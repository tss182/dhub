package driver

import (
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"dhub/internal/driver/mysqlmeta"
)

type QueryExecer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// wrapSelectForPaging wraps a plain SELECT in a derived table with LIMIT/OFFSET so the
// database applies the offset (or LIMIT on page 1 for OLAP engines like ClickHouse).
// It fetches limit+1 rows so the caller can detect "has more".
// Returns ok=false for anything that is not a simple SELECT (CTEs, SHOW, EXPLAIN, statements
// that already contain LIMIT/OFFSET/FETCH/FORMAT/INTO OUTFILE, or when no offset is needed for OLTP).
func wrapSelectForPaging(stmt string, limit, offset int, dialect string) (string, bool) {
	if limit <= 0 {
		return "", false
	}
	if isMySQLFamily, _ := dialectFlags(dialect); isMySQLFamily {
		return appendLimitMySQL(stmt, limit, offset, dialect)
	}
	if offset <= 0 && dialect != "clickhouse" {
		return "", false
	}
	trimmed := strings.TrimRight(strings.TrimSpace(stmt), "; \t\r\n")
	upper := strings.ToUpper(trimmed)
	if !strings.HasPrefix(upper, "SELECT") {
		return "", false
	}
	for _, kw := range []string{" LIMIT ", " OFFSET ", " FETCH ", " FOR UPDATE", " INTO ", " FORMAT ", " WITH TOTALS", "--", "/*"} {
		if strings.Contains(upper, kw) {
			return "", false
		}
	}
	if dialect == "clickhouse" {
		// Preserve trailing SETTINGS ... clause outside the wrapper so ClickHouse parses it cleanly.
		settingsSuffix := ""
		if idx := strings.LastIndex(upper, " SETTINGS "); idx != -1 {
			settingsSuffix = " " + strings.TrimSpace(trimmed[idx:])
			trimmed = strings.TrimSpace(trimmed[:idx])
		}
		if offset <= 0 {
			return fmt.Sprintf("SELECT * FROM (%s) AS dhub_page LIMIT %d%s", trimmed, limit+1, settingsSuffix), true
		}
		return fmt.Sprintf("SELECT * FROM (%s) AS dhub_page LIMIT %d OFFSET %d%s", trimmed, limit+1, offset, settingsSuffix), true
	}
	if dialect == "mssql" {
		if strings.Contains(upper, " TOP ") || strings.Contains(upper, " ORDER BY ") {
			return "", false
		}
		return fmt.Sprintf("SELECT * FROM (%s) AS dhub_page ORDER BY (SELECT NULL) OFFSET %d ROWS FETCH NEXT %d ROWS ONLY", trimmed, offset, limit+1), true
	}
	if dialect == "oracle" {
		if strings.Contains(upper, "ROWNUM") {
			return "", false
		}
		return fmt.Sprintf("SELECT * FROM (%s) dhub_page OFFSET %d ROWS FETCH NEXT %d ROWS ONLY", trimmed, offset, limit+1), true
	}
	return fmt.Sprintf("SELECT * FROM (%s) AS dhub_page LIMIT %d OFFSET %d", trimmed, limit+1, offset), true
}

// appendLimitMySQL appends LIMIT/OFFSET to the end of a plain SELECT so MySQL and MariaDB stop
// sending rows after the requested page. Appending avoids derived tables, which break on duplicate
// column names and may drop ORDER BY. It returns ok=false whenever the statement is not a read query
// whose top level can safely take a trailing LIMIT, so the caller keeps the original behaviour.
func appendLimitMySQL(stmt string, limit, offset int, dialect string) (string, bool) {
	trimmed := strings.TrimRight(strings.TrimSpace(stmt), "; \t\r\n")
	if trimmed == "" {
		return "", false
	}
	sanitized, hasExec, hasComment := sanitizeSQLFlags(trimmed, dialect)
	// Executable comments run as SQL and a trailing line comment would swallow the appended LIMIT.
	if hasExec || hasComment {
		return "", false
	}

	// Collect the keywords that sit outside any parentheses.
	var words []string
	depth := 0
	runes := []rune(strings.ToUpper(sanitized))
	for i := 0; i < len(runes); i++ {
		switch r := runes[i]; {
		case r == '(':
			depth++
		case r == ')':
			if depth > 0 {
				depth--
			}
		case isIdentChar(r) && (i == 0 || !isIdentChar(runes[i-1])):
			j := i
			for j < len(runes) && isIdentChar(runes[j]) {
				j++
			}
			if depth == 0 {
				words = append(words, string(runes[i:j]))
			}
			i = j - 1
		}
	}
	if len(words) == 0 || (words[0] != "SELECT" && words[0] != "WITH") {
		return "", false
	}
	for idx, w := range words {
		switch w {
		case "LIMIT", "OFFSET", "FETCH", "INTO", "PROCEDURE", "RETURNING",
			"INSERT", "UPDATE", "DELETE", "REPLACE", "OUTFILE", "DUMPFILE":
			return "", false
		case "FOR":
			// FOR UPDATE / FOR SHARE take a lock clause; MariaDB's FOR SYSTEM_TIME does not.
			if idx+1 < len(words) && words[idx+1] != "SYSTEM_TIME" {
				return "", false
			}
		case "LOCK":
			return "", false
		}
	}
	if offset > 0 {
		return fmt.Sprintf("%s LIMIT %d OFFSET %d", trimmed, limit+1, offset), true
	}
	return fmt.Sprintf("%s LIMIT %d", trimmed, limit+1), true
}

