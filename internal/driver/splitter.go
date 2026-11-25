package driver

import (
	"net/url"
	"strings"
	"unicode"
)

// dialectFlags classifies a dialect name. MySQL and MariaDB share quoting and comment rules
// that differ from the generic splitter: "--" is a comment only when followed by whitespace
// or a control character, and "/*! ... */" (plus "/*M! ... */" on MariaDB) is executed as SQL.
func dialectFlags(dialect string) (isMySQLFamily, isMariaDB bool) {
	switch strings.ToLower(strings.TrimSpace(dialect)) {
	case "mysql":
		return true, false
	case "mariadb":
		return true, true
	}
	return false, false
}

type sqlDialectRules struct {
	isGeneric        bool
	isPostgres       bool
	isMySQLFamily    bool
	isMariaDB        bool
	isMSSQL          bool
	isOracle         bool
	isClickHouse     bool
	backslashEscapes bool
	hashComment      bool
	bracketIdent     bool
	dollarQuote      bool
	backtickIdent    bool
	delimiterDir     bool
}

func getSQLDialectRules(dialect string) sqlDialectRules {
	d := strings.ToLower(strings.TrimSpace(dialect))
	isMySQLFamily, isMariaDB := dialectFlags(d)
	isGeneric := d == ""
	isPostgres := d == "postgres" || d == "postgresql"
	isMSSQL := d == "mssql" || d == "sqlserver"
	isOracle := d == "oracle"
	isClickHouse := d == "clickhouse"
	return sqlDialectRules{
		isGeneric:        isGeneric,
		isPostgres:       isPostgres,
		isMySQLFamily:    isMySQLFamily,
		isMariaDB:        isMariaDB,
		isMSSQL:          isMSSQL,
		isOracle:         isOracle,
		isClickHouse:     isClickHouse,
		backslashEscapes: isMySQLFamily || isClickHouse || isGeneric,
		hashComment:      isMySQLFamily || isClickHouse || isGeneric,
		bracketIdent:     isMSSQL || isGeneric,
		dollarQuote:      isPostgres || isGeneric,
		backtickIdent:    !isPostgres,
		delimiterDir:     isMySQLFamily || isGeneric,
	}
}

// isMySQLDashComment reports whether "--" at runes[i:i+2] starts a comment in MySQL,
// which requires whitespace, a control character, or end of input right after it.
func isMySQLDashComment(runes []rune, afterDashes int) bool {
	if afterDashes >= len(runes) {
		return true
	}
	return unicode.IsSpace(runes[afterDashes]) || unicode.IsControl(runes[afterDashes])
}

// executableCommentLen returns the length of the "/*!" or "/*M!" opener at runes[i:], or 0.
// MySQL runs the body of "/*! ... */" as SQL, and MariaDB also runs "/*M! ... */".
func executableCommentLen(runes []rune, i int, isMariaDB bool) int {
	if i+2 < len(runes) && runes[i] == '/' && runes[i+1] == '*' {
		if runes[i+2] == '!' {
			return 3
		}
		if isMariaDB && i+3 < len(runes) && runes[i+2] == 'M' && runes[i+3] == '!' {
			return 4
		}
	}
	return 0
}

func isIdentChar(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '$'
}

func peekNextWord(runes []rune, start int) string {
	n := len(runes)
	i := start
	for i < n {
		r := runes[i]
		if unicode.IsSpace(r) {
			i++
			continue
		}
		if r == '-' && i+1 < n && runes[i+1] == '-' {
			i += 2
			for i < n && runes[i] != '\n' {
				i++
			}
			continue
		}
		if r == '#' {
			i++
			for i < n && runes[i] != '\n' {
				i++
			}
			continue
		}
		if r == '/' && i+1 < n && runes[i+1] == '*' {
			i += 2
			for i+1 < n && !(runes[i] == '*' && runes[i+1] == '/') {
				i++
			}
			i += 2
			continue
		}
		break
	}
	if i >= n {
		return ""
	}
	if !isIdentChar(runes[i]) {
		return string(runes[i])
	}
	j := i
	for j < n && isIdentChar(runes[j]) {
		j++
	}
	return strings.ToUpper(string(runes[i:j]))
}

func matchSliceAt(runes []rune, idx int, target []rune) bool {
	if len(target) == 0 || idx+len(target) > len(runes) {
		return false
	}
	for k, r := range target {
		if runes[idx+k] != r {
			return false
		}
	}
	return true
}

func parseDollarTag(runes []rune, idx int) ([]rune, bool) {
	n := len(runes)
	if idx >= n || runes[idx] != '$' {
		return nil, false
	}
	if idx+1 < n && runes[idx+1] == '$' {
		return runes[idx : idx+2], true
	}
	if idx+1 >= n || (!unicode.IsLetter(runes[idx+1]) && runes[idx+1] != '_') {
		return nil, false
	}
	j := idx + 2
	for j < n && (unicode.IsLetter(runes[j]) || unicode.IsDigit(runes[j]) || runes[j] == '_') {
		j++
	}
	if j < n && runes[j] == '$' {
		return runes[idx : j+1], true
	}
	return nil, false
}

func parseMSSQLGoLine(runes []rune, lineStart int) (lineEnd int, ok bool) {
	n := len(runes)
	i := lineStart
	for i < n && (runes[i] == ' ' || runes[i] == '\t') {
		i++
	}
	if i+2 > n || (runes[i] != 'G' && runes[i] != 'g') || (runes[i+1] != 'O' && runes[i+1] != 'o') {
		return 0, false
	}
	i += 2
	if i < n && (isIdentChar(runes[i]) || runes[i] == '.') {
		return 0, false
	}
	for i < n && runes[i] != '\n' && runes[i] != '\r' {
		if runes[i] == ' ' || runes[i] == '\t' {
			i++
			continue
		}
		if runes[i] == '-' && i+1 < n && runes[i+1] == '-' {
			for i < n && runes[i] != '\n' && runes[i] != '\r' {
				i++
			}
			break
		}
		if unicode.IsDigit(runes[i]) {
			for i < n && unicode.IsDigit(runes[i]) {
				i++
			}
			continue
		}
		return 0, false
	}
	if i < n && runes[i] == '\r' && i+1 < n && runes[i+1] == '\n' {
		i += 2
	} else if i < n && (runes[i] == '\n' || runes[i] == '\r') {
		i++
	}
	return i, true
}

func parseOracleSlashLine(runes []rune, lineStart int) (lineEnd int, ok bool) {
	n := len(runes)
	i := lineStart
	for i < n && (runes[i] == ' ' || runes[i] == '\t') {
		i++
	}
	if i >= n || runes[i] != '/' {
		return 0, false
	}
	i++
	for i < n && (runes[i] == ' ' || runes[i] == '\t') {
		i++
	}
	if i < n && runes[i] != '\n' && runes[i] != '\r' {
		return 0, false
	}
	if i < n && runes[i] == '\r' && i+1 < n && runes[i+1] == '\n' {
		i += 2
	} else if i < n && (runes[i] == '\n' || runes[i] == '\r') {
		i++
	}
	return i, true
}

