package mariadb

import (
	"testing"

	"dhub/internal/driver"
)

func TestNormalizeMariaDBValue_KeepsUserText(t *testing.T) {
	for _, in := range []string{"null", "NULL", "<null>", "2026-11-05T12:30:00+07:00"} {
		if got := normalizeMariaDBValue(in); got != in {
			t.Errorf("normalizeMariaDBValue(%q) = %v, want it unchanged", in, got)
		}
	}
}

func TestFormatSQLVal_EscapesLikeMariaDB(t *testing.T) {
	cases := []struct {
		in   any
		want string
	}{
		{"C:\\temp\\", `'C:\\temp\\'`},
		{"it's", `'it\'s'`},
		{"a\nb", `'a\nb'`},
		{[]byte{0xde, 0xad}, "X'DEAD'"},
		{true, "1"},
		{nil, "NULL"},
		{"null", `'null'`},
	}
	for _, tc := range cases {
		if got := formatSQLVal(tc.in); got != tc.want {
			t.Errorf("formatSQLVal(%#v) = %s, want %s", tc.in, got, tc.want)
		}
	}
}

func TestGenerateDMLPreview_NullTextPrimaryKey(t *testing.T) {
	d := &MariaDBDriver{}
	stmts, err := d.GenerateDMLPreview("db", "", "t", []driver.RowChange{
		{Type: "delete", PrimaryKey: map[string]any{"code": "null"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if want := "DELETE FROM `db`.`t` WHERE `code` = 'null';"; stmts[0] != want {
		t.Errorf("got %s, want %s", stmts[0], want)
	}
}
