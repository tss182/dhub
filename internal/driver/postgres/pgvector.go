package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"dhub/internal/driver"
)

type PgVectorStatus struct {
	Installed            bool   `json:"installed"`
	InstalledVersion     string `json:"installedVersion"`
	DefaultVersion       string `json:"defaultVersion"`
	Schema               string `json:"schema"`
	SupportsHNSW         bool   `json:"supportsHnsw"`
	SupportsParallelHNSW bool   `json:"supportsParallelHnsw"`
	SupportsHalfvec      bool   `json:"supportsHalfvec"`
	SupportsSparsevec    bool   `json:"supportsSparsevec"`
	SupportsBit          bool   `json:"supportsBit"`
	SupportsL1           bool   `json:"supportsL1"`
	SupportsIterative    bool   `json:"supportsIterative"`
	HasPgTrgm            bool   `json:"hasPgTrgm"`
}

type PgVectorColumnInfo struct {
	Name     string `json:"name"`
	DataType string `json:"dataType"`
	Kind     string `json:"kind"` // "vector" | "halfvec" | "sparsevec" | "bit"
	Dims     int    `json:"dims"`
}

type PgVectorIndexInfo struct {
	IndexName             string            `json:"indexName"`
	Method                string            `json:"method"` // "hnsw" | "ivfflat"
	ColumnOrExpr          string            `json:"columnOrExpr"`
	Opclass               string            `json:"opclass"`
	WithParams            map[string]string `json:"withParams"`
	WherePredicate        string            `json:"wherePredicate"`
	IsExpressionQuantized bool              `json:"isExpressionQuantized"`
	IsValid               bool              `json:"isValid"`
	SizePretty            string            `json:"sizePretty"`
	IdxScan               int64             `json:"idxScan"`
	Definition            string            `json:"definition"`
}

type PgVectorProgressInfo struct {
	IndexName   string  `json:"indexName"`
	Phase       string  `json:"phase"`
	TuplesDone  int64   `json:"tuplesDone"`
	TuplesTotal int64   `json:"tuplesTotal"`
	BlocksDone  int64   `json:"blocksDone"`
	BlocksTotal int64   `json:"blocksTotal"`
	Percent     float64 `json:"percent"`
}

type TableVectorOverview struct {
	Columns     []PgVectorColumnInfo   `json:"columns"`
	Indexes     []PgVectorIndexInfo    `json:"indexes"`
	InProgress  []PgVectorProgressInfo `json:"inProgress"`
	RowEstimate int64                  `json:"rowEstimate"`
}

var allowedPgVectorGUCs = map[string]bool{
	"hnsw.ef_search":           true,
	"hnsw.iterative_scan":      true,
	"hnsw.max_scan_tuples":     true,
	"hnsw.scan_mem_multiplier": true,
	"ivfflat.probes":           true,
	"ivfflat.iterative_scan":   true,
	"ivfflat.max_probes":       true,
	"enable_indexscan":         true,
	"enable_bitmapscan":        true,
	"enable_seqscan":           true,
}

func IsAllowedPgVectorGUC(name string) bool {
	return allowedPgVectorGUCs[strings.ToLower(strings.TrimSpace(name))]
}

func parsePgVectorSemver(ver string) (major, minor, patch int, ok bool) {
	clean := strings.TrimSpace(ver)
	if clean == "" {
		return 0, 0, 0, false
	}
	if idx := strings.IndexAny(clean, "-+ "); idx != -1 {
		clean = clean[:idx]
	}
	parts := strings.Split(clean, ".")
	if len(parts) < 2 {
		return 0, 0, 0, false
	}
	maj, err1 := strconv.Atoi(parts[0])
	min, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 0, 0, 0, false
	}
	pat := 0
	if len(parts) >= 3 {
		if p, err3 := strconv.Atoi(parts[2]); err3 == nil {
			pat = p
		}
	}
	return maj, min, pat, true
}

func versionAtLeast(ver string, reqMaj, reqMin, reqPat int) bool {
	maj, min, pat, ok := parsePgVectorSemver(ver)
	if !ok {
		return false
	}
	if maj != reqMaj {
		return maj > reqMaj
	}
	if min != reqMin {
		return min > reqMin
	}
	return pat >= reqPat
}

