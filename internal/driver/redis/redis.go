package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"dhub/internal/driver"
	"github.com/redis/go-redis/v9"
)

type RedisDriver struct {
	client *redis.Client
	opts   *redis.Options
}

func NewRedisDriver(opts *redis.Options) (*RedisDriver, error) {
	client := redis.NewClient(opts)
	return &RedisDriver{
		client: client,
		opts:   opts,
	}, nil
}

func (r *RedisDriver) Ping(ctx context.Context) error {
	return r.client.Ping(ctx).Err()
}

func (r *RedisDriver) Close() error {
	if r.client != nil {
		return r.client.Close()
	}
	return nil
}

// ParseDB helper to extract database index (e.g. "db0", "3", "main" -> int)
func ParseDB(database string) int {
	trimmed := strings.TrimSpace(strings.ToLower(database))
	trimmed = strings.TrimPrefix(trimmed, "db")
	if idx, err := strconv.Atoi(trimmed); err == nil && idx >= 0 {
		return idx
	}
	return 0
}

func (r *RedisDriver) ServerVersion(ctx context.Context) (string, error) {
	info, err := r.client.Info(ctx, "server").Result()
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(info, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "redis_version:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "redis_version:")), nil
		}
	}
	return "", nil
}

func (r *RedisDriver) ListDatabases(ctx context.Context) ([]string, error) {
	var dbs []string
	for i := 0; i < 16; i++ {
		dbs = append(dbs, fmt.Sprintf("db%d", i))
	}
	return dbs, nil
}

func (r *RedisDriver) ListSchemas(ctx context.Context, database string) ([]string, error) {
	return []string{database}, nil
}

func (r *RedisDriver) ListObjects(ctx context.Context, database, schema string) ([]driver.ObjectSummary, error) {
	dbNum := ParseDB(database)
	conn := r.client.Conn()
	defer conn.Close()

	if err := conn.Select(ctx, dbNum).Err(); err != nil {
		return nil, err
	}

	var keys []string
	var cursor uint64
	for {
		var batch []string
		var err error
		batch, cursor, err = conn.Scan(ctx, cursor, "*", 250).Result()
		if err != nil {
			return nil, err
		}
		keys = append(keys, batch...)
		if cursor == 0 || len(keys) >= 1000 {
			break
		}
	}
	sort.Strings(keys)

	if len(keys) == 0 {
		ftObjects := r.listRediSearchIndices(ctx, conn, database)
		if len(ftObjects) > 0 {
			return ftObjects, nil
		}
		return []driver.ObjectSummary{}, nil
	}

	pipe := conn.Pipeline()
	typeCmds := make(map[string]*redis.StatusCmd, len(keys))
	ttlCmds := make(map[string]*redis.DurationCmd, len(keys))
	for _, k := range keys {
		typeCmds[k] = pipe.Type(ctx, k)
		ttlCmds[k] = pipe.TTL(ctx, k)
	}
	_, _ = pipe.Exec(ctx)

	var objects []driver.ObjectSummary
	for _, k := range keys {
		kType := "string"
		if cmd, ok := typeCmds[k]; ok && cmd.Err() == nil && cmd.Val() != "" {
			kType = cmd.Val()
		}

		comment := ""
		if cmd, ok := ttlCmds[k]; ok && cmd.Err() == nil {
			dur := cmd.Val()
			if dur == -1 {
				comment = "no ttl"
			} else if dur == -2 {
				comment = "expired"
			} else {
				comment = fmt.Sprintf("ttl: %v", dur.Round(time.Second))
			}
		}

		objects = append(objects, driver.ObjectSummary{
			Schema:      database,
			Name:        k,
			Type:        kType,
			RowEstimate: 1,
			Comment:     comment,
		})
	}

	ftObjects := r.listRediSearchIndices(ctx, conn, database)
	objects = append(ftObjects, objects...)

	return objects, nil
}

func (r *RedisDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	dbNum := ParseDB(database)
	conn := r.client.Conn()
	defer conn.Close()

	if err := conn.Select(ctx, dbNum).Err(); err != nil {
		return nil, err
	}

	cleanTable := extractKeyName(table)
	if cleanTable == "keys" || cleanTable == "*" {
		return &driver.TableStructure{
			Schema: database,
			Name:   "keys",
			Columns: []driver.ColumnMeta{
				{Name: "key", DataType: "string", RawType: "string", IsPrimaryKey: true},
				{Name: "type", DataType: "string", RawType: "string"},
				{Name: "ttl", DataType: "string", RawType: "string"},
				{Name: "size", DataType: "integer", RawType: "integer"},
				{Name: "value", DataType: "string", RawType: "string"},
			},
			PrimaryKeys: []string{"key"},
			ForeignKeys: []driver.ForeignKeyMeta{},
			Indexes:     []driver.IndexMeta{},
			Comment:     fmt.Sprintf("Redis Keys (%s)", database),
		}, nil
	}

	kType, _ := conn.Type(ctx, table).Result()
	if kType == "" || kType == "none" {
		if ftStruct, ftErr := r.getRediSearchStructure(ctx, conn, database, table); ftErr == nil {
			return ftStruct, nil
		}
		kType = "string"
	}

	structure := &driver.TableStructure{
		Schema:      database,
		Name:        table,
		Columns:     []driver.ColumnMeta{},
		PrimaryKeys: []string{},
		ForeignKeys: []driver.ForeignKeyMeta{},
		Indexes:     []driver.IndexMeta{},
		Comment:     fmt.Sprintf("Redis Key (%s)", kType),
	}

	switch kType {
	case "hash":
		structure.Columns = []driver.ColumnMeta{
			{Name: "field", DataType: "string", RawType: "string", IsPrimaryKey: true},
			{Name: "value", DataType: "string", RawType: "string"},
		}
		structure.PrimaryKeys = []string{"field"}
	case "list":
		structure.Columns = []driver.ColumnMeta{
			{Name: "index", DataType: "integer", RawType: "integer", IsPrimaryKey: true},
			{Name: "value", DataType: "string", RawType: "string"},
		}
		structure.PrimaryKeys = []string{"index"}
	case "set":
		structure.Columns = []driver.ColumnMeta{
			{Name: "member", DataType: "string", RawType: "string", IsPrimaryKey: true},
		}
		structure.PrimaryKeys = []string{"member"}
	case "zset":
		structure.Columns = []driver.ColumnMeta{
			{Name: "member", DataType: "string", RawType: "string", IsPrimaryKey: true},
			{Name: "score", DataType: "float", RawType: "float"},
		}
		structure.PrimaryKeys = []string{"member"}
	case "stream":
		structure.Columns = []driver.ColumnMeta{
			{Name: "id", DataType: "string", RawType: "string", IsPrimaryKey: true},
			{Name: "fields", DataType: "json", RawType: "json"},
		}
		structure.PrimaryKeys = []string{"id"}
	case "ReJSON-RL", "json":
		structure.Columns = []driver.ColumnMeta{
			{Name: "path", DataType: "string", RawType: "string", IsPrimaryKey: true},
			{Name: "value", DataType: "json", RawType: "json"},
		}
		structure.PrimaryKeys = []string{"path"}
	default:
		structure.Columns = []driver.ColumnMeta{
			{Name: "key", DataType: "string", RawType: "string", IsPrimaryKey: true},
			{Name: "value", DataType: "string", RawType: "string"},
			{Name: "type", DataType: "string", RawType: "string"},
			{Name: "ttl", DataType: "string", RawType: "string"},
		}
		structure.PrimaryKeys = []string{"key"}
	}

	return structure, nil
}

