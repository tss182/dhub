package mongodb

import (
	"math"
	"strings"
	"testing"
	"time"

	"dhub/internal/driver"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestStripCollectionAndFieldQuotes(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{`"users"`, "users"},
		{"`users`", "users"},
		{"[users]", "users"},
		{`'users'`, "users"},
		{`mydb."users"`, "users"},
		{"mydb.users", "users"},
	}

	for _, tt := range tests {
		got := stripCollectionName(tt.input)
		if got != tt.expected {
			t.Errorf("stripCollectionName(%q) = %q; want %q", tt.input, got, tt.expected)
		}
	}
}

func TestParseWhereClause(t *testing.T) {
	w1 := parseWhereClause("name = 'Alice'")
	if w1["name"] != "Alice" {
		t.Errorf("expected Alice, got %v", w1["name"])
	}

	w2 := parseWhereClause("age = 25")
	if w2["age"] != int64(25) {
		t.Errorf("expected 25, got %v", w2["age"])
	}

	w3 := parseWhereClause(`{"status": "active"}`)
	if w3["status"] != "active" {
		t.Errorf("expected active, got %v", w3["status"])
	}

	// OR / IN / IS NOT NULL / BETWEEN
	w4 := parseWhereClause("status IN ('active', 'pending') AND deleted_at IS NULL")
	if _, ok := w4["status"].(bson.M); !ok {
		t.Fatalf("expected bson.M for IN clause, got %T", w4["status"])
	}
	if _, hasDeleted := w4["deleted_at"]; !hasDeleted {
		t.Errorf("expected deleted_at key in parsed filter")
	}

	w5 := parseWhereClause("(role = 'admin' OR role = 'owner')")
	if _, ok := w5["$or"]; !ok {
		t.Errorf("expected $or branch, got %v", w5)
	}

	w6 := parseWhereClause("score BETWEEN 10 AND 50")
	if cond, ok := w6["score"].(bson.M); !ok || cond["$gte"] != int64(10) || cond["$lte"] != int64(50) {
		t.Errorf("unexpected BETWEEN filter: %v", w6)
	}
}

func TestParseOrderByClause(t *testing.T) {
	sortDoc := parseOrderByClause("profile.age DESC, name ASC")
	if len(sortDoc) != 2 {
		t.Fatalf("expected 2 sort keys, got %d", len(sortDoc))
	}
	if sortDoc[0].Key != "profile.age" || sortDoc[0].Value != int32(-1) {
		t.Errorf("unexpected first sort key: %+v", sortDoc[0])
	}
	if sortDoc[1].Key != "name" || sortDoc[1].Value != int32(1) {
		t.Errorf("unexpected second sort key: %+v", sortDoc[1])
	}
}

func TestParseID(t *testing.T) {
	hex := "507f1f77bcf86cd799439011"
	oid := parseID(hex)
	if _, ok := oid.(primitive.ObjectID); !ok {
		t.Errorf("expected primitive.ObjectID, got %T", oid)
	}

	withWrapper := `ObjectId("507f1f77bcf86cd799439011")`
	oid2 := parseID(withWrapper)
	if _, ok := oid2.(primitive.ObjectID); !ok {
		t.Errorf("expected primitive.ObjectID, got %T", oid2)
	}

	normalStr := "user_123"
	s := parseID(normalStr)
	if s != "user_123" {
		t.Errorf("expected user_123, got %v", s)
	}
}

func TestBsonValueToCleanValue(t *testing.T) {
	nestedD := primitive.D{
		{Key: "city", Value: "Jakarta"},
		{Key: "zip", Value: int32(10110)},
	}
	cleaned := bsonValueToCleanValue(nestedD)
	m, ok := cleaned.(map[string]any)
	if !ok {
		t.Fatalf("expected map[string]any, got %T", cleaned)
	}
	if m["city"] != "Jakarta" || m["zip"] != int32(10110) {
		t.Errorf("unexpected cleaned primitive.D: %v", m)
	}

	if bsonValueToCleanValue(math.NaN()) != "NaN" {
		t.Errorf("expected NaN string for math.NaN()")
	}
	if bsonValueToCleanValue(math.Inf(1)) != "Infinity" {
		t.Errorf("expected Infinity string for +Inf")
	}
}

func TestCoerceValueForBson(t *testing.T) {
	dt := coerceValueForBson("2026-01-15T10:00:00Z", "date")
	if _, ok := dt.(primitive.DateTime); !ok {
		t.Errorf("expected primitive.DateTime, got %T", dt)
	}
	dec := coerceValueForBson("123.45", "decimal")
	if _, ok := dec.(primitive.Decimal128); !ok {
		t.Errorf("expected primitive.Decimal128, got %T", dec)
	}
	num := coerceValueForBson("42", "int")
	if n32, ok := num.(int32); !ok || n32 != 42 {
		t.Errorf("expected int32(42), got %T(%v)", num, num)
	}
}

