package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"dhub/internal/crypto"
	"github.com/google/uuid"
)

type ConnectionConfig struct {
	ID           string    `json:"id"`
	FolderID     *string   `json:"folderId"`
	Name         string    `json:"name"`
	Driver       string    `json:"driver"` // "postgres", "mysql", "sqlite"
	ColorTag     string    `json:"colorTag"`
	IsReadOnly   bool      `json:"isReadOnly"`
	TxMode       string    `json:"txMode"`
	Host         string    `json:"host"`
	Port         int       `json:"port"`
	Username     string    `json:"username"`
	Password     string    `json:"password,omitempty"` // Not stored in DB, retrieved from Keyring
	DatabaseName string    `json:"databaseName"`
	FilePath     string    `json:"filePath"` // for SQLite
	SSLMode      string    `json:"sslMode"`
	SSLCAPath    string    `json:"sslCaPath"`
	SSLCertPath  string    `json:"sslCertPath"`
	SSLKeyPath   string    `json:"sslKeyPath"`
	SSHEnabled   bool      `json:"sshEnabled"`
	SSHHost      string    `json:"sshHost"`
	SSHPort      int       `json:"sshPort"`
	SSHUser      string    `json:"sshUser"`
	SSHAuthType  string    `json:"sshAuthType"` // "password" | "key"
	SSHKeyPath   string    `json:"sshKeyPath"`
	SSHPassword  string    `json:"sshPassword,omitempty"`
	OptionsJSON  string    `json:"optionsJson"`
	SortOrder    int       `json:"sortOrder"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type ConnectionFolder struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	ParentID  *string   `json:"parentId"`
	SortOrder int       `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
}

func (s *LocalStore) ListFolders(ctx context.Context) ([]ConnectionFolder, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, parent_id, sort_order, created_at FROM connection_folders ORDER BY sort_order, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var folders []ConnectionFolder
	for rows.Next() {
		var f ConnectionFolder
		if err := rows.Scan(&f.ID, &f.Name, &f.ParentID, &f.SortOrder, &f.CreatedAt); err != nil {
			continue
		}
		folders = append(folders, f)
	}
	return folders, nil
}

func (s *LocalStore) ListConnections(ctx context.Context) ([]ConnectionConfig, error) {
	query := `SELECT id, folder_id, name, driver, color_tag, is_read_only, tx_mode, host, port, username, database_name,
		file_path, ssl_mode, ssl_ca_path, ssl_cert_path, ssl_key_path, ssh_enabled, ssh_host, ssh_port, ssh_user,
		ssh_auth_type, ssh_key_path, options_json, sort_order, created_at, updated_at
		FROM connections ORDER BY sort_order, name`

	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var conns []ConnectionConfig
	for rows.Next() {
		var c ConnectionConfig
		var isReadOnly, sshEnabled int
		if err := rows.Scan(
			&c.ID, &c.FolderID, &c.Name, &c.Driver, &c.ColorTag, &isReadOnly, &c.TxMode,
			&c.Host, &c.Port, &c.Username, &c.DatabaseName, &c.FilePath, &c.SSLMode,
			&c.SSLCAPath, &c.SSLCertPath, &c.SSLKeyPath, &sshEnabled, &c.SSHHost,
			&c.SSHPort, &c.SSHUser, &c.SSHAuthType, &c.SSHKeyPath, &c.OptionsJSON,
			&c.SortOrder, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			continue
		}
		c.IsReadOnly = isReadOnly == 1
		c.SSHEnabled = sshEnabled == 1
		conns = append(conns, c)
	}
	return conns, nil
}

