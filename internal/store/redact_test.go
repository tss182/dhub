package store

import (
	"strings"
	"testing"
)

func TestRedactSQLSecrets(t *testing.T) {
	cases := []struct {
		name, in, secret string
	}{
		{"create user", "CREATE USER `u`@`%` IDENTIFIED BY 'hunter2'", "hunter2"},
		{"backslash quote", `ALTER USER u@h IDENTIFIED BY 'a\'b\\c'`, `a\'b`},
		{"injection attempt", `CREATE USER u IDENTIFIED BY 'x\'; DROP USER root@'%'; --'`, "DROP USER"},
		{"identified with", "CREATE USER u IDENTIFIED WITH caching_sha2_password BY 's3cret'", "s3cret"},
		{"identified with as hash", "CREATE USER u IDENTIFIED WITH mysql_native_password AS '*ABCDEF'", "*ABCDEF"},
		{"by password hash", "CREATE USER u IDENTIFIED BY PASSWORD '*ABCDEF'", "*ABCDEF"},
		{"mariadb via using", "CREATE USER u IDENTIFIED VIA ed25519 USING PASSWORD('s3cret')", "s3cret"},
		{"replace old password", "ALTER USER u IDENTIFIED BY 'new1' REPLACE 'old1'", "old1"},
		{"set password", "SET PASSWORD FOR 'u'@'h' = 'pw1'", "pw1"},
		{"set password function", "SET PASSWORD FOR u = PASSWORD('pw2')", "pw2"},
		{"postgres", "ALTER ROLE app WITH ENCRYPTED PASSWORD 'pg-secret'", "pg-secret"},
		{"double quoted", `CREATE USER u IDENTIFIED BY "dq-secret"`, "dq-secret"},
		{"lowercase", "create user u identified by 'low'", "low"},
		{"doubled quote", "CREATE USER u IDENTIFIED BY 'it''s'", "it''s"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := RedactSQLSecrets(tc.in)
			if strings.Contains(got, tc.secret) {
				t.Fatalf("secret %q still present: %s", tc.secret, got)
			}
			if !strings.Contains(got, "'***'") {
				t.Fatalf("no redaction marker: %s", got)
			}
		})
	}
}

func TestRedactSQLSecrets_LeavesOrdinarySQLAlone(t *testing.T) {
	for _, in := range []string{
		"SELECT * FROM users WHERE name = 'bob'",
		"SELECT 'identified by' AS s",
		"GRANT SELECT ON db.* TO 'u'@'%'",
		"SELECT password FROM users LIMIT 5",
		"UPDATE users SET name = 'x' WHERE id = 1",
	} {
		if got := RedactSQLSecrets(in); got != in {
			t.Errorf("changed ordinary SQL:\n in  %s\n out %s", in, got)
		}
	}
}
