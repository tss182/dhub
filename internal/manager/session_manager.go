package manager

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
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

	goredis "github.com/redis/go-redis/v9"
	go_ora "github.com/sijms/go-ora/v2"
	mongoopts "go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
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

// GetExisting returns the active driver for connectionID without opening a new connection.
func (m *SessionManager) GetExisting(connectionID string) driver.DatabaseDriver {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if s, ok := m.sessions[connectionID]; ok && s != nil {
		return s.Driver
	}
	return nil
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
	if sip, ok := drv.(driver.ServerInfoProvider); ok {
		if info, iErr := sip.ServerInfo(ctx); iErr == nil && info != nil && info.Version != "" {
			if info.Flavor != "" {
				return info.Flavor + " " + info.Version, nil
			}
			return info.Version, nil
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
		return sqlite.NewSQLiteDriverWithOptions(targetPath, cfg.IsReadOnly)
	case "postgres":
		sslMode := strings.TrimSpace(cfg.SSLMode)
		if sslMode == "" {
			sslMode = "disable"
		}
		rawHost := strings.TrimSpace(cfg.Host)
		var u url.URL
		if strings.HasPrefix(rawHost, "postgres://") || strings.HasPrefix(rawHost, "postgresql://") {
			parsed, perr := url.Parse(rawHost)
			if perr != nil {
				return nil, fmt.Errorf("invalid PostgreSQL URI: %w", perr)
			}
			u = *parsed
			u.Scheme = "postgres"
			if cfg.SSHEnabled && host != "" && port > 0 {
				u.Host = net.JoinHostPort(host, strconv.Itoa(port))
			}
			if u.User == nil && (cfg.Username != "" || cfg.Password != "") {
				u.User = url.UserPassword(cfg.Username, cfg.Password)
			}
			if (u.Path == "" || u.Path == "/") && strings.TrimSpace(cfg.DatabaseName) != "" {
				u.Path = "/" + strings.TrimSpace(cfg.DatabaseName)
			}
			if u.Path == "" || u.Path == "/" {
				u.Path = "/postgres"
			}
		} else {
			if port <= 0 {
				port = 5432
			}
			if host == "" {
				host = "127.0.0.1"
			}
			dbName := strings.TrimSpace(cfg.DatabaseName)
			if dbName == "" {
				dbName = "postgres"
			}
			if !strings.HasPrefix(dbName, "/") {
				dbName = "/" + dbName
			}
			u = url.URL{
				Scheme: "postgres",
				User:   url.UserPassword(cfg.Username, cfg.Password),
				Host:   net.JoinHostPort(host, strconv.Itoa(port)),
				Path:   dbName,
			}
		}
		q := u.Query()
		if q.Get("sslmode") == "" || cfg.SSLMode != "" {
			q.Set("sslmode", sslMode)
		}
		if q.Get("connect_timeout") == "" {
			q.Set("connect_timeout", "10")
		}
		if q.Get("application_name") == "" {
			q.Set("application_name", "DHub")
		}
		if cfg.SSLCAPath != "" {
			q.Set("sslrootcert", cfg.SSLCAPath)
		}
		if cfg.SSLCertPath != "" {
			q.Set("sslcert", cfg.SSLCertPath)
		}
		if cfg.SSLKeyPath != "" {
			q.Set("sslkey", cfg.SSLKeyPath)
		}
		if cfg.IsReadOnly {
			q.Set("default_transaction_read_only", "on")
		}
		if strings.TrimSpace(cfg.OptionsJSON) != "" {
			var pgOpts struct {
				ApplicationName string `json:"applicationName"`
				SearchPath      string `json:"searchPath"`
				StatementTimout string `json:"statementTimeout"`
				ExecMode        string `json:"defaultQueryExecMode"`
			}
			if json.Unmarshal([]byte(cfg.OptionsJSON), &pgOpts) == nil {
				if strings.TrimSpace(pgOpts.ApplicationName) != "" {
					q.Set("application_name", strings.TrimSpace(pgOpts.ApplicationName))
				}
				if strings.TrimSpace(pgOpts.SearchPath) != "" {
					q.Set("search_path", strings.TrimSpace(pgOpts.SearchPath))
				}
				if strings.TrimSpace(pgOpts.StatementTimout) != "" {
					q.Set("statement_timeout", strings.TrimSpace(pgOpts.StatementTimout))
				}
				if strings.TrimSpace(pgOpts.ExecMode) != "" {
					q.Set("default_query_exec_mode", strings.TrimSpace(pgOpts.ExecMode))
				}
			}
		}
		u.RawQuery = q.Encode()
		return postgres.NewPostgresDriver(u.String())
	case "mysql", "mariadb":
		mc, err := newMySQLConfig(cfg, host, port)
		if err != nil {
			return nil, err
		}
		initSQL := extractMySQLInitSQL(cfg)
		if cfg.Driver == "mariadb" {
			return mariadb.NewMariaDBDriverWithInitSQL(mc.FormatDSN(), cfg.IsReadOnly, initSQL)
		}
		return mysql.NewMySQLDriverWithInitSQL(mc.FormatDSN(), cfg.IsReadOnly, initSQL)
	case "redis":
		if port <= 0 {
			port = 6379
		}
		if host == "" {
			host = "127.0.0.1"
		}
		redisOpts := &goredis.Options{
			Addr:            net.JoinHostPort(host, strconv.Itoa(port)),
			Username:        cfg.Username,
			Password:        cfg.Password,
			DB:              redisdriver.ParseDB(cfg.DatabaseName),
			DialTimeout:     10 * time.Second,
			PoolSize:        4,
			MinIdleConns:    0,
			ConnMaxIdleTime: 2 * time.Minute,
		}

		sslModeLower := strings.ToLower(strings.TrimSpace(cfg.SSLMode))
		if sslModeLower != "" && sslModeLower != "disable" && sslModeLower != "disabled" {
			tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
			if cfg.SSHEnabled && strings.TrimSpace(cfg.Host) != "" {
				tlsCfg.ServerName = strings.TrimSpace(cfg.Host)
			}
			if strings.TrimSpace(cfg.SSLCAPath) != "" {
				rootCertPool := x509.NewCertPool()
				pem, err := os.ReadFile(cfg.SSLCAPath)
				if err != nil {
					return nil, fmt.Errorf("failed to read Redis SSL CA file %q: %w", cfg.SSLCAPath, err)
				}
				if !rootCertPool.AppendCertsFromPEM(pem) {
					return nil, fmt.Errorf("failed to parse Redis SSL CA certificates from %q", cfg.SSLCAPath)
				}
				tlsCfg.RootCAs = rootCertPool
			}
			certPath, keyPath := strings.TrimSpace(cfg.SSLCertPath), strings.TrimSpace(cfg.SSLKeyPath)
			if (certPath == "") != (keyPath == "") {
				return nil, fmt.Errorf("Redis SSL client certificate and key must both be set")
			}
			if certPath != "" {
				cert, err := tls.LoadX509KeyPair(certPath, keyPath)
				if err != nil {
					return nil, fmt.Errorf("failed to load Redis SSL client certificate/key: %w", err)
				}
				tlsCfg.Certificates = []tls.Certificate{cert}
			}
			switch sslModeLower {
			case "require", "required":
				tlsCfg.InsecureSkipVerify = true
			case "verify-ca":
				tlsCfg.InsecureSkipVerify = true
				roots := tlsCfg.RootCAs
				tlsCfg.VerifyConnection = func(cs tls.ConnectionState) error {
					if len(cs.PeerCertificates) == 0 {
						return fmt.Errorf("server presented no TLS certificates")
					}
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
		if cfg.IsReadOnly {
			q.Set("ApplicationIntent", "ReadOnly")
		}

		switch strings.ToLower(strings.TrimSpace(cfg.SSLMode)) {
		case "require", "required", "prefer", "preferred":
			q.Set("encrypt", "true")
			q.Set("trustservercertificate", "true")
		case "verify-ca":
			q.Set("encrypt", "true")
			q.Set("trustservercertificate", "false")
			if cfg.SSLCAPath != "" {
				q.Set("certificate", cfg.SSLCAPath)
			}
		case "verify-full", "verify-identity":
			q.Set("encrypt", "true")
			q.Set("trustservercertificate", "false")
			if cfg.SSLCAPath != "" {
				q.Set("certificate", cfg.SSLCAPath)
			}
			if cfg.SSHEnabled && strings.TrimSpace(cfg.Host) != "" {
				q.Set("hostNameInCertificate", strings.TrimSpace(cfg.Host))
			}
		default:
			q.Set("encrypt", "disable")
			q.Set("trustservercertificate", "true")
		}

		u.RawQuery = q.Encode()
		return mssql.NewMSSQLDriver(u.String())
	case "mongodb", "mongo":
		return buildMongoDriver(cfg, host, port)
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
		drv, err := elasticsearch.NewElasticsearchDriver(baseURL, cfg.Username, cfg.Password, tlsCfg)
		if err != nil {
			return nil, err
		}
		if cfg.SSHEnabled && origHostname != "" {
			drv.SetHostHeader(origHostname)
		}
		return drv, nil
	case "clickhouse":
		connStr := strings.TrimSpace(cfg.Host)
		if strings.HasPrefix(connStr, "clickhouse://") || strings.HasPrefix(connStr, "http://") || strings.HasPrefix(connStr, "https://") {
			if u, err := url.Parse(connStr); err == nil {
				origHost := u.Hostname()
				if cfg.SSHEnabled && host != "" && port > 0 {
					u.Host = net.JoinHostPort(host, strconv.Itoa(port))
				}
				if u.Path == "" || u.Path == "/" {
					if dbName := strings.TrimSpace(cfg.DatabaseName); dbName != "" {
						u.Path = "/" + dbName
					}
				}
				if cfg.IsReadOnly {
					q := u.Query()
					q.Set("readonly", "1")
					u.RawQuery = q.Encode()
				}
				tlsCfg, tlsErr := buildHTTPDriverTLSConfig(cfg, u.String(), origHost)
				if tlsErr != nil {
					return nil, tlsErr
				}
				return clickhouse.NewClickHouseDriverWithTLS(u.String(), tlsCfg)
			}
			tlsCfg, tlsErr := buildHTTPDriverTLSConfig(cfg, connStr, "")
			if tlsErr != nil {
				return nil, tlsErr
			}
			return clickhouse.NewClickHouseDriverWithTLS(connStr, tlsCfg)
		}
		if port <= 0 {
			if strings.EqualFold(strings.TrimSpace(cfg.Protocol), "http") {
				if cfg.SSLMode != "" && cfg.SSLMode != "disable" {
					port = 8443
				} else {
					port = 8123
				}
			} else {
				port = 9000
			}
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

		// Use original cfg.Port (not tunneled local port) and explicit Protocol for scheme detection.
		origPort := cfg.Port
		scheme := "clickhouse"
		if strings.EqualFold(strings.TrimSpace(cfg.Protocol), "http") {
			if cfg.SSLMode != "" && cfg.SSLMode != "disable" {
				scheme = "https"
			} else {
				scheme = "http"
			}
		} else if origPort == 8123 {
			scheme = "http"
		} else if origPort == 8443 {
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
		if cfg.IsReadOnly {
			q.Set("readonly", "1")
		}

		var tlsCfg *tls.Config
		chSSL := strings.ToLower(strings.TrimSpace(cfg.SSLMode))
		if chSSL != "" && chSSL != "disable" && chSSL != "disabled" {
			q.Set("secure", "true")
			if chSSL == "require" || chSSL == "required" {
				q.Set("skip_verify", "true")
			}
			origHost := strings.TrimSpace(cfg.Host)
			var tlsErr error
			tlsCfg, tlsErr = buildHTTPDriverTLSConfig(cfg, u.String(), origHost)
			if tlsErr != nil {
				return nil, tlsErr
			}
		}

		u.RawQuery = q.Encode()
		return clickhouse.NewClickHouseDriverWithTLS(u.String(), tlsCfg)
	case "oracle":
		connStr := strings.TrimSpace(cfg.Host)
		dbName := strings.TrimSpace(cfg.DatabaseName)
		if dbName == "" {
			dbName = "ORCL"
		}
		if strings.HasPrefix(connStr, "oracle://") {
			if cfg.SSHEnabled && host != "" && port > 0 {
				if u, perr := url.Parse(connStr); perr == nil {
					u.Host = net.JoinHostPort(host, strconv.Itoa(port))
					connStr = u.String()
				}
			}
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
		oraSSL := strings.ToLower(strings.TrimSpace(cfg.SSLMode))
		if oraSSL != "" && oraSSL != "disable" && oraSSL != "disabled" {
			urlOptions["SSL"] = "true"
			if oraSSL == "require" || oraSSL == "required" {
				urlOptions["SSL Verify"] = "false"
			} else {
				urlOptions["SSL Verify"] = "true"
			}
			if strings.TrimSpace(cfg.SSLCAPath) != "" {
				urlOptions["WALLET"] = strings.TrimSpace(cfg.SSLCAPath)
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
	if strings.HasPrefix(rawHost, "http://") || strings.HasPrefix(rawHost, "https://") || strings.HasPrefix(rawHost, "clickhouse://") || strings.HasPrefix(rawHost, "mongodb://") || strings.HasPrefix(rawHost, "postgres://") || strings.HasPrefix(rawHost, "postgresql://") || strings.HasPrefix(rawHost, "oracle://") {
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
				} else if u.Scheme == "clickhouse" {
					remotePort = 9000
				} else if u.Scheme == "mongodb" {
					remotePort = 27017
				} else if u.Scheme == "postgres" || u.Scheme == "postgresql" {
					remotePort = 5432
				}
			}
		}
	}
	if remotePort <= 0 && strings.EqualFold(strings.TrimSpace(cfg.Driver), "postgres") {
		remotePort = 5432
	} else if remotePort <= 0 && strings.EqualFold(strings.TrimSpace(cfg.Driver), "qdrant") {
		remotePort = 6333
	} else if remotePort <= 0 && strings.EqualFold(strings.TrimSpace(cfg.Driver), "clickhouse") {
		remotePort = 9000
	} else if remotePort <= 0 && (strings.EqualFold(strings.TrimSpace(cfg.Driver), "elasticsearch") || strings.EqualFold(strings.TrimSpace(cfg.Driver), "es")) {
		remotePort = 9200
	} else if remotePort <= 0 && (strings.EqualFold(strings.TrimSpace(cfg.Driver), "mongodb") || strings.EqualFold(strings.TrimSpace(cfg.Driver), "mongo")) {
		remotePort = 27017
	}
	return remoteHost, remotePort
}

type mongoConnectionOptions struct {
	AuthSource            string `json:"authSource"`
	AuthMechanism         string `json:"authMechanism"`
	ReplicaSet            string `json:"replicaSet"`
	DirectConnection      bool   `json:"directConnection"`
	ReadPreference        string `json:"readPreference"`
	LegacyAuthSource      string `json:"mongoAuthSource"`
	LegacyAuthMechanism   string `json:"mongoAuthMechanism"`
	LegacyReplicaSet      string `json:"mongoReplicaSet"`
	LegacyDirect          bool   `json:"mongoDirectConnection"`
	LegacyReadPreference  string `json:"mongoReadPreference"`
}

func buildMongoDriver(cfg store.ConnectionConfig, host string, port int) (driver.DatabaseDriver, error) {
	var mOpts mongoConnectionOptions
	if strings.TrimSpace(cfg.OptionsJSON) != "" {
		_ = json.Unmarshal([]byte(cfg.OptionsJSON), &mOpts)
		if mOpts.AuthSource == "" {
			mOpts.AuthSource = mOpts.LegacyAuthSource
		}
		if mOpts.AuthMechanism == "" {
			mOpts.AuthMechanism = mOpts.LegacyAuthMechanism
		}
		if mOpts.ReplicaSet == "" {
			mOpts.ReplicaSet = mOpts.LegacyReplicaSet
		}
		if !mOpts.DirectConnection {
			mOpts.DirectConnection = mOpts.LegacyDirect
		}
		if mOpts.ReadPreference == "" {
			mOpts.ReadPreference = mOpts.LegacyReadPreference
		}
	}

	rawConn := strings.TrimSpace(cfg.Host)
	origHostname := ""
	var finalURI string

	if strings.HasPrefix(rawConn, "mongodb://") || strings.HasPrefix(rawConn, "mongodb+srv://") {
		u, err := url.Parse(rawConn)
		if err != nil {
			return nil, fmt.Errorf("invalid MongoDB URI: %w", err)
		}
		origHostname = u.Hostname()
		if cfg.SSHEnabled {
			if strings.HasPrefix(rawConn, "mongodb+srv://") {
				return nil, fmt.Errorf("SSH tunnel cannot be used with mongodb+srv:// SRV URIs; use a direct mongodb:// host:port")
			}
			u.Host = net.JoinHostPort(host, strconv.Itoa(port))
			q := u.Query()
			q.Set("directConnection", "true")
			u.RawQuery = q.Encode()
		}
		if (u.User == nil) && (cfg.Username != "" || cfg.Password != "") {
			u.User = url.UserPassword(cfg.Username, cfg.Password)
		}
		q := u.Query()
		if mOpts.AuthSource != "" {
			q.Set("authSource", mOpts.AuthSource)
		}
		if mOpts.AuthMechanism != "" {
			q.Set("authMechanism", mOpts.AuthMechanism)
		}
		if mOpts.ReplicaSet != "" {
			q.Set("replicaSet", mOpts.ReplicaSet)
		}
		if mOpts.DirectConnection {
			q.Set("directConnection", "true")
		}
		u.RawQuery = q.Encode()
		finalURI = u.String()
	} else {
		if port <= 0 {
			port = 27017
		}
		if host == "" {
			host = "127.0.0.1"
		}
		origHostname = rawConn
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
			authSrc := mOpts.AuthSource
			if authSrc == "" {
				authSrc = "admin"
			}
			q.Set("authSource", authSrc)
		}
		if mOpts.AuthMechanism != "" {
			q.Set("authMechanism", mOpts.AuthMechanism)
		}
		if mOpts.ReplicaSet != "" {
			q.Set("replicaSet", mOpts.ReplicaSet)
		}
		if mOpts.DirectConnection || cfg.SSHEnabled {
			q.Set("directConnection", "true")
		}
		u.RawQuery = q.Encode()
		finalURI = u.String()
	}

	clientOpts := mongoopts.Client()
	if cfg.SSLMode != "" && cfg.SSLMode != "disable" {
		tlsCfg, tlsErr := buildHTTPDriverTLSConfig(cfg, "https://"+origHostname, origHostname)
		if tlsErr != nil {
			return nil, tlsErr
		}
		if tlsCfg != nil {
			clientOpts.SetTLSConfig(tlsCfg)
		}
	}

	switch strings.ToLower(strings.TrimSpace(mOpts.ReadPreference)) {
	case "primary":
		clientOpts.SetReadPreference(readpref.Primary())
	case "primarypreferred":
		clientOpts.SetReadPreference(readpref.PrimaryPreferred())
	case "secondary":
		clientOpts.SetReadPreference(readpref.Secondary())
	case "secondarypreferred":
		clientOpts.SetReadPreference(readpref.SecondaryPreferred())
	case "nearest":
		clientOpts.SetReadPreference(readpref.Nearest())
	}

	return mongodb.NewMongoDBDriverWithOptions(finalURI, clientOpts)
}

func decodeElasticCloudID(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	colonIdx := strings.IndexByte(trimmed, ':')
	if colonIdx <= 0 || strings.Contains(trimmed, "://") {
		return "", false
	}
	b64Part := trimmed[colonIdx+1:]
	decoded, err := base64.StdEncoding.DecodeString(b64Part)
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(b64Part)
		if err != nil {
			return "", false
		}
	}
	parts := strings.Split(string(decoded), "$")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return "", false
	}
	domain := parts[0]
	esUUID := parts[1]
	return fmt.Sprintf("https://%s.%s:443", esUUID, domain), true
}

func isHexSHA256Fingerprint(s string) (string, bool) {
	clean := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(s), ":", ""), " ", ""))
	if len(clean) != 64 {
		return "", false
	}
	for i := 0; i < len(clean); i++ {
		c := clean[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return "", false
		}
	}
	return clean, true
}

func resolveHTTPBaseURL(cfg store.ConnectionConfig, host string, port, defaultPort int) (baseURL, origHostname string) {
	rawHost := strings.TrimSpace(cfg.Host)
	if decodedURL, ok := decodeElasticCloudID(rawHost); ok {
		rawHost = decodedURL
	}
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
	var pinnedCAHex string
	if cfg.SSLCAPath != "" {
		if fpHex, isFP := isHexSHA256Fingerprint(cfg.SSLCAPath); isFP {
			pinnedCAHex = fpHex
		} else {
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
	}
	if cfg.SSLCertPath != "" && cfg.SSLKeyPath != "" {
		cert, err := tls.LoadX509KeyPair(cfg.SSLCertPath, cfg.SSLKeyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to load SSL client certificate/key: %w", err)
		}
		tlsCfg.Certificates = []tls.Certificate{cert}
	}
	if pinnedCAHex != "" {
		tlsCfg.InsecureSkipVerify = true
		tlsCfg.VerifyConnection = func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return fmt.Errorf("server presented no TLS certificates")
			}
			var matchedCA *x509.Certificate
			for _, cert := range cs.PeerCertificates {
				sum := sha256.Sum256(cert.Raw)
				if strings.EqualFold(hex.EncodeToString(sum[:]), pinnedCAHex) {
					matchedCA = cert
					break
				}
			}
			if matchedCA == nil {
				return fmt.Errorf("TLS certificate SHA-256 fingerprint mismatch (expected %s)", pinnedCAHex)
			}
			// Verify the leaf certificate chains to the pinned certificate (or is the pinned leaf itself).
			roots := x509.NewCertPool()
			roots.AddCert(matchedCA)
			inters := x509.NewCertPool()
			for _, cert := range cs.PeerCertificates[1:] {
				inters.AddCert(cert)
			}
			_, err := cs.PeerCertificates[0].Verify(x509.VerifyOptions{
				Roots:         roots,
				Intermediates: inters,
				CurrentTime:   time.Now(),
			})
			return err
		}
		return tlsCfg, nil
	}
	switch strings.ToLower(strings.TrimSpace(cfg.SSLMode)) {
	case "require", "required":
		tlsCfg.InsecureSkipVerify = true
	case "verify-ca":
		tlsCfg.InsecureSkipVerify = true
		roots := tlsCfg.RootCAs
		tlsCfg.VerifyConnection = func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return fmt.Errorf("server presented no TLS certificates")
			}
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

