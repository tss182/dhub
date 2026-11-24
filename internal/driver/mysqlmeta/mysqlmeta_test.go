package mysqlmeta

import (
	"bytes"
	"testing"
)

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

func TestFormatRead(t *testing.T) {
	if v, ok := FormatRead("BINARY", []byte{0x01, 0xab}); !ok || v != "0x01ab" {
		t.Errorf("BINARY = %v, %v", v, ok)
	}
	if v, ok := FormatRead("blob", nil); !ok || v != "0x" {
		t.Errorf("empty blob = %v, %v", v, ok)
	}
	if v, ok := FormatRead("BIT", []byte{0x01}); !ok || v != uint64(1) {
		t.Errorf("BIT(1) = %#v, %v", v, ok)
	}
	if v, ok := FormatRead("BIT", []byte{0x01, 0x00}); !ok || v != uint64(256) {
		t.Errorf("BIT(16) = %#v, %v", v, ok)
	}
	if v, ok := FormatRead("BIT", []byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}); !ok || v != "18446744073709551615" {
		t.Errorf("BIT(64) = %#v, %v", v, ok)
	}
	for _, typ := range []string{"VARCHAR", "TEXT", "JSON", "DECIMAL", "DATETIME", "CHAR"} {
		if _, ok := FormatRead(typ, []byte("x")); ok {
			t.Errorf("%s must not be treated as binary", typ)
		}
	}
}

func TestConvertForWrite(t *testing.T) {
	got, err := ConvertForWrite("binary", "0x00ff")
	if err != nil || !bytes.Equal(got.([]byte), []byte{0x00, 0xff}) {
		t.Errorf("binary = %#v, %v", got, err)
	}
	if got, _ := ConvertForWrite("blob", "0x"); !bytes.Equal(got.([]byte), []byte{}) {
		t.Errorf("empty blob = %#v", got)
	}
	if _, err := ConvertForWrite("varbinary", "hello"); err == nil {
		t.Error("plain text for a binary column must be rejected")
	}
	if _, err := ConvertForWrite("binary", "0xZZ"); err == nil {
		t.Error("invalid hex must be rejected")
	}
	if got, _ := ConvertForWrite("varchar", "0x1F"); got != "0x1F" {
		t.Errorf("VARCHAR text was reinterpreted: %#v", got)
	}
	if got, _ := ConvertForWrite("bit", "5"); got != uint64(5) {
		t.Errorf("BIT string = %#v", got)
	}
	if got, _ := ConvertForWrite("bit", float64(1)); got != uint64(1) {
		t.Errorf("BIT number = %#v", got)
	}
	if got, _ := ConvertForWrite("bit", true); got != uint64(1) {
		t.Errorf("BIT bool = %#v", got)
	}
	if _, err := ConvertForWrite("bit", "abc"); err == nil {
		t.Error("non-numeric BIT must be rejected")
	}
	if got, _ := ConvertForWrite("int", "7"); got != "7" {
		t.Errorf("int passthrough = %#v", got)
	}
	if got, _ := ConvertForWrite("binary", nil); got != nil {
		t.Errorf("nil = %#v", got)
	}
}

func TestConvertRow(t *testing.T) {
	types := map[string]string{"id": "binary", "flag": "bit", "name": "varchar"}
	out, err := ConvertRow(types, map[string]any{"id": "0x0a", "flag": "1", "name": "0x0a", "extra": "x"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out["id"].([]byte), []byte{0x0a}) || out["flag"] != uint64(1) || out["name"] != "0x0a" || out["extra"] != "x" {
		t.Errorf("unexpected: %#v", out)
	}
	same, _ := ConvertRow(nil, map[string]any{"id": "0x0a"})
	if same["id"] != "0x0a" {
		t.Errorf("without type info values must pass through: %#v", same)
	}
}
