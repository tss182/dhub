package postgres

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
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
const maxExtraPools = 8

type PostgresDriver struct {
	db        *sql.DB // pool for the default database
	connStr   string
	defaultDB string

	mu        sync.Mutex
	pools     map[string]*sql.DB // extra pools keyed by database name
	poolOrder []string           // LRU order of extra pool keys
}

func openPool(connStr string) (*sql.DB, error) {
	db, err := sql.Open("pgx", connStr)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(1)
	db.SetConnMaxIdleTime(2 * time.Minute)
	db.SetConnMaxLifetime(30 * time.Minute)
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
		// Move to most-recently-used position
		for i, name := range p.poolOrder {
			if name == database {
				p.poolOrder = append(p.poolOrder[:i], p.poolOrder[i+1:]...)
				break
			}
		}
		p.poolOrder = append(p.poolOrder, database)
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
	for i := 0; i < len(p.poolOrder) && len(p.poolOrder) >= maxExtraPools; {
		evict := p.poolOrder[i]
		oldPool, exists := p.pools[evict]
		if !exists {
			p.poolOrder = append(p.poolOrder[:i], p.poolOrder[i+1:]...)
			continue
		}
		if oldPool.Stats().InUse > 0 {
			i++
			continue
		}
		p.poolOrder = append(p.poolOrder[:i], p.poolOrder[i+1:]...)
		_ = oldPool.Close()
		delete(p.pools, evict)
	}
	p.pools[database] = pool
	p.poolOrder = append(p.poolOrder, database)
	return pool, nil
}

func (p *PostgresDriver) Ping(ctx context.Context) error {
	return p.db.PingContext(ctx)
}

// ServerVersion returns the PostgreSQL server version string.
func (p *PostgresDriver) ServerVersion(ctx context.Context) (string, error) {
	var ver string
	if err := p.db.QueryRowContext(ctx, `SHOW server_version;`).Scan(&ver); err != nil {
		return "", err
	}
	return strings.TrimSpace(ver), nil
}

