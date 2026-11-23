package mongodb

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"dhub/internal/driver"
	"go.mongodb.org/mongo-driver/bson"
)

func (m *MongoDBDriver) executeExplain(ctx context.Context, dbName, collName string, explainTarget bson.D, verbosity, execID string, start time.Time) (*driver.QueryResult, error) {
	if verbosity == "" {
		verbosity = "executionStats"
	}
	cmd := bson.D{
		{Key: "explain", Value: explainTarget},
		{Key: "verbosity", Value: verbosity},
	}

	var res bson.M
	if err := m.client.Database(dbName).RunCommand(ctx, cmd).Decode(&res); err != nil {
		return nil, fmt.Errorf("explain command failed: %w", err)
	}

	clean := bsonValueToCleanValue(res)
	pretty, err := json.MarshalIndent(clean, "", "  ")
	if err != nil {
		pretty = []byte(fmt.Sprintf("%v", clean))
	}

	return &driver.QueryResult{
		ExecutionID:  execID,
		Columns:      []driver.ColumnMeta{{Name: "explain", DataType: "object", RawType: "Object"}},
		Rows:         [][]any{{string(pretty)}},
		RowsAffected: 1,
		ElapsedMs:    time.Since(start).Milliseconds(),
		SourceSchema: dbName,
		SourceTable:  collName,
	}, nil
}

func buildExplainFindTarget(collName string, filter, projection, sortDoc any, skipVal, limitVal int64, hint any) bson.D {
	cmd := bson.D{
		{Key: "find", Value: collName},
	}
	if filter != nil {
		cmd = append(cmd, bson.E{Key: "filter", Value: filter})
	} else {
		cmd = append(cmd, bson.E{Key: "filter", Value: bson.M{}})
	}
	if projection != nil {
		cmd = append(cmd, bson.E{Key: "projection", Value: projection})
	}
	if sortDoc != nil {
		cmd = append(cmd, bson.E{Key: "sort", Value: sortDoc})
	}
	if skipVal > 0 {
		cmd = append(cmd, bson.E{Key: "skip", Value: skipVal})
	}
	if limitVal > 0 {
		cmd = append(cmd, bson.E{Key: "limit", Value: limitVal})
	}
	if hint != nil {
		cmd = append(cmd, bson.E{Key: "hint", Value: hint})
	}
	return cmd
}

func normalizeExplainVerbosity(raw string) string {
	v := strings.Trim(strings.TrimSpace(raw), `"'`)
	switch strings.ToLower(v) {
	case "", "executionstats":
		return "executionStats"
	case "queryplanner":
		return "queryPlanner"
	case "allplansexecution":
		return "allPlansExecution"
	default:
		return v
	}
}
