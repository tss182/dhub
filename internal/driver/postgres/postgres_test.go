package postgres

import (
	"strings"
	"testing"

	"dhub/internal/driver"
)

func TestQuoteIdentEscapesQuotes(t *testing.T) {
	if got := quoteIdent(`we"ird`); got != `"we""ird"` {
		t.Fatalf("got %s", got)
	}
}

func TestDbForSelectsPools(t *testing.T) {
	drv, err := NewPostgresDriver("postgres://u:p@localhost:5432/appdb?sslmode=disable")
	if err != nil {
		t.Fatalf("new: %v", err)
	}
	defer drv.Close()

	// sql.Open is lazy, so no server is needed to verify pool routing.
	for _, name := range []string{"", "main", "appdb"} {
		db, err := drv.dbFor(name)
		if err != nil || db != drv.db {
			t.Fatalf("dbFor(%q) should use the default pool (err=%v)", name, err)
		}
	}

	other, err := drv.dbFor("analytics")
	if err != nil || other == drv.db {
		t.Fatalf("dbFor(analytics) should create a separate pool (err=%v)", err)
	}
	again, _ := drv.dbFor("analytics")
	if again != other {
		t.Fatalf("pool for the same database must be reused")
	}
}

func TestGeneratePostgresDDLIncludesIndexesAndFKRules(t *testing.T) {
	s := &driver.TableStructure{
		Columns: []driver.ColumnMeta{
			{Name: "id", DataType: "integer"},
			{Name: "user_id", DataType: "integer", IsNullable: true},
		},
		PrimaryKeys: []string{"id"},
		ForeignKeys: []driver.ForeignKeyMeta{{
			ConstraintName: "posts_user_fk", ColumnName: "user_id",
			RefSchema: "public", RefTable: "users", RefColumn: "id",
			OnUpdate: "NO ACTION", OnDelete: "CASCADE",
		}},
		Indexes: []driver.IndexMeta{
			{Name: "posts_pkey", Columns: []string{"id"}, IsPrimary: true, Method: "btree"},
			{Name: "idx_posts_user", Columns: []string{"user_id"}, IsUnique: true, Method: "btree"},
			{Name: "idx_posts_gin", Columns: []string{"user_id"}, Method: "gin"},
		},
	}
	ddl := generatePostgresDDL("public", "posts", s)

	for _, want := range []string{
		`ON DELETE CASCADE`,
		`CREATE UNIQUE INDEX "idx_posts_user" ON "posts" ("user_id");`,
		`CREATE INDEX "idx_posts_gin" ON "posts" USING gin ("user_id");`,
	} {
		if !strings.Contains(ddl, want) {
			t.Errorf("DDL missing %q\n%s", want, ddl)
		}
	}
	if strings.Contains(ddl, "ON UPDATE NO ACTION") {
		t.Errorf("NO ACTION rule should be omitted\n%s", ddl)
	}
	if strings.Contains(ddl, `INDEX "posts_pkey"`) {
		t.Errorf("primary key index must not be emitted separately\n%s", ddl)
	}
}

