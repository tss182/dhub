package manager

import (
	"testing"

	"dhub/internal/store"
)

func TestQdrantSessionURLAndSSHResolution(t *testing.T) {
	// 1. Explicit URL port takes precedence in SSH target resolution
	host, port := resolveSSHRemoteTarget(store.ConnectionConfig{
		Driver: "qdrant",
		Host:   "https://internal.qdrant:8443",
		Port:   6333,
	})
	if host != "internal.qdrant" || port != 8443 {
		t.Fatalf("expected internal.qdrant:8443, got %s:%d", host, port)
	}

	// 2. Plain Qdrant host defaults to 6333
	host, port = resolveSSHRemoteTarget(store.ConnectionConfig{
		Driver: "qdrant",
		Host:   "10.0.0.5",
		Port:   0,
	})
	if host != "10.0.0.5" || port != 6333 {
		t.Fatalf("expected 10.0.0.5:6333, got %s:%d", host, port)
	}

	// 3. IPv6 literal formatting + SSH origHostname preservation
	baseURL, orig := resolveHTTPBaseURL(store.ConnectionConfig{
		Driver:     "qdrant",
		Host:       "::1",
		Port:       6333,
		SSHEnabled: false,
	}, "::1", 6333, 6333)
	if baseURL != "http://[::1]:6333" || orig != "" {
		t.Fatalf("unexpected IPv6 baseURL=%q orig=%q", baseURL, orig)
	}

	sshURL, origHost := resolveHTTPBaseURL(store.ConnectionConfig{
		Driver:     "qdrant",
		Host:       "qdrant.internal",
		SSLMode:    "verify-full",
		SSHEnabled: true,
	}, "127.0.0.1", 54321, 6333)
	if sshURL != "https://127.0.0.1:54321" || origHost != "qdrant.internal" {
		t.Fatalf("unexpected SSH URL=%q origHost=%q", sshURL, origHost)
	}

	// 4. verify-ca vs verify-full TLS config
	tlsVerifyCA, err := buildHTTPDriverTLSConfig(store.ConnectionConfig{
		SSLMode:    "verify-ca",
		SSHEnabled: true,
	}, sshURL, origHost)
	if err != nil || tlsVerifyCA == nil || !tlsVerifyCA.InsecureSkipVerify || tlsVerifyCA.VerifyConnection == nil {
		t.Fatalf("expected verify-ca to configure custom VerifyConnection, got %+v, err=%v", tlsVerifyCA, err)
	}
	if tlsVerifyCA.ServerName != "qdrant.internal" {
		t.Fatalf("expected SNI ServerName=qdrant.internal, got %q", tlsVerifyCA.ServerName)
	}

	// 5. Missing CA path returns explicit error
	if _, err := buildHTTPDriverTLSConfig(store.ConnectionConfig{
		SSLMode:   "verify-full",
		SSLCAPath: "/nonexistent/ca.pem",
	}, "https://localhost:6333", ""); err == nil {
		t.Fatalf("expected error for missing SSLCAPath")
	}
}
