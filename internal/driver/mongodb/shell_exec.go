package mongodb

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"dhub/internal/driver"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (m *MongoDBDriver) executeShellScript(ctx context.Context, initialDB string, req driver.QueryRequest, start time.Time) (*driver.QueryResult, error) {
	stmts := splitMongoShellStatements(req.SQL)
	if len(stmts) == 0 {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			ElapsedMs:   time.Since(start).Milliseconds(),
		}, nil
	}

	activeDB := initialDB
	var stmtResults []driver.StatementResult
	var lastRes *driver.QueryResult

	for _, rawStmt := range stmts {
		stmtStart := time.Now()
		parsed, err := parseMongoStatement(rawStmt)
		if err != nil {
			return nil, err
		}

		var res *driver.QueryResult
		if parsed.kind == stmtUseDB {
			activeDB = parsed.target
			res = &driver.QueryResult{
				ExecutionID:  req.ExecutionID,
				Columns:      []driver.ColumnMeta{{Name: "switchedToDb", DataType: "string", RawType: "String"}},
				Rows:         [][]any{{activeDB}},
				RowsAffected: 1,
				ElapsedMs:    time.Since(stmtStart).Milliseconds(),
				SourceSchema: activeDB,
			}
		} else {
			res, err = m.executeParsedStatement(ctx, activeDB, req, parsed, stmtStart)
			if err != nil {
				return nil, err
			}
		}

		lastRes = res
		stmtResults = append(stmtResults, driver.StatementResult{
			SQL:          rawStmt,
			Columns:      res.Columns,
			Rows:         res.Rows,
			RowsAffected: res.RowsAffected,
			ElapsedMs:    res.ElapsedMs,
			HasMore:      res.HasMore,
		})
	}

	if lastRes == nil {
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			ElapsedMs:   time.Since(start).Milliseconds(),
		}, nil
	}

	lastRes.ElapsedMs = time.Since(start).Milliseconds()
	if len(stmtResults) > 1 {
		lastRes.Results = stmtResults
	}
	return lastRes, nil
}

func (m *MongoDBDriver) executeParsedStatement(ctx context.Context, dbName string, req driver.QueryRequest, stmt *parsedShellStmt, start time.Time) (*driver.QueryResult, error) {
	switch stmt.kind {
	case stmtShow:
		return m.executeShowCommand(ctx, dbName, stmt.target, req.ExecutionID, start)
	case stmtRawCommand:
		return m.executeRawCommand(ctx, dbName, stmt.raw, req.ExecutionID, start)
	case stmtDBMethod:
		return m.executeDBMethod(ctx, dbName, stmt.calls[0], req.ExecutionID, start)
	case stmtCollMethod:
		return m.executeCollMethod(ctx, dbName, stmt.target, stmt.calls, req, start)
	case stmtReplicaSet:
		return m.executeReplicaSetMethod(ctx, stmt.calls[0], req.ExecutionID, start)
	case stmtSharding:
		return m.executeShardingMethod(ctx, stmt.calls[0], req.ExecutionID, start)
	default:
		return nil, fmt.Errorf("unsupported statement kind")
	}
}

func (m *MongoDBDriver) executeShowCommand(ctx context.Context, dbName, target, execID string, start time.Time) (*driver.QueryResult, error) {
	switch target {
	case "dbs", "databases":
		listRes, err := m.client.ListDatabases(ctx, bson.M{})
		if err != nil {
			return nil, err
		}
		rows := make([][]any, 0, len(listRes.Databases))
		for _, dbSpec := range listRes.Databases {
			rows = append(rows, []any{dbSpec.Name, dbSpec.SizeOnDisk, dbSpec.Empty})
		}
		return &driver.QueryResult{
			ExecutionID: execID,
			Columns: []driver.ColumnMeta{
				{Name: "name", DataType: "string", RawType: "String"},
				{Name: "sizeOnDisk", DataType: "long", RawType: "Int64"},
				{Name: "empty", DataType: "bool", RawType: "Boolean"},
			},
			Rows:         rows,
			RowsAffected: int64(len(rows)),
			ElapsedMs:    time.Since(start).Milliseconds(),
		}, nil

	case "collections", "tables":
		objs, err := m.ListObjects(ctx, dbName, dbName)
		if err != nil {
			return nil, err
		}
		rows := make([][]any, 0, len(objs))
		for _, o := range objs {
			rows = append(rows, []any{o.Name, o.Type, o.RowEstimate, o.Engine})
		}
		return &driver.QueryResult{
			ExecutionID: execID,
			Columns: []driver.ColumnMeta{
				{Name: "name", DataType: "string", RawType: "String"},
				{Name: "type", DataType: "string", RawType: "String"},
				{Name: "estimatedCount", DataType: "long", RawType: "Int64"},
				{Name: "engine", DataType: "string", RawType: "String"},
			},
			Rows:         rows,
			RowsAffected: int64(len(rows)),
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
		}, nil

	case "users":
		return m.runCommandToQueryResult(ctx, dbName, bson.D{{Key: "usersInfo", Value: 1}}, "users", execID, start)
	case "roles":
		return m.runCommandToQueryResult(ctx, dbName, bson.D{{Key: "rolesInfo", Value: 1}, {Key: "showPrivileges", Value: true}}, "roles", execID, start)
	case "profile":
		cur, err := m.client.Database(dbName).Collection("system.profile").Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "ts", Value: -1}}).SetLimit(20))
		if err != nil {
			return nil, err
		}
		defer cur.Close(ctx)
		var docs []bson.M
		if err := cur.All(ctx, &docs); err != nil {
			return nil, err
		}
		res := docsToQueryResult(docs, time.Since(start), false)
		res.ExecutionID = execID
		res.SourceSchema = dbName
		res.SourceTable = "system.profile"
		return res, nil
	default:
		return nil, fmt.Errorf("unsupported show target: show %s", target)
	}
}

