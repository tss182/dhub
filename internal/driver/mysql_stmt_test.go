package driver

import (
	"context"
	"database/sql"
	sqldriver "database/sql/driver"
	"errors"
	"testing"

	mysqldriver "github.com/go-sql-driver/mysql"
	_ "modernc.org/sqlite"
)

func TestClassifyMySQLStatement(t *testing.T) {
	cases := []struct {
		sql  string
		want MySQLStmtKind
	}{
		{"USE mydb;", StmtUse},
		{"/* comment */ USE `my``db`", StmtUse},
		{"COMMIT;", StmtCommit},
		{"ROLLBACK;", StmtRollback},
		{"ROLLBACK TO SAVEPOINT sp1;", StmtOther},
		{"ROLLBACK WORK TO sp1;", StmtOther},
		{"BEGIN;", StmtBegin},
		{"START TRANSACTION;", StmtBegin},
		{"ALTER TABLE t ADD COLUMN c INT;", StmtImplicitCommit},
		{"CREATE TABLE t (id INT);", StmtImplicitCommit},
		{"CREATE TEMPORARY TABLE tmp (id INT);", StmtOther},
		{"DROP TEMPORARY TABLE IF EXISTS tmp;", StmtOther},
		{"SET @a = 1;", StmtOther},
		{"SET SESSION autocommit = 1;", StmtImplicitCommit},
		{"ANALYZE TABLE t;", StmtImplicitCommit},
		{"ANALYZE SELECT 1;", StmtOther},
		{"LOAD DATA INFILE '/tmp/x' INTO TABLE t;", StmtOther},
		{"LOAD INDEX INTO CACHE t;", StmtImplicitCommit},
		{"SELECT 1;", StmtOther},
	}
	for _, tc := range cases {
		if got := ClassifyMySQLStatement(tc.sql); got != tc.want {
			t.Errorf("ClassifyMySQLStatement(%q) = %v, want %v", tc.sql, got, tc.want)
		}
	}
}

func TestIsConnectionLost(t *testing.T) {
	if IsConnectionLost(nil) {
		t.Fatal("nil should not be connection lost")
	}
	for _, err := range []error{
		sqldriver.ErrBadConn,
		mysqldriver.ErrInvalidConn,
		sql.ErrConnDone,
		&mysqldriver.MySQLError{Number: 2006, Message: "MySQL server has gone away"},
		&mysqldriver.MySQLError{Number: 2013, Message: "Lost connection to MySQL server"},
		errors.New("broken pipe"),
	} {
		if !IsConnectionLost(err) {
			t.Errorf("IsConnectionLost(%v) = false, want true", err)
		}
	}
	if IsConnectionLost(&mysqldriver.MySQLError{Number: 1064, Message: "syntax error"}) {
		t.Error("syntax error should not be treated as connection lost")
	}
}

func TestExecuteStatements_MidScriptFailureKeepsPriorResults(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	res, err := ExecuteStatementsWithDialect(context.Background(), db, QueryRequest{
		ExecutionID: "exec-1",
		SQL:         "SELECT 1 AS a; SELECT * FROM nonexistent_table; SELECT 2 AS b;",
		Limit:       10,
	}, "mysql")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res == nil || res.Error == "" {
		t.Fatalf("expected QueryResult.Error to be populated, got %+v", res)
	}
	if len(res.Results) != 2 {
		t.Fatalf("got %d results, want 2 (first succeeded + second failed)", len(res.Results))
	}
	if res.Results[0].Error != "" || len(res.Results[0].Rows) != 1 {
		t.Errorf("first result = %+v, want 1 row and no error", res.Results[0])
	}
	if res.Results[1].Error == "" {
		t.Errorf("second result should carry the error")
	}

	// Failure on the very first statement still returns an error.
	_, err = ExecuteStatementsWithDialect(context.Background(), db, QueryRequest{
		ExecutionID: "exec-2",
		SQL:         "SELECT * FROM nonexistent_table;",
		Limit:       10,
	}, "mysql")
	if err == nil {
		t.Fatal("expected error when first statement fails")
	}
}
