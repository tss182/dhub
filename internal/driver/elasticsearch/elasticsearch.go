package elasticsearch

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

// ElasticsearchDriver implements driver.DatabaseDriver over Elasticsearch's HTTP REST API.
type ElasticsearchDriver struct {
	baseURL  string
	username string
	password string
	client   *http.Client
}

// NewElasticsearchDriver creates an Elasticsearch driver targeting baseURL (e.g. http://127.0.0.1:9200).
func NewElasticsearchDriver(baseURL, username, password string, tlsCfg *tls.Config) (*ElasticsearchDriver, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("elasticsearch base URL cannot be empty")
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	if tlsCfg != nil {
		transport.TLSClientConfig = tlsCfg
	}

	return &ElasticsearchDriver{
		baseURL:  baseURL,
		username: username,
		password: password,
		client: &http.Client{
			Timeout:   30 * time.Second,
			Transport: transport,
		},
	}, nil
}

func (e *ElasticsearchDriver) doRequest(ctx context.Context, method, path string, body any) ([]byte, int, error) {
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

	req, err := http.NewRequestWithContext(ctx, method, e.baseURL+path, bodyReader)
	if err != nil {
		return nil, 0, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if e.username != "" {
		req.SetBasicAuth(e.username, e.password)
	} else if e.password != "" {
		if strings.HasPrefix(e.password, "ApiKey ") || strings.HasPrefix(e.password, "Bearer ") {
			req.Header.Set("Authorization", e.password)
		} else {
			req.Header.Set("Authorization", "ApiKey "+e.password)
		}
	}

	resp, err := e.client.Do(req)
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
			Error struct {
				Type   string `json:"type"`
				Reason string `json:"reason"`
			} `json:"error"`
		}
		if json.Unmarshal(respBytes, &errEnv) == nil && errEnv.Error.Reason != "" {
			return respBytes, resp.StatusCode, fmt.Errorf("elasticsearch error (%d %s): %s", resp.StatusCode, errEnv.Error.Type, errEnv.Error.Reason)
		}
		return respBytes, resp.StatusCode, fmt.Errorf("elasticsearch HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBytes)))
	}

	return respBytes, resp.StatusCode, nil
}

func (e *ElasticsearchDriver) Ping(ctx context.Context) error {
	_, _, err := e.doRequest(ctx, http.MethodGet, "/", nil)
	return err
}

func (e *ElasticsearchDriver) Close() error {
	if e.client != nil {
		e.client.CloseIdleConnections()
	}
	return nil
}

func (e *ElasticsearchDriver) ListDatabases(ctx context.Context) ([]string, error) {
	return []string{"default"}, nil
}

func (e *ElasticsearchDriver) ListSchemas(ctx context.Context, database string) ([]string, error) {
	return []string{"default"}, nil
}

type catIndexEntry struct {
	Index     string `json:"index"`
	DocsCount string `json:"docs.count"`
	StoreSize string `json:"store.size"`
	Health    string `json:"health"`
	Status    string `json:"status"`
}

func (e *ElasticsearchDriver) ListObjects(ctx context.Context, database, schema string) ([]driver.ObjectSummary, error) {
	raw, _, err := e.doRequest(ctx, http.MethodGet, "/_cat/indices?format=json&h=index,docs.count,store.size,health,status", nil)
	if err != nil {
		return nil, err
	}

	var entries []catIndexEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, fmt.Errorf("decode indices: %w", err)
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Index < entries[j].Index
	})

	objects := make([]driver.ObjectSummary, 0, len(entries))
	for _, entry := range entries {
		if strings.HasPrefix(entry.Index, ".") {
			continue
		}
		rowEst := int64(-1)
		if entry.DocsCount != "" {
			if n, perr := strconv.ParseInt(entry.DocsCount, 10, 64); perr == nil {
				rowEst = n
			}
		}
		comment := strings.TrimSpace(entry.Health)
		if entry.Status != "" {
			if comment != "" {
				comment += " (" + entry.Status + ")"
			} else {
				comment = entry.Status
			}
		}

		objects = append(objects, driver.ObjectSummary{
			Schema:      "default",
			Name:        entry.Index,
			Type:        "table",
			RowEstimate: rowEst,
			SizePretty:  entry.StoreSize,
			Comment:     comment,
		})
	}

	return objects, nil
}

