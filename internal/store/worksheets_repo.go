package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

type Worksheet struct {
	ID             string    `json:"id"`
	ConnectionID   string    `json:"connectionId"`
	Title          string    `json:"title"`
	Content        string    `json:"content"`
	TargetDatabase string    `json:"targetDatabase"`
	TargetSchema   string    `json:"targetSchema"`
	IsPinned       bool      `json:"isPinned"`
	CursorLine     int       `json:"cursorLine"`
	CursorCol      int       `json:"cursorCol"`
	SortOrder      int       `json:"sortOrder"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

func (s *LocalStore) ListWorksheets(ctx context.Context, connectionID string) ([]Worksheet, error) {
	query := `SELECT id, connection_id, title, content, target_database, target_schema, is_pinned, cursor_line, cursor_col, sort_order, updated_at
		FROM worksheets WHERE connection_id = ? ORDER BY is_pinned DESC, sort_order, updated_at DESC`
	rows, err := s.db.QueryContext(ctx, query, connectionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sheets []Worksheet
	for rows.Next() {
		var w Worksheet
		var pinned int
		if err := rows.Scan(&w.ID, &w.ConnectionID, &w.Title, &w.Content, &w.TargetDatabase, &w.TargetSchema, &pinned, &w.CursorLine, &w.CursorCol, &w.SortOrder, &w.UpdatedAt); err != nil {
			continue
		}
		w.IsPinned = pinned == 1
		sheets = append(sheets, w)
	}
	return sheets, nil
}

func (s *LocalStore) SaveWorksheet(ctx context.Context, w Worksheet) (string, error) {
	if w.ID == "" {
		w.ID = uuid.NewString()
	}

	query := `INSERT INTO worksheets (id, connection_id, title, content, target_database, target_schema, is_pinned, cursor_line, cursor_col, sort_order, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			title = excluded.title,
			content = excluded.content,
			target_database = excluded.target_database,
			target_schema = excluded.target_schema,
			is_pinned = excluded.is_pinned,
			cursor_line = excluded.cursor_line,
			cursor_col = excluded.cursor_col,
			sort_order = excluded.sort_order,
			updated_at = CURRENT_TIMESTAMP`

	pinned := 0
	if w.IsPinned {
		pinned = 1
	}

	_, err := s.db.ExecContext(ctx, query, w.ID, w.ConnectionID, w.Title, w.Content, w.TargetDatabase, w.TargetSchema, pinned, w.CursorLine, w.CursorCol, w.SortOrder)
	if err != nil {
		return "", err
	}
	return w.ID, nil
}

func (s *LocalStore) DeleteWorksheet(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM worksheets WHERE id = ?`, id)
	return err
}

func (s *LocalStore) GetWorksheet(ctx context.Context, id string) (*Worksheet, error) {
	query := `SELECT id, connection_id, title, content, target_database, target_schema, is_pinned, cursor_line, cursor_col, sort_order, updated_at
		FROM worksheets WHERE id = ?`
	var w Worksheet
	var pinned int
	err := s.db.QueryRowContext(ctx, query, id).Scan(&w.ID, &w.ConnectionID, &w.Title, &w.Content, &w.TargetDatabase, &w.TargetSchema, &pinned, &w.CursorLine, &w.CursorCol, &w.SortOrder, &w.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("worksheet not found")
		}
		return nil, err
	}
	w.IsPinned = pinned == 1
	return &w, nil
}

