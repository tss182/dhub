package services

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

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

