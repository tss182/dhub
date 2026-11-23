package elasticsearch

import (
	"bytes"
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"dhub/internal/driver"
)

// ElasticsearchDriver implements driver.DatabaseDriver over Elasticsearch/OpenSearch's HTTP REST API.
type ElasticsearchDriver struct {
	baseURL  string
	username string
	password string
	client   *http.Client

	mu                 sync.Mutex
	distro             string // "elasticsearch" | "opensearch"
	version            string
	keywordSubfieldMap map[string]map[string]bool // index -> field -> has .keyword subfield
}

// NewElasticsearchDriver creates an Elasticsearch driver targeting baseURL (e.g. http://127.0.0.1:9200).
func NewElasticsearchDriver(baseURL, username, password string, tlsCfg *tls.Config) (*ElasticsearchDriver, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("elasticsearch base URL cannot be empty")
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{
		Timeout:   15 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext
	transport.TLSHandshakeTimeout = 15 * time.Second
	if tlsCfg != nil {
		transport.TLSClientConfig = tlsCfg
	}

	return &ElasticsearchDriver{
		baseURL:  baseURL,
		username: username,
		password: password,
		client: &http.Client{
			// Rely on request context deadlines instead of a hardcoded 30s timeout
			// so long exports, _reindex, _delete_by_query, and heavy aggregations can complete.
			Transport: transport,
		},
		keywordSubfieldMap: make(map[string]map[string]bool),
	}, nil
}

func isNDJSONPath(path string) bool {
	cleanPath := strings.SplitN(path, "?", 2)[0]
	cleanPath = strings.TrimRight(strings.ToLower(cleanPath), "/")
	return cleanPath == "/_bulk" ||
		cleanPath == "/_msearch" ||
		strings.HasSuffix(cleanPath, "/_bulk") ||
		strings.HasSuffix(cleanPath, "/_msearch")
}

func decodeJSONUseNumber(data []byte, target any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	return dec.Decode(target)
}

func (e *ElasticsearchDriver) doRequest(ctx context.Context, method, path string, body any) ([]byte, int, error) {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	ndjson := isNDJSONPath(path)

	var bodyReader io.Reader
	if body != nil {
		switch b := body.(type) {
		case []byte:
			if ndjson && len(b) > 0 && b[len(b)-1] != '\n' {
				b = append(append([]byte(nil), b...), '\n')
			}
			bodyReader = bytes.NewReader(b)
		case string:
			if ndjson && b != "" && !strings.HasSuffix(b, "\n") {
				b += "\n"
			}
			bodyReader = strings.NewReader(b)
		default:
			raw, err := json.Marshal(b)
			if err != nil {
				return nil, 0, fmt.Errorf("marshal request body: %w", err)
			}
			if ndjson && len(raw) > 0 && raw[len(raw)-1] != '\n' {
				raw = append(raw, '\n')
			}
			bodyReader = bytes.NewReader(raw)
		}
	}

	req, err := http.NewRequestWithContext(ctx, method, e.baseURL+path, bodyReader)
	if err != nil {
		return nil, 0, err
	}
	if body != nil {
		if ndjson {
			req.Header.Set("Content-Type", "application/x-ndjson")
		} else {
			req.Header.Set("Content-Type", "application/json")
		}
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
				Type      string `json:"type"`
				Reason    string `json:"reason"`
				RootCause []struct {
					Type   string `json:"type"`
					Reason string `json:"reason"`
				} `json:"root_cause"`
				CausedBy *struct {
					Type   string `json:"type"`
					Reason string `json:"reason"`
				} `json:"caused_by"`
			} `json:"error"`
		}
		if json.Unmarshal(respBytes, &errEnv) == nil && (errEnv.Error.Reason != "" || len(errEnv.Error.RootCause) > 0) {
			errType := errEnv.Error.Type
			reason := errEnv.Error.Reason
			if len(errEnv.Error.RootCause) > 0 && errEnv.Error.RootCause[0].Reason != "" {
				rc := errEnv.Error.RootCause[0]
				if reason == "" || strings.EqualFold(reason, "all shards failed") {
					reason = rc.Reason
					if rc.Type != "" {
						errType = rc.Type
					}
				} else if rc.Reason != reason && !strings.Contains(reason, rc.Reason) {
					reason = fmt.Sprintf("%s (root cause: %s)", reason, rc.Reason)
				}
			}
			if errEnv.Error.CausedBy != nil && errEnv.Error.CausedBy.Reason != "" && !strings.Contains(reason, errEnv.Error.CausedBy.Reason) {
				reason = fmt.Sprintf("%s (caused by: %s)", reason, errEnv.Error.CausedBy.Reason)
			}
			return respBytes, resp.StatusCode, fmt.Errorf("elasticsearch error (%d %s): %s", resp.StatusCode, errType, reason)
		}
		var strErrEnv struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(respBytes, &strErrEnv) == nil && strErrEnv.Error != "" {
			return respBytes, resp.StatusCode, fmt.Errorf("elasticsearch error (%d): %s", resp.StatusCode, strErrEnv.Error)
		}
		return respBytes, resp.StatusCode, fmt.Errorf("elasticsearch HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBytes)))
	}

	return respBytes, resp.StatusCode, nil
}

func (e *ElasticsearchDriver) Ping(ctx context.Context) error {
	_, err := e.ServerVersion(ctx)
	return err
}

// ServerVersion fetches the Elasticsearch or OpenSearch server version via GET /.
func (e *ElasticsearchDriver) ServerVersion(ctx context.Context) (string, error) {
	raw, _, err := e.doRequest(ctx, http.MethodGet, "/", nil)
	if err != nil {
		return "", err
	}
	var root struct {
		Version struct {
			Number       string `json:"number"`
			Distribution string `json:"distribution"`
		} `json:"version"`
	}
	if err := json.Unmarshal(raw, &root); err != nil {
		return "", nil
	}
	e.mu.Lock()
	if strings.EqualFold(root.Version.Distribution, "opensearch") {
		e.distro = "opensearch"
	} else {
		e.distro = "elasticsearch"
	}
	e.version = root.Version.Number
	e.mu.Unlock()

	if strings.EqualFold(root.Version.Distribution, "opensearch") && root.Version.Number != "" {
		return "OpenSearch " + root.Version.Number, nil
	}
	return root.Version.Number, nil
}

