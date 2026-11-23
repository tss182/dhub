package mongodb

import (
	"fmt"
	"strings"
)

type shellStmtKind int

const (
	stmtUseDB shellStmtKind = iota
	stmtShow
	stmtRawCommand
	stmtDBMethod
	stmtCollMethod
	stmtReplicaSet
	stmtSharding
)

type methodCall struct {
	name    string
	argsRaw string
}

type parsedShellStmt struct {
	kind       shellStmtKind
	raw        string
	target     string       // db name for use, show target, or collection name
	calls      []methodCall // chain of method calls
}

// splitMongoShellStatements splits a MongoDB shell script into individual statements.
// It respects strings (' " `), regex literals (/.../), comments (// and /* */),
// and nesting of (), {}, []. Top-level semicolons always split statements, and
// top-level newlines split standalone shell commands (use ..., show ...) or complete calls.
func splitMongoShellStatements(script string) []string {
	var stmts []string
	var cur strings.Builder
	n := len(script)
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
		if s != "" && !isCommentOnly(s) {
			stmts = append(stmts, s)
		}
	}

	for i < n {
		ch := script[i]
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

		// Line comment
		if ch == '/' && i+1 < n && script[i+1] == '/' {
			for i < n && script[i] != '\n' {
				i++
			}
			continue
		}
		// Block comment
		if ch == '/' && i+1 < n && script[i+1] == '*' {
			i += 2
			for i+1 < n && !(script[i] == '*' && script[i+1] == '/') {
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
				// Split if current line is a standalone shell command (`use x`, `show dbs`),
				// OR if it does not end with '.' and the next non-empty token does not start with '.'.
				if strings.HasPrefix(lower, "use ") || strings.HasPrefix(lower, "show ") {
					flush()
				} else if trimmed != "" && !strings.HasSuffix(trimmed, ".") && !nextNonSpaceStartsWithDot(script, i+1) {
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

func nextNonSpaceStartsWithDot(s string, idx int) bool {
	for idx < len(s) {
		ch := s[idx]
		if ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n' {
			idx++
			continue
		}
		return ch == '.'
	}
	return false
}

func isCommentOnly(s string) bool {
	return strings.TrimSpace(s) == ""
}

func parseMongoStatement(raw string) (*parsedShellStmt, error) {
	s := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(raw), ";"))
	if s == "" {
		return nil, fmt.Errorf("empty statement")
	}

	lower := strings.ToLower(s)
	if strings.HasPrefix(lower, "use ") || lower == "use" {
		db := strings.TrimSpace(s[3:])
		db = stripSingleOrDoubleQuotes(db)
		if db == "" {
			return nil, fmt.Errorf("syntax error: expected database name after 'use'")
		}
		return &parsedShellStmt{kind: stmtUseDB, raw: s, target: db}, nil
	}

	if strings.HasPrefix(lower, "show ") {
		what := strings.TrimSpace(strings.ToLower(s[5:]))
		return &parsedShellStmt{kind: stmtShow, raw: s, target: what}, nil
	}

	if strings.HasPrefix(s, "{") && strings.HasSuffix(s, "}") {
		return &parsedShellStmt{kind: stmtRawCommand, raw: s}, nil
	}

	if strings.HasPrefix(s, "rs.") {
		calls, err := parseMethodChain(s[3:])
		if err != nil {
			return nil, err
		}
		return &parsedShellStmt{kind: stmtReplicaSet, raw: s, calls: calls}, nil
	}

	if strings.HasPrefix(s, "sh.") {
		calls, err := parseMethodChain(s[3:])
		if err != nil {
			return nil, err
		}
		return &parsedShellStmt{kind: stmtSharding, raw: s, calls: calls}, nil
	}

	if s == "db" {
		return &parsedShellStmt{kind: stmtDBMethod, raw: s, calls: []methodCall{{name: "getName"}}}, nil
	}

	if strings.HasPrefix(s, "db[") {
		closeBracket := findMatchingBracket(s, 2)
		if closeBracket < 0 {
			return nil, fmt.Errorf("unclosed bracket in collection reference: %s", s)
		}
		collName := stripSingleOrDoubleQuotes(s[3:closeBracket])
		rest := strings.TrimSpace(s[closeBracket+1:])
		if !strings.HasPrefix(rest, ".") {
			return nil, fmt.Errorf("expected method call after db[%q]", collName)
		}
		calls, err := parseMethodChain(rest[1:])
		if err != nil {
			return nil, err
		}
		return &parsedShellStmt{kind: stmtCollMethod, raw: s, target: collName, calls: calls}, nil
	}

	if strings.HasPrefix(s, "db.getCollection(") {
		openParen := len("db.getCollection")
		closeParen := findMatchingParen(s, openParen)
		if closeParen < 0 {
			return nil, fmt.Errorf("unclosed db.getCollection(...) call")
		}
		collName := stripSingleOrDoubleQuotes(s[openParen+1 : closeParen])
		rest := strings.TrimSpace(s[closeParen+1:])
		if !strings.HasPrefix(rest, ".") {
			return nil, fmt.Errorf("expected method call after db.getCollection(%q)", collName)
		}
		calls, err := parseMethodChain(rest[1:])
		if err != nil {
			return nil, err
		}
		return &parsedShellStmt{kind: stmtCollMethod, raw: s, target: collName, calls: calls}, nil
	}

	if strings.HasPrefix(s, "db.") {
		rest := s[3:]
		// Distinguish db.<method>(...) vs db.<coll>.<method>(...)
		// Find first '(' or '.' outside quotes/brackets
		dotIdx, parenIdx := findFirstDotOrParen(rest)
		if parenIdx >= 0 && (dotIdx < 0 || parenIdx < dotIdx) {
			// db.<method>(...) — or db.<method>(...).chain(...)
			calls, err := parseMethodChain(rest)
			if err != nil {
				return nil, err
			}
			return &parsedShellStmt{kind: stmtDBMethod, raw: s, calls: calls}, nil
		}
		if dotIdx > 0 {
			collName := strings.TrimSpace(rest[:dotIdx])
			calls, err := parseMethodChain(rest[dotIdx+1:])
			if err != nil {
				return nil, err
			}
			return &parsedShellStmt{kind: stmtCollMethod, raw: s, target: collName, calls: calls}, nil
		}
	}

	return nil, fmt.Errorf("unrecognized MongoDB statement: %s", s)
}

func findFirstDotOrParen(s string) (int, int) {
	inSingle := false
	inDouble := false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch == '\'' && !inDouble {
			inSingle = !inSingle
		} else if ch == '"' && !inSingle {
			inDouble = !inDouble
		} else if !inSingle && !inDouble {
			if ch == '.' {
				return i, -1
			}
			if ch == '(' {
				return -1, i
			}
		}
	}
	return -1, -1
}