func TestNormalizeMongoShellJSON(t *testing.T) {
	in := `{ _id: ObjectId('507f1f77bcf86cd799439011'), name: 'Alice', createdAt: ISODate("2026-01-01T00:00:00Z"), tag: /^admin/i, }`
	out := normalizeMongoShellJSON(in)
	var doc bson.M
	if err := bson.UnmarshalExtJSON([]byte(out), false, &doc); err != nil {
		t.Fatalf("normalized shell JSON failed UnmarshalExtJSON: %v (output=%s)", err, out)
	}
	if doc["name"] != "Alice" {
		t.Errorf("expected name Alice, got %v", doc["name"])
	}
	if _, ok := doc["_id"].(primitive.ObjectID); !ok {
		t.Errorf("expected ObjectID, got %T", doc["_id"])
	}
	if _, ok := doc["createdAt"].(primitive.DateTime); !ok {
		t.Errorf("expected DateTime, got %T", doc["createdAt"])
	}
}

func TestShellParser(t *testing.T) {
	script := `
use analytics;
show collections;
db.getCollection("user.events").find({ active: true }).sort({ ts: -1 }).limit(10);
`
	stmts := splitMongoShellStatements(script)
	if len(stmts) != 3 {
		t.Fatalf("expected 3 statements, got %d: %v", len(stmts), stmts)
	}

	p0, err := parseMongoStatement(stmts[0])
	if err != nil || p0.kind != stmtUseDB || p0.target != "analytics" {
		t.Fatalf("unexpected stmt 0: %+v, err=%v", p0, err)
	}

	p1, err := parseMongoStatement(stmts[1])
	if err != nil || p1.kind != stmtShow || p1.target != "collections" {
		t.Fatalf("unexpected stmt 1: %+v, err=%v", p1, err)
	}

	p2, err := parseMongoStatement(stmts[2])
	if err != nil || p2.kind != stmtCollMethod || p2.target != "user.events" || len(p2.calls) != 3 {
		t.Fatalf("unexpected stmt 2: %+v, err=%v", p2, err)
	}
}

func TestDocsToQueryResult(t *testing.T) {
	oid, _ := primitive.ObjectIDFromHex("507f1f77bcf86cd799439011")
	doc1 := bson.M{
		"_id":     oid,
		"name":    "Alice",
		"age":     int32(28),
		"profile": primitive.D{{Key: "tier", Value: "pro"}},
	}
	doc2 := bson.M{
		"_id":   "custom_id",
		"name":  "Bob",
		"email": "bob@example.com",
	}

	qr := docsToQueryResult([]bson.M{doc1, doc2}, 10*time.Millisecond, true)
	if len(qr.Rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(qr.Rows))
	}
	if !qr.HasMore {
		t.Errorf("expected HasMore=true")
	}
	if qr.Columns[0].Name != "_id" || !qr.Columns[0].IsPrimaryKey {
		t.Errorf("expected first column to be _id PK, got %+v", qr.Columns[0])
	}
	if qr.Rows[0][0] != "507f1f77bcf86cd799439011" {
		t.Errorf("expected hex id string, got %v", qr.Rows[0][0])
	}
}

func TestGenerateDMLPreview(t *testing.T) {
	drv := &MongoDBDriver{}

	changes := []driver.RowChange{
		{
			Type: "insert",
			Changes: map[string]any{
				"name": "Charlie",
				"age":  35,
			},
		},
		{
			Type: "update",
			PrimaryKey: map[string]any{
				"_id": "507f1f77bcf86cd799439011",
			},
			Changes: map[string]any{
				"name":       "Charlie Updated",
				"deprecated": nil,
			},
		},
		{
			Type: "delete",
			PrimaryKey: map[string]any{
				"_id": "507f1f77bcf86cd799439011",
			},
		},
	}

	stmts, err := drv.GenerateDMLPreview("mydb", "mydb", "users", changes)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(stmts) != 3 {
		t.Fatalf("expected 3 statements, got %d", len(stmts))
	}
	if !strings.HasPrefix(stmts[0], "db.users.insertOne(") {
		t.Errorf("statement 0 mismatch: %s", stmts[0])
	}
	if !strings.HasPrefix(stmts[1], "db.users.updateOne(") || !strings.Contains(stmts[1], "deprecated: null") {
		t.Errorf("statement 1 mismatch (expected deprecated: null): %s", stmts[1])
	}
	if !strings.HasPrefix(stmts[2], "db.users.deleteOne(") {
		t.Errorf("statement 2 mismatch: %s", stmts[2])
	}
}
