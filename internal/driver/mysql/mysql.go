package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
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

// quoteIdent quotes a MySQL identifier, escaping embedded backticks.
func quoteIdent(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
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

	// 1. Fetch table options (Engine, Collation, Comment)
	tblQuery := `SELECT engine, table_collation, table_comment
		FROM information_schema.tables
		WHERE table_schema = ? AND table_name = ?`
	var engine, collation, tblComment *string
	if err := m.db.QueryRowContext(ctx, tblQuery, database, table).Scan(&engine, &collation, &tblComment); err == nil {
		if engine != nil {
			structure.Engine = *engine
		}
		if collation != nil {
			structure.Collation = *collation
		}
		if tblComment != nil {
			structure.Comment = *tblComment
		}
	}

	// 2. Fetch columns with accurate types, defaults, and comments
	colQuery := `SELECT column_name, column_type, data_type, is_nullable, column_key, column_default, extra, column_comment
		FROM information_schema.columns
		WHERE table_schema = ? AND table_name = ?
		ORDER BY ordinal_position`
	rows, err := m.db.QueryContext(ctx, colQuery, database, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var name, colType, dataType, isNullable, colKey, extra string
		var dflt, colComment *string
		if err := rows.Scan(&name, &colType, &dataType, &isNullable, &colKey, &dflt, &extra, &colComment); err == nil {
			isPk := colKey == "PRI"
			if isPk {
				structure.PrimaryKeys = append(structure.PrimaryKeys, name)
			}
			defVal := ""
			if dflt != nil {
				defVal = *dflt
			}
			cmt := ""
			if colComment != nil {
				cmt = *colComment
			}
			structure.Columns = append(structure.Columns, driver.ColumnMeta{
				Name:         name,
				DataType:     colType,
				RawType:      dataType,
				IsNullable:   isNullable == "YES",
				IsPrimaryKey: isPk,
				IsAutoIncr:   strings.Contains(strings.ToLower(extra), "auto_increment"),
				DefaultValue: defVal,
				Comment:      cmt,
			})
		}
	}

	// 3. Fetch Indexes (including composite indexes)
	idxQuery := `SELECT index_name, non_unique, column_name, seq_in_index, index_type, comment
		FROM information_schema.statistics
		WHERE table_schema = ? AND table_name = ?
		ORDER BY index_name, seq_in_index`
	idxRows, err := m.db.QueryContext(ctx, idxQuery, database, table)
	if err == nil {
		defer idxRows.Close()
		type rawIdx struct {
			name     string
			isUnique bool
			isPk     bool
			columns  []string
			idxType  string
			comment  string
		}
		idxMap := make(map[string]*rawIdx)
		var idxOrder []string

		for idxRows.Next() {
			var idxName, colName, idxType string
			var nonUnique, seq int
			var idxComment *string
			if err := idxRows.Scan(&idxName, &nonUnique, &colName, &seq, &idxType, &idxComment); err == nil {
				if _, exists := idxMap[idxName]; !exists {
					cmt := ""
					if idxComment != nil {
						cmt = *idxComment
					}
					idxMap[idxName] = &rawIdx{
						name:     idxName,
						isUnique: nonUnique == 0,
						isPk:     idxName == "PRIMARY",
						columns:  []string{},
						idxType:  idxType,
						comment:  cmt,
					}
					idxOrder = append(idxOrder, idxName)
				}
				idxMap[idxName].columns = append(idxMap[idxName].columns, colName)
			}
		}

		for _, name := range idxOrder {
			item := idxMap[name]
			structure.Indexes = append(structure.Indexes, driver.IndexMeta{
				Name:      item.name,
				Columns:   item.columns,
				IsUnique:  item.isUnique,
				IsPrimary: item.isPk,
				Type:      item.idxType,
				Method:    item.idxType,
				Comment:   item.comment,
			})
		}
	}

	// 3b. Fetch Foreign Keys (with ON UPDATE / ON DELETE rules)
	fkQuery := `SELECT kcu.constraint_name, kcu.column_name,
			COALESCE(kcu.referenced_table_schema, ''), kcu.referenced_table_name, kcu.referenced_column_name,
			rc.update_rule, rc.delete_rule
		FROM information_schema.key_column_usage kcu
		JOIN information_schema.referential_constraints rc
			ON rc.constraint_schema = kcu.constraint_schema
			AND rc.constraint_name = kcu.constraint_name
			AND rc.table_name = kcu.table_name
		WHERE kcu.table_schema = ? AND kcu.table_name = ?
			AND kcu.referenced_table_name IS NOT NULL
		ORDER BY kcu.constraint_name, kcu.ordinal_position`
	if fkRows, fkErr := m.db.QueryContext(ctx, fkQuery, database, table); fkErr == nil {
		defer fkRows.Close()
		for fkRows.Next() {
			var cName, col, refSchema, refTable, refCol, onUpdate, onDelete string
			if err := fkRows.Scan(&cName, &col, &refSchema, &refTable, &refCol, &onUpdate, &onDelete); err == nil {
				structure.ForeignKeys = append(structure.ForeignKeys, driver.ForeignKeyMeta{
					ConstraintName: cName,
					ColumnName:     col,
					RefSchema:      refSchema,
					RefTable:       refTable,
					RefColumn:      refCol,
					OnUpdate:       onUpdate,
					OnDelete:       onDelete,
				})
			}
		}
	}

	// 4. Fetch DDL
	showQuery := fmt.Sprintf("SHOW CREATE TABLE %s.%s", quoteIdent(database), quoteIdent(table))
	if database == "" {
		showQuery = fmt.Sprintf("SHOW CREATE TABLE %s", quoteIdent(table))
	}
	var tblName, ddlStr string
	if err := m.db.QueryRowContext(ctx, showQuery).Scan(&tblName, &ddlStr); err == nil {
		structure.DDL = ddlStr
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
		if _, err := conn.ExecContext(ctx, fmt.Sprintf("USE %s", quoteIdent(req.Database))); err != nil {
			return nil, fmt.Errorf("error switching to database '%s': %w", req.Database, err)
		}
	}

	return driver.ExecuteStatements(ctx, conn, req)
}