type esMappingProp struct {
	Type       string                   `json:"type"`
	Dims       int                      `json:"dims"`
	Similarity string                   `json:"similarity"`
	Properties map[string]esMappingProp `json:"properties"`
}

func flattenMappingProps(prefix string, props map[string]esMappingProp, out *[]driver.ColumnMeta) {
	names := make([]string, 0, len(props))
	for k := range props {
		names = append(names, k)
	}
	sort.Strings(names)

	for _, name := range names {
		p := props[name]
		fullName := name
		if prefix != "" {
			fullName = prefix + "." + name
		}

		if len(p.Properties) > 0 && p.Type != "dense_vector" {
			flattenMappingProps(fullName, p.Properties, out)
			continue
		}

		dataType := p.Type
		rawType := rawTypeFromESType(p.Type)
		if p.Type == "dense_vector" {
			if p.Dims > 0 && p.Similarity != "" {
				dataType = fmt.Sprintf("dense_vector(%d, %s)", p.Dims, p.Similarity)
			} else if p.Dims > 0 {
				dataType = fmt.Sprintf("dense_vector(%d)", p.Dims)
			}
			rawType = "vector"
		}
		if dataType == "" {
			dataType = "object"
		}

		*out = append(*out, driver.ColumnMeta{
			Name:       fullName,
			DataType:   dataType,
			RawType:    rawType,
			IsNullable: true,
		})
	}
}

func rawTypeFromESType(t string) string {
	switch t {
	case "long", "integer", "short", "byte", "double", "float", "half_float", "scaled_float":
		return "number"
	case "boolean":
		return "boolean"
	case "date", "date_nanos":
		return "date"
	case "dense_vector":
		return "vector"
	case "object", "nested":
		return "json"
	default:
		return "string"
	}
}

func (e *ElasticsearchDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	raw, _, err := e.doRequest(ctx, http.MethodGet, "/"+url.PathEscape(table)+"/_mapping", nil)
	if err != nil {
		return nil, err
	}

	var mappingMap map[string]struct {
		Mappings struct {
			Properties map[string]esMappingProp `json:"properties"`
		} `json:"mappings"`
	}
	if err := json.Unmarshal(raw, &mappingMap); err != nil {
		return nil, fmt.Errorf("decode mapping: %w", err)
	}

	structure := &driver.TableStructure{
		Schema:      "default",
		Name:        table,
		Columns:     []driver.ColumnMeta{{Name: "_id", DataType: "keyword", RawType: "string", IsPrimaryKey: true, IsNullable: false}},
		PrimaryKeys: []string{"_id"},
		ForeignKeys: []driver.ForeignKeyMeta{},
		Indexes:     []driver.IndexMeta{},
	}

	if idxData, ok := mappingMap[table]; ok {
		flattenMappingProps("", idxData.Mappings.Properties, &structure.Columns)
	} else {
		for _, idxData := range mappingMap {
			flattenMappingProps("", idxData.Mappings.Properties, &structure.Columns)
			break
		}
	}

	var pretty any
	if json.Unmarshal(raw, &pretty) == nil {
		if formatted, merr := json.MarshalIndent(pretty, "", "  "); merr == nil {
			structure.DDL = string(formatted)
		}
	}

	return structure, nil
}

type esSearchResponse struct {
	Hits struct {
		Hits []struct {
			ID     string         `json:"_id"`
			Score  *float64       `json:"_score"`
			Source map[string]any `json:"_source"`
		} `json:"hits"`
	} `json:"hits"`
}