func (e *ElasticsearchDriver) isOpenSearch() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.distro == "opensearch"
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
	Dimension  int                      `json:"dimension"` // OpenSearch knn_vector
	Method     *struct {
		Name      string `json:"name"`
		SpaceType string `json:"space_type"`
	} `json:"method"`
	Properties map[string]esMappingProp `json:"properties"`
	Fields     map[string]esMappingProp `json:"fields"`
}

func flattenMappingProps(prefix string, props map[string]esMappingProp, out *[]driver.ColumnMeta, keywordSubfields map[string]bool) {
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

		if len(p.Properties) > 0 && p.Type != "dense_vector" && p.Type != "knn_vector" {
			flattenMappingProps(fullName, p.Properties, out, keywordSubfields)
			continue
		}

		dataType := p.Type
		rawType := rawTypeFromESType(p.Type)
		switch p.Type {
		case "dense_vector":
			if p.Dims > 0 && p.Similarity != "" {
				dataType = fmt.Sprintf("dense_vector(%d, %s)", p.Dims, p.Similarity)
			} else if p.Dims > 0 {
				dataType = fmt.Sprintf("dense_vector(%d)", p.Dims)
			}
			rawType = "vector"
		case "knn_vector":
			dims := p.Dimension
			if dims <= 0 {
				dims = p.Dims
			}
			space := ""
			if p.Method != nil && p.Method.SpaceType != "" {
				space = p.Method.SpaceType
			}
			if dims > 0 && space != "" {
				dataType = fmt.Sprintf("dense_vector(%d, %s)", dims, space)
			} else if dims > 0 {
				dataType = fmt.Sprintf("dense_vector(%d)", dims)
			} else {
				dataType = "dense_vector"
			}
			rawType = "vector"
		}
		if dataType == "" {
			dataType = "object"
		}

		comment := ""
		if kwField, hasKw := p.Fields["keyword"]; hasKw && (kwField.Type == "keyword" || kwField.Type == "") {
			if keywordSubfields != nil {
				keywordSubfields[fullName] = true
			}
			comment = "multi-field: .keyword"
		}

		*out = append(*out, driver.ColumnMeta{
			Name:       fullName,
			DataType:   dataType,
			RawType:    rawType,
			IsNullable: true,
			Comment:    comment,
		})
	}
}

func rawTypeFromESType(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	switch {
	case t == "long" || t == "integer" || t == "short" || t == "byte" || t == "unsigned_long" ||
		t == "double" || t == "float" || t == "half_float" || t == "scaled_float" || t == "number":
		return "number"
	case t == "boolean" || t == "bool":
		return "boolean"
	case t == "date" || t == "date_nanos" || t == "datetime":
		return "date"
	case strings.HasPrefix(t, "dense_vector") || strings.HasPrefix(t, "knn_vector") || t == "vector":
		return "vector"
	case t == "object" || t == "nested" || t == "flattened" || t == "json" || t == "array":
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

	kwSubfields := make(map[string]bool)
	if idxData, ok := mappingMap[table]; ok {
		flattenMappingProps("", idxData.Mappings.Properties, &structure.Columns, kwSubfields)
	} else {
		for _, idxData := range mappingMap {
			flattenMappingProps("", idxData.Mappings.Properties, &structure.Columns, kwSubfields)
			break
		}
	}

	e.mu.Lock()
	e.keywordSubfieldMap[table] = kwSubfields
	e.mu.Unlock()

	var pretty any
	if json.Unmarshal(raw, &pretty) == nil {
		if formatted, merr := json.MarshalIndent(pretty, "", "  "); merr == nil {
			structure.DDL = string(formatted)
		}
	}

	return structure, nil
}

func (e *ElasticsearchDriver) resolveSortField(ctx context.Context, indexName, col string) string {
	if col == "_id" || col == "_score" || col == "_doc" || strings.HasSuffix(col, ".keyword") {
		return col
	}
	e.mu.Lock()
	kwMap, ok := e.keywordSubfieldMap[indexName]
	e.mu.Unlock()
	if !ok && indexName != "" {
		_, _ = e.GetTableStructure(ctx, "default", "default", indexName)
		e.mu.Lock()
		kwMap = e.keywordSubfieldMap[indexName]
		e.mu.Unlock()
	}
	if kwMap != nil && kwMap[col] {
		return col + ".keyword"
	}
	return col
}

type esSearchResponse struct {
	Hits struct {
		Total json.RawMessage `json:"total"`
		Hits  []struct {
			ID     string         `json:"_id"`
			Score  *float64       `json:"_score"`
			Source map[string]any `json:"_source"`
		} `json:"hits"`
	} `json:"hits"`
	Aggregations map[string]any `json:"aggregations,omitempty"`
}

func parseESTotalHits(raw json.RawMessage) int64 {
	if len(raw) == 0 {
		return -1
	}
	var obj struct {
		Value *int64 `json:"value"`
	}
	if json.Unmarshal(raw, &obj) == nil && obj.Value != nil {
		return *obj.Value
	}
	var n int64
	if json.Unmarshal(raw, &n) == nil {
		return n
	}
	return -1
}

func inferESValueType(v any) (dataType string, rawType string) {
	if v == nil {
		return "keyword", "string"
	}
	switch val := v.(type) {
	case bool:
		return "boolean", "boolean"
	case json.Number:
		if _, err := val.Int64(); err == nil {
			return "long", "number"
		}
		return "double", "number"
	case float64:
		if val == float64(int64(val)) {
			return "long", "number"
		}
		return "double", "number"
	case int, int64:
		return "long", "number"
	case []any:
		if len(val) > 0 {
			allNum := true
			for _, elem := range val {
				switch elem.(type) {
				case float64, int, int64, json.Number:
				default:
					allNum = false
				}
				if !allNum {
					break
				}
			}
			if allNum && len(val) >= 2 {
				return fmt.Sprintf("dense_vector(%d)", len(val)), "vector"
			}
		}
		return "array", "json"
	case map[string]any:
		return "object", "json"
	default:
		return "text", "string"
	}
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
	case json.Number:
		if iv, err := val.Int64(); err == nil {
			if iv > 9007199254740991 || iv < -9007199254740991 {
				return val.String()
			}
			return iv
		}
		if uv, err := strconv.ParseUint(val.String(), 10, 64); err == nil {
			if uv > 9007199254740991 {
				return val.String()
			}
			return int64(uv)
		}
		if fv, err := val.Float64(); err == nil {
			return fv
		}
		return val.String()
	case float64:
		if val == float64(int64(val)) {
			return int64(val)
		}
		return val
	default:
		return val
	}
}

