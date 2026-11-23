package qdrant

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

// QdrantDriver implements driver.DatabaseDriver over Qdrant's HTTP REST API.
type QdrantDriver struct {
	baseURL     string
	apiKey      string
	client      *http.Client
	cursorMu    sync.Mutex
	cursorCache map[string]map[int]any
}

// NewQdrantDriver creates a Qdrant driver targeting baseURL (e.g. http://127.0.0.1:6333).
func NewQdrantDriver(baseURL, apiKey string, tlsCfg *tls.Config) (*QdrantDriver, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("qdrant base URL cannot be empty")
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

	return &QdrantDriver{
		baseURL: baseURL,
		apiKey:  apiKey,
		client: &http.Client{
			// Rely on request context deadlines instead of a hardcoded 30s timeout
			// so long exports, snapshots, and heavy scrolls can complete.
			Transport: transport,
		},
		cursorCache: make(map[string]map[int]any),
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

// ServerVersion fetches the Qdrant server version via GET /.
func (q *QdrantDriver) ServerVersion(ctx context.Context) (string, error) {
	raw, _, err := q.doRequest(ctx, http.MethodGet, "/", nil)
	if err != nil {
		return "", err
	}
	var root struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &root); err != nil {
		return "", err
	}
	return root.Version, nil
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
		Status       string `json:"status"`
		PointsCount  *int64 `json:"points_count"`
		VectorsCount *int64 `json:"vectors_count"`
		Config       struct {
			Params struct {
				Vectors       json.RawMessage `json:"vectors"`
				SparseVectors json.RawMessage `json:"sparse_vectors"`
			} `json:"params"`
		} `json:"config"`
		PayloadSchema map[string]struct {
			DataType string `json:"data_type"`
		} `json:"payload_schema"`
	} `json:"result"`
}

type vectorParamInfo struct {
	Size              int             `json:"size"`
	Distance          string          `json:"distance"`
	Datatype          string          `json:"datatype,omitempty"`
	OnDisk            *bool           `json:"on_disk,omitempty"`
	MultivectorConfig json.RawMessage `json:"multivector_config,omitempty"`
}

func formatVectorTypeDesc(v vectorParamInfo) (colType string, shortDesc string) {
	extras := []string{}
	if v.Datatype != "" && !strings.EqualFold(v.Datatype, "float32") {
		extras = append(extras, v.Datatype)
	}
	if len(v.MultivectorConfig) > 0 && string(v.MultivectorConfig) != "null" {
		extras = append(extras, "multi")
	}
	if v.OnDisk != nil && *v.OnDisk {
		extras = append(extras, "on_disk")
	}
	if len(extras) > 0 {
		return fmt.Sprintf("vector(%d, %s, %s)", v.Size, v.Distance, strings.Join(extras, ", ")),
			fmt.Sprintf("%dd %s (%s)", v.Size, v.Distance, strings.Join(extras, ","))
	}
	return fmt.Sprintf("vector(%d, %s)", v.Size, v.Distance),
		fmt.Sprintf("%dd %s", v.Size, v.Distance)
}

func parseVectorConfigSummary(raw, rawSparse json.RawMessage) (map[string]string, string) {
	configs := make(map[string]string)
	var parts []string

	if len(raw) > 0 && string(raw) != "null" {
		// Single unnamed vector: {"size": 1536, "distance": "Cosine"}
		var single vectorParamInfo
		if err := json.Unmarshal(raw, &single); err == nil && single.Size > 0 {
			desc, short := formatVectorTypeDesc(single)
			configs["vector"] = desc
			parts = append(parts, short)
		} else {
			// Named vectors: {"text": {"size": 768, "distance": "Cosine"}, ...}
			var named map[string]vectorParamInfo
			if err := json.Unmarshal(raw, &named); err == nil && len(named) > 0 {
				names := make([]string, 0, len(named))
				for k := range named {
					names = append(names, k)
				}
				sort.Strings(names)
				for _, k := range names {
					desc, short := formatVectorTypeDesc(named[k])
					configs["vector."+k] = desc
					parts = append(parts, fmt.Sprintf("%s:%s", k, short))
				}
			}
		}
	}

	if len(rawSparse) > 0 && string(rawSparse) != "null" {
		var sparse map[string]json.RawMessage
		if err := json.Unmarshal(rawSparse, &sparse); err == nil && len(sparse) > 0 {
			names := make([]string, 0, len(sparse))
			for k := range sparse {
				names = append(names, k)
			}
			sort.Strings(names)
			for _, k := range names {
				configs["vector."+k] = "sparse_vector"
				parts = append(parts, fmt.Sprintf("%s:sparse", k))
			}
		}
	}

	return configs, strings.Join(parts, ", ")
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

	cols := listResp.Result.Collections
	objects := make([]driver.ObjectSummary, len(cols))

	const maxConcurrency = 8
	sem := make(chan struct{}, maxConcurrency)
	var wg sync.WaitGroup

	for idx, c := range cols {
		wg.Add(1)
		go func(i int, collName string) {
			defer wg.Done()
			rowEst := int64(-1)
			comment := ""

			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				objects[i] = driver.ObjectSummary{
					Schema:      "default",
					Name:        collName,
					Type:        "table",
					RowEstimate: rowEst,
				}
				return
			}

			if ctx.Err() == nil {
				infoBytes, _, infoErr := q.doRequest(ctx, http.MethodGet, "/collections/"+url.PathEscape(collName), nil)
				if infoErr == nil {
					var info collectionInfoResp
					if json.Unmarshal(infoBytes, &info) == nil {
						if info.Result.PointsCount != nil {
							rowEst = *info.Result.PointsCount
						} else if info.Result.VectorsCount != nil {
							rowEst = *info.Result.VectorsCount
						}
						_, comment = parseVectorConfigSummary(info.Result.Config.Params.Vectors, info.Result.Config.Params.SparseVectors)
					}
				}
			}

			objects[i] = driver.ObjectSummary{
				Schema:      "default",
				Name:        collName,
				Type:        "table",
				RowEstimate: rowEst,
				Comment:     comment,
			}
		}(idx, c.Name)
	}
	wg.Wait()

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
	vecConfigs, _ := parseVectorConfigSummary(info.Result.Config.Params.Vectors, info.Result.Config.Params.SparseVectors)
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
	return pointsToQueryResultWithProjection(execID, collection, points, elapsedMs, isEditable, nil)
}

