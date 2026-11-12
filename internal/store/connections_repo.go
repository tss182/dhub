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
	Driver       string    `json:"driver"`  // "postgres", "mysql", "sqlite", "mariadb", "redis", "mssql", "mongodb", "clickhouse"
	EnvType      string    `json:"envType"` // "local", "dev", "prod"
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
	Color     string    `json:"color"`
	ParentID  *string   `json:"parentId"`
	SortOrder int       `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt,omitempty"`
}

type ConnectionLayoutUpdate struct {
	ID        string  `json:"id"`
	FolderID  *string `json:"folderId"`
	SortOrder int     `json:"sortOrder"`
}

func (s *LocalStore) normalizeFolderID(ctx context.Context, folderID *string) *string {
	if folderID == nil || *folderID == "" {
		return nil
	}
	var exists int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM connection_folders WHERE id = ?`, *folderID).Scan(&exists)
	if err != nil || exists != 1 {
		return nil
	}
	return folderID
}

func (s *LocalStore) ListFolders(ctx context.Context) ([]ConnectionFolder, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, COALESCE(color, '#3b82f6'), parent_id, sort_order, created_at FROM connection_folders ORDER BY sort_order, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var folders []ConnectionFolder
	for rows.Next() {
		var f ConnectionFolder
		if err := rows.Scan(&f.ID, &f.Name, &f.Color, &f.ParentID, &f.SortOrder, &f.CreatedAt); err != nil {
			continue
		}
		folders = append(folders, f)
	}
	return folders, nil
}

func (s *LocalStore) SaveFolder(ctx context.Context, f ConnectionFolder) (string, error) {
	if f.ID == "" {
		f.ID = uuid.NewString()
	}
	if f.Color == "" {
		f.Color = "#3b82f6"
	}
	var parentID *string
	if f.ParentID != nil && *f.ParentID != "" {
		parentID = f.ParentID
	}

	query := `INSERT INTO connection_folders (id, name, color, parent_id, sort_order)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			color = excluded.color,
			parent_id = excluded.parent_id,
			sort_order = excluded.sort_order`

	_, err := s.db.ExecContext(ctx, query, f.ID, f.Name, f.Color, parentID, f.SortOrder)
	if err != nil {
		return "", err
	}
	return f.ID, nil
}

func (s *LocalStore) DeleteFolder(ctx context.Context, id string) error {
	_, _ = s.db.ExecContext(ctx, `UPDATE connections SET folder_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE folder_id = ?`, id)
	_, err := s.db.ExecContext(ctx, `DELETE FROM connection_folders WHERE id = ?`, id)
	return err
}

func (s *LocalStore) MoveConnectionToFolder(ctx context.Context, connectionID string, folderID *string) error {
	validFolderID := s.normalizeFolderID(ctx, folderID)
	_, err := s.db.ExecContext(ctx, `UPDATE connections SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, validFolderID, connectionID)
	return err
}

