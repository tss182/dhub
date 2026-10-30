package store

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestWorksheetSaveAndList(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("Failed to open sqlite: %v", err)
	}
	defer db.Close()

	s := &LocalStore{db: db}
	if err := s.migrate(); err != nil {
		t.Fatalf("Failed to migrate: %v", err)
	}

	// 1. Test Save
	ws := Worksheet{
		ID:             "console-test-1",
		ConnectionID:   "",
		Title:          "test_console.sql",
		Content:        "SELECT 123;",
		TargetDatabase: "rnd_dev",
		TargetSchema:   "public",
	}

	savedID, err := s.SaveWorksheet(context.Background(), ws)
	if err != nil {
		t.Fatalf("SaveWorksheet failed: %v", err)
	}
	t.Logf("Saved worksheet ID: %s", savedID)

	// 2. Test List
	list, err := s.ListWorksheets(context.Background(), "")
	if err != nil {
		t.Fatalf("ListWorksheets failed: %v", err)
	}

	if len(list) != 1 {
		t.Fatalf("Expected 1 worksheet, got %d", len(list))
	}

	t.Logf("Loaded worksheet: %+v", list[0])
	if list[0].Title != "test_console.sql" {
		t.Errorf("Expected title 'test_console.sql', got '%s'", list[0].Title)
	}
	if list[0].Content != "SELECT 123;" {
		t.Errorf("Expected content 'SELECT 123;', got '%s'", list[0].Content)
	}
}

