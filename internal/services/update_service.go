package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"dhub/internal/app"
	"dhub/internal/version"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type ReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
	ContentType        string `json:"content_type"`
}

type GitHubReleaseResponse struct {
	TagName     string         `json:"tag_name"`
	Name        string         `json:"name"`
	Body        string         `json:"body"`
	HTMLURL     string         `json:"html_url"`
	PublishedAt string         `json:"published_at"`
	Prerelease  bool           `json:"prerelease"`
	Draft       bool           `json:"draft"`
	Assets      []ReleaseAsset `json:"assets"`
}

type UpdateInfo struct {
	HasUpdate      bool   `json:"hasUpdate"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	ReleaseTitle   string `json:"releaseTitle"`
	ReleaseNotes   string `json:"releaseNotes"`
	ReleaseURL     string `json:"releaseUrl"`
	DownloadURL    string `json:"downloadUrl"`
	AssetFileName  string `json:"assetFileName"`
	AssetSize      int64  `json:"assetSize"`
	PublishedAt    string `json:"publishedAt"`
	PlatformOS     string `json:"platformOS"`
	PlatformArch   string `json:"platformArch"`
}

type UpdateService struct {
	appGetter func() *application.App
	repoOwner string
	repoName  string

	mu               sync.Mutex
	isDownloading    bool
	cancelDownload   context.CancelFunc
	downloadedTarget string
}

func NewUpdateService(appGetter func() *application.App) *UpdateService {
	return &UpdateService{
		appGetter: appGetter,
		repoOwner: "tss182",
		repoName:  "dhub",
	}
}

func parseSemver(v string) []int {
	v = strings.TrimPrefix(v, "v")
	v = strings.TrimPrefix(v, "V")
	if idx := strings.Index(v, "-"); idx != -1 {
		v = v[:idx]
	}
	parts := strings.Split(v, ".")
	nums := make([]int, len(parts))
	for i, p := range parts {
		n, _ := strconv.Atoi(p)
		nums[i] = n
	}
	return nums
}

func isVersionNewer(latest, current string) bool {
	lParts := parseSemver(latest)
	cParts := parseSemver(current)
	maxLen := len(lParts)
	if len(cParts) > maxLen {
		maxLen = len(cParts)
	}
	for i := 0; i < maxLen; i++ {
		l := 0
		if i < len(lParts) {
			l = lParts[i]
		}
		c := 0
		if i < len(cParts) {
			c = cParts[i]
		}
		if l > c {
			return true
		}
		if l < c {
			return false
		}
	}
	return false
}

func findBestAsset(assets []ReleaseAsset, goos, goarch string) (ReleaseAsset, bool) {
	goos = strings.ToLower(goos)
	goarch = strings.ToLower(goarch)

	switch goos {
	case "windows":
		// Best match: installer for matching architecture (user installer / installer)
		for _, a := range assets {
			name := strings.ToLower(a.Name)
			if strings.HasSuffix(name, ".exe") && strings.Contains(name, "installer") && strings.Contains(name, goarch) {
				return a, true
			}
		}
		// Second match: any installer.exe
		for _, a := range assets {
			name := strings.ToLower(a.Name)
			if strings.HasSuffix(name, ".exe") && strings.Contains(name, "installer") {
				return a, true
			}
		}
		// Third match: matching arch .exe
		for _, a := range assets {
			name := strings.ToLower(a.Name)
			if strings.HasSuffix(name, ".exe") && strings.Contains(name, goarch) {
				return a, true
			}
		}
		// Fallback: any .exe
		for _, a := range assets {
			name := strings.ToLower(a.Name)
			if strings.HasSuffix(name, ".exe") {
				return a, true
			}
		}

	case "darwin":
		for _, a := range assets {
			name := strings.ToLower(a.Name)
			if strings.HasSuffix(name, ".dmg") {
				return a, true
			}
		}
		for _, a := range assets {
			name := strings.ToLower(a.Name)
			if strings.HasSuffix(name, ".zip") && strings.Contains(name, "macos") {
				return a, true
			}
		}

	case "linux":
		for _, a := range assets {
			name := strings.ToLower(a.Name)
			if strings.HasSuffix(name, ".deb") {
				return a, true
			}
		}
		for _, a := range assets {
			name := strings.ToLower(a.Name)
			if strings.HasSuffix(name, ".appimage") {
				return a, true
			}
		}
		for _, a := range assets {
			name := strings.ToLower(a.Name)
			if strings.HasSuffix(name, ".rpm") {
				return a, true
			}
		}
	}

	return ReleaseAsset{}, false
}

func (u *UpdateService) CheckForUpdate() (*UpdateInfo, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", u.repoOwner, u.repoName)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create update request: %w", err)
	}
	req.Header.Set("User-Agent", "DHub-Desktop/"+version.CurrentVersion)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("network error checking for updates: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return &UpdateInfo{
			HasUpdate:      false,
			CurrentVersion: version.CurrentVersion,
			LatestVersion:  version.CurrentVersion,
			PlatformOS:     runtime.GOOS,
			PlatformArch:   runtime.GOARCH,
		}, nil
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github api returned status %d", resp.StatusCode)
	}

	var rel GitHubReleaseResponse
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("failed to parse release info: %w", err)
	}

	cleanLatest := strings.TrimPrefix(rel.TagName, "v")
	cleanCurrent := strings.TrimPrefix(version.CurrentVersion, "v")
	hasUpdate := isVersionNewer(cleanLatest, cleanCurrent)

	info := &UpdateInfo{
		HasUpdate:      hasUpdate,
		CurrentVersion: version.CurrentVersion,
		LatestVersion:  rel.TagName,
		ReleaseTitle:   rel.Name,
		ReleaseNotes:   rel.Body,
		ReleaseURL:     rel.HTMLURL,
		PublishedAt:    rel.PublishedAt,
		PlatformOS:     runtime.GOOS,
		PlatformArch:   runtime.GOARCH,
	}

	if asset, ok := findBestAsset(rel.Assets, runtime.GOOS, runtime.GOARCH); ok {
		info.DownloadURL = asset.BrowserDownloadURL
		info.AssetFileName = asset.Name
		info.AssetSize = asset.Size
	} else {
		info.DownloadURL = rel.HTMLURL
	}

	return info, nil
}

func (u *UpdateService) OpenURL(targetURL string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", targetURL)
	case "darwin":
		cmd = exec.Command("open", targetURL)
	default:
		cmd = exec.Command("xdg-open", targetURL)
	}
	return cmd.Start()
}

func (u *UpdateService) emitProgress(status string, downloaded, total int64, percent float64, errMsg string) {
	if a := u.appGetter(); a != nil {
		a.Event.Emit("update:progress", app.UpdateProgressEvent{
			Status:     status,
			Downloaded: downloaded,
			Total:      total,
			Percent:    percent,
			Error:      errMsg,
		})
	}
}

type progressTrackingWriter struct {
	total          int64
	downloaded     int64
	lastEmitTime   time.Time
	onEmitProgress func(downloaded, total int64, percent float64)
}

func (pw *progressTrackingWriter) Write(p []byte) (int, error) {
	n := len(p)
	pw.downloaded += int64(n)
	now := time.Now()
	// Throttle event emission to every 100ms or 100% completion to avoid flooding the event loop
	if pw.onEmitProgress != nil && (now.Sub(pw.lastEmitTime) > 100*time.Millisecond || (pw.total > 0 && pw.downloaded >= pw.total)) {
		pw.lastEmitTime = now
		var pct float64
		if pw.total > 0 {
			pct = float64(pw.downloaded) / float64(pw.total) * 100
			if pct > 100 {
				pct = 100
			}
		}
		pw.onEmitProgress(pw.downloaded, pw.total, pct)
	}
	return n, nil
}

// DownloadAndStage downloads the update asset directly in-app, emitting progress events.
func (u *UpdateService) DownloadAndStage(downloadURL, assetFileName string) (string, error) {
	u.mu.Lock()
	if u.isDownloading {
		u.mu.Unlock()
		return "", fmt.Errorf("download already in progress")
	}
	ctx, cancel := context.WithCancel(context.Background())
	u.cancelDownload = cancel
	u.isDownloading = true
	u.downloadedTarget = ""
	u.mu.Unlock()

	defer func() {
		u.mu.Lock()
		u.isDownloading = false
		u.mu.Unlock()
	}()

	u.emitProgress("downloading", 0, 0, 0, "")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		u.emitProgress("error", 0, 0, 0, err.Error())
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", "DHub-Desktop/"+version.CurrentVersion)
	req.Header.Set("Accept", "application/octet-stream")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		u.emitProgress("error", 0, 0, 0, err.Error())
		return "", fmt.Errorf("failed to download update: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		err := fmt.Errorf("download returned HTTP status %d", resp.StatusCode)
		u.emitProgress("error", 0, 0, 0, err.Error())
		return "", err
	}

	totalSize := resp.ContentLength
	tempDir := os.TempDir()
	cleanName := filepath.Base(assetFileName)
	if cleanName == "" || cleanName == "." || cleanName == "/" {
		cleanName = "dhub-update"
	}
	destPath := filepath.Join(tempDir, cleanName)

	file, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		u.emitProgress("error", 0, 0, 0, err.Error())
		return "", fmt.Errorf("failed to create file on disk: %w", err)
	}
	defer file.Close()

	pw := &progressTrackingWriter{
		total:        totalSize,
		lastEmitTime: time.Now(),
		onEmitProgress: func(downloaded, total int64, pct float64) {
			u.emitProgress("downloading", downloaded, total, pct, "")
		},
	}

	_, err = io.Copy(file, io.TeeReader(resp.Body, pw))
	if err != nil {
		u.emitProgress("error", 0, 0, 0, err.Error())
		return "", fmt.Errorf("failed writing downloaded asset: %w", err)
	}

	u.mu.Lock()
	u.downloadedTarget = destPath
	u.mu.Unlock()

	u.emitProgress("completed", pw.downloaded, totalSize, 100, "")
	return destPath, nil
}

// CancelDownload cancels an in-progress download.
func (u *UpdateService) CancelDownload() {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.cancelDownload != nil {
		u.cancelDownload()
	}
	u.isDownloading = false
}

// ApplyUpdate launches the installer/package and terminates the current DHub process.
func (u *UpdateService) ApplyUpdate(filePath string) error {
	u.mu.Lock()
	targetPath := filePath
	if targetPath == "" {
		targetPath = u.downloadedTarget
	}
	u.mu.Unlock()

	if targetPath == "" {
		return fmt.Errorf("no downloaded update found to apply")
	}

	if _, err := os.Stat(targetPath); err != nil {
		return fmt.Errorf("update file not found at %s: %w", targetPath, err)
	}

	u.emitProgress("installing", 0, 0, 100, "")

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		// Windows: Launch NSIS installer in the background
		// We launch without waiting so DHub can quit cleanly
		cmd = exec.Command(targetPath)
	case "darwin":
		if strings.HasSuffix(strings.ToLower(targetPath), ".dmg") {
			cmd = exec.Command("open", targetPath)
		} else {
			cmd = exec.Command("open", "-R", targetPath)
		}
	default:
		// Linux: Open with default installer (e.g. software center, gdebi, or xdg-open)
		cmd = exec.Command("xdg-open", targetPath)
	}

	if err := cmd.Start(); err != nil {
		u.emitProgress("error", 0, 0, 0, err.Error())
		return fmt.Errorf("failed to launch installer: %w", err)
	}

	// Quit the current app instance smoothly on Windows so the installer can replace files without file locks
	go func() {
		time.Sleep(500 * time.Millisecond)
		if a := u.appGetter(); a != nil {
			a.Quit()
		} else {
			os.Exit(0)
		}
	}()

	return nil
}


