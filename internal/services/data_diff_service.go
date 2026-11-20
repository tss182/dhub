package services

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"dhub/internal/driver"
)

type DataDiffRequest struct {
	SrcConnID string   `json:"srcConnId"`
	SrcDB     string   `json:"srcDb"`
	SrcSchema string   `json:"srcSchema"`
	SrcTable  string   `json:"srcTable"`
	DstConnID string   `json:"dstConnId"`
	DstDB     string   `json:"dstDb"`
	DstSchema string   `json:"dstSchema"`
	DstTable  string   `json:"dstTable"`
	KeyCols   []string `json:"keyCols,omitempty"`
	Limit     int      `json:"limit,omitempty"`
}

type DataRowDiff struct {
	Key        string         `json:"key"`
	Status     string         `json:"status"` // "added" | "removed" | "modified"
	SrcRow     map[string]any `json:"srcRow,omitempty"`
	DstRow     map[string]any `json:"dstRow,omitempty"`
	DiffFields []string       `json:"diffFields,omitempty"`
}

type DataDiffResult struct {
	Columns     []string           `json:"columns"`
	KeyColumns  []string           `json:"keyColumns"`
	Identical   int                `json:"identical"`
	Added       int                `json:"added"`
	Removed     int                `json:"removed"`
	Modified    int                `json:"modified"`
	Truncated   bool               `json:"truncated"`
	RowDiffs    []DataRowDiff      `json:"rowDiffs"`
	SyncSQL     string             `json:"syncSql"`
	SyncChanges []driver.RowChange `json:"syncChanges"`
}

func qualifyTableForQuery(drvType, db, schema, table string) string {
	qTable := quoteIdentifier(drvType, table)
	d := strings.ToLower(strings.TrimSpace(drvType))
	if d == "mysql" || d == "mariadb" || d == "clickhouse" {
		targetDB := schema
		if targetDB == "" || targetDB == "main" {
			targetDB = db
		}
		if targetDB != "" && targetDB != "main" {
			return quoteIdentifier(drvType, targetDB) + "." + qTable
		}
		return qTable
	}
	if schema != "" && schema != "main" {
		return quoteIdentifier(drvType, schema) + "." + qTable
	}
	return qTable
}

func buildRowKey(rowMap map[string]any, keyCols []string) string {
	if len(keyCols) == 1 {
		return fmt.Sprintf("%v", rowMap[keyCols[0]])
	}
	parts := make([]string, len(keyCols))
	for i, k := range keyCols {
		parts[i] = fmt.Sprintf("%v", rowMap[k])
	}
	return strings.Join(parts, "|")
}

func normalizeCellForCompare(v any) string {
	if v == nil {
		return "<nil>"
	}
	return fmt.Sprintf("%v", v)
}

