package services

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"dhub/internal/app"
	"dhub/internal/driver"
	"dhub/internal/manager"
	"dhub/internal/store"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type SchemaService struct {
	store      *store.LocalStore
	sessions   *manager.SessionManager
	appGetter  func() *application.App
	mu         sync.Mutex
	runningOps map[string]context.CancelFunc
}

func NewSchemaService(s *store.LocalStore, sm *manager.SessionManager, appGetter func() *application.App) *SchemaService {
	return &SchemaService{
		store:      s,
		sessions:   sm,
		appGetter:  appGetter,
		runningOps: make(map[string]context.CancelFunc),
	}
}

func backupRestoreOpKey(connectionID, database string) string {
	return connectionID + "::" + strings.TrimSpace(database)
}

func (s *SchemaService) registerOp(key string, cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.runningOps == nil {
		s.runningOps = make(map[string]context.CancelFunc)
	}
	s.runningOps[key] = cancel
}

func (s *SchemaService) unregisterOp(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.runningOps, key)
}

// CancelBackupRestore cancels an active backup or restore operation for the given connection and database.
func (s *SchemaService) CancelBackupRestore(connectionID, database string) bool {
	key := backupRestoreOpKey(connectionID, database)
	s.mu.Lock()
	cancel, ok := s.runningOps[key]
	if !ok {
		prefix := connectionID + "::"
		for k, fn := range s.runningOps {
			if strings.HasPrefix(k, prefix) {
				cancel = fn
				ok = true
				break
			}
		}
	}
	s.mu.Unlock()
	if ok && cancel != nil {
		cancel()
		return true
	}
	return false
}

func (s *SchemaService) GetDatabases(connectionID string) ([]string, error) {
	drv, err := s.sessions.GetOrConnect(context.Background(), connectionID)
	if err != nil {
		return nil, err
	}
	return drv.ListDatabases(context.Background())
}

func (s *SchemaService) GetSchemas(connectionID, database string) ([]string, error) {
	drv, err := s.sessions.GetOrConnect(context.Background(), connectionID)
	if err != nil {
		return nil, err
	}
	return drv.ListSchemas(context.Background(), database)
}

func (s *SchemaService) GetObjects(connectionID, database, schema string) ([]driver.ObjectSummary, error) {
	drv, err := s.sessions.GetOrConnect(context.Background(), connectionID)
	if err != nil {
		return nil, err
	}
	objs, err := drv.ListObjects(context.Background(), database, schema)
	if err == nil && len(objs) > 0 {
		go func() {
			ctx := context.Background()
			cachedItems := make([]store.CachedObject, len(objs))
			for i, o := range objs {
				canonicalSchema := o.Schema
				if canonicalSchema == "" {
					canonicalSchema = schema
				}
				if canonicalSchema == "" {
					canonicalSchema = database
				}
				cachedItems[i] = store.CachedObject{
					ConnectionID: connectionID,
					DatabaseName: database,
					SchemaName:   canonicalSchema,
					ObjectType:   o.Type,
					ObjectName:   o.Name,
					RowEstimate:  o.RowEstimate,
				}
			}
			_ = s.store.SaveSchemaCacheBatch(ctx, cachedItems)
		}()
	}
	return objs, err
}

func (s *SchemaService) GetTableStructure(connectionID, database, schema, table string) (*driver.TableStructure, error) {
	drv, err := s.sessions.GetOrConnect(context.Background(), connectionID)
	if err != nil {
		return nil, err
	}
	structData, err := drv.GetTableStructure(context.Background(), database, schema, table)
	if err != nil {
		return nil, err
	}

	// Update background cache
	canonicalSchema := structData.Schema
	if canonicalSchema == "" {
		canonicalSchema = schema
	}
	if canonicalSchema == "" {
		canonicalSchema = database
	}
	_ = s.store.SaveSchemaCache(context.Background(), store.CachedObject{
		ConnectionID: connectionID,
		DatabaseName: database,
		SchemaName:   canonicalSchema,
		ObjectType:   "table",
		ObjectName:   table,
		Columns:      structData.Columns,
		Indexes:      structData.Indexes,
		ForeignKeys:  structData.ForeignKeys,
	})

	return structData, nil
}

func (s *SchemaService) GetCachedSchema(connectionID, database, schema string) ([]store.CachedObject, error) {
	return s.store.GetCachedObjects(context.Background(), connectionID, database, schema)
}

