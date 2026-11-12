package clickhouse

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"dhub/internal/driver"
	_ "github.com/ClickHouse/clickhouse-go/v2"
)

type ClickHouseDriver struct {
	db        *sql.DB
	connStr   string
	defaultDB string

	mu    sync.Mutex
	pools map[string]*sql.DB
}

func openPool(connStr string) (*sql.DB, error) {
	db, err := sql.Open("clickhouse", connStr)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(time.Hour)
	return db, nil
}

func NewClickHouseDriver(connStr string) (*ClickHouseDriver, error) {
	db, err := openPool(connStr)
	if err != nil {
		return nil, err
	}

	defaultDB := ""
	if u, perr := url.Parse(connStr); perr == nil {
		defaultDB = strings.TrimPrefix(u.Path, "/")
	}
	if defaultDB == "" {
		defaultDB = "default"
	}

	return &ClickHouseDriver{
		db:        db,
		connStr:   connStr,
		defaultDB: defaultDB,
		pools:     make(map[string]*sql.DB),
	}, nil
}

func (c *ClickHouseDriver) dbFor(database string) (*sql.DB, error) {
	database = strings.TrimSpace(database)
	if database == "" || database == "main" || database == c.defaultDB {
		return c.db, nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if pool, ok := c.pools[database]; ok {
		return pool, nil
	}

	u, err := url.Parse(c.connStr)
	if err != nil {
		return nil, fmt.Errorf("invalid connection string: %w", err)
	}
	u.Path = "/" + database

	pool, err := openPool(u.String())
	if err != nil {
		return nil, err
	}
	c.pools[database] = pool
	return pool, nil
}

func (c *ClickHouseDriver) Ping(ctx context.Context) error {
	return c.db.PingContext(ctx)
}

func (c *ClickHouseDriver) Close() error {
	c.mu.Lock()
	for name, pool := range c.pools {
		_ = pool.Close()
		delete(c.pools, name)
	}
	c.mu.Unlock()

	if c.db != nil {
		return c.db.Close()
	}
	return nil
}

func quoteIdent(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
}

func qualifiedName(schema, table string) string {
	if schema == "" || schema == "default" {
		return quoteIdent(table)
	}
	return quoteIdent(schema) + "." + quoteIdent(table)
}

func (c *ClickHouseDriver) ListDatabases(ctx context.Context) ([]string, error) {
	query := `SELECT name FROM system.databases ORDER BY name;`
	rows, err := c.db.QueryContext(ctx, query)
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

func (c *ClickHouseDriver) ListSchemas(ctx context.Context, database string) ([]string, error) {
	if database == "" || database == "main" {
		database = c.defaultDB
	}
	return []string{database}, nil
}

func (c *ClickHouseDriver) ListObjects(ctx context.Context, database, schema string) ([]driver.ObjectSummary, error) {
	if database == "" || database == "main" {
		database = c.defaultDB
	}
	db, err := c.dbFor(database)
	if err != nil {
		return nil, err
	}

	query := `
		SELECT 
			name,
			engine,
			total_rows,
			comment
		FROM system.tables 
		WHERE database = ?
		ORDER BY name;`

	rows, err := db.QueryContext(ctx, query, database)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var objects []driver.ObjectSummary
	for rows.Next() {
		var name, engine string
		var totalRows sql.NullInt64
		var comment sql.NullString

		if err := rows.Scan(&name, &engine, &totalRows, &comment); err != nil {
			continue
		}

		collType := "table"
		if strings.Contains(strings.ToLower(engine), "view") {
			collType = "view"
		}

		var rowEst int64
		if totalRows.Valid {
			rowEst = totalRows.Int64
		}

		objects = append(objects, driver.ObjectSummary{
			Schema:      database,
			Name:        name,
			Type:        collType,
			RowEstimate: rowEst,
			Comment:     comment.String,
		})
	}

	return objects, nil
}

func rawTypeFromClickHouse(t string) string {
	lower := strings.ToLower(t)
	if strings.Contains(lower, "int") || strings.Contains(lower, "float") || strings.Contains(lower, "decimal") {
		return "number"
	}
	if strings.Contains(lower, "date") || strings.Contains(lower, "time") {
		return "date"
	}
	if strings.Contains(lower, "bool") {
		return "boolean"
	}
	if strings.HasPrefix(lower, "array") || strings.HasPrefix(lower, "tuple") || strings.HasPrefix(lower, "map") || strings.HasPrefix(lower, "json") {
		return "json"
	}
	return "string"
}

func (c *ClickHouseDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	if database == "" || database == "main" {
		database = c.defaultDB
	}
	db, err := c.dbFor(database)
	if err != nil {
		return nil, err
	}

	structure := &driver.TableStructure{
		Schema:      database,
		Name:        table,
		Columns:     []driver.ColumnMeta{},
		PrimaryKeys: []string{},
		ForeignKeys: []driver.ForeignKeyMeta{},
		Indexes:     []driver.IndexMeta{},
	}

	// 1. Columns
	colQuery := `
		SELECT 
			name,
			type,
			default_expression,
			comment,
			is_in_primary_key
		FROM system.columns 
		WHERE database = ? AND table = ?
		ORDER BY position;`

	rows, err := db.QueryContext(ctx, colQuery, database, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var colName, colType string
		var defaultExpr, comment sql.NullString
		var isInPK uint8

		if err := rows.Scan(&colName, &colType, &defaultExpr, &comment, &isInPK); err != nil {
			continue
		}

		isPK := isInPK == 1
		if isPK {
			structure.PrimaryKeys = append(structure.PrimaryKeys, colName)
		}

		structure.Columns = append(structure.Columns, driver.ColumnMeta{
			Name:         colName,
			DataType:     colType,
			RawType:      rawTypeFromClickHouse(colType),
			IsNullable:   strings.HasPrefix(colType, "Nullable("),
			IsPrimaryKey: isPK,
			DefaultValue: defaultExpr.String,
			Comment:      comment.String,
		})
	}

	// 2. Fetch DDL from ClickHouse metadata
	var ddl sql.NullString
	_ = db.QueryRowContext(ctx, "SELECT create_table_query FROM system.tables WHERE database = ? AND name = ?", database, table).Scan(&ddl)
	if ddl.Valid && ddl.String != "" {
		structure.DDL = ddl.String
	} else {
		structure.DDL = generateClickHouseDDL(database, table, structure)
	}

	return structure, nil
}

func generateClickHouseDDL(database, table string, s *driver.TableStructure) string {
	var sb strings.Builder
	prefix := qualifiedName(database, table)
	sb.WriteString(fmt.Sprintf("CREATE TABLE %s (\n", prefix))

	var defs []string
	for _, col := range s.Columns {
		def := fmt.Sprintf("  %s %s", quoteIdent(col.Name), col.DataType)
		if col.DefaultValue != "" {
			def += " DEFAULT " + col.DefaultValue
		}
		if col.Comment != "" {
			def += fmt.Sprintf(" COMMENT '%s'", strings.ReplaceAll(col.Comment, "'", "\\'"))
		}
		defs = append(defs, def)
	}
	sb.WriteString(strings.Join(defs, ",\n"))
	sb.WriteString("\n) ENGINE = MergeTree()");

	if len(s.PrimaryKeys) > 0 {
		var pkCols []string
		for _, pk := range s.PrimaryKeys {
			pkCols = append(pkCols, quoteIdent(pk))
		}
		sb.WriteString(fmt.Sprintf("\nORDER BY (%s);", strings.Join(pkCols, ", ")))
	} else {
		sb.WriteString("\nORDER BY tuple();")
	}

	return sb.String()
}

func (c *ClickHouseDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	db, err := c.dbFor(req.Database)
	if err != nil {
		return nil, err
	}

	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	return driver.ExecuteStatements(ctx, conn, req)
}

func (c *ClickHouseDriver) BeginTx(ctx context.Context, database string) (*sql.Tx, error) {
	db, err := c.dbFor(database)
	if err != nil {
		return nil, err
	}
	return db.BeginTx(ctx, nil)
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func formatSQLVal(v any) string {
	if v == nil {
		return "NULL"
	}
	switch val := v.(type) {
	case string:
		return "'" + strings.ReplaceAll(val, "'", "''") + "'"
	case bool:
		if val {
			return "1"
		}
		return "0"
	default:
		return fmt.Sprintf("%v", val)
	}
}

func (c *ClickHouseDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	prefix := qualifiedName(schema, table)

	for _, ch := range changes {
		switch ch.Type {
		case "insert":
			var cols, vals []string
			for _, k := range sortedKeys(ch.Changes) {
				cols = append(cols, quoteIdent(k))
				vals = append(vals, formatSQLVal(ch.Changes[k]))
			}
			stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);", prefix, strings.Join(cols, ", "), strings.Join(vals, ", "))
			statements = append(statements, stmt)
		case "update":
			var sets, where []string
			for _, k := range sortedKeys(ch.Changes) {
				sets = append(sets, fmt.Sprintf("%s = %s", quoteIdent(k), formatSQLVal(ch.Changes[k])))
			}
			for _, k := range sortedKeys(ch.PrimaryKey) {
				where = append(where, fmt.Sprintf("%s = %s", quoteIdent(k), formatSQLVal(ch.PrimaryKey[k])))
			}
			stmt := fmt.Sprintf("ALTER TABLE %s UPDATE %s WHERE %s;", prefix, strings.Join(sets, ", "), strings.Join(where, " AND "))
			statements = append(statements, stmt)
		case "delete":
			var where []string
			for _, k := range sortedKeys(ch.PrimaryKey) {
				where = append(where, fmt.Sprintf("%s = %s", quoteIdent(k), formatSQLVal(ch.PrimaryKey[k])))
			}
			stmt := fmt.Sprintf("ALTER TABLE %s DELETE WHERE %s;", prefix, strings.Join(where, " AND "))
			statements = append(statements, stmt)
		}
	}
	return statements, nil
}

func (c *ClickHouseDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	db, err := c.dbFor(database)
	if err != nil {
		return 0, err
	}

	prefix := qualifiedName(schema, table)
	var totalAffected int64

	for _, ch := range changes {
		switch ch.Type {
		case "insert":
			var cols, placeholders []string
			var vals []any
			for _, k := range sortedKeys(ch.Changes) {
				cols = append(cols, quoteIdent(k))
				placeholders = append(placeholders, "?")
				vals = append(vals, ch.Changes[k])
			}
			stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", prefix, strings.Join(cols, ", "), strings.Join(placeholders, ", "))
			res, err := db.ExecContext(ctx, stmt, vals...)
			if err != nil {
				return totalAffected, err
			}
			ra, _ := res.RowsAffected()
			if ra == 0 {
				ra = 1
			}
			totalAffected += ra
		case "update":
			var sets, where []string
			var vals []any
			for _, k := range sortedKeys(ch.Changes) {
				sets = append(sets, fmt.Sprintf("%s = ?", quoteIdent(k)))
				vals = append(vals, ch.Changes[k])
			}
			for _, k := range sortedKeys(ch.PrimaryKey) {
				where = append(where, fmt.Sprintf("%s = ?", quoteIdent(k)))
				vals = append(vals, ch.PrimaryKey[k])
			}
			stmt := fmt.Sprintf("ALTER TABLE %s UPDATE %s WHERE %s", prefix, strings.Join(sets, ", "), strings.Join(where, " AND "))
			res, err := db.ExecContext(ctx, stmt, vals...)
			if err != nil {
				return totalAffected, err
			}
			ra, _ := res.RowsAffected()
			if ra == 0 {
				ra = 1
			}
			totalAffected += ra
		case "delete":
			var where []string
			var vals []any
			for _, k := range sortedKeys(ch.PrimaryKey) {
				where = append(where, fmt.Sprintf("%s = ?", quoteIdent(k)))
				vals = append(vals, ch.PrimaryKey[k])
			}
			stmt := fmt.Sprintf("ALTER TABLE %s DELETE WHERE %s", prefix, strings.Join(where, " AND "))
			res, err := db.ExecContext(ctx, stmt, vals...)
			if err != nil {
				return totalAffected, err
			}
			ra, _ := res.RowsAffected()
			if ra == 0 {
				ra = 1
			}
			totalAffected += ra
		}
	}

	return totalAffected, nil
}

