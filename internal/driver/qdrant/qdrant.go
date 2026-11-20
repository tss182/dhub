package qdrant

import (
	"bytes"
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"dhub/internal/driver"
)

// QdrantDriver implements driver.DatabaseDriver over Qdrant's HTTP REST API.
type QdrantDriver struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

// NewQdrantDriver creates a Qdrant driver targeting baseURL (e.g. http://127.0.0.1:6333).
func NewQdrantDriver(baseURL, apiKey string, tlsCfg *tls.Config) (*QdrantDriver, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("qdrant base URL cannot be empty")
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	if tlsCfg != nil {
		transport.TLSClientConfig = tlsCfg
	}

	return &QdrantDriver{
		baseURL: baseURL,
		apiKey:  apiKey,
		client: &http.Client{
			Timeout:   30 * time.Second,
			Transport: transport,
		},
	}, nil
}

func (q *QdrantDriver) doRequest(ctx context.Context, method, path string, body any) ([]byte, int, error) {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	var bodyReader io.Reader
	if body != nil {
		switch b := body.(type) {
		case []byte:
			bodyReader = bytes.NewReader(b)
		case string:
			bodyReader = strings.NewReader(b)
		default:
			raw, err := json.Marshal(b)
			if err != nil {
				return nil, 0, fmt.Errorf("marshal request body: %w", err)
			}
			bodyReader = bytes.NewReader(raw)
		}
	}

	req, err := http.NewRequestWithContext(ctx, method, q.baseURL+path, bodyReader)
	if err != nil {
		return nil, 0, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if q.apiKey != "" {
		req.Header.Set("api-key", q.apiKey)
	}

	resp, err := q.client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}

	if resp.StatusCode >= 400 {
		var errEnv struct {
			Status any `json:"status"`
		}
		if json.Unmarshal(respBytes, &errEnv) == nil {
			if m, ok := errEnv.Status.(map[string]any); ok {
				if msg, ok := m["error"].(string); ok && msg != "" {
					return respBytes, resp.StatusCode, fmt.Errorf("qdrant error (%d): %s", resp.StatusCode, msg)
				}
			}
		}
		return respBytes, resp.StatusCode, fmt.Errorf("qdrant HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBytes)))
	}

	return respBytes, resp.StatusCode, nil
}

func (q *QdrantDriver) Ping(ctx context.Context) error {
	_, _, err := q.doRequest(ctx, http.MethodGet, "/collections", nil)
	return err
}

func (q *QdrantDriver) Close() error {
	if q.client != nil {
		q.client.CloseIdleConnections()
	}
	return nil
}

func (q *QdrantDriver) ListDatabases(ctx context.Context) ([]string, error) {
	return []string{"default"}, nil
}

func (q *QdrantDriver) ListSchemas(ctx context.Context, database string) ([]string, error) {
	return []string{"default"}, nil
}

type collectionListResp struct {
	Result struct {
		Collections []struct {
			Name string `json:"name"`
		} `json:"collections"`
	} `json:"result"`
}

type collectionInfoResp struct {
	Result struct {
		Status        string `json:"status"`
		PointsCount   *int64 `json:"points_count"`
		VectorsCount  *int64 `json:"vectors_count"`
		Config        struct {
			Params struct {
				Vectors json.RawMessage `json:"vectors"`
			} `json:"params"`
		} `json:"config"`
		PayloadSchema map[string]struct {
			DataType string `json:"data_type"`
		} `json:"payload_schema"`
	} `json:"result"`
}

func parseVectorConfigSummary(raw json.RawMessage) (map[string]string, string) {
	configs := make(map[string]string)
	if len(raw) == 0 || string(raw) == "null" {
		return configs, ""
	}

	// Single unnamed vector: {"size": 1536, "distance": "Cosine"}
	var single struct {
		Size     int    `json:"size"`
		Distance string `json:"distance"`
	}
	if err := json.Unmarshal(raw, &single); err == nil && single.Size > 0 {
		desc := fmt.Sprintf("vector(%d, %s)", single.Size, single.Distance)
		configs["vector"] = desc
		return configs, fmt.Sprintf("%dd %s", single.Size, single.Distance)
	}

	// Named vectors: {"text": {"size": 768, "distance": "Cosine"}, ...}
	var named map[string]struct {
		Size     int    `json:"size"`
		Distance string `json:"distance"`
	}
	if err := json.Unmarshal(raw, &named); err == nil && len(named) > 0 {
		var parts []string
		names := make([]string, 0, len(named))
		for k := range named {
			names = append(names, k)
		}
		sort.Strings(names)
		for _, k := range names {
			v := named[k]
			configs["vector."+k] = fmt.Sprintf("vector(%d, %s)", v.Size, v.Distance)
			parts = append(parts, fmt.Sprintf("%s:%dd %s", k, v.Size, v.Distance))
		}
		return configs, strings.Join(parts, ", ")
	}

	return configs, ""
}

func (q *QdrantDriver) ListObjects(ctx context.Context, database, schema string) ([]driver.ObjectSummary, error) {
	raw, _, err := q.doRequest(ctx, http.MethodGet, "/collections", nil)
	if err != nil {
		return nil, err
	}

	var listResp collectionListResp
	if err := json.Unmarshal(raw, &listResp); err != nil {
		return nil, fmt.Errorf("decode collections: %w", err)
	}

	sort.Slice(listResp.Result.Collections, func(i, j int) bool {
		return listResp.Result.Collections[i].Name < listResp.Result.Collections[j].Name
	})

	objects := make([]driver.ObjectSummary, 0, len(listResp.Result.Collections))
	for _, c := range listResp.Result.Collections {
		rowEst := int64(-1)
		comment := ""

		infoBytes, _, infoErr := q.doRequest(ctx, http.MethodGet, "/collections/"+url.PathEscape(c.Name), nil)
		if infoErr == nil {
			var info collectionInfoResp
			if json.Unmarshal(infoBytes, &info) == nil {
				if info.Result.PointsCount != nil {
					rowEst = *info.Result.PointsCount
				} else if info.Result.VectorsCount != nil {
					rowEst = *info.Result.VectorsCount
				}
				_, comment = parseVectorConfigSummary(info.Result.Config.Params.Vectors)
			}
		}

		objects = append(objects, driver.ObjectSummary{
			Schema:      "default",
			Name:        c.Name,
			Type:        "table",
			RowEstimate: rowEst,
			Comment:     comment,
		})
	}

	return objects, nil
}

type qdrantPoint struct {
	ID      any            `json:"id"`
	Score   *float64       `json:"score,omitempty"`
	Payload map[string]any `json:"payload,omitempty"`
	Vector  any            `json:"vector,omitempty"`
}

func (q *QdrantDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	infoBytes, _, err := q.doRequest(ctx, http.MethodGet, "/collections/"+url.PathEscape(table), nil)
	if err != nil {
		return nil, err
	}

	var info collectionInfoResp
	if err := json.Unmarshal(infoBytes, &info); err != nil {
		return nil, fmt.Errorf("decode collection info: %w", err)
	}

	structure := &driver.TableStructure{
		Schema:      "default",
		Name:        table,
		Columns:     []driver.ColumnMeta{{Name: "id", DataType: "point_id", RawType: "string", IsPrimaryKey: true, IsNullable: false}},
		PrimaryKeys: []string{"id"},
		ForeignKeys: []driver.ForeignKeyMeta{},
		Indexes:     []driver.IndexMeta{},
	}

	// Vector columns
	vecConfigs, _ := parseVectorConfigSummary(info.Result.Config.Params.Vectors)
	vecNames := make([]string, 0, len(vecConfigs))
	for k := range vecConfigs {
		vecNames = append(vecNames, k)
	}
	sort.Strings(vecNames)
	for _, vn := range vecNames {
		structure.Columns = append(structure.Columns, driver.ColumnMeta{
			Name:       vn,
			DataType:   vecConfigs[vn],
			RawType:    "vector",
			IsNullable: true,
		})
	}

	// Indexed payload schema
	payloadTypes := make(map[string]string)
	for fieldName, ps := range info.Result.PayloadSchema {
		payloadTypes[fieldName] = ps.DataType
		structure.Indexes = append(structure.Indexes, driver.IndexMeta{
			Name:    "payload_" + fieldName,
			Columns: []string{fieldName},
			Type:    ps.DataType,
			Method:  ps.DataType,
		})
	}
	sort.Slice(structure.Indexes, func(i, j int) bool {
		return structure.Indexes[i].Name < structure.Indexes[j].Name
	})

	// Sample 20 points to discover dynamic payload fields
	scrollBody := map[string]any{
		"limit":        20,
		"with_payload": true,
		"with_vector":  false,
	}
	if scrollBytes, _, sErr := q.doRequest(ctx, http.MethodPost, "/collections/"+url.PathEscape(table)+"/points/scroll", scrollBody); sErr == nil {
		var scrollResp struct {
			Result struct {
				Points []qdrantPoint `json:"points"`
			} `json:"result"`
		}
		if json.Unmarshal(scrollBytes, &scrollResp) == nil {
			for _, pt := range scrollResp.Result.Points {
				for k, v := range pt.Payload {
					if _, exists := payloadTypes[k]; !exists {
						payloadTypes[k] = inferJSONType(v)
					}
				}
			}
		}
	}

	payloadNames := make([]string, 0, len(payloadTypes))
	for k := range payloadTypes {
		payloadNames = append(payloadNames, k)
	}
	sort.Strings(payloadNames)
	for _, pn := range payloadNames {
		structure.Columns = append(structure.Columns, driver.ColumnMeta{
			Name:       pn,
			DataType:   payloadTypes[pn],
			RawType:    rawTypeFromJSONType(payloadTypes[pn]),
			IsNullable: true,
		})
	}

	var pretty any
	if json.Unmarshal(infoBytes, &pretty) == nil {
		if formatted, merr := json.MarshalIndent(pretty, "", "  "); merr == nil {
			structure.DDL = string(formatted)
		}
	}

	return structure, nil
}

func inferJSONType(v any) string {
	if v == nil {
		return "null"
	}
	switch val := v.(type) {
	case string:
		return "keyword/text"
	case float64:
		if val == float64(int64(val)) {
			return "integer"
		}
		return "float"
	case bool:
		return "bool"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	default:
		return fmt.Sprintf("%T", v)
	}
}

func rawTypeFromJSONType(t string) string {
	switch t {
	case "integer", "float":
		return "number"
	case "bool":
		return "boolean"
	case "array", "object":
		return "json"
	default:
		return "string"
	}
}

func formatCellValue(v any) any {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case []any, map[string]any:
		if b, err := json.Marshal(val); err == nil {
			return string(b)
		}
		return fmt.Sprintf("%v", val)
	case float64:
		if val == float64(int64(val)) {
			return int64(val)
		}
		return val
	default:
		return val
	}
}

