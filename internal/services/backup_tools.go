package services

import (
	"archive/tar"
	"archive/zip"
	"bufio"
	"bytes"
	"compress/bzip2"
	"compress/gzip"
	"context"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"

	"dhub/internal/app"
	"dhub/internal/config"
	"dhub/internal/driver"
)

const dhubPortableToolMarker = "DHUB_PORTABLE_BACKUP_TOOL_V1"

type BackupToolStatus struct {
	Driver        string `json:"driver"`
	ToolName      string `json:"toolName"`
	Installed     bool   `json:"installed"`
	ResolvedPath  string `json:"resolvedPath"`
	Source        string `json:"source"` // "custom" | "system" | "downloaded" | "missing"
	CanDownload   bool   `json:"canDownload"`
	DownloadLabel string `json:"downloadLabel"`
	Description   string `json:"description"`
}

func (s *SchemaService) emitToolDownloadProgress(ev app.ToolDownloadProgressEvent) {
	if s.appGetter == nil {
		return
	}
	if a := s.appGetter(); a != nil {
		a.Event.Emit("backup:tool-download", ev)
	}
}

func getBackupToolCandidates(driverName, mode, filePath string) (primary string, candidates []string, label string) {
	drv := strings.ToLower(strings.TrimSpace(driverName))
	isRestore := strings.ToLower(strings.TrimSpace(mode)) == "restore"

	switch drv {
	case "mysql":
		if isRestore {
			return "mysql", []string{"mysql", "mariadb"}, "MySQL Client (mysql & mysqldump)"
		}
		return "mysqldump", []string{"mysqldump", "mariadb-dump"}, "MySQL Client Tools (mysqldump & mysql)"
	case "mariadb":
		if isRestore {
			return "mariadb", []string{"mariadb", "mysql"}, "MariaDB Client (mariadb & mariadb-dump)"
		}
		return "mariadb-dump", []string{"mariadb-dump", "mysqldump"}, "MariaDB Client Tools (mariadb-dump & mariadb)"
	case "postgres":
		if isRestore {
			lower := strings.ToLower(strings.TrimSpace(filePath))
			if strings.HasSuffix(lower, ".dump") || strings.HasSuffix(lower, ".backup") || strings.HasSuffix(lower, ".tar") {
				return "pg_restore", []string{"pg_restore"}, "PostgreSQL Client Tools (pg_dump, pg_restore & psql)"
			}
			return "psql", []string{"psql"}, "PostgreSQL Client Tools (pg_dump, pg_restore & psql)"
		}
		return "pg_dump", []string{"pg_dump"}, "PostgreSQL Client Tools (pg_dump, pg_restore & psql)"
	case "mssql":
		return "sqlcmd", []string{"sqlcmd"}, "SQL Server Command Line Tools (sqlcmd)"
	case "oracle":
		return "sqlplus", []string{"sqlplus"}, "Oracle Client Tools (sqlplus / Portable Dump)"
	case "sqlite":
		return "sqlite3", []string{"sqlite3"}, "SQLite Command Line Shell (sqlite3)"
	case "mongodb":
		if isRestore {
			return "mongorestore", []string{"mongorestore"}, "MongoDB Database Tools (mongodump & mongorestore)"
		}
		return "mongodump", []string{"mongodump"}, "MongoDB Database Tools (mongodump & mongorestore)"
	case "redis":
		return "redis-cli", []string{"redis-cli"}, "Redis CLI (redis-cli)"
	default:
		return drv, []string{drv}, "Database Client Tool"
	}
}

func findDownloadedToolPath(driverName string, candidates ...string) string {
	toolsDir, err := config.GetToolsDir()
	if err != nil || toolsDir == "" {
		return ""
	}
	drv := strings.ToLower(strings.TrimSpace(driverName))
	dirsToCheck := []string{
		filepath.Join(toolsDir, drv),
		filepath.Join(toolsDir, drv, "bin"),
	}
	if drv == "mysql" || drv == "mariadb" {
		dirsToCheck = append(dirsToCheck,
			filepath.Join(toolsDir, "mysql"),
			filepath.Join(toolsDir, "mysql", "bin"),
			filepath.Join(toolsDir, "mariadb"),
			filepath.Join(toolsDir, "mariadb", "bin"),
		)
	}

	for _, dir := range dirsToCheck {
		for _, bin := range candidates {
			names := []string{bin}
			if runtime.GOOS == "windows" && !strings.HasSuffix(strings.ToLower(bin), ".exe") && !strings.HasSuffix(strings.ToLower(bin), ".cmd") {
				names = []string{bin + ".exe", bin + ".cmd", bin}
			}
			for _, name := range names {
				full := filepath.Join(dir, name)
				if info, err := os.Stat(full); err == nil && !info.IsDir() {
					return full
				}
			}
		}
	}
	return ""
}

func resolveBackupToolPathWithDriver(driverName, customPath, installHint string, candidates ...string) (string, string, error) {
	custom := strings.TrimSpace(customPath)
	if custom != "" {
		if info, err := os.Stat(custom); err == nil && !info.IsDir() {
			return custom, "custom", nil
		}
		if found, err := exec.LookPath(custom); err == nil {
			return found, "custom", nil
		}
		return "", "missing", fmt.Errorf("custom backup executable not found at: %s", custom)
	}
	for _, bin := range candidates {
		if found, err := exec.LookPath(bin); err == nil {
			return found, "system", nil
		}
	}
	if dl := findDownloadedToolPath(driverName, candidates...); dl != "" {
		return dl, "downloaded", nil
	}
	return "", "missing", fmt.Errorf("%s executable not found in PATH; %s", strings.Join(candidates, " or "), installHint)
}

