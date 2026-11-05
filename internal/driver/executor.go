package driver

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type QueryExecer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// wrapSelectForPaging wraps a plain SELECT in a derived table with LIMIT/OFFSET so the
// database applies the offset. It fetches limit+1 rows so the caller can detect "has more".
// Returns ok=false for anything that is not a simple SELECT (CTEs, SHOW, EXPLAIN, statements
// that already contain LIMIT/OFFSET/FETCH, or when no offset is needed).
func wrapSelectForPaging(stmt string, limit, offset int) (string, bool) {
	if offset <= 0 || limit <= 0 {
		return "", false
	}
	trimmed := strings.TrimRight(strings.TrimSpace(stmt), "; \t\r\n")
	upper := strings.ToUpper(trimmed)
	if !strings.HasPrefix(upper, "SELECT") {
		return "", false
	}
	for _, kw := range []string{" LIMIT ", " OFFSET ", " FETCH ", " FOR UPDATE", " INTO ", "--", "/*"} {
		if strings.Contains(upper, kw) {
			return "", false
		}
	}
	return fmt.Sprintf("SELECT * FROM (%s) AS dhub_page LIMIT %d OFFSET %d", trimmed, limit+1, offset), true
}

// ExecuteStatements splits a SQL string into individual statements and executes each in sequence.
// It returns a QueryResult containing all individual statement results in Results, with the main
// view defaulting to the last SELECT statement (or the last executed statement).
func ExecuteStatements(ctx context.Context, execer QueryExecer, req QueryRequest) (*QueryResult, error) {
	start := time.Now()
	statements := SplitStatements(req.SQL)
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
			if wrapped, ok := wrapSelectForPaging(stmt, limit, offset); ok {
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

			var resultRows [][]any
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
					if b, ok := v.([]byte); ok {
						rowValues[vIdx] = string(b)
					} else if t, ok := v.(time.Time); ok {
						if t.Nanosecond() != 0 {
							rowValues[vIdx] = t.Format("2006-01-02 15:04:05.000000")
						} else if t.Hour() == 0 && t.Minute() == 0 && t.Second() == 0 && strings.EqualFold(columns[vIdx].DataType, "date") {
							rowValues[vIdx] = t.Format("2006-01-02")
						} else {
							rowValues[vIdx] = t.Format("2006-01-02 15:04:05")
						}
					} else {
						rowValues[vIdx] = v
					}
				}
				resultRows = append(resultRows, rowValues)
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

