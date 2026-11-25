package mongodb

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"dhub/internal/driver"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

// MongoDBDriver implements driver.DatabaseDriver for MongoDB using the official mongo-driver.
type MongoDBDriver struct {
	client    *mongo.Client
	uri       string
	defaultDB string
}

// NewMongoDBDriver creates a MongoDBDriver from a connection URI.
func NewMongoDBDriver(uri string) (*MongoDBDriver, error) {
	return NewMongoDBDriverWithOptions(uri, nil)
}

// NewMongoDBDriverWithOptions creates a MongoDBDriver with optional preconfigured ClientOptions (TLS, ReadPreference, etc.).
func NewMongoDBDriverWithOptions(uri string, extraOpts *options.ClientOptions) (*MongoDBDriver, error) {
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

	opts := []*options.ClientOptions{
		options.Client().
			ApplyURI(uri).
			SetMaxPoolSize(8).
			SetMinPoolSize(0).
			SetMaxConnIdleTime(2 * time.Minute).
			SetConnectTimeout(10 * time.Second).
			SetServerSelectionTimeout(10 * time.Second),
	}
	if extraOpts != nil {
		opts = append(opts, extraOpts)
	}

	client, err := mongo.Connect(context.Background(), opts...)
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
	return m.client.Ping(ctx, readpref.PrimaryPreferred())
}

func (m *MongoDBDriver) Close() error {
	if m.client != nil {
		return m.client.Disconnect(context.Background())
	}
	return nil
}

// Client returns the underlying *mongo.Client for GridFS and Change Stream operations.
func (m *MongoDBDriver) Client() *mongo.Client {
	return m.client
}

// ServerVersion returns the MongoDB server version string via buildInfo.
func (m *MongoDBDriver) ServerVersion(ctx context.Context) (string, error) {
	var res bson.M
	if err := m.client.Database("admin").RunCommand(ctx, bson.D{{Key: "buildInfo", Value: 1}}).Decode(&res); err != nil {
		return "", err
	}
	if v, ok := res["version"].(string); ok {
		return v, nil
	}
	return "", fmt.Errorf("version not found in buildInfo")
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
		// Non-admin / Atlas shared-cluster users may lack listDatabases privilege; fall back to configured defaultDB.
		lowerErr := strings.ToLower(err.Error())
		if m.defaultDB != "" && (strings.Contains(lowerErr, "authorized") || strings.Contains(lowerErr, "permission") || strings.Contains(lowerErr, "authentication")) {
			return []string{m.defaultDB}, nil
		}
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

	type collEntry struct {
		name   string
		objTyp string
		engine string
		skipCt bool
	}

	var entries []collEntry
	for cur.Next(ctx) {
		var raw bson.M
		if err := cur.Decode(&raw); err != nil {
			continue
		}
		name, _ := raw["name"].(string)
		if name == "" {
			continue
		}
		collType, _ := raw["type"].(string)
		objType := "table"
		engine := ""
		skipCt := strings.HasPrefix(name, "system.")

		switch collType {
		case "view":
			objType = "view"
			engine = "view"
			skipCt = true
		case "timeseries":
			engine = "timeseries"
		default:
			if optsMap, ok := raw["options"].(bson.M); ok {
				if capped, ok := optsMap["capped"].(bool); ok && capped {
					engine = "capped"
				} else if _, ok := optsMap["timeseries"]; ok {
					engine = "timeseries"
				}
			}
		}

		entries = append(entries, collEntry{
			name:   name,
			objTyp: objType,
			engine: engine,
			skipCt: skipCt,
		})
	}
	if err := cur.Err(); err != nil {
		return nil, err
	}

	results := make([]driver.ObjectSummary, len(entries))
	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup

	for i, e := range entries {
		results[i] = driver.ObjectSummary{
			Name:   e.name,
			Type:   e.objTyp,
			Engine: e.engine,
		}
		if e.skipCt {
			continue
		}
		wg.Add(1)
		go func(idx int, collName string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			cctx, cancel := context.WithTimeout(ctx, 2*time.Second)
			defer cancel()
			if cnt, err := db.Collection(collName).EstimatedDocumentCount(cctx); err == nil {
				results[idx].RowEstimate = cnt
			}
		}(i, e.name)
	}
	wg.Wait()

	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})
	return results, nil
}

