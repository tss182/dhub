package oracle

import (
	"database/sql"
	"strings"
	"testing"

	"dhub/internal/driver"
)

func TestQuoteIdentAndQualifiedName(t *testing.T) {
	if got := quoteIdent(`EMPLOYEES`); got != `"EMPLOYEES"` {
		t.Fatalf("quoteIdent = %q, want %q", got, `"EMPLOYEES"`)
	}
	if got := quoteIdent(`weird"name`); got != `"weird""name"` {
		t.Fatalf("quoteIdent escape = %q, want %q", got, `"weird""name"`)
	}
	if got := qualifiedName("HR", "EMPLOYEES"); got != `"HR"."EMPLOYEES"` {
		t.Fatalf("qualifiedName = %q, want %q", got, `"HR"."EMPLOYEES"`)
	}
	if got := qualifiedName("", "EMPLOYEES"); got != `"EMPLOYEES"` {
		t.Fatalf("qualifiedName no schema = %q, want %q", got, `"EMPLOYEES"`)
	}
}

func TestFormatOracleType(t *testing.T) {
	tests := []struct {
		name     string
		dataType string
		dataLen  sql.NullInt64
		charLen  sql.NullInt64
		numPrec  sql.NullInt64
		numScale sql.NullInt64
		want     string
	}{
		{
			name:     "varchar2",
			dataType: "VARCHAR2",
			charLen:  sql.NullInt64{Int64: 100, Valid: true},
			want:     "VARCHAR2(100)",
		},
		{
			name:     "number_with_scale",
			dataType: "NUMBER",
			numPrec:  sql.NullInt64{Int64: 10, Valid: true},
			numScale: sql.NullInt64{Int64: 2, Valid: true},
			want:     "NUMBER(10,2)",
		},
		{
			name:     "number_integer",
			dataType: "NUMBER",
			numPrec:  sql.NullInt64{Int64: 19, Valid: true},
			numScale: sql.NullInt64{Int64: 0, Valid: true},
			want:     "NUMBER(19)",
		},
		{
			name:     "date",
			dataType: "DATE",
			want:     "DATE",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := formatOracleType(tc.dataType, tc.dataLen, tc.charLen, tc.numPrec, tc.numScale)
			if got != tc.want {
				t.Fatalf("formatOracleType = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestGenerateDMLPreview(t *testing.T) {
	drv := &OracleDriver{}
	stmts, err := drv.GenerateDMLPreview("ORCL", "HR", "EMPLOYEES", []driver.RowChange{
		{
			Type:    "insert",
			Changes: map[string]any{"ID": 1, "NAME": "O'Reilly"},
		},
		{
			Type:       "update",
			PrimaryKey: map[string]any{"ID": 1},
			Changes:    map[string]any{"ACTIVE": true},
		},
		{
			Type:       "delete",
			PrimaryKey: map[string]any{"ID": 1},
		},
	})
	if err != nil {
		t.Fatalf("GenerateDMLPreview error: %v", err)
	}
	if len(stmts) != 3 {
		t.Fatalf("expected 3 statements, got %d", len(stmts))
	}
	if stmts[0] != `INSERT INTO "HR"."EMPLOYEES" ("ID", "NAME") VALUES (1, 'O''Reilly');` {
		t.Fatalf("unexpected insert: %s", stmts[0])
	}
	if stmts[1] != `UPDATE "HR"."EMPLOYEES" SET "ACTIVE" = 1 WHERE "ID" = 1;` {
		t.Fatalf("unexpected update: %s", stmts[1])
	}
	if stmts[2] != `DELETE FROM "HR"."EMPLOYEES" WHERE "ID" = 1;` {
		t.Fatalf("unexpected delete: %s", stmts[2])
	}
}

func TestGenerateOracleDDL(t *testing.T) {
	structure := &driver.TableStructure{
		Schema: "HR",
		Name:   "EMPLOYEES",
		Columns: []driver.ColumnMeta{
			{Name: "ID", DataType: "NUMBER(10)", IsNullable: false, IsAutoIncr: true},
			{Name: "EMAIL", DataType: "VARCHAR2(255)", IsNullable: false},
		},
		PrimaryKeys: []string{"ID"},
		Indexes: []driver.IndexMeta{
			{Name: "IDX_EMAIL", Columns: []string{"EMAIL"}, IsUnique: true},
		},
	}

	ddl := generateOracleDDL("HR", "EMPLOYEES", structure)
	if !strings.Contains(ddl, `CREATE TABLE "HR"."EMPLOYEES"`) {
		t.Fatalf("missing CREATE TABLE in DDL: %s", ddl)
	}
	if !strings.Contains(ddl, `"ID" NUMBER(10) GENERATED ALWAYS AS IDENTITY NOT NULL`) {
		t.Fatalf("missing identity column in DDL: %s", ddl)
	}
	if !strings.Contains(ddl, `CREATE UNIQUE INDEX "IDX_EMAIL" ON "HR"."EMPLOYEES" ("EMAIL");`) {
		t.Fatalf("missing unique index in DDL: %s", ddl)
	}
}