func applyPgVectorCapabilities(st *PgVectorStatus) {
	if !st.Installed || st.InstalledVersion == "" {
		return
	}
	v := st.InstalledVersion
	st.SupportsHNSW = versionAtLeast(v, 0, 5, 0)
	st.SupportsParallelHNSW = versionAtLeast(v, 0, 6, 0)
	st.SupportsHalfvec = versionAtLeast(v, 0, 7, 0)
	st.SupportsSparsevec = versionAtLeast(v, 0, 7, 0)
	st.SupportsBit = versionAtLeast(v, 0, 7, 0)
	st.SupportsL1 = versionAtLeast(v, 0, 7, 0)
	st.SupportsIterative = versionAtLeast(v, 0, 8, 0)
}

var (
	rePgVecColType = regexp.MustCompile(`^(?:pg_catalog\.)?(?:public\.)?(vector|halfvec|sparsevec|bit(?:\s+varying)?|varbit)(?:\(\s*(\d+)\s*\))?$`)
	rePgVecUsing   = regexp.MustCompile(`(?i)\bUSING\s+(hnsw|ivfflat)\s*\(`)
	rePgVecOpclass = regexp.MustCompile(`(?i)\b([a-z_]+_(?:cosine|l2|ip|l1|hamming|jaccard)_ops)\b`)
)

func extractBalancedParens(s string, openIdx int) (inner string, closeIdx int, ok bool) {
	if openIdx < 0 || openIdx >= len(s) || s[openIdx] != '(' {
		return "", -1, false
	}
	depth := 0
	inSingle := false
	for i := openIdx; i < len(s); i++ {
		ch := s[i]
		if ch == '\'' {
			if inSingle && i+1 < len(s) && s[i+1] == '\'' {
				i++
				continue
			}
			inSingle = !inSingle
			continue
		}
		if inSingle {
			continue
		}
		if ch == '(' {
			depth++
		} else if ch == ')' {
			depth--
			if depth == 0 {
				return s[openIdx+1 : i], i, true
			}
		}
	}
	return "", -1, false
}

func parsePgVectorColType(dataType string) (kind string, dims int, ok bool) {
	dt := strings.ToLower(strings.TrimSpace(dataType))
	m := rePgVecColType.FindStringSubmatch(dt)
	if len(m) == 0 {
		return "", 0, false
	}
	kind = m[1]
	if strings.HasPrefix(kind, "bit") || kind == "varbit" {
		kind = "bit"
	}
	if m[2] != "" {
		if d, err := strconv.Atoi(m[2]); err == nil {
			dims = d
		}
	}
	return kind, dims, true
}

func parsePgVectorIndexDef(indexName, method, def string, isValid bool, sizePretty string, idxScan int64) PgVectorIndexInfo {
	info := PgVectorIndexInfo{
		IndexName:  indexName,
		Method:     strings.ToLower(strings.TrimSpace(method)),
		WithParams: make(map[string]string),
		IsValid:    isValid,
		SizePretty: sizePretty,
		IdxScan:    idxScan,
		Definition: def,
	}

	work := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(def), ";"))
	if loc := rePgVecUsing.FindStringSubmatchIndex(work); len(loc) >= 4 {
		if info.Method == "" {
			info.Method = strings.ToLower(work[loc[2]:loc[3]])
		}
		openIdx := loc[1] - 1
		if usingBody, closeIdx, ok := extractBalancedParens(work, openIdx); ok {
			usingBody = strings.TrimSpace(usingBody)
			if opMatch := rePgVecOpclass.FindStringSubmatch(usingBody); len(opMatch) > 1 {
				info.Opclass = strings.ToLower(opMatch[1])
				colPart := strings.TrimSpace(strings.Replace(usingBody, opMatch[1], "", 1))
				info.ColumnOrExpr = strings.Trim(colPart, " ")
			} else {
				info.ColumnOrExpr = usingBody
			}

			lowerExpr := strings.ToLower(info.ColumnOrExpr)
			if strings.Contains(lowerExpr, "binary_quantize(") ||
				strings.Contains(lowerExpr, "::halfvec") ||
				strings.Contains(lowerExpr, "::bit") {
				info.IsExpressionQuantized = true
			}

			rest := strings.TrimSpace(work[closeIdx+1:])
			upperRest := strings.ToUpper(rest)
			if strings.HasPrefix(upperRest, "WITH") {
				if pIdx := strings.Index(rest, "("); pIdx != -1 {
					if withBody, withClose, wOk := extractBalancedParens(rest, pIdx); wOk {
						for _, kv := range strings.Split(withBody, ",") {
							parts := strings.SplitN(kv, "=", 2)
							if len(parts) == 2 {
								k := strings.TrimSpace(strings.ToLower(parts[0]))
								v := strings.Trim(strings.TrimSpace(parts[1]), "'\"")
								if k != "" {
									info.WithParams[k] = v
								}
							}
						}
						rest = strings.TrimSpace(rest[withClose+1:])
						upperRest = strings.ToUpper(rest)
					}
				}
			}
			if strings.HasPrefix(upperRest, "WHERE") {
				info.WherePredicate = strings.TrimSpace(rest[len("WHERE"):])
			}
		}
	}
	return info
}

