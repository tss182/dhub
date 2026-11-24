package mysqlapply

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"

	drv "dhub/internal/driver"
)

// fakeDB is a tiny database/sql driver that records statements and replies from a script.
type fakeDB struct {
	mu       sync.Mutex
	log      []string
	args     [][]driver.Value
	affected map[string]int64 // statement prefix -> rows affected
	types    map[string]string
	commit   int
	rollback int
}

type fakeConnector struct{ db *fakeDB }

func (c *fakeConnector) Connect(context.Context) (driver.Conn, error) { return &fakeConn{c.db}, nil }
func (c *fakeConnector) Driver() driver.Driver                        { return nil }

type fakeConn struct{ db *fakeDB }

func (c *fakeConn) Prepare(q string) (driver.Stmt, error) { return &fakeStmt{c.db, q}, nil }
func (c *fakeConn) Close() error                          { return nil }
func (c *fakeConn) Begin() (driver.Tx, error)             { return &fakeTx{c.db}, nil }

type fakeTx struct{ db *fakeDB }

func (t *fakeTx) Commit() error   { t.db.mu.Lock(); t.db.commit++; t.db.mu.Unlock(); return nil }
func (t *fakeTx) Rollback() error { t.db.mu.Lock(); t.db.rollback++; t.db.mu.Unlock(); return nil }

type fakeStmt struct {
	db *fakeDB
	q  string
}

func (s *fakeStmt) Close() error  { return nil }
func (s *fakeStmt) NumInput() int { return -1 }
func (s *fakeStmt) Exec(args []driver.Value) (driver.Result, error) {
	s.db.mu.Lock()
	defer s.db.mu.Unlock()
	s.db.log = append(s.db.log, s.q)
	s.db.args = append(s.db.args, args)
	for prefix, n := range s.db.affected {
		if strings.HasPrefix(s.q, prefix) {
			return driver.RowsAffected(n), nil
		}
	}
	return driver.RowsAffected(1), nil
}
func (s *fakeStmt) Query(args []driver.Value) (driver.Rows, error) {
	if strings.Contains(s.q, "information_schema.columns") {
		return &fakeRows{cols: []string{"column_name", "data_type"}, db: s.db}, nil
	}
	return &fakeRows{cols: []string{"x"}}, nil
}

type fakeRows struct {
	cols []string
	db   *fakeDB
	i    int
	keys []string
}

func (r *fakeRows) Columns() []string { return r.cols }
func (r *fakeRows) Close() error      { return nil }
func (r *fakeRows) Next(dest []driver.Value) error {
	if r.db == nil {
		return io.EOF
	}
	if r.keys == nil {
		for k := range r.db.types {
			r.keys = append(r.keys, k)
		}
	}
	if r.i >= len(r.keys) {
		return io.EOF
	}
	dest[0], dest[1] = r.keys[r.i], r.db.types[r.keys[r.i]]
	r.i++
	return nil
}

func newDB(t *testing.T, f *fakeDB) *sql.DB {
	t.Helper()
	db := sql.OpenDB(&fakeConnector{f})
	t.Cleanup(func() { db.Close() })
	return db
}

func quote(s string) string { return "`" + strings.ReplaceAll(s, "`", "``") + "`" }

func TestApply_RefusesEmptyKey(t *testing.T) {
	for _, typ := range []string{"update", "delete"} {
		f := &fakeDB{}
		_, err := Apply(context.Background(), newDB(t, f), quote, "db", "t",
			[]drv.RowChange{{Type: typ, PrimaryKey: map[string]any{}, Changes: map[string]any{"a": 1}}})
		if !errors.Is(err, ErrNoRowKey) {
			t.Fatalf("%s: err = %v, want ErrNoRowKey", typ, err)
		}
		for _, q := range f.log {
			if strings.HasPrefix(q, "UPDATE") || strings.HasPrefix(q, "DELETE") {
				t.Fatalf("%s: statement was sent without a key: %s", typ, q)
			}
		}
		if f.commit != 0 {
			t.Fatalf("%s: transaction was committed", typ)
		}
	}
}

