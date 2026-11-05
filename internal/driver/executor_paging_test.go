package driver

import "testing"

func TestWrapSelectForPaging(t *testing.T) {
	cases := []struct {
		name   string
		sql    string
		limit  int
		offset int
		wantOK bool
		want   string
	}{
		{"plain select", "SELECT * FROM users;", 100, 200, true,
			"SELECT * FROM (SELECT * FROM users) AS dhub_page LIMIT 101 OFFSET 200"},
		{"no offset needs no wrap", "SELECT * FROM users", 100, 0, false, ""},
		{"already has limit", "SELECT * FROM users LIMIT 10", 100, 50, false, ""},
		{"already has offset", "SELECT * FROM users OFFSET 5", 100, 50, false, ""},
		{"cte not wrapped", "WITH a AS (SELECT 1) SELECT * FROM a", 100, 50, false, ""},
		{"show not wrapped", "SHOW TABLES", 100, 50, false, ""},
		{"line comment not wrapped", "SELECT * FROM users -- c", 100, 50, false, ""},
		{"select into not wrapped", "SELECT * INTO t2 FROM t1", 100, 50, false, ""},
		{"invalid limit", "SELECT 1", 0, 50, false, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := wrapSelectForPaging(tc.sql, tc.limit, tc.offset)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if ok && got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

