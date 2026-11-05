package tunnel

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type SSHTunnelConfig struct {
	Host       string
	Port       int
	User       string
	AuthType   string // "password" | "key"
	Password   string
	KeyPath    string
	RemoteHost string
	RemotePort int
}

type Tunnel struct {
	client   *ssh.Client
	listener net.Listener
	LocalPort int
}

var knownHostsMu sync.Mutex

// knownHostsPath returns DHub's own known_hosts file (<user config dir>/dhub/known_hosts).
func knownHostsPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir = filepath.Join(dir, "dhub")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "known_hosts")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDONLY, 0o600)
	if err != nil {
		return "", err
	}
	_ = f.Close()
	return path, nil
}

// trustOnFirstUseCallback verifies SSH host keys against DHub's known_hosts file.
// Unknown hosts are trusted and recorded on first connection (TOFU); a changed key for a
// known host is rejected to protect against man-in-the-middle attacks.
func trustOnFirstUseCallback() ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		knownHostsMu.Lock()
		defer knownHostsMu.Unlock()

		path, err := knownHostsPath()
		if err != nil {
			return fmt.Errorf("cannot access known_hosts: %w", err)
		}
		check, err := knownhosts.New(path)
		if err != nil {
			return fmt.Errorf("cannot read known_hosts: %w", err)
		}

		err = check(hostname, remote, key)
		if err == nil {
			return nil
		}

		var keyErr *knownhosts.KeyError
		if !errors.As(err, &keyErr) {
			return err
		}
		if len(keyErr.Want) > 0 {
			return fmt.Errorf("SSH host key for %s has CHANGED (possible man-in-the-middle attack); "+
				"remove the old entry from %s if the change is expected", hostname, path)
		}

		// Unknown host: remember it (trust on first use).
		f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			return fmt.Errorf("cannot record host key: %w", err)
		}
		defer f.Close()
		line := knownhosts.Line([]string{knownhosts.Normalize(hostname)}, key)
		if _, err := f.WriteString(line + "\n"); err != nil {
			return fmt.Errorf("cannot record host key: %w", err)
		}
		return nil
	}
}

func OpenSSHTunnel(cfg SSHTunnelConfig) (*Tunnel, error) {
	var authMethods []ssh.AuthMethod

	if cfg.AuthType == "password" && cfg.Password != "" {
		authMethods = append(authMethods, ssh.Password(cfg.Password))
	} else if cfg.KeyPath != "" {
		keyBytes, err := os.ReadFile(cfg.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read ssh key file: %w", err)
		}
		signer, err := ssh.ParsePrivateKey(keyBytes)
		if err != nil {
			return nil, fmt.Errorf("failed to parse ssh private key: %w", err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}

	clientConfig := &ssh.ClientConfig{
		User:            cfg.User,
		Auth:            authMethods,
		HostKeyCallback: trustOnFirstUseCallback(),
		Timeout:         10 * time.Second,
	}

	sshServer := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	client, err := ssh.Dial("tcp", sshServer, clientConfig)
	if err != nil {
		return nil, fmt.Errorf("ssh dial failed: %w", err)
	}

	// Listen on dynamic localhost port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("failed to bind local tunnel listener: %w", err)
	}

	t := &Tunnel{
		client:    client,
		listener:  listener,
		LocalPort: listener.Addr().(*net.TCPAddr).Port,
	}

	go t.forward(fmt.Sprintf("%s:%d", cfg.RemoteHost, cfg.RemotePort))

	return t, nil
}

func (t *Tunnel) forward(remoteAddr string) {
	for {
		localConn, err := t.listener.Accept()
		if err != nil {
			return // listener closed
		}

		go func(lConn net.Conn) {
			defer lConn.Close()
			remoteConn, err := t.client.Dial("tcp", remoteAddr)
			if err != nil {
				return
			}
			defer remoteConn.Close()

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			go func() {
				_, _ = copyWithContext(ctx, remoteConn, lConn)
				cancel()
			}()
			_, _ = copyWithContext(ctx, lConn, remoteConn)
		}(localConn)
	}
}

func copyWithContext(ctx context.Context, dst net.Conn, src net.Conn) (int64, error) {
	buf := make([]byte, 32*1024)
	var written int64
	for {
		select {
		case <-ctx.Done():
			return written, nil
		default:
			_ = src.SetReadDeadline(time.Now().Add(2 * time.Second))
			nr, err := src.Read(buf)
			if nr > 0 {
				nw, ew := dst.Write(buf[0:nr])
				if nw > 0 {
					written += int64(nw)
				}
				if ew != nil {
					return written, ew
				}
			}
			if err != nil {
				if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
					continue
				}
				return written, err
			}
		}
	}
}

func (t *Tunnel) Close() error {
	var err1, err2 error
	if t.listener != nil {
		err1 = t.listener.Close()
	}
	if t.client != nil {
		err2 = t.client.Close()
	}
	if err1 != nil {
		return err1
	}
	return err2
}

