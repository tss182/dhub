package manager

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"dhub/internal/driver"
	"dhub/internal/driver/clickhouse"
	"dhub/internal/driver/elasticsearch"
	"dhub/internal/driver/mariadb"
	"dhub/internal/driver/mongodb"
	"dhub/internal/driver/mssql"
	"dhub/internal/driver/mysql"
	"dhub/internal/driver/oracle"
	"dhub/internal/driver/postgres"
	"dhub/internal/driver/qdrant"
	redisdriver "dhub/internal/driver/redis"
	"dhub/internal/driver/sqlite"
	"dhub/internal/store"
	"dhub/internal/tunnel"

	mysqldriver "github.com/go-sql-driver/mysql"
	goredis "github.com/redis/go-redis/v9"
	go_ora "github.com/sijms/go-ora/v2"
)

type Session struct {
	Config         store.ConnectionConfig
	Driver         driver.DatabaseDriver
	Tunnel         *tunnel.Tunnel
	lastPingUnixMs atomic.Int64
}

const sessionPingIntervalMs = 15_000

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
		nowMs := time.Now().UnixMilli()
		if nowMs-s.lastPingUnixMs.Load() <= sessionPingIntervalMs {
			return s.Driver, nil
		}
		if err := s.Driver.Ping(ctx); err == nil {
			s.lastPingUnixMs.Store(nowMs)
			return s.Driver, nil
		}
		// Stale session, close and reconnect only if it's still the same instance
		m.disconnectIfSame(connectionID, s)
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
		remoteHost, remotePort := resolveSSHRemoteTarget(cfg)
		tun, err = tunnel.OpenSSHTunnel(tunnel.SSHTunnelConfig{
			Host:       cfg.SSHHost,
			Port:       cfg.SSHPort,
			User:       cfg.SSHUser,
			AuthType:   cfg.SSHAuthType,
			Password:   cfg.SSHPassword,
			KeyPath:    cfg.SSHKeyPath,
			RemoteHost: remoteHost,
			RemotePort: remotePort,
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

// TestConnectionInfo tests the connection and returns an optional server version string.
func (m *SessionManager) TestConnectionInfo(ctx context.Context, cfg store.ConnectionConfig) (string, error) {
	var tun *tunnel.Tunnel
	var err error
	targetHost := cfg.Host
	targetPort := cfg.Port

	if cfg.SSHEnabled {
		remoteHost, remotePort := resolveSSHRemoteTarget(cfg)
		tun, err = tunnel.OpenSSHTunnel(tunnel.SSHTunnelConfig{
			Host:       cfg.SSHHost,
			Port:       cfg.SSHPort,
			User:       cfg.SSHUser,
			AuthType:   cfg.SSHAuthType,
			Password:   cfg.SSHPassword,
			KeyPath:    cfg.SSHKeyPath,
			RemoteHost: remoteHost,
			RemotePort: remotePort,
		})
		if err != nil {
			return "", fmt.Errorf("ssh tunnel connection failed: %w", err)
		}
		defer tun.Close()
		targetHost = "127.0.0.1"
		targetPort = tun.LocalPort
	}

	drv, err := m.createDriver(cfg, targetHost, targetPort)
	if err != nil {
		return "", err
	}
	defer drv.Close()

	if err := drv.Ping(ctx); err != nil {
		return "", err
	}
	if vp, ok := drv.(interface {
		ServerVersion(context.Context) (string, error)
	}); ok {
		if ver, vErr := vp.ServerVersion(ctx); vErr == nil && ver != "" {
			return ver, nil
		}
	}
	return "", nil
}

func (m *SessionManager) disconnectIfSame(connectionID string, target *Session) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if s, ok := m.sessions[connectionID]; ok && s == target {
		_ = s.Driver.Close()
		if s.Tunnel != nil {
			_ = s.Tunnel.Close()
		}
		delete(m.sessions, connectionID)
	}
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

	// Double-check in case another goroutine already established this session while waiting for the lock.
	if existing, exists := m.sessions[cfg.ID]; exists {
		nowMs := time.Now().UnixMilli()
		if nowMs-existing.lastPingUnixMs.Load() <= sessionPingIntervalMs {
			return existing.Driver, nil
		}
		if err := existing.Driver.Ping(ctx); err == nil {
			existing.lastPingUnixMs.Store(nowMs)
			return existing.Driver, nil
		}
		_ = existing.Driver.Close()
		if existing.Tunnel != nil {
			_ = existing.Tunnel.Close()
		}
		delete(m.sessions, cfg.ID)
	}

	var tun *tunnel.Tunnel
	var err error
	targetHost := cfg.Host
	targetPort := cfg.Port

	if cfg.SSHEnabled {
		remoteHost, remotePort := resolveSSHRemoteTarget(cfg)
		tun, err = tunnel.OpenSSHTunnel(tunnel.SSHTunnelConfig{
			Host:       cfg.SSHHost,
			Port:       cfg.SSHPort,
			User:       cfg.SSHUser,
			AuthType:   cfg.SSHAuthType,
			Password:   cfg.SSHPassword,
			KeyPath:    cfg.SSHKeyPath,
			RemoteHost: remoteHost,
			RemotePort: remotePort,
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

	sess := &Session{
		Config: cfg,
		Driver: drv,
		Tunnel: tun,
	}
	sess.lastPingUnixMs.Store(time.Now().UnixMilli())
	m.sessions[cfg.ID] = sess

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
		dbName := strings.TrimSpace(cfg.DatabaseName)
		if dbName == "" {
			dbName = "postgres"
		}
		if !strings.HasPrefix(dbName, "/") {
			dbName = "/" + dbName
		}
		// postgres://user:password@host:port/dbname?sslmode=disable
		u := url.URL{
			Scheme: "postgres",
			User:   url.UserPassword(cfg.Username, cfg.Password),
			Host:   fmt.Sprintf("%s:%d", host, port),
			Path:   dbName,
		}
		q := u.Query()
		q.Set("sslmode", sslMode)
		q.Set("connect_timeout", "10")
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
	case "mysql", "mariadb":
		mc := mysqldriver.NewConfig()
		mc.User = cfg.Username
		mc.Passwd = cfg.Password
		mc.Net = "tcp"
		mc.Addr = fmt.Sprintf("%s:%d", host, port)
		mc.DBName = cfg.DatabaseName
		mc.ParseTime = true
		mc.MultiStatements = true
		mc.Timeout = 10 * time.Second

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

		if cfg.Driver == "mariadb" {
			return mariadb.NewMariaDBDriver(mc.FormatDSN())
		}
		return mysql.NewMySQLDriver(mc.FormatDSN())
	case "redis":
		if port <= 0 {
			port = 6379
		}
		if host == "" {
			host = "127.0.0.1"
		}
		redisOpts := &goredis.Options{
			Addr:            fmt.Sprintf("%s:%d", host, port),
			Username:        cfg.Username,
			Password:        cfg.Password,
			DB:              redisdriver.ParseDB(cfg.DatabaseName),
			DialTimeout:     10 * time.Second,
			PoolSize:        4,
			MinIdleConns:    0,
			ConnMaxIdleTime: 2 * time.Minute,
		}

		if cfg.SSLMode != "" && cfg.SSLMode != "disable" {
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
			if cfg.SSLMode == "require" || cfg.SSLMode == "required" {
				tlsCfg.InsecureSkipVerify = true
			}
			redisOpts.TLSConfig = tlsCfg
		}

		return redisdriver.NewRedisDriver(redisOpts)
	case "mssql", "sqlserver":
		if port <= 0 {
			port = 1433
		}
		if host == "" {
			host = "127.0.0.1"
		}
		dbName := strings.TrimSpace(cfg.DatabaseName)
		if dbName == "" {
			dbName = "master"
		}

		u := &url.URL{
			Scheme: "sqlserver",
			Host:   fmt.Sprintf("%s:%d", host, port),
		}
		if cfg.Username != "" || cfg.Password != "" {
			u.User = url.UserPassword(cfg.Username, cfg.Password)
		}
		q := u.Query()
		q.Set("database", dbName)

		switch cfg.SSLMode {
		case "require", "required":
			q.Set("encrypt", "true")
			q.Set("trustservercertificate", "true")
		case "verify-ca", "verify-full", "verify-identity":
			q.Set("encrypt", "true")
			q.Set("trustservercertificate", "false")
			if cfg.SSLCAPath != "" {
				q.Set("certificate", cfg.SSLCAPath)
			}
		default:
			q.Set("encrypt", "disable")
			q.Set("trustservercertificate", "true")
		}

		u.RawQuery = q.Encode()
		return mssql.NewMSSQLDriver(u.String())
	case "mongodb", "mongo":
		connStr := strings.TrimSpace(cfg.Host)
		if strings.HasPrefix(connStr, "mongodb://") || strings.HasPrefix(connStr, "mongodb+srv://") {
			return mongodb.NewMongoDBDriver(connStr)
		}
		if port <= 0 {
			port = 27017
		}
		if host == "" {
			host = "127.0.0.1"
		}
		dbName := strings.TrimSpace(cfg.DatabaseName)
		if dbName == "" {
			dbName = "admin"
		}

		u := &url.URL{
			Scheme: "mongodb",
			Host:   fmt.Sprintf("%s:%d", host, port),
			Path:   "/" + dbName,
		}
		if cfg.Username != "" || cfg.Password != "" {
			u.User = url.UserPassword(cfg.Username, cfg.Password)
		}
		q := u.Query()
		if cfg.Username != "" {
			q.Set("authSource", dbName)
		}

		if cfg.SSLMode != "" && cfg.SSLMode != "disable" {
			q.Set("tls", "true")
			if cfg.SSLMode == "require" || cfg.SSLMode == "required" {
				q.Set("tlsInsecure", "true")
			}
			if cfg.SSLCAPath != "" {
				q.Set("tlsCAFile", cfg.SSLCAPath)
			}
			if cfg.SSLCertPath != "" {
				q.Set("tlsCertificateKeyFile", cfg.SSLCertPath)
			}
		}

		u.RawQuery = q.Encode()
		return mongodb.NewMongoDBDriver(u.String())
	case "qdrant":
		baseURL, origHostname := resolveHTTPBaseURL(cfg, host, port, 6333)
		tlsCfg, tlsErr := buildHTTPDriverTLSConfig(cfg, baseURL, origHostname)
		if tlsErr != nil {
			return nil, tlsErr
		}
		drv, err := qdrant.NewQdrantDriver(baseURL, cfg.Password, tlsCfg)
		if err != nil {
			return nil, err
		}
		if cfg.SSHEnabled && origHostname != "" {
			drv.SetHostHeader(origHostname)
		}
		return drv, nil
	case "elasticsearch", "es":
		baseURL, origHostname := resolveHTTPBaseURL(cfg, host, port, 9200)
		tlsCfg, tlsErr := buildHTTPDriverTLSConfig(cfg, baseURL, origHostname)
		if tlsErr != nil {
			return nil, tlsErr
		}
		return elasticsearch.NewElasticsearchDriver(baseURL, cfg.Username, cfg.Password, tlsCfg)
	case "clickhouse":
		connStr := strings.TrimSpace(cfg.Host)
		if strings.HasPrefix(connStr, "clickhouse://") || strings.HasPrefix(connStr, "http://") || strings.HasPrefix(connStr, "https://") {
			return clickhouse.NewClickHouseDriver(connStr)
		}
		if port <= 0 {
			port = 9000
		}
		if host == "" {
			host = "127.0.0.1"
		}
		dbName := strings.TrimSpace(cfg.DatabaseName)
		if dbName == "" {
			dbName = "default"
		}
		username := strings.TrimSpace(cfg.Username)
		if username == "" {
			username = "default"
		}

		scheme := "clickhouse"
		if port == 8123 {
			scheme = "http"
		} else if port == 8443 {
			scheme = "https"
		}

		u := &url.URL{
			Scheme: scheme,
			Host:   fmt.Sprintf("%s:%d", host, port),
			Path:   "/" + dbName,
		}
		if username != "" || cfg.Password != "" {
			u.User = url.UserPassword(username, cfg.Password)
		}
		q := u.Query()
		q.Set("dial_timeout", "10s")

		if cfg.SSLMode != "" && cfg.SSLMode != "disable" {
			q.Set("secure", "true")
			if cfg.SSLMode == "require" || cfg.SSLMode == "required" {
				q.Set("skip_verify", "true")
			}
		}

		u.RawQuery = q.Encode()
		return clickhouse.NewClickHouseDriver(u.String())
	case "oracle":
		connStr := strings.TrimSpace(cfg.Host)
		dbName := strings.TrimSpace(cfg.DatabaseName)
		if dbName == "" {
			dbName = "ORCL"
		}
		if strings.HasPrefix(connStr, "oracle://") {
			return oracle.NewOracleDriver(connStr, dbName)
		}
		if port <= 0 {
			port = 1521
		}
		if host == "" {
			host = "127.0.0.1"
		}
		urlOptions := map[string]string{
			"CONNECTION TIMEOUT": "10",
		}
		if cfg.SSLMode != "" && cfg.SSLMode != "disable" {
			urlOptions["SSL"] = "true"
			if cfg.SSLMode == "require" || cfg.SSLMode == "required" {
				urlOptions["SSL Verify"] = "false"
			} else {
				urlOptions["SSL Verify"] = "true"
			}
		}
		dsn := go_ora.BuildUrl(host, port, dbName, cfg.Username, cfg.Password, urlOptions)
		return oracle.NewOracleDriver(dsn, dbName)
	default:
		return nil, fmt.Errorf("unsupported driver: %s", cfg.Driver)
	}
}

func resolveSSHRemoteTarget(cfg store.ConnectionConfig) (string, int) {
	rawHost := strings.TrimSpace(cfg.Host)
	remoteHost := rawHost
	remotePort := cfg.Port
	if strings.HasPrefix(rawHost, "http://") || strings.HasPrefix(rawHost, "https://") {
		if u, err := url.Parse(rawHost); err == nil && u.Hostname() != "" {
			remoteHost = u.Hostname()
			if pStr := u.Port(); pStr != "" {
				if p, pErr := strconv.Atoi(pStr); pErr == nil && p > 0 {
					remotePort = p
				}
			} else if remotePort <= 0 {
				if u.Scheme == "https" {
					remotePort = 443
				} else if u.Scheme == "http" {
					remotePort = 80
				}
			}
		}
	}
	if remotePort <= 0 && strings.EqualFold(strings.TrimSpace(cfg.Driver), "qdrant") {
		remotePort = 6333
	}
	return remoteHost, remotePort
}

func resolveHTTPBaseURL(cfg store.ConnectionConfig, host string, port, defaultPort int) (baseURL, origHostname string) {
	rawHost := strings.TrimSpace(cfg.Host)
	wantTLS := cfg.SSLMode != "" && cfg.SSLMode != "disable"
	if strings.HasPrefix(rawHost, "http://") || strings.HasPrefix(rawHost, "https://") {
		if u, err := url.Parse(rawHost); err == nil {
			origHostname = u.Hostname()
			if wantTLS && u.Scheme == "http" {
				u.Scheme = "https"
			}
			if cfg.SSHEnabled {
				if port <= 0 {
					port = defaultPort
				}
				if host == "" {
					host = "127.0.0.1"
				}
				u.Host = net.JoinHostPort(host, strconv.Itoa(port))
				return strings.TrimRight(u.String(), "/"), origHostname
			}
			if u.Port() == "" && port > 0 && port != 443 && port != 80 {
				u.Host = net.JoinHostPort(origHostname, strconv.Itoa(port))
			}
			return strings.TrimRight(u.String(), "/"), origHostname
		}
		return strings.TrimRight(rawHost, "/"), ""
	}
	if port <= 0 {
		port = defaultPort
	}
	if host == "" {
		host = "127.0.0.1"
	}
	scheme := "http"
	if wantTLS {
		scheme = "https"
	}
	if cfg.SSHEnabled {
		origHostname = rawHost
	}
	return fmt.Sprintf("%s://%s", scheme, net.JoinHostPort(host, strconv.Itoa(port))), origHostname
}

func buildHTTPDriverTLSConfig(cfg store.ConnectionConfig, baseURL, origHostname string) (*tls.Config, error) {
	if !strings.HasPrefix(baseURL, "https://") && (cfg.SSLMode == "" || cfg.SSLMode == "disable") {
		return nil, nil
	}
	tlsCfg := &tls.Config{}
	if cfg.SSHEnabled && origHostname != "" {
		tlsCfg.ServerName = origHostname
	}
	if cfg.SSLCAPath != "" {
		pem, err := os.ReadFile(cfg.SSLCAPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read SSL CA file %q: %w", cfg.SSLCAPath, err)
		}
		rootCertPool := x509.NewCertPool()
		if !rootCertPool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("failed to parse SSL CA certificates from %q", cfg.SSLCAPath)
		}
		tlsCfg.RootCAs = rootCertPool
	}
	if cfg.SSLCertPath != "" && cfg.SSLKeyPath != "" {
		cert, err := tls.LoadX509KeyPair(cfg.SSLCertPath, cfg.SSLKeyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to load SSL client certificate/key: %w", err)
		}
		tlsCfg.Certificates = []tls.Certificate{cert}
	}
	switch cfg.SSLMode {
	case "require", "required":
		tlsCfg.InsecureSkipVerify = true
	case "verify-ca":
		tlsCfg.InsecureSkipVerify = true
		roots := tlsCfg.RootCAs
		tlsCfg.VerifyConnection = func(cs tls.ConnectionState) error {
			opts := x509.VerifyOptions{
				Roots:         roots,
				Intermediates: x509.NewCertPool(),
			}
			for _, cert := range cs.PeerCertificates[1:] {
				opts.Intermediates.AddCert(cert)
			}
			_, err := cs.PeerCertificates[0].Verify(opts)
			return err
		}
	}
	return tlsCfg, nil
}

