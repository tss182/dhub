// Package mysqlschema turns information_schema rows into driver metadata for MySQL and MariaDB.
package mysqlschema

import (
	"database/sql"
	"strings"

	"dhub/internal/driver"
)

// IndexRow is one row of information_schema.statistics.
type IndexRow struct {
	Name       string
	NonUnique  int
	Column     sql.NullString // NULL for a functional key part
	Seq        int
	Type       string
	Comment    sql.NullString
	SubPart    sql.NullInt64
	Collation  sql.NullString // "A" ascending, "D" descending, NULL not sorted
	Expression sql.NullString // MySQL 8.0.13+, functional key part
	Visible    sql.NullString // MySQL "YES"/"NO"
	Ignored    sql.NullString // MariaDB 10.6+ "YES"/"NO"
}

// BuildIndexes groups statistics rows into indexes, keeping prefix length, sort direction,
// visibility and functional expressions. Rows must be ordered by index name, then Seq.
func BuildIndexes(rows []IndexRow) []driver.IndexMeta {
	var order []string
	byName := map[string]*driver.IndexMeta{}
	for _, r := range rows {
		idx, ok := byName[r.Name]
		if !ok {
			idx = &driver.IndexMeta{
				Name:      r.Name,
				IsUnique:  r.NonUnique == 0,
				IsPrimary: r.Name == "PRIMARY",
				Type:      r.Type,
				Method:    r.Type,
			}
			if r.Comment.Valid {
				idx.Comment = r.Comment.String
			}
			// MySQL reports INVISIBLE indexes with IS_VISIBLE = 'NO'. MariaDB reports IGNORED = 'YES'.
			if r.Visible.Valid {
				v := !strings.EqualFold(r.Visible.String, "NO")
				idx.IsVisible = &v
			} else if r.Ignored.Valid {
				v := !strings.EqualFold(r.Ignored.String, "YES")
				idx.IsVisible = &v
			}
			byName[r.Name] = idx
			order = append(order, r.Name)
		}
		name := r.Column.String
		if !r.Column.Valid {
			// Functional key part: show the expression where a column name would be.
			name = "(" + r.Expression.String + ")"
			if idx.Expression == "" {
				idx.Expression = r.Expression.String
			} else {
				idx.Expression += ", " + r.Expression.String
			}
		}
		idx.Columns = append(idx.Columns, name)
		sub := 0
		if r.SubPart.Valid {
			sub = int(r.SubPart.Int64)
		}
		idx.SubParts = append(idx.SubParts, sub)
		idx.Descending = append(idx.Descending, strings.EqualFold(r.Collation.String, "D"))
	}

	out := make([]driver.IndexMeta, 0, len(order))
	for _, name := range order {
		idx := byName[name]
		// Drop the parallel slices when they carry no information, to keep payloads small.
		if !hasNonZero(idx.SubParts) {
			idx.SubParts = nil
		}
		if !hasTrue(idx.Descending) {
			idx.Descending = nil
		}
		out = append(out, *idx)
	}
	return out
}

func hasNonZero(v []int) bool {
	for _, n := range v {
		if n != 0 {
			return true
		}
	}
	return false
}

func hasTrue(v []bool) bool {
	for _, b := range v {
		if b {
			return true
		}
	}
	return false
}

// FKRow is one row of the key_column_usage / referential_constraints join.
type FKRow struct {
	Name, Column, RefSchema, RefTable, RefColumn, OnUpdate, OnDelete string
}

// BuildForeignKeys folds one row per column into one entry per constraint, in ordinal order.
// Rows must be ordered by constraint name, then ordinal position.
func BuildForeignKeys(rows []FKRow) []driver.ForeignKeyMeta {
	var order []string
	byName := map[string]*driver.ForeignKeyMeta{}
	for _, r := range rows {
		fk, ok := byName[r.Name]
		if !ok {
			fk = &driver.ForeignKeyMeta{
				ConstraintName: r.Name,
				ColumnName:     r.Column,
				RefSchema:      r.RefSchema,
				RefTable:       r.RefTable,
				RefColumn:      r.RefColumn,
				OnUpdate:       r.OnUpdate,
				OnDelete:       r.OnDelete,
			}
			byName[r.Name] = fk
			order = append(order, r.Name)
		}
		fk.Columns = append(fk.Columns, r.Column)
		fk.RefColumns = append(fk.RefColumns, r.RefColumn)
	}
	out := make([]driver.ForeignKeyMeta, 0, len(order))
	for _, name := range order {
		fk := byName[name]
		if len(fk.Columns) == 1 {
			// A single-column key is fully described by ColumnName/RefColumn.
			fk.Columns, fk.RefColumns = nil, nil
		}
		out = append(out, *fk)
	}
	return out
}

// IndexQueries lists statistics queries from richest to simplest. Each server version supports a
// different set of columns, so callers try them in order until one runs. Every query returns the
// columns in the same order that ScanIndexRow expects, padding missing ones with NULL.
var IndexQueries = []string{
	// MySQL 8.0.13+: functional key parts and visibility.
	`SELECT index_name, non_unique, column_name, seq_in_index, index_type, comment, sub_part, collation, expression, is_visible, NULL
	 FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? ORDER BY index_name, seq_in_index`,
	// MariaDB 10.6+: ignored indexes.
	`SELECT index_name, non_unique, column_name, seq_in_index, index_type, comment, sub_part, collation, NULL, NULL, ignored
	 FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? ORDER BY index_name, seq_in_index`,
	// Older servers.
	`SELECT index_name, non_unique, column_name, seq_in_index, index_type, comment, sub_part, collation, NULL, NULL, NULL
	 FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? ORDER BY index_name, seq_in_index`,
}

// ScanIndexRow reads one row produced by any query in IndexQueries.
func ScanIndexRow(rows interface{ Scan(...any) error }) (IndexRow, error) {
	var r IndexRow
	err := rows.Scan(&r.Name, &r.NonUnique, &r.Column, &r.Seq, &r.Type, &r.Comment, &r.SubPart, &r.Collation, &r.Expression, &r.Visible, &r.Ignored)
	return r, err
}
