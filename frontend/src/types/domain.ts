export type ConnectionEnvType = 'local' | 'dev' | 'prod';

export interface ConnectionFolder {
  id: string;
  name: string;
  color?: string;
  parentId?: string | null;
  sortOrder?: number;
}

export interface ConnectionConfig {
  id: string;
  folderId?: string | null;
  sortOrder?: number;
  name: string;
  driver: 'postgres' | 'mysql' | 'sqlite' | 'mariadb' | 'redis';
  envType?: ConnectionEnvType;
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

export function resolveConnectionEnv(
  conn?: { envType?: string; colorTag?: string } | null
): ConnectionEnvType {
  if (!conn) return 'local';
  const raw = (conn.envType || '').toLowerCase();
  if (raw === 'dev' || raw === 'development') return 'dev';
  if (raw === 'prod' || raw === 'production') return 'prod';
  if (raw === 'local') return 'local';

  const color = (conn.colorTag || '').toLowerCase();
  if (color === '#10b981' || color === '#22c55e') return 'dev';
  if (color === '#ef4444' || color === '#f43f5e') return 'prod';
  return 'local';
}

export function getConnectionEnvInfo(
  conn?: { envType?: string; colorTag?: string } | null
) {
  const envType = resolveConnectionEnv(conn);
  if (envType === 'dev') {
    return {
      envType: 'dev' as const,
      label: 'DEV',
      fullLabel: 'Development',
      color: '#10b981',
    };
  }
  if (envType === 'prod') {
    return {
      envType: 'prod' as const,
      label: 'PROD',
      fullLabel: 'Production',
      color: '#ef4444',
    };
  }
  return {
    envType: 'local' as const,
    label: '',
    fullLabel: 'Local',
    color: '',
  };
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
  type: 'table' | 'view' | 'materialized_view' | 'routine' | 'trigger';
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

export type WorkbenchTabType = 'worksheet' | 'table_data' | 'ddl' | 'users' | 'er_diagram';

export interface TableViewState {
  whereClause?: string;
  sortConfigs?: Array<{ column: string; direction: 'asc' | 'desc' }>;
  frozenColumns?: string[];
  activeRowIndex?: number;
  scrollTop?: number;
  scrollLeft?: number;
  pageSize?: number;
  page?: number;
  offset?: number;
  startOffset?: number;
}

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
  tableViewState?: TableViewState;
}

export interface WorkspaceItem {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  colorTag?: string;
  isActive: boolean;
  tabsJson: string;
  activeTabId: string;
  createdAt?: string;
  updatedAt?: string;
}

