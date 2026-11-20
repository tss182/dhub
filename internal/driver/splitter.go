package driver

import (
	"strings"
	"unicode"
)

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
	var statements []string
	var current strings.Builder
	runes := []rune(sql)
	n := len(runes)

	delim := []rune{';'}

	var inSingleQuote bool
	var inDoubleQuote bool
	var inBacktick bool
	var inBracket bool
	var inDollarQuote bool
	var dollarTag []rune
	var inLineComment bool
	var inBlockComment bool

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
		if atLineStart && !inSingleQuote && !inDoubleQuote && !inBacktick && !inBracket && !inDollarQuote && !inLineComment && !inBlockComment {
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

		// Check block comment end
		if inBlockComment {
			current.WriteRune(r)
			if r == '*' && i+1 < n && runes[i+1] == '/' {
				current.WriteRune('/')
				i++
				inBlockComment = false
			}
			atLineStart = (r == '\n')
			continue
		}

		// Check single quote end
		if inSingleQuote {
			current.WriteRune(r)
			if r == '\\' && i+1 < n {
				current.WriteRune(runes[i+1])
				i++
			} else if r == '\'' {
				// Handle escaped quote: ''
				if i+1 < n && runes[i+1] == '\'' {
					current.WriteRune('\'')
					i++
				} else {
					inSingleQuote = false
				}
			}
			atLineStart = (r == '\n')
			continue
		}

		// Check double quote end
		if inDoubleQuote {
			current.WriteRune(r)
			if r == '\\' && i+1 < n {
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
		if r == '-' && i+1 < n && runes[i+1] == '-' {
			current.WriteRune(r)
			current.WriteRune('-')
			i++
			inLineComment = true
			atLineStart = false
			continue
		}
		if r == '#' {
			current.WriteRune(r)
			inLineComment = true
			atLineStart = false
			continue
		}
		if r == '/' && i+1 < n && runes[i+1] == '*' {
			current.WriteRune(r)
			current.WriteRune('*')
			i++
			inBlockComment = true
			atLineStart = false
			continue
		}
		if r == '\'' {
			inSingleQuote = true
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
		if r == '`' {
			inBacktick = true
			stmtStarted = true
			current.WriteRune(r)
			atLineStart = false
			continue
		}
		if r == '[' {
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
				isStandaloneTx := nextWord == ";" || nextWord == "" || nextWord == "TRANSACTION" || nextWord == "WORK"
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
		if strings.HasPrefix(s, "--") {
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

		if r == '-' && i+1 < n && runes[i+1] == '-' {
			inLineComment = true
			i++
			out.WriteRune(' ')
			continue
		}
		if r == '#' {
			inLineComment = true
			out.WriteRune(' ')
			continue
		}
		if r == '/' && i+1 < n && runes[i+1] == '*' {
			inBlockComment = true
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
	return out.String()
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

// IsReadOnlySafeQuery verifies that a SQL statement only performs read operations
// and does not contain data-modifying CTEs (e.g., WITH ... DELETE) or DML/DDL statements.
func IsReadOnlySafeQuery(sql string) bool {
	clean := StripLeadingComments(sql)
	upper := strings.ToUpper(clean)
	isReadLeading := hasLeadingKeyword(upper, "SELECT") ||
		hasLeadingKeyword(upper, "SHOW") ||
		hasLeadingKeyword(upper, "DESCRIBE") ||
		hasLeadingKeyword(upper, "DESC") ||
		hasLeadingKeyword(upper, "EXPLAIN") ||
		hasLeadingKeyword(upper, "ANALYZE") ||
		hasLeadingKeyword(upper, "PRAGMA") ||
		hasLeadingKeyword(upper, "WITH") ||
		hasLeadingKeyword(upper, "VALUES") ||
		hasLeadingKeyword(upper, "CHECK")
	if !isReadLeading {
		return false
	}
	sanitizedUpper := strings.ToUpper(stripStringsAndComments(clean))
	return !containsStandaloneWord(sanitizedUpper,
		"INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
		"TRUNCATE", "REPLACE", "MERGE", "GRANT", "REVOKE",
	)
}

// TruncateSQL shortens a SQL string for display in log messages.
func TruncateSQL(sql string, maxLen int) string {
	clean := strings.ReplaceAll(strings.TrimSpace(sql), "\n", " ")
	if len(clean) > maxLen {
		return clean[:maxLen] + "..."
	}
	return clean
}

