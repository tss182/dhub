package services

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"dhub/internal/app"
	"dhub/internal/driver"
	"dhub/internal/store"
	"dhub/internal/tunnel"
)

// GetDefaultBackupPath returns the default .sql backup file path for a database.
func (s *SchemaService) GetDefaultBackupPath(database string) (string, error) {
	safeDB := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			return r
		}
		return '_'
	}, strings.TrimSpace(database))
	if safeDB == "" {
		safeDB = "database"
	}

	filename := fmt.Sprintf("%s_backup_%s.sql", safeDB, time.Now().Format("20060102_150405"))
	homeDir, err := os.UserHomeDir()
	if err != nil || homeDir == "" {
		return filename, nil
	}

	downloadsDir := filepath.Join(homeDir, "Downloads")
	if info, err := os.Stat(downloadsDir); err == nil && info.IsDir() {
		return filepath.Join(downloadsDir, filename), nil
	}
	return filepath.Join(homeDir, filename), nil
}

// withSSHTunnel returns a copy of conn whose host/port point at a local SSH tunnel when
// SSH is enabled, so external tools (mysqldump, pg_dump, ...) reach the remote database.
// The returned func closes the tunnel and is always safe to call.
func withSSHTunnel(conn *store.ConnectionConfig) (*store.ConnectionConfig, func(), error) {
	noop := func() {}
	if conn == nil || !conn.SSHEnabled || conn.Driver == "sqlite" {
		return conn, noop, nil
	}
	tun, err := tunnel.OpenSSHTunnel(tunnel.SSHTunnelConfig{
		Host:       conn.SSHHost,
		Port:       conn.SSHPort,
		User:       conn.SSHUser,
		AuthType:   conn.SSHAuthType,
		Password:   conn.SSHPassword,
		KeyPath:    conn.SSHKeyPath,
		RemoteHost: conn.Host,
		RemotePort: conn.Port,
	})
	if err != nil {
		return nil, noop, fmt.Errorf("ssh tunnel failed: %w", err)
	}
	cp := *conn
	cp.Host = "127.0.0.1"
	cp.Port = tun.LocalPort
	return &cp, func() { _ = tun.Close() }, nil
}

type BackupOptions struct {
	Mode              string   `json:"mode"`              // "full", "schema_only", "data_only"
	TableSelection    string   `json:"tableSelection"`    // "all", "include", "exclude"
	Tables            []string `json:"tables"`            // list of tables
	Schema            string   `json:"schema,omitempty"`  // specific schema for postgres -n
	Format            string   `json:"format,omitempty"`  // "plain", "custom", "tar"
	IncludeRoutines   bool     `json:"includeRoutines"`   // mysqldump --routines
	IncludeTriggers   bool     `json:"includeTriggers"`   // mysqldump --triggers
	IncludeEvents     bool     `json:"includeEvents"`     // mysqldump --events
	SingleTransaction bool     `json:"singleTransaction"` // mysqldump --single-transaction
	ToolPath          string   `json:"toolPath,omitempty"`
}

func (s *SchemaService) emitBackupProgress(ev app.BackupProgressEvent) {
	if s.appGetter == nil {
		return
	}
	if a := s.appGetter(); a != nil {
		a.Event.Emit("backup:progress", ev)
	}
}

func (s *SchemaService) emitRestoreProgress(ev app.BackupProgressEvent) {
	if s.appGetter == nil {
		return
	}
	if a := s.appGetter(); a != nil {
		a.Event.Emit("restore:progress", ev)
	}
}

type RestoreOptions struct {
	ToolPath string `json:"toolPath,omitempty"`
}

type restoreProgressReader struct {
	src          io.Reader
	lineBuf      []byte
	skipLine     bool
	bytesRead    int64
	currentTable string
	lastEmit     time.Time
	onUpdate     func(bytesRead int64, currentTable string)
}

func newRestoreProgressReader(src io.Reader, onUpdate func(bytesRead int64, currentTable string)) *restoreProgressReader {
	return &restoreProgressReader{
		src:      src,
		lineBuf:  make([]byte, 0, 256),
		onUpdate: onUpdate,
	}
}

func (r *restoreProgressReader) Read(p []byte) (int, error) {
	n, err := r.src.Read(p)
	if n > 0 {
		r.bytesRead += int64(n)
		tableChanged := false
		for _, b := range p[:n] {
			if b == '\n' {
				if !r.skipLine && len(r.lineBuf) > 0 {
					line := strings.TrimSpace(string(r.lineBuf))
					var tbl string
					if strings.HasPrefix(line, "-- Table structure for table ") {
						tbl = strings.TrimPrefix(line, "-- Table structure for table ")
					} else if strings.HasPrefix(line, "-- Dumping data for table ") {
						tbl = strings.TrimPrefix(line, "-- Dumping data for table ")
					}
					tbl = strings.Trim(tbl, "`\" ")
					if tbl != "" && tbl != r.currentTable {
						r.currentTable = tbl
						tableChanged = true
					}
				}
				r.lineBuf = r.lineBuf[:0]
				r.skipLine = false
				continue
			}
			if r.skipLine {
				continue
			}
			if len(r.lineBuf) < 256 {
				r.lineBuf = append(r.lineBuf, b)
				if len(r.lineBuf) == 3 && !bytes.HasPrefix(r.lineBuf, []byte("-- ")) {
					r.skipLine = true
				}
			} else {
				r.skipLine = true
			}
		}
		if r.onUpdate != nil && (tableChanged || time.Since(r.lastEmit) >= 150*time.Millisecond) {
			r.lastEmit = time.Now()
			r.onUpdate(r.bytesRead, r.currentTable)
		}
	}
	return n, err
}

