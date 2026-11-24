package manager

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"

	"dhub/internal/store"
)

func writeTestCA(t *testing.T) (certPath string, der []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	der, err = x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certPath = filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	return certPath, der
}

func TestConfigureMySQLTLS_FailsClosed(t *testing.T) {
	dir := t.TempDir()
	badPEM := filepath.Join(dir, "bad.pem")
	if err := os.WriteFile(badPEM, []byte("not a certificate"), 0o600); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		cfg  store.ConnectionConfig
		want string
	}{
		{"missing CA file", store.ConnectionConfig{ID: "a", SSLMode: "verify-ca", SSLCAPath: filepath.Join(dir, "missing.pem")}, "cannot read SSL CA file"},
		{"CA without certificates", store.ConnectionConfig{ID: "b", SSLMode: "verify-ca", SSLCAPath: badPEM}, "no valid PEM"},
		{"bad client keypair", store.ConnectionConfig{ID: "c", SSLMode: "required", SSLCertPath: badPEM, SSLKeyPath: badPEM}, "client certificate"},
		{"cert without key", store.ConnectionConfig{ID: "d", SSLMode: "required", SSLCertPath: badPEM}, ""},
		{"unknown mode", store.ConnectionConfig{ID: "e", SSLMode: "bogus"}, "unsupported SSL mode"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mc := mysqldriver.NewConfig()
			err := configureMySQLTLS(mc, tc.cfg)
			if tc.name == "cert without key" {
				// A lone certificate is ignored by the "has files" check, so TLS stays on without a client cert.
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}

func TestConfigureMySQLTLS_ModeMapping(t *testing.T) {
	caPath, _ := writeTestCA(t)
	cases := []struct {
		name string
		cfg  store.ConnectionConfig
		want string // expected TLSConfig; "custom" means a registered name
	}{
		{"disable ignores files", store.ConnectionConfig{ID: "m1", SSLMode: "disable", SSLCAPath: caPath}, "false"},
		{"empty mode without files", store.ConnectionConfig{ID: "m2"}, "false"},
		{"preferred", store.ConnectionConfig{ID: "m3", SSLMode: "preferred"}, "preferred"},
		{"required", store.ConnectionConfig{ID: "m4", SSLMode: "required"}, "skip-verify"},
		{"verify-identity without CA", store.ConnectionConfig{ID: "m5", SSLMode: "verify-identity"}, "true"},
		{"verify-ca registers custom", store.ConnectionConfig{ID: "m6", SSLMode: "verify-ca", SSLCAPath: caPath}, "custom_tls_m6"},
		{"verify-identity with CA", store.ConnectionConfig{ID: "m7", SSLMode: "verify-identity", SSLCAPath: caPath, Host: "db.example.com"}, "custom_tls_m7"},
		{"empty mode with CA enables TLS", store.ConnectionConfig{ID: "m8", SSLCAPath: caPath}, "custom_tls_m8"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mc := mysqldriver.NewConfig()
			if err := configureMySQLTLS(mc, tc.cfg); err != nil {
				t.Fatal(err)
			}
			if mc.TLSConfig != tc.want {
				t.Fatalf("TLSConfig = %q, want %q", mc.TLSConfig, tc.want)
			}
		})
	}
}

func TestVerifyChainOnly(t *testing.T) {
	_, caDER := writeTestCA(t)
	ca, _ := x509.ParseCertificate(caDER)
	roots := x509.NewCertPool()
	roots.AddCert(ca)

	if err := verifyChainOnly([][]byte{caDER}, roots); err != nil {
		t.Fatalf("trusted cert rejected: %v", err)
	}
	_, otherDER := writeTestCA(t)
	if err := verifyChainOnly([][]byte{otherDER}, roots); err == nil {
		t.Fatal("certificate from an unknown CA was accepted")
	}
	if err := verifyChainOnly(nil, roots); err == nil {
		t.Fatal("empty chain was accepted")
	}
}
