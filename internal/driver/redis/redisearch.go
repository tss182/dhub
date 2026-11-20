package redis

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"dhub/internal/driver"
	"github.com/redis/go-redis/v9"
)

// listRediSearchIndices queries FT._LIST best-effort. Returns nil when RediSearch is not loaded.
func (r *RedisDriver) listRediSearchIndices(ctx context.Context, conn *redis.Conn, database string) []driver.ObjectSummary {
	res, err := conn.Do(ctx, "FT._LIST").Result()
	if err != nil {
		return nil
	}
	rawList, ok := res.([]any)
	if !ok || len(rawList) == 0 {
		return nil
	}

	names := make([]string, 0, len(rawList))
	for _, item := range rawList {
		if s := fmt.Sprint(item); s != "" {
			names = append(names, s)
		}
	}
	sort.Strings(names)

	out := make([]driver.ObjectSummary, 0, len(names))
	for _, name := range names {
		rowEst := int64(-1)
		if info, iErr := conn.Do(ctx, "FT.INFO", name).Result(); iErr == nil {
			if m := respPairSliceToMap(info); m != nil {
				if numDocs, ok := m["num_docs"]; ok {
					if n, perr := strconv.ParseInt(fmt.Sprint(numDocs), 10, 64); perr == nil {
						rowEst = n
					}
				}
			}
		}
		out = append(out, driver.ObjectSummary{
			Schema:      database,
			Name:        name,
			Type:        "table",
			RowEstimate: rowEst,
			Comment:     "RediSearch index",
		})
	}
	return out
}

func respPairSliceToMap(v any) map[string]any {
	switch m := v.(type) {
	case map[any]any:
		out := make(map[string]any, len(m))
		for k, val := range m {
			out[fmt.Sprint(k)] = val
		}
		return out
	case map[string]any:
		return m
	case []any:
		out := make(map[string]any, len(m)/2)
		for i := 0; i+1 < len(m); i += 2 {
			out[fmt.Sprint(m[i])] = m[i+1]
		}
		return out
	default:
		return nil
	}
}

func (r *RedisDriver) getRediSearchStructure(ctx context.Context, conn *redis.Conn, database, indexName string) (*driver.TableStructure, error) {
	rawInfo, err := conn.Do(ctx, "FT.INFO", indexName).Result()
	if err != nil {
		return nil, err
	}
	infoMap := respPairSliceToMap(rawInfo)
	if infoMap == nil {
		return nil, fmt.Errorf("unexpected FT.INFO response for %s", indexName)
	}

	structure := &driver.TableStructure{
		Schema:      database,
		Name:        indexName,
		Columns:     []driver.ColumnMeta{{Name: "_key", DataType: "string", RawType: "string", IsPrimaryKey: true}},
		PrimaryKeys: []string{"_key"},
		ForeignKeys: []driver.ForeignKeyMeta{},
		Indexes:     []driver.IndexMeta{},
		Comment:     fmt.Sprintf("RediSearch Index (%s)", indexName),
	}

	if attrsRaw, ok := infoMap["attributes"].([]any); ok {
		for _, attrItem := range attrsRaw {
			attrMap := respPairSliceToMap(attrItem)
			if attrMap == nil {
				continue
			}
			colName := fmt.Sprint(attrMap["attribute"])
			if colName == "" || colName == "<nil>" {
				colName = fmt.Sprint(attrMap["identifier"])
			}
			attrType := strings.ToUpper(fmt.Sprint(attrMap["type"]))
			dataType := strings.ToLower(attrType)
			rawType := "string"

			if attrType == "VECTOR" {
				rawType = "vector"
				algo := ""
				dims := ""
				if idxMap := respPairSliceToMap(attrMap["index"]); idxMap != nil {
					if d, ok := idxMap["dimensions"]; ok {
						dims = fmt.Sprint(d)
					}
					if a, ok := idxMap["algorithm"]; ok {
						algo = fmt.Sprint(a)
					}
				}
				if dims != "" && algo != "" {
					dataType = fmt.Sprintf("vector(%s, %s)", dims, algo)
				} else if dims != "" {
					dataType = fmt.Sprintf("vector(%s)", dims)
				} else {
					dataType = "vector"
				}
				structure.Indexes = append(structure.Indexes, driver.IndexMeta{
					Name:    "vec_" + colName,
					Columns: []string{colName},
					Type:    algo,
					Method:  algo,
				})
			} else if attrType == "NUMERIC" {
				rawType = "number"
			}

			structure.Columns = append(structure.Columns, driver.ColumnMeta{
				Name:       colName,
				DataType:   dataType,
				RawType:    rawType,
				IsNullable: true,
			})
		}
	}

	if b, merr := json.MarshalIndent(infoMap, "", "  "); merr == nil {
		structure.DDL = string(b)
	}
	return structure, nil
}

