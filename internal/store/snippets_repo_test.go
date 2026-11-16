package store

import (
	"context"
	"testing"
)

func TestSnippetsCRUD(t *testing.T) {
	s, err := NewLocalStoreWithPath(":memory:")
	if err != nil {
		t.Fatalf("failed to open in-memory store: %v", err)
	}
	defer s.Close()

	ctx := context.Background()
	id, err := s.SaveSnippet(ctx, QuerySnippet{
		Title:       "Active Connections",
		Description: "List active PG sessions",
		SQLText:     "SELECT * FROM pg_stat_activity;",
		Driver:      "postgres",
		Tags:        "monitoring,pg",
	})
	if err != nil {
		t.Fatalf("SaveSnippet failed: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty snippet id")
	}

	list, err := s.ListSnippets(ctx)
	if err != nil {
		t.Fatalf("ListSnippets failed: %v", err)
	}
	if len(list) != 1 || list[0].Title != "Active Connections" {
		t.Fatalf("unexpected snippets list: %+v", list)
	}

	if err := s.DeleteSnippet(ctx, id); err != nil {
		t.Fatalf("DeleteSnippet failed: %v", err)
	}
	listAfter, err := s.ListSnippets(ctx)
	if err != nil {
		t.Fatalf("ListSnippets after delete failed: %v", err)
	}
	if len(listAfter) != 0 {
		t.Fatalf("expected 0 snippets after delete, got %d", len(listAfter))
	}
}

