package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"dhub/internal/driver/mongodb"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/gridfs"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (s *SchemaService) getMongoClient(ctx context.Context, connectionID string) (*mongodb.MongoDBDriver, error) {
	drv, err := s.sessions.GetOrConnect(ctx, connectionID)
	if err != nil {
		return nil, err
	}
	mDrv, ok := drv.(*mongodb.MongoDBDriver)
	if !ok || mDrv == nil || mDrv.Client() == nil {
		return nil, fmt.Errorf("connection %q is not an active MongoDB connection", connectionID)
	}
	return mDrv, nil
}

// MongoGridFSUpload streams a local file into a MongoDB GridFS bucket (<bucketPrefix>.files + <bucketPrefix>.chunks).
func (s *SchemaService) MongoGridFSUpload(ctx context.Context, connectionID, database, bucketPrefix, localFilePath string) (string, error) {
	cfg, cfgErr := s.store.GetConnection(ctx, connectionID)
	if cfgErr != nil {
		return "", fmt.Errorf("upload blocked: failed to verify connection permissions: %w", cfgErr)
	}
	if cfg != nil && cfg.IsReadOnly {
		return "", fmt.Errorf("upload blocked: connection %q is configured as read-only", cfg.Name)
	}
	mDrv, err := s.getMongoClient(ctx, connectionID)
	if err != nil {
		return "", err
	}
	dbName := strings.TrimSpace(database)
	if dbName == "" || dbName == "main" {
		dbName = "admin"
	}
	bucketName := strings.TrimSpace(bucketPrefix)
	if bucketName == "" {
		bucketName = "fs"
	}

	f, err := os.Open(localFilePath)
	if err != nil {
		return "", fmt.Errorf("failed to open file %q: %w", localFilePath, err)
	}
	defer f.Close()

	bucket, err := gridfs.NewBucket(mDrv.Client().Database(dbName), options.GridFSBucket().SetName(bucketName))
	if err != nil {
		return "", fmt.Errorf("failed to open GridFS bucket: %w", err)
	}

	filename := filepath.Base(localFilePath)
	uploadStream, err := bucket.OpenUploadStream(filename)
	if err != nil {
		return "", fmt.Errorf("failed to open GridFS upload stream: %w", err)
	}
	defer uploadStream.Close()

	if _, err := io.Copy(uploadStream, f); err != nil {
		_ = uploadStream.Close()
		return "", fmt.Errorf("failed to stream file to GridFS: %w", err)
	}
	if err := uploadStream.Close(); err != nil {
		return "", fmt.Errorf("failed to finalize GridFS upload: %w", err)
	}

	if oid, ok := uploadStream.FileID.(primitive.ObjectID); ok {
		return oid.Hex(), nil
	}
	return fmt.Sprintf("%v", uploadStream.FileID), nil
}

// MongoGridFSDownload streams a GridFS file by _id to a local destination path.
func (s *SchemaService) MongoGridFSDownload(ctx context.Context, connectionID, database, bucketPrefix, fileID, destPath string) error {
	mDrv, err := s.getMongoClient(ctx, connectionID)
	if err != nil {
		return err
	}
	dbName := strings.TrimSpace(database)
	if dbName == "" || dbName == "main" {
		dbName = "admin"
	}
	bucketName := strings.TrimSpace(bucketPrefix)
	if bucketName == "" {
		bucketName = "fs"
	}

	bucket, err := gridfs.NewBucket(mDrv.Client().Database(dbName), options.GridFSBucket().SetName(bucketName))
	if err != nil {
		return fmt.Errorf("failed to open GridFS bucket: %w", err)
	}

	var idVal any = fileID
	if oid, hexErr := primitive.ObjectIDFromHex(strings.TrimSpace(fileID)); hexErr == nil {
		idVal = oid
	}

	outFile, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("failed to create destination file %q: %w", destPath, err)
	}
	defer outFile.Close()

	if _, err := bucket.DownloadToStream(idVal, outFile); err != nil {
		_ = os.Remove(destPath)
		return fmt.Errorf("failed to download GridFS file: %w", err)
	}
	return nil
}

// StartMongoChangeStream opens a MongoDB Change Stream on a collection and emits "mongo:changestream" Wails events.
func (s *SchemaService) StartMongoChangeStream(ctx context.Context, connectionID, database, collectionName, streamID string) error {
	mDrv, err := s.getMongoClient(ctx, connectionID)
	if err != nil {
		return err
	}
	dbName := strings.TrimSpace(database)
	if dbName == "" || dbName == "main" {
		dbName = "admin"
	}

	coll := mDrv.Client().Database(dbName).Collection(collectionName)
	streamCtx, cancel := context.WithCancel(context.Background())

	cs, err := coll.Watch(streamCtx, mongo.Pipeline{}, options.ChangeStream().SetFullDocument(options.UpdateLookup))
	if err != nil {
		cancel()
		return err
	}

	opKey := "mongo_cs::" + streamID
	s.registerOp(opKey, cancel)

	go func() {
		defer cancel()
		defer cs.Close(context.Background())
		defer s.unregisterOp(opKey)

		for cs.Next(streamCtx) {
			var ev bson.M
			if decErr := cs.Decode(&ev); decErr != nil {
				continue
			}
			opType, _ := ev["operationType"].(string)
			payload := map[string]any{
				"streamId":      streamID,
				"operationType": opType,
				"ts":            time.Now().Format("15:04:05"),
				"documentKey":   ev["documentKey"],
				"fullDocument":  ev["fullDocument"],
			}
			rawJSON, _ := json.Marshal(payload)
			var parsed map[string]any
			_ = json.Unmarshal(rawJSON, &parsed)
			if s.appGetter != nil {
				if appInst := s.appGetter(); appInst != nil {
					appInst.Event.Emit("mongo:changestream", parsed)
				}
			}
		}
	}()

	return nil
}

// StopMongoChangeStream cancels an active MongoDB Change Stream by streamID.
func (s *SchemaService) StopMongoChangeStream(streamID string) {
	key := "mongo_cs::" + streamID
	s.mu.Lock()
	cancel, ok := s.runningOps[key]
	s.mu.Unlock()
	if ok && cancel != nil {
		cancel()
	}
}
