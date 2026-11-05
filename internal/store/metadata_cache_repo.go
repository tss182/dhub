package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"dhub/internal/driver"
)

type CachedObject struct {
	ConnectionID string                `json:"connectionId"`
	DatabaseName string                `json:"databaseName"`
	SchemaName   string                `json:"schemaName"`
	ObjectType   string                `json:"objectType"`
	ObjectName   string                `json:"objectName"`
	Columns      []driver.ColumnMeta   `json:"columns"`
	Indexes      []driver.IndexMeta    `json:"indexes"`
	ForeignKeys  []driver.ForeignKeyMeta `json:"foreignKeys"`
	RowEstimate  int64                 `json:"rowEstimate"`
	SyncedAt     time.Time             `json:"syncedAt"`
}

func (s *LocalStore) SaveSchemaCache(ctx context.Context, item CachedObject) error {
	colJSON, _ := json.Marshal(item.Columns)
	idxJSON, _ := json.Marshal(item.Indexes)
	fkJSON, _ := json.Marshal(item.ForeignKeys)

	query := `INSERT INTO schema_cache (
		connection_id, database_name, schema_name, object_type, object_name,
		columns_json, indexes_json, foreign_keys_json, row_estimate, synced_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	ON CONFLICT(connection_id, database_name, schema_name, object_type, object_name) DO UPDATE SET
		columns_json = CASE
			WHEN excluded.columns_json != 'null' AND excluded.columns_json != '[]' THEN excluded.columns_json
			ELSE schema_cache.columns_json
		END,
		indexes_json = CASE
			WHEN excluded.indexes_json != 'null' AND excluded.indexes_json != '[]' THEN excluded.indexes_json
			ELSE schema_cache.indexes_json
		END,
		foreign_keys_json = CASE
			WHEN excluded.foreign_keys_json != 'null' AND excluded.foreign_keys_json != '[]' THEN excluded.foreign_keys_json
			ELSE schema_cache.foreign_keys_json
		END,
		row_estimate = CASE
			WHEN excluded.row_estimate > 0 THEN excluded.row_estimate
			ELSE schema_cache.row_estimate
		END,
		synced_at = CURRENT_TIMESTAMP`

	_, err := s.db.ExecContext(ctx, query,
		item.ConnectionID, item.DatabaseName, item.SchemaName, item.ObjectType, item.ObjectName,
		string(colJSON), string(idxJSON), string(fkJSON), item.RowEstimate,
	)
	return err
}

