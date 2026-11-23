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
		CheckConstraints: []driver.CheckConstraintMeta{
			{Name: "posts_user_id_positive", Clause: "user_id > 0"},
		},
		Comment: "User posts table",
		Indexes: []driver.IndexMeta{
			{Name: "posts_pkey", Columns: []string{"id"}, IsPrimary: true, Method: "btree"},
			{Name: "idx_posts_user", Columns: []string{"user_id"}, IsUnique: true, Method: "btree"},
			{Name: "idx_posts_gin", Columns: []string{"user_id"}, Method: "gin"},
		},
	}
	ddl := generatePostgresDDL("public", "posts", s)

	for _, want := range []string{
		`ON DELETE CASCADE`,
		`CONSTRAINT "posts_user_id_positive" CHECK (user_id > 0)`,
		`COMMENT ON TABLE "posts" IS 'User posts table';`,
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

func TestGeneratePostgresDDLIncludesPgvectorColumnsAndIndexes(t *testing.T) {
	s := &driver.TableStructure{
		Columns: []driver.ColumnMeta{
			{Name: "id", DataType: "bigint"},
			{Name: "embedding", DataType: "vector(1536)", IsNullable: true},
			{Name: "half_emb", DataType: "halfvec(768)", IsNullable: true},
		},
		PrimaryKeys: []string{"id"},
		Indexes: []driver.IndexMeta{
			{Name: "docs_pkey", Columns: []string{"id"}, IsPrimary: true, Method: "btree"},
			{
				Name:       "idx_docs_embedding_hnsw",
				Columns:    []string{"embedding"},
				Method:     "hnsw",
				Definition: "CREATE INDEX idx_docs_embedding_hnsw ON public.docs USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64')",
			},
			{
				Name:       "idx_docs_half_ivf",
				Columns:    []string{"half_emb"},
				Method:     "ivfflat",
				Definition: "CREATE INDEX idx_docs_half_ivf ON public.docs USING ivfflat (half_emb halfvec_l2_ops) WITH (lists='100')",
			},
		},
	}

	ddl := generatePostgresDDL("public", "docs", s)

	for _, want := range []string{
		`"embedding" vector(1536)`,
		`"half_emb" halfvec(768)`,
		`CREATE INDEX idx_docs_embedding_hnsw ON public.docs USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64');`,
		`CREATE INDEX idx_docs_half_ivf ON public.docs USING ivfflat (half_emb halfvec_l2_ops) WITH (lists='100');`,
	} {
		if !strings.Contains(ddl, want) {
			t.Errorf("DDL missing %q\n%s", want, ddl)
		}
	}
}

func TestFormatSQLVal(t *testing.T) {
	if got := formatSQLVal(nil); got != "NULL" {
		t.Errorf("nil = %q, want NULL", got)
	}
	if got := formatSQLVal("O'Reilly"); got != "'O''Reilly'" {
		t.Errorf("string = %q, want 'O''Reilly'", got)
	}
	if got := formatSQLVal(true); got != "TRUE" {
		t.Errorf("bool = %q, want TRUE", got)
	}
	if got := formatSQLVal(int64(42)); got != "42" {
		t.Errorf("int64 = %q, want 42", got)
	}
	if got := formatSQLVal([]byte{0xde, 0xad, 0xbe, 0xef}); got != `'\xdeadbeef'::bytea` {
		t.Errorf("bytes = %q, want '\\xdeadbeef'::bytea", got)
	}
}

func TestGeneratePostgresDDL_IdentityGeneratedCompositeFKAndGinIndex(t *testing.T) {
	s := &driver.TableStructure{
		Columns: []driver.ColumnMeta{
			{Name: "tenant_id", DataType: "bigint"},
			{Name: "id", DataType: "bigint", DefaultKind: "IDENTITY_ALWAYS"},
			{Name: "full_name", DataType: "text", DefaultKind: "GENERATED_STORED", DefaultValue: "(first_name || ' ' || last_name)", IsNullable: true},
			{Name: "status", DataType: "order_status", EnumValues: []string{"pending", "paid"}},
		},
		PrimaryKeys: []string{"tenant_id", "id"},
		ForeignKeys: []driver.ForeignKeyMeta{
			{
				ConstraintName: "fk_orders_customer",
				ColumnName:     "tenant_id",
				RefSchema:      "crm",
				RefTable:       "customers",
				RefColumn:      "tenant_id",
				OnDelete:       "CASCADE",
			},
			{
				ConstraintName: "fk_orders_customer",
				ColumnName:     "id",
				RefSchema:      "crm",
				RefTable:       "customers",
				RefColumn:      "id",
				OnDelete:       "CASCADE",
			},
		},
		Indexes: []driver.IndexMeta{
			{
				Name:       "idx_orders_lower_status",
				Method:     "gin",
				Definition: "CREATE INDEX idx_orders_lower_status ON public.orders USING gin (payload) WHERE (deleted_at IS NULL)",
			},
		},
	}

	ddl := generatePostgresDDL("public", "orders", s)
	for _, want := range []string{
		`"id" bigint NOT NULL GENERATED ALWAYS AS IDENTITY`,
		`"full_name" text GENERATED ALWAYS AS ((first_name || ' ' || last_name)) STORED`,
		`"status" order_status NOT NULL`,
		`PRIMARY KEY ("tenant_id", "id")`,
		`CONSTRAINT "fk_orders_customer" FOREIGN KEY ("tenant_id", "id") REFERENCES "crm"."customers" ("tenant_id", "id") ON DELETE CASCADE`,
		`CREATE INDEX idx_orders_lower_status ON public.orders USING gin (payload) WHERE (deleted_at IS NULL);`,
	} {
		if !strings.Contains(ddl, want) {
			t.Errorf("DDL missing %q\n%s", want, ddl)
		}
	}
}

