package mongodb

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// bsonValueToCleanValue converts any BSON/primitive value into a JSON-safe Go value,
// recursively normalizing primitive.D (which encoding/json otherwise marshals as Key/Value pairs).
func bsonValueToCleanValue(v any) any {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case primitive.D:
		m := make(map[string]any, len(val))
		for _, elem := range val {
			m[elem.Key] = bsonValueToCleanValue(elem.Value)
		}
		return m
	case primitive.M:
		m := make(map[string]any, len(val))
		for k, item := range val {
			m[k] = bsonValueToCleanValue(item)
		}
		return m
	case map[string]any:
		m := make(map[string]any, len(val))
		for k, item := range val {
			m[k] = bsonValueToCleanValue(item)
		}
		return m
	case primitive.A:
		arr := make([]any, len(val))
		for i, item := range val {
			arr[i] = bsonValueToCleanValue(item)
		}
		return arr
	case []any:
		arr := make([]any, len(val))
		for i, item := range val {
			arr[i] = bsonValueToCleanValue(item)
		}
		return arr
	case primitive.ObjectID:
		return val.Hex()
	case primitive.DateTime:
		return val.Time().UTC().Format(time.RFC3339Nano)
	case time.Time:
		return val.UTC().Format(time.RFC3339Nano)
	case primitive.Decimal128:
		return val.String()
	case primitive.Binary:
		if (val.Subtype == 3 || val.Subtype == 4) && len(val.Data) == 16 {
			return formatUUIDBytes(val.Data)
		}
		return fmt.Sprintf("BinData(%d, %s)", val.Subtype, base64.StdEncoding.EncodeToString(val.Data))
	case primitive.Regex:
		return fmt.Sprintf("/%s/%s", val.Pattern, val.Options)
	case primitive.Timestamp:
		return fmt.Sprintf("Timestamp(%d, %d)", val.T, val.I)
	case primitive.Symbol:
		return string(val)
	case primitive.JavaScript:
		return string(val)
	case primitive.CodeWithScope:
		return map[string]any{
			"$code":  string(val.Code),
			"$scope": bsonValueToCleanValue(val.Scope),
		}
	case primitive.DBPointer:
		return map[string]any{
			"$ref": val.DB,
			"$id":  val.Pointer.Hex(),
		}
	case primitive.MinKey:
		return "$minKey"
	case primitive.MaxKey:
		return "$maxKey"
	case int64:
		const maxSafeJSInt = int64(9007199254740991)
		if val > maxSafeJSInt || val < -maxSafeJSInt {
			return fmt.Sprintf("%d", val)
		}
		return val
	case primitive.Undefined, primitive.Null:
		return nil
	case float64:
		if math.IsNaN(val) {
			return "NaN"
		}
		if math.IsInf(val, 1) {
			return "Infinity"
		}
		if math.IsInf(val, -1) {
			return "-Infinity"
		}
		return val
	case float32:
		f := float64(val)
		if math.IsNaN(f) {
			return "NaN"
		}
		if math.IsInf(f, 1) {
			return "Infinity"
		}
		if math.IsInf(f, -1) {
			return "-Infinity"
		}
		return val
	default:
		return val
	}
}