func parseDelimiterLine(runes []rune, lineStart int) (delim string, lineEnd int, ok bool) {
	n := len(runes)
	i := lineStart
	for i < n && (runes[i] == ' ' || runes[i] == '\t') {
		i++
	}
	const kw = "DELIMITER"
	if i+len(kw) > n {
		return "", 0, false
	}
	if !strings.EqualFold(string(runes[i:i+len(kw)]), kw) {
		return "", 0, false
	}
	i += len(kw)
	if i >= n || (runes[i] != ' ' && runes[i] != '\t') {
		return "", 0, false
	}
	for i < n && (runes[i] == ' ' || runes[i] == '\t') {
		i++
	}
	end := i
	for end < n && runes[end] != '\n' && runes[end] != '\r' {
		end++
	}
	tok := strings.TrimSpace(string(runes[i:end]))
	if tok == "" {
		return "", 0, false
	}
	if end < n && runes[end] == '\r' && end+1 < n && runes[end+1] == '\n' {
		end += 2
	} else if end < n && (runes[end] == '\n' || runes[end] == '\r') {
		end++
	}
	return tok, end, true
}

// SplitStatements splits a multi-statement SQL script into individual statements,
// accurately ignoring delimiters inside strings, comments, identifier quotes,
// client DELIMITER blocks, and compound BEGIN ... END blocks (procedures/functions/triggers/events).
func SplitStatements(sql string) []string {
	return SplitStatementsForDialect(sql, "")
}

// SplitStatementsForDialect splits a multi-statement SQL script using dialect-aware quoting and comment rules.
func SplitStatementsForDialect(sql, dialect string) []string {
	rules := getSQLDialectRules(dialect)
	isPostgres := rules.isPostgres
	isMySQLFamily := rules.isMySQLFamily
	isMariaDB := rules.isMariaDB
	var statements []string
	var current strings.Builder
	runes := []rune(sql)
	n := len(runes)

	delim := []rune{';'}

	var inSingleQuote bool
	var singleQuoteEscape bool
	var inDoubleQuote bool
	var inBacktick bool
	var inBracket bool
	var inDollarQuote bool
	var dollarTag []rune
	var inLineComment bool
	var blockCommentDepth int

	var atLineStart = true
	var stmtStarted bool
	var isCreateStmt bool
	var pendingCompoundBody bool
	var hadCompoundBody bool
	var beginDepth int
	var caseDepth int

	resetStmtState := func() {
		stmtStarted = false
		isCreateStmt = false
		pendingCompoundBody = false
		hadCompoundBody = false
		beginDepth = 0
		caseDepth = 0
	}

	for i := 0; i < n; i++ {
		r := runes[i]

		// Handle client DELIMITER directive and native batch terminators (MSSQL GO, Oracle /)
		if atLineStart && !inSingleQuote && !inDoubleQuote && !inBacktick && !inBracket && !inDollarQuote && !inLineComment && blockCommentDepth == 0 {
			if rules.delimiterDir && !stmtStarted {
				if newDelim, nextIdx, ok := parseDelimiterLine(runes, i); ok {
					delim = []rune(newDelim)
					i = nextIdx - 1
					atLineStart = true
					continue
				}
			}
			if rules.isMSSQL {
				if nextIdx, ok := parseMSSQLGoLine(runes, i); ok {
					if stmt := strings.TrimSpace(current.String()); stmt != "" {
						statements = append(statements, stmt)
					}
					current.Reset()
					resetStmtState()
					i = nextIdx - 1
					atLineStart = true
					continue
				}
			}
			if rules.isOracle {
				if nextIdx, ok := parseOracleSlashLine(runes, i); ok {
					if stmt := strings.TrimSpace(current.String()); stmt != "" {
						statements = append(statements, stmt)
					}
					current.Reset()
					resetStmtState()
					i = nextIdx - 1
					atLineStart = true
					continue
				}
			}
		}

		// Check line comment end
		if inLineComment {
			current.WriteRune(r)
			if r == '\n' {
				inLineComment = false
				atLineStart = true
			} else {
				atLineStart = false
			}
			continue
		}

		// Check block comment end (supports nested /* ... */ in PostgreSQL)
		if blockCommentDepth > 0 {
			current.WriteRune(r)
			if isPostgres && r == '/' && i+1 < n && runes[i+1] == '*' {
				current.WriteRune('*')
				i++
				blockCommentDepth++
			} else if r == '*' && i+1 < n && runes[i+1] == '/' {
				current.WriteRune('/')
				i++
				blockCommentDepth--
			}
			atLineStart = (r == '\n')
			continue
		}

		// Check single quote end
		if inSingleQuote {
			current.WriteRune(r)
			if singleQuoteEscape && r == '\\' && i+1 < n {
				current.WriteRune(runes[i+1])
				i++
			} else if r == '\'' {
				// Handle escaped quote: ''
				if i+1 < n && runes[i+1] == '\'' {
					current.WriteRune('\'')
					i++
				} else {
					inSingleQuote = false
					singleQuoteEscape = false
				}
			}
			atLineStart = (r == '\n')
			continue
		}

		// Check double quote end
		if inDoubleQuote {
			current.WriteRune(r)
			if rules.backslashEscapes && r == '\\' && i+1 < n {
				current.WriteRune(runes[i+1])
				i++
			} else if r == '"' {
				if i+1 < n && runes[i+1] == '"' {
					current.WriteRune('"')
					i++
				} else {
					inDoubleQuote = false
				}
			}
			atLineStart = (r == '\n')
			continue
		}

		// Check backtick end
		if inBacktick {
			current.WriteRune(r)
			if r == '`' {
				inBacktick = false
			}
			atLineStart = (r == '\n')
			continue
		}

		// Check MSSQL bracketed identifier end
		if inBracket {
			current.WriteRune(r)
			if r == ']' {
				if i+1 < n && runes[i+1] == ']' {
					current.WriteRune(']')
					i++
				} else {
					inBracket = false
				}
			}
			atLineStart = (r == '\n')
			continue
		}

		// Check PostgreSQL dollar-quoted string end
		if inDollarQuote {
			if matchSliceAt(runes, i, dollarTag) {
				for _, tr := range dollarTag {
					current.WriteRune(tr)
				}
				i += len(dollarTag) - 1
				inDollarQuote = false
				atLineStart = false
			} else {
				current.WriteRune(r)
				atLineStart = (r == '\n')
			}
			continue
		}

		// Start of comments or quotes
		if r == '-' && i+1 < n && runes[i+1] == '-' && (!isMySQLFamily || isMySQLDashComment(runes, i+2)) {
			current.WriteRune(r)
			current.WriteRune('-')
			i++
			inLineComment = true
			atLineStart = false
			continue
		}
		if r == '#' && rules.hashComment {
			current.WriteRune(r)
			inLineComment = true
			atLineStart = false
			continue
		}
		if isMySQLFamily {
			if l := executableCommentLen(runes, i, isMariaDB); l > 0 {
				// The body runs as SQL on the server, so keep scanning it as code.
				for k := 0; k < l; k++ {
					current.WriteRune(runes[i+k])
				}
				i += l - 1
				stmtStarted = true
				atLineStart = false
				continue
			}
		}
		if r == '/' && i+1 < n && runes[i+1] == '*' {
			current.WriteRune(r)
			current.WriteRune('*')
			i++
			blockCommentDepth = 1
			atLineStart = false
			continue
		}
		if r == '\'' {
			inSingleQuote = true
			singleQuoteEscape = rules.backslashEscapes
			if isPostgres && i > 0 && (runes[i-1] == 'e' || runes[i-1] == 'E') && (i == 1 || !isIdentChar(runes[i-2])) {
				singleQuoteEscape = true
			}
			stmtStarted = true
			current.WriteRune(r)
			atLineStart = false
			continue
		}
		if r == '"' {
			inDoubleQuote = true
			stmtStarted = true
			current.WriteRune(r)
			atLineStart = false
			continue
		}
		if r == '`' && rules.backtickIdent {
			inBacktick = true
			stmtStarted = true
			current.WriteRune(r)
			atLineStart = false
			continue
		}
		if r == '[' && rules.bracketIdent {
			inBracket = true
			stmtStarted = true
			current.WriteRune(r)
			atLineStart = false
			continue
		}
		// Track delimiter match (only split on ';' when not inside a compound BEGIN ... END block)
		// Checked before dollar-quoting so custom client delimiters like `DELIMITER $$` are recognized.
		isDefaultDelim := len(delim) == 1 && delim[0] == ';'
		if matchSliceAt(runes, i, delim) && (!isDefaultDelim || beginDepth == 0) {
			if rules.isOracle && isDefaultDelim && hadCompoundBody {
				current.WriteRune(';')
			}
			stmt := strings.TrimSpace(current.String())
			if stmt != "" {
				statements = append(statements, stmt)
			}
			current.Reset()
			resetStmtState()
			i += len(delim) - 1
			atLineStart = false
			continue
		}

		if r == '$' && rules.dollarQuote {
			if tag, ok := parseDollarTag(runes, i); ok {
				inDollarQuote = true
				dollarTag = tag
				stmtStarted = true
				for _, tr := range tag {
					current.WriteRune(tr)
				}
				i += len(tag) - 1
				atLineStart = false
				continue
			}
		}

		// Track identifiers for compound BEGIN ... END blocks
		if isIdentChar(r) && (i == 0 || !isIdentChar(runes[i-1])) {
			j := i
			for j < n && isIdentChar(runes[j]) && (isDefaultDelim || !matchSliceAt(runes, j, delim)) {
				j++
			}
			word := strings.ToUpper(string(runes[i:j]))

			if !stmtStarted {
				stmtStarted = true
				if word == "CREATE" {
					isCreateStmt = true
				}
			}

			if isCreateStmt && beginDepth == 0 && (word == "PROCEDURE" || word == "FUNCTION" || word == "TRIGGER" || word == "EVENT" ||
				(rules.isOracle && (word == "PACKAGE" || word == "TYPE"))) {
				pendingCompoundBody = true
			}

			if word == "BEGIN" {
				nextWord := peekNextWord(runes, j)
				isStandaloneTx := nextWord == ";" || nextWord == "" || nextWord == "TRANSACTION" || nextWord == "TRAN" || nextWord == "WORK" ||
					nextWord == "DISTRIBUTED" || nextWord == "DEFERRED" || nextWord == "IMMEDIATE" || nextWord == "EXCLUSIVE" ||
					(isPostgres && (nextWord == "ISOLATION" || nextWord == "READ" || nextWord == "DEFERRABLE" || nextWord == "NOT"))
				if pendingCompoundBody || beginDepth > 0 || !isStandaloneTx {
					beginDepth++
					hadCompoundBody = true
					pendingCompoundBody = false
				}
			} else if beginDepth > 0 {
				if word == "CASE" {
					caseDepth++
				} else if word == "END" {
					nextWord := peekNextWord(runes, j)
					if nextWord == "IF" || nextWord == "LOOP" || nextWord == "WHILE" || nextWord == "REPEAT" {
						// END IF / END LOOP / END WHILE / END REPEAT closes control flow, not BEGIN
					} else if nextWord == "CASE" {
						if caseDepth > 0 {
							caseDepth--
						}
					} else if caseDepth > 0 {
						caseDepth--
					} else {
						beginDepth--
					}
				}
			}

			current.WriteString(string(runes[i:j]))
			i = j - 1
			atLineStart = false
			continue
		}

		if !unicode.IsSpace(r) {
			stmtStarted = true
		}

		current.WriteRune(r)
		atLineStart = (r == '\n')
	}

	remaining := strings.TrimSpace(current.String())
	if remaining != "" {
		statements = append(statements, remaining)
	}

	return statements
}