var (
	selectCountRegex = regexp.MustCompile(`(?i)^\s*SELECT\s+COUNT\(\*\)\s+FROM\s+([^\s;]+)`)
	selectStarRegex  = regexp.MustCompile(`(?i)^\s*SELECT\s+\*\s+FROM\s+([^\s;]+)`)
)

func extractKeyName(raw string) string {
	raw = strings.TrimSpace(raw)
	// Remove database prefixes like `db0`.`mykey` or "db0"."mykey"
	if strings.Contains(raw, ".") {
		parts := strings.SplitN(raw, ".", 2)
		raw = parts[1]
	}
	raw = strings.Trim(raw, "\"`'")
	return raw
}

func (r *RedisDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	start := time.Now()
	dbNum := ParseDB(req.Database)
	conn := r.client.Conn()
	defer conn.Close()

	if err := conn.Select(ctx, dbNum).Err(); err != nil {
		return nil, fmt.Errorf("failed to select redis db %d: %w", dbNum, err)
	}

	rawSQL := strings.TrimSpace(req.SQL)
	if rawSQL == "" {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []driver.ColumnMeta{},
			Rows:        [][]any{},
			ElapsedMs:   0,
		}, nil
	}

	// 1. Check for Pseudo-SQL SELECT COUNT(*) FROM <table>
	if m := selectCountRegex.FindStringSubmatch(rawSQL); len(m) == 2 {
		key := extractKeyName(m[1])
		count := int64(0)
		if key == "keys" || key == "*" {
			count, _ = conn.DBSize(ctx).Result()
		} else {
			kType, _ := conn.Type(ctx, key).Result()
			switch kType {
			case "hash":
				count, _ = conn.HLen(ctx, key).Result()
			case "list":
				count, _ = conn.LLen(ctx, key).Result()
			case "set":
				count, _ = conn.SCard(ctx, key).Result()
			case "zset":
				count, _ = conn.ZCard(ctx, key).Result()
			case "stream":
				count, _ = conn.XLen(ctx, key).Result()
			case "string", "ReJSON-RL", "json":
				count = 1
			default:
				if ftCount, ok := r.countRediSearchIndex(ctx, conn, key); ok {
					count = ftCount
				}
			}
		}

		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns: []driver.ColumnMeta{
				{Name: "count", DataType: "int8", RawType: "int8"},
			},
			Rows:         [][]any{{count}},
			RowsAffected: 1,
			ElapsedMs:    time.Since(start).Milliseconds(),
		}, nil
	}

	// 2. Check for Pseudo-SQL SELECT * FROM <table>
	if m := selectStarRegex.FindStringSubmatch(rawSQL); len(m) == 2 {
		key := extractKeyName(m[1])
		return r.executeTableQuery(ctx, conn, req, key, start)
	}

	// 3. Otherwise treat as Redis command(s) (split by newlines or semicolons)
	lines := splitRedisStatements(rawSQL)
	if len(lines) == 0 {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []driver.ColumnMeta{},
			Rows:        [][]any{},
			ElapsedMs:   0,
		}, nil
	}

	var allResults []driver.StatementResult
	var lastCols []driver.ColumnMeta
	var lastRows [][]any
	var lastAffected int64
	var lastErr string

	for _, line := range lines {
		cmdStart := time.Now()
		args := ParseRedisCommandArgs(line)
		if len(args) == 0 {
			continue
		}

		cmdName := strings.ToUpper(fmt.Sprint(args[0]))
		if cmdName == "FT.SEARCH" {
			strArgs := make([]string, len(args))
			for i, a := range args {
				strArgs[i] = fmt.Sprint(a)
			}
			args = encodeVectorParamsIfPresent(strArgs)
		}

		res, err := conn.Do(ctx, args...).Result()
		var cols []driver.ColumnMeta
		var rows [][]any
		var affected int64
		var errMsg string
		if cmdName == "FT.SEARCH" && err == nil {
			idxName := ""
			if len(args) > 1 {
				idxName = fmt.Sprint(args[1])
			}
			qr := ftSearchResultToQueryResult(req.ExecutionID, req.Database, idxName, res, time.Since(cmdStart).Milliseconds())
			cols = qr.Columns
			rows = qr.Rows
			affected = qr.RowsAffected
		} else {
			cols, rows, affected, errMsg = formatRedisResult(args[0].(string), res, err)
		}

		stmtRes := driver.StatementResult{
			SQL:          line,
			Columns:      cols,
			Rows:         rows,
			RowsAffected: affected,
			ElapsedMs:    time.Since(cmdStart).Milliseconds(),
			Error:        errMsg,
		}
		allResults = append(allResults, stmtRes)

		lastCols = cols
		lastRows = rows
		lastAffected = affected
		lastErr = errMsg
	}

	return &driver.QueryResult{
		ExecutionID:  req.ExecutionID,
		Columns:      lastCols,
		Rows:         lastRows,
		RowsAffected: lastAffected,
		ElapsedMs:    time.Since(start).Milliseconds(),
		Error:        lastErr,
		Results:      allResults,
	}, nil
}

