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
		lowerType := strings.ToLower(dataType)
		if dialect == "postgres" && lowerType == "bytea" {
			return `\x` + hex.EncodeToString(b)
		}
		if dialect == "mysql" || dialect == "mariadb" {
			// Binary and BIT bytes are not valid UTF-8 text. Send them in a form the UI can show
			// and ApplyChanges can convert back.
			if formatted, ok := mysqlmeta.FormatRead(dataType, b); ok {
				return formatted
			}
		}
		if dialect == "sqlite" && lowerType == "blob" {
			return "0x" + hex.EncodeToString(b)
		}
		if dialect == "mssql" || dialect == "sqlserver" {
			if lowerType == "uniqueidentifier" && len(b) == 16 {
				return fmt.Sprintf("%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
					b[3], b[2], b[1], b[0], b[5], b[4], b[7], b[6], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15])
			}
			if strings.Contains(lowerType, "binary") || lowerType == "image" || lowerType == "rowversion" || lowerType == "timestamp" {
				return "0x" + hex.EncodeToString(b)
			}
		}
		if dialect == "oracle" && (lowerType == "raw" || lowerType == "blob" || lowerType == "long raw" || lowerType == "bfile") {
			return "0x" + hex.EncodeToString(b)
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
		if dialect == "mssql" || dialect == "sqlserver" {
			if lowerType == "datetimeoffset" {
				if t.Nanosecond() != 0 {
					return t.Format("2006-01-02 15:04:05.9999999Z07:00")
				}
				return t.Format("2006-01-02 15:04:05Z07:00")
			}
			if lowerType == "time" {
				if t.Nanosecond() != 0 {
					return t.Format("15:04:05.9999999")
				}
				return t.Format("15:04:05")
			}
		}
		if dialect == "oracle" && strings.Contains(lowerType, "time zone") {
			if t.Nanosecond() != 0 {
				return t.Format("2006-01-02 15:04:05.999999Z07:00")
			}
			return t.Format("2006-01-02 15:04:05Z07:00")
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
	if dialect == "clickhouse" || dialect == "postgres" || dialect == "mysql" || dialect == "mariadb" ||
		dialect == "sqlite" || dialect == "mssql" || dialect == "sqlserver" || dialect == "oracle" {
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

	isMySQLFamily, _ := dialectFlags(dialect)
	var allResults []StatementResult
	var lastResultWithRows *StatementResult
	var totalRowsAffected int64

	finishResult := func(errMsg string) *QueryResult {
		totalElapsed := time.Since(start).Milliseconds()
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
			Error:        errMsg,
			Results:      allResults,
		}
	}

	failMidScript := func(stmtIdx int, stmtSQL string, stmtElapsed int64, err error) (*QueryResult, error) {
		if len(allResults) == 0 {
			return nil, fmt.Errorf("error in statement %d: %w\nSQL: %s", stmtIdx+1, err, TruncateSQL(stmtSQL, 100))
		}
		allResults = append(allResults, StatementResult{
			SQL:       stmtSQL,
			Columns:   []ColumnMeta{},
			Rows:      [][]any{},
			ElapsedMs: stmtElapsed,
			Error:     err.Error(),
		})
		return finishResult(fmt.Sprintf("error in statement %d: %v", stmtIdx+1, err)), nil
	}

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
			if err != nil && ctx.Err() == nil && !isMySQLFamily && stmtOffset == 0 && queryText != stmt {
				errLower := strings.ToLower(err.Error())
				if strings.Contains(errLower, "duplicate column") ||
					strings.Contains(errLower, "specified more than once") ||
					strings.Contains(errLower, "ambiguous") {
					// Derived-table wrapping can fail on duplicate column names in joins.
					stmtOffset = offset
					rows, err = execer.QueryContext(ctx, stmt)
				}
			}
			if err != nil {
				return failMidScript(i, stmt, time.Since(stmtStart).Milliseconds(), err)
			}

			firstSet, err := scanRowsResultSet(rows, limit, stmtOffset, dialect)
			if err != nil {
				rows.Close()
				return failMidScript(i, stmt, time.Since(stmtStart).Milliseconds(), err)
			}

			var extraSets []scannedResultSet
			if isMySQLFamily {
				for rows.NextResultSet() {
					nextSet, nextErr := scanRowsResultSet(rows, limit, 0, dialect)
					if nextErr != nil {
						rows.Close()
						return failMidScript(i, stmt, time.Since(stmtStart).Milliseconds(), nextErr)
					}
					extraSets = append(extraSets, nextSet)
				}
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return failMidScript(i, stmt, time.Since(stmtStart).Milliseconds(), err)
			}
			rows.Close()

			stmtElapsed := time.Since(stmtStart).Milliseconds()
			stmtRes := StatementResult{
				SQL:          stmt,
				Columns:      firstSet.columns,
				Rows:         firstSet.rows,
				RowsAffected: int64(len(firstSet.rows)),
				ElapsedMs:    stmtElapsed,
				HasMore:      firstSet.hasMore,
			}
			allResults = append(allResults, stmtRes)
			if len(firstSet.columns) > 0 || len(extraSets) == 0 {
				lastResultWithRows = &allResults[len(allResults)-1]
			}
			for _, extra := range extraSets {
				extraRes := StatementResult{
					SQL:          stmt,
					Columns:      extra.columns,
					Rows:         extra.rows,
					RowsAffected: int64(len(extra.rows)),
					ElapsedMs:    stmtElapsed,
					HasMore:      extra.hasMore,
				}
				allResults = append(allResults, extraRes)
				if len(extra.columns) > 0 {
					lastResultWithRows = &allResults[len(allResults)-1]
				}
			}
		} else {
			res, err := execer.ExecContext(ctx, stmt)
			if err != nil {
				return failMidScript(i, stmt, time.Since(stmtStart).Milliseconds(), err)
			}

			var ra int64
			var lastInsertID int64
			if res != nil {
				ra, _ = res.RowsAffected()
				if isMySQLFamily {
					lastInsertID, _ = res.LastInsertId()
				}
			}
			totalRowsAffected += ra
			stmtElapsed := time.Since(stmtStart).Milliseconds()

			var warnings []string
			if isMySQLFamily {
				warnings = fetchMySQLWarnings(ctx, execer)
			}

			stmtRes := StatementResult{
				SQL:          stmt,
				Columns:      []ColumnMeta{},
				Rows:         [][]any{},
				RowsAffected: ra,
				LastInsertID: lastInsertID,
				ElapsedMs:    stmtElapsed,
				Warnings:     warnings,
			}
			allResults = append(allResults, stmtRes)
		}
	}

	return finishResult(""), nil
}

