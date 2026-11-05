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
			for _, o := range objs {
				_ = s.store.SaveSchemaCache(ctx, store.CachedObject{
					ConnectionID: connectionID,
					DatabaseName: database,
					SchemaName:   schema,
					ObjectType:   o.Type,
					ObjectName:   o.Name,
					RowEstimate:  o.RowEstimate,
				})
			}
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
	_ = s.store.SaveSchemaCache(context.Background(), store.CachedObject{
		ConnectionID: connectionID,
		DatabaseName: database,
		SchemaName:   schema,
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
					_ = s.store.SaveSchemaCache(ctx, store.CachedObject{
						ConnectionID: connectionID,
						DatabaseName: database,
						SchemaName:   schema,
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
	if !strings.HasSuffix(strings.ToLower(filePath), ".sql") {
		filePath += ".sql"
	}

	if dir := filepath.Dir(filePath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", fmt.Errorf("failed to create backup directory: %w", err)
		}
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
	case "mysql":
		binPath, err := exec.LookPath("mysqldump")
		if err != nil {
			binPath, err = exec.LookPath("mariadb-dump")
			if err != nil {
				return "", fmt.Errorf("mysqldump executable not found in PATH; please install mysql-client")
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

		out, dumpErr := runDump()
		if dumpErr != nil {
			errText := string(out)
			var retryFlags []string
			if strings.Contains(errText, "COLUMN_STATISTICS") || strings.Contains(errText, "column-statistics") {
				retryFlags = append(retryFlags, "--column-statistics=0")
			}
			if strings.Contains(errText, "GTID_PURGED") || strings.Contains(errText, "gtid-purged") {
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
			return "", fmt.Errorf("mysqldump failed: %s", msg)
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

		switch opts.Mode {
		case "schema_only":
			args = append(args, "--schema-only")
		case "data_only":
			args = append(args, "--data-only")
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
	case "mysql":
		binPath, err := exec.LookPath("mysql")
		if err != nil {
			binPath, err = exec.LookPath("mariadb")
			if err != nil {
				return "", fmt.Errorf("mysql executable not found in PATH; please install mysql-client")
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
			return "", fmt.Errorf("mysql restore failed: %s", msg)
		}

	case "postgres":
		binPath, err := exec.LookPath("psql")
		if err != nil {
			return "", fmt.Errorf("psql executable not found in PATH; please install postgresql-client")
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

	default:
		return "", fmt.Errorf("unsupported driver for restore: %s", conn.Driver)
	}

	return fmt.Sprintf("Database '%s' restored successfully from %s", database, filepath.Base(filePath)), nil
}