func (r *RedisDriver) executeTableQuery(ctx context.Context, conn *redis.Conn, req driver.QueryRequest, key string, start time.Time) (*driver.QueryResult, error) {
	if key == "keys" || key == "*" {
		return r.executeKeysListQuery(ctx, conn, req, start)
	}

	kType, _ := conn.Type(ctx, key).Result()
	if kType == "" || kType == "none" {
		if ftRes, ftErr := r.executeRediSearchBrowse(ctx, conn, req, key, start); ftErr == nil {
			return ftRes, nil
		}
	}

	var cols []driver.ColumnMeta
	var rows [][]any
	var pks []string

	limit := req.Limit
	if limit <= 0 {
		limit = 100
	}
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	switch kType {
	case "hash":
		cols = []driver.ColumnMeta{
			{Name: "field", DataType: "string", RawType: "string", IsPrimaryKey: true},
			{Name: "value", DataType: "string", RawType: "string"},
		}
		pks = []string{"field"}
		const maxFullScanThreshold = 1000
		hLen, hLenErr := conn.HLen(ctx, key).Result()
		if hLenErr == nil && hLen > maxFullScanThreshold {
			var cursor uint64
			needed := offset + limit
			type kv struct{ k, v string }
			var collected []kv
			for {
				keysVals, nextCursor, scanErr := conn.HScan(ctx, key, cursor, "*", 250).Result()
				if scanErr != nil {
					break
				}
				for i := 0; i+1 < len(keysVals); i += 2 {
					collected = append(collected, kv{k: keysVals[i], v: keysVals[i+1]})
				}
				cursor = nextCursor
				if cursor == 0 || len(collected) >= needed {
					break
				}
			}
			end := offset + limit
			if end > len(collected) {
				end = len(collected)
			}
			if offset < len(collected) {
				for _, item := range collected[offset:end] {
					rows = append(rows, []any{item.k, item.v})
				}
			}
		} else {
			fields, err := conn.HGetAll(ctx, key).Result()
			if err == nil {
				sortedKeys := make([]string, 0, len(fields))
				for f := range fields {
					sortedKeys = append(sortedKeys, f)
				}
				sort.Strings(sortedKeys)
				end := offset + limit
				if end > len(sortedKeys) {
					end = len(sortedKeys)
				}
				if offset < len(sortedKeys) {
					for _, f := range sortedKeys[offset:end] {
						rows = append(rows, []any{f, fields[f]})
					}
				}
			}
		}

	case "list":
		cols = []driver.ColumnMeta{
			{Name: "index", DataType: "integer", RawType: "integer", IsPrimaryKey: true},
			{Name: "value", DataType: "string", RawType: "string"},
		}
		pks = []string{"index"}
		stop := int64(offset + limit - 1)
		items, err := conn.LRange(ctx, key, int64(offset), stop).Result()
		if err == nil {
			for i, val := range items {
				rows = append(rows, []any{int64(offset + i), val})
			}
		}

	case "set":
		cols = []driver.ColumnMeta{
			{Name: "member", DataType: "string", RawType: "string", IsPrimaryKey: true},
		}
		pks = []string{"member"}
		const maxFullSetThreshold = 1000
		sCard, sCardErr := conn.SCard(ctx, key).Result()
		if sCardErr == nil && sCard > maxFullSetThreshold {
			var cursor uint64
			needed := offset + limit
			var collected []string
			for {
				batch, nextCursor, scanErr := conn.SScan(ctx, key, cursor, "*", 250).Result()
				if scanErr != nil {
					break
				}
				collected = append(collected, batch...)
				cursor = nextCursor
				if cursor == 0 || len(collected) >= needed {
					break
				}
			}
			end := offset + limit
			if end > len(collected) {
				end = len(collected)
			}
			if offset < len(collected) {
				for _, m := range collected[offset:end] {
					rows = append(rows, []any{m})
				}
			}
		} else {
			members, err := conn.SMembers(ctx, key).Result()
			if err == nil {
				sort.Strings(members)
				end := offset + limit
				if end > len(members) {
					end = len(members)
				}
				if offset < len(members) {
					for _, m := range members[offset:end] {
						rows = append(rows, []any{m})
					}
				}
			}
		}

	case "zset":
		cols = []driver.ColumnMeta{
			{Name: "member", DataType: "string", RawType: "string", IsPrimaryKey: true},
			{Name: "score", DataType: "float", RawType: "float"},
		}
		pks = []string{"member"}
		stop := int64(offset + limit - 1)
		items, err := conn.ZRangeWithScores(ctx, key, int64(offset), stop).Result()
		if err == nil {
			for _, item := range items {
				rows = append(rows, []any{item.Member, item.Score})
			}
		}

	case "stream":
		cols = []driver.ColumnMeta{
			{Name: "id", DataType: "string", RawType: "string", IsPrimaryKey: true},
			{Name: "fields", DataType: "json", RawType: "json"},
		}
		pks = []string{"id"}
		msgs, err := conn.XRangeN(ctx, key, "-", "+", int64(offset+limit)).Result()
		if err == nil && offset < len(msgs) {
			for _, msg := range msgs[offset:] {
				fieldsBytes, _ := json.Marshal(msg.Values)
				rows = append(rows, []any{msg.ID, string(fieldsBytes)})
			}
		}

	case "ReJSON-RL", "json":
		cols = []driver.ColumnMeta{
			{Name: "path", DataType: "string", RawType: "string", IsPrimaryKey: true},
			{Name: "value", DataType: "json", RawType: "json"},
		}
		pks = []string{"path"}
		jsonVal, err := conn.Do(ctx, "JSON.GET", key, "$").Text()
		if err != nil {
			jsonVal, err = conn.Do(ctx, "JSON.GET", key).Text()
		}
		if err == nil {
			rows = append(rows, []any{"$", jsonVal})
		}

	default: // string or single key view
		cols = []driver.ColumnMeta{
			{Name: "key", DataType: "string", RawType: "string", IsPrimaryKey: true},
			{Name: "value", DataType: "string", RawType: "string"},
			{Name: "type", DataType: "string", RawType: "string"},
			{Name: "ttl", DataType: "string", RawType: "string"},
		}
		pks = []string{"key"}
		val, _ := conn.Get(ctx, key).Result()
		ttl, _ := conn.TTL(ctx, key).Result()
		ttlStr := "no ttl"
		if ttl > 0 {
			ttlStr = ttl.String()
		}
		if val != "" || kType != "none" {
			rows = append(rows, []any{key, val, kType, ttlStr})
		}
	}

	return &driver.QueryResult{
		ExecutionID:  req.ExecutionID,
		Columns:      cols,
		Rows:         rows,
		RowsAffected: int64(len(rows)),
		ElapsedMs:    time.Since(start).Milliseconds(),
		IsEditable:   true,
		SourceSchema: req.Database,
		SourceTable:  key,
		PrimaryKeys:  pks,
	}, nil
}

