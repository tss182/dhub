package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"dhub/internal/store"
	"dhub/internal/version"

	"github.com/google/uuid"
)

type ConfigExportData struct {
	Version     string                   `json:"version"`
	ExportedAt  string                   `json:"exportedAt"`
	App         string                   `json:"app"`
	AppVersion  string                   `json:"appVersion"`
	Preferences map[string]any           `json:"preferences,omitempty"`
	Settings    map[string]string        `json:"settings"`
	Folders     []store.ConnectionFolder `json:"folders,omitempty"`
	Connections []store.ConnectionConfig `json:"connections,omitempty"`
}

type ConfigImportSummary struct {
	SettingsCount    int      `json:"settingsCount"`
	ConnectionsCount int      `json:"connectionsCount"`
	FoldersCount     int      `json:"foldersCount"`
	ConnectionNames  []string `json:"connectionNames"`
}

type ConfigImportOptions struct {
	ImportSettings    bool   `json:"importSettings"`
	ImportConnections bool   `json:"importConnections"`
	ConflictStrategy  string `json:"conflictStrategy"` // "skip" | "overwrite" | "duplicate"
}

type ConfigImportResult struct {
	Success             bool     `json:"success"`
	SettingsImported    int      `json:"settingsImported"`
	ConnectionsImported int      `json:"connectionsImported"`
	FoldersImported     int      `json:"foldersImported"`
	Errors              []string `json:"errors,omitempty"`
}

type WorkspaceService struct {
	store *store.LocalStore
}

func NewWorkspaceService(s *store.LocalStore) *WorkspaceService {
	return &WorkspaceService{store: s}
}

func (w *WorkspaceService) ListWorksheets(connectionID string) ([]store.Worksheet, error) {
	list, err := w.store.ListWorksheets(context.Background(), connectionID)
	if err != nil {
		log.Printf("[WorkspaceService] ListWorksheets error: %v", err)
	}
	return list, err
}

func (w *WorkspaceService) GetWorksheet(id string) (*store.Worksheet, error) {
	return w.store.GetWorksheet(context.Background(), id)
}

func (w *WorkspaceService) SaveWorksheet(ws store.Worksheet) (string, error) {
	id, err := w.store.SaveWorksheet(context.Background(), ws)
	if err != nil {
		log.Printf("[WorkspaceService] SaveWorksheet error: %v", err)
	}
	return id, err
}

func (w *WorkspaceService) DeleteWorksheet(id string) error {
	err := w.store.DeleteWorksheet(context.Background(), id)
	if err != nil {
		log.Printf("[WorkspaceService] DeleteWorksheet error: %v", err)
	}
	return err
}

func (w *WorkspaceService) GetQueryHistory(connectionID string, limit int) ([]store.QueryHistoryEntry, error) {
	return w.store.GetRecentHistory(connectionID, limit)
}

func (w *WorkspaceService) GetSettings() (map[string]string, error) {
	return w.store.GetSettings()
}

func (w *WorkspaceService) SaveSetting(key string, value string) error {
	return w.store.SaveSetting(key, value)
}

func (w *WorkspaceService) ExportConfig(includeConnections bool, includePasswords bool) (string, error) {
	ctx := context.Background()

	settings, err := w.store.GetSettings()
	if err != nil {
		return "", fmt.Errorf("failed to retrieve settings: %w", err)
	}

	exportData := ConfigExportData{
		Version:     "1.0",
		ExportedAt:  time.Now().UTC().Format(time.RFC3339),
		App:         "DHub",
		AppVersion:  version.CurrentVersion,
		Settings:    settings,
		Folders:     make([]store.ConnectionFolder, 0),
		Connections: make([]store.ConnectionConfig, 0),
	}

	// Provide readable preferences if dhub_settings_v1 exists
	if rawPref, ok := settings["dhub_settings_v1"]; ok {
		var prefMap map[string]any
		if err := json.Unmarshal([]byte(rawPref), &prefMap); err == nil {
			exportData.Preferences = prefMap
		}
	}

	if includeConnections {
		folders, err := w.store.ListFolders(ctx)
		if err == nil && folders != nil {
			exportData.Folders = folders
		}

		conns, err := w.store.ListConnections(ctx)
		if err == nil && conns != nil {
			if includePasswords {
				for i, c := range conns {
					fullConn, err := w.store.GetConnection(ctx, c.ID)
					if err == nil && fullConn != nil {
						conns[i].Password = fullConn.Password
						conns[i].SSHPassword = fullConn.SSHPassword
					}
				}
			} else {
				for i := range conns {
					conns[i].Password = ""
					conns[i].SSHPassword = ""
				}
			}
			exportData.Connections = conns
		}
	}

	bytes, err := json.MarshalIndent(exportData, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to encode config JSON: %w", err)
	}

	return string(bytes), nil
}

