package redis

import (
	"reflect"
	"testing"

	"dhub/internal/driver"
)

func TestParseRedisCommandArgs(t *testing.T) {
	tests := []struct {
		input    string
		expected []any
	}{
		{
			input:    "PING",
			expected: []any{"PING"},
		},
		{
			input:    `SET "my key" "hello world"`,
			expected: []any{"SET", "my key", "hello world"},
		},
		{
			input:    `HSET user:1 name 'John Doe' age 30`,
			expected: []any{"HSET", "user:1", "name", "John Doe", "age", "30"},
		},
		{
			input:    `KEYS *`,
			expected: []any{"KEYS", "*"},
		},
	}

	for _, tt := range tests {
		actual := ParseRedisCommandArgs(tt.input)
		if !reflect.DeepEqual(actual, tt.expected) {
			t.Errorf("ParseRedisCommandArgs(%q) = %v, expected %v", tt.input, actual, tt.expected)
		}
	}
}

func TestSplitRedisStatements(t *testing.T) {
	input := `# Comment line
-- Another comment
SET foo 1; GET foo

# End comment
KEYS *`

	expected := []string{"SET foo 1", "GET foo", "KEYS *"}
	actual := splitRedisStatements(input)

	if !reflect.DeepEqual(actual, expected) {
		t.Errorf("splitRedisStatements() = %v, expected %v", actual, expected)
	}
}

func TestExtractKeyName(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{input: `"users"`, expected: "users"},
		{input: "`db0`.`users`", expected: "users"},
		{input: `"db0"."my_key"`, expected: "my_key"},
		{input: "users", expected: "users"},
	}

	for _, tt := range tests {
		actual := extractKeyName(tt.input)
		if actual != tt.expected {
			t.Errorf("extractKeyName(%q) = %q, expected %q", tt.input, actual, tt.expected)
		}
	}
}

func TestGenerateDMLPreview(t *testing.T) {
	r := &RedisDriver{}
	changes := []driver.RowChange{
		{
			Type: "insert",
			Changes: map[string]any{
				"value": "bar",
			},
		},
		{
			Type: "delete",
			PrimaryKey: map[string]any{
				"field": "age",
			},
		},
	}

	stmts, err := r.GenerateDMLPreview("db0", "db0", "mykey", changes)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(stmts) != 2 {
		t.Fatalf("expected 2 statements, got %d", len(stmts))
	}
	if stmts[0] != `SET mykey "bar"` {
		t.Errorf("expected SET mykey \"bar\", got %q", stmts[0])
	}
	if stmts[1] != `HDEL mykey age` {
		t.Errorf("expected HDEL mykey age, got %q", stmts[1])
	}
}

func TestRedisTTLHandling(t *testing.T) {
	// 1. parseRedisTTL test
	dur, isPersist, err := parseRedisTTL("no ttl")
	if err != nil || !isPersist {
		t.Errorf("parseRedisTTL('no ttl') error = %v, isPersist = %v", err, isPersist)
	}

	dur, isPersist, err = parseRedisTTL("60")
	if err != nil || isPersist || dur.Seconds() != 60 {
		t.Errorf("parseRedisTTL('60') dur = %v, want 60s", dur)
	}

	dur, isPersist, err = parseRedisTTL("1h")
	if err != nil || isPersist || dur.Hours() != 1 {
		t.Errorf("parseRedisTTL('1h') dur = %v, want 1h", dur)
	}

	dur, isPersist, err = parseRedisTTL("2d")
	if err != nil || isPersist || dur.Hours() != 48 {
		t.Errorf("parseRedisTTL('2d') dur = %v, want 48h", dur)
	}

	// 2. GenerateDMLPreview with TTL
	r := &RedisDriver{}
	changes := []driver.RowChange{
		{
			Type: "update",
			PrimaryKey: map[string]any{
				"key": "user_session",
			},
			Changes: map[string]any{
				"ttl": "3600",
			},
		},
		{
			Type: "update",
			PrimaryKey: map[string]any{
				"key": "persistent_key",
			},
			Changes: map[string]any{
				"ttl": "no ttl",
			},
		},
	}

	stmts, err := r.GenerateDMLPreview("db0", "db0", "keys", changes)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(stmts) != 2 {
		t.Fatalf("expected 2 stmts, got %d", len(stmts))
	}
	if stmts[0] != "EXPIRE user_session 3600" {
		t.Errorf("expected 'EXPIRE user_session 3600', got %q", stmts[0])
	}
	if stmts[1] != "PERSIST persistent_key" {
		t.Errorf("expected 'PERSIST persistent_key', got %q", stmts[1])
	}
}