var (
	scanWherePatternRegex  = regexp.MustCompile(`(?i)(?:MATCH|LIKE|=)\s*['"]([^'"]+)['"]`)
	keysFilterPatternRegex = regexp.MustCompile(`(?i)(?:['"]%?([^'"%]+)%?['"]|WHERE\s*\(\s*([^\s)]+)\s*\))`)
)

func extractScanPattern(rawSQL string) string {
	if !strings.Contains(strings.ToUpper(rawSQL), "WHERE") {
		return "*"
	}
	m := scanWherePatternRegex.FindStringSubmatch(rawSQL)
	if len(m) > 1 && m[1] != "" {
		p := m[1]
		p = strings.ReplaceAll(p, "%", "*")
		if !strings.Contains(p, "*") {
			p = "*" + p + "*"
		}
		return p
	}
	return "*"
}

func (r *RedisDriver) executeKeysListQuery(ctx context.Context, conn *redis.Conn, req driver.QueryRequest, start time.Time) (*driver.QueryResult, error) {
	cols := []driver.ColumnMeta{
		{Name: "key", DataType: "string", RawType: "string", IsPrimaryKey: true},
		{Name: "type", DataType: "string", RawType: "string"},
		{Name: "ttl", DataType: "string", RawType: "string"},
		{Name: "size", DataType: "integer", RawType: "integer"},
		{Name: "value", DataType: "string", RawType: "string"},
	}
	pks := []string{"key"}

	limit := req.Limit
	if limit <= 0 {
		limit = 100
	}
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	scanPattern := extractScanPattern(req.SQL)
	var allKeys []string
	var cursor uint64
	for {
		var batch []string
		var err error
		batch, cursor, err = conn.Scan(ctx, cursor, scanPattern, 500).Result()
		if err != nil {
			return nil, err
		}
		allKeys = append(allKeys, batch...)
		if cursor == 0 || len(allKeys) >= 10000 {
			break
		}
	}
	sort.Strings(allKeys)

	// In-memory filter if WHERE clause present
	rawSQL := req.SQL
	if strings.Contains(strings.ToUpper(rawSQL), "WHERE") {
		filterPattern := ""
		m := keysFilterPatternRegex.FindStringSubmatch(rawSQL)
		if len(m) > 1 {
			for _, sub := range m[1:] {
				if sub != "" && !strings.EqualFold(sub, "key") && !strings.EqualFold(sub, "keys") {
					filterPattern = strings.ToLower(sub)
					break
				}
			}
		}
		if filterPattern != "" {
			var filtered []string
			for _, k := range allKeys {
				if strings.Contains(strings.ToLower(k), filterPattern) {
					filtered = append(filtered, k)
				}
			}
			allKeys = filtered
		}
	}

	end := offset + limit
	if end > len(allKeys) {
		end = len(allKeys)
	}

	var pageKeys []string
	if offset < len(allKeys) {
		pageKeys = allKeys[offset:end]
	}

	if len(pageKeys) == 0 {
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      cols,
			Rows:         [][]any{},
			RowsAffected: 0,
			ElapsedMs:    time.Since(start).Milliseconds(),
			IsEditable:   true,
			SourceSchema: req.Database,
			SourceTable:  "keys",
			PrimaryKeys:  pks,
		}, nil
	}

	pipe := conn.Pipeline()
	typeCmds := make(map[string]*redis.StatusCmd, len(pageKeys))
	ttlCmds := make(map[string]*redis.DurationCmd, len(pageKeys))
	for _, k := range pageKeys {
		typeCmds[k] = pipe.Type(ctx, k)
		ttlCmds[k] = pipe.TTL(ctx, k)
	}
	_, _ = pipe.Exec(ctx)

	pipe2 := conn.Pipeline()
	valCmds := make(map[string]*redis.StringCmd, len(pageKeys))
	hLenCmds := make(map[string]*redis.IntCmd, len(pageKeys))
	lLenCmds := make(map[string]*redis.IntCmd, len(pageKeys))
	sCardCmds := make(map[string]*redis.IntCmd, len(pageKeys))
	zCardCmds := make(map[string]*redis.IntCmd, len(pageKeys))

	for _, k := range pageKeys {
		kType := "string"
		if cmd, ok := typeCmds[k]; ok && cmd.Err() == nil && cmd.Val() != "" {
			kType = cmd.Val()
		}
		switch kType {
		case "string":
			valCmds[k] = pipe2.Get(ctx, k)
		case "hash":
			hLenCmds[k] = pipe2.HLen(ctx, k)
		case "list":
			lLenCmds[k] = pipe2.LLen(ctx, k)
		case "set":
			sCardCmds[k] = pipe2.SCard(ctx, k)
		case "zset":
			zCardCmds[k] = pipe2.ZCard(ctx, k)
		}
	}
	_, _ = pipe2.Exec(ctx)

	var rows [][]any
	for _, k := range pageKeys {
		kType := "string"
		if cmd, ok := typeCmds[k]; ok && cmd.Err() == nil && cmd.Val() != "" {
			kType = cmd.Val()
		}

		ttlStr := "no ttl"
		if cmd, ok := ttlCmds[k]; ok && cmd.Err() == nil {
			dur := cmd.Val()
			if dur == -1 {
				ttlStr = "no ttl"
			} else if dur == -2 {
				ttlStr = "expired"
			} else {
				ttlStr = fmt.Sprintf("%v", dur.Round(time.Second))
			}
		}

		size := int64(0)
		valStr := ""
		switch kType {
		case "string":
			if cmd, ok := valCmds[k]; ok && cmd.Err() == nil {
				valStr = cmd.Val()
				size = int64(len(valStr))
			}
		case "hash":
			if cmd, ok := hLenCmds[k]; ok && cmd.Err() == nil {
				size = cmd.Val()
				valStr = fmt.Sprintf("(%d fields)", size)
			}
		case "list":
			if cmd, ok := lLenCmds[k]; ok && cmd.Err() == nil {
				size = cmd.Val()
				valStr = fmt.Sprintf("(%d items)", size)
			}
		case "set":
			if cmd, ok := sCardCmds[k]; ok && cmd.Err() == nil {
				size = cmd.Val()
				valStr = fmt.Sprintf("(%d members)", size)
			}
		case "zset":
			if cmd, ok := zCardCmds[k]; ok && cmd.Err() == nil {
				size = cmd.Val()
				valStr = fmt.Sprintf("(%d members)", size)
			}
		default:
			valStr = fmt.Sprintf("(%s)", kType)
		}

		rows = append(rows, []any{k, kType, ttlStr, size, valStr})
	}

	return &driver.QueryResult{
		ExecutionID:  req.ExecutionID,
		Columns:      cols,
		Rows:         rows,
		RowsAffected: int64(len(rows)),
		ElapsedMs:    time.Since(start).Milliseconds(),
		IsEditable:   true,
		SourceSchema: req.Database,
		SourceTable:  "keys",
		PrimaryKeys:  pks,
	}, nil
}

