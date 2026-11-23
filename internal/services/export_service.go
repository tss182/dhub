package services

import (
	"bufio"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"dhub/internal/app"
	"dhub/internal/driver"
	"dhub/internal/manager"
	"dhub/internal/store"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type ExportRequest struct {
	ConnectionID string `json:"connectionId"`
	Database     string `json:"database"`
	Schema       string `json:"schema"`
	Table        string `json:"table"`
	SQL          string `json:"sql"`
	Format       string `json:"format"` // "csv" | "json" | "sql_insert"
	FilePath     string `json:"filePath"`
	Delimiter    string `json:"delimiter"`      // e.g. ",", ";", "\t"
	IncludeHeader bool   `json:"includeHeader"`
}

type ExportResult struct {
	RowsExported int64  `json:"rowsExported"`
	FileSize     int64  `json:"fileSize"`
	ElapsedMs    int64  `json:"elapsedMs"`
	FilePath     string `json:"filePath"`
}

type ColumnMapping struct {
	FileColumn  string `json:"fileColumn"`
	TableColumn string `json:"tableColumn"`
}

type ImportRequest struct {
	ConnectionID string          `json:"connectionId"`
	Database     string          `json:"database"`
	Schema       string          `json:"schema"`
	Table        string          `json:"table"`
	FilePath     string          `json:"filePath"`
	Format       string          `json:"format"` // "csv" | "json"
	Delimiter    string          `json:"delimiter"`
	HasHeader    bool            `json:"hasHeader"`
	Mappings     []ColumnMapping `json:"mappings"`
}

type ImportResult struct {
	RowsImported int64 `json:"rowsImported"`
	ElapsedMs    int64 `json:"elapsedMs"`
}

type FilePreview struct {
	Columns []string   `json:"columns"`
	Rows    [][]string `json:"rows"`
}

type ExportService struct {
	store      *store.LocalStore
	sessions   *manager.SessionManager
	appGetter  func() *application.App
	mu         sync.Mutex
	runningOps map[string]context.CancelFunc
}

func NewExportService(s *store.LocalStore, sm *manager.SessionManager, appGetter func() *application.App) *ExportService {
	return &ExportService{
		store:      s,
		sessions:   sm,
		appGetter:  appGetter,
		runningOps: make(map[string]context.CancelFunc),
	}
}

func (e *ExportService) registerOp(opID string, cancel context.CancelFunc) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.runningOps == nil {
		e.runningOps = make(map[string]context.CancelFunc)
	}
	e.runningOps[opID] = cancel
}

func (e *ExportService) unregisterOp(opID string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	delete(e.runningOps, opID)
}

// CancelExportImport cancels an active export or import operation by ID (or all active ops if empty).
func (e *ExportService) CancelExportImport(operationID string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if operationID != "" {
		if cancel, ok := e.runningOps[operationID]; ok && cancel != nil {
			cancel()
			return true
		}
		return false
	}
	cancelled := false
	for _, cancel := range e.runningOps {
		if cancel != nil {
			cancel()
			cancelled = true
		}
	}
	return cancelled
}

func (e *ExportService) emitProgress(opID, kind, status string, rowsDone int64, msg string) {
	if e.appGetter == nil {
		return
	}
	if a := e.appGetter(); a != nil {
		a.Event.Emit("export:progress", app.ExportProgressEvent{
			OperationID: opID,
			Kind:        kind,
			Status:      status,
			RowsDone:    rowsDone,
			Message:     msg,
		})
	}
}

