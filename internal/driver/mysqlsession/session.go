// Package mysqlsession manages separated metadata/query pools, per-tab pinned
// connections, and server-side KILL QUERY cancellation for MySQL and MariaDB.
package mysqlsession

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"

	"dhub/internal/driver"
	"dhub/internal/driver/mysqlconn"
	"dhub/internal/driver/mysqlmeta"
)

const (
	defaultMaxSessions = 16
	defaultIdleTimeout = 10 * time.Minute
	defaultMetaConns   = 8
)

type tabSession struct {
	mu        sync.Mutex
	conn      *sql.Conn
	connID    int64
	currentDB string
	lastUsed  time.Time
	inTx      bool
}

// Manager separates metadata/grid operations from per-tab console sessions.
type Manager struct {
	metaPool    *sql.DB
	sessionPool *sql.DB
	defaultDB   string
	dialect     string
	maxSessions int
	idleTimeout time.Duration

	mu       sync.Mutex
	sessions map[string]*tabSession

	execMu sync.Mutex
	execs  map[string]int64

	infoMu     sync.Mutex
	serverInfo *driver.ServerInfo
}

// New opens separated metadata and session pools for a MySQL or MariaDB driver.
func New(dsn, defaultDB, dialect string, readOnly bool) (*Manager, error) {
	metaPool, err := mysqlconn.Open(dsn, readOnly)
	if err != nil {
		return nil, err
	}
	metaPool.SetMaxOpenConns(defaultMetaConns)
	metaPool.SetMaxIdleConns(2)
	metaPool.SetConnMaxIdleTime(2 * time.Minute)
	metaPool.SetConnMaxLifetime(30 * time.Minute)

	sessionPool, err := mysqlconn.Open(dsn, readOnly)
	if err != nil {
		_ = metaPool.Close()
		return nil, err
	}
	sessionPool.SetMaxOpenConns(defaultMaxSessions + 4)
	sessionPool.SetMaxIdleConns(2)
	sessionPool.SetConnMaxIdleTime(defaultIdleTimeout)
	sessionPool.SetConnMaxLifetime(30 * time.Minute)

	return &Manager{
		metaPool:    metaPool,
		sessionPool: sessionPool,
		defaultDB:   defaultDB,
		dialect:     dialect,
		maxSessions: defaultMaxSessions,
		idleTimeout: defaultIdleTimeout,
		sessions:    make(map[string]*tabSession),
		execs:       make(map[string]int64),
	}, nil
}

// MetaDB returns the pool used for introspection, grid loading, ApplyChanges, and KILL QUERY.
func (m *Manager) MetaDB() *sql.DB {
	return m.metaPool
}

// Ping verifies connectivity using the metadata pool.
func (m *Manager) Ping(ctx context.Context) error {
	return m.metaPool.PingContext(ctx)
}

// ServerInfo returns cached server version, flavor, and capability metadata.
func (m *Manager) ServerInfo(ctx context.Context) (*driver.ServerInfo, error) {
	m.infoMu.Lock()
	defer m.infoMu.Unlock()
	if m.serverInfo != nil {
		return m.serverInfo, nil
	}
	meta, err := mysqlmeta.DetectServerInfo(ctx, m.metaPool)
	if err != nil {
		return nil, err
	}
	info := &driver.ServerInfo{
		Flavor:                    meta.Flavor,
		Version:                   meta.Version,
		Major:                     meta.Major,
		Minor:                     meta.Minor,
		Patch:                     meta.Patch,
		VersionComment:            meta.VersionComment,
		SQLMode:                   meta.SQLMode,
		TimeZone:                  meta.TimeZone,
		SystemTimeZone:            meta.SystemTimeZone,
		CharacterSetServer:        meta.CharacterSetServer,
		CollationServer:           meta.CollationServer,
		LowerCaseTableNames:       meta.LowerCaseTableNames,
		ExplicitDefaultsTimestamp: meta.ExplicitDefaultsTimestamp,
		PerformanceSchema:         meta.PerformanceSchema,
		SupportsExplainTree:       meta.SupportsExplainTree,
		SupportsExplainAnalyze:    meta.SupportsExplainAnalyze,
		SupportsCheckConstraints:  meta.SupportsCheckConstraints,
		SupportsFunctionalIndexes: meta.SupportsFunctionalIndexes,
		SupportsInvisibleColumns:  meta.SupportsInvisibleColumns,
		SupportsRoles:             meta.SupportsRoles,
		SupportsSequences:         meta.SupportsSequences,
		SupportsReturning:         meta.SupportsReturning,
		SupportsIgnoredIndexes:    meta.SupportsIgnoredIndexes,
	}
	m.serverInfo = info
	return info, nil
}

