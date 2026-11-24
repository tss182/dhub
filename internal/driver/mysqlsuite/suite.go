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
	t.Helper()
	s := &suite{t: t, drv: drv, db: db}
	t.Run("BigIntKeepsPrecision", s.bigIntKeepsPrecision)
	t.Run("FirstPageIsLimited", s.firstPageIsLimited)
	t.Run("LiteralNullAndISOTextSurvive", s.literalNullAndISOTextSurvive)
	t.Run("PreviewMatchesApplied", s.previewMatchesApplied)
	t.Run("StatementsRunSeparately", s.statementsRunSeparately)
}

type suite struct {
	t   *testing.T
	drv driver.DatabaseDriver
	db  string
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
