package tunnel

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"dhub/internal/config"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"
)

type SSHTunnelConfig struct {
	Host       string
	Port       int
	User       string
	AuthType   string // "password" | "key" | "agent"
	Password   string
	KeyPath    string
	RemoteHost string
	RemotePort int
}

type Tunnel struct {
	client    *ssh.Client
	listener  net.Listener
	agentConn io.Closer
	LocalPort int
	done      chan struct{}
	closeOnce sync.Once
}

var knownHostsMu sync.Mutex

// knownHostsPath returns DHub's own known_hosts file (<user config dir>/known_hosts).
func knownHostsPath() (string, error) {
	dir, err := config.GetConfigDir()
	if err != nil {
		return "", err
	}
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

// RemoveKnownHost removes any stored host key entries matching host[:port] from DHub's known_hosts file.
func RemoveKnownHost(host string, port int) error {
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()

	path, err := knownHostsPath()
	if err != nil {
		return err
	}

	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()

	if port <= 0 {
		port = 22
	}
	targetHost := knownhosts.Normalize(fmt.Sprintf("%s:%d", strings.TrimSpace(host), port))
	plainHost := strings.TrimSpace(host)

	var kept []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			kept = append(kept, line)
			continue
		}
		fields := strings.Fields(trimmed)
		if len(fields) > 0 {
			hostsField := fields[0]
			matched := false
			for _, h := range strings.Split(hostsField, ",") {
				if h == targetHost || h == plainHost {
					matched = true
					break
				}
			}
			if matched {
				continue
			}
		}
		kept = append(kept, line)
	}
	if err := scanner.Err(); err != nil {
		return err
	}

	content := ""
	if len(kept) > 0 {
		content = strings.Join(kept, "\n") + "\n"
	}
	return os.WriteFile(path, []byte(content), 0o600)
}

func OpenSSHTunnel(cfg SSHTunnelConfig) (*Tunnel, error) {
	var authMethods []ssh.AuthMethod
	var agentConn io.Closer
	closeAgent := func() {
		if agentConn != nil {
			_ = agentConn.Close()
			agentConn = nil
		}
	}

	if cfg.AuthType == "agent" {
		sock := os.Getenv("SSH_AUTH_SOCK")
		if sock == "" {
			return nil, fmt.Errorf("SSH_AUTH_SOCK environment variable is not set; cannot connect to SSH agent")
		}
		conn, err := net.Dial("unix", sock)
		if err != nil {
			return nil, fmt.Errorf("failed to dial SSH agent (%s): %w", sock, err)
		}
		agentConn = conn
		agentClient := agent.NewClient(conn)
		signers, err := agentClient.Signers()
		if err != nil {
			closeAgent()
			return nil, fmt.Errorf("failed to retrieve keys from SSH agent: %w", err)
		}
		if len(signers) == 0 {
			closeAgent()
			return nil, fmt.Errorf("SSH agent has no loaded identities (run ssh-add first)")
		}
		authMethods = append(authMethods, ssh.PublicKeys(signers...))
	} else if cfg.AuthType == "password" && cfg.Password != "" {
		authMethods = append(authMethods, ssh.Password(cfg.Password))
	} else if cfg.KeyPath != "" {
		keyBytes, err := os.ReadFile(cfg.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read ssh key file: %w", err)
		}
		var signer ssh.Signer
		if cfg.Password != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(cfg.Password))
		}
		if signer == nil {
			signer, err = ssh.ParsePrivateKey(keyBytes)
			if err != nil && cfg.Password != "" {
				signer, err = ssh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(cfg.Password))
			}
		}
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
		closeAgent()
		return nil, fmt.Errorf("ssh dial failed: %w", err)
	}

	// Listen on dynamic localhost port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		client.Close()
		closeAgent()
		return nil, fmt.Errorf("failed to bind local tunnel listener: %w", err)
	}

	t := &Tunnel{
		client:    client,
		listener:  listener,
		agentConn: agentConn,
		LocalPort: listener.Addr().(*net.TCPAddr).Port,
		done:      make(chan struct{}),
	}

	go t.keepAlive(30 * time.Second)
	go t.forward(fmt.Sprintf("%s:%d", cfg.RemoteHost, cfg.RemotePort))

	return t, nil
}

func (t *Tunnel) keepAlive(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-t.done:
			return
		case <-ticker.C:
			if t.client == nil {
				return
			}
			_, _, err := t.client.SendRequest("keepalive@openssh.com", true, nil)
			if err != nil {
				return
			}
		}
	}
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
	t.closeOnce.Do(func() {
		if t.done != nil {
			close(t.done)
		}
	})
	var err1, err2, err3 error
	if t.listener != nil {
		err1 = t.listener.Close()
	}
	if t.client != nil {
		err2 = t.client.Close()
	}
	if t.agentConn != nil {
		err3 = t.agentConn.Close()
	}
	if err1 != nil {
		return err1
	}
	if err2 != nil {
		return err2
	}
	return err3
}

