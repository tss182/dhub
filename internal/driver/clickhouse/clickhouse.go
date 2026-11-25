package clickhouse

import (
	"context"
	"crypto/tls"
	"database/sql"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"dhub/internal/driver"
	chdriver "github.com/ClickHouse/clickhouse-go/v2"
)

const maxExtraPools = 8

type chExecEntry struct {
	queryID string
	db      string
}

type ClickHouseDriver struct {
	db        *sql.DB
	connStr   string
	defaultDB string
	tlsCfg    *tls.Config

	mu        sync.Mutex
	pools     map[string]*sql.DB
	poolOrder []string

	execMu      sync.Mutex
	activeExecs map[string]chExecEntry
}

func openPool(connStr string, tlsCfg *tls.Config) (*sql.DB, error) {
	var db *sql.DB
	var err error
	if tlsCfg != nil {
		opts, perr := chdriver.ParseDSN(connStr)
		if perr != nil {
			return nil, fmt.Errorf("invalid ClickHouse DSN for TLS connection: %w", perr)
		}
		opts.TLS = tlsCfg
		db = chdriver.OpenDB(opts)
	} else {
		db, err = sql.Open("clickhouse", connStr)
	}
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(1)
	db.SetConnMaxIdleTime(2 * time.Minute)
	db.SetConnMaxLifetime(30 * time.Minute)
	return db, nil
}

func NewClickHouseDriver(connStr string) (*ClickHouseDriver, error) {
	return NewClickHouseDriverWithTLS(connStr, nil)
}

func NewClickHouseDriverWithTLS(connStr string, tlsCfg *tls.Config) (*ClickHouseDriver, error) {
	db, err := openPool(connStr, tlsCfg)
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
		tlsCfg:    tlsCfg,
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
		for i, name := range c.poolOrder {
			if name == database {
				c.poolOrder = append(c.poolOrder[:i], c.poolOrder[i+1:]...)
				break
			}
		}
		c.poolOrder = append(c.poolOrder, database)
		return pool, nil
	}

	u, err := url.Parse(c.connStr)
	if err != nil {
		return nil, fmt.Errorf("invalid connection string: %w", err)
	}
	u.Path = "/" + database

	pool, err := openPool(u.String(), c.tlsCfg)
	if err != nil {
		return nil, err
	}
	for i := 0; i < len(c.poolOrder) && len(c.poolOrder) >= maxExtraPools; {
		evict := c.poolOrder[i]
		oldPool, exists := c.pools[evict]
		if !exists {
			c.poolOrder = append(c.poolOrder[:i], c.poolOrder[i+1:]...)
			continue
		}
		if oldPool.Stats().InUse > 0 {
			i++
			continue
		}
		c.poolOrder = append(c.poolOrder[:i], c.poolOrder[i+1:]...)
		_ = oldPool.Close()
		delete(c.pools, evict)
	}
	c.pools[database] = pool
	c.poolOrder = append(c.poolOrder, database)
	return pool, nil
}

func (c *ClickHouseDriver) Ping(ctx context.Context) error {
	return c.db.PingContext(ctx)
}