// StripLeadingComments strips line and block comments from the start of a SQL statement.
func StripLeadingComments(sql string) string {
	s := strings.TrimSpace(sql)
	for {
		if strings.HasPrefix(s, "--") || strings.HasPrefix(s, "//") {
			if idx := strings.Index(s, "\n"); idx != -1 {
				s = strings.TrimSpace(s[idx+1:])
				continue
			}
			return ""
		}
		if strings.HasPrefix(s, "#") {
			if idx := strings.Index(s, "\n"); idx != -1 {
				s = strings.TrimSpace(s[idx+1:])
				continue
			}
			return ""
		}
		if strings.HasPrefix(s, "/*") {
			if idx := strings.Index(s, "*/"); idx != -1 {
				s = strings.TrimSpace(s[idx+2:])
				continue
			}
			return ""
		}
		break
	}
	return s
}

func hasLeadingKeyword(upper, kw string) bool {
	if !strings.HasPrefix(upper, kw) {
		return false
	}
	if len(upper) == len(kw) {
		return true
	}
	next := upper[len(kw)]
	return next == ' ' || next == '\t' || next == '\n' || next == '\r' || next == '('
}

// stripStringsAndComments replaces quoted literals, dollar-quoted strings, bracketed identifiers,
// and comments with spaces so keyword scanning does not match inside literal text.
func stripStringsAndComments(sql string) string {
	out, _ := sanitizeSQL(sql, "")
	return out
}

// sanitizeSQL is stripStringsAndComments with dialect-aware comment rules. The second result
// reports whether an executable comment ("/*!" or, on MariaDB, "/*M!") was found. Its body is
// kept in the output because the server executes it.
func sanitizeSQL(sql, dialect string) (string, bool) {
	out, hasExec, _ := sanitizeSQLFlags(sql, dialect)
	return out, hasExec
}

