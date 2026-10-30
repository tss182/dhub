package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"dhub/internal/driver"
	_ "github.com/go-sql-driver/mysql"
)

type MySQLDriver struct {
	db     *sql.DB
	dsn    string
}

func NewMySQLDriver(dsn string) (*MySQLDriver, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(time.Hour)
	return &MySQLDriver{db: db, dsn: dsn}, nil
}

func (m *MySQLDriver) Ping(ctx context.Context) error {
	return m.db.PingContext(ctx)
}

func (m *MySQLDriver) Close() error {
	if m.db != nil {
		return m.db.Close()
	}
	return nil
}

func (m *MySQLDriver) ListDatabases(ctx context.Context) ([]string, error) {
	rows, err := m.db.QueryContext(ctx, "SHOW DATABASES;")
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

func (m *MySQLDriver) ListSchemas(ctx context.Context, database string) ([]string, error) {
	return []string{database}, nil
}

func (m *MySQLDriver) ListObjects(ctx context.Context, database, schema string) ([]driver.ObjectSummary, error) {
	query := `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name`
	rows, err := m.db.QueryContext(ctx, query, database)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var objects []driver.ObjectSummary
	for rows.Next() {
		var name, objType string
		if err := rows.Scan(&name, &objType); err == nil {
			t := "table"
			if strings.Contains(strings.ToUpper(objType), "VIEW") {
				t = "view"
			}
			objects = append(objects, driver.ObjectSummary{
				Schema:      database,
				Name:        name,
				Type:        t,
				RowEstimate: -1,
			})
		}
	}
	return objects, nil
}

func (m *MySQLDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	structure := &driver.TableStructure{
		Schema:      database,
		Name:        table,
		Columns:     []driver.ColumnMeta{},
		PrimaryKeys: []string{},
		ForeignKeys: []driver.ForeignKeyMeta{},
		Indexes:     []driver.IndexMeta{},
	}

	colQuery := `SELECT column_name, data_type, is_nullable, column_key, column_default, extra
		FROM information_schema.columns
		WHERE table_schema = ? AND table_name = ?
		ORDER BY ordinal_position`
	rows, err := m.db.QueryContext(ctx, colQuery, database, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var name, dataType, isNullable, colKey, extra string
		var dflt *string
		if err := rows.Scan(&name, &dataType, &isNullable, &colKey, &dflt, &extra); err == nil {
			isPk := colKey == "PRI"
			if isPk {
				structure.PrimaryKeys = append(structure.PrimaryKeys, name)
			}
			defVal := ""
			if dflt != nil {
				defVal = *dflt
			}
			structure.Columns = append(structure.Columns, driver.ColumnMeta{
				Name:         name,
				DataType:     dataType,
				RawType:      dataType,
				IsNullable:   isNullable == "YES",
				IsPrimaryKey: isPk,
				IsAutoIncr:   strings.Contains(strings.ToLower(extra), "auto_increment"),
				DefaultValue: defVal,
			})
		}
	}

	return structure, nil
}

func (m *MySQLDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	conn, err := m.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	if req.Database != "" && req.Database != "main" {
		if _, err := conn.ExecContext(ctx, fmt.Sprintf("USE `%s`", req.Database)); err != nil {
			return nil, fmt.Errorf("error switching to database '%s': %w", req.Database, err)
		}
	}

	return driver.ExecuteStatements(ctx, conn, req)
}

func (m *MySQLDriver) GenerateDMLPreview(schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	prefix := fmt.Sprintf("`%s`.`%s`", schema, table)
	if schema == "" {
		prefix = fmt.Sprintf("`%s`", table)
	}

	for _, c := range changes {
		switch c.Type {
		case "insert":
			cols := []string{}
			vals := []string{}
			for k, v := range c.Changes {
				cols = append(cols, fmt.Sprintf("`%s`", k))
				vals = append(vals, formatSQLVal(v))
			}
			statements = append(statements, fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);", prefix, strings.Join(cols, ", "), strings.Join(vals, ", ")))
		case "update":
			sets := []string{}
			for k, v := range c.Changes {
				sets = append(sets, fmt.Sprintf("`%s` = %s", k, formatSQLVal(v)))
			}
			where := []string{}
			for k, v := range c.PrimaryKey {
				where = append(where, fmt.Sprintf("`%s` = %s", k, formatSQLVal(v)))
			}
			statements = append(statements, fmt.Sprintf("UPDATE %s SET %s WHERE %s;", prefix, strings.Join(sets, ", "), strings.Join(where, " AND ")))
		case "delete":
			where := []string{}
			for k, v := range c.PrimaryKey {
				where = append(where, fmt.Sprintf("`%s` = %s", k, formatSQLVal(v)))
			}
			statements = append(statements, fmt.Sprintf("DELETE FROM %s WHERE %s;", prefix, strings.Join(where, " AND ")))
		}
	}
	return statements, nil
}

func (m *MySQLDriver) ApplyChanges(ctx context.Context, schema, table string, changes []driver.RowChange) (int64, error) {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	prefix := fmt.Sprintf("`%s`.`%s`", schema, table)
	if schema == "" {
		prefix = fmt.Sprintf("`%s`", table)
	}

	var totalAffected int64
	for _, c := range changes {
		switch c.Type {
		case "insert":
			cols := []string{}
			placeholders := []string{}
			vals := []any{}
			for k, v := range c.Changes {
				cols = append(cols, fmt.Sprintf("`%s`", k))
				placeholders = append(placeholders, "?")
				vals = append(vals, v)
			}
			stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", prefix, strings.Join(cols, ", "), strings.Join(placeholders, ", "))
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
				sets = append(sets, fmt.Sprintf("`%s` = ?", k))
				vals = append(vals, v)
			}
			where := []string{}
			for k, v := range c.PrimaryKey {
				where = append(where, fmt.Sprintf("`%s` = ?", k))
				vals = append(vals, v)
			}
			stmt := fmt.Sprintf("UPDATE %s SET %s WHERE %s", prefix, strings.Join(sets, ", "), strings.Join(where, " AND "))
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
				where = append(where, fmt.Sprintf("`%s` = ?", k))
				vals = append(vals, v)
			}
			stmt := fmt.Sprintf("DELETE FROM %s WHERE %s", prefix, strings.Join(where, " AND "))
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