func (m *MongoDBDriver) executeRawCommand(ctx context.Context, dbName, raw, execID string, start time.Time) (*driver.QueryResult, error) {
	cmd, err := unmarshalExtJSONDoc(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid MongoDB command JSON: %w", err)
	}
	return m.runCommandDoc(ctx, dbName, cmd, execID, start)
}

func (m *MongoDBDriver) runCommandDoc(ctx context.Context, dbName string, cmd bson.D, execID string, start time.Time) (*driver.QueryResult, error) {
	var res bson.M
	if err := m.client.Database(dbName).RunCommand(ctx, cmd).Decode(&res); err != nil {
		return nil, err
	}
	// If the command returned a cursor.firstBatch, unpack those documents into rows!
	if cursorObj, ok := res["cursor"].(bson.M); ok {
		if batch, ok := cursorObj["firstBatch"].(bson.A); ok {
			docs := make([]bson.M, 0, len(batch))
			for _, item := range batch {
				switch d := item.(type) {
				case bson.M:
					docs = append(docs, d)
				case bson.D:
					mDoc := make(bson.M, len(d))
					for _, e := range d {
						mDoc[e.Key] = e.Value
					}
					docs = append(docs, mDoc)
				}
			}
			if len(docs) > 0 {
				qr := docsToQueryResult(docs, time.Since(start), false)
				qr.ExecutionID = execID
				qr.SourceSchema = dbName
				return qr, nil
			}
		}
	}

	qr := docsToQueryResult([]bson.M{res}, time.Since(start), false)
	qr.ExecutionID = execID
	qr.SourceSchema = dbName
	return qr, nil
}

// runCommandToQueryResult extracts an array field (e.g. "users" or "roles") from a RunCommand response.
func (m *MongoDBDriver) runCommandToQueryResult(ctx context.Context, dbName string, cmd bson.D, arrayField, execID string, start time.Time) (*driver.QueryResult, error) {
	var res bson.M
	if err := m.client.Database(dbName).RunCommand(ctx, cmd).Decode(&res); err != nil {
		return nil, err
	}
	if arr, ok := res[arrayField].(bson.A); ok {
		docs := make([]bson.M, 0, len(arr))
		for _, item := range arr {
			if doc, ok := item.(bson.M); ok {
				docs = append(docs, doc)
			}
		}
		qr := docsToQueryResult(docs, time.Since(start), false)
		qr.ExecutionID = execID
		qr.SourceSchema = dbName
		return qr, nil
	}
	qr := docsToQueryResult([]bson.M{res}, time.Since(start), false)
	qr.ExecutionID = execID
	qr.SourceSchema = dbName
	return qr, nil
}

type primitiveD = bson.D