func pointsToQueryResult(execID, collection string, points []qdrantPoint, elapsedMs int64, isEditable bool) *driver.QueryResult {
	hasScore := false
	hasSingleVec := false
	namedVecSet := make(map[string]bool)
	payloadSet := make(map[string]bool)

	for _, pt := range points {
		if pt.Score != nil {
			hasScore = true
		}
		if pt.Vector != nil {
			if m, ok := pt.Vector.(map[string]any); ok {
				for k := range m {
					namedVecSet[k] = true
				}
			} else {
				hasSingleVec = true
			}
		}
		for k := range pt.Payload {
			payloadSet[k] = true
		}
	}

	columns := []driver.ColumnMeta{
		{Name: "id", DataType: "point_id", RawType: "string", IsPrimaryKey: true, IsNullable: false},
	}
	if hasScore {
		columns = append(columns, driver.ColumnMeta{Name: "score", DataType: "float", RawType: "number", IsNullable: true})
	}

	payloadNames := make([]string, 0, len(payloadSet))
	for k := range payloadSet {
		payloadNames = append(payloadNames, k)
	}
	sort.Strings(payloadNames)
	for _, k := range payloadNames {
		columns = append(columns, driver.ColumnMeta{Name: k, DataType: "json", RawType: "string", IsNullable: true})
	}

	if hasSingleVec {
		columns = append(columns, driver.ColumnMeta{Name: "vector", DataType: "vector", RawType: "vector", IsNullable: true})
	}
	namedVecNames := make([]string, 0, len(namedVecSet))
	for k := range namedVecSet {
		namedVecNames = append(namedVecNames, k)
	}
	sort.Strings(namedVecNames)
	for _, k := range namedVecNames {
		columns = append(columns, driver.ColumnMeta{Name: "vector." + k, DataType: "vector", RawType: "vector", IsNullable: true})
	}

	rows := make([][]any, len(points))
	for rIdx, pt := range points {
		row := make([]any, 0, len(columns))
		row = append(row, formatCellValue(pt.ID))
		if hasScore {
			if pt.Score != nil {
				row = append(row, *pt.Score)
			} else {
				row = append(row, nil)
			}
		}
		for _, k := range payloadNames {
			if pt.Payload != nil {
				row = append(row, formatCellValue(pt.Payload[k]))
			} else {
				row = append(row, nil)
			}
		}
		if hasSingleVec {
			if _, isMap := pt.Vector.(map[string]any); !isMap {
				row = append(row, formatCellValue(pt.Vector))
			} else {
				row = append(row, nil)
			}
		}
		if len(namedVecNames) > 0 {
			m, _ := pt.Vector.(map[string]any)
			for _, k := range namedVecNames {
				if m != nil {
					row = append(row, formatCellValue(m[k]))
				} else {
					row = append(row, nil)
				}
			}
		}
		rows[rIdx] = row
	}

	return &driver.QueryResult{
		ExecutionID:  execID,
		Columns:      columns,
		Rows:         rows,
		RowsAffected: int64(len(rows)),
		ElapsedMs:    elapsedMs,
		IsEditable:   isEditable && collection != "",
		SourceSchema: "default",
		SourceTable:  collection,
		PrimaryKeys:  []string{"id"},
	}
}

