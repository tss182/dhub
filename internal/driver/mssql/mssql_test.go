package mssql

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
		{"users", "[users]"},
		{"user]name", "[user]]name]"},
		{"my table", "[my table]"},
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
		{"dbo", "users", "[dbo].[users]"},
		{"", "users", "[users]"},
		{"sales", "order items", "[sales].[order items]"},
	}

	for _, tt := range tests {
		got := qualifiedName(tt.schema, tt.table)
		if got != tt.expected {
			t.Errorf("qualifiedName(%q, %q) = %q; want %q", tt.schema, tt.table, got, tt.expected)
		}
	}
}

func TestGenerateMSSQLDDL(t *testing.T) {
	ts := &driver.TableStructure{
		Schema: "dbo",
		Name:   "users",
		Columns: []driver.ColumnMeta{
			{Name: "id", DataType: "int", IsAutoIncr: true, IsNullable: false},
			{Name: "username", DataType: "nvarchar(255)", IsNullable: false},
			{Name: "email", DataType: "nvarchar(255)", IsNullable: true, DefaultValue: "('test@example.com')"},
		},
		PrimaryKeys: []string{"id"},
		Indexes: []driver.IndexMeta{
			{Name: "IX_users_username", Columns: []string{"username"}, IsUnique: true},
		},
	}

	ddl := generateMSSQLDDL("dbo", "users", ts)

	if !strings.Contains(ddl, "CREATE TABLE [dbo].[users]") {
		t.Errorf("expected CREATE TABLE statement, got: %s", ddl)
	}
	if !strings.Contains(ddl, "[id] int IDENTITY(1,1) NOT NULL") {
		t.Errorf("expected identity primary key, got: %s", ddl)
	}
	if !strings.Contains(ddl, "CONSTRAINT [PK_users] PRIMARY KEY ([id])") {
		t.Errorf("expected primary key constraint, got: %s", ddl)
	}
	if !strings.Contains(ddl, "CREATE UNIQUE INDEX [IX_users_username] ON [dbo].[users] ([username])") {
		t.Errorf("expected unique index statement, got: %s", ddl)
	}
}

func TestGenerateDMLPreview(t *testing.T) {
	drv := &MSSQLDriver{}

	changes := []driver.RowChange{
		{
			Type: "insert",
			Changes: map[string]any{
				"name": "Alice",
				"age":  30,
			},
		},
		{
			Type: "update",
			PrimaryKey: map[string]any{
				"id": 1,
			},
			Changes: map[string]any{
				"name": "Bob",
			},
		},
		{
			Type: "delete",
			PrimaryKey: map[string]any{
				"id": 2,
			},
		},
	}

	stmts, err := drv.GenerateDMLPreview("testdb", "dbo", "users", changes)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(stmts) != 3 {
		t.Fatalf("expected 3 statements, got %d", len(stmts))
	}

	if !strings.HasPrefix(stmts[0], "INSERT INTO [dbo].[users]") {
		t.Errorf("statement 0 mismatch: %s", stmts[0])
	}
	if !strings.Contains(stmts[0], "'Alice'") || !strings.Contains(stmts[0], "30") {
		t.Errorf("insert values mismatch: %s", stmts[0])
	}

	if !strings.HasPrefix(stmts[1], "UPDATE [dbo].[users] SET [name] = 'Bob' WHERE [id] = 1") {
		t.Errorf("statement 1 mismatch: %s", stmts[1])
	}

	if !strings.HasPrefix(stmts[2], "DELETE FROM [dbo].[users] WHERE [id] = 2") {
		t.Errorf("statement 2 mismatch: %s", stmts[2])
	}
}