func (w *WorkspaceService) SaveConfigFile(filePath string, content string) error {
	if filePath == "" {
		return errors.New("file path cannot be empty")
	}
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}
	return os.WriteFile(filePath, []byte(content), 0644)
}

func (w *WorkspaceService) ReadConfigFile(filePath string) (string, error) {
	if filePath == "" {
		return "", errors.New("file path cannot be empty")
	}
	bytes, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read file: %w", err)
	}
	return string(bytes), nil
}

func (w *WorkspaceService) ValidateConfigFile(jsonContent string) (*ConfigImportSummary, error) {
	if strings.TrimSpace(jsonContent) == "" {
		return nil, errors.New("file content is empty")
	}

	var rawMap map[string]json.RawMessage
	if err := json.Unmarshal([]byte(jsonContent), &rawMap); err != nil {
		return nil, fmt.Errorf("invalid JSON format: %w", err)
	}

	summary := &ConfigImportSummary{
		ConnectionNames: make([]string, 0),
	}

	// 1. Settings
	if rawSettings, ok := rawMap["settings"]; ok {
		var settingsMap map[string]string
		if err := json.Unmarshal(rawSettings, &settingsMap); err == nil {
			summary.SettingsCount = len(settingsMap)
		}
	} else if rawMap["theme"] != nil || rawMap["dataViewMode"] != nil || rawMap["editorFontSize"] != nil {
		summary.SettingsCount = 1
	}

	if summary.SettingsCount == 0 && rawMap["preferences"] != nil {
		summary.SettingsCount = 1
	}

	// 2. Folders
	if rawFolders, ok := rawMap["folders"]; ok {
		var folders []store.ConnectionFolder
		if err := json.Unmarshal(rawFolders, &folders); err == nil {
			summary.FoldersCount = len(folders)
		}
	}

	// 3. Connections
	if rawConns, ok := rawMap["connections"]; ok {
		var conns []store.ConnectionConfig
		if err := json.Unmarshal(rawConns, &conns); err == nil {
			summary.ConnectionsCount = len(conns)
			for _, c := range conns {
				if c.Name != "" {
					summary.ConnectionNames = append(summary.ConnectionNames, c.Name)
				}
			}
		}
	}

	if summary.SettingsCount == 0 && summary.ConnectionsCount == 0 && summary.FoldersCount == 0 {
		return nil, errors.New("no valid settings, connections, or folders found in config")
	}

	return summary, nil
}

