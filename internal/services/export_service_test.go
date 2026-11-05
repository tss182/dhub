package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"dhub/internal/manager"
	"dhub/internal/store"
	_ "modernc.org/sqlite"
)

func TestExportService_PreviewImportFile(t *testing.T) {
	tmpDir := t.TempDir()
	csvPath := filepath.Join(tmpDir, "test.csv")
	content := "id,name,department\n1,Alice,Engineering\n2,Bob,Marketing\n3,Charlie,Product\n"
	if err := os.WriteFile(csvPath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write csv: %v", err)
	}

	svc := NewExportService(nil, nil, nil)
	preview, err := svc.PreviewImportFile(csvPath, ",", true)
	if err != nil {
		t.Fatalf("PreviewImportFile failed: %v", err)
	}

	if len(preview.Columns) != 3 {
		t.Fatalf("expected 3 columns, got %d", len(preview.Columns))
	}
	if preview.Columns[0] != "id" || preview.Columns[1] != "name" || preview.Columns[2] != "department" {
		t.Errorf("unexpected columns: %v", preview.Columns)
	}
	if len(preview.Rows) != 3 {
		t.Errorf("expected 3 rows, got %d", len(preview.Rows))
	}
}

func TestExportService_ExportAndImport(t *testing.T) {
	localStore, cleanup := setupTestStore(t)
	defer cleanup()

	tmpDir := t.TempDir()
	userDbPath := filepath.Join(tmpDir, "data.db")

	userDB, err := sql.Open("sqlite", userDbPath)
	if err != nil {
		t.Fatalf("failed to create user sqlite db: %v", err)
	}
	defer userDB.Close()

	_, err = userDB.Exec(`
		CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT, price REAL);
		INSERT INTO items (id, title, price) VALUES (1, 'Widget', 19.99), (2, 'Gadget', 29.50);
	`)
	if err != nil {
		t.Fatalf("failed to seed items: %v", err)
	}

	connID := "conn-test-export"
	_, err = localStore.SaveConnection(context.Background(), store.ConnectionConfig{
		ID:           connID,
		Name:         "Test SQLite",
		Driver:       "sqlite",
		FilePath:     userDbPath,
		DatabaseName: "main",
	})
	if err != nil {
		t.Fatalf("failed to save connection: %v", err)
	}

	sessionMgr := manager.NewSessionManager(localStore)
	svc := NewExportService(localStore, sessionMgr, nil)

	// 1. Test CSV Export
	csvExportPath := filepath.Join(tmpDir, "out.csv")
	resCSV, err := svc.ExportToFile(ExportRequest{
		ConnectionID:  connID,
		Database:      "main",
		Table:         "items",
		Format:        "csv",
		FilePath:      csvExportPath,
		Delimiter:     ",",
		IncludeHeader: true,
	})
	if err != nil {
		t.Fatalf("CSV export failed: %v", err)
	}
	if resCSV.RowsExported != 2 {
		t.Errorf("expected 2 rows exported, got %d", resCSV.RowsExported)
	}

	csvData, err := os.ReadFile(csvExportPath)
	if err != nil {
		t.Fatalf("failed to read exported csv: %v", err)
	}
	csvStr := string(csvData)
	if !strings.Contains(csvStr, "Widget") || !strings.Contains(csvStr, "Gadget") {
		t.Errorf("exported csv missing expected contents: %s", csvStr)
	}

	// 2. Test JSON Export
	jsonExportPath := filepath.Join(tmpDir, "out.json")
	resJSON, err := svc.ExportToFile(ExportRequest{
		ConnectionID: connID,
		Database:     "main",
		Table:        "items",
		Format:       "json",
		FilePath:     jsonExportPath,
	})
	if err != nil {
		t.Fatalf("JSON export failed: %v", err)
	}
	if resJSON.RowsExported != 2 {
		t.Errorf("expected 2 rows exported in JSON, got %d", resJSON.RowsExported)
	}

	jsonData, err := os.ReadFile(jsonExportPath)
	if err != nil {
		t.Fatalf("failed to read exported json: %v", err)
	}
	var parsedJSON []map[string]any
	if err := json.Unmarshal(jsonData, &parsedJSON); err != nil {
		t.Fatalf("exported json is invalid: %v", err)
	}
	if len(parsedJSON) != 2 {
		t.Errorf("expected 2 JSON objects, got %d", len(parsedJSON))
	}

	// 3. Test SQL Insert Export
	sqlExportPath := filepath.Join(tmpDir, "out.sql")
	resSQL, err := svc.ExportToFile(ExportRequest{
		ConnectionID: connID,
		Database:     "main",
		Table:        "items",
		Format:       "sql_insert",
		FilePath:     sqlExportPath,
	})
	if err != nil {
		t.Fatalf("SQL export failed: %v", err)
	}
	if resSQL.RowsExported != 2 {
		t.Errorf("expected 2 rows exported in SQL, got %d", resSQL.RowsExported)
	}

	sqlData, err := os.ReadFile(sqlExportPath)
	if err != nil {
		t.Fatalf("failed to read exported sql: %v", err)
	}
	sqlStr := string(sqlData)
	if (!strings.Contains(sqlStr, "INSERT INTO items") && !strings.Contains(sqlStr, `INSERT INTO "items"`)) || !strings.Contains(sqlStr, "Widget") {
		t.Errorf("exported sql missing expected contents: %s", sqlStr)
	}

	// 4. Test Import to new table
	_, err = userDB.Exec(`CREATE TABLE imported_items (item_id INTEGER, item_name TEXT);`)
	if err != nil {
		t.Fatalf("failed to create imported_items: %v", err)
	}

	importRes, err := svc.ImportFileToTable(ImportRequest{
		ConnectionID: connID,
		Database:     "main",
		Table:        "imported_items",
		FilePath:     csvExportPath,
		Format:       "csv",
		Delimiter:    ",",
		HasHeader:    true,
		Mappings: []ColumnMapping{
			{FileColumn: "id", TableColumn: "item_id"},
			{FileColumn: "title", TableColumn: "item_name"},
		},
	})
	if err != nil {
		t.Fatalf("ImportFileToTable failed: %v", err)
	}
	if importRes.RowsImported != 2 {
		t.Errorf("expected 2 rows imported, got %d", importRes.RowsImported)
	}

	var count int
	_ = userDB.QueryRow("SELECT COUNT(*) FROM imported_items").Scan(&count)
	if count != 2 {
		t.Errorf("expected 2 rows in imported_items, got %d", count)
	}
}
