package manager

import (
	"context"
	"fmt"
	"net/url"
	"sync"

	"dhub/internal/driver"
	"dhub/internal/driver/mysql"
	"dhub/internal/driver/postgres"
	"dhub/internal/driver/sqlite"
	"dhub/internal/store"
	"dhub/internal/tunnel"
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
		return sqlite.NewSQLiteDriver(cfg.FilePath)
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
		u.RawQuery = q.Encode()
		return postgres.NewPostgresDriver(u.String())
	case "mysql":
		// user:password@tcp(host:port)/dbname?parseTime=true&multiStatements=true
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&multiStatements=true",
			cfg.Username, cfg.Password, host, port, cfg.DatabaseName)
		return mysql.NewMySQLDriver(dsn)
	default:
		return nil, fmt.Errorf("unsupported driver: %s", cfg.Driver)
	}
}

