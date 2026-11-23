package services

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestQdrantExportImportAndDDLHelpers(t *testing.T) {
	// 1. flattenQdrantPointRecord protects id/vector from payload collisions and handles mixed "" + named vectors
	flat := flattenQdrantPointRecord(map[string]any{
		"id": "uuid-123",
		"vector": map[string]any{
			"":     []any{0.1, 0.2},
			"bm25": map[string]any{"indices": []any{1, 2}, "values": []any{0.5, 0.8}},
		},
		"payload": map[string]any{
			"id":       "payload-id-should-not-overwrite",
			"category": "docs",
		},
	})
	if flat["id"] != "uuid-123" || flat["category"] != "docs" || flat["vector"] == nil || flat["vector.bm25"] == nil {
		t.Fatalf("unexpected flattened Qdrant point: %+v", flat)
	}

	// 2. extractWrappedJSONObjects handles two-level Qdrant result.points wrapper
	wrapped := map[string]any{
		"result": map[string]any{
			"points": []any{
				map[string]any{"id": json.Number("1"), "payload": map[string]any{"k": "v"}},
			},
		},
	}
	objs := extractWrappedJSONObjects(wrapped, 10)
	if len(objs) != 1 || objs[0]["id"] != json.Number("1") {
		t.Fatalf("expected 1 extracted object from result.points, got %+v", objs)
	}

	// 3. buildQdrantCollectionMigration preserves sharding_method and payload_schema params
	ddl := `{"result":{"config":{"params":{"vectors":{"size":1536,"distance":"Cosine"},"sharding_method":"custom"}},"payload_schema":{"title":{"data_type":"text","params":{"type":"text","tokenizer":"word"}}}}}`
	mig := buildQdrantCollectionMigration("docs", ddl)
	if !strings.Contains(mig, `"sharding_method": "custom"`) || !strings.Contains(mig, `"tokenizer":"word"`) {
		t.Fatalf("unexpected Qdrant collection migration: %s", mig)
	}

	// 4. getBackupToolCandidates does not return "qdrant" binary name
	primary, candidates, _ := getBackupToolCandidates("qdrant", "backup", "")
	if primary != "" || len(candidates) != 0 {
		t.Fatalf("expected empty CLI tool candidates for qdrant, got primary=%q candidates=%v", primary, candidates)
	}
}
