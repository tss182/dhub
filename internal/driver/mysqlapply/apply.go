// Package mysqlapply applies grid edits for the MySQL and MariaDB drivers.
package mysqlapply

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"

	"dhub/internal/driver"
	"dhub/internal/driver/mysqlmeta"
)

// ErrNoRowKey is returned for an update or delete that carries no primary or unique key, which
// would otherwise produce a WHERE clause matching every row.
var ErrNoRowKey = errors.New("this table has no primary key or unique key, so rows cannot be updated or deleted safely")

// ErrRowChanged is returned when an update or delete by key matches no row, because another session
// changed or deleted it first.
var ErrRowChanged = errors.New("the row was changed or deleted by another session; reload the data and try again")

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// Quoter quotes identifiers for the target server.
type Quoter func(string) string

// whereClause builds "k1 = ? AND k2 IS NULL" from a primary key. It refuses an empty key.
func whereClause(quote Quoter, pk map[string]any) (string, []any, error) {
	if len(pk) == 0 {
		return "", nil, ErrNoRowKey
	}
	parts := make([]string, 0, len(pk))
	args := make([]any, 0, len(pk))
	for _, k := range sortedKeys(pk) {
		if pk[k] == nil {
			parts = append(parts, quote(k)+" IS NULL")
			continue
		}
		parts = append(parts, quote(k)+" = ?")
		args = append(args, pk[k])
	}
	return strings.Join(parts, " AND "), args, nil
}

// Apply runs changes inside one transaction. The pool must connect with ClientFoundRows so
// RowsAffected counts matched rows: an update that writes the same value still reports 1, and an
// update or delete that matches nothing reports 0 and fails the whole batch.
//
// Binary and BIT values arrive as text from the grid and are converted by the table's column types.
// The table name is fully qualified, so no USE statement is needed.
func Apply(ctx context.Context, db *sql.DB, quote Quoter, schema, table string, changes []driver.RowChange) (int64, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	target := quote(table)
	typeSchema := schema
	if schema != "" {
		target = quote(schema) + "." + target
	} else {
		// Fall back to the connection's current database for the type lookup.
		if err := tx.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&typeSchema); err != nil {
			typeSchema = ""
		}
	}
	// Types are best effort: if the lookup fails, values pass through unconverted.
	types, _ := mysqlmeta.LoadColumnTypes(ctx, tx, typeSchema, table)

	var total int64
	for i, c := range changes {
		switch c.Type {
		case "insert":
			vals, err := mysqlmeta.ConvertRow(types, c.Changes)
			if err != nil {
				return 0, fmt.Errorf("change %d: %w", i+1, err)
			}
			cols := make([]string, 0, len(vals))
			marks := make([]string, 0, len(vals))
			args := make([]any, 0, len(vals))
			for _, k := range sortedKeys(vals) {
				cols = append(cols, quote(k))
				marks = append(marks, "?")
				args = append(args, vals[k])
			}
			stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", target, strings.Join(cols, ", "), strings.Join(marks, ", "))
			if len(cols) == 0 {
				stmt = fmt.Sprintf("INSERT INTO %s () VALUES ()", target)
			}
			res, err := tx.ExecContext(ctx, stmt, args...)
			if err != nil {
				return 0, err
			}
			n, _ := res.RowsAffected()
			total += n

		case "update":
			if len(c.Changes) == 0 {
				continue
			}
			vals, err := mysqlmeta.ConvertRow(types, c.Changes)
			if err != nil {
				return 0, fmt.Errorf("change %d: %w", i+1, err)
			}
			pk, err := mysqlmeta.ConvertRow(types, c.PrimaryKey)
			if err != nil {
				return 0, fmt.Errorf("change %d: %w", i+1, err)
			}
			where, whereArgs, err := whereClause(quote, pk)
			if err != nil {
				return 0, fmt.Errorf("change %d: %w", i+1, err)
			}
			sets := make([]string, 0, len(vals))
			args := make([]any, 0, len(vals)+len(whereArgs))
			for _, k := range sortedKeys(vals) {
				sets = append(sets, quote(k)+" = ?")
				args = append(args, vals[k])
			}
			args = append(args, whereArgs...)
			res, err := tx.ExecContext(ctx, fmt.Sprintf("UPDATE %s SET %s WHERE %s", target, strings.Join(sets, ", "), where), args...)
			if err != nil {
				return 0, err
			}
			n, _ := res.RowsAffected()
			if n != 1 {
				return 0, fmt.Errorf("change %d: %w", i+1, rowCountError(n))
			}
			total += n

		case "delete":
			pk, err := mysqlmeta.ConvertRow(types, c.PrimaryKey)
			if err != nil {
				return 0, fmt.Errorf("change %d: %w", i+1, err)
			}
			where, args, err := whereClause(quote, pk)
			if err != nil {
				return 0, fmt.Errorf("change %d: %w", i+1, err)
			}
			res, err := tx.ExecContext(ctx, fmt.Sprintf("DELETE FROM %s WHERE %s", target, where), args...)
			if err != nil {
				return 0, err
			}
			n, _ := res.RowsAffected()
			if n != 1 {
				return 0, fmt.Errorf("change %d: %w", i+1, rowCountError(n))
			}
			total += n
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return total, nil
}

func rowCountError(n int64) error {
	if n == 0 {
		return ErrRowChanged
	}
	return fmt.Errorf("expected to change exactly one row but %d matched; the key is not unique", n)
}

// PreviewWhere renders the WHERE clause for the SQL preview, refusing an empty key like Apply does.
func PreviewWhere(quote Quoter, literal func(any) string, pk map[string]any) (string, error) {
	if len(pk) == 0 {
		return "", ErrNoRowKey
	}
	parts := make([]string, 0, len(pk))
	for _, k := range sortedKeys(pk) {
		if pk[k] == nil {
			parts = append(parts, quote(k)+" IS NULL")
		} else {
			parts = append(parts, quote(k)+" = "+literal(pk[k]))
		}
	}
	return strings.Join(parts, " AND "), nil
}
