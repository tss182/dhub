export interface ConnectionConfig {
  id: string;
  folderId?: string;
  name: string;
  driver: 'postgres' | 'mysql' | 'sqlite';
  colorTag: string;
  isReadOnly: boolean;
  txMode: 'auto' | 'manual';
  host: string;
  port: number;
  username: string;
  password?: string;
  databaseName: string;
  filePath: string;
  sslMode: string;
  sshEnabled: boolean;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshAuthType: 'password' | 'key';
  sshKeyPath: string;
}

export interface ColumnMeta {
  name: string;
  dataType: string;
  rawType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  defaultValue: string;
  comment?: string;
}

export interface ForeignKeyMeta {
  constraintName: string;
  columnName: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
  onUpdate: string;
  onDelete: string;
}

export interface IndexMeta {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
}

export interface ObjectSummary {
  schema: string;
  name: string;
  type: 'table' | 'view' | 'materialized_view' | 'routine';
  rowEstimate: number;
  sizePretty?: string;
}

export interface TableStructure {
  schema: string;
  name: string;
  columns: ColumnMeta[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyMeta[];
  indexes: IndexMeta[];
  ddl: string;
}

export interface StatementResult {
  sql: string;
  columns: ColumnMeta[];
  rows: any[][];
  rowsAffected: number;
  elapsedMs: number;
  hasMore?: boolean;
  error?: string;
}

export interface QueryResult {
  executionId: string;
  sql?: string;
  columns: ColumnMeta[];
  rows: any[][];
  rowsAffected: number;
  elapsedMs: number;
  hasMore: boolean;
  error?: string;
  results?: StatementResult[];
}

export interface Worksheet {
  id: string;
  connectionId: string;
  title: string;
  content: string;
  targetDatabase: string;
  targetSchema: string;
  isPinned: boolean;
  cursorLine: number;
  cursorCol: number;
  sortOrder: number;
  updatedAt: string;
}

export interface QueryHistoryEntry {
  id: number;
  connectionId: string;
  databaseName: string;
  schemaName: string;
  sqlText: string;
  durationMs: number;
  rowsAffected: number;
  status: 'success' | 'error' | 'cancelled';
  errorMessage: string;
  executedAt: string;
}

export type WorkbenchTabType = 'worksheet' | 'table_data' | 'ddl';

export interface WorkbenchTab {
  id: string;
  type: WorkbenchTabType;
  title: string;
  connectionId: string;
  driver?: string;
  database: string;
  schema: string;
  table?: string;
  worksheetId?: string;
  content?: string;
  isDirty?: boolean;
}