var (
	sqlSelectCountRegex = regexp.MustCompile(`(?i)^\s*SELECT\s+COUNT\(\*\)\s+FROM\s+([^\s;]+)(?:\s+WHERE\s+(.+?))?\s*;?\s*$`)
	sqlSelectRegex      = regexp.MustCompile(`(?i)^\s*SELECT\s+(.+?)\s+FROM\s+([^\s;]+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?\s*;?\s*$`)
	httpCmdRegex        = regexp.MustCompile(`(?i)^(GET|POST|PUT|DELETE|PATCH)\s+(\S+)(?:\s+([\s\S]*))?$`)
)

func stripIdentQuotes(s string) string {
	s = strings.TrimSpace(s)
	if strings.Contains(s, ".") {
		parts := strings.SplitN(s, ".", 2)
		s = parts[1]
	}
	return strings.Trim(s, "\"`'[]")
}

func parseSimpleWhereToFilter(where string) map[string]any {
	where = strings.TrimSpace(where)
	if where == "" {
		return nil
	}
	// Strip outer parentheses if present
	if strings.HasPrefix(where, "(") && strings.HasSuffix(where, ")") {
		where = strings.TrimSpace(where[1 : len(where)-1])
	}
	parts := regexp.MustCompile(`(?i)\s+AND\s+`).Split(where, -1)
	var must []map[string]any
	eqRe := regexp.MustCompile(`^\s*([a-zA-Z0-9_."` + "`" + `]+)\s*=\s*(.+?)\s*$`)
	for _, p := range parts {
		m := eqRe.FindStringSubmatch(p)
		if len(m) != 3 {
			continue
		}
		key := strings.Trim(m[1], "\"`")
		rawVal := strings.TrimSpace(m[2])
		var val any = rawVal
		if (strings.HasPrefix(rawVal, "'") && strings.HasSuffix(rawVal, "'")) ||
			(strings.HasPrefix(rawVal, `"`) && strings.HasSuffix(rawVal, `"`)) {
			val = rawVal[1 : len(rawVal)-1]
		} else if strings.EqualFold(rawVal, "true") {
			val = true
		} else if strings.EqualFold(rawVal, "false") {
			val = false
		} else if iv, err := strconv.ParseInt(rawVal, 10, 64); err == nil {
			val = iv
		} else if fv, err := strconv.ParseFloat(rawVal, 64); err == nil {
			val = fv
		}
		must = append(must, map[string]any{
			"key":   key,
			"match": map[string]any{"value": val},
		})
	}
	if len(must) == 0 {
		return nil
	}
	return map[string]any{"must": must}
}

