package driver

import (
	"context"
	"database/sql"
	sqldriver "database/sql/driver"
	"errors"
	"strings"

	mysqldriver "github.com/go-sql-driver/mysql"
)

// MySQLStmtKind classifies a MySQL or MariaDB statement by its effect on the session.
type MySQLStmtKind int

const (
	StmtOther MySQLStmtKind = iota
	// StmtImplicitCommit statements end the open transaction on the server without being asked to.
	StmtImplicitCommit
	StmtCommit
	StmtRollback // a plain ROLLBACK, not ROLLBACK TO SAVEPOINT
	StmtBegin    // BEGIN or START TRANSACTION
	StmtUse
)

// ClassifyMySQLStatement reports what a single statement does to the session and transaction.
// The statement must come from SplitStatementsForDialect, so comments are already in their final
// place; leading comments are stripped here.
func ClassifyMySQLStatement(stmt string) MySQLStmtKind {
	clean := strings.TrimSpace(StripLeadingComments(stmt))
	clean = strings.TrimRight(clean, "; \t\r\n")
	words := strings.Fields(strings.ToUpper(clean))
	if len(words) == 0 {
		return StmtOther
	}
	w0 := words[0]
	w1, w2 := "", ""
	if len(words) > 1 {
		w1 = words[1]
	}
	if len(words) > 2 {
		w2 = words[2]
	}

	switch w0 {
	case "USE":
		return StmtUse
	case "COMMIT":
		return StmtCommit
	case "BEGIN":
		return StmtBegin
	case "START":
		if w1 == "TRANSACTION" {
			return StmtBegin
		}
	case "ROLLBACK":
		// ROLLBACK TO [SAVEPOINT] x keeps the transaction open.
		if w1 == "TO" || w1 == "WORK" && w2 == "TO" {
			return StmtOther
		}
		return StmtRollback
	case "ALTER", "RENAME", "TRUNCATE", "GRANT", "REVOKE", "INSTALL", "UNINSTALL", "FLUSH",
		"ANALYZE", "OPTIMIZE", "REPAIR", "CACHE", "LOAD", "RESET", "LOCK", "UNLOCK":
		if w0 == "LOAD" && w1 != "INDEX" {
			return StmtOther // LOAD DATA stays inside the transaction on InnoDB
		}
		if w0 == "ANALYZE" && w1 != "TABLE" && w1 != "NO_WRITE_TO_BINLOG" && w1 != "LOCAL" {
			return StmtOther // MariaDB: ANALYZE <stmt> runs the statement
		}
		return StmtImplicitCommit
	case "CREATE", "DROP":
		if w1 == "TEMPORARY" || (w1 == "OR" && w2 == "REPLACE" && len(words) > 3 && words[3] == "TEMPORARY") {
			return StmtOther // temporary tables do not commit
		}
		return StmtImplicitCommit
	case "SET":
		// SET autocommit = 1 commits an open transaction. Any other SET leaves it alone.
		joined := strings.ReplaceAll(strings.Join(words[1:], ""), "@@SESSION.", "")
		joined = strings.TrimPrefix(joined, "SESSION")
		joined = strings.TrimPrefix(joined, "@@")
		if strings.HasPrefix(joined, "AUTOCOMMIT=1") || strings.HasPrefix(joined, "AUTOCOMMIT=ON") ||
			strings.HasPrefix(joined, "AUTOCOMMIT=TRUE") {
			return StmtImplicitCommit
		}
		if w1 == "PASSWORD" {
			return StmtImplicitCommit
		}
	}
	return StmtOther
}

// ContainsUseStatement reports whether any statement in the script switches the default database.
func ContainsUseStatement(sqlText, dialect string) bool {
	for _, stmt := range SplitStatementsForDialect(sqlText, dialect) {
		if ClassifyMySQLStatement(stmt) == StmtUse {
			return true
		}
	}
	return false
}

// IsConnectionLost reports whether err means the server connection is gone, so session state,
// temporary tables and any open transaction no longer exist.
func IsConnectionLost(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, sqldriver.ErrBadConn) || errors.Is(err, mysqldriver.ErrInvalidConn) || errors.Is(err, sql.ErrConnDone) {
		return true
	}
	var me *mysqldriver.MySQLError
	if errors.As(err, &me) {
		switch me.Number {
		case 1053, 1927, 2006, 2013: // server shutdown, connection killed, gone away, lost
			return true
		}
		return false
	}
	msg := strings.ToLower(err.Error())
	for _, s := range []string{"invalid connection", "bad connection", "broken pipe", "connection reset", "server has gone away", "lost connection", "use of closed network connection", "driver: bad connection"} {
		if strings.Contains(msg, s) {
			return true
		}
	}
	return false
}

// TabSessionDriver is implemented by drivers that keep one server session per console tab, so
// SET, @variables, temporary tables and transactions survive between executions.
type TabSessionDriver interface {
	// BeginTxForTab opens a transaction on the tab's own session.
	BeginTxForTab(ctx context.Context, tabID, database string) (*sql.Tx, error)
	// TxEnded tells the driver that the tab's transaction is over, however it ended.
	TxEnded(tabID string)
	// CloseSession releases the tab's session. It is safe to call for a tab with none.
	CloseSession(tabID string)
}

// QueryCanceller is implemented by drivers that can stop a running statement on the server
// without dropping the connection (KILL QUERY), which keeps the session and its transaction.
type QueryCanceller interface {
	// CancelExecution reports handled=true when the statement was stopped on the server. When it
	// is false the caller should fall back to cancelling the context.
	CancelExecution(executionID string) (handled bool, err error)
	// TrackExecution associates a running execution with a tab so it can be cancelled. The
	// returned function removes the association.
	TrackExecution(executionID, tabID string) (untrack func())
}
