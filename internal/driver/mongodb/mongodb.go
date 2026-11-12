package mongodb

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"dhub/internal/driver"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

type MongoDBDriver struct {
	client    *mongo.Client
	uri       string
	defaultDB string
}

func NewMongoDBDriver(uri string) (*MongoDBDriver, error) {
	defaultDB := ""
	if u, err := url.Parse(uri); err == nil {
		path := strings.TrimPrefix(u.Path, "/")
		if path != "" {
			defaultDB = path
		}
	}
	if defaultDB == "" {
		defaultDB = "admin"
	}

	clientOpts := options.Client().ApplyURI(uri)
	client, err := mongo.Connect(context.Background(), clientOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to mongodb: %w", err)
	}

	return &MongoDBDriver{
		client:    client,
		uri:       uri,
		defaultDB: defaultDB,
	}, nil
}

func (m *MongoDBDriver) Ping(ctx context.Context) error {
	return m.client.Ping(ctx, readpref.Primary())
}

func (m *MongoDBDriver) Close() error {
	if m.client != nil {
		return m.client.Disconnect(context.Background())
	}
	return nil
}

func (m *MongoDBDriver) targetDatabase(database string) string {
	database = strings.TrimSpace(database)
	if database == "" || database == "main" {
		return m.defaultDB
	}
	return database
}

func (m *MongoDBDriver) ListDatabases(ctx context.Context) ([]string, error) {
	names, err := m.client.ListDatabaseNames(ctx, bson.M{})
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	return names, nil
}

func (m *MongoDBDriver) ListSchemas(ctx context.Context, database string) ([]string, error) {
	dbName := m.targetDatabase(database)
	return []string{dbName}, nil
}

func (m *MongoDBDriver) ListObjects(ctx context.Context, database, schema string) ([]driver.ObjectSummary, error) {
	dbName := m.targetDatabase(database)
	db := m.client.Database(dbName)

	cur, err := db.ListCollections(ctx, bson.M{})
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)

	var objects []driver.ObjectSummary
	for cur.Next(ctx) {
		var elem struct {
			Name string `bson:"name"`
			Type string `bson:"type"`
		}
		if err := cur.Decode(&elem); err != nil {
			continue
		}

		collType := "table"
		if elem.Type == "view" {
			collType = "view"
		}

		// Fast estimate of document count
		count, _ := db.Collection(elem.Name).EstimatedDocumentCount(ctx)

		objects = append(objects, driver.ObjectSummary{
			Schema:      dbName,
			Name:        elem.Name,
			Type:        collType,
			RowEstimate: count,
		})
	}

	sort.Slice(objects, func(i, j int) bool {
		return objects[i].Name < objects[j].Name
	})

	return objects, nil
}

