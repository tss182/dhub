package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"dhub/internal/driver"
)

func newTestDriver(t *testing.T) *SQLiteDriver {
	t.Helper()
	drv, err := NewSQLiteDriver(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	return drv
}

func TestGetTableStructureIndexesAndForeignKeys(t *testing.T) {
	drv := newTestDriver(t)
	ctx := context.Background()

	_, err := drv.Execute(ctx, driver.QueryRequest{SQL: `
		CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, org TEXT);
		CREATE TABLE posts (
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			title TEXT
		);
		CREATE UNIQUE INDEX idx_users_email ON users(email);
		CREATE INDEX idx_users_org_email ON users(org, email);
	`})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	users, err := drv.GetTableStructure(ctx, "main", "main", "users")
	if err != nil {
		t.Fatalf("users structure: %v", err)
	}

	idx := map[string]driver.IndexMeta{}
	for _, i := range users.Indexes {
		idx[i.Name] = i
	}
	if u, ok := idx["idx_users_email"]; !ok || !u.IsUnique || len(u.Columns) != 1 || u.Columns[0] != "email" {
		t.Fatalf("unexpected unique index: %+v (found=%v)", u, ok)
	}
	if c, ok := idx["idx_users_org_email"]; !ok || c.IsUnique || len(c.Columns) != 2 || c.Columns[0] != "org" || c.Columns[1] != "email" {
		t.Fatalf("unexpected composite index: %+v (found=%v)", c, ok)
	}
	if !users.Columns[0].IsAutoIncr {
		t.Fatalf("expected users.id to be auto-increment")
	}

	posts, err := drv.GetTableStructure(ctx, "main", "main", "posts")
	if err != nil {
		t.Fatalf("posts structure: %v", err)
	}
	if len(posts.ForeignKeys) != 1 || posts.ForeignKeys[0].RefTable != "users" || posts.ForeignKeys[0].OnDelete != "CASCADE" {
		t.Fatalf("unexpected foreign keys: %+v", posts.ForeignKeys)
	}
}

func TestGetTableStructureQuotedTableName(t *testing.T) {
	drv := newTestDriver(t)
	ctx := context.Background()

	if _, err := drv.Execute(ctx, driver.QueryRequest{SQL: `CREATE TABLE "it's" (id INTEGER PRIMARY KEY, v TEXT);`}); err != nil {
		t.Fatalf("setup: %v", err)
	}
	st, err := drv.GetTableStructure(ctx, "main", "main", "it's")
	if err != nil {
		t.Fatalf("structure: %v", err)
	}
	if len(st.Columns) != 2 {
		t.Fatalf("expected 2 columns, got %d", len(st.Columns))
	}
}

func TestDeepPagingReturnsCorrectPage(t *testing.T) {
	drv := newTestDriver(t)
	ctx := context.Background()

	var sb strings.Builder
	sb.WriteString("CREATE TABLE n (v INTEGER);\nINSERT INTO n VALUES ")
	for i := 1; i <= 250; i++ {
		if i > 1 {
			sb.WriteString(",")
		}
		sb.WriteString(fmt.Sprintf("(%d)", i))
	}
	sb.WriteString(";")
	if _, err := drv.Execute(ctx, driver.QueryRequest{SQL: sb.String()}); err != nil {
		t.Fatalf("setup: %v", err)
	}

	res, err := drv.Execute(ctx, driver.QueryRequest{SQL: "SELECT v FROM n ORDER BY v", Limit: 100, Offset: 200})
	if err != nil {
		t.Fatalf("paged query: %v", err)
	}
	if len(res.Rows) != 50 {
		t.Fatalf("expected 50 rows on last page, got %d", len(res.Rows))
	}
	if first, _ := res.Rows[0][0].(int64); first != 201 {
		t.Fatalf("first row of page = %v, want 201", res.Rows[0][0])
	}
	if res.HasMore {
		t.Fatalf("last page must not report HasMore")
	}

	mid, err := drv.Execute(ctx, driver.QueryRequest{SQL: "SELECT v FROM n ORDER BY v", Limit: 100, Offset: 100})
	if err != nil {
		t.Fatalf("mid page: %v", err)
	}
	if len(mid.Rows) != 100 || !mid.HasMore {
		t.Fatalf("mid page rows=%d hasMore=%v, want 100/true", len(mid.Rows), mid.HasMore)
	}
}

func TestSQLiteApplyChangesAndDMLPreview(t *testing.T) {
	drv := newTestDriver(t)
	ctx := context.Background()

	_, err := drv.Execute(ctx, driver.QueryRequest{SQL: `
		CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL);
		INSERT INTO products (id, name, price) VALUES (1, 'Book', 12.50), (2, 'Pen', 1.50);
	`})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	changes := []driver.RowChange{
		{
			Type: "insert",
			Changes: map[string]any{
				"id":    3,
				"name":  "Notebook",
				"price": 5.0,
			},
		},
		{
			Type: "update",
			PrimaryKey: map[string]any{
				"id": 1,
			},
			Changes: map[string]any{
				"price": 15.0,
			},
		},
		{
			Type: "delete",
			PrimaryKey: map[string]any{
				"id": 2,
			},
		},
	}

	// 1. GenerateDMLPreview
	preview, err := drv.GenerateDMLPreview("main", "main", "products", changes)
	if err != nil {
		t.Fatalf("GenerateDMLPreview failed: %v", err)
	}
	if len(preview) != 3 {
		t.Fatalf("expected 3 statements in preview, got %d", len(preview))
	}

	// 2. ApplyChanges
	affected, err := drv.ApplyChanges(ctx, "main", "main", "products", changes)
	if err != nil {
		t.Fatalf("ApplyChanges failed: %v", err)
	}
	if affected != 3 {
		t.Errorf("expected 3 rows affected, got %d", affected)
	}

	// 3. Verify final table state
	res, err := drv.Execute(ctx, driver.QueryRequest{SQL: "SELECT id, name, price FROM products ORDER BY id;"})
	if err != nil {
		t.Fatalf("query products: %v", err)
	}
	if len(res.Rows) != 2 {
		t.Fatalf("expected 2 remaining rows, got %d", len(res.Rows))
	}
	// Row 1: id=1, price=15.0
	if res.Rows[0][0].(int64) != 1 || res.Rows[0][2].(float64) != 15.0 {
		t.Errorf("unexpected updated row: %+v", res.Rows[0])
	}
	// Row 2: id=3, name=Notebook
	if res.Rows[1][0].(int64) != 3 || res.Rows[1][1].(string) != "Notebook" {
		t.Errorf("unexpected inserted row: %+v", res.Rows[1])
	}
}

func TestSQLite_ServerInfo_ViewDDL_GeneratedColumns_StreamQuery(t *testing.T) {
	drv := newTestDriver(t)
	ctx := context.Background()

	info, err := drv.ServerInfo(ctx)
	if err != nil {
		t.Fatalf("ServerInfo failed: %v", err)
	}
	if info.Flavor != "sqlite" || info.Major < 3 || info.Version == "" {
		t.Fatalf("unexpected ServerInfo: %+v", info)
	}

	_, err = drv.Execute(ctx, driver.QueryRequest{
		SQL: `CREATE TABLE items (
			id INTEGER PRIMARY KEY,
			price INTEGER NOT NULL,
			qty INTEGER NOT NULL,
			total INTEGER GENERATED ALWAYS AS (price * qty) STORED
		);
		INSERT INTO items (id, price, qty) VALUES (1, 10, 3), (2, 20, 2);
		CREATE VIEW item_totals AS SELECT id, total FROM items;`,
	})
	if err != nil {
		t.Fatalf("setup schema failed: %v", err)
	}

	tblStruct, err := drv.GetTableStructure(ctx, "main", "main", "items")
	if err != nil {
		t.Fatalf("GetTableStructure(items) failed: %v", err)
	}
	var foundGenerated bool
	for _, c := range tblStruct.Columns {
		if c.Name == "total" {
			foundGenerated = true
			if c.ColumnKind != "STORED" || c.DefaultKind != "GENERATED_STORED" {
				t.Errorf("expected generated STORED column, got ColumnKind=%q DefaultKind=%q", c.ColumnKind, c.DefaultKind)
			}
		}
	}
	if !foundGenerated {
		t.Fatalf("expected generated column 'total' in table_xinfo output")
	}

	viewStruct, err := drv.GetTableStructure(ctx, "main", "main", "item_totals")
	if err != nil {
		t.Fatalf("GetTableStructure(item_totals) failed: %v", err)
	}
	if !strings.Contains(strings.ToUpper(viewStruct.DDL), "CREATE VIEW") {
		t.Errorf("expected CREATE VIEW DDL, got %q", viewStruct.DDL)
	}

	var streamedRows int
	err = drv.StreamQuery(ctx, driver.QueryRequest{SQL: "SELECT id, total FROM item_totals ORDER BY id;"}, func(cols []driver.ColumnMeta, row []any) error {
		streamedRows++
		return nil
	})
	if err != nil {
		t.Fatalf("StreamQuery failed: %v", err)
	}
	if streamedRows != 2 {
		t.Errorf("expected 2 streamed rows, got %d", streamedRows)
	}
}

func TestSQLite_CheckConstraints_And_TabSessionManager(t *testing.T) {
	drv := newTestDriver(t)
	ctx := context.Background()

	_, err := drv.Execute(ctx, driver.QueryRequest{
		SQL: `CREATE TABLE orders_chk (
			id INTEGER PRIMARY KEY,
			qty INTEGER NOT NULL CONSTRAINT chk_positive_qty CHECK (qty > 0),
			status TEXT CHECK (status IN ('open', 'closed'))
		);`,
	})
	if err != nil {
		t.Fatalf("create table failed: %v", err)
	}

	st, err := drv.GetTableStructure(ctx, "main", "main", "orders_chk")
	if err != nil {
		t.Fatalf("GetTableStructure failed: %v", err)
	}
	if len(st.CheckConstraints) != 2 {
		t.Fatalf("expected 2 check constraints, got %d: %+v", len(st.CheckConstraints), st.CheckConstraints)
	}
	if st.CheckConstraints[0].Name != "chk_positive_qty" || st.CheckConstraints[0].Clause != "qty > 0" {
		t.Errorf("unexpected first check constraint: %+v", st.CheckConstraints[0])
	}

	mgr := driver.NewTabSessionManager(func(string) (*sql.DB, error) {
		return drv.db, nil
	})
	defer mgr.CloseAll()

	conn1, release1, reset1, err := mgr.Acquire(ctx, "tab-1", "main")
	if err != nil {
		t.Fatalf("Acquire 1 failed: %v", err)
	}
	if reset1 {
		t.Errorf("expected reset1=false on first acquire")
	}
	if _, err := conn1.ExecContext(ctx, `CREATE TEMP TABLE tmp_tab_session (x INT); INSERT INTO tmp_tab_session VALUES (42);`); err != nil {
		release1()
		t.Fatalf("temp table create failed: %v", err)
	}
	release1()

	// Second acquire on the same tab must see the temp table on the same pinned connection.
	conn2, release2, reset2, err := mgr.Acquire(ctx, "tab-1", "main")
	if err != nil {
		t.Fatalf("Acquire 2 failed: %v", err)
	}
	if reset2 {
		t.Errorf("expected reset2=false on healthy pinned conn")
	}
	var got int
	if err := conn2.QueryRowContext(ctx, `SELECT x FROM tmp_tab_session`).Scan(&got); err != nil {
		release2()
		t.Fatalf("expected temp table to persist across tab session acquires: %v", err)
	}
	release2()
	if got != 42 {
		t.Errorf("expected 42 from temp table, got %d", got)
	}

	mgr.CloseSession("tab-1")
}
