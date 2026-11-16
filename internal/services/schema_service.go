package services

import (
	"bytes"
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
	"dhub/internal/manager"
	"dhub/internal/store"
	"dhub/internal/tunnel"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type SchemaService struct {
	store     *store.LocalStore
	sessions  *manager.SessionManager
	appGetter func() *application.App
}

func NewSchemaService(s *store.LocalStore, sm *manager.SessionManager, appGetter func() *application.App) *SchemaService {
	return &SchemaService{
		store:     s,
		sessions:  sm,
		appGetter: appGetter,
	}
}

func (s *SchemaService) GetDatabases(connectionID string) ([]string, error) {
	drv, err := s.sessions.GetOrConnect(context.Background(), connectionID)
	if err != nil {
		return nil, err
	}
	return drv.ListDatabases(context.Background())
}

func (s *SchemaService) GetSchemas(connectionID, database string) ([]string, error) {
	drv, err := s.sessions.GetOrConnect(context.Background(), connectionID)
	if err != nil {
		return nil, err
	}
	return drv.ListSchemas(context.Background(), database)
}

func (s *SchemaService) GetObjects(connectionID, database, schema string) ([]driver.ObjectSummary, error) {
	drv, err := s.sessions.GetOrConnect(context.Background(), connectionID)
	if err != nil {
		return nil, err
	}
	objs, err := drv.ListObjects(context.Background(), database, schema)
	if err == nil && len(objs) > 0 {
		go func() {
			ctx := context.Background()
			cachedItems := make([]store.CachedObject, len(objs))
			for i, o := range objs {
				canonicalSchema := o.Schema
				if canonicalSchema == "" {
					canonicalSchema = schema
				}
				if canonicalSchema == "" {
					canonicalSchema = database
				}
				cachedItems[i] = store.CachedObject{
					ConnectionID: connectionID,
					DatabaseName: database,
					SchemaName:   canonicalSchema,
					ObjectType:   o.Type,
					ObjectName:   o.Name,
					RowEstimate:  o.RowEstimate,
				}
			}
			_ = s.store.SaveSchemaCacheBatch(ctx, cachedItems)
		}()
	}
	return objs, err
}

func (s *SchemaService) GetTableStructure(connectionID, database, schema, table string) (*driver.TableStructure, error) {
	drv, err := s.sessions.GetOrConnect(context.Background(), connectionID)
	if err != nil {
		return nil, err
	}
	structData, err := drv.GetTableStructure(context.Background(), database, schema, table)
	if err != nil {
		return nil, err
	}

	// Update background cache
	canonicalSchema := structData.Schema
	if canonicalSchema == "" {
		canonicalSchema = schema
	}
	if canonicalSchema == "" {
		canonicalSchema = database
	}
	_ = s.store.SaveSchemaCache(context.Background(), store.CachedObject{
		ConnectionID: connectionID,
		DatabaseName: database,
		SchemaName:   canonicalSchema,
		ObjectType:   "table",
		ObjectName:   table,
		Columns:      structData.Columns,
		Indexes:      structData.Indexes,
		ForeignKeys:  structData.ForeignKeys,
	})

	return structData, nil
}

func (s *SchemaService) GetCachedSchema(connectionID, database, schema string) ([]store.CachedObject, error) {
	return s.store.GetCachedObjects(context.Background(), connectionID, database, schema)
}

func (s *SchemaService) SearchEverywhere(connectionID, query string) ([]store.CachedObject, error) {
	return s.store.SearchEverywhere(context.Background(), connectionID, query, 500)
}

func (s *SchemaService) RefreshSchema(connectionID, database, schema string) (string, error) {
	drv, err := s.sessions.GetOrConnect(context.Background(), connectionID)
	if err != nil {
		return "", err
	}

	s.emitSync(connectionID, database, schema, "syncing", "Crawling schema metadata...")

	go func() {
		ctx := context.Background()
		objs, err := drv.ListObjects(ctx, database, schema)
		if err != nil {
			s.emitSync(connectionID, database, schema, "error", err.Error())
			return
		}

		for _, obj := range objs {
			if obj.Type == "table" {
				if tStruct, err := drv.GetTableStructure(ctx, database, schema, obj.Name); err == nil {
					canonicalSchema := obj.Schema
					if canonicalSchema == "" {
						canonicalSchema = tStruct.Schema
					}
					if canonicalSchema == "" {
						canonicalSchema = schema
					}
					if canonicalSchema == "" {
						canonicalSchema = database
					}
					_ = s.store.SaveSchemaCache(ctx, store.CachedObject{
						ConnectionID: connectionID,
						DatabaseName: database,
						SchemaName:   canonicalSchema,
						ObjectType:   obj.Type,
						ObjectName:   obj.Name,
						Columns:      tStruct.Columns,
						Indexes:      tStruct.Indexes,
						ForeignKeys:  tStruct.ForeignKeys,
					})
				}
			}
		}

		s.emitSync(connectionID, database, schema, "ready", fmt.Sprintf("Synced %d objects", len(objs)))
	}()

	return "Sync started in background", nil
}

func (s *SchemaService) emitSync(connID, db, schema, status, message string) {
	if a := s.appGetter(); a != nil {
		a.Event.Emit("schema:sync", app.SchemaSyncEvent{
			ConnectionID: connID,
			Database:     db,
			Schema:       schema,
			Status:       status,
			Message:      message,
		})
	}
}

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
}