// sanitizeSQLFlags also reports whether any comment (executable or not) was present.
func sanitizeSQLFlags(sql, dialect string) (string, bool, bool) {
	rules := getSQLDialectRules(dialect)
	isMySQLFamily := rules.isMySQLFamily
	isMariaDB := rules.isMariaDB
	hasExecComment := false
	hasComment := false
	var out strings.Builder
	runes := []rune(sql)
	n := len(runes)
	var inSingle, singleEscape, inDouble, inBacktick, inBracket, inDollar, inLineComment, inBlockComment bool
	var dollarTag []rune

	for i := 0; i < n; i++ {
		r := runes[i]
		if inLineComment {
			if r == '\n' {
				inLineComment = false
				out.WriteRune('\n')
			} else {
				out.WriteRune(' ')
			}
			continue
		}
		if inBlockComment {
			if r == '*' && i+1 < n && runes[i+1] == '/' {
				inBlockComment = false
				i++
			}
			out.WriteRune(' ')
			continue
		}
		if inSingle {
			if singleEscape && r == '\\' && i+1 < n {
				i++
			} else if r == '\'' {
				if i+1 < n && runes[i+1] == '\'' {
					i++
				} else {
					inSingle = false
					singleEscape = false
				}
			}
			out.WriteRune(' ')
			continue
		}
		if inDouble {
			if rules.backslashEscapes && r == '\\' && i+1 < n {
				i++
			} else if r == '"' {
				if i+1 < n && runes[i+1] == '"' {
					i++
				} else {
					inDouble = false
				}
			}
			out.WriteRune(' ')
			continue
		}
		if inBacktick {
			if r == '`' {
				inBacktick = false
			}
			out.WriteRune(' ')
			continue
		}
		if inBracket {
			if r == ']' {
				if i+1 < n && runes[i+1] == ']' {
					i++
				} else {
					inBracket = false
				}
			}
			out.WriteRune(' ')
			continue
		}
		if inDollar {
			if matchSliceAt(runes, i, dollarTag) {
				i += len(dollarTag) - 1
				inDollar = false
			}
			out.WriteRune(' ')
			continue
		}

		if r == '-' && i+1 < n && runes[i+1] == '-' && (!isMySQLFamily || isMySQLDashComment(runes, i+2)) {
			inLineComment = true
			hasComment = true
			i++
			out.WriteRune(' ')
			continue
		}
		if r == '#' && rules.hashComment {
			inLineComment = true
			hasComment = true
			out.WriteRune(' ')
			continue
		}
		if isMySQLFamily {
			if l := executableCommentLen(runes, i, isMariaDB); l > 0 {
				hasExecComment = true
				hasComment = true
				i += l - 1
				out.WriteString(strings.Repeat(" ", l))
				continue
			}
		}
		if r == '/' && i+1 < n && runes[i+1] == '*' {
			inBlockComment = true
			hasComment = true
			i++
			out.WriteRune(' ')
			continue
		}
		if r == '\'' {
			inSingle = true
			singleEscape = rules.backslashEscapes
			if rules.isPostgres && i > 0 && (runes[i-1] == 'e' || runes[i-1] == 'E') && (i == 1 || !isIdentChar(runes[i-2])) {
				singleEscape = true
			}
			out.WriteRune(' ')
			continue
		}
		if r == '"' {
			inDouble = true
			out.WriteRune(' ')
			continue
		}
		if r == '`' && rules.backtickIdent {
			inBacktick = true
			out.WriteRune(' ')
			continue
		}
		if r == '[' && rules.bracketIdent {
			inBracket = true
			out.WriteRune(' ')
			continue
		}
		if r == '$' && rules.dollarQuote {
			if tag, ok := parseDollarTag(runes, i); ok {
				inDollar = true
				dollarTag = tag
				i += len(tag) - 1
				out.WriteRune(' ')
				continue
			}
		}
		out.WriteRune(r)
	}
	return out.String(), hasExecComment, hasComment
}

func containsStandaloneWord(upperSanitized string, targets ...string) bool {
	targetSet := make(map[string]struct{}, len(targets))
	for _, t := range targets {
		targetSet[t] = struct{}{}
	}
	runes := []rune(upperSanitized)
	n := len(runes)
	for i := 0; i < n; i++ {
		if isIdentChar(runes[i]) && (i == 0 || !isIdentChar(runes[i-1])) {
			j := i
			for j < n && isIdentChar(runes[j]) {
				j++
			}
			if _, ok := targetSet[string(runes[i:j])]; ok {
				return true
			}
			i = j - 1
		}
	}
	return false
}

// IsQueryReturningRows determines if a statement produces a result set (SELECT, SHOW, DESC, EXPLAIN, ANALYZE, PRAGMA, WITH, VALUES, RETURNING, etc.).
func IsQueryReturningRows(sql string) bool {
	clean := StripLeadingComments(sql)
	upper := strings.ToUpper(clean)
	if hasLeadingKeyword(upper, "SELECT") ||
		hasLeadingKeyword(upper, "SHOW") ||
		hasLeadingKeyword(upper, "DESCRIBE") ||
		hasLeadingKeyword(upper, "DESC") ||
		hasLeadingKeyword(upper, "EXPLAIN") ||
		hasLeadingKeyword(upper, "ANALYZE") ||
		hasLeadingKeyword(upper, "PRAGMA") ||
		hasLeadingKeyword(upper, "WITH") ||
		hasLeadingKeyword(upper, "VALUES") ||
		hasLeadingKeyword(upper, "TABLE") ||
		hasLeadingKeyword(upper, "FETCH") ||
		hasLeadingKeyword(upper, "EXISTS") ||
		hasLeadingKeyword(upper, "OPTIMIZE") ||
		hasLeadingKeyword(upper, "CHECK") ||
		hasLeadingKeyword(upper, "REPAIR") ||
		hasLeadingKeyword(upper, "EXEC") ||
		hasLeadingKeyword(upper, "EXECUTE") ||
		hasLeadingKeyword(upper, "CALL") {
		return true
	}
	sanitizedUpper := strings.ToUpper(stripStringsAndComments(clean))
	return containsStandaloneWord(sanitizedUpper, "RETURNING")
}

func hasUnsafeHTTPPathSegments(rawPath string) bool {
	if strings.Contains(rawPath, "\\") {
		return true
	}
	check := func(p string) bool {
		if strings.Contains(p, "\\") {
			return true
		}
		for _, seg := range strings.Split(strings.Trim(p, "/"), "/") {
			if seg == "." || seg == ".." {
				return true
			}
		}
		return false
	}
	if check(rawPath) {
		return true
	}
	if unescaped, err := url.PathUnescape(rawPath); err == nil {
		if check(unescaped) {
			return true
		}
	}
	return false
}

func isReadOnlyHTTPCommand(clean, dialect string) bool {
	fields := strings.Fields(clean)
	if len(fields) < 2 {
		return false
	}
	method := strings.ToUpper(fields[0])
	// Strip #fragment before ?query so URL fragments cannot spoof suffixes.
	rawTarget := strings.SplitN(fields[1], "#", 2)[0]
	path := strings.SplitN(rawTarget, "?", 2)[0]
	if !strings.HasPrefix(path, "/") {
		return false
	}
	if len(path) > 1 {
		path = strings.TrimRight(path, "/")
	}
	if hasUnsafeHTTPPathSegments(path) {
		return false
	}
	if method == "GET" || method == "HEAD" {
		return true
	}
	if method == "POST" {
		d := strings.ToLower(strings.TrimSpace(dialect))
		lowerPath := strings.ToLower(path)
		if (d == "qdrant" || d == "") && strings.HasPrefix(lowerPath, "/collections/") {
			rest := strings.TrimPrefix(lowerPath, "/collections/")
			collSeg, actionSeg, hasAction := strings.Cut(rest, "/")
			if collSeg != "" && collSeg != "." && collSeg != ".." && hasAction {
				actionPath := "/" + actionSeg
				switch actionPath {
				case "/points/search",
					"/points/search/batch",
					"/points/search/groups",
					"/points/scroll",
					"/points/query",
					"/points/query/batch",
					"/points/query/groups",
					"/points/count",
					"/points/recommend",
					"/points/recommend/batch",
					"/points/recommend/groups",
					"/points/discover",
					"/points/discover/batch",
					"/points/discover/groups",
					"/points/search/matrix/pairs",
					"/points/search/matrix/offsets",
					"/facet",
					"/points":
					return true
				}
			}
		}
		if d == "elasticsearch" || d == "es" || d == "" {
			switch lowerPath {
			case "/_sql",
				"/_sql/translate",
				"/_plugins/_sql",
				"/_plugins/_sql/_explain",
				"/_query",
				"/_search",
				"/_msearch",
				"/_mget",
				"/_count",
				"/_analyze",
				"/_field_caps",
				"/_search/template",
				"/_msearch/template",
				"/_rank_eval":
				return true
			}
			segs := strings.Split(strings.Trim(lowerPath, "/"), "/")
			if len(segs) >= 2 && segs[0] != "" {
				switch segs[0] {
				case "_doc", "_create", "_update", "_bulk", "_reindex", "_delete_by_query", "_update_by_query":
					return false
				}
			}
			if len(segs) == 2 {
				switch segs[1] {
				case "_search", "_msearch", "_mget", "_count", "_analyze", "_field_caps", "_terms_enum", "_rank_eval", "_explain":
					return true
				}
			} else if len(segs) == 3 {
				if (segs[1] == "_validate" && segs[2] == "query") ||
					(segs[1] == "_search" && segs[2] == "template") ||
					(segs[1] == "_msearch" && segs[2] == "template") ||
					(segs[1] == "_explain" && segs[2] != "") {
					return true
				}
			}
		}
	}
	return false
}

