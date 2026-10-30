package services

import (
	"context"

	"dhub/internal/app"
	"dhub/internal/manager"
	"dhub/internal/store"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type ConnectionService struct {
	store     *store.LocalStore
	sessions  *manager.SessionManager
	appGetter func() *application.App
}

func NewConnectionService(s *store.LocalStore, sm *manager.SessionManager, appGetter func() *application.App) *ConnectionService {
	return &ConnectionService{
		store:     s,
		sessions:  sm,
		appGetter: appGetter,
	}
}

func (s *ConnectionService) ListConnections() ([]store.ConnectionConfig, error) {
	return s.store.ListConnections(context.Background())
}

func (s *ConnectionService) GetConnection(id string) (*store.ConnectionConfig, error) {
	return s.store.GetConnection(context.Background(), id)
}

func (s *ConnectionService) SaveConnection(cfg store.ConnectionConfig) (string, error) {
	id, err := s.store.SaveConnection(context.Background(), cfg)
	if err != nil {
		return "", err
	}
	return id, nil
}

func (s *ConnectionService) DeleteConnection(id string) error {
	s.sessions.Disconnect(id)
	return s.store.DeleteConnection(context.Background(), id)
}

func (s *ConnectionService) TestConnection(cfg store.ConnectionConfig) (string, error) {
	err := s.sessions.TestConnection(context.Background(), cfg)
	if err != nil {
		return "", err
	}
	return "Connection successful!", nil
}

func (s *ConnectionService) Connect(id string) (string, error) {
	_, err := s.sessions.GetOrConnect(context.Background(), id)
	if err != nil {
		s.emitState(id, "error", err.Error())
		return "", err
	}
	s.emitState(id, "connected", "")
	return "Connected", nil
}

func (s *ConnectionService) Disconnect(id string) error {
	s.sessions.Disconnect(id)
	s.emitState(id, "disconnected", "")
	return nil
}

func (s *ConnectionService) emitState(id, status, errMsg string) {
	if a := s.appGetter(); a != nil {
		a.Event.Emit("connection:state", app.ConnectionStateEvent{
			ConnectionID: id,
			Status:       status,
			Error:        errMsg,
		})
	}
}
