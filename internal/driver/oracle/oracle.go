package oracle

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	"dhub/internal/driver"
	_ "github.com/sijms/go-ora/v2"
)

type OracleDriver struct {
	db        *sql.DB
	connStr   string
	defaultDB string
}

func NewOracleDriver(connStr, defaultDB string) (*OracleDriver, error) {
	db, err := sql.Open("oracle", connStr)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(1)
	db.SetConnMaxIdleTime(2 * time.Minute)
	db.SetConnMaxLifetime(30 * time.Minute)

	if strings.TrimSpace(defaultDB) == "" {
		defaultDB = "ORCL"
	}

	return &OracleDriver{
		db:        db,
		connStr:   connStr,
		defaultDB: defaultDB,
	}, nil
}

func (o *OracleDriver) Ping(ctx context.Context) error {
	return o.db.PingContext(ctx)
}

func (o *OracleDriver) Close() error {
	if o.db != nil {
		return o.db.Close()
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

func (o *OracleDriver) currentSchema(ctx context.Context) string {
	var schema string
	if err := o.db.QueryRowContext(ctx, `SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') FROM DUAL`).Scan(&schema); err == nil && schema != "" {
		return schema
	}
	return ""
}

func (o *OracleDriver) ListDatabases(ctx context.Context) ([]string, error) {
	var dbName sql.NullString
	err := o.db.QueryRowContext(ctx, `SELECT SYS_CONTEXT('USERENV', 'DB_NAME') FROM DUAL`).Scan(&dbName)
	if err == nil && dbName.Valid && strings.TrimSpace(dbName.String) != "" {
		return []string{strings.TrimSpace(dbName.String)}, nil
	}
	return []string{o.defaultDB}, nil
}

func (o *OracleDriver) ListSchemas(ctx context.Context, database string) ([]string, error) {
	// Oracle 12c+ supports ORACLE_MAINTAINED = 'N'; fall back to an explicit exclusion list for 11g.
	query12c := `SELECT USERNAME FROM ALL_USERS WHERE ORACLE_MAINTAINED = 'N' ORDER BY USERNAME`
	rows, err := o.db.QueryContext(ctx, query12c)
	if err != nil {
		query11g := `
			SELECT USERNAME FROM ALL_USERS
			WHERE USERNAME NOT IN (
				'SYS', 'SYSTEM', 'OUTLN', 'DBSNMP', 'WMSYS', 'XDB', 'CTXSYS',
				'MDSYS', 'ORDSYS', 'ORDDATA', 'OLAPSYS', 'ANONYMOUS',
				'APEX_PUBLIC_USER', 'FLOWS_FILES', 'SI_INFORMTN_SCHEMA', 'DIP', 'MDDATA'
			)
			ORDER BY USERNAME`
		rows, err = o.db.QueryContext(ctx, query11g)
		if err != nil {
			return nil, err
		}
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
		if cur := o.currentSchema(ctx); cur != "" {
			schemas = []string{cur}
		}
	}
	return schemas, nil
}

func (o *OracleDriver) ListObjects(ctx context.Context, database, schema string) ([]driver.ObjectSummary, error) {
	targetSchema := strings.TrimSpace(schema)
	if targetSchema == "" {
		targetSchema = o.currentSchema(ctx)
	}

	var objects []driver.ObjectSummary

	// Tables
	tblQuery := `
		SELECT OWNER, TABLE_NAME, NVL(NUM_ROWS, 0)
		FROM ALL_TABLES
		WHERE (:1 = '' OR OWNER = :2)
		ORDER BY OWNER, TABLE_NAME`
	if rows, err := o.db.QueryContext(ctx, tblQuery, targetSchema, targetSchema); err == nil {
		defer rows.Close()
		for rows.Next() {
			var oSum driver.ObjectSummary
			if err := rows.Scan(&oSum.Schema, &oSum.Name, &oSum.RowEstimate); err == nil {
				oSum.Type = "table"
				objects = append(objects, oSum)
			}
		}
	} else {
		return nil, err
	}

	// Views
	viewQuery := `
		SELECT OWNER, VIEW_NAME
		FROM ALL_VIEWS
		WHERE (:1 = '' OR OWNER = :2)
		ORDER BY OWNER, VIEW_NAME`
	if vRows, vErr := o.db.QueryContext(ctx, viewQuery, targetSchema, targetSchema); vErr == nil {
		defer vRows.Close()
		for vRows.Next() {
			var vSchema, vName string
			if err := vRows.Scan(&vSchema, &vName); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema: vSchema,
					Name:   vName,
					Type:   "view",
				})
			}
		}
	}

	// Materialized Views
	mvQuery := `
		SELECT OWNER, MVIEW_NAME
		FROM ALL_MVIEWS
		WHERE (:1 = '' OR OWNER = :2)
		ORDER BY OWNER, MVIEW_NAME`
	if mvRows, mvErr := o.db.QueryContext(ctx, mvQuery, targetSchema, targetSchema); mvErr == nil {
		defer mvRows.Close()
		for mvRows.Next() {
			var mvSchema, mvName string
			if err := mvRows.Scan(&mvSchema, &mvName); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema: mvSchema,
					Name:   mvName,
					Type:   "materialized_view",
				})
			}
		}
	}

	// Routines (Procedures, Functions, Packages)
	routineQuery := `
		SELECT OWNER, OBJECT_NAME
		FROM ALL_OBJECTS
		WHERE (:1 = '' OR OWNER = :2)
		  AND OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION', 'PACKAGE')
		ORDER BY OWNER, OBJECT_NAME`
	if rRows, rErr := o.db.QueryContext(ctx, routineQuery, targetSchema, targetSchema); rErr == nil {
		defer rRows.Close()
		for rRows.Next() {
			var rSchema, rName string
			if err := rRows.Scan(&rSchema, &rName); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema: rSchema,
					Name:   rName,
					Type:   "routine",
				})
			}
		}
	}

	// Sequences
	seqQuery := `
		SELECT SEQUENCE_OWNER, SEQUENCE_NAME
		FROM ALL_SEQUENCES
		WHERE (:1 = '' OR SEQUENCE_OWNER = :2)
		ORDER BY SEQUENCE_OWNER, SEQUENCE_NAME`
	if sRows, sErr := o.db.QueryContext(ctx, seqQuery, targetSchema, targetSchema); sErr == nil {
		defer sRows.Close()
		for sRows.Next() {
			var sSchema, sName string
			if err := sRows.Scan(&sSchema, &sName); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema: sSchema,
					Name:   sName,
					Type:   "sequence",
				})
			}
		}
	}

	// Triggers
	trigQuery := `
		SELECT OWNER, TRIGGER_NAME, TABLE_NAME
		FROM ALL_TRIGGERS
		WHERE (:1 = '' OR OWNER = :2)
		ORDER BY OWNER, TRIGGER_NAME`
	if tRows, tErr := o.db.QueryContext(ctx, trigQuery, targetSchema, targetSchema); tErr == nil {
		defer tRows.Close()
		for tRows.Next() {
			var tSchema, tName, tTable string
			if err := tRows.Scan(&tSchema, &tName, &tTable); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema:      tSchema,
					Name:        tName,
					Type:        "trigger",
					ParentTable: tTable,
				})
			}
		}
	}

	return objects, nil
}

