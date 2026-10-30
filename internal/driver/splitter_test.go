package driver

import (
	"reflect"
	"testing"
)

func TestSplitStatements(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected []string
	}{
		{
			name:     "Single statement without semicolon",
			input:    "SELECT * FROM users",
			expected: []string{"SELECT * FROM users"},
		},
		{
			name:     "Two statements separated by semicolon",
			input:    "SELECT * FROM a; SELECT * FROM b;",
			expected: []string{"SELECT * FROM a", "SELECT * FROM b"},
		},
		{
			name:     "Semicolon inside single quotes",
			input:    "INSERT INTO t VALUES ('semi;colon'); SELECT 1;",
			expected: []string{"INSERT INTO t VALUES ('semi;colon')", "SELECT 1"},
		},
		{
			name:     "Semicolon inside comments",
			input:    "-- line comment with ; inside\nSELECT 1;\n/* block ; comment */ SELECT 2;",
			expected: []string{"-- line comment with ; inside\nSELECT 1", "/* block ; comment */ SELECT 2"},
		},
		{
			name:     "Semicolon inside backticks",
			input:    "SELECT `col;name` FROM t; SELECT 2;",
			expected: []string{"SELECT `col;name` FROM t", "SELECT 2"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SplitStatements(tt.input)
			if !reflect.DeepEqual(got, tt.expected) {
				t.Errorf("SplitStatements() = %#v, want %#v", got, tt.expected)
			}
		})
	}
}

