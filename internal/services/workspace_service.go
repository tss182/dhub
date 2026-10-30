package services

import (
	"context"

	"dhub/internal/store"
)

type WorkspaceService struct {
	store *store.LocalStore
}

func NewWorkspaceService(s *store.LocalStore) *WorkspaceService {
	return &WorkspaceService{store: s}
}

func (w *WorkspaceService) ListWorksheets(connectionID string) ([]store.Worksheet, error) {
	return w.store.ListWorksheets(context.Background(), connectionID)
}

func (w *WorkspaceService) GetWorksheet(id string) (*store.Worksheet, error) {
	return w.store.GetWorksheet(context.Background(), id)
}

func (w *WorkspaceService) SaveWorksheet(ws store.Worksheet) (string, error) {
	return w.store.SaveWorksheet(context.Background(), ws)
}

func (w *WorkspaceService) DeleteWorksheet(id string) error {
	return w.store.DeleteWorksheet(context.Background(), id)
}

func (w *WorkspaceService) GetQueryHistory(connectionID string, limit int) ([]store.QueryHistoryEntry, error) {
	return w.store.GetRecentHistory(connectionID, limit)
}

