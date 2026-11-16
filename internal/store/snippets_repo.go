package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type QuerySnippet struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	SQLText     string `json:"sqlText"`
	Driver      string `json:"driver"`
	Tags        string `json:"tags"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

func (s *LocalStore) ListSnippets(ctx context.Context) ([]QuerySnippet, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, title, description, sql_text, driver, tags, created_at, updated_at
		FROM query_snippets
		ORDER BY updated_at DESC, title ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []QuerySnippet
	for rows.Next() {
		var sn QuerySnippet
		if err := rows.Scan(&sn.ID, &sn.Title, &sn.Description, &sn.SQLText, &sn.Driver, &sn.Tags, &sn.CreatedAt, &sn.UpdatedAt); err == nil {
			list = append(list, sn)
		}
	}
	if list == nil {
		list = []QuerySnippet{}
	}
	return list, nil
}

func (s *LocalStore) SaveSnippet(ctx context.Context, sn QuerySnippet) (string, error) {
	if sn.ID == "" {
		sn.ID = uuid.NewString()
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO query_snippets (id, title, description, sql_text, driver, tags, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			title = excluded.title,
			description = excluded.description,
			sql_text = excluded.sql_text,
			driver = excluded.driver,
			tags = excluded.tags,
			updated_at = excluded.updated_at
	`, sn.ID, sn.Title, sn.Description, sn.SQLText, sn.Driver, sn.Tags, now, now)
	if err != nil {
		return "", err
	}
	return sn.ID, nil
}

func (s *LocalStore) DeleteSnippet(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM query_snippets WHERE id = ?`, id)
	return err
}

