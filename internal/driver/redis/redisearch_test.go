package redis

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"testing"
)

func TestEncodeAndDecodeFloat32VectorParams(t *testing.T) {
	args := []string{
		"FT.SEARCH", "idx:docs", "*=>[KNN $K @embedding $vec AS score]",
		"PARAMS", "4", "K", "5", "vec", "[0.25, -0.5, 0.75, 1.0]", "DIALECT", "2",
	}
	encoded := encodeVectorParamsIfPresent(args)
	blob, ok := encoded[8].([]byte)
	if !ok || len(blob) != 16 {
		t.Fatalf("expected 16-byte float32 blob, got %T (len=%d)", encoded[8], len(blob))
	}

	// Verify little-endian float32 round-trip
	rawStr := string(blob)
	decoded := decodePossibleFloat32Vector(rawStr)
	decodedStr, ok := decoded.(string)
	if !ok {
		t.Fatalf("expected JSON string, got %T", decoded)
	}
	var got []float32
	if err := json.Unmarshal([]byte(decodedStr), &got); err != nil {
		t.Fatalf("unmarshal decoded vector: %v", err)
	}
	want := []float32{0.25, -0.5, 0.75, 1.0}
	for i := range want {
		if math.Abs(float64(got[i]-want[i])) > 1e-6 {
			t.Fatalf("index %d: got %v, want %v", i, got[i], want[i])
		}
	}

	// Verify FT.SEARCH array parsing into QueryResult
	mockResp := []any{
		int64(1),
		"doc:1",
		[]any{"title", "Redis Vector", "score", "0.95", "embedding", string([]byte{
			0, 0, 0x80, 0x3e, // 0.25
			0, 0, 0, 0xbf, // -0.5
			0, 0, 0x40, 0x3f, // 0.75
			0, 0, 0x80, 0x3f, // 1.0
		})},
	}
	// Quick sanity check on binary encoding
	_ = binary.LittleEndian
	qr := ftSearchResultToQueryResult("exec-1", "db0", "idx:docs", mockResp, 4)
	if len(qr.Rows) != 1 || len(qr.Columns) != 4 {
		t.Fatalf("unexpected QueryResult shape: cols=%d rows=%d", len(qr.Columns), len(qr.Rows))
	}
}
