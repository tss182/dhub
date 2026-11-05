package sqlite

import (
	"context"
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
