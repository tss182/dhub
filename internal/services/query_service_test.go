package services

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"dhub/internal/driver"
	"dhub/internal/manager"
	"dhub/internal/store"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func setupTestStore(t *testing.T) (*store.LocalStore, func()) {
	t.Helper()
	tmpDir, err := os.MkdirTemp("", "dhub-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	t.Setenv("DHUB_CONFIG_DIR", tmpDir)

	s, err := store.NewLocalStore()
	if err != nil {
		os.RemoveAll(tmpDir)
		t.Fatalf("failed to create store: %v", err)
	}

	cleanup := func() {
		s.Close()
		os.RemoveAll(tmpDir)
	}
	return s, cleanup
}

func TestQueryService_ReadOnlyEnforcement(t *testing.T) {
	st, cleanup := setupTestStore(t)
	defer cleanup()

	tmpDir := t.TempDir()
	sqliteFile := filepath.Join(tmpDir, "readonly_test.db")

	// Save read-only connection
	roConn := store.ConnectionConfig{
		ID:         "conn-readonly-1",
		Name:       "Production ReadOnly DB",
		Driver:     "sqlite",
		FilePath:   sqliteFile,
		IsReadOnly: true,
	}
	if _, err := st.SaveConnection(context.Background(), roConn); err != nil {
		t.Fatalf("failed to save connection: %v", err)
	}

	// Also create normal connection
	rwConn := store.ConnectionConfig{
		ID:         "conn-readwrite-1",
		Name:       "Dev ReadWrite DB",
		Driver:     "sqlite",
		FilePath:   sqliteFile,
		IsReadOnly: false,
	}
	if _, err := st.SaveConnection(context.Background(), rwConn); err != nil {
		t.Fatalf("failed to save connection: %v", err)
	}

	sm := manager.NewSessionManager(st)
	defer sm.CloseAll()

	qs := NewQueryService(st, sm, func() *application.App { return nil })

	// First create table using RW connection
	_, err := qs.ExecuteQuery(driver.QueryRequest{
		ExecutionID:  "exec-setup",
		ConnectionID: rwConn.ID,
		SQL:          "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items (name) VALUES ('apple');",
	})
	if err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	// 1. Read-only should allow SELECT
	selRes, err := qs.ExecuteQuery(driver.QueryRequest{
		ExecutionID:  "exec-ro-select",
		ConnectionID: roConn.ID,
		SQL:          "SELECT * FROM items;",
	})
	if err != nil {
		t.Fatalf("expected SELECT to succeed on read-only connection, got: %v", err)
	}
	if selRes == nil || len(selRes.Rows) != 1 {
		t.Fatalf("expected 1 row, got %+v", selRes)
	}

	// 2. Read-only should allow PRAGMA / EXPLAIN
	_, err = qs.ExecuteQuery(driver.QueryRequest{
		ExecutionID:  "exec-ro-pragma",
		ConnectionID: roConn.ID,
		SQL:          "PRAGMA table_info(items);",
	})
	if err != nil {
		t.Fatalf("expected PRAGMA to succeed on read-only connection, got: %v", err)
	}

	// 3. Read-only should BLOCK INSERT
	_, err = qs.ExecuteQuery(driver.QueryRequest{
		ExecutionID:  "exec-ro-insert",
		ConnectionID: roConn.ID,
		SQL:          "INSERT INTO items (name) VALUES ('banana');",
	})
	if err == nil {
		t.Fatal("expected INSERT to be blocked on read-only connection, but it succeeded")
	}

	// 4. Read-only should BLOCK DROP TABLE
	_, err = qs.ExecuteQuery(driver.QueryRequest{
		ExecutionID:  "exec-ro-drop",
		ConnectionID: roConn.ID,
		SQL:          "DROP TABLE items;",
	})
	if err == nil {
		t.Fatal("expected DROP TABLE to be blocked on read-only connection, but it succeeded")
	}

	// 5. Read-only should BLOCK SubmitChanges
	_, err = qs.SubmitChanges(roConn.ID, "", "", "items", []driver.RowChange{
		{
			Type:    "insert",
			Changes: map[string]any{"name": "pear"},
		},
	})
	if err == nil {
		t.Fatal("expected SubmitChanges to be blocked on read-only connection, but it succeeded")
	}
}

func TestQueryService_ManualTransactions(t *testing.T) {
	st, cleanup := setupTestStore(t)
	defer cleanup()

	tmpDir := t.TempDir()
	sqliteFile := filepath.Join(tmpDir, "tx_test.db")

	conn := store.ConnectionConfig{
		ID:       "conn-tx-1",
		Name:     "Tx Test DB",
		Driver:   "sqlite",
		FilePath: sqliteFile,
	}
	if _, err := st.SaveConnection(context.Background(), conn); err != nil {
		t.Fatalf("failed to save connection: %v", err)
	}

	sm := manager.NewSessionManager(st)
	defer sm.CloseAll()

	qs := NewQueryService(st, sm, func() *application.App { return nil })

	// Initial setup: table with 1 row
	_, err := qs.ExecuteQuery(driver.QueryRequest{
		ExecutionID:  "exec-tx-init",
		ConnectionID: conn.ID,
		SQL:          "CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INT); INSERT INTO accounts (id, balance) VALUES (1, 100);",
	})
	if err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	tabID := "tab-workspace-1"

	// 1. Begin transaction on tab
	txStatus, err := qs.BeginTransaction(tabID, conn.ID, "")
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}
	if !txStatus.IsOpen {
		t.Fatal("expected txStatus.IsOpen to be true")
	}

	// Verify GetTransactionStatus
	statusCheck := qs.GetTransactionStatus(tabID)
	if !statusCheck.IsOpen {
		t.Fatal("expected statusCheck.IsOpen to be true")
	}

	// 2. Execute UPDATE inside transaction
	_, err = qs.ExecuteQuery(driver.QueryRequest{
		ExecutionID:  "exec-tx-update",
		ConnectionID: conn.ID,
		TabID:        tabID,
		SQL:          "UPDATE accounts SET balance = 500 WHERE id = 1;",
	})
	if err != nil {
		t.Fatalf("failed to execute update inside tx: %v", err)
	}

	// 3. Rollback transaction
	if err := qs.RollbackTransaction(tabID); err != nil {
		t.Fatalf("rollback failed: %v", err)
	}

	// Verify balance was NOT changed (rolled back to 100)
	selRes, err := qs.ExecuteQuery(driver.QueryRequest{
		ExecutionID:  "exec-verify-rollback",
		ConnectionID: conn.ID,
		SQL:          "SELECT balance FROM accounts WHERE id = 1;",
	})
	if err != nil {
		t.Fatalf("select failed: %v", err)
	}
	if len(selRes.Rows) == 0 || selRes.Rows[0][0] != int64(100) {
		t.Fatalf("expected balance 100 after rollback, got %v", selRes.Rows[0][0])
	}

	// 4. Begin new transaction, execute update, and COMMIT
	_, err = qs.BeginTransaction(tabID, conn.ID, "")
	if err != nil {
		t.Fatalf("failed to begin second transaction: %v", err)
	}

	_, err = qs.ExecuteQuery(driver.QueryRequest{
		ExecutionID:  "exec-tx-update-2",
		ConnectionID: conn.ID,
		TabID:        tabID,
		SQL:          "UPDATE accounts SET balance = 999 WHERE id = 1;",
	})
	if err != nil {
		t.Fatalf("failed update in second tx: %v", err)
	}

	if err := qs.CommitTransaction(tabID); err != nil {
		t.Fatalf("commit failed: %v", err)
	}

	// Verify balance was committed to 999
	selRes2, err := qs.ExecuteQuery(driver.QueryRequest{
		ExecutionID:  "exec-verify-commit",
		ConnectionID: conn.ID,
		SQL:          "SELECT balance FROM accounts WHERE id = 1;",
	})
	if err != nil {
		t.Fatalf("select failed: %v", err)
	}
	if len(selRes2.Rows) == 0 || selRes2.Rows[0][0] != int64(999) {
		t.Fatalf("expected balance 999 after commit, got %v", selRes2.Rows[0][0])
	}
}