func (s *LocalStore) SaveSchemaCacheBatch(ctx context.Context, items []CachedObject) error {
	if len(items) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	query := `INSERT INTO schema_cache (
		connection_id, database_name, schema_name, object_type, object_name,
		columns_json, indexes_json, foreign_keys_json, row_estimate, synced_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	ON CONFLICT(connection_id, database_name, schema_name, object_type, object_name) DO UPDATE SET
		columns_json = CASE
			WHEN excluded.columns_json != 'null' AND excluded.columns_json != '[]' THEN excluded.columns_json
			ELSE schema_cache.columns_json
		END,
		indexes_json = CASE
			WHEN excluded.indexes_json != 'null' AND excluded.indexes_json != '[]' THEN excluded.indexes_json
			ELSE schema_cache.indexes_json
		END,
		foreign_keys_json = CASE
			WHEN excluded.foreign_keys_json != 'null' AND excluded.foreign_keys_json != '[]' THEN excluded.foreign_keys_json
			ELSE schema_cache.foreign_keys_json
		END,
		row_estimate = CASE
			WHEN excluded.row_estimate > 0 THEN excluded.row_estimate
			ELSE schema_cache.row_estimate
		END,
		synced_at = CURRENT_TIMESTAMP`

	stmt, err := tx.PrepareContext(ctx, query)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, item := range items {
		colJSON, _ := json.Marshal(item.Columns)
		idxJSON, _ := json.Marshal(item.Indexes)
		fkJSON, _ := json.Marshal(item.ForeignKeys)

		if _, err := stmt.ExecContext(ctx,
			item.ConnectionID, item.DatabaseName, item.SchemaName, item.ObjectType, item.ObjectName,
			string(colJSON), string(idxJSON), string(fkJSON), item.RowEstimate,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *LocalStore) GetCachedObjects(ctx context.Context, connectionID, databaseName, schemaName string) ([]CachedObject, error) {
	query := `SELECT connection_id, database_name, schema_name, object_type, object_name, columns_json, indexes_json, foreign_keys_json, row_estimate, synced_at
		FROM schema_cache WHERE connection_id = ? AND database_name = ? AND schema_name = ?
		ORDER BY object_type, object_name`

	rows, err := s.db.QueryContext(ctx, query, connectionID, databaseName, schemaName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var objects []CachedObject
	for rows.Next() {
		var o CachedObject
		var colJSON, idxJSON, fkJSON string
		if err := rows.Scan(&o.ConnectionID, &o.DatabaseName, &o.SchemaName, &o.ObjectType, &o.ObjectName, &colJSON, &idxJSON, &fkJSON, &o.RowEstimate, &o.SyncedAt); err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(colJSON), &o.Columns)
		_ = json.Unmarshal([]byte(idxJSON), &o.Indexes)
		_ = json.Unmarshal([]byte(fkJSON), &o.ForeignKeys)
		if o.Columns == nil {
			o.Columns = []driver.ColumnMeta{}
		}
		if o.Indexes == nil {
			o.Indexes = []driver.IndexMeta{}
		}
		if o.ForeignKeys == nil {
			o.ForeignKeys = []driver.ForeignKeyMeta{}
		}
		objects = append(objects, o)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return objects, nil
}

func (s *LocalStore) SearchEverywhere(ctx context.Context, connectionID, queryStr string, limit int) ([]CachedObject, error) {
	if limit <= 0 {
		limit = 50
	}
	likeQuery := "%" + queryStr + "%"
	var rows *sql.Rows
	var err error

	if connectionID != "" {
		query := `SELECT connection_id, database_name, schema_name, object_type, object_name, columns_json, indexes_json, foreign_keys_json, row_estimate, synced_at
			FROM schema_cache WHERE connection_id = ? AND (object_name LIKE ? OR columns_json LIKE ?)
			ORDER BY object_name ASC LIMIT ?`
		rows, err = s.db.QueryContext(ctx, query, connectionID, likeQuery, likeQuery, limit)
	} else {
		query := `SELECT connection_id, database_name, schema_name, object_type, object_name, columns_json, indexes_json, foreign_keys_json, row_estimate, synced_at
			FROM schema_cache WHERE (object_name LIKE ? OR columns_json LIKE ?)
			ORDER BY object_name ASC LIMIT ?`
		rows, err = s.db.QueryContext(ctx, query, likeQuery, likeQuery, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var objects []CachedObject
	for rows.Next() {
		var o CachedObject
		var colJSON, idxJSON, fkJSON string
		if err := rows.Scan(&o.ConnectionID, &o.DatabaseName, &o.SchemaName, &o.ObjectType, &o.ObjectName, &colJSON, &idxJSON, &fkJSON, &o.RowEstimate, &o.SyncedAt); err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(colJSON), &o.Columns)
		_ = json.Unmarshal([]byte(idxJSON), &o.Indexes)
		_ = json.Unmarshal([]byte(fkJSON), &o.ForeignKeys)
		if o.Columns == nil {
			o.Columns = []driver.ColumnMeta{}
		}
		if o.Indexes == nil {
			o.Indexes = []driver.IndexMeta{}
		}
		if o.ForeignKeys == nil {
			o.ForeignKeys = []driver.ForeignKeyMeta{}
		}
		objects = append(objects, o)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return objects, nil
}