func formatUUIDBytes(b []byte) string {
	if len(b) != 16 {
		return hex.EncodeToString(b)
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// inferBsonType returns the normalized lowercase BSON type name for a value.
func inferBsonType(v any) string {
	if v == nil {
		return "null"
	}
	switch v.(type) {
	case primitive.ObjectID:
		return "objectId"
	case string, primitive.Symbol, primitive.JavaScript:
		return "string"
	case int, int8, int16, int32, uint, uint8, uint16, uint32:
		return "int"
	case int64, uint64:
		return "long"
	case float32, float64:
		return "double"
	case primitive.Decimal128:
		return "decimal"
	case bool:
		return "bool"
	case primitive.DateTime, time.Time:
		return "date"
	case primitive.Timestamp:
		return "timestamp"
	case primitive.A, []any:
		return "array"
	case primitive.D, primitive.M, map[string]any:
		return "object"
	case primitive.Binary:
		return "binData"
	case primitive.Regex:
		return "regex"
	case primitive.Null, primitive.Undefined:
		return "null"
	default:
		return "string"
	}
}

// rawTypeFromBson maps a normalized BSON type to a human-readable display type.
func rawTypeFromBson(t string) string {
	switch t {
	case "objectId":
		return "ObjectId"
	case "string":
		return "String"
	case "int":
		return "Int32"
	case "long":
		return "Int64"
	case "double":
		return "Double"
	case "decimal":
		return "Decimal128"
	case "bool":
		return "Boolean"
	case "date":
		return "Date"
	case "timestamp":
		return "Timestamp"
	case "array":
		return "Array"
	case "object":
		return "Object"
	case "binData":
		return "BinData"
	case "regex":
		return "Regex"
	case "null":
		return "Null"
	case "mixed":
		return "Mixed"
	default:
		return "String"
	}
}

// parseID converts a primary key value from the grid or API into the appropriate MongoDB _id type.
func parseID(raw any) any {
	if raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case primitive.ObjectID:
		return v
	case string:
		trimmed := strings.TrimSpace(v)
		if strings.HasPrefix(trimmed, "ObjectId(") && strings.HasSuffix(trimmed, ")") {
			inner := strings.TrimSpace(trimmed[len("ObjectId(") : len(trimmed)-1])
			inner = strings.Trim(inner, `"'`)
			if oid, err := primitive.ObjectIDFromHex(inner); err == nil {
				return oid
			}
		}
		if len(trimmed) == 24 {
			if oid, err := primitive.ObjectIDFromHex(trimmed); err == nil {
				return oid
			}
		}
		return v
	case map[string]any:
		if oidStr, ok := v["$oid"].(string); ok {
			if oid, err := primitive.ObjectIDFromHex(oidStr); err == nil {
				return oid
			}
		}
		return v
	default:
		return v
	}
}

// coerceValueForBson converts a user-supplied value (from grid inline editing or import)
// into an appropriate typed BSON value using an optional column dataType hint.
func coerceValueForBson(val any, dataTypeHint string) any {
	if val == nil {
		return nil
	}
	hint := strings.ToLower(strings.TrimSpace(dataTypeHint))

	// If already a structured Go/BSON value, preserve or normalize it.
	switch v := val.(type) {
	case primitive.ObjectID, primitive.DateTime, primitive.Decimal128, primitive.Binary, primitive.Regex, primitive.Timestamp:
		return v
	case map[string]any:
		return coerceMapForBson(v)
	case []any:
		arr := make(primitive.A, len(v))
		for i, item := range v {
			arr[i] = coerceValueForBson(item, "")
		}
		return arr
	}

	s, isStr := val.(string)
	if !isStr {
		// Handle float64 numbers from JSON unmarshaling when hint specifies int/long/decimal.
		if f, ok := val.(float64); ok {
			switch hint {
			case "int", "int32":
				return int32(f)
			case "long", "int64":
				return int64(f)
			case "decimal", "decimal128":
				if dec, err := primitive.ParseDecimal128(strconv.FormatFloat(f, 'f', -1, 64)); err == nil {
					return dec
				}
			}
		}
		return val
	}

	trimmed := strings.TrimSpace(s)

	switch hint {
	case "objectid":
		if oid, ok := tryParseObjectID(trimmed); ok {
			return oid
		}
		return s
	case "date", "datetime":
		if dt, ok := tryParseDateTime(trimmed); ok {
			return dt
		}
		return s
	case "decimal", "decimal128":
		if dec, err := primitive.ParseDecimal128(trimmed); err == nil {
			return dec
		}
		return s
	case "int", "int32":
		if n, err := strconv.ParseInt(trimmed, 10, 32); err == nil {
			return int32(n)
		}
		return s
	case "long", "int64":
		if n, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
			return n
		}
		return s
	case "double", "float":
		if f, err := strconv.ParseFloat(trimmed, 64); err == nil {
			return f
		}
		return s
	case "bool", "boolean":
		if strings.EqualFold(trimmed, "true") {
			return true
		}
		if strings.EqualFold(trimmed, "false") {
			return false
		}
		return s
	case "object":
		if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
			if doc, err := unmarshalExtJSONDoc(trimmed); err == nil {
				return doc
			}
		}
		return s
	case "array":
		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			if arr, err := unmarshalExtJSONArray(trimmed); err == nil {
				return arr
			}
		}
		return s
	}

	// No strict hint: infer from explicit Mongo shell wrappers or JSON literals.
	if oid, ok := tryParseObjectID(trimmed); ok && strings.HasPrefix(trimmed, "ObjectId(") {
		return oid
	}
	if strings.HasPrefix(trimmed, "ISODate(") || strings.HasPrefix(trimmed, "new Date(") {
		if dt, ok := tryParseDateTime(trimmed); ok {
			return dt
		}
	}
	if (strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}")) ||
		(strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]")) {
		if strings.HasPrefix(trimmed, "{") {
			if doc, err := unmarshalExtJSONDoc(trimmed); err == nil {
				return doc
			}
		} else {
			if arr, err := unmarshalExtJSONArray(trimmed); err == nil {
				return arr
			}
		}
	}
	return s
}