func formatRedisResult(cmd string, res any, err error) ([]driver.ColumnMeta, [][]any, int64, string) {
	if err != nil {
		if err == redis.Nil {
			return []driver.ColumnMeta{{Name: "Result", DataType: "string"}}, [][]any{{"(nil)"}}, 0, ""
		}
		return []driver.ColumnMeta{{Name: "Error", DataType: "string"}}, nil, 0, err.Error()
	}

	switch v := res.(type) {
	case string:
		if strings.EqualFold(cmd, "INFO") {
			var rows [][]any
			lines := strings.Split(v, "\n")
			currentSection := "General"
			for _, l := range lines {
				l = strings.TrimSpace(l)
				if l == "" {
					continue
				}
				if strings.HasPrefix(l, "#") {
					currentSection = strings.TrimSpace(strings.TrimPrefix(l, "#"))
					continue
				}
				if idx := strings.Index(l, ":"); idx != -1 {
					k := strings.TrimSpace(l[:idx])
					val := strings.TrimSpace(l[idx+1:])
					rows = append(rows, []any{currentSection, k, val})
				}
			}
			return []driver.ColumnMeta{
				{Name: "Section", DataType: "string"},
				{Name: "Property", DataType: "string"},
				{Name: "Value", DataType: "string"},
			}, rows, int64(len(rows)), ""
		}
		return []driver.ColumnMeta{{Name: "Result", DataType: "string"}}, [][]any{{v}}, 1, ""
	case int64:
		return []driver.ColumnMeta{{Name: "Result", DataType: "int64"}}, [][]any{{v}}, v, ""
	case bool:
		return []driver.ColumnMeta{{Name: "Result", DataType: "boolean"}}, [][]any{{v}}, 1, ""
	case []any:
		upperCmd := strings.ToUpper(cmd)
		// If command produces key-value pairs (like HGETALL or CONFIG GET) and even count
		if (upperCmd == "HGETALL" || upperCmd == "CONFIG") && len(v)%2 == 0 {
			var rows [][]any
			for i := 0; i < len(v); i += 2 {
				rows = append(rows, []any{fmt.Sprintf("%v", v[i]), fmt.Sprintf("%v", v[i+1])})
			}
			return []driver.ColumnMeta{
				{Name: "Key", DataType: "string"},
				{Name: "Value", DataType: "string"},
			}, rows, int64(len(rows)), ""
		}

		var rows [][]any
		for i, item := range v {
			rows = append(rows, []any{i + 1, fmt.Sprintf("%v", item)})
		}
		return []driver.ColumnMeta{
			{Name: "#", DataType: "integer"},
			{Name: "Value", DataType: "string"},
		}, rows, int64(len(rows)), ""

	case map[string]string:
		var rows [][]any
		for k, val := range v {
			rows = append(rows, []any{k, val})
		}
		return []driver.ColumnMeta{
			{Name: "Key", DataType: "string"},
			{Name: "Value", DataType: "string"},
		}, rows, int64(len(rows)), ""

	case nil:
		return []driver.ColumnMeta{{Name: "Result", DataType: "string"}}, [][]any{{"(nil)"}}, 0, ""
	default:
		return []driver.ColumnMeta{{Name: "Result", DataType: "string"}}, [][]any{{fmt.Sprintf("%v", v)}}, 1, ""
	}
}

func splitRedisStatements(raw string) []string {
	return driver.SplitRedisStatements(raw)
}

func ParseRedisCommandArgs(cmdStr string) []any {
	var args []any
	var current strings.Builder
	inQuote := false
	var quoteChar rune

	runes := []rune(cmdStr)
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		if inQuote {
			if r == quoteChar {
				inQuote = false
			} else if r == '\\' && i+1 < len(runes) {
				i++
				current.WriteRune(runes[i])
			} else {
				current.WriteRune(r)
			}
		} else {
			if r == '"' || r == '\'' {
				inQuote = true
				quoteChar = r
			} else if r == ' ' || r == '\t' {
				if current.Len() > 0 {
					args = append(args, current.String())
					current.Reset()
				}
			} else {
				current.WriteRune(r)
			}
		}
	}
	if current.Len() > 0 {
		args = append(args, current.String())
	}
	return args
}

