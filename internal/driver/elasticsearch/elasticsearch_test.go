package elasticsearch

import (
	"context"
	"encoding/json"
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