// IsReadOnlySafeQuery verifies that a SQL statement only performs read operations
// and does not contain data-modifying CTEs (e.g., WITH ... DELETE) or DML/DDL statements.
func IsReadOnlySafeQuery(sql string) bool {
	return IsReadOnlySafeQueryForDialect(sql, "")
}

// IsReadOnlySafeQueryForDialect is IsReadOnlySafeQuery using the comment rules of the target
// server. For MySQL and MariaDB it rejects any statement containing an executable comment,
// because the server runs its body even though a generic parser sees only a comment.
func IsReadOnlySafeQueryForDialect(sql, dialect string) bool {
	d := strings.ToLower(strings.TrimSpace(dialect))
	if d == "redis" {
		return IsReadOnlySafeRedisQuery(sql)
	}
	if d == "mongodb" || d == "mongo" {
		return IsReadOnlySafeMongoQuery(sql)
	}
	if isMySQLFamily, _ := dialectFlags(d); isMySQLFamily {
		if _, hasExec := sanitizeSQL(sql, d); hasExec {
			return false
		}
	}
	clean := StripLeadingComments(sql)
	isHTTPDialect := d == "qdrant" || d == "elasticsearch" || d == "es" || d == ""
	if isHTTPDialect && isReadOnlyHTTPCommand(clean, d) {
		return true
	}
	if d == "qdrant" {
		// Qdrant also accepts pseudo-SQL SELECT/SHOW queries; non-HTTP queries must pass SQL checks below.
	}
	upper := strings.ToUpper(clean)
	isAnalyzeSelect := false
	if hasLeadingKeyword(upper, "ANALYZE") {
		rest := strings.TrimSpace(upper[len("ANALYZE"):])
		isAnalyzeSelect = strings.HasPrefix(rest, "SELECT") || strings.HasPrefix(rest, "FORMAT")
	}
	isESDialect := d == "elasticsearch" || d == "es" || d == ""
	isReadLeading := hasLeadingKeyword(upper, "SELECT") ||
		hasLeadingKeyword(upper, "SHOW") ||
		hasLeadingKeyword(upper, "DESCRIBE") ||
		hasLeadingKeyword(upper, "DESC") ||
		hasLeadingKeyword(upper, "EXPLAIN") ||
		isAnalyzeSelect ||
		hasLeadingKeyword(upper, "PRAGMA") ||
		hasLeadingKeyword(upper, "WITH") ||
		hasLeadingKeyword(upper, "VALUES") ||
		hasLeadingKeyword(upper, "TABLE") ||
		hasLeadingKeyword(upper, "EXISTS") ||
		hasLeadingKeyword(upper, "CHECK") ||
		(isESDialect && ((hasLeadingKeyword(upper, "FROM") && strings.Contains(clean, "|")) || hasLeadingKeyword(upper, "ROW")))
	if !isReadLeading {
		return false
	}
	sanitized, _ := sanitizeSQL(clean, d)
	sanitizedUpper := strings.ToUpper(sanitized)
	if hasLeadingKeyword(upper, "PRAGMA") {
		if strings.Contains(sanitizedUpper, "=") || containsStandaloneWord(sanitizedUpper,
			"WAL_CHECKPOINT", "OPTIMIZE", "INCREMENTAL_VACUUM", "SHRINK_MEMORY", "WRITABLE_SCHEMA",
		) {
			return false
		}
	}
	if containsStandaloneWord(sanitizedUpper,
		"INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
		"TRUNCATE", "MERGE", "GRANT", "REVOKE",
		"SYSTEM", "KILL", "OPTIMIZE", "ATTACH", "DETACH",
		"EXCHANGE", "RENAME", "BACKUP", "RESTORE", "SET",
		"VACUUM", "REINDEX", "CLUSTER", "REFRESH", "COPY",
		"INTO", "EXEC", "EXECUTE", "DBCC", "SHUTDOWN",
		"CALL", "LOAD", "IMPORT", "EXPORT",
		"SET_CONFIG", "NEXTVAL", "PG_TERMINATE_BACKEND", "PG_CANCEL_BACKEND", "PG_RELOAD_CONF",
		"PG_ROTATE_LOGFILE", "SETVAL", "LO_UNLINK", "LO_EXPORT", "LO_IMPORT",
		"LO_FROM_BYTEA", "LO_PUT", "LO_TRUNCATE",
		"PG_CREATE_RESTORE_POINT", "PG_FILE_WRITE", "PG_FILE_UNLINK", "PG_FILE_RENAME",
		"PG_DROP_REPLICATION_SLOT", "PG_CREATE_PHYSICAL_REPLICATION_SLOT",
		"PG_CREATE_LOGICAL_REPLICATION_SLOT", "PG_REPLICATION_SLOT_ADVANCE",
		"PG_SWITCH_WAL", "PG_START_BACKUP", "PG_STOP_BACKUP", "PG_BACKUP_START", "PG_BACKUP_STOP",
	) {
		return false
	}
	// Block SELECT ... INTO OUTFILE / INTO DUMPFILE
	if containsStandaloneWord(sanitizedUpper, "OUTFILE") || containsStandaloneWord(sanitizedUpper, "DUMPFILE") {
		return false
	}
	return true
}

// TruncateSQL shortens a SQL string for display in log messages.
func TruncateSQL(sql string, maxLen int) string {
	clean := strings.ReplaceAll(strings.TrimSpace(sql), "\n", " ")
	if len(clean) > maxLen {
		return clean[:maxLen] + "..."
	}
	return clean
}

func isHTTPMethodLine(trimmed string) bool {
	fields := strings.Fields(trimmed)
	if len(fields) < 2 {
		return false
	}
	switch strings.ToUpper(fields[0]) {
	case "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD":
		return strings.HasPrefix(fields[1], "/")
	default:
		return false
	}
}