func (m *MongoDBDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	dbName := m.targetDatabase(database)
	coll := m.client.Database(dbName).Collection(table)

	structure := &driver.TableStructure{
		Schema:      dbName,
		Name:        table,
		Columns:     []driver.ColumnMeta{},
		PrimaryKeys: []string{"_id"},
		ForeignKeys: []driver.ForeignKeyMeta{},
		Indexes:     []driver.IndexMeta{},
	}

	// 1. Sample up to 50 documents to inspect fields and data types
	cur, err := coll.Find(ctx, bson.M{}, options.Find().SetLimit(50))
	if err == nil {
		defer cur.Close(ctx)
		fieldTypes := make(map[string]string)
		var fieldOrder []string

		for cur.Next(ctx) {
			var doc bson.D
			if err := cur.Decode(&doc); err != nil {
				continue
			}
			for _, elem := range doc {
				t := inferBsonType(elem.Value)
				if _, exists := fieldTypes[elem.Key]; !exists {
					fieldTypes[elem.Key] = t
					fieldOrder = append(fieldOrder, elem.Key)
				}
			}
		}

		// Ensure _id is first
		hasID := false
		for _, f := range fieldOrder {
			if f == "_id" {
				hasID = true
				break
			}
		}
		if !hasID {
			fieldOrder = append([]string{"_id"}, fieldOrder...)
			fieldTypes["_id"] = "objectId"
		} else {
			// Move _id to front
			var reordered []string
			reordered = append(reordered, "_id")
			for _, f := range fieldOrder {
				if f != "_id" {
					reordered = append(reordered, f)
				}
			}
			fieldOrder = reordered
		}

		for _, name := range fieldOrder {
			t := fieldTypes[name]
			if t == "" {
				t = "string"
			}
			structure.Columns = append(structure.Columns, driver.ColumnMeta{
				Name:         name,
				DataType:     t,
				RawType:      rawTypeFromBson(t),
				IsPrimaryKey: name == "_id",
				IsNullable:   name != "_id",
			})
		}
	}

	// Default fallback if collection is empty
	if len(structure.Columns) == 0 {
		structure.Columns = []driver.ColumnMeta{
			{Name: "_id", DataType: "objectId", RawType: "string", IsPrimaryKey: true},
		}
	}

	// 2. Fetch Indexes
	if idxCur, idxErr := coll.Indexes().List(ctx); idxErr == nil {
		defer idxCur.Close(ctx)
		for idxCur.Next(ctx) {
			var idxDoc bson.M
			if err := idxCur.Decode(&idxDoc); err != nil {
				continue
			}
			idxName, _ := idxDoc["name"].(string)
			isUnique, _ := idxDoc["unique"].(bool)

			var cols []string
			if keyDoc, ok := idxDoc["key"].(bson.M); ok {
				for k := range keyDoc {
					cols = append(cols, k)
				}
			} else if keyD, ok := idxDoc["key"].(primitive.D); ok {
				for _, elem := range keyD {
					cols = append(cols, elem.Key)
				}
			}

			structure.Indexes = append(structure.Indexes, driver.IndexMeta{
				Name:      idxName,
				Columns:   cols,
				IsUnique:  isUnique,
				IsPrimary: idxName == "_id_",
				Type:      "B-Tree",
			})
		}
	}

	// 3. Generate DDL preview
	structure.DDL = fmt.Sprintf("db.createCollection(\"%s\");", table)
	for _, idx := range structure.Indexes {
		if idx.IsPrimary {
			continue
		}
		var keys []string
		for _, c := range idx.Columns {
			keys = append(keys, fmt.Sprintf("\"%s\": 1", c))
		}
		uniqueStr := ""
		if idx.IsUnique {
			uniqueStr = ", { unique: true }"
		}
		structure.DDL += fmt.Sprintf("\n\ndb.%s.createIndex({ %s }%s);", table, strings.Join(keys, ", "), uniqueStr)
	}

	return structure, nil
}

func inferBsonType(v any) string {
	if v == nil {
		return "null"
	}
	switch v.(type) {
	case primitive.ObjectID:
		return "objectId"
	case string:
		return "string"
	case int, int32:
		return "int32"
	case int64:
		return "int64"
	case float32, float64:
		return "double"
	case bool:
		return "boolean"
	case primitive.DateTime, time.Time:
		return "date"
	case primitive.A, []any:
		return "array"
	case primitive.D, primitive.M, map[string]any:
		return "object"
	default:
		return fmt.Sprintf("%T", v)
	}
}

func rawTypeFromBson(t string) string {
	switch t {
	case "int32", "int64", "double":
		return "number"
	case "boolean":
		return "boolean"
	case "date":
		return "date"
	case "array", "object":
		return "json"
	default:
		return "string"
	}
}

func stripQuotes(s string) string {
	s = strings.TrimSpace(s)
	if strings.Contains(s, ".") {
		parts := strings.SplitN(s, ".", 2)
		s = parts[1]
	}
	s = strings.Trim(s, "\"`'[]")
	return s
}