// PreviewImportFile parses the first 10 rows of a CSV or JSON file for column mapping preview.
func (e *ExportService) PreviewImportFile(filePath, delimiter string, hasHeader bool) (*FilePreview, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer f.Close()

	lowerPath := strings.ToLower(filePath)
	if strings.HasSuffix(lowerPath, ".jsonl") || strings.HasSuffix(lowerPath, ".ndjson") {
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)
		var rawList []map[string]any
		for scanner.Scan() && len(rawList) < 10 {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var item map[string]any
			if err := json.Unmarshal([]byte(line), &item); err != nil {
				return nil, fmt.Errorf("invalid JSONL line: %w", err)
			}
			rawList = append(rawList, flattenQdrantPointRecord(item))
		}
		if err := scanner.Err(); err != nil {
			return nil, fmt.Errorf("failed to read JSONL file: %w", err)
		}
		if len(rawList) == 0 {
			return nil, fmt.Errorf("JSONL file contains no valid JSON objects")
		}
		return buildJSONFilePreview(rawList), nil
	}

	if strings.HasSuffix(lowerPath, ".json") {
		byteData, err := io.ReadAll(io.LimitReader(f, 2*1024*1024))
		if err != nil {
			return nil, fmt.Errorf("failed to read JSON file: %w", err)
		}
		var rawList []map[string]any
		if err := json.Unmarshal(byteData, &rawList); err != nil {
			var wrapper map[string]any
			if err2 := json.Unmarshal(byteData, &wrapper); err2 == nil {
				for _, val := range wrapper {
					if arr, ok := val.([]any); ok {
						for _, item := range arr {
							if m, ok := item.(map[string]any); ok {
								rawList = append(rawList, m)
							}
						}
						if len(rawList) > 0 {
							break
						}
					}
				}
			}
		}

		if len(rawList) == 0 {
			return nil, fmt.Errorf("JSON file must contain an array of objects or an object containing an array")
		}

		return buildJSONFilePreview(rawList), nil
	}

	delimRune := ','
	if delimiter == ";" {
		delimRune = ';'
	} else if delimiter == "\t" {
		delimRune = '\t'
	}

	reader := csv.NewReader(f)
	reader.Comma = delimRune
	reader.LazyQuotes = true
	reader.FieldsPerRecord = -1

	var columns []string
	var previewRows [][]string

	count := 0
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("error reading CSV file: %w", err)
		}

		if count == 0 && hasHeader {
			columns = record
		} else {
			if len(columns) == 0 {
				for i := range record {
					columns = append(columns, fmt.Sprintf("Column_%d", i+1))
				}
			}
			previewRows = append(previewRows, record)
			if len(previewRows) >= 10 {
				break
			}
		}
		count++
	}

	return &FilePreview{
		Columns: columns,
		Rows:    previewRows,
	}, nil
}

// quoteIdentifier safely quotes table/schema/column identifiers based on database driver.
func quoteIdentifier(driverType, name string) string {
	if name == "" {
		return ""
	}
	switch strings.ToLower(driverType) {
	case "mysql", "mariadb", "clickhouse":
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	case "postgres", "sqlite", "oracle":
		return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
	case "mssql", "sqlserver":
		return "[" + strings.ReplaceAll(name, "]", "]]") + "]"
	case "redis", "mongodb", "mongo", "qdrant", "elasticsearch", "es":
		return name
	default:
		return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
	}
}

