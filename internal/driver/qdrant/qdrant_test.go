package qdrant

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"dhub/internal/driver"
)

func TestQdrantDriverLifecycleAndQueries(t *testing.T) {
	var lastMethod, lastPath, lastAPIKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lastMethod = r.Method
		lastPath = r.URL.Path
		lastAPIKey = r.Header.Get("api-key")
		w.Header().Set("Content-Type", "application/json")

		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/collections":
			_, _ = w.Write([]byte(`{"result":{"collections":[{"name":"docs"}]},"status":"ok"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/collections/docs":
			_, _ = w.Write([]byte(`{
				"result": {
					"status": "green",
					"points_count": 42,
					"config": {"params": {"vectors": {"size": 3, "distance": "Cosine"}}},
					"payload_schema": {"category": {"data_type": "keyword"}}
				},
				"status": "ok"
			}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs/points/scroll":
			_, _ = w.Write([]byte(`{
				"result": {
					"points": [
						{"id": 1, "payload": {"category": "ai", "title": "hello"}, "vector": [0.1, 0.2, 0.3]}
					]
				},
				"status": "ok"
			}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs/points/search":
			_, _ = w.Write([]byte(`{
				"result": [
					{"id": 1, "score": 0.98, "payload": {"category": "ai"}, "vector": [0.1, 0.2, 0.3]}
				],
				"status": "ok"
			}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs/points/count":
			_, _ = w.Write([]byte(`{"result":{"count":42},"status":"ok"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	drv, err := NewQdrantDriver(srv.URL, "secret-key", nil)
	if err != nil {
		t.Fatalf("NewQdrantDriver: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()
	if err := drv.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if lastAPIKey != "secret-key" {
		t.Fatalf("expected api-key header, got %q", lastAPIKey)
	}

	objs, err := drv.ListObjects(ctx, "default", "default")
	if err != nil || len(objs) != 1 || objs[0].Name != "docs" || objs[0].RowEstimate != 42 {
		t.Fatalf("unexpected ListObjects: %+v, err=%v", objs, err)
	}

	st, err := drv.GetTableStructure(ctx, "default", "default", "docs")
	if err != nil {
		t.Fatalf("GetTableStructure: %v", err)
	}
	if len(st.Indexes) != 1 || st.Indexes[0].Type != "keyword" {
		t.Fatalf("unexpected indexes: %+v", st.Indexes)
	}

	// Pseudo-SQL SELECT *
	res, err := drv.Execute(ctx, driver.QueryRequest{SQL: `SELECT * FROM docs WHERE category = 'ai' LIMIT 10`})
	if err != nil {
		t.Fatalf("Execute SELECT: %v", err)
	}
	if len(res.Rows) != 1 || !res.IsEditable {
		t.Fatalf("unexpected SELECT result: %+v", res)
	}

	// REST similarity search
	searchRes, err := drv.Execute(ctx, driver.QueryRequest{
		SQL: "POST /collections/docs/points/search\n" + `{"vector":[0.1,0.2,0.3],"limit":5,"with_payload":true}`,
	})
	if err != nil {
		t.Fatalf("Execute search: %v", err)
	}
	if lastMethod != http.MethodPost || !strings.HasSuffix(lastPath, "/points/search") || len(searchRes.Rows) != 1 {
		t.Fatalf("unexpected search result: %+v", searchRes)
	}

	// Pseudo-SQL COUNT
	cntRes, err := drv.Execute(ctx, driver.QueryRequest{SQL: `SELECT COUNT(*) FROM docs`})
	if err != nil || len(cntRes.Rows) != 1 {
		t.Fatalf("Execute COUNT: %+v, err=%v", cntRes, err)
	}
	if got, _ := json.Marshal(cntRes.Rows[0][0]); string(got) != "42" {
		t.Fatalf("expected count 42, got %s", got)
	}
}
