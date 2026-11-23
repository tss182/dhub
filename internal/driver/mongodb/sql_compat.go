package mongodb

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"dhub/internal/driver"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var (
	mongoSQLSelectRegex = regexp.MustCompile(`(?is)^\s*SELECT\s+(DISTINCT\s+)?(.+?)\s+FROM\s+(.+?)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?)?(?:\s+OFFSET\s+(\d+))?\s*;?\s*$`)
)

func stripQuotes(s string) string {
	s = strings.TrimSpace(s)
	s = strings.Trim(s, "`\"[]'")
	return strings.TrimSpace(s)
}

func stripCollectionName(s string) string {
	s = strings.TrimSpace(s)
	// Handle db.coll or "db"."coll"
	parts := splitOutsideQuotes(s, '.')
	if len(parts) > 1 {
		return stripQuotes(parts[len(parts)-1])
	}
	return stripQuotes(s)
}

func stripFieldPath(s string) string {
	s = strings.TrimSpace(s)
	parts := splitOutsideQuotes(s, '.')
	for i, p := range parts {
		parts[i] = stripQuotes(p)
	}
	return strings.Join(parts, ".")
}

func splitOutsideQuotes(s string, sep byte) []string {
	var parts []string
	var cur strings.Builder
	inSingle := false
	inDouble := false
	inBacktick := false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch == '\'' && !inDouble && !inBacktick {
			inSingle = !inSingle
		} else if ch == '"' && !inSingle && !inBacktick {
			inDouble = !inDouble
		} else if ch == '`' && !inSingle && !inDouble {
			inBacktick = !inBacktick
		} else if ch == sep && !inSingle && !inDouble && !inBacktick {
			parts = append(parts, cur.String())
			cur.Reset()
			continue
		}
		cur.WriteByte(ch)
	}
	parts = append(parts, cur.String())
	return parts
}

func parseOrderByClause(orderBy string) bson.D {
	orderBy = strings.TrimSpace(orderBy)
	if orderBy == "" {
		return nil
	}
	parts := splitOutsideQuotes(orderBy, ',')
	sortDoc := make(bson.D, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		dir := int32(1)
		upper := strings.ToUpper(p)
		if strings.HasSuffix(upper, " DESC") {
			dir = -1
			p = strings.TrimSpace(p[:len(p)-5])
		} else if strings.HasSuffix(upper, " ASC") {
			dir = 1
			p = strings.TrimSpace(p[:len(p)-4])
		}
		field := stripFieldPath(p)
		if field != "" {
			sortDoc = append(sortDoc, bson.E{Key: field, Value: dir})
		}
	}
	return sortDoc
}