func (p *PostgresDriver) GetPgVectorStatus(ctx context.Context, database string) (*PgVectorStatus, error) {
	db, err := p.dbFor(database)
	if err != nil {
		return nil, err
	}

	status := &PgVectorStatus{}
	var extVer, extSchema sql.NullString
	err = db.QueryRowContext(ctx, `
		SELECT e.extversion, n.nspname
		FROM pg_extension e
		JOIN pg_namespace n ON n.oid = e.extnamespace
		WHERE e.extname = 'vector'
		LIMIT 1;`).Scan(&extVer, &extSchema)
	if err == nil && extVer.Valid {
		status.Installed = true
		status.InstalledVersion = extVer.String
		status.Schema = extSchema.String
		applyPgVectorCapabilities(status)
	}

	var defVer sql.NullString
	if err := db.QueryRowContext(ctx, `SELECT default_version FROM pg_available_extensions WHERE name = 'vector' LIMIT 1;`).Scan(&defVer); err == nil && defVer.Valid {
		status.DefaultVersion = defVer.String
	}

	var trgmCount int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM pg_extension WHERE extname = 'pg_trgm';`).Scan(&trgmCount); err == nil && trgmCount > 0 {
		status.HasPgTrgm = true
	}

	return status, nil
}

func (p *PostgresDriver) InstallOrUpgradePgVector(ctx context.Context, database, action string) (*PgVectorStatus, error) {
	db, err := p.dbFor(database)
	if err != nil {
		return nil, err
	}

	var stmt string
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "upgrade", "update":
		stmt = `ALTER EXTENSION vector UPDATE;`
	default:
		stmt = `CREATE EXTENSION IF NOT EXISTS vector;`
	}
	if _, err := db.ExecContext(ctx, stmt); err != nil {
		return nil, err
	}
	return p.GetPgVectorStatus(ctx, database)
}

func (p *PostgresDriver) GetTableVectorOverview(ctx context.Context, database, schema, table string) (*TableVectorOverview, error) {
	db, err := p.dbFor(database)
	if err != nil {
		return nil, err
	}
	if schema == "" || schema == "main" {
		schema = "public"
	}

	overview := &TableVectorOverview{
		Columns:     []PgVectorColumnInfo{},
		Indexes:     []PgVectorIndexInfo{},
		InProgress:  []PgVectorProgressInfo{},
		RowEstimate: -1,
	}

	_ = db.QueryRowContext(ctx, `
		SELECT GREATEST(COALESCE(c.reltuples::bigint, -1), -1)
		FROM pg_catalog.pg_class c
		JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1 AND c.relname = $2;`, schema, table).Scan(&overview.RowEstimate)

	colRows, err := db.QueryContext(ctx, `
		SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) AS full_type
		FROM pg_catalog.pg_attribute a
		JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
		JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
		ORDER BY a.attnum;`, schema, table)
	if err == nil {
		defer colRows.Close()
		for colRows.Next() {
			var name, fullType string
			if colRows.Scan(&name, &fullType) == nil {
				if kind, dims, ok := parsePgVectorColType(fullType); ok {
					overview.Columns = append(overview.Columns, PgVectorColumnInfo{
						Name:     name,
						DataType: fullType,
						Kind:     kind,
						Dims:     dims,
					})
				}
			}
		}
	}

	idxRows, err := db.QueryContext(ctx, `
		SELECT
			i.relname,
			am.amname,
			COALESCE(pg_catalog.pg_get_indexdef(i.oid), ''),
			ix.indisvalid,
			pg_size_pretty(pg_relation_size(i.oid)),
			COALESCE(st.idx_scan, 0)
		FROM pg_catalog.pg_class t
		JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
		JOIN pg_catalog.pg_index ix ON ix.indrelid = t.oid
		JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
		JOIN pg_catalog.pg_am am ON am.oid = i.relam
		LEFT JOIN pg_catalog.pg_stat_user_indexes st ON st.indexrelid = i.oid
		WHERE n.nspname = $1 AND t.relname = $2 AND am.amname IN ('hnsw', 'ivfflat')
		ORDER BY i.relname;`, schema, table)
	if err == nil {
		defer idxRows.Close()
		for idxRows.Next() {
			var iName, amName, def, sizePretty string
			var isValid bool
			var idxScan int64
			if idxRows.Scan(&iName, &amName, &def, &isValid, &sizePretty, &idxScan) == nil {
				overview.Indexes = append(overview.Indexes, parsePgVectorIndexDef(iName, amName, def, isValid, sizePretty, idxScan))
			}
		}
	}

	progRows, err := db.QueryContext(ctx, `
		SELECT
			COALESCE(ic.relname, ''),
			COALESCE(p.phase, ''),
			COALESCE(p.tuples_done, 0),
			COALESCE(p.tuples_total, 0),
			COALESCE(p.blocks_done, 0),
			COALESCE(p.blocks_total, 0)
		FROM pg_stat_progress_create_index p
		JOIN pg_catalog.pg_class tc ON tc.oid = p.relid
		JOIN pg_catalog.pg_namespace n ON n.oid = tc.relnamespace
		LEFT JOIN pg_catalog.pg_class ic ON ic.oid = p.index_relid
		WHERE n.nspname = $1 AND tc.relname = $2;`, schema, table)
	if err == nil {
		defer progRows.Close()
		for progRows.Next() {
			var info PgVectorProgressInfo
			if progRows.Scan(&info.IndexName, &info.Phase, &info.TuplesDone, &info.TuplesTotal, &info.BlocksDone, &info.BlocksTotal) == nil {
				if info.TuplesTotal > 0 {
					info.Percent = float64(info.TuplesDone) * 100.0 / float64(info.TuplesTotal)
				} else if info.BlocksTotal > 0 {
					info.Percent = float64(info.BlocksDone) * 100.0 / float64(info.BlocksTotal)
				}
				overview.InProgress = append(overview.InProgress, info)
			}
		}
	}

	return overview, nil
}

// ExecutePgVectorSearch runs a read-only PostgreSQL vector search inside a dedicated
// transaction with transaction-local GUCs (via set_config(..., true)), preventing any
// session state from leaking into the shared connection pool.
func (p *PostgresDriver) ExecutePgVectorSearch(
	ctx context.Context,
	req driver.QueryRequest,
	sessionParams map[string]string,
) (*driver.QueryResult, error) {
	db, err := p.dbFor(req.Database)
	if err != nil {
		return nil, err
	}

	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("failed to begin read-only vector search transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if req.Schema != "" && req.Schema != "main" {
		if _, err := tx.ExecContext(ctx, fmt.Sprintf(`SET LOCAL search_path TO %s, public`, quoteIdent(req.Schema))); err != nil {
			return nil, fmt.Errorf("failed to set local search_path to %q: %w", req.Schema, err)
		}
	}

	for k, v := range sessionParams {
		cleanKey := strings.ToLower(strings.TrimSpace(k))
		if cleanKey == "" {
			continue
		}
		if !IsAllowedPgVectorGUC(cleanKey) {
			return nil, fmt.Errorf("disallowed pgvector session setting %q", k)
		}
		if _, err := tx.ExecContext(ctx, `SELECT set_config($1, $2, true)`, cleanKey, strings.TrimSpace(v)); err != nil {
			return nil, fmt.Errorf("failed to apply pgvector setting %s=%q: %w", cleanKey, v, err)
		}
	}

	return driver.ExecuteStatementsWithDialect(ctx, tx, req, "postgres")
}