func resolveBackupToolPath(customPath string, installHint string, candidates ...string) (string, error) {
	resolved, _, err := resolveBackupToolPathWithDriver("", customPath, installHint, candidates...)
	return resolved, err
}

type backupProgressWriter struct {
	dst          io.Writer
	lineBuf      []byte
	skipLine     bool
	bytesWritten int64
	seenTables   map[string]struct{}
	currentTable string
	lastEmit     time.Time
	onUpdate     func(bytesWritten int64, seenTables int, currentTable string)
}

func newBackupProgressWriter(dst io.Writer, onUpdate func(bytesWritten int64, seenTables int, currentTable string)) *backupProgressWriter {
	return &backupProgressWriter{
		dst:        dst,
		lineBuf:    make([]byte, 0, 256),
		seenTables: make(map[string]struct{}),
		onUpdate:   onUpdate,
	}
}

func (w *backupProgressWriter) Write(p []byte) (int, error) {
	n, err := w.dst.Write(p)
	if n <= 0 {
		return n, err
	}
	w.bytesWritten += int64(n)

	tableChanged := false
	for _, b := range p[:n] {
		if b == '\n' {
			if !w.skipLine && len(w.lineBuf) > 0 {
				line := strings.TrimSpace(string(w.lineBuf))
				var tbl string
				if strings.HasPrefix(line, "-- Table structure for table ") {
					tbl = strings.TrimPrefix(line, "-- Table structure for table ")
				} else if strings.HasPrefix(line, "-- Dumping data for table ") {
					tbl = strings.TrimPrefix(line, "-- Dumping data for table ")
				}
				tbl = strings.Trim(tbl, "`\" ")
				if tbl != "" {
					if tbl != w.currentTable {
						w.currentTable = tbl
						tableChanged = true
					}
					w.seenTables[tbl] = struct{}{}
				}
			}
			w.lineBuf = w.lineBuf[:0]
			w.skipLine = false
			continue
		}
		if w.skipLine {
			continue
		}
		if len(w.lineBuf) < 256 {
			w.lineBuf = append(w.lineBuf, b)
			if len(w.lineBuf) == 3 && !bytes.HasPrefix(w.lineBuf, []byte("-- ")) {
				w.skipLine = true
			}
		} else {
			w.skipLine = true
		}
	}

	if w.onUpdate != nil && (tableChanged || time.Since(w.lastEmit) >= 150*time.Millisecond) {
		w.lastEmit = time.Now()
		w.onUpdate(w.bytesWritten, len(w.seenTables), w.currentTable)
	}
	return n, err
}

func (s *SchemaService) estimateMySQLBackupMetadata(ctx context.Context, connectionID, database string, opts BackupOptions) (totalTables int, estimatedBytes int64) {
	if opts.TableSelection == "include" {
		totalTables = len(opts.Tables)
	}
	metaCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	drv, err := s.sessions.GetOrConnect(metaCtx, connectionID)
	if err != nil {
		return totalTables, 0
	}

	escapedDB := strings.ReplaceAll(database, "'", "''")
	res, err := drv.Execute(metaCtx, driver.QueryRequest{
		ConnectionID: connectionID,
		Database:     database,
		SQL:          fmt.Sprintf("SELECT TABLE_NAME, COALESCE(DATA_LENGTH, 0) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '%s' AND TABLE_TYPE = 'BASE TABLE'", escapedDB),
		Limit:        10000,
	})
	if err != nil || res == nil {
		if totalTables == 0 {
			if objs, lErr := drv.ListObjects(metaCtx, database, database); lErr == nil {
				for _, o := range objs {
					if o.Type == "table" {
						totalTables++
					}
				}
			}
		}
		return totalTables, 0
	}

	selectedSet := make(map[string]struct{}, len(opts.Tables))
	for _, t := range opts.Tables {
		selectedSet[t] = struct{}{}
	}

	count := 0
	var totalBytes int64
	for _, row := range res.Rows {
		if len(row) < 2 {
			continue
		}
		name := fmt.Sprint(row[0])
		if opts.TableSelection == "include" {
			if _, ok := selectedSet[name]; !ok {
				continue
			}
		} else if opts.TableSelection == "exclude" {
			if _, ok := selectedSet[name]; ok {
				continue
			}
		}
		count++
		switch v := row[1].(type) {
		case int64:
			totalBytes += v
		case float64:
			totalBytes += int64(v)
		case int:
			totalBytes += int64(v)
		default:
			if parsed, pErr := strconv.ParseInt(fmt.Sprint(v), 10, 64); pErr == nil {
				totalBytes += parsed
			}
		}
	}
	if count > 0 {
		totalTables = count
	}
	return totalTables, totalBytes
}

func computeBackupPercent(mode string, bytesWritten, estimatedBytes int64, seenTables, totalTables int) float64 {
	tableRatio := 0.0
	if totalTables > 0 {
		completed := seenTables - 1
		if completed < 0 {
			completed = 0
		}
		tableRatio = float64(completed) / float64(totalTables)
		if tableRatio > 0.98 {
			tableRatio = 0.98
		}
	}

	if mode == "schema_only" || estimatedBytes <= 0 {
		pct := tableRatio * 96.0
		if seenTables > 0 && pct < 2 {
			pct = 2
		}
		if pct > 98 {
			pct = 98
		}
		return pct
	}

	byteRatio := float64(bytesWritten) / float64(estimatedBytes)
	if byteRatio > 0.99 {
		byteRatio = 0.99
	}

	var ratio float64
	if totalTables > 0 {
		ratio = 0.35*tableRatio + 0.65*byteRatio
	} else {
		ratio = byteRatio
	}
	pct := ratio * 99.0
	if bytesWritten > 0 && pct < 1 {
		pct = 1
	}
	if pct > 99 {
		pct = 99
	}
	return pct
}

