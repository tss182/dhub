package tunnel

import (
	"context"
	"fmt"
	"net"
	"os"
	"time"

	"golang.org/x/crypto/ssh"
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
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
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