func formatESCellValue(v any) any {
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

func hitsToQueryResult(execID, indexName string, resp esSearchResponse, elapsedMs int64, isEditable bool) *driver.QueryResult {
	hasScore := false
	fieldSet := make(map[string]bool)

	for _, hit := range resp.Hits.Hits {
		if hit.Score != nil {
			hasScore = true
		}
		for k := range hit.Source {
			fieldSet[k] = true
		}
	}

	columns := []driver.ColumnMeta{
		{Name: "_id", DataType: "keyword", RawType: "string", IsPrimaryKey: true, IsNullable: false},
	}
	if hasScore {
		columns = append(columns, driver.ColumnMeta{Name: "_score", DataType: "float", RawType: "number", IsNullable: true})
	}

	fieldNames := make([]string, 0, len(fieldSet))
	for k := range fieldSet {
		fieldNames = append(fieldNames, k)
	}
	sort.Strings(fieldNames)
	for _, fn := range fieldNames {
		columns = append(columns, driver.ColumnMeta{Name: fn, DataType: "json", RawType: "string", IsNullable: true})
	}

	rows := make([][]any, len(resp.Hits.Hits))
	for rIdx, hit := range resp.Hits.Hits {
		row := make([]any, 0, len(columns))
		row = append(row, hit.ID)
		if hasScore {
			if hit.Score != nil {
				row = append(row, *hit.Score)
			} else {
				row = append(row, nil)
			}
		}
		for _, fn := range fieldNames {
			if hit.Source != nil {
				row = append(row, formatESCellValue(hit.Source[fn]))
			} else {
				row = append(row, nil)
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
		IsEditable:   isEditable && indexName != "",
		SourceSchema: "default",
		SourceTable:  indexName,
		PrimaryKeys:  []string{"_id"},
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

func parseSimpleWhereToESQuery(where string) map[string]any {
	where = strings.TrimSpace(where)
	if where == "" {
		return map[string]any{"match_all": map[string]any{}}
	}
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
			"match": map[string]any{key: val},
		})
	}
	if len(must) == 0 {
		return map[string]any{"query_string": map[string]any{"query": where}}
	}
	return map[string]any{"bool": map[string]any{"must": must}}
}

func (e *ElasticsearchDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	start := time.Now()
	rawSQL := strings.TrimSpace(req.SQL)
	if rawSQL == "" {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []driver.ColumnMeta{},
			Rows:        [][]any{},
		}, nil
	}

	// 1. SHOW INDICES / SHOW TABLES / SHOW DATABASES
	if strings.EqualFold(rawSQL, "SHOW DATABASES") || strings.EqualFold(rawSQL, "SHOW DATABASES;") {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []driver.ColumnMeta{{Name: "database", DataType: "string", RawType: "string"}},
			Rows:        [][]any{{"default"}},
			ElapsedMs:   time.Since(start).Milliseconds(),
		}, nil
	}
	if strings.EqualFold(rawSQL, "SHOW INDICES") || strings.EqualFold(rawSQL, "SHOW TABLES") ||
		strings.EqualFold(rawSQL, "SHOW INDICES;") || strings.EqualFold(rawSQL, "SHOW TABLES;") {
		objs, err := e.ListObjects(ctx, "default", "default")
		if err != nil {
			return nil, err
		}
		rows := make([][]any, len(objs))
		for i, o := range objs {
			rows[i] = []any{o.Name, o.RowEstimate, o.SizePretty, o.Comment}
		}
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns: []driver.ColumnMeta{
				{Name: "index", DataType: "string", RawType: "string"},
				{Name: "docs_count", DataType: "int64", RawType: "number"},
				{Name: "store_size", DataType: "string", RawType: "string"},
				{Name: "health", DataType: "string", RawType: "string"},
			},
			Rows:      rows,
			ElapsedMs: time.Since(start).Milliseconds(),
		}, nil
	}

	// 2. Pseudo-SQL SELECT COUNT(*) FROM <index>
	if match := sqlSelectCountRegex.FindStringSubmatch(rawSQL); len(match) > 1 {
		idxName := stripIdentQuotes(match[1])
		body := map[string]any{}
		if len(match) > 2 && strings.TrimSpace(match[2]) != "" {
			body["query"] = parseSimpleWhereToESQuery(match[2])
		}
		respBytes, _, err := e.doRequest(ctx, http.MethodPost, "/"+url.PathEscape(idxName)+"/_count", body)
		if err != nil {
			return nil, err
		}
		var countResp struct {
			Count int64 `json:"count"`
		}
		if err := json.Unmarshal(respBytes, &countResp); err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      []driver.ColumnMeta{{Name: "count", DataType: "int64", RawType: "number"}},
			Rows:         [][]any{{countResp.Count}},
			RowsAffected: 1,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: "default",
			SourceTable:  idxName,
		}, nil
	}

	// 3. Pseudo-SQL SELECT ... FROM <index>
	if match := sqlSelectRegex.FindStringSubmatch(rawSQL); len(match) > 2 && !strings.Contains(strings.ToUpper(rawSQL), " GROUP BY ") {
		idxName := stripIdentQuotes(match[2])
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

		body := map[string]any{
			"from":             offset,
			"size":             limit,
			"track_total_hits": true,
			"query":            parseSimpleWhereToESQuery(match[3]),
		}

		if strings.TrimSpace(match[4]) != "" {
			var sorts []map[string]any
			for _, part := range strings.Split(match[4], ",") {
				fields := strings.Fields(strings.TrimSpace(part))
				if len(fields) == 0 {
					continue
				}
				col := stripIdentQuotes(fields[0])
				dir := "asc"
				if len(fields) > 1 && strings.EqualFold(fields[1], "DESC") {
					dir = "desc"
				}
				sorts = append(sorts, map[string]any{col: map[string]any{"order": dir}})
			}
			if len(sorts) > 0 {
				body["sort"] = sorts
			}
		}

		respBytes, _, err := e.doRequest(ctx, http.MethodPost, "/"+url.PathEscape(idxName)+"/_search", body)
		if err != nil {
			return nil, err
		}
		var searchResp esSearchResponse
		if err := json.Unmarshal(respBytes, &searchResp); err != nil {
			return nil, err
		}
		return hitsToQueryResult(req.ExecutionID, idxName, searchResp, time.Since(start).Milliseconds(), true), nil
	}

	// 4. Complex SQL -> Elasticsearch /_sql?format=json
	if strings.HasPrefix(strings.ToUpper(rawSQL), "SELECT ") {
		respBytes, _, err := e.doRequest(ctx, http.MethodPost, "/_sql?format=json", map[string]any{
			"query": strings.TrimRight(rawSQL, ";"),
		})
		if err != nil {
			return nil, err
		}
		var sqlResp struct {
			Columns []struct {
				Name string `json:"name"`
				Type string `json:"type"`
			} `json:"columns"`
			Rows [][]any `json:"rows"`
		}
		if err := json.Unmarshal(respBytes, &sqlResp); err != nil {
			return nil, err
		}
		cols := make([]driver.ColumnMeta, len(sqlResp.Columns))
		for i, c := range sqlResp.Columns {
			cols[i] = driver.ColumnMeta{
				Name:     c.Name,
				DataType: c.Type,
				RawType:  rawTypeFromESType(c.Type),
			}
		}
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      cols,
			Rows:         sqlResp.Rows,
			RowsAffected: int64(len(sqlResp.Rows)),
			ElapsedMs:    time.Since(start).Milliseconds(),
		}, nil
	}

	// 5. Kibana DevTools HTTP syntax: GET/POST/PUT/DELETE /path [\n {json}]
	if match := httpCmdRegex.FindStringSubmatch(rawSQL); len(match) >= 3 {
		method := strings.ToUpper(match[1])
		path := match[2]
		bodyStr := strings.TrimSpace(match[3])
		var bodyArg any
		if bodyStr != "" {
			bodyArg = bodyStr
		}
		respBytes, _, err := e.doRequest(ctx, method, path, bodyArg)
		if err != nil {
			return nil, err
		}

		var searchResp esSearchResponse
		if json.Unmarshal(respBytes, &searchResp) == nil && searchResp.Hits.Hits != nil {
			idxName := ""
			segs := strings.Split(strings.TrimPrefix(path, "/"), "/")
			if len(segs) >= 2 && segs[1] == "_search" {
				idxName = segs[0]
			}
			return hitsToQueryResult(req.ExecutionID, idxName, searchResp, time.Since(start).Milliseconds(), false), nil
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

	return nil, fmt.Errorf("unsupported Elasticsearch command (use SQL SELECT, SHOW INDICES, or HTTP syntax like 'POST /<index>/_search {...}')")
}

func (e *ElasticsearchDriver) BeginTx(ctx context.Context, database string) (*sql.Tx, error) {
	return nil, fmt.Errorf("transactions are not supported in Elasticsearch")
}

func parseESFieldValue(v any) any {
	if s, ok := v.(string); ok {
		trimmed := strings.TrimSpace(s)
		if (strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]")) ||
			(strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}")) {
			var parsed any
			if json.Unmarshal([]byte(trimmed), &parsed) == nil {
				return parsed
			}
		}
	}
	return v
}

