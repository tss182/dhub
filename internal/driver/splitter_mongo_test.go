package driver

import "testing"

func TestSplitMongoStatements(t *testing.T) {
	script := `
// comment with ; inside
use shop;
db.orders.find({ status: { $in: ["paid", "shipped"] } })
  .sort({ createdAt: -1 })
  .limit(20);
show collections
`
	stmts := SplitMongoStatements(script)
	if len(stmts) != 3 {
		t.Fatalf("expected 3 statements, got %d: %#v", len(stmts), stmts)
	}
}

func TestIsReadOnlySafeMongoQuery(t *testing.T) {
	safe := []string{
		`use shop`,
		`show collections`,
		`db.users.find({ active: true }).limit(10)`,
		`db.users.aggregate([{ $match: { active: true } }, { $count: "n" }])`,
		`db.users.find({}).explain("executionStats")`,
		`SELECT * FROM users WHERE age > 20`,
		`rs.status()`,
	}
	for _, q := range safe {
		if !IsReadOnlySafeMongoQuery(q) {
			t.Errorf("expected read-only safe: %s", q)
		}
	}

	unsafe := []string{
		`db.users.insertOne({ name: "a" })`,
		`db.users.updateMany({}, { $set: { x: 1 } })`,
		`db.users.deleteMany({})`,
		`db.users.drop()`,
		`db.dropDatabase()`,
		`db.users.aggregate([{ $match: {} }, { $out: "backup" }])`,
		`db.users.aggregate([{ $match: {} }, { $merge: "target" }])`,
		`db.users.aggregate([{ $match: {} }, { "\$out": "backup" }])`,
		`db.users.drop (".find(")`,
		`db.users.deleteMany ({ "$comment": ".find(" })`,
		`db.runCommand({ dropDatabase: 1, comment: "ping" })`,
		`{ drop: "accounts" }`,
		`db.createUser({ user: "u", pwd: "p", roles: [] })`,
	}
	for _, q := range unsafe {
		if IsReadOnlySafeMongoQuery(q) {
			t.Errorf("expected read-only BLOCKED: %s", q)
		}
	}
}
