package services

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

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
	store     *store.LocalStore
	sessions  *manager.SessionManager
	appGetter func() *application.App
}

func NewExportService(s *store.LocalStore, sm *manager.SessionManager, appGetter func() *application.App) *ExportService {
	return &ExportService{
		store:     s,
		sessions:  sm,
		appGetter: appGetter,
	}
}

// PreviewImportFile parses the first 10 rows of a CSV file for column mapping preview.
func (e *ExportService) PreviewImportFile(filePath, delimiter string, hasHeader bool) (*FilePreview, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer f.Close()

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

// ExportToFile streams query or table rows directly into a file on disk.
func (e *ExportService) ExportToFile(req ExportRequest) (*ExportResult, error) {
	start := time.Now()

	drv, err := e.sessions.GetOrConnect(context.Background(), req.ConnectionID)
	if err != nil {
		return nil, err
	}

	// Prepare query SQL
	querySQL := req.SQL
	if strings.TrimSpace(querySQL) == "" {
		if req.Table == "" {
			return nil, fmt.Errorf("either table name or SQL query must be provided for export")
		}
		if req.Schema != "" && req.Schema != "main" && req.Schema != req.Database {
			querySQL = fmt.Sprintf("SELECT * FROM %s.%s", req.Schema, req.Table)
		} else {
			querySQL = fmt.Sprintf("SELECT * FROM %s", req.Table)
		}
	}

	// Execute without pagination limit to stream full dataset
	qReq := driver.QueryRequest{
		ExecutionID:  "export-" + fmt.Sprintf("%d", time.Now().UnixNano()),
		ConnectionID: req.ConnectionID,
		Database:     req.Database,
		Schema:       req.Schema,
		SQL:          querySQL,
		Limit:        1000000, // Export up to 1M rows
		Offset:       0,
	}

	res, err := drv.Execute(context.Background(), qReq)
	if err != nil {
		return nil, fmt.Errorf("query execution failed: %w", err)
	}

	f, err := os.Create(req.FilePath)
	if err != nil {
		return nil, fmt.Errorf("failed to create export file: %w", err)
	}
	defer f.Close()

	var exportedRows int64

	switch strings.ToLower(req.Format) {
	case "json":
		encoder := json.NewEncoder(f)
		encoder.SetIndent("", "  ")

		colNames := make([]string, len(res.Columns))
		for i, col := range res.Columns {
			colNames[i] = col.Name
		}

		var objList []map[string]any
		for _, row := range res.Rows {
			obj := make(map[string]any, len(colNames))
			for i, val := range row {
				if i < len(colNames) {
					obj[colNames[i]] = val
				}
			}
			objList = append(objList, obj)
			exportedRows++
		}
		if err := encoder.Encode(objList); err != nil {
			return nil, fmt.Errorf("failed to encode JSON export: %w", err)
		}

	case "sql_insert", "sql":
		targetTable := req.Table
		if targetTable == "" {
			targetTable = "exported_table"
		}
		colNames := make([]string, len(res.Columns))
		for i, col := range res.Columns {
			colNames[i] = fmt.Sprintf("%q", col.Name)
		}
		colsJoined := strings.Join(colNames, ", ")

		for _, row := range res.Rows {
			valStrs := make([]string, len(row))
			for i, v := range row {
				if v == nil {
					valStrs[i] = "NULL"
				} else {
					s := fmt.Sprintf("%v", v)
					valStrs[i] = "'" + strings.ReplaceAll(s, "'", "''") + "'"
				}
			}
			stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);\n", targetTable, colsJoined, strings.Join(valStrs, ", "))
			if _, err := f.WriteString(stmt); err != nil {
				return nil, err
			}
			exportedRows++
		}

	default: // CSV
		delimRune := ','
		if req.Delimiter == ";" {
			delimRune = ';'
		} else if req.Delimiter == "\t" {
			delimRune = '\t'
		}

		writer := csv.NewWriter(f)
		writer.Comma = delimRune

		if req.IncludeHeader {
			headers := make([]string, len(res.Columns))
			for i, col := range res.Columns {
				headers[i] = col.Name
			}
			if err := writer.Write(headers); err != nil {
				return nil, err
			}
		}

		for _, row := range res.Rows {
			strRow := make([]string, len(row))
			for i, v := range row {
				if v == nil {
					strRow[i] = ""
				} else {
					strRow[i] = fmt.Sprintf("%v", v)
				}
			}
			if err := writer.Write(strRow); err != nil {
				return nil, err
			}
			exportedRows++
		}
		writer.Flush()
		if err := writer.Error(); err != nil {
			return nil, err
		}
	}

	fi, _ := f.Stat()
	var fileSize int64
	if fi != nil {
		fileSize = fi.Size()
	}

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

	cfg, cfgErr := e.store.GetConnection(context.Background(), req.ConnectionID)
	if cfgErr == nil && cfg != nil && cfg.IsReadOnly {
		return nil, fmt.Errorf("import blocked: connection %q is configured as read-only", cfg.Name)
	}

	drv, err := e.sessions.GetOrConnect(context.Background(), req.ConnectionID)
	if err != nil {
		return nil, err
	}

	f, err := os.Open(req.FilePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open import file: %w", err)
	}
	defer f.Close()

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

	var batch []driver.RowChange
	var totalImported int64
	const batchSize = 250

	flushBatch := func() error {
		if len(batch) == 0 {
			return nil
		}
		affected, err := drv.ApplyChanges(context.Background(), req.Database, req.Schema, req.Table, batch)
		if err != nil {
			return fmt.Errorf("failed to apply batch of %d rows: %w", len(batch), err)
		}
		totalImported += affected
		batch = batch[:0]
		return nil
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

	return &ImportResult{
		RowsImported: totalImported,
		ElapsedMs:    time.Since(start).Milliseconds(),
	}, nil
}