// ExportToFile streams query or table rows directly into a file on disk.
func (e *ExportService) ExportToFile(req ExportRequest) (*ExportResult, error) {
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	opID := fmt.Sprintf("export-%d", start.UnixNano())
	e.registerOp(opID, cancel)
	defer e.unregisterOp(opID)

	drv, err := e.sessions.GetOrConnect(ctx, req.ConnectionID)
	if err != nil {
		e.emitProgress(opID, "export", "error", 0, err.Error())
		return nil, err
	}

	var driverType string
	if cfg, err := e.store.GetConnection(context.Background(), req.ConnectionID); err == nil && cfg != nil {
		driverType = cfg.Driver
	}

	// Prepare query SQL
	querySQL := req.SQL
	if strings.TrimSpace(querySQL) == "" {
		if req.Table == "" {
			return nil, fmt.Errorf("either table name or SQL query must be provided for export")
		}
		quotedTable := quoteIdentifier(driverType, req.Table)
		if req.Schema != "" && req.Schema != "main" && req.Schema != req.Database {
			quotedSchema := quoteIdentifier(driverType, req.Schema)
			querySQL = fmt.Sprintf("SELECT * FROM %s.%s", quotedSchema, quotedTable)
		} else {
			querySQL = fmt.Sprintf("SELECT * FROM %s", quotedTable)
		}
	}

	// Stream dataset in chunks to avoid loading up to 1M rows into RAM at once.
	const chunkSize = 5000
	const maxExportRows = 1000000

	f, err := os.Create(req.FilePath)
	if err != nil {
		return nil, fmt.Errorf("failed to create export file: %w", err)
	}
	defer f.Close()

	bw := bufio.NewWriterSize(f, 32*1024)
	format := strings.ToLower(req.Format)

	var csvWriter *csv.Writer
	var xlsxWriter *xlsxStreamWriter
	switch format {
	case "xlsx":
		xlsxWriter, err = newXLSXStreamWriter(f)
		if err != nil {
			return nil, fmt.Errorf("failed to initialize xlsx writer: %w", err)
		}
	case "json", "sql_insert", "sql", "markdown", "md":
	default:
		delimRune := ','
		if req.Delimiter == ";" {
			delimRune = ';'
		} else if req.Delimiter == "\t" {
			delimRune = '\t'
		}
		csvWriter = csv.NewWriter(bw)
		csvWriter.Comma = delimRune
	}

	var exportedRows int64
	var colNames []string
	var sqlTargetTable string
	var sqlColsJoined string
	var jsonObj map[string]any
	headerWritten := false

	offset := 0
	for exportedRows < maxExportRows {
		remaining := maxExportRows - int(exportedRows)
		limit := chunkSize
		if remaining < limit {
			limit = remaining
		}

		qReq := driver.QueryRequest{
			ExecutionID:  "export-" + fmt.Sprintf("%d", time.Now().UnixNano()),
			ConnectionID: req.ConnectionID,
			Database:     req.Database,
			Schema:       req.Schema,
			SQL:          querySQL,
			Limit:        limit,
			Offset:       offset,
		}

		res, err := drv.Execute(ctx, qReq)
		if err != nil {
			if ctx.Err() == context.Canceled {
				e.emitProgress(opID, "export", "cancelled", exportedRows, "Export cancelled")
			} else {
				e.emitProgress(opID, "export", "error", exportedRows, err.Error())
			}
			return nil, fmt.Errorf("query execution failed: %w", err)
		}

		if !headerWritten {
			headerWritten = true
			switch format {
			case "json":
				colNames = make([]string, len(res.Columns))
				for i, col := range res.Columns {
					colNames[i] = col.Name
				}
				jsonObj = make(map[string]any, len(colNames))
				if _, err := bw.WriteString("[\n"); err != nil {
					return nil, fmt.Errorf("failed to write JSON export: %w", err)
				}
			case "jsonl", "ndjson":
				colNames = make([]string, len(res.Columns))
				for i, col := range res.Columns {
					colNames[i] = col.Name
				}
				jsonObj = make(map[string]any, len(colNames))
			case "sql_insert", "sql":
				sqlTargetTable = req.Table
				if sqlTargetTable == "" {
					sqlTargetTable = "exported_table"
				} else {
					sqlTargetTable = quoteIdentifier(driverType, sqlTargetTable)
				}
				quotedCols := make([]string, len(res.Columns))
				for i, col := range res.Columns {
					quotedCols[i] = quoteIdentifier(driverType, col.Name)
				}
				sqlColsJoined = strings.Join(quotedCols, ", ")
			case "markdown", "md":
				if len(res.Columns) > 0 {
					headers := make([]string, len(res.Columns))
					seps := make([]string, len(res.Columns))
					for i, col := range res.Columns {
						headers[i] = strings.ReplaceAll(col.Name, "|", "\\|")
						seps[i] = "---"
					}
					if _, err := bw.WriteString("| " + strings.Join(headers, " | ") + " |\n| " + strings.Join(seps, " | ") + " |\n"); err != nil {
						return nil, err
					}
				}
			case "xlsx":
				if req.IncludeHeader && len(res.Columns) > 0 {
					headers := make([]any, len(res.Columns))
					for i, col := range res.Columns {
						headers[i] = col.Name
					}
					if err := xlsxWriter.writeRow(headers); err != nil {
						return nil, err
					}
				}
			default:
				if req.IncludeHeader && len(res.Columns) > 0 {
					headers := make([]string, len(res.Columns))
					for i, col := range res.Columns {
						headers[i] = col.Name
					}
					if err := csvWriter.Write(headers); err != nil {
						return nil, err
					}
				}
			}
		}

		rowCount := len(res.Rows)
		if rowCount == 0 {
			res = nil
			break
		}

		switch format {
		case "jsonl", "ndjson":
			for _, row := range res.Rows {
				var outRecord map[string]any
				if driverType == "qdrant" {
					pt := map[string]any{"payload": map[string]any{}}
					payload := pt["payload"].(map[string]any)
					var namedVecs map[string]any
					for i, val := range row {
						if i >= len(colNames) {
							continue
						}
						col := colNames[i]
						if col == "score" {
							continue
						} else if col == "id" {
							pt["id"] = val
						} else if col == "vector" {
							pt["vector"] = parseJSONIfPossible(val)
						} else if strings.HasPrefix(col, "vector.") {
							if namedVecs == nil {
								namedVecs = make(map[string]any)
							}
							namedVecs[strings.TrimPrefix(col, "vector.")] = parseJSONIfPossible(val)
						} else if val != nil {
							payload[col] = parseJSONIfPossible(val)
						}
					}
					if namedVecs != nil {
						pt["vector"] = namedVecs
					}
					outRecord = pt
				} else {
					clear(jsonObj)
					for i, val := range row {
						if i < len(colNames) {
							jsonObj[colNames[i]] = val
						}
					}
					outRecord = jsonObj
				}
				raw, err := json.Marshal(outRecord)
				if err != nil {
					return nil, fmt.Errorf("failed to encode JSONL export: %w", err)
				}
				if _, err := bw.Write(raw); err != nil {
					return nil, err
				}
				if err := bw.WriteByte('\n'); err != nil {
					return nil, err
				}
				exportedRows++
			}

		case "json":
			for _, row := range res.Rows {
				clear(jsonObj)
				for i, val := range row {
					if i < len(colNames) {
						jsonObj[colNames[i]] = val
					}
				}
				raw, err := json.MarshalIndent(jsonObj, "  ", "  ")
				if err != nil {
					return nil, fmt.Errorf("failed to encode JSON export: %w", err)
				}
				if exportedRows > 0 {
					if _, err := bw.WriteString(",\n"); err != nil {
						return nil, err
					}
				}
				if _, err := bw.WriteString("  "); err != nil {
					return nil, err
				}
				if _, err := bw.Write(raw); err != nil {
					return nil, err
				}
				exportedRows++
			}

		case "sql_insert", "sql":
			for _, row := range res.Rows {
				valStrs := make([]string, len(row))
				for i, v := range row {
					valStrs[i] = formatSQLValue(driverType, v)
				}
				stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);\n", sqlTargetTable, sqlColsJoined, strings.Join(valStrs, ", "))
				if _, err := bw.WriteString(stmt); err != nil {
					return nil, err
				}
				exportedRows++
			}

		case "markdown", "md":
			for _, row := range res.Rows {
				cells := make([]string, len(row))
				for i, v := range row {
					if v == nil {
						cells[i] = "_NULL_"
					} else {
						s := strings.ReplaceAll(fmt.Sprintf("%v", v), "|", "\\|")
						s = strings.ReplaceAll(s, "\r\n", "<br>")
						s = strings.ReplaceAll(s, "\n", "<br>")
						cells[i] = s
					}
				}
				if _, err := bw.WriteString("| " + strings.Join(cells, " | ") + " |\n"); err != nil {
					return nil, err
				}
				exportedRows++
			}

		case "xlsx":
			for _, row := range res.Rows {
				if err := xlsxWriter.writeRow(row); err != nil {
					return nil, err
				}
				exportedRows++
			}

		default:
			for _, row := range res.Rows {
				strRow := make([]string, len(row))
				for i, v := range row {
					if v == nil {
						strRow[i] = ""
					} else {
						strRow[i] = fmt.Sprintf("%v", v)
					}
				}
				if err := csvWriter.Write(strRow); err != nil {
					return nil, err
				}
				exportedRows++
			}
		}

		hasMore := res.HasMore && rowCount >= limit
		res = nil
		e.emitProgress(opID, "export", "running", exportedRows, fmt.Sprintf("Exported %d rows...", exportedRows))
		if !hasMore {
			break
		}
		offset += rowCount
	}

	switch format {
	case "json":
		if _, err := bw.WriteString("\n]\n"); err != nil {
			return nil, err
		}
		if err := bw.Flush(); err != nil {
			return nil, err
		}
	case "jsonl", "ndjson", "sql_insert", "sql", "markdown", "md":
		if err := bw.Flush(); err != nil {
			return nil, err
		}
	case "xlsx":
		if err := xlsxWriter.Close(); err != nil {
			return nil, err
		}
	default:
		csvWriter.Flush()
		if err := csvWriter.Error(); err != nil {
			return nil, err
		}
		if err := bw.Flush(); err != nil {
			return nil, err
		}
	}

	// Release large result buffers promptly on low-memory systems.
	if exportedRows > 1000 {
		debug.FreeOSMemory()
	}

	fi, _ := f.Stat()
	var fileSize int64
	if fi != nil {
		fileSize = fi.Size()
	}

	e.emitProgress(opID, "export", "completed", exportedRows, fmt.Sprintf("Exported %d rows", exportedRows))

	return &ExportResult{
		RowsExported: exportedRows,
		FileSize:     fileSize,
		ElapsedMs:    time.Since(start).Milliseconds(),
		FilePath:     req.FilePath,
	}, nil
}

