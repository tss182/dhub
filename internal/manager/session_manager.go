package manager

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/url"
	"os"
	"sync"

	"dhub/internal/driver"
	"dhub/internal/driver/mysql"
	"dhub/internal/driver/postgres"
	"dhub/internal/driver/sqlite"
	"dhub/internal/store"
	"dhub/internal/tunnel"

	mysqldriver "github.com/go-sql-driver/mysql"
)

type Session struct {
	Config store.ConnectionConfig
	Driver driver.DatabaseDriver
	Tunnel *tunnel.Tunnel
}

type SessionManager struct {
	store    *store.LocalStore
	mu       sync.RWMutex
	sessions map[string]*Session
}

func NewSessionManager(s *store.LocalStore) *SessionManager {
	return &SessionManager{
		store:    s,
		sessions: make(map[string]*Session),
	}
}

func (m *SessionManager) GetOrConnect(ctx context.Context, connectionID string) (driver.DatabaseDriver, error) {
	m.mu.RLock()
	s, exists := m.sessions[connectionID]
	m.mu.RUnlock()

	if exists {
		if err := s.Driver.Ping(ctx); err == nil {
			return s.Driver, nil
		}
		// Stale session, close and reconnect
		m.Disconnect(connectionID)
	}

	cfg, err := m.store.GetConnection(ctx, connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get connection config: %w", err)
	}

	return m.connect(ctx, *cfg)
}

func (m *SessionManager) TestConnection(ctx context.Context, cfg store.ConnectionConfig) error {
	var tun *tunnel.Tunnel
	var err error
	targetHost := cfg.Host
	targetPort := cfg.Port

	if cfg.SSHEnabled {
		tun, err = tunnel.OpenSSHTunnel(tunnel.SSHTunnelConfig{
			Host:       cfg.SSHHost,
			Port:       cfg.SSHPort,
			User:       cfg.SSHUser,
			AuthType:   cfg.SSHAuthType,
			Password:   cfg.SSHPassword,
			KeyPath:    cfg.SSHKeyPath,
			RemoteHost: cfg.Host,
			RemotePort: cfg.Port,
		})
		if err != nil {
			return fmt.Errorf("ssh tunnel connection failed: %w", err)
		}
		defer tun.Close()
		targetHost = "127.0.0.1"
		targetPort = tun.LocalPort
	}

	drv, err := m.createDriver(cfg, targetHost, targetPort)
	if err != nil {
		return err
	}
	defer drv.Close()

	return drv.Ping(ctx)
}

func (m *SessionManager) Disconnect(connectionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if s, ok := m.sessions[connectionID]; ok {
		_ = s.Driver.Close()
		if s.Tunnel != nil {
			_ = s.Tunnel.Close()
		}
		delete(m.sessions, connectionID)
	}
}

func (m *SessionManager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, s := range m.sessions {
		_ = s.Driver.Close()
		if s.Tunnel != nil {
			_ = s.Tunnel.Close()
		}
		delete(m.sessions, id)
	}
}

func (m *SessionManager) connect(ctx context.Context, cfg store.ConnectionConfig) (driver.DatabaseDriver, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var tun *tunnel.Tunnel
	var err error
	targetHost := cfg.Host
	targetPort := cfg.Port

	if cfg.SSHEnabled {
		tun, err = tunnel.OpenSSHTunnel(tunnel.SSHTunnelConfig{
			Host:       cfg.SSHHost,
			Port:       cfg.SSHPort,
			User:       cfg.SSHUser,
			AuthType:   cfg.SSHAuthType,
			Password:   cfg.SSHPassword,
			KeyPath:    cfg.SSHKeyPath,
			RemoteHost: cfg.Host,
			RemotePort: cfg.Port,
		})
		if err != nil {
			return nil, fmt.Errorf("ssh tunnel failed: %w", err)
		}
		targetHost = "127.0.0.1"
		targetPort = tun.LocalPort
	}

	drv, err := m.createDriver(cfg, targetHost, targetPort)
	if err != nil {
		if tun != nil {
			_ = tun.Close()
		}
		return nil, err
	}

	if err := drv.Ping(ctx); err != nil {
		_ = drv.Close()
		if tun != nil {
			_ = tun.Close()
		}
		return nil, fmt.Errorf("ping failed: %w", err)
	}

	m.sessions[cfg.ID] = &Session{
		Config: cfg,
		Driver: drv,
		Tunnel: tun,
	}

	return drv, nil
}