type scannedResultSet struct {
	columns []ColumnMeta
	rows    [][]any
	hasMore bool
}

func scanRowsResultSet(rows *sql.Rows, limit, stmtOffset int, dialect string) (scannedResultSet, error) {
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return scannedResultSet{}, err
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
		return scannedResultSet{}, err
	}

	return scannedResultSet{
		columns: columns,
		rows:    resultRows,
		hasMore: hasMore,
	}, nil
}

func fetchMySQLWarnings(ctx context.Context, execer QueryExecer) []string {
	rows, err := execer.QueryContext(ctx, "SHOW WARNINGS LIMIT 50")
	if err != nil {
		return nil
	}
	defer rows.Close()

	var warnings []string
	for rows.Next() {
		var level string
		var code int
		var msg string
		if scanErr := rows.Scan(&level, &code, &msg); scanErr == nil {
			warnings = append(warnings, fmt.Sprintf("%s (%d): %s", level, code, msg))
		}
	}
	return warnings
}

// StreamQueryWithDialect executes req.SQL and streams every row to onRow without buffering the
// entire result set in memory or issuing OFFSET paging queries.
func StreamQueryWithDialect(ctx context.Context, execer QueryExecer, req QueryRequest, dialect string, onRow func(cols []ColumnMeta, row []any) error) error {
	rows, err := execer.QueryContext(ctx, req.SQL)
	if err != nil {
		return err
	}
	defer rows.Close()

	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return err
	}
	columns := make([]ColumnMeta, len(colTypes))
	for i, ct := range colTypes {
		columns[i] = ColumnMeta{
			Name:     ct.Name(),
			DataType: ct.DatabaseTypeName(),
			RawType:  strings.ToLower(ct.DatabaseTypeName()),
		}
	}

	values := make([]any, len(columns))
	valuePtrs := make([]any, len(columns))
	for i := range values {
		valuePtrs[i] = &values[i]
	}

	for rows.Next() {
		if err := rows.Scan(valuePtrs...); err != nil {
			return err
		}
		rowValues := make([]any, len(columns))
		for i, v := range values {
			rowValues[i] = normalizeScannedValue(v, columns[i].DataType, dialect)
		}
		if err := onRow(columns, rowValues); err != nil {
			return err
		}
	}
	return rows.Err()
}
