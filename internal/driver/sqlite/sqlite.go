package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"dhub/internal/driver"
	_ "modernc.org/sqlite"
)

type SQLiteDriver struct {
	db       *sql.DB
	filePath string
}

func NewSQLiteDriver(filePath string) (*SQLiteDriver, error) {
	db, err := sql.Open("sqlite", filePath)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return &SQLiteDriver{db: db, filePath: filePath}, nil
}

func (s *SQLiteDriver) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

func (s *SQLiteDriver) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

func (s *SQLiteDriver) ListDatabases(ctx context.Context) ([]string, error) {
	return []string{"main"}, nil
}

func (s *SQLiteDriver) ListSchemas(ctx context.Context, database string) ([]string, error) {
	return []string{"main"}, nil
}

func (s *SQLiteDriver) ListObjects(ctx context.Context, database, schema string) ([]driver.ObjectSummary, error) {
	query := `SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name`
	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var objects []driver.ObjectSummary
	for rows.Next() {
		var name, objType string
		if err := rows.Scan(&name, &objType); err != nil {
			continue
		}
		objects = append(objects, driver.ObjectSummary{
			Schema:      "main",
			Name:        name,
			Type:        objType,
			RowEstimate: -1,
		})
	}
	return objects, nil
}

func (s *SQLiteDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	structure := &driver.TableStructure{
		Schema:      "main",
		Name:        table,
		Columns:     []driver.ColumnMeta{},
		PrimaryKeys: []string{},
		ForeignKeys: []driver.ForeignKeyMeta{},
		Indexes:     []driver.IndexMeta{},
	}

	// 1. Get Columns via PRAGMA table_info
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info('%s')", table))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid, notnull, pk int
		var name, typeStr string
		var dfltValue *string
		if err := rows.Scan(&cid, &name, &typeStr, &notnull, &dfltValue, &pk); err != nil {
			continue
		}
		dflt := ""
		if dfltValue != nil {
			dflt = *dfltValue
		}
		isPk := pk > 0
		if isPk {
			structure.PrimaryKeys = append(structure.PrimaryKeys, name)
		}
		structure.Columns = append(structure.Columns, driver.ColumnMeta{
			Name:         name,
			DataType:     typeStr,
			RawType:      strings.ToLower(typeStr),
			IsNullable:   notnull == 0,
			IsPrimaryKey: isPk,
			DefaultValue: dflt,
		})
	}

	// 2. Get Foreign Keys via PRAGMA foreign_key_list
	fkRows, err := s.db.QueryContext(ctx, fmt.Sprintf("PRAGMA foreign_key_list('%s')", table))
	if err == nil {
		defer fkRows.Close()
		for fkRows.Next() {
			var id, seq int
			var refTable, fromCol, toCol, onUpdate, onDelete, match string
			if err := fkRows.Scan(&id, &seq, &refTable, &fromCol, &toCol, &onUpdate, &onDelete, &match); err == nil {
				structure.ForeignKeys = append(structure.ForeignKeys, driver.ForeignKeyMeta{
					ConstraintName: fmt.Sprintf("fk_%s_%s", table, fromCol),
					ColumnName:     fromCol,
					RefSchema:      "main",
					RefTable:       refTable,
					RefColumn:      toCol,
					OnUpdate:       onUpdate,
					OnDelete:       onDelete,
				})
			}
		}
	}

	// 3. Get DDL
	var ddl string
	_ = s.db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&ddl)
	structure.DDL = ddl

	return structure, nil
}

func (s *SQLiteDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	return driver.ExecuteStatements(ctx, s.db, req)
}

func (s *SQLiteDriver) GenerateDMLPreview(schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	for _, c := range changes {
		switch c.Type {
		case "insert":
			cols := []string{}
			vals := []string{}
			for k, v := range c.Changes {
				cols = append(cols, fmt.Sprintf(`"%s"`, k))
				vals = append(vals, formatSQLVal(v))
			}
			statements = append(statements, fmt.Sprintf(`INSERT INTO "%s" (%s) VALUES (%s);`, table, strings.Join(cols, ", "), strings.Join(vals, ", ")))
		case "update":
			sets := []string{}
			for k, v := range c.Changes {
				sets = append(sets, fmt.Sprintf(`"%s" = %s`, k, formatSQLVal(v)))
			}
			where := []string{}
			for k, v := range c.PrimaryKey {
				where = append(where, fmt.Sprintf(`"%s" = %s`, k, formatSQLVal(v)))
			}
			statements = append(statements, fmt.Sprintf(`UPDATE "%s" SET %s WHERE %s;`, table, strings.Join(sets, ", "), strings.Join(where, " AND ")))
		case "delete":
			where := []string{}
			for k, v := range c.PrimaryKey {
				where = append(where, fmt.Sprintf(`"%s" = %s`, k, formatSQLVal(v)))
			}
			statements = append(statements, fmt.Sprintf(`DELETE FROM "%s" WHERE %s;`, table, strings.Join(where, " AND ")))
		}
	}
	return statements, nil
}

func (s *SQLiteDriver) ApplyChanges(ctx context.Context, schema, table string, changes []driver.RowChange) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var totalAffected int64
	for _, c := range changes {
		switch c.Type {
		case "insert":
			cols := []string{}
			placeholders := []string{}
			vals := []any{}
			for k, v := range c.Changes {
				cols = append(cols, fmt.Sprintf(`"%s"`, k))
				placeholders = append(placeholders, "?")
				vals = append(vals, v)
			}
			stmt := fmt.Sprintf(`INSERT INTO "%s" (%s) VALUES (%s)`, table, strings.Join(cols, ", "), strings.Join(placeholders, ", "))
			res, err := tx.ExecContext(ctx, stmt, vals...)
			if err != nil {
				return 0, err
			}
			ra, _ := res.RowsAffected()
			totalAffected += ra
		case "update":
			sets := []string{}
			vals := []any{}
			for k, v := range c.Changes {
				sets = append(sets, fmt.Sprintf(`"%s" = ?`, k))
				vals = append(vals, v)
			}
			where := []string{}
			for k, v := range c.PrimaryKey {
				where = append(where, fmt.Sprintf(`"%s" = ?`, k))
				vals = append(vals, v)
			}
			stmt := fmt.Sprintf(`UPDATE "%s" SET %s WHERE %s`, table, strings.Join(sets, ", "), strings.Join(where, " AND "))
			res, err := tx.ExecContext(ctx, stmt, vals...)
			if err != nil {
				return 0, err
			}
			ra, _ := res.RowsAffected()
			totalAffected += ra
		case "delete":
			where := []string{}
			vals := []any{}
			for k, v := range c.PrimaryKey {
				where = append(where, fmt.Sprintf(`"%s" = ?`, k))
				vals = append(vals, v)
			}
			stmt := fmt.Sprintf(`DELETE FROM "%s" WHERE %s`, table, strings.Join(where, " AND "))
			res, err := tx.ExecContext(ctx, stmt, vals...)
			if err != nil {
				return 0, err
			}
			ra, _ := res.RowsAffected()
			totalAffected += ra
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return totalAffected, nil
}

func formatSQLVal(v any) string {
	if v == nil {
		return "NULL"
	}
	switch val := v.(type) {
	case string:
		return "'" + strings.ReplaceAll(val, "'", "''") + "'"
	default:
		return fmt.Sprintf("%v", val)
	}
}