func (m *SessionManager) createDriver(cfg store.ConnectionConfig, host string, port int) (driver.DatabaseDriver, error) {
	switch cfg.Driver {
	case "sqlite":
		targetPath := cfg.FilePath
		if targetPath == "" {
			targetPath = cfg.Host
		}
		if targetPath == "" {
			targetPath = cfg.DatabaseName
		}
		return sqlite.NewSQLiteDriver(targetPath)
	case "postgres":
		sslMode := cfg.SSLMode
		if sslMode == "" {
			sslMode = "disable"
		}
		// postgres://user:password@host:port/dbname?sslmode=disable
		u := url.URL{
			Scheme: "postgres",
			User:   url.UserPassword(cfg.Username, cfg.Password),
			Host:   fmt.Sprintf("%s:%d", host, port),
			Path:   cfg.DatabaseName,
		}
		q := u.Query()
		q.Set("sslmode", sslMode)
		if cfg.SSLCAPath != "" {
			q.Set("sslrootcert", cfg.SSLCAPath)
		}
		if cfg.SSLCertPath != "" {
			q.Set("sslcert", cfg.SSLCertPath)
		}
		if cfg.SSLKeyPath != "" {
			q.Set("sslkey", cfg.SSLKeyPath)
		}
		u.RawQuery = q.Encode()
		return postgres.NewPostgresDriver(u.String())
	case "mysql":
		mc := mysqldriver.NewConfig()
		mc.User = cfg.Username
		mc.Passwd = cfg.Password
		mc.Net = "tcp"
		mc.Addr = fmt.Sprintf("%s:%d", host, port)
		mc.DBName = cfg.DatabaseName
		mc.ParseTime = true
		mc.MultiStatements = true

		// Handle SSL/TLS configuration
		if cfg.SSLCAPath != "" || (cfg.SSLCertPath != "" && cfg.SSLKeyPath != "") {
			tlsCfg := &tls.Config{}
			if cfg.SSLCAPath != "" {
				rootCertPool := x509.NewCertPool()
				pem, err := os.ReadFile(cfg.SSLCAPath)
				if err == nil {
					rootCertPool.AppendCertsFromPEM(pem)
					tlsCfg.RootCAs = rootCertPool
				}
			}
			if cfg.SSLCertPath != "" && cfg.SSLKeyPath != "" {
				cert, err := tls.LoadX509KeyPair(cfg.SSLCertPath, cfg.SSLKeyPath)
				if err == nil {
					tlsCfg.Certificates = []tls.Certificate{cert}
				}
			}
			if cfg.SSLMode == "required" || cfg.SSLMode == "require" {
				tlsCfg.InsecureSkipVerify = true
			}
			tlsConfigName := fmt.Sprintf("custom_tls_%s", cfg.ID)
			if err := mysqldriver.RegisterTLSConfig(tlsConfigName, tlsCfg); err == nil {
				mc.TLSConfig = tlsConfigName
			}
		} else {
			switch cfg.SSLMode {
			case "preferred":
				mc.TLSConfig = "preferred"
			case "required", "require":
				mc.TLSConfig = "skip-verify"
			case "verify-ca", "verify-identity", "verify-full":
				mc.TLSConfig = "true"
			default:
				mc.TLSConfig = "false"
			}
		}

		return mysql.NewMySQLDriver(mc.FormatDSN())
	default:
		return nil, fmt.Errorf("unsupported driver: %s", cfg.Driver)
	}
}