func (s *SchemaService) BackupDatabase(connectionID, database, filePath, optionsJSON string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	conn, err := s.store.GetConnection(ctx, connectionID)
	if err != nil {
		return "", fmt.Errorf("failed to get connection config: %w", err)
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
	if !strings.HasSuffix(lowerPath, ".sql") && !strings.HasSuffix(lowerPath, ".dump") && !strings.HasSuffix(lowerPath, ".backup") && !strings.HasSuffix(lowerPath, ".tar") {
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

	switch conn.Driver {
	case "mysql", "mariadb":
		firstBin := "mysqldump"
		secondBin := "mariadb-dump"
		if conn.Driver == "mariadb" {
			firstBin = "mariadb-dump"
			secondBin = "mysqldump"
		}
		binPath, err := exec.LookPath(firstBin)
		if err != nil {
			binPath, err = exec.LookPath(secondBin)
			if err != nil {
				return "", fmt.Errorf("%s or %s executable not found in PATH; please install mysql-client or mariadb-client", firstBin, secondBin)
			}
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

		runDump := func(extraArgs ...string) ([]byte, error) {
			args := make([]string, 0, len(baseArgs)+len(extraArgs)+len(opts.Tables)+2)
			args = append(args, baseArgs...)
			args = append(args, extraArgs...)
			args = append(args, "--result-file="+filePath, database)

			// Table inclusions
			if opts.TableSelection == "include" {
				args = append(args, opts.Tables...)
			}

			cmd := exec.CommandContext(ctx, binPath, args...)
			cmd.Env = os.Environ()
			if conn.Password != "" {
				cmd.Env = append(cmd.Env, "MYSQL_PWD="+conn.Password)
			}
			return cmd.CombinedOutput()
		}

		binName := filepath.Base(binPath)
		isMariaDBDump := strings.Contains(strings.ToLower(binName), "mariadb")

		out, dumpErr := runDump()
		if dumpErr != nil {
			errText := string(out)
			var retryFlags []string
			if strings.Contains(errText, "COLUMN_STATISTICS") || strings.Contains(errText, "column-statistics") {
				retryFlags = append(retryFlags, "--column-statistics=0")
			}
			if !isMariaDBDump && (strings.Contains(errText, "GTID_PURGED") || strings.Contains(errText, "gtid-purged")) {
				retryFlags = append(retryFlags, "--set-gtid-purged=OFF")
			}
			if len(retryFlags) > 0 {
				out, dumpErr = runDump(retryFlags...)
			}
		}
		if dumpErr != nil {
			msg := strings.TrimSpace(string(out))
			if msg == "" {
				msg = dumpErr.Error()
			}
			return "", fmt.Errorf("%s failed: %s", binName, msg)
		}

	case "postgres":
		binPath, err := exec.LookPath("pg_dump")
		if err != nil {
			return "", fmt.Errorf("pg_dump executable not found in PATH; please install postgresql-client")
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
			return "", fmt.Errorf("pg_dump failed: %s", msg)
		}

	case "sqlite":
		if binPath, err := exec.LookPath("sqlite3"); err == nil && conn.FilePath != "" {
			outFile, err := os.Create(filePath)
			if err != nil {
				return "", fmt.Errorf("failed to create backup file: %w", err)
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
				return "", fmt.Errorf("sqlite3 dump failed: %s", strings.TrimSpace(stderr.String()))
			}
		} else if conn.FilePath != "" {
			src, err := os.Open(conn.FilePath)
			if err != nil {
				return "", fmt.Errorf("failed to open sqlite file: %w", err)
			}
			defer src.Close()
			dst, err := os.Create(filePath)
			if err != nil {
				return "", fmt.Errorf("failed to create backup file: %w", err)
			}
			if _, err := io.Copy(dst, src); err != nil {
				_ = dst.Close()
				return "", fmt.Errorf("failed to copy sqlite database: %w", err)
			}
			_ = dst.Close()
		}

	case "mongodb":
		binPath, err := exec.LookPath("mongodump")
		if err != nil {
			return "", fmt.Errorf("mongodump executable not found in PATH; please install MongoDB Database Tools")
		}
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
		binPath, err := exec.LookPath("redis-cli")
		if err != nil {
			return "", fmt.Errorf("redis-cli executable not found in PATH; please install redis-tools")
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
		binPath, err := exec.LookPath("sqlcmd")
		if err != nil {
			return "", fmt.Errorf("sqlcmd executable not found in PATH; please install Microsoft SQL Server Command Line Utilities")
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
		drv, err := s.sessions.GetOrConnect(ctx, connectionID)
		if err != nil {
			return "", err
		}
		objs, err := drv.ListObjects(ctx, database, database)
		if err != nil {
			return "", fmt.Errorf("failed to list clickhouse objects: %w", err)
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("-- ClickHouse SQL Backup for database `%s`\n\n", strings.ReplaceAll(database, "`", "``")))
		for _, obj := range objs {
			if opts.TableSelection == "include" && len(opts.Tables) > 0 {
				matched := false
				for _, t := range opts.Tables {
					if t == obj.Name {
						matched = true
						break
					}
				}
				if !matched {
					continue
				}
			}
			if tStruct, sErr := drv.GetTableStructure(ctx, database, database, obj.Name); sErr == nil && tStruct.DDL != "" {
				sb.WriteString(strings.TrimSpace(tStruct.DDL) + ";\n\n")
			}
		}
		if err := os.WriteFile(filePath, []byte(sb.String()), 0o644); err != nil {
			return "", fmt.Errorf("failed to write clickhouse backup: %w", err)
		}

	default:
		return "", fmt.Errorf("unsupported driver for backup: %s", conn.Driver)
	}

	info, err := os.Stat(filePath)
	if err != nil {
		return fmt.Sprintf("Backup of '%s' saved to %s", database, filePath), nil
	}
	return fmt.Sprintf("Database '%s' backed up successfully to %s (%d KB)", database, filePath, (info.Size()+1023)/1024), nil
}

func (s *SchemaService) RestoreDatabase(connectionID, database, filePath string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	conn, err := s.store.GetConnection(ctx, connectionID)
	if err != nil {
		return "", fmt.Errorf("failed to get connection config: %w", err)
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

	switch conn.Driver {
	case "mysql", "mariadb":
		firstBin := "mysql"
		secondBin := "mariadb"
		if conn.Driver == "mariadb" {
			firstBin = "mariadb"
			secondBin = "mysql"
		}
		binPath, err := exec.LookPath(firstBin)
		if err != nil {
			binPath, err = exec.LookPath(secondBin)
			if err != nil {
				return "", fmt.Errorf("%s or %s executable not found in PATH; please install mysql-client or mariadb-client", firstBin, secondBin)
			}
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
			return "", fmt.Errorf("failed to open SQL file: %w", err)
		}
		defer sqlFile.Close()

		args := []string{
			"--protocol=TCP",
			"-h", host,
			"-P", strconv.Itoa(port),
			"-u", user,
			"--default-character-set=utf8mb4",
			database,
		}

		cmd := exec.CommandContext(ctx, binPath, args...)
		cmd.Stdin = sqlFile
		cmd.Env = os.Environ()
		if conn.Password != "" {
			cmd.Env = append(cmd.Env, "MYSQL_PWD="+conn.Password)
		}

		if out, err := cmd.CombinedOutput(); err != nil {
			msg := strings.TrimSpace(string(out))
			if msg == "" {
				msg = err.Error()
			}
			return "", fmt.Errorf("%s restore failed: %s", filepath.Base(binPath), msg)
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
			binPath, err := exec.LookPath("pg_restore")
			if err != nil {
				return "", fmt.Errorf("pg_restore executable not found in PATH; please install postgresql-client")
			}
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
				return "", fmt.Errorf("pg_restore failed: %s", msg)
			}
		} else {
			binPath, err := exec.LookPath("psql")
			if err != nil {
				return "", fmt.Errorf("psql executable not found in PATH; please install postgresql-client")
			}
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
				return "", fmt.Errorf("psql restore failed: %s", msg)
			}
		}

	case "sqlite":
		drv, err := s.sessions.GetOrConnect(ctx, connectionID)
		if err != nil {
			return "", err
		}
		sqlBytes, err := os.ReadFile(filePath)
		if err != nil {
			return "", fmt.Errorf("failed to read SQL file: %w", err)
		}
		_, err = drv.Execute(ctx, driver.QueryRequest{
			ConnectionID: connectionID,
			Database:     database,
			Schema:       database,
			SQL:          string(sqlBytes),
		})
		if err != nil {
			return "", fmt.Errorf("sqlite restore failed: %w", err)
		}

	case "mongodb":
		binPath, err := exec.LookPath("mongorestore")
		if err != nil {
			return "", fmt.Errorf("mongorestore executable not found in PATH; please install MongoDB Database Tools")
		}
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
		binPath, err := exec.LookPath("sqlcmd")
		if err != nil {
			return "", fmt.Errorf("sqlcmd executable not found in PATH; please install Microsoft SQL Server Command Line Utilities")
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
		drv, err := s.sessions.GetOrConnect(ctx, connectionID)
		if err != nil {
			return "", err
		}
		sqlBytes, err := os.ReadFile(filePath)
		if err != nil {
			return "", fmt.Errorf("failed to read SQL file: %w", err)
		}
		_, err = drv.Execute(ctx, driver.QueryRequest{
			ConnectionID: connectionID,
			Database:     database,
			Schema:       database,
			SQL:          string(sqlBytes),
		})
		if err != nil {
			return "", fmt.Errorf("clickhouse restore failed: %w", err)
		}

	default:
		return "", fmt.Errorf("unsupported driver for restore: %s", conn.Driver)
	}

	return fmt.Sprintf("Database '%s' restored successfully from %s", database, filepath.Base(filePath)), nil
}

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

	srcObjs, err := srcDrv.ListObjects(ctx, srcDB, srcSchema)
	if err != nil {
		return nil, fmt.Errorf("failed to list source objects: %w", err)
	}
	dstObjs, err := dstDrv.ListObjects(ctx, dstDB, dstSchema)
	if err != nil {
		return nil, fmt.Errorf("failed to list target objects: %w", err)
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
	var allNames []string
	for name := range allNamesMap {
		allNames = append(allNames, name)
	}
	// Simple sort
	for i := 0; i < len(allNames); i++ {
		for j := i + 1; j < len(allNames); j++ {
			if allNames[i] > allNames[j] {
				allNames[i], allNames[j] = allNames[j], allNames[i]
			}
		}
	}

	res := &SchemaDiffResult{
		SourceLabel: fmt.Sprintf("%s.%s", srcDB, srcSchema),
		TargetLabel: fmt.Sprintf("%s.%s", dstDB, dstSchema),
		TableDiffs:  make([]TableDiff, 0),
	}
	var migrationParts []string

	for _, name := range allNames {
		_, inSrc := srcTables[name]
		_, inDst := dstTables[name]

		if inSrc && !inDst {
			res.MissingTarget++
			mig := fmt.Sprintf("-- Create missing table %s in target", name)
			if st, sErr := srcDrv.GetTableStructure(ctx, srcDB, srcSchema, name); sErr == nil && st.DDL != "" {
				mig = strings.TrimSpace(st.DDL)
				if !strings.HasSuffix(mig, ";") {
					mig += ";"
				}
			}
			res.TableDiffs = append(res.TableDiffs, TableDiff{
				TableName: name,
				Status:    "missing_in_target",
				Migration: mig,
			})
			migrationParts = append(migrationParts, mig)
			continue
		}

		if !inSrc && inDst {
			res.ExtraTarget++
			mig := fmt.Sprintf("-- Table %s exists only in target (review before dropping):\n-- DROP TABLE %s;", name, name)
			res.TableDiffs = append(res.TableDiffs, TableDiff{
				TableName: name,
				Status:    "extra_in_target",
				Migration: mig,
			})
			continue
		}

		srcStruct, sErr := srcDrv.GetTableStructure(ctx, srcDB, srcSchema, name)
		dstStruct, dErr := dstDrv.GetTableStructure(ctx, dstDB, dstSchema, name)
		if sErr != nil || dErr != nil {
			continue
		}

		srcCols := make(map[string]driver.ColumnMeta)
		for _, c := range srcStruct.Columns {
			srcCols[c.Name] = c
		}
		dstCols := make(map[string]driver.ColumnMeta)
		for _, c := range dstStruct.Columns {
			dstCols[c.Name] = c
		}

		var colDiffs []ColumnDiff
		var alterStmts []string

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
				alterStmts = append(alterStmts, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s %s;", name, sc.Name, sc.DataType, nullStr))
			} else if !strings.EqualFold(sc.DataType, dc.DataType) || sc.IsNullable != dc.IsNullable {
				colDiffs = append(colDiffs, ColumnDiff{
					ColumnName: sc.Name,
					Status:     "modified",
					SourceType: sc.DataType,
					TargetType: dc.DataType,
					Detail:     fmt.Sprintf("Type: %s -> %s, Nullable: %v -> %v", dc.DataType, sc.DataType, dc.IsNullable, sc.IsNullable),
				})
				alterStmts = append(alterStmts, fmt.Sprintf("-- Column %s.%s differs: target=%s (nullable=%v), source=%s (nullable=%v)", name, sc.Name, dc.DataType, dc.IsNullable, sc.DataType, sc.IsNullable))
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
				alterStmts = append(alterStmts, fmt.Sprintf("-- Extra column in target: ALTER TABLE %s DROP COLUMN %s;", name, dc.Name))
			}
		}

		if len(colDiffs) == 0 {
			res.Identical++
		} else {
			res.Modified++
			mig := strings.Join(alterStmts, "\n")
			res.TableDiffs = append(res.TableDiffs, TableDiff{
				TableName:   name,
				Status:      "modified",
				ColumnDiffs: colDiffs,
				Migration:   mig,
			})
			migrationParts = append(migrationParts, mig)
		}
	}

	res.MigrationSQL = strings.Join(migrationParts, "\n\n")
	return res, nil
}

// GetDatabaseDDL returns the combined DDL statements (schema only, no data) for a database or specific schema.
func (s *SchemaService) GetDatabaseDDL(connectionID, database, schema string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	drv, err := s.sessions.GetOrConnect(ctx, connectionID)
	if err != nil {
		return "", err
	}

	conn, _ := s.store.GetConnection(ctx, connectionID)
	driverName := ""
	if conn != nil {
		driverName = strings.ToLower(strings.TrimSpace(conn.Driver))
	}

	database = strings.TrimSpace(database)
	schema = strings.TrimSpace(schema)

	var schemas []string
	if schema != "" {
		schemas = []string{schema}
	} else if driverName == "postgres" || driverName == "mssql" {
		listed, listErr := drv.ListSchemas(ctx, database)
		if listErr == nil && len(listed) > 0 {
			schemas = listed
		} else if driverName == "postgres" {
			schemas = []string{"public"}
		} else {
			schemas = []string{"dbo"}
		}
	} else {
		schemas = []string{database}
	}

	var sb strings.Builder
	sb.WriteString("-- ============================================================\n")
	sb.WriteString("-- DHub DDL Export (Structure Only, No Data)\n")
	if database != "" {
		sb.WriteString(fmt.Sprintf("-- Database: %s\n", database))
	}
	if schema != "" {
		sb.WriteString(fmt.Sprintf("-- Schema:   %s\n", schema))
	}
	sb.WriteString(fmt.Sprintf("-- Date:     %s\n", time.Now().Format("2006-01-02 15:04:05")))
	sb.WriteString("-- ============================================================\n\n")

	objectCount := 0
	for _, sch := range schemas {
		objs, listErr := drv.ListObjects(ctx, database, sch)
		if listErr != nil {
			if len(schemas) == 1 {
				return "", listErr
			}
			continue
		}

		var ordered []driver.ObjectSummary
		for _, o := range objs {
			if o.Type == "table" {
				ordered = append(ordered, o)
			}
		}
		for _, o := range objs {
			if o.Type == "view" || o.Type == "materialized_view" {
				ordered = append(ordered, o)
			}
		}

		if len(schemas) > 1 && len(ordered) > 0 {
			sb.WriteString(fmt.Sprintf("-- Schema: %s\n\n", sch))
		}

		for _, obj := range ordered {
			tStruct, structErr := drv.GetTableStructure(ctx, database, sch, obj.Name)
			if structErr != nil || tStruct == nil {
				continue
			}
			ddl := strings.TrimSpace(tStruct.DDL)
			if ddl == "" {
				continue
			}
			if !strings.HasSuffix(ddl, ";") {
				ddl += ";"
			}
			label := strings.ToUpper(obj.Type)
			if sch != "" && sch != database {
				sb.WriteString(fmt.Sprintf("-- %s: %s.%s\n", label, sch, obj.Name))
			} else {
				sb.WriteString(fmt.Sprintf("-- %s: %s\n", label, obj.Name))
			}
			sb.WriteString(ddl)
			sb.WriteString("\n\n")
			objectCount++
		}
	}

	if objectCount == 0 {
		sb.WriteString("-- No tables or views found.\n")
	}

	return strings.TrimRight(sb.String(), "\n") + "\n", nil
}

// SaveDDLFile writes generated DDL text to the specified file path on disk.
func (s *SchemaService) SaveDDLFile(filePath, content string) error {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return fmt.Errorf("file path is required")
	}
	return os.WriteFile(filePath, []byte(content), 0644)
}