func (c *ClickHouseDriver) ServerVersion(ctx context.Context) (string, error) {
	var ver string
	if err := c.db.QueryRowContext(ctx, "SELECT version()").Scan(&ver); err != nil {
		return "", err
	}
	return strings.TrimSpace(ver), nil
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

func formatBytesPretty(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(b)/float64(div), "KMGTPE"[exp])
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
			total_bytes,
			comment,
			arrayStringConcat(dependencies_table, ', ') AS deps
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
		var totalRows, totalBytes sql.NullInt64
		var comment, deps sql.NullString

		if err := rows.Scan(&name, &engine, &totalRows, &totalBytes, &comment, &deps); err != nil {
			continue
		}

		lowerEngine := strings.ToLower(engine)
		collType := "table"
		switch {
		case lowerEngine == "materializedview":
			collType = "materialized_view"
		case strings.Contains(lowerEngine, "view"):
			collType = "view"
		case lowerEngine == "dictionary":
			collType = "dictionary"
		}

		var rowEst int64
		if totalRows.Valid {
			rowEst = totalRows.Int64
		}

		var totalBytesPtr *uint64
		sizePretty := ""
		if totalBytes.Valid && totalBytes.Int64 >= 0 {
			ub := uint64(totalBytes.Int64)
			totalBytesPtr = &ub
			sizePretty = formatBytesPretty(ub)
		}

		isInternal := strings.HasPrefix(name, ".inner.") || strings.HasPrefix(name, ".inner_id.")

		objects = append(objects, driver.ObjectSummary{
			Schema:      database,
			Name:        name,
			Type:        collType,
			RowEstimate: rowEst,
			SizePretty:  sizePretty,
			Comment:     comment.String,
			Engine:      engine,
			TargetTable: deps.String,
			TotalBytes:  totalBytesPtr,
			IsInternal:  isInternal,
		})
	}

	// Also fetch SQL user-defined functions
	fnRows, fnErr := db.QueryContext(ctx, `SELECT name FROM system.functions WHERE origin = 'SQLUserDefined' ORDER BY name`)
	if fnErr == nil {
		defer fnRows.Close()
		for fnRows.Next() {
			var fnName string
			if err := fnRows.Scan(&fnName); err == nil && fnName != "" {
				objects = append(objects, driver.ObjectSummary{
					Schema: database,
					Name:   fnName,
					Type:   "function",
				})
			}
		}
	}

	return objects, nil
}

func unwrapClickHouseType(t string) string {
	s := strings.TrimSpace(t)
	for {
		if strings.HasPrefix(s, "LowCardinality(") && strings.HasSuffix(s, ")") {
			s = strings.TrimSpace(s[len("LowCardinality(") : len(s)-1])
			continue
		}
		if strings.HasPrefix(s, "Nullable(") && strings.HasSuffix(s, ")") {
			s = strings.TrimSpace(s[len("Nullable(") : len(s)-1])
			continue
		}
		break
	}
	return s
}

func rawTypeFromClickHouse(t string) string {
	unwrapped := unwrapClickHouseType(t)
	lower := strings.ToLower(unwrapped)
	if lower == "array(float32)" || lower == "array(float64)" || lower == "array(bfloat16)" {
		return "vector"
	}
	if strings.HasPrefix(lower, "array(") || strings.HasPrefix(lower, "tuple(") || strings.HasPrefix(lower, "map(") || lower == "json" || strings.HasPrefix(lower, "object(") {
		return "json"
	}
	if lower == "bool" || lower == "boolean" {
		return "boolean"
	}
	if lower == "uuid" {
		return "uuid"
	}
	if lower == "ipv4" || lower == "ipv6" {
		return "ip"
	}
	if strings.HasPrefix(lower, "date") || strings.HasPrefix(lower, "time") {
		return "date"
	}
	if strings.HasPrefix(lower, "int") || strings.HasPrefix(lower, "uint") || strings.HasPrefix(lower, "float") || strings.HasPrefix(lower, "bfloat") || strings.HasPrefix(lower, "decimal") {
		return "number"
	}
	return "string"
}

func isMutableClickHouseEngine(engine string) bool {
	lower := strings.ToLower(strings.TrimSpace(engine))
	return strings.Contains(lower, "mergetree") || lower == "materializedpostgresql"
}

func isClickHouseNullable(colType string) bool {
	return strings.HasPrefix(colType, "Nullable(") || strings.HasPrefix(colType, "LowCardinality(Nullable(")
}

