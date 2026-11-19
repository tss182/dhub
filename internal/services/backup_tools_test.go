package services

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"dhub/internal/driver"
	"dhub/internal/manager"
	"dhub/internal/store"
	_ "modernc.org/sqlite"
)

func TestSplitSQLStatementsForRestore_Dialects(t *testing.T) {
	t.Run("MySQL DELIMITER and quotes", func(t *testing.T) {
		script := `
-- header comment
CREATE TABLE t (id INT);
INSERT INTO t VALUES (1); /* block comment */
DELIMITER ;;
CREATE TRIGGER trg_t AFTER INSERT ON t FOR EACH ROW
BEGIN
  INSERT INTO log VALUES ('a;b');
END;;
DELIMITER ;
SELECT * FROM t;
`
		stmts := splitSQLStatementsForRestore(script, "mysql")
		if len(stmts) != 4 {
			t.Fatalf("expected 4 statements, got %d: %#v", len(stmts), stmts)
		}
		if !strings.Contains(stmts[2], "CREATE TRIGGER trg_t") || !strings.Contains(stmts[2], "'a;b'") {
			t.Errorf("unexpected trigger statement: %s", stmts[2])
		}
	})

	t.Run("PostgreSQL dollar quoting", func(t *testing.T) {
		script := `
CREATE FUNCTION f() RETURNS void AS $body$
BEGIN
  RAISE NOTICE 'hello; world';
END;
$body$ LANGUAGE plpgsql;
SELECT 1;
`
		stmts := splitSQLStatementsForRestore(script, "postgres")
		if len(stmts) != 2 {
			t.Fatalf("expected 2 statements, got %d: %#v", len(stmts), stmts)
		}
		if !strings.Contains(stmts[0], "$body$") {
			t.Errorf("expected dollar-quoted body preserved: %s", stmts[0])
		}
	})

	t.Run("MSSQL GO separator", func(t *testing.T) {
		script := "SELECT 1\nGO\nSELECT 2\nGO\n"
		stmts := splitSQLStatementsForRestore(script, "mssql")
		if len(stmts) != 2 {
			t.Fatalf("expected 2 statements, got %d: %#v", len(stmts), stmts)
		}
	})

	t.Run("Oracle slash separator", func(t *testing.T) {
		script := "BEGIN NULL; END;\n/\nSELECT 1 FROM DUAL;\n"
		stmts := splitSQLStatementsForRestore(script, "oracle")
		if len(stmts) != 2 {
			t.Fatalf("expected 2 statements, got %d: %#v", len(stmts), stmts)
		}
	})
}

func TestFormatSQLValue(t *testing.T) {
	if got := formatSQLValue("postgres", nil); got != "NULL" {
		t.Errorf("nil: got %q, want NULL", got)
	}
	if got := formatSQLValue("postgres", true); got != "TRUE" {
		t.Errorf("postgres bool: got %q, want TRUE", got)
	}
	if got := formatSQLValue("mysql", true); got != "1" {
		t.Errorf("mysql bool: got %q, want 1", got)
	}
	if got := formatSQLValue("postgres", 42); got != "42" {
		t.Errorf("int: got %q, want 42", got)
	}
	if got := formatSQLValue("mysql", "it's\na\\b"); got != `'it\'s\na\\b'` {
		t.Errorf("mysql escape: got %q", got)
	}
	if got := formatSQLValue("postgres", "it's"); got != `'it''s'` {
		t.Errorf("postgres escape: got %q", got)
	}
	ts := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	if got := formatSQLValue("oracle", ts); !strings.Contains(got, "TO_TIMESTAMP('2026-01-02 03:04:05'") {
		t.Errorf("oracle timestamp: got %q", got)
	}
	bin := []byte{0xff, 0x00, 0xab}
	if got := formatSQLValue("postgres", bin); got != `'\xff00ab'` {
		t.Errorf("postgres binary: got %q", got)
	}
	if got := formatSQLValue("sqlite", bin); got != `X'FF00AB'` {
		t.Errorf("sqlite binary: got %q", got)
	}
}