func (e *ElasticsearchDriver) buildEmptyIndexColumns(ctx context.Context, indexName string, selectedCols []string) []driver.ColumnMeta {
	if len(selectedCols) > 0 {
		cols := make([]driver.ColumnMeta, 0, len(selectedCols))
		for _, c := range selectedCols {
			if c == "_id" {
				cols = append(cols, driver.ColumnMeta{Name: "_id", DataType: "keyword", RawType: "string", IsPrimaryKey: true, IsNullable: false})
			} else {
				cols = append(cols, driver.ColumnMeta{Name: c, DataType: "text", RawType: "string", IsNullable: true})
			}
		}
		return cols
	}
	if indexName != "" {
		if st, err := e.GetTableStructure(ctx, "default", "default", indexName); err == nil && st != nil && len(st.Columns) > 0 {
			return st.Columns
		}
	}
	return []driver.ColumnMeta{
		{Name: "_id", DataType: "keyword", RawType: "string", IsPrimaryKey: true, IsNullable: false},
	}
}

func (e *ElasticsearchDriver) hitsToQueryResult(ctx context.Context, execID, indexName string, resp esSearchResponse, offset, limit int, elapsedMs int64, isEditable bool, selectedCols []string) *driver.QueryResult {
	totalHits := parseESTotalHits(resp.Hits.Total)
	hitCount := len(resp.Hits.Hits)
	hasMore := false
	if totalHits >= 0 {
		hasMore = int64(offset+hitCount) < totalHits
	} else if limit > 0 {
		hasMore = hitCount >= limit
	}

	if hitCount == 0 {
		return &driver.QueryResult{
			ExecutionID:  execID,
			Columns:      e.buildEmptyIndexColumns(ctx, indexName, selectedCols),
			Rows:         [][]any{},
			RowsAffected: 0,
			ElapsedMs:    elapsedMs,
			HasMore:      false,
			IsEditable:   isEditable && indexName != "",
			SourceSchema: "default",
			SourceTable:  indexName,
			PrimaryKeys:  []string{"_id"},
		}
	}

	hasScore := false
	fieldSet := make(map[string]bool)
	inferredDT := make(map[string]string)
	inferredRT := make(map[string]string)

	for _, hit := range resp.Hits.Hits {
		if hit.Score != nil {
			hasScore = true
		}
		for k, v := range hit.Source {
			fieldSet[k] = true
			if v != nil {
				if _, exists := inferredDT[k]; !exists {
					dt, rt := inferESValueType(v)
					inferredDT[k] = dt
					inferredRT[k] = rt
				}
			}
		}
	}

	var columns []driver.ColumnMeta
	var fieldNames []string

	if len(selectedCols) > 0 {
		seen := make(map[string]bool)
		for _, sc := range selectedCols {
			if sc == "" || seen[sc] {
				continue
			}
			seen[sc] = true
			switch sc {
			case "_id":
				columns = append(columns, driver.ColumnMeta{Name: "_id", DataType: "keyword", RawType: "string", IsPrimaryKey: true, IsNullable: false})
			case "_score":
				hasScore = true
				columns = append(columns, driver.ColumnMeta{Name: "_score", DataType: "float", RawType: "number", IsNullable: true})
			default:
				dt := inferredDT[sc]
				rt := inferredRT[sc]
				if dt == "" {
					dt, rt = "text", "string"
				}
				columns = append(columns, driver.ColumnMeta{Name: sc, DataType: dt, RawType: rt, IsNullable: true})
				fieldNames = append(fieldNames, sc)
			}
		}
	} else {
		columns = []driver.ColumnMeta{
			{Name: "_id", DataType: "keyword", RawType: "string", IsPrimaryKey: true, IsNullable: false},
		}
		if hasScore {
			columns = append(columns, driver.ColumnMeta{Name: "_score", DataType: "float", RawType: "number", IsNullable: true})
		}

		fieldNames = make([]string, 0, len(fieldSet))
		for k := range fieldSet {
			fieldNames = append(fieldNames, k)
		}
		sort.Strings(fieldNames)
		for _, fn := range fieldNames {
			dt := inferredDT[fn]
			rt := inferredRT[fn]
			if dt == "" {
				dt, rt = "text", "string"
			}
			columns = append(columns, driver.ColumnMeta{Name: fn, DataType: dt, RawType: rt, IsNullable: true})
		}
	}

	rows := make([][]any, hitCount)
	for rIdx, hit := range resp.Hits.Hits {
		row := make([]any, 0, len(columns))
		for _, col := range columns {
			switch col.Name {
			case "_id":
				row = append(row, hit.ID)
			case "_score":
				if hit.Score != nil {
					row = append(row, *hit.Score)
				} else {
					row = append(row, nil)
				}
			default:
				if hit.Source != nil {
					row = append(row, formatESCellValue(hit.Source[col.Name]))
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
		HasMore:      hasMore,
		IsEditable:   isEditable && indexName != "",
		SourceSchema: "default",
		SourceTable:  indexName,
		PrimaryKeys:  []string{"_id"},
	}
}

var (
	sqlSelectCountRegex = regexp.MustCompile(`(?i)^\s*SELECT\s+COUNT\(\*\)\s+FROM\s+([^\s;]+)(?:\s+WHERE\s+(.+?))?\s*;?\s*$`)
	sqlSelectRegex      = regexp.MustCompile(`(?i)^\s*SELECT\s+(.+?)\s+FROM\s+([^\s;]+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?\s*;?\s*$`)
	sqlTruncateRegex    = regexp.MustCompile(`(?i)^\s*TRUNCATE\s+(?:TABLE\s+)?([^\s;]+)\s*;?\s*$`)
	sqlDeleteRegex      = regexp.MustCompile(`(?i)^\s*DELETE\s+FROM\s+([^\s;]+)(?:\s+WHERE\s+(.+?))?\s*;?\s*$`)
	httpCmdRegex        = regexp.MustCompile(`(?i)^(GET|POST|PUT|DELETE|PATCH|HEAD)\s+(\S+)(?:\s+([\s\S]*))?$`)
)

func stripIdentQuotes(s string) string {
	s = strings.TrimSpace(s)
	lower := strings.ToLower(s)
	for _, prefix := range []string{"default.", `"default".`, "`default`.", "[default]."} {
		if strings.HasPrefix(lower, prefix) {
			s = s[len(prefix):]
			break
		}
	}
	return strings.Trim(s, "\"`'[]")
}

func parseScalarLiteral(rawVal string) any {
	rawVal = strings.TrimSpace(rawVal)
	if (strings.HasPrefix(rawVal, "'") && strings.HasSuffix(rawVal, "'") && len(rawVal) >= 2) ||
		(strings.HasPrefix(rawVal, `"`) && strings.HasSuffix(rawVal, `"`) && len(rawVal) >= 2) {
		return rawVal[1 : len(rawVal)-1]
	}
	if strings.EqualFold(rawVal, "true") {
		return true
	}
	if strings.EqualFold(rawVal, "false") {
		return false
	}
	if iv, err := strconv.ParseInt(rawVal, 10, 64); err == nil {
		return iv
	}
	if fv, err := strconv.ParseFloat(rawVal, 64); err == nil {
		return fv
	}
	return rawVal
}

func splitKeywordTopLevel(s, kw string) []string {
	var parts []string
	var buf strings.Builder
	inSingle := false
	inDouble := false
	parenDepth := 0
	kwUpper := strings.ToUpper(kw)
	kwLen := len(kwUpper)

	i := 0
	for i < len(s) {
		ch := s[i]
		if ch == '\'' && !inDouble {
			inSingle = !inSingle
			buf.WriteByte(ch)
			i++
			continue
		}
		if ch == '"' && !inSingle {
			inDouble = !inDouble
			buf.WriteByte(ch)
			i++
			continue
		}
		if !inSingle && !inDouble {
			if ch == '(' {
				parenDepth++
			} else if ch == ')' && parenDepth > 0 {
				parenDepth--
			} else if parenDepth == 0 && i+kwLen <= len(s) {
				prevSpace := i > 0 && (s[i-1] == ' ' || s[i-1] == '\t' || s[i-1] == '\n' || s[i-1] == ')')
				nextIdx := i + kwLen
				nextSpace := nextIdx < len(s) && (s[nextIdx] == ' ' || s[nextIdx] == '\t' || s[nextIdx] == '\n' || s[nextIdx] == '(')
				if prevSpace && nextSpace && strings.EqualFold(s[i:nextIdx], kwUpper) {
					parts = append(parts, strings.TrimSpace(buf.String()))
					buf.Reset()
					i = nextIdx
					continue
				}
			}
		}
		buf.WriteByte(ch)
		i++
	}
	if last := strings.TrimSpace(buf.String()); last != "" {
		parts = append(parts, last)
	}
	return parts
}

func parseSimpleWhereToESQuery(where string) map[string]any {
	where = strings.TrimSpace(where)
	if where == "" {
		return map[string]any{"match_all": map[string]any{}}
	}
	if strings.HasPrefix(where, "(") && strings.HasSuffix(where, ")") {
		inner := strings.TrimSpace(where[1 : len(where)-1])
		if inner != "" {
			where = inner
		}
	}

	// Allow raw Elasticsearch Query DSL JSON directly in WHERE (e.g. {"term":{"status":"active"}} or {"query":{...}})
	if strings.HasPrefix(where, "{") && strings.HasSuffix(where, "}") {
		var rawQuery map[string]any
		if json.Unmarshal([]byte(where), &rawQuery) == nil && len(rawQuery) > 0 {
			if innerQ, ok := rawQuery["query"].(map[string]any); ok && len(rawQuery) == 1 {
				return innerQ
			}
			return rawQuery
		}
	}

	orBranches := splitKeywordTopLevel(where, "OR")
	if len(orBranches) > 1 {
		should := make([]map[string]any, 0, len(orBranches))
		for _, br := range orBranches {
			should = append(should, parseSimpleWhereToESQuery(br))
		}
		return map[string]any{
			"bool": map[string]any{
				"should":               should,
				"minimum_should_match": 1,
			},
		}
	}

	betweenProtectRe := regexp.MustCompile(`(?i)(\b(?:NOT\s+)?BETWEEN\s+(?:'[^']*'|"[^"]*"|\S+))\s+AND\s+('[^']*'|"[^"]*"|\S+)`)
	protectedWhere := betweenProtectRe.ReplaceAllString(where, "$1 \x00 $2")

	parts := splitKeywordTopLevel(protectedWhere, "AND")
	var must []map[string]any
	var mustNot []map[string]any

	isNullRe := regexp.MustCompile(`(?i)^\s*([a-zA-Z0-9_."` + "`" + `-]+)\s+IS\s+(NOT\s+)?NULL\s*$`)
	inRe := regexp.MustCompile(`(?i)^\s*([a-zA-Z0-9_."` + "`" + `-]+)\s+(NOT\s+)?IN\s*\((.+)\)\s*$`)
	betweenRe := regexp.MustCompile(`(?i)^\s*([a-zA-Z0-9_."` + "`" + `-]+)\s+(NOT\s+)?BETWEEN\s+(.+?)\s*\x00\s*(.+?)\s*$`)
	likeRe := regexp.MustCompile(`(?i)^\s*([a-zA-Z0-9_."` + "`" + `-]+)\s+(NOT\s+)?(I?LIKE|CONTAINS)\s+(.+?)\s*$`)
	cmpRe := regexp.MustCompile(`^\s*([a-zA-Z0-9_."` + "`" + `-]+)\s*(!=|<>|>=|<=|=|>|<)\s*(.+?)\s*$`)

	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if strings.HasPrefix(p, "(") && strings.HasSuffix(p, ")") {
			inner := strings.TrimSpace(p[1 : len(p)-1])
			if inner != "" {
				if len(splitKeywordTopLevel(inner, "OR")) > 1 || len(splitKeywordTopLevel(inner, "AND")) > 1 {
					must = append(must, parseSimpleWhereToESQuery(strings.ReplaceAll(inner, "\x00", "AND")))
					continue
				}
				p = inner
			}
		}

		if m := isNullRe.FindStringSubmatch(p); len(m) == 3 {
			key := strings.Trim(m[1], "\"`")
			existsQ := map[string]any{"exists": map[string]any{"field": key}}
			if strings.TrimSpace(m[2]) != "" {
				must = append(must, existsQ)
			} else {
				mustNot = append(mustNot, existsQ)
			}
			continue
		}

		if m := betweenRe.FindStringSubmatch(p); len(m) == 5 {
			key := strings.Trim(m[1], "\"`")
			v1 := parseScalarLiteral(m[3])
			v2 := parseScalarLiteral(m[4])
			rangeQ := map[string]any{
				"range": map[string]any{
					key: map[string]any{"gte": v1, "lte": v2},
				},
			}
			if strings.TrimSpace(m[2]) != "" {
				mustNot = append(mustNot, rangeQ)
			} else {
				must = append(must, rangeQ)
			}
			continue
		}

		if m := likeRe.FindStringSubmatch(p); len(m) == 5 {
			key := strings.Trim(m[1], "\"`")
			rawLit := fmt.Sprintf("%v", parseScalarLiteral(m[4]))
			pattern := strings.ReplaceAll(rawLit, "%", "*")
			pattern = strings.ReplaceAll(pattern, "_", "?")
			var q map[string]any
			if strings.ContainsAny(pattern, "*?") {
				q = map[string]any{
					"wildcard": map[string]any{
						key: map[string]any{"value": pattern, "case_insensitive": true},
					},
				}
			} else {
				q = map[string]any{
					"match": map[string]any{key: rawLit},
				}
			}
			if strings.TrimSpace(m[2]) != "" {
				mustNot = append(mustNot, q)
			} else {
				must = append(must, q)
			}
			continue
		}

		if m := inRe.FindStringSubmatch(p); len(m) == 4 {
			key := strings.Trim(m[1], "\"`")
			isNot := strings.TrimSpace(m[2]) != ""
			rawItems := strings.Split(m[3], ",")
			var vals []any
			var strVals []string
			for _, item := range rawItems {
				item = strings.TrimSpace(item)
				if item == "" {
					continue
				}
				v := parseScalarLiteral(item)
				vals = append(vals, v)
				strVals = append(strVals, fmt.Sprintf("%v", v))
			}
			var q map[string]any
			if key == "_id" {
				q = map[string]any{"ids": map[string]any{"values": strVals}}
			} else {
				shouldTerms := make([]map[string]any, 0, len(vals))
				for _, v := range vals {
					shouldTerms = append(shouldTerms, map[string]any{"match_phrase": map[string]any{key: v}})
				}
				q = map[string]any{
					"bool": map[string]any{
						"should":               shouldTerms,
						"minimum_should_match": 1,
					},
				}
			}
			if isNot {
				mustNot = append(mustNot, q)
			} else {
				must = append(must, q)
			}
			continue
		}

		m := cmpRe.FindStringSubmatch(p)
		if len(m) != 4 {
			return map[string]any{"query_string": map[string]any{"query": strings.ReplaceAll(where, "\x00", "AND")}}
		}
		key := strings.Trim(m[1], "\"`")
		op := m[2]
		val := parseScalarLiteral(m[3])

		if key == "_id" {
			idQ := map[string]any{"ids": map[string]any{"values": []string{fmt.Sprintf("%v", val)}}}
			if op == "!=" || op == "<>" {
				mustNot = append(mustNot, idQ)
			} else {
				must = append(must, idQ)
			}
			continue
		}

		switch op {
		case "=":
			must = append(must, map[string]any{
				"match": map[string]any{key: val},
			})
		case "!=", "<>":
			mustNot = append(mustNot, map[string]any{
				"match": map[string]any{key: val},
			})
		case ">", ">=", "<", "<=":
			rangeKey := map[string]string{
				">":  "gt",
				">=": "gte",
				"<":  "lt",
				"<=": "lte",
			}[op]
			must = append(must, map[string]any{
				"range": map[string]any{
					key: map[string]any{rangeKey: val},
				},
			})
		}
	}

	if len(must) == 0 && len(mustNot) == 0 {
		return map[string]any{"query_string": map[string]any{"query": where}}
	}
	boolMap := make(map[string]any)
	if len(must) > 0 {
		boolMap["must"] = must
	}
	if len(mustNot) > 0 {
		boolMap["must_not"] = mustNot
	}
	return map[string]any{"bool": boolMap}
}

func parseESSelectProjection(selectExpr string) (selectedCols []string, sourceFields []string) {
	trimmed := strings.TrimSpace(selectExpr)
	if trimmed == "" || trimmed == "*" {
		return nil, nil
	}
	parts := strings.Split(trimmed, ",")
	for _, p := range parts {
		col := stripIdentQuotes(p)
		if col == "" {
			continue
		}
		if col == "*" {
			return nil, nil
		}
		selectedCols = append(selectedCols, col)
		if col != "_id" && col != "_score" {
			sourceFields = append(sourceFields, col)
		}
	}
	return selectedCols, sourceFields
}

func jsonArrayToQueryResult(execID string, arr []map[string]any, elapsedMs int64) *driver.QueryResult {
	colSet := make(map[string]bool)
	var colNames []string
	for _, item := range arr {
		for k := range item {
			if !colSet[k] {
				colSet[k] = true
				colNames = append(colNames, k)
			}
		}
	}
	sort.Strings(colNames)
	cols := make([]driver.ColumnMeta, len(colNames))
	for i, k := range colNames {
		cols[i] = driver.ColumnMeta{Name: k, DataType: "string", RawType: "string", IsNullable: true}
	}
	rows := make([][]any, len(arr))
	for rIdx, item := range arr {
		row := make([]any, len(colNames))
		for cIdx, k := range colNames {
			row[cIdx] = formatESCellValue(item[k])
		}
		rows[rIdx] = row
	}
	return &driver.QueryResult{
		ExecutionID:  execID,
		Columns:      cols,
		Rows:         rows,
		RowsAffected: int64(len(rows)),
		ElapsedMs:    elapsedMs,
	}
}

func (e *ElasticsearchDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	start := time.Now()
	stmts := driver.SplitHTTPOrSQLStatements(req.SQL)
	if len(stmts) == 0 {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []driver.ColumnMeta{},
			Rows:        [][]any{},
		}, nil
	}
	if len(stmts) == 1 {
		singleReq := req
		singleReq.SQL = stmts[0]
		return e.executeSingle(ctx, singleReq)
	}

	allResults := make([]driver.StatementResult, 0, len(stmts))
	var lastRes *driver.QueryResult
	var lastErr string

	for _, stmt := range stmts {
		stmtStart := time.Now()
		subReq := req
		subReq.SQL = stmt
		res, err := e.executeSingle(ctx, subReq)
		if err != nil {
			errMsg := err.Error()
			allResults = append(allResults, driver.StatementResult{
				SQL:       stmt,
				Columns:   []driver.ColumnMeta{},
				Rows:      [][]any{},
				ElapsedMs: time.Since(stmtStart).Milliseconds(),
				Error:     errMsg,
			})
			lastErr = errMsg
			continue
		}
		allResults = append(allResults, driver.StatementResult{
			SQL:          stmt,
			Columns:      res.Columns,
			Rows:         res.Rows,
			RowsAffected: res.RowsAffected,
			ElapsedMs:    res.ElapsedMs,
			HasMore:      res.HasMore,
		})
		lastRes = res
		lastErr = ""
	}

	out := &driver.QueryResult{
		ExecutionID: req.ExecutionID,
		Columns:     []driver.ColumnMeta{},
		Rows:        [][]any{},
		ElapsedMs:   time.Since(start).Milliseconds(),
		Error:       lastErr,
		Results:     allResults,
	}
	if lastRes != nil {
		out.Columns = lastRes.Columns
		out.Rows = lastRes.Rows
		out.RowsAffected = lastRes.RowsAffected
		out.HasMore = lastRes.HasMore
		out.IsEditable = lastRes.IsEditable
		out.SourceSchema = lastRes.SourceSchema
		out.SourceTable = lastRes.SourceTable
		out.PrimaryKeys = lastRes.PrimaryKeys
	}
	return out, nil
}

func (e *ElasticsearchDriver) executeSingle(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	start := time.Now()
	rawSQL := strings.TrimSpace(driver.StripLeadingComments(req.SQL))
	if rawSQL == "" {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []driver.ColumnMeta{},
			Rows:        [][]any{},
		}, nil
	}

	// 1. SHOW INDICES / SHOW TABLES / SHOW COLLECTIONS / SHOW DATABASES
	if strings.EqualFold(rawSQL, "SHOW DATABASES") || strings.EqualFold(rawSQL, "SHOW DATABASES;") {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []driver.ColumnMeta{{Name: "database", DataType: "string", RawType: "string"}},
			Rows:        [][]any{{"default"}},
			ElapsedMs:   time.Since(start).Milliseconds(),
		}, nil
	}
	if strings.EqualFold(rawSQL, "SHOW INDICES") || strings.EqualFold(rawSQL, "SHOW TABLES") || strings.EqualFold(rawSQL, "SHOW COLLECTIONS") ||
		strings.EqualFold(rawSQL, "SHOW INDICES;") || strings.EqualFold(rawSQL, "SHOW TABLES;") || strings.EqualFold(rawSQL, "SHOW COLLECTIONS;") {
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

	// 1b. Pseudo-SQL TRUNCATE [TABLE] <index>
	if match := sqlTruncateRegex.FindStringSubmatch(rawSQL); len(match) > 1 {
		idxName := stripIdentQuotes(match[1])
		body := map[string]any{"query": map[string]any{"match_all": map[string]any{}}}
		respBytes, _, err := e.doRequest(ctx, http.MethodPost, "/"+url.PathEscape(idxName)+"/_delete_by_query?refresh=true&conflicts=proceed", body)
		if err != nil {
			return nil, err
		}
		var delResp struct {
			Deleted int64 `json:"deleted"`
		}
		_ = json.Unmarshal(respBytes, &delResp)
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      []driver.ColumnMeta{},
			Rows:         [][]any{},
			RowsAffected: delResp.Deleted,
			ElapsedMs:    time.Since(start).Milliseconds(),
		}, nil
	}

	// 1c. Pseudo-SQL DELETE FROM <index> [WHERE ...]
	if match := sqlDeleteRegex.FindStringSubmatch(rawSQL); len(match) > 1 {
		idxName := stripIdentQuotes(match[1])
		whereStr := ""
		if len(match) > 2 {
			whereStr = strings.TrimSpace(match[2])
		}
		body := map[string]any{"query": parseSimpleWhereToESQuery(whereStr)}
		respBytes, _, err := e.doRequest(ctx, http.MethodPost, "/"+url.PathEscape(idxName)+"/_delete_by_query?refresh=true&conflicts=proceed", body)
		if err != nil {
			return nil, err
		}
		var delResp struct {
			Deleted int64 `json:"deleted"`
		}
		_ = json.Unmarshal(respBytes, &delResp)
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      []driver.ColumnMeta{},
			Rows:         [][]any{},
			RowsAffected: delResp.Deleted,
			ElapsedMs:    time.Since(start).Milliseconds(),
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
		selectedCols, sourceFields := parseESSelectProjection(match[1])
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
		if len(selectedCols) > 0 {
			if len(sourceFields) > 0 {
				body["_source"] = sourceFields
			} else {
				body["_source"] = false
			}
		}

		if strings.TrimSpace(match[4]) != "" {
			var sorts []map[string]any
			for _, part := range strings.Split(match[4], ",") {
				fields := strings.Fields(strings.TrimSpace(part))
				if len(fields) == 0 {
					continue
				}
				col := stripIdentQuotes(fields[0])
				if col == "_id" {
					// ES 7/8 disallows sorting on _id by default unless fielddata or _doc is used; skip _id sort if unmapped
					continue
				}
				sortField := e.resolveSortField(ctx, idxName, col)
				dir := "asc"
				if len(fields) > 1 && strings.EqualFold(fields[1], "DESC") {
					dir = "desc"
				}
				sorts = append(sorts, map[string]any{sortField: map[string]any{"order": dir}})
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
		if err := decodeJSONUseNumber(respBytes, &searchResp); err != nil {
			return nil, err
		}
		return e.hitsToQueryResult(ctx, req.ExecutionID, idxName, searchResp, offset, limit, time.Since(start).Milliseconds(), true, selectedCols), nil
	}

	// 4. Complex SQL -> Elasticsearch /_sql?format=json (or OpenSearch /_plugins/_sql?format=json)
	if strings.HasPrefix(strings.ToUpper(rawSQL), "SELECT ") {
		sqlPayload := map[string]any{
			"query": strings.TrimRight(rawSQL, ";"),
		}
		sqlEndpoint := "/_sql?format=json"
		if e.isOpenSearch() {
			sqlEndpoint = "/_plugins/_sql?format=json"
		}
		respBytes, statusCode, err := e.doRequest(ctx, http.MethodPost, sqlEndpoint, sqlPayload)
		if err != nil && !e.isOpenSearch() && (statusCode == http.StatusNotFound || statusCode == http.StatusBadRequest || statusCode == http.StatusMethodNotAllowed) {
			if fallbackBytes, _, fallbackErr := e.doRequest(ctx, http.MethodPost, "/_plugins/_sql?format=json", sqlPayload); fallbackErr == nil {
				respBytes = fallbackBytes
				err = nil
			}
		}
		if err != nil {
			return nil, err
		}
		var sqlResp struct {
			Columns []struct {
				Name string `json:"name"`
				Type string `json:"type"`
			} `json:"columns"`
			Schema []struct {
				Name string `json:"name"`
				Type string `json:"type"`
			} `json:"schema"` // OpenSearch SQL format
			Rows     [][]any `json:"rows"`
			Datarows [][]any `json:"datarows"` // OpenSearch SQL format
		}
		if err := decodeJSONUseNumber(respBytes, &sqlResp); err != nil {
			return nil, err
		}
		colDefs := sqlResp.Columns
		if len(colDefs) == 0 && len(sqlResp.Schema) > 0 {
			colDefs = sqlResp.Schema
		}
		rowData := sqlResp.Rows
		if len(rowData) == 0 && len(sqlResp.Datarows) > 0 {
			rowData = sqlResp.Datarows
		}
		cols := make([]driver.ColumnMeta, len(colDefs))
		for i, c := range colDefs {
			cols[i] = driver.ColumnMeta{
				Name:     c.Name,
				DataType: c.Type,
				RawType:  rawTypeFromESType(c.Type),
			}
		}
		for rIdx := range rowData {
			for cIdx := range rowData[rIdx] {
				rowData[rIdx][cIdx] = formatESCellValue(rowData[rIdx][cIdx])
			}
		}
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      cols,
			Rows:         rowData,
			RowsAffected: int64(len(rowData)),
			ElapsedMs:    time.Since(start).Milliseconds(),
		}, nil
	}

	// 5. Kibana DevTools HTTP syntax: GET/POST/PUT/DELETE/PATCH/HEAD /path [\n {json}]
	if match := httpCmdRegex.FindStringSubmatch(rawSQL); len(match) >= 3 {
		method := strings.ToUpper(match[1])
		path := match[2]
		bodyStr := strings.TrimSpace(match[3])
		var bodyArg any
		if bodyStr != "" {
			bodyArg = bodyStr
		}
		respBytes, statusCode, err := e.doRequest(ctx, method, path, bodyArg)
		if err != nil {
			return nil, err
		}
		if method == http.MethodHead {
			return &driver.QueryResult{
				ExecutionID:  req.ExecutionID,
				Columns:      []driver.ColumnMeta{{Name: "status", DataType: "string", RawType: "string"}},
				Rows:         [][]any{{fmt.Sprintf("HTTP %d OK", statusCode)}},
				RowsAffected: 1,
				ElapsedMs:    time.Since(start).Milliseconds(),
			}, nil
		}

		// Render JSON array responses (e.g. GET /_cat/indices?format=json) as tabular rows
		var arrResp []map[string]any
		if decodeJSONUseNumber(respBytes, &arrResp) == nil && len(arrResp) > 0 {
			return jsonArrayToQueryResult(req.ExecutionID, arrResp, time.Since(start).Milliseconds()), nil
		}

		var searchResp esSearchResponse
		if decodeJSONUseNumber(respBytes, &searchResp) == nil && searchResp.Hits.Hits != nil {
			// Only convert to hits table if there are actual hits OR there are no aggregations to display.
			// When size=0 with aggregations, returning an empty hits table would swallow the aggregation results!
			if len(searchResp.Hits.Hits) > 0 || len(searchResp.Aggregations) == 0 {
				idxName := ""
				cleanPath := strings.SplitN(strings.TrimPrefix(path, "/"), "?", 2)[0]
				segs := strings.Split(cleanPath, "/")
				if len(segs) >= 2 && segs[1] == "_search" {
					idxName = segs[0]
				}
				return e.hitsToQueryResult(ctx, req.ExecutionID, idxName, searchResp, 0, 0, time.Since(start).Milliseconds(), idxName != "" && !strings.Contains(idxName, ","), nil), nil
			}
		}

		var pretty any
		display := string(respBytes)
		if decodeJSONUseNumber(respBytes, &pretty) == nil {
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
			if decodeJSONUseNumber([]byte(trimmed), &parsed) == nil {
				return parsed
			}
		}
	}
	return v
}