func (o *OracleDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	targetSchema := strings.TrimSpace(schema)
	if targetSchema == "" {
		targetSchema = o.currentSchema(ctx)
	}

	structure := &driver.TableStructure{
		Schema:      targetSchema,
		Name:        table,
		Columns:     []driver.ColumnMeta{},
		PrimaryKeys: []string{},
		ForeignKeys: []driver.ForeignKeyMeta{},
		Indexes:     []driver.IndexMeta{},
	}

	// 1. Columns (try 12c+ IDENTITY_COLUMN first, fall back for 11g)
	colQuery12c := `
		SELECT
			c.COLUMN_NAME,
			c.DATA_TYPE,
			c.DATA_LENGTH,
			c.CHAR_LENGTH,
			c.DATA_PRECISION,
			c.DATA_SCALE,
			c.NULLABLE,
			c.DATA_DEFAULT,
			c.IDENTITY_COLUMN,
			cm.COMMENTS
		FROM ALL_TAB_COLUMNS c
		LEFT JOIN ALL_COL_COMMENTS cm
			ON c.OWNER = cm.OWNER AND c.TABLE_NAME = cm.TABLE_NAME AND c.COLUMN_NAME = cm.COLUMN_NAME
		WHERE c.OWNER = :1 AND c.TABLE_NAME = :2
		ORDER BY c.COLUMN_ID`

	hasIdentityCol := true
	rows, err := o.db.QueryContext(ctx, colQuery12c, targetSchema, table)
	if err != nil {
		hasIdentityCol = false
		colQuery11g := `
			SELECT
				c.COLUMN_NAME,
				c.DATA_TYPE,
				c.DATA_LENGTH,
				c.CHAR_LENGTH,
				c.DATA_PRECISION,
				c.DATA_SCALE,
				c.NULLABLE,
				c.DATA_DEFAULT,
				cm.COMMENTS
			FROM ALL_TAB_COLUMNS c
			LEFT JOIN ALL_COL_COMMENTS cm
				ON c.OWNER = cm.OWNER AND c.TABLE_NAME = cm.TABLE_NAME AND c.COLUMN_NAME = cm.COLUMN_NAME
			WHERE c.OWNER = :1 AND c.TABLE_NAME = :2
			ORDER BY c.COLUMN_ID`
		rows, err = o.db.QueryContext(ctx, colQuery11g, targetSchema, table)
		if err != nil {
			return nil, err
		}
	}
	defer rows.Close()

	for rows.Next() {
		var colName, dataType, nullableStr string
		var dataLen, charLen, numPrec, numScale sql.NullInt64
		var colDef, identityStr, comment sql.NullString

		if hasIdentityCol {
			if err := rows.Scan(&colName, &dataType, &dataLen, &charLen, &numPrec, &numScale, &nullableStr, &colDef, &identityStr, &comment); err != nil {
				continue
			}
		} else {
			if err := rows.Scan(&colName, &dataType, &dataLen, &charLen, &numPrec, &numScale, &nullableStr, &colDef, &comment); err != nil {
				continue
			}
		}

		rawType := strings.ToLower(dataType)
		fullType := formatOracleType(dataType, dataLen, charLen, numPrec, numScale)

		isNullable := strings.EqualFold(nullableStr, "Y")
		isAutoIncr := identityStr.Valid && strings.EqualFold(identityStr.String, "YES")

		defaultValue := ""
		if colDef.Valid {
			defaultValue = strings.TrimSpace(colDef.String)
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
		SELECT cols.COLUMN_NAME
		FROM ALL_CONSTRAINTS cons
		JOIN ALL_CONS_COLUMNS cols
			ON cons.OWNER = cols.OWNER AND cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME
		WHERE cons.CONSTRAINT_TYPE = 'P'
		  AND cons.OWNER = :1
		  AND cons.TABLE_NAME = :2
		ORDER BY cols.POSITION`
	if pkRows, pkErr := o.db.QueryContext(ctx, pkQuery, targetSchema, table); pkErr == nil {
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
			cons.CONSTRAINT_NAME,
			cols.COLUMN_NAME,
			r_cons.OWNER AS REF_SCHEMA,
			r_cols.TABLE_NAME AS REF_TABLE,
			r_cols.COLUMN_NAME AS REF_COLUMN,
			NVL(cons.DELETE_RULE, 'NO ACTION') AS DELETE_RULE
		FROM ALL_CONSTRAINTS cons
		JOIN ALL_CONS_COLUMNS cols
			ON cons.OWNER = cols.OWNER AND cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME
		JOIN ALL_CONSTRAINTS r_cons
			ON cons.R_OWNER = r_cons.OWNER AND cons.R_CONSTRAINT_NAME = r_cons.CONSTRAINT_NAME
		JOIN ALL_CONS_COLUMNS r_cols
			ON r_cons.OWNER = r_cols.OWNER AND r_cons.CONSTRAINT_NAME = r_cols.CONSTRAINT_NAME AND cols.POSITION = r_cols.POSITION
		WHERE cons.CONSTRAINT_TYPE = 'R'
		  AND cons.OWNER = :1
		  AND cons.TABLE_NAME = :2
		ORDER BY cons.CONSTRAINT_NAME, cols.POSITION`
	if fkRows, fkErr := o.db.QueryContext(ctx, fkQuery, targetSchema, table); fkErr == nil {
		defer fkRows.Close()
		for fkRows.Next() {
			var cName, colName, refSch, refTbl, refCol, onDel string
			if err := fkRows.Scan(&cName, &colName, &refSch, &refTbl, &refCol, &onDel); err == nil {
				structure.ForeignKeys = append(structure.ForeignKeys, driver.ForeignKeyMeta{
					ConstraintName: cName,
					ColumnName:     colName,
					RefSchema:      refSch,
					RefTable:       refTbl,
					RefColumn:      refCol,
					OnUpdate:       "NO ACTION",
					OnDelete:       onDel,
				})
			}
		}
	}

	// 4. Indexes
	idxQuery := `
		SELECT
			idx.INDEX_NAME,
			icol.COLUMN_NAME,
			idx.UNIQUENESS,
			idx.INDEX_TYPE
		FROM ALL_INDEXES idx
		JOIN ALL_IND_COLUMNS icol
			ON idx.OWNER = icol.INDEX_OWNER AND idx.INDEX_NAME = icol.INDEX_NAME
		WHERE idx.TABLE_OWNER = :1 AND idx.TABLE_NAME = :2
		ORDER BY idx.INDEX_NAME, icol.COLUMN_POSITION`
	if idxRows, idxErr := o.db.QueryContext(ctx, idxQuery, targetSchema, table); idxErr == nil {
		defer idxRows.Close()
		idxPos := make(map[string]int)
		for idxRows.Next() {
			var idxName, colName, uniqueness, idxType string
			if err := idxRows.Scan(&idxName, &colName, &uniqueness, &idxType); err != nil {
				continue
			}
			pos, exists := idxPos[idxName]
			if !exists {
				pos = len(structure.Indexes)
				idxPos[idxName] = pos
				structure.Indexes = append(structure.Indexes, driver.IndexMeta{
					Name:     idxName,
					Columns:  []string{},
					IsUnique: strings.EqualFold(uniqueness, "UNIQUE"),
					Type:     idxType,
				})
			}
			structure.Indexes[pos].Columns = append(structure.Indexes[pos].Columns, colName)
		}
	}

	// 5. Check Constraints
	chkQuery := `
		SELECT CONSTRAINT_NAME, SEARCH_CONDITION
		FROM ALL_CONSTRAINTS
		WHERE CONSTRAINT_TYPE = 'C'
		  AND OWNER = :1
		  AND TABLE_NAME = :2
		  AND GENERATED = 'USER NAME'
		ORDER BY CONSTRAINT_NAME`
	if chkRows, chkErr := o.db.QueryContext(ctx, chkQuery, targetSchema, table); chkErr == nil {
		defer chkRows.Close()
		for chkRows.Next() {
			var name string
			var cond sql.NullString
			if err := chkRows.Scan(&name, &cond); err == nil && cond.Valid {
				structure.CheckConstraints = append(structure.CheckConstraints, driver.CheckConstraintMeta{
					Name:   name,
					Clause: strings.TrimSpace(cond.String),
				})
			}
		}
	}

	// 6. Generate DDL
	structure.DDL = generateOracleDDL(targetSchema, table, structure)

	return structure, nil
}

func formatOracleType(dataType string, dataLen, charLen, numPrec, numScale sql.NullInt64) string {
	upper := strings.ToUpper(dataType)
	switch upper {
	case "VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR":
		if charLen.Valid && charLen.Int64 > 0 {
			return fmt.Sprintf("%s(%d)", upper, charLen.Int64)
		}
		if dataLen.Valid && dataLen.Int64 > 0 {
			return fmt.Sprintf("%s(%d)", upper, dataLen.Int64)
		}
	case "RAW":
		if dataLen.Valid && dataLen.Int64 > 0 {
			return fmt.Sprintf("%s(%d)", upper, dataLen.Int64)
		}
	case "NUMBER":
		if numPrec.Valid {
			if numScale.Valid && numScale.Int64 != 0 {
				return fmt.Sprintf("NUMBER(%d,%d)", numPrec.Int64, numScale.Int64)
			}
			return fmt.Sprintf("NUMBER(%d)", numPrec.Int64)
		}
	case "FLOAT":
		if numPrec.Valid && numPrec.Int64 != 126 {
			return fmt.Sprintf("FLOAT(%d)", numPrec.Int64)
		}
	}
	return dataType
}

func generateOracleDDL(schema, table string, s *driver.TableStructure) string {
	var sb strings.Builder
	prefix := qualifiedName(schema, table)
	sb.WriteString(fmt.Sprintf("CREATE TABLE %s (\n", prefix))

	var defs []string
	for _, c := range s.Columns {
		def := fmt.Sprintf("  %s %s", quoteIdent(c.Name), c.DataType)
		if c.IsAutoIncr {
			def += " GENERATED ALWAYS AS IDENTITY"
		}
		if c.DefaultValue != "" && !c.IsAutoIncr {
			def += " DEFAULT " + c.DefaultValue
		}
		if !c.IsNullable {
			def += " NOT NULL"
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
		if fk.OnDelete != "" && !strings.EqualFold(fk.OnDelete, "NO ACTION") {
			def += " ON DELETE " + fk.OnDelete
		}
		defs = append(defs, def)
	}

	for _, chk := range s.CheckConstraints {
		defs = append(defs, fmt.Sprintf("  CONSTRAINT %s CHECK (%s)", quoteIdent(chk.Name), chk.Clause))
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

func (o *OracleDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	conn, err := o.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	return driver.ExecuteStatementsWithDialect(ctx, conn, req, "oracle")
}

func (o *OracleDriver) BeginTx(ctx context.Context, database string) (*sql.Tx, error) {
	return o.db.BeginTx(ctx, nil)
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

func (o *OracleDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
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
			statements = append(statements, stmt)
		case "update":
			sets := []string{}
			for _, k := range sortedKeys(c.Changes) {
				sets = append(sets, fmt.Sprintf(`%s = %s`, quoteIdent(k), formatSQLVal(c.Changes[k])))
			}
			where := []string{}
			for _, k := range sortedKeys(c.PrimaryKey) {
				if c.PrimaryKey[k] == nil {
					where = append(where, fmt.Sprintf(`%s IS NULL`, quoteIdent(k)))
				} else {
					where = append(where, fmt.Sprintf(`%s = %s`, quoteIdent(k), formatSQLVal(c.PrimaryKey[k])))
				}
			}
			statements = append(statements, fmt.Sprintf(`UPDATE %s SET %s WHERE %s;`, prefix, strings.Join(sets, ", "), strings.Join(where, " AND ")))
		case "delete":
			where := []string{}
			for _, k := range sortedKeys(c.PrimaryKey) {
				if c.PrimaryKey[k] == nil {
					where = append(where, fmt.Sprintf(`%s IS NULL`, quoteIdent(k)))
				} else {
					where = append(where, fmt.Sprintf(`%s = %s`, quoteIdent(k), formatSQLVal(c.PrimaryKey[k])))
				}
			}
			statements = append(statements, fmt.Sprintf(`DELETE FROM %s WHERE %s;`, prefix, strings.Join(where, " AND ")))
		}
	}
	return statements, nil
}

func (o *OracleDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	tx, err := o.db.BeginTx(ctx, nil)
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
				placeholders = append(placeholders, fmt.Sprintf(":%d", idx))
				vals = append(vals, c.Changes[k])
				idx++
			}
			stmt := fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`, prefix, strings.Join(cols, ", "), strings.Join(placeholders, ", "))
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
				sets = append(sets, fmt.Sprintf(`%s = :%d`, quoteIdent(k), idx))
				vals = append(vals, c.Changes[k])
				idx++
			}
			where := []string{}
			for _, k := range sortedKeys(c.PrimaryKey) {
				if c.PrimaryKey[k] == nil {
					where = append(where, fmt.Sprintf(`%s IS NULL`, quoteIdent(k)))
				} else {
					where = append(where, fmt.Sprintf(`%s = :%d`, quoteIdent(k), idx))
					vals = append(vals, c.PrimaryKey[k])
					idx++
				}
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
				if c.PrimaryKey[k] == nil {
					where = append(where, fmt.Sprintf(`%s IS NULL`, quoteIdent(k)))
				} else {
					where = append(where, fmt.Sprintf(`%s = :%d`, quoteIdent(k), idx))
					vals = append(vals, c.PrimaryKey[k])
					idx++
				}
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
