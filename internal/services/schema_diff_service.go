package services

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"dhub/internal/driver"
)

type ColumnDiff struct {
	ColumnName string `json:"columnName"`
	Status     string `json:"status"` // "added" | "removed" | "modified"
	SourceType string `json:"sourceType"`
	TargetType string `json:"targetType"`
	Detail     string `json:"detail"`
}

type TableDiff struct {
	TableName   string       `json:"tableName"`
	Status      string       `json:"status"` // "missing_in_target" | "extra_in_target" | "modified" | "identical"
	ColumnDiffs []ColumnDiff `json:"columnDiffs,omitempty"`
	Migration   string       `json:"migration,omitempty"`
}

type SchemaDiffResult struct {
	SourceLabel   string      `json:"sourceLabel"`
	TargetLabel   string      `json:"targetLabel"`
	Identical     int         `json:"identical"`
	Modified      int         `json:"modified"`
	MissingTarget int         `json:"missingTarget"`
	ExtraTarget   int         `json:"extraTarget"`
	TableDiffs    []TableDiff `json:"tableDiffs"`
	MigrationSQL  string      `json:"migrationSql"`
}

func (s *SchemaService) CompareSchemas(srcConnID, srcDB, srcSchema, dstConnID, dstDB, dstSchema string) (*SchemaDiffResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	srcDrv, err := s.sessions.GetOrConnect(ctx, srcConnID)
	if err != nil {
		return nil, fmt.Errorf("source connection failed: %w", err)
	}
	dstDrv, err := s.sessions.GetOrConnect(ctx, dstConnID)
	if err != nil {
		return nil, fmt.Errorf("target connection failed: %w", err)
	}

	dstDriverType := ""
	if dstConn, cErr := s.store.GetConnection(ctx, dstConnID); cErr == nil && dstConn != nil {
		dstDriverType = dstConn.Driver
	}

	var srcObjs, dstObjs []driver.ObjectSummary
	var srcErr, dstErr error
	var listWg sync.WaitGroup
	listWg.Add(2)
	go func() {
		defer listWg.Done()
		srcObjs, srcErr = srcDrv.ListObjects(ctx, srcDB, srcSchema)
	}()
	go func() {
		defer listWg.Done()
		dstObjs, dstErr = dstDrv.ListObjects(ctx, dstDB, dstSchema)
	}()
	listWg.Wait()

	if srcErr != nil {
		return nil, fmt.Errorf("failed to list source objects: %w", srcErr)
	}
	if dstErr != nil {
		return nil, fmt.Errorf("failed to list target objects: %w", dstErr)
	}

	srcTables := make(map[string]driver.ObjectSummary)
	for _, o := range srcObjs {
		if o.Type == "table" {
			srcTables[o.Name] = o
		}
	}
	dstTables := make(map[string]driver.ObjectSummary)
	for _, o := range dstObjs {
		if o.Type == "table" {
			dstTables[o.Name] = o
		}
	}

	allNamesMap := make(map[string]struct{})
	for name := range srcTables {
		allNamesMap[name] = struct{}{}
	}
	for name := range dstTables {
		allNamesMap[name] = struct{}{}
	}
	allNames := make([]string, 0, len(allNamesMap))
	for name := range allNamesMap {
		allNames = append(allNames, name)
	}
	sort.Strings(allNames)

	type tableDiffOutcome struct {
		status        string // "identical" | "modified" | "missing_in_target" | "extra_in_target" | "skip"
		diff          TableDiff
		migrationPart string
	}

	outcomes := make([]tableDiffOutcome, len(allNames))
	const diffConcurrency = 4
	sem := make(chan struct{}, diffConcurrency)
	var diffWg sync.WaitGroup

	for idx, name := range allNames {
		_, inSrc := srcTables[name]
		_, inDst := dstTables[name]

		if !inSrc && inDst {
			qTable := quoteIdentifier(dstDriverType, name)
			mig := fmt.Sprintf("-- Table %s exists only in target (review before dropping):\n-- DROP TABLE %s;", name, qTable)
			if dstDriverType == "qdrant" {
				mig = fmt.Sprintf("-- Collection %s exists only in target (review before deleting):\n-- DELETE /collections/%s", name, url.PathEscape(name))
			}
			outcomes[idx] = tableDiffOutcome{
				status: "extra_in_target",
				diff: TableDiff{
					TableName: name,
					Status:    "extra_in_target",
					Migration: mig,
				},
			}
			continue
		}

		diffWg.Add(1)
		go func(i int, tblName string, existsInSrc, existsInDst bool) {
			defer diffWg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			if ctx.Err() != nil {
				outcomes[i].status = "skip"
				return
			}

			if existsInSrc && !existsInDst {
				mig := fmt.Sprintf("-- Create missing table %s in target", tblName)
				if st, sErr := srcDrv.GetTableStructure(ctx, srcDB, srcSchema, tblName); sErr == nil && st.DDL != "" {
					if dstDriverType == "qdrant" {
						mig = buildQdrantCollectionMigration(tblName, st.DDL)
					} else {
						mig = strings.TrimSpace(st.DDL)
						if !strings.HasSuffix(mig, ";") {
							mig += ";"
						}
					}
				}
				outcomes[i] = tableDiffOutcome{
					status: "missing_in_target",
					diff: TableDiff{
						TableName: tblName,
						Status:    "missing_in_target",
						Migration: mig,
					},
					migrationPart: mig,
				}
				return
			}

			var srcStruct, dstStruct *driver.TableStructure
			var sErr, dErr error
			var pairWg sync.WaitGroup
			pairWg.Add(2)
			go func() {
				defer pairWg.Done()
				srcStruct, sErr = srcDrv.GetTableStructure(ctx, srcDB, srcSchema, tblName)
			}()
			go func() {
				defer pairWg.Done()
				dstStruct, dErr = dstDrv.GetTableStructure(ctx, dstDB, dstSchema, tblName)
			}()
			pairWg.Wait()

			if sErr != nil || dErr != nil {
				outcomes[i].status = "skip"
				return
			}

			srcCols := make(map[string]driver.ColumnMeta, len(srcStruct.Columns))
			for _, c := range srcStruct.Columns {
				srcCols[c.Name] = c
			}
			dstCols := make(map[string]driver.ColumnMeta, len(dstStruct.Columns))
			for _, c := range dstStruct.Columns {
				dstCols[c.Name] = c
			}

			var colDiffs []ColumnDiff
			var alterStmts []string
			qTable := quoteIdentifier(dstDriverType, tblName)

			if dstDriverType == "qdrant" {
				// Qdrant payloads are schemaless; compare vector columns and payload indexes symmetrically.
				for _, sc := range srcStruct.Columns {
					if sc.Name != "vector" && !strings.HasPrefix(sc.Name, "vector.") {
						continue
					}
					dc, exists := dstCols[sc.Name]
					if !exists {
						colDiffs = append(colDiffs, ColumnDiff{
							ColumnName: sc.Name,
							Status:     "added",
							SourceType: sc.DataType,
							Detail:     fmt.Sprintf("Missing vector in target (%s)", sc.DataType),
						})
						alterStmts = append(alterStmts, fmt.Sprintf("-- Missing vector %s (%s) in target collection %s (recreate collection to add named vectors)", sc.Name, sc.DataType, tblName))
					} else if !strings.EqualFold(sc.DataType, dc.DataType) {
						colDiffs = append(colDiffs, ColumnDiff{
							ColumnName: sc.Name,
							Status:     "modified",
							SourceType: sc.DataType,
							TargetType: dc.DataType,
							Detail:     fmt.Sprintf("Vector config differs: %s -> %s", dc.DataType, sc.DataType),
						})
						alterStmts = append(alterStmts, fmt.Sprintf("-- Vector %s differs in %s: target=%s, source=%s (recreate collection to change vector dimensions/distance)", sc.Name, tblName, dc.DataType, sc.DataType))
					}
				}
				for _, dc := range dstStruct.Columns {
					if dc.Name != "vector" && !strings.HasPrefix(dc.Name, "vector.") {
						continue
					}
					if _, exists := srcCols[dc.Name]; !exists {
						colDiffs = append(colDiffs, ColumnDiff{
							ColumnName: dc.Name,
							Status:     "removed",
							TargetType: dc.DataType,
							Detail:     fmt.Sprintf("Extra vector in target (%s)", dc.DataType),
						})
						alterStmts = append(alterStmts, fmt.Sprintf("-- Extra vector %s (%s) in target collection %s", dc.Name, dc.DataType, tblName))
					}
				}
			} else {
				for _, sc := range srcStruct.Columns {
					dc, exists := dstCols[sc.Name]
					if !exists {
						colDiffs = append(colDiffs, ColumnDiff{
							ColumnName: sc.Name,
							Status:     "added",
							SourceType: sc.DataType,
							Detail:     fmt.Sprintf("Missing in target (%s)", sc.DataType),
						})
						nullStr := "NULL"
						if !sc.IsNullable {
							nullStr = "NOT NULL"
						}
						alterStmts = append(alterStmts, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s %s;", qTable, quoteIdentifier(dstDriverType, sc.Name), sc.DataType, nullStr))
					} else if !strings.EqualFold(sc.DataType, dc.DataType) || sc.IsNullable != dc.IsNullable {
						colDiffs = append(colDiffs, ColumnDiff{
							ColumnName: sc.Name,
							Status:     "modified",
							SourceType: sc.DataType,
							TargetType: dc.DataType,
							Detail:     fmt.Sprintf("Type: %s -> %s, Nullable: %v -> %v", dc.DataType, sc.DataType, dc.IsNullable, sc.IsNullable),
						})
						alterStmts = append(alterStmts, buildModifyColumnSQL(dstDriverType, qTable, sc, dc))
					}
				}

				for _, dc := range dstStruct.Columns {
					if _, exists := srcCols[dc.Name]; !exists {
						colDiffs = append(colDiffs, ColumnDiff{
							ColumnName: dc.Name,
							Status:     "removed",
							TargetType: dc.DataType,
							Detail:     fmt.Sprintf("Extra in target (%s)", dc.DataType),
						})
						alterStmts = append(alterStmts, fmt.Sprintf("-- Extra column in target: ALTER TABLE %s DROP COLUMN %s;", qTable, quoteIdentifier(dstDriverType, dc.Name)))
					}
				}
			}

			// Compare Indexes (excluding primary keys)
			srcIdxs := make(map[string]driver.IndexMeta)
			for _, ix := range srcStruct.Indexes {
				if !ix.IsPrimary && !strings.EqualFold(ix.Name, "PRIMARY") {
					srcIdxs[strings.ToLower(ix.Name)] = ix
				}
			}
			dstIdxs := make(map[string]driver.IndexMeta)
			for _, ix := range dstStruct.Indexes {
				if !ix.IsPrimary && !strings.EqualFold(ix.Name, "PRIMARY") {
					dstIdxs[strings.ToLower(ix.Name)] = ix
				}
			}
			for key, sIdx := range srcIdxs {
				dIdx, exists := dstIdxs[key]
				sColsStr := strings.Join(sIdx.Columns, ", ")
				if !exists {
					colDiffs = append(colDiffs, ColumnDiff{
						ColumnName: "INDEX " + sIdx.Name,
						Status:     "added",
						SourceType: sColsStr,
						Detail:     fmt.Sprintf("Missing index in target (%s)", sColsStr),
					})
					qIdxCols := make([]string, len(sIdx.Columns))
					for k, col := range sIdx.Columns {
						qIdxCols[k] = quoteIdentifier(dstDriverType, col)
					}
					uniqueKw := ""
					if sIdx.IsUnique {
						uniqueKw = "UNIQUE "
					}
					if dstDriverType == "qdrant" && len(sIdx.Columns) > 0 {
						fieldName := sIdx.Columns[0]
						fieldType := sIdx.Type
						if fieldType == "" {
							fieldType = "keyword"
						}
						idxBody, _ := json.Marshal(map[string]any{"field_name": fieldName, "field_schema": fieldType})
						alterStmts = append(alterStmts, fmt.Sprintf("PUT /collections/%s/index?wait=true\n%s", url.PathEscape(tblName), string(idxBody)))
					} else {
						alterStmts = append(alterStmts, fmt.Sprintf("CREATE %sINDEX %s ON %s (%s);", uniqueKw, quoteIdentifier(dstDriverType, sIdx.Name), qTable, strings.Join(qIdxCols, ", ")))
					}
				} else if strings.Join(sIdx.Columns, ",") != strings.Join(dIdx.Columns, ",") || sIdx.IsUnique != dIdx.IsUnique || (dstDriverType == "qdrant" && !strings.EqualFold(sIdx.Type, dIdx.Type)) {
					colDiffs = append(colDiffs, ColumnDiff{
						ColumnName: "INDEX " + sIdx.Name,
						Status:     "modified",
						SourceType: fmt.Sprintf("%s (%s)", sColsStr, sIdx.Type),
						TargetType: fmt.Sprintf("%s (%s)", strings.Join(dIdx.Columns, ", "), dIdx.Type),
						Detail:     fmt.Sprintf("Index differs: (%s:%s) -> (%s:%s)", strings.Join(dIdx.Columns, ", "), dIdx.Type, sColsStr, sIdx.Type),
					})
					if dstDriverType == "qdrant" && len(sIdx.Columns) > 0 {
						fieldName := sIdx.Columns[0]
						fieldType := sIdx.Type
						if fieldType == "" {
							fieldType = "keyword"
						}
						idxBody, _ := json.Marshal(map[string]any{"field_name": fieldName, "field_schema": fieldType})
						alterStmts = append(alterStmts, fmt.Sprintf("DELETE /collections/%s/index/%s?wait=true\nPUT /collections/%s/index?wait=true\n%s", url.PathEscape(tblName), url.PathEscape(fieldName), url.PathEscape(tblName), string(idxBody)))
					} else {
						alterStmts = append(alterStmts, fmt.Sprintf("-- Index %s.%s differs: target=(%s), source=(%s)", tblName, sIdx.Name, strings.Join(dIdx.Columns, ", "), sColsStr))
					}
				}
			}
			for key, dIdx := range dstIdxs {
				if _, exists := srcIdxs[key]; !exists {
					colDiffs = append(colDiffs, ColumnDiff{
						ColumnName: "INDEX " + dIdx.Name,
						Status:     "removed",
						TargetType: strings.Join(dIdx.Columns, ", "),
						Detail:     fmt.Sprintf("Extra index in target (%s)", strings.Join(dIdx.Columns, ", ")),
					})
					if dstDriverType == "qdrant" && len(dIdx.Columns) > 0 {
						alterStmts = append(alterStmts, fmt.Sprintf("-- Extra payload index in target: DELETE /collections/%s/index/%s?wait=true", url.PathEscape(tblName), url.PathEscape(dIdx.Columns[0])))
					} else {
						alterStmts = append(alterStmts, fmt.Sprintf("-- Extra index in target: DROP INDEX %s;", quoteIdentifier(dstDriverType, dIdx.Name)))
					}
				}
			}

			// Compare Foreign Keys
			srcFKs := make(map[string]driver.ForeignKeyMeta)
			for _, fk := range srcStruct.ForeignKeys {
				fkKey := strings.ToLower(fk.ColumnName + "->" + fk.RefTable + "." + fk.RefColumn)
				srcFKs[fkKey] = fk
			}
			dstFKs := make(map[string]driver.ForeignKeyMeta)
			for _, fk := range dstStruct.ForeignKeys {
				fkKey := strings.ToLower(fk.ColumnName + "->" + fk.RefTable + "." + fk.RefColumn)
				dstFKs[fkKey] = fk
			}
			for key, sFk := range srcFKs {
				if _, exists := dstFKs[key]; !exists {
					fkName := sFk.ConstraintName
					if fkName == "" {
						fkName = fmt.Sprintf("fk_%s_%s", tblName, sFk.ColumnName)
					}
					colDiffs = append(colDiffs, ColumnDiff{
						ColumnName: "FK " + fkName,
						Status:     "added",
						SourceType: fmt.Sprintf("%s -> %s.%s", sFk.ColumnName, sFk.RefTable, sFk.RefColumn),
						Detail:     fmt.Sprintf("Missing FK in target (%s -> %s.%s)", sFk.ColumnName, sFk.RefTable, sFk.RefColumn),
					})
					fkStmt := fmt.Sprintf("ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s)",
						qTable, quoteIdentifier(dstDriverType, fkName), quoteIdentifier(dstDriverType, sFk.ColumnName), quoteIdentifier(dstDriverType, sFk.RefTable), quoteIdentifier(dstDriverType, sFk.RefColumn))
					if sFk.OnDelete != "" && !strings.EqualFold(sFk.OnDelete, "NO ACTION") {
						fkStmt += " ON DELETE " + sFk.OnDelete
					}
					if sFk.OnUpdate != "" && !strings.EqualFold(sFk.OnUpdate, "NO ACTION") {
						fkStmt += " ON UPDATE " + sFk.OnUpdate
					}
					alterStmts = append(alterStmts, fkStmt+";")
				}
			}
			for key, dFk := range dstFKs {
				if _, exists := srcFKs[key]; !exists {
					fkName := dFk.ConstraintName
					if fkName == "" {
						fkName = fmt.Sprintf("fk_%s_%s", tblName, dFk.ColumnName)
					}
					colDiffs = append(colDiffs, ColumnDiff{
						ColumnName: "FK " + fkName,
						Status:     "removed",
						TargetType: fmt.Sprintf("%s -> %s.%s", dFk.ColumnName, dFk.RefTable, dFk.RefColumn),
						Detail:     fmt.Sprintf("Extra FK in target (%s -> %s.%s)", dFk.ColumnName, dFk.RefTable, dFk.RefColumn),
					})
					alterStmts = append(alterStmts, fmt.Sprintf("-- Extra FK in target: ALTER TABLE %s DROP CONSTRAINT %s;", qTable, quoteIdentifier(dstDriverType, fkName)))
				}
			}

			if len(colDiffs) == 0 {
				outcomes[i].status = "identical"
			} else {
				mig := strings.Join(alterStmts, "\n")
				outcomes[i] = tableDiffOutcome{
					status: "modified",
					diff: TableDiff{
						TableName:   tblName,
						Status:      "modified",
						ColumnDiffs: colDiffs,
						Migration:   mig,
					},
					migrationPart: mig,
				}
			}
		}(idx, name, inSrc, inDst)
	}
	diffWg.Wait()

	res := &SchemaDiffResult{
		SourceLabel: fmt.Sprintf("%s.%s", srcDB, srcSchema),
		TargetLabel: fmt.Sprintf("%s.%s", dstDB, dstSchema),
		TableDiffs:  make([]TableDiff, 0),
	}
	var migrationParts []string

	for _, out := range outcomes {
		switch out.status {
		case "identical":
			res.Identical++
		case "missing_in_target":
			res.MissingTarget++
			res.TableDiffs = append(res.TableDiffs, out.diff)
		case "extra_in_target":
			res.ExtraTarget++
			res.TableDiffs = append(res.TableDiffs, out.diff)
		case "modified":
			res.Modified++
			res.TableDiffs = append(res.TableDiffs, out.diff)
		}
		if out.migrationPart != "" {
			migrationParts = append(migrationParts, out.migrationPart)
		}
	}

	res.MigrationSQL = strings.Join(migrationParts, "\n\n")
	return res, nil
}

func buildModifyColumnSQL(driverType, qTable string, sc, dc driver.ColumnMeta) string {
	drv := strings.ToLower(strings.TrimSpace(driverType))
	qCol := quoteIdentifier(drv, sc.Name)
	nullStr := "NULL"
	if !sc.IsNullable {
		nullStr = "NOT NULL"
	}

	switch drv {
	case "mysql", "mariadb":
		return fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s %s %s;", qTable, qCol, sc.DataType, nullStr)
	case "postgres":
		var parts []string
		if !strings.EqualFold(sc.DataType, dc.DataType) {
			parts = append(parts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s TYPE %s;", qTable, qCol, sc.DataType))
		}
		if sc.IsNullable != dc.IsNullable {
			action := "DROP NOT NULL"
			if !sc.IsNullable {
				action = "SET NOT NULL"
			}
			parts = append(parts, fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s %s;", qTable, qCol, action))
		}
		return strings.Join(parts, "\n")
	case "mssql", "sqlserver":
		return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s %s %s;", qTable, qCol, sc.DataType, nullStr)
	case "oracle":
		nullClause := ""
		if sc.IsNullable != dc.IsNullable {
			nullClause = " " + nullStr
		}
		return fmt.Sprintf("ALTER TABLE %s MODIFY (%s %s%s);", qTable, qCol, sc.DataType, nullClause)
	case "clickhouse":
		return fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s %s;", qTable, qCol, sc.DataType)
	default:
		return fmt.Sprintf("-- Column %s differs: target=%s (nullable=%v), source=%s (nullable=%v)", sc.Name, dc.DataType, dc.IsNullable, sc.DataType, sc.IsNullable)
	}
}

func buildQdrantCollectionMigration(collName, ddlJSON string) string {
	var parsed struct {
		Result struct {
			Config struct {
				Params             map[string]any `json:"params"`
				HnswConfig         map[string]any `json:"hnsw_config"`
				OptimizerConfig    map[string]any `json:"optimizer_config"`
				QuantizationConfig map[string]any `json:"quantization_config"`
			} `json:"config"`
			PayloadSchema map[string]struct {
				DataType string         `json:"data_type"`
				Params   map[string]any `json:"params,omitempty"`
			} `json:"payload_schema"`
			WalConfig        map[string]any `json:"wal_config,omitempty"`
			StrictModeConfig map[string]any `json:"strict_mode_config,omitempty"`
		} `json:"result"`
	}
	if err := json.Unmarshal([]byte(ddlJSON), &parsed); err != nil {
		return fmt.Sprintf("-- Could not parse Qdrant collection config for %s:\n-- %s", collName, strings.TrimSpace(ddlJSON))
	}

	createBody := make(map[string]any)
	params := parsed.Result.Config.Params
	for _, key := range []string{"vectors", "sparse_vectors", "shard_number", "sharding_method", "replication_factor", "write_consistency_factor", "on_disk_payload"} {
		if v, ok := params[key]; ok && v != nil {
			createBody[key] = v
		}
	}
	if len(parsed.Result.Config.HnswConfig) > 0 {
		createBody["hnsw_config"] = parsed.Result.Config.HnswConfig
	}
	if len(parsed.Result.Config.OptimizerConfig) > 0 {
		createBody["optimizers_config"] = parsed.Result.Config.OptimizerConfig
	}
	if len(parsed.Result.Config.QuantizationConfig) > 0 {
		createBody["quantization_config"] = parsed.Result.Config.QuantizationConfig
	}
	if len(parsed.Result.WalConfig) > 0 {
		createBody["wal_config"] = parsed.Result.WalConfig
	}
	if len(parsed.Result.StrictModeConfig) > 0 {
		createBody["strict_mode_config"] = parsed.Result.StrictModeConfig
	}

	b, _ := json.MarshalIndent(createBody, "", "  ")
	stmts := []string{
		fmt.Sprintf("PUT /collections/%s\n%s", url.PathEscape(collName), string(b)),
	}

	if len(parsed.Result.PayloadSchema) > 0 {
		fields := make([]string, 0, len(parsed.Result.PayloadSchema))
		for k := range parsed.Result.PayloadSchema {
			fields = append(fields, k)
		}
		sort.Strings(fields)
		for _, f := range fields {
			ps := parsed.Result.PayloadSchema[f]
			var fieldSchema any = ps.DataType
			if len(ps.Params) > 0 {
				fieldSchema = ps.Params
			} else if ps.DataType == "" {
				fieldSchema = "keyword"
			}
			idxBody, _ := json.Marshal(map[string]any{"field_name": f, "field_schema": fieldSchema})
			stmts = append(stmts, fmt.Sprintf("PUT /collections/%s/index?wait=true\n%s", url.PathEscape(collName), string(idxBody)))
		}
	}
	return strings.Join(stmts, "\n\n")
}
