// Package mysqlconn opens database/sql pools for the MySQL and MariaDB drivers.
package mysqlconn

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"

	mysqldriver "github.com/go-sql-driver/mysql"
)

// Open returns a pool for dsn. When readOnly is set, every new connection first runs
// SET SESSION TRANSACTION READ ONLY so the server rejects writes even if a statement slips
// past the client-side read-only check. The statement is valid on both MySQL and MariaDB,
// unlike session variables passed through the DSN, which fail on servers that do not know them.
// If the statement fails the connection is dropped, so a read-only pool never degrades to read-write.
func Open(dsn string, readOnly bool) (*sql.DB, error) {
	if !readOnly {
		return sql.Open("mysql", dsn)
	}
	cfg, err := mysqldriver.ParseDSN(dsn)
	if err != nil {
		return nil, err
	}
	inner, err := mysqldriver.NewConnector(cfg)
	if err != nil {
		return nil, err
	}
	return sql.OpenDB(&readOnlyConnector{inner: inner}), nil
}

type readOnlyConnector struct {
	inner driver.Connector
}

func (c *readOnlyConnector) Driver() driver.Driver { return c.inner.Driver() }

func (c *readOnlyConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.inner.Connect(ctx)
	if err != nil {
		return nil, err
	}
	execer, ok := conn.(driver.ExecerContext)
	if !ok {
		_ = conn.Close()
		return nil, fmt.Errorf("cannot enforce read-only session: driver connection does not support ExecContext")
	}
	if _, err := execer.ExecContext(ctx, "SET SESSION TRANSACTION READ ONLY", nil); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("cannot enforce read-only session: %w", err)
	}
	return conn, nil
}
