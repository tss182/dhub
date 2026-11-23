package driver

import (
	"strings"
	"testing"
)

func TestQdrantReadOnlyFragmentBypassAndSplitter(t *testing.T) {
	blocked := []string{
		"POST /collections/prod/points/delete#/points\n{\"filter\":{}}",
		"POST /locks#/_search\n{\"write\":true}",
		"POST /collections/aliases#/_count\n{\"actions\":[]}",
		"DELETE /collections/prod",
		"// leading comment\nDELETE /collections/prod",
	}
	for _, cmd := range blocked {
		if IsReadOnlySafeQuery(cmd) {
			t.Fatalf("expected command to be blocked in read-only mode: %q", cmd)
		}
	}

	allowed := []string{
		"POST /collections/docs/points/scroll/\n{\"limit\":10}",
		"// comment\nPOST /collections/docs/points/count\n{\"exact\":true}",
		"GET /snapshots",
	}
	for _, cmd := range allowed {
		if !IsReadOnlySafeQuery(cmd) {
			t.Fatalf("expected command to be allowed in read-only mode: %q", cmd)
		}
	}

	script := "POST /collections/docs/points/count\n{\"exact\":true}\n-- Don't break on { apostrophes\nPOST /collections/docs/points/search\n{\"vector\":[0.1,0.2],\"limit\":5}"
	stmts := SplitHTTPOrSQLStatements(script)
	if len(stmts) != 2 {
		t.Fatalf("expected 2 statements, got %d: %#v", len(stmts), stmts)
	}
	if strings.Contains(stmts[0], "-- Don't") {
		t.Fatalf("trailing comment leaked into preceding REST JSON body: %q", stmts[0])
	}
}