func (s *SchemaService) SearchEverywhere(connectionID, query string) ([]store.CachedObject, error) {
	return s.store.SearchEverywhere(context.Background(), connectionID, query, 500)
}

func (s *SchemaService) RefreshSchema(connectionID, database, schema string) (string, error) {
	drv, err := s.sessions.GetOrConnect(context.Background(), connectionID)
	if err != nil {
		return "", err
	}

	s.emitSync(connectionID, database, schema, "syncing", "Crawling schema metadata...")

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()

		objs, err := drv.ListObjects(ctx, database, schema)
		if err != nil {
			s.emitSync(connectionID, database, schema, "error", err.Error())
			return
		}

		const batchSize = 50
		batch := make([]store.CachedObject, 0, batchSize)
		for _, obj := range objs {
			if ctx.Err() != nil {
				break
			}
			if obj.Type == "table" {
				if tStruct, err := drv.GetTableStructure(ctx, database, schema, obj.Name); err == nil {
					canonicalSchema := obj.Schema
					if canonicalSchema == "" {
						canonicalSchema = tStruct.Schema
					}
					if canonicalSchema == "" {
						canonicalSchema = schema
					}
					if canonicalSchema == "" {
						canonicalSchema = database
					}
					batch = append(batch, store.CachedObject{
						ConnectionID: connectionID,
						DatabaseName: database,
						SchemaName:   canonicalSchema,
						ObjectType:   obj.Type,
						ObjectName:   obj.Name,
						Columns:      tStruct.Columns,
						Indexes:      tStruct.Indexes,
						ForeignKeys:  tStruct.ForeignKeys,
					})
					if len(batch) >= batchSize {
						_ = s.store.SaveSchemaCacheBatch(ctx, batch)
						batch = batch[:0]
					}
				}
			}
		}
		if len(batch) > 0 {
			_ = s.store.SaveSchemaCacheBatch(ctx, batch)
		}

		s.emitSync(connectionID, database, schema, "ready", fmt.Sprintf("Synced %d objects", len(objs)))
	}()

	return "Sync started in background", nil
}

func (s *SchemaService) emitSync(connID, db, schema, status, message string) {
	if a := s.appGetter(); a != nil {
		a.Event.Emit("schema:sync", app.SchemaSyncEvent{
			ConnectionID: connID,
			Database:     db,
			Schema:       schema,
			Status:       status,
			Message:      message,
		})
	}
}

// DownloadQdrantSnapshot streams a Qdrant collection or full-instance snapshot to savePath.
func (s *SchemaService) DownloadQdrantSnapshot(connectionID, collectionName, snapshotName, savePath string) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	opKey := backupRestoreOpKey(connectionID, collectionName)
	s.registerOp(opKey, cancel)
	defer s.unregisterOp(opKey)

	drv, err := s.sessions.GetOrConnect(ctx, connectionID)
	if err != nil {
		return 0, err
	}
	qd, ok := drv.(interface {
		DownloadSnapshot(context.Context, string, string, string) (int64, error)
	})
	if !ok {
		return 0, fmt.Errorf("connection does not support Qdrant snapshot download")
	}
	return qd.DownloadSnapshot(ctx, collectionName, snapshotName, savePath)
}

// UploadQdrantSnapshot uploads a local .snapshot file to recover a Qdrant collection.
func (s *SchemaService) UploadQdrantSnapshot(connectionID, collectionName, filePath string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	opKey := backupRestoreOpKey(connectionID, collectionName)
	s.registerOp(opKey, cancel)
	defer s.unregisterOp(opKey)

	cfg, cErr := s.store.GetConnection(ctx, connectionID)
	if cErr != nil {
		return fmt.Errorf("snapshot upload blocked: failed to verify connection permissions: %w", cErr)
	}
	if cfg != nil && cfg.IsReadOnly {
		return fmt.Errorf("snapshot upload blocked: connection %q is configured as read-only", cfg.Name)
	}
	drv, err := s.sessions.GetOrConnect(ctx, connectionID)
	if err != nil {
		return err
	}
	qd, ok := drv.(interface {
		UploadSnapshot(context.Context, string, string) error
	})
	if !ok {
		return fmt.Errorf("connection does not support Qdrant snapshot upload")
	}
	return qd.UploadSnapshot(ctx, collectionName, filePath)
}