func (s *SchemaService) BackupDatabase(connectionID, database, filePath, optionsJSON string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	conn, err := s.store.GetConnection(ctx, connectionID)
	if err != nil {
		return "", fmt.Errorf("failed to get connection config: %w", err)
	}
	if strings.EqualFold(strings.TrimSpace(conn.Driver), "qdrant") {
		return "", fmt.Errorf("Qdrant uses built-in HTTP snapshots: use Manage Collection -> Snapshots or Server Info -> Full Snapshots")
	}
	if strings.EqualFold(strings.TrimSpace(conn.Driver), "elasticsearch") || strings.EqualFold(strings.TrimSpace(conn.Driver), "es") {
		return "", fmt.Errorf("Elasticsearch uses the Snapshot API (/_snapshot) or index data export (JSONL / JSON / CSV via Export Table)")
	}
	conn, closeTunnel, err := withSSHTunnel(conn)
	if err != nil {
		return "", err
	}
	defer closeTunnel()

	database = strings.TrimSpace(database)
	if database == "" {
		database = strings.TrimSpace(conn.DatabaseName)
	}
	if database == "" {
		return "", fmt.Errorf("database name is required for backup")
	}

	opKey := backupRestoreOpKey(connectionID, database)
	s.registerOp(opKey, cancel)
	defer s.unregisterOp(opKey)

	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		filePath, _ = s.GetDefaultBackupPath(database)
	}
	opts := BackupOptions{
		Mode:              "full",
		TableSelection:    "all",
		IncludeRoutines:   true,
		IncludeTriggers:   true,
		IncludeEvents:     false,
		SingleTransaction: true,
	}
	if strings.TrimSpace(optionsJSON) != "" {
		_ = json.Unmarshal([]byte(optionsJSON), &opts)
	}

	lowerPath := strings.ToLower(filePath)
	if !strings.HasSuffix(lowerPath, ".sql") && !strings.HasSuffix(lowerPath, ".sql.gz") && !strings.HasSuffix(lowerPath, ".gz") && !strings.HasSuffix(lowerPath, ".dump") && !strings.HasSuffix(lowerPath, ".backup") && !strings.HasSuffix(lowerPath, ".tar") {
		if opts.Format == "custom" {
			filePath += ".dump"
		} else if opts.Format == "tar" {
			filePath += ".tar"
		} else {
			filePath += ".sql"
		}
	}

	// Filter empty table names
	var validTables []string
	for _, t := range opts.Tables {
		t = strings.TrimSpace(t)
		if t != "" {
			validTables = append(validTables, t)
		}
	}
	opts.Tables = validTables

	if opts.TableSelection == "include" && len(opts.Tables) == 0 {
		return "", fmt.Errorf("table selection is set to 'include' but no tables were selected")
	}

	s.emitBackupProgress(app.BackupProgressEvent{
		ConnectionID: connectionID,
		Database:     database,
		Status:       "running",
		Percent:      0,
		Message:      "Preparing backup...",
	})

	emitErr := func(err error) error {
		s.emitBackupProgress(app.BackupProgressEvent{
			ConnectionID: connectionID,
			Database:     database,
			Status:       "error",
			Percent:      0,
			Message:      err.Error(),
		})
		return err
	}

	switch conn.Driver {
	case "mysql", "mariadb":
		firstBin := "mysqldump"
		secondBin := "mariadb-dump"
		if conn.Driver == "mariadb" {
			firstBin = "mariadb-dump"
			secondBin = "mysqldump"
		}
		binPath, _, err := resolveBackupToolPathWithDriver(conn.Driver, opts.ToolPath, "please install mysql-client or mariadb-client, or click 'Download Tool' in the Backup modal", firstBin, secondBin)
		if err != nil {
			return "", emitErr(err)
		}

		if isDHubPortableTool(binPath) {
			if err := s.backupDatabaseNativeSQL(ctx, connectionID, conn.Driver, database, filePath, opts); err != nil {
				_ = os.Remove(filePath)
				return "", emitErr(err)
			}
			break
		}

		totalTables, estimatedBytes := s.estimateMySQLBackupMetadata(ctx, connectionID, database, opts)
		s.emitBackupProgress(app.BackupProgressEvent{
			ConnectionID: connectionID,
			Database:     database,
			Status:       "running",
			Percent:      1,
			TotalTables:  totalTables,
			Message:      fmt.Sprintf("Running %s...", filepath.Base(binPath)),
		})

		host := strings.TrimSpace(conn.Host)
		if host == "" || strings.EqualFold(host, "localhost") {
			host = "127.0.0.1"
		}
		port := conn.Port
		if port <= 0 {
			port = 3306
		}
		user := strings.TrimSpace(conn.Username)
		if user == "" {
			user = "root"
		}

		baseArgs := []string{
			"--protocol=TCP",
			"-h", host,
			"-P", strconv.Itoa(port),
			"-u", user,
			"--default-character-set=utf8mb4",
		}

		if opts.SingleTransaction {
			baseArgs = append(baseArgs, "--single-transaction")
		}

		// Dump Mode
		switch opts.Mode {
		case "schema_only":
			baseArgs = append(baseArgs, "--no-data")
		case "data_only":
			baseArgs = append(baseArgs, "--no-create-info")
		}

		// Routines / Functions
		if opts.IncludeRoutines {
			baseArgs = append(baseArgs, "--routines")
		} else {
			baseArgs = append(baseArgs, "--skip-routines")
		}

		// Triggers
		if opts.IncludeTriggers {
			baseArgs = append(baseArgs, "--triggers")
		} else {
			baseArgs = append(baseArgs, "--skip-triggers")
		}

		// Events
		if opts.IncludeEvents {
			baseArgs = append(baseArgs, "--events")
		} else {
			baseArgs = append(baseArgs, "--skip-events")
		}

		// Table exclusions
		if opts.TableSelection == "exclude" {
			for _, tbl := range opts.Tables {
				baseArgs = append(baseArgs, fmt.Sprintf("--ignore-table=%s.%s", database, tbl))
			}
		}

		runDump := func(extraArgs ...string) (string, error) {
			outFile, createErr := os.Create(filePath)
			if createErr != nil {
				return "", fmt.Errorf("failed to create backup file: %w", createErr)
			}

			args := make([]string, 0, len(baseArgs)+len(extraArgs)+len(opts.Tables)+1)
			args = append(args, baseArgs...)
			args = append(args, extraArgs...)
			args = append(args, database)

			// Table inclusions
			if opts.TableSelection == "include" {
				args = append(args, opts.Tables...)
			}

			cmd := exec.CommandContext(ctx, binPath, args...)
			cmd.Env = os.Environ()
			if conn.Password != "" {
				cmd.Env = append(cmd.Env, "MYSQL_PWD="+conn.Password)
			}

			var stderrBuf bytes.Buffer
			pw := newBackupProgressWriter(outFile, func(bytesWritten int64, seenTables int, currentTable string) {
				pct := computeBackupPercent(opts.Mode, bytesWritten, estimatedBytes, seenTables, totalTables)
				msg := "Dumping database..."
				if currentTable != "" {
					if totalTables > 0 {
						msg = fmt.Sprintf("Dumping table `%s` (%d/%d)", currentTable, seenTables, totalTables)
					} else {
						msg = fmt.Sprintf("Dumping table `%s`", currentTable)
					}
				}
				s.emitBackupProgress(app.BackupProgressEvent{
					ConnectionID: connectionID,
					Database:     database,
					Status:       "running",
					Percent:      pct,
					CurrentTable: currentTable,
					TablesDone:   seenTables,
					TotalTables:  totalTables,
					BytesWritten: bytesWritten,
					Message:      msg,
				})
			})
			cmd.Stdout = pw
			cmd.Stderr = &stderrBuf

			runErr := cmd.Run()
			_ = outFile.Close()
			return stderrBuf.String(), runErr
		}

		binName := filepath.Base(binPath)
		isMariaDBDump := strings.Contains(strings.ToLower(binName), "mariadb")

		errText, dumpErr := runDump()
		if dumpErr != nil {
			var retryFlags []string
			if strings.Contains(errText, "COLUMN_STATISTICS") || strings.Contains(errText, "column-statistics") {
				retryFlags = append(retryFlags, "--column-statistics=0")
			}
			if !isMariaDBDump && (strings.Contains(errText, "GTID_PURGED") || strings.Contains(errText, "gtid-purged")) {
				retryFlags = append(retryFlags, "--set-gtid-purged=OFF")
			}
			if len(retryFlags) > 0 {
				errText, dumpErr = runDump(retryFlags...)
			}
		}
		if dumpErr != nil {
			_ = os.Remove(filePath)
			msg := strings.TrimSpace(errText)
			if msg == "" {
				msg = dumpErr.Error()
			}
			return "", emitErr(fmt.Errorf("%s failed: %s", binName, msg))
		}

	case "postgres":
		binPath, _, err := resolveBackupToolPathWithDriver("postgres", opts.ToolPath, "please install postgresql-client, or click 'Download Tool' in the Backup modal", "pg_dump")
		if err != nil {
			return "", emitErr(err)
		}
		if isDHubPortableTool(binPath) {
			if err := s.backupDatabaseNativeSQL(ctx, connectionID, conn.Driver, database, filePath, opts); err != nil {
				_ = os.Remove(filePath)
				return "", emitErr(err)
			}
			break
		}
		s.emitBackupProgress(app.BackupProgressEvent{
			ConnectionID: connectionID,
			Database:     database,
			Status:       "running",
			Percent:      10,
			Message:      fmt.Sprintf("Running %s...", filepath.Base(binPath)),
		})
		host := strings.TrimSpace(conn.Host)
		if host == "" {
			host = "localhost"
		}
		port := conn.Port
		if port <= 0 {
			port = 5432
		}
		user := strings.TrimSpace(conn.Username)
		if user == "" {
			user = "postgres"
		}

		args := []string{
			"-h", host,
			"-p", strconv.Itoa(port),
			"-U", user,
			"--no-owner",
			"--no-acl",
			"-f", filePath,
		}

		lowerPath := strings.ToLower(filePath)
		if opts.Format == "custom" || strings.HasSuffix(lowerPath, ".dump") || strings.HasSuffix(lowerPath, ".backup") {
			args = append(args, "-F", "c")
		} else if opts.Format == "tar" || strings.HasSuffix(lowerPath, ".tar") {
			args = append(args, "-F", "t")
		} else {
			args = append(args, "-F", "p")
		}

		switch opts.Mode {
		case "schema_only":
			args = append(args, "--schema-only")
		case "data_only":
			args = append(args, "--data-only")
		}

		if opts.Schema != "" && opts.Schema != "main" && opts.Schema != "all" {
			args = append(args, "-n", opts.Schema)
		}

		if opts.TableSelection == "include" {
			for _, tbl := range opts.Tables {
				args = append(args, "-t", tbl)
			}
		} else if opts.TableSelection == "exclude" {
			for _, tbl := range opts.Tables {
				args = append(args, "-T", tbl)
			}
		}

		args = append(args, database)

		cmd := exec.CommandContext(ctx, binPath, args...)
		cmd.Env = os.Environ()
		if conn.Password != "" {
			cmd.Env = append(cmd.Env, "PGPASSWORD="+conn.Password)
		}
		if mode := strings.TrimSpace(conn.SSLMode); mode != "" {
			cmd.Env = append(cmd.Env, "PGSSLMODE="+mode)
		}
		if out, err := cmd.CombinedOutput(); err != nil {
			msg := strings.TrimSpace(string(out))
			if msg == "" {
				msg = err.Error()
			}
			return "", emitErr(fmt.Errorf("pg_dump failed: %s", msg))
		}

	case "sqlite":
		if binPath, _, err := resolveBackupToolPathWithDriver("sqlite", opts.ToolPath, "", "sqlite3"); err == nil && conn.FilePath != "" {
			if isDHubPortableTool(binPath) {
				if err := s.backupDatabaseNativeSQL(ctx, connectionID, conn.Driver, database, filePath, opts); err != nil {
					_ = os.Remove(filePath)
					return "", emitErr(err)
				}
				break
			}
			outFile, err := os.Create(filePath)
			if err != nil {
				return "", emitErr(fmt.Errorf("failed to create backup file: %w", err))
			}
			cmdArgs := []string{conn.FilePath}
			if opts.Mode == "schema_only" {
				cmdArgs = append(cmdArgs, ".schema")
			} else {
				cmdArgs = append(cmdArgs, ".dump")
			}
			if opts.TableSelection == "include" {
				cmdArgs = append(cmdArgs, opts.Tables...)
			}
			cmd := exec.CommandContext(ctx, binPath, cmdArgs...)
			var stderr bytes.Buffer
			cmd.Stdout = outFile
			cmd.Stderr = &stderr
			runErr := cmd.Run()
			_ = outFile.Close()
			if runErr != nil {
				return "", emitErr(fmt.Errorf("sqlite3 dump failed: %s", strings.TrimSpace(stderr.String())))
			}
		} else if conn.FilePath != "" {
			if strings.TrimSpace(opts.ToolPath) != "" {
				return "", emitErr(fmt.Errorf("custom backup executable not found at: %s", opts.ToolPath))
			}
			if err := s.backupDatabaseNativeSQL(ctx, connectionID, conn.Driver, database, filePath, opts); err != nil {
				_ = os.Remove(filePath)
				return "", emitErr(err)
			}
		}

	case "mongodb":
		binPath, _, err := resolveBackupToolPathWithDriver("mongodb", opts.ToolPath, "please install MongoDB Database Tools, or click 'Download Tool' in the Backup modal", "mongodump")
		if err != nil {
			return "", emitErr(err)
		}
		s.emitBackupProgress(app.BackupProgressEvent{
			ConnectionID: connectionID,
			Database:     database,
			Status:       "running",
			Percent:      10,
			Message:      fmt.Sprintf("Running %s...", filepath.Base(binPath)),
		})
		host := strings.TrimSpace(conn.Host)
		if host == "" {
			host = "localhost"
		}
		port := conn.Port
		if port <= 0 {
			port = 27017
		}
		args := []string{
			"--host", host,
			"--port", strconv.Itoa(port),
			"--db", database,
			"--archive=" + filePath,
		}
		if strings.HasSuffix(strings.ToLower(filePath), ".gz") {
			args = append(args, "--gzip")
		}
		if strings.TrimSpace(conn.Username) != "" {
			args = append(args, "--username", conn.Username)
			if conn.Password != "" {
				args = append(args, "--password", conn.Password)
			}
			args = append(args, "--authenticationDatabase", "admin")
		}
		cmd := exec.CommandContext(ctx, binPath, args...)
		if out, err := cmd.CombinedOutput(); err != nil {
			msg := strings.TrimSpace(string(out))
			if msg == "" {
				msg = err.Error()
			}
			return "", fmt.Errorf("mongodump failed: %s", msg)
		}

	case "redis":
		binPath, _, err := resolveBackupToolPathWithDriver("redis", opts.ToolPath, "please install redis-tools or set a custom path", "redis-cli")
		if err != nil {
			return "", emitErr(err)
		}
		host := strings.TrimSpace(conn.Host)
		if host == "" {
			host = "127.0.0.1"
		}
		port := conn.Port
		if port <= 0 {
			port = 6379
		}
		args := []string{"-h", host, "-p", strconv.Itoa(port), "--rdb", filePath}
		cmd := exec.CommandContext(ctx, binPath, args...)
		cmd.Env = os.Environ()
		if conn.Password != "" {
			cmd.Env = append(cmd.Env, "REDISCLI_AUTH="+conn.Password)
		}
		if out, err := cmd.CombinedOutput(); err != nil {
			msg := strings.TrimSpace(string(out))
			if msg == "" {
				msg = err.Error()
			}
			return "", fmt.Errorf("redis-cli --rdb failed: %s", msg)
		}

	case "mssql":
		binPath, _, err := resolveBackupToolPathWithDriver("mssql", opts.ToolPath, "please install SQL Server Command Line Utilities (sqlcmd), or click 'Download Tool' in the Backup modal", "sqlcmd")
		if err != nil {
			return "", emitErr(err)
		}
		if isDHubPortableTool(binPath) || strings.HasSuffix(strings.ToLower(filePath), ".sql") {
			if err := s.backupDatabaseNativeSQL(ctx, connectionID, conn.Driver, database, filePath, opts); err != nil {
				_ = os.Remove(filePath)
				return "", emitErr(err)
			}
			break
		}
		host := strings.TrimSpace(conn.Host)
		if host == "" {
			host = "localhost"
		}
		port := conn.Port
		if port <= 0 {
			port = 1433
		}
		server := fmt.Sprintf("%s,%d", host, port)
		safeFile := strings.ReplaceAll(filePath, "'", "''")
		safeDB := strings.ReplaceAll(database, "]", "]]")
		tsql := fmt.Sprintf("BACKUP DATABASE [%s] TO DISK = N'%s' WITH INIT, FORMAT", safeDB, safeFile)
		args := []string{"-S", server, "-Q", tsql, "-C"}
		if strings.TrimSpace(conn.Username) != "" {
			args = append(args, "-U", conn.Username)
			if conn.Password != "" {
				args = append(args, "-P", conn.Password)
			}
		} else {
			args = append(args, "-E")
		}
		cmd := exec.CommandContext(ctx, binPath, args...)
		if out, err := cmd.CombinedOutput(); err != nil {
			msg := strings.TrimSpace(string(out))
			if msg == "" {
				msg = err.Error()
			}
			return "", fmt.Errorf("sqlcmd backup failed: %s", msg)
		}

	case "clickhouse":
		if err := s.backupDatabaseNativeSQL(ctx, connectionID, conn.Driver, database, filePath, opts); err != nil {
			_ = os.Remove(filePath)
			return "", emitErr(err)
		}

	case "oracle":
		if _, _, err := resolveBackupToolPathWithDriver("oracle", opts.ToolPath, "please install Oracle Client (sqlplus), or click 'Download Tool' in the Backup modal", "sqlplus"); err != nil {
			return "", emitErr(err)
		}
		if err := s.backupDatabaseNativeSQL(ctx, connectionID, conn.Driver, database, filePath, opts); err != nil {
			_ = os.Remove(filePath)
			return "", emitErr(err)
		}

	default:
		return "", emitErr(fmt.Errorf("unsupported driver for backup: %s", conn.Driver))
	}

	info, err := os.Stat(filePath)
	var bytesWritten int64
	if err == nil {
		bytesWritten = info.Size()
	}
	s.emitBackupProgress(app.BackupProgressEvent{
		ConnectionID: connectionID,
		Database:     database,
		Status:       "completed",
		Percent:      100,
		BytesWritten: bytesWritten,
		Message:      "Backup completed",
	})
	if err != nil {
		return fmt.Sprintf("Backup of '%s' saved to %s", database, filePath), nil
	}
	return fmt.Sprintf("Database '%s' backed up successfully to %s (%d KB)", database, filePath, (info.Size()+1023)/1024), nil
}