func parseID(val any) any {
	if s, ok := val.(string); ok {
		s = strings.TrimSpace(s)
		s = strings.TrimPrefix(s, "ObjectId(\"")
		s = strings.TrimPrefix(s, "ObjectId('")
		s = strings.TrimSuffix(s, "\")")
		s = strings.TrimSuffix(s, "')")
		if oid, err := primitive.ObjectIDFromHex(s); err == nil {
			return oid
		}
		return s
	}
	return val
}

func bsonValueToAny(v any) any {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case primitive.ObjectID:
		return val.Hex()
	case primitive.DateTime:
		return val.Time().Format(time.RFC3339)
	case time.Time:
		return val.Format(time.RFC3339)
	case primitive.A, []any, primitive.D, primitive.M, map[string]any:
		b, err := json.Marshal(val)
		if err == nil {
			return string(b)
		}
		return fmt.Sprintf("%v", val)
	default:
		return val
	}
}

func docsToQueryResult(execID, dbName, collName string, docs []bson.D, elapsedMs int64) *driver.QueryResult {
	fieldSet := make(map[string]bool)
	var colNames []string

	// Scan all documents to collect columns
	for _, doc := range docs {
		for _, elem := range doc {
			if !fieldSet[elem.Key] {
				fieldSet[elem.Key] = true
				colNames = append(colNames, elem.Key)
			}
		}
	}

	// Ensure _id is first if present
	var orderedCols []string
	if fieldSet["_id"] {
		orderedCols = append(orderedCols, "_id")
	}
	for _, c := range colNames {
		if c != "_id" {
			orderedCols = append(orderedCols, c)
		}
	}

	columns := make([]driver.ColumnMeta, len(orderedCols))
	for i, colName := range orderedCols {
		isPK := colName == "_id"
		columns[i] = driver.ColumnMeta{
			Name:         colName,
			DataType:     "string",
			RawType:      "string",
			IsPrimaryKey: isPK,
			IsNullable:   !isPK,
		}
	}

	rows := make([][]any, len(docs))
	for rIdx, doc := range docs {
		docMap := make(map[string]any, len(doc))
		for _, elem := range doc {
			docMap[elem.Key] = elem.Value
		}
		row := make([]any, len(orderedCols))
		for cIdx, colName := range orderedCols {
			if val, ok := docMap[colName]; ok {
				row[cIdx] = bsonValueToAny(val)
			} else {
				row[cIdx] = nil
			}
		}
		rows[rIdx] = row
	}

	return &driver.QueryResult{
		ExecutionID:  execID,
		Columns:      columns,
		Rows:         rows,
		RowsAffected: int64(len(rows)),
		ElapsedMs:    elapsedMs,
		IsEditable:   true,
		SourceSchema: dbName,
		SourceTable:  collName,
		PrimaryKeys:  []string{"_id"},
	}
}

var (
	sqlSelectCountRegex = regexp.MustCompile(`(?i)^\s*SELECT\s+COUNT\(\*\)\s+FROM\s+([^\s;]+)(?:\s+WHERE\s+(.+?))?\s*;?\s*$`)
	sqlSelectRegex      = regexp.MustCompile(`(?i)^\s*SELECT\s+(.+?)\s+FROM\s+([^\s;]+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?\s*;?\s*$`)
	mongoShellCmdRegex  = regexp.MustCompile(`(?i)^\s*db\.([a-zA-Z0-9_$-]+)\.([a-zA-Z0-9_]+)\s*\(([\s\S]*)\)\s*;?\s*$`)
)