func coerceMapForBson(m map[string]any) any {
	// Check for Extended JSON single-key wrappers first
	if len(m) == 1 {
		if oidStr, ok := m["$oid"].(string); ok {
			if oid, err := primitive.ObjectIDFromHex(oidStr); err == nil {
				return oid
			}
		}
		if dateVal, ok := m["$date"]; ok {
			switch dv := dateVal.(type) {
			case string:
				if dt, ok := tryParseDateTime(dv); ok {
					return dt
				}
			case float64:
				return primitive.NewDateTimeFromTime(time.UnixMilli(int64(dv)).UTC())
			}
		}
		if decStr, ok := m["$numberDecimal"].(string); ok {
			if dec, err := primitive.ParseDecimal128(decStr); err == nil {
				return dec
			}
		}
		if longStr, ok := m["$numberLong"].(string); ok {
			if n, err := strconv.ParseInt(longStr, 10, 64); err == nil {
				return n
			}
		}
	}
	out := make(bson.M, len(m))
	for k, v := range m {
		out[k] = coerceValueForBson(v, "")
	}
	return out
}

func tryParseObjectID(s string) (primitive.ObjectID, bool) {
	if strings.HasPrefix(s, "ObjectId(") && strings.HasSuffix(s, ")") {
		inner := strings.TrimSpace(s[len("ObjectId(") : len(s)-1])
		inner = strings.Trim(inner, `"'`)
		if oid, err := primitive.ObjectIDFromHex(inner); err == nil {
			return oid, true
		}
	}
	if len(s) == 24 {
		if oid, err := primitive.ObjectIDFromHex(s); err == nil {
			return oid, true
		}
	}
	return primitive.NilObjectID, false
}

func tryParseDateTime(s string) (primitive.DateTime, bool) {
	inner := strings.TrimSpace(s)
	if strings.HasPrefix(inner, "ISODate(") && strings.HasSuffix(inner, ")") {
		inner = strings.TrimSpace(inner[len("ISODate(") : len(inner)-1])
		inner = strings.Trim(inner, `"'`)
	} else if strings.HasPrefix(inner, "new Date(") && strings.HasSuffix(inner, ")") {
		inner = strings.TrimSpace(inner[len("new Date(") : len(inner)-1])
		inner = strings.Trim(inner, `"'`)
	}
	if inner == "" {
		return primitive.NewDateTimeFromTime(time.Now().UTC()), true
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	} {
		if t, err := time.Parse(layout, inner); err == nil {
			return primitive.NewDateTimeFromTime(t.UTC()), true
		}
	}
	return 0, false
}

func unmarshalExtJSONDoc(raw string) (bson.D, error) {
	normalized := normalizeMongoShellJSON(raw)
	var doc bson.D
	if err := bson.UnmarshalExtJSON([]byte(normalized), false, &doc); err == nil {
		return doc, nil
	}
	// Fallback to standard JSON -> bson.M
	var m map[string]any
	if err := json.Unmarshal([]byte(normalized), &m); err != nil {
		return nil, err
	}
	res := make(bson.D, 0, len(m))
	for k, v := range m {
		res = append(res, bson.E{Key: k, Value: coerceValueForBson(v, "")})
	}
	return res, nil
}

func unmarshalExtJSONArray(raw string) (bson.A, error) {
	normalized := normalizeMongoShellJSON(raw)
	var arr []any
	if err := bson.UnmarshalExtJSON([]byte(normalized), false, &arr); err == nil {
		res := make(bson.A, len(arr))
		copy(res, arr)
		return res, nil
	}
	var stdArr []any
	if err := json.Unmarshal([]byte(normalized), &stdArr); err != nil {
		return nil, err
	}
	res := make(bson.A, len(stdArr))
	for i, item := range stdArr {
		res[i] = coerceValueForBson(item, "")
	}
	return res, nil
}