// CompareTableData compares rows between two tables across connections/databases using primary/key columns
// and generates dialect-accurate INSERT/UPDATE/DELETE sync statements for the target table.
func (s *SchemaService) CompareTableData(req DataDiffRequest) (*DataDiffResult, error) {
	if req.SrcConnID == "" || req.SrcTable == "" || req.DstConnID == "" || req.DstTable == "" {
		return nil, fmt.Errorf("source and target connections and tables are required")
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 2000
	}
	if limit > 10000 {
		limit = 10000
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	srcDrv, err := s.sessions.GetOrConnect(ctx, req.SrcConnID)
	if err != nil {
		return nil, fmt.Errorf("source connection failed: %w", err)
	}
	dstDrv, err := s.sessions.GetOrConnect(ctx, req.DstConnID)
	if err != nil {
		return nil, fmt.Errorf("target connection failed: %w", err)
	}

	srcDriverType := ""
	if c, cErr := s.store.GetConnection(ctx, req.SrcConnID); cErr == nil && c != nil {
		srcDriverType = c.Driver
	}
	dstDriverType := ""
	if c, cErr := s.store.GetConnection(ctx, req.DstConnID); cErr == nil && c != nil {
		dstDriverType = c.Driver
	}

	var srcStruct, dstStruct *driver.TableStructure
	var srcStructErr, dstStructErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		srcStruct, srcStructErr = srcDrv.GetTableStructure(ctx, req.SrcDB, req.SrcSchema, req.SrcTable)
	}()
	go func() {
		defer wg.Done()
		dstStruct, dstStructErr = dstDrv.GetTableStructure(ctx, req.DstDB, req.DstSchema, req.DstTable)
	}()
	wg.Wait()

	if srcStructErr != nil {
		return nil, fmt.Errorf("failed to inspect source table: %w", srcStructErr)
	}
	if dstStructErr != nil {
		return nil, fmt.Errorf("failed to inspect target table: %w", dstStructErr)
	}

	keyCols := make([]string, 0)
	for _, k := range req.KeyCols {
		k = strings.TrimSpace(k)
		if k != "" {
			keyCols = append(keyCols, k)
		}
	}
	if len(keyCols) == 0 {
		if len(dstStruct.PrimaryKeys) > 0 {
			keyCols = append(keyCols, dstStruct.PrimaryKeys...)
		} else if len(srcStruct.PrimaryKeys) > 0 {
			keyCols = append(keyCols, srcStruct.PrimaryKeys...)
		}
	}
	if len(keyCols) == 0 {
		return nil, fmt.Errorf("no primary key found on %s or %s; please specify Key Columns", req.SrcTable, req.DstTable)
	}

	buildOrderBy := func(drvType string) string {
		parts := make([]string, len(keyCols))
		for i, k := range keyCols {
			parts[i] = quoteIdentifier(drvType, k)
		}
		return strings.Join(parts, ", ")
	}

	srcSQL := fmt.Sprintf("SELECT * FROM %s ORDER BY %s", qualifyTableForQuery(srcDriverType, req.SrcDB, req.SrcSchema, req.SrcTable), buildOrderBy(srcDriverType))
	dstSQL := fmt.Sprintf("SELECT * FROM %s ORDER BY %s", qualifyTableForQuery(dstDriverType, req.DstDB, req.DstSchema, req.DstTable), buildOrderBy(dstDriverType))

	var srcRes, dstRes *driver.QueryResult
	var srcExecErr, dstExecErr error
	wg.Add(2)
	go func() {
		defer wg.Done()
		srcRes, srcExecErr = srcDrv.Execute(ctx, driver.QueryRequest{
			ExecutionID:  fmt.Sprintf("datadiff-src-%d", time.Now().UnixNano()),
			ConnectionID: req.SrcConnID,
			Database:     req.SrcDB,
			Schema:       req.SrcSchema,
			SQL:          srcSQL,
			Limit:        limit + 1,
		})
	}()
	go func() {
		defer wg.Done()
		dstRes, dstExecErr = dstDrv.Execute(ctx, driver.QueryRequest{
			ExecutionID:  fmt.Sprintf("datadiff-dst-%d", time.Now().UnixNano()),
			ConnectionID: req.DstConnID,
			Database:     req.DstDB,
			Schema:       req.DstSchema,
			SQL:          dstSQL,
			Limit:        limit + 1,
		})
	}()
	wg.Wait()

	if srcExecErr != nil {
		return nil, fmt.Errorf("failed to query source table: %w", srcExecErr)
	}
	if dstExecErr != nil {
		return nil, fmt.Errorf("failed to query target table: %w", dstExecErr)
	}

	truncated := len(srcRes.Rows) > limit || len(dstRes.Rows) > limit
	if len(srcRes.Rows) > limit {
		srcRes.Rows = srcRes.Rows[:limit]
	}
	if len(dstRes.Rows) > limit {
		dstRes.Rows = dstRes.Rows[:limit]
	}

	indexRows := func(res *driver.QueryResult) (map[string]map[string]any, []string) {
		colNames := make([]string, len(res.Columns))
		for i, c := range res.Columns {
			colNames[i] = c.Name
		}
		indexed := make(map[string]map[string]any, len(res.Rows))
		for _, row := range res.Rows {
			m := make(map[string]any, len(colNames))
			for i, col := range colNames {
				if i < len(row) {
					m[col] = row[i]
				}
			}
			k := buildRowKey(m, keyCols)
			indexed[k] = m
		}
		return indexed, colNames
	}

	srcMap, srcCols := indexRows(srcRes)
	dstMap, dstCols := indexRows(dstRes)

	// Determine common columns (preserving target column names for DML generation)
	srcColLookup := make(map[string]string, len(srcCols))
	for _, c := range srcCols {
		srcColLookup[strings.ToLower(c)] = c
	}
	commonCols := make([]string, 0, len(dstCols))
	for _, dc := range dstCols {
		if _, ok := srcColLookup[strings.ToLower(dc)]; ok {
			commonCols = append(commonCols, dc)
		}
	}
	if len(commonCols) == 0 {
		commonCols = srcCols
	}

	keySet := make(map[string]struct{}, len(keyCols))
	for _, k := range keyCols {
		keySet[strings.ToLower(k)] = struct{}{}
	}

	allKeysMap := make(map[string]struct{}, len(srcMap)+len(dstMap))
	for k := range srcMap {
		allKeysMap[k] = struct{}{}
	}
	for k := range dstMap {
		allKeysMap[k] = struct{}{}
	}
	allKeys := make([]string, 0, len(allKeysMap))
	for k := range allKeysMap {
		allKeys = append(allKeys, k)
	}
	sort.Strings(allKeys)

	result := &DataDiffResult{
		Columns:     commonCols,
		KeyColumns:  keyCols,
		Truncated:   truncated,
		RowDiffs:    make([]DataRowDiff, 0),
		SyncChanges: make([]driver.RowChange, 0),
	}

	for _, k := range allKeys {
		sRow, inSrc := srcMap[k]
		dRow, inDst := dstMap[k]

		if inSrc && !inDst {
			result.Added++
			insertMap := make(map[string]any, len(commonCols))
			for _, dc := range commonCols {
				if sc, ok := srcColLookup[strings.ToLower(dc)]; ok {
					insertMap[dc] = sRow[sc]
				}
			}
			result.RowDiffs = append(result.RowDiffs, DataRowDiff{
				Key:    k,
				Status: "added",
				SrcRow: sRow,
			})
			result.SyncChanges = append(result.SyncChanges, driver.RowChange{
				Type:    "insert",
				Changes: insertMap,
			})
			continue
		}

		if !inSrc && inDst {
			result.Removed++
			pkMap := make(map[string]any, len(keyCols))
			for _, kc := range keyCols {
				pkMap[kc] = dRow[kc]
			}
			result.RowDiffs = append(result.RowDiffs, DataRowDiff{
				Key:    k,
				Status: "removed",
				DstRow: dRow,
			})
			result.SyncChanges = append(result.SyncChanges, driver.RowChange{
				Type:       "delete",
				PrimaryKey: pkMap,
			})
			continue
		}

		// Present in both: compare common non-key columns
		var diffFields []string
		updateMap := make(map[string]any)
		for _, dc := range commonCols {
			if _, isKey := keySet[strings.ToLower(dc)]; isKey {
				continue
			}
			sc := srcColLookup[strings.ToLower(dc)]
			if normalizeCellForCompare(sRow[sc]) != normalizeCellForCompare(dRow[dc]) {
				diffFields = append(diffFields, dc)
				updateMap[dc] = sRow[sc]
			}
		}
		if len(diffFields) == 0 {
			result.Identical++
		} else {
			result.Modified++
			pkMap := make(map[string]any, len(keyCols))
			for _, kc := range keyCols {
				pkMap[kc] = dRow[kc]
			}
			result.RowDiffs = append(result.RowDiffs, DataRowDiff{
				Key:        k,
				Status:     "modified",
				SrcRow:     sRow,
				DstRow:     dRow,
				DiffFields: diffFields,
			})
			result.SyncChanges = append(result.SyncChanges, driver.RowChange{
				Type:       "update",
				PrimaryKey: pkMap,
				Changes:    updateMap,
			})
		}
	}

	if len(result.SyncChanges) > 0 {
		if stmts, pErr := dstDrv.GenerateDMLPreview(req.DstDB, req.DstSchema, req.DstTable, result.SyncChanges); pErr == nil {
			result.SyncSQL = strings.Join(stmts, "\n")
		}
	}

	return result, nil
}
