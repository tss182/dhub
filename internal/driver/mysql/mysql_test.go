package mysql

import (
	"testing"

	"dhub/internal/driver"
)

func TestQuoteIdent(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"users", "`users`"},
		{"user`table", "`user``table`"},
		{"my`db`name", "`my``db``name`"},
	}

	for _, c := range cases {
		got := quoteIdent(c.input)
		if got != c.expected {
			t.Errorf("quoteIdent(%q) = %q, expected %q", c.input, got, c.expected)
		}
	}
}

func TestNormalizeMySQLValue(t *testing.T) {
	cases := []struct {
		input    any
		expected any
	}{
		{nil, nil},
		{"null", nil},
		{"<NULL>", nil},
		{"2026-11-05T12:30:00Z", "2026-11-05 12:30:00"},
		{"hello", "hello"},
		{123, 123},
	}

	for _, c := range cases {
		got := normalizeMySQLValue(c.input)
		if got != c.expected {
			t.Errorf("normalizeMySQLValue(%v) = %v, expected %v", c.input, got, c.expected)
		}
	}
}

func TestGenerateDMLPreview(t *testing.T) {
	d := &MySQLDriver{}
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

	stmts, err := d.GenerateDMLPreview("mydb", "", "users", changes)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(stmts) != 3 {
		t.Fatalf("expected 3 statements, got %d", len(stmts))
	}

	// Verify insert
	if len(stmts[0]) == 0 || stmts[0][:11] != "INSERT INTO" {
		t.Errorf("unexpected insert statement: %s", stmts[0])
	}

	// Verify update
	if len(stmts[1]) == 0 || stmts[1][:11] != "UPDATE `myd" {
		t.Errorf("unexpected update statement: %s", stmts[1])
	}

	// Verify delete
	expectedDelete := "DELETE FROM `mydb`.`users` WHERE `id` = 2;"
	if stmts[2] != expectedDelete {
		t.Errorf("expected delete statement %q, got %q", expectedDelete, stmts[2])
	}
}

