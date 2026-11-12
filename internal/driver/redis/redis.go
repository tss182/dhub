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
		default:
			if key == "keys" || key == "*" {
				count, _ = conn.DBSize(ctx).Result()
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

func formatRedisResult(cmd string, res any, err error) ([]driver.ColumnMeta, [][]any, int64, string) {
	if err != nil {
		if err == redis.Nil {
			return []driver.ColumnMeta{{Name: "Result", DataType: "string"}}, [][]any{{"(nil)"}}, 0, ""
		}
		return []driver.ColumnMeta{{Name: "Error", DataType: "string"}}, nil, 0, err.Error()
	}

	switch v := res.(type) {
	case string:
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
	for _, c := range changes {
		switch c.Type {
		case "insert", "update":
			if val, ok := c.Changes["value"]; ok {
				if field, okField := c.PrimaryKey["field"]; okField {
					statements = append(statements, fmt.Sprintf("HSET %s %s %q", table, field, fmt.Sprintf("%v", val)))
				} else {
					statements = append(statements, fmt.Sprintf("SET %s %q", table, fmt.Sprintf("%v", val)))
				}
			}
		case "delete":
			if field, okField := c.PrimaryKey["field"]; okField {
				statements = append(statements, fmt.Sprintf("HDEL %s %s", table, field))
			} else {
				statements = append(statements, fmt.Sprintf("DEL %s", table))
			}
		}
	}
	return statements, nil
}

func (r *RedisDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	dbNum := ParseDB(database)
	conn := r.client.Conn()
	defer conn.Close()

	if err := conn.Select(ctx, dbNum).Err(); err != nil {
		return 0, err
	}

	var affected int64
	for _, c := range changes {
		switch c.Type {
		case "insert", "update":
			if val, ok := c.Changes["value"]; ok {
				if field, okField := c.PrimaryKey["field"]; okField {
					_ = conn.HSet(ctx, table, fmt.Sprintf("%v", field), fmt.Sprintf("%v", val)).Err()
					affected++
				} else {
					_ = conn.Set(ctx, table, fmt.Sprintf("%v", val), 0).Err()
					affected++
				}
			}
		case "delete":
			if field, okField := c.PrimaryKey["field"]; okField {
				_ = conn.HDel(ctx, table, fmt.Sprintf("%v", field)).Err()
				affected++
			} else {
				_ = conn.Del(ctx, table).Err()
				affected++
			}
		}
	}
	return affected, nil
}
