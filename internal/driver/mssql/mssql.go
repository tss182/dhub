package mssql

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
	_ "github.com/microsoft/go-mssqldb"
)

type MSSQLDriver struct {
	db        *sql.DB
	connStr   string
	defaultDB string

	mu    sync.Mutex
	pools map[string]*sql.DB
}

func openPool(connStr string) (*sql.DB, error) {
	db, err := sql.Open("sqlserver", connStr)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(time.Hour)
	return db, nil
}

func NewMSSQLDriver(connStr string) (*MSSQLDriver, error) {
	db, err := openPool(connStr)
	if err != nil {
		return nil, err
	}

	defaultDB := ""
	if u, perr := url.Parse(connStr); perr == nil {
		defaultDB = u.Query().Get("database")
	}
	if defaultDB == "" {
		defaultDB = "master"
	}

	return &MSSQLDriver{
		db:        db,
		connStr:   connStr,
		defaultDB: defaultDB,
		pools:     make(map[string]*sql.DB),
	}, nil
}

func (m *MSSQLDriver) dbFor(database string) (*sql.DB, error) {
	database = strings.TrimSpace(database)
	if database == "" || database == "main" || database == m.defaultDB {
		return m.db, nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if pool, ok := m.pools[database]; ok {
		return pool, nil
	}

	u, err := url.Parse(m.connStr)
	if err != nil {
		return nil, fmt.Errorf("invalid connection string: %w", err)
	}
	q := u.Query()
	q.Set("database", database)
	u.RawQuery = q.Encode()

	pool, err := openPool(u.String())
	if err != nil {
		return nil, err
	}
	m.pools[database] = pool
	return pool, nil
}

func (m *MSSQLDriver) Ping(ctx context.Context) error {
	return m.db.PingContext(ctx)
}

func (m *MSSQLDriver) Close() error {
	m.mu.Lock()
	for name, pool := range m.pools {
		_ = pool.Close()
		delete(m.pools, name)
	}
	m.mu.Unlock()

	if m.db != nil {
		return m.db.Close()
	}
	return nil
}

func quoteIdent(s string) string {
	return "[" + strings.ReplaceAll(s, "]", "]]") + "]"
}

func qualifiedName(schema, table string) string {
	if schema == "" {
		return quoteIdent(table)
	}
	return quoteIdent(schema) + "." + quoteIdent(table)
}

func (m *MSSQLDriver) ListDatabases(ctx context.Context) ([]string, error) {
	query := `SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name;`
	rows, err := m.db.QueryContext(ctx, query)
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

func (m *MSSQLDriver) ListSchemas(ctx context.Context, database string) ([]string, error) {
	db, err := m.dbFor(database)
	if err != nil {
		return nil, err
	}

	query := `SELECT schema_name FROM information_schema.schemata
		WHERE schema_name NOT IN ('guest', 'INFORMATION_SCHEMA', 'sys', 'db_owner', 'db_accessadmin', 'db_securityadmin', 'db_ddladmin', 'db_backupoperator', 'db_datareader', 'db_datawriter', 'db_denydatareader', 'db_denydatawriter')
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
	if len(schemas) == 0 {
		schemas = []string{"dbo"}
	}
	return schemas, nil
}

func (m *MSSQLDriver) ListObjects(ctx context.Context, database, schema string) ([]driver.ObjectSummary, error) {
	db, err := m.dbFor(database)
	if err != nil {
		return nil, err
	}

	query := `
		SELECT 
			s.name AS [schema],
			t.name AS [name],
			CASE WHEN t.type = 'V' THEN 'view' ELSE 'table' END AS [type],
			ISNULL(p.row_count, 0) AS [row_estimate]
		FROM (
			SELECT schema_id, name, type, object_id FROM sys.tables
			UNION ALL
			SELECT schema_id, name, type, object_id FROM sys.views
		) t
		JOIN sys.schemas s ON t.schema_id = s.schema_id
		LEFT JOIN (
			SELECT object_id, SUM(rows) AS row_count
			FROM sys.partitions
			WHERE index_id IN (0, 1)
			GROUP BY object_id
		) p ON t.object_id = p.object_id
		WHERE (@p1 = '' OR s.name = @p1)
		ORDER BY s.name, t.name;`

	rows, err := db.QueryContext(ctx, query, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var objects []driver.ObjectSummary
	for rows.Next() {
		var o driver.ObjectSummary
		if err := rows.Scan(&o.Schema, &o.Name, &o.Type, &o.RowEstimate); err == nil {
			objects = append(objects, o)
		}
	}

	// Add stored procedures and functions
	routineQuery := `
		SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE
		FROM INFORMATION_SCHEMA.ROUTINES
		WHERE (@p1 = '' OR ROUTINE_SCHEMA = @p1)
		ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME;`
	if rRows, rErr := db.QueryContext(ctx, routineQuery, schema); rErr == nil {
		defer rRows.Close()
		for rRows.Next() {
			var rSchema, rName, rType string
			if err := rRows.Scan(&rSchema, &rName, &rType); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema: rSchema,
					Name:   rName,
					Type:   "routine",
				})
			}
		}
	}

	return objects, nil
}

func (m *MSSQLDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	db, err := m.dbFor(database)
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

	// 1. Columns
	colQuery := `
		SELECT 
			c.COLUMN_NAME,
			c.DATA_TYPE,
			c.CHARACTER_MAXIMUM_LENGTH,
			c.NUMERIC_PRECISION,
			c.NUMERIC_SCALE,
			c.IS_NULLABLE,
			c.COLUMN_DEFAULT,
			COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS is_identity,
			CAST(ep.value AS NVARCHAR(MAX)) AS comment
		FROM INFORMATION_SCHEMA.COLUMNS c
		LEFT JOIN sys.extended_properties ep 
			ON ep.major_id = OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME))
			AND ep.minor_id = c.ORDINAL_POSITION
			AND ep.name = 'MS_Description'
		WHERE c.TABLE_SCHEMA = @p1 AND c.TABLE_NAME = @p2
		ORDER BY c.ORDINAL_POSITION;`

	rows, err := db.QueryContext(ctx, colQuery, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var colName, dataType, isNullableStr string
		var charLen sql.NullInt64
		var numPrec, numScale, isIdentity sql.NullInt64
		var colDef, comment sql.NullString

		if err := rows.Scan(&colName, &dataType, &charLen, &numPrec, &numScale, &isNullableStr, &colDef, &isIdentity, &comment); err != nil {
			continue
		}

		rawType := strings.ToLower(dataType)
		fullType := dataType

		switch rawType {
		case "char", "varchar", "nchar", "nvarchar", "binary", "varbinary":
			if charLen.Valid {
				if charLen.Int64 == -1 {
					fullType = fmt.Sprintf("%s(max)", dataType)
				} else if charLen.Int64 > 0 {
					fullType = fmt.Sprintf("%s(%d)", dataType, charLen.Int64)
				}
			}
		case "decimal", "numeric":
			if numPrec.Valid && numScale.Valid {
				fullType = fmt.Sprintf("%s(%d,%d)", dataType, numPrec.Int64, numScale.Int64)
			}
		}

		isNullable := strings.EqualFold(isNullableStr, "YES")
		isAutoIncr := isIdentity.Valid && isIdentity.Int64 == 1

		defaultValue := ""
		if colDef.Valid {
			defaultValue = colDef.String
		}

		commentVal := ""
		if comment.Valid {
			commentVal = comment.String
		}

		structure.Columns = append(structure.Columns, driver.ColumnMeta{
			Name:         colName,
			DataType:     fullType,
			RawType:      rawType,
			IsNullable:   isNullable,
			IsAutoIncr:   isAutoIncr,
			DefaultValue: defaultValue,
			Comment:      commentVal,
		})
	}

	// 2. Primary Keys
	pkQuery := `
		SELECT 
			kcu.COLUMN_NAME
		FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
		JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
			ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
			AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
			AND tc.TABLE_NAME = kcu.TABLE_NAME
		WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
		  AND tc.TABLE_SCHEMA = @p1
		  AND tc.TABLE_NAME = @p2
		ORDER BY kcu.ORDINAL_POSITION;`

	if pkRows, pkErr := db.QueryContext(ctx, pkQuery, schema, table); pkErr == nil {
		defer pkRows.Close()
		pkMap := make(map[string]bool)
		for pkRows.Next() {
			var pkCol string
			if err := pkRows.Scan(&pkCol); err == nil {
				structure.PrimaryKeys = append(structure.PrimaryKeys, pkCol)
				pkMap[pkCol] = true
			}
		}
		for i := range structure.Columns {
			if pkMap[structure.Columns[i].Name] {
				structure.Columns[i].IsPrimaryKey = true
			}
		}
	}

	// 3. Foreign Keys
	fkQuery := `
		SELECT 
			fk.name AS constraint_name,
			col.name AS column_name,
			ref_schema.name AS ref_schema,
			ref_table.name AS ref_table,
			ref_col.name AS ref_column,
			fk.update_referential_action_desc AS on_update,
			fk.delete_referential_action_desc AS on_delete
		FROM sys.foreign_keys fk
		JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
		JOIN sys.tables t ON fk.parent_object_id = t.object_id
		JOIN sys.schemas s ON t.schema_id = s.schema_id
		JOIN sys.columns col ON fkc.parent_object_id = col.object_id AND fkc.parent_column_id = col.column_id
		JOIN sys.tables ref_table ON fk.referenced_object_id = ref_table.object_id
		JOIN sys.schemas ref_schema ON ref_table.schema_id = ref_schema.schema_id
		JOIN sys.columns ref_col ON fkc.referenced_object_id = ref_col.object_id AND fkc.referenced_column_id = ref_col.column_id
		WHERE s.name = @p1 AND t.name = @p2
		ORDER BY fk.name, fkc.constraint_column_id;`

	if fkRows, fkErr := db.QueryContext(ctx, fkQuery, schema, table); fkErr == nil {
		defer fkRows.Close()
		for fkRows.Next() {
			var cName, colName, refSch, refTbl, refCol, onUpd, onDel string
			if err := fkRows.Scan(&cName, &colName, &refSch, &refTbl, &refCol, &onUpd, &onDel); err == nil {
				structure.ForeignKeys = append(structure.ForeignKeys, driver.ForeignKeyMeta{
					ConstraintName: cName,
					ColumnName:     colName,
					RefSchema:      refSch,
					RefTable:       refTbl,
					RefColumn:      refCol,
					OnUpdate:       strings.ReplaceAll(onUpd, "_", " "),
					OnDelete:       strings.ReplaceAll(onDel, "_", " "),
				})
			}
		}
	}

	// 4. Indexes
	idxQuery := `
		SELECT 
			i.name AS index_name,
			c.name AS column_name,
			i.is_unique,
			i.is_primary_key,
			i.type_desc
		FROM sys.indexes i
		JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
		JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
		JOIN sys.tables t ON i.object_id = t.object_id
		JOIN sys.schemas s ON t.schema_id = s.schema_id
		WHERE s.name = @p1 AND t.name = @p2 AND i.is_hypothetical = 0 AND i.name IS NOT NULL
		ORDER BY i.name, ic.key_ordinal;`

	if idxRows, idxErr := db.QueryContext(ctx, idxQuery, schema, table); idxErr == nil {
		defer idxRows.Close()
		idxPos := make(map[string]int)
		for idxRows.Next() {
			var idxName, colName, typeDesc string
			var isUnique, isPrimary bool
			if err := idxRows.Scan(&idxName, &colName, &isUnique, &isPrimary, &typeDesc); err != nil {
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
					Type:      typeDesc,
				})
			}
			structure.Indexes[pos].Columns = append(structure.Indexes[pos].Columns, colName)
		}
	}

	// 5. Generate DDL
	structure.DDL = generateMSSQLDDL(schema, table, structure)

	return structure, nil
}

func generateMSSQLDDL(schema, table string, s *driver.TableStructure) string {
	var sb strings.Builder
	prefix := qualifiedName(schema, table)
	sb.WriteString(fmt.Sprintf("CREATE TABLE %s (\n", prefix))

	var defs []string
	for _, c := range s.Columns {
		def := fmt.Sprintf("  %s %s", quoteIdent(c.Name), c.DataType)
		if c.IsAutoIncr {
			def += " IDENTITY(1,1)"
		}
		if !c.IsNullable {
			def += " NOT NULL"
		} else {
			def += " NULL"
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
		defs = append(defs, fmt.Sprintf("  CONSTRAINT %s PRIMARY KEY (%s)", quoteIdent("PK_"+table), strings.Join(pkCols, ", ")))
	}

	for _, fk := range s.ForeignKeys {
		cName := fk.ConstraintName
		if cName == "" {
			cName = fmt.Sprintf("FK_%s_%s", table, fk.ColumnName)
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
		sb.WriteString(fmt.Sprintf("\n\nCREATE %sINDEX %s ON %s (%s);", unique, quoteIdent(idx.Name), prefix, strings.Join(cols, ", ")))
	}

	return sb.String()
}

func (m *MSSQLDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	db, err := m.dbFor(req.Database)
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

func (m *MSSQLDriver) BeginTx(ctx context.Context, database string) (*sql.Tx, error) {
	db, err := m.dbFor(database)
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

func (m *MSSQLDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
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

func (m *MSSQLDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	db, err := m.dbFor(database)
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
				placeholders = append(placeholders, fmt.Sprintf("@p%d", idx))
				vals = append(vals, c.Changes[k])
				idx++
			}
			var stmt string
			if len(cols) == 0 {
				stmt = fmt.Sprintf(`INSERT INTO %s DEFAULT VALUES`, prefix)
			} else {
				stmt = fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`, prefix, strings.Join(cols, ", "), strings.Join(placeholders, ", "))
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
				sets = append(sets, fmt.Sprintf(`%s = @p%d`, quoteIdent(k), idx))
				vals = append(vals, c.Changes[k])
				idx++
			}
			where := []string{}
			for _, k := range sortedKeys(c.PrimaryKey) {
				where = append(where, fmt.Sprintf(`%s = @p%d`, quoteIdent(k), idx))
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
				where = append(where, fmt.Sprintf(`%s = @p%d`, quoteIdent(k), idx))
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