func formatRedisPreviewArg(s string) string {
	if s == "" || strings.ContainsAny(s, " \t\n\r\"'\\") {
		return fmt.Sprintf("%q", s)
	}
	return s
}

func (r *RedisDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
	if isRediSearchChanges(changes) {
		return generateRediSearchDML(changes), nil
	}
	var statements []string
	cleanTable := extractKeyName(table)
	for _, c := range changes {
		targetKey := table
		if cleanTable == "keys" || cleanTable == "*" {
			if k, ok := c.PrimaryKey["key"]; ok && fmt.Sprintf("%v", k) != "" {
				targetKey = fmt.Sprintf("%v", k)
			} else if k, ok := c.Changes["key"]; ok && fmt.Sprintf("%v", k) != "" {
				targetKey = fmt.Sprintf("%v", k)
			}
		}
		qKey := formatRedisPreviewArg(targetKey)

		switch c.Type {
		case "insert", "update":
			if field, okField := c.PrimaryKey["field"]; okField && cleanTable != "keys" && cleanTable != "*" {
				if val, ok := c.Changes["value"]; ok {
					statements = append(statements, fmt.Sprintf("HSET %s %s %q", qKey, formatRedisPreviewArg(fmt.Sprintf("%v", field)), fmt.Sprintf("%v", val)))
				}
				continue
			}
			if fieldVal, hasFieldChange := c.Changes["field"]; hasFieldChange && cleanTable != "keys" && cleanTable != "*" {
				statements = append(statements, fmt.Sprintf("HSET %s %s %q", qKey, formatRedisPreviewArg(fmt.Sprintf("%v", fieldVal)), fmt.Sprintf("%v", c.Changes["value"])))
				continue
			}
			if idxVal, okIdx := c.PrimaryKey["index"]; okIdx && cleanTable != "keys" && cleanTable != "*" {
				if val, ok := c.Changes["value"]; ok {
					statements = append(statements, fmt.Sprintf("LSET %s %v %q", qKey, idxVal, fmt.Sprintf("%v", val)))
				}
				continue
			}
			if _, okIdx := c.Changes["index"]; okIdx && cleanTable != "keys" && cleanTable != "*" {
				if val, ok := c.Changes["value"]; ok {
					statements = append(statements, fmt.Sprintf("RPUSH %s %q", qKey, fmt.Sprintf("%v", val)))
				}
				continue
			}
			if member, okMember := c.PrimaryKey["member"]; okMember && cleanTable != "keys" && cleanTable != "*" {
				if score, okScore := c.Changes["score"]; okScore {
					statements = append(statements, fmt.Sprintf("ZADD %s %v %s", qKey, score, formatRedisPreviewArg(fmt.Sprintf("%v", member))))
				} else if newMember, okNew := c.Changes["member"]; okNew {
					statements = append(statements, fmt.Sprintf("SREM %s %s; SADD %s %s", qKey, formatRedisPreviewArg(fmt.Sprintf("%v", member)), qKey, formatRedisPreviewArg(fmt.Sprintf("%v", newMember))))
				}
				continue
			}
			if memberVal, okMember := c.Changes["member"]; okMember && cleanTable != "keys" && cleanTable != "*" {
				if score, okScore := c.Changes["score"]; okScore {
					statements = append(statements, fmt.Sprintf("ZADD %s %v %s", qKey, score, formatRedisPreviewArg(fmt.Sprintf("%v", memberVal))))
				} else {
					statements = append(statements, fmt.Sprintf("SADD %s %s", qKey, formatRedisPreviewArg(fmt.Sprintf("%v", memberVal))))
				}
				continue
			}
			if val, ok := c.Changes["value"]; ok {
				statements = append(statements, fmt.Sprintf("SET %s %q", qKey, fmt.Sprintf("%v", val)))
			}
			if ttlVal, ok := c.Changes["ttl"]; ok {
				dur, isPersist, err := parseRedisTTL(ttlVal)
				if isPersist {
					statements = append(statements, fmt.Sprintf("PERSIST %s", qKey))
				} else if err == nil {
					statements = append(statements, fmt.Sprintf("EXPIRE %s %d", qKey, int64(dur.Seconds())))
				}
			}
		case "delete":
			if field, okField := c.PrimaryKey["field"]; okField && cleanTable != "keys" && cleanTable != "*" {
				statements = append(statements, fmt.Sprintf("HDEL %s %s", qKey, formatRedisPreviewArg(fmt.Sprintf("%v", field))))
			} else if idxVal, okIdx := c.PrimaryKey["index"]; okIdx && cleanTable != "keys" && cleanTable != "*" {
				statements = append(statements, fmt.Sprintf("-- remove list item at index %v from %s (LSET + LREM)", idxVal, qKey))
			} else if member, okMember := c.PrimaryKey["member"]; okMember && cleanTable != "keys" && cleanTable != "*" {
				statements = append(statements, fmt.Sprintf("SREM/ZREM %s %s", qKey, formatRedisPreviewArg(fmt.Sprintf("%v", member))))
			} else {
				statements = append(statements, fmt.Sprintf("DEL %s", qKey))
			}
		}
	}
	return statements, nil
}

