package mysqlmeta

import "testing"

func sp(s string) *string { return &s }

func TestParseExtra(t *testing.T) {
	cases := []struct {
		in   string
		want Extra
	}{
		{"", Extra{Kind: KindNormal}},
		{"auto_increment", Extra{Kind: KindNormal, AutoIncrement: true}},
		{"DEFAULT_GENERATED", Extra{Kind: KindNormal, DefaultGenerated: true}},
		{"DEFAULT_GENERATED on update CURRENT_TIMESTAMP", Extra{Kind: KindNormal, DefaultGenerated: true, OnUpdate: "CURRENT_TIMESTAMP"}},
		{"on update CURRENT_TIMESTAMP(3)", Extra{Kind: KindNormal, OnUpdate: "CURRENT_TIMESTAMP(3)"}},
		{"on update current_timestamp()", Extra{Kind: KindNormal, OnUpdate: "current_timestamp()"}},
		{"VIRTUAL GENERATED", Extra{Kind: KindVirtual}},
		{"STORED GENERATED", Extra{Kind: KindStored}},
		{"PERSISTENT", Extra{Kind: KindStored}},
		{"INVISIBLE", Extra{Kind: KindNormal, Invisible: true}},
		{"auto_increment INVISIBLE", Extra{Kind: KindNormal, AutoIncrement: true, Invisible: true}},
		{"on update CURRENT_TIMESTAMP INVISIBLE", Extra{Kind: KindNormal, OnUpdate: "CURRENT_TIMESTAMP", Invisible: true}},
	}
	for _, tc := range cases {
		if got := ParseExtra(tc.in); got != tc.want {
			t.Errorf("ParseExtra(%q) = %+v, want %+v", tc.in, got, tc.want)
		}
	}
}

func TestMySQLDefault(t *testing.T) {
	cases := []struct {
		name     string
		dflt     *string
		nullable bool
		extra    string
		want     Default
	}{
		{"nullable no default", nil, true, "", Default{Kind: DefaultNull}},
		{"not null no default", nil, false, "", Default{Kind: DefaultNone}},
		{"literal string", sp("abc"), false, "", Default{"abc", DefaultLiteral}},
		{"literal text NULL stays text", sp("NULL"), true, "", Default{"NULL", DefaultLiteral}},
		{"literal zero", sp("0"), false, "", Default{"0", DefaultLiteral}},
		{"uuid expression", sp("uuid()"), false, "DEFAULT_GENERATED", Default{"uuid()", DefaultExpression}},
		{"timestamp expression", sp("CURRENT_TIMESTAMP(3)"), false, "DEFAULT_GENERATED", Default{"CURRENT_TIMESTAMP(3)", DefaultExpression}},
	}
	for _, tc := range cases {
		if got := MySQLDefault(tc.dflt, tc.nullable, ParseExtra(tc.extra)); got != tc.want {
			t.Errorf("%s: got %+v, want %+v", tc.name, got, tc.want)
		}
	}
}

func TestMariaDBDefault(t *testing.T) {
	cases := []struct {
		name     string
		dflt     *string
		nullable bool
		want     Default
	}{
		{"nullable no default", nil, true, Default{Kind: DefaultNull}},
		{"not null no default", nil, false, Default{Kind: DefaultNone}},
		{"NULL text means null", sp("NULL"), true, Default{Kind: DefaultNull}},
		{"quoted string", sp("'abc'"), false, Default{"abc", DefaultLiteral}},
		{"quoted with doubled quote", sp("'it''s'"), false, Default{"it's", DefaultLiteral}},
		{"quoted with backslash escape", sp(`'a\\b'`), false, Default{`a\b`, DefaultLiteral}},
		{"quoted text NULL is a string", sp("'NULL'"), false, Default{"NULL", DefaultLiteral}},
		{"empty string", sp("''"), false, Default{"", DefaultLiteral}},
		{"integer", sp("0"), false, Default{"0", DefaultLiteral}},
		{"decimal", sp("1.50"), false, Default{"1.50", DefaultLiteral}},
		{"current_timestamp()", sp("current_timestamp()"), false, Default{"current_timestamp()", DefaultExpression}},
		{"CURRENT_TIMESTAMP", sp("CURRENT_TIMESTAMP"), false, Default{"CURRENT_TIMESTAMP", DefaultExpression}},
		{"function call", sp("uuid()"), false, Default{"uuid()", DefaultExpression}},
		{"legacy unquoted literal", sp("abc"), false, Default{"abc", DefaultLiteral}},
	}
	for _, tc := range cases {
		if got := MariaDBDefault(tc.dflt, tc.nullable); got != tc.want {
			t.Errorf("%s: got %+v, want %+v", tc.name, got, tc.want)
		}
	}
}
