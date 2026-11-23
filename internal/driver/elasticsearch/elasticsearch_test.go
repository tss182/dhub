package elasticsearch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"dhub/internal/driver"
)

func TestElasticsearchDriverLifecycleAndQueries(t *testing.T) {
	var lastAuth, lastPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lastAuth = r.Header.Get("Authorization")
		lastPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")

		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/":
			_, _ = w.Write([]byte(`{"name":"es-node","cluster_name":"test"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/_cat/indices":
			_, _ = w.Write([]byte(`[
				{"index":"articles","docs.count":"120","store.size":"45kb","health":"green","status":"open"},
				{"index":".kibana_1","docs.count":"5","store.size":"10kb","health":"green","status":"open"}
			]`))
		case r.Method == http.MethodGet && r.URL.Path == "/articles/_mapping":
			_, _ = w.Write([]byte(`{
				"articles": {
					"mappings": {
						"properties": {
							"title": {"type": "text"},
							"embedding": {"type": "dense_vector", "dims": 768, "similarity": "cosine"}
						}
					}
				}
			}`))
		case r.Method == http.MethodPost && r.URL.Path == "/articles/_search":
			_, _ = w.Write([]byte(`{
				"hits": {
					"hits": [
						{"_id": "doc-1", "_score": 0.92, "_source": {"title": "Vector DB", "embedding": [0.1, 0.2, 0.3]}}
					]
				}
			}`))
		case r.Method == http.MethodPost && r.URL.Path == "/articles/_count":
			_, _ = w.Write([]byte(`{"count": 120}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	drv, err := NewElasticsearchDriver(srv.URL, "elastic", "changeme", nil)
	if err != nil {
		t.Fatalf("NewElasticsearchDriver: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()
	if err := drv.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if !strings.HasPrefix(lastAuth, "Basic ") {
		t.Fatalf("expected Basic auth header, got %q", lastAuth)
	}

	objs, err := drv.ListObjects(ctx, "default", "default")
	if err != nil || len(objs) != 1 || objs[0].Name != "articles" || objs[0].RowEstimate != 120 {
		t.Fatalf("unexpected ListObjects (system indices should be filtered): %+v, err=%v", objs, err)
	}

	st, err := drv.GetTableStructure(ctx, "default", "default", "articles")
	if err != nil {
		t.Fatalf("GetTableStructure: %v", err)
	}
	foundVec := false
	for _, col := range st.Columns {
		if col.Name == "embedding" && col.DataType == "dense_vector(768, cosine)" && col.RawType == "vector" {
			foundVec = true
		}
	}
	if !foundVec {
		t.Fatalf("expected dense_vector(768, cosine) column, got %+v", st.Columns)
	}

	// Pseudo-SQL SELECT *
	res, err := drv.Execute(ctx, driver.QueryRequest{SQL: `SELECT * FROM articles WHERE title = 'Vector' LIMIT 10`})
	if err != nil || len(res.Rows) != 1 || !res.IsEditable {
		t.Fatalf("unexpected SELECT result: %+v, err=%v", res, err)
	}

	// Kibana HTTP kNN search
	knnRes, err := drv.Execute(ctx, driver.QueryRequest{
		SQL: "POST /articles/_search\n" + `{"knn":{"field":"embedding","query_vector":[0.1,0.2,0.3],"k":5}}`,
	})
	if err != nil || !strings.HasSuffix(lastPath, "/articles/_search") || len(knnRes.Rows) != 1 {
		t.Fatalf("unexpected kNN result: %+v, err=%v", knnRes, err)
	}

	// Pseudo-SQL COUNT
	cntRes, err := drv.Execute(ctx, driver.QueryRequest{SQL: `SELECT COUNT(*) FROM articles`})
	if err != nil || len(cntRes.Rows) != 1 {
		t.Fatalf("Execute COUNT: %+v, err=%v", cntRes, err)
	}
	if got, _ := json.Marshal(cntRes.Rows[0][0]); string(got) != "120" {
		t.Fatalf("expected count 120, got %s", got)
	}
}

func TestElasticsearchAdvancedQueriesAndBulk(t *testing.T) {
	var bulkBody string
	var bulkContentType string
	var lastSearchBody map[string]any
	isOpenSearch := false

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/":
			if isOpenSearch {
				_, _ = w.Write([]byte(`{"name":"os-node","version":{"number":"2.11.0","distribution":"opensearch"}}`))
			} else {
				_, _ = w.Write([]byte(`{"name":"es-node","version":{"number":"8.12.0"}}`))
			}
		case r.Method == http.MethodGet && r.URL.Path == "/logs-2026.11.23/_mapping":
			_, _ = w.Write([]byte(`{
				"logs-2026.11.23": {
					"mappings": {
						"properties": {
							"status": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
							"views": {"type": "long"},
							"vec": {"type": "knn_vector", "dimension": 3, "method": {"space_type": "l2"}}
						}
					}
				}
			}`))
		case r.Method == http.MethodPost && r.URL.Path == "/logs-2026.11.23/_search":
			_ = json.NewDecoder(r.Body).Decode(&lastSearchBody)
			if _, hasAggs := lastSearchBody["aggs"]; hasAggs {
				_, _ = w.Write([]byte(`{
					"hits": {"total": {"value": 100}, "hits": []},
					"aggregations": {"by_status": {"buckets": [{"key": "ok", "doc_count": 100}]}}
				}`))
				return
			}
			_, _ = w.Write([]byte(`{
				"hits": {
					"total": {"value": 250, "relation": "eq"},
					"hits": [
						{"_id": "1", "_score": 1.0, "_source": {"status": "ok", "views": 9007199254740993}}
					]
				}
			}`))
		case r.Method == http.MethodPost && r.URL.Path == "/logs-2026.11.23/_bulk":
			bulkContentType = r.Header.Get("Content-Type")
			buf := new(strings.Builder)
			b := make([]byte, 4096)
			for {
				n, err := r.Body.Read(b)
				if n > 0 {
					buf.Write(b[:n])
				}
				if err != nil {
					break
				}
			}
			bulkBody = buf.String()
			_, _ = w.Write([]byte(`{"took":5,"errors":false,"items":[{"index":{"_id":"1","status":201}},{"delete":{"_id":"2","status":200}}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/_plugins/_sql":
			_, _ = w.Write([]byte(`{
				"schema": [{"name": "status", "type": "keyword"}],
				"datarows": [["ok"]]
			}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	drv, err := NewElasticsearchDriver(srv.URL, "", "", nil)
	if err != nil {
		t.Fatalf("NewElasticsearchDriver: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()
	ver, err := drv.ServerVersion(ctx)
	if err != nil || !strings.Contains(ver, "8.12.0") {
		t.Fatalf("unexpected ServerVersion: %q, err=%v", ver, err)
	}

	// Dotted index name + complex WHERE + keyword sort fallback + int64 precision + HasMore
	res, err := drv.Execute(ctx, driver.QueryRequest{
		SQL: `SELECT status, views FROM "logs-2026.11.23" WHERE status != 'err' AND views >= 10 ORDER BY status DESC LIMIT 1`,
	})
	if err != nil {
		t.Fatalf("Execute on dotted index failed: %v", err)
	}
	if !res.HasMore {
		t.Fatalf("expected HasMore=true, got HasMore=%v", res.HasMore)
	}
	if len(res.Rows) != 1 || res.Rows[0][1] != "9007199254740993" {
		t.Fatalf("expected int64 precision preserved as string above 2^53-1, got %#v", res.Rows)
	}

	// Aggregations with size: 0 (empty hits.hits) must return aggregation JSON
	aggRes, err := drv.Execute(ctx, driver.QueryRequest{
		SQL: "POST /logs-2026.11.23/_search\n" + `{"size":0,"aggs":{"by_status":{"terms":{"field":"status.keyword"}}}}`,
	})
	if err != nil || len(aggRes.Rows) == 0 || !strings.Contains(fmt.Sprintf("%v", aggRes.Rows[0][0]), "aggregations") {
		t.Fatalf("expected aggregations JSON when hits is empty, got %+v, err=%v", aggRes, err)
	}

	// Bulk ApplyChanges with NDJSON
	affected, err := drv.ApplyChanges(ctx, "default", "default", "logs-2026.11.23", []driver.RowChange{
		{Type: "insert", Changes: map[string]any{"_id": "1", "status": "ok"}},
		{Type: "delete", PrimaryKey: map[string]any{"_id": "2"}},
	})
	if err != nil || affected != 2 {
		t.Fatalf("ApplyChanges bulk failed: affected=%d, err=%v", affected, err)
	}
	if bulkContentType != "application/x-ndjson" || !strings.HasSuffix(bulkBody, "\n") {
		t.Fatalf("expected application/x-ndjson with trailing newline, got content-type=%q body=%q", bulkContentType, bulkBody)
	}

	// OpenSearch knn_vector mapping & /_plugins/_sql fallback
	isOpenSearch = true
	drv.distro = ""
	if _, err := drv.ServerVersion(ctx); err != nil {
		t.Fatalf("ServerVersion OpenSearch: %v", err)
	}
	st, err := drv.GetTableStructure(ctx, "default", "default", "logs-2026.11.23")
	if err != nil {
		t.Fatalf("GetTableStructure: %v", err)
	}
	foundKNN := false
	for _, col := range st.Columns {
		if col.Name == "vec" && col.RawType == "vector" && strings.Contains(col.DataType, "(3, l2)") {
			foundKNN = true
		}
	}
	if !foundKNN {
		t.Fatalf("expected OpenSearch knn_vector column, got %+v", st.Columns)
	}
	osSQLRes, err := drv.Execute(ctx, driver.QueryRequest{
		SQL: `SELECT status FROM "logs-2026.11.23" GROUP BY status`,
	})
	if err != nil || len(osSQLRes.Rows) != 1 || osSQLRes.Rows[0][0] != "ok" {
		t.Fatalf("expected OpenSearch /_plugins/_sql fallback to succeed, got %+v, err=%v", osSQLRes, err)
	}
}