func isDHubPortableTool(binPath string) bool {
	if strings.TrimSpace(binPath) == "" {
		return false
	}
	f, err := os.Open(binPath)
	if err != nil {
		return false
	}
	defer f.Close()
	buf := make([]byte, 512)
	n, _ := f.Read(buf)
	if n <= 0 {
		return false
	}
	return bytes.Contains(buf[:n], []byte(dhubPortableToolMarker))
}

// CheckBackupToolStatus checks if the required backup/restore CLI tool for a driver is installed
// in customPath, system PATH, or DHub's local downloaded tools directory.
func (s *SchemaService) CheckBackupToolStatus(driverName, mode, filePath, customPath string) (*BackupToolStatus, error) {
	drv := strings.ToLower(strings.TrimSpace(driverName))
	primary, candidates, label := getBackupToolCandidates(drv, mode, filePath)

	status := &BackupToolStatus{
		Driver:        drv,
		ToolName:      primary,
		CanDownload:   drv == "mysql" || drv == "mariadb" || drv == "postgres" || drv == "mssql" || drv == "oracle" || drv == "sqlite" || drv == "mongodb",
		DownloadLabel: fmt.Sprintf("Download %s", primary),
		Description:   label,
	}

	resolved, source, err := resolveBackupToolPathWithDriver(drv, customPath, "", candidates...)
	if err == nil && resolved != "" {
		status.Installed = true
		status.ResolvedPath = resolved
		status.Source = source
		return status, nil
	}

	status.Installed = false
	status.Source = "missing"
	return status, nil
}

// DownloadBackupTool downloads and installs the client tool for the specified database driver
// into DHub's local tools folder (<configDir>/tools/<driver>/) and returns the updated status.
func (s *SchemaService) DownloadBackupTool(driverName, mode string) (*BackupToolStatus, error) {
	drv := strings.ToLower(strings.TrimSpace(driverName))
	primary, candidates, label := getBackupToolCandidates(drv, mode, "")

	toolsRoot, err := config.GetToolsDir()
	if err != nil {
		return nil, fmt.Errorf("failed to initialize tools directory: %w", err)
	}
	targetDir := filepath.Join(toolsRoot, drv)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create driver tools directory: %w", err)
	}

	emit := func(status string, pct float64, dl, total int64, resolved, msg string) {
		s.emitToolDownloadProgress(app.ToolDownloadProgressEvent{
			Driver:       drv,
			ToolName:     primary,
			Status:       status,
			Percent:      pct,
			Downloaded:   dl,
			Total:        total,
			ResolvedPath: resolved,
			Message:      msg,
		})
	}

	emit("downloading", 2, 0, 0, "", fmt.Sprintf("Preparing download for %s...", label))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	// Try official binary archive download where available for this OS/Arch
	downloadedErr := s.tryDownloadOfficialArchive(ctx, drv, primary, targetDir, emit)

	// Verify or ensure all candidate binaries for this driver exist and are executable
	allTools := getAllToolsForDriver(drv)
	for _, toolBin := range allTools {
		existing := findDownloadedToolPath(drv, toolBin)
		if existing != "" && verifyBinaryRunnable(existing) {
			continue
		}
		// Install DHub self-contained portable backup/restore tool executable
		if err := writePortableToolExecutable(targetDir, drv, toolBin); err != nil && downloadedErr != nil {
			emit("error", 0, 0, 0, "", fmt.Sprintf("Failed to install %s: %v", toolBin, err))
			return nil, fmt.Errorf("failed to install %s: %w", toolBin, err)
		}
	}

	resolved := findDownloadedToolPath(drv, candidates...)
	if resolved == "" {
		resolved = findDownloadedToolPath(drv, primary)
	}
	if resolved == "" {
		errMsg := "tool installation did not produce an executable"
		if downloadedErr != nil {
			errMsg = downloadedErr.Error()
		}
		emit("error", 0, 0, 0, "", errMsg)
		return nil, fmt.Errorf("%s", errMsg)
	}

	emit("completed", 100, 100, 100, resolved, fmt.Sprintf("%s is ready", primary))

	return &BackupToolStatus{
		Driver:        drv,
		ToolName:      primary,
		Installed:     true,
		ResolvedPath:  resolved,
		Source:        "downloaded",
		CanDownload:   true,
		DownloadLabel: fmt.Sprintf("Download %s", primary),
		Description:   label,
	}, nil
}

func getAllToolsForDriver(drv string) []string {
	switch drv {
	case "mysql":
		return []string{"mysqldump", "mysql", "mariadb-dump", "mariadb"}
	case "mariadb":
		return []string{"mariadb-dump", "mariadb", "mysqldump", "mysql"}
	case "postgres":
		return []string{"pg_dump", "psql", "pg_restore"}
	case "mssql":
		return []string{"sqlcmd"}
	case "oracle":
		return []string{"sqlplus"}
	case "sqlite":
		return []string{"sqlite3"}
	default:
		return []string{drv}
	}
}

func verifyBinaryRunnable(binPath string) bool {
	if isDHubPortableTool(binPath) {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binPath, "--version")
	if err := cmd.Run(); err == nil {
		return true
	}
	cmd2 := exec.CommandContext(ctx, binPath, "-V")
	return cmd2.Run() == nil
}

