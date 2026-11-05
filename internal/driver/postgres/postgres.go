package postgres

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
	_ "github.com/jackc/pgx/v5/stdlib"
)

// PostgresDriver keeps one connection pool per database. PostgreSQL cannot
// switch databases within a single connection, so every database the user
// browses or queries gets its own lazily-created pool derived from the same
// connection string (and therefore the same SSH tunnel / credentials).
type PostgresDriver struct {
	db        *sql.DB // pool for the default database
	connStr   string
	defaultDB string

	mu    sync.Mutex
	pools map[string]*sql.DB // extra pools keyed by database name
}

func openPool(connStr string) (*sql.DB, error) {
	db, err := sql.Open("pgx", connStr)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(time.Hour)
	return db, nil
}

func NewPostgresDriver(connStr string) (*PostgresDriver, error) {
	db, err := openPool(connStr)
	if err != nil {
		return nil, err
	}
	defaultDB := ""
	if u, perr := url.Parse(connStr); perr == nil {
		defaultDB = strings.TrimPrefix(u.Path, "/")
	}
	return &PostgresDriver{
		db:        db,
		connStr:   connStr,
		defaultDB: defaultDB,
		pools:     make(map[string]*sql.DB),
	}, nil
}

// dbFor returns the pool for the requested database, creating it on first use.
// Empty names, "main" (UI placeholder) and the default database use the default pool.
func (p *PostgresDriver) dbFor(database string) (*sql.DB, error) {
	database = strings.TrimSpace(database)
	if database == "" || database == "main" || database == p.defaultDB {
		return p.db, nil
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if pool, ok := p.pools[database]; ok {
		return pool, nil
	}

	u, err := url.Parse(p.connStr)
	if err != nil {
		return nil, fmt.Errorf("invalid connection string: %w", err)
	}
	u.Path = "/" + database
	u.RawPath = ""

	pool, err := openPool(u.String())
	if err != nil {
		return nil, err
	}
	p.pools[database] = pool
	return pool, nil
}

func (p *PostgresDriver) Ping(ctx context.Context) error {
	return p.db.PingContext(ctx)
}

func (p *PostgresDriver) Close() error {
	p.mu.Lock()
	for name, pool := range p.pools {
		_ = pool.Close()
		delete(p.pools, name)
	}
	p.mu.Unlock()

	if p.db != nil {
		return p.db.Close()
	}
	return nil
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func qualifiedName(schema, table string) string {
	if schema == "" {
		return quoteIdent(table)
	}
	return quoteIdent(schema) + "." + quoteIdent(table)
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
	db, err := p.dbFor(database)
	if err != nil {
		return nil, err
	}
	query := `SELECT schema_name FROM information_schema.schemata
		WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
		ORDER BY schema_name;`
	rows, err := db.QueryContext(ctx, query)
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
	db, err := p.dbFor(database)
	if err != nil {
		return nil, err
	}
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

	rows, err := db.QueryContext(ctx, query, schema)
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

	// Materialized Views
	matRows, matErr := db.QueryContext(ctx, `SELECT matviewname FROM pg_matviews WHERE schemaname = $1 ORDER BY matviewname`, schema)
	if matErr == nil {
		defer matRows.Close()
		for matRows.Next() {
			var mName string
			if err := matRows.Scan(&mName); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema:      schema,
					Name:        mName,
					Type:        "materialized_view",
					RowEstimate: -1,
				})
			}
		}
	}

	// Routines (Functions & Stored Procedures)
	routineRows, rErr := db.QueryContext(ctx, `SELECT routine_name FROM information_schema.routines WHERE routine_schema = $1 ORDER BY routine_name`, schema)
	if rErr == nil {
		defer routineRows.Close()
		for routineRows.Next() {
			var rName string
			if err := routineRows.Scan(&rName); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema:      schema,
					Name:        rName,
					Type:        "routine",
					RowEstimate: -1,
				})
			}
		}
	}

	// Triggers
	triggerRows, tErr := db.QueryContext(ctx, `SELECT DISTINCT trigger_name FROM information_schema.triggers WHERE trigger_schema = $1 ORDER BY trigger_name`, schema)
	if tErr == nil {
		defer triggerRows.Close()
		for triggerRows.Next() {
			var tName string
			if err := triggerRows.Scan(&tName); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema:      schema,
					Name:        tName,
					Type:        "trigger",
					RowEstimate: -1,
				})
			}
		}
	}

	return objects, nil
}