func (q *QdrantDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	start := time.Now()
	rawSQL := strings.TrimSpace(req.SQL)
	if rawSQL == "" {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []driver.ColumnMeta{},
			Rows:        [][]any{},
		}, nil
	}

	// 1. SHOW COLLECTIONS / SHOW TABLES / SHOW DATABASES
	if strings.EqualFold(rawSQL, "SHOW DATABASES") || strings.EqualFold(rawSQL, "SHOW DATABASES;") {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []driver.ColumnMeta{{Name: "database", DataType: "string", RawType: "string"}},
			Rows:        [][]any{{"default"}},
			ElapsedMs:   time.Since(start).Milliseconds(),
		}, nil
	}
	if strings.EqualFold(rawSQL, "SHOW COLLECTIONS") || strings.EqualFold(rawSQL, "SHOW TABLES") ||
		strings.EqualFold(rawSQL, "SHOW COLLECTIONS;") || strings.EqualFold(rawSQL, "SHOW TABLES;") {
		objs, err := q.ListObjects(ctx, "default", "default")
		if err != nil {
			return nil, err
		}
		rows := make([][]any, len(objs))
		for i, o := range objs {
			rows[i] = []any{o.Name, o.RowEstimate, o.Comment}
		}
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns: []driver.ColumnMeta{
				{Name: "collection", DataType: "string", RawType: "string"},
				{Name: "points_count", DataType: "int64", RawType: "number"},
				{Name: "vectors", DataType: "string", RawType: "string"},
			},
			Rows:      rows,
			ElapsedMs: time.Since(start).Milliseconds(),
		}, nil
	}

	// 2. Pseudo-SQL SELECT COUNT(*) FROM <collection>
	if match := sqlSelectCountRegex.FindStringSubmatch(rawSQL); len(match) > 1 {
		coll := stripIdentQuotes(match[1])
		body := map[string]any{"exact": true}
		if len(match) > 2 && strings.TrimSpace(match[2]) != "" {
			if f := parseSimpleWhereToFilter(match[2]); f != nil {
				body["filter"] = f
			}
		}
		respBytes, _, err := q.doRequest(ctx, http.MethodPost, "/collections/"+url.PathEscape(coll)+"/points/count", body)
		if err != nil {
			return nil, err
		}
		var countResp struct {
			Result struct {
				Count int64 `json:"count"`
			} `json:"result"`
		}
		if err := json.Unmarshal(respBytes, &countResp); err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      []driver.ColumnMeta{{Name: "count", DataType: "int64", RawType: "number"}},
			Rows:         [][]any{{countResp.Result.Count}},
			RowsAffected: 1,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: "default",
			SourceTable:  coll,
		}, nil
	}

	// 3. Pseudo-SQL SELECT ... FROM <collection>
	if match := sqlSelectRegex.FindStringSubmatch(rawSQL); len(match) > 2 {
		coll := stripIdentQuotes(match[2])
		limit := 100
		if match[5] != "" {
			if l, err := strconv.Atoi(match[5]); err == nil && l > 0 {
				limit = l
			}
		} else if req.Limit > 0 {
			limit = req.Limit
		}

		offset := 0
		if match[6] != "" {
			if o, err := strconv.Atoi(match[6]); err == nil && o >= 0 {
				offset = o
			}
		} else if req.Offset > 0 {
			offset = req.Offset
		}

		// Qdrant scroll uses cursor-based offset; for small offsets we request offset+limit and slice.
		fetchLimit := limit + offset
		body := map[string]any{
			"limit":        fetchLimit,
			"with_payload": true,
			"with_vector":  true,
		}
		if match[3] != "" {
			if f := parseSimpleWhereToFilter(match[3]); f != nil {
				body["filter"] = f
			}
		}

		respBytes, _, err := q.doRequest(ctx, http.MethodPost, "/collections/"+url.PathEscape(coll)+"/points/scroll", body)
		if err != nil {
			return nil, err
		}

		var scrollResp struct {
			Result struct {
				Points []qdrantPoint `json:"points"`
			} `json:"result"`
		}
		if err := json.Unmarshal(respBytes, &scrollResp); err != nil {
			return nil, err
		}

		pts := scrollResp.Result.Points
		if offset > 0 {
			if offset >= len(pts) {
				pts = []qdrantPoint{}
			} else {
				pts = pts[offset:]
			}
		}
		if len(pts) > limit {
			pts = pts[:limit]
		}

		return pointsToQueryResult(req.ExecutionID, coll, pts, time.Since(start).Milliseconds(), true), nil
	}

	// 4. REST-style command: GET/POST/PUT/DELETE /collections/... [\n {json}]
	if match := httpCmdRegex.FindStringSubmatch(rawSQL); len(match) >= 3 {
		method := strings.ToUpper(match[1])
		path := match[2]
		bodyStr := strings.TrimSpace(match[3])
		var bodyArg any
		if bodyStr != "" {
			bodyArg = bodyStr
		}
		respBytes, _, err := q.doRequest(ctx, method, path, bodyArg)
		if err != nil {
			return nil, err
		}

		// Try to extract collection name from path: /collections/{name}/...
		coll := ""
		trimmedPath := strings.TrimPrefix(path, "/")
		if strings.HasPrefix(trimmedPath, "collections/") {
			segs := strings.Split(strings.TrimPrefix(trimmedPath, "collections/"), "/")
			if len(segs) > 0 {
				coll = segs[0]
			}
		}

		// Check if response contains points array (search/query/scroll)
		var env struct {
			Result json.RawMessage `json:"result"`
		}
		if json.Unmarshal(respBytes, &env) == nil && len(env.Result) > 0 {
			var pts []qdrantPoint
			if json.Unmarshal(env.Result, &pts) == nil && pts != nil {
				return pointsToQueryResult(req.ExecutionID, coll, pts, time.Since(start).Milliseconds(), false), nil
			}
			var scrollObj struct {
				Points []qdrantPoint `json:"points"`
			}
			if json.Unmarshal(env.Result, &scrollObj) == nil && scrollObj.Points != nil {
				return pointsToQueryResult(req.ExecutionID, coll, scrollObj.Points, time.Since(start).Milliseconds(), coll != ""), nil
			}
		}

		var pretty any
		display := string(respBytes)
		if json.Unmarshal(respBytes, &pretty) == nil {
			if b, merr := json.MarshalIndent(pretty, "", "  "); merr == nil {
				display = string(b)
			}
		}
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      []driver.ColumnMeta{{Name: "response", DataType: "json", RawType: "json"}},
			Rows:         [][]any{{display}},
			RowsAffected: 1,
			ElapsedMs:    time.Since(start).Milliseconds(),
		}, nil
	}

	return nil, fmt.Errorf("unsupported Qdrant command (use SQL SELECT, SHOW COLLECTIONS, or HTTP syntax like 'POST /collections/<name>/points/search {...}')")
}