func (w *WorkspaceService) ImportConfig(jsonContent string, opts ConfigImportOptions) (*ConfigImportResult, error) {
	if strings.TrimSpace(jsonContent) == "" {
		return nil, errors.New("config content is empty")
	}

	var rawMap map[string]json.RawMessage
	if err := json.Unmarshal([]byte(jsonContent), &rawMap); err != nil {
		return nil, fmt.Errorf("invalid JSON format: %w", err)
	}

	result := &ConfigImportResult{
		Success: true,
		Errors:  make([]string, 0),
	}

	ctx := context.Background()

	// 1. Import Settings
	if opts.ImportSettings {
		settingsToSave := make(map[string]string)

		if rawSettings, ok := rawMap["settings"]; ok {
			_ = json.Unmarshal(rawSettings, &settingsToSave)
		}

		if len(settingsToSave) == 0 {
			if rawPref, ok := rawMap["preferences"]; ok {
				settingsToSave["dhub_settings_v1"] = string(rawPref)
			}
		}

		if len(settingsToSave) == 0 && (rawMap["theme"] != nil || rawMap["dataViewMode"] != nil || rawMap["editorFontSize"] != nil) {
			settingsToSave["dhub_settings_v1"] = jsonContent
		}

		for k, v := range settingsToSave {
			if err := w.store.SaveSetting(k, v); err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("Failed to save setting %s: %v", k, err))
			} else {
				result.SettingsImported++
			}
		}
	}

	// 2. Import Connections & Folders
	if opts.ImportConnections {
		folderIDMapping := make(map[string]string) // old ID -> new/existing ID

		// Folders
		if rawFolders, ok := rawMap["folders"]; ok {
			var folders []store.ConnectionFolder
			if err := json.Unmarshal(rawFolders, &folders); err == nil {
				existingFolders, _ := w.store.ListFolders(ctx)
				existingByName := make(map[string]store.ConnectionFolder)
				existingByID := make(map[string]store.ConnectionFolder)
				for _, f := range existingFolders {
					existingByName[f.Name] = f
					existingByID[f.ID] = f
				}

				for _, f := range folders {
					oldID := f.ID
					if existing, exists := existingByName[f.Name]; exists {
						folderIDMapping[oldID] = existing.ID
						continue
					}
					if _, exists := existingByID[f.ID]; exists {
						f.ID = uuid.NewString()
					}
					if f.ID == "" {
						f.ID = uuid.NewString()
					}
					savedID, err := w.store.SaveFolder(ctx, f)
					if err != nil {
						result.Errors = append(result.Errors, fmt.Sprintf("Failed to save folder %s: %v", f.Name, err))
					} else {
						folderIDMapping[oldID] = savedID
						result.FoldersImported++
					}
				}
			}
		}

		// Connections
		if rawConns, ok := rawMap["connections"]; ok {
			var conns []store.ConnectionConfig
			if err := json.Unmarshal(rawConns, &conns); err == nil {
				existingConns, _ := w.store.ListConnections(ctx)
				existingByName := make(map[string]store.ConnectionConfig)
				existingByID := make(map[string]store.ConnectionConfig)
				for _, c := range existingConns {
					existingByName[c.Name] = c
					existingByID[c.ID] = c
				}

				for _, c := range conns {
					// Remap folder ID if applicable
					if c.FolderID != nil && *c.FolderID != "" {
						if mappedID, ok := folderIDMapping[*c.FolderID]; ok {
							c.FolderID = &mappedID
						}
					}

					existingByNameConn, nameExists := existingByName[c.Name]
					_, idExists := existingByID[c.ID]

					if opts.ConflictStrategy == "skip" && (nameExists || idExists) {
						continue
					}

					if opts.ConflictStrategy == "overwrite" && nameExists {
						c.ID = existingByNameConn.ID
					} else if opts.ConflictStrategy == "duplicate" || idExists {
						c.ID = uuid.NewString()
						if nameExists {
							c.Name = c.Name + " (imported)"
						}
					}

					if c.ID == "" {
						c.ID = uuid.NewString()
					}

					_, err := w.store.SaveConnection(ctx, c)
					if err != nil {
						result.Errors = append(result.Errors, fmt.Sprintf("Failed to save connection %s: %v", c.Name, err))
					} else {
						result.ConnectionsImported++
					}
				}
			}
		}
	}

	if len(result.Errors) > 0 && result.SettingsImported == 0 && result.ConnectionsImported == 0 && result.FoldersImported == 0 {
		result.Success = false
	}

	return result, nil
}

func (w *WorkspaceService) ListWorkspaces() ([]store.WorkspaceSnapshot, error) {
	return w.store.ListWorkspaces(context.Background())
}

func (w *WorkspaceService) GetWorkspace(id string) (*store.WorkspaceSnapshot, error) {
	return w.store.GetWorkspace(context.Background(), id)
}

func (w *WorkspaceService) SaveWorkspace(ws store.WorkspaceSnapshot) (string, error) {
	return w.store.SaveWorkspace(context.Background(), ws)
}

func (w *WorkspaceService) RenameWorkspace(id, newName string) error {
	return w.store.RenameWorkspace(context.Background(), id, newName)
}

func (w *WorkspaceService) SetActiveWorkspace(id string) error {
	return w.store.SetActiveWorkspace(context.Background(), id)
}

func (w *WorkspaceService) DeleteWorkspace(id string) error {
	return w.store.DeleteWorkspace(context.Background(), id)
}