func (e *ElasticsearchDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	for _, c := range changes {
		switch c.Type {
		case "insert":
			doc := make(map[string]any)
			var docID string
			for k, v := range c.Changes {
				if k == "_id" {
					docID = fmt.Sprintf("%v", v)
				} else {
					doc[k] = parseESFieldValue(v)
				}
			}
			b, _ := json.Marshal(doc)
			if docID != "" {
				statements = append(statements, fmt.Sprintf("PUT /%s/_doc/%s?refresh=wait_for\n%s", table, docID, string(b)))
			} else {
				statements = append(statements, fmt.Sprintf("POST /%s/_doc?refresh=wait_for\n%s", table, string(b)))
			}
		case "update":
			docID := fmt.Sprintf("%v", c.PrimaryKey["_id"])
			doc := make(map[string]any)
			for k, v := range c.Changes {
				if k != "_id" {
					doc[k] = parseESFieldValue(v)
				}
			}
			b, _ := json.Marshal(map[string]any{"doc": doc})
			statements = append(statements, fmt.Sprintf("POST /%s/_update/%s?refresh=wait_for\n%s", table, docID, string(b)))
		case "delete":
			docID := fmt.Sprintf("%v", c.PrimaryKey["_id"])
			statements = append(statements, fmt.Sprintf("DELETE /%s/_doc/%s?refresh=wait_for", table, docID))
		}
	}
	return statements, nil
}

