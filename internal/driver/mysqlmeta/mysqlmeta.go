// Package mysqlmeta interprets information_schema.columns rows for the MySQL and MariaDB drivers.
// The two servers describe defaults and generated columns differently, so parsing lives in one
// place instead of being copied into each driver.
package mysqlmeta

import (
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"
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

// maxSafeJSInt is the largest integer a JavaScript number holds exactly.
const maxSafeJSInt = uint64(9007199254740991)

// IsBinaryType reports whether a type name (from DatabaseTypeName or information_schema.data_type)
// holds raw bytes that cannot travel to the UI as text.
func IsBinaryType(typeName string) bool {
	switch strings.ToUpper(strings.TrimSpace(typeName)) {
	case "BINARY", "VARBINARY", "TINYBLOB", "BLOB", "MEDIUMBLOB", "LONGBLOB", "GEOMETRY",
		"POINT", "LINESTRING", "POLYGON", "MULTIPOINT", "MULTILINESTRING", "MULTIPOLYGON", "GEOMETRYCOLLECTION":
		return true
	}
	return false
}

// FormatRead converts raw bytes of a binary or BIT column into a value the UI can show and send
// back unchanged: binary becomes "0x<hex>", BIT becomes a number (a string above 2^53).
// ok is false for any other type, so the caller keeps its default handling.
func FormatRead(typeName string, b []byte) (value any, ok bool) {
	t := strings.ToUpper(strings.TrimSpace(typeName))
	if t == "BIT" {
		var n uint64
		for _, c := range b {
			n = n<<8 | uint64(c)
		}
		if n > maxSafeJSInt {
			return fmt.Sprintf("%d", n), true
		}
		return n, true
	}
	if IsBinaryType(t) {
		return "0x" + hex.EncodeToString(b), true
	}
	return nil, false
}

// ConvertForWrite turns a value the UI sent for a column of dataType back into what the server
// expects: "0x.." text becomes bytes for binary columns, and numbers or numeric text become an
// integer for BIT columns. Values for any other type pass through untouched, so a VARCHAR that
// happens to contain "0x1F" is never reinterpreted. dataType is information_schema.data_type.
func ConvertForWrite(dataType string, v any) (any, error) {
	t := strings.ToUpper(strings.TrimSpace(dataType))
	switch {
	case v == nil:
		return nil, nil
	case t == "BIT":
		switch val := v.(type) {
		case string:
			s := strings.TrimSpace(val)
			if s == "" {
				return nil, nil
			}
			var n uint64
			if _, err := fmt.Sscanf(s, "%d", &n); err != nil || fmt.Sprintf("%d", n) != s {
				return nil, fmt.Errorf("BIT value %q must be a non-negative integer", val)
			}
			return n, nil
		case float64:
			if val < 0 || val != float64(uint64(val)) {
				return nil, fmt.Errorf("BIT value %v must be a non-negative integer", val)
			}
			return uint64(val), nil
		case bool:
			if val {
				return uint64(1), nil
			}
			return uint64(0), nil
		}
		return v, nil
	case IsBinaryType(t):
		s, ok := v.(string)
		if !ok {
			return v, nil
		}
		if len(s) >= 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X') {
			raw, err := hex.DecodeString(s[2:])
			if err != nil {
				return nil, fmt.Errorf("binary value %q is not valid hex: %w", s, err)
			}
			return raw, nil
		}
		return nil, fmt.Errorf("binary column value must be written as 0x followed by hex digits, got %q", s)
	}
	return v, nil
}

// Querier is satisfied by *sql.DB, *sql.Conn and *sql.Tx.
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// LoadColumnTypes returns column name -> information_schema.data_type for a table.
func LoadColumnTypes(ctx context.Context, q Querier, schema, table string) (map[string]string, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`,
		schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	types := map[string]string{}
	for rows.Next() {
		var name, dataType string
		if err := rows.Scan(&name, &dataType); err != nil {
			return nil, err
		}
		types[name] = dataType
	}
	return types, rows.Err()
}

// ConvertRow applies ConvertForWrite to every value in m using the table's column types.
// Columns missing from types (for example when the lookup failed) are left as they are.
func ConvertRow(types map[string]string, m map[string]any) (map[string]any, error) {
	if len(types) == 0 || len(m) == 0 {
		return m, nil
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		cv, err := ConvertForWrite(types[k], v)
		if err != nil {
			return nil, fmt.Errorf("column %s: %w", k, err)
		}
		out[k] = cv
	}
	return out, nil
}

// ParseEnumValues extracts the allowed labels from a MySQL/MariaDB enum(...) or set(...)
// column_type string, unescaping embedded ” and \' quotes.
func ParseEnumValues(colType string) []string {
	trimmed := strings.TrimSpace(colType)
	lower := strings.ToLower(trimmed)
	var start int
	switch {
	case strings.HasPrefix(lower, "enum("):
		start = len("enum(")
	case strings.HasPrefix(lower, "set("):
		start = len("set(")
	default:
		return nil
	}
	end := strings.LastIndexByte(trimmed, ')')
	if end <= start {
		return nil
	}
	body := trimmed[start:end]
	var values []string
	var cur strings.Builder
	inQuote := false
	for i := 0; i < len(body); i++ {
		c := body[i]
		if !inQuote {
			if c == '\'' {
				inQuote = true
				cur.Reset()
			}
			continue
		}
		if c == '\\' && i+1 < len(body) {
			cur.WriteByte(body[i+1])
			i++
			continue
		}
		if c == '\'' {
			if i+1 < len(body) && body[i+1] == '\'' {
				cur.WriteByte('\'')
				i++
				continue
			}
			values = append(values, cur.String())
			inQuote = false
			continue
		}
		cur.WriteByte(c)
	}
	return values
}