func (r *RedisDriver) countRediSearchIndex(ctx context.Context, conn *redis.Conn, indexName string) (int64, bool) {
	res, err := conn.Do(ctx, "FT.SEARCH", indexName, "*", "LIMIT", "0", "0").Result()
	if err != nil {
		return 0, false
	}
	if arr, ok := res.([]any); ok && len(arr) > 0 {
		if n, perr := strconv.ParseInt(fmt.Sprint(arr[0]), 10, 64); perr == nil {
			return n, true
		}
	}
	if m := respPairSliceToMap(res); m != nil {
		if tot, ok := m["total_results"]; ok {
			if n, perr := strconv.ParseInt(fmt.Sprint(tot), 10, 64); perr == nil {
				return n, true
			}
		}
	}
	return 0, false
}

func (r *RedisDriver) executeRediSearchBrowse(ctx context.Context, conn *redis.Conn, req driver.QueryRequest, indexName string, start time.Time) (*driver.QueryResult, error) {
	limit := req.Limit
	if limit <= 0 {
		limit = 100
	}
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}
	res, err := conn.Do(ctx, "FT.SEARCH", indexName, "*", "LIMIT", offset, limit).Result()
	if err != nil {
		return nil, err
	}
	return ftSearchResultToQueryResult(req.ExecutionID, req.Database, indexName, res, time.Since(start).Milliseconds()), nil
}

// encodeVectorParamsIfPresent converts JSON float arrays (e.g. "[0.1, 0.2, ...]") inside
// `FT.SEARCH ... PARAMS <count> <k1> <v1> ...` into little-endian float32 binary blobs.
func encodeVectorParamsIfPresent(args []string) []any {
	out := make([]any, len(args))
	for i, a := range args {
		out[i] = a
	}
	for i := 0; i < len(args); i++ {
		if strings.EqualFold(args[i], "PARAMS") && i+1 < len(args) {
			paramCount, err := strconv.Atoi(args[i+1])
			if err != nil || paramCount <= 0 {
				continue
			}
			end := i + 2 + paramCount
			if end > len(args) {
				end = len(args)
			}
			for j := i + 3; j < end; j += 2 {
				trimmed := strings.TrimSpace(args[j])
				if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
					var floats []float32
					if json.Unmarshal([]byte(trimmed), &floats) == nil && len(floats) > 0 {
						buf := make([]byte, len(floats)*4)
						for k, f := range floats {
							binary.LittleEndian.PutUint32(buf[k*4:], math.Float32bits(f))
						}
						out[j] = buf
					}
				}
			}
		}
	}
	return out
}

func decodePossibleFloat32Vector(raw any) any {
	s, ok := raw.(string)
	if !ok {
		return raw
	}
	// If it already looks like valid UTF-8 text or JSON, keep as-is unless it contains non-printable bytes
	if len(s) >= 16 && len(s)%4 == 0 {
		hasControl := false
		for i := 0; i < len(s); i++ {
			b := s[i]
			if b < 0x20 && b != '\t' && b != '\n' && b != '\r' {
				hasControl = true
				break
			}
		}
		if hasControl {
			n := len(s) / 4
			floats := make([]float32, n)
			for i := 0; i < n; i++ {
				bits := binary.LittleEndian.Uint32([]byte(s[i*4 : i*4+4]))
				floats[i] = math.Float32frombits(bits)
			}
			if b, err := json.Marshal(floats); err == nil {
				return string(b)
			}
		}
	}
	return s
}

