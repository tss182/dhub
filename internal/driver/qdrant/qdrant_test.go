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

func TestQdrantDriverCommentsFiltersPagingAndDML(t *testing.T) {
	var scrollCalls int
	var deleteBodies []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs/points/scroll":
			scrollCalls++
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if _, hasOrderBy := body["order_by"]; hasOrderBy {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"status":{"error":"Index required for order_by"}}`))
				return
			}
			_, _ = w.Write([]byte(`{
				"result": {
					"points": [
						{"id": 2, "payload": {"views": 10}, "vector": [0.2, 0.3]},
						{"id": 1, "payload": {"views": 30}, "vector": [0.1, 0.2]}
					],
					"next_page_offset": 3
				},
				"status": "ok"
			}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs/points/delete":
			var raw json.RawMessage
			_ = json.NewDecoder(r.Body).Decode(&raw)
			deleteBodies = append(deleteBodies, string(raw))
			_, _ = w.Write([]byte(`{"result":{"status":"completed"},"status":"ok"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	drv, err := NewQdrantDriver(srv.URL, "", nil)
	if err != nil {
		t.Fatalf("NewQdrantDriver: %v", err)
	}
	defer drv.Close()
	ctx := context.Background()

	// 1. Leading comments + SELECT 1
	sel1, err := drv.Execute(ctx, driver.QueryRequest{SQL: "-- comment header\nSELECT 1;"})
	if err != nil || len(sel1.Rows) != 1 || sel1.Rows[0][0] != int64(1) {
		t.Fatalf("SELECT 1 with comment failed: %+v, err=%v", sel1, err)
	}

	// 2. Leading comments + ORDER BY fallback + HasMore
	res, err := drv.Execute(ctx, driver.QueryRequest{
		SQL: "-- Query Console\nSELECT * FROM docs ORDER BY views DESC LIMIT 2;",
	})
	if err != nil {
		t.Fatalf("Execute SELECT with comment & order_by fallback: %v", err)
	}
	if scrollCalls != 2 {
		t.Fatalf("expected 2 scroll calls (order_by + fallback), got %d", scrollCalls)
	}
	if !res.HasMore {
		t.Fatalf("expected HasMore=true when next_page_offset is present")
	}
	if res.Rows[0][0] != int64(1) {
		t.Fatalf("expected fallback in-memory DESC sort to put id=1 (views=30) first, got %v", res.Rows[0][0])
	}

	// 3. TRUNCATE & DELETE
	if _, err := drv.Execute(ctx, driver.QueryRequest{SQL: "TRUNCATE TABLE docs;"}); err != nil {
		t.Fatalf("TRUNCATE TABLE: %v", err)
	}
	if _, err := drv.Execute(ctx, driver.QueryRequest{SQL: "DELETE FROM docs WHERE id = 5;"}); err != nil {
		t.Fatalf("DELETE FROM: %v", err)
	}
	if len(deleteBodies) != 2 || !strings.Contains(deleteBodies[0], `"filter":{}`) || !strings.Contains(deleteBodies[1], `"has_id":[5]`) {
		t.Fatalf("unexpected delete bodies: %#v", deleteBodies)
	}

	// 4. Filter parsing (has_id, range, must_not, is_null, raw JSON)
	f1 := parseSimpleWhereToFilter(`id = 42 AND views >= 10 AND category != 'spam' AND tag IS NOT NULL`)
	b1, _ := json.Marshal(f1)
	s1 := string(b1)
	if !strings.Contains(s1, `"has_id":[42]`) || !strings.Contains(s1, `"gte":10`) || !strings.Contains(s1, `"must_not"`) || !strings.Contains(s1, `"is_null"`) {
		t.Fatalf("unexpected filter JSON: %s", s1)
	}
	fRaw := parseSimpleWhereToFilter(`{"must":[{"key":"tag","match":{"value":"go"}}]}`)
	if fRaw == nil || fRaw["must"] == nil {
		t.Fatalf("expected raw JSON filter to parse, got %#v", fRaw)
	}

	// 5. GenerateDMLPreview with named vectors, vector update, and JSON payload
	stmts, err := drv.GenerateDMLPreview("default", "default", "docs", []driver.RowChange{
		{
			Type: "insert",
			Changes: map[string]any{
				"id":          "10",
				"vector.text": "[0.1, 0.2]",
				"meta":        `{"lang":"id"}`,
			},
		},
		{
			Type:       "update",
			PrimaryKey: map[string]any{"id": 10},
			Changes: map[string]any{
				"title":  "updated",
				"vector": "[0.4, 0.5]",
			},
		},
	})
	if err != nil {
		t.Fatalf("GenerateDMLPreview: %v", err)
	}
	if len(stmts) != 3 {
		t.Fatalf("expected 3 preview statements (1 insert, 1 payload update, 1 vector update), got %d: %#v", len(stmts), stmts)
	}
	if !strings.Contains(stmts[0], `"text":[0.1,0.2]`) || !strings.Contains(stmts[0], `"meta":{"lang":"id"}`) {
		t.Fatalf("unexpected insert preview: %s", stmts[0])
	}
	if !strings.Contains(stmts[1], `/points/payload?wait=true`) || !strings.Contains(stmts[2], `/points/vectors?wait=true`) {
		t.Fatalf("unexpected update previews: %s | %s", stmts[1], stmts[2])
	}
}