func (m *MongoDBDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	start := time.Now()
	dbName := m.targetDatabase(req.Database)
	rawSQL := strings.TrimSpace(req.SQL)

	if rawSQL == "" {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []driver.ColumnMeta{},
			Rows:        [][]any{},
			ElapsedMs:   0,
		}, nil
	}

	// 1. SHOW DATABASES / SHOW DBS
	if strings.EqualFold(rawSQL, "SHOW DBS") || strings.EqualFold(rawSQL, "SHOW DATABASES") || strings.EqualFold(rawSQL, "SHOW DATABASES;") {
		dbs, err := m.ListDatabases(ctx)
		if err != nil {
			return nil, err
		}
		rows := make([][]any, len(dbs))
		for i, d := range dbs {
			rows[i] = []any{d}
		}
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns:     []driver.ColumnMeta{{Name: "database", DataType: "string", RawType: "string"}},
			Rows:        rows,
			ElapsedMs:   time.Since(start).Milliseconds(),
		}, nil
	}

	// 2. SHOW COLLECTIONS / SHOW TABLES
	if strings.EqualFold(rawSQL, "SHOW COLLECTIONS") || strings.EqualFold(rawSQL, "SHOW TABLES") || strings.EqualFold(rawSQL, "SHOW COLLECTIONS;") {
		objs, err := m.ListObjects(ctx, dbName, dbName)
		if err != nil {
			return nil, err
		}
		rows := make([][]any, len(objs))
		for i, o := range objs {
			rows[i] = []any{o.Name, o.Type, o.RowEstimate}
		}
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns: []driver.ColumnMeta{
				{Name: "collection", DataType: "string", RawType: "string"},
				{Name: "type", DataType: "string", RawType: "string"},
				{Name: "count", DataType: "int64", RawType: "number"},
			},
			Rows:      rows,
			ElapsedMs: time.Since(start).Milliseconds(),
		}, nil
	}

	// 3. Pseudo-SQL SELECT COUNT(*) FROM <table>
	if match := sqlSelectCountRegex.FindStringSubmatch(rawSQL); len(match) > 1 {
		collName := stripQuotes(match[1])
		filter := bson.M{}
		if len(match) > 2 && strings.TrimSpace(match[2]) != "" {
			filter = parseWhereClause(match[2])
		}
		coll := m.client.Database(dbName).Collection(collName)
		count, err := coll.CountDocuments(ctx, filter)
		if err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns: []driver.ColumnMeta{
				{Name: "count", DataType: "int64", RawType: "number"},
			},
			Rows:         [][]any{{count}},
			RowsAffected: 1,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil
	}

	// 4. Pseudo-SQL SELECT ... FROM <table>
	if match := sqlSelectRegex.FindStringSubmatch(rawSQL); len(match) > 2 {
		collName := stripQuotes(match[2])
		coll := m.client.Database(dbName).Collection(collName)

		filter := bson.M{}
		if match[3] != "" {
			filter = parseWhereClause(match[3])
		}

		findOpts := options.Find()
		limit := int64(100)
		if match[5] != "" {
			if l, err := strconv.ParseInt(match[5], 10, 64); err == nil && l > 0 {
				limit = l
			}
		} else if req.Limit > 0 {
			limit = int64(req.Limit)
		}
		findOpts.SetLimit(limit)

		offset := int64(0)
		if match[6] != "" {
			if o, err := strconv.ParseInt(match[6], 10, 64); err == nil && o >= 0 {
				offset = o
			}
		} else if req.Offset > 0 {
			offset = int64(req.Offset)
		}
		if offset > 0 {
			findOpts.SetSkip(offset)
		}

		// Projection
		fieldsStr := strings.TrimSpace(match[1])
		if fieldsStr != "*" && fieldsStr != "" {
			proj := bson.M{}
			for _, f := range strings.Split(fieldsStr, ",") {
				cleanF := stripQuotes(f)
				if cleanF != "" {
					proj[cleanF] = 1
				}
			}
			if len(proj) > 0 {
				findOpts.SetProjection(proj)
			}
		}

		cur, err := coll.Find(ctx, filter, findOpts)
		if err != nil {
			return nil, err
		}
		defer cur.Close(ctx)

		var docs []bson.D
		for cur.Next(ctx) {
			var doc bson.D
			if err := cur.Decode(&doc); err == nil {
				docs = append(docs, doc)
			}
		}

		return docsToQueryResult(req.ExecutionID, dbName, collName, docs, time.Since(start).Milliseconds()), nil
	}

	// 5. Mongo Shell Syntax: db.<collection>.<method>(...)
	if match := mongoShellCmdRegex.FindStringSubmatch(rawSQL); len(match) >= 3 {
		collName := match[1]
		method := strings.ToLower(match[2])
		argsRaw := strings.TrimSpace(match[3])
		return m.executeMongoShellMethod(ctx, req.ExecutionID, dbName, collName, method, argsRaw, start)
	}

	// 6. JSON Command: {"command": ...}
	if strings.HasPrefix(rawSQL, "{") && strings.HasSuffix(rawSQL, "}") {
		var cmdDoc bson.D
		if err := bson.UnmarshalExtJSON([]byte(rawSQL), true, &cmdDoc); err == nil {
			var resDoc bson.D
			err := m.client.Database(dbName).RunCommand(ctx, cmdDoc).Decode(&resDoc)
			if err != nil {
				return nil, err
			}
			return docsToQueryResult(req.ExecutionID, dbName, "", []bson.D{resDoc}, time.Since(start).Milliseconds()), nil
		}
	}

	return nil, fmt.Errorf("unsupported MongoDB query or command: %s", rawSQL)
}

