package store

import (
	"context"
	"database/sql"
	"encoding/json"
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

func (w *Worksheet) UnmarshalJSON(data []byte) error {
	type Alias Worksheet
	aux := &struct {
		UpdatedAt any `json:"updatedAt"`
		*Alias
	}{
		Alias: (*Alias)(w),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	switch v := aux.UpdatedAt.(type) {
	case string:
		if v == "" {
			w.UpdatedAt = time.Now()
		} else if t, err := time.Parse(time.RFC3339, v); err == nil {
			w.UpdatedAt = t
		} else if t2, err2 := time.Parse("2006-01-02 15:04:05", v); err2 == nil {
			w.UpdatedAt = t2
		} else {
			w.UpdatedAt = time.Now()
		}
	default:
		w.UpdatedAt = time.Now()
	}
	return nil
}

func (s *LocalStore) ListWorksheets(ctx context.Context, connectionID string) ([]Worksheet, error) {
	var query string
	var rows *sql.Rows
	var err error

	if connectionID == "" {
		query = `SELECT id, connection_id, title, content, target_database, target_schema, is_pinned, cursor_line, cursor_col, sort_order, updated_at
			FROM worksheets ORDER BY is_pinned DESC, sort_order, updated_at DESC`
		rows, err = s.db.QueryContext(ctx, query)
	} else {
		query = `SELECT id, connection_id, title, content, target_database, target_schema, is_pinned, cursor_line, cursor_col, sort_order, updated_at
			FROM worksheets WHERE connection_id = ? ORDER BY is_pinned DESC, sort_order, updated_at DESC`
		rows, err = s.db.QueryContext(ctx, query, connectionID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sheets []Worksheet
	for rows.Next() {
		var w Worksheet
		var connID sql.NullString
		var pinned int
		if err := rows.Scan(&w.ID, &connID, &w.Title, &w.Content, &w.TargetDatabase, &w.TargetSchema, &pinned, &w.CursorLine, &w.CursorCol, &w.SortOrder, &w.UpdatedAt); err != nil {
			continue
		}
		w.ConnectionID = connID.String
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
			connection_id = excluded.connection_id,
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

	var connID any
	if w.ConnectionID != "" {
		var exists int
		_ = s.db.QueryRowContext(ctx, "SELECT 1 FROM connections WHERE id = ?", w.ConnectionID).Scan(&exists)
		if exists == 1 {
			connID = w.ConnectionID
		} else {
			connID = nil
		}
	} else {
		connID = nil
	}

	_, err := s.db.ExecContext(ctx, query, w.ID, connID, w.Title, w.Content, w.TargetDatabase, w.TargetSchema, pinned, w.CursorLine, w.CursorCol, w.SortOrder)
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
	var connID sql.NullString
	var pinned int
	err := s.db.QueryRowContext(ctx, query, id).Scan(&w.ID, &connID, &w.Title, &w.Content, &w.TargetDatabase, &w.TargetSchema, &pinned, &w.CursorLine, &w.CursorCol, &w.SortOrder, &w.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("worksheet not found")
		}
		return nil, err
	}
	w.ConnectionID = connID.String
	w.IsPinned = pinned == 1
	return &w, nil
}

