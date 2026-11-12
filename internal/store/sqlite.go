package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"dhub/internal/config"
	_ "modernc.org/sqlite"
)

const (
	maxHistoryPerConnection = 500
	maxHistorySQLBytes      = 64 * 1024
)

type LocalStore struct {
	db *sql.DB
}

func NewLocalStore() (*LocalStore, error) {
	dbPath, err := config.GetDBPath()
	if err != nil {
		return nil, err
	}
	return NewLocalStoreWithPath(dbPath)
}

func NewLocalStoreWithPath(dbPath string) (*LocalStore, error) {
	dsn := dbPath
	if dbPath != ":memory:" {
		if !strings.Contains(dbPath, "?") {
			dsn = dbPath + "?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)"
		} else if !strings.Contains(dbPath, "busy_timeout") {
			dsn = dbPath + "&_pragma=busy_timeout(10000)"
		}
	}

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite store: %w", err)
	}

	// In SQLite embedded storage, serializing database access through 1 open connection
	// with a 10s busy_timeout and WAL mode completely eliminates OS-level write lock contention (SQLITE_BUSY).
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	s := &LocalStore{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	return s, nil
}

func (s *LocalStore) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

func (s *LocalStore) DB() *sql.DB {
	return s.db
}

func (s *LocalStore) migrate() error {
	queries := []string{
		`PRAGMA journal_mode=WAL;`,
		`PRAGMA synchronous=NORMAL;`,
		`PRAGMA foreign_keys=ON;`,
		`PRAGMA busy_timeout=10000;`, // wait up to 10s if table is locked
		`PRAGMA cache_size=-4000;`, // cap page cache at ~4MB
		`PRAGMA temp_store=FILE;`,

		`CREATE TABLE IF NOT EXISTS connection_folders (
			id          TEXT PRIMARY KEY,
			name        TEXT NOT NULL,
			color       TEXT NOT NULL DEFAULT '#3b82f6',
			parent_id   TEXT REFERENCES connection_folders(id) ON DELETE CASCADE,
			sort_order  INTEGER NOT NULL DEFAULT 0,
			created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE TABLE IF NOT EXISTS app_settings (
			key         TEXT PRIMARY KEY,
			value       TEXT NOT NULL,
			updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE TABLE IF NOT EXISTS connections (
			id              TEXT PRIMARY KEY,
			folder_id       TEXT REFERENCES connection_folders(id) ON DELETE SET NULL,
			name            TEXT NOT NULL,
			driver          TEXT NOT NULL,
			env_type        TEXT NOT NULL DEFAULT 'local',
			color_tag       TEXT NOT NULL DEFAULT '#3b82f6',
			is_read_only     INTEGER NOT NULL DEFAULT 0,
			tx_mode         TEXT NOT NULL DEFAULT 'auto',
			host            TEXT NOT NULL DEFAULT 'localhost',
			port            INTEGER NOT NULL DEFAULT 5432,
			username        TEXT NOT NULL DEFAULT '',
			database_name   TEXT NOT NULL DEFAULT '',
			file_path       TEXT NOT NULL DEFAULT '',
			ssl_mode        TEXT NOT NULL DEFAULT 'disable',
			ssl_ca_path     TEXT NOT NULL DEFAULT '',
			ssl_cert_path   TEXT NOT NULL DEFAULT '',
			ssl_key_path    TEXT NOT NULL DEFAULT '',
			ssh_enabled     INTEGER NOT NULL DEFAULT 0,
			ssh_host        TEXT NOT NULL DEFAULT '',
			ssh_port        INTEGER NOT NULL DEFAULT 22,
			ssh_user        TEXT NOT NULL DEFAULT '',
			ssh_auth_type   TEXT NOT NULL DEFAULT 'key',
			ssh_key_path    TEXT NOT NULL DEFAULT '',
			options_json    TEXT NOT NULL DEFAULT '{}',
			sort_order      INTEGER NOT NULL DEFAULT 0,
			created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE TABLE IF NOT EXISTS worksheets (
			id              TEXT PRIMARY KEY,
			connection_id   TEXT REFERENCES connections(id) ON DELETE CASCADE,
			title           TEXT NOT NULL,
			content         TEXT NOT NULL DEFAULT '',
			target_database TEXT NOT NULL DEFAULT '',
			target_schema   TEXT NOT NULL DEFAULT '',
			is_pinned       INTEGER NOT NULL DEFAULT 0,
			cursor_line     INTEGER NOT NULL DEFAULT 1,
			cursor_col      INTEGER NOT NULL DEFAULT 1,
			sort_order      INTEGER NOT NULL DEFAULT 0,
			updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE TABLE IF NOT EXISTS query_history (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			connection_id   TEXT NOT NULL,
			database_name   TEXT NOT NULL DEFAULT '',
			schema_name     TEXT NOT NULL DEFAULT '',
			sql_text        TEXT NOT NULL,
			duration_ms     INTEGER NOT NULL DEFAULT 0,
			rows_affected   INTEGER NOT NULL DEFAULT 0,
			status          TEXT NOT NULL,
			error_message   TEXT NOT NULL DEFAULT '',
			executed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE INDEX IF NOT EXISTS idx_query_history_conn_time ON query_history(connection_id, executed_at DESC);`,

		`CREATE TABLE IF NOT EXISTS schema_cache (
			connection_id     TEXT NOT NULL,
			database_name     TEXT NOT NULL,
			schema_name       TEXT NOT NULL,
			object_type       TEXT NOT NULL,
			object_name       TEXT NOT NULL,
			columns_json      TEXT NOT NULL DEFAULT '[]',
			indexes_json      TEXT NOT NULL DEFAULT '[]',
			foreign_keys_json TEXT NOT NULL DEFAULT '[]',
			row_estimate      INTEGER NOT NULL DEFAULT 0,
			synced_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (connection_id, database_name, schema_name, object_type, object_name)
		);`,

		`CREATE TABLE IF NOT EXISTS workspaces (
			id              TEXT PRIMARY KEY,
			name            TEXT NOT NULL,
			description     TEXT NOT NULL DEFAULT '',
			icon            TEXT NOT NULL DEFAULT 'briefcase',
			color_tag       TEXT NOT NULL DEFAULT '#3b82f6',
			is_active       INTEGER NOT NULL DEFAULT 0,
			tabs_json       TEXT NOT NULL DEFAULT '[]',
			active_tab_id   TEXT NOT NULL DEFAULT '',
			created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE INDEX IF NOT EXISTS idx_workspaces_active ON workspaces(is_active);`,
	}

	for _, q := range queries {
		if _, err := s.db.Exec(q); err != nil {
			return fmt.Errorf("migration query failed: %w (SQL: %s)", err, q)
		}
	}

	// Ensure color column exists on older connection_folders tables
	_, _ = s.db.Exec(`ALTER TABLE connection_folders ADD COLUMN color TEXT NOT NULL DEFAULT '#3b82f6';`)
	// Ensure env_type column exists on older connections tables
	_, _ = s.db.Exec(`ALTER TABLE connections ADD COLUMN env_type TEXT NOT NULL DEFAULT 'local';`)

	// Clean up duplicate schema_cache rows where empty or artificial schemas were stored
	_, _ = s.db.Exec(`DELETE FROM schema_cache
		WHERE rowid NOT IN (
			SELECT rowid FROM (
				SELECT rowid,
					ROW_NUMBER() OVER (
						PARTITION BY connection_id, database_name,
							CASE
								WHEN schema_name = '' OR schema_name = 'main' OR schema_name = database_name THEN ''
								ELSE schema_name
							END,
							object_type, object_name
						ORDER BY (schema_name != '' AND schema_name != 'main') DESC,
							(columns_json != '[]' AND columns_json != 'null' AND columns_json != '') DESC,
							rowid DESC
					) as rn
				FROM schema_cache
			) WHERE rn = 1
		);`)

	return nil
}