// CloseDatabasePool closes and evicts any cached connection pool for the given database
// so administrative operations such as DROP DATABASE are not blocked by DHub's own pool.
func (p *PostgresDriver) CloseDatabasePool(database string) {
	database = strings.TrimSpace(database)
	if database == "" || database == p.defaultDB {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if pool, ok := p.pools[database]; ok {
		_ = pool.Close()
		delete(p.pools, database)
	}
	for i := 0; i < len(p.poolOrder); i++ {
		if p.poolOrder[i] == database {
			p.poolOrder = append(p.poolOrder[:i], p.poolOrder[i+1:]...)
			break
		}
	}
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
	query := `SELECT nspname FROM pg_catalog.pg_namespace
		WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
			AND nspname NOT LIKE 'pg_temp_%'
			AND nspname NOT LIKE 'pg_toast_temp_%'
		ORDER BY nspname;`
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

	var objects []driver.ObjectSummary

	// 1. Tables, Views, Materialized Views, and Partitioned Tables with row estimates, size, and comments
	classQuery := `
		SELECT
			c.relname,
			CASE c.relkind
				WHEN 'r' THEN 'table'
				WHEN 'v' THEN 'view'
				WHEN 'm' THEN 'materialized_view'
				WHEN 'p' THEN 'table'
				ELSE 'other'
			END as obj_type,
			GREATEST(COALESCE(c.reltuples::bigint, -1), -1) as row_estimate,
			pg_size_pretty(pg_total_relation_size(c.oid)) as size_pretty,
			COALESCE(d.description, '') as comment
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
		WHERE n.nspname = $1 AND c.relkind IN ('r', 'v', 'm', 'p')
		ORDER BY c.relname;`

	rows, err := db.QueryContext(ctx, classQuery, schema)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var name, objType, sizePretty, comment string
			var rowEstimate int64
			if err := rows.Scan(&name, &objType, &rowEstimate, &sizePretty, &comment); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema:      schema,
					Name:        name,
					Type:        objType,
					RowEstimate: rowEstimate,
					SizePretty:  sizePretty,
					Comment:     comment,
				})
			}
		}
	} else {
		// Fallback for limited permissions
		fallbackQuery := `
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
		if fbRows, fbErr := db.QueryContext(ctx, fallbackQuery, schema); fbErr == nil {
			defer fbRows.Close()
			for fbRows.Next() {
				var name, objType string
				if err := fbRows.Scan(&name, &objType); err == nil {
					objects = append(objects, driver.ObjectSummary{
						Schema:      schema,
						Name:        name,
						Type:        objType,
						RowEstimate: -1,
					})
				}
			}
		}
	}

	// 2. Sequences
	seqQuery := `
		SELECT c.relname, COALESCE(d.description, '')
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
		WHERE n.nspname = $1 AND c.relkind = 'S'
		ORDER BY c.relname;`
	if seqRows, sErr := db.QueryContext(ctx, seqQuery, schema); sErr == nil {
		defer seqRows.Close()
		for seqRows.Next() {
			var sName, sComment string
			if err := seqRows.Scan(&sName, &sComment); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema:      schema,
					Name:        sName,
					Type:        "sequence",
					RowEstimate: -1,
					Comment:     sComment,
				})
			}
		}
	}

	// 3. Routines (Functions & Stored Procedures with signature & kind)
	routineQuery := `
		SELECT
			p.proname,
			CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS kind,
			pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
			COALESCE(d.description, '') AS comment
		FROM pg_catalog.pg_proc p
		JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
		LEFT JOIN pg_catalog.pg_description d ON d.objoid = p.oid AND d.classoid = 'pg_proc'::regclass
		WHERE n.nspname = $1
		ORDER BY p.proname, args;`
	if routineRows, rErr := db.QueryContext(ctx, routineQuery, schema); rErr == nil {
		defer routineRows.Close()
		for routineRows.Next() {
			var rName, kind, args, rComment string
			if err := routineRows.Scan(&rName, &kind, &args, &rComment); err == nil {
				sig := fmt.Sprintf("[%s] (%s)", kind, args)
				if rComment != "" {
					sig += " " + rComment
				}
				objects = append(objects, driver.ObjectSummary{
					Schema:      schema,
					Name:        rName,
					Type:        "routine",
					RowEstimate: -1,
					Comment:     strings.TrimSpace(sig),
				})
			}
		}
	}

	// 4. Triggers (with parent table resolved)
	triggerQuery := `
		SELECT t.tgname, c.relname, COALESCE(d.description, '')
		FROM pg_trigger t
		JOIN pg_class c ON c.oid = t.tgrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN pg_description d ON d.objoid = t.oid AND d.objsubid = 0
		WHERE n.nspname = $1 AND NOT t.tgisinternal
		ORDER BY t.tgname;`
	if triggerRows, tErr := db.QueryContext(ctx, triggerQuery, schema); tErr == nil {
		defer triggerRows.Close()
		for triggerRows.Next() {
			var tName, pTable, tComment string
			if err := triggerRows.Scan(&tName, &pTable, &tComment); err == nil {
				objects = append(objects, driver.ObjectSummary{
					Schema:      schema,
					Name:        tName,
					Type:        "trigger",
					RowEstimate: -1,
					ParentTable: pTable,
					Comment:     tComment,
				})
			}
		}
	}

	// 5. Extensions (schema-specific or public)
	extQuery := `
		SELECT e.extname, e.extversion, COALESCE(d.description, '')
		FROM pg_extension e
		JOIN pg_namespace n ON n.oid = e.extnamespace
		LEFT JOIN pg_description d ON d.objoid = e.oid
		WHERE n.nspname = $1
		ORDER BY e.extname;`
	if extRows, xErr := db.QueryContext(ctx, extQuery, schema); xErr == nil {
		defer extRows.Close()
		for extRows.Next() {
			var xName, xVer, xComment string
			if err := extRows.Scan(&xName, &xVer, &xComment); err == nil {
				desc := "v" + xVer
				if xComment != "" {
					desc += " - " + xComment
				}
				objects = append(objects, driver.ObjectSummary{
					Schema:      schema,
					Name:        xName,
					Type:        "extension",
					RowEstimate: -1,
					Comment:     desc,
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

	// 1. Get Primary Keys (ordered by position in the key via pg_constraint)
	pkQuery := `
		SELECT a.attname
		FROM pg_catalog.pg_constraint con
		JOIN pg_catalog.pg_class cl ON cl.oid = con.conrelid
		JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
		JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
		JOIN pg_catalog.pg_attribute a ON a.attrelid = cl.oid AND a.attnum = k.attnum
		WHERE con.contype = 'p' AND n.nspname = $1 AND cl.relname = $2
		ORDER BY k.ord;`
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

	// 2. Get Columns via pg_catalog (preserves exact format_type, identity/generated flags, and enum labels)
	colQuery := `
		SELECT
			a.attname,
			pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
			t.typname AS udt_name,
			NOT a.attnotnull AS is_nullable,
			COALESCE(pg_catalog.pg_get_expr(ad.adbin, ad.adrelid), '') AS column_default,
			a.attidentity::text,
			a.attgenerated::text,
			COALESCE(pg_catalog.col_description(cl.oid, a.attnum), '') AS col_comment,
			COALESCE((
				SELECT string_agg(e.enumlabel, E'\x1f' ORDER BY e.enumsortorder)
				FROM pg_catalog.pg_enum e
				WHERE e.enumtypid = a.atttypid
			), '') AS enum_labels
		FROM pg_catalog.pg_attribute a
		JOIN pg_catalog.pg_class cl ON cl.oid = a.attrelid
		JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
		JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
		LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
		WHERE n.nspname = $1 AND cl.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
		ORDER BY a.attnum;`
	rows, err := db.QueryContext(ctx, colQuery, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var name, formattedType, udtName, defVal, attIdentity, attGenerated, colComment, enumLabelsRaw string
		var isNullable bool
		if err := rows.Scan(&name, &formattedType, &udtName, &isNullable, &defVal, &attIdentity, &attGenerated, &colComment, &enumLabelsRaw); err == nil {
			defaultKind := ""
			switch attIdentity {
			case "a":
				defaultKind = "IDENTITY_ALWAYS"
			case "d":
				defaultKind = "IDENTITY_BY_DEFAULT"
			}
			if attGenerated == "s" {
				defaultKind = "GENERATED_STORED"
			} else if defaultKind == "" && defVal != "" {
				defaultKind = "DEFAULT"
			}
			isAuto := strings.HasPrefix(strings.ToLower(defVal), "nextval(") ||
				attIdentity == "a" || attIdentity == "d"

			var enumValues []string
			if enumLabelsRaw != "" {
				enumValues = strings.Split(enumLabelsRaw, "\x1f")
			}

			structure.Columns = append(structure.Columns, driver.ColumnMeta{
				Name:         name,
				DataType:     formattedType,
				RawType:      udtName,
				IsNullable:   isNullable,
				IsPrimaryKey: pkSet[name],
				IsAutoIncr:   isAuto,
				DefaultValue: defVal,
				DefaultKind:  defaultKind,
				EnumValues:   enumValues,
				Comment:      colComment,
			})
		}
	}

	// 2b. Table comment
	var tblComment *string
	_ = db.QueryRowContext(ctx, `
		SELECT pg_catalog.obj_description(c.oid, 'pg_class')
		FROM pg_catalog.pg_class c
		JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1 AND c.relname = $2;`, schema, table).Scan(&tblComment)
	if tblComment != nil {
		structure.Comment = *tblComment
	}

	// 3. Get Foreign Keys via pg_constraint (supports cross-schema and composite FKs accurately)
	fkQuery := `
		SELECT
			con.conname,
			src_a.attname AS col_name,
			ref_n.nspname AS ref_schema,
			ref_c.relname AS ref_table,
			ref_a.attname AS ref_column,
			CASE con.confupdtype
				WHEN 'a' THEN 'NO ACTION'
				WHEN 'r' THEN 'RESTRICT'
				WHEN 'c' THEN 'CASCADE'
				WHEN 'n' THEN 'SET NULL'
				WHEN 'd' THEN 'SET DEFAULT'
				ELSE 'NO ACTION'
			END AS on_update,
			CASE con.confdeltype
				WHEN 'a' THEN 'NO ACTION'
				WHEN 'r' THEN 'RESTRICT'
				WHEN 'c' THEN 'CASCADE'
				WHEN 'n' THEN 'SET NULL'
				WHEN 'd' THEN 'SET DEFAULT'
				ELSE 'NO ACTION'
			END AS on_delete
		FROM pg_catalog.pg_constraint con
		JOIN pg_catalog.pg_class src_c ON src_c.oid = con.conrelid
		JOIN pg_catalog.pg_namespace src_n ON src_n.oid = src_c.relnamespace
		JOIN pg_catalog.pg_class ref_c ON ref_c.oid = con.confrelid
		JOIN pg_catalog.pg_namespace ref_n ON ref_n.oid = ref_c.relnamespace
		JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(src_attnum, ref_attnum, ord) ON true
		JOIN pg_catalog.pg_attribute src_a ON src_a.attrelid = src_c.oid AND src_a.attnum = k.src_attnum
		JOIN pg_catalog.pg_attribute ref_a ON ref_a.attrelid = ref_c.oid AND ref_a.attnum = k.ref_attnum
		WHERE con.contype = 'f' AND src_n.nspname = $1 AND src_c.relname = $2
		ORDER BY con.conname, k.ord;`
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

	// 4. Get Indexes (includes expression indexes where attnum = 0 via LEFT JOIN)
	idxQuery := `
		SELECT i.relname, ix.indisunique, ix.indisprimary, am.amname, COALESCE(a.attname, ''), COALESCE(pg_catalog.pg_get_indexdef(i.oid), '')
		FROM pg_catalog.pg_class t
		JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
		JOIN pg_catalog.pg_index ix ON ix.indrelid = t.oid
		JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
		JOIN pg_catalog.pg_am am ON am.oid = i.relam
		JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
		LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum AND k.attnum > 0
		WHERE n.nspname = $1 AND t.relname = $2
		ORDER BY i.relname, k.ord;`
	if idxRows, idxErr := db.QueryContext(ctx, idxQuery, schema, table); idxErr == nil {
		defer idxRows.Close()
		idxPos := make(map[string]int)
		for idxRows.Next() {
			var idxName, method, colName, idxDef string
			var isUnique, isPrimary bool
			if err := idxRows.Scan(&idxName, &isUnique, &isPrimary, &method, &colName, &idxDef); err != nil {
				continue
			}
			pos, exists := idxPos[idxName]
			if !exists {
				pos = len(structure.Indexes)
				idxPos[idxName] = pos
				structure.Indexes = append(structure.Indexes, driver.IndexMeta{
					Name:       idxName,
					Columns:    []string{},
					IsUnique:   isUnique,
					IsPrimary:  isPrimary,
					Type:       method,
					Method:     method,
					Definition: idxDef,
				})
			}
			if colName != "" {
				structure.Indexes[pos].Columns = append(structure.Indexes[pos].Columns, colName)
			}
		}
	}

	// 4b. Get Check Constraints
	chkQuery := `
		SELECT c.conname, pg_get_constraintdef(c.oid)
		FROM pg_constraint c
		JOIN pg_namespace n ON n.oid = c.connamespace
		JOIN pg_class cl ON cl.oid = c.conrelid
		WHERE n.nspname = $1 AND cl.relname = $2 AND c.contype = 'c';`
	if chkRows, chkErr := db.QueryContext(ctx, chkQuery, schema, table); chkErr == nil {
		defer chkRows.Close()
		for chkRows.Next() {
			var cName, cDef string
			if err := chkRows.Scan(&cName, &cDef); err == nil {
				structure.CheckConstraints = append(structure.CheckConstraints, driver.CheckConstraintMeta{
					Name:   cName,
					Clause: cDef,
				})
			}
		}
	}

	// 4c. Get Triggers
	trgQuery := `
		SELECT trigger_name, action_timing, string_agg(event_manipulation, ' OR '), action_statement
		FROM information_schema.triggers
		WHERE event_object_schema = $1 AND event_object_table = $2
		GROUP BY trigger_name, action_timing, action_statement
		ORDER BY trigger_name;`
	if trgRows, trgErr := db.QueryContext(ctx, trgQuery, schema, table); trgErr == nil {
		defer trgRows.Close()
		for trgRows.Next() {
			var tName, timing, event, stmt string
			if err := trgRows.Scan(&tName, &timing, &event, &stmt); err == nil {
				structure.Triggers = append(structure.Triggers, driver.TriggerMeta{
					Name:      tName,
					Timing:    timing,
					Event:     event,
					Statement: stmt,
				})
			}
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
		if c.DefaultKind == "GENERATED_STORED" && c.DefaultValue != "" {
			def += fmt.Sprintf(" GENERATED ALWAYS AS (%s) STORED", c.DefaultValue)
		} else {
			if !c.IsNullable {
				def += " NOT NULL"
			}
			if c.DefaultKind == "IDENTITY_ALWAYS" {
				def += " GENERATED ALWAYS AS IDENTITY"
			} else if c.DefaultKind == "IDENTITY_BY_DEFAULT" {
				def += " GENERATED BY DEFAULT AS IDENTITY"
			} else if c.DefaultValue != "" {
				def += " DEFAULT " + c.DefaultValue
			}
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

	// Group composite Foreign Keys by constraint name while preserving order
	type fkGroup struct {
		name     string
		cols     []string
		refCols  []string
		refSch   string
		refTbl   string
		onUpdate string
		onDelete string
	}
	var fkGroups []*fkGroup
	fkByName := make(map[string]*fkGroup)
	for _, fk := range s.ForeignKeys {
		cName := fk.ConstraintName
		if cName == "" {
			cName = fmt.Sprintf("%s_%s_fkey", table, fk.ColumnName)
		}
		g, ok := fkByName[cName]
		if !ok {
			g = &fkGroup{
				name:     cName,
				refSch:   fk.RefSchema,
				refTbl:   fk.RefTable,
				onUpdate: fk.OnUpdate,
				onDelete: fk.OnDelete,
			}
			fkByName[cName] = g
			fkGroups = append(fkGroups, g)
		}
		g.cols = append(g.cols, quoteIdent(fk.ColumnName))
		g.refCols = append(g.refCols, quoteIdent(fk.RefColumn))
	}
	for _, g := range fkGroups {
		def := fmt.Sprintf("  CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s)",
			quoteIdent(g.name), strings.Join(g.cols, ", "), qualifiedName(g.refSch, g.refTbl), strings.Join(g.refCols, ", "))
		if g.onUpdate != "" && !strings.EqualFold(g.onUpdate, "NO ACTION") {
			def += " ON UPDATE " + g.onUpdate
		}
		if g.onDelete != "" && !strings.EqualFold(g.onDelete, "NO ACTION") {
			def += " ON DELETE " + g.onDelete
		}
		defs = append(defs, def)
	}

	for _, chk := range s.CheckConstraints {
		clause := chk.Clause
		if strings.HasPrefix(strings.ToUpper(clause), "CHECK ") {
			defs = append(defs, fmt.Sprintf("  CONSTRAINT %s %s", quoteIdent(chk.Name), clause))
		} else {
			defs = append(defs, fmt.Sprintf("  CONSTRAINT %s CHECK (%s)", quoteIdent(chk.Name), clause))
		}
	}

	sb.WriteString(strings.Join(defs, ",\n"))
	sb.WriteString("\n);")

	if s.Comment != "" {
		sb.WriteString(fmt.Sprintf("\n\nCOMMENT ON TABLE %s IS '%s';", prefix, strings.ReplaceAll(s.Comment, "'", "''")))
	}
	for _, col := range s.Columns {
		if col.Comment != "" {
			sb.WriteString(fmt.Sprintf("\nCOMMENT ON COLUMN %s.%s IS '%s';", prefix, quoteIdent(col.Name), strings.ReplaceAll(col.Comment, "'", "''")))
		}
	}

	for _, idx := range s.Indexes {
		if idx.IsPrimary {
			continue
		}
		if idx.Definition != "" {
			def := strings.TrimRight(strings.TrimSpace(idx.Definition), ";")
			sb.WriteString(fmt.Sprintf("\n\n%s;", def))
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
		if _, sErr := conn.ExecContext(ctx, fmt.Sprintf(`SET search_path TO %s, public`, quoteIdent(req.Schema))); sErr != nil {
			return nil, fmt.Errorf("failed to set search_path to %q: %w", req.Schema, sErr)
		}
		defer func() {
			_, _ = conn.ExecContext(context.Background(), `RESET search_path`)
		}()
	}

	return driver.ExecuteStatementsWithDialect(ctx, conn, req, "postgres")
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
	const insertBatchSize = 100
	for i := 0; i < len(changes); i++ {
		c := changes[i]
		switch c.Type {
		case "insert":
			cols := sortedKeys(c.Changes)
			if len(cols) == 0 {
				stmt := fmt.Sprintf(`INSERT INTO %s DEFAULT VALUES`, prefix)
				res, err := tx.ExecContext(ctx, stmt)
				if err != nil {
					return 0, err
				}
				ra, _ := res.RowsAffected()
				totalAffected += ra
				continue
			}

			// Batch consecutive homogeneous INSERTs for remote/SSH performance
			batchEnd := i + 1
			for batchEnd < len(changes) && (batchEnd-i) < insertBatchSize {
				next := changes[batchEnd]
				if next.Type != "insert" {
					break
				}
				nextCols := sortedKeys(next.Changes)
				if len(nextCols) != len(cols) {
					break
				}
				same := true
				for k := range cols {
					if cols[k] != nextCols[k] {
						same = false
						break
					}
				}
				if !same {
					break
				}
				batchEnd++
			}

			qCols := make([]string, len(cols))
			for k, col := range cols {
				qCols[k] = quoteIdent(col)
			}
			var tupleStrs []string
			var vals []any
			paramIdx := 1
			for b := i; b < batchEnd; b++ {
				rowChanges := changes[b].Changes
				placeholders := make([]string, len(cols))
				for k, col := range cols {
					placeholders[k] = fmt.Sprintf("$%d", paramIdx)
					vals = append(vals, rowChanges[col])
					paramIdx++
				}
				tupleStrs = append(tupleStrs, "("+strings.Join(placeholders, ", ")+")")
			}
			stmt := fmt.Sprintf(`INSERT INTO %s (%s) VALUES %s`, prefix, strings.Join(qCols, ", "), strings.Join(tupleStrs, ", "))
			res, err := tx.ExecContext(ctx, stmt, vals...)
			if err != nil {
				return 0, err
			}
			ra, _ := res.RowsAffected()
			totalAffected += ra
			i = batchEnd - 1
		case "update":
			if len(c.PrimaryKey) == 0 {
				return 0, fmt.Errorf("cannot update row without primary key")
			}
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
				if c.PrimaryKey[k] == nil {
					where = append(where, fmt.Sprintf(`%s IS NULL`, quoteIdent(k)))
				} else {
					where = append(where, fmt.Sprintf(`%s = $%d`, quoteIdent(k), idx))
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
			if len(c.PrimaryKey) == 0 {
				return 0, fmt.Errorf("cannot delete row without primary key")
			}
			where := []string{}
			vals := []any{}
			idx := 1
			for _, k := range sortedKeys(c.PrimaryKey) {
				if c.PrimaryKey[k] == nil {
					where = append(where, fmt.Sprintf(`%s IS NULL`, quoteIdent(k)))
				} else {
					where = append(where, fmt.Sprintf(`%s = $%d`, quoteIdent(k), idx))
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

func formatSQLVal(v any) string {
	if v == nil {
		return "NULL"
	}
	switch val := v.(type) {
	case bool:
		if val {
			return "TRUE"
		}
		return "FALSE"
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return fmt.Sprintf("%v", val)
	case []byte:
		return fmt.Sprintf("'\\x%s'::bytea", hex.EncodeToString(val))
	case time.Time:
		return "'" + val.Format("2006-01-02 15:04:05.999999Z07:00") + "'"
	case string:
		return "'" + strings.ReplaceAll(val, "'", "''") + "'"
	case map[string]any, []any:
		if b, err := json.Marshal(val); err == nil {
			return "'" + strings.ReplaceAll(string(b), "'", "''") + "'"
		}
		return "'" + strings.ReplaceAll(fmt.Sprintf("%v", val), "'", "''") + "'"
	default:
		return "'" + strings.ReplaceAll(fmt.Sprintf("%v", val), "'", "''") + "'"
	}
}