func (q *QdrantDriver) BeginTx(ctx context.Context, database string) (*sql.Tx, error) {
	return nil, fmt.Errorf("transactions are not supported in Qdrant")
}

func parsePointID(raw any) any {
	if s, ok := raw.(string); ok {
		if iv, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err == nil {
			return iv
		}
		return s
	}
	return raw
}

func parseVectorValue(raw any) any {
	if s, ok := raw.(string); ok {
		var parsed any
		if json.Unmarshal([]byte(s), &parsed) == nil {
			return parsed
		}
	}
	return raw
}

func (q *QdrantDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	for _, c := range changes {
		switch c.Type {
		case "insert":
			pt := map[string]any{"payload": map[string]any{}}
			payload := pt["payload"].(map[string]any)
			for k, v := range c.Changes {
				if k == "id" {
					pt["id"] = parsePointID(v)
				} else if k == "vector" {
					pt["vector"] = parseVectorValue(v)
				} else {
					payload[k] = v
				}
			}
			b, _ := json.Marshal(map[string]any{"points": []any{pt}})
			statements = append(statements, fmt.Sprintf("PUT /collections/%s/points?wait=true\n%s", table, string(b)))
		case "update":
			idVal := parsePointID(c.PrimaryKey["id"])
			payload := make(map[string]any)
			for k, v := range c.Changes {
				if k != "id" && k != "vector" && !strings.HasPrefix(k, "vector.") {
					payload[k] = v
				}
			}
			if len(payload) > 0 {
				b, _ := json.Marshal(map[string]any{"payload": payload, "points": []any{idVal}})
				statements = append(statements, fmt.Sprintf("POST /collections/%s/points/payload?wait=true\n%s", table, string(b)))
			}
		case "delete":
			idVal := parsePointID(c.PrimaryKey["id"])
			b, _ := json.Marshal(map[string]any{"points": []any{idVal}})
			statements = append(statements, fmt.Sprintf("POST /collections/%s/points/delete?wait=true\n%s", table, string(b)))
		}
	}
	return statements, nil
}