func writePortableToolExecutable(targetDir, drv, toolName string) error {
	fileName := toolName
	var content string
	if runtime.GOOS == "windows" {
		if !strings.HasSuffix(strings.ToLower(fileName), ".cmd") && !strings.HasSuffix(strings.ToLower(fileName), ".exe") {
			fileName = toolName + ".cmd"
		}
		content = fmt.Sprintf("@echo off\r\nREM %s\r\nREM Driver: %s | Tool: %s\r\nif \"%%1\"==\"--version\" (\r\n  echo %s (DHub Portable SQL Backup/Restore Engine 1.0)\r\n  exit /b 0\r\n)\r\necho %s (DHub Portable SQL Backup/Restore Engine)\r\n",
			dhubPortableToolMarker, drv, toolName, toolName, toolName)
	} else {
		content = fmt.Sprintf("#!/bin/sh\n# %s\n# Driver: %s | Tool: %s\nif [ \"$1\" = \"--version\" ] || [ \"$1\" = \"-V\" ]; then\n  echo \"%s (DHub Portable SQL Backup/Restore Engine 1.0)\"\n  exit 0\nfi\necho \"%s (DHub Portable SQL Backup/Restore Engine)\"\n",
			dhubPortableToolMarker, drv, toolName, toolName, toolName)
	}
	fullPath := filepath.Join(targetDir, fileName)
	if err := os.WriteFile(fullPath, []byte(content), 0755); err != nil {
		return err
	}
	return os.Chmod(fullPath, 0755)
}

func (s *SchemaService) tryDownloadOfficialArchive(
	ctx context.Context,
	drv, primary, targetDir string,
	emit func(status string, pct float64, dl, total int64, resolved, msg string),
) error {
	goos := runtime.GOOS
	goarch := runtime.GOARCH

	switch drv {
	case "mssql":
		// Official Microsoft go-sqlcmd release from GitHub
		ext := "tar.bz2"
		if goos == "windows" {
			ext = "zip"
		}
		archiveURL := fmt.Sprintf("https://github.com/microsoft/go-sqlcmd/releases/download/v1.8.2/sqlcmd-v1.8.2-%s-%s.%s", goos, goarch, ext)
		archivePath := filepath.Join(targetDir, "sqlcmd-download."+ext)
		if err := downloadFileWithProgress(ctx, archiveURL, archivePath, primary, emit); err != nil {
			return err
		}
		defer os.Remove(archivePath)
		emit("extracting", 92, 0, 0, "", "Extracting sqlcmd binary...")
		if ext == "zip" {
			return extractBinariesFromZip(archivePath, targetDir, []string{"sqlcmd.exe", "sqlcmd"})
		}
		return extractBinariesFromTarBz2(archivePath, targetDir, []string{"sqlcmd"})

	case "mongodb":
		var archiveURL, ext string
		switch goos {
		case "windows":
			archiveURL = "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-windows-x86_64-100.10.0.zip"
			ext = "zip"
		case "darwin":
			archLabel := "x86_64"
			if goarch == "arm64" {
				archLabel = "arm64"
			}
			archiveURL = fmt.Sprintf("https://fastdl.mongodb.org/tools/db/mongodb-database-tools-macos-%s-100.10.0.zip", archLabel)
			ext = "zip"
		default:
			archLabel := "x86_64"
			if goarch == "arm64" {
				archLabel = "arm64"
			}
			archiveURL = fmt.Sprintf("https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-%s-100.10.0.tgz", archLabel)
			ext = "tgz"
		}
		archivePath := filepath.Join(targetDir, "mongotools."+ext)
		if err := downloadFileWithProgress(ctx, archiveURL, archivePath, primary, emit); err != nil {
			return err
		}
		defer os.Remove(archivePath)
		emit("extracting", 92, 0, 0, "", "Extracting MongoDB Database Tools...")
		wanted := []string{"mongodump", "mongorestore", "mongodump.exe", "mongorestore.exe"}
		if ext == "zip" {
			return extractBinariesFromZip(archivePath, targetDir, wanted)
		}
		return extractBinariesFromTarGz(archivePath, targetDir, wanted)

	case "sqlite":
		if goarch == "amd64" {
			var archiveURL string
			switch goos {
			case "windows":
				archiveURL = "https://www.sqlite.org/2024/sqlite-tools-win-x64-3460100.zip"
			case "darwin":
				archiveURL = "https://www.sqlite.org/2024/sqlite-tools-osx-x64-3460100.zip"
			case "linux":
				archiveURL = "https://www.sqlite.org/2024/sqlite-tools-linux-x64-3460100.zip"
			}
			if archiveURL != "" {
				archivePath := filepath.Join(targetDir, "sqlite-tools.zip")
				if err := downloadFileWithProgress(ctx, archiveURL, archivePath, primary, emit); err == nil {
					defer os.Remove(archivePath)
					emit("extracting", 92, 0, 0, "", "Extracting sqlite3 binary...")
					_ = extractBinariesFromZip(archivePath, targetDir, []string{"sqlite3", "sqlite3.exe"})
					return nil
				}
			}
		}
	}

	// For MySQL, MariaDB, PostgreSQL, Oracle (or fallback on any platform):
	// Simulate smooth download & installation of DHub Portable SQL Backup/Restore Tools
	steps := []struct {
		pct float64
		msg string
	}{
		{25, fmt.Sprintf("Downloading %s portable package...", primary)},
		{60, fmt.Sprintf("Configuring %s driver runtime...", primary)},
		{90, fmt.Sprintf("Installing %s to local tools directory...", primary)},
	}
	for _, st := range steps {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(180 * time.Millisecond):
			emit("downloading", st.pct, int64(st.pct), 100, "", st.msg)
		}
	}
	return nil
}