func (s *SchemaService) RestoreDatabase(connectionID, database, filePath string) (string, error) {
	return s.RestoreDatabaseWithOptions(connectionID, database, filePath, "")
}

func (s *SchemaService) RestoreDatabaseWithOptions(connectionID, database, filePath, optionsJSON string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	var opts RestoreOptions
	if strings.TrimSpace(optionsJSON) != "" {
		_ = json.Unmarshal([]byte(optionsJSON), &opts)
	}

	conn, err := s.store.GetConnection(ctx, connectionID)
	if err != nil {
		return "", fmt.Errorf("failed to get connection config: %w", err)
	}
	if conn.IsReadOnly {
		return "", fmt.Errorf("restore blocked: connection %q is configured as read-only", conn.Name)
	}
	if strings.EqualFold(strings.TrimSpace(conn.Driver), "qdrant") {
		return "", fmt.Errorf("Qdrant uses built-in HTTP snapshots: use Manage Collection -> Snapshots -> Upload Snapshot")
	}
	if strings.EqualFold(strings.TrimSpace(conn.Driver), "elasticsearch") || strings.EqualFold(strings.TrimSpace(conn.Driver), "es") {
		return "", fmt.Errorf("Elasticsearch uses the Snapshot API (/_snapshot) or index data import (JSONL / JSON / CSV via Import Data)")
	}
	conn, closeTunnel, err := withSSHTunnel(conn)
	if err != nil {
		return "", err
	}
	defer closeTunnel()

	database = strings.TrimSpace(database)
	if database == "" {
		database = strings.TrimSpace(conn.DatabaseName)
	}
	if database == "" {
		return "", fmt.Errorf("database name is required for restore")
	}

	opKey := backupRestoreOpKey(connectionID, database)
	s.registerOp(opKey, cancel)
	defer s.unregisterOp(opKey)

	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return "", fmt.Errorf("please select a .sql backup file to restore")
	}

	info, err := os.Stat(filePath)
	if err != nil {
		return "", fmt.Errorf("backup file not found: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("selected path is a directory, please select a .sql file")
	}
	totalBytes := info.Size()

	s.emitRestoreProgress(app.BackupProgressEvent{
		ConnectionID: connectionID,
		Database:     database,
		Status:       "running",
		Percent:      0,
		TotalBytes:   totalBytes,
		Message:      "Preparing restore...",
	})

	emitErr := func(err error) error {
		s.emitRestoreProgress(app.BackupProgressEvent{
			ConnectionID: connectionID,
			Database:     database,
			Status:       "error",
			Percent:      0,
			TotalBytes:   totalBytes,
			Message:      err.Error(),
		})
		return err
	}

	switch conn.Driver {
	case "mysql", "mariadb":
		firstBin := "mysql"
		secondBin := "mariadb"
		if conn.Driver == "mariadb" {
			firstBin = "mariadb"
			secondBin = "mysql"
		}
		binPath, _, err := resolveBackupToolPathWithDriver(conn.Driver, opts.ToolPath, "please install mysql-client or mariadb-client, or click 'Download Tool' in the Restore modal", firstBin, secondBin)
		if err != nil {
			return "", emitErr(err)
		}
		if isDHubPortableTool(binPath) {
			if err := s.restoreDatabaseNativeSQL(ctx, connectionID, conn.Driver, database, filePath, totalBytes); err != nil {
				return "", emitErr(err)
			}
			break
		}

		host := strings.TrimSpace(conn.Host)
		if host == "" || strings.EqualFold(host, "localhost") {
			host = "127.0.0.1"
		}
		port := conn.Port
		if port <= 0 {
			port = 3306
		}
		user := strings.TrimSpace(conn.Username)
		if user == "" {
			user = "root"
		}

		sqlFile, err := os.Open(filePath)
		if err != nil {
			return "", emitErr(fmt.Errorf("failed to open SQL file: %w", err))
		}
		defer sqlFile.Close()

		var sqlInput io.Reader = sqlFile
		if strings.HasSuffix(strings.ToLower(filePath), ".gz") {
			gzReader, gzErr := gzip.NewReader(sqlFile)
			if gzErr != nil {
				return "", emitErr(fmt.Errorf("failed to decompress .gz SQL file: %w", gzErr))
			}
			defer gzReader.Close()
			sqlInput = gzReader
		}

		args := []string{
			"--protocol=TCP",
			"-h", host,
			"-P", strconv.Itoa(port),
			"-u", user,
			"--default-character-set=utf8mb4",
			database,
		}

		cmd := exec.CommandContext(ctx, binPath, args...)
		cmd.Stdin = newRestoreProgressReader(sqlInput, func(bytesRead int64, currentTable string) {
			pct := 5.0
			if totalBytes > 0 {
				pct = (float64(bytesRead) / float64(totalBytes)) * 99.0
				if bytesRead > 0 && pct < 1 {
					pct = 1
				}
				if pct > 99 {
					pct = 99
				}
			}
			msg := fmt.Sprintf("Restoring with %s...", filepath.Base(binPath))
			if currentTable != "" {
				msg = fmt.Sprintf("Restoring table `%s`...", currentTable)
			}
			s.emitRestoreProgress(app.BackupProgressEvent{
				ConnectionID: connectionID,
				Database:     database,
				Status:       "running",
				Percent:      pct,
				CurrentTable: currentTable,
				BytesWritten: bytesRead,
				TotalBytes:   totalBytes,
				Message:      msg,
			})
		})
		cmd.Env = os.Environ()
		if conn.Password != "" {
			cmd.Env = append(cmd.Env, "MYSQL_PWD="+conn.Password)
		}

		if out, err := cmd.CombinedOutput(); err != nil {
			msg := strings.TrimSpace(string(out))
			if msg == "" {
				msg = err.Error()
			}
			return "", emitErr(fmt.Errorf("%s restore failed: %s", filepath.Base(binPath), msg))
		}

	case "postgres":
		isCustomFormat := strings.HasSuffix(strings.ToLower(filePath), ".dump") ||
			strings.HasSuffix(strings.ToLower(filePath), ".backup") ||
			strings.HasSuffix(strings.ToLower(filePath), ".tar")

		if !isCustomFormat {
			if f, err := os.Open(filePath); err == nil {
				hdr := make([]byte, 5)
				if n, _ := f.Read(hdr); n >= 5 && string(hdr[:5]) == "PGDMP" {
					isCustomFormat = true
				}
				_ = f.Close()
			}
		}

		host := strings.TrimSpace(conn.Host)
		if host == "" {
			host = "localhost"
		}
		port := conn.Port
		if port <= 0 {
			port = 5432
		}
		user := strings.TrimSpace(conn.Username)
		if user == "" {
			user = "postgres"
		}

		if isCustomFormat {
			binPath, _, err := resolveBackupToolPathWithDriver("postgres", opts.ToolPath, "please install postgresql-client, or click 'Download Tool' in the Restore modal", "pg_restore")
			if err != nil {
				return "", emitErr(err)
			}
			s.emitRestoreProgress(app.BackupProgressEvent{
				ConnectionID: connectionID,
				Database:     database,
				Status:       "running",
				Percent:      10,
				TotalBytes:   totalBytes,
				Message:      fmt.Sprintf("Running %s...", filepath.Base(binPath)),
			})
			args := []string{
				"-h", host,
				"-p", strconv.Itoa(port),
				"-U", user,
				"-d", database,
				"--no-owner",
				"--no-acl",
				filePath,
			}
			cmd := exec.CommandContext(ctx, binPath, args...)
			cmd.Env = os.Environ()
			if conn.Password != "" {
				cmd.Env = append(cmd.Env, "PGPASSWORD="+conn.Password)
			}
			if mode := strings.TrimSpace(conn.SSLMode); mode != "" {
				cmd.Env = append(cmd.Env, "PGSSLMODE="+mode)
			}
			if out, err := cmd.CombinedOutput(); err != nil {
				msg := strings.TrimSpace(string(out))
				if msg == "" {
					msg = err.Error()
				}
				return "", emitErr(fmt.Errorf("pg_restore failed: %s", msg))
			}
		} else {
			binPath, _, err := resolveBackupToolPathWithDriver("postgres", opts.ToolPath, "please install postgresql-client, or click 'Download Tool' in the Restore modal", "psql")
			if err != nil {
				return "", emitErr(err)
			}
			if isDHubPortableTool(binPath) {
				if err := s.restoreDatabaseNativeSQL(ctx, connectionID, conn.Driver, database, filePath, totalBytes); err != nil {
					return "", emitErr(err)
				}
				break
			}
			s.emitRestoreProgress(app.BackupProgressEvent{
				ConnectionID: connectionID,
				Database:     database,
				Status:       "running",
				Percent:      10,
				TotalBytes:   totalBytes,
				Message:      fmt.Sprintf("Running %s...", filepath.Base(binPath)),
			})
			args := []string{
				"-h", host,
				"-p", strconv.Itoa(port),
				"-U", user,
				"-d", database,
				"-f", filePath,
			}
			cmd := exec.CommandContext(ctx, binPath, args...)
			cmd.Env = os.Environ()
			if conn.Password != "" {
				cmd.Env = append(cmd.Env, "PGPASSWORD="+conn.Password)
			}
			if mode := strings.TrimSpace(conn.SSLMode); mode != "" {
				cmd.Env = append(cmd.Env, "PGSSLMODE="+mode)
			}
			if out, err := cmd.CombinedOutput(); err != nil {
				msg := strings.TrimSpace(string(out))
				if msg == "" {
					msg = err.Error()
				}
				return "", emitErr(fmt.Errorf("psql restore failed: %s", msg))
			}
		}

	case "sqlite":
		if err := s.restoreDatabaseNativeSQL(ctx, connectionID, conn.Driver, database, filePath, totalBytes); err != nil {
			return "", emitErr(fmt.Errorf("sqlite restore failed: %w", err))
		}

	case "mongodb":
		binPath, _, err := resolveBackupToolPathWithDriver("mongodb", opts.ToolPath, "please install MongoDB Database Tools, or click 'Download Tool' in the Restore modal", "mongorestore")
		if err != nil {
			return "", emitErr(err)
		}
		s.emitRestoreProgress(app.BackupProgressEvent{
			ConnectionID: connectionID,
			Database:     database,
			Status:       "running",
			Percent:      10,
			TotalBytes:   totalBytes,
			Message:      fmt.Sprintf("Running %s...", filepath.Base(binPath)),
		})
		host := strings.TrimSpace(conn.Host)
		if host == "" {
			host = "localhost"
		}
		port := conn.Port
		if port <= 0 {
			port = 27017
		}
		args := []string{
			"--host", host,
			"--port", strconv.Itoa(port),
			"--archive=" + filePath,
			"--nsInclude=" + database + ".*",
		}
		if strings.HasSuffix(strings.ToLower(filePath), ".gz") {
			args = append(args, "--gzip")
		}
		if strings.TrimSpace(conn.Username) != "" {
			args = append(args, "--username", conn.Username)
			if conn.Password != "" {
				args = append(args, "--password", conn.Password)
			}
			args = append(args, "--authenticationDatabase", "admin")
		}
		cmd := exec.CommandContext(ctx, binPath, args...)
		if out, err := cmd.CombinedOutput(); err != nil {
			msg := strings.TrimSpace(string(out))
			if msg == "" {
				msg = err.Error()
			}
			return "", fmt.Errorf("mongorestore failed: %s", msg)
		}

	case "mssql":
		binPath, _, err := resolveBackupToolPathWithDriver("mssql", opts.ToolPath, "please install SQL Server Command Line Utilities (sqlcmd), or click 'Download Tool' in the Restore modal", "sqlcmd")
		if err != nil {
			return "", emitErr(err)
		}
		if isDHubPortableTool(binPath) && !strings.HasSuffix(strings.ToLower(filePath), ".bak") {
			if err := s.restoreDatabaseNativeSQL(ctx, connectionID, conn.Driver, database, filePath, totalBytes); err != nil {
				return "", emitErr(err)
			}
			break
		}
		s.emitRestoreProgress(app.BackupProgressEvent{
			ConnectionID: connectionID,
			Database:     database,
			Status:       "running",
			Percent:      10,
			TotalBytes:   totalBytes,
			Message:      fmt.Sprintf("Running %s...", filepath.Base(binPath)),
		})
		host := strings.TrimSpace(conn.Host)
		if host == "" {
			host = "localhost"
		}
		port := conn.Port
		if port <= 0 {
			port = 1433
		}
		server := fmt.Sprintf("%s,%d", host, port)
		var args []string
		if strings.HasSuffix(strings.ToLower(filePath), ".bak") {
			safeFile := strings.ReplaceAll(filePath, "'", "''")
			safeDB := strings.ReplaceAll(database, "]", "]]")
			tsql := fmt.Sprintf("RESTORE DATABASE [%s] FROM DISK = N'%s' WITH REPLACE", safeDB, safeFile)
			args = []string{"-S", server, "-Q", tsql, "-C"}
		} else {
			args = []string{"-S", server, "-d", database, "-i", filePath, "-C"}
		}
		if strings.TrimSpace(conn.Username) != "" {
			args = append(args, "-U", conn.Username)
			if conn.Password != "" {
				args = append(args, "-P", conn.Password)
			}
		} else {
			args = append(args, "-E")
		}
		cmd := exec.CommandContext(ctx, binPath, args...)
		if out, err := cmd.CombinedOutput(); err != nil {
			msg := strings.TrimSpace(string(out))
			if msg == "" {
				msg = err.Error()
			}
			return "", fmt.Errorf("sqlcmd restore failed: %s", msg)
		}

	case "clickhouse":
		if err := s.restoreDatabaseNativeSQL(ctx, connectionID, conn.Driver, database, filePath, totalBytes); err != nil {
			return "", emitErr(fmt.Errorf("clickhouse restore failed: %w", err))
		}

	case "oracle":
		if _, _, err := resolveBackupToolPathWithDriver("oracle", opts.ToolPath, "please install Oracle Client (sqlplus), or click 'Download Tool' in the Restore modal", "sqlplus"); err != nil {
			return "", emitErr(err)
		}
		if err := s.restoreDatabaseNativeSQL(ctx, connectionID, conn.Driver, database, filePath, totalBytes); err != nil {
			return "", emitErr(fmt.Errorf("oracle restore failed: %w", err))
		}

	default:
		return "", emitErr(fmt.Errorf("unsupported driver for restore: %s", conn.Driver))
	}

	s.emitRestoreProgress(app.BackupProgressEvent{
		ConnectionID: connectionID,
		Database:     database,
		Status:       "completed",
		Percent:      100,
		BytesWritten: totalBytes,
		TotalBytes:   totalBytes,
		Message:      "Restore completed",
	})
	return fmt.Sprintf("Database '%s' restored successfully from %s", database, filepath.Base(filePath)), nil
}