func (c *ClickHouseDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	database = resolveCHDatabase(database, schema, c.defaultDB)
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
		Projections: []driver.ProjectionMeta{},
	}

	// 1. Columns
	colQuery := `
		SELECT 
			name,
			type,
			default_kind,
			default_expression,
			compression_codec,
			comment,
			is_in_primary_key,
			is_in_sorting_key,
			is_in_partition_key
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
		var defaultKind, defaultExpr, codec, comment sql.NullString
		var isInPK, isInSort, isInPart uint8

		if err := rows.Scan(&colName, &colType, &defaultKind, &defaultExpr, &codec, &comment, &isInPK, &isInSort, &isInPart); err != nil {
			continue
		}

		isPK := isInPK == 1
		if isPK {
			structure.PrimaryKeys = append(structure.PrimaryKeys, colName)
		}

		structure.Columns = append(structure.Columns, driver.ColumnMeta{
			Name:           colName,
			DataType:       colType,
			RawType:        rawTypeFromClickHouse(colType),
			IsNullable:     isClickHouseNullable(colType),
			IsPrimaryKey:   isPK,
			DefaultValue:   defaultExpr.String,
			DefaultKind:    defaultKind.String,
			Codec:          codec.String,
			Comment:        comment.String,
			IsSortingKey:   isInSort == 1,
			IsPartitionKey: isInPart == 1,
		})
	}

	// 2. Fetch table-level metadata & DDL from system.tables
	var engine, sortingKey, pkExpr, partKey, sampKey, tblComment, ddl sql.NullString
	_ = db.QueryRowContext(ctx,
		`SELECT engine, sorting_key, primary_key, partition_key, sampling_key, comment, create_table_query
		 FROM system.tables WHERE database = ? AND name = ?`,
		database, table,
	).Scan(&engine, &sortingKey, &pkExpr, &partKey, &sampKey, &tblComment, &ddl)

	structure.Engine = engine.String
	structure.SortingKey = sortingKey.String
	structure.PrimaryKeyExpr = pkExpr.String
	structure.PartitionKey = partKey.String
	structure.SamplingKey = sampKey.String
	structure.Comment = tblComment.String
	structure.SupportsMutations = isMutableClickHouseEngine(engine.String)

	if ddl.Valid && ddl.String != "" {
		structure.DDL = ddl.String
		structure.TableTTL, structure.Settings = extractClickHouseTableClauses(ddl.String)
	} else {
		structure.DDL = generateClickHouseDDL(database, table, structure)
	}

	// 3. Fetch Data Skipping Indexes
	idxRows, idxErr := db.QueryContext(ctx,
		`SELECT name, expr, type_full, granularity
		 FROM system.data_skipping_indices WHERE database = ? AND table = ?`,
		database, table,
	)
	if idxErr == nil {
		defer idxRows.Close()
		for idxRows.Next() {
			var idxName, expr, typeFull sql.NullString
			var granularity sql.NullInt64
			if err := idxRows.Scan(&idxName, &expr, &typeFull, &granularity); err == nil && idxName.String != "" {
				structure.Indexes = append(structure.Indexes, driver.IndexMeta{
					Name:        idxName.String,
					Expression:  expr.String,
					Type:        typeFull.String,
					Granularity: int(granularity.Int64),
					Columns:     []string{expr.String},
				})
			}
		}
	}

	// 4. Fetch Projections
	projRows, projErr := db.QueryContext(ctx,
		`SELECT name, query FROM system.projections WHERE database = ? AND table = ?`,
		database, table,
	)
	if projErr == nil {
		defer projRows.Close()
		for projRows.Next() {
			var pName, pQuery sql.NullString
			if err := projRows.Scan(&pName, &pQuery); err == nil && pName.String != "" {
				structure.Projections = append(structure.Projections, driver.ProjectionMeta{
					Name:  pName.String,
					Query: pQuery.String,
				})
			}
		}
	}

	// 5. Fetch active parts from system.parts
	partRows, partErr := db.QueryContext(ctx,
		`SELECT partition, name, rows, bytes_on_disk
		 FROM system.parts WHERE database = ? AND table = ? AND active = 1
		 ORDER BY partition, name LIMIT 200`,
		database, table,
	)
	if partErr == nil {
		defer partRows.Close()
		for partRows.Next() {
			var partID, partName sql.NullString
			var pRows, pBytes sql.NullInt64
			if err := partRows.Scan(&partID, &partName, &pRows, &pBytes); err == nil && partName.String != "" {
				structure.Partitions = append(structure.Partitions, driver.PartitionMeta{
					Name:        partName.String,
					Method:      "MergeTree Part",
					Expression:  partID.String,
					Description: formatBytesPretty(uint64(max(0, pBytes.Int64))),
					RowEstimate: pRows.Int64,
				})
			}
		}
	}

	return structure, nil
}

func extractClickHouseTableClauses(ddl string) (ttl string, settings string) {
	upper := strings.ToUpper(ddl)
	if sIdx := strings.LastIndex(upper, "\nSETTINGS "); sIdx >= 0 {
		settings = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(ddl[sIdx+len("\nSETTINGS "):]), ";"))
	} else if sIdx := strings.LastIndex(upper, " SETTINGS "); sIdx >= 0 {
		settings = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(ddl[sIdx+len(" SETTINGS "):]), ";"))
	}
	if tIdx := strings.Index(upper, " TTL "); tIdx >= 0 {
		rest := ddl[tIdx+len(" TTL "):]
		restUpper := upper[tIdx+len(" TTL "):]
		end := len(rest)
		for _, kw := range []string{"\nSETTINGS ", " SETTINGS ", "\nCOMMENT ", " COMMENT "} {
			if kIdx := strings.Index(restUpper, kw); kIdx >= 0 && kIdx < end {
				end = kIdx
			}
		}
		ttl = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(rest[:end]), ";"))
	}
	return ttl, settings
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

var (
	_ driver.QueryCanceller     = (*ClickHouseDriver)(nil)
	_ driver.ServerInfoProvider = (*ClickHouseDriver)(nil)
	_ driver.RowStreamer        = (*ClickHouseDriver)(nil)
)

func (c *ClickHouseDriver) ServerInfo(ctx context.Context) (*driver.ServerInfo, error) {
	ver, err := c.ServerVersion(ctx)
	if err != nil {
		return nil, err
	}
	maj, min, pat := driver.ParseVersionTriplet(ver)
	return &driver.ServerInfo{
		Flavor:  "clickhouse",
		Version: ver,
		Major:   maj,
		Minor:   min,
		Patch:   pat,
	}, nil
}

func (c *ClickHouseDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	db, err := c.dbFor(req.Database)
	if err != nil {
		return nil, err
	}

	if req.ExecutionID != "" {
		queryID := "dhub-" + strings.Map(func(r rune) rune {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
				return r
			}
			return '_'
		}, req.ExecutionID)
		ctx = chdriver.Context(ctx, chdriver.WithQueryID(queryID))
		c.execMu.Lock()
		if c.activeExecs == nil {
			c.activeExecs = make(map[string]chExecEntry)
		}
		c.activeExecs[req.ExecutionID] = chExecEntry{queryID: queryID, db: req.Database}
		c.execMu.Unlock()
		defer func() {
			c.execMu.Lock()
			delete(c.activeExecs, req.ExecutionID)
			c.execMu.Unlock()
		}()
	}

	var readRows, readBytes, wroteRows, totalRows atomic.Uint64
	ctx = chdriver.Context(ctx, chdriver.WithProgress(func(p *chdriver.Progress) {
		if p == nil {
			return
		}
		readRows.Add(p.Rows)
		readBytes.Add(p.Bytes)
		wroteRows.Add(p.WroteRows)
		if p.TotalRows > 0 {
			totalRows.Store(p.TotalRows)
		}
	}))

	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	res, execErr := driver.ExecuteStatementsWithDialect(ctx, conn, req, "clickhouse")
	if res != nil {
		rr := readRows.Load()
		rb := readBytes.Load()
		wr := wroteRows.Load()
		tr := totalRows.Load()
		if rr > 0 || rb > 0 || wr > 0 || tr > 0 {
			res.Stats = &driver.QueryExecutionStats{
				ReadRows:        rr,
				ReadBytes:       rb,
				WrittenRows:     wr,
				TotalRowsToRead: tr,
			}
		}
	}
	return res, execErr
}

func (c *ClickHouseDriver) TrackExecution(executionID, tabID string) func() {
	return func() {}
}

func (c *ClickHouseDriver) CancelExecution(executionID string) (bool, error) {
	c.execMu.Lock()
	entry, ok := c.activeExecs[executionID]
	c.execMu.Unlock()
	if !ok || entry.queryID == "" {
		return false, nil
	}
	db, err := c.dbFor(entry.db)
	if err != nil {
		return false, err
	}
	cctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := db.ExecContext(cctx, "KILL QUERY WHERE query_id = ?", entry.queryID); err != nil {
		return false, err
	}
	return true, nil
}

func (c *ClickHouseDriver) StreamQuery(ctx context.Context, req driver.QueryRequest, onRow func(cols []driver.ColumnMeta, row []any) error) error {
	db, err := c.dbFor(req.Database)
	if err != nil {
		return err
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	return driver.StreamQueryWithDialect(ctx, conn, req, "clickhouse", onRow)
}

func (c *ClickHouseDriver) BeginTx(ctx context.Context, database string) (*sql.Tx, error) {
	return nil, fmt.Errorf("manual transactions are not supported by ClickHouse")
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
		escaped := strings.ReplaceAll(val, `\`, `\\`)
		escaped = strings.ReplaceAll(escaped, "'", `\'`)
		return "'" + escaped + "'"
	case bool:
		if val {
			return "true"
		}
		return "false"
	case time.Time:
		if val.Nanosecond() != 0 {
			return "'" + val.Format("2006-01-02 15:04:05.000000") + "'"
		}
		return "'" + val.Format("2006-01-02 15:04:05") + "'"
	case []any:
		parts := make([]string, len(val))
		for i, item := range val {
			parts[i] = formatSQLVal(item)
		}
		return "[" + strings.Join(parts, ", ") + "]"
	case map[string]any:
		keys := sortedKeys(val)
		parts := make([]string, len(keys))
		for i, k := range keys {
			parts[i] = formatSQLVal(k) + ": " + formatSQLVal(val[k])
		}
		return "{" + strings.Join(parts, ", ") + "}"
	default:
		return fmt.Sprintf("%v", val)
	}
}