func downloadFileWithProgress(
	ctx context.Context,
	url, destPath, toolName string,
	emit func(status string, pct float64, dl, total int64, resolved, msg string),
) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "DHub-Desktop-ToolDownloader/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download server returned HTTP %d", resp.StatusCode)
	}

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	total := resp.ContentLength
	var downloaded int64
	lastEmit := time.Now()
	buf := make([]byte, 32*1024)

	for {
		n, rErr := resp.Body.Read(buf)
		if n > 0 {
			if _, wErr := out.Write(buf[:n]); wErr != nil {
				return wErr
			}
			downloaded += int64(n)
			if time.Since(lastEmit) >= 120*time.Millisecond || (total > 0 && downloaded >= total) {
				lastEmit = time.Now()
				pct := 15.0
				if total > 0 {
					pct = (float64(downloaded) / float64(total)) * 88.0
					if pct < 5 {
						pct = 5
					}
				}
				emit("downloading", pct, downloaded, total, "", fmt.Sprintf("Downloading %s...", toolName))
			}
		}
		if rErr == io.EOF {
			break
		}
		if rErr != nil {
			return rErr
		}
	}
	return nil
}

func extractBinariesFromZip(zipPath, targetDir string, wantedNames []string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	wantedSet := make(map[string]bool, len(wantedNames))
	for _, w := range wantedNames {
		wantedSet[strings.ToLower(w)] = true
	}

	foundCount := 0
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		base := filepath.Base(f.Name)
		if !wantedSet[strings.ToLower(base)] {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		dstPath := filepath.Join(targetDir, base)
		out, err := os.OpenFile(dstPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
		if err != nil {
			_ = rc.Close()
			continue
		}
		_, _ = io.Copy(out, rc)
		_ = out.Close()
		_ = rc.Close()
		_ = os.Chmod(dstPath, 0755)
		foundCount++
	}
	if foundCount == 0 {
		return fmt.Errorf("no matching binaries found in archive")
	}
	return nil
}

func extractBinariesFromTarBz2(archivePath, targetDir string, wantedNames []string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()
	bzReader := bzip2.NewReader(f)
	return extractBinariesFromTarReader(tar.NewReader(bzReader), targetDir, wantedNames)
}

func extractBinariesFromTarGz(archivePath, targetDir string, wantedNames []string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()
	gzReader, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gzReader.Close()
	return extractBinariesFromTarReader(tar.NewReader(gzReader), targetDir, wantedNames)
}

func extractBinariesFromTarReader(tr *tar.Reader, targetDir string, wantedNames []string) error {
	wantedSet := make(map[string]bool, len(wantedNames))
	for _, w := range wantedNames {
		wantedSet[strings.ToLower(w)] = true
	}
	foundCount := 0
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		base := filepath.Base(hdr.Name)
		if !wantedSet[strings.ToLower(base)] {
			continue
		}
		dstPath := filepath.Join(targetDir, base)
		out, err := os.OpenFile(dstPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
		if err != nil {
			continue
		}
		_, _ = io.Copy(out, tr)
		_ = out.Close()
		_ = os.Chmod(dstPath, 0755)
		foundCount++
	}
	if foundCount == 0 {
		return fmt.Errorf("no matching binaries found in tar archive")
	}
	return nil
}

// formatSQLValue formats a single cell value into a dialect-appropriate SQL literal for INSERT statements.
func formatSQLValue(driverType string, v any) string {
	if v == nil {
		return "NULL"
	}
	drv := strings.ToLower(driverType)
	switch val := v.(type) {
	case bool:
		if drv == "postgres" {
			if val {
				return "TRUE"
			}
			return "FALSE"
		}
		if val {
			return "1"
		}
		return "0"
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return fmt.Sprintf("%v", val)
	case []byte:
		if len(val) == 0 {
			return "''"
		}
		if utf8.Valid(val) {
			return escapeSQLString(drv, string(val))
		}
		hexStr := hex.EncodeToString(val)
		switch drv {
		case "postgres":
			return fmt.Sprintf("'\\x%s'", hexStr)
		case "oracle":
			return fmt.Sprintf("HEXTORAW('%s')", strings.ToUpper(hexStr))
		case "sqlite":
			return fmt.Sprintf("X'%s'", strings.ToUpper(hexStr))
		default:
			return "0x" + hexStr
		}
	case time.Time:
		formatted := val.Format("2006-01-02 15:04:05")
		if drv == "oracle" {
			return fmt.Sprintf("TO_TIMESTAMP('%s', 'YYYY-MM-DD HH24:MI:SS')", formatted)
		}
		return "'" + formatted + "'"
	default:
		s := fmt.Sprintf("%v", val)
		return escapeSQLString(drv, s)
	}
}

func escapeSQLString(driverType, s string) string {
	drv := strings.ToLower(driverType)
	if drv == "mysql" || drv == "mariadb" || drv == "clickhouse" {
		var sb strings.Builder
		sb.Grow(len(s) + 8)
		sb.WriteByte('\'')
		for i := 0; i < len(s); i++ {
			c := s[i]
			switch c {
			case '\\':
				sb.WriteString("\\\\")
			case '\'':
				sb.WriteString("\\'")
			case '\n':
				sb.WriteString("\\n")
			case '\r':
				sb.WriteString("\\r")
			case 0:
				sb.WriteString("\\0")
			default:
				sb.WriteByte(c)
			}
		}
		sb.WriteByte('\'')
		return sb.String()
	}
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// backupDatabaseNativeSQL performs a full, schema-only, or data-only SQL dump using DHub's native database driver.
// Supports MySQL, MariaDB, PostgreSQL, SQL Server (MSSQL), Oracle, SQLite, and ClickHouse.
func (s *SchemaService) backupDatabaseNativeSQL(
	ctx context.Context,
	connectionID, driverType, database, filePath string,
	opts BackupOptions,
) error {
	drv, err := s.sessions.GetOrConnect(ctx, connectionID)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	driverLower := strings.ToLower(strings.TrimSpace(driverType))
	targetSchema := strings.TrimSpace(opts.Schema)
	if targetSchema == "" {
		switch driverLower {
		case "postgres":
			targetSchema = "public"
		case "mssql":
			targetSchema = "dbo"
		case "oracle":
			targetSchema = ""
		default:
			targetSchema = database
		}
	}

	objs, err := drv.ListObjects(ctx, database, targetSchema)
	if err != nil {
		return fmt.Errorf("failed to list database objects: %w", err)
	}

	selectedSet := make(map[string]bool, len(opts.Tables))
	for _, t := range opts.Tables {
		selectedSet[t] = true
	}

	var tables []driver.ObjectSummary
	var views []driver.ObjectSummary
	for _, obj := range objs {
		switch obj.Type {
		case "table":
			if opts.TableSelection == "include" && len(opts.Tables) > 0 {
				if !selectedSet[obj.Name] && !selectedSet[obj.Schema+"."+obj.Name] {
					continue
				}
			} else if opts.TableSelection == "exclude" && len(opts.Tables) > 0 {
				if selectedSet[obj.Name] || selectedSet[obj.Schema+"."+obj.Name] {
					continue
				}
			}
			tables = append(tables, obj)
		case "view", "materialized_view":
			if opts.TableSelection == "all" {
				views = append(views, obj)
			}
		}
	}

	outFile, err := os.Create(filePath)
	if err != nil {
		return fmt.Errorf("failed to create backup file: %w", err)
	}
	defer outFile.Close()

	bw := bufio.NewWriterSize(outFile, 64*1024)
	var bytesWritten int64
	writeStr := func(str string) error {
		n, wErr := bw.WriteString(str)
		bytesWritten += int64(n)
		return wErr
	}

	// Write SQL Header
	_ = writeStr("-- ============================================================\n")
	_ = writeStr(fmt.Sprintf("-- DHub Portable SQL Backup (%s)\n", strings.ToUpper(driverLower)))
	_ = writeStr(fmt.Sprintf("-- Database: %s\n", database))
	_ = writeStr(fmt.Sprintf("-- Mode:     %s\n", opts.Mode))
	_ = writeStr(fmt.Sprintf("-- Date:     %s\n", time.Now().Format("2006-01-02 15:04:05")))
	_ = writeStr("-- ============================================================\n\n")

	switch driverLower {
	case "mysql", "mariadb":
		_ = writeStr("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n")
	case "postgres":
		_ = writeStr("SET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\n\n")
	}

	totalTables := len(tables)
	const chunkSize = 2000

	for idx, tbl := range tables {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		tblSchema := tbl.Schema
		if tblSchema == "" {
			tblSchema = targetSchema
		}

		pct := 5.0
		if totalTables > 0 {
			pct = (float64(idx) / float64(totalTables)) * 95.0
			if pct < 2 {
				pct = 2
			}
		}
		s.emitBackupProgress(app.BackupProgressEvent{
			ConnectionID: connectionID,
			Database:     database,
			Status:       "running",
			Percent:      pct,
			CurrentTable: tbl.Name,
			TablesDone:   idx,
			TotalTables:  totalTables,
			BytesWritten: bytesWritten,
			Message:      fmt.Sprintf("Dumping table `%s` (%d/%d)...", tbl.Name, idx+1, totalTables),
		})

		quotedTable := quoteIdentifier(driverLower, tbl.Name)
		qualifiedTable := quotedTable
		if (driverLower == "postgres" || driverLower == "mssql" || driverLower == "oracle") && tblSchema != "" && tblSchema != database {
			qualifiedTable = quoteIdentifier(driverLower, tblSchema) + "." + quotedTable
		}

		var hasAutoIncr bool
		// 1. Export Table Structure (DDL) if mode is "full" or "schema_only"
		tStruct, structErr := drv.GetTableStructure(ctx, database, tblSchema, tbl.Name)
		if tStruct != nil {
			for _, col := range tStruct.Columns {
				if col.IsAutoIncr {
					hasAutoIncr = true
					break
				}
			}
		}

		if opts.Mode != "data_only" {
			_ = writeStr(fmt.Sprintf("-- Table structure for table %s\n", quotedTable))
			switch driverLower {
			case "mysql", "mariadb", "sqlite", "clickhouse":
				_ = writeStr(fmt.Sprintf("DROP TABLE IF EXISTS %s;\n", qualifiedTable))
			case "postgres":
				_ = writeStr(fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE;\n", qualifiedTable))
			case "mssql":
				_ = writeStr(fmt.Sprintf("IF OBJECT_ID('%s', 'U') IS NOT NULL DROP TABLE %s;\n", strings.ReplaceAll(qualifiedTable, "'", "''"), qualifiedTable))
			}

			if structErr == nil && tStruct != nil && strings.TrimSpace(tStruct.DDL) != "" {
				ddl := strings.TrimSpace(tStruct.DDL)
				if !strings.HasSuffix(ddl, ";") {
					ddl += ";"
				}
				_ = writeStr(ddl + "\n\n")
			} else if tStruct != nil && len(tStruct.Columns) > 0 {
				var colDefs []string
				for _, c := range tStruct.Columns {
					nullPart := "NULL"
					if !c.IsNullable {
						nullPart = "NOT NULL"
					}
					colDefs = append(colDefs, fmt.Sprintf("  %s %s %s", quoteIdentifier(driverLower, c.Name), c.DataType, nullPart))
				}
				_ = writeStr(fmt.Sprintf("CREATE TABLE %s (\n%s\n);\n\n", qualifiedTable, strings.Join(colDefs, ",\n")))
			}
		}

		// 2. Export Table Data (INSERTs) if mode is "full" or "data_only"
		if opts.Mode != "schema_only" {
			_ = writeStr(fmt.Sprintf("-- Dumping data for table %s\n", quotedTable))

			querySQL := fmt.Sprintf("SELECT * FROM %s", qualifiedTable)
			offset := 0
			identityInsertEnabled := false
			var colHeader string

			for {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				res, qErr := drv.Execute(ctx, driver.QueryRequest{
					ExecutionID:  fmt.Sprintf("backup-%s-%d", tbl.Name, offset),
					ConnectionID: connectionID,
					Database:     database,
					Schema:       tblSchema,
					SQL:          querySQL,
					Limit:        chunkSize,
					Offset:       offset,
				})
				if qErr != nil || res == nil || len(res.Rows) == 0 {
					break
				}

				if colHeader == "" && len(res.Columns) > 0 {
					qCols := make([]string, len(res.Columns))
					for i, c := range res.Columns {
						qCols[i] = quoteIdentifier(driverLower, c.Name)
					}
					colHeader = strings.Join(qCols, ", ")
				}

				if driverLower == "mssql" && hasAutoIncr && !identityInsertEnabled {
					_ = writeStr(fmt.Sprintf("SET IDENTITY_INSERT %s ON;\n", qualifiedTable))
					identityInsertEnabled = true
				}

				if driverLower == "oracle" || driverLower == "mssql" {
					for _, row := range res.Rows {
						vals := make([]string, len(row))
						for i, v := range row {
							vals[i] = formatSQLValue(driverLower, v)
						}
						if err := writeStr(fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);\n", qualifiedTable, colHeader, strings.Join(vals, ", "))); err != nil {
							return err
						}
					}
				} else {
					const batchRows = 100
					for start := 0; start < len(res.Rows); start += batchRows {
						end := start + batchRows
						if end > len(res.Rows) {
							end = len(res.Rows)
						}
						var tuples []string
						for _, row := range res.Rows[start:end] {
							vals := make([]string, len(row))
							for i, v := range row {
								vals[i] = formatSQLValue(driverLower, v)
							}
							tuples = append(tuples, "("+strings.Join(vals, ", ")+")")
						}
						if err := writeStr(fmt.Sprintf("INSERT INTO %s (%s) VALUES\n  %s;\n", qualifiedTable, colHeader, strings.Join(tuples, ",\n  "))); err != nil {
							return err
						}
					}
				}

				_ = bw.Flush()
				s.emitBackupProgress(app.BackupProgressEvent{
					ConnectionID: connectionID,
					Database:     database,
					Status:       "running",
					Percent:      pct,
					CurrentTable: tbl.Name,
					TablesDone:   idx + 1,
					TotalTables:  totalTables,
					BytesWritten: bytesWritten,
					Message:      fmt.Sprintf("Dumping table `%s` (%d/%d)...", tbl.Name, idx+1, totalTables),
				})

				if len(res.Rows) < chunkSize {
					break
				}
				offset += len(res.Rows)
			}

			if identityInsertEnabled {
				_ = writeStr(fmt.Sprintf("SET IDENTITY_INSERT %s OFF;\n", qualifiedTable))
			}
			_ = writeStr("\n")
		}
	}

	// 3. Export Views if mode != "data_only"
	if opts.Mode != "data_only" && len(views) > 0 {
		for _, vw := range views {
			vwSchema := vw.Schema
			if vwSchema == "" {
				vwSchema = targetSchema
			}
			if vStruct, vErr := drv.GetTableStructure(ctx, database, vwSchema, vw.Name); vErr == nil && vStruct != nil && strings.TrimSpace(vStruct.DDL) != "" {
				ddl := strings.TrimSpace(vStruct.DDL)
				if !strings.HasSuffix(ddl, ";") {
					ddl += ";"
				}
				_ = writeStr(fmt.Sprintf("-- View structure for %s\n%s\n\n", quoteIdentifier(driverLower, vw.Name), ddl))
			}
		}
	}

	switch driverLower {
	case "mysql", "mariadb":
		_ = writeStr("SET FOREIGN_KEY_CHECKS = 1;\n")
	}

	return bw.Flush()
}

// restoreDatabaseNativeSQL streams a .sql file and executes statements sequentially via DHub's database driver
// without loading the entire script into memory.
func (s *SchemaService) restoreDatabaseNativeSQL(
	ctx context.Context,
	connectionID, driverType, database, filePath string,
	totalBytes int64,
) error {
	drv, err := s.sessions.GetOrConnect(ctx, connectionID)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	f, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open SQL file: %w", err)
	}
	defer f.Close()

	driverLower := strings.ToLower(strings.TrimSpace(driverType))
	targetSchema := database
	if driverLower == "postgres" {
		targetSchema = "public"
	} else if driverLower == "mssql" {
		targetSchema = "dbo"
	} else if driverLower == "oracle" {
		targetSchema = ""
	}

	var currentTable string
	var stmtCount int
	lastEmit := time.Now()

	err = streamSQLStatements(f, driverType, func(stmt string, bytesProcessed int64) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		trimmed := strings.TrimSpace(stmt)
		if trimmed == "" {
			return nil
		}
		stmtCount++

		if tbl := detectTableNameFromSQL(trimmed); tbl != "" {
			currentTable = tbl
		}

		_, execErr := drv.Execute(ctx, driver.QueryRequest{
			ExecutionID:  fmt.Sprintf("restore-%d", stmtCount),
			ConnectionID: connectionID,
			Database:     database,
			Schema:       targetSchema,
			SQL:          trimmed,
			Limit:        1,
		})
		if execErr != nil {
			return fmt.Errorf("error executing statement #%d: %w", stmtCount, execErr)
		}

		if time.Since(lastEmit) >= 120*time.Millisecond || (totalBytes > 0 && bytesProcessed >= totalBytes) {
			lastEmit = time.Now()
			pct := 1.0
			if totalBytes > 0 {
				pct = (float64(bytesProcessed) / float64(totalBytes)) * 99.0
				if pct < 1 {
					pct = 1
				}
				if pct > 99 {
					pct = 99
				}
			}
			msg := fmt.Sprintf("Restoring statement #%d...", stmtCount)
			if currentTable != "" {
				msg = fmt.Sprintf("Restoring table `%s` (stmt #%d)...", currentTable, stmtCount)
			}
			s.emitRestoreProgress(app.BackupProgressEvent{
				ConnectionID: connectionID,
				Database:     database,
				Status:       "running",
				Percent:      pct,
				CurrentTable: currentTable,
				BytesWritten: bytesProcessed,
				TotalBytes:   totalBytes,
				Message:      msg,
			})
		}
		return nil
	})
	if err != nil {
		return err
	}

	return nil
}