func (m *MongoDBDriver) executeDBMethod(ctx context.Context, dbName string, call methodCall, execID string, start time.Time) (*driver.QueryResult, error) {
	method := strings.ToLower(call.name)
	args := splitTopLevelArgs(call.argsRaw)

	switch method {
	case "getname":
		return singleValueResult(execID, dbName, "database", dbName, "string", start), nil

	case "version":
		ver, err := m.ServerVersion(ctx)
		if err != nil {
			return nil, err
		}
		return singleValueResult(execID, dbName, "version", ver, "string", start), nil

	case "runcommand":
		if len(args) < 1 {
			return nil, fmt.Errorf("db.runCommand requires a command document")
		}
		cmd, err := unmarshalExtJSONDoc(args[0])
		if err != nil {
			return nil, fmt.Errorf("invalid command document in db.runCommand: %w", err)
		}
		return m.runCommandDoc(ctx, dbName, cmd, execID, start)

	case "admincommand":
		if len(args) < 1 {
			return nil, fmt.Errorf("db.adminCommand requires a command document")
		}
		cmd, err := unmarshalExtJSONDoc(args[0])
		if err != nil {
			return nil, fmt.Errorf("invalid command document in db.adminCommand: %w", err)
		}
		return m.runCommandDoc(ctx, "admin", cmd, execID, start)

	case "stats":
		scale := int32(1)
		if len(args) >= 1 {
			if n, err := strconv.Atoi(strings.TrimSpace(args[0])); err == nil && n > 0 {
				scale = int32(n)
			}
		}
		return m.runCommandDoc(ctx, dbName, bson.D{{Key: "dbStats", Value: 1}, {Key: "scale", Value: scale}}, execID, start)

	case "serverstatus":
		return m.runCommandDoc(ctx, "admin", bson.D{{Key: "serverStatus", Value: 1}}, execID, start)

	case "currentop":
		cmd := bson.D{{Key: "currentOp", Value: true}}
		if len(args) >= 1 && strings.TrimSpace(args[0]) != "" {
			if filterDoc, err := unmarshalExtJSONDoc(args[0]); err == nil {
				cmd = append(bson.D{{Key: "currentOp", Value: 1}}, filterDoc...)
			}
		}
		return m.runCommandDoc(ctx, "admin", cmd, execID, start)

	case "killop":
		if len(args) < 1 {
			return nil, fmt.Errorf("db.killOp requires an opId")
		}
		opID, err := strconv.ParseInt(strings.TrimSpace(args[0]), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid opId in db.killOp: %w", err)
		}
		return m.runCommandDoc(ctx, "admin", bson.D{{Key: "killOp", Value: 1}, {Key: "op", Value: opID}}, execID, start)

	case "listcommands":
		return m.runCommandDoc(ctx, dbName, bson.D{{Key: "listCommands", Value: 1}}, execID, start)

	case "getcollectionnames":
		names, err := m.client.Database(dbName).ListCollectionNames(ctx, bson.M{})
		if err != nil {
			return nil, err
		}
		rows := make([][]any, 0, len(names))
		for _, n := range names {
			rows = append(rows, []any{n})
		}
		return &driver.QueryResult{
			ExecutionID:  execID,
			Columns:      []driver.ColumnMeta{{Name: "collection", DataType: "string", RawType: "String"}},
			Rows:         rows,
			RowsAffected: int64(len(rows)),
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
		}, nil

	case "getcollectioninfos":
		filter := bson.M{}
		if len(args) >= 1 && strings.TrimSpace(args[0]) != "" {
			if doc, err := unmarshalExtJSONDoc(args[0]); err == nil {
				for _, e := range doc {
					filter[e.Key] = e.Value
				}
			}
		}
		cur, err := m.client.Database(dbName).ListCollections(ctx, filter)
		if err != nil {
			return nil, err
		}
		defer cur.Close(ctx)
		var docs []bson.M
		if err := cur.All(ctx, &docs); err != nil {
			return nil, err
		}
		qr := docsToQueryResult(docs, time.Since(start), false)
		qr.ExecutionID = execID
		qr.SourceSchema = dbName
		return qr, nil

	case "createcollection":
		if len(args) < 1 {
			return nil, fmt.Errorf("db.createCollection requires a collection name")
		}
		collName := stripSingleOrDoubleQuotes(args[0])
		cmd := bson.D{{Key: "create", Value: collName}}
		if len(args) >= 2 && strings.TrimSpace(args[1]) != "" {
			optsDoc, err := unmarshalExtJSONDoc(args[1])
			if err != nil {
				return nil, fmt.Errorf("invalid options in db.createCollection: %w", err)
			}
			cmd = append(cmd, optsDoc...)
		}
		return m.runCommandDoc(ctx, dbName, cmd, execID, start)

	case "createview":
		if len(args) < 3 {
			return nil, fmt.Errorf("db.createView requires (viewName, sourceCollection, pipeline)")
		}
		viewName := stripSingleOrDoubleQuotes(args[0])
		viewOn := stripSingleOrDoubleQuotes(args[1])
		pipeline, err := unmarshalExtJSONArray(args[2])
		if err != nil {
			return nil, fmt.Errorf("invalid pipeline in db.createView: %w", err)
		}
		cmd := bson.D{
			{Key: "create", Value: viewName},
			{Key: "viewOn", Value: viewOn},
			{Key: "pipeline", Value: pipeline},
		}
		if len(args) >= 4 && strings.TrimSpace(args[3]) != "" {
			if optsDoc, err := unmarshalExtJSONDoc(args[3]); err == nil {
				cmd = append(cmd, optsDoc...)
			}
		}
		return m.runCommandDoc(ctx, dbName, cmd, execID, start)

	case "dropdatabase":
		if err := m.client.Database(dbName).Drop(ctx); err != nil {
			return nil, err
		}
		return singleValueResult(execID, dbName, "dropped", dbName, "string", start), nil

	case "getusers":
		return m.runCommandToQueryResult(ctx, dbName, bson.D{{Key: "usersInfo", Value: 1}}, "users", execID, start)

	case "createuser":
		if len(args) < 1 {
			return nil, fmt.Errorf("db.createUser requires a user document")
		}
		doc, err := unmarshalExtJSONDoc(args[0])
		if err != nil {
			return nil, fmt.Errorf("invalid user document in db.createUser: %w", err)
		}
		var user string
		cmd := bson.D{}
		for _, e := range doc {
			if e.Key == "user" {
				user, _ = e.Value.(string)
			} else {
				cmd = append(cmd, e)
			}
		}
		fullCmd := append(bson.D{{Key: "createUser", Value: user}}, cmd...)
		return m.runCommandDoc(ctx, dbName, fullCmd, execID, start)

	case "updateuser":
		if len(args) < 2 {
			return nil, fmt.Errorf("db.updateUser requires (username, updateDoc)")
		}
		user := stripSingleOrDoubleQuotes(args[0])
		doc, err := unmarshalExtJSONDoc(args[1])
		if err != nil {
			return nil, fmt.Errorf("invalid update document in db.updateUser: %w", err)
		}
		fullCmd := append(bson.D{{Key: "updateUser", Value: user}}, doc...)
		return m.runCommandDoc(ctx, dbName, fullCmd, execID, start)

	case "dropuser":
		if len(args) < 1 {
			return nil, fmt.Errorf("db.dropUser requires a username")
		}
		user := stripSingleOrDoubleQuotes(args[0])
		return m.runCommandDoc(ctx, dbName, bson.D{{Key: "dropUser", Value: user}}, execID, start)

	case "getroles":
		return m.runCommandToQueryResult(ctx, dbName, bson.D{{Key: "rolesInfo", Value: 1}, {Key: "showPrivileges", Value: true}}, "roles", execID, start)

	case "createrole":
		if len(args) < 1 {
			return nil, fmt.Errorf("db.createRole requires a role document")
		}
		doc, err := unmarshalExtJSONDoc(args[0])
		if err != nil {
			return nil, fmt.Errorf("invalid role document in db.createRole: %w", err)
		}
		var role string
		cmd := bson.D{}
		for _, e := range doc {
			if e.Key == "role" {
				role, _ = e.Value.(string)
			} else {
				cmd = append(cmd, e)
			}
		}
		fullCmd := append(bson.D{{Key: "createRole", Value: role}}, cmd...)
		return m.runCommandDoc(ctx, dbName, fullCmd, execID, start)

	case "droprole":
		if len(args) < 1 {
			return nil, fmt.Errorf("db.dropRole requires a role name")
		}
		role := stripSingleOrDoubleQuotes(args[0])
		return m.runCommandDoc(ctx, dbName, bson.D{{Key: "dropRole", Value: role}}, execID, start)

	default:
		return nil, fmt.Errorf("unsupported db method: db.%s()", call.name)
	}
}

