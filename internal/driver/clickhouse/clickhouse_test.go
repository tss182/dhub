package clickhouse

import (
	"strings"
	"testing"

	"dhub/internal/driver"
)

func TestQuoteIdent(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"users", "`users`"},
		{"user`name", "`user``name`"},
		{"my table", "`my table`"},
	}

	for _, tt := range tests {
		got := quoteIdent(tt.input)
		if got != tt.expected {
			t.Errorf("quoteIdent(%q) = %q; want %q", tt.input, got, tt.expected)
		}
	}
}

func TestQualifiedName(t *testing.T) {
	tests := []struct {
		schema   string
		table    string
		expected string
	}{
		{"default", "users", "`users`"},
		{"", "users", "`users`"},
		{"analytics", "events", "`analytics`.`events`"},
	}

	for _, tt := range tests {
		got := qualifiedName(tt.schema, tt.table)
		if got != tt.expected {
			t.Errorf("qualifiedName(%q, %q) = %q; want %q", tt.schema, tt.table, got, tt.expected)
		}
	}
}

func TestGenerateClickHouseDDL(t *testing.T) {
	ts := &driver.TableStructure{
		Schema: "analytics",
		Name:   "events",
		Columns: []driver.ColumnMeta{
			{Name: "id", DataType: "UInt64", IsPrimaryKey: true},
			{Name: "event_name", DataType: "String", IsNullable: false},
			{Name: "timestamp", DataType: "DateTime", DefaultValue: "now()"},
		},
		PrimaryKeys: []string{"id"},
	}

	ddl := generateClickHouseDDL("analytics", "events", ts)

	if !strings.Contains(ddl, "CREATE TABLE `analytics`.`events`") {
		t.Errorf("expected CREATE TABLE statement, got: %s", ddl)
	}
	if !strings.Contains(ddl, "ENGINE = MergeTree()") {
		t.Errorf("expected MergeTree engine, got: %s", ddl)
	}
	if !strings.Contains(ddl, "ORDER BY (`id`);") {
		t.Errorf("expected ORDER BY clause, got: %s", ddl)
	}
}

func TestGenerateDMLPreview(t *testing.T) {
	drv := &ClickHouseDriver{}

	changes := []driver.RowChange{
		{
			Type: "insert",
			Changes: map[string]any{
				"name": "Clicky",
				"age":  10,
			},
		},
		{
			Type: "update",
			PrimaryKey: map[string]any{
				"id": 1,
			},
			Changes: map[string]any{
				"name": "Clicky Updated",
			},
		},
		{
			Type: "delete",
			PrimaryKey: map[string]any{
				"id": 2,
			},
		},
	}

	stmts, err := drv.GenerateDMLPreview("default", "default", "users", changes)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(stmts) != 3 {
		t.Fatalf("expected 3 statements, got %d", len(stmts))
	}

	if !strings.HasPrefix(stmts[0], "INSERT INTO `users`") {
		t.Errorf("statement 0 mismatch: %s", stmts[0])
	}
	if !strings.HasPrefix(stmts[1], "ALTER TABLE `users` UPDATE `name` = 'Clicky Updated' WHERE `id` = 1") {
		t.Errorf("statement 1 mismatch: %s", stmts[1])
	}
	if !strings.HasPrefix(stmts[2], "ALTER TABLE `users` DELETE WHERE `id` = 2") {
		t.Errorf("statement 2 mismatch: %s", stmts[2])
	}
}