func TestApply_RollsBackWhenRowIsGone(t *testing.T) {
	f := &fakeDB{affected: map[string]int64{"UPDATE": 0}}
	_, err := Apply(context.Background(), newDB(t, f), quote, "db", "t", []drv.RowChange{
		{Type: "insert", Changes: map[string]any{"a": 1}},
		{Type: "update", PrimaryKey: map[string]any{"id": 1}, Changes: map[string]any{"a": 2}},
	})
	if !errors.Is(err, ErrRowChanged) {
		t.Fatalf("err = %v, want ErrRowChanged", err)
	}
	if f.commit != 0 || f.rollback == 0 {
		t.Fatalf("commit=%d rollback=%d, want the batch rolled back", f.commit, f.rollback)
	}
}

func TestApply_RejectsAmbiguousKey(t *testing.T) {
	f := &fakeDB{affected: map[string]int64{"DELETE": 2}}
	_, err := Apply(context.Background(), newDB(t, f), quote, "db", "t",
		[]drv.RowChange{{Type: "delete", PrimaryKey: map[string]any{"id": 1}}})
	if err == nil || !strings.Contains(err.Error(), "not unique") {
		t.Fatalf("err = %v, want a not-unique error", err)
	}
}

func TestApply_NoUseStatementAndNullKey(t *testing.T) {
	f := &fakeDB{}
	n, err := Apply(context.Background(), newDB(t, f), quote, "my`db", "t", []drv.RowChange{
		{Type: "update", PrimaryKey: map[string]any{"a": nil, "b": "null"}, Changes: map[string]any{"c": "x"}},
	})
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	for _, q := range f.log {
		if strings.HasPrefix(strings.ToUpper(q), "USE ") {
			t.Fatalf("unexpected USE statement: %s", q)
		}
	}
	want := "UPDATE `my``db`.`t` SET `c` = ? WHERE `a` IS NULL AND `b` = ?"
	if f.log[len(f.log)-1] != want {
		t.Fatalf("statement = %q, want %q", f.log[len(f.log)-1], want)
	}
	args := f.args[len(f.args)-1]
	if len(args) != 2 || args[1] != "null" {
		t.Fatalf("args = %v, text 'null' must stay a string", args)
	}
	if f.commit != 1 {
		t.Fatalf("commit = %d", f.commit)
	}
}

func TestApply_ConvertsBinaryKeyByColumnType(t *testing.T) {
	f := &fakeDB{types: map[string]string{"id": "binary", "name": "varchar"}}
	_, err := Apply(context.Background(), newDB(t, f), quote, "db", "t", []drv.RowChange{
		{Type: "update", PrimaryKey: map[string]any{"id": "0x0a0b"}, Changes: map[string]any{"name": "0x0a0b"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	args := f.args[len(f.args)-1]
	if fmt.Sprintf("%v", args[0]) != "0x0a0b" {
		t.Errorf("varchar value was reinterpreted: %v", args[0])
	}
	if b, ok := args[1].([]byte); !ok || len(b) != 2 || b[0] != 0x0a || b[1] != 0x0b {
		t.Errorf("binary key = %#v, want bytes 0a0b", args[1])
	}
}

func TestPreviewWhere(t *testing.T) {
	lit := func(v any) string { return fmt.Sprintf("'%v'", v) }
	got, err := PreviewWhere(quote, lit, map[string]any{"b": 2, "a": nil})
	if err != nil || got != "`a` IS NULL AND `b` = '2'" {
		t.Fatalf("got %q, %v", got, err)
	}
	if _, err := PreviewWhere(quote, lit, nil); !errors.Is(err, ErrNoRowKey) {
		t.Fatalf("err = %v", err)
	}
}