func (m *MongoDBDriver) executeReplicaSetMethod(ctx context.Context, call methodCall, execID string, start time.Time) (*driver.QueryResult, error) {
	switch strings.ToLower(call.name) {
	case "status":
		return m.runCommandDoc(ctx, "admin", bson.D{{Key: "replSetGetStatus", Value: 1}}, execID, start)
	case "conf":
		return m.runCommandDoc(ctx, "admin", bson.D{{Key: "replSetGetConfig", Value: 1}}, execID, start)
	case "ismaster", "hello":
		return m.runCommandDoc(ctx, "admin", bson.D{{Key: "hello", Value: 1}}, execID, start)
	default:
		return nil, fmt.Errorf("unsupported replica set method: rs.%s()", call.name)
	}
}

func (m *MongoDBDriver) executeShardingMethod(ctx context.Context, call methodCall, execID string, start time.Time) (*driver.QueryResult, error) {
	switch strings.ToLower(call.name) {
	case "status":
		return m.runCommandDoc(ctx, "config", bson.D{{Key: "listShards", Value: 1}}, execID, start)
	default:
		return nil, fmt.Errorf("unsupported sharding method: sh.%s()", call.name)
	}
}

func (m *MongoDBDriver) executeCollMethod(ctx context.Context, dbName, collName string, calls []methodCall, req driver.QueryRequest, start time.Time) (*driver.QueryResult, error) {
	coll := m.client.Database(dbName).Collection(collName)
	primary := calls[0]
	method := strings.ToLower(primary.name)
	args := splitTopLevelArgs(primary.argsRaw)

	switch method {
	case "find":
		filter := any(bson.M{})
		if len(args) >= 1 && strings.TrimSpace(args[0]) != "" {
			doc, err := unmarshalExtJSONDoc(args[0])
			if err != nil {
				return nil, fmt.Errorf("invalid filter in find: %w", err)
			}
			filter = doc
		}
		var projection any
		if len(args) >= 2 && strings.TrimSpace(args[1]) != "" {
			proj, err := unmarshalExtJSONDoc(args[1])
			if err != nil {
				return nil, fmt.Errorf("invalid projection in find: %w", err)
			}
			projection = proj
		}

		limitVal := int64(req.Limit)
		if limitVal <= 0 {
			limitVal = 200
		}
		skipVal := int64(req.Offset)
		var sortDoc any
		var hintVal any
		var collationVal *options.Collation
		var maxTimeMS int64
		countMode := false
		explainMode := false
		explainVerbosity := "executionStats"

		for _, ch := range calls[1:] {
			cName := strings.ToLower(ch.name)
			cArgs := splitTopLevelArgs(ch.argsRaw)
			switch cName {
			case "sort":
				if len(cArgs) >= 1 {
					d, err := unmarshalExtJSONDoc(cArgs[0])
					if err != nil {
						return nil, fmt.Errorf("invalid sort document: %w", err)
					}
					sortDoc = d
				}
			case "skip":
				if len(cArgs) >= 1 {
					if v, err := strconv.ParseInt(strings.TrimSpace(cArgs[0]), 10, 64); err == nil && v >= 0 {
						skipVal = v
					}
				}
			case "limit":
				if len(cArgs) >= 1 {
					if v, err := strconv.ParseInt(strings.TrimSpace(cArgs[0]), 10, 64); err == nil && v > 0 {
						limitVal = v
					}
				}
			case "projection":
				if len(cArgs) >= 1 {
					d, err := unmarshalExtJSONDoc(cArgs[0])
					if err != nil {
						return nil, fmt.Errorf("invalid projection document: %w", err)
					}
					projection = d
				}
			case "hint":
				if len(cArgs) >= 1 {
					rawHint := strings.TrimSpace(cArgs[0])
					if strings.HasPrefix(rawHint, "{") {
						d, err := unmarshalExtJSONDoc(rawHint)
						if err != nil {
							return nil, fmt.Errorf("invalid hint document: %w", err)
						}
						hintVal = d
					} else {
						hintVal = stripSingleOrDoubleQuotes(rawHint)
					}
				}
			case "collation":
				if len(cArgs) >= 1 {
					d, err := unmarshalExtJSONDoc(cArgs[0])
					if err == nil {
						b, _ := bson.Marshal(d)
						var col options.Collation
						if jsonErr := bson.Unmarshal(b, &col); jsonErr == nil {
							collationVal = &col
						}
					}
				}
			case "maxtimems":
				if len(cArgs) >= 1 {
					if v, err := strconv.ParseInt(strings.TrimSpace(cArgs[0]), 10, 64); err == nil && v > 0 {
						maxTimeMS = v
					}
				}
			case "count", "size":
				countMode = true
			case "explain":
				explainMode = true
				if len(cArgs) >= 1 {
					explainVerbosity = normalizeExplainVerbosity(cArgs[0])
				}
			}
		}

		if explainMode {
			target := buildExplainFindTarget(collName, filter, projection, sortDoc, skipVal, limitVal, hintVal)
			return m.executeExplain(ctx, dbName, collName, target, explainVerbosity, req.ExecutionID, start)
		}

		if countMode {
			cnt, err := coll.CountDocuments(ctx, filter)
			if err != nil {
				return nil, err
			}
			return singleValueResult(req.ExecutionID, dbName, "count", cnt, "long", start), nil
		}

		findOpts := options.Find().SetLimit(limitVal + 1).SetSkip(skipVal)
		if projection != nil {
			findOpts.SetProjection(projection)
		}
		if sortDoc != nil {
			findOpts.SetSort(sortDoc)
		}
		if hintVal != nil {
			findOpts.SetHint(hintVal)
		}
		if collationVal != nil {
			findOpts.SetCollation(collationVal)
		}
		if maxTimeMS > 0 {
			findOpts.SetMaxTime(time.Duration(maxTimeMS) * time.Millisecond)
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
		if int64(len(docs)) > limitVal {
			hasMore = true
			docs = docs[:limitVal]
		}
		qr := docsToQueryResult(docs, time.Since(start), hasMore)
		qr.ExecutionID = req.ExecutionID
		qr.SourceSchema = dbName
		qr.SourceTable = collName
		for _, col := range qr.Columns {
			if col.Name == "_id" && collName != "" {
				qr.IsEditable = true
				qr.PrimaryKeys = []string{"_id"}
				break
			}
		}
		return qr, nil

	case "findone":
		filter := any(bson.M{})
		if len(args) >= 1 && strings.TrimSpace(args[0]) != "" {
			doc, err := unmarshalExtJSONDoc(args[0])
			if err != nil {
				return nil, fmt.Errorf("invalid filter in findOne: %w", err)
			}
			filter = doc
		}
		findOpts := options.FindOne()
		if len(args) >= 2 && strings.TrimSpace(args[1]) != "" {
			if proj, err := unmarshalExtJSONDoc(args[1]); err == nil {
				findOpts.SetProjection(proj)
			}
		}
		var doc bson.M
		err := coll.FindOne(ctx, filter, findOpts).Decode(&doc)
		if err == mongo.ErrNoDocuments {
			qr := docsToQueryResult(nil, time.Since(start), false)
			qr.ExecutionID = req.ExecutionID
			qr.SourceSchema = dbName
			qr.SourceTable = collName
			return qr, nil
		}
		if err != nil {
			return nil, err
		}
		qr := docsToQueryResult([]bson.M{doc}, time.Since(start), false)
		qr.ExecutionID = req.ExecutionID
		qr.SourceSchema = dbName
		qr.SourceTable = collName
		return qr, nil

	case "aggregate":
		if len(args) < 1 {
			return nil, fmt.Errorf("aggregate requires a pipeline array")
		}
		pipeline, err := unmarshalExtJSONArray(args[0])
		if err != nil {
			return nil, fmt.Errorf("invalid pipeline in aggregate: %w", err)
		}
		// Check chained .explain()
		for _, ch := range calls[1:] {
			if strings.ToLower(ch.name) == "explain" {
				verb := "executionStats"
				cArgs := splitTopLevelArgs(ch.argsRaw)
				if len(cArgs) >= 1 {
					verb = normalizeExplainVerbosity(cArgs[0])
				}
				target := bson.D{
					{Key: "aggregate", Value: collName},
					{Key: "pipeline", Value: pipeline},
					{Key: "cursor", Value: bson.M{}},
				}
				return m.executeExplain(ctx, dbName, collName, target, verb, req.ExecutionID, start)
			}
		}
		aggOpts := options.Aggregate().SetAllowDiskUse(true)
		cur, err := coll.Aggregate(ctx, pipeline, aggOpts)
		if err != nil {
			return nil, err
		}
		defer cur.Close(ctx)
		var docs []bson.M
		if err := cur.All(ctx, &docs); err != nil {
			return nil, err
		}
		qr := docsToQueryResult(docs, time.Since(start), false)
		qr.ExecutionID = req.ExecutionID
		qr.SourceSchema = dbName
		qr.SourceTable = collName
		return qr, nil

	case "countdocuments", "count":
		filter := any(bson.M{})
		if len(args) >= 1 && strings.TrimSpace(args[0]) != "" {
			doc, err := unmarshalExtJSONDoc(args[0])
			if err != nil {
				return nil, fmt.Errorf("invalid filter in %s: %w", primary.name, err)
			}
			filter = doc
		}
		cnt, err := coll.CountDocuments(ctx, filter)
		if err != nil {
			return nil, err
		}
		qr := singleValueResult(req.ExecutionID, dbName, "count", cnt, "long", start)
		qr.SourceTable = collName
		return qr, nil

	case "estimateddocumentcount":
		cnt, err := coll.EstimatedDocumentCount(ctx)
		if err != nil {
			return nil, err
		}
		qr := singleValueResult(req.ExecutionID, dbName, "count", cnt, "long", start)
		qr.SourceTable = collName
		return qr, nil

	case "distinct":
		if len(args) < 1 {
			return nil, fmt.Errorf("distinct requires a field name")
		}
		field := stripSingleOrDoubleQuotes(args[0])
		filter := any(bson.M{})
		if len(args) >= 2 && strings.TrimSpace(args[1]) != "" {
			doc, err := unmarshalExtJSONDoc(args[1])
			if err != nil {
				return nil, fmt.Errorf("invalid filter in distinct: %w", err)
			}
			filter = doc
		}
		vals, err := coll.Distinct(ctx, field, filter)
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
			Columns:      []driver.ColumnMeta{{Name: field, DataType: colType, RawType: rawTypeFromBson(colType)}},
			Rows:         rows,
			RowsAffected: int64(len(rows)),
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil

	case "insertone":
		if len(args) < 1 {
			return nil, fmt.Errorf("insertOne requires a document")
		}
		doc, err := unmarshalExtJSONDoc(args[0])
		if err != nil {
			return nil, fmt.Errorf("invalid document in insertOne: %w", err)
		}
		res, err := coll.InsertOne(ctx, doc)
		if err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      []driver.ColumnMeta{{Name: "insertedId", DataType: "string", RawType: "String"}},
			Rows:         [][]any{{fmt.Sprintf("%v", bsonValueToCleanValue(res.InsertedID))}},
			RowsAffected: 1,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil

	case "insertmany":
		if len(args) < 1 {
			return nil, fmt.Errorf("insertMany requires an array of documents")
		}
		arr, err := unmarshalExtJSONArray(args[0])
		if err != nil {
			return nil, fmt.Errorf("invalid document array in insertMany: %w", err)
		}
		docs := make([]any, len(arr))
		copy(docs, arr)
		res, err := coll.InsertMany(ctx, docs)
		if err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID:  req.ExecutionID,
			Columns:      []driver.ColumnMeta{{Name: "insertedCount", DataType: "int", RawType: "Int32"}},
			Rows:         [][]any{{len(res.InsertedIDs)}},
			RowsAffected: int64(len(res.InsertedIDs)),
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil

	case "updateone", "updatemany":
		if len(args) < 2 {
			return nil, fmt.Errorf("%s requires (filter, update)", primary.name)
		}
		filter, err := unmarshalExtJSONDoc(args[0])
		if err != nil {
			return nil, fmt.Errorf("invalid filter in %s: %w", primary.name, err)
		}
		update, err := unmarshalExtJSONDoc(args[1])
		if err != nil {
			return nil, fmt.Errorf("invalid update in %s: %w", primary.name, err)
		}
		upsert := false
		if len(args) >= 3 && strings.TrimSpace(args[2]) != "" {
			if optDoc, err := unmarshalExtJSONDoc(args[2]); err == nil {
				for _, e := range optDoc {
					if e.Key == "upsert" {
						if b, ok := e.Value.(bool); ok {
							upsert = b
						}
					}
				}
			}
		}
		var res *mongo.UpdateResult
		if method == "updateone" {
			res, err = coll.UpdateOne(ctx, filter, update, options.Update().SetUpsert(upsert))
		} else {
			res, err = coll.UpdateMany(ctx, filter, update, options.Update().SetUpsert(upsert))
		}
		if err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns: []driver.ColumnMeta{
				{Name: "matchedCount", DataType: "long", RawType: "Int64"},
				{Name: "modifiedCount", DataType: "long", RawType: "Int64"},
				{Name: "upsertedCount", DataType: "long", RawType: "Int64"},
			},
			Rows:         [][]any{{res.MatchedCount, res.ModifiedCount, res.UpsertedCount}},
			RowsAffected: res.ModifiedCount + res.UpsertedCount,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil

	case "replaceone":
		if len(args) < 2 {
			return nil, fmt.Errorf("replaceOne requires (filter, replacement)")
		}
		filter, err := unmarshalExtJSONDoc(args[0])
		if err != nil {
			return nil, fmt.Errorf("invalid filter in replaceOne: %w", err)
		}
		replacement, err := unmarshalExtJSONDoc(args[1])
		if err != nil {
			return nil, fmt.Errorf("invalid replacement in replaceOne: %w", err)
		}
		// Preserve immutable ObjectId _id when the UI sends the stringified hex _id back in the replacement doc.
		var filterID any
		for _, elem := range filter {
			if elem.Key == "_id" {
				filterID = elem.Value
				break
			}
		}
		if oid, isOID := filterID.(primitive.ObjectID); isOID {
			for idx, elem := range replacement {
				if elem.Key == "_id" {
					if s, ok := elem.Value.(string); ok && strings.EqualFold(s, oid.Hex()) {
						replacement[idx].Value = oid
					}
					break
				}
			}
		}
		res, err := coll.ReplaceOne(ctx, filter, replacement)
		if err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns: []driver.ColumnMeta{
				{Name: "matchedCount", DataType: "long", RawType: "Int64"},
				{Name: "modifiedCount", DataType: "long", RawType: "Int64"},
			},
			Rows:         [][]any{{res.MatchedCount, res.ModifiedCount}},
			RowsAffected: res.ModifiedCount,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil

	case "findoneandupdate":
		if len(args) < 2 {
			return nil, fmt.Errorf("findOneAndUpdate requires (filter, update)")
		}
		filter, err := unmarshalExtJSONDoc(args[0])
		if err != nil {
			return nil, err
		}
		update, err := unmarshalExtJSONDoc(args[1])
		if err != nil {
			return nil, err
		}
		var doc bson.M
		err = coll.FindOneAndUpdate(ctx, filter, update, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&doc)
		if err == mongo.ErrNoDocuments {
			return docsToQueryResult(nil, time.Since(start), false), nil
		}
		if err != nil {
			return nil, err
		}
		qr := docsToQueryResult([]bson.M{doc}, time.Since(start), false)
		qr.ExecutionID = req.ExecutionID
		qr.SourceSchema = dbName
		qr.SourceTable = collName
		return qr, nil

	case "findoneanddelete":
		if len(args) < 1 {
			return nil, fmt.Errorf("findOneAndDelete requires a filter")
		}
		filter, err := unmarshalExtJSONDoc(args[0])
		if err != nil {
			return nil, err
		}
		var doc bson.M
		err = coll.FindOneAndDelete(ctx, filter).Decode(&doc)
		if err == mongo.ErrNoDocuments {
			return docsToQueryResult(nil, time.Since(start), false), nil
		}
		if err != nil {
			return nil, err
		}
		qr := docsToQueryResult([]bson.M{doc}, time.Since(start), false)
		qr.ExecutionID = req.ExecutionID
		qr.SourceSchema = dbName
		qr.SourceTable = collName
		return qr, nil

	case "deleteone", "deletemany":
		if len(args) < 1 {
			return nil, fmt.Errorf("%s requires a filter", primary.name)
		}
		filter, err := unmarshalExtJSONDoc(args[0])
		if err != nil {
			return nil, fmt.Errorf("invalid filter in %s: %w", primary.name, err)
		}
		var res *mongo.DeleteResult
		if method == "deleteone" {
			res, err = coll.DeleteOne(ctx, filter)
		} else {
			res, err = coll.DeleteMany(ctx, filter)
		}
		if err != nil {
			return nil, err
		}
		qr := singleValueResult(req.ExecutionID, dbName, "deletedCount", res.DeletedCount, "long", start)
		qr.RowsAffected = res.DeletedCount
		qr.SourceTable = collName
		return qr, nil

	case "bulkwrite":
		if len(args) < 1 {
			return nil, fmt.Errorf("bulkWrite requires an array of write operations")
		}
		opsArr, err := unmarshalExtJSONArray(args[0])
		if err != nil {
			return nil, fmt.Errorf("invalid operations array in bulkWrite: %w", err)
		}
		var models []mongo.WriteModel
		for _, item := range opsArr {
			opDoc, ok := item.(bson.D)
			if !ok {
				if mDoc, isM := item.(bson.M); isM {
					for k, v := range mDoc {
						opDoc = append(opDoc, bson.E{Key: k, Value: v})
					}
				}
			}
			for _, e := range opDoc {
				subDoc := e.Value
				switch strings.ToLower(e.Key) {
				case "insertone":
					if d, ok := subDoc.(bson.D); ok {
						for _, ie := range d {
							if ie.Key == "document" {
								models = append(models, mongo.NewInsertOneModel().SetDocument(ie.Value))
							}
						}
					} else if m, ok := subDoc.(bson.M); ok {
						if doc, exists := m["document"]; exists {
							models = append(models, mongo.NewInsertOneModel().SetDocument(doc))
						}
					}
				case "updateone", "updatemany":
					var filterVal, updateVal any
					var upsertVal bool
					if d, ok := subDoc.(bson.D); ok {
						for _, ue := range d {
							switch ue.Key {
							case "filter":
								filterVal = ue.Value
							case "update":
								updateVal = ue.Value
							case "upsert":
								upsertVal, _ = ue.Value.(bool)
							}
						}
					} else if m, ok := subDoc.(bson.M); ok {
						filterVal = m["filter"]
						updateVal = m["update"]
						upsertVal, _ = m["upsert"].(bool)
					}
					if strings.ToLower(e.Key) == "updateone" {
						models = append(models, mongo.NewUpdateOneModel().SetFilter(filterVal).SetUpdate(updateVal).SetUpsert(upsertVal))
					} else {
						models = append(models, mongo.NewUpdateManyModel().SetFilter(filterVal).SetUpdate(updateVal).SetUpsert(upsertVal))
					}
				case "replaceone":
					var filterVal, repVal any
					var upsertVal bool
					if d, ok := subDoc.(bson.D); ok {
						for _, re := range d {
							switch re.Key {
							case "filter":
								filterVal = re.Value
							case "replacement":
								repVal = re.Value
							case "upsert":
								upsertVal, _ = re.Value.(bool)
							}
						}
					} else if m, ok := subDoc.(bson.M); ok {
						filterVal = m["filter"]
						repVal = m["replacement"]
						upsertVal, _ = m["upsert"].(bool)
					}
					models = append(models, mongo.NewReplaceOneModel().SetFilter(filterVal).SetReplacement(repVal).SetUpsert(upsertVal))
				case "deleteone", "deletemany":
					var filterVal any
					if d, ok := subDoc.(bson.D); ok {
						for _, de := range d {
							if de.Key == "filter" {
								filterVal = de.Value
							}
						}
					} else if m, ok := subDoc.(bson.M); ok {
						filterVal = m["filter"]
					}
					if strings.ToLower(e.Key) == "deleteone" {
						models = append(models, mongo.NewDeleteOneModel().SetFilter(filterVal))
					} else {
						models = append(models, mongo.NewDeleteManyModel().SetFilter(filterVal))
					}
				}
			}
		}
		ordered := true
		if len(args) >= 2 && strings.TrimSpace(args[1]) != "" {
			if optDoc, err := unmarshalExtJSONDoc(args[1]); err == nil {
				for _, oe := range optDoc {
					if oe.Key == "ordered" {
						if b, ok := oe.Value.(bool); ok {
							ordered = b
						}
					}
				}
			}
		}
		bwRes, err := coll.BulkWrite(ctx, models, options.BulkWrite().SetOrdered(ordered))
		if err != nil {
			return nil, err
		}
		return &driver.QueryResult{
			ExecutionID: req.ExecutionID,
			Columns: []driver.ColumnMeta{
				{Name: "insertedCount", DataType: "long", RawType: "Int64"},
				{Name: "matchedCount", DataType: "long", RawType: "Int64"},
				{Name: "modifiedCount", DataType: "long", RawType: "Int64"},
				{Name: "deletedCount", DataType: "long", RawType: "Int64"},
				{Name: "upsertedCount", DataType: "long", RawType: "Int64"},
			},
			Rows:         [][]any{{bwRes.InsertedCount, bwRes.MatchedCount, bwRes.ModifiedCount, bwRes.DeletedCount, bwRes.UpsertedCount}},
			RowsAffected: bwRes.InsertedCount + bwRes.ModifiedCount + bwRes.DeletedCount + bwRes.UpsertedCount,
			ElapsedMs:    time.Since(start).Milliseconds(),
			SourceSchema: dbName,
			SourceTable:  collName,
		}, nil

	case "createindex":
		if len(args) < 1 {
			return nil, fmt.Errorf("createIndex requires a key specification document")
		}
		keysDoc, err := unmarshalExtJSONDoc(args[0])
		if err != nil {
			return nil, fmt.Errorf("invalid keys in createIndex: %w", err)
		}
		idxOpts := options.Index()
		if len(args) >= 2 && strings.TrimSpace(args[1]) != "" {
			optsDoc, err := unmarshalExtJSONDoc(args[1])
			if err != nil {
				return nil, fmt.Errorf("invalid options in createIndex: %w", err)
			}
			for _, e := range optsDoc {
				switch e.Key {
				case "name":
					if s, ok := e.Value.(string); ok {
						idxOpts.SetName(s)
					}
				case "unique":
					if b, ok := e.Value.(bool); ok {
						idxOpts.SetUnique(b)
					}
				case "sparse":
					if b, ok := e.Value.(bool); ok {
						idxOpts.SetSparse(b)
					}
				case "hidden":
					if b, ok := e.Value.(bool); ok {
						idxOpts.SetHidden(b)
					}
				case "expireAfterSeconds":
					switch v := e.Value.(type) {
					case int32:
						idxOpts.SetExpireAfterSeconds(v)
					case int64:
						idxOpts.SetExpireAfterSeconds(int32(v))
					case float64:
						idxOpts.SetExpireAfterSeconds(int32(v))
					}
				case "partialFilterExpression":
					idxOpts.SetPartialFilterExpression(e.Value)
				}
			}
		}
		name, err := coll.Indexes().CreateOne(ctx, mongo.IndexModel{Keys: keysDoc, Options: idxOpts})
		if err != nil {
			return nil, err
		}
		qr := singleValueResult(req.ExecutionID, dbName, "indexName", name, "string", start)
		qr.SourceTable = collName
		return qr, nil

	case "getindexes":
		cur, err := coll.Indexes().List(ctx)
		if err != nil {
			return nil, err
		}
		defer cur.Close(ctx)
		var docs []bson.M
		if err := cur.All(ctx, &docs); err != nil {
			return nil, err
		}
		qr := docsToQueryResult(docs, time.Since(start), false)
		qr.ExecutionID = req.ExecutionID
		qr.SourceSchema = dbName
		qr.SourceTable = collName
		return qr, nil

	case "dropindex":
		if len(args) < 1 {
			return nil, fmt.Errorf("dropIndex requires an index name")
		}
		idxName := stripSingleOrDoubleQuotes(args[0])
		if _, err := coll.Indexes().DropOne(ctx, idxName); err != nil {
			return nil, err
		}
		qr := singleValueResult(req.ExecutionID, dbName, "droppedIndex", idxName, "string", start)
		qr.SourceTable = collName
		return qr, nil

	case "dropindexes":
		if _, err := coll.Indexes().DropAll(ctx); err != nil {
			return nil, err
		}
		qr := singleValueResult(req.ExecutionID, dbName, "result", "dropped all non-_id indexes", "string", start)
		qr.SourceTable = collName
		return qr, nil

	case "hideindex", "unhideindex":
		if len(args) < 1 {
			return nil, fmt.Errorf("%s requires an index name", primary.name)
		}
		idxName := stripSingleOrDoubleQuotes(args[0])
		cmd := bson.D{
			{Key: "collMod", Value: collName},
			{Key: "index", Value: bson.D{
				{Key: "name", Value: idxName},
				{Key: "hidden", Value: method == "hideindex"},
			}},
		}
		return m.runCommandDoc(ctx, dbName, cmd, req.ExecutionID, start)

	case "stats":
		return m.runCommandDoc(ctx, dbName, bson.D{{Key: "collStats", Value: collName}}, req.ExecutionID, start)

	case "validate":
		full := false
		if len(args) >= 1 && strings.EqualFold(strings.TrimSpace(args[0]), "true") {
			full = true
		}
		return m.runCommandDoc(ctx, dbName, bson.D{{Key: "validate", Value: collName}, {Key: "full", Value: full}}, req.ExecutionID, start)

	case "renamecollection":
		if len(args) < 1 {
			return nil, fmt.Errorf("renameCollection requires a new collection name")
		}
		newName := stripSingleOrDoubleQuotes(args[0])
		cmd := bson.D{
			{Key: "renameCollection", Value: dbName + "." + collName},
			{Key: "to", Value: dbName + "." + newName},
		}
		return m.runCommandDoc(ctx, "admin", cmd, req.ExecutionID, start)

	case "drop":
		if err := coll.Drop(ctx); err != nil {
			return nil, err
		}
		qr := singleValueResult(req.ExecutionID, dbName, "result", "collection dropped", "string", start)
		qr.SourceTable = collName
		return qr, nil

	default:
		return nil, fmt.Errorf("unsupported MongoDB collection method: %s", primary.name)
	}
}

func singleValueResult(execID, dbName, colName string, val any, dataType string, start time.Time) *driver.QueryResult {
	return &driver.QueryResult{
		ExecutionID:  execID,
		Columns:      []driver.ColumnMeta{{Name: colName, DataType: dataType, RawType: rawTypeFromBson(dataType)}},
		Rows:         [][]any{{val}},
		RowsAffected: 1,
		ElapsedMs:    time.Since(start).Milliseconds(),
		SourceSchema: dbName,
	}
}
