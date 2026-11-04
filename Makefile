# ==============================================================================
# DHub - Makefile for Development & Multi-Platform Builds (Wails v3)
# ==============================================================================

WAILS ?= wails3
APP_NAME ?= dhub
BIN_DIR ?= bin
INSTALL_SCOPE ?= user

.DEFAULT_GOAL := help

.PHONY: help dev build\:mac build\:mac\:bin build\:mac\:dmg build\:deb build\:rpm build\:appimage build\:windows build\:windows\:installer clean bindings update-assets sync-version reset\:sqlite
.PHONY: build-mac build-mac-bin build-mac-dmg build-deb build-rpm build-appimage build-windows build-windows-installer reset-sqlite db\:reset reset-db

help:
	@echo "========================================================================"
	@echo "                   $(APP_NAME) Development & Build Commands"
	@echo "========================================================================"
	@echo "  make dev                    Run application in development mode (hot reload)"
	@echo ""
	@echo "Build Targets (OS Packaging):"
	@echo "  make build:mac              Build macOS .app bundle (bin/$(APP_NAME).app)"
	@echo "  make build:deb              Build Linux Debian package (.deb in bin/)"
	@echo "  make build:rpm              Build Linux RedHat/Fedora package (.rpm in bin/)"
	@echo "  make build:windows          Build Windows executable (bin/$(APP_NAME).exe)"
	@echo ""
	@echo "Additional Targets:"
	@echo "  make build:appimage         Build Linux AppImage (bin/)"
	@echo "  make build:mac:dmg          Build macOS DMG installer"
	@echo "  make build:windows:installer Build Windows NSIS installer (scope: $(INSTALL_SCOPE))"
	@echo "  make bindings               Generate Go-TypeScript bindings"
	@echo "  make update-assets          Update build assets & sync version everywhere"
	@echo "  make sync-version           Sync version from build/config.yml across project"
	@echo "  make reset:sqlite           Reset local SQLite metadata database (dhub_meta.db)"
	@echo "  make clean                  Remove build artifacts and output directory"
	@echo "========================================================================"

# Development mode (Wails v3 dev server + Vite hot reload)
dev:
	$(WAILS) dev

# macOS Builds
build\:mac:
	@echo "==> Building macOS application bundle (.app)..."
	$(WAILS) task darwin:package

build\:mac\:bin:
	@echo "==> Building macOS binary only..."
	$(WAILS) task darwin:build

build\:mac\:dmg:
	@echo "==> Building macOS DMG package..."
	$(WAILS) task darwin:package:dmg

# Linux Package Builds
build\:deb:
	@echo "==> Building Linux Debian package (.deb)..."
	$(WAILS) task linux:create:deb

build\:rpm:
	@echo "==> Building Linux RPM package (.rpm)..."
	$(WAILS) task linux:create:rpm

build\:appimage:
	@echo "==> Building Linux AppImage..."
	$(WAILS) task linux:create:appimage

# Windows Builds
build\:windows:
	@echo "==> Building Windows executable (.exe)..."
	$(WAILS) task windows:build

build\:windows\:installer:
	@echo "==> Building Windows NSIS installer (scope: $(INSTALL_SCOPE))..."
	$(WAILS) task windows:package INSTALL_SCOPE=$(INSTALL_SCOPE)

# Aliases with hyphens for standard Makefile conventions
build-mac: build\:mac
build-mac-bin: build\:mac\:bin
build-mac-dmg: build\:mac\:dmg
build-deb: build\:deb
build-rpm: build\:rpm
build-appimage: build\:appimage
build-windows: build\:windows
build-windows-installer: build\:windows\:installer
reset-sqlite: reset\:sqlite
db\:reset: reset\:sqlite
reset-db: reset\:sqlite

# Utilities
bindings:
	@echo "==> Generating Wails bindings..."
	$(WAILS) task common:generate:bindings

update-assets:
	@echo "==> Updating build assets from build/config.yml..."
	$(WAILS) task common:update:build-assets
	@echo "==> Syncing version across frontend and packaging manifests..."
	@./scripts/sync-version.sh

sync-version:
	@./scripts/sync-version.sh

reset\:sqlite:
	@echo "==> Resetting local SQLite metadata database..."
	@rm -f "$${XDG_CONFIG_HOME:-$$HOME/.config}/dhub/dhub_meta.db" \
	       "$${XDG_CONFIG_HOME:-$$HOME/.config}/dhub/dhub_meta.db-wal" \
	       "$${XDG_CONFIG_HOME:-$$HOME/.config}/dhub/dhub_meta.db-shm" \
	       "$$HOME/Library/Application Support/dhub/dhub_meta.db" \
	       "$$HOME/Library/Application Support/dhub/dhub_meta.db-wal" \
	       "$$HOME/Library/Application Support/dhub/dhub_meta.db-shm"
	@echo "==> SQLite database reset complete."

clean:
	@echo "==> Cleaning build artifacts..."
	@rm -rf $(BIN_DIR) *.syso frontend/dist build/linux/appimage/build