func resolveCHDatabase(database, schema, defaultDB string) string {
	db := strings.TrimSpace(database)
	if db == "" || db == "main" {
		db = strings.TrimSpace(schema)
	}
	if db == "" || db == "main" {
		db = defaultDB
	}
	if db == "" {
		db = "default"
	}
	return db
}

func qualifiedCHName(database, schema, table, defaultDB string) string {
	db := resolveCHDatabase(database, schema, defaultDB)
	return fmt.Sprintf("%s.%s", quoteIdent(db), quoteIdent(table))
}

func (c *ClickHouseDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	prefix := qualifiedCHName(database, schema, table, c.defaultDB)

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
			if len(ch.PrimaryKey) == 0 {
				return nil, fmt.Errorf("cannot update row without primary key")
			}
			if len(ch.Changes) == 0 {
				return nil, fmt.Errorf("update has no column changes")
			}
			var sets, where []string
			for _, k := range sortedKeys(ch.Changes) {
				sets = append(sets, fmt.Sprintf("%s = %s", quoteIdent(k), formatSQLVal(ch.Changes[k])))
			}
			for _, k := range sortedKeys(ch.PrimaryKey) {
				if ch.PrimaryKey[k] == nil {
					where = append(where, fmt.Sprintf("%s IS NULL", quoteIdent(k)))
				} else {
					where = append(where, fmt.Sprintf("%s = %s", quoteIdent(k), formatSQLVal(ch.PrimaryKey[k])))
				}
			}
			stmt := fmt.Sprintf("ALTER TABLE %s UPDATE %s WHERE %s SETTINGS mutations_sync = 1;", prefix, strings.Join(sets, ", "), strings.Join(where, " AND "))
			statements = append(statements, stmt)
		case "delete":
			if len(ch.PrimaryKey) == 0 {
				return nil, fmt.Errorf("cannot delete row without primary key")
			}
			var where []string
			for _, k := range sortedKeys(ch.PrimaryKey) {
				if ch.PrimaryKey[k] == nil {
					where = append(where, fmt.Sprintf("%s IS NULL", quoteIdent(k)))
				} else {
					where = append(where, fmt.Sprintf("%s = %s", quoteIdent(k), formatSQLVal(ch.PrimaryKey[k])))
				}
			}
			stmt := fmt.Sprintf("ALTER TABLE %s DELETE WHERE %s SETTINGS mutations_sync = 1;", prefix, strings.Join(where, " AND "))
			statements = append(statements, stmt)
		}
	}
	return statements, nil
}