// formatMongoShellValue renders a Go/BSON value in mongosh syntax for DML previews and scripts.
func formatMongoShellValue(v any) string {
	if v == nil {
		return "null"
	}
	switch val := v.(type) {
	case primitive.ObjectID:
		return fmt.Sprintf("ObjectId(%q)", val.Hex())
	case primitive.DateTime:
		return fmt.Sprintf("ISODate(%q)", val.Time().UTC().Format(time.RFC3339Nano))
	case time.Time:
		return fmt.Sprintf("ISODate(%q)", val.UTC().Format(time.RFC3339Nano))
	case primitive.Decimal128:
		return fmt.Sprintf("NumberDecimal(%q)", val.String())
	case int64:
		return fmt.Sprintf("NumberLong(%d)", val)
	case primitive.D:
		parts := make([]string, 0, len(val))
		for _, elem := range val {
			parts = append(parts, fmt.Sprintf("%s: %s", formatShellKey(elem.Key), formatMongoShellValue(elem.Value)))
		}
		return "{ " + strings.Join(parts, ", ") + " }"
	case bson.M:
		b, err := json.Marshal(bsonValueToCleanValue(val))
		if err != nil {
			return "{}"
		}
		return string(b)
	default:
		clean := bsonValueToCleanValue(val)
		b, err := json.Marshal(clean)
		if err != nil {
			return fmt.Sprintf("%q", fmt.Sprint(val))
		}
		return string(b)
	}
}

func formatShellKey(k string) string {
	if isSimpleShellIdent(k) {
		return k
	}
	b, _ := json.Marshal(k)
	return string(b)
}

func isSimpleShellIdent(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		if i == 0 && !(unicode.IsLetter(r) || r == '_' || r == '$') {
			return false
		}
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '$') {
			return false
		}
	}
	return true
}

// normalizeMongoShellJSON converts relaxed mongosh object/array literals into valid Extended JSON:
// - unquoted keys -> "key"
// - single-quoted strings -> "double-quoted"
// - trailing commas before } or ] removed
// - ObjectId("..."), ISODate("..."), new Date("..."), NumberInt(...), NumberLong(...), NumberDecimal(...) -> Extended JSON
// - /pattern/flags -> {"$regex": "pattern", "$options": "flags"}
func normalizeMongoShellJSON(input string) string {
	var out strings.Builder
	out.Grow(len(input) + 16)
	n := len(input)
	i := 0

	// Track whether the previous significant token could precede a regex literal.
	canStartRegex := true

	for i < n {
		ch := input[i]

		// Skip whitespace
		if ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n' {
			out.WriteByte(ch)
			i++
			continue
		}

		// Line comment //
		if ch == '/' && i+1 < n && input[i+1] == '/' {
			for i < n && input[i] != '\n' {
				i++
			}
			continue
		}

		// Block comment /* ... */
		if ch == '/' && i+1 < n && input[i+1] == '*' {
			i += 2
			for i+1 < n && !(input[i] == '*' && input[i+1] == '/') {
				i++
			}
			if i+1 < n {
				i += 2
			}
			continue
		}

		// Regex literal /pattern/flags
		if ch == '/' && canStartRegex {
			pattern, flags, nextIdx, ok := readRegexLiteral(input, i)
			if ok {
				patJSON, _ := json.Marshal(pattern)
				if flags != "" {
					flgJSON, _ := json.Marshal(flags)
					out.WriteString(`{"$regex":`)
					out.Write(patJSON)
					out.WriteString(`,"$options":`)
					out.Write(flgJSON)
					out.WriteByte('}')
				} else {
					out.WriteString(`{"$regex":`)
					out.Write(patJSON)
					out.WriteByte('}')
				}
				i = nextIdx
				canStartRegex = false
				continue
			}
		}

		// Double-quoted or single-quoted string
		if ch == '"' || ch == '\'' {
			strVal, nextIdx := readShellString(input, i)
			encoded, _ := json.Marshal(strVal)
			out.Write(encoded)
			i = nextIdx
			canStartRegex = false
			continue
		}

		// Trailing comma before } or ]
		if ch == ',' {
			j := i + 1
			for j < n && (input[j] == ' ' || input[j] == '\t' || input[j] == '\r' || input[j] == '\n') {
				j++
			}
			if j < n && (input[j] == '}' || input[j] == ']') {
				i++
				continue
			}
			out.WriteByte(',')
			i++
			canStartRegex = true
			continue
		}

		if ch == '{' || ch == '[' || ch == ':' || ch == '(' {
			out.WriteByte(ch)
			i++
			canStartRegex = true
			continue
		}
		if ch == '}' || ch == ']' || ch == ')' {
			out.WriteByte(ch)
			i++
			canStartRegex = false
			continue
		}

		// Identifier, keyword, helper constructor, or unquoted object key
		if isIdentStart(ch) {
			start := i
			i++
			for i < n && isIdentPart(input[i]) {
				i++
			}
			word := input[start:i]

			// Handle "new Date(...)" or "new ObjectId(...)"
			if word == "new" {
				j := i
				for j < n && (input[j] == ' ' || input[j] == '\t') {
					j++
				}
				if j < n && isIdentStart(input[j]) {
					k := j
					for k < n && isIdentPart(input[k]) {
						k++
					}
					ctor := input[j:k]
					if ctor == "Date" || ctor == "ObjectId" || ctor == "RegExp" {
						word = ctor
						i = k
					}
				}
			}

			// Look ahead past whitespace for '(' (helper call) or ':' (unquoted key)
			j := i
			for j < n && (input[j] == ' ' || input[j] == '\t' || input[j] == '\r' || input[j] == '\n') {
				j++
			}

			if j < n && input[j] == '(' {
				if ext, nextIdx, handled := convertShellHelperCall(word, input, j); handled {
					out.WriteString(ext)
					i = nextIdx
					canStartRegex = false
					continue
				}
			}

			if j < n && input[j] == ':' {
				encoded, _ := json.Marshal(word)
				out.Write(encoded)
				canStartRegex = false
				continue
			}

			// Keywords: true, false, null, undefined
			switch word {
			case "true", "false", "null":
				out.WriteString(word)
			case "undefined":
				out.WriteString("null")
			default:
				out.WriteString(word)
			}
			canStartRegex = false
			continue
		}

		out.WriteByte(ch)
		i++
		canStartRegex = false
	}

	return out.String()
}