// ImportFileToTable imports CSV rows into a database table using batch inserts.
func (e *ExportService) ImportFileToTable(req ImportRequest) (*ImportResult, error) {
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	opID := fmt.Sprintf("import-%d", start.UnixNano())
	e.registerOp(opID, cancel)
	defer e.unregisterOp(opID)

	cfg, cfgErr := e.store.GetConnection(ctx, req.ConnectionID)
	if cfgErr == nil && cfg != nil && cfg.IsReadOnly {
		return nil, fmt.Errorf("import blocked: connection %q is configured as read-only", cfg.Name)
	}

	drv, err := e.sessions.GetOrConnect(ctx, req.ConnectionID)
	if err != nil {
		e.emitProgress(opID, "import", "error", 0, err.Error())
		return nil, err
	}

	f, err := os.Open(req.FilePath)
	if err != nil {
		e.emitProgress(opID, "import", "error", 0, err.Error())
		return nil, fmt.Errorf("failed to open import file: %w", err)
	}
	defer f.Close()

	var batch []driver.RowChange
	var totalImported int64
	const batchSize = 250

	flushBatch := func() error {
		if len(batch) == 0 {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		affected, err := drv.ApplyChanges(ctx, req.Database, req.Schema, req.Table, batch)
		if err != nil {
			e.emitProgress(opID, "import", "error", totalImported, err.Error())
			return fmt.Errorf("failed to apply batch of %d rows: %w", len(batch), err)
		}
		totalImported += affected
		batch = batch[:0]
		e.emitProgress(opID, "import", "running", totalImported, fmt.Sprintf("Imported %d rows...", totalImported))
		return nil
	}

	isJSONL := strings.EqualFold(req.Format, "jsonl") ||
		strings.EqualFold(req.Format, "ndjson") ||
		strings.HasSuffix(strings.ToLower(req.FilePath), ".jsonl") ||
		strings.HasSuffix(strings.ToLower(req.FilePath), ".ndjson")
	if isJSONL {
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var rawItem map[string]any
			if err := json.Unmarshal([]byte(line), &rawItem); err != nil {
				return nil, fmt.Errorf("error decoding JSONL record: %w", err)
			}
			item := flattenQdrantPointRecord(rawItem)
			changes := make(map[string]any, len(req.Mappings))
			for _, m := range req.Mappings {
				if m.TableColumn == "" {
					continue
				}
				if val, ok := item[m.FileColumn]; ok {
					changes[m.TableColumn] = val
				}
			}
			if len(changes) > 0 {
				batch = append(batch, driver.RowChange{
					Type:    "insert",
					Changes: changes,
				})
				if len(batch) >= batchSize {
					if err := flushBatch(); err != nil {
						return nil, err
					}
				}
			}
		}
		if err := scanner.Err(); err != nil {
			return nil, fmt.Errorf("error reading JSONL file: %w", err)
		}
		if err := flushBatch(); err != nil {
			return nil, err
		}
		return &ImportResult{
			RowsImported: totalImported,
			ElapsedMs:    time.Since(start).Milliseconds(),
		}, nil
	}

	isJSON := strings.EqualFold(req.Format, "json") || strings.HasSuffix(strings.ToLower(req.FilePath), ".json")
	if isJSON {
		decoder := json.NewDecoder(f)
		tok, err := decoder.Token()
		if err != nil {
			return nil, fmt.Errorf("invalid JSON file: %w", err)
		}

		handleObject := func(item map[string]any) error {
			changes := make(map[string]any, len(req.Mappings))
			for _, m := range req.Mappings {
				if m.TableColumn == "" {
					continue
				}
				if val, ok := item[m.FileColumn]; ok {
					changes[m.TableColumn] = val
				}
			}
			if len(changes) > 0 {
				batch = append(batch, driver.RowChange{
					Type:    "insert",
					Changes: changes,
				})
				if len(batch) >= batchSize {
					if err := flushBatch(); err != nil {
						return err
					}
				}
			}
			return nil
		}

		if delim, ok := tok.(json.Delim); ok && delim == '[' {
			for decoder.More() {
				var item map[string]any
				if err := decoder.Decode(&item); err != nil {
					return nil, fmt.Errorf("error decoding JSON record: %w", err)
				}
				if err := handleObject(item); err != nil {
					return nil, err
				}
			}
		} else {
			byteData, _ := io.ReadAll(f)
			var wrapper map[string]any
			if err := json.Unmarshal(byteData, &wrapper); err == nil {
				for _, val := range wrapper {
					if arr, ok := val.([]any); ok {
						for _, item := range arr {
							if m, ok := item.(map[string]any); ok {
								if err := handleObject(m); err != nil {
									return nil, err
								}
							}
						}
					}
				}
			}
		}

		if err := flushBatch(); err != nil {
			return nil, err
		}

		return &ImportResult{
			RowsImported: totalImported,
			ElapsedMs:    time.Since(start).Milliseconds(),
		}, nil
	}

	delimRune := ','
	if req.Delimiter == ";" {
		delimRune = ';'
	} else if req.Delimiter == "\t" {
		delimRune = '\t'
	}

	reader := csv.NewReader(f)
	reader.Comma = delimRune
	reader.LazyQuotes = true
	reader.FieldsPerRecord = -1

	var headerMap map[string]int
	if req.HasHeader {
		header, err := reader.Read()
		if err != nil {
			return nil, fmt.Errorf("failed to read CSV header: %w", err)
		}
		headerMap = make(map[string]int, len(header))
		for i, h := range header {
			headerMap[strings.TrimSpace(h)] = i
		}
	}

	rowIndex := 0
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read error on row %d: %w", rowIndex+1, err)
		}

		changes := make(map[string]any, len(req.Mappings))
		for _, m := range req.Mappings {
			if m.TableColumn == "" {
				continue
			}
			var val string
			if headerMap != nil {
				if colIdx, ok := headerMap[m.FileColumn]; ok && colIdx < len(record) {
					val = record[colIdx]
				}
			} else {
				// Mappings contain Column_1, Column_2 etc.
				var colIdx int
				if _, sErr := fmt.Sscanf(m.FileColumn, "Column_%d", &colIdx); sErr == nil && colIdx-1 < len(record) {
					val = record[colIdx-1]
				}
			}

			if strings.EqualFold(strings.TrimSpace(val), "null") || strings.TrimSpace(val) == "" {
				changes[m.TableColumn] = nil
			} else {
				changes[m.TableColumn] = strings.TrimSpace(val)
			}
		}

		if len(changes) > 0 {
			batch = append(batch, driver.RowChange{
				Type:    "insert",
				Changes: changes,
			})
			if len(batch) >= batchSize {
				if err := flushBatch(); err != nil {
					return nil, err
				}
			}
		}
		rowIndex++
	}

	if err := flushBatch(); err != nil {
		return nil, err
	}

	e.emitProgress(opID, "import", "completed", totalImported, fmt.Sprintf("Imported %d rows", totalImported))

	return &ImportResult{
		RowsImported: totalImported,
		ElapsedMs:    time.Since(start).Milliseconds(),
	}, nil
}

