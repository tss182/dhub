package manager

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"dhub/internal/store"
	_ "modernc.org/sqlite"
)

func setupTestStore(t *testing.T) (*store.LocalStore, func()) {
	t.Helper()
	tmpDir, err := os.MkdirTemp("", "dhub-mgr-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	t.Setenv("DHUB_CONFIG_DIR", tmpDir)

	s, err := store.NewLocalStore()
	if err != nil {
		os.RemoveAll(tmpDir)
		t.Fatalf("failed to create store: %v", err)
	}

	cleanup := func() {
		s.Close()
		os.RemoveAll(tmpDir)
	}
	return s, cleanup
}

func TestSessionManager_SQLiteLifecycle(t *testing.T) {
	st, cleanup := setupTestStore(t)
	defer cleanup()

	tmpDir := t.TempDir()
	dbFile := filepath.Join(tmpDir, "session_test.db")

	cfg := store.ConnectionConfig{
		ID:           "test-sqlite-session",
		Name:         "Session Test DB",
		Driver:       "sqlite",
		FilePath:     dbFile,
		DatabaseName: "main",
	}

	ctx := context.Background()
	mgr := NewSessionManager(st)

	// 1. TestConnection
	if err := mgr.TestConnection(ctx, cfg); err != nil {
		t.Fatalf("TestConnection failed: %v", err)
	}

	// 2. Save connection to store
	if _, err := st.SaveConnection(ctx, cfg); err != nil {
		t.Fatalf("failed to save connection: %v", err)
	}

	// 3. GetOrConnect
	drv1, err := mgr.GetOrConnect(ctx, cfg.ID)
	if err != nil {
		t.Fatalf("GetOrConnect failed: %v", err)
	}
	if drv1 == nil {
		t.Fatal("expected driver, got nil")
	}

	// 4. Repeated GetOrConnect returns same driver instance
	drv2, err := mgr.GetOrConnect(ctx, cfg.ID)
	if err != nil {
		t.Fatalf("second GetOrConnect failed: %v", err)
	}
	if drv1 != drv2 {
		t.Error("expected same driver instance from cache")
	}

	// 5. Disconnect removes session
	mgr.Disconnect(cfg.ID)

	// 6. Verify session map is empty
	mgr.mu.RLock()
	_, exists := mgr.sessions[cfg.ID]
	mgr.mu.RUnlock()
	if exists {
		t.Error("expected session to be removed after disconnect")
	}
}

func TestSessionManager_UnsupportedDriver(t *testing.T) {
	st, cleanup := setupTestStore(t)
	defer cleanup()

	mgr := NewSessionManager(st)
	cfg := store.ConnectionConfig{
		ID:     "invalid-driver",
		Driver: "oracle",
	}

	err := mgr.TestConnection(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected error for unsupported driver, got nil")
	}
}
