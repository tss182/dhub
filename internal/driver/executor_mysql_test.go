package driver

import "testing"

func TestWrapSelectForPaging_MySQLFamily(t *testing.T) {
	cases := []struct {
		name    string
		sql     string
		limit   int
		offset  int
		wantOK  bool
		want    string
		dialect string
	}{
		{"first page is pushed down", "SELECT * FROM t;", 100, 0, true, "SELECT * FROM t LIMIT 101", "mysql"},
		{"first page (mariadb)", "SELECT * FROM t", 100, 0, true, "SELECT * FROM t LIMIT 101", "mariadb"},
		{"offset appended, no derived table", "SELECT a.id, b.id FROM a JOIN b ON 1=1", 50, 100, true,
			"SELECT a.id, b.id FROM a JOIN b ON 1=1 LIMIT 51 OFFSET 100", "mysql"},
		{"cte select", "WITH x AS (SELECT 1 AS id) SELECT * FROM x", 10, 0, true,
			"WITH x AS (SELECT 1 AS id) SELECT * FROM x LIMIT 11", "mysql"},
		{"subquery limit does not block", "SELECT * FROM (SELECT id FROM t LIMIT 5) x", 10, 0, true,
			"SELECT * FROM (SELECT id FROM t LIMIT 5) x LIMIT 11", "mysql"},
		{"union", "SELECT 1 UNION SELECT 2", 10, 0, true, "SELECT 1 UNION SELECT 2 LIMIT 11", "mysql"},
		{"string containing LIMIT", "SELECT ' LIMIT 5' AS s FROM t", 10, 0, true,
			"SELECT ' LIMIT 5' AS s FROM t LIMIT 11", "mysql"},
		{"top-level limit", "SELECT * FROM t LIMIT 10", 100, 0, false, "", "mysql"},
		{"top-level limit offset", "SELECT * FROM t LIMIT 10 OFFSET 5", 100, 0, false, "", "mysql"},
		{"for update", "SELECT * FROM t FOR UPDATE", 100, 0, false, "", "mysql"},
		{"lock in share mode", "SELECT * FROM t LOCK IN SHARE MODE", 100, 0, false, "", "mysql"},
		{"into outfile", "SELECT * FROM t INTO OUTFILE '/tmp/x'", 100, 0, false, "", "mysql"},
		{"trailing line comment", "SELECT * FROM t -- c", 100, 0, false, "", "mysql"},
		{"show is untouched", "SHOW TABLES", 100, 0, false, "", "mysql"},
		{"returning is untouched", "INSERT INTO t VALUES (1) RETURNING id", 100, 0, false, "", "mariadb"},
		{"delete returning is untouched", "DELETE FROM t RETURNING id", 100, 0, false, "", "mariadb"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := wrapSelectForPaging(tc.sql, tc.limit, tc.offset, tc.dialect)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v (got %q)", ok, tc.wantOK, got)
			}
			if ok && got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestNormalizeScannedValue_MySQLBigInt(t *testing.T) {
	const big = int64(9007199254740993) // 2^53 + 1
	cases := []struct {
		name    string
		in      any
		want    any
		dialect string
	}{
		{"int64 above 2^53", big, "9007199254740993", "mysql"},
		{"int64 above 2^53 (mariadb)", big, "9007199254740993", "mariadb"},
		{"negative int64 below -2^53", -big, "-9007199254740993", "mysql"},
		{"uint64 max", uint64(18446744073709551615), "18446744073709551615", "mysql"},
		{"safe int64 stays a number", int64(42), int64(42), "mysql"},
		{"safe uint64 stays a number", uint64(42), uint64(42), "mysql"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeScannedValue(tc.in, "BIGINT", tc.dialect)
			if got != tc.want {
				t.Fatalf("got %#v, want %#v", got, tc.want)
			}
		})
	}
}

func TestNormalizeScannedValue_MySQLBinaryAndBit(t *testing.T) {
	cases := []struct {
		name     string
		typeName string
		in       []byte
		want     any
	}{
		{"binary uuid", "BINARY", []byte{0xde, 0xad, 0xbe, 0xef}, "0xdeadbeef"},
		{"varbinary", "VARBINARY", []byte{0x00, 0x01}, "0x0001"},
		{"blob", "BLOB", []byte{0xff}, "0xff"},
		{"bit(1)", "BIT", []byte{0x01}, uint64(1)},
		{"varchar stays text", "VARCHAR", []byte("héllo"), "héllo"},
		{"json stays text", "JSON", []byte(`{"a":1}`), `{"a":1}`},
	}
	for _, tc := range cases {
		for _, dialect := range []string{"mysql", "mariadb"} {
			if got := normalizeScannedValue(tc.in, tc.typeName, dialect); got != tc.want {
				t.Errorf("%s/%s: got %#v, want %#v", tc.name, dialect, got, tc.want)
			}
		}
	}
	// Other dialects keep returning the raw string.
	if got := normalizeScannedValue([]byte{0x41}, "BINARY", "sqlite"); got != "A" {
		t.Errorf("sqlite changed: %#v", got)
	}
}
