package mysqlschema

import (
	"database/sql"
	"reflect"
	"testing"
)

func ns(s string) sql.NullString { return sql.NullString{String: s, Valid: true} }
func ni(n int64) sql.NullInt64   { return sql.NullInt64{Int64: n, Valid: true} }

func TestBuildIndexes(t *testing.T) {
	rows := []IndexRow{
		{Name: "PRIMARY", NonUnique: 0, Column: ns("id"), Seq: 1, Type: "BTREE", Collation: ns("A"), Visible: ns("YES")},
		{Name: "idx_name", NonUnique: 1, Column: ns("name"), Seq: 1, Type: "BTREE", SubPart: ni(10), Collation: ns("A"), Visible: ns("YES")},
		{Name: "idx_name", NonUnique: 1, Column: ns("created"), Seq: 2, Type: "BTREE", Collation: ns("D"), Visible: ns("YES")},
		{Name: "idx_fn", NonUnique: 1, Seq: 1, Type: "BTREE", Expression: ns("lower(`email`)"), Visible: ns("NO")},
		{Name: "mdb_ignored", NonUnique: 1, Column: ns("a"), Seq: 1, Type: "BTREE", Ignored: ns("YES")},
	}
	got := BuildIndexes(rows)
	if len(got) != 4 {
		t.Fatalf("got %d indexes, want 4", len(got))
	}
	pk := got[0]
	if !pk.IsPrimary || !pk.IsUnique || pk.SubParts != nil || pk.Descending != nil {
		t.Errorf("primary key = %+v", pk)
	}
	composite := got[1]
	if !reflect.DeepEqual(composite.Columns, []string{"name", "created"}) ||
		!reflect.DeepEqual(composite.SubParts, []int{10, 0}) ||
		!reflect.DeepEqual(composite.Descending, []bool{false, true}) {
		t.Errorf("composite = %+v", composite)
	}
	fn := got[2]
	if len(fn.Columns) != 1 || fn.Columns[0] != "(lower(`email`))" || fn.Expression != "lower(`email`)" {
		t.Errorf("functional index lost its expression: %+v", fn)
	}
	if fn.IsVisible == nil || *fn.IsVisible {
		t.Errorf("invisible index reported visible: %+v", fn.IsVisible)
	}
	if got[3].IsVisible == nil || *got[3].IsVisible {
		t.Errorf("mariadb ignored index must report not visible")
	}
	if composite.IsVisible == nil || !*composite.IsVisible {
		t.Errorf("visible index must report visible")
	}
}

func TestBuildForeignKeys(t *testing.T) {
	rows := []FKRow{
		{"fk_single", "user_id", "db", "users", "id", "CASCADE", "RESTRICT"},
		{"fk_comp", "a", "db", "parent", "x", "NO ACTION", "NO ACTION"},
		{"fk_comp", "b", "db", "parent", "y", "NO ACTION", "NO ACTION"},
	}
	got := BuildForeignKeys(rows)
	if len(got) != 2 {
		t.Fatalf("got %d foreign keys, want 2 (one per constraint)", len(got))
	}
	if got[0].Columns != nil || got[0].ColumnName != "user_id" || got[0].OnUpdate != "CASCADE" {
		t.Errorf("single = %+v", got[0])
	}
	c := got[1]
	if c.ColumnName != "a" || c.RefColumn != "x" ||
		!reflect.DeepEqual(c.Columns, []string{"a", "b"}) || !reflect.DeepEqual(c.RefColumns, []string{"x", "y"}) {
		t.Errorf("composite = %+v", c)
	}
}
