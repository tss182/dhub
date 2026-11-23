package driver

import (
	"reflect"
	"testing"
)

func TestSplitStatements_CompoundAndDelimiter(t *testing.T) {
	tests := []struct {
		name string
		sql  string
		want []string
	}{
		{
			name: "standalone transaction begin and commit",
			sql:  "BEGIN; INSERT INTO t VALUES (1); COMMIT;",
			want: []string{"BEGIN", "INSERT INTO t VALUES (1)", "COMMIT"},
		},
		{
			name: "create procedure with compound BEGIN END without delimiter",
			sql: `CREATE PROCEDURE test_proc(IN p_id INT)
BEGIN
  IF p_id > 0 THEN
    SELECT * FROM users WHERE id = p_id;
  END IF;
  INSERT INTO logs(msg) VALUES ('ok');
END;
SELECT 1;`,
			want: []string{
				`CREATE PROCEDURE test_proc(IN p_id INT)
BEGIN
  IF p_id > 0 THEN
    SELECT * FROM users WHERE id = p_id;
  END IF;
  INSERT INTO logs(msg) VALUES ('ok');
END`,
				"SELECT 1",
			},
		},
		{
			name: "client DELIMITER directive",
			sql: `DELIMITER $$
CREATE TRIGGER trg_audit AFTER INSERT ON orders
FOR EACH ROW
BEGIN
  INSERT INTO audit(order_id) VALUES (NEW.id);
END$$
DELIMITER ;
SELECT 2;`,
			want: []string{
				`CREATE TRIGGER trg_audit AFTER INSERT ON orders
FOR EACH ROW
BEGIN
  INSERT INTO audit(order_id) VALUES (NEW.id);
END`,
				"SELECT 2",
			},
		},
		{
			name: "nested CASE inside compound BEGIN END",
			sql: `CREATE FUNCTION fn_label(x INT) RETURNS VARCHAR(10)
BEGIN
  DECLARE res VARCHAR(10);
  SET res = CASE WHEN x > 0 THEN 'pos' ELSE 'neg' END;
  RETURN res;
END;`,
			want: []string{
				`CREATE FUNCTION fn_label(x INT) RETURNS VARCHAR(10)
BEGIN
  DECLARE res VARCHAR(10);
  SET res = CASE WHEN x > 0 THEN 'pos' ELSE 'neg' END;
  RETURN res;
END`,
			},
		},
		{
			name: "postgres dollar-quoted block with semicolons",
			sql: `DO $$
BEGIN
  PERFORM 1;
  PERFORM 2;
END $$;
SELECT 3;`,
			want: []string{
				`DO $$
BEGIN
  PERFORM 1;
  PERFORM 2;
END $$`,
				"SELECT 3",
			},
		},
		{
			name: "mssql bracketed identifier with semicolon",
			sql:  "SELECT [col;name] FROM [dbo].[users]; SELECT 1;",
			want: []string{"SELECT [col;name] FROM [dbo].[users]", "SELECT 1"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := SplitStatements(tc.sql)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("SplitStatements() =\n%#v\nwant:\n%#v", got, tc.want)
			}
		})
	}
}

func TestIsQueryReturningRows(t *testing.T) {
	returning := []string{
		"SELECT 1",
		"  -- comment\nANALYZE SELECT * FROM users",
		"ANALYZE FORMAT=JSON SELECT 1",
		"VALUES (1, 2)",
		"WITH cte AS (SELECT 1) SELECT * FROM cte",
		"SHOW CREATE SEQUENCE s1",
		"OPTIMIZE TABLE users",
		"CHECK TABLE users",
		"REPAIR TABLE users",
	}
	for _, q := range returning {
		if !IsQueryReturningRows(q) {
			t.Errorf("expected IsQueryReturningRows(%q) = true", q)
		}
	}

	nonReturning := []string{
		"INSERT INTO users VALUES (1)",
		"UPDATE users SET a = 1",
		"CREATE TABLE t (id INT)",
		"DESCRIPTION_SOMETHING",
	}
	for _, q := range nonReturning {
		if IsQueryReturningRows(q) {
			t.Errorf("expected IsQueryReturningRows(%q) = false", q)
		}
	}
}

