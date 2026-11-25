package manager

import (
	"testing"

	"dhub/internal/store"
)

func TestResolveSSHRemoteTargetMongoDB(t *testing.T) {
	cfg := store.ConnectionConfig{
		Driver: "mongodb",
		Host:   "mongo-internal.corp",
	}
	h, p := resolveSSHRemoteTarget(cfg)
	if h != "mongo-internal.corp" || p != 27017 {
		t.Fatalf("expected mongo-internal.corp:27017, got %s:%d", h, p)
	}

	cfgURI := store.ConnectionConfig{
		Driver: "mongodb",
		Host:   "mongodb://user:pass@db.internal:27018/analytics?replicaSet=rs0",
	}
	h2, p2 := resolveSSHRemoteTarget(cfgURI)
	if h2 != "db.internal" || p2 != 27018 {
		t.Fatalf("expected db.internal:27018, got %s:%d", h2, p2)
	}
}
