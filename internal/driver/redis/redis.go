package redis

import (
	"context"
	"database/sql"
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
			case "string":
				count = 1
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

		res, err := conn.Do(ctx, args...).Result()
		cols, rows, affected, errMsg := formatRedisResult(args[0].(string), res, err)

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
		fields, err := conn.HGetAll(ctx, key).Result()
		if err == nil {
			var sortedKeys []string
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

func extractScanPattern(rawSQL string) string {
	if !strings.Contains(strings.ToUpper(rawSQL), "WHERE") {
		return "*"
	}
	m := regexp.MustCompile(`(?i)(?:MATCH|LIKE|=)\s*['"]([^'"]+)['"]`).FindStringSubmatch(rawSQL)
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
		m := regexp.MustCompile(`(?i)(?:['"]%?([^'"%]+)%?['"]|WHERE\s*\(\s*([^\s)]+)\s*\))`).FindStringSubmatch(rawSQL)
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
	var stmts []string
	rawLines := strings.Split(raw, "\n")
	for _, l := range rawLines {
		trimmed := strings.TrimSpace(l)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "--") {
			continue
		}
		// Semicolon separation on single line
		if strings.Contains(trimmed, ";") {
			subParts := strings.Split(trimmed, ";")
			for _, sp := range subParts {
				spTrim := strings.TrimSpace(sp)
				if spTrim != "" && !strings.HasPrefix(spTrim, "#") && !strings.HasPrefix(spTrim, "--") {
					stmts = append(stmts, spTrim)
				}
			}
		} else {
			stmts = append(stmts, trimmed)
		}
	}
	return stmts
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

func (r *RedisDriver) BeginTx(ctx context.Context, database string) (*sql.Tx, error) {
	return nil, nil
}

func (r *RedisDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
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

		switch c.Type {
		case "insert", "update":
			if val, ok := c.Changes["value"]; ok {
				if field, okField := c.PrimaryKey["field"]; okField && cleanTable != "keys" && cleanTable != "*" {
					statements = append(statements, fmt.Sprintf("HSET %s %s %q", targetKey, field, fmt.Sprintf("%v", val)))
				} else {
					statements = append(statements, fmt.Sprintf("SET %s %q", targetKey, fmt.Sprintf("%v", val)))
				}
			}
			if ttlVal, ok := c.Changes["ttl"]; ok {
				dur, isPersist, err := parseRedisTTL(ttlVal)
				if isPersist {
					statements = append(statements, fmt.Sprintf("PERSIST %s", targetKey))
				} else if err == nil {
					statements = append(statements, fmt.Sprintf("EXPIRE %s %d", targetKey, int64(dur.Seconds())))
				}
			}
		case "delete":
			if field, okField := c.PrimaryKey["field"]; okField && cleanTable != "keys" && cleanTable != "*" {
				statements = append(statements, fmt.Sprintf("HDEL %s %s", targetKey, field))
			} else {
				statements = append(statements, fmt.Sprintf("DEL %s", targetKey))
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
			if val, ok := c.Changes["value"]; ok {
				if field, okField := c.PrimaryKey["field"]; okField && cleanTable != "keys" && cleanTable != "*" {
					if err := conn.HSet(ctx, targetKey, fmt.Sprintf("%v", field), fmt.Sprintf("%v", val)).Err(); err == nil {
						rowUpdated = true
					}
				} else {
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
					if err := conn.Set(ctx, targetKey, fmt.Sprintf("%v", val), exp).Err(); err == nil {
						rowUpdated = true
					}
				}
			}

			if ttlVal, ok := c.Changes["ttl"]; ok {
				dur, isPersist, err := parseRedisTTL(ttlVal)
				if err == nil {
					if isPersist {
						if err := conn.Persist(ctx, targetKey).Err(); err == nil {
							rowUpdated = true
						}
					} else {
						if err := conn.Expire(ctx, targetKey, dur).Err(); err == nil {
							rowUpdated = true
						}
					}
				}
			}

			if rowUpdated {
				affected++
			}
		case "delete":
			if field, okField := c.PrimaryKey["field"]; okField && cleanTable != "keys" && cleanTable != "*" {
				_ = conn.HDel(ctx, targetKey, fmt.Sprintf("%v", field)).Err()
				affected++
			} else {
				_ = conn.Del(ctx, targetKey).Err()
				affected++
			}
		}
	}
	return affected, nil
}