func (q *QdrantDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	var totalAffected int64
	for _, c := range changes {
		switch c.Type {
		case "insert":
			pt := map[string]any{"payload": map[string]any{}}
			payload := pt["payload"].(map[string]any)
			for k, v := range c.Changes {
				if k == "id" {
					pt["id"] = parsePointID(v)
				} else if k == "vector" {
					pt["vector"] = parseVectorValue(v)
				} else if strings.HasPrefix(k, "vector.") {
					vecMap, ok := pt["vector"].(map[string]any)
					if !ok {
						vecMap = make(map[string]any)
						pt["vector"] = vecMap
					}
					vecMap[strings.TrimPrefix(k, "vector.")] = parseVectorValue(v)
				} else {
					payload[k] = v
				}
			}
			if _, ok := pt["id"]; !ok {
				pt["id"] = time.Now().UnixNano()
			}
			body := map[string]any{"points": []any{pt}}
			if _, _, err := q.doRequest(ctx, http.MethodPut, "/collections/"+url.PathEscape(table)+"/points?wait=true", body); err != nil {
				return totalAffected, err
			}
			totalAffected++

		case "update":
			idVal := parsePointID(c.PrimaryKey["id"])
			payload := make(map[string]any)
			var singleVec any
			namedVecs := make(map[string]any)

			for k, v := range c.Changes {
				if k == "id" {
					continue
				} else if k == "vector" {
					singleVec = parseVectorValue(v)
				} else if strings.HasPrefix(k, "vector.") {
					namedVecs[strings.TrimPrefix(k, "vector.")] = parseVectorValue(v)
				} else {
					payload[k] = v
				}
			}

			if len(payload) > 0 {
				body := map[string]any{
					"payload": payload,
					"points":  []any{idVal},
				}
				if _, _, err := q.doRequest(ctx, http.MethodPost, "/collections/"+url.PathEscape(table)+"/points/payload?wait=true", body); err != nil {
					return totalAffected, err
				}
			}
			if singleVec != nil || len(namedVecs) > 0 {
				var vecPayload any = singleVec
				if len(namedVecs) > 0 {
					vecPayload = namedVecs
				}
				body := map[string]any{
					"points": []map[string]any{
						{"id": idVal, "vector": vecPayload},
					},
				}
				if _, _, err := q.doRequest(ctx, http.MethodPut, "/collections/"+url.PathEscape(table)+"/points/vectors?wait=true", body); err != nil {
					return totalAffected, err
				}
			}
			totalAffected++

		case "delete":
			idVal := parsePointID(c.PrimaryKey["id"])
			body := map[string]any{"points": []any{idVal}}
			if _, _, err := q.doRequest(ctx, http.MethodPost, "/collections/"+url.PathEscape(table)+"/points/delete?wait=true", body); err != nil {
				return totalAffected, err
			}
			totalAffected++
		}
	}
	return totalAffected, nil
}
