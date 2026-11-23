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
	f1, err := parseSimpleWhereToFilter(`id = 42 AND views >= 10 AND category != 'spam' AND tag IS NOT NULL`)
	if err != nil {
		t.Fatalf("parseSimpleWhereToFilter f1: %v", err)
	}
	b1, _ := json.Marshal(f1)
	s1 := string(b1)
	if !strings.Contains(s1, `"has_id":[42]`) || !strings.Contains(s1, `"gte":10`) || !strings.Contains(s1, `"must_not"`) || !strings.Contains(s1, `"is_null"`) {
		t.Fatalf("unexpected filter JSON: %s", s1)
	}
	fRaw, err := parseSimpleWhereToFilter(`{"must":[{"key":"tag","match":{"value":"go"}}]}`)
	if err != nil || fRaw == nil || fRaw["must"] == nil {
		t.Fatalf("expected raw JSON filter to parse, got %#v, err=%v", fRaw, err)
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

func TestQdrantDriverPhase4Features(t *testing.T) {
	var scrollBodies []map[string]any
	var putPointsCalls int
	var deletePointsCalls int
	var deletePayloadKeysCalls int

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/collections":
			_, _ = w.Write([]byte(`{"result":{"collections":[{"name":"docs.v1"},{"name":"empty_col"}]},"status":"ok"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/collections/docs.v1":
			_, _ = w.Write([]byte(`{
				"result": {
					"status": "green",
					"points_count": 4,
					"config": {
						"params": {
							"vectors": {"text": {"size": 128, "distance": "Cosine", "datatype": "float16", "multivector_config": {"comparator": "max_sim"}}},
							"sparse_vectors": {"bm25": {}}
						}
					},
					"payload_schema": {"title": {"data_type": "text"}}
				},
				"status": "ok"
			}`))
		case r.Method == http.MethodGet && r.URL.Path == "/collections/empty_col":
			_, _ = w.Write([]byte(`{
				"result": {
					"status": "green",
					"points_count": 0,
					"config": {"params": {"vectors": {"size": 4, "distance": "Cosine"}}},
					"payload_schema": {"category": {"data_type": "keyword"}}
				},
				"status": "ok"
			}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/empty_col/points/scroll":
			_, _ = w.Write([]byte(`{"result":{"points":[]},"status":"ok"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs.v1/points/scroll":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			scrollBodies = append(scrollBodies, body)
			if body["offset"] == "cursor_2" {
				_, _ = w.Write([]byte(`{
					"result": {
						"points": [{"id": 3, "payload": {"title": "p3"}}, {"id": 4, "payload": {"title": "p4"}}]
					},
					"status": "ok"
				}`))
				return
			}
			_, _ = w.Write([]byte(`{
				"result": {
					"points": [{"id": 1, "payload": {"title": "p1"}}, {"id": 2, "payload": {"title": "p2"}}],
					"next_page_offset": "cursor_2"
				},
				"status": "ok"
			}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs.v1/points/search/groups":
			_, _ = w.Write([]byte(`{"result":{"groups":[{"id":"g1","hits":[{"id":1,"score":0.9,"payload":{"title":"a"}}]}]},"status":"ok"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs.v1/points/search/batch":
			_, _ = w.Write([]byte(`{"result":[[{"id":2,"score":0.8,"payload":{"title":"b"}}]],"status":"ok"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs.v1/facet":
			_, _ = w.Write([]byte(`{"result":{"hits":[{"value":"ai","count":12}]},"status":"ok"}`))
		case r.Method == http.MethodPut && r.URL.Path == "/collections/docs.v1/points":
			putPointsCalls++
			_, _ = w.Write([]byte(`{"result":{"status":"completed"},"status":"ok"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs.v1/points/delete":
			deletePointsCalls++
			_, _ = w.Write([]byte(`{"result":{"status":"completed"},"status":"ok"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs.v1/points/payload/delete":
			deletePayloadKeysCalls++
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

	// 1. Dotted collection name + sparse/multivector metadata
	st, err := drv.GetTableStructure(ctx, "default", "default", "docs.v1")
	if err != nil {
		t.Fatalf("GetTableStructure dotted: %v", err)
	}
	var hasSparse, hasMulti bool
	for _, c := range st.Columns {
		if c.Name == "vector.bm25" && c.DataType == "sparse_vector" {
			hasSparse = true
		}
		if c.Name == "vector.text" && strings.Contains(c.DataType, "multi") && strings.Contains(c.DataType, "float16") {
			hasMulti = true
		}
	}
	if !hasSparse || !hasMulti {
		t.Fatalf("expected sparse and multi vector columns, got: %+v", st.Columns)
	}

	// 2. Empty collection returns vector + indexed payload columns
	emptyRes, err := drv.Execute(ctx, driver.QueryRequest{SQL: `SELECT * FROM empty_col LIMIT 10`})
	if err != nil {
		t.Fatalf("empty_col SELECT: %v", err)
	}
	if len(emptyRes.Columns) != 3 {
		t.Fatalf("expected 3 columns (id, category, vector) for empty collection, got %+v", emptyRes.Columns)
	}

	// 3. Projection + cursor pagination
	p1, err := drv.Execute(ctx, driver.QueryRequest{SQL: `SELECT id, title FROM "docs.v1" LIMIT 2 OFFSET 0`})
	if err != nil || !p1.HasMore || len(p1.Columns) != 2 {
		t.Fatalf("page 1 failed: %+v, err=%v", p1, err)
	}
	if scrollBodies[0]["with_vector"] != false {
		t.Fatalf("expected with_vector=false for projection without vector, got %v", scrollBodies[0]["with_vector"])
	}
	p2, err := drv.Execute(ctx, driver.QueryRequest{SQL: `SELECT id, title FROM "docs.v1" LIMIT 2 OFFSET 2`})
	if err != nil || p2.HasMore || len(p2.Rows) != 2 || p2.Rows[0][0] != int64(3) {
		t.Fatalf("page 2 cursor pagination failed: %+v, err=%v", p2, err)
	}

	// 4. Advanced WHERE filters & explicit error on invalid syntax
	fAdv, err := parseSimpleWhereToFilter(`(category NOT IN ('a', 'b') AND views BETWEEN 10 AND 50 AND title LIKE '%hello%') OR status = 'pinned'`)
	if err != nil {
		t.Fatalf("advanced WHERE parse: %v", err)
	}
	bAdv, _ := json.Marshal(fAdv)
	sAdv := string(bAdv)
	if !strings.Contains(sAdv, `"should"`) || !strings.Contains(sAdv, `"must_not"`) || !strings.Contains(sAdv, `"gte":10`) || !strings.Contains(sAdv, `"text":"hello"`) {
		t.Fatalf("unexpected advanced filter JSON: %s", sAdv)
	}
	if _, err := parseSimpleWhereToFilter(`invalid_clause_without_operator`); err == nil {
		t.Fatalf("expected explicit error for unsupported WHERE clause")
	}

	// 5. Tabular parsers: groups, batch, facet + Multi-statement execution
	multiRes, err := drv.Execute(ctx, driver.QueryRequest{
		SQL: "POST /collections/docs.v1/points/search/groups\n{\"vector\":[0.1],\"group_by\":\"cat\"}\n\n" +
			"POST /collections/docs.v1/points/search/batch\n{\"searches\":[]}\n\n" +
			"POST /collections/docs.v1/facet\n{\"key\":\"category\"}",
	})
	if err != nil {
		t.Fatalf("multi-statement Execute: %v", err)
	}
	if len(multiRes.Results) != 3 {
		t.Fatalf("expected 3 statement results, got %d", len(multiRes.Results))
	}
	if len(multiRes.Rows) != 1 || multiRes.Rows[0][0] != "ai" {
		t.Fatalf("expected facet result on final statement, got %+v", multiRes)
	}

	// 6. Batched ApplyChanges + payload key deletion
	affected, err := drv.ApplyChanges(ctx, "default", "default", "docs.v1", []driver.RowChange{
		{Type: "insert", Changes: map[string]any{"id": 10, "title": "a"}},
		{Type: "insert", Changes: map[string]any{"id": 11, "title": "b"}},
		{Type: "update", PrimaryKey: map[string]any{"id": 10}, Changes: map[string]any{"old_key": nil}},
		{Type: "delete", PrimaryKey: map[string]any{"id": 12}},
		{Type: "delete", PrimaryKey: map[string]any{"id": 13}},
	})
	if err != nil || affected != 5 {
		t.Fatalf("ApplyChanges batched failed: affected=%d, err=%v", affected, err)
	}
	if putPointsCalls != 1 || deletePointsCalls != 1 || deletePayloadKeysCalls != 1 {
		t.Fatalf("expected 1 batched put, 1 batched delete, 1 payload/delete, got put=%d del=%d keyDel=%d",
			putPointsCalls, deletePointsCalls, deletePayloadKeysCalls)
	}
}

func TestQdrantDriverPhase8Fixes(t *testing.T) {
	var scrollRequests []map[string]any
	var putCount int

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/":
			_, _ = w.Write([]byte(`{"title":"qdrant - vector search engine","version":"1.13.4"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/collections/docs/points/42":
			_, _ = w.Write([]byte(`{"result":{"id":42,"payload":{"title":"forty-two"},"vector":[0.1,0.2]},"status":"ok"}`))
		case r.Method == http.MethodPut && r.URL.Path == "/collections/docs/points":
			putCount++
			_, _ = w.Write([]byte(`{"result":{"status":"completed"},"status":"ok"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs/points/scroll":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			scrollRequests = append(scrollRequests, body)

			if ob, ok := body["order_by"].(map[string]any); ok {
				if ob["start_from"] == float64(80) {
					_, _ = w.Write([]byte(`{"result":{"points":[{"id":3,"payload":{"views":80}}]},"status":"ok"}`))
					return
				}
				_, _ = w.Write([]byte(`{"result":{"points":[{"id":1,"payload":{"views":100}},{"id":2,"payload":{"views":90}},{"id":3,"payload":{"views":80}}]},"status":"ok"}`))
				return
			}

			if body["offset"] == float64(3) || body["offset"] == "3" {
				_, _ = w.Write([]byte(`{"result":{"points":[{"id":3,"payload":{"title":"p3"}},{"id":4,"payload":{"title":"p4"}}]},"status":"ok"}`))
				return
			}
			_, _ = w.Write([]byte(`{
				"result": {
					"points": [
						{"id": 1, "payload": {"title": "p1"}},
						{"id": 2, "payload": {"title": "p2"}},
						{"id": 3, "payload": {"title": "p3"}}
					],
					"next_page_offset": 4
				},
				"status": "ok"
			}`))
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

	// 1. ServerVersion
	ver, err := drv.ServerVersion(ctx)
	if err != nil || ver != "1.13.4" {
		t.Fatalf("expected version 1.13.4, got %q (err=%v)", ver, err)
	}

	// 2. Cursor cache hit for limit = pageSize + 1 (DataGrid pattern)
	p1, err := drv.Execute(ctx, driver.QueryRequest{SQL: `SELECT * FROM docs LIMIT 3 OFFSET 0`})
	if err != nil || len(p1.Rows) != 3 {
		t.Fatalf("page 1 failed: %+v, err=%v", p1, err)
	}
	p2, err := drv.Execute(ctx, driver.QueryRequest{SQL: `SELECT * FROM docs LIMIT 3 OFFSET 2`})
	if err != nil || len(p2.Rows) != 2 {
		t.Fatalf("page 2 failed: %+v, err=%v", p2, err)
	}
	// Should be only 2 scroll requests total (page 2 hit cached cursor id=3 directly without advancing!)
	if len(scrollRequests) != 2 || scrollRequests[1]["offset"] != float64(3) {
		t.Fatalf("expected 2 scroll requests with cached offset=3, got %#v", scrollRequests)
	}

	// 3. Cursor cache invalidation after ApplyChanges
	_, err = drv.ApplyChanges(ctx, "default", "default", "docs", []driver.RowChange{
		{Type: "insert", Changes: map[string]any{"id": 99, "title": "new"}},
	})
	if err != nil || putCount != 1 {
		t.Fatalf("ApplyChanges failed: %v", err)
	}
	if _, cached := drv.getCursor("docs|||", 2); cached != nil {
		t.Fatalf("expected cursor cache for docs to be invalidated after ApplyChanges")
	}

	// 4. ORDER BY + start_from pagination
	scrollRequests = nil
	ob1, err := drv.Execute(ctx, driver.QueryRequest{SQL: `SELECT * FROM docs ORDER BY views DESC LIMIT 2 OFFSET 0`})
	if err != nil || !ob1.HasMore || len(ob1.Rows) != 2 {
		t.Fatalf("ORDER BY page 1 failed: %+v, err=%v", ob1, err)
	}
	ob2, err := drv.Execute(ctx, driver.QueryRequest{SQL: `SELECT * FROM docs ORDER BY views DESC LIMIT 2 OFFSET 2`})
	if err != nil || ob2.HasMore || len(ob2.Rows) != 1 {
		t.Fatalf("ORDER BY page 2 failed: %+v, err=%v", ob2, err)
	}

	// 5. Nested parentheses (A OR B) AND C
	fNested, err := parseSimpleWhereToFilter(`(category = 'ai' OR category = 'ml') AND views >= 10`)
	if err != nil {
		t.Fatalf("nested parens WHERE failed: %v", err)
	}
	bNested, _ := json.Marshal(fNested)
	if !strings.Contains(string(bNested), `"should"`) || !strings.Contains(string(bNested), `"gte":10`) {
		t.Fatalf("unexpected nested filter JSON: %s", string(bNested))
	}

	// 6. Single point GET /collections/docs/points/42
	ptRes, err := drv.Execute(ctx, driver.QueryRequest{SQL: `GET /collections/docs/points/42`})
	if err != nil || len(ptRes.Rows) != 1 || !ptRes.IsEditable || ptRes.Rows[0][0] != int64(42) {
		t.Fatalf("single point GET parse failed: %+v, err=%v", ptRes, err)
	}
}

func TestQdrantSnapshotNotSwallowed_Uint64_And_WhereEnhancements(t *testing.T) {
	var deletedVecPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/snapshots":
			_, _ = w.Write([]byte(`{"result":[{"name":"full-snap-1.snapshot","size":2048}],"status":"ok"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs/points/query/batch":
			_, _ = w.Write([]byte(`{"result":[{"points":[{"id":9007199254740993,"score":0.95,"payload":{"meta":{"author":"alice"}}}]}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/collections/docs/points/vectors/delete":
			deletedVecPath = r.URL.Path
			_, _ = w.Write([]byte(`{"result":{"status":"completed"}}`))
		default:
			_, _ = w.Write([]byte(`{"result":{"status":"ok"}}`))
		}
	}))
	defer srv.Close()

	drv, err := NewQdrantDriver(srv.URL, "", nil)
	if err != nil {
		t.Fatalf("NewQdrantDriver: %v", err)
	}
	defer drv.Close()
	ctx := context.Background()

	// 1. Snapshots must return raw JSON in `response` column, not be swallowed by []qdrantPoint
	snapRes, err := drv.Execute(ctx, driver.QueryRequest{SQL: `GET /snapshots`})
	if err != nil {
		t.Fatalf("GET /snapshots failed: %v", err)
	}
	if len(snapRes.Columns) != 1 || snapRes.Columns[0].Name != "response" {
		t.Fatalf("expected raw response column for /snapshots, got %+v", snapRes.Columns)
	}

	// 2. query/batch + uint64 > 2^53 preservation
	batchRes, err := drv.Execute(ctx, driver.QueryRequest{SQL: `POST /collections/docs/points/query/batch` + "\n" + `{"searches":[]}`})
	if err != nil || len(batchRes.Rows) != 1 {
		t.Fatalf("query/batch failed: %+v, err=%v", batchRes, err)
	}
	if batchRes.Rows[0][0] != "9007199254740993" {
		t.Fatalf("expected exact uint64 string '9007199254740993', got %#v", batchRes.Rows[0][0])
	}

	// 3. parsePointID preserves uint64 > MaxInt64
	if got := parsePointID("9007199254740993"); got != uint64(9007199254740993) {
		t.Fatalf("expected uint64(9007199254740993), got %#v (%T)", got, got)
	}

	// 4. Balanced outer parens, float equality via range, and IS EMPTY
	fBal, err := parseSimpleWhereToFilter(`(a = 1) AND (b = 2)`)
	if err != nil || len(fBal["must"].([]map[string]any)) != 2 {
		t.Fatalf("balanced parens failed: %+v, err=%v", fBal, err)
	}
	fFloat, err := parseSimpleWhereToFilter(`score_val = 0.5 AND tags IS EMPTY`)
	if err != nil {
		t.Fatalf("float/empty WHERE failed: %v", err)
	}
	bFloat, _ := json.Marshal(fFloat)
	if !strings.Contains(string(bFloat), `"range":{"gte":0.5,"lte":0.5}`) || !strings.Contains(string(bFloat), `"is_empty":{"key":"tags"}`) {
		t.Fatalf("unexpected float/empty filter JSON: %s", string(bFloat))
	}

	// 5. Deleting a named vector via nil change routes to /points/vectors/delete
	_, err = drv.ApplyChanges(ctx, "default", "default", "docs", []driver.RowChange{
		{Type: "update", PrimaryKey: map[string]any{"id": "1"}, Changes: map[string]any{"vector.bm25": nil}},
	})
	if err != nil || deletedVecPath != "/collections/docs/points/vectors/delete" {
		t.Fatalf("expected /points/vectors/delete call, got %q, err=%v", deletedVecPath, err)
	}
}