func (e *ElasticsearchDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	var totalAffected int64
	for _, c := range changes {
		switch c.Type {
		case "insert":
			doc := make(map[string]any)
			var docID string
			for k, v := range c.Changes {
				if k == "_id" && v != nil && fmt.Sprintf("%v", v) != "" {
					docID = fmt.Sprintf("%v", v)
				} else if k != "_id" {
					doc[k] = parseESFieldValue(v)
				}
			}
			if docID != "" {
				path := fmt.Sprintf("/%s/_doc/%s?refresh=wait_for", url.PathEscape(table), url.PathEscape(docID))
				if _, _, err := e.doRequest(ctx, http.MethodPut, path, doc); err != nil {
					return totalAffected, err
				}
			} else {
				path := fmt.Sprintf("/%s/_doc?refresh=wait_for", url.PathEscape(table))
				if _, _, err := e.doRequest(ctx, http.MethodPost, path, doc); err != nil {
					return totalAffected, err
				}
			}
			totalAffected++

		case "update":
			docID := fmt.Sprintf("%v", c.PrimaryKey["_id"])
			doc := make(map[string]any)
			for k, v := range c.Changes {
				if k != "_id" {
					doc[k] = parseESFieldValue(v)
				}
			}
			if len(doc) > 0 {
				path := fmt.Sprintf("/%s/_update/%s?refresh=wait_for", url.PathEscape(table), url.PathEscape(docID))
				if _, _, err := e.doRequest(ctx, http.MethodPost, path, map[string]any{"doc": doc}); err != nil {
					return totalAffected, err
				}
			}
			totalAffected++

		case "delete":
			docID := fmt.Sprintf("%v", c.PrimaryKey["_id"])
			path := fmt.Sprintf("/%s/_doc/%s?refresh=wait_for", url.PathEscape(table), url.PathEscape(docID))
			if _, _, err := e.doRequest(ctx, http.MethodDelete, path, nil); err != nil {
				return totalAffected, err
			}
			totalAffected++
		}
	}
	return totalAffected, nil
}
