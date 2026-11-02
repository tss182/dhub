package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"dhub/internal/driver"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type PostgresDriver struct {
	db     *sql.DB
	connStr string
}

func NewPostgresDriver(connStr string) (*PostgresDriver, error) {
	db, err := sql.Open("pgx", connStr)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(time.Hour)
	return &PostgresDriver{db: db, connStr: connStr}, nil
}

func (p *PostgresDriver) Ping(ctx context.Context) error {
	return p.db.PingContext(ctx)
}

func (p *PostgresDriver) Close() error {
	if p.db != nil {
		return p.db.Close()
	}
	return nil
}

func (p *PostgresDriver) ListDatabases(ctx context.Context) ([]string, error) {
	query := `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;`
	rows, err := p.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var dbs []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			dbs = append(dbs, name)
		}
	}
	return dbs, nil
}

func (p *PostgresDriver) ListSchemas(ctx context.Context, database string) ([]string, error) {
	query := `SELECT schema_name FROM information_schema.schemata
		WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
		ORDER BY schema_name;`
	rows, err := p.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var schemas []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			schemas = append(schemas, name)
		}
	}
	return schemas, nil
}

func (p *PostgresDriver) ListObjects(ctx context.Context, database, schema string) ([]driver.ObjectSummary, error) {
	query := `
		SELECT
			table_name,
			CASE table_type
				WHEN 'BASE TABLE' THEN 'table'
				WHEN 'VIEW' THEN 'view'
				ELSE 'other'
			END as obj_type
		FROM information_schema.tables
		WHERE table_schema = $1
		ORDER BY table_name;`

	rows, err := p.db.QueryContext(ctx, query, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var objects []driver.ObjectSummary
	for rows.Next() {
		var name, objType string
		if err := rows.Scan(&name, &objType); err == nil {
			objects = append(objects, driver.ObjectSummary{
				Schema:      schema,
				Name:        name,
				Type:        objType,
				RowEstimate: -1,
			})
		}
	}
	return objects, nil
}

func (p *PostgresDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	structure := &driver.TableStructure{
		Schema:      schema,
		Name:        table,
		Columns:     []driver.ColumnMeta{},
		PrimaryKeys: []string{},
		ForeignKeys: []driver.ForeignKeyMeta{},
		Indexes:     []driver.IndexMeta{},
	}

	// 1. Get Primary Keys
	pkQuery := `
		SELECT kcu.column_name
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
			ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
		WHERE tc.constraint_type = 'PRIMARY KEY'
			AND tc.table_schema = $1 AND tc.table_name = $2;`
	pkRows, err := p.db.QueryContext(ctx, pkQuery, schema, table)
	if err == nil {
		defer pkRows.Close()
		for pkRows.Next() {
			var pkCol string
			if err := pkRows.Scan(&pkCol); err == nil {
				structure.PrimaryKeys = append(structure.PrimaryKeys, pkCol)
			}
		}
	}

	pkSet := make(map[string]bool)
	for _, pk := range structure.PrimaryKeys {
		pkSet[pk] = true
	}

	// 2. Get Columns
	colQuery := `
		SELECT column_name, data_type, is_nullable, column_default
		FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = $2
		ORDER BY ordinal_position;`
	rows, err := p.db.QueryContext(ctx, colQuery, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var name, dataType, isNullable string
		var dflt *string
		if err := rows.Scan(&name, &dataType, &isNullable, &dflt); err == nil {
			defVal := ""
			if dflt != nil {
				defVal = *dflt
			}
			structure.Columns = append(structure.Columns, driver.ColumnMeta{
				Name:         name,
				DataType:     dataType,
				RawType:      dataType,
				IsNullable:   isNullable == "YES",
				IsPrimaryKey: pkSet[name],
				DefaultValue: defVal,
			})
		}
	}

	// 3. Get Foreign Keys
	fkQuery := `
		SELECT
			tc.constraint_name, kcu.column_name,
			ccu.table_schema AS foreign_table_schema,
			ccu.table_name AS foreign_table_name,
			ccu.column_name AS foreign_column_name
		FROM information_schema.table_constraints AS tc
		JOIN information_schema.key_column_usage AS kcu
			ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
		JOIN information_schema.constraint_column_usage AS ccu
			ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
		WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2;`
	fkRows, err := p.db.QueryContext(ctx, fkQuery, schema, table)
	if err == nil {
		defer fkRows.Close()
		for fkRows.Next() {
			var cName, col, fSchema, fTable, fCol string
			if err := fkRows.Scan(&cName, &col, &fSchema, &fTable, &fCol); err == nil {
				structure.ForeignKeys = append(structure.ForeignKeys, driver.ForeignKeyMeta{
					ConstraintName: cName,
					ColumnName:     col,
					RefSchema:      fSchema,
					RefTable:       fTable,
					RefColumn:      fCol,
				})
			}
		}
	}

	return structure, nil
}

func (p *PostgresDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	conn, err := p.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	if req.Schema != "" && req.Schema != "main" {
		_, _ = conn.ExecContext(ctx, fmt.Sprintf(`SET search_path TO "%s", public`, req.Schema))
	}

	return driver.ExecuteStatements(ctx, conn, req)
}

func (p *PostgresDriver) GenerateDMLPreview(schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	prefix := fmt.Sprintf(`"%s"."%s"`, schema, table)
	if schema == "" {
		prefix = fmt.Sprintf(`"%s"`, table)
	}

	for _, c := range changes {
		switch c.Type {
		case "insert":
			cols := []string{}
			vals := []string{}
			for k, v := range c.Changes {
				cols = append(cols, fmt.Sprintf(`"%s"`, k))
				vals = append(vals, formatSQLVal(v))
			}
			stmt := fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s);`, prefix, strings.Join(cols, ", "), strings.Join(vals, ", "))
			if len(cols) == 0 {
				stmt = fmt.Sprintf(`INSERT INTO %s DEFAULT VALUES;`, prefix)
			}
			statements = append(statements, stmt)
		case "update":
			sets := []string{}
			for k, v := range c.Changes {
				sets = append(sets, fmt.Sprintf(`"%s" = %s`, k, formatSQLVal(v)))
			}
			where := []string{}
			for k, v := range c.PrimaryKey {
				where = append(where, fmt.Sprintf(`"%s" = %s`, k, formatSQLVal(v)))
			}
			statements = append(statements, fmt.Sprintf(`UPDATE %s SET %s WHERE %s;`, prefix, strings.Join(sets, ", "), strings.Join(where, " AND ")))
		case "delete":
			where := []string{}
			for k, v := range c.PrimaryKey {
				where = append(where, fmt.Sprintf(`"%s" = %s`, k, formatSQLVal(v)))
			}
			statements = append(statements, fmt.Sprintf(`DELETE FROM %s WHERE %s;`, prefix, strings.Join(where, " AND ")))
		}
	}
	return statements, nil
}

func (p *PostgresDriver) ApplyChanges(ctx context.Context, schema, table string, changes []driver.RowChange) (int64, error) {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	prefix := fmt.Sprintf(`"%s"."%s"`, schema, table)
	if schema == "" {
		prefix = fmt.Sprintf(`"%s"`, table)
	}

	var totalAffected int64
	for _, c := range changes {
		switch c.Type {
		case "insert":
			cols := []string{}
			placeholders := []string{}
			vals := []any{}
			idx := 1
			for k, v := range c.Changes {
				cols = append(cols, fmt.Sprintf(`"%s"`, k))
				placeholders = append(placeholders, fmt.Sprintf("$%d", idx))
				vals = append(vals, v)
				idx++
			}
			stmt := fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`, prefix, strings.Join(cols, ", "), strings.Join(placeholders, ", "))
			if len(cols) == 0 {
				stmt = fmt.Sprintf(`INSERT INTO %s DEFAULT VALUES`, prefix)
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
			idx := 1
			for k, v := range c.Changes {
				sets = append(sets, fmt.Sprintf(`"%s" = $%d`, k, idx))
				vals = append(vals, v)
				idx++
			}
			where := []string{}
			for k, v := range c.PrimaryKey {
				where = append(where, fmt.Sprintf(`"%s" = $%d`, k, idx))
				vals = append(vals, v)
				idx++
			}
			stmt := fmt.Sprintf(`UPDATE %s SET %s WHERE %s`, prefix, strings.Join(sets, ", "), strings.Join(where, " AND "))
			res, err := tx.ExecContext(ctx, stmt, vals...)
			if err != nil {
				return 0, err
			}
			ra, _ := res.RowsAffected()
			totalAffected += ra
		case "delete":
			where := []string{}
			vals := []any{}
			idx := 1
			for k, v := range c.PrimaryKey {
				where = append(where, fmt.Sprintf(`"%s" = $%d`, k, idx))
				vals = append(vals, v)
				idx++
			}
			stmt := fmt.Sprintf(`DELETE FROM %s WHERE %s`, prefix, strings.Join(where, " AND "))
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

