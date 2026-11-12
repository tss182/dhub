package driver

import (
	"context"
	"database/sql"
)

type DriverType string

const (
	DriverPostgres DriverType = "postgres"
	DriverMySQL    DriverType = "mysql"
	DriverSQLite   DriverType = "sqlite"
	DriverMariaDB  DriverType = "mariadb"
	DriverRedis    DriverType = "redis"
	DriverMSSQL    DriverType = "mssql"
	DriverMongoDB  DriverType = "mongodb"
)

type ColumnMeta struct {
	Name         string `json:"name"`
	DataType     string `json:"dataType"`     // e.g. "varchar(255)", "int8", "timestamptz"
	RawType      string `json:"rawType"`      // basic type for cell editor
	IsNullable   bool   `json:"isNullable"`
	IsPrimaryKey bool   `json:"isPrimaryKey"`
	IsAutoIncr   bool   `json:"isAutoIncrement"`
	DefaultValue string `json:"defaultValue"`
	Comment      string `json:"comment"`
}

type ForeignKeyMeta struct {
	ConstraintName string `json:"constraintName"`
	ColumnName     string `json:"columnName"`
	RefSchema      string `json:"refSchema"`
	RefTable       string `json:"refTable"`
	RefColumn      string `json:"refColumn"`
	OnUpdate       string `json:"onUpdate"`
	OnDelete       string `json:"onDelete"`
}

type IndexMeta struct {
	Name      string   `json:"name"`
	Columns   []string `json:"columns"`
	IsUnique  bool     `json:"isUnique"`
	IsPrimary bool     `json:"isPrimary"`
	Type      string   `json:"type,omitempty"`
	Method    string   `json:"method,omitempty"`
	Comment   string   `json:"comment,omitempty"`
}

type ObjectSummary struct {
	Schema      string `json:"schema"`
	Name        string `json:"name"`
	Type        string `json:"type"` // "table" | "view" | "materialized_view" | "routine"
	RowEstimate int64  `json:"rowEstimate"`
	SizePretty  string `json:"sizePretty"`
	Comment     string `json:"comment"`
}

type TableStructure struct {
	Schema      string           `json:"schema"`
	Name        string           `json:"name"`
	Columns     []ColumnMeta     `json:"columns"`
	PrimaryKeys []string         `json:"primaryKeys"`
	ForeignKeys []ForeignKeyMeta `json:"foreignKeys"`
	Indexes     []IndexMeta      `json:"indexes"`
	DDL         string           `json:"ddl"`
	Engine      string           `json:"engine,omitempty"`
	Collation   string           `json:"collation,omitempty"`
	Comment     string           `json:"comment,omitempty"`
}

type QueryRequest struct {
	ExecutionID  string `json:"executionId"`
	ConnectionID string `json:"connectionId"`
	TabID        string `json:"tabId,omitempty"`
	Database     string `json:"database"`
	Schema       string `json:"schema"`
	SQL          string `json:"sql"`
	Limit        int    `json:"limit"`
	Offset       int    `json:"offset"`
}

type StatementResult struct {
	SQL          string       `json:"sql"`
	Columns      []ColumnMeta `json:"columns"`
	Rows         [][]any      `json:"rows"`
	RowsAffected int64        `json:"rowsAffected"`
	ElapsedMs    int64        `json:"elapsedMs"`
	HasMore      bool         `json:"hasMore"`
	Error        string       `json:"error,omitempty"`
}

type QueryResult struct {
	ExecutionID  string            `json:"executionId"`
	Columns      []ColumnMeta      `json:"columns"`
	Rows         [][]any           `json:"rows"`
	RowsAffected int64             `json:"rowsAffected"`
	ElapsedMs    int64             `json:"elapsedMs"`
	HasMore      bool              `json:"hasMore"`
	IsEditable   bool              `json:"isEditable"`
	SourceSchema string            `json:"sourceSchema"`
	SourceTable  string            `json:"sourceTable"`
	PrimaryKeys  []string          `json:"primaryKeys"`
	Error        string            `json:"error,omitempty"`
	Results      []StatementResult `json:"results,omitempty"`
}

type RowChange struct {
	Type       string         `json:"type"` // "insert" | "update" | "delete"
	PrimaryKey map[string]any `json:"primaryKey"`
	Changes    map[string]any `json:"changes"`
}

type DatabaseDriver interface {
	Ping(ctx context.Context) error
	Close() error

	// Introspection
	ListDatabases(ctx context.Context) ([]string, error)
	ListSchemas(ctx context.Context, database string) ([]string, error)
	ListObjects(ctx context.Context, database, schema string) ([]ObjectSummary, error)
	GetTableStructure(ctx context.Context, database, schema, table string) (*TableStructure, error)

	// Execution & Staged Changes
	Execute(ctx context.Context, req QueryRequest) (*QueryResult, error)
	BeginTx(ctx context.Context, database string) (*sql.Tx, error)
	ApplyChanges(ctx context.Context, database, schema, table string, changes []RowChange) (int64, error)
	GenerateDMLPreview(database, schema, table string, changes []RowChange) ([]string, error)
}