func isIdentStart(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || b == '_' || b == '$'
}

func isIdentPart(b byte) bool {
	return isIdentStart(b) || (b >= '0' && b <= '9')
}

func readShellString(input string, start int) (string, int) {
	quote := input[start]
	i := start + 1
	n := len(input)
	var sb strings.Builder
	for i < n {
		ch := input[i]
		if ch == '\\' && i+1 < n {
			next := input[i+1]
			switch next {
			case 'n':
				sb.WriteByte('\n')
			case 'r':
				sb.WriteByte('\r')
			case 't':
				sb.WriteByte('\t')
			case '\\', '"', '\'':
				sb.WriteByte(next)
			default:
				sb.WriteByte(next)
			}
			i += 2
			continue
		}
		if ch == quote {
			return sb.String(), i + 1
		}
		sb.WriteByte(ch)
		i++
	}
	return sb.String(), n
}

func readRegexLiteral(input string, start int) (string, string, int, bool) {
	i := start + 1
	n := len(input)
	var pat strings.Builder
	closed := false
	for i < n {
		ch := input[i]
		if ch == '\\' && i+1 < n {
			pat.WriteByte(ch)
			pat.WriteByte(input[i+1])
			i += 2
			continue
		}
		if ch == '/' {
			closed = true
			i++
			break
		}
		if ch == '\n' || ch == '\r' {
			return "", "", start, false
		}
		pat.WriteByte(ch)
		i++
	}
	if !closed {
		return "", "", start, false
	}
	var flags strings.Builder
	for i < n && ((input[i] >= 'a' && input[i] <= 'z') || (input[i] >= 'A' && input[i] <= 'Z')) {
		flags.WriteByte(input[i])
		i++
	}
	return pat.String(), flags.String(), i, true
}