func parseJSONIfPossible(val any) any {
	s, ok := val.(string)
	if !ok {
		return val
	}
	trimmed := strings.TrimSpace(s)
	if (strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}")) ||
		(strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]")) {
		var parsed any
		if json.Unmarshal([]byte(trimmed), &parsed) == nil {
			return parsed
		}
	}
	return val
}

func flattenQdrantPointRecord(item map[string]any) map[string]any {
	payloadRaw, hasPayload := item["payload"]
	if !hasPayload {
		return item
	}
	payloadMap, ok := payloadRaw.(map[string]any)
	if !ok {
		return item
	}
	flat := make(map[string]any, len(payloadMap)+4)
	if id, exists := item["id"]; exists {
		flat["id"] = id
	}
	if vec, exists := item["vector"]; exists && vec != nil {
		if vecMap, isMap := vec.(map[string]any); isMap {
			if _, isSparse := vecMap["indices"]; isSparse {
				flat["vector"] = vec
			} else {
				for k, v := range vecMap {
					flat["vector."+k] = v
				}
			}
		} else {
			flat["vector"] = vec
		}
	}
	for k, v := range payloadMap {
		flat[k] = v
	}
	return flat
}

func buildJSONFilePreview(rawList []map[string]any) *FilePreview {
	colSet := make(map[string]bool)
	var columns []string
	for _, item := range rawList {
		for k := range item {
			if !colSet[k] {
				colSet[k] = true
				columns = append(columns, k)
			}
		}
	}
	var previewRows [][]string
	for idx, item := range rawList {
		if idx >= 10 {
			break
		}
		row := make([]string, len(columns))
		for cIdx, col := range columns {
			if v, ok := item[col]; ok && v != nil {
				switch vt := v.(type) {
				case string:
					row[cIdx] = vt
				case []any, map[string]any:
					if b, err := json.Marshal(vt); err == nil {
						row[cIdx] = string(b)
					} else {
						row[cIdx] = fmt.Sprintf("%v", v)
					}
				default:
					row[cIdx] = fmt.Sprintf("%v", v)
				}
			} else {
				row[cIdx] = ""
			}
		}
		previewRows = append(previewRows, row)
	}
	return &FilePreview{
		Columns: columns,
		Rows:    previewRows,
	}
}
