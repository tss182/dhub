package driver

import (
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
	isPostgres := strings.EqualFold(strings.TrimSpace(dialect), "postgres")
	isMySQLFamily, isMariaDB := dialectFlags(dialect)
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
	var beginDepth int
	var caseDepth int

	resetStmtState := func() {
		stmtStarted = false
		isCreateStmt = false
		pendingCompoundBody = false
		beginDepth = 0
		caseDepth = 0
	}

	for i := 0; i < n; i++ {
		r := runes[i]

		// Handle client DELIMITER directive at line start when not inside quotes/comments
		if atLineStart && !inSingleQuote && !inDoubleQuote && !inBacktick && !inBracket && !inDollarQuote && !inLineComment && blockCommentDepth == 0 {
			if newDelim, nextIdx, ok := parseDelimiterLine(runes, i); ok {
				delim = []rune(newDelim)
				i = nextIdx - 1
				atLineStart = true
				continue
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
			if !isPostgres && r == '\\' && i+1 < n {
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
		if r == '#' && !isPostgres {
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
			singleQuoteEscape = !isPostgres
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
		if r == '`' && !isPostgres {
			inBacktick = true
			stmtStarted = true
			current.WriteRune(r)
			atLineStart = false
			continue
		}
		if r == '[' && !isPostgres {
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

		if r == '$' {
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

			if isCreateStmt && beginDepth == 0 && (word == "PROCEDURE" || word == "FUNCTION" || word == "TRIGGER" || word == "EVENT") {
				pendingCompoundBody = true
			}

			if word == "BEGIN" {
				nextWord := peekNextWord(runes, j)
				isStandaloneTx := nextWord == ";" || nextWord == "" || nextWord == "TRANSACTION" || nextWord == "WORK" ||
					(isPostgres && (nextWord == "ISOLATION" || nextWord == "READ" || nextWord == "DEFERRABLE" || nextWord == "NOT"))
				if pendingCompoundBody || beginDepth > 0 || !isStandaloneTx {
					beginDepth++
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
	isMySQLFamily, isMariaDB := dialectFlags(dialect)
	hasExecComment := false
	hasComment := false
	var out strings.Builder
	runes := []rune(sql)
	n := len(runes)
	var inSingle, inDouble, inBacktick, inBracket, inDollar, inLineComment, inBlockComment bool
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
			if r == '\\' && i+1 < n {
				i++
			} else if r == '\'' {
				if i+1 < n && runes[i+1] == '\'' {
					i++
				} else {
					inSingle = false
				}
			}
			out.WriteRune(' ')
			continue
		}
		if inDouble {
			if r == '\\' && i+1 < n {
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
		if r == '#' {
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
			out.WriteRune(' ')
			continue
		}
		if r == '"' {
			inDouble = true
			out.WriteRune(' ')
			continue
		}
		if r == '`' {
			inBacktick = true
			out.WriteRune(' ')
			continue
		}
		if r == '[' {
			inBracket = true
			out.WriteRune(' ')
			continue
		}
		if r == '$' {
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

func isReadOnlyHTTPCommand(clean string) bool {
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
	if method == "GET" || method == "HEAD" {
		return true
	}
	if method == "POST" {
		lowerPath := strings.ToLower(path)
		if strings.HasPrefix(lowerPath, "/collections/") {
			rest := strings.TrimPrefix(lowerPath, "/collections/")
			collSeg, actionSeg, hasAction := strings.Cut(rest, "/")
			if collSeg != "" && hasAction {
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
		if lowerPath == "/_sql" ||
			lowerPath == "/_sql/translate" ||
			lowerPath == "/_plugins/_sql" ||
			lowerPath == "/_plugins/_sql/_explain" ||
			lowerPath == "/_query" ||
			lowerPath == "/_search" ||
			lowerPath == "/_msearch" ||
			lowerPath == "/_mget" ||
			lowerPath == "/_count" ||
			lowerPath == "/_analyze" ||
			lowerPath == "/_field_caps" ||
			lowerPath == "/_search/template" ||
			lowerPath == "/_msearch/template" ||
			lowerPath == "/_rank_eval" ||
			strings.HasSuffix(lowerPath, "/_search") ||
			strings.HasSuffix(lowerPath, "/_msearch") ||
			strings.HasSuffix(lowerPath, "/_mget") ||
			strings.HasSuffix(lowerPath, "/_count") ||
			strings.HasSuffix(lowerPath, "/_analyze") ||
			strings.HasSuffix(lowerPath, "/_validate/query") ||
			strings.HasSuffix(lowerPath, "/_field_caps") ||
			strings.HasSuffix(lowerPath, "/_terms_enum") ||
			strings.HasSuffix(lowerPath, "/_search/template") ||
			strings.HasSuffix(lowerPath, "/_msearch/template") ||
			strings.HasSuffix(lowerPath, "/_rank_eval") ||
			strings.HasSuffix(lowerPath, "/_explain") ||
			strings.Contains(lowerPath, "/_explain/") {
			return true
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
	if isMySQLFamily, _ := dialectFlags(dialect); isMySQLFamily {
		if _, hasExec := sanitizeSQL(sql, dialect); hasExec {
			return false
		}
	}
	clean := StripLeadingComments(sql)
	if isReadOnlyHTTPCommand(clean) {
		return true
	}
	upper := strings.ToUpper(clean)
	isAnalyzeSelect := false
	if hasLeadingKeyword(upper, "ANALYZE") {
		rest := strings.TrimSpace(upper[len("ANALYZE"):])
		isAnalyzeSelect = strings.HasPrefix(rest, "SELECT") || strings.HasPrefix(rest, "FORMAT")
	}
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
		(hasLeadingKeyword(upper, "FROM") && strings.Contains(clean, "|")) ||
		hasLeadingKeyword(upper, "ROW")
	if !isReadLeading {
		return false
	}
	sanitized, _ := sanitizeSQL(clean, dialect)
	sanitizedUpper := strings.ToUpper(sanitized)
	if containsStandaloneWord(sanitizedUpper,
		"INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
		"TRUNCATE", "MERGE", "GRANT", "REVOKE",
		"SYSTEM", "KILL", "OPTIMIZE", "ATTACH", "DETACH",
		"EXCHANGE", "RENAME", "BACKUP", "RESTORE", "SET",
		"VACUUM", "REINDEX", "CLUSTER", "REFRESH", "COPY",
		"PG_TERMINATE_BACKEND", "PG_CANCEL_BACKEND", "PG_RELOAD_CONF",
		"PG_ROTATE_LOGFILE", "SETVAL", "LO_UNLINK", "LO_EXPORT", "LO_IMPORT",
		"PG_CREATE_RESTORE_POINT",
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
		return IsReadOnlySafeQuery(clean)
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

	// Explicitly block mutating collection/db methods
	for _, writePattern := range []string{
		".insertone(", ".insertmany(", ".insert(",
		".updateone(", ".updatemany(", ".update(",
		".replaceone(", ".findoneandupdate(", ".findoneandreplace(", ".findoneanddelete(",
		".deleteone(", ".deletemany(", ".remove(",
		".drop(", ".dropdatabase(", ".createcollection(", ".createview(",
		".createindex(", ".dropindex(", ".dropindexes(", ".hideindex(", ".unhideindex(",
		".renamecollection(", ".bulkwrite(",
		".createuser(", ".updateuser(", ".dropuser(", ".createrole(", ".droprole(",
		".killop(",
	} {
		if strings.Contains(lower, writePattern) {
			return false
		}
	}

	// Aggregate is read-only unless it uses $out or $merge
	if strings.Contains(lower, ".aggregate(") {
		sanitized := strings.ToLower(clean)
		if strings.Contains(sanitized, "$out") || strings.Contains(sanitized, "$merge") {
			return false
		}
		return true
	}

	// Known read-only collection/db methods
	for _, readPattern := range []string{
		".find(", ".findone(", ".countdocuments(", ".estimateddocumentcount(",
		".count(", ".distinct(", ".getindexes(", ".stats(", ".validate(",
		"db.getcollectionnames(", "db.getcollectioninfos(", "db.stats(",
		"db.version(", "db.serverstatus(", "db.currentop(", "db.listcommands(",
		"db.getusers(", "db.getroles(", "db.getname(",
	} {
		if strings.Contains(lower, readPattern) {
			return true
		}
	}

	// Raw command or runCommand: allow only known safe read commands
	if strings.HasPrefix(lower, "db.runcommand(") || strings.HasPrefix(lower, "db.admincommand(") || strings.HasPrefix(lower, "{") {
		for _, safeCmd := range []string{
			"ping", "hello", "ismaster", "buildinfo", "serverstatus", "dbstats",
			"collstats", "listcollections", "listdatabases", "listindexes",
			"usersinfo", "rolesinfo", "explain", "count", "distinct", "find",
			"replsetgetstatus", "replsetgetconfig", "listshards", "listcommands",
		} {
			if strings.Contains(lower, safeCmd) {
				return true
			}
		}
		return false
	}

	return false
}
