// Package mysqlmeta interprets information_schema.columns rows for the MySQL and MariaDB drivers.
// The two servers describe defaults and generated columns differently, so parsing lives in one
// place instead of being copied into each driver.
package mysqlmeta

import (
	"regexp"
	"strings"
)

// Default kinds reported in driver.ColumnMeta.DefaultKind.
const (
	DefaultLiteral    = "literal"
	DefaultExpression = "expression"
	DefaultNull       = "null"
	DefaultNone       = "none"
)

// Column kinds reported in driver.ColumnMeta.ColumnKind.
const (
	KindNormal  = "NORMAL"
	KindVirtual = "VIRTUAL"
	KindStored  = "STORED"
)

// Extra is the parsed form of the information_schema.columns.EXTRA value.
type Extra struct {
	AutoIncrement    bool
	DefaultGenerated bool // MySQL 8.0.13+: the default is an expression, not a literal
	Invisible        bool
	OnUpdate         string // e.g. "CURRENT_TIMESTAMP(3)"; empty when the column has none
	Kind             string // NORMAL, VIRTUAL or STORED
}

var onUpdateRe = regexp.MustCompile(`(?i)\bon\s+update\s+(.+?)(?:\s+(?:default_generated|auto_increment|invisible|virtual|stored|persistent)\b|$)`)

// ParseExtra reads flags such as "DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)",
// "STORED GENERATED", "VIRTUAL GENERATED" or "INVISIBLE".
func ParseExtra(extra string) Extra {
	lower := strings.ToLower(extra)
	e := Extra{Kind: KindNormal}
	e.AutoIncrement = strings.Contains(lower, "auto_increment")
	e.DefaultGenerated = strings.Contains(lower, "default_generated")
	e.Invisible = strings.Contains(lower, "invisible")
	switch {
	case strings.Contains(lower, "stored generated"), strings.Contains(lower, "persistent"):
		e.Kind = KindStored
	case strings.Contains(lower, "virtual generated"), strings.Contains(lower, "virtual"):
		e.Kind = KindVirtual
	}
	if m := onUpdateRe.FindStringSubmatch(extra); len(m) == 2 {
		e.OnUpdate = strings.TrimSpace(m[1])
	}
	return e
}

// Default describes a column default.
type Default struct {
	Value string // literal text without quotes, or the expression text
	Kind  string // one of the Default* constants
}

// MySQLDefault interprets column_default as MySQL reports it: literals are raw (unquoted) text,
// SQL NULL means "no explicit value", and EXTRA carries DEFAULT_GENERATED for expressions.
func MySQLDefault(dflt *string, nullable bool, extra Extra) Default {
	if dflt == nil {
		if nullable {
			return Default{Kind: DefaultNull}
		}
		return Default{Kind: DefaultNone}
	}
	if extra.DefaultGenerated {
		return Default{Value: *dflt, Kind: DefaultExpression}
	}
	return Default{Value: *dflt, Kind: DefaultLiteral}
}

var (
	numberRe    = regexp.MustCompile(`^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`)
	callRe      = regexp.MustCompile(`(?i)^[a-z_][a-z0-9_]*\s*\(.*\)$`)
	keywordExpr = regexp.MustCompile(`(?i)^(current_timestamp|current_date|current_time|localtime|localtimestamp|now|curdate|curtime)$`)
)

// MariaDBDefault interprets column_default as MariaDB 10.2.7+ reports it: the value is SQL text,
// so strings arrive quoted ('abc'), a missing default on a nullable column arrives as the text
// NULL, and functions arrive as expressions (current_timestamp()). Older servers return raw
// values; those are kept as literals.
func MariaDBDefault(dflt *string, nullable bool) Default {
	if dflt == nil {
		if nullable {
			return Default{Kind: DefaultNull}
		}
		return Default{Kind: DefaultNone}
	}
	raw := strings.TrimSpace(*dflt)
	switch {
	case strings.EqualFold(raw, "NULL"):
		return Default{Kind: DefaultNull}
	case len(raw) >= 2 && raw[0] == '\'' && raw[len(raw)-1] == '\'':
		return Default{Value: unquoteMariaDB(raw[1 : len(raw)-1]), Kind: DefaultLiteral}
	case numberRe.MatchString(raw):
		return Default{Value: raw, Kind: DefaultLiteral}
	case keywordExpr.MatchString(raw), callRe.MatchString(raw):
		return Default{Value: raw, Kind: DefaultExpression}
	}
	return Default{Value: *dflt, Kind: DefaultLiteral}
}

// unquoteMariaDB reverses the escaping MariaDB applies inside a quoted default.
func unquoteMariaDB(s string) string {
	if !strings.ContainsAny(s, `\'`) {
		return s
	}
	var sb strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '\'' && i+1 < len(s) && s[i+1] == '\'':
			sb.WriteByte('\'')
			i++
		case c == '\\' && i+1 < len(s):
			i++
			switch s[i] {
			case 'n':
				sb.WriteByte('\n')
			case 'r':
				sb.WriteByte('\r')
			case 't':
				sb.WriteByte('\t')
			case '0':
				sb.WriteByte(0)
			default:
				sb.WriteByte(s[i])
			}
		default:
			sb.WriteByte(c)
		}
	}
	return sb.String()
}