// normalizeScannedValue normalizes driver-specific scanned values for JSON serialization.
// In particular, for ClickHouse it prevents JS 53-bit integer precision loss on large Int64/UInt64
// and handles Date32 / Nullable(Date) / fmt.Stringer types (UUID, IP, Decimal, BigInt).
func normalizeScannedValue(v any, dataType string, dialect string) any {
	if v == nil {
		return nil
	}
	if b, ok := v.([]byte); ok {
		if dialect == "postgres" && strings.EqualFold(dataType, "BYTEA") {
			return `\x` + hex.EncodeToString(b)
		}
		if dialect == "mysql" || dialect == "mariadb" {
			// Binary and BIT bytes are not valid UTF-8 text. Send them in a form the UI can show
			// and ApplyChanges can convert back.
			if formatted, ok := mysqlmeta.FormatRead(dataType, b); ok {
				return formatted
			}
		}
		return string(b)
	}
	if t, ok := v.(time.Time); ok {
		lowerType := strings.ToLower(dataType)
		if dialect == "postgres" {
			if lowerType == "date" {
				return t.Format("2006-01-02")
			}
			if lowerType == "timestamptz" {
				if t.Nanosecond() != 0 {
					return t.Format("2006-01-02 15:04:05.999999Z07:00")
				}
				return t.Format("2006-01-02 15:04:05Z07:00")
			}
			if lowerType == "timetz" {
				if t.Nanosecond() != 0 {
					return t.Format("15:04:05.999999Z07:00")
				}
				return t.Format("15:04:05Z07:00")
			}
			if lowerType == "time" {
				if t.Nanosecond() != 0 {
					return t.Format("15:04:05.999999")
				}
				return t.Format("15:04:05")
			}
		}
		if t.Nanosecond() != 0 {
			return t.Format("2006-01-02 15:04:05.000000")
		}
		if t.Hour() == 0 && t.Minute() == 0 && t.Second() == 0 &&
			(strings.EqualFold(dataType, "date") || strings.Contains(lowerType, "date32") || strings.Contains(lowerType, "(date)")) {
			return t.Format("2006-01-02")
		}
		return t.Format("2006-01-02 15:04:05")
	}
	if dialect == "clickhouse" || dialect == "postgres" || dialect == "mysql" || dialect == "mariadb" {
		const maxSafeJSInt = int64(9007199254740991)
		const maxSafeJSUint = uint64(9007199254740991)
		switch val := v.(type) {
		case int64:
			if val > maxSafeJSInt || val < -maxSafeJSInt {
				return fmt.Sprintf("%d", val)
			}
			return val
		case *int64:
			if val == nil {
				return nil
			}
			if *val > maxSafeJSInt || *val < -maxSafeJSInt {
				return fmt.Sprintf("%d", *val)
			}
			return *val
		case uint64:
			if val > maxSafeJSUint {
				return fmt.Sprintf("%d", val)
			}
			return val
		case *uint64:
			if val == nil {
				return nil
			}
			if *val > maxSafeJSUint {
				return fmt.Sprintf("%d", *val)
			}
			return *val
		case fmt.Stringer:
			return val.String()
		}
	}
	return v
}

// It returns a QueryResult containing all individual statement results in Results, with the main
// view defaulting to the last SELECT statement (or the last executed statement).
func ExecuteStatements(ctx context.Context, execer QueryExecer, req QueryRequest) (*QueryResult, error) {
	return ExecuteStatementsWithDialect(ctx, execer, req, "")
}

