package services_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"dhub/internal/services"
	"dhub/internal/store"
)

func TestWorkspaceService_ExportAndImportConfig(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "dhub_test_workspace_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbPath := filepath.Join(tmpDir, "test_dhub.db")
	st, err := store.NewLocalStoreWithPath(dbPath)
	if err != nil {
		t.Fatalf("failed to create local store: %v", err)
	}
	defer st.Close()

	wsSvc := services.NewWorkspaceService(st)

	// 1. Setup initial settings & connections
	err = wsSvc.SaveSetting("dhub_settings_v1", `{"theme":"dark","defaultPageSize":150,"editorFontSize":14}`)
	if err != nil {
		t.Fatalf("failed to save setting: %v", err)
	}

	folderID, err := st.SaveFolder(t.Context(), store.ConnectionFolder{
		Name:  "Test Folder",
		Color: "#3b82f6",
	})
	if err != nil {
		t.Fatalf("failed to save folder: %v", err)
	}

	connID, err := st.SaveConnection(t.Context(), store.ConnectionConfig{
		FolderID:     &folderID,
		Name:         "Postgres Dev",
		Driver:       "postgres",
		Host:         "localhost",
		Port:         5432,
		Username:     "postgres",
		Password:     "secret123",
		DatabaseName: "testdb",
	})
	if err != nil {
		t.Fatalf("failed to save connection: %v", err)
	}

	// 2. Export Config (without passwords)
	exportStr, err := wsSvc.ExportConfig(true, false)
	if err != nil {
		t.Fatalf("ExportConfig failed: %v", err)
	}

	var exportData services.ConfigExportData
	if err := json.Unmarshal([]byte(exportStr), &exportData); err != nil {
		t.Fatalf("invalid export JSON: %v", err)
	}

	if exportData.Settings["dhub_settings_v1"] == "" {
		t.Errorf("expected dhub_settings_v1 to be in export settings")
	}
	if len(exportData.Connections) != 1 {
		t.Fatalf("expected 1 connection in export, got %d", len(exportData.Connections))
	}
	if exportData.Connections[0].Password != "" {
		t.Errorf("expected empty password when includePasswords is false, got %s", exportData.Connections[0].Password)
	}

	// 3. Export Config (with passwords)
	exportStrWithPass, err := wsSvc.ExportConfig(true, true)
	if err != nil {
		t.Fatalf("ExportConfig with pass failed: %v", err)
	}
	var exportDataWithPass services.ConfigExportData
	if err := json.Unmarshal([]byte(exportStrWithPass), &exportDataWithPass); err != nil {
		t.Fatalf("invalid export JSON: %v", err)
	}
	if exportDataWithPass.Connections[0].Password != "secret123" {
		t.Errorf("expected password secret123, got %s", exportDataWithPass.Connections[0].Password)
	}

	// 4. Save and Read Config file
	filePath := filepath.Join(tmpDir, "sub", "config.json")
	if err := wsSvc.SaveConfigFile(filePath, exportStr); err != nil {
		t.Fatalf("SaveConfigFile failed: %v", err)
	}
	readContent, err := wsSvc.ReadConfigFile(filePath)
	if err != nil {
		t.Fatalf("ReadConfigFile failed: %v", err)
	}
	if readContent != exportStr {
		t.Errorf("read content does not match saved content")
	}

	// 5. Validate config file
	summary, err := wsSvc.ValidateConfigFile(exportStr)
	if err != nil {
		t.Fatalf("ValidateConfigFile failed: %v", err)
	}
	if summary.ConnectionsCount != 1 || summary.FoldersCount != 1 || summary.SettingsCount < 1 {
		t.Errorf("unexpected summary counts: %+v", summary)
	}

	// 6. Test Import into new clean store
	dbPath2 := filepath.Join(tmpDir, "test_dhub2.db")
	st2, err := store.NewLocalStoreWithPath(dbPath2)
	if err != nil {
		t.Fatalf("failed to create second store: %v", err)
	}
	defer st2.Close()
	wsSvc2 := services.NewWorkspaceService(st2)

	importRes, err := wsSvc2.ImportConfig(exportStrWithPass, services.ConfigImportOptions{
		ImportSettings:    true,
		ImportConnections: true,
		ConflictStrategy:  "overwrite",
	})
	if err != nil {
		t.Fatalf("ImportConfig failed: %v", err)
	}
	if !importRes.Success {
		t.Fatalf("import failed: %+v", importRes.Errors)
	}
	if importRes.ConnectionsImported != 1 || importRes.FoldersImported != 1 || importRes.SettingsImported < 1 {
		t.Errorf("unexpected import result: %+v", importRes)
	}

	// Verify imported data in store 2
	settings2, _ := wsSvc2.GetSettings()
	if settings2["dhub_settings_v1"] != `{"theme":"dark","defaultPageSize":150,"editorFontSize":14}` {
		t.Errorf("settings mismatch: %s", settings2["dhub_settings_v1"])
	}

	conns2, _ := st2.ListConnections(t.Context())
	if len(conns2) != 1 {
		t.Fatalf("expected 1 connection in store 2, got %d", len(conns2))
	}
	fullConn2, err := st2.GetConnection(t.Context(), conns2[0].ID)
	if err != nil {
		t.Fatalf("failed to get imported connection: %v", err)
	}
	if fullConn2.Password != "secret123" {
		t.Errorf("expected imported password to be secret123, got %s", fullConn2.Password)
	}

	// Test conflict strategy "duplicate"
	dupRes, err := wsSvc2.ImportConfig(exportStrWithPass, services.ConfigImportOptions{
		ImportSettings:    false,
		ImportConnections: true,
		ConflictStrategy:  "duplicate",
	})
	if err != nil {
		t.Fatalf("ImportConfig duplicate failed: %v", err)
	}
	if dupRes.ConnectionsImported != 1 {
		t.Errorf("expected 1 duplicated connection, got %d", dupRes.ConnectionsImported)
	}
	connsAfterDup, _ := st2.ListConnections(t.Context())
	if len(connsAfterDup) != 2 {
		t.Errorf("expected 2 connections after duplication, got %d", len(connsAfterDup))
	}

	_ = connID
}

