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
		if atLineStart && !inSingleQuote && !inDoubleQuote && !inBacktick && !inLineComment && !inBlockComment {
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

		// Track delimiter match (only split on ';' when not inside a compound BEGIN ... END block)
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

		// Track identifiers for compound BEGIN ... END blocks
		if isIdentChar(r) && (i == 0 || !isIdentChar(runes[i-1])) {
			j := i
			for j < n && isIdentChar(runes[j]) {
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

// IsQueryReturningRows determines if a statement produces a result set (SELECT, SHOW, DESC, EXPLAIN, ANALYZE, PRAGMA, WITH, VALUES, etc.).
func IsQueryReturningRows(sql string) bool {
	clean := StripLeadingComments(sql)
	upper := strings.ToUpper(clean)
	return hasLeadingKeyword(upper, "SELECT") ||
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
		hasLeadingKeyword(upper, "REPAIR")
}

// TruncateSQL shortens a SQL string for display in log messages.
func TruncateSQL(sql string, maxLen int) string {
	clean := strings.ReplaceAll(strings.TrimSpace(sql), "\n", " ")
	if len(clean) > maxLen {
		return clean[:maxLen] + "..."
	}
	return clean
}