func TestIsReadOnlySafeQuery(t *testing.T) {
	safe := []string{
		"SELECT * FROM users",
		"SELECT updated_at, delete_flag FROM users WHERE status = 'DELETE'",
		"WITH active AS (SELECT * FROM users) SELECT * FROM active",
		"EXPLAIN SELECT * FROM users",
		"SHOW TABLES",
		"GET /collections/docs",
		"POST /collections/docs/points/search\n{\"vector\":[0.1,0.2],\"limit\":5}",
		"POST /collections/docs/points/scroll\n{\"limit\":10}",
		"POST /collections/docs/points/query\n{\"query\":[0.1,0.2]}",
		"POST /collections/docs/points/count\n{\"exact\":true}",
		"POST /my_index/_search\n{\"query\":{\"match_all\":{}}}",
	}
	for _, q := range safe {
		if !IsReadOnlySafeQuery(q) {
			t.Errorf("expected IsReadOnlySafeQuery(%q) = true", q)
		}
	}

	unsafe := []string{
		"INSERT INTO users VALUES (1)",
		"INSERT INTO users VALUES (1) RETURNING *",
		"WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d",
		"WITH u AS (UPDATE users SET a = 1 RETURNING *) SELECT * FROM u",
		"EXPLAIN ANALYZE DELETE FROM users",
		"DROP TABLE users",
		"EXEC sp_who2",
		"PUT /collections/docs/points?wait=true\n{}",
		"POST /collections/docs/points/delete?wait=true\n{}",
		"DELETE /collections/docs",
	}
	for _, q := range unsafe {
		if IsReadOnlySafeQuery(q) {
			t.Errorf("expected IsReadOnlySafeQuery(%q) = false", q)
		}
	}
}

func TestSplitHTTPOrSQLStatements_ReadOnlyBypassPrevention(t *testing.T) {
	script := "GET /collections\n\nDELETE /collections/prod"
	stmts := SplitHTTPOrSQLStatements(script)
	if len(stmts) != 2 {
		t.Fatalf("expected 2 statements, got %d: %#v", len(stmts), stmts)
	}
	if !IsReadOnlySafeQuery(stmts[0]) {
		t.Fatalf("expected GET /collections to be read-only safe")
	}
	if IsReadOnlySafeQuery(stmts[1]) {
		t.Fatalf("expected DELETE /collections/prod to be blocked in read-only mode")
	}
	if !IsReadOnlySafeQuery("POST /collections/docs/facet\n{\"key\":\"category\"}") {
		t.Fatalf("expected POST /collections/docs/facet to be read-only safe")
	}
}

func TestElasticsearchReadOnlyAndSplitter(t *testing.T) {
	safeES := []string{
		"GET /_cat/indices?format=json",
		"HEAD /my_index",
		"POST /my_index/_search\n{\"query\":{\"match_all\":{}}}",
		"POST /my_index/_count\n{\"query\":{\"match_all\":{}}}",
		"POST /my_index/_analyze\n{\"analyzer\":\"standard\",\"text\":\"hello world\"}",
		"FROM logs | WHERE status == \"ok\" | LIMIT 10",
	}
	for _, q := range safeES {
		if !IsReadOnlySafeQuery(q) {
			t.Errorf("expected Elasticsearch query %q to be read-only safe", q)
		}
	}

	unsafeES := []string{
		"POST /my_index/_bulk\n{\"index\":{}}\n{\"a\":1}\n",
		"POST /_reindex\n{\"source\":{\"index\":\"a\"},\"dest\":{\"index\":\"b\"}}",
		"POST /my_index/_delete_by_query\n{\"query\":{\"match_all\":{}}}",
		"PUT /my_index\n{}",
		"DELETE /my_index",
	}
	for _, q := range unsafeES {
		if IsReadOnlySafeQuery(q) {
			t.Errorf("expected Elasticsearch mutating query %q to be blocked in read-only mode", q)
		}
	}

	script := "// list indices\nGET /_cat/indices?format=json\n\nFROM logs | LIMIT 5"
	stmts := SplitHTTPOrSQLStatements(script)
	if len(stmts) != 2 {
		t.Fatalf("expected 2 statements, got %d: %#v", len(stmts), stmts)
	}
}