func ftSearchResultToQueryResult(execID, database, indexName string, raw any, elapsedMs int64) *driver.QueryResult {
	type docEntry struct {
		key    string
		fields map[string]any
	}
	var docs []docEntry
	fieldSet := make(map[string]bool)

	if arr, ok := raw.([]any); ok && len(arr) >= 1 {
		for i := 1; i+1 < len(arr); i += 2 {
			key := fmt.Sprint(arr[i])
			fMap := respPairSliceToMap(arr[i+1])
			if fMap == nil {
				fMap = map[string]any{"value": arr[i+1]}
			}
			for k := range fMap {
				fieldSet[k] = true
			}
			docs = append(docs, docEntry{key: key, fields: fMap})
		}
	}

	fieldNames := make([]string, 0, len(fieldSet))
	for k := range fieldSet {
		fieldNames = append(fieldNames, k)
	}
	sort.Strings(fieldNames)

	columns := []driver.ColumnMeta{
		{Name: "_key", DataType: "string", RawType: "string", IsPrimaryKey: true},
	}
	for _, fn := range fieldNames {
		colType := "string"
		rawType := "string"
		if strings.HasSuffix(fn, "_score") || fn == "score" {
			colType = "float"
			rawType = "number"
		} else if len(docs) > 0 {
			if decoded, ok := decodePossibleFloat32Vector(docs[0].fields[fn]).(string); ok && strings.HasPrefix(decoded, "[") && len(decoded) > 20 {
				var testVec []float64
				if json.Unmarshal([]byte(decoded), &testVec) == nil && len(testVec) >= 4 {
					colType = fmt.Sprintf("vector(%d)", len(testVec))
					rawType = "vector"
				}
			}
		}
		columns = append(columns, driver.ColumnMeta{
			Name:       fn,
			DataType:   colType,
			RawType:    rawType,
			IsNullable: true,
		})
	}

	rows := make([][]any, len(docs))
	for rIdx, d := range docs {
		row := make([]any, 0, len(columns))
		row = append(row, d.key)
		for _, fn := range fieldNames {
			row = append(row, decodePossibleFloat32Vector(d.fields[fn]))
		}
		rows[rIdx] = row
	}

	return &driver.QueryResult{
		ExecutionID:  execID,
		Columns:      columns,
		Rows:         rows,
		RowsAffected: int64(len(rows)),
		ElapsedMs:    elapsedMs,
		IsEditable:   indexName != "",
		SourceSchema: database,
		SourceTable:  indexName,
		PrimaryKeys:  []string{"_key"},
	}
}

func encodeRediSearchFieldValue(raw any) any {
	s, ok := raw.(string)
	if !ok {
		return raw
	}
	trimmed := strings.TrimSpace(s)
	if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
		var floats []float32
		if json.Unmarshal([]byte(trimmed), &floats) == nil && len(floats) >= 4 {
			buf := make([]byte, len(floats)*4)
			for k, f := range floats {
				binary.LittleEndian.PutUint32(buf[k*4:], math.Float32bits(f))
			}
			return buf
		}
	}
	return s
}

func isRediSearchChanges(changes []driver.RowChange) bool {
	for _, c := range changes {
		if _, ok := c.PrimaryKey["_key"]; ok {
			return true
		}
		if _, ok := c.Changes["_key"]; ok {
			return true
		}
	}
	return false
}

func generateRediSearchDML(changes []driver.RowChange) []string {
	var statements []string
	for _, c := range changes {
		docKey := fmt.Sprintf("%v", c.PrimaryKey["_key"])
		if docKey == "" || docKey == "<nil>" {
			if k, ok := c.Changes["_key"]; ok {
				docKey = fmt.Sprintf("%v", k)
			}
		}
		if docKey == "" || docKey == "<nil>" {
			continue
		}
		switch c.Type {
		case "insert", "update":
			var pairs []string
			keys := make([]string, 0, len(c.Changes))
			for k := range c.Changes {
				if k != "_key" && k != "score" {
					keys = append(keys, k)
				}
			}
			sort.Strings(keys)
			for _, k := range keys {
				pairs = append(pairs, fmt.Sprintf("%s %q", k, fmt.Sprintf("%v", c.Changes[k])))
			}
			if len(pairs) > 0 {
				statements = append(statements, fmt.Sprintf("HSET %s %s", docKey, strings.Join(pairs, " ")))
			}
		case "delete":
			statements = append(statements, fmt.Sprintf("DEL %s", docKey))
		}
	}
	return statements
}

func applyRediSearchChanges(ctx context.Context, conn *redis.Conn, changes []driver.RowChange) (int64, error) {
	var affected int64
	for _, c := range changes {
		docKey := fmt.Sprintf("%v", c.PrimaryKey["_key"])
		if docKey == "" || docKey == "<nil>" {
			if k, ok := c.Changes["_key"]; ok {
				docKey = fmt.Sprintf("%v", k)
			}
		}
		if docKey == "" || docKey == "<nil>" {
			continue
		}
		switch c.Type {
		case "insert", "update":
			args := []any{"HSET", docKey}
			for k, v := range c.Changes {
				if k == "_key" || k == "score" {
					continue
				}
				args = append(args, k, encodeRediSearchFieldValue(v))
			}
			if len(args) > 2 {
				if err := conn.Do(ctx, args...).Err(); err != nil {
					return affected, err
				}
				affected++
			}
		case "delete":
			if err := conn.Del(ctx, docKey).Err(); err != nil {
				return affected, err
			}
			affected++
		}
	}
	return affected, nil
}
