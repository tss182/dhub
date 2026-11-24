// Package sqlfmt renders Go values as SQL literals for statement previews.
package sqlfmt

import (
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// MySQLString quotes s as a MySQL/MariaDB string literal under the default sql_mode, where the
// backslash is an escape character.
func MySQLString(s string) string {
	var sb strings.Builder
	sb.Grow(len(s) + 2)
	sb.WriteByte('\'')
	for i := 0; i < len(s); i++ {
		switch c := s[i]; c {
		case 0:
			sb.WriteString(`\0`)
		case '\n':
			sb.WriteString(`\n`)
		case '\r':
			sb.WriteString(`\r`)
		case '\\':
			sb.WriteString(`\\`)
		case '\'':
			sb.WriteString(`\'`)
		case 0x1a:
			sb.WriteString(`\Z`)
		default:
			sb.WriteByte(c)
		}
	}
	sb.WriteByte('\'')
	return sb.String()
}

// MySQLValue renders v as a MySQL/MariaDB literal. Strings are never reinterpreted, so the text
// "null" stays a string. Only a Go nil becomes NULL.
func MySQLValue(v any) string {
	switch val := v.(type) {
	case nil:
		return "NULL"
	case string:
		return MySQLString(val)
	case []byte:
		if len(val) == 0 {
			return "''"
		}
		return "X'" + strings.ToUpper(hex.EncodeToString(val)) + "'"
	case bool:
		if val {
			return "1"
		}
		return "0"
	case time.Time:
		if val.Nanosecond() != 0 {
			return "'" + val.Format("2006-01-02 15:04:05.999999") + "'"
		}
		return "'" + val.Format("2006-01-02 15:04:05") + "'"
	default:
		return fmt.Sprintf("%v", val)
	}
}