func cleanIDValue(v any) string {
	if v == nil {
		return ""
	}
	s := strings.TrimSpace(fmt.Sprintf("%v", v))
	if s == "" || s == "<nil>" {
		return ""
	}
	return s
}

func (e *ElasticsearchDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	for _, c := range changes {
		switch c.Type {
		case "insert":
			doc := make(map[string]any)
			var docID string
			for k, v := range c.Changes {
				if k == "_score" {
					continue
				}
				if k == "_id" {
					docID = cleanIDValue(v)
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
			docID := cleanIDValue(c.PrimaryKey["_id"])
			doc := make(map[string]any)
			for k, v := range c.Changes {
				if k != "_id" && k != "_score" {
					doc[k] = parseESFieldValue(v)
				}
			}
			b, _ := json.Marshal(map[string]any{"doc": doc})
			statements = append(statements, fmt.Sprintf("POST /%s/_update/%s?refresh=wait_for\n%s", table, docID, string(b)))
		case "delete":
			docID := cleanIDValue(c.PrimaryKey["_id"])
			statements = append(statements, fmt.Sprintf("DELETE /%s/_doc/%s?refresh=wait_for", table, docID))
		}
	}
	return statements, nil
}

func (e *ElasticsearchDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	if len(changes) == 0 {
		return 0, nil
	}

	// Use Elasticsearch Bulk API when applying multiple row changes for high performance
	if len(changes) > 1 {
		var ndjson bytes.Buffer
		var expectedOps int64
		for _, c := range changes {
			switch c.Type {
			case "insert":
				doc := make(map[string]any)
				var docID string
				for k, v := range c.Changes {
					if k == "_score" {
						continue
					}
					if k == "_id" {
						docID = cleanIDValue(v)
					} else {
						doc[k] = parseESFieldValue(v)
					}
				}
				meta := map[string]any{}
				if docID != "" {
					meta["_id"] = docID
				}
				metaLine, _ := json.Marshal(map[string]any{"index": meta})
				docLine, _ := json.Marshal(doc)
				ndjson.Write(metaLine)
				ndjson.WriteByte('\n')
				ndjson.Write(docLine)
				ndjson.WriteByte('\n')
				expectedOps++

			case "update":
				docID := cleanIDValue(c.PrimaryKey["_id"])
				if docID == "" {
					continue
				}
				doc := make(map[string]any)
				for k, v := range c.Changes {
					if k != "_id" && k != "_score" {
						doc[k] = parseESFieldValue(v)
					}
				}
				if len(doc) == 0 {
					continue
				}
				metaLine, _ := json.Marshal(map[string]any{"update": map[string]any{"_id": docID}})
				docLine, _ := json.Marshal(map[string]any{"doc": doc})
				ndjson.Write(metaLine)
				ndjson.WriteByte('\n')
				ndjson.Write(docLine)
				ndjson.WriteByte('\n')
				expectedOps++

			case "delete":
				docID := cleanIDValue(c.PrimaryKey["_id"])
				if docID == "" {
					continue
				}
				metaLine, _ := json.Marshal(map[string]any{"delete": map[string]any{"_id": docID}})
				ndjson.Write(metaLine)
				ndjson.WriteByte('\n')
				expectedOps++
			}
		}

		if expectedOps == 0 {
			return 0, nil
		}

		bulkPath := fmt.Sprintf("/%s/_bulk?refresh=wait_for", url.PathEscape(table))
		respBytes, _, err := e.doRequest(ctx, http.MethodPost, bulkPath, ndjson.Bytes())
		if err != nil {
			return 0, err
		}

		var bulkResp struct {
			Errors bool              `json:"errors"`
			Items  []map[string]struct {
				Status int `json:"status"`
				Error  *struct {
					Type   string `json:"type"`
					Reason string `json:"reason"`
				} `json:"error,omitempty"`
			} `json:"items"`
		}
		if json.Unmarshal(respBytes, &bulkResp) == nil && bulkResp.Errors {
			var succeeded int64
			var firstErr string
			for _, item := range bulkResp.Items {
				for _, opRes := range item {
					if opRes.Error != nil {
						if firstErr == "" {
							firstErr = fmt.Sprintf("%s: %s", opRes.Error.Type, opRes.Error.Reason)
						}
					} else if opRes.Status < 400 {
						succeeded++
					}
				}
			}
			if firstErr != "" {
				return succeeded, fmt.Errorf("elasticsearch bulk error: %s", firstErr)
			}
		}
		return expectedOps, nil
	}

	var totalAffected int64
	for _, c := range changes {
		switch c.Type {
		case "insert":
			doc := make(map[string]any)
			var docID string
			for k, v := range c.Changes {
				if k == "_score" {
					continue
				}
				if k == "_id" {
					docID = cleanIDValue(v)
				} else {
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
			docID := cleanIDValue(c.PrimaryKey["_id"])
			doc := make(map[string]any)
			for k, v := range c.Changes {
				if k != "_id" && k != "_score" {
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
			docID := cleanIDValue(c.PrimaryKey["_id"])
			path := fmt.Sprintf("/%s/_doc/%s?refresh=wait_for", url.PathEscape(table), url.PathEscape(docID))
			if _, _, err := e.doRequest(ctx, http.MethodDelete, path, nil); err != nil {
				return totalAffected, err
			}
			totalAffected++
		}
	}
	return totalAffected, nil
}
