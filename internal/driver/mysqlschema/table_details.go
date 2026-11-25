package mysqlschema

import (
	"context"
	"database/sql"
	"strings"
)

// PartitionRow holds a single partition entry from information_schema.partitions.
type PartitionRow struct {
	Name        string
	Method      string
	Expression  string
	Description string
	RowEstimate int64
}

// TableDetails holds table options, view metadata, and partitions for a MySQL/MariaDB object.
type TableDetails struct {
	Engine        string
	Collation     string
	Comment       string
	RowFormat     string
	AutoIncrement *int64
	DataFreeBytes *int64
	IsUpdatable   *bool
	SecurityType  string
	ViewDefiner   string
	Partitions    []PartitionRow
}

// FetchTableDetails queries information_schema for table options, view updatability/security,
// and partitions. All lookups are best-effort so older or restricted servers degrade gracefully.
func FetchTableDetails(ctx context.Context, db *sql.DB, targetDB, table string) TableDetails {
	var out TableDetails

	var engine, collation, comment, rowFormat sql.NullString
	var autoIncr, dataFree sql.NullInt64
	err := db.QueryRowContext(ctx,
		`SELECT engine, table_collation, table_comment, row_format, auto_increment, data_free
		 FROM information_schema.tables
		 WHERE table_schema = ? AND table_name = ?`,
		targetDB, table,
	).Scan(&engine, &collation, &comment, &rowFormat, &autoIncr, &dataFree)
	if err == nil {
		out.Engine = engine.String
		out.Collation = collation.String
		out.Comment = comment.String
		out.RowFormat = rowFormat.String
		if autoIncr.Valid {
			v := autoIncr.Int64
			out.AutoIncrement = &v
		}
		if dataFree.Valid {
			v := dataFree.Int64
			out.DataFreeBytes = &v
		}
	}

	var isUpdatable, secType, definer sql.NullString
	if err := db.QueryRowContext(ctx,
		`SELECT is_updatable, security_type, definer
		 FROM information_schema.views
		 WHERE table_schema = ? AND table_name = ?`,
		targetDB, table,
	).Scan(&isUpdatable, &secType, &definer); err == nil {
		upd := strings.EqualFold(strings.TrimSpace(isUpdatable.String), "YES")
		out.IsUpdatable = &upd
		out.SecurityType = secType.String
		out.ViewDefiner = definer.String
	}

	pRows, pErr := db.QueryContext(ctx,
		`SELECT partition_name, COALESCE(partition_method, ''), COALESCE(partition_expression, ''), COALESCE(partition_description, ''), COALESCE(table_rows, 0)
		 FROM information_schema.partitions
		 WHERE table_schema = ? AND table_name = ? AND partition_name IS NOT NULL
		 ORDER BY partition_ordinal_position`,
		targetDB, table,
	)
	if pErr == nil {
		defer pRows.Close()
		for pRows.Next() {
			var pr PartitionRow
			if scanErr := pRows.Scan(&pr.Name, &pr.Method, &pr.Expression, &pr.Description, &pr.RowEstimate); scanErr == nil {
				out.Partitions = append(out.Partitions, pr)
			}
		}
	}

	return out
}