func pointsToQueryResultWithProjection(execID, collection string, points []qdrantPoint, elapsedMs int64, isEditable bool, selectedCols []string) *driver.QueryResult {
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

	var columns []driver.ColumnMeta
	if len(selectedCols) > 0 {
		seen := make(map[string]bool)
		for _, colName := range selectedCols {
			if colName == "" || seen[colName] {
				continue
			}
			seen[colName] = true
			switch {
			case strings.EqualFold(colName, "id"):
				columns = append(columns, driver.ColumnMeta{Name: "id", DataType: "point_id", RawType: "string", IsPrimaryKey: true, IsNullable: false})
			case strings.EqualFold(colName, "score"):
				columns = append(columns, driver.ColumnMeta{Name: "score", DataType: "float", RawType: "number", IsNullable: true})
			case strings.EqualFold(colName, "vector"):
				columns = append(columns, driver.ColumnMeta{Name: "vector", DataType: "vector", RawType: "vector", IsNullable: true})
			case strings.HasPrefix(colName, "vector."):
				columns = append(columns, driver.ColumnMeta{Name: colName, DataType: "vector", RawType: "vector", IsNullable: true})
			default:
				columns = append(columns, driver.ColumnMeta{Name: colName, DataType: "json", RawType: "string", IsNullable: true})
			}
		}
	} else {
		columns = []driver.ColumnMeta{
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
	}

	rows := make([][]any, len(points))
	for rIdx, pt := range points {
		row := make([]any, 0, len(columns))
		for _, col := range columns {
			switch {
			case col.Name == "id":
				row = append(row, formatCellValue(pt.ID))
			case col.Name == "score":
				if pt.Score != nil {
					row = append(row, *pt.Score)
				} else {
					row = append(row, nil)
				}
			case col.Name == "vector":
				if _, isMap := pt.Vector.(map[string]any); !isMap {
					row = append(row, formatCellValue(pt.Vector))
				} else {
					row = append(row, nil)
				}
			case strings.HasPrefix(col.Name, "vector."):
				vecKey := strings.TrimPrefix(col.Name, "vector.")
				if m, ok := pt.Vector.(map[string]any); ok && m != nil {
					row = append(row, formatCellValue(m[vecKey]))
				} else {
					row = append(row, nil)
				}
			default:
				if pt.Payload != nil {
					row = append(row, formatCellValue(pt.Payload[col.Name]))
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

func (q *QdrantDriver) buildEmptyCollectionColumns(ctx context.Context, coll string, selectedCols []string) []driver.ColumnMeta {
	if len(selectedCols) > 0 {
		return pointsToQueryResultWithProjection("", coll, nil, 0, true, selectedCols).Columns
	}
	cols := []driver.ColumnMeta{
		{Name: "id", DataType: "point_id", RawType: "string", IsPrimaryKey: true, IsNullable: false},
	}
	infoBytes, _, err := q.doRequest(ctx, http.MethodGet, "/collections/"+url.PathEscape(coll), nil)
	if err != nil {
		return cols
	}
	var info collectionInfoResp
	if json.Unmarshal(infoBytes, &info) != nil {
		return cols
	}
	payloadNames := make([]string, 0, len(info.Result.PayloadSchema))
	for k := range info.Result.PayloadSchema {
		payloadNames = append(payloadNames, k)
	}
	sort.Strings(payloadNames)
	for _, k := range payloadNames {
		dt := info.Result.PayloadSchema[k].DataType
		cols = append(cols, driver.ColumnMeta{Name: k, DataType: dt, RawType: rawTypeFromJSONType(dt), IsNullable: true})
	}
	vecConfigs, _ := parseVectorConfigSummary(info.Result.Config.Params.Vectors, info.Result.Config.Params.SparseVectors)
	vecNames := make([]string, 0, len(vecConfigs))
	for k := range vecConfigs {
		vecNames = append(vecNames, k)
	}
	sort.Strings(vecNames)
	for _, vn := range vecNames {
		cols = append(cols, driver.ColumnMeta{Name: vn, DataType: vecConfigs[vn], RawType: "vector", IsNullable: true})
	}
	return cols
}

var (
	sqlSelectCountRegex = regexp.MustCompile(`(?i)^\s*SELECT\s+COUNT\(\*\)\s+FROM\s+([^\s;]+)(?:\s+WHERE\s+(.+?))?\s*;?\s*$`)
	sqlSelectRegex      = regexp.MustCompile(`(?i)^\s*SELECT\s+(.+?)\s+FROM\s+([^\s;]+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?\s*;?\s*$`)
	sqlTruncateRegex    = regexp.MustCompile(`(?i)^\s*TRUNCATE\s+(?:TABLE\s+)?([^\s;]+)\s*;?\s*$`)
	sqlDeleteRegex      = regexp.MustCompile(`(?i)^\s*DELETE\s+FROM\s+([^\s;]+)(?:\s+WHERE\s+(.+?))?\s*;?\s*$`)
	httpCmdRegex        = regexp.MustCompile(`(?i)^(GET|POST|PUT|DELETE|PATCH)\s+(\S+)(?:\s+([\s\S]*))?$`)
)

func stripIdentQuotes(s string) string {
	s = strings.TrimSpace(s)
	lower := strings.ToLower(s)
	if strings.HasPrefix(lower, "default.") {
		s = s[len("default."):]
	} else if strings.HasPrefix(lower, `"default".`) {
		s = s[len(`"default".`):]
	} else if strings.HasPrefix(lower, "`default`.") {
		s = s[len("`default`."):]
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

func parseSimpleWhereToFilter(where string) (map[string]any, error) {
	where = strings.TrimSpace(where)
	if where == "" {
		return nil, nil
	}
	if strings.HasPrefix(where, "(") && strings.HasSuffix(where, ")") {
		inner := strings.TrimSpace(where[1 : len(where)-1])
		if inner != "" {
			where = inner
		}
	}

	// Allow raw Qdrant filter JSON directly in WHERE
	if strings.HasPrefix(where, "{") && strings.HasSuffix(where, "}") {
		var rawFilter map[string]any
		if err := json.Unmarshal([]byte(where), &rawFilter); err != nil {
			return nil, fmt.Errorf("invalid Qdrant JSON filter: %w", err)
		}
		if len(rawFilter) == 0 {
			return nil, nil
		}
		return rawFilter, nil
	}

	orBranches := splitKeywordTopLevel(where, "OR")
	if len(orBranches) > 1 {
		should := make([]map[string]any, 0, len(orBranches))
		for _, br := range orBranches {
			f, err := parseSimpleWhereToFilter(br)
			if err != nil {
				return nil, err
			}
			if f != nil {
				should = append(should, f)
			}
		}
		if len(should) == 0 {
			return nil, nil
		}
		return map[string]any{"should": should}, nil
	}

	// Protect `BETWEEN a AND b` before splitting on AND
	betweenProtectRe := regexp.MustCompile(`(?i)(\b(?:NOT\s+)?BETWEEN\s+(?:'[^']*'|"[^"]*"|\S+))\s+AND\s+('[^']*'|"[^"]*"|\S+)`)
	protectedWhere := betweenProtectRe.ReplaceAllString(where, "$1 \x00 $2")

	parts := splitKeywordTopLevel(protectedWhere, "AND")
	var must []map[string]any
	var mustNot []map[string]any

	isNullRe := regexp.MustCompile(`(?i)^\s*([a-zA-Z0-9_."` + "`" + `]+)\s+IS\s+(NOT\s+)?NULL\s*$`)
	inRe := regexp.MustCompile(`(?i)^\s*([a-zA-Z0-9_."` + "`" + `]+)\s+(NOT\s+)?IN\s*\((.+)\)\s*$`)
	betweenRe := regexp.MustCompile(`(?i)^\s*([a-zA-Z0-9_."` + "`" + `]+)\s+(NOT\s+)?BETWEEN\s+(.+?)\s*\x00\s*(.+?)\s*$`)
	likeRe := regexp.MustCompile(`(?i)^\s*([a-zA-Z0-9_."` + "`" + `]+)\s+(NOT\s+)?(I?LIKE|CONTAINS)\s+(.+?)\s*$`)
	cmpRe := regexp.MustCompile(`^\s*([a-zA-Z0-9_."` + "`" + `]+)\s*(!=|<>|>=|<=|=|>|<)\s*(.+?)\s*$`)

	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		// Handle balanced outer parentheses (including nested OR / AND like `(a = 1 OR b = 2)`)
		if strings.HasPrefix(p, "(") && strings.HasSuffix(p, ")") {
			inner := strings.TrimSpace(p[1 : len(p)-1])
			if inner != "" {
				if len(splitKeywordTopLevel(inner, "OR")) > 1 || len(splitKeywordTopLevel(inner, "AND")) > 1 {
					subFilter, err := parseSimpleWhereToFilter(strings.ReplaceAll(inner, "\x00", "AND"))
					if err != nil {
						return nil, err
					}
					if subFilter != nil {
						must = append(must, subFilter)
					}
					continue
				}
				p = inner
			}
		}

		if m := isNullRe.FindStringSubmatch(p); len(m) == 3 {
			key := strings.Trim(m[1], "\"`")
			cond := map[string]any{"is_null": map[string]any{"key": key}}
			if strings.TrimSpace(m[2]) != "" {
				mustNot = append(mustNot, cond)
			} else {
				must = append(must, cond)
			}
			continue
		}

		if m := betweenRe.FindStringSubmatch(p); len(m) == 5 {
			key := strings.Trim(m[1], "\"`")
			v1 := parseScalarLiteral(m[3])
			v2 := parseScalarLiteral(m[4])
			cond := map[string]any{
				"key":   key,
				"range": map[string]any{"gte": v1, "lte": v2},
			}
			if strings.TrimSpace(m[2]) != "" {
				mustNot = append(mustNot, cond)
			} else {
				must = append(must, cond)
			}
			continue
		}

		if m := likeRe.FindStringSubmatch(p); len(m) == 5 {
			key := strings.Trim(m[1], "\"`")
			rawLit := parseScalarLiteral(m[4])
			text := strings.Trim(fmt.Sprintf("%v", rawLit), "%*")
			cond := map[string]any{
				"key":   key,
				"match": map[string]any{"text": text},
			}
			if strings.TrimSpace(m[2]) != "" {
				mustNot = append(mustNot, cond)
			} else {
				must = append(must, cond)
			}
			continue
		}

		if m := inRe.FindStringSubmatch(p); len(m) == 4 {
			key := strings.Trim(m[1], "\"`")
			isNot := strings.TrimSpace(m[2]) != ""
			rawItems := strings.Split(m[3], ",")
			vals := make([]any, 0, len(rawItems))
			for _, item := range rawItems {
				item = strings.TrimSpace(item)
				if item == "" {
					continue
				}
				v := parseScalarLiteral(item)
				if strings.EqualFold(key, "id") {
					v = parsePointID(v)
				}
				vals = append(vals, v)
			}
			if len(vals) == 0 {
				return nil, fmt.Errorf("empty IN list in WHERE clause: %s", p)
			}
			var cond map[string]any
			if strings.EqualFold(key, "id") {
				cond = map[string]any{"has_id": vals}
			} else {
				cond = map[string]any{"key": key, "match": map[string]any{"any": vals}}
			}
			if isNot {
				mustNot = append(mustNot, cond)
			} else {
				must = append(must, cond)
			}
			continue
		}

		m := cmpRe.FindStringSubmatch(p)
		if len(m) != 4 {
			return nil, fmt.Errorf("unsupported WHERE condition for Qdrant: %s", strings.ReplaceAll(p, "\x00", "AND"))
		}
		key := strings.Trim(m[1], "\"`")
		op := m[2]
		val := parseScalarLiteral(m[3])

		if strings.EqualFold(key, "id") {
			idVal := parsePointID(val)
			switch op {
			case "=":
				must = append(must, map[string]any{"has_id": []any{idVal}})
			case "!=", "<>":
				mustNot = append(mustNot, map[string]any{"has_id": []any{idVal}})
			default:
				return nil, fmt.Errorf("operator %s is not supported on Qdrant point id", op)
			}
			continue
		}

		switch op {
		case "=":
			must = append(must, map[string]any{
				"key":   key,
				"match": map[string]any{"value": val},
			})
		case "!=", "<>":
			mustNot = append(mustNot, map[string]any{
				"key":   key,
				"match": map[string]any{"value": val},
			})
		case ">", ">=", "<", "<=":
			rangeKey := map[string]string{
				">":  "gt",
				">=": "gte",
				"<":  "lt",
				"<=": "lte",
			}[op]
			must = append(must, map[string]any{
				"key":   key,
				"range": map[string]any{rangeKey: val},
			})
		}
	}

	if len(must) == 0 && len(mustNot) == 0 {
		return nil, nil
	}
	filter := make(map[string]any)
	if len(must) > 0 {
		filter["must"] = must
	}
	if len(mustNot) > 0 {
		filter["must_not"] = mustNot
	}
	return filter, nil
}

func sortPointsInMemory(pts []qdrantPoint, col, dir string) {
	if len(pts) <= 1 || col == "" {
		return
	}
	desc := strings.EqualFold(dir, "desc")
	getVal := func(pt qdrantPoint) (any, bool) {
		if strings.EqualFold(col, "id") {
			return pt.ID, pt.ID != nil
		}
		if strings.EqualFold(col, "score") && pt.Score != nil {
			return *pt.Score, true
		}
		if pt.Payload != nil {
			v, ok := pt.Payload[col]
			return v, ok && v != nil
		}
		return nil, false
	}
	sort.SliceStable(pts, func(i, j int) bool {
		vi, oki := getVal(pts[i])
		vj, okj := getVal(pts[j])
		if !oki && !okj {
			return false
		}
		if !oki {
			return !desc
		}
		if !okj {
			return desc
		}
		var cmp int
		fi, isFi := toFloat64(vi)
		fj, isFj := toFloat64(vj)
		if isFi && isFj {
			if fi < fj {
				cmp = -1
			} else if fi > fj {
				cmp = 1
			}
		} else {
			si := fmt.Sprintf("%v", vi)
			sj := fmt.Sprintf("%v", vj)
			cmp = strings.Compare(si, sj)
		}
		if desc {
			return cmp > 0
		}
		return cmp < 0
	})
}

func toFloat64(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}

func (q *QdrantDriver) invalidateCursorCache(coll string) {
	q.cursorMu.Lock()
	defer q.cursorMu.Unlock()
	if coll == "" {
		q.cursorCache = make(map[string]map[int]any)
		return
	}
	prefix := coll + "|"
	for k := range q.cursorCache {
		if strings.HasPrefix(k, prefix) {
			delete(q.cursorCache, k)
		}
	}
}

func (q *QdrantDriver) getCursor(key string, offset int) (int, any) {
	q.cursorMu.Lock()
	defer q.cursorMu.Unlock()
	m, ok := q.cursorCache[key]
	if !ok {
		return 0, nil
	}
	if c, exact := m[offset]; exact {
		return offset, c
	}
	bestOff := 0
	var bestCursor any
	for off, c := range m {
		if off < offset && off > bestOff && c != nil {
			bestOff = off
			bestCursor = c
		}
	}
	return bestOff, bestCursor
}

func (q *QdrantDriver) setCursor(key string, offset int, cursor any) {
	if cursor == nil || offset <= 0 {
		return
	}
	q.cursorMu.Lock()
	defer q.cursorMu.Unlock()
	if len(q.cursorCache) > 64 {
		q.cursorCache = make(map[string]map[int]any)
	}
	m, ok := q.cursorCache[key]
	if !ok {
		m = make(map[int]any)
		q.cursorCache[key] = m
	}
	m[offset] = cursor
}

func parseSelectProjection(selectExpr string) (selectedCols []string, withPayload any, withVector any) {
	trimmed := strings.TrimSpace(selectExpr)
	if trimmed == "" || trimmed == "*" {
		return nil, true, true
	}
	rawCols := strings.Split(trimmed, ",")
	var payloadCols []string
	var namedVecs []string
	wantAllVec := false

	for _, rc := range rawCols {
		col := strings.Trim(strings.TrimSpace(rc), "\"`'[]")
		if col == "" {
			continue
		}
		if col == "*" {
			return nil, true, true
		}
		selectedCols = append(selectedCols, col)
		switch {
		case strings.EqualFold(col, "id") || strings.EqualFold(col, "score"):
			// handled automatically
		case strings.EqualFold(col, "vector"):
			wantAllVec = true
		case strings.HasPrefix(col, "vector."):
			namedVecs = append(namedVecs, strings.TrimPrefix(col, "vector."))
		default:
			payloadCols = append(payloadCols, col)
		}
	}

	if len(payloadCols) > 0 {
		withPayload = payloadCols
	} else {
		withPayload = false
	}

	if wantAllVec {
		withVector = true
	} else if len(namedVecs) > 0 {
		withVector = namedVecs
	} else {
		withVector = false
	}
	return selectedCols, withPayload, withVector
}

func (q *QdrantDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
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
		return q.executeSingle(ctx, singleReq)
	}

	allResults := make([]driver.StatementResult, 0, len(stmts))
	var lastRes *driver.QueryResult
	var lastErr string

	for _, stmt := range stmts {
		stmtStart := time.Now()
		subReq := req
		subReq.SQL = stmt
		res, err := q.executeSingle(ctx, subReq)
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

func (q *QdrantDriver) executeSingle(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	start := time.Now()
	rawSQL := strings.TrimSpace(driver.StripLeadingComments(req.SQL))
	if rawSQL == "" {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []driver.ColumnMeta{},
			Rows:        [][]any{},
		}, nil
	}

	// 0. Health / trivial SELECT 1
	if strings.EqualFold(rawSQL, "SELECT 1") || strings.EqualFold(rawSQL, "SELECT 1;") {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []driver.ColumnMeta{{Name: "result", DataType: "int64", RawType: "number"}},
			Rows:        [][]any{{int64(1)}},
			ElapsedMs:   time.Since(start).Milliseconds(),
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

	// 1b. Pseudo-SQL TRUNCATE TABLE <collection> / DELETE FROM <collection> [WHERE ...]
	if match := sqlTruncateRegex.FindStringSubmatch(rawSQL); len(match) > 1 {
		coll := stripIdentQuotes(match[1])
		body := map[string]any{"filter": map[string]any{}}
		if _, _, err := q.doRequest(ctx, http.MethodPost, "/collections/"+url.PathEscape(coll)+"/points/delete?wait=true", body); err != nil {
			return nil, err
		}
		q.invalidateCursorCache(coll)
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      []driver.ColumnMeta{},
			Rows:         [][]any{},
			RowsAffected: 0,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: "default",
			SourceTable:  coll,
		}, nil
	}
	if match := sqlDeleteRegex.FindStringSubmatch(rawSQL); len(match) > 1 {
		coll := stripIdentQuotes(match[1])
		filter := map[string]any{}
		if len(match) > 2 && strings.TrimSpace(match[2]) != "" {
			f, fErr := parseSimpleWhereToFilter(match[2])
			if fErr != nil {
				return nil, fErr
			}
			if f != nil {
				filter = f
			}
		}
		body := map[string]any{"filter": filter}
		if _, _, err := q.doRequest(ctx, http.MethodPost, "/collections/"+url.PathEscape(coll)+"/points/delete?wait=true", body); err != nil {
			return nil, err
		}
		q.invalidateCursorCache(coll)
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      []driver.ColumnMeta{},
			Rows:         [][]any{},
			RowsAffected: 1,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: "default",
			SourceTable:  coll,
		}, nil
	}

	// 2. Pseudo-SQL SELECT COUNT(*) FROM <collection>
	if match := sqlSelectCountRegex.FindStringSubmatch(rawSQL); len(match) > 1 {
		coll := stripIdentQuotes(match[1])
		body := map[string]any{"exact": true}
		if len(match) > 2 && strings.TrimSpace(match[2]) != "" {
			f, fErr := parseSimpleWhereToFilter(match[2])
			if fErr != nil {
				return nil, fErr
			}
			if f != nil {
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
		selectedCols, withPayload, withVector := parseSelectProjection(match[1])

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

		var filter map[string]any
		if match[3] != "" {
			f, fErr := parseSimpleWhereToFilter(match[3])
			if fErr != nil {
				return nil, fErr
			}
			filter = f
		}

		var sortCol, sortDir string
		var orderByBody map[string]any
		usedServerOrderBy := false
		if strings.TrimSpace(match[4]) != "" {
			firstSort := strings.Split(match[4], ",")[0]
			fields := strings.Fields(strings.TrimSpace(firstSort))
			if len(fields) > 0 {
				sortCol = stripIdentQuotes(fields[0])
				sortDir = "asc"
				if len(fields) > 1 && strings.EqualFold(fields[1], "DESC") {
					sortDir = "desc"
				}
				if sortCol != "" && !strings.EqualFold(sortCol, "id") && !strings.EqualFold(sortCol, "vector") && !strings.HasPrefix(strings.ToLower(sortCol), "vector.") {
					orderByBody = map[string]any{
						"key":       sortCol,
						"direction": sortDir,
					}
					usedServerOrderBy = true
				}
			}
		}

		type scrollResult struct {
			Result struct {
				Points         []qdrantPoint `json:"points"`
				NextPageOffset any           `json:"next_page_offset"`
			} `json:"result"`
		}

		scrollEndpoint := "/collections/" + url.PathEscape(coll) + "/points/scroll"

		// Fast cursor-based pagination when no in-memory sort fallback is needed.
		runCursorScroll := func() (*driver.QueryResult, error) {
			filterKey := ""
			if filter != nil {
				if fb, err := json.Marshal(filter); err == nil {
					filterKey = string(fb)
				}
			}
			cacheKey := fmt.Sprintf("%s|%s|%s|%s", coll, filterKey, sortCol, sortDir)

			// Qdrant order_by uses order_by.start_from (not offset) and always returns next_page_offset: null.
			if usedServerOrderBy && orderByBody != nil {
				var startFrom any
				if offset > 0 {
					curOff, curVal := q.getCursor(cacheKey, offset)
					startFrom = curVal
					for curOff < offset {
						step := offset - curOff
						if step > 500 {
							step = 500
						}
						ob := map[string]any{"key": sortCol, "direction": sortDir}
						if startFrom != nil {
							ob["start_from"] = startFrom
						}
						stepBody := map[string]any{
							"limit":        step + 1,
							"order_by":     ob,
							"with_payload": []string{sortCol},
							"with_vector":  false,
						}
						if filter != nil {
							stepBody["filter"] = filter
						}
						stepBytes, _, stepErr := q.doRequest(ctx, http.MethodPost, scrollEndpoint, stepBody)
						if stepErr != nil {
							return nil, stepErr
						}
						var stepResp scrollResult
						if err := json.Unmarshal(stepBytes, &stepResp); err != nil {
							return nil, err
						}
						pts := stepResp.Result.Points
						if len(pts) <= step {
							res := pointsToQueryResultWithProjection(req.ExecutionID, coll, nil, time.Since(start).Milliseconds(), len(selectedCols) == 0, selectedCols)
							if len(selectedCols) == 0 {
								res.Columns = q.buildEmptyCollectionColumns(ctx, coll, nil)
							}
							return res, nil
						}
						curOff += step
						startFrom = pts[step].Payload[sortCol]
						q.setCursor(cacheKey, curOff, startFrom)
					}
				}

				ob := map[string]any{"key": sortCol, "direction": sortDir}
				if startFrom != nil {
					ob["start_from"] = startFrom
				}
				body := map[string]any{
					"limit":        limit + 1,
					"order_by":     ob,
					"with_payload": withPayload,
					"with_vector":  withVector,
				}
				if filter != nil {
					body["filter"] = filter
				}
				respBytes, _, err := q.doRequest(ctx, http.MethodPost, scrollEndpoint, body)
				if err != nil {
					return nil, err
				}
				var scrollResp scrollResult
				if err := json.Unmarshal(respBytes, &scrollResp); err != nil {
					return nil, err
				}
				pts := scrollResp.Result.Points
				hasMore := len(pts) > limit
				if hasMore {
					if limit > 0 && pts[limit-1].Payload != nil {
						q.setCursor(cacheKey, offset+limit-1, pts[limit-1].Payload[sortCol])
					}
					if pts[limit].Payload != nil {
						q.setCursor(cacheKey, offset+limit, pts[limit].Payload[sortCol])
					}
					pts = pts[:limit]
				}
				res := pointsToQueryResultWithProjection(req.ExecutionID, coll, pts, time.Since(start).Milliseconds(), len(selectedCols) == 0, selectedCols)
				if len(pts) == 0 && len(selectedCols) == 0 {
					res.Columns = q.buildEmptyCollectionColumns(ctx, coll, nil)
				}
				res.HasMore = hasMore
				return res, nil
			}

			var cursor any
			if offset > 0 {
				curOff, curVal := q.getCursor(cacheKey, offset)
				cursor = curVal
				for curOff < offset {
					step := offset - curOff
					if step > 500 {
						step = 500
					}
					stepBody := map[string]any{
						"limit":        step,
						"with_payload": false,
						"with_vector":  false,
					}
					if filter != nil {
						stepBody["filter"] = filter
					}
					if cursor != nil {
						stepBody["offset"] = cursor
					}
					stepBytes, _, stepErr := q.doRequest(ctx, http.MethodPost, scrollEndpoint, stepBody)
					if stepErr != nil {
						return nil, stepErr
					}
					var stepResp scrollResult
					if err := json.Unmarshal(stepBytes, &stepResp); err != nil {
						return nil, err
					}
					curOff += len(stepResp.Result.Points)
					cursor = stepResp.Result.NextPageOffset
					if cursor == nil {
						// Reached end before target offset
						res := pointsToQueryResultWithProjection(req.ExecutionID, coll, nil, time.Since(start).Milliseconds(), len(selectedCols) == 0, selectedCols)
						if len(selectedCols) == 0 {
							res.Columns = q.buildEmptyCollectionColumns(ctx, coll, nil)
						}
						return res, nil
					}
					q.setCursor(cacheKey, curOff, cursor)
				}
			}

			body := map[string]any{
				"limit":        limit,
				"with_payload": withPayload,
				"with_vector":  withVector,
			}
			if filter != nil {
				body["filter"] = filter
			}
			if cursor != nil {
				body["offset"] = cursor
			}

			respBytes, _, err := q.doRequest(ctx, http.MethodPost, scrollEndpoint, body)
			if err != nil {
				return nil, err
			}
			var scrollResp scrollResult
			if err := json.Unmarshal(respBytes, &scrollResp); err != nil {
				return nil, err
			}

			pts := scrollResp.Result.Points
			hasMore := scrollResp.Result.NextPageOffset != nil
			if hasMore {
				q.setCursor(cacheKey, offset+len(pts), scrollResp.Result.NextPageOffset)
			}
			// Also cache offset+len(pts)-1 -> pts[last].ID so callers using limit=pageSize+1 (like DataGrid) hit cache on next page!
			if len(pts) > 1 && pts[len(pts)-1].ID != nil {
				q.setCursor(cacheKey, offset+len(pts)-1, pts[len(pts)-1].ID)
			}

			res := pointsToQueryResultWithProjection(req.ExecutionID, coll, pts, time.Since(start).Milliseconds(), len(selectedCols) == 0, selectedCols)
			if len(pts) == 0 && len(selectedCols) == 0 {
				res.Columns = q.buildEmptyCollectionColumns(ctx, coll, nil)
			}
			res.HasMore = hasMore
			return res, nil
		}

		if sortCol == "" || usedServerOrderBy {
			res, err := runCursorScroll()
			if err == nil {
				return res, nil
			}
			if !usedServerOrderBy {
				return nil, err
			}
			// Fallback if Qdrant rejects order_by (e.g. unindexed or non-numeric/datetime field)
			usedServerOrderBy = false
		}

		// In-memory sort fallback (for unindexed sortCol or id)
		fetchLimit := limit + offset + 1
		body := map[string]any{
			"limit":        fetchLimit,
			"with_payload": withPayload,
			"with_vector":  withVector,
		}
		if filter != nil {
			body["filter"] = filter
		}
		respBytes, _, err := q.doRequest(ctx, http.MethodPost, scrollEndpoint, body)
		if err != nil {
			return nil, err
		}
		var scrollResp scrollResult
		if err := json.Unmarshal(respBytes, &scrollResp); err != nil {
			return nil, err
		}

		pts := scrollResp.Result.Points
		if sortCol != "" {
			sortPointsInMemory(pts, sortCol, sortDir)
		}
		if offset > 0 {
			if offset >= len(pts) {
				pts = []qdrantPoint{}
			} else {
				pts = pts[offset:]
			}
		}
		hasMore := len(pts) > limit
		if hasMore {
			pts = pts[:limit]
		} else if len(pts) == limit && scrollResp.Result.NextPageOffset != nil {
			hasMore = true
		}

		res := pointsToQueryResultWithProjection(req.ExecutionID, coll, pts, time.Since(start).Milliseconds(), len(selectedCols) == 0, selectedCols)
		if len(pts) == 0 && len(selectedCols) == 0 {
			res.Columns = q.buildEmptyCollectionColumns(ctx, coll, nil)
		}
		res.HasMore = hasMore
		return res, nil
	}

	// 4. REST-style command: GET/POST/PUT/DELETE/PATCH /collections/... [\n {json}]
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

		if method != http.MethodGet && !driver.IsReadOnlySafeQuery(rawSQL) {
			q.invalidateCursorCache(coll)
		}

		var env struct {
			Result json.RawMessage `json:"result"`
		}
		if json.Unmarshal(respBytes, &env) == nil && len(env.Result) > 0 {
			// 4a. Single point object (GET /collections/{name}/points/{id})
			var singlePt qdrantPoint
			if json.Unmarshal(env.Result, &singlePt) == nil && singlePt.ID != nil {
				return pointsToQueryResult(req.ExecutionID, coll, []qdrantPoint{singlePt}, time.Since(start).Milliseconds(), coll != ""), nil
			}
			// 4a. Standard points array (search/recommend/discover)
			var pts []qdrantPoint
			if json.Unmarshal(env.Result, &pts) == nil && pts != nil {
				return pointsToQueryResult(req.ExecutionID, coll, pts, time.Since(start).Milliseconds(), false), nil
			}
			// 4b. Scroll / Query API result.points
			var scrollObj struct {
				Points []qdrantPoint `json:"points"`
			}
			if json.Unmarshal(env.Result, &scrollObj) == nil && scrollObj.Points != nil {
				return pointsToQueryResult(req.ExecutionID, coll, scrollObj.Points, time.Since(start).Milliseconds(), coll != ""), nil
			}
			// 4c. Grouped search/query result.groups
			var groupsObj struct {
				Groups []struct {
					ID   any           `json:"id"`
					Hits []qdrantPoint `json:"hits"`
				} `json:"groups"`
			}
			if json.Unmarshal(env.Result, &groupsObj) == nil && groupsObj.Groups != nil {
				var flat []qdrantPoint
				for _, g := range groupsObj.Groups {
					for _, h := range g.Hits {
						if h.Payload == nil {
							h.Payload = make(map[string]any)
						}
						if _, exists := h.Payload["_group_id"]; !exists {
							h.Payload["_group_id"] = g.ID
						}
						flat = append(flat, h)
					}
				}
				return pointsToQueryResult(req.ExecutionID, coll, flat, time.Since(start).Milliseconds(), false), nil
			}
			// 4d. Batch search/query [][]qdrantPoint
			var batchPts [][]qdrantPoint
			if json.Unmarshal(env.Result, &batchPts) == nil && batchPts != nil {
				var flat []qdrantPoint
				for bIdx, grp := range batchPts {
					for _, h := range grp {
						if h.Payload == nil {
							h.Payload = make(map[string]any)
						}
						if _, exists := h.Payload["_batch_index"]; !exists {
							h.Payload["_batch_index"] = bIdx
						}
						flat = append(flat, h)
					}
				}
				return pointsToQueryResult(req.ExecutionID, coll, flat, time.Since(start).Milliseconds(), false), nil
			}
			// 4e. Facet API result.hits
			var facetObj struct {
				Hits []struct {
					Value any   `json:"value"`
					Count int64 `json:"count"`
				} `json:"hits"`
			}
			if json.Unmarshal(env.Result, &facetObj) == nil && facetObj.Hits != nil {
				rows := make([][]any, len(facetObj.Hits))
				for i, h := range facetObj.Hits {
					rows[i] = []any{formatCellValue(h.Value), h.Count}
				}
				return &driver.QueryResult{
					ExecutionID: req.ExecutionID,
					Columns: []driver.ColumnMeta{
						{Name: "value", DataType: "string", RawType: "string"},
						{Name: "count", DataType: "int64", RawType: "number"},
					},
					Rows:         rows,
					RowsAffected: int64(len(rows)),
					ElapsedMs:    time.Since(start).Milliseconds(),
					SourceSchema: "default",
					SourceTable:  coll,
				}, nil
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

func parsePayloadValue(v any) any {
	if s, ok := v.(string); ok {
		trimmed := strings.TrimSpace(s)
		if (strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}")) ||
			(strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]")) {
			var parsed any
			if json.Unmarshal([]byte(trimmed), &parsed) == nil {
				return parsed
			}
		}
	}
	return v
}

func buildPointForInsert(changes map[string]any) map[string]any {
	pt := map[string]any{"payload": map[string]any{}}
	payload := pt["payload"].(map[string]any)
	for k, v := range changes {
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
			payload[k] = parsePayloadValue(v)
		}
	}
	return pt
}

func (q *QdrantDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	escapedTable := url.PathEscape(table)
	for _, c := range changes {
		switch c.Type {
		case "insert":
			pt := buildPointForInsert(c.Changes)
			b, _ := json.Marshal(map[string]any{"points": []any{pt}})
			statements = append(statements, fmt.Sprintf("PUT /collections/%s/points?wait=true\n%s", escapedTable, string(b)))
		case "update":
			idVal := parsePointID(c.PrimaryKey["id"])
			payload := make(map[string]any)
			var deleteKeys []string
			var singleVec any
			namedVecs := make(map[string]any)

			for k, v := range c.Changes {
				if k == "id" {
					continue
				} else if k == "vector" {
					singleVec = parseVectorValue(v)
				} else if strings.HasPrefix(k, "vector.") {
					namedVecs[strings.TrimPrefix(k, "vector.")] = parseVectorValue(v)
				} else if v == nil {
					deleteKeys = append(deleteKeys, k)
				} else {
					payload[k] = parsePayloadValue(v)
				}
			}
			if len(payload) > 0 {
				b, _ := json.Marshal(map[string]any{"payload": payload, "points": []any{idVal}})
				statements = append(statements, fmt.Sprintf("POST /collections/%s/points/payload?wait=true\n%s", escapedTable, string(b)))
			}
			if len(deleteKeys) > 0 {
				sort.Strings(deleteKeys)
				b, _ := json.Marshal(map[string]any{"keys": deleteKeys, "points": []any{idVal}})
				statements = append(statements, fmt.Sprintf("POST /collections/%s/points/payload/delete?wait=true\n%s", escapedTable, string(b)))
			}
			if singleVec != nil || len(namedVecs) > 0 {
				var vecPayload any = singleVec
				if len(namedVecs) > 0 {
					vecPayload = namedVecs
				}
				b, _ := json.Marshal(map[string]any{
					"points": []map[string]any{
						{"id": idVal, "vector": vecPayload},
					},
				})
				statements = append(statements, fmt.Sprintf("PUT /collections/%s/points/vectors?wait=true\n%s", escapedTable, string(b)))
			}
		case "delete":
			idVal := parsePointID(c.PrimaryKey["id"])
			b, _ := json.Marshal(map[string]any{"points": []any{idVal}})
			statements = append(statements, fmt.Sprintf("POST /collections/%s/points/delete?wait=true\n%s", escapedTable, string(b)))
		}
	}
	return statements, nil
}

func (q *QdrantDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	defer q.invalidateCursorCache(table)
	var totalAffected int64
	escapedTable := url.PathEscape(table)

	var insertBatch []map[string]any
	var deleteBatch []any

	flushInserts := func() error {
		if len(insertBatch) == 0 {
			return nil
		}
		body := map[string]any{"points": insertBatch}
		if _, _, err := q.doRequest(ctx, http.MethodPut, "/collections/"+escapedTable+"/points?wait=true", body); err != nil {
			return err
		}
		totalAffected += int64(len(insertBatch))
		insertBatch = nil
		return nil
	}

	flushDeletes := func() error {
		if len(deleteBatch) == 0 {
			return nil
		}
		body := map[string]any{"points": deleteBatch}
		if _, _, err := q.doRequest(ctx, http.MethodPost, "/collections/"+escapedTable+"/points/delete?wait=true", body); err != nil {
			return err
		}
		totalAffected += int64(len(deleteBatch))
		deleteBatch = nil
		return nil
	}

	for _, c := range changes {
		switch c.Type {
		case "insert":
			if err := flushDeletes(); err != nil {
				return totalAffected, err
			}
			pt := buildPointForInsert(c.Changes)
			if _, ok := pt["id"]; !ok {
				pt["id"] = time.Now().UnixNano()
			}
			insertBatch = append(insertBatch, pt)
			if len(insertBatch) >= 250 {
				if err := flushInserts(); err != nil {
					return totalAffected, err
				}
			}

		case "update":
			if err := flushInserts(); err != nil {
				return totalAffected, err
			}
			if err := flushDeletes(); err != nil {
				return totalAffected, err
			}
			idVal := parsePointID(c.PrimaryKey["id"])
			payload := make(map[string]any)
			var deleteKeys []string
			var singleVec any
			namedVecs := make(map[string]any)

			for k, v := range c.Changes {
				if k == "id" {
					continue
				} else if k == "vector" {
					singleVec = parseVectorValue(v)
				} else if strings.HasPrefix(k, "vector.") {
					namedVecs[strings.TrimPrefix(k, "vector.")] = parseVectorValue(v)
				} else if v == nil {
					deleteKeys = append(deleteKeys, k)
				} else {
					payload[k] = parsePayloadValue(v)
				}
			}

			if len(payload) > 0 {
				body := map[string]any{
					"payload": payload,
					"points":  []any{idVal},
				}
				if _, _, err := q.doRequest(ctx, http.MethodPost, "/collections/"+escapedTable+"/points/payload?wait=true", body); err != nil {
					return totalAffected, err
				}
			}
			if len(deleteKeys) > 0 {
				body := map[string]any{
					"keys":   deleteKeys,
					"points": []any{idVal},
				}
				if _, _, err := q.doRequest(ctx, http.MethodPost, "/collections/"+escapedTable+"/points/payload/delete?wait=true", body); err != nil {
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
				if _, _, err := q.doRequest(ctx, http.MethodPut, "/collections/"+escapedTable+"/points/vectors?wait=true", body); err != nil {
					return totalAffected, err
				}
			}
			totalAffected++

		case "delete":
			if err := flushInserts(); err != nil {
				return totalAffected, err
			}
			idVal := parsePointID(c.PrimaryKey["id"])
			deleteBatch = append(deleteBatch, idVal)
			if len(deleteBatch) >= 500 {
				if err := flushDeletes(); err != nil {
					return totalAffected, err
				}
			}
		}
	}

	if err := flushInserts(); err != nil {
		return totalAffected, err
	}
	if err := flushDeletes(); err != nil {
		return totalAffected, err
	}
	return totalAffected, nil
}