// ExecuteStatementsWithDialect executes statements with dialect-specific pagination support.
func ExecuteStatementsWithDialect(ctx context.Context, execer QueryExecer, req QueryRequest, dialect string) (*QueryResult, error) {
	start := time.Now()
	statements := SplitStatementsForDialect(req.SQL, dialect)
	if len(statements) == 0 {
		return &QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []ColumnMeta{},
			Rows:        [][]any{},
			ElapsedMs:   0,
		}, nil
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 100
	}
	offset := req.Offset
	if offset < 0 || strings.Contains(strings.ToUpper(req.SQL), " OFFSET ") {
		offset = 0
	}

	var allResults []StatementResult
	var lastResultWithRows *StatementResult
	var totalRowsAffected int64

	for i, stmt := range statements {
		stmtStart := time.Now()
		isSelect := IsQueryReturningRows(stmt)

		if isSelect {
			// Push OFFSET to the server for plain SELECTs so deep pages do not stream
			// and discard every preceding row. Falls back to client-side skipping.
			stmtOffset := offset
			queryText := stmt
			if wrapped, ok := wrapSelectForPaging(stmt, limit, offset, dialect); ok {
				queryText = wrapped
				stmtOffset = 0
			}

			rows, err := execer.QueryContext(ctx, queryText)
			if err != nil && stmtOffset == 0 && queryText != stmt {
				// Wrapping can fail (e.g. duplicate column names in a derived table).
				stmtOffset = offset
				rows, err = execer.QueryContext(ctx, stmt)
			}
			if err != nil {
				return nil, fmt.Errorf("error in statement %d: %w\nSQL: %s", i+1, err, TruncateSQL(stmt, 100))
			}

			colTypes, err := rows.ColumnTypes()
			if err != nil {
				rows.Close()
				return nil, err
			}

			columns := make([]ColumnMeta, len(colTypes))
			for cIdx, ct := range colTypes {
				columns[cIdx] = ColumnMeta{
					Name:     ct.Name(),
					DataType: ct.DatabaseTypeName(),
					RawType:  strings.ToLower(ct.DatabaseTypeName()),
				}
			}

			values := make([]any, len(columns))
			valuePtrs := make([]any, len(columns))
			for vIdx := range values {
				valuePtrs[vIdx] = &values[vIdx]
			}

			capHint := limit
			if capHint > 256 {
				capHint = 256
			}
			resultRows := make([][]any, 0, capHint)
			skipped := 0
			hasMore := false

			for rows.Next() {
				if skipped < stmtOffset {
					if err := rows.Scan(valuePtrs...); err == nil {
						skipped++
					}
					continue
				}

				if len(resultRows) >= limit {
					hasMore = true
					break
				}

				if err := rows.Scan(valuePtrs...); err != nil {
					continue
				}

				rowValues := make([]any, len(columns))
				for vIdx, v := range values {
					rowValues[vIdx] = normalizeScannedValue(v, columns[vIdx].DataType, dialect)
				}
				resultRows = append(resultRows, rowValues)
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return nil, fmt.Errorf("error in statement %d: %w\nSQL: %s", i+1, err, TruncateSQL(stmt, 100))
			}
			rows.Close()

			stmtElapsed := time.Since(stmtStart).Milliseconds()
			stmtRes := StatementResult{
				SQL:          stmt,
				Columns:      columns,
				Rows:         resultRows,
				RowsAffected: int64(len(resultRows)),
				ElapsedMs:    stmtElapsed,
				HasMore:      hasMore,
			}
			allResults = append(allResults, stmtRes)
			lastResultWithRows = &stmtRes
		} else {
			res, err := execer.ExecContext(ctx, stmt)
			if err != nil {
				return nil, fmt.Errorf("error in statement %d: %w\nSQL: %s", i+1, err, TruncateSQL(stmt, 100))
			}

			var ra int64
			if res != nil {
				ra, _ = res.RowsAffected()
			}
			totalRowsAffected += ra
			stmtElapsed := time.Since(stmtStart).Milliseconds()

			stmtRes := StatementResult{
				SQL:          stmt,
				Columns:      []ColumnMeta{},
				Rows:         [][]any{},
				RowsAffected: ra,
				ElapsedMs:    stmtElapsed,
			}
			allResults = append(allResults, stmtRes)
		}
	}

	totalElapsed := time.Since(start).Milliseconds()

	// Default main view to the last SELECT statement with data, or the last executed statement
	var defCols []ColumnMeta
	var defRows [][]any
	var defHasMore bool

	if lastResultWithRows != nil {
		defCols = lastResultWithRows.Columns
		defRows = lastResultWithRows.Rows
		defHasMore = lastResultWithRows.HasMore
	} else if len(allResults) > 0 {
		last := allResults[len(allResults)-1]
		defCols = last.Columns
		defRows = last.Rows
		defHasMore = last.HasMore
	}

	return &QueryResult{
		ExecutionID:  req.ExecutionID,
		Columns:      defCols,
		Rows:         defRows,
		RowsAffected: totalRowsAffected,
		ElapsedMs:    totalElapsed,
		HasMore:      defHasMore,
		Results:      allResults,
	}, nil
}
