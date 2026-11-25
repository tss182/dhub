// Package mysqlconn opens database/sql pools for the MySQL and MariaDB drivers.
package mysqlconn

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"strings"

	mysqldriver "github.com/go-sql-driver/mysql"
)

// Open returns a pool for dsn. When readOnly is set, every new connection first runs
// SET SESSION TRANSACTION READ ONLY so the server rejects writes even if a statement slips
// past the client-side read-only check.
func Open(dsn string, readOnly bool) (*sql.DB, error) {
	return OpenWithInitSQL(dsn, readOnly, "")
}

// OpenWithInitSQL opens a pool for dsn, enforcing read-only mode (when readOnly is true) and
// running initSQL on every newly opened connection.
func OpenWithInitSQL(dsn string, readOnly bool, initSQL string) (*sql.DB, error) {
	initSQL = strings.TrimSpace(initSQL)
	if !readOnly && initSQL == "" {
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
	return sql.OpenDB(&initConnector{inner: inner, readOnly: readOnly, initSQL: initSQL}), nil
}

type initConnector struct {
	inner    driver.Connector
	readOnly bool
	initSQL  string
}

func (c *initConnector) Driver() driver.Driver { return c.inner.Driver() }

func (c *initConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.inner.Connect(ctx)
	if err != nil {
		return nil, err
	}
	execer, ok := conn.(driver.ExecerContext)
	if !ok {
		_ = conn.Close()
		return nil, fmt.Errorf("cannot initialize session: driver connection does not support ExecContext")
	}
	if c.initSQL != "" {
		for _, stmt := range splitInitSQL(c.initSQL) {
			if _, err := execer.ExecContext(ctx, stmt, nil); err != nil {
				_ = conn.Close()
				return nil, fmt.Errorf("init SQL failed: %w", err)
			}
		}
	}
	if c.readOnly {
		if _, err := execer.ExecContext(ctx, "SET SESSION TRANSACTION READ ONLY", nil); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("cannot enforce read-only session: %w", err)
		}
	}
	return conn, nil
}

func splitInitSQL(sql string) []string {
	var stmts []string
	var cur strings.Builder
	inSingle, inDouble, inBacktick, escaped := false, false, false, false
	for _, r := range sql {
		if escaped {
			cur.WriteRune(r)
			escaped = false
			continue
		}
		if (inSingle || inDouble) && r == '\\' {
			cur.WriteRune(r)
			escaped = true
			continue
		}
		if r == '\'' && !inDouble && !inBacktick {
			inSingle = !inSingle
		} else if r == '"' && !inSingle && !inBacktick {
			inDouble = !inDouble
		} else if r == '`' && !inSingle && !inDouble {
			inBacktick = !inBacktick
		} else if r == ';' && !inSingle && !inDouble && !inBacktick {
			if s := strings.TrimSpace(cur.String()); s != "" {
				stmts = append(stmts, s)
			}
			cur.Reset()
			continue
		}
		cur.WriteRune(r)
	}
	if s := strings.TrimSpace(cur.String()); s != "" {
		stmts = append(stmts, s)
	}
	return stmts
}
