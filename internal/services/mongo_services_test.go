package services

import (
	"testing"

	"dhub/internal/store"
)

func TestBuildMongoIndexKeysJSON(t *testing.T) {
	got := buildMongoIndexKeysJSON([]string{"email:1", "createdAt:-1", "bio:text"})
	want := `{ "email": 1, "createdAt": -1, "bio": "text" }`
	if got != want {
		t.Fatalf("buildMongoIndexKeysJSON() = %q; want %q", got, want)
	}
}

func TestBuildMongoToolsCommonArgs(t *testing.T) {
	conn := &store.ConnectionConfig{
		Driver:      "mongodb",
		Host:        "127.0.0.1",
		Port:        27017,
		Username:    "admin",
		Password:    "secret",
		OptionsJSON: `{"mongoAuthSource":"custom_auth"}`,
		SSLMode:     "require",
		SSLCAPath:   "/tmp/ca.pem",
	}
	args, cleanup := buildMongoToolsCommonArgs(conn, "shop")
	defer cleanup()
	joined := ""
	for _, a := range args {
		joined += a + " "
	}
	for _, expected := range []string{
		"--host 127.0.0.1",
		"--port 27017",
		"--username admin",
		"--authenticationDatabase custom_auth",
		"--db shop",
		"--ssl",
		"--sslAllowInvalidCertificates",
		"--sslCAFile /tmp/ca.pem",
	} {
		if !containsSubstring(joined, expected) {
			t.Errorf("expected %q in args: %s", expected, joined)
		}
	}
}

func containsSubstring(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexString(s, sub) >= 0)
}

func indexString(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
