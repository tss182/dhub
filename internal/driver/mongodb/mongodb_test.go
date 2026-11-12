package mongodb

import (
	"strings"
	"testing"

	"dhub/internal/driver"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestStripQuotes(t *testing.T) {
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
		got := stripQuotes(tt.input)
		if got != tt.expected {
			t.Errorf("stripQuotes(%q) = %q; want %q", tt.input, got, tt.expected)
		}
	}
}

func TestParseWhereClause(t *testing.T) {
	// Simple string equality
	w1 := parseWhereClause("name = 'Alice'")
	if w1["name"] != "Alice" {
		t.Errorf("expected Alice, got %v", w1["name"])
	}

	// Simple int equality
	w2 := parseWhereClause("age = 25")
	if w2["age"] != int64(25) {
		t.Errorf("expected 25, got %v", w2["age"])
	}

	// JSON filter
	w3 := parseWhereClause(`{"status": "active"}`)
	if w3["status"] != "active" {
		t.Errorf("expected active, got %v", w3["status"])
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

func TestDocsToQueryResult(t *testing.T) {
	oid, _ := primitive.ObjectIDFromHex("507f1f77bcf86cd799439011")
	doc1 := bson.D{
		{Key: "_id", Value: oid},
		{Key: "name", Value: "Alice"},
		{Key: "age", Value: int32(28)},
	}
	doc2 := bson.D{
		{Key: "_id", Value: "custom_id"},
		{Key: "name", Value: "Bob"},
		{Key: "email", Value: "bob@example.com"},
	}

	qr := docsToQueryResult("test-exec", "mydb", "users", []bson.D{doc1, doc2}, 10)

	if len(qr.Rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(qr.Rows))
	}
	if len(qr.Columns) < 3 {
		t.Fatalf("expected at least 3 columns, got %d", len(qr.Columns))
	}

	// _id must be first column
	if qr.Columns[0].Name != "_id" {
		t.Errorf("expected first column to be _id, got %s", qr.Columns[0].Name)
	}
	if !qr.Columns[0].IsPrimaryKey {
		t.Errorf("expected _id to be primary key")
	}

	// First row _id should be hex string
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
				"name": "Charlie Updated",
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
	if !strings.HasPrefix(stmts[1], "db.users.updateOne(") {
		t.Errorf("statement 1 mismatch: %s", stmts[1])
	}
	if !strings.HasPrefix(stmts[2], "db.users.deleteOne(") {
		t.Errorf("statement 2 mismatch: %s", stmts[2])
	}
}