func (p *PostgresDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	db, err := p.dbFor(database)
	if err != nil {
		return nil, err
	}

	structure := &driver.TableStructure{
		Schema:      schema,
		Name:        table,
		Columns:     []driver.ColumnMeta{},
		PrimaryKeys: []string{},
		ForeignKeys: []driver.ForeignKeyMeta{},
		Indexes:     []driver.IndexMeta{},
	}

	// 1. Get Primary Keys (ordered by position in the key)
	pkQuery := `
		SELECT kcu.column_name
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
			ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
		WHERE tc.constraint_type = 'PRIMARY KEY'
			AND tc.table_schema = $1 AND tc.table_name = $2
		ORDER BY kcu.ordinal_position;`
	pkRows, err := db.QueryContext(ctx, pkQuery, schema, table)
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
		SELECT column_name, data_type, is_nullable, column_default, is_identity
		FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = $2
		ORDER BY ordinal_position;`
	rows, err := db.QueryContext(ctx, colQuery, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	colIndex := make(map[string]int)
	for rows.Next() {
		var name, dataType, isNullable string
		var dflt, isIdentity *string
		if err := rows.Scan(&name, &dataType, &isNullable, &dflt, &isIdentity); err == nil {
			defVal := ""
			if dflt != nil {
				defVal = *dflt
			}
			isAuto := strings.HasPrefix(strings.ToLower(defVal), "nextval(") ||
				(isIdentity != nil && strings.EqualFold(*isIdentity, "YES"))
			colIndex[name] = len(structure.Columns)
			structure.Columns = append(structure.Columns, driver.ColumnMeta{
				Name:         name,
				DataType:     dataType,
				RawType:      dataType,
				IsNullable:   isNullable == "YES",
				IsPrimaryKey: pkSet[name],
				IsAutoIncr:   isAuto,
				DefaultValue: defVal,
			})
		}
	}

	// 2b. Column & table comments (best effort)
	cmtQuery := `
		SELECT a.attnum, COALESCE(a.attname, ''), d.description
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
		JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = COALESCE(a.attnum, 0)
		WHERE n.nspname = $1 AND c.relname = $2;`
	if cRows, cErr := db.QueryContext(ctx, cmtQuery, schema, table); cErr == nil {
		defer cRows.Close()
		for cRows.Next() {
			var attnum int
			var attname string
			var desc *string
			if err := cRows.Scan(&attnum, &attname, &desc); err != nil || desc == nil {
				continue
			}
			if attnum == 0 {
				structure.Comment = *desc
			} else if idx, ok := colIndex[attname]; ok {
				structure.Columns[idx].Comment = *desc
			}
		}
	}

	// 3. Get Foreign Keys (with ON UPDATE / ON DELETE rules)
	fkQuery := `
		SELECT
			tc.constraint_name, kcu.column_name,
			ccu.table_schema AS foreign_table_schema,
			ccu.table_name AS foreign_table_name,
			ccu.column_name AS foreign_column_name,
			rc.update_rule, rc.delete_rule
		FROM information_schema.table_constraints AS tc
		JOIN information_schema.key_column_usage AS kcu
			ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
		JOIN information_schema.constraint_column_usage AS ccu
			ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
		JOIN information_schema.referential_constraints AS rc
			ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
		WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2;`
	fkRows, err := db.QueryContext(ctx, fkQuery, schema, table)
	if err == nil {
		defer fkRows.Close()
		for fkRows.Next() {
			var cName, col, fSchema, fTable, fCol, onUpdate, onDelete string
			if err := fkRows.Scan(&cName, &col, &fSchema, &fTable, &fCol, &onUpdate, &onDelete); err == nil {
				structure.ForeignKeys = append(structure.ForeignKeys, driver.ForeignKeyMeta{
					ConstraintName: cName,
					ColumnName:     col,
					RefSchema:      fSchema,
					RefTable:       fTable,
					RefColumn:      fCol,
					OnUpdate:       onUpdate,
					OnDelete:       onDelete,
				})
			}
		}
	}

	// 4. Get Indexes (composite indexes grouped by name, columns in key order)
	idxQuery := `
		SELECT i.relname, ix.indisunique, ix.indisprimary, am.amname, a.attname
		FROM pg_class t
		JOIN pg_namespace n ON n.oid = t.relnamespace
		JOIN pg_index ix ON ix.indrelid = t.oid
		JOIN pg_class i ON i.oid = ix.indexrelid
		JOIN pg_am am ON am.oid = i.relam
		JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
		JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
		WHERE n.nspname = $1 AND t.relname = $2
		ORDER BY i.relname, k.ord;`
	if idxRows, idxErr := db.QueryContext(ctx, idxQuery, schema, table); idxErr == nil {
		defer idxRows.Close()
		idxPos := make(map[string]int)
		for idxRows.Next() {
			var idxName, method, colName string
			var isUnique, isPrimary bool
			if err := idxRows.Scan(&idxName, &isUnique, &isPrimary, &method, &colName); err != nil {
				continue
			}
			pos, exists := idxPos[idxName]
			if !exists {
				pos = len(structure.Indexes)
				idxPos[idxName] = pos
				structure.Indexes = append(structure.Indexes, driver.IndexMeta{
					Name:      idxName,
					Columns:   []string{},
					IsUnique:  isUnique,
					IsPrimary: isPrimary,
					Type:      method,
					Method:    method,
				})
			}
			structure.Indexes[pos].Columns = append(structure.Indexes[pos].Columns, colName)
		}
	}

	// 5. Generate DDL
	structure.DDL = generatePostgresDDL(schema, table, structure)

	return structure, nil
}

func generatePostgresDDL(schema, table string, s *driver.TableStructure) string {
	var sb strings.Builder
	prefix := qualifiedName(schema, table)
	if schema == "" || schema == "public" {
		prefix = quoteIdent(table)
	}
	sb.WriteString(fmt.Sprintf("CREATE TABLE %s (\n", prefix))

	var defs []string
	for _, c := range s.Columns {
		def := fmt.Sprintf("  %s %s", quoteIdent(c.Name), c.DataType)
		if !c.IsNullable {
			def += " NOT NULL"
		}
		if c.DefaultValue != "" {
			def += " DEFAULT " + c.DefaultValue
		}
		defs = append(defs, def)
	}

	if len(s.PrimaryKeys) > 0 {
		var pkCols []string
		for _, pk := range s.PrimaryKeys {
			pkCols = append(pkCols, quoteIdent(pk))
		}
		defs = append(defs, fmt.Sprintf("  CONSTRAINT %s PRIMARY KEY (%s)", quoteIdent(table+"_pkey"), strings.Join(pkCols, ", ")))
	}

	for _, fk := range s.ForeignKeys {
		cName := fk.ConstraintName
		if cName == "" {
			cName = fmt.Sprintf("%s_%s_fkey", table, fk.ColumnName)
		}
		def := fmt.Sprintf("  CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s)",
			quoteIdent(cName), quoteIdent(fk.ColumnName), qualifiedName(fk.RefSchema, fk.RefTable), quoteIdent(fk.RefColumn))
		if fk.OnUpdate != "" && !strings.EqualFold(fk.OnUpdate, "NO ACTION") {
			def += " ON UPDATE " + fk.OnUpdate
		}
		if fk.OnDelete != "" && !strings.EqualFold(fk.OnDelete, "NO ACTION") {
			def += " ON DELETE " + fk.OnDelete
		}
		defs = append(defs, def)
	}

	sb.WriteString(strings.Join(defs, ",\n"))
	sb.WriteString("\n);")

	for _, idx := range s.Indexes {
		if idx.IsPrimary {
			continue
		}
		var cols []string
		for _, c := range idx.Columns {
			cols = append(cols, quoteIdent(c))
		}
		unique := ""
		if idx.IsUnique {
			unique = "UNIQUE "
		}
		method := ""
		if idx.Method != "" && !strings.EqualFold(idx.Method, "btree") {
			method = " USING " + idx.Method
		}
		sb.WriteString(fmt.Sprintf("\n\nCREATE %sINDEX %s ON %s%s (%s);", unique, quoteIdent(idx.Name), prefix, method, strings.Join(cols, ", ")))
	}

	return sb.String()
}

func (p *PostgresDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	db, err := p.dbFor(req.Database)
	if err != nil {
		return nil, err
	}

	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	if req.Schema != "" && req.Schema != "main" {
		_, _ = conn.ExecContext(ctx, fmt.Sprintf(`SET search_path TO %s, public`, quoteIdent(req.Schema)))
	}

	return driver.ExecuteStatements(ctx, conn, req)
}

func (p *PostgresDriver) BeginTx(ctx context.Context, database string) (*sql.Tx, error) {
	db, err := p.dbFor(database)
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

func (p *PostgresDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	prefix := qualifiedName(schema, table)

	for _, c := range changes {
		switch c.Type {
		case "insert":
			cols := []string{}
			vals := []string{}
			for _, k := range sortedKeys(c.Changes) {
				cols = append(cols, quoteIdent(k))
				vals = append(vals, formatSQLVal(c.Changes[k]))
			}
			stmt := fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s);`, prefix, strings.Join(cols, ", "), strings.Join(vals, ", "))
			if len(cols) == 0 {
				stmt = fmt.Sprintf(`INSERT INTO %s DEFAULT VALUES;`, prefix)
			}
			statements = append(statements, stmt)
		case "update":
			sets := []string{}
			for _, k := range sortedKeys(c.Changes) {
				sets = append(sets, fmt.Sprintf(`%s = %s`, quoteIdent(k), formatSQLVal(c.Changes[k])))
			}
			where := []string{}
			for _, k := range sortedKeys(c.PrimaryKey) {
				where = append(where, fmt.Sprintf(`%s = %s`, quoteIdent(k), formatSQLVal(c.PrimaryKey[k])))
			}
			statements = append(statements, fmt.Sprintf(`UPDATE %s SET %s WHERE %s;`, prefix, strings.Join(sets, ", "), strings.Join(where, " AND ")))
		case "delete":
			where := []string{}
			for _, k := range sortedKeys(c.PrimaryKey) {
				where = append(where, fmt.Sprintf(`%s = %s`, quoteIdent(k), formatSQLVal(c.PrimaryKey[k])))
			}
			statements = append(statements, fmt.Sprintf(`DELETE FROM %s WHERE %s;`, prefix, strings.Join(where, " AND ")))
		}
	}
	return statements, nil
}

func (p *PostgresDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	db, err := p.dbFor(database)
	if err != nil {
		return 0, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	prefix := qualifiedName(schema, table)

	var totalAffected int64
	for _, c := range changes {
		switch c.Type {
		case "insert":
			cols := []string{}
			placeholders := []string{}
			vals := []any{}
			idx := 1
			for _, k := range sortedKeys(c.Changes) {
				cols = append(cols, quoteIdent(k))
				placeholders = append(placeholders, fmt.Sprintf("$%d", idx))
				vals = append(vals, c.Changes[k])
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
			for _, k := range sortedKeys(c.Changes) {
				sets = append(sets, fmt.Sprintf(`%s = $%d`, quoteIdent(k), idx))
				vals = append(vals, c.Changes[k])
				idx++
			}
			where := []string{}
			for _, k := range sortedKeys(c.PrimaryKey) {
				where = append(where, fmt.Sprintf(`%s = $%d`, quoteIdent(k), idx))
				vals = append(vals, c.PrimaryKey[k])
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
			for _, k := range sortedKeys(c.PrimaryKey) {
				where = append(where, fmt.Sprintf(`%s = $%d`, quoteIdent(k), idx))
				vals = append(vals, c.PrimaryKey[k])
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
