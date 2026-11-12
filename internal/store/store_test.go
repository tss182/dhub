package store

import (
	"context"
	"os"
	"testing"

	"dhub/internal/driver"
	_ "modernc.org/sqlite"
)

func setupTestStore(t *testing.T) (*LocalStore, func()) {
	t.Helper()
	tmpDir, err := os.MkdirTemp("", "dhub-store-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	t.Setenv("DHUB_CONFIG_DIR", tmpDir)

	s, err := NewLocalStore()
	if err != nil {
		os.RemoveAll(tmpDir)
		t.Fatalf("failed to create store: %v", err)
	}

	cleanup := func() {
		s.Close()
		os.RemoveAll(tmpDir)
	}
	return s, cleanup
}

func TestLocalStore_ConnectionsCRUD(t *testing.T) {
	st, cleanup := setupTestStore(t)
	defer cleanup()

	ctx := context.Background()

	// 1. Save connection
	conn := ConnectionConfig{
		ID:           "test-conn-1",
		Name:         "Dev Postgres",
		Driver:       "postgres",
		EnvType:      "dev",
		ColorTag:     "#3b82f6",
		Host:         "localhost",
		Port:         5432,
		Username:     "postgres",
		DatabaseName: "app_dev",
		IsReadOnly:   false,
	}

	savedID, err := st.SaveConnection(ctx, conn)
	if err != nil {
		t.Fatalf("SaveConnection failed: %v", err)
	}
	if savedID != conn.ID {
		t.Errorf("expected ID %q, got %q", conn.ID, savedID)
	}

	// 2. Get connection
	fetched, err := st.GetConnection(ctx, conn.ID)
	if err != nil {
		t.Fatalf("GetConnection failed: %v", err)
	}
	if fetched.Name != "Dev Postgres" || fetched.Port != 5432 {
		t.Errorf("fetched data mismatch: %+v", fetched)
	}

	// 3. List connections
	list, err := st.ListConnections(ctx)
	if err != nil {
		t.Fatalf("ListConnections failed: %v", err)
	}
	found := false
	for _, c := range list {
		if c.ID == conn.ID {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected connection %q to be in list", conn.ID)
	}

	// 4. Delete connection
	if err := st.DeleteConnection(ctx, conn.ID); err != nil {
		t.Fatalf("DeleteConnection failed: %v", err)
	}

	listAfter, _ := st.ListConnections(ctx)
	foundAfter := false
	for _, c := range listAfter {
		if c.ID == conn.ID {
			foundAfter = true
			break
		}
	}
	if foundAfter {
		t.Errorf("expected connection %q to be removed from list", conn.ID)
	}
}

func TestLocalStore_QueryHistory(t *testing.T) {
	st, cleanup := setupTestStore(t)
	defer cleanup()

	// 1. Record entries
	uniqueConnID := "conn-test-hist-unique"
	entry := QueryHistoryEntry{
		ConnectionID: uniqueConnID,
		DatabaseName: "app_db",
		SchemaName:   "public",
		SQLText:      "SELECT id, name FROM users WHERE active = true;",
		DurationMs:   42,
		RowsAffected: 150,
		Status:       "success",
	}

	if err := st.RecordQueryHistory(entry); err != nil {
		t.Fatalf("RecordQueryHistory failed: %v", err)
	}

	// 2. Get recent history
	hist, err := st.GetRecentHistory(uniqueConnID, 10)
	if err != nil {
		t.Fatalf("GetRecentHistory failed: %v", err)
	}
	if len(hist) != 1 {
		t.Fatalf("expected 1 history entry, got %d", len(hist))
	}
	if hist[0].RowsAffected != 150 || hist[0].DurationMs != 42 {
		t.Errorf("unexpected history fields: %+v", hist[0])
	}
}

func TestLocalStore_SchemaCache(t *testing.T) {
	st, cleanup := setupTestStore(t)
	defer cleanup()

	ctx := context.Background()

	cached := CachedObject{
		ConnectionID: "conn-1",
		DatabaseName: "app_db",
		SchemaName:   "public",
		ObjectType:   "table",
		ObjectName:   "customers",
		Columns: []driver.ColumnMeta{
			{Name: "id", DataType: "int", IsPrimaryKey: true},
			{Name: "email", DataType: "varchar(255)", IsNullable: false},
		},
		RowEstimate: 500,
	}

	if err := st.SaveSchemaCache(ctx, cached); err != nil {
		t.Fatalf("SaveSchemaCache failed: %v", err)
	}

	objects, err := st.GetCachedObjects(ctx, "conn-1", "app_db", "public")
	if err != nil {
		t.Fatalf("GetCachedObjects failed: %v", err)
	}
	if len(objects) != 1 {
		t.Fatalf("expected 1 cached object, got %d", len(objects))
	}
	if objects[0].ObjectName != "customers" || len(objects[0].Columns) != 2 {
		t.Errorf("unexpected cached object: %+v", objects[0])
	}

	// Search everywhere
	searchRes, err := st.SearchEverywhere(ctx, "conn-1", "custom", 5)
	if err != nil {
		t.Fatalf("SearchEverywhere failed: %v", err)
	}
	if len(searchRes) != 1 {
		t.Errorf("expected 1 search result, got %d", len(searchRes))
	}
}

func TestSearchEverywhere_Deduplication(t *testing.T) {
	st, cleanup := setupTestStore(t)
	defer cleanup()

	ctx := context.Background()

	// Insert duplicate entries for the same table with different schema variations
	// e.g. one with "" and one with "rnd_db" and one with "main"
	items := []CachedObject{
		{
			ConnectionID: "conn-mysql",
			DatabaseName: "rnd_db",
			SchemaName:   "",
			ObjectType:   "table",
			ObjectName:   "rnd_manufacture",
		},
		{
			ConnectionID: "conn-mysql",
			DatabaseName: "rnd_db",
			SchemaName:   "rnd_db",
			ObjectType:   "table",
			ObjectName:   "rnd_manufacture",
		},
		{
			ConnectionID: "conn-mysql",
			DatabaseName: "rnd_db",
			SchemaName:   "main",
			ObjectType:   "table",
			ObjectName:   "rnd_manufacture",
		},
	}

	for _, it := range items {
		if err := st.SaveSchemaCache(ctx, it); err != nil {
			t.Fatalf("SaveSchemaCache failed: %v", err)
		}
	}

	res, err := st.SearchEverywhere(ctx, "", "manufacture", 10)
	if err != nil {
		t.Fatalf("SearchEverywhere failed: %v", err)
	}

	if len(res) != 1 {
		t.Fatalf("expected exactly 1 deduplicated result, got %d", len(res))
	}
	if res[0].ObjectName != "rnd_manufacture" {
		t.Errorf("unexpected object name: %s", res[0].ObjectName)
	}
}
