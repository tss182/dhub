// Package mysqlsuite holds integration checks shared by the MySQL and MariaDB drivers.
// It is only used from tests tagged "integration" and needs a live server.
package mysqlsuite

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"dhub/internal/driver"
)

// Run executes the shared suite against drv. db is the database every test creates tables in.
func Run(t *testing.T, drv driver.DatabaseDriver, db string) {
	RunWithReadOnly(t, drv, nil, db)
}

// RunWithReadOnly also checks that readOnly, a driver opened in read-only mode, rejects writes.
func RunWithReadOnly(t *testing.T, drv, readOnly driver.DatabaseDriver, db string) {
	t.Helper()
	s := &suite{t: t, drv: drv, readOnly: readOnly, db: db}
	t.Run("BigIntKeepsPrecision", s.bigIntKeepsPrecision)
	t.Run("FirstPageIsLimited", s.firstPageIsLimited)
	t.Run("LiteralNullAndISOTextSurvive", s.literalNullAndISOTextSurvive)
	t.Run("PreviewMatchesApplied", s.previewMatchesApplied)
	t.Run("StatementsRunSeparately", s.statementsRunSeparately)
	t.Run("ZeroDateAndFractionKeptAsText", s.zeroDateAndFractionKeptAsText)
	t.Run("BinaryKeyAndBitRoundTrip", s.binaryKeyAndBitRoundTrip)
	t.Run("EditRequiresExactlyOneRow", s.editRequiresExactlyOneRow)
	t.Run("EmptyKeyIsRefused", s.emptyKeyIsRefused)
	t.Run("MetadataIsComplete", s.metadataIsComplete)
	t.Run("ReadOnlyBlocksWrites", s.readOnlyBlocksWrites)
	t.Run("SessionPinningAndIsolation", s.sessionPinningAndIsolation)
	t.Run("ManualTransactionAndCommit", s.manualTransactionAndCommit)
	t.Run("CancelQueryPreservesSession", s.cancelQueryPreservesSession)
	t.Run("MultipleResultSetsAndPartialFailure", s.multipleResultSetsAndPartialFailure)
}

type suite struct {
	t        *testing.T
	drv      driver.DatabaseDriver
	readOnly driver.DatabaseDriver
	db       string
}

func (s *suite) exec(sqlText string) *driver.QueryResult {
	s.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	res, err := s.drv.Execute(ctx, driver.QueryRequest{Database: s.db, SQL: sqlText, Limit: 1000})
	if err != nil {
		s.t.Fatalf("execute %q: %v", sqlText, err)
	}
	return res
}

func (s *suite) table(name, ddl string) string {
	s.t.Helper()
	s.exec(fmt.Sprintf("DROP TABLE IF EXISTS `%s`", name))
	s.exec(fmt.Sprintf("CREATE TABLE `%s` (%s)", name, ddl))
	s.t.Cleanup(func() {
		_, _ = s.drv.Execute(context.Background(), driver.QueryRequest{Database: s.db, SQL: fmt.Sprintf("DROP TABLE IF EXISTS `%s`", name), Limit: 10})
	})
	return name
}

func (s *suite) apply(table string, changes ...driver.RowChange) int64 {
	s.t.Helper()
	n, err := s.drv.ApplyChanges(context.Background(), s.db, "", table, changes)
	if err != nil {
		s.t.Fatalf("ApplyChanges: %v", err)
	}
	return n
}

// D1: BIGINT above 2^53 must reach the UI as a string, and editing such a row must hit it.
func (s *suite) bigIntKeepsPrecision(t *testing.T) {
	tb := s.table("dhub_bigint", "id BIGINT UNSIGNED PRIMARY KEY, note VARCHAR(20)")
	s.exec(fmt.Sprintf("INSERT INTO `%s` VALUES (9007199254740993,'a'),(18446744073709551615,'b')", tb))

	res := s.exec(fmt.Sprintf("SELECT id FROM `%s` ORDER BY id", tb))
	want := []string{"9007199254740993", "18446744073709551615"}
	if len(res.Rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(res.Rows))
	}
	for i, w := range want {
		if got := fmt.Sprint(res.Rows[i][0]); got != w {
			t.Errorf("row %d id = %q (%T), want %q", i, got, res.Rows[i][0], w)
		}
		if _, ok := res.Rows[i][0].(string); !ok {
			t.Errorf("row %d id is %T, want string to avoid JS rounding", i, res.Rows[i][0])
		}
	}
	for i, w := range want {
		n := s.apply(tb, driver.RowChange{Type: "update", PrimaryKey: map[string]any{"id": res.Rows[i][0]}, Changes: map[string]any{"note": "edited"}})
		if n != 1 {
			t.Errorf("update of id %s affected %d rows, want 1", w, n)
		}
	}
}