// StreamQuery streams rows from the metadata pool without OFFSET paging (P2).
func (m *Manager) StreamQuery(ctx context.Context, req driver.QueryRequest, targetDB string, onRow func(cols []driver.ColumnMeta, row []any) error) error {
	conn, err := m.metaPool.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	if targetDB != "" {
		if _, err := conn.ExecContext(ctx, fmt.Sprintf("USE %s", quoteIdent(targetDB))); err != nil {
			return fmt.Errorf("error switching to database '%s': %w", targetDB, err)
		}
		if m.defaultDB != "" && targetDB != m.defaultDB {
			defer func() {
				_, _ = conn.ExecContext(context.Background(), fmt.Sprintf("USE %s", quoteIdent(m.defaultDB)))
			}()
		}
	}
	return driver.StreamQueryWithDialect(ctx, conn, req, m.dialect, onRow)
}

// Close closes all pinned tab sessions and both underlying pools.
func (m *Manager) Close() error {
	m.mu.Lock()
	for tabID, sess := range m.sessions {
		if sess != nil && sess.conn != nil {
			_ = sess.conn.Close()
		}
		delete(m.sessions, tabID)
	}
	m.mu.Unlock()

	var firstErr error
	if m.sessionPool != nil {
		if err := m.sessionPool.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if m.metaPool != nil {
		if err := m.metaPool.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// CloseSession closes and removes the pinned connection for tabID, if any.
func (m *Manager) CloseSession(tabID string) {
	if tabID == "" {
		return
	}
	m.mu.Lock()
	sess, ok := m.sessions[tabID]
	if ok {
		delete(m.sessions, tabID)
	}
	m.mu.Unlock()

	if ok && sess != nil && sess.conn != nil {
		_ = sess.conn.Close()
	}
}

// ActiveSessionCount returns the number of currently pinned tab sessions (for tests/diagnostics).
func (m *Manager) ActiveSessionCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions)
}

func quoteIdent(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
}

func queryConnID(ctx context.Context, conn *sql.Conn) int64 {
	var id int64
	if err := conn.QueryRowContext(ctx, "SELECT CONNECTION_ID()").Scan(&id); err != nil {
		return 0
	}
	return id
}

func (m *Manager) getOrCreateSession(ctx context.Context, tabID string) (*tabSession, bool, error) {
	now := time.Now()
	var toClose []*sql.Conn

	m.mu.Lock()
	// Evict expired idle sessions that are not in an open transaction.
	for id, s := range m.sessions {
		if id != tabID && !s.inTx && now.Sub(s.lastUsed) > m.idleTimeout {
			toClose = append(toClose, s.conn)
			delete(m.sessions, id)
		}
	}
	existing := m.sessions[tabID]
	if existing == nil && len(m.sessions) >= m.maxSessions {
		var oldestID string
		var oldestTime time.Time
		for id, s := range m.sessions {
			if s.inTx {
				continue
			}
			if oldestID == "" || s.lastUsed.Before(oldestTime) {
				oldestID = id
				oldestTime = s.lastUsed
			}
		}
		if oldestID != "" {
			toClose = append(toClose, m.sessions[oldestID].conn)
			delete(m.sessions, oldestID)
		}
	}
	m.mu.Unlock()

	for _, c := range toClose {
		if c != nil {
			_ = c.Close()
		}
	}

	if existing != nil {
		if err := existing.conn.PingContext(ctx); err == nil {
			return existing, false, nil
		}
		// Pinned connection died (e.g. wait_timeout or killed). Replace it and signal reset.
		_ = existing.conn.Close()
		conn, err := m.sessionPool.Conn(ctx)
		if err != nil {
			m.CloseSession(tabID)
			return nil, true, err
		}
		existing.mu.Lock()
		existing.conn = conn
		existing.connID = queryConnID(ctx, conn)
		existing.currentDB = m.defaultDB
		existing.lastUsed = now
		existing.inTx = false
		existing.mu.Unlock()
		return existing, true, nil
	}

	conn, err := m.sessionPool.Conn(ctx)
	if err != nil {
		return nil, false, err
	}
	sess := &tabSession{
		conn:      conn,
		connID:    queryConnID(ctx, conn),
		currentDB: m.defaultDB,
		lastUsed:  now,
	}
	m.mu.Lock()
	// Another goroutine may have raced for the same tabID.
	if race, ok := m.sessions[tabID]; ok {
		m.mu.Unlock()
		_ = conn.Close()
		return race, false, nil
	}
	m.sessions[tabID] = sess
	m.mu.Unlock()
	return sess, false, nil
}

// Execute runs req on a pinned session when req.TabID is set, or on an isolated metadata pool
// connection otherwise.
func (m *Manager) Execute(ctx context.Context, req driver.QueryRequest, targetDB string) (*driver.QueryResult, error) {
	if req.TabID == "" {
		return m.executePooled(ctx, req, targetDB)
	}

	sess, reset, err := m.getOrCreateSession(ctx, req.TabID)
	if err != nil {
		return nil, err
	}

	sess.mu.Lock()
	defer sess.mu.Unlock()
	sess.lastUsed = time.Now()

	if req.ExecutionID != "" && sess.connID > 0 {
		m.trackConnID(req.ExecutionID, sess.connID)
		defer m.untrackExec(req.ExecutionID)
	}

	if targetDB != "" && targetDB != sess.currentDB {
		if _, err := sess.conn.ExecContext(ctx, fmt.Sprintf("USE %s", quoteIdent(targetDB))); err != nil {
			if driver.IsConnectionLost(err) {
				m.dropSessionLocked(req.TabID, sess)
			}
			return nil, fmt.Errorf("error switching to database '%s': %w", targetDB, err)
		}
		sess.currentDB = targetDB
	}

	res, execErr := driver.ExecuteStatementsWithDialect(ctx, sess.conn, req, m.dialect)
	if execErr != nil {
		if driver.IsConnectionLost(execErr) {
			m.dropSessionLocked(req.TabID, sess)
		}
		return nil, execErr
	}

	if res != nil {
		if reset {
			res.SessionReset = true
		}
		for _, r := range res.Results {
			if r.Error == "" && driver.ClassifyMySQLStatement(r.SQL) == driver.StmtUse {
				if db := extractUseDatabase(r.SQL); db != "" {
					sess.currentDB = db
					res.ActiveDatabase = db
				}
			}
		}
	}
	return res, nil
}

func (m *Manager) executePooled(ctx context.Context, req driver.QueryRequest, targetDB string) (*driver.QueryResult, error) {
	conn, err := m.metaPool.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	if req.ExecutionID != "" {
		if connID := queryConnID(ctx, conn); connID > 0 {
			m.trackConnID(req.ExecutionID, connID)
			defer m.untrackExec(req.ExecutionID)
		}
	}

	if targetDB != "" {
		if _, err := conn.ExecContext(ctx, fmt.Sprintf("USE %s", quoteIdent(targetDB))); err != nil {
			return nil, fmt.Errorf("error switching to database '%s': %w", targetDB, err)
		}
		if m.defaultDB != "" && targetDB != m.defaultDB {
			defer func() {
				_, _ = conn.ExecContext(context.Background(), fmt.Sprintf("USE %s", quoteIdent(m.defaultDB)))
			}()
		}
	}

	return driver.ExecuteStatementsWithDialect(ctx, conn, req, m.dialect)
}

func (m *Manager) dropSessionLocked(tabID string, sess *tabSession) {
	m.mu.Lock()
	if cur, ok := m.sessions[tabID]; ok && cur == sess {
		delete(m.sessions, tabID)
	}
	m.mu.Unlock()
	if sess.conn != nil {
		_ = sess.conn.Close()
	}
}

// BeginTxForTab starts a manual transaction on the tab's pinned connection.
func (m *Manager) BeginTxForTab(ctx context.Context, tabID, targetDB string) (*sql.Tx, error) {
	sess, _, err := m.getOrCreateSession(ctx, tabID)
	if err != nil {
		return nil, err
	}

	sess.mu.Lock()
	defer sess.mu.Unlock()
	sess.lastUsed = time.Now()

	if targetDB != "" && targetDB != sess.currentDB {
		if _, err := sess.conn.ExecContext(ctx, fmt.Sprintf("USE %s", quoteIdent(targetDB))); err != nil {
			if driver.IsConnectionLost(err) {
				m.dropSessionLocked(tabID, sess)
			}
			return nil, fmt.Errorf("error switching to database '%s': %w", targetDB, err)
		}
		sess.currentDB = targetDB
	}

	tx, err := sess.conn.BeginTx(ctx, nil)
	if err != nil {
		if driver.IsConnectionLost(err) {
			m.dropSessionLocked(tabID, sess)
		}
		return nil, err
	}
	sess.inTx = true
	return tx, nil
}

// TxEnded marks the tab's manual transaction as finished while keeping the pinned connection alive.
func (m *Manager) TxEnded(tabID string) {
	if tabID == "" {
		return
	}
	m.mu.Lock()
	sess := m.sessions[tabID]
	m.mu.Unlock()
	if sess == nil {
		return
	}
	sess.mu.Lock()
	sess.inTx = false
	sess.lastUsed = time.Now()
	sess.mu.Unlock()
}

// TrackExecution associates executionID with tabID's server connection ID for KILL QUERY.
func (m *Manager) TrackExecution(executionID, tabID string) func() {
	if executionID == "" || tabID == "" {
		return func() {}
	}
	m.mu.Lock()
	sess := m.sessions[tabID]
	m.mu.Unlock()
	if sess == nil || sess.connID <= 0 {
		return func() {}
	}
	m.trackConnID(executionID, sess.connID)
	return func() { m.untrackExec(executionID) }
}

func (m *Manager) trackConnID(executionID string, connID int64) {
	m.execMu.Lock()
	m.execs[executionID] = connID
	m.execMu.Unlock()
}

func (m *Manager) untrackExec(executionID string) {
	m.execMu.Lock()
	delete(m.execs, executionID)
	m.execMu.Unlock()
}

// CancelExecution runs KILL QUERY <connection_id> on the metadata pool so the server stops the
// running statement without closing the tab's pinned connection.
func (m *Manager) CancelExecution(executionID string) (bool, error) {
	m.execMu.Lock()
	connID, ok := m.execs[executionID]
	m.execMu.Unlock()
	if !ok || connID <= 0 {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := m.metaPool.ExecContext(ctx, fmt.Sprintf("KILL QUERY %d", connID))
	return true, err
}

func extractUseDatabase(stmt string) string {
	clean := strings.TrimSpace(driver.StripLeadingComments(stmt))
	clean = strings.TrimRight(clean, "; \t\r\n")
	if len(clean) < 4 || !strings.EqualFold(clean[:3], "USE") {
		return ""
	}
	rest := strings.TrimSpace(clean[3:])
	if rest == "" {
		return ""
	}
	if strings.HasPrefix(rest, "`") && strings.HasSuffix(rest, "`") && len(rest) >= 2 {
		return strings.ReplaceAll(rest[1:len(rest)-1], "``", "`")
	}
	if strings.HasPrefix(rest, `"`) && strings.HasSuffix(rest, `"`) && len(rest) >= 2 {
		return strings.ReplaceAll(rest[1:len(rest)-1], `""`, `"`)
	}
	fields := strings.Fields(rest)
	if len(fields) > 0 {
		return fields[0]
	}
	return ""
}