func (m *MongoDBDriver) executeMongoShellMethod(
	ctx context.Context,
	execID, dbName, collName, method, argsRaw string,
	start time.Time,
) (*driver.QueryResult, error) {
	coll := m.client.Database(dbName).Collection(collName)

	switch method {
	case "find":
		filter := bson.M{}
		if argsRaw != "" {
			_ = bson.UnmarshalExtJSON([]byte(argsRaw), true, &filter)
		}
		cur, err := coll.Find(ctx, filter, options.Find().SetLimit(100))
		if err != nil {
			return nil, err
		}
		defer cur.Close(ctx)

		var docs []bson.D
		for cur.Next(ctx) {
			var doc bson.D
			if err := cur.Decode(&doc); err == nil {
				docs = append(docs, doc)
			}
		}
		return docsToQueryResult(execID, dbName, collName, docs, time.Since(start).Milliseconds()), nil

	case "countdocuments", "count":
		filter := bson.M{}
		if argsRaw != "" {
			_ = bson.UnmarshalExtJSON([]byte(argsRaw), true, &filter)
		}
		count, err := coll.CountDocuments(ctx, filter)
		if err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID:  execID,
			Columns:      []driver.ColumnMeta{{Name: "count", DataType: "int64", RawType: "number"}},
			Rows:         [][]any{{count}},
			RowsAffected: 1,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil

	case "insertone":
		var doc bson.M
		if err := bson.UnmarshalExtJSON([]byte(argsRaw), true, &doc); err != nil {
			return nil, fmt.Errorf("invalid json in insertOne: %w", err)
		}
		res, err := coll.InsertOne(ctx, doc)
		if err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID:  execID,
			Columns:      []driver.ColumnMeta{{Name: "insertedId", DataType: "string", RawType: "string"}},
			Rows:         [][]any{{fmt.Sprintf("%v", res.InsertedID)}},
			RowsAffected: 1,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil

	case "deleteone":
		var filter bson.M
		if err := bson.UnmarshalExtJSON([]byte(argsRaw), true, &filter); err != nil {
			return nil, fmt.Errorf("invalid filter json in deleteOne: %w", err)
		}
		res, err := coll.DeleteOne(ctx, filter)
		if err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID:  execID,
			Columns:      []driver.ColumnMeta{{Name: "deletedCount", DataType: "int64", RawType: "number"}},
			Rows:         [][]any{{res.DeletedCount}},
			RowsAffected: res.DeletedCount,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil

	case "deletemany":
		var filter bson.M
		if err := bson.UnmarshalExtJSON([]byte(argsRaw), true, &filter); err != nil {
			return nil, fmt.Errorf("invalid filter json in deleteMany: %w", err)
		}
		res, err := coll.DeleteMany(ctx, filter)
		if err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID:  execID,
			Columns:      []driver.ColumnMeta{{Name: "deletedCount", DataType: "int64", RawType: "number"}},
			Rows:         [][]any{{res.DeletedCount}},
			RowsAffected: res.DeletedCount,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil

	case "drop":
		err := coll.Drop(ctx)
		if err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID:  execID,
			Columns:      []driver.ColumnMeta{{Name: "result", DataType: "string", RawType: "string"}},
			Rows:         [][]any{{"collection dropped"}},
			RowsAffected: 1,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil

	default:
		return nil, fmt.Errorf("unsupported MongoDB method: %s", method)
	}
}