func (m *MongoDBDriver) executePseudoSQL(ctx context.Context, dbName string, req driver.QueryRequest, start time.Time) (*driver.QueryResult, error) {
	sqlStr := strings.TrimSpace(req.SQL)
	matches := mongoSQLSelectRegex.FindStringSubmatch(sqlStr)
	if len(matches) == 0 {
		return nil, fmt.Errorf("unsupported MongoDB query: use MQL (e.g. db.collection.find({})) or SELECT ... FROM collection")
	}

	isDistinct := strings.TrimSpace(matches[1]) != ""
	selectFields := strings.TrimSpace(matches[2])
	collName := stripCollectionName(matches[3])
	whereClause := strings.TrimSpace(matches[4])
	orderByClause := strings.TrimSpace(matches[5])
	limitStr := strings.TrimSpace(matches[6])
	offsetStr := strings.TrimSpace(matches[7])
	if offsetStr == "" {
		offsetStr = strings.TrimSpace(matches[8])
	}

	filter := bson.M{}
	if whereClause != "" {
		filter = parseWhereClause(whereClause)
	}

	coll := m.client.Database(dbName).Collection(collName)

	// Handle SELECT COUNT(*)
	upperSel := strings.ToUpper(strings.ReplaceAll(selectFields, " ", ""))
	if strings.HasPrefix(upperSel, "COUNT(") {
		var count int64
		var err error
		if len(filter) == 0 {
			count, err = coll.EstimatedDocumentCount(ctx)
		} else {
			count, err = coll.CountDocuments(ctx, filter)
		}
		if err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      []driver.ColumnMeta{{Name: "count", DataType: "long", RawType: "Int64"}},
			Rows:         [][]any{{count}},
			RowsAffected: 1,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil
	}

	// Handle SELECT DISTINCT field FROM coll
	if isDistinct && selectFields != "*" && !strings.Contains(selectFields, ",") {
		fieldName := stripFieldPath(selectFields)
		vals, err := coll.Distinct(ctx, fieldName, filter)
		if err != nil {
			return nil, err
		}
		rows := make([][]any, 0, len(vals))
		colType := "string"
		for i, v := range vals {
			if i == 0 && v != nil {
				colType = inferBsonType(v)
			}
			clean := bsonValueToCleanValue(v)
			if mVal, ok := clean.(map[string]any); ok {
				b, _ := json.Marshal(mVal)
				clean = string(b)
			} else if aVal, ok := clean.([]any); ok {
				b, _ := json.Marshal(aVal)
				clean = string(b)
			}
			rows = append(rows, []any{clean})
		}
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      []driver.ColumnMeta{{Name: fieldName, DataType: colType, RawType: rawTypeFromBson(colType)}},
			Rows:         rows,
			RowsAffected: int64(len(rows)),
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil
	}

	limit := int64(req.Limit)
	if limit <= 0 {
		limit = 200
	}
	if limitStr != "" {
		if parsedLim, err := strconv.ParseInt(limitStr, 10, 64); err == nil && parsedLim > 0 {
			limit = parsedLim
		}
	}
	offset := int64(req.Offset)
	if offsetStr != "" {
		if parsedOff, err := strconv.ParseInt(offsetStr, 10, 64); err == nil && parsedOff >= 0 {
			offset = parsedOff
		}
	}

	findOpts := options.Find().SetLimit(limit + 1).SetSkip(offset)
	if sortDoc := parseOrderByClause(orderByClause); len(sortDoc) > 0 {
		findOpts.SetSort(sortDoc)
	}
	if selectFields != "*" {
		proj := bson.M{}
		hasID := false
		for _, f := range splitOutsideQuotes(selectFields, ',') {
			fp := stripFieldPath(f)
			if fp == "" {
				continue
			}
			if fp == "_id" {
				hasID = true
			}
			proj[fp] = 1
		}
		if len(proj) > 0 {
			if !hasID {
				proj["_id"] = 0
			}
			findOpts.SetProjection(proj)
		}
	}

	cur, err := coll.Find(ctx, filter, findOpts)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)

	var docs []bson.M
	if err := cur.All(ctx, &docs); err != nil {
		return nil, err
	}

	hasMore := false
	if int64(len(docs)) > limit {
		hasMore = true
		docs = docs[:limit]
	}

	res := docsToQueryResult(docs, time.Since(start), hasMore)
	res.ExecutionID = req.ExecutionID
	res.SourceSchema = dbName
	res.SourceTable = collName
	return res, nil
}

// --- Recursive-descent SQL WHERE parser ---

type whereTokenKind int

const (
	wtEOF whereTokenKind = iota
	wtLParen
	wtRParen
	wtComma
	wtAnd
	wtOr
	wtNot
	wtIs
	wtNull
	wtIn
	wtBetween
	wtLike
	wtOp
	wtString
	wtIdent
	wtNumber
)

type whereToken struct {
	kind whereTokenKind
	val  string
}