// P1: opening a big table must return one page and flag that more rows exist.
func (s *suite) firstPageIsLimited(t *testing.T) {
	tb := s.table("dhub_paging", "id INT PRIMARY KEY")
	s.exec("SET SESSION cte_max_recursion_depth = 5000")
	for i := 0; i < 5; i++ {
		s.exec(fmt.Sprintf("INSERT INTO `%s` SELECT %d*1000+n FROM (SELECT (a.n*100+b.n*10+c.n) AS n FROM "+
			"(SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a, "+
			"(SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) b, "+
			"(SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) c) x", tb, i))
	}
	ctx := context.Background()
	res, err := s.drv.Execute(ctx, driver.QueryRequest{Database: s.db, SQL: fmt.Sprintf("SELECT * FROM `%s` ORDER BY id", tb), Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Rows) != 10 || !res.HasMore {
		t.Fatalf("rows=%d hasMore=%v, want 10 rows and hasMore", len(res.Rows), res.HasMore)
	}
	// duplicate column names must not break paging
	res, err = s.drv.Execute(ctx, driver.QueryRequest{Database: s.db, SQL: fmt.Sprintf("SELECT a.id, b.id FROM `%s` a JOIN `%s` b ON a.id=b.id ORDER BY a.id", tb, tb), Limit: 10, Offset: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Rows) != 10 || fmt.Sprint(res.Rows[0][0]) != "20" {
		t.Fatalf("offset page: rows=%d first=%v, want 10 rows starting at 20", len(res.Rows), res.Rows[0])
	}
}

// D4: user text such as "null" or an ISO timestamp must be stored exactly as typed.
func (s *suite) literalNullAndISOTextSurvive(t *testing.T) {
	tb := s.table("dhub_text", "code VARCHAR(40) PRIMARY KEY, note VARCHAR(60) NULL")
	iso := "2026-11-05T12:30:00+07:00"
	s.apply(tb,
		driver.RowChange{Type: "insert", Changes: map[string]any{"code": "null", "note": iso}},
		driver.RowChange{Type: "insert", Changes: map[string]any{"code": "x", "note": nil}},
	)
	res := s.exec(fmt.Sprintf("SELECT code, note FROM `%s` ORDER BY code", tb))
	if len(res.Rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(res.Rows))
	}
	if res.Rows[0][0] != "null" || res.Rows[0][1] != iso {
		t.Errorf("row 0 = %v, want [null %s]", res.Rows[0], iso)
	}
	if res.Rows[1][1] != nil {
		t.Errorf("real NULL became %v", res.Rows[1][1])
	}
	if n := s.apply(tb, driver.RowChange{Type: "delete", PrimaryKey: map[string]any{"code": "null"}}); n != 1 {
		t.Errorf("deleting PK 'null' affected %d rows, want 1", n)
	}
}

// S4: the preview shown to the user must produce the same data as the applied change.
func (s *suite) previewMatchesApplied(t *testing.T) {
	tb := s.table("dhub_preview", "id INT PRIMARY KEY, v VARCHAR(80)")
	value := `C:\temp\it's` + "\nline2"
	change := driver.RowChange{Type: "insert", Changes: map[string]any{"id": 1, "v": value}}
	stmts, err := s.drv.GenerateDMLPreview(s.db, "", tb, []driver.RowChange{change})
	if err != nil {
		t.Fatal(err)
	}
	s.exec(strings.TrimSuffix(stmts[0], ";"))
	res := s.exec(fmt.Sprintf("SELECT v FROM `%s`", tb))
	if len(res.Rows) != 1 || res.Rows[0][0] != value {
		t.Fatalf("preview %q stored %v, want %q", stmts[0], res.Rows, value)
	}
}

// S1: statements are split client-side, so each one runs on its own and in order.
func (s *suite) statementsRunSeparately(t *testing.T) {
	tb := s.table("dhub_multi", "id INT PRIMARY KEY")
	res := s.exec(fmt.Sprintf("INSERT INTO `%s` VALUES (1); INSERT INTO `%s` VALUES (2); SELECT COUNT(*) FROM `%s`", tb, tb, tb))
	if len(res.Results) != 3 {
		t.Fatalf("got %d results, want 3", len(res.Results))
	}
}

// D2: a zero date and fractional seconds must come back exactly as stored.
func (s *suite) zeroDateAndFractionKeptAsText(t *testing.T) {
	tb := s.table("dhub_dates", "id INT PRIMARY KEY, d DATE NULL, dt DATETIME(3) NULL")
	s.exec("SET SESSION sql_mode = ''")
	s.exec(fmt.Sprintf("INSERT INTO `%s` VALUES (1, '0000-00-00', '2026-11-05 12:30:00.120')", tb))
	res := s.exec(fmt.Sprintf("SELECT d, dt FROM `%s`", tb))
	if len(res.Rows) != 1 {
		t.Fatalf("got %d rows", len(res.Rows))
	}
	if res.Rows[0][0] != "0000-00-00" || res.Rows[0][1] != "2026-11-05 12:30:00.120" {
		t.Errorf("got %v, want [0000-00-00 2026-11-05 12:30:00.120]", res.Rows[0])
	}
}

// D3: a BINARY primary key and a BIT column can be shown, edited and deleted.
func (s *suite) binaryKeyAndBitRoundTrip(t *testing.T) {
	tb := s.table("dhub_binary", "id BINARY(4) PRIMARY KEY, flag BIT(1) NOT NULL, note VARCHAR(20)")
	s.exec(fmt.Sprintf("INSERT INTO `%s` VALUES (0xDEADBEEF, b'1', 'x'), (0x00000001, b'0', 'y')", tb))
	res := s.exec(fmt.Sprintf("SELECT id, flag, note FROM `%s` ORDER BY id", tb))
	if len(res.Rows) != 2 || res.Rows[1][0] != "0xdeadbeef" {
		t.Fatalf("rows = %v, want binary shown as 0xdeadbeef", res.Rows)
	}
	if fmt.Sprint(res.Rows[1][1]) != "1" {
		t.Errorf("BIT(1) = %v, want 1", res.Rows[1][1])
	}
	if n := s.apply(tb, driver.RowChange{Type: "update", PrimaryKey: map[string]any{"id": "0xdeadbeef"}, Changes: map[string]any{"note": "edited", "flag": "0"}}); n != 1 {
		t.Fatalf("update affected %d rows, want 1", n)
	}
	chk := s.exec(fmt.Sprintf("SELECT note, flag+0 FROM `%s` WHERE id = 0xDEADBEEF", tb))
	if len(chk.Rows) != 1 || chk.Rows[0][0] != "edited" || fmt.Sprint(chk.Rows[0][1]) != "0" {
		t.Errorf("after update = %v", chk.Rows)
	}
	if n := s.apply(tb, driver.RowChange{Type: "delete", PrimaryKey: map[string]any{"id": "0x00000001"}}); n != 1 {
		t.Errorf("delete affected %d rows, want 1", n)
	}
}

// D6: writing the same value still counts as a matched row, and a vanished row fails the batch.
func (s *suite) editRequiresExactlyOneRow(t *testing.T) {
	tb := s.table("dhub_rows", "id INT PRIMARY KEY, v VARCHAR(10)")
	s.exec(fmt.Sprintf("INSERT INTO `%s` VALUES (1,'a'),(2,'b')", tb))
	if n := s.apply(tb, driver.RowChange{Type: "update", PrimaryKey: map[string]any{"id": 1}, Changes: map[string]any{"v": "a"}}); n != 1 {
		t.Errorf("same-value update reported %d, want 1", n)
	}
	_, err := s.drv.ApplyChanges(context.Background(), s.db, "", tb, []driver.RowChange{
		{Type: "update", PrimaryKey: map[string]any{"id": 2}, Changes: map[string]any{"v": "changed"}},
		{Type: "update", PrimaryKey: map[string]any{"id": 999}, Changes: map[string]any{"v": "x"}},
	})
	if err == nil {
		t.Fatal("update of a missing row succeeded")
	}
	res := s.exec(fmt.Sprintf("SELECT v FROM `%s` WHERE id = 2", tb))
	if res.Rows[0][0] != "b" {
		t.Errorf("batch was not rolled back: row 2 = %v", res.Rows[0][0])
	}
}

// D5: an update or delete without a key must never reach the server.
func (s *suite) emptyKeyIsRefused(t *testing.T) {
	tb := s.table("dhub_nokey", "a INT")
	s.exec(fmt.Sprintf("INSERT INTO `%s` VALUES (1),(2),(3)", tb))
	for _, typ := range []string{"update", "delete"} {
		_, err := s.drv.ApplyChanges(context.Background(), s.db, "", tb, []driver.RowChange{{Type: typ, PrimaryKey: map[string]any{}, Changes: map[string]any{"a": 9}}})
		if err == nil {
			t.Errorf("%s without a key succeeded", typ)
		}
	}
	if res := s.exec(fmt.Sprintf("SELECT COUNT(*) FROM `%s`", tb)); fmt.Sprint(res.Rows[0][0]) != "3" {
		t.Errorf("rows changed: %v", res.Rows)
	}
}

// D7/D8: generated columns, ON UPDATE, composite foreign keys and prefix/desc indexes are reported.
func (s *suite) metadataIsComplete(t *testing.T) {
	s.exec("DROP TABLE IF EXISTS dhub_child")
	parent := s.table("dhub_parent", "a INT, b INT, PRIMARY KEY (a, b)")
	_ = parent
	s.exec("CREATE TABLE dhub_child (" +
		"id INT PRIMARY KEY, a INT, b INT, name VARCHAR(50), " +
		"gen INT GENERATED ALWAYS AS (id * 2) STORED, " +
		"updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, " +
		"note VARCHAR(20) NULL DEFAULT NULL, label VARCHAR(20) NOT NULL DEFAULT 'abc', " +
		"KEY idx_name (name(10) , a DESC), " +
		"CONSTRAINT fk_ab FOREIGN KEY (a, b) REFERENCES dhub_parent (a, b))")
	t.Cleanup(func() {
		_, _ = s.drv.Execute(context.Background(), driver.QueryRequest{Database: s.db, SQL: "DROP TABLE IF EXISTS dhub_child", Limit: 1})
	})
	st, err := s.drv.GetTableStructure(context.Background(), s.db, "", "dhub_child")
	if err != nil {
		t.Fatal(err)
	}
	col := func(name string) driver.ColumnMeta {
		for _, c := range st.Columns {
			if c.Name == name {
				return c
			}
		}
		t.Fatalf("column %s missing", name)
		return driver.ColumnMeta{}
	}
	if g := col("gen"); g.ColumnKind != "STORED" || g.GenerationExpression == "" || g.DefaultValue != "" {
		t.Errorf("generated column = %+v", g)
	}
	if u := col("updated_at"); u.OnUpdate == "" || !strings.Contains(strings.ToLower(u.OnUpdate), "current_timestamp") {
		t.Errorf("ON UPDATE lost: %+v", u)
	}
	if n := col("note"); n.DefaultKind != "null" {
		t.Errorf("DEFAULT NULL = %+v", n)
	}
	if l := col("label"); l.DefaultValue != "abc" || l.DefaultKind != "literal" {
		t.Errorf("DEFAULT 'abc' = %+v", l)
	}
	if len(st.ForeignKeys) != 1 || len(st.ForeignKeys[0].Columns) != 2 || len(st.ForeignKeys[0].RefColumns) != 2 {
		t.Errorf("composite FK = %+v", st.ForeignKeys)
	}
	var idx *driver.IndexMeta
	for i := range st.Indexes {
		if st.Indexes[i].Name == "idx_name" {
			idx = &st.Indexes[i]
		}
	}
	if idx == nil || len(idx.SubParts) != 2 || idx.SubParts[0] != 10 {
		t.Fatalf("prefix index = %+v", idx)
	}
	if len(idx.Descending) != 2 || !idx.Descending[1] {
		t.Errorf("DESC part not reported: %+v", idx.Descending)
	}
}

// S1: a read-only connection must reject writes on the server, even when the client check is skipped.
func (s *suite) readOnlyBlocksWrites(t *testing.T) {
	ro, ok := s.drv.(interface {
		Execute(context.Context, driver.QueryRequest) (*driver.QueryResult, error)
	})
	if !ok || s.readOnly == nil {
		t.Skip("no read-only driver supplied")
	}
	tb := s.table("dhub_ro", "id INT PRIMARY KEY")
	s.exec(fmt.Sprintf("INSERT INTO `%s` VALUES (1)", tb))
	_ = ro
	for _, q := range []string{
		fmt.Sprintf("INSERT INTO `%s` VALUES (2)", tb),
		fmt.Sprintf("DELETE FROM `%s`", tb),
	} {
		if _, err := s.readOnly.Execute(context.Background(), driver.QueryRequest{Database: s.db, SQL: q, Limit: 10}); err == nil {
			t.Errorf("read-only connection accepted %q", q)
		}
	}
	if res := s.exec(fmt.Sprintf("SELECT COUNT(*) FROM `%s`", tb)); fmt.Sprint(res.Rows[0][0]) != "1" {
		t.Errorf("row count changed to %v", res.Rows[0][0])
	}
}

// F3/D13: each console tab gets its own pinned session, isolated from other tabs and the metadata pool.
func (s *suite) sessionPinningAndIsolation(t *testing.T) {
	ts, ok := s.drv.(driver.TabSessionDriver)
	if !ok {
		t.Skip("driver does not implement TabSessionDriver")
	}
	defer ts.CloseSession("tab-a")
	defer ts.CloseSession("tab-b")

	if _, err := s.drv.Execute(context.Background(), driver.QueryRequest{
		TabID:    "tab-a",
		Database: s.db,
		SQL:      "SET @dhub_var = 42; CREATE TEMPORARY TABLE dhub_tmp (v INT); INSERT INTO dhub_tmp VALUES (99);",
		Limit:    10,
	}); err != nil {
		t.Fatalf("tab-a setup failed: %v", err)
	}

	// Tab B must not see Tab A's session variable.
	resB, err := s.drv.Execute(context.Background(), driver.QueryRequest{
		TabID:    "tab-b",
		Database: s.db,
		SQL:      "SELECT @dhub_var",
		Limit:    10,
	})
	if err != nil || len(resB.Rows) != 1 || resB.Rows[0][0] != nil {
		t.Fatalf("tab-b saw @dhub_var = %v (err=%v), want nil", resB, err)
	}

	// Tab A still has both its variable and temporary table.
	resA, err := s.drv.Execute(context.Background(), driver.QueryRequest{
		TabID:    "tab-a",
		Database: s.db,
		SQL:      "SELECT @dhub_var, (SELECT v FROM dhub_tmp LIMIT 1)",
		Limit:    10,
	})
	if err != nil || len(resA.Rows) != 1 || fmt.Sprint(resA.Rows[0][0]) != "42" || fmt.Sprint(resA.Rows[0][1]) != "99" {
		t.Fatalf("tab-a lost session state: %+v (err=%v)", resA, err)
	}

	// USE db updates ActiveDatabase.
	useRes, err := s.drv.Execute(context.Background(), driver.QueryRequest{
		TabID:    "tab-a",
		Database: s.db,
		SQL:      fmt.Sprintf("USE `%s`", s.db),
		Limit:    10,
	})
	if err != nil || useRes.ActiveDatabase != s.db {
		t.Errorf("USE did not report ActiveDatabase=%q: %+v (err=%v)", s.db, useRes, err)
	}
}

// D14: manual transactions run on the tab's pinned connection and survive until commit/rollback.
func (s *suite) manualTransactionAndCommit(t *testing.T) {
	ts, ok := s.drv.(driver.TabSessionDriver)
	if !ok {
		t.Skip("driver does not implement TabSessionDriver")
	}
	defer ts.CloseSession("tab-tx")

	tb := s.table("dhub_tx", "id INT PRIMARY KEY")
	tx, err := ts.BeginTxForTab(context.Background(), "tab-tx", s.db)
	if err != nil {
		t.Fatalf("BeginTxForTab failed: %v", err)
	}
	if _, err := tx.Exec(fmt.Sprintf("INSERT INTO `%s` VALUES (1)", tb)); err != nil {
		_ = tx.Rollback()
		ts.TxEnded("tab-tx")
		t.Fatalf("insert inside tx failed: %v", err)
	}
	// Another session must not see uncommitted row.
	if res := s.exec(fmt.Sprintf("SELECT COUNT(*) FROM `%s`", tb)); fmt.Sprint(res.Rows[0][0]) != "0" {
		t.Errorf("uncommitted row visible: %v", res.Rows)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit failed: %v", err)
	}
	ts.TxEnded("tab-tx")
	if res := s.exec(fmt.Sprintf("SELECT COUNT(*) FROM `%s`", tb)); fmt.Sprint(res.Rows[0][0]) != "1" {
		t.Errorf("committed row not visible: %v", res.Rows)
	}
}

// D15: CancelExecution runs KILL QUERY so the statement stops on the server while keeping the session.
func (s *suite) cancelQueryPreservesSession(t *testing.T) {
	ts, ok := s.drv.(driver.TabSessionDriver)
	if !ok {
		t.Skip("driver does not implement TabSessionDriver")
	}
	qc, ok := s.drv.(driver.QueryCanceller)
	if !ok {
		t.Skip("driver does not implement QueryCanceller")
	}
	defer ts.CloseSession("tab-cancel")

	if _, err := s.drv.Execute(context.Background(), driver.QueryRequest{
		TabID:    "tab-cancel",
		Database: s.db,
		SQL:      "SET @keep_me = 777",
		Limit:    10,
	}); err != nil {
		t.Fatal(err)
	}

	errCh := make(chan error, 1)
	go func() {
		_, err := s.drv.Execute(context.Background(), driver.QueryRequest{
			ExecutionID: "exec-sleep",
			TabID:       "tab-cancel",
			Database:    s.db,
			SQL:         "SELECT SLEEP(5)",
			Limit:       10,
		})
		errCh <- err
	}()

	// Poll briefly until CancelExecution finds the running execution.
	var handled bool
	for i := 0; i < 20; i++ {
		var err error
		handled, err = qc.CancelExecution("exec-sleep")
		if handled {
			if err != nil {
				t.Errorf("CancelExecution error: %v", err)
			}
			break
		}
		select {
		case <-errCh:
			t.Fatal("SLEEP finished before cancel")
		default:
		}
	}
	if !handled {
		t.Fatal("CancelExecution never saw exec-sleep")
	}
	<-errCh

	// Session variable must still be intact because KILL QUERY kept the connection alive.
	res, err := s.drv.Execute(context.Background(), driver.QueryRequest{
		TabID:    "tab-cancel",
		Database: s.db,
		SQL:      "SELECT @keep_me",
		Limit:    10,
	})
	if err != nil || len(res.Rows) != 1 || fmt.Sprint(res.Rows[0][0]) != "777" {
		t.Errorf("session lost after KILL QUERY: %+v (err=%v)", res, err)
	}
}

// D16/D18: CALL with multiple result sets returns all sets, and mid-script failure keeps prior results.
func (s *suite) multipleResultSetsAndPartialFailure(t *testing.T) {
	s.exec("DROP PROCEDURE IF EXISTS dhub_multi_proc")
	s.exec("CREATE PROCEDURE dhub_multi_proc() BEGIN SELECT 1 AS a; SELECT 2 AS b; END")
	t.Cleanup(func() {
		_, _ = s.drv.Execute(context.Background(), driver.QueryRequest{Database: s.db, SQL: "DROP PROCEDURE IF EXISTS dhub_multi_proc", Limit: 1})
	})

	res := s.exec("CALL dhub_multi_proc()")
	if len(res.Results) != 2 {
		t.Fatalf("got %d result sets from CALL, want 2", len(res.Results))
	}

	partial, err := s.drv.Execute(context.Background(), driver.QueryRequest{
		Database: s.db,
		SQL:      "SELECT 1 AS ok; SELECT * FROM dhub_does_not_exist_xyz;",
		Limit:    10,
	})
	if err != nil {
		t.Fatalf("mid-script failure returned error instead of partial QueryResult: %v", err)
	}
	if partial.Error == "" || len(partial.Results) != 2 || partial.Results[0].Error != "" || partial.Results[1].Error == "" {
		t.Errorf("unexpected partial result: %+v", partial)
	}
}
