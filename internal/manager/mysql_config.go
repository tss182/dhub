package manager

import (
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"

	"dhub/internal/store"
)

type mysqlOptions struct {
	UnixSocket              string `json:"unixSocket"`
	Collation               string `json:"collation"`
	TimeZone                string `json:"timeZone"`
	InitSQL                 string `json:"initSql"`
	MaxExecutionTimeMs      int    `json:"maxExecutionTimeMs"`
	AllowCleartextPasswords bool   `json:"allowCleartextPasswords"`
	Compress                bool   `json:"compress"`
	ReadTimeout             string `json:"readTimeout"`
	WriteTimeout            string `json:"writeTimeout"`
}

func extractMySQLInitSQL(cfg store.ConnectionConfig) string {
	if strings.TrimSpace(cfg.OptionsJSON) == "" {
		return ""
	}
	var opts mysqlOptions
	if err := json.Unmarshal([]byte(cfg.OptionsJSON), &opts); err != nil {
		return ""
	}
	return strings.TrimSpace(opts.InitSQL)
}

// newMySQLConfig builds the go-sql-driver config shared by the MySQL and MariaDB drivers.
func newMySQLConfig(cfg store.ConnectionConfig, host string, port int) (*mysqldriver.Config, error) {
	mc := mysqldriver.NewConfig()
	mc.User = cfg.Username
	mc.Passwd = cfg.Password
	mc.Net = "tcp"
	if strings.TrimSpace(host) == "" {
		host = "127.0.0.1"
	}
	if port <= 0 {
		port = 3306
	}
	mc.Addr = net.JoinHostPort(host, strconv.Itoa(port))
	mc.DBName = cfg.DatabaseName
	// Dates stay as the text the server sends. Parsing them turns 0000-00-00 into 0001-01-01,
	// drops the original fractional precision, and applies a time zone to TIMESTAMP columns.
	mc.ParseTime = false
	// RowsAffected counts matched rows, not only changed rows, so an edit that writes the same value
	// is not mistaken for "row was deleted by someone else".
	mc.ClientFoundRows = true
	// Statements are split client-side. Server-side multi-statements would let a payload that the
	// client parses as one read-only statement run as several on the server.
	mc.MultiStatements = false
	mc.Timeout = 10 * time.Second
	mc.ConnectionAttributes = "program_name:DHub"

	if strings.TrimSpace(cfg.OptionsJSON) != "" {
		var opts mysqlOptions
		if err := json.Unmarshal([]byte(cfg.OptionsJSON), &opts); err == nil {
			if sock := strings.TrimSpace(opts.UnixSocket); sock != "" {
				mc.Net = "unix"
				mc.Addr = sock
			}
			if col := strings.TrimSpace(opts.Collation); col != "" {
				mc.Collation = col
			}
			if tz := strings.TrimSpace(opts.TimeZone); tz != "" {
				if mc.Params == nil {
					mc.Params = make(map[string]string)
				}
				mc.Params["time_zone"] = "'" + strings.ReplaceAll(tz, "'", "''") + "'"
			}
			if opts.MaxExecutionTimeMs > 0 {
				if mc.Params == nil {
					mc.Params = make(map[string]string)
				}
				if strings.EqualFold(cfg.Driver, "mariadb") {
					// MariaDB uses max_statement_time in seconds (decimal).
					mc.Params["max_statement_time"] = strconv.FormatFloat(float64(opts.MaxExecutionTimeMs)/1000.0, 'f', -1, 64)
				} else {
					mc.Params["max_execution_time"] = strconv.Itoa(opts.MaxExecutionTimeMs)
				}
			}
			sslModeLower := strings.ToLower(strings.TrimSpace(cfg.SSLMode))
			if opts.AllowCleartextPasswords && sslModeLower != "" && sslModeLower != "disable" && sslModeLower != "disabled" {
				mc.AllowCleartextPasswords = true
			}
			if opts.Compress {
				if mc.Params == nil {
					mc.Params = make(map[string]string)
				}
				mc.Params["compress"] = "true"
			}
			if d, err := time.ParseDuration(strings.TrimSpace(opts.ReadTimeout)); err == nil && d > 0 {
				mc.ReadTimeout = d
			}
			if d, err := time.ParseDuration(strings.TrimSpace(opts.WriteTimeout)); err == nil && d > 0 {
				mc.WriteTimeout = d
			}
		}
	}

	// Handle SSL/TLS configuration. Any failure aborts the connection instead of silently
	// connecting without the requested verification.
	if err := configureMySQLTLS(mc, cfg); err != nil {
		return nil, fmt.Errorf("tls configuration: %w", err)
	}
	return mc, nil
}
