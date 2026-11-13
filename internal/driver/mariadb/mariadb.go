package mariadb

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"dhub/internal/driver"
	mysqldriver "github.com/go-sql-driver/mysql"
)

type MariaDBDriver struct {
	db        *sql.DB
	dsn       string
	defaultDB string
}

func NewMariaDBDriver(dsn string) (*MariaDBDriver, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(time.Hour)

	var defaultDB string
	if cfg, parseErr := mysqldriver.ParseDSN(dsn); parseErr == nil {
		defaultDB = cfg.DBName
	}

	return &MariaDBDriver{db: db, dsn: dsn, defaultDB: defaultDB}, nil
}

// quoteIdent quotes a MariaDB identifier, escaping embedded backticks.
func quoteIdent(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
}

func (m *MariaDBDriver) resolveDatabase(database, schema string) string {
	s := strings.TrimSpace(schema)
	if s != "" && s != "main" {
		return s
	}
	d := strings.TrimSpace(database)
	if d != "" && d != "main" {
		return d
	}
	return m.defaultDB
}

func (m *MariaDBDriver) Ping(ctx context.Context) error {
	return m.db.PingContext(ctx)
}

func (m *MariaDBDriver) Close() error {
	if m.db != nil {
		return m.db.Close()
	}
	return nil
}

func (m *MariaDBDriver) ListDatabases(ctx context.Context) ([]string, error) {
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

func (m *MariaDBDriver) ListSchemas(ctx context.Context, database string) ([]string, error) {
	targetDB := m.resolveDatabase(database, "")
	return []string{targetDB}, nil
}

// formatBytes converts byte count into a human-readable string (e.g. 1.2 MB).
func formatBytes(b int64) string {
	if b <= 0 {
		return ""
	}
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

func (m *MariaDBDriver) ListObjects(ctx context.Context, database, schema string) ([]driver.ObjectSummary, error) {
	targetDB := m.resolveDatabase(database, schema)

	query := `SELECT table_name, table_type, COALESCE(table_rows, 0), COALESCE(data_length + index_length, 0), COALESCE(table_comment, '')
		FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name`
	rows, err := m.db.QueryContext(ctx, query, targetDB)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var objects []driver.ObjectSummary
	for rows.Next() {
		var name, objType, comment string
		var rowsEst, sizeBytes int64
		if err := rows.Scan(&name, &objType, &rowsEst, &sizeBytes, &comment); err == nil {
			upperType := strings.ToUpper(strings.TrimSpace(objType))
			t := "table"
			if strings.Contains(upperType, "VIEW") {
				t = "view"
			} else if upperType == "SEQUENCE" {
				t = "sequence"
				rowsEst = -1
			}
			objects = append(objects, driver.ObjectSummary{
				Schema:      targetDB,
				Name:        name,
				Type:        t,
				RowEstimate: rowsEst,
				SizePretty:  formatBytes(sizeBytes),
				Comment:     comment,
			})
		}
	}

	// Routines (Procedures & Functions)
	rRows, rErr := m.db.QueryContext(ctx, `SELECT ROUTINE_NAME, COALESCE(ROUTINE_TYPE, 'PROCEDURE'), COALESCE(ROUTINE_COMMENT, '') FROM information_schema.routines WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_NAME`, targetDB)
	if rErr == nil {
		defer rRows.Close()
		for rRows.Next() {
			var rName, rType, rComment string
			if err := rRows.Scan(&rName, &rType, &rComment); err == nil {
				formattedComment := strings.TrimSpace(fmt.Sprintf("[%s] %s", strings.ToUpper(strings.TrimSpace(rType)), rComment))
				objects = append(objects, driver.ObjectSummary{
					Schema:      targetDB,
					Name:        rName,
					Type:        "routine",
					RowEstimate: -1,
					Comment:     formattedComment,
				})
			}
		}
	}

	// Triggers
	tRows, tErr := m.db.QueryContext(ctx, `SELECT TRIGGER_NAME, COALESCE(EVENT_OBJECT_TABLE, ''), COALESCE(ACTION_TIMING, ''), COALESCE(EVENT_MANIPULATION, '') FROM information_schema.triggers WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME`, targetDB)
	if tErr == nil {
		defer tRows.Close()
		for tRows.Next() {
			var tName, parentTbl, timing, event string
			if err := tRows.Scan(&tName, &parentTbl, &timing, &event); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema:      targetDB,
					Name:        tName,
					Type:        "trigger",
					RowEstimate: -1,
					ParentTable: parentTbl,
					Comment:     strings.TrimSpace(timing + " " + event),
				})
			}
		}
	}

	// Events (Scheduled Tasks)
	eRows, eErr := m.db.QueryContext(ctx, `SELECT EVENT_NAME, COALESCE(EVENT_COMMENT, '') FROM information_schema.events WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME`, targetDB)
	if eErr == nil {
		defer eRows.Close()
		for eRows.Next() {
			var eName, eComment string
			if err := eRows.Scan(&eName, &eComment); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema:      targetDB,
					Name:        eName,
					Type:        "event",
					RowEstimate: -1,
					Comment:     eComment,
				})
			}
		}
	}

	return objects, nil
}

