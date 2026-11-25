package driver

import (
	"context"
	"database/sql"
	"sync"
)

type tabConnEntry struct {
	mu   sync.Mutex
	conn *sql.Conn
	db   string
	inTx bool
}

// TabSessionManager pins one *sql.Conn per console tabID so session-scoped state
// (temporary tables, SET/ALTER SESSION variables, and transactions) persists across runs.
type TabSessionManager struct {
	mu       sync.Mutex
	sessions map[string]*tabConnEntry
	poolFor  func(database string) (*sql.DB, error)
}

// NewTabSessionManager creates a TabSessionManager backed by the given pool resolver.
func NewTabSessionManager(poolFor func(database string) (*sql.DB, error)) *TabSessionManager {
	return &TabSessionManager{
		sessions: make(map[string]*tabConnEntry),
		poolFor:  poolFor,
	}
}

func (m *TabSessionManager) getOrCreateEntry(tabID string) *tabConnEntry {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sessions == nil {
		m.sessions = make(map[string]*tabConnEntry)
	}
	e, ok := m.sessions[tabID]
	if !ok {
		e = &tabConnEntry{}
		m.sessions[tabID] = e
	}
	return e
}

// Acquire returns a pinned *sql.Conn for tabID and database along with a release callback.
// sessionReset is true when a previous broken connection had to be replaced.
func (m *TabSessionManager) Acquire(ctx context.Context, tabID, database string) (conn *sql.Conn, release func(), sessionReset bool, err error) {
	e := m.getOrCreateEntry(tabID)
	e.mu.Lock()

	if e.conn != nil {
		if !e.inTx && database != "" && e.db != "" && e.db != database {
			_ = e.conn.Close()
			e.conn = nil
		} else if pErr := e.conn.PingContext(ctx); pErr != nil {
			_ = e.conn.Close()
			e.conn = nil
			sessionReset = true
		}
	}

	if e.conn == nil {
		pool, pErr := m.poolFor(database)
		if pErr != nil {
			e.mu.Unlock()
			return nil, nil, sessionReset, pErr
		}
		c, cErr := pool.Conn(ctx)
		if cErr != nil {
			e.mu.Unlock()
			return nil, nil, sessionReset, cErr
		}
		e.conn = c
		e.db = database
		e.inTx = false
	}

	return e.conn, func() { e.mu.Unlock() }, sessionReset, nil
}

// BeginTxForTab opens a transaction on the tab's pinned session.
func (m *TabSessionManager) BeginTxForTab(ctx context.Context, tabID, database string) (*sql.Tx, error) {
	conn, release, _, err := m.Acquire(ctx, tabID, database)
	if err != nil {
		return nil, err
	}
	defer release()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	e := m.getOrCreateEntry(tabID)
	e.inTx = true
	return tx, nil
}

// TxEnded marks the tab's active transaction as finished.
func (m *TabSessionManager) TxEnded(tabID string) {
	m.mu.Lock()
	e, ok := m.sessions[tabID]
	m.mu.Unlock()
	if !ok {
		return
	}
	e.mu.Lock()
	e.inTx = false
	e.mu.Unlock()
}

// CloseSession closes and removes any pinned connection for tabID.
func (m *TabSessionManager) CloseSession(tabID string) {
	m.mu.Lock()
	e, ok := m.sessions[tabID]
	if ok {
		delete(m.sessions, tabID)
	}
	m.mu.Unlock()
	if !ok {
		return
	}
	e.mu.Lock()
	if e.conn != nil {
		_ = e.conn.Close()
		e.conn = nil
	}
	e.inTx = false
	e.mu.Unlock()
}

// CloseAll closes all pinned tab connections.
func (m *TabSessionManager) CloseAll() {
	m.mu.Lock()
	entries := make([]*tabConnEntry, 0, len(m.sessions))
	for k, e := range m.sessions {
		entries = append(entries, e)
		delete(m.sessions, k)
	}
	m.mu.Unlock()
	for _, e := range entries {
		e.mu.Lock()
		if e.conn != nil {
			_ = e.conn.Close()
			e.conn = nil
		}
		e.inTx = false
		e.mu.Unlock()
	}
}
