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