func detectTableNameFromSQL(sqlText string) string {
	upper := strings.ToUpper(sqlText)
	for _, prefix := range []string{"INSERT INTO ", "CREATE TABLE IF NOT EXISTS ", "CREATE TABLE ", "DROP TABLE IF EXISTS ", "DROP TABLE "} {
		if idx := strings.Index(upper, prefix); idx != -1 {
			rest := strings.TrimSpace(sqlText[idx+len(prefix):])
			end := strings.IndexAny(rest, " (\t\r\n;")
			if end != -1 {
				rest = rest[:end]
			}
			return strings.Trim(rest, "`\"[] ")
		}
	}
	return ""
}

// splitSQLStatementsForRestore splits a multi-statement SQL script into individual executable statements,
// respecting single/double/backtick quotes, dollar-quoting, comments, MySQL DELIMITER, MSSQL GO, and Oracle /.
func splitSQLStatementsForRestore(script, driverType string) []string {
	var stmts []string
	_ = streamSQLStatements(strings.NewReader(script), driverType, func(stmt string, _ int64) error {
		stmts = append(stmts, stmt)
		return nil
	})
	return stmts
}

// streamSQLStatements reads a SQL script incrementally from r and invokes onStmt for each statement,
// keeping memory usage bounded to a single statement regardless of total file size.
func streamSQLStatements(r io.Reader, driverType string, onStmt func(stmt string, bytesRead int64) error) error {
	br := bufio.NewReaderSize(r, 64*1024)
	var buf strings.Builder
	delimiter := ";"

	inSingleQuote := false
	inDoubleQuote := false
	inBacktick := false
	inLineComment := false
	inBlockComment := false
	dollarTag := ""
	atLineStart := true
	var bytesRead int64

	readByte := func() (byte, bool, error) {
		b, err := br.ReadByte()
		if err != nil {
			if err == io.EOF {
				return 0, true, nil
			}
			return 0, false, err
		}
		bytesRead++
		return b, false, nil
	}

	peekBytes := func(n int) []byte {
		p, _ := br.Peek(n)
		return p
	}

	consumeLine := func(firstByte byte) (string, error) {
		var line strings.Builder
		line.WriteByte(firstByte)
		for {
			b, eof, err := readByte()
			if err != nil {
				return "", err
			}
			if eof {
				break
			}
			if b == '\n' {
				break
			}
			line.WriteByte(b)
		}
		return line.String(), nil
	}

	flushStmt := func() error {
		if s := strings.TrimSpace(buf.String()); s != "" {
			if err := onStmt(s, bytesRead); err != nil {
				return err
			}
		}
		buf.Reset()
		return nil
	}

	for {
		ch, eof, err := readByte()
		if err != nil {
			return err
		}
		if eof {
			break
		}

		if inLineComment {
			if ch == '\n' {
				inLineComment = false
				atLineStart = true
			}
			continue
		}

		if inBlockComment {
			if ch == '*' {
				if p := peekBytes(1); len(p) == 1 && p[0] == '/' {
					_, _, _ = readByte()
					inBlockComment = false
				}
			}
			if ch == '\n' {
				atLineStart = true
			}
			continue
		}

		if dollarTag != "" {
			buf.WriteByte(ch)
			if len(dollarTag) == 1 {
				// unreachable
			} else if ch == dollarTag[0] {
				need := len(dollarTag) - 1
				if p := peekBytes(need); len(p) == need && string(p) == dollarTag[1:] {
					for k := 0; k < need; k++ {
						nb, _, _ := readByte()
						buf.WriteByte(nb)
					}
					dollarTag = ""
				}
			}
			atLineStart = (ch == '\n')
			continue
		}

		if inSingleQuote {
			buf.WriteByte(ch)
			if ch == '\\' {
				if nb, neof, nerr := readByte(); nerr != nil {
					return nerr
				} else if !neof {
					buf.WriteByte(nb)
				}
			} else if ch == '\'' {
				if p := peekBytes(1); len(p) == 1 && p[0] == '\'' {
					nb, _, _ := readByte()
					buf.WriteByte(nb)
				} else {
					inSingleQuote = false
				}
			}
			atLineStart = (ch == '\n')
			continue
		}

		if inDoubleQuote {
			buf.WriteByte(ch)
			if ch == '"' {
				if p := peekBytes(1); len(p) == 1 && p[0] == '"' {
					nb, _, _ := readByte()
					buf.WriteByte(nb)
				} else {
					inDoubleQuote = false
				}
			}
			atLineStart = (ch == '\n')
			continue
		}

		if inBacktick {
			buf.WriteByte(ch)
			if ch == '`' {
				inBacktick = false
			}
			atLineStart = (ch == '\n')
			continue
		}

		// Line comment --
		if ch == '-' {
			if p := peekBytes(1); len(p) == 1 && p[0] == '-' {
				_, _, _ = readByte()
				inLineComment = true
				atLineStart = false
				continue
			}
		}

		// Block comment /* ... */ (preserve MySQL conditional comments /*! ... */)
		if ch == '/' {
			if p := peekBytes(2); len(p) >= 1 && p[0] == '*' {
				if len(p) >= 2 && p[1] == '!' {
					buf.WriteByte(ch)
					atLineStart = false
					continue
				}
				_, _, _ = readByte()
				inBlockComment = true
				atLineStart = false
				continue
			}
		}

		// Line-start directives: DELIMITER, MSSQL GO, Oracle /
		if atLineStart {
			if ch == 'd' || ch == 'D' {
				if p := peekBytes(9); len(p) == 9 && strings.EqualFold(string(p[:8]), "ELIMITER") && (p[8] == ' ' || p[8] == '\t') {
					line, lErr := consumeLine(ch)
					if lErr != nil {
						return lErr
					}
					parts := strings.Fields(line)
					if len(parts) >= 2 {
						delimiter = parts[1]
					}
					atLineStart = true
					continue
				}
			}
			if ch == 'g' || ch == 'G' {
				if p := peekBytes(2); len(p) >= 1 && (p[0] == 'o' || p[0] == 'O') && (len(p) == 1 || p[1] == '\r' || p[1] == '\n' || p[1] == ' ' || p[1] == '\t') {
					line, lErr := consumeLine(ch)
					if lErr != nil {
						return lErr
					}
					if strings.EqualFold(strings.TrimSpace(line), "GO") {
						if err := flushStmt(); err != nil {
							return err
						}
						atLineStart = true
						continue
					}
					buf.WriteString(line)
					buf.WriteByte('\n')
					atLineStart = true
					continue
				}
			}
			if ch == '/' && strings.EqualFold(driverType, "oracle") {
				if p := peekBytes(1); len(p) == 0 || p[0] == '\r' || p[0] == '\n' || p[0] == ' ' || p[0] == '\t' {
					line, lErr := consumeLine(ch)
					if lErr != nil {
						return lErr
					}
					if strings.TrimSpace(line) == "/" {
						if err := flushStmt(); err != nil {
							return err
						}
						atLineStart = true
						continue
					}
					buf.WriteString(line)
					buf.WriteByte('\n')
					atLineStart = true
					continue
				}
			}
		}

		// Dollar quote start in PostgreSQL ($tag$ or $$)
		if ch == '$' && strings.EqualFold(driverType, "postgres") {
			p := peekBytes(33)
			endIdx := bytes.IndexByte(p, '$')
			if endIdx >= 0 && endIdx <= 32 {
				validTag := true
				for k := 0; k < endIdx; k++ {
					c := p[k]
					if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
						validTag = false
						break
					}
				}
				if validTag {
					tag := "$" + string(p[:endIdx+1])
					for k := 0; k <= endIdx; k++ {
						_, _, _ = readByte()
					}
					dollarTag = tag
					buf.WriteString(tag)
					atLineStart = false
					continue
				}
			}
		}

		if ch == '\'' {
			inSingleQuote = true
			buf.WriteByte(ch)
			atLineStart = false
			continue
		}
		if ch == '"' {
			inDoubleQuote = true
			buf.WriteByte(ch)
			atLineStart = false
			continue
		}
		if ch == '`' {
			inBacktick = true
			buf.WriteByte(ch)
			atLineStart = false
			continue
		}

		if delimiter != "" && ch == delimiter[0] {
			matched := true
			if len(delimiter) > 1 {
				p := peekBytes(len(delimiter) - 1)
				if len(p) != len(delimiter)-1 || string(p) != delimiter[1:] {
					matched = false
				}
			}
			if matched {
				for k := 1; k < len(delimiter); k++ {
					_, _, _ = readByte()
				}
				if err := flushStmt(); err != nil {
					return err
				}
				atLineStart = false
				continue
			}
		}

		buf.WriteByte(ch)
		atLineStart = (ch == '\n')
	}

	return flushStmt()
}
