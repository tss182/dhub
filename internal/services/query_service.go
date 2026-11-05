package services

import (
	"context"
	"fmt"
	"sync"
	"time"

	"dhub/internal/app"
	"dhub/internal/driver"
	"dhub/internal/manager"
	"dhub/internal/store"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type QueryService struct {
	store      *store.LocalStore
	sessions   *manager.SessionManager
	appGetter  func() *application.App
	mu         sync.Mutex
	runningOps map[string]context.CancelFunc
}

func NewQueryService(s *store.LocalStore, sm *manager.SessionManager, appGetter func() *application.App) *QueryService {
	return &QueryService{
		store:      s,
		sessions:   sm,
		appGetter:  appGetter,
		runningOps: make(map[string]context.CancelFunc),
	}
}

func (q *QueryService) ExecuteQuery(req driver.QueryRequest) (*driver.QueryResult, error) {
	cfg, cfgErr := q.store.GetConnection(context.Background(), req.ConnectionID)
	if cfgErr == nil && cfg != nil && cfg.IsReadOnly {
		statements := driver.SplitStatements(req.SQL)
		for _, stmt := range statements {
			if !driver.IsQueryReturningRows(stmt) {
				errMsg := fmt.Sprintf("execution blocked: connection %q is configured as read-only (statement: %s)", cfg.Name, driver.TruncateSQL(stmt, 60))
				q.emitStatus(req.ExecutionID, "error", errMsg)
				_ = q.store.RecordQueryHistory(store.QueryHistoryEntry{
					ConnectionID: req.ConnectionID,
					DatabaseName: req.Database,
					SchemaName:   req.Schema,
					SQLText:      req.SQL,
					DurationMs:   0,
					RowsAffected: 0,
					Status:       "error",
					ErrorMessage: errMsg,
				})
				return nil, fmt.Errorf("%s", errMsg)
			}
		}
	}

	drv, err := q.sessions.GetOrConnect(context.Background(), req.ConnectionID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	q.mu.Lock()
	q.runningOps[req.ExecutionID] = cancel
	q.mu.Unlock()

	defer func() {
		q.mu.Lock()
		delete(q.runningOps, req.ExecutionID)
		q.mu.Unlock()
		cancel()
	}()

	q.emitStatus(req.ExecutionID, "running", "Executing statement...")
	start := time.Now()

	res, execErr := drv.Execute(ctx, req)
	elapsed := time.Since(start).Milliseconds()

	status := "success"
	errMsg := ""
	var rowsAffected int64
	if execErr != nil {
		status = "error"
		errMsg = execErr.Error()
		q.emitStatus(req.ExecutionID, "error", errMsg)
	} else if res != nil {
		res.ElapsedMs = elapsed
		rowsAffected = res.RowsAffected
		q.emitStatus(req.ExecutionID, "completed", fmt.Sprintf("Fetched %d rows in %dms", len(res.Rows), elapsed))
	}

	_ = q.store.RecordQueryHistory(store.QueryHistoryEntry{
		ConnectionID: req.ConnectionID,
		DatabaseName: req.Database,
		SchemaName:   req.Schema,
		SQLText:      req.SQL,
		DurationMs:   elapsed,
		RowsAffected: rowsAffected,
		Status:       status,
		ErrorMessage: errMsg,
	})

	return res, execErr
}

func (q *QueryService) CancelQuery(executionID string) bool {
	q.mu.Lock()
	cancel, exists := q.runningOps[executionID]
	q.mu.Unlock()
	if exists {
		cancel()
		q.emitStatus(executionID, "cancelled", "Query cancelled by user")
		return true
	}
	return false
}

func (q *QueryService) PreviewChanges(connectionID, database, schema, table string, changes []driver.RowChange) ([]string, error) {
	drv, err := q.sessions.GetOrConnect(context.Background(), connectionID)
	if err != nil {
		return nil, err
	}
	return drv.GenerateDMLPreview(database, schema, table, changes)
}

func (q *QueryService) SubmitChanges(connectionID, database, schema, table string, changes []driver.RowChange) (int64, error) {
	cfg, cfgErr := q.store.GetConnection(context.Background(), connectionID)
	if cfgErr == nil && cfg != nil && cfg.IsReadOnly {
		return 0, fmt.Errorf("submission blocked: connection %q is configured as read-only", cfg.Name)
	}

	drv, err := q.sessions.GetOrConnect(context.Background(), connectionID)
	if err != nil {
		return 0, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return drv.ApplyChanges(ctx, database, schema, table, changes)
}

func (q *QueryService) emitStatus(execID, state, message string) {
	if a := q.appGetter(); a != nil {
		a.Event.Emit("query:status", app.QueryStatusEvent{
			ExecutionID: execID,
			State:       state,
			Message:     message,
			Timestamp:   time.Now().UnixMilli(),
		})
	}
}