func (m *MongoDBDriver) GetTableStructure(ctx context.Context, database, schema, table string) (*driver.TableStructure, error) {
	dbName := m.targetDatabase(database)
	db := m.client.Database(dbName)
	coll := db.Collection(table)

	structure := &driver.TableStructure{
		Name:        table,
		Schema:      dbName,
		PrimaryKeys: []string{"_id"},
	}

	// Sample up to 50 documents for non-null type inference
	typeHist := make(map[string]map[string]int)
	cur, err := coll.Find(ctx, bson.M{}, options.Find().SetLimit(50))
	if err == nil {
		defer cur.Close(ctx)
		for cur.Next(ctx) {
			var doc bson.M
			if decErr := cur.Decode(&doc); decErr != nil {
				continue
			}
			for k, v := range doc {
				if _, ok := typeHist[k]; !ok {
					typeHist[k] = make(map[string]int)
				}
				t := inferBsonType(v)
				if t != "null" {
					typeHist[k][t]++
				}
			}
		}
	}

	// Build sorted column list with _id first
	fieldNames := make([]string, 0, len(typeHist))
	hasID := false
	for k := range typeHist {
		if k == "_id" {
			hasID = true
			continue
		}
		fieldNames = append(fieldNames, k)
	}
	sort.Strings(fieldNames)
	if hasID {
		fieldNames = append([]string{"_id"}, fieldNames...)
	}

	for _, k := range fieldNames {
		hist := typeHist[k]
		dominant := "null"
		maxCount := 0
		if len(hist) > 1 {
			// Check if all types are numeric (int/long/double/decimal) or mixed
			dominant = pickDominantType(hist)
		} else {
			for t, cnt := range hist {
				if cnt > maxCount {
					maxCount = cnt
					dominant = t
				}
			}
		}
		structure.Columns = append(structure.Columns, driver.ColumnMeta{
			Name:         k,
			DataType:     dominant,
			RawType:      rawTypeFromBson(dominant),
			IsNullable:   k != "_id",
			IsPrimaryKey: k == "_id",
		})
	}

	// Decode indexes using bson.D to preserve exact key order and attributes
	var ddlLines []string
	collRef := formatCollectionRef(table)

	// Inspect collection options (capped, timeseries, validator, viewOn)
	if infoCur, infoErr := db.ListCollections(ctx, bson.M{"name": table}); infoErr == nil {
		defer infoCur.Close(ctx)
		if infoCur.Next(ctx) {
			var info bson.M
			if infoCur.Decode(&info) == nil {
				collType, _ := info["type"].(string)
				optsMap, _ := info["options"].(bson.M)
				if collType == "view" {
					viewOn, _ := optsMap["viewOn"].(string)
					pipelineClean := bsonValueToCleanValue(optsMap["pipeline"])
					pBytes, _ := json.MarshalIndent(pipelineClean, "", "  ")
					ddlLines = append(ddlLines, fmt.Sprintf("db.createView(%q, %q, %s);", table, viewOn, string(pBytes)))
				} else if len(optsMap) > 0 {
					optsClean := bsonValueToCleanValue(optsMap)
					oBytes, _ := json.MarshalIndent(optsClean, "", "  ")
					ddlLines = append(ddlLines, fmt.Sprintf("db.createCollection(%q, %s);", table, string(oBytes)))
				} else {
					ddlLines = append(ddlLines, fmt.Sprintf("db.createCollection(%q);", table))
				}
			}
		}
	}
	if len(ddlLines) == 0 {
		ddlLines = append(ddlLines, fmt.Sprintf("db.createCollection(%q);", table))
	}

	idxCur, idxErr := coll.Indexes().List(ctx)
	if idxErr == nil {
		defer idxCur.Close(ctx)
		for idxCur.Next(ctx) {
			var rawIdx bson.D
			if idxCur.Decode(&rawIdx) != nil {
				continue
			}
			idxName := ""
			isUnique := false
			isSparse := false
			isHidden := false
			var ttl *int32
			var keyDoc bson.D
			var partialFilter any

			for _, elem := range rawIdx {
				switch elem.Key {
				case "name":
					idxName, _ = elem.Value.(string)
				case "unique":
					isUnique, _ = elem.Value.(bool)
				case "sparse":
					isSparse, _ = elem.Value.(bool)
				case "hidden":
					isHidden, _ = elem.Value.(bool)
				case "expireAfterSeconds":
					switch v := elem.Value.(type) {
					case int32:
						ttl = &v
					case int64:
						t32 := int32(v)
						ttl = &t32
					case float64:
						t32 := int32(v)
						ttl = &t32
					}
				case "partialFilterExpression":
					partialFilter = elem.Value
				case "key":
					if kd, ok := elem.Value.(bson.D); ok {
						keyDoc = kd
					}
				}
			}

			var cols []string
			idxType := "BTREE"
			for _, ke := range keyDoc {
				cols = append(cols, fmt.Sprintf("%s:%v", ke.Key, ke.Value))
				switch val := ke.Value.(type) {
				case string:
					switch val {
					case "text":
						idxType = "TEXT"
					case "2dsphere", "2d":
						idxType = strings.ToUpper(val)
					case "hashed":
						idxType = "HASHED"
					}
				}
			}
			if ttl != nil {
				idxType = fmt.Sprintf("TTL (%ds)", *ttl)
			} else if isHidden {
				idxType += " (HIDDEN)"
			} else if isSparse {
				idxType += " (SPARSE)"
			}

			structure.Indexes = append(structure.Indexes, driver.IndexMeta{
				Name:      idxName,
				Columns:   cols,
				IsUnique:  isUnique || idxName == "_id_",
				IsPrimary: idxName == "_id_",
				Type:      idxType,
			})

			if idxName != "_id_" && len(keyDoc) > 0 {
				keyJSON := formatShellOrderedDoc(keyDoc)
				var optParts []string
				if idxName != "" {
					optParts = append(optParts, fmt.Sprintf("name: %q", idxName))
				}
				if isUnique {
					optParts = append(optParts, "unique: true")
				}
				if isSparse {
					optParts = append(optParts, "sparse: true")
				}
				if isHidden {
					optParts = append(optParts, "hidden: true")
				}
				if ttl != nil {
					optParts = append(optParts, fmt.Sprintf("expireAfterSeconds: %d", *ttl))
				}
				if partialFilter != nil {
					pfBytes, _ := json.Marshal(bsonValueToCleanValue(partialFilter))
					optParts = append(optParts, fmt.Sprintf("partialFilterExpression: %s", string(pfBytes)))
				}
				if len(optParts) > 0 {
					ddlLines = append(ddlLines, fmt.Sprintf("%s.createIndex(%s, { %s });", collRef, keyJSON, strings.Join(optParts, ", ")))
				} else {
					ddlLines = append(ddlLines, fmt.Sprintf("%s.createIndex(%s);", collRef, keyJSON))
				}
			}
		}
	}

	structure.DDL = strings.Join(ddlLines, "\n")
	return structure, nil
}

