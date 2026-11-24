package store

import "regexp"

// sqlStringLiteral matches a single- or double-quoted SQL string, honouring backslash escapes
// and doubled quotes.
const sqlStringLiteral = `(?:'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*")`

var secretPatterns = []*regexp.Regexp{
	// MySQL/MariaDB: IDENTIFIED BY 'x', IDENTIFIED BY PASSWORD 'hash', IDENTIFIED WITH plugin BY|AS 'x'
	regexp.MustCompile(`(?i)(\bIDENTIFIED\s+(?:WITH\s+\w+\s+)?(?:BY|AS)\s+(?:PASSWORD\s+)?)` + sqlStringLiteral),
	// MariaDB: IDENTIFIED VIA ed25519 USING PASSWORD('x') / USING 'hash'
	regexp.MustCompile(`(?i)(\bIDENTIFIED\s+VIA\s+\w+\s+USING\s+(?:PASSWORD\s*\(\s*)?)` + sqlStringLiteral),
	// ALTER USER ... IDENTIFIED BY 'new' REPLACE 'old'
	regexp.MustCompile(`(?i)(\bIDENTIFIED\b[^;]*?\bREPLACE\s+)` + sqlStringLiteral),
	// PASSWORD('x'), PASSWORD 'x' (also PostgreSQL "WITH [ENCRYPTED] PASSWORD 'x'")
	regexp.MustCompile(`(?i)(\bPASSWORD\s*\(\s*)` + sqlStringLiteral),
	regexp.MustCompile(`(?i)(\bPASSWORD\s+)` + sqlStringLiteral),
	// SET PASSWORD [FOR user] = 'x'. This also matches "UPDATE t SET password = 'x'", which is
	// redacted on purpose: hiding a column value in history is safer than leaking a credential.
	regexp.MustCompile(`(?i)(\bSET\s+PASSWORD\b[^=;]*=\s*)` + sqlStringLiteral),
}

// RedactSQLSecrets masks passwords and password hashes in account-management SQL so they are not
// written to the local query history.
func RedactSQLSecrets(sql string) string {
	for _, re := range secretPatterns {
		sql = re.ReplaceAllString(sql, `${1}'***'`)
	}
	return sql
}
