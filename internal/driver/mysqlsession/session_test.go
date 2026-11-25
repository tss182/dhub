package mysqlsession

import "testing"

func TestExtractUseDatabase(t *testing.T) {
	cases := []struct {
		stmt string
		want string
	}{
		{"USE mydb;", "mydb"},
		{"use  test_db ", "test_db"},
		{"/* comment */ USE `my``db`;", "my`db"},
		{`USE "quoted_db"`, "quoted_db"},
		{"SELECT 1", ""},
	}
	for _, tc := range cases {
		if got := extractUseDatabase(tc.stmt); got != tc.want {
			t.Errorf("extractUseDatabase(%q) = %q, want %q", tc.stmt, got, tc.want)
		}
	}
}
