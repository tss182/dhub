package driver

import (
	"reflect"
	"testing"
)

// readOnlyAllows mirrors the read-only gate in QueryService.ExecuteQuery:
// every statement produced by the dialect-aware splitter must be read-only safe.
func readOnlyAllows(sql, dialect string) bool {
	for _, stmt := range SplitStatementsForDialect(sql, dialect) {
		if !IsReadOnlySafeQuery(stmt) {
			return false
		}
	}
	return true
}

func TestSplitStatementsForDialect_MySQLComments(t *testing.T) {
	cases := []struct {
		name    string
		sql     string
		dialect string
		want    []string
	}{
		// In MySQL "--" starts a comment only when followed by whitespace/control/EOF.
		{"dash dash digit is not a comment", "SELECT 1 --1;DROP TABLE t", "mysql",
			[]string{"SELECT 1 --1", "DROP TABLE t"}},
		{"dash dash digit is not a comment (mariadb)", "SELECT 1 --1;DROP TABLE t", "mariadb",
			[]string{"SELECT 1 --1", "DROP TABLE t"}},
		{"dash dash space is a comment", "SELECT 1 -- x;y\nFROM t", "mysql",
			[]string{"SELECT 1 -- x;y\nFROM t"}},
		{"dash dash tab is a comment", "SELECT 1 --\tx;y\nFROM t", "mysql",
			[]string{"SELECT 1 --\tx;y\nFROM t"}},
		{"dash dash at EOF is a comment", "SELECT 1 --", "mysql",
			[]string{"SELECT 1 --"}},
		{"string containing dashes", "SELECT '--' ; DELETE FROM t", "mysql",
			[]string{"SELECT '--'", "DELETE FROM t"}},
		// Executable comments run as SQL, so a ';' inside them splits a statement.
		{"executable comment splits", "SELECT 1 /*!; DROP TABLE t */", "mysql",
			[]string{"SELECT 1 /*!", "DROP TABLE t */"}},
		{"mariadb executable comment splits", "SELECT 1 /*M!100100; DROP TABLE t */", "mariadb",
			[]string{"SELECT 1 /*M!100100", "DROP TABLE t */"}},
		{"plain block comment keeps semicolon", "SELECT 1 /* a;b */", "mysql",
			[]string{"SELECT 1 /* a;b */"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := SplitStatementsForDialect(tc.sql, tc.dialect)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("SplitStatementsForDialect(%q, %q)\n got  %q\n want %q", tc.sql, tc.dialect, got, tc.want)
			}
		})
	}
}

func TestReadOnlyBypass_MySQLFamily(t *testing.T) {
	blocked := []struct{ sql, dialect string }{
		{"SELECT 1 --1;DROP TABLE t", "mysql"},
		{"SELECT 1 --1;DROP TABLE t", "mariadb"},
		{"SELECT 1 /*!; DROP TABLE t */", "mysql"},
		{"SELECT * FROM t /*! INTO OUTFILE '/tmp/x' */", "mysql"},
		{"SELECT * FROM t /*!50700 INTO OUTFILE '/tmp/x' */", "mysql"},
		{"SELECT * FROM t /*M! INTO OUTFILE '/tmp/x' */", "mariadb"},
		{"SELECT 1 /*M!100100; DROP TABLE t */", "mariadb"},
		{"SELECT '--' ; DELETE FROM t", "mysql"},
	}
	for _, tc := range blocked {
		if readOnlyAllows(tc.sql, tc.dialect) {
			t.Errorf("read-only gate allowed %q (dialect %s), want blocked", tc.sql, tc.dialect)
		}
	}

	allowed := []struct{ sql, dialect string }{
		{"SELECT 1", "mysql"},
		{"SELECT 1 -- trailing comment", "mysql"},
		{"SELECT 1 /* plain comment */", "mysql"},
		{"SELECT /*+ MAX_EXECUTION_TIME(1000) */ 1", "mysql"},
		{"SELECT '--', 'a;b' FROM t", "mysql"},
		{"SHOW TABLES", "mariadb"},
	}
	for _, tc := range allowed {
		if !readOnlyAllows(tc.sql, tc.dialect) {
			t.Errorf("read-only gate blocked %q (dialect %s), want allowed", tc.sql, tc.dialect)
		}
	}
}