func parseRedisTTL(v any) (time.Duration, bool, error) {
	if v == nil {
		return 0, true, nil
	}
	s := strings.TrimSpace(strings.ToLower(fmt.Sprintf("%v", v)))
	s = strings.TrimPrefix(s, "ttl:")
	s = strings.TrimPrefix(s, "ttl")
	s = strings.TrimSpace(s)

	if s == "" || s == "no ttl" || s == "none" || s == "persist" || s == "-1" || s == "0" || s == "expired" || s == "-2" {
		return 0, true, nil
	}

	// Normalizations
	s = strings.ReplaceAll(s, "seconds", "s")
	s = strings.ReplaceAll(s, "second", "s")
	s = strings.ReplaceAll(s, "secs", "s")
	s = strings.ReplaceAll(s, "sec", "s")
	s = strings.ReplaceAll(s, "minutes", "m")
	s = strings.ReplaceAll(s, "minute", "m")
	s = strings.ReplaceAll(s, "mins", "m")
	s = strings.ReplaceAll(s, "min", "m")
	s = strings.ReplaceAll(s, "hours", "h")
	s = strings.ReplaceAll(s, "hour", "h")
	s = strings.ReplaceAll(s, "hr", "h")
	s = strings.ReplaceAll(s, " ", "")

	// Check if pure integer (seconds)
	if secs, err := strconv.ParseInt(s, 10, 64); err == nil {
		if secs <= 0 {
			return 0, true, nil
		}
		return time.Duration(secs) * time.Second, false, nil
	}
	// Check if float (seconds)
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		if f <= 0 {
			return 0, true, nil
		}
		return time.Duration(f * float64(time.Second)), false, nil
	}

	// Check days
	if strings.HasSuffix(s, "days") || strings.HasSuffix(s, "day") || strings.HasSuffix(s, "d") {
		dStr := strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(s, "days"), "day"), "d")
		if days, err := strconv.ParseFloat(dStr, 64); err == nil {
			if days <= 0 {
				return 0, true, nil
			}
			return time.Duration(days * 24 * float64(time.Hour)), false, nil
		}
	}

	// Try time.ParseDuration (supports 10s, 5m, 1h30m, 31h23m32s, etc.)
	dur, err := time.ParseDuration(s)
	if err == nil {
		if dur <= 0 {
			return 0, true, nil
		}
		return dur, false, nil
	}

	return 0, false, fmt.Errorf("invalid ttl format: %q", v)
}