func (s *LocalStore) GetConnection(ctx context.Context, id string) (*ConnectionConfig, error) {
	query := `SELECT id, folder_id, name, driver, color_tag, is_read_only, tx_mode, host, port, username, database_name,
		file_path, ssl_mode, ssl_ca_path, ssl_cert_path, ssl_key_path, ssh_enabled, ssh_host, ssh_port, ssh_user,
		ssh_auth_type, ssh_key_path, options_json, sort_order, created_at, updated_at
		FROM connections WHERE id = ?`

	var c ConnectionConfig
	var isReadOnly, sshEnabled int
	err := s.db.QueryRowContext(ctx, query, id).Scan(
		&c.ID, &c.FolderID, &c.Name, &c.Driver, &c.ColorTag, &isReadOnly, &c.TxMode,
		&c.Host, &c.Port, &c.Username, &c.DatabaseName, &c.FilePath, &c.SSLMode,
		&c.SSLCAPath, &c.SSLCertPath, &c.SSLKeyPath, &sshEnabled, &c.SSHHost,
		&c.SSHPort, &c.SSHUser, &c.SSHAuthType, &c.SSHKeyPath, &c.OptionsJSON,
		&c.SortOrder, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("connection not found")
		}
		return nil, err
	}
	c.IsReadOnly = isReadOnly == 1
	c.SSHEnabled = sshEnabled == 1

	// Retrieve password from keyring/vault
	if pass, err := crypto.GetSecret("conn:" + c.ID + ":db"); err == nil {
		c.Password = pass
	}
	if sshPass, err := crypto.GetSecret("conn:" + c.ID + ":ssh"); err == nil {
		c.SSHPassword = sshPass
	}

	return &c, nil
}

func (s *LocalStore) SaveConnection(ctx context.Context, c ConnectionConfig) (string, error) {
	if c.ID == "" {
		c.ID = uuid.NewString()
	}

	query := `INSERT INTO connections (
		id, folder_id, name, driver, color_tag, is_read_only, tx_mode, host, port, username, database_name,
		file_path, ssl_mode, ssl_ca_path, ssl_cert_path, ssl_key_path, ssh_enabled, ssh_host, ssh_port, ssh_user,
		ssh_auth_type, ssh_key_path, options_json, sort_order, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	ON CONFLICT(id) DO UPDATE SET
		folder_id = excluded.folder_id,
		name = excluded.name,
		driver = excluded.driver,
		color_tag = excluded.color_tag,
		is_read_only = excluded.is_read_only,
		tx_mode = excluded.tx_mode,
		host = excluded.host,
		port = excluded.port,
		username = excluded.username,
		database_name = excluded.database_name,
		file_path = excluded.file_path,
		ssl_mode = excluded.ssl_mode,
		ssl_ca_path = excluded.ssl_ca_path,
		ssl_cert_path = excluded.ssl_cert_path,
		ssl_key_path = excluded.ssl_key_path,
		ssh_enabled = excluded.ssh_enabled,
		ssh_host = excluded.ssh_host,
		ssh_port = excluded.ssh_port,
		ssh_user = excluded.ssh_user,
		ssh_auth_type = excluded.ssh_auth_type,
		ssh_key_path = excluded.ssh_key_path,
		options_json = excluded.options_json,
		sort_order = excluded.sort_order,
		updated_at = CURRENT_TIMESTAMP`

	isReadOnly := 0
	if c.IsReadOnly {
		isReadOnly = 1
	}
	sshEnabled := 0
	if c.SSHEnabled {
		sshEnabled = 1
	}

	_, err := s.db.ExecContext(ctx, query,
		c.ID, c.FolderID, c.Name, c.Driver, c.ColorTag, isReadOnly, c.TxMode, c.Host, c.Port, c.Username, c.DatabaseName,
		c.FilePath, c.SSLMode, c.SSLCAPath, c.SSLCertPath, c.SSLKeyPath, sshEnabled, c.SSHHost, c.SSHPort, c.SSHUser,
		c.SSHAuthType, c.SSHKeyPath, c.OptionsJSON, c.SortOrder,
	)
	if err != nil {
		return "", err
	}

	// Save secrets securely
	if c.Password != "" {
		_ = crypto.SaveSecret("conn:"+c.ID+":db", c.Password)
	}
	if c.SSHPassword != "" {
		_ = crypto.SaveSecret("conn:"+c.ID+":ssh", c.SSHPassword)
	}

	return c.ID, nil
}

func (s *LocalStore) DeleteConnection(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM connections WHERE id = ?`, id)
	_ = crypto.DeleteSecret("conn:" + id + ":db")
	_ = crypto.DeleteSecret("conn:" + id + ":ssh")
	return err
}

