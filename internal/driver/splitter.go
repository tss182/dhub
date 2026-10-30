package driver

import "strings"

// SplitStatements splits a multi-statement SQL script into individual statements,
// accurately ignoring semicolons inside strings, comments, and identifier quotes.
func SplitStatements(sql string) []string {
	var statements []string
	var current strings.Builder
	runes := []rune(sql)
	n := len(runes)

	var inSingleQuote bool
	var inDoubleQuote bool
	var inBacktick bool
	var inLineComment bool
	var inBlockComment bool

	for i := 0; i < n; i++ {
		r := runes[i]

		// Check line comment end
		if inLineComment {
			current.WriteRune(r)
			if r == '\n' {
				inLineComment = false
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
			continue
		}

		// Check backtick end
		if inBacktick {
			current.WriteRune(r)
			if r == '`' {
				inBacktick = false
			}
			continue
		}

		// Start of comments or quotes
		if r == '-' && i+1 < n && runes[i+1] == '-' {
			current.WriteRune(r)
			current.WriteRune('-')
			i++
			inLineComment = true
			continue
		}
		if r == '#' {
			current.WriteRune(r)
			inLineComment = true
			continue
		}
		if r == '/' && i+1 < n && runes[i+1] == '*' {
			current.WriteRune(r)
			current.WriteRune('*')
			i++
			inBlockComment = true
			continue
		}
		if r == '\'' {
			inSingleQuote = true
			current.WriteRune(r)
			continue
		}
		if r == '"' {
			inDoubleQuote = true
			current.WriteRune(r)
			continue
		}
		if r == '`' {
			inBacktick = true
			current.WriteRune(r)
			continue
		}

		// Semicolon separator
		if r == ';' {
			stmt := strings.TrimSpace(current.String())
			if stmt != "" {
				statements = append(statements, stmt)
			}
			current.Reset()
			continue
		}

		current.WriteRune(r)
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

// IsQueryReturningRows determines if a statement produces a result set (SELECT, SHOW, DESC, EXPLAIN, PRAGMA).
func IsQueryReturningRows(sql string) bool {
	clean := StripLeadingComments(sql)
	upper := strings.ToUpper(clean)
	return strings.HasPrefix(upper, "SELECT") ||
		strings.HasPrefix(upper, "SHOW") ||
		strings.HasPrefix(upper, "DESCRIBE") ||
		strings.HasPrefix(upper, "DESC ") ||
		strings.HasPrefix(upper, "EXPLAIN") ||
		strings.HasPrefix(upper, "PRAGMA")
}

// TruncateSQL shortens a SQL string for display in log messages.
func TruncateSQL(sql string, maxLen int) string {
	clean := strings.ReplaceAll(strings.TrimSpace(sql), "\n", " ")
	if len(clean) > maxLen {
		return clean[:maxLen] + "..."
	}
	return clean
}

