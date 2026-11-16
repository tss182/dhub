package driver

import (
	"testing"
)

func TestWrapSelectForPagingMSSQL(t *testing.T) {
	tests := []struct {
		name    string
		stmt    string
		limit   int
		offset  int
		dialect string
		wantOK  bool
		wantSQL string
	}{
		{
			name:    "standard postgres/mysql",
			stmt:    "SELECT * FROM users;",
			limit:   50,
			offset:  100,
			dialect: "",
			wantOK:  true,
			wantSQL: "SELECT * FROM (SELECT * FROM users) AS dhub_page LIMIT 51 OFFSET 100",
		},
		{
			name:    "mssql without order by",
			stmt:    "SELECT id, name FROM users;",
			limit:   25,
			offset:  50,
			dialect: "mssql",
			wantOK:  true,
			wantSQL: "SELECT * FROM (SELECT id, name FROM users) AS dhub_page ORDER BY (SELECT NULL) OFFSET 50 ROWS FETCH NEXT 26 ROWS ONLY",
		},
		{
			name:    "mssql with order by skips wrapper",
			stmt:    "SELECT id FROM users ORDER BY id DESC",
			limit:   25,
			offset:  50,
			dialect: "mssql",
			wantOK:  false,
		},
		{
			name:    "zero offset skips wrapper",
			stmt:    "SELECT * FROM users",
			limit:   50,
			offset:  0,
			dialect: "mssql",
			wantOK:  false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gotSQL, gotOK := wrapSelectForPaging(tc.stmt, tc.limit, tc.offset, tc.dialect)
			if gotOK != tc.wantOK {
				t.Fatalf("expected ok=%v, got %v (sql=%q)", tc.wantOK, gotOK, gotSQL)
			}
			if tc.wantOK && gotSQL != tc.wantSQL {
				t.Fatalf("expected sql %q, got %q", tc.wantSQL, gotSQL)
			}
		})
	}
}
