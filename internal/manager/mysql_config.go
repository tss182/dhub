package manager

import (
	"fmt"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"

	"dhub/internal/store"
)

// newMySQLConfig builds the go-sql-driver config shared by the MySQL and MariaDB drivers.
func newMySQLConfig(cfg store.ConnectionConfig, host string, port int) (*mysqldriver.Config, error) {
	mc := mysqldriver.NewConfig()
	mc.User = cfg.Username
	mc.Passwd = cfg.Password
	mc.Net = "tcp"
	mc.Addr = fmt.Sprintf("%s:%d", host, port)
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

	// Handle SSL/TLS configuration. Any failure aborts the connection instead of silently
	// connecting without the requested verification.
	if err := configureMySQLTLS(mc, cfg); err != nil {
		return nil, fmt.Errorf("tls configuration: %w", err)
	}
	return mc, nil
}