func tokenizeWhere(s string) []whereToken {
	var tokens []whereToken
	i := 0
	n := len(s)
	for i < n {
		ch := s[i]
		if unicode.IsSpace(rune(ch)) {
			i++
			continue
		}
		switch ch {
		case '(':
			tokens = append(tokens, whereToken{wtLParen, "("})
			i++
			continue
		case ')':
			tokens = append(tokens, whereToken{wtRParen, ")"})
			i++
			continue
		case ',':
			tokens = append(tokens, whereToken{wtComma, ","})
			i++
			continue
		case '=', '!', '<', '>':
			if i+1 < n {
				two := s[i : i+2]
				if two == "!=" || two == "<>" || two == ">=" || two == "<=" {
					tokens = append(tokens, whereToken{wtOp, two})
					i += 2
					continue
				}
			}
			tokens = append(tokens, whereToken{wtOp, string(ch)})
			i++
			continue
		case '\'':
			val, next := readQuotedSQLString(s, i, '\'')
			tokens = append(tokens, whereToken{wtString, val})
			i = next
			continue
		case '"', '`':
			val, next := readQuotedSQLString(s, i, ch)
			tokens = append(tokens, whereToken{wtIdent, val})
			i = next
			continue
		}

		if (ch >= '0' && ch <= '9') || (ch == '-' && i+1 < n && s[i+1] >= '0' && s[i+1] <= '9') {
			start := i
			i++
			for i < n && ((s[i] >= '0' && s[i] <= '9') || s[i] == '.') {
				i++
			}
			tokens = append(tokens, whereToken{wtNumber, s[start:i]})
			continue
		}

		start := i
		for i < n && !unicode.IsSpace(rune(s[i])) && s[i] != '(' && s[i] != ')' && s[i] != ',' && s[i] != '=' && s[i] != '!' && s[i] != '<' && s[i] != '>' {
			i++
		}
		word := s[start:i]
		upper := strings.ToUpper(word)
		switch upper {
		case "AND":
			tokens = append(tokens, whereToken{wtAnd, upper})
		case "OR":
			tokens = append(tokens, whereToken{wtOr, upper})
		case "NOT":
			tokens = append(tokens, whereToken{wtNot, upper})
		case "IS":
			tokens = append(tokens, whereToken{wtIs, upper})
		case "NULL":
			tokens = append(tokens, whereToken{wtNull, upper})
		case "IN":
			tokens = append(tokens, whereToken{wtIn, upper})
		case "BETWEEN":
			tokens = append(tokens, whereToken{wtBetween, upper})
		case "LIKE":
			tokens = append(tokens, whereToken{wtLike, upper})
		default:
			tokens = append(tokens, whereToken{wtIdent, word})
		}
	}
	tokens = append(tokens, whereToken{wtEOF, ""})
	return tokens
}

func readQuotedSQLString(s string, start int, quote byte) (string, int) {
	i := start + 1
	var sb strings.Builder
	for i < len(s) {
		if s[i] == '\\' && i+1 < len(s) {
			sb.WriteByte(s[i+1])
			i += 2
			continue
		}
		if s[i] == quote {
			if i+1 < len(s) && s[i+1] == quote {
				sb.WriteByte(quote)
				i += 2
				continue
			}
			return sb.String(), i + 1
		}
		sb.WriteByte(s[i])
		i++
	}
	return sb.String(), len(s)
}

type whereParser struct {
	tokens []whereToken
	pos    int
}

func (p *whereParser) peek() whereToken {
	if p.pos >= len(p.tokens) {
		return whereToken{kind: wtEOF}
	}
	return p.tokens[p.pos]
}

func (p *whereParser) next() whereToken {
	tok := p.peek()
	if p.pos < len(p.tokens) {
		p.pos++
	}
	return tok
}

func parseWhereClause(where string) bson.M {
	where = strings.TrimSpace(where)
	if where == "" {
		return bson.M{}
	}
	if strings.HasPrefix(where, "{") && strings.HasSuffix(where, "}") {
		if doc, err := unmarshalExtJSONDoc(where); err == nil {
			m := bson.M{}
			for _, elem := range doc {
				m[elem.Key] = elem.Value
			}
			return m
		}
	}
	p := &whereParser{tokens: tokenizeWhere(where)}
	res := p.parseOr()
	if res == nil {
		return bson.M{}
	}
	return res
}

func (p *whereParser) parseOr() bson.M {
	left := p.parseAnd()
	if left == nil {
		return nil
	}
	orBranches := []bson.M{left}
	for p.peek().kind == wtOr {
		p.next()
		right := p.parseAnd()
		if right != nil {
			orBranches = append(orBranches, right)
		}
	}
	if len(orBranches) == 1 {
		return orBranches[0]
	}
	return bson.M{"$or": orBranches}
}

func (p *whereParser) parseAnd() bson.M {
	left := p.parsePrimary()
	if left == nil {
		return nil
	}
	andBranches := []bson.M{left}
	for p.peek().kind == wtAnd {
		p.next()
		right := p.parsePrimary()
		if right != nil {
			andBranches = append(andBranches, right)
		}
	}
	if len(andBranches) == 1 {
		return andBranches[0]
	}
	// Merge non-conflicting equality/operator keys when possible for readability
	merged := bson.M{}
	canMerge := true
	for _, b := range andBranches {
		for k, v := range b {
			if strings.HasPrefix(k, "$") {
				canMerge = false
				break
			}
			if _, exists := merged[k]; exists {
				canMerge = false
				break
			}
			merged[k] = v
		}
		if !canMerge {
			break
		}
	}
	if canMerge {
		return merged
	}
	return bson.M{"$and": andBranches}
}