func parseWhereClause(where string) bson.M {
	where = strings.TrimSpace(where)
	if strings.HasPrefix(where, "{") && strings.HasSuffix(where, "}") {
		var m bson.M
		if err := bson.UnmarshalExtJSON([]byte(where), true, &m); err == nil {
			return m
		}
	}

	filter := bson.M{}
	// Simple equality: field = 'val' or field = 123
	eqParts := strings.SplitN(where, "=", 2)
	if len(eqParts) == 2 {
		k := stripQuotes(eqParts[0])
		v := strings.TrimSpace(eqParts[1])
		v = strings.Trim(v, "'\"")
		if k == "_id" {
			filter[k] = parseID(v)
		} else if num, err := strconv.ParseInt(v, 10, 64); err == nil {
			filter[k] = num
		} else {
			filter[k] = v
		}
	}
	return filter
}

func (m *MongoDBDriver) BeginTx(ctx context.Context, database string) (*sql.Tx, error) {
	return nil, nil
}

func (m *MongoDBDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string

	for _, c := range changes {
		switch c.Type {
		case "insert":
			b, _ := json.Marshal(c.Changes)
			statements = append(statements, fmt.Sprintf("db.%s.insertOne(%s);", table, string(b)))
		case "update":
			filterMap := make(map[string]any)
			for k, v := range c.PrimaryKey {
				filterMap[k] = parseID(v)
			}
			fBytes, _ := json.Marshal(filterMap)
			sBytes, _ := json.Marshal(c.Changes)
			statements = append(statements, fmt.Sprintf("db.%s.updateOne(%s, { \"$set\": %s });", table, string(fBytes), string(sBytes)))
		case "delete":
			filterMap := make(map[string]any)
			for k, v := range c.PrimaryKey {
				filterMap[k] = parseID(v)
			}
			fBytes, _ := json.Marshal(filterMap)
			statements = append(statements, fmt.Sprintf("db.%s.deleteOne(%s);", table, string(fBytes)))
		}
	}

	return statements, nil
}

func (m *MongoDBDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	dbName := m.targetDatabase(database)
	coll := m.client.Database(dbName).Collection(table)

	var totalAffected int64
	for _, c := range changes {
		switch c.Type {
		case "insert":
			doc := bson.M{}
			for k, v := range c.Changes {
				if k == "_id" {
					doc[k] = parseID(v)
				} else {
					doc[k] = v
				}
			}
			res, err := coll.InsertOne(ctx, doc)
			if err != nil {
				return totalAffected, fmt.Errorf("failed to insert document: %w", err)
			}
			if res.InsertedID != nil {
				totalAffected++
			}
		case "update":
			filter := bson.M{}
			for k, v := range c.PrimaryKey {
				filter[k] = parseID(v)
			}
			updateDoc := bson.M{}
			for k, v := range c.Changes {
				if k == "_id" {
					continue
				}
				updateDoc[k] = v
			}
			res, err := coll.UpdateOne(ctx, filter, bson.M{"$set": updateDoc})
			if err != nil {
				return totalAffected, fmt.Errorf("failed to update document: %w", err)
			}
			totalAffected += res.ModifiedCount
		case "delete":
			filter := bson.M{}
			for k, v := range c.PrimaryKey {
				filter[k] = parseID(v)
			}
			res, err := coll.DeleteOne(ctx, filter)
			if err != nil {
				return totalAffected, fmt.Errorf("failed to delete document: %w", err)
			}
			totalAffected += res.DeletedCount
		}
	}

	return totalAffected, nil
}