func TestSchemaService_BackupAndRestoreSQLite_PlainAndGzip(t *testing.T) {
	localStore, cleanup := setupTestStore(t)
	defer cleanup()

	tmpDir := t.TempDir()
	srcDBPath := filepath.Join(tmpDir, "src.db")
	dstDBPath := filepath.Join(tmpDir, "dst.db")

	srcDB, err := sql.Open("sqlite", srcDBPath)
	if err != nil {
		t.Fatalf("open src sqlite: %v", err)
	}
	_, err = srcDB.Exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
		INSERT INTO users (id, name) VALUES (1, 'Alice'), (2, 'Bob''s');
	`)
	_ = srcDB.Close()
	if err != nil {
		t.Fatalf("seed src sqlite: %v", err)
	}

	dstDB, err := sql.Open("sqlite", dstDBPath)
	if err != nil {
		t.Fatalf("open dst sqlite: %v", err)
	}
	_ = dstDB.Close()

	ctx := context.Background()
	_, err = localStore.SaveConnection(ctx, store.ConnectionConfig{
		ID:           "src-sqlite",
		Name:         "Src SQLite",
		Driver:       "sqlite",
		FilePath:     srcDBPath,
		DatabaseName: "main",
	})
	if err != nil {
		t.Fatalf("save src conn: %v", err)
	}
	_, err = localStore.SaveConnection(ctx, store.ConnectionConfig{
		ID:           "dst-sqlite",
		Name:         "Dst SQLite",
		Driver:       "sqlite",
		FilePath:     dstDBPath,
		DatabaseName: "main",
	})
	if err != nil {
		t.Fatalf("save dst conn: %v", err)
	}

	sm := manager.NewSessionManager(localStore)
	defer sm.CloseAll()
	svc := NewSchemaService(localStore, sm, nil)

	gzPath := filepath.Join(tmpDir, "backup.sql.gz")
	if err := svc.backupDatabaseNativeSQL(ctx, "src-sqlite", "sqlite", "main", gzPath, BackupOptions{
		Mode:           "full",
		TableSelection: "all",
	}); err != nil {
		t.Fatalf("backupDatabaseNativeSQL(.sql.gz) failed: %v", err)
	}

	fi, err := os.Stat(gzPath)
	if err != nil || fi.Size() == 0 {
		t.Fatalf("expected non-empty .sql.gz backup file, err=%v", err)
	}

	if err := svc.restoreDatabaseNativeSQL(ctx, "dst-sqlite", "sqlite", "main", gzPath, fi.Size()); err != nil {
		t.Fatalf("restoreDatabaseNativeSQL(.sql.gz) failed: %v", err)
	}

	verifyDB, err := sql.Open("sqlite", dstDBPath)
	if err != nil {
		t.Fatalf("open verify db: %v", err)
	}
	defer verifyDB.Close()

	var count int
	if err := verifyDB.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err != nil {
		t.Fatalf("count restored rows: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 restored rows, got %d", count)
	}
}

func TestSchemaService_RestoreReadOnlyBlocked(t *testing.T) {
	localStore, cleanup := setupTestStore(t)
	defer cleanup()

	tmpDir := t.TempDir()
	sqlFile := filepath.Join(tmpDir, "dump.sql")
	if err := os.WriteFile(sqlFile, []byte("SELECT 1;"), 0644); err != nil {
		t.Fatalf("write sql file: %v", err)
	}

	ctx := context.Background()
	_, err := localStore.SaveConnection(ctx, store.ConnectionConfig{
		ID:           "ro-conn",
		Name:         "Prod ReadOnly",
		Driver:       "sqlite",
		FilePath:     filepath.Join(tmpDir, "ro.db"),
		DatabaseName: "main",
		IsReadOnly:   true,
	})
	if err != nil {
		t.Fatalf("save conn: %v", err)
	}

	sm := manager.NewSessionManager(localStore)
	defer sm.CloseAll()
	svc := NewSchemaService(localStore, sm, nil)

	_, err = svc.RestoreDatabaseWithOptions("ro-conn", "main", sqlFile, "")
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "read-only") {
		t.Fatalf("expected read-only error, got: %v", err)
	}
}

func TestSchemaService_CancelBackupRestore(t *testing.T) {
	svc := NewSchemaService(nil, nil, nil)
	if svc.CancelBackupRestore("c1", "db1") {
		t.Errorf("expected false when no operation is active")
	}

	ctx, cancel := context.WithCancel(context.Background())
	key := backupRestoreOpKey("c1", "db1")
	svc.registerOp(key, cancel)
	if !svc.CancelBackupRestore("c1", "db1") {
		t.Errorf("expected true when operation is active")
	}
	if ctx.Err() == nil {
		t.Errorf("expected context to be cancelled")
	}
	svc.unregisterOp(key)
}

func TestBuildModifyColumnSQL(t *testing.T) {
	sc := driver.ColumnMeta{Name: "email", DataType: "varchar(320)", IsNullable: false}
	dc := driver.ColumnMeta{Name: "email", DataType: "varchar(255)", IsNullable: true}

	if got := buildModifyColumnSQL("mysql", "`users`", sc, dc); !strings.Contains(got, "MODIFY COLUMN `email` varchar(320) NOT NULL;") {
		t.Errorf("mysql modify: %s", got)
	}
	if got := buildModifyColumnSQL("postgres", `"users"`, sc, dc); !strings.Contains(got, "ALTER COLUMN \"email\" TYPE varchar(320)") || !strings.Contains(got, "SET NOT NULL") {
		t.Errorf("postgres modify: %s", got)
	}
	if got := buildModifyColumnSQL("mssql", "[users]", sc, dc); !strings.Contains(got, "ALTER COLUMN [email] varchar(320) NOT NULL;") {
		t.Errorf("mssql modify: %s", got)
	}
	if got := buildModifyColumnSQL("oracle", `"users"`, sc, dc); !strings.Contains(got, `MODIFY ("email" varchar(320) NOT NULL);`) {
		t.Errorf("oracle modify: %s", got)
	}
}
