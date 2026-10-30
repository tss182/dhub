# ==============================================================================
# DHub - Makefile for Development & Multi-Platform Builds (Wails v3)
# ==============================================================================

WAILS ?= wails3
APP_NAME ?= dhub
BIN_DIR ?= bin

.DEFAULT_GOAL := help

.PHONY: help dev build:mac build:mac:bin build:mac:dmg build:deb build:rpm build:appimage build:windows build:windows:installer clean bindings

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
	@echo "  make build:windows:installer Build Windows NSIS installer"
	@echo "  make bindings               Generate Go-TypeScript bindings"
	@echo "  make clean                  Remove build artifacts and output directory"
	@echo "========================================================================"

# Development mode (Wails v3 dev server + Vite hot reload)
dev:
	$(WAILS) dev

# macOS Builds
build:mac:
	@echo "==> Building macOS application bundle (.app)..."
	$(WAILS) task darwin:package

build:mac:bin:
	@echo "==> Building macOS binary only..."
	$(WAILS) task darwin:build

build:mac:dmg:
	@echo "==> Building macOS DMG package..."
	$(WAILS) task darwin:package:dmg

# Linux Package Builds
build:deb:
	@echo "==> Building Linux Debian package (.deb)..."
	$(WAILS) task linux:create:deb

build:rpm:
	@echo "==> Building Linux RPM package (.rpm)..."
	$(WAILS) task linux:create:rpm

build:appimage:
	@echo "==> Building Linux AppImage..."
	$(WAILS) task linux:create:appimage

# Windows Builds
build:windows:
	@echo "==> Building Windows executable (.exe)..."
	$(WAILS) task windows:build

build:windows:installer:
	@echo "==> Building Windows NSIS installer..."
	$(WAILS) task windows:package

# Utilities
bindings:
	@echo "==> Generating Wails bindings..."
	$(WAILS) task common:generate:bindings

clean:
	@echo "==> Cleaning build artifacts..."
	@rm -rf $(BIN_DIR) *.syso frontend/dist build/linux/appimage/build