func (r *RedisDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	dbNum := ParseDB(database)
	conn := r.client.Conn()
	defer conn.Close()

	if err := conn.Select(ctx, dbNum).Err(); err != nil {
		return 0, err
	}

	if isRediSearchChanges(changes) {
		return applyRediSearchChanges(ctx, conn, changes)
	}

	cleanTable := extractKeyName(table)
	var affected int64
	for _, c := range changes {
		targetKey := table
		if cleanTable == "keys" || cleanTable == "*" {
			if k, ok := c.PrimaryKey["key"]; ok && fmt.Sprintf("%v", k) != "" {
				targetKey = fmt.Sprintf("%v", k)
			} else if k, ok := c.Changes["key"]; ok && fmt.Sprintf("%v", k) != "" {
				targetKey = fmt.Sprintf("%v", k)
			}
		}

		switch c.Type {
		case "insert", "update":
			var rowUpdated bool
			isSingleKeyView := cleanTable != "keys" && cleanTable != "*"
			kType := ""
			if isSingleKeyView {
				kType, _ = conn.Type(ctx, targetKey).Result()
			}

			// Hash mutations
			if field, okField := c.PrimaryKey["field"]; okField && isSingleKeyView {
				if val, ok := c.Changes["value"]; ok {
					if err := conn.HSet(ctx, targetKey, fmt.Sprintf("%v", field), fmt.Sprintf("%v", val)).Err(); err != nil {
						return affected, fmt.Errorf("HSET failed on %q: %w", targetKey, err)
					}
					rowUpdated = true
				}
			} else if kType == "hash" {
				fieldVal, okField := c.Changes["field"]
				if !okField || fmt.Sprintf("%v", fieldVal) == "" {
					return affected, fmt.Errorf("hash insert requires a 'field' name")
				}
				valStr := ""
				if v, ok := c.Changes["value"]; ok && v != nil {
					valStr = fmt.Sprintf("%v", v)
				}
				if err := conn.HSet(ctx, targetKey, fmt.Sprintf("%v", fieldVal), valStr).Err(); err != nil {
					return affected, fmt.Errorf("HSET failed on %q: %w", targetKey, err)
				}
				rowUpdated = true
			} else if idxVal, okIdx := c.PrimaryKey["index"]; okIdx && isSingleKeyView {
				// List update by index
				idx, convErr := strconv.ParseInt(fmt.Sprintf("%v", idxVal), 10, 64)
				if convErr != nil {
					return affected, fmt.Errorf("invalid list index %v: %w", idxVal, convErr)
				}
				if val, ok := c.Changes["value"]; ok {
					if err := conn.LSet(ctx, targetKey, idx, fmt.Sprintf("%v", val)).Err(); err != nil {
						return affected, fmt.Errorf("LSET failed on %q[%d]: %w", targetKey, idx, err)
					}
					rowUpdated = true
				}
			} else if kType == "list" {
				// List insert
				valStr := ""
				if v, ok := c.Changes["value"]; ok && v != nil {
					valStr = fmt.Sprintf("%v", v)
				}
				if err := conn.RPush(ctx, targetKey, valStr).Err(); err != nil {
					return affected, fmt.Errorf("RPUSH failed on %q: %w", targetKey, err)
				}
				rowUpdated = true
			} else if member, okMember := c.PrimaryKey["member"]; okMember && isSingleKeyView {
				// Set or ZSet update
				oldMember := fmt.Sprintf("%v", member)
				if kType == "zset" {
					score := 0.0
					if sVal, okScore := c.Changes["score"]; okScore {
						parsed, pErr := strconv.ParseFloat(fmt.Sprintf("%v", sVal), 64)
						if pErr != nil {
							return affected, fmt.Errorf("invalid zset score %v: %w", sVal, pErr)
						}
						score = parsed
					} else {
						curScore, sErr := conn.ZScore(ctx, targetKey, oldMember).Result()
						if sErr != nil {
							return affected, fmt.Errorf("ZSCORE failed on %q: %w", targetKey, sErr)
						}
						score = curScore
					}
					newMember := oldMember
					if mVal, okNew := c.Changes["member"]; okNew && fmt.Sprintf("%v", mVal) != "" {
						newMember = fmt.Sprintf("%v", mVal)
					}
					if newMember != oldMember {
						if err := conn.ZRem(ctx, targetKey, oldMember).Err(); err != nil {
							return affected, fmt.Errorf("ZREM failed on %q: %w", targetKey, err)
						}
					}
					if err := conn.ZAdd(ctx, targetKey, redis.Z{Score: score, Member: newMember}).Err(); err != nil {
						return affected, fmt.Errorf("ZADD failed on %q: %w", targetKey, err)
					}
					rowUpdated = true
				} else if kType == "set" {
					if mVal, okNew := c.Changes["member"]; okNew && fmt.Sprintf("%v", mVal) != "" && fmt.Sprintf("%v", mVal) != oldMember {
						if err := conn.SRem(ctx, targetKey, oldMember).Err(); err != nil {
							return affected, fmt.Errorf("SREM failed on %q: %w", targetKey, err)
						}
						if err := conn.SAdd(ctx, targetKey, fmt.Sprintf("%v", mVal)).Err(); err != nil {
							return affected, fmt.Errorf("SADD failed on %q: %w", targetKey, err)
						}
						rowUpdated = true
					}
				}
			} else if kType == "zset" {
				mVal, okM := c.Changes["member"]
				if !okM || fmt.Sprintf("%v", mVal) == "" {
					return affected, fmt.Errorf("zset insert requires a 'member'")
				}
				score := 0.0
				if sVal, okS := c.Changes["score"]; okS && sVal != nil {
					parsed, pErr := strconv.ParseFloat(fmt.Sprintf("%v", sVal), 64)
					if pErr != nil {
						return affected, fmt.Errorf("invalid zset score %v: %w", sVal, pErr)
					}
					score = parsed
				}
				if err := conn.ZAdd(ctx, targetKey, redis.Z{Score: score, Member: fmt.Sprintf("%v", mVal)}).Err(); err != nil {
					return affected, fmt.Errorf("ZADD failed on %q: %w", targetKey, err)
				}
				rowUpdated = true
			} else if kType == "set" {
				mVal, okM := c.Changes["member"]
				if !okM || fmt.Sprintf("%v", mVal) == "" {
					return affected, fmt.Errorf("set insert requires a 'member'")
				}
				if err := conn.SAdd(ctx, targetKey, fmt.Sprintf("%v", mVal)).Err(); err != nil {
					return affected, fmt.Errorf("SADD failed on %q: %w", targetKey, err)
				}
				rowUpdated = true
			} else {
				// String or keys-list view: guard against overwriting structured keys with SET
				if val, ok := c.Changes["value"]; ok {
					existingType, _ := conn.Type(ctx, targetKey).Result()
					if existingType != "" && existingType != "none" && existingType != "string" {
						return affected, fmt.Errorf("cannot overwrite %s key %q with string SET; open the key directly to edit its items", existingType, targetKey)
					}
					var exp time.Duration = redis.KeepTTL
					if c.Type == "insert" {
						exp = 0
					}
					if ttlVal, okTTL := c.Changes["ttl"]; okTTL {
						dur, isPersist, err := parseRedisTTL(ttlVal)
						if err == nil {
							if isPersist {
								exp = 0
							} else {
								exp = dur
							}
						}
					}
					if err := conn.Set(ctx, targetKey, fmt.Sprintf("%v", val), exp).Err(); err != nil {
						return affected, fmt.Errorf("SET failed on %q: %w", targetKey, err)
					}
					rowUpdated = true
				}
			}

			if ttlVal, ok := c.Changes["ttl"]; ok {
				dur, isPersist, err := parseRedisTTL(ttlVal)
				if err != nil {
					return affected, err
				}
				if isPersist {
					if err := conn.Persist(ctx, targetKey).Err(); err != nil {
						return affected, fmt.Errorf("PERSIST failed on %q: %w", targetKey, err)
					}
					rowUpdated = true
				} else {
					if err := conn.Expire(ctx, targetKey, dur).Err(); err != nil {
						return affected, fmt.Errorf("EXPIRE failed on %q: %w", targetKey, err)
					}
					rowUpdated = true
				}
			}

			if rowUpdated {
				affected++
			}
		case "delete":
			isSingleKeyView := cleanTable != "keys" && cleanTable != "*"
			if field, okField := c.PrimaryKey["field"]; okField && isSingleKeyView {
				n, err := conn.HDel(ctx, targetKey, fmt.Sprintf("%v", field)).Result()
				if err != nil {
					return affected, fmt.Errorf("HDEL failed on %q: %w", targetKey, err)
				}
				affected += n
			} else if idxVal, okIdx := c.PrimaryKey["index"]; okIdx && isSingleKeyView {
				idx, convErr := strconv.ParseInt(fmt.Sprintf("%v", idxVal), 10, 64)
				if convErr != nil {
					return affected, fmt.Errorf("invalid list index %v: %w", idxVal, convErr)
				}
				sentinel := fmt.Sprintf("__dhub_del_%d__", time.Now().UnixNano())
				if err := conn.LSet(ctx, targetKey, idx, sentinel).Err(); err != nil {
					return affected, fmt.Errorf("LSET failed during delete on %q[%d]: %w", targetKey, idx, err)
				}
				n, err := conn.LRem(ctx, targetKey, 1, sentinel).Result()
				if err != nil {
					return affected, fmt.Errorf("LREM failed on %q: %w", targetKey, err)
				}
				affected += n
			} else if member, okMember := c.PrimaryKey["member"]; okMember && isSingleKeyView {
				kType, _ := conn.Type(ctx, targetKey).Result()
				memberStr := fmt.Sprintf("%v", member)
				if kType == "zset" {
					n, err := conn.ZRem(ctx, targetKey, memberStr).Result()
					if err != nil {
						return affected, fmt.Errorf("ZREM failed on %q: %w", targetKey, err)
					}
					affected += n
				} else {
					n, err := conn.SRem(ctx, targetKey, memberStr).Result()
					if err != nil {
						return affected, fmt.Errorf("SREM failed on %q: %w", targetKey, err)
					}
					affected += n
				}
			} else {
				n, err := conn.Del(ctx, targetKey).Result()
				if err != nil {
					return affected, fmt.Errorf("DEL failed on %q: %w", targetKey, err)
				}
				affected += n
			}
		}
	}
	return affected, nil
}