func isSQLStartLine(trimmed string) bool {
	upper := strings.ToUpper(trimmed)
	return hasLeadingKeyword(upper, "SELECT") ||
		hasLeadingKeyword(upper, "SHOW") ||
		hasLeadingKeyword(upper, "TRUNCATE") ||
		hasLeadingKeyword(upper, "DELETE") ||
		hasLeadingKeyword(upper, "FROM")
}

// SplitHTTPOrSQLStatements splits a script containing REST commands (GET/POST/PUT/DELETE/PATCH /...)
// and/or pseudo-SQL statements separated by semicolons or top-level HTTP method lines.
func SplitHTTPOrSQLStatements(raw string) []string {
	lines := strings.Split(raw, "\n")
	var stmts []string
	var cur strings.Builder
	hasNonComment := false
	curIsREST := false
	inSingle := false
	inDouble := false
	braceDepth := 0
	bracketDepth := 0

	flush := func() {
		s := strings.TrimSpace(cur.String())
		s = strings.TrimRight(s, "; \t\r\n")
		if strings.TrimSpace(StripLeadingComments(s)) != "" {
			stmts = append(stmts, s)
		}
		cur.Reset()
		hasNonComment = false
		curIsREST = false
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		isCommentLine := trimmed == "" || strings.HasPrefix(trimmed, "--") || strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "#")

		if !inSingle && !inDouble && braceDepth == 0 && bracketDepth == 0 && hasNonComment {
			if isHTTPMethodLine(trimmed) || (curIsREST && isSQLStartLine(trimmed)) {
				flush()
			}
		}

		if isCommentLine {
			// Do not append trailing comments onto a completed REST command's JSON body,
			// and never scan comment text for quotes/braces.
			if !curIsREST || braceDepth > 0 || bracketDepth > 0 {
				cur.WriteString(line)
				cur.WriteByte('\n')
			}
			continue
		}

		if !hasNonComment {
			hasNonComment = true
			if isHTTPMethodLine(trimmed) {
				curIsREST = true
			}
		}

		for i := 0; i < len(line); i++ {
			ch := line[i]
			if ch == '\\' && (inSingle || inDouble) && i+1 < len(line) {
				cur.WriteByte(ch)
				i++
				cur.WriteByte(line[i])
				continue
			}
			if ch == '\'' && !inDouble {
				inSingle = !inSingle
			} else if ch == '"' && !inSingle {
				inDouble = !inDouble
			} else if !inSingle && !inDouble {
				switch ch {
				case '{':
					braceDepth++
				case '}':
					if braceDepth > 0 {
						braceDepth--
					}
				case '[':
					bracketDepth++
				case ']':
					if bracketDepth > 0 {
						bracketDepth--
					}
				case ';':
					if braceDepth == 0 && bracketDepth == 0 && !curIsREST {
						flush()
						continue
					}
				}
			}
			cur.WriteByte(ch)
		}
		cur.WriteByte('\n')
	}
	flush()
	return stmts
}

// SplitMongoStatements splits a MongoDB shell script into individual statements,
// respecting JS/MQL strings (' " `), comments (// and /* */), and (), {}, [] nesting.
func SplitMongoStatements(raw string) []string {
	var stmts []string
	var cur strings.Builder
	n := len(raw)
	i := 0
	depthParen := 0
	depthBrace := 0
	depthBracket := 0
	inSingle := false
	inDouble := false
	inBacktick := false
	escaped := false

	flush := func() {
		s := strings.TrimSpace(cur.String())
		cur.Reset()
		if s != "" && strings.TrimSpace(StripLeadingComments(s)) != "" {
			stmts = append(stmts, s)
		}
	}

	nextIsDot := func(idx int) bool {
		for idx < n {
			c := raw[idx]
			if c == ' ' || c == '\t' || c == '\r' || c == '\n' {
				idx++
				continue
			}
			return c == '.'
		}
		return false
	}

	for i < n {
		ch := raw[i]
		if escaped {
			cur.WriteByte(ch)
			escaped = false
			i++
			continue
		}
		if (inSingle || inDouble || inBacktick) && ch == '\\' {
			cur.WriteByte(ch)
			escaped = true
			i++
			continue
		}
		if ch == '\'' && !inDouble && !inBacktick {
			inSingle = !inSingle
			cur.WriteByte(ch)
			i++
			continue
		}
		if ch == '"' && !inSingle && !inBacktick {
			inDouble = !inDouble
			cur.WriteByte(ch)
			i++
			continue
		}
		if ch == '`' && !inSingle && !inDouble {
			inBacktick = !inBacktick
			cur.WriteByte(ch)
			i++
			continue
		}
		if inSingle || inDouble || inBacktick {
			cur.WriteByte(ch)
			i++
			continue
		}
		if ch == '/' && i+1 < n && raw[i+1] == '/' {
			for i < n && raw[i] != '\n' {
				i++
			}
			continue
		}
		if ch == '/' && i+1 < n && raw[i+1] == '*' {
			i += 2
			for i+1 < n && !(raw[i] == '*' && raw[i+1] == '/') {
				i++
			}
			if i+1 < n {
				i += 2
			}
			continue
		}

		switch ch {
		case '(':
			depthParen++
			cur.WriteByte(ch)
		case ')':
			if depthParen > 0 {
				depthParen--
			}
			cur.WriteByte(ch)
		case '{':
			depthBrace++
			cur.WriteByte(ch)
		case '}':
			if depthBrace > 0 {
				depthBrace--
			}
			cur.WriteByte(ch)
		case '[':
			depthBracket++
			cur.WriteByte(ch)
		case ']':
			if depthBracket > 0 {
				depthBracket--
			}
			cur.WriteByte(ch)
		case ';':
			if depthParen == 0 && depthBrace == 0 && depthBracket == 0 {
				flush()
			} else {
				cur.WriteByte(ch)
			}
		case '\n':
			if depthParen == 0 && depthBrace == 0 && depthBracket == 0 {
				trimmed := strings.TrimSpace(cur.String())
				lower := strings.ToLower(trimmed)
				if strings.HasPrefix(lower, "use ") || strings.HasPrefix(lower, "show ") {
					flush()
				} else if trimmed != "" && !strings.HasSuffix(trimmed, ".") && !nextIsDot(i+1) {
					flush()
				} else {
					cur.WriteByte(ch)
				}
			} else {
				cur.WriteByte(ch)
			}
		default:
			cur.WriteByte(ch)
		}
		i++
	}
	flush()
	return stmts
}