func (m *MySQLDriver) BeginTx(ctx context.Context, database string) (*sql.Tx, error) {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	if database != "" && database != "main" {
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("USE %s", quoteIdent(database))); err != nil {
			_ = tx.Rollback()
			return nil, fmt.Errorf("error switching to database '%s': %w", database, err)
		}
	}
	return tx, nil
}

func (m *MySQLDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	effectiveSchema := schema
	if effectiveSchema == "" && database != "" && database != "main" {
		effectiveSchema = database
	}
	prefix := fmt.Sprintf("`%s`.`%s`", effectiveSchema, table)
	if effectiveSchema == "" {
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
			stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);", prefix, strings.Join(cols, ", "), strings.Join(vals, ", "))
			if len(cols) == 0 {
				stmt = fmt.Sprintf("INSERT INTO %s () VALUES ();", prefix)
			}
			statements = append(statements, stmt)
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

var isoDateTimeRegex = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(?:Z|[+-]\d{2}:?\d{2})?$`)

func normalizeMySQLValue(v any) any {
	if v == nil {
		return nil
	}
	s, ok := v.(string)
	if !ok {
		return v
	}
	trimmed := strings.TrimSpace(s)
	if strings.EqualFold(trimmed, "null") || strings.EqualFold(trimmed, "<null>") {
		return nil
	}
	if match := isoDateTimeRegex.FindStringSubmatch(trimmed); len(match) == 3 {
		return match[1] + " " + match[2]
	}
	return v
}

func (m *MySQLDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	effectiveSchema := schema
	if effectiveSchema == "" && database != "" && database != "main" {
		effectiveSchema = database
	}
	prefix := fmt.Sprintf("`%s`.`%s`", effectiveSchema, table)
	if effectiveSchema == "" {
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
				vals = append(vals, normalizeMySQLValue(v))
			}
			stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", prefix, strings.Join(cols, ", "), strings.Join(placeholders, ", "))
			if len(cols) == 0 {
				stmt = fmt.Sprintf("INSERT INTO %s () VALUES ()", prefix)
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
			for k, v := range c.Changes {
				sets = append(sets, fmt.Sprintf("`%s` = ?", k))
				vals = append(vals, normalizeMySQLValue(v))
			}
			where := []string{}
			for k, v := range c.PrimaryKey {
				where = append(where, fmt.Sprintf("`%s` = ?", k))
				vals = append(vals, normalizeMySQLValue(v))
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
				vals = append(vals, normalizeMySQLValue(v))
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
	v = normalizeMySQLValue(v)
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

