package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"dhub/internal/driver"
	_ "modernc.org/sqlite"
)

type SQLiteDriver struct {
	db       *sql.DB
	filePath string
}

func NewSQLiteDriver(filePath string) (*SQLiteDriver, error) {
	cleanPath := strings.TrimSpace(filePath)
	if cleanPath == "" {
		return nil, fmt.Errorf("sqlite database file path cannot be empty")
	}

	if cleanPath != ":memory:" {
		dir := filepath.Dir(cleanPath)
		if dir != "" && dir != "." {
			_ = os.MkdirAll(dir, 0755)
		}
	}

	dsn := cleanPath
	if cleanPath != ":memory:" && !strings.Contains(cleanPath, "?") {
		dsn = cleanPath + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(5)
	return &SQLiteDriver{db: db, filePath: cleanPath}, nil
}

func (s *SQLiteDriver) Ping(ctx context.Context) error {
	if err := s.db.PingContext(ctx); err != nil {
		return fmt.Errorf("cannot open sqlite database at %q: %w", s.filePath, err)
	}
	return nil
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
	query := `SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name`
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

	quotedTable := quoteLiteral(table)

	// 1. Get Columns via PRAGMA table_info
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info(%s)", quotedTable))
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
	fkRows, err := s.db.QueryContext(ctx, fmt.Sprintf("PRAGMA foreign_key_list(%s)", quotedTable))
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

	// 2b. Detect auto-assigned keys: a single INTEGER PRIMARY KEY is a rowid alias
	// and gets a value automatically (with or without the AUTOINCREMENT keyword).
	if len(structure.PrimaryKeys) == 1 {
		for i := range structure.Columns {
			c := &structure.Columns[i]
			if c.IsPrimaryKey && strings.EqualFold(strings.TrimSpace(c.DataType), "INTEGER") {
				c.IsAutoIncr = true
			}
		}
	}

	// 2c. Get Indexes via PRAGMA index_list + index_info
	idxRows, idxErr := s.db.QueryContext(ctx, fmt.Sprintf("PRAGMA index_list(%s)", quotedTable))
	if idxErr == nil {
		type rawIdx struct {
			name   string
			unique bool
			origin string
		}
		var rawIdxs []rawIdx
		for idxRows.Next() {
			var seq, unique, partial int
			var name, origin string
			if err := idxRows.Scan(&seq, &name, &unique, &origin, &partial); err == nil {
				rawIdxs = append(rawIdxs, rawIdx{name: name, unique: unique == 1, origin: origin})
			}
		}
		idxRows.Close()

		for _, ri := range rawIdxs {
			cols := []string{}
			if infoRows, err := s.db.QueryContext(ctx, fmt.Sprintf("PRAGMA index_info(%s)", quoteLiteral(ri.name))); err == nil {
				for infoRows.Next() {
					var seqno, cid int
					var colName *string
					if err := infoRows.Scan(&seqno, &cid, &colName); err == nil && colName != nil {
						cols = append(cols, *colName)
					}
				}
				infoRows.Close()
			}
			structure.Indexes = append(structure.Indexes, driver.IndexMeta{
				Name:      ri.name,
				Columns:   cols,
				IsUnique:  ri.unique,
				IsPrimary: ri.origin == "pk",
				Type:      "BTREE",
				Method:    "BTREE",
			})
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

func (s *SQLiteDriver) BeginTx(ctx context.Context, database string) (*sql.Tx, error) {
	return s.db.BeginTx(ctx, nil)
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func (s *SQLiteDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	for _, c := range changes {
		switch c.Type {
		case "insert":
			cols := []string{}
			vals := []string{}
			for _, k := range sortedKeys(c.Changes) {
				cols = append(cols, fmt.Sprintf(`"%s"`, k))
				vals = append(vals, formatSQLVal(c.Changes[k]))
			}
			stmt := fmt.Sprintf(`INSERT INTO "%s" (%s) VALUES (%s);`, table, strings.Join(cols, ", "), strings.Join(vals, ", "))
			if len(cols) == 0 {
				stmt = fmt.Sprintf(`INSERT INTO "%s" DEFAULT VALUES;`, table)
			}
			statements = append(statements, stmt)
		case "update":
			sets := []string{}
			for _, k := range sortedKeys(c.Changes) {
				sets = append(sets, fmt.Sprintf(`"%s" = %s`, k, formatSQLVal(c.Changes[k])))
			}
			where := []string{}
			for _, k := range sortedKeys(c.PrimaryKey) {
				where = append(where, fmt.Sprintf(`"%s" = %s`, k, formatSQLVal(c.PrimaryKey[k])))
			}
			statements = append(statements, fmt.Sprintf(`UPDATE "%s" SET %s WHERE %s;`, table, strings.Join(sets, ", "), strings.Join(where, " AND ")))
		case "delete":
			where := []string{}
			for _, k := range sortedKeys(c.PrimaryKey) {
				where = append(where, fmt.Sprintf(`"%s" = %s`, k, formatSQLVal(c.PrimaryKey[k])))
			}
			statements = append(statements, fmt.Sprintf(`DELETE FROM "%s" WHERE %s;`, table, strings.Join(where, " AND ")))
		}
	}
	return statements, nil
}

func (s *SQLiteDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
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
			for _, k := range sortedKeys(c.Changes) {
				cols = append(cols, fmt.Sprintf(`"%s"`, k))
				placeholders = append(placeholders, "?")
				vals = append(vals, c.Changes[k])
			}
			stmt := fmt.Sprintf(`INSERT INTO "%s" (%s) VALUES (%s)`, table, strings.Join(cols, ", "), strings.Join(placeholders, ", "))
			if len(cols) == 0 {
				stmt = fmt.Sprintf(`INSERT INTO "%s" DEFAULT VALUES`, table)
			}
			res, err := tx.ExecContext(ctx, stmt, vals...)
			if err != nil {
				return 0, err
			}
			ra, _ := res.RowsAffected()
			totalAffected += ra
		case "update":
			sets := []string{}
			vals := []any{}
			for _, k := range sortedKeys(c.Changes) {
				sets = append(sets, fmt.Sprintf(`"%s" = ?`, k))
				vals = append(vals, c.Changes[k])
			}
			where := []string{}
			for _, k := range sortedKeys(c.PrimaryKey) {
				where = append(where, fmt.Sprintf(`"%s" = ?`, k))
				vals = append(vals, c.PrimaryKey[k])
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
			for _, k := range sortedKeys(c.PrimaryKey) {
				where = append(where, fmt.Sprintf(`"%s" = ?`, k))
				vals = append(vals, c.PrimaryKey[k])
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

// quoteLiteral returns s as a single-quoted SQL string literal with quotes escaped.
func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
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