func (s *LocalStore) GetSettings() (map[string]string, error) {
	rows, err := s.db.Query(`SELECT key, value FROM app_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	res := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			continue
		}
		res[k] = v
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return res, nil
}

func (s *LocalStore) SaveSetting(key, value string) error {
	query := `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
	_, err := s.db.Exec(query, key, value)
	return err
}

type QueryHistoryEntry struct {
	ID           int64     `json:"id"`
	ConnectionID string    `json:"connectionId"`
	DatabaseName string    `json:"databaseName"`
	SchemaName   string    `json:"schemaName"`
	SQLText      string    `json:"sqlText"`
	DurationMs   int64     `json:"durationMs"`
	RowsAffected int64     `json:"rowsAffected"`
	Status       string    `json:"status"`
	ErrorMessage string    `json:"errorMessage"`
	ExecutedAt   time.Time `json:"executedAt"`
}

func (s *LocalStore) RecordQueryHistory(entry QueryHistoryEntry) error {
	query := `INSERT INTO query_history (connection_id, database_name, schema_name, sql_text, duration_ms, rows_affected, status, error_message, executed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
	sqlText := entry.SQLText
	if len(sqlText) > maxHistorySQLBytes {
		sqlText = sqlText[:maxHistorySQLBytes]
	}
	if _, err := s.db.Exec(query, entry.ConnectionID, entry.DatabaseName, entry.SchemaName, sqlText, entry.DurationMs, entry.RowsAffected, entry.Status, entry.ErrorMessage); err != nil {
		return err
	}

	// Keep only the most recent entries per connection to bound DB size and memory.
	_, err := s.db.Exec(`DELETE FROM query_history WHERE connection_id = ? AND id NOT IN (
		SELECT id FROM query_history WHERE connection_id = ? ORDER BY id DESC LIMIT ?)`,
		entry.ConnectionID, entry.ConnectionID, maxHistoryPerConnection)
	return err
}

func (s *LocalStore) GetRecentHistory(connectionID string, limit int) ([]QueryHistoryEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `SELECT id, connection_id, database_name, schema_name, sql_text, duration_ms, rows_affected, status, error_message, executed_at
		FROM query_history WHERE connection_id = ? ORDER BY executed_at DESC LIMIT ?`
	rows, err := s.db.Query(query, connectionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []QueryHistoryEntry
	for rows.Next() {
		var e QueryHistoryEntry
		if err := rows.Scan(&e.ID, &e.ConnectionID, &e.DatabaseName, &e.SchemaName, &e.SQLText, &e.DurationMs, &e.RowsAffected, &e.Status, &e.ErrorMessage, &e.ExecutedAt); err != nil {
			continue
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return entries, nil
}

