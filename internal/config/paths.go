package config

import (
	"os"
	"path/filepath"

	"github.com/adrg/xdg"
)

func GetConfigDir() (string, error) {
	dir := filepath.Join(xdg.ConfigHome, "dhub")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

func GetDBPath() (string, error) {
	dir, err := GetConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "dhub_meta.db"), nil
}