func (p *whereParser) parsePrimary() bson.M {
	tok := p.peek()
	if tok.kind == wtLParen {
		p.next()
		inner := p.parseOr()
		if p.peek().kind == wtRParen {
			p.next()
		}
		return inner
	}
	if tok.kind == wtEOF || tok.kind == wtRParen {
		return nil
	}

	fieldTok := p.next()
	field := stripFieldPath(fieldTok.val)
	isID := field == "_id"

	// IS [NOT] NULL
	if p.peek().kind == wtIs {
		p.next()
		isNot := false
		if p.peek().kind == wtNot {
			isNot = true
			p.next()
		}
		if p.peek().kind == wtNull {
			p.next()
		}
		if isNot {
			return bson.M{field: bson.M{"$ne": nil}}
		}
		return bson.M{field: nil}
	}

	// [NOT] IN (...) / [NOT] LIKE ... / [NOT] BETWEEN a AND b
	negated := false
	if p.peek().kind == wtNot {
		negated = true
		p.next()
	}

	switch p.peek().kind {
	case wtIn:
		p.next()
		var vals []any
		if p.peek().kind == wtLParen {
			p.next()
			for p.peek().kind != wtRParen && p.peek().kind != wtEOF {
				if p.peek().kind == wtComma {
					p.next()
					continue
				}
				valTok := p.next()
				vals = append(vals, tokenToWhereScalar(valTok, isID))
			}
			if p.peek().kind == wtRParen {
				p.next()
			}
		}
		if negated {
			return bson.M{field: bson.M{"$nin": vals}}
		}
		return bson.M{field: bson.M{"$in": vals}}

	case wtLike:
		p.next()
		patTok := p.next()
		pattern := regexp.QuoteMeta(patTok.val)
		pattern = strings.ReplaceAll(pattern, "%", ".*")
		pattern = strings.ReplaceAll(pattern, "_", ".")
		regexCond := bson.M{"$regex": "^" + pattern + "$", "$options": "i"}
		if negated {
			return bson.M{field: bson.M{"$not": regexCond}}
		}
		return bson.M{field: regexCond}

	case wtBetween:
		p.next()
		lowTok := p.next()
		if p.peek().kind == wtAnd {
			p.next()
		}
		highTok := p.next()
		low := tokenToWhereScalar(lowTok, isID)
		high := tokenToWhereScalar(highTok, isID)
		if negated {
			return bson.M{"$or": []bson.M{{field: bson.M{"$lt": low}}, {field: bson.M{"$gt": high}}}}
		}
		return bson.M{field: bson.M{"$gte": low, "$lte": high}}

	case wtOp:
		op := p.next().val
		valTok := p.next()
		val := tokenToWhereScalar(valTok, isID)
		switch op {
		case "=":
			return bson.M{field: val}
		case "!=", "<>":
			return bson.M{field: bson.M{"$ne": val}}
		case ">":
			return bson.M{field: bson.M{"$gt": val}}
		case ">=":
			return bson.M{field: bson.M{"$gte": val}}
		case "<":
			return bson.M{field: bson.M{"$lt": val}}
		case "<=":
			return bson.M{field: bson.M{"$lte": val}}
		}
	}

	return nil
}

func tokenToWhereScalar(tok whereToken, isID bool) any {
	if tok.kind == wtString {
		if isID {
			return parseID(tok.val)
		}
		return tok.val
	}
	if tok.kind == wtNull {
		return nil
	}
	return parseWhereScalar(tok.val, isID)
}

func parseWhereScalar(raw string, isID bool) any {
	v := strings.TrimSpace(raw)
	wasQuoted := len(v) >= 2 && ((v[0] == '\'' && v[len(v)-1] == '\'') || (v[0] == '"' && v[len(v)-1] == '"'))
	if wasQuoted {
		v = v[1 : len(v)-1]
	}
	if isID {
		return parseID(v)
	}
	if wasQuoted {
		return v
	}
	if strings.EqualFold(v, "true") {
		return true
	}
	if strings.EqualFold(v, "false") {
		return false
	}
	if strings.EqualFold(v, "null") {
		return nil
	}
	if num, err := strconv.ParseInt(v, 10, 64); err == nil {
		return num
	}
	if f, err := strconv.ParseFloat(v, 64); err == nil {
		return f
	}
	return v
}

// Unused import guard for mongo if needed in future
var _ = mongo.ErrNoDocuments