func (s *LocalStore) UpdateConnectionsLayout(ctx context.Context, items []ConnectionLayoutUpdate) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	stmt, err := tx.PrepareContext(ctx, `UPDATE connections SET folder_id = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, item := range items {
		var folderID *string
		if item.FolderID != nil && *item.FolderID != "" {
			var exists int
			if err := tx.QueryRowContext(ctx, `SELECT 1 FROM connection_folders WHERE id = ?`, *item.FolderID).Scan(&exists); err == nil && exists == 1 {
				folderID = item.FolderID
			}
		}
		if _, err := stmt.ExecContext(ctx, folderID, item.SortOrder, item.ID); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *LocalStore) UpdateFoldersOrder(ctx context.Context, folderIDs []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	stmt, err := tx.PrepareContext(ctx, `UPDATE connection_folders SET sort_order = ? WHERE id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for idx, id := range folderIDs {
		if _, err := stmt.ExecContext(ctx, idx, id); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *LocalStore) ListConnections(ctx context.Context) ([]ConnectionConfig, error) {
	query := `SELECT id, folder_id, name, driver, COALESCE(env_type, 'local'), color_tag, is_read_only, tx_mode, host, port, username, database_name,
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
			&c.ID, &c.FolderID, &c.Name, &c.Driver, &c.EnvType, &c.ColorTag, &isReadOnly, &c.TxMode,
			&c.Host, &c.Port, &c.Username, &c.DatabaseName, &c.FilePath, &c.SSLMode,
			&c.SSLCAPath, &c.SSLCertPath, &c.SSLKeyPath, &sshEnabled, &c.SSHHost,
			&c.SSHPort, &c.SSHUser, &c.SSHAuthType, &c.SSHKeyPath, &c.OptionsJSON,
			&c.SortOrder, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			continue
		}
		if c.EnvType == "" {
			c.EnvType = "local"
		}
		c.IsReadOnly = isReadOnly == 1
		c.SSHEnabled = sshEnabled == 1
		conns = append(conns, c)
	}
	return conns, nil
}

func (s *LocalStore) GetConnection(ctx context.Context, id string) (*ConnectionConfig, error) {
	query := `SELECT id, folder_id, name, driver, COALESCE(env_type, 'local'), color_tag, is_read_only, tx_mode, host, port, username, database_name,
		file_path, ssl_mode, ssl_ca_path, ssl_cert_path, ssl_key_path, ssh_enabled, ssh_host, ssh_port, ssh_user,
		ssh_auth_type, ssh_key_path, options_json, sort_order, created_at, updated_at
		FROM connections WHERE id = ?`

	var c ConnectionConfig
	var isReadOnly, sshEnabled int
	err := s.db.QueryRowContext(ctx, query, id).Scan(
		&c.ID, &c.FolderID, &c.Name, &c.Driver, &c.EnvType, &c.ColorTag, &isReadOnly, &c.TxMode,
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
	if c.EnvType == "" {
		c.EnvType = "local"
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
	c.FolderID = s.normalizeFolderID(ctx, c.FolderID)
	if c.EnvType != "dev" && c.EnvType != "prod" {
		c.EnvType = "local"
	}
	switch c.EnvType {
	case "dev":
		c.ColorTag = "#10b981"
	case "prod":
		c.ColorTag = "#ef4444"
	default:
		c.ColorTag = ""
	}

	query := `INSERT INTO connections (
		id, folder_id, name, driver, env_type, color_tag, is_read_only, tx_mode, host, port, username, database_name,
		file_path, ssl_mode, ssl_ca_path, ssl_cert_path, ssl_key_path, ssh_enabled, ssh_host, ssh_port, ssh_user,
		ssh_auth_type, ssh_key_path, options_json, sort_order, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	ON CONFLICT(id) DO UPDATE SET
		folder_id = excluded.folder_id,
		name = excluded.name,
		driver = excluded.driver,
		env_type = excluded.env_type,
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
		c.ID, c.FolderID, c.Name, c.Driver, c.EnvType, c.ColorTag, isReadOnly, c.TxMode, c.Host, c.Port, c.Username, c.DatabaseName,
		c.FilePath, c.SSLMode, c.SSLCAPath, c.SSLCertPath, c.SSLKeyPath, sshEnabled, c.SSHHost, c.SSHPort, c.SSHUser,
		c.SSHAuthType, c.SSHKeyPath, c.OptionsJSON, c.SortOrder,
	)
	if err != nil {
		return "", err
	}

	// Save or clear secrets securely
	if c.Password != "" {
		_ = crypto.SaveSecret("conn:"+c.ID+":db", c.Password)
	} else {
		_ = crypto.DeleteSecret("conn:" + c.ID + ":db")
	}
	if c.SSHPassword != "" {
		_ = crypto.SaveSecret("conn:"+c.ID+":ssh", c.SSHPassword)
	} else {
		_ = crypto.DeleteSecret("conn:" + c.ID + ":ssh")
	}

	return c.ID, nil
}

func (s *LocalStore) DeleteConnection(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM connections WHERE id = ?`, id)
	_ = crypto.DeleteSecret("conn:" + id + ":db")
	_ = crypto.DeleteSecret("conn:" + id + ":ssh")
	return err
}

