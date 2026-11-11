package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

type WorkspaceSnapshot struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Icon        string    `json:"icon"`
	ColorTag    string    `json:"colorTag"`
	IsActive    bool      `json:"isActive"`
	TabsJSON    string    `json:"tabsJson"`
	ActiveTabID string    `json:"activeTabId"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func (s *LocalStore) ListWorkspaces(ctx context.Context) ([]WorkspaceSnapshot, error) {
	query := `SELECT id, name, description, icon, color_tag, is_active, tabs_json, active_tab_id, created_at, updated_at
		FROM workspaces ORDER BY updated_at DESC`

	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []WorkspaceSnapshot
	for rows.Next() {
		var ws WorkspaceSnapshot
		var isActiveInt int
		if err := rows.Scan(
			&ws.ID,
			&ws.Name,
			&ws.Description,
			&ws.Icon,
			&ws.ColorTag,
			&isActiveInt,
			&ws.TabsJSON,
			&ws.ActiveTabID,
			&ws.CreatedAt,
			&ws.UpdatedAt,
		); err != nil {
			continue
		}
		ws.IsActive = isActiveInt == 1
		list = append(list, ws)
	}
	return list, nil
}

func (s *LocalStore) GetWorkspace(ctx context.Context, id string) (*WorkspaceSnapshot, error) {
	query := `SELECT id, name, description, icon, color_tag, is_active, tabs_json, active_tab_id, created_at, updated_at
		FROM workspaces WHERE id = ?`

	var ws WorkspaceSnapshot
	var isActiveInt int
	err := s.db.QueryRowContext(ctx, query, id).Scan(
		&ws.ID,
		&ws.Name,
		&ws.Description,
		&ws.Icon,
		&ws.ColorTag,
		&isActiveInt,
		&ws.TabsJSON,
		&ws.ActiveTabID,
		&ws.CreatedAt,
		&ws.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("workspace not found")
		}
		return nil, err
	}
	ws.IsActive = isActiveInt == 1
	return &ws, nil
}

func (s *LocalStore) SaveWorkspace(ctx context.Context, ws WorkspaceSnapshot) (string, error) {
	if ws.ID == "" {
		ws.ID = uuid.NewString()
	}
	if ws.Name == "" {
		ws.Name = "Workspace"
	}
	if ws.Icon == "" {
		ws.Icon = "briefcase"
	}
	if ws.ColorTag == "" {
		ws.ColorTag = "#3b82f6"
	}
	if ws.TabsJSON == "" {
		ws.TabsJSON = "[]"
	}

	isActiveInt := 0
	if ws.IsActive {
		isActiveInt = 1
		// Deactivate others if this is active
		_, _ = s.db.ExecContext(ctx, `UPDATE workspaces SET is_active = 0 WHERE id != ?`, ws.ID)
	}

	query := `INSERT INTO workspaces (id, name, description, icon, color_tag, is_active, tabs_json, active_tab_id, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			description = excluded.description,
			icon = excluded.icon,
			color_tag = excluded.color_tag,
			is_active = excluded.is_active,
			tabs_json = excluded.tabs_json,
			active_tab_id = excluded.active_tab_id,
			updated_at = CURRENT_TIMESTAMP`

	_, err := s.db.ExecContext(ctx, query, ws.ID, ws.Name, ws.Description, ws.Icon, ws.ColorTag, isActiveInt, ws.TabsJSON, ws.ActiveTabID)
	if err != nil {
		return "", err
	}
	return ws.ID, nil
}

func (s *LocalStore) RenameWorkspace(ctx context.Context, id, newName string) error {
	query := `UPDATE workspaces SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
	_, err := s.db.ExecContext(ctx, query, newName, id)
	return err
}

func (s *LocalStore) SetActiveWorkspace(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `UPDATE workspaces SET is_active = 0`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE workspaces SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, id); err != nil {
		return err
	}

	return tx.Commit()
}

func (s *LocalStore) DeleteWorkspace(ctx context.Context, id string) error {
	query := `DELETE FROM workspaces WHERE id = ?`
	_, err := s.db.ExecContext(ctx, query, id)
	return err
}