func pickDominantType(hist map[string]int) string {
	best := ""
	bestCnt := 0
	for t, cnt := range hist {
		if cnt > bestCnt {
			bestCnt = cnt
			best = t
		}
	}
	return best
}

func formatCollectionRef(name string) string {
	if isSimpleShellIdent(name) {
		return "db." + name
	}
	return fmt.Sprintf("db.getCollection(%q)", name)
}

func formatShellOrderedDoc(d bson.D) string {
	parts := make([]string, 0, len(d))
	for _, e := range d {
		parts = append(parts, fmt.Sprintf("%s: %s", formatShellKey(e.Key), formatMongoShellValue(e.Value)))
	}
	return "{ " + strings.Join(parts, ", ") + " }"
}

func (m *MongoDBDriver) GetDatabaseDDL(ctx context.Context, database string) (string, error) {
	dbName := m.targetDatabase(database)
	objs, err := m.ListObjects(ctx, dbName, dbName)
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("// MongoDB Database Script: %s\nuse %s;\n\n", dbName, dbName))
	for _, obj := range objs {
		if strings.HasPrefix(obj.Name, "system.") {
			continue
		}
		st, err := m.GetTableStructure(ctx, dbName, dbName, obj.Name)
		if err != nil || st == nil || st.DDL == "" {
			sb.WriteString(fmt.Sprintf("db.createCollection(%q);\n\n", obj.Name))
			continue
		}
		sb.WriteString(st.DDL)
		sb.WriteString("\n\n")
	}
	return strings.TrimSpace(sb.String()), nil
}