func sanitizeMongoJS(raw string) string {
	var out strings.Builder
	n := len(raw)
	i := 0
	inSingle := false
	inDouble := false
	inBacktick := false
	escaped := false

	for i < n {
		ch := raw[i]
		if escaped {
			out.WriteByte(' ')
			escaped = false
			i++
			continue
		}
		if (inSingle || inDouble || inBacktick) && ch == '\\' {
			out.WriteByte(' ')
			escaped = true
			i++
			continue
		}
		if ch == '\'' && !inDouble && !inBacktick {
			inSingle = !inSingle
			out.WriteByte(' ')
			i++
			continue
		}
		if ch == '"' && !inSingle && !inBacktick {
			inDouble = !inDouble
			out.WriteByte(' ')
			i++
			continue
		}
		if ch == '`' && !inSingle && !inDouble {
			inBacktick = !inBacktick
			out.WriteByte(' ')
			i++
			continue
		}
		if inSingle || inDouble || inBacktick {
			out.WriteByte(' ')
			i++
			continue
		}
		if ch == '/' && i+1 < n && raw[i+1] == '/' {
			for i < n && raw[i] != '\n' {
				out.WriteByte(' ')
				i++
			}
			continue
		}
		if ch == '/' && i+1 < n && raw[i+1] == '*' {
			out.WriteString("  ")
			i += 2
			for i+1 < n && !(raw[i] == '*' && raw[i+1] == '/') {
				out.WriteByte(' ')
				i++
			}
			if i+1 < n {
				out.WriteString("  ")
				i += 2
			}
			continue
		}
		out.WriteByte(ch)
		i++
	}
	return out.String()
}

func hasMongoMethod(sanitizedLower, method string) bool {
	needle := "." + method
	idx := 0
	for {
		pos := strings.Index(sanitizedLower[idx:], needle)
		if pos == -1 {
			return false
		}
		after := idx + pos + len(needle)
		if after == len(sanitizedLower) {
			return true
		}
		next := sanitizedLower[after]
		if next == '(' || next == '.' || next == ';' || next == ' ' || next == '\t' || next == '\n' || next == '\r' {
			return true
		}
		idx = idx + pos + 1
	}
}

func extractMongoCommandKey(clean string) string {
	s := strings.TrimSpace(clean)
	lower := strings.ToLower(s)
	if strings.HasPrefix(lower, "db.runcommand") {
		s = strings.TrimSpace(s[len("db.runcommand"):])
		if !strings.HasPrefix(s, "(") {
			return ""
		}
		s = strings.TrimSpace(s[1:])
	} else if strings.HasPrefix(lower, "db.admincommand") {
		s = strings.TrimSpace(s[len("db.admincommand"):])
		if !strings.HasPrefix(s, "(") {
			return ""
		}
		s = strings.TrimSpace(s[1:])
	}
	if !strings.HasPrefix(s, "{") {
		return ""
	}
	s = strings.TrimSpace(s[1:])
	if len(s) == 0 {
		return ""
	}
	if s[0] == '"' || s[0] == '\'' {
		quote := s[0]
		end := 1
		for end < len(s) {
			if s[end] == '\\' && end+1 < len(s) {
				end += 2
				continue
			}
			if s[end] == quote {
				return strings.ToLower(s[1:end])
			}
			end++
		}
		return ""
	}
	end := 0
	for end < len(s) {
		c := s[end]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '$' {
			end++
		} else {
			break
		}
	}
	return strings.ToLower(s[:end])
}

// IsReadOnlySafeMongoQuery checks whether a MongoDB shell statement or pseudo-SQL query
// is safe to execute on a Read-Only connection.
func IsReadOnlySafeMongoQuery(stmt string) bool {
	clean := strings.TrimSpace(StripLeadingComments(stmt))
	if clean == "" {
		return true
	}
	lower := strings.ToLower(clean)

	// Allow read-only pseudo-SQL SELECT
	if strings.HasPrefix(lower, "select ") || strings.HasPrefix(lower, "select\n") || strings.HasPrefix(lower, "select\t") {
		return IsReadOnlySafeQueryForDialect(clean, "postgres")
	}

	// Shell navigation and inspection
	if strings.HasPrefix(lower, "use ") || strings.HasPrefix(lower, "show ") || lower == "db" {
		return true
	}

	// Replica set / sharding status
	if strings.HasPrefix(lower, "rs.status") || strings.HasPrefix(lower, "rs.conf") ||
		strings.HasPrefix(lower, "rs.ismaster") || strings.HasPrefix(lower, "rs.hello") ||
		strings.HasPrefix(lower, "sh.status") {
		return true
	}

	sanitizedLower := strings.ToLower(sanitizeMongoJS(clean))

	// Explicitly block mutating collection/db methods (whitespace-tolerant before '(' or bare property)
	for _, writeMethod := range []string{
		"insertone", "insertmany", "insert",
		"updateone", "updatemany", "update",
		"replaceone", "findoneandupdate", "findoneandreplace", "findoneanddelete",
		"deleteone", "deletemany", "remove",
		"drop", "dropdatabase", "createcollection", "createview",
		"createindex", "dropindex", "dropindexes", "hideindex", "unhideindex",
		"renamecollection", "bulkwrite",
		"createuser", "updateuser", "dropuser", "createrole", "droprole",
		"killop",
	} {
		if hasMongoMethod(sanitizedLower, writeMethod) {
			return false
		}
	}

	// Aggregate is read-only unless it uses $out or $merge (strip backslashes so "\$out" cannot bypass)
	if hasMongoMethod(sanitizedLower, "aggregate") {
		noEscapeLower := strings.ReplaceAll(lower, "\\", "")
		if strings.Contains(noEscapeLower, "$out") || strings.Contains(noEscapeLower, "$merge") {
			return false
		}
		return true
	}

	// Known read-only collection/db methods
	for _, readMethod := range []string{
		"find", "findone", "countdocuments", "estimateddocumentcount",
		"count", "distinct", "getindexes", "stats", "validate",
		"getcollectionnames", "getcollectioninfos", "version",
		"serverstatus", "currentop", "listcommands",
		"getusers", "getroles", "getname",
	} {
		if hasMongoMethod(sanitizedLower, readMethod) {
			return true
		}
	}

	// Raw command or runCommand: allow only if the first command key is a known safe read command
	trimmedSanitized := strings.TrimSpace(sanitizedLower)
	if strings.HasPrefix(trimmedSanitized, "db.runcommand") || strings.HasPrefix(trimmedSanitized, "db.admincommand") || strings.HasPrefix(trimmedSanitized, "{") {
		cmdKey := extractMongoCommandKey(clean)
		switch cmdKey {
		case "ping", "hello", "ismaster", "buildinfo", "serverstatus", "dbstats",
			"collstats", "listcollections", "listdatabases", "listindexes",
			"usersinfo", "rolesinfo", "explain", "count", "distinct", "find",
			"replsetgetstatus", "replsetgetconfig", "listshards", "listcommands":
			return true
		}
		return false
	}

	return false
}

// SplitRedisStatements splits a Redis script by newlines and unquoted semicolons, skipping # and -- comment lines.
func SplitRedisStatements(raw string) []string {
	var stmts []string
	var cur strings.Builder
	inSingle := false
	inDouble := false
	escaped := false

	flush := func() {
		s := strings.TrimSpace(cur.String())
		cur.Reset()
		if s == "" || strings.HasPrefix(s, "#") || strings.HasPrefix(s, "--") {
			return
		}
		stmts = append(stmts, s)
	}

	runes := []rune(raw)
	for i := 0; i < len(runes); i++ {
		r := runes[i]
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
		if r == '\'' && !inDouble {
			inSingle = !inSingle
			cur.WriteRune(r)
			continue
		}
		if r == '"' && !inSingle {
			inDouble = !inDouble
			cur.WriteRune(r)
			continue
		}
		if !inSingle && !inDouble && (r == '\n' || r == '\r' || r == ';') {
			flush()
			continue
		}
		cur.WriteRune(r)
	}
	flush()
	return stmts
}

