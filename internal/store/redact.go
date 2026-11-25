package store

import "regexp"

// sqlStringLiteral matches a single- or double-quoted SQL string, honouring backslash escapes
// and doubled quotes.
const sqlStringLiteral = `(?:'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*")`

// stdSqlStringLiteral matches a standard SQL string (no backslash escape, e.g. PostgreSQL / MSSQL / Oracle).
const stdSqlStringLiteral = `'(?:[^']|'')*'`

var secretPatterns = []*regexp.Regexp{
	// MySQL/MariaDB: IDENTIFIED BY 'x', IDENTIFIED BY PASSWORD 'hash', IDENTIFIED WITH 'plugin' BY|AS 'x'
	regexp.MustCompile(`(?i)(\bIDENTIFIED\s+(?:WITH\s+(?:\w+|` + sqlStringLiteral + `)\s+)?(?:BY|AS)\s+(?:PASSWORD\s+)?)` + sqlStringLiteral),
	// Oracle: IDENTIFIED BY unquoted_password
	regexp.MustCompile(`(?i)(\bIDENTIFIED\s+BY\s+)([^\s;'"(]+)`),
	// MariaDB: IDENTIFIED VIA ed25519 USING PASSWORD('x') / USING 'hash'
	regexp.MustCompile(`(?i)(\bIDENTIFIED\s+VIA\s+\w+\s+USING\s+(?:PASSWORD\s*\(\s*)?)` + sqlStringLiteral),
	// ALTER USER ... IDENTIFIED BY 'new' REPLACE 'old'
	regexp.MustCompile(`(?i)(\bIDENTIFIED\b[^;]*?\bREPLACE\s+)` + sqlStringLiteral),
	// MSSQL: WITH PASSWORD = N'x' / 'x', OLD_PASSWORD = N'x' / 'x'
	regexp.MustCompile(`(?i)(\b(?:OLD_)?PASSWORD\s*=\s*N?)` + stdSqlStringLiteral),
	// PostgreSQL: PASSWORD $$secret$$ or E'secret'
	regexp.MustCompile(`(?i)(\bPASSWORD\s+)\$\$.*?\$\$`),
	regexp.MustCompile(`(?i)(\bPASSWORD\s+E)` + sqlStringLiteral),
	// PASSWORD('x'), PASSWORD 'x' (also PostgreSQL "WITH [ENCRYPTED] PASSWORD 'x'")
	regexp.MustCompile(`(?i)(\bPASSWORD\s*\(\s*)` + sqlStringLiteral),
	regexp.MustCompile(`(?i)(\bPASSWORD\s+)` + sqlStringLiteral),
	// SET PASSWORD [FOR user] = 'x'.
	regexp.MustCompile(`(?i)(\bSET\s+PASSWORD\b[^=;]*=\s*)` + sqlStringLiteral),
	// SQLite SQLCipher: PRAGMA key = 'x', PRAGMA rekey = 'x'
	regexp.MustCompile(`(?i)(\bPRAGMA\s+(?:re)?key\s*=\s*)` + sqlStringLiteral),
	// MongoDB: pwd: "x" / 'x', changeUserPassword("u", "x")
	regexp.MustCompile(`(?i)(["']?pwd["']?\s*:\s*)` + sqlStringLiteral),
	regexp.MustCompile(`(?i)(\bchangeUserPassword\s*\(\s*` + sqlStringLiteral + `\s*,\s*)` + sqlStringLiteral),
	// Elasticsearch: "password": "x"
	regexp.MustCompile(`(?i)("password"\s*:\s*)"(?:[^"\\]|\\.)*"`),
	// Redis: AUTH [user] secret, CONFIG SET requirepass secret, ACL SETUSER u >secret
	regexp.MustCompile(`(?i)(^\s*AUTH\s+(?:\S+\s+)?)(\S+)`),
	regexp.MustCompile(`(?i)(\bCONFIG\s+SET\s+requirepass\s+)(\S+)`),
	regexp.MustCompile(`(?i)(\bACL\s+SETUSER\s+\S+[^;\n]*?\s>?)(\S+)`),
}

// RedactSQLSecrets masks passwords and password hashes in account-management SQL so they are not
// written to the local query history.
func RedactSQLSecrets(sql string) string {
	for _, re := range secretPatterns {
		sql = re.ReplaceAllString(sql, `${1}'***'`)
	}
	return sql
}