func (m *MongoDBDriver) Execute(ctx context.Context, req driver.QueryRequest) (*driver.QueryResult, error) {
	start := time.Now()
	dbName := m.targetDatabase(req.Database)
	sqlStr := strings.TrimSpace(req.SQL)

	if sqlStr == "" {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			ElapsedMs:   0,
		}, nil
	}

	upper := strings.ToUpper(sqlStr)
	if strings.HasPrefix(upper, "SELECT ") || strings.HasPrefix(upper, "SELECT\n") || strings.HasPrefix(upper, "SELECT\t") {
		return m.executePseudoSQL(ctx, dbName, req, start)
	}

	return m.executeShellScript(ctx, dbName, req, start)
}

func docsToQueryResult(docs []bson.M, elapsed time.Duration, hasMore bool) *driver.QueryResult {
	colTypes := make(map[string]map[string]int)
	hasID := false
	for _, doc := range docs {
		for k, v := range doc {
			if k == "_id" {
				hasID = true
			}
			if _, ok := colTypes[k]; !ok {
				colTypes[k] = make(map[string]int)
			}
			t := inferBsonType(v)
			if t != "null" {
				colTypes[k][t]++
			}
		}
	}

	colNames := make([]string, 0, len(colTypes))
	for k := range colTypes {
		if k == "_id" {
			continue
		}
		colNames = append(colNames, k)
	}
	sort.Strings(colNames)
	if hasID {
		colNames = append([]string{"_id"}, colNames...)
	}

	cols := make([]driver.ColumnMeta, len(colNames))
	for i, name := range colNames {
		hist := colTypes[name]
		dtype := "null"
		if len(hist) == 1 {
			for t := range hist {
				dtype = t
			}
		} else if len(hist) > 1 {
			dtype = "mixed"
		}
		cols[i] = driver.ColumnMeta{
			Name:         name,
			DataType:     dtype,
			RawType:      rawTypeFromBson(dtype),
			IsNullable:   name != "_id",
			IsPrimaryKey: name == "_id",
		}
	}

	rows := make([][]any, len(docs))
	for rIdx, doc := range docs {
		row := make([]any, len(colNames))
		for cIdx, cName := range colNames {
			val, exists := doc[cName]
			if !exists || val == nil {
				row[cIdx] = nil
				continue
			}
			clean := bsonValueToCleanValue(val)
			switch v := clean.(type) {
			case map[string]any, []any:
				b, err := json.Marshal(v)
				if err != nil {
					row[cIdx] = fmt.Sprintf("%v", v)
				} else {
					row[cIdx] = string(b)
				}
			default:
				row[cIdx] = v
			}
		}
		rows[rIdx] = row
	}

	return &driver.QueryResult{
		Columns:      cols,
		Rows:         rows,
		RowsAffected: int64(len(rows)),
		ElapsedMs:    elapsed.Milliseconds(),
		HasMore:      hasMore,
	}
}