func convertShellHelperCall(name, input string, openParenIdx int) (string, int, bool) {
	closeIdx := findMatchingParen(input, openParenIdx)
	if closeIdx < 0 {
		return "", 0, false
	}
	argRaw := strings.TrimSpace(input[openParenIdx+1 : closeIdx])
	argUnquoted := stripSingleOrDoubleQuotes(argRaw)

	switch name {
	case "ObjectId":
		if argUnquoted == "" {
			argUnquoted = primitive.NewObjectID().Hex()
		}
		b, _ := json.Marshal(argUnquoted)
		return fmt.Sprintf(`{"$oid":%s}`, string(b)), closeIdx + 1, true
	case "ISODate", "Date":
		if argUnquoted == "" {
			argUnquoted = time.Now().UTC().Format(time.RFC3339Nano)
		}
		b, _ := json.Marshal(argUnquoted)
		return fmt.Sprintf(`{"$date":%s}`, string(b)), closeIdx + 1, true
	case "NumberLong":
		b, _ := json.Marshal(argUnquoted)
		return fmt.Sprintf(`{"$numberLong":%s}`, string(b)), closeIdx + 1, true
	case "NumberDecimal":
		b, _ := json.Marshal(argUnquoted)
		return fmt.Sprintf(`{"$numberDecimal":%s}`, string(b)), closeIdx + 1, true
	case "NumberInt":
		if _, err := strconv.Atoi(argUnquoted); err == nil {
			return argUnquoted, closeIdx + 1, true
		}
		return "0", closeIdx + 1, true
	case "UUID":
		hexClean := strings.ReplaceAll(argUnquoted, "-", "")
		if raw, err := hex.DecodeString(hexClean); err == nil {
			b64 := base64.StdEncoding.EncodeToString(raw)
			b, _ := json.Marshal(b64)
			return fmt.Sprintf(`{"$binary":{"base64":%s,"subType":"04"}}`, string(b)), closeIdx + 1, true
		}
		return fmt.Sprintf(`%q`, argUnquoted), closeIdx + 1, true
	case "RegExp":
		// RegExp("pat", "i")
		parts := splitTopLevelArgs(argRaw)
		pat := ""
		opts := ""
		if len(parts) >= 1 {
			pat = stripSingleOrDoubleQuotes(strings.TrimSpace(parts[0]))
		}
		if len(parts) >= 2 {
			opts = stripSingleOrDoubleQuotes(strings.TrimSpace(parts[1]))
		}
		patJSON, _ := json.Marshal(pat)
		if opts != "" {
			optsJSON, _ := json.Marshal(opts)
			return fmt.Sprintf(`{"$regex":%s,"$options":%s}`, string(patJSON), string(optsJSON)), closeIdx + 1, true
		}
		return fmt.Sprintf(`{"$regex":%s}`, string(patJSON)), closeIdx + 1, true
	default:
		return "", 0, false
	}
}

func findMatchingParen(s string, openIdx int) int {
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
		if ch == '(' {
			depth++
		} else if ch == ')' {
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

func stripSingleOrDoubleQuotes(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && ((s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'')) {
		val, _ := readShellString(s, 0)
		return val
	}
	return s
}

func splitTopLevelArgs(raw string) []string {
	var args []string
	var cur strings.Builder
	depthParen := 0
	depthBrace := 0
	depthBracket := 0
	inSingle := false
	inDouble := false
	escaped := false

	for i := 0; i < len(raw); i++ {
		ch := raw[i]
		if escaped {
			cur.WriteByte(ch)
			escaped = false
			continue
		}
		if ch == '\\' && (inSingle || inDouble) {
			cur.WriteByte(ch)
			escaped = true
			continue
		}
		if ch == '\'' && !inDouble {
			inSingle = !inSingle
			cur.WriteByte(ch)
			continue
		}
		if ch == '"' && !inSingle {
			inDouble = !inDouble
			cur.WriteByte(ch)
			continue
		}
		if !inSingle && !inDouble {
			switch ch {
			case '(':
				depthParen++
			case ')':
				depthParen--
			case '{':
				depthBrace++
			case '}':
				depthBrace--
			case '[':
				depthBracket++
			case ']':
				depthBracket--
			case ',':
				if depthParen == 0 && depthBrace == 0 && depthBracket == 0 {
					args = append(args, strings.TrimSpace(cur.String()))
					cur.Reset()
					continue
				}
			}
		}
		cur.WriteByte(ch)
	}
	if strings.TrimSpace(cur.String()) != "" {
		args = append(args, strings.TrimSpace(cur.String()))
	}
	return args
}
