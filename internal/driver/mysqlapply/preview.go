package mysqlapply

import (
	"fmt"
	"sort"
	"strings"

	"dhub/internal/driver"
	"dhub/internal/driver/sqlfmt"
)

func sortedMapKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// FormatSQLVal formats a Go value as a MySQL/MariaDB SQL literal for DML previews.
func FormatSQLVal(v any) string {
	return sqlfmt.MySQLValue(v)
}

// GeneratePreview builds SQL DML preview statements shared by the MySQL and MariaDB drivers.
func GeneratePreview(quoteIdent func(string) string, effectiveSchema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	prefix := fmt.Sprintf("%s.%s", quoteIdent(effectiveSchema), quoteIdent(table))
	if effectiveSchema == "" {
		prefix = quoteIdent(table)
	}

	for i, c := range changes {
		switch c.Type {
		case "insert":
			cols := []string{}
			vals := []string{}
			for _, k := range sortedMapKeys(c.Changes) {
				cols = append(cols, quoteIdent(k))
				vals = append(vals, FormatSQLVal(c.Changes[k]))
			}
			stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);", prefix, strings.Join(cols, ", "), strings.Join(vals, ", "))
			if len(cols) == 0 {
				stmt = fmt.Sprintf("INSERT INTO %s () VALUES ();", prefix)
			}
			statements = append(statements, stmt)
		case "update":
			sets := []string{}
			for _, k := range sortedMapKeys(c.Changes) {
				sets = append(sets, fmt.Sprintf("%s = %s", quoteIdent(k), FormatSQLVal(c.Changes[k])))
			}
			where, err := PreviewWhere(quoteIdent, FormatSQLVal, c.PrimaryKey)
			if err != nil {
				return nil, fmt.Errorf("change %d: %w", i+1, err)
			}
			statements = append(statements, fmt.Sprintf("UPDATE %s SET %s WHERE %s;", prefix, strings.Join(sets, ", "), where))
		case "delete":
			where, err := PreviewWhere(quoteIdent, FormatSQLVal, c.PrimaryKey)
			if err != nil {
				return nil, fmt.Errorf("change %d: %w", i+1, err)
			}
			statements = append(statements, fmt.Sprintf("DELETE FROM %s WHERE %s;", prefix, where))
		}
	}
	return statements, nil
}