func (m *MongoDBDriver) GenerateDMLPreview(database, schema, table string, changes []driver.RowChange) ([]string, error) {
	var statements []string
	collRef := formatCollectionRef(table)

	for _, c := range changes {
		switch c.Type {
		case "insert":
			doc := make(bson.D, 0, len(c.Changes))
			for k, v := range c.Changes {
				if k == "_id" {
					if v == nil || v == "" {
						continue
					}
					doc = append(doc, bson.E{Key: k, Value: parseID(v)})
				} else {
					doc = append(doc, bson.E{Key: k, Value: coerceValueForBson(v, "")})
				}
			}
			statements = append(statements, fmt.Sprintf("%s.insertOne(%s);", collRef, formatShellOrderedDoc(doc)))

		case "update":
			filterDoc := make(bson.D, 0, len(c.PrimaryKey))
			for k, v := range c.PrimaryKey {
				filterDoc = append(filterDoc, bson.E{Key: k, Value: parseID(v)})
			}
			setDoc := make(bson.D, 0)
			for k, v := range c.Changes {
				if k == "_id" {
					continue
				}
				if v == nil {
					setDoc = append(setDoc, bson.E{Key: k, Value: nil})
				} else {
					setDoc = append(setDoc, bson.E{Key: k, Value: coerceValueForBson(v, "")})
				}
			}
			if len(setDoc) > 0 {
				statements = append(statements, fmt.Sprintf("%s.updateOne(%s, { $set: %s });", collRef, formatShellOrderedDoc(filterDoc), formatShellOrderedDoc(setDoc)))
			}

		case "delete":
			filterDoc := make(bson.D, 0, len(c.PrimaryKey))
			for k, v := range c.PrimaryKey {
				filterDoc = append(filterDoc, bson.E{Key: k, Value: parseID(v)})
			}
			statements = append(statements, fmt.Sprintf("%s.deleteOne(%s);", collRef, formatShellOrderedDoc(filterDoc)))
		}
	}

	return statements, nil
}

func (m *MongoDBDriver) ApplyChanges(ctx context.Context, database, schema, table string, changes []driver.RowChange) (int64, error) {
	if len(changes) == 0 {
		return 0, nil
	}
	dbName := m.targetDatabase(database)
	coll := m.client.Database(dbName).Collection(table)

	// Fetch column type hints once for typed BSON coercion
	typeHints := make(map[string]string)
	if st, err := m.GetTableStructure(ctx, dbName, dbName, table); err == nil && st != nil {
		for _, col := range st.Columns {
			typeHints[col.Name] = col.DataType
		}
	}

	var writeModels []mongo.WriteModel
	for _, c := range changes {
		switch c.Type {
		case "insert":
			doc := bson.M{}
			for k, v := range c.Changes {
				if k == "_id" {
					if v == nil || v == "" {
						continue
					}
					doc[k] = parseID(v)
				} else {
					doc[k] = coerceValueForBson(v, typeHints[k])
				}
			}
			writeModels = append(writeModels, mongo.NewInsertOneModel().SetDocument(doc))

		case "update":
			filter := bson.M{}
			for k, v := range c.PrimaryKey {
				filter[k] = parseID(v)
			}
			setDoc := bson.M{}
			for k, v := range c.Changes {
				if k == "_id" {
					continue
				}
				if v == nil {
					setDoc[k] = nil
				} else {
					setDoc[k] = coerceValueForBson(v, typeHints[k])
				}
			}
			updateDoc := bson.M{}
			if len(setDoc) > 0 {
				updateDoc["$set"] = setDoc
			}
			if len(updateDoc) > 0 {
				writeModels = append(writeModels, mongo.NewUpdateOneModel().SetFilter(filter).SetUpdate(updateDoc))
			}

		case "delete":
			filter := bson.M{}
			for k, v := range c.PrimaryKey {
				filter[k] = parseID(v)
			}
			writeModels = append(writeModels, mongo.NewDeleteOneModel().SetFilter(filter))
		}
	}

	if len(writeModels) == 0 {
		return 0, nil
	}

	res, err := coll.BulkWrite(ctx, writeModels, options.BulkWrite().SetOrdered(true))
	if err != nil {
		return 0, fmt.Errorf("failed to apply MongoDB changes: %w", err)
	}
	return res.InsertedCount + res.ModifiedCount + res.DeletedCount + res.UpsertedCount, nil
}

// Keep unused primitive import satisfied if needed
var _ = primitive.NilObjectID