func findMatchingBracket(s string, openIdx int) int {
	depth := 0
	inSingle := false
	inDouble := false
	escaped := false
	for i := openIdx; i < len(s); i++ {
		ch := s[i]
		if escaped {
			escaped = false
			continue
		}
		if ch == '\\' && (inSingle || inDouble) {
			escaped = true
			continue
		}
		if ch == '\'' && !inDouble {
			inSingle = !inSingle
			continue
		}
		if ch == '"' && !inSingle {
			inDouble = !inDouble
			continue
		}
		if inSingle || inDouble {
			continue
		}
		if ch == '[' {
			depth++
		} else if ch == ']' {
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

func parseMethodChain(chainStr string) ([]methodCall, error) {
	var calls []methodCall
	s := strings.TrimSpace(chainStr)
	i := 0
	n := len(s)

	for i < n {
		// Skip whitespace and leading dot
		for i < n && (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n') {
			i++
		}
		if i >= n {
			break
		}
		if len(calls) > 0 {
			if s[i] != '.' {
				return nil, fmt.Errorf("expected '.' before chained method at: %s", s[i:])
			}
			i++
			for i < n && (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n') {
				i++
			}
		}

		nameStart := i
		for i < n && isIdentPart(s[i]) {
			i++
		}
		name := s[nameStart:i]
		if name == "" {
			return nil, fmt.Errorf("expected method name at: %s", s[nameStart:])
		}
		for i < n && (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n') {
			i++
		}
		if i >= n || s[i] != '(' {
			// Property access without parens (e.g. db.serverStatus)
			calls = append(calls, methodCall{name: name, argsRaw: ""})
			continue
		}
		closeIdx := findMatchingParen(s, i)
		if closeIdx < 0 {
			return nil, fmt.Errorf("unclosed '(' in %s(...)", name)
		}
		argsRaw := strings.TrimSpace(s[i+1 : closeIdx])
		calls = append(calls, methodCall{name: name, argsRaw: argsRaw})
		i = closeIdx + 1
	}

	if len(calls) == 0 {
		return nil, fmt.Errorf("no method call found")
	}
	return calls, nil
}