func parseRedisArgsForCheck(cmdStr string) []string {
	var args []string
	var current strings.Builder
	inQuote := false
	hadQuote := false
	var quoteChar rune

	runes := []rune(cmdStr)
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		if inQuote {
			if r == quoteChar {
				inQuote = false
			} else if r == '\\' && i+1 < len(runes) {
				i++
				current.WriteRune(runes[i])
			} else {
				current.WriteRune(r)
			}
		} else {
			if r == '"' || r == '\'' {
				inQuote = true
				hadQuote = true
				quoteChar = r
			} else if r == ' ' || r == '\t' {
				if current.Len() > 0 || hadQuote {
					args = append(args, current.String())
					current.Reset()
					hadQuote = false
				}
			} else {
				current.WriteRune(r)
			}
		}
	}
	if current.Len() > 0 || hadQuote {
		args = append(args, current.String())
	}
	return args
}

// IsReadOnlySafeRedisQuery verifies that a Redis command or pseudo-SQL SELECT is read-only.
func IsReadOnlySafeRedisQuery(stmt string) bool {
	clean := strings.TrimSpace(StripLeadingComments(stmt))
	if clean == "" {
		return true
	}
	upper := strings.ToUpper(clean)
	// Allow pseudo-SQL SELECT * / SELECT COUNT(*) FROM ...
	if hasLeadingKeyword(upper, "SELECT") {
		fields := strings.Fields(upper)
		if len(fields) >= 4 && (fields[1] == "*" || fields[1] == "COUNT(*)") && fields[2] == "FROM" {
			return !strings.ContainsAny(clean, "\n\r")
		}
		// Redis native SELECT <db>
		if len(fields) == 2 {
			return true
		}
		return false
	}

	args := parseRedisArgsForCheck(clean)
	if len(args) == 0 {
		return true
	}
	cmd := strings.ToUpper(args[0])
	switch cmd {
	case "PING", "ECHO", "INFO", "DBSIZE", "TIME", "LASTSAVE", "LOLWUT", "HELLO",
		"COMMAND", "OBJECT",
		"EXISTS", "TYPE", "TTL", "PTTL", "EXPIRETIME", "PEXPIRETIME", "KEYS", "SCAN", "RANDOMKEY", "DUMP",
		"GET", "MGET", "GETRANGE", "STRLEN", "GETBIT", "BITCOUNT", "BITPOS", "LCS",
		"HGET", "HMGET", "HGETALL", "HKEYS", "HVALS", "HLEN", "HEXISTS", "HSTRLEN", "HSCAN", "HRANDFIELD",
		"LINDEX", "LLEN", "LRANGE", "LPOS",
		"SCARD", "SISMEMBER", "SMISMEMBER", "SMEMBERS", "SRANDMEMBER", "SSCAN", "SINTER", "SINTERCARD", "SUNION", "SDIFF",
		"ZCARD", "ZCOUNT", "ZLEXCOUNT", "ZRANGE", "ZRANGEBYSCORE", "ZRANGEBYLEX", "ZREVRANGE", "ZREVRANGEBYSCORE", "ZREVRANGEBYLEX", "ZRANK", "ZREVRANK", "ZSCORE", "ZMSCORE", "ZSCAN", "ZRANDMEMBER",
		"XLEN", "XRANGE", "XREVRANGE", "XREAD", "XINFO", "XPENDING",
		"PFCOUNT",
		"GEODIST", "GEOHASH", "GEOPOS", "GEORADIUS_RO", "GEORADIUSBYMEMBER_RO", "GEOSEARCH",
		"JSON.GET", "JSON.MGET", "JSON.TYPE", "JSON.STRLEN", "JSON.OBJLEN", "JSON.OBJKEYS", "JSON.ARRLEN", "JSON.ARRINDEX",
		"FT.SEARCH", "FT.AGGREGATE", "FT.INFO", "FT._LIST", "FT.EXPLAIN", "FT.EXPLAINCLI", "FT.PROFILE", "FT.TAGVALS", "FT.SUGGET", "FT.SUGLEN", "FT.SYNDUMP", "FT.SPELLCHECK", "FT.DICTUMP":
		return true
	case "CONFIG", "FT.CONFIG":
		return len(args) >= 2 && strings.EqualFold(args[1], "GET")
	case "CLIENT":
		if len(args) < 2 {
			return false
		}
		switch strings.ToUpper(args[1]) {
		case "LIST", "INFO", "GETNAME", "ID", "TRACKINGINFO":
			return true
		}
		return false
	case "MEMORY":
		if len(args) < 2 {
			return false
		}
		switch strings.ToUpper(args[1]) {
		case "USAGE", "STATS", "DOCTOR", "MALLOC-STATS":
			return true
		}
		return false
	case "SLOWLOG":
		if len(args) < 2 {
			return false
		}
		switch strings.ToUpper(args[1]) {
		case "GET", "LEN":
			return true
		}
		return false
	case "LATENCY":
		if len(args) < 2 {
			return false
		}
		switch strings.ToUpper(args[1]) {
		case "LATEST", "HISTORY", "GRAPH", "DOCTOR":
			return true
		}
		return false
	case "ACL":
		if len(args) < 2 {
			return false
		}
		switch strings.ToUpper(args[1]) {
		case "LIST", "USERS", "GETUSER", "WHOAMI", "CAT", "LOG", "HELP":
			return true
		}
		return false
	case "CLUSTER":
		if len(args) < 2 {
			return false
		}
		switch strings.ToUpper(args[1]) {
		case "INFO", "NODES", "SLOTS", "SHARDS", "KEYSLOT", "COUNTKEYSINSLOT", "GETKEYSINSLOT":
			return true
		}
		return false
	case "MODULE":
		return len(args) >= 2 && strings.EqualFold(args[1], "LIST")
	}
	return false
}

// ValidateReadOnlyScript splits a script using the appropriate driver splitter and checks every
// statement for read-only safety. Returns the first unsafe statement and false if blocked.
func ValidateReadOnlyScript(script, dialect string) (string, bool) {
	d := strings.ToLower(strings.TrimSpace(dialect))
	var statements []string
	switch d {
	case "qdrant", "elasticsearch", "es":
		statements = SplitHTTPOrSQLStatements(script)
	case "mongodb", "mongo":
		statements = SplitMongoStatements(script)
	case "redis":
		// Preserve single pseudo-SQL SELECT * / SELECT COUNT(*) FROM ... queries
		trimmed := strings.TrimSpace(script)
		upper := strings.ToUpper(trimmed)
		if (hasLeadingKeyword(upper, "SELECT") && strings.Contains(upper, " FROM ")) && !strings.ContainsAny(trimmed, "\n\r") {
			statements = []string{trimmed}
		} else {
			statements = SplitRedisStatements(script)
		}
	default:
		statements = SplitStatementsForDialect(script, d)
	}
	for _, stmt := range statements {
		var isSafe bool
		switch d {
		case "mongodb", "mongo":
			isSafe = IsReadOnlySafeMongoQuery(stmt)
		case "redis":
			isSafe = IsReadOnlySafeRedisQuery(stmt)
		default:
			isSafe = IsReadOnlySafeQueryForDialect(stmt, d)
		}
		if !isSafe {
			return stmt, false
		}
	}
	return "", true
}