func (c *ClickHouseDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	targetDB := resolveCHDatabase(database, schema, c.defaultDB)
	db, err := c.dbFor(targetDB)
	if err != nil {
		return 0, err
	}

	prefix := qualifiedCHName(targetDB, schema, table, c.defaultDB)
	var totalAffected int64

	// Group consecutive inserts with identical sorted column lists into multi-row INSERTs
	// to avoid ClickHouse TOO_MANY_PARTS errors.
	i := 0
	for i < len(changes) {
		ch := changes[i]
		if ch.Type == "insert" {
			cols := sortedKeys(ch.Changes)
			if len(cols) == 0 {
				i++
				continue
			}
			colSig := strings.Join(cols, "\x00")
			var batch []driver.RowChange
			for i < len(changes) && changes[i].Type == "insert" {
				nextCols := sortedKeys(changes[i].Changes)
				if strings.Join(nextCols, "\x00") != colSig {
					break
				}
				batch = append(batch, changes[i])
				i++
			}
			quotedCols := make([]string, len(cols))
			for ci, col := range cols {
				quotedCols[ci] = quoteIdent(col)
			}
			rowPlaceholder := "(" + strings.TrimSuffix(strings.Repeat("?, ", len(cols)), ", ") + ")"
			allPlaceholders := make([]string, len(batch))
			vals := make([]any, 0, len(batch)*len(cols))
			for bi, bch := range batch {
				allPlaceholders[bi] = rowPlaceholder
				for _, col := range cols {
					vals = append(vals, bch.Changes[col])
				}
			}
			stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES %s", prefix, strings.Join(quotedCols, ", "), strings.Join(allPlaceholders, ", "))
			if _, err := db.ExecContext(ctx, stmt, vals...); err != nil {
				return totalAffected, err
			}
			totalAffected += int64(len(batch))
			continue
		}

		switch ch.Type {
		case "update":
			if len(ch.PrimaryKey) == 0 {
				return totalAffected, fmt.Errorf("cannot update row without primary key")
			}
			if len(ch.Changes) == 0 {
				return totalAffected, fmt.Errorf("update has no column changes")
			}
			var sets, where []string
			var vals []any
			for _, k := range sortedKeys(ch.Changes) {
				sets = append(sets, fmt.Sprintf("%s = ?", quoteIdent(k)))
				vals = append(vals, ch.Changes[k])
			}
			for _, k := range sortedKeys(ch.PrimaryKey) {
				if ch.PrimaryKey[k] == nil {
					where = append(where, fmt.Sprintf("%s IS NULL", quoteIdent(k)))
				} else {
					where = append(where, fmt.Sprintf("%s = ?", quoteIdent(k)))
					vals = append(vals, ch.PrimaryKey[k])
				}
			}
			stmt := fmt.Sprintf("ALTER TABLE %s UPDATE %s WHERE %s SETTINGS mutations_sync = 1", prefix, strings.Join(sets, ", "), strings.Join(where, " AND "))
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
			if len(ch.PrimaryKey) == 0 {
				return totalAffected, fmt.Errorf("cannot delete row without primary key")
			}
			var where []string
			var vals []any
			for _, k := range sortedKeys(ch.PrimaryKey) {
				if ch.PrimaryKey[k] == nil {
					where = append(where, fmt.Sprintf("%s IS NULL", quoteIdent(k)))
				} else {
					where = append(where, fmt.Sprintf("%s = ?", quoteIdent(k)))
					vals = append(vals, ch.PrimaryKey[k])
				}
			}
			stmt := fmt.Sprintf("ALTER TABLE %s DELETE WHERE %s SETTINGS mutations_sync = 1", prefix, strings.Join(where, " AND "))
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
		i++
	}

	return totalAffected, nil
}

