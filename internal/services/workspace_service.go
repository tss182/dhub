package services

import (
	"context"
	"log"

	"dhub/internal/store"
)

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


