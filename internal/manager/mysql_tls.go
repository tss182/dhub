package manager

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"strings"

	mysqldriver "github.com/go-sql-driver/mysql"

	"dhub/internal/store"
)

// configureMySQLTLS applies the connection's SSL settings to mc and fails closed: a CA or
// client certificate that cannot be loaded, or a TLS config that cannot be registered, is a
// connection error. It never falls back to an unencrypted or unverified connection.
//
// Modes: disable (files are ignored), preferred (TLS if the server offers it), required
// (TLS without verification), verify-ca (chain verified, hostname ignored, which is what
// connections through an SSH tunnel need), verify-identity / verify-full (chain and hostname
// verified against the original host, not the tunnel's 127.0.0.1).
func configureMySQLTLS(mc *mysqldriver.Config, cfg store.ConnectionConfig) error {
	mode := strings.ToLower(strings.TrimSpace(cfg.SSLMode))
	hasFiles := strings.TrimSpace(cfg.SSLCAPath) != "" ||
		(strings.TrimSpace(cfg.SSLCertPath) != "" && strings.TrimSpace(cfg.SSLKeyPath) != "")

	switch mode {
	case "disable", "disabled":
		mc.TLSConfig = "false"
		return nil
	case "":
		// Unset: keep the legacy behaviour where supplying files turns TLS on.
		if !hasFiles {
			mc.TLSConfig = "false"
			return nil
		}
		mode = "required"
	case "prefer", "preferred", "allow":
		mode = "preferred"
	case "require", "required":
		mode = "required"
	case "verify-ca":
	case "verify-identity", "verify-full":
		mode = "verify-identity"
	default:
		return fmt.Errorf("unsupported SSL mode %q", cfg.SSLMode)
	}

	if !hasFiles {
		switch mode {
		case "preferred":
			mc.TLSConfig = "preferred"
		case "required":
			mc.TLSConfig = "skip-verify"
		case "verify-identity":
			if cfg.SSHEnabled && strings.TrimSpace(cfg.Host) != "" {
				tlsCfg, err := buildMySQLTLS(cfg, mode)
				if err != nil {
					return err
				}
				return registerMySQLTLS(mc, cfg, tlsCfg)
			}
			mc.TLSConfig = "true"
		case "verify-ca":
			tlsCfg, err := buildMySQLTLS(cfg, mode)
			if err != nil {
				return err
			}
			return registerMySQLTLS(mc, cfg, tlsCfg)
		}
		return nil
	}

	tlsCfg, err := buildMySQLTLS(cfg, mode)
	if err != nil {
		return err
	}
	return registerMySQLTLS(mc, cfg, tlsCfg)
}

func buildMySQLTLS(cfg store.ConnectionConfig, mode string) (*tls.Config, error) {
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}

	var pool *x509.CertPool
	if ca := strings.TrimSpace(cfg.SSLCAPath); ca != "" {
		pem, err := os.ReadFile(ca)
		if err != nil {
			return nil, fmt.Errorf("cannot read SSL CA file: %w", err)
		}
		pool = x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("SSL CA file %q contains no valid PEM certificate", ca)
		}
		tlsCfg.RootCAs = pool
	}

	certPath, keyPath := strings.TrimSpace(cfg.SSLCertPath), strings.TrimSpace(cfg.SSLKeyPath)
	if (certPath == "") != (keyPath == "") {
		return nil, fmt.Errorf("SSL client certificate and key must both be set")
	}
	if certPath != "" {
		cert, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			return nil, fmt.Errorf("cannot load SSL client certificate: %w", err)
		}
		tlsCfg.Certificates = []tls.Certificate{cert}
	}

	switch mode {
	case "preferred", "required":
		tlsCfg.InsecureSkipVerify = true
	case "verify-ca":
		// Verify the chain ourselves and skip only the hostname check, so the server name
		// need not match the tunnel's loopback address.
		tlsCfg.InsecureSkipVerify = true
		roots := pool
		tlsCfg.VerifyPeerCertificate = func(raw [][]byte, _ [][]*x509.Certificate) error {
			return verifyChainOnly(raw, roots)
		}
	case "verify-identity":
		// The tunnel connects to 127.0.0.1, so the certificate must be checked against the real host.
		tlsCfg.ServerName = strings.TrimSpace(cfg.Host)
	}
	return tlsCfg, nil
}

func verifyChainOnly(raw [][]byte, roots *x509.CertPool) error {
	if len(raw) == 0 {
		return fmt.Errorf("server presented no certificate")
	}
	certs := make([]*x509.Certificate, 0, len(raw))
	for _, der := range raw {
		c, err := x509.ParseCertificate(der)
		if err != nil {
			return fmt.Errorf("cannot parse server certificate: %w", err)
		}
		certs = append(certs, c)
	}
	opts := x509.VerifyOptions{Roots: roots, Intermediates: x509.NewCertPool()}
	for _, c := range certs[1:] {
		opts.Intermediates.AddCert(c)
	}
	if _, err := certs[0].Verify(opts); err != nil {
		return fmt.Errorf("server certificate is not trusted: %w", err)
	}
	return nil
}

func registerMySQLTLS(mc *mysqldriver.Config, cfg store.ConnectionConfig, tlsCfg *tls.Config) error {
	name := fmt.Sprintf("custom_tls_%s", cfg.ID)
	if err := mysqldriver.RegisterTLSConfig(name, tlsCfg); err != nil {
		return fmt.Errorf("cannot register TLS configuration: %w", err)
	}
	mc.TLSConfig = name
	return nil
}