func (m *MariaDBDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	targetDB := m.resolveDatabase(database, schema)

	structure := &driver.TableStructure{
		Schema:           targetDB,
		Name:             table,
		Columns:          []driver.ColumnMeta{},
		PrimaryKeys:      []string{},
		ForeignKeys:      []driver.ForeignKeyMeta{},
		Indexes:          []driver.IndexMeta{},
		CheckConstraints: []driver.CheckConstraintMeta{},
	}

	// 1. Fetch table options (Engine, Collation, Comment)
	tblQuery := `SELECT engine, table_collation, table_comment
		FROM information_schema.tables
		WHERE table_schema = ? AND table_name = ?`
	var engine, collation, tblComment *string
	if err := m.db.QueryRowContext(ctx, tblQuery, targetDB, table).Scan(&engine, &collation, &tblComment); err == nil {
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

	// 2. Fetch columns with accurate types, defaults, comments, and generation_expression
	colQuery := `SELECT column_name, column_type, data_type, is_nullable, column_key, column_default, extra, column_comment, COALESCE(generation_expression, '')
		FROM information_schema.columns
		WHERE table_schema = ? AND table_name = ?
		ORDER BY ordinal_position`
	rows, err := m.db.QueryContext(ctx, colQuery, targetDB, table)
	hasGenExpr := true
	if err != nil {
		hasGenExpr = false
		colQueryFallback := `SELECT column_name, column_type, data_type, is_nullable, column_key, column_default, extra, column_comment
			FROM information_schema.columns
			WHERE table_schema = ? AND table_name = ?
			ORDER BY ordinal_position`
		rows, err = m.db.QueryContext(ctx, colQueryFallback, targetDB, table)
		if err != nil {
			return nil, err
		}
	}
	defer rows.Close()

	for rows.Next() {
		var name, colType, dataType, isNullable, colKey, extra, genExpr string
		var dflt, colComment *string
		var scanErr error
		if hasGenExpr {
			scanErr = rows.Scan(&name, &colType, &dataType, &isNullable, &colKey, &dflt, &extra, &colComment, &genExpr)
		} else {
			scanErr = rows.Scan(&name, &colType, &dataType, &isNullable, &colKey, &dflt, &extra, &colComment)
		}
		if scanErr == nil {
			isPk := colKey == "PRI"
			if isPk {
				structure.PrimaryKeys = append(structure.PrimaryKeys, name)
			}
			defVal := ""
			if dflt != nil {
				defVal = *dflt
			}
			if genExpr != "" && defVal == "" {
				defVal = genExpr
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
	idxRows, err := m.db.QueryContext(ctx, idxQuery, targetDB, table)
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
	if fkRows, fkErr := m.db.QueryContext(ctx, fkQuery, targetDB, table); fkErr == nil {
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

	// 3c. Fetch Check Constraints (MariaDB 10.2.1+)
	chkQuery := `SELECT constraint_name, check_clause
		FROM information_schema.check_constraints
		WHERE constraint_schema = ? AND table_name = ?
		ORDER BY constraint_name`
	chkRows, chkErr := m.db.QueryContext(ctx, chkQuery, targetDB, table)
	if chkErr != nil {
		// Fallback join with table_constraints if table_name is absent in information_schema.check_constraints
		chkQueryFallback := `SELECT tc.constraint_name, cc.check_clause
			FROM information_schema.table_constraints tc
			JOIN information_schema.check_constraints cc
				ON tc.constraint_schema = cc.constraint_schema
				AND tc.constraint_name = cc.constraint_name
			WHERE tc.table_schema = ? AND tc.table_name = ?
				AND tc.constraint_type = 'CHECK'
			ORDER BY tc.constraint_name`
		chkRows, chkErr = m.db.QueryContext(ctx, chkQueryFallback, targetDB, table)
	}
	if chkErr == nil {
		defer chkRows.Close()
		for chkRows.Next() {
			var cName, clause string
			if err := chkRows.Scan(&cName, &clause); err == nil {
				structure.CheckConstraints = append(structure.CheckConstraints, driver.CheckConstraintMeta{
					Name:   cName,
					Clause: clause,
				})
			}
		}
	}

	// 4. Fetch DDL (handles Tables, Sequences, and 4-column Views)
	showQuery := fmt.Sprintf("SHOW CREATE TABLE %s.%s", quoteIdent(targetDB), quoteIdent(table))
	if targetDB == "" {
		showQuery = fmt.Sprintf("SHOW CREATE TABLE %s", quoteIdent(table))
	}
	if showRows, showErr := m.db.QueryContext(ctx, showQuery); showErr == nil {
		defer showRows.Close()
		if cols, colErr := showRows.Columns(); colErr == nil && len(cols) >= 2 && showRows.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if scanErr := showRows.Scan(ptrs...); scanErr == nil {
				switch v := vals[1].(type) {
				case string:
					structure.DDL = v
				case []byte:
					structure.DDL = string(v)
				}
			}
		}
	}

	return structure, nil
}

func (m *MariaDBDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	conn, err := m.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	targetDB := m.resolveDatabase(req.Database, req.Schema)
	if targetDB != "" {
		if _, err := conn.ExecContext(ctx, fmt.Sprintf("USE %s", quoteIdent(targetDB))); err != nil {
			return nil, fmt.Errorf("error switching to database '%s': %w", targetDB, err)
		}
		if m.defaultDB != "" && targetDB != m.defaultDB {
			defer func() {
				_, _ = conn.ExecContext(context.Background(), fmt.Sprintf("USE %s", quoteIdent(m.defaultDB)))
			}()
		}
	}

	return driver.ExecuteStatements(ctx, conn, req)
}

func (m *MariaDBDriver) BeginTx(ctx context.Context, database string) (*sql.Tx, error) {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	targetDB := m.resolveDatabase(database, "")
	if targetDB != "" {
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("USE %s", quoteIdent(targetDB))); err != nil {
			_ = tx.Rollback()
			return nil, fmt.Errorf("error switching to database '%s': %w", targetDB, err)
		}
	}
	return tx, nil
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func (m *MariaDBDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	effectiveSchema := m.resolveDatabase(database, schema)
	prefix := fmt.Sprintf("%s.%s", quoteIdent(effectiveSchema), quoteIdent(table))
	if effectiveSchema == "" {
		prefix = quoteIdent(table)
	}

	for _, c := range changes {
		switch c.Type {
		case "insert":
			cols := []string{}
			vals := []string{}
			for _, k := range sortedKeys(c.Changes) {
				cols = append(cols, quoteIdent(k))
				vals = append(vals, formatSQLVal(c.Changes[k]))
			}
			stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);", prefix, strings.Join(cols, ", "), strings.Join(vals, ", "))
			if len(cols) == 0 {
				stmt = fmt.Sprintf("INSERT INTO %s () VALUES ();", prefix)
			}
			statements = append(statements, stmt)
		case "update":
			sets := []string{}
			for _, k := range sortedKeys(c.Changes) {
				sets = append(sets, fmt.Sprintf("%s = %s", quoteIdent(k), formatSQLVal(c.Changes[k])))
			}
			where := []string{}
			for _, k := range sortedKeys(c.PrimaryKey) {
				where = append(where, fmt.Sprintf("%s = %s", quoteIdent(k), formatSQLVal(c.PrimaryKey[k])))
			}
			statements = append(statements, fmt.Sprintf("UPDATE %s SET %s WHERE %s;", prefix, strings.Join(sets, ", "), strings.Join(where, " AND ")))
		case "delete":
			where := []string{}
			for _, k := range sortedKeys(c.PrimaryKey) {
				where = append(where, fmt.Sprintf("%s = %s", quoteIdent(k), formatSQLVal(c.PrimaryKey[k])))
			}
			statements = append(statements, fmt.Sprintf("DELETE FROM %s WHERE %s;", prefix, strings.Join(where, " AND ")))
		}
	}
	return statements, nil
}

var isoDateTimeRegex = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(?:Z|[+-]\d{2}:?\d{2})?$`)

func normalizeMariaDBValue(v any) any {
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

func (m *MariaDBDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	effectiveSchema := m.resolveDatabase(database, schema)
	if effectiveSchema != "" {
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("USE %s", quoteIdent(effectiveSchema))); err != nil {
			return 0, fmt.Errorf("error switching to database '%s': %w", effectiveSchema, err)
		}
	}
	prefix := fmt.Sprintf("%s.%s", quoteIdent(effectiveSchema), quoteIdent(table))
	if effectiveSchema == "" {
		prefix = quoteIdent(table)
	}

	var totalAffected int64
	for _, c := range changes {
		switch c.Type {
		case "insert":
			cols := []string{}
			placeholders := []string{}
			vals := []any{}
			for _, k := range sortedKeys(c.Changes) {
				cols = append(cols, quoteIdent(k))
				placeholders = append(placeholders, "?")
				vals = append(vals, normalizeMariaDBValue(c.Changes[k]))
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
			for _, k := range sortedKeys(c.Changes) {
				sets = append(sets, fmt.Sprintf("%s = ?", quoteIdent(k)))
				vals = append(vals, normalizeMariaDBValue(c.Changes[k]))
			}
			where := []string{}
			for _, k := range sortedKeys(c.PrimaryKey) {
				where = append(where, fmt.Sprintf("%s = ?", quoteIdent(k)))
				vals = append(vals, normalizeMariaDBValue(c.PrimaryKey[k]))
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
			for _, k := range sortedKeys(c.PrimaryKey) {
				where = append(where, fmt.Sprintf("%s = ?", quoteIdent(k)))
				vals = append(vals, normalizeMariaDBValue(c.PrimaryKey[k]))
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
	v = normalizeMariaDBValue(v)
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

