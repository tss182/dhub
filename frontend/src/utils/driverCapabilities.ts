export type DriverCategory =
  | 'relational'
  | 'olap'
  | 'document'
  | 'keyvalue'
  | 'vector'
  | 'search';

export interface DriverCapabilities {
  category: DriverCategory;
  defaultDatabase: string;
  defaultPort: number;
  identifierQuote: '`' | '"' | '[]';
  systemDatabases: string[];
  // Schema & DDL
  hasSeparateSchemas: boolean;
  supportsTableEngines: boolean;
  supportsForeignKeys: boolean;
  supportsTriggers: boolean;
  supportsAutoIncrement: boolean;
  supportsCollation: boolean;
  supportsRelationalIndexes: boolean;
  supportsSkippingIndexes: boolean;
  supportsProjections: boolean;
  supportsPartitions: boolean;
  supportsMaterializedViews: boolean;
  supportsDictionaries: boolean;
  // Query & Execution
  supportsTransactions: boolean;
  supportsStandardUpdate: boolean;
  supportsAlterTableMutations: boolean;
  supportsUpsertOnDuplicateKey: boolean;
  supportsFinalModifier: boolean;
  supportsPrewhere: boolean;
  // UI & Tools
  supportsErDiagram: boolean;
  supportsMoveTable: boolean;
  supportsVectorSearch: boolean;
  backupToolLabel: string;
}

const DEFAULT_RELATIONAL: DriverCapabilities = {
  category: 'relational',
  defaultDatabase: 'postgres',
  defaultPort: 5432,
  identifierQuote: '"',
  systemDatabases: [],
  hasSeparateSchemas: false,
  supportsTableEngines: false,
  supportsForeignKeys: true,
  supportsTriggers: true,
  supportsAutoIncrement: true,
  supportsCollation: true,
  supportsRelationalIndexes: true,
  supportsSkippingIndexes: false,
  supportsProjections: false,
  supportsPartitions: false,
  supportsMaterializedViews: false,
  supportsDictionaries: false,
  supportsTransactions: true,
  supportsStandardUpdate: true,
  supportsAlterTableMutations: false,
  supportsUpsertOnDuplicateKey: false,
  supportsFinalModifier: false,
  supportsPrewhere: false,
  supportsErDiagram: true,
  supportsMoveTable: true,
  supportsVectorSearch: false,
  backupToolLabel: 'SQL',
};

const CAPABILITY_MAP: Record<string, DriverCapabilities> = {
  clickhouse: {
    category: 'olap',
    defaultDatabase: 'default',
    defaultPort: 9000,
    identifierQuote: '`',
    systemDatabases: ['system', 'information_schema', 'INFORMATION_SCHEMA'],
    hasSeparateSchemas: false,
    supportsTableEngines: true,
    supportsForeignKeys: false,
    supportsTriggers: false,
    supportsAutoIncrement: false,
    supportsCollation: false,
    supportsRelationalIndexes: false,
    supportsSkippingIndexes: true,
    supportsProjections: true,
    supportsPartitions: true,
    supportsMaterializedViews: true,
    supportsDictionaries: true,
    supportsTransactions: false,
    supportsStandardUpdate: false,
    supportsAlterTableMutations: true,
    supportsUpsertOnDuplicateKey: false,
    supportsFinalModifier: true,
    supportsPrewhere: true,
    supportsErDiagram: false,
    supportsMoveTable: true,
    supportsVectorSearch: true,
    backupToolLabel: 'SQL / Native',
  },
  postgres: {
    ...DEFAULT_RELATIONAL,
    defaultDatabase: 'postgres',
    defaultPort: 5432,
    hasSeparateSchemas: true,
    systemDatabases: ['information_schema', 'pg_catalog', 'pg_toast'],
    supportsMaterializedViews: true,
    supportsVectorSearch: true,
    backupToolLabel: 'pg_dump',
  },
  mysql: {
    ...DEFAULT_RELATIONAL,
    defaultDatabase: '',
    defaultPort: 3306,
    identifierQuote: '`',
    systemDatabases: ['information_schema', 'mysql', 'performance_schema', 'sys'],
    supportsTableEngines: true,
    supportsUpsertOnDuplicateKey: true,
    backupToolLabel: 'mysqldump',
  },
  mariadb: {
    ...DEFAULT_RELATIONAL,
    defaultDatabase: '',
    defaultPort: 3306,
    identifierQuote: '`',
    systemDatabases: ['information_schema', 'mysql', 'performance_schema', 'sys'],
    supportsTableEngines: true,
    supportsUpsertOnDuplicateKey: true,
    backupToolLabel: 'mariadb-dump',
  },
  sqlite: {
    ...DEFAULT_RELATIONAL,
    defaultDatabase: 'main',
    defaultPort: 0,
    supportsMoveTable: false,
    backupToolLabel: 'sqlite3',
  },
  mssql: {
    ...DEFAULT_RELATIONAL,
    defaultDatabase: 'master',
    defaultPort: 1433,
    identifierQuote: '[]',
    hasSeparateSchemas: true,
    backupToolLabel: 'sqlcmd',
  },
  oracle: {
    ...DEFAULT_RELATIONAL,
    defaultDatabase: 'ORCL',
    defaultPort: 1521,
    hasSeparateSchemas: true,
    backupToolLabel: 'sqlplus',
  },
  mongodb: {
    ...DEFAULT_RELATIONAL,
    category: 'document',
    defaultDatabase: 'admin',
    defaultPort: 27017,
    supportsForeignKeys: false,
    supportsTriggers: false,
    supportsAutoIncrement: false,
    supportsCollation: false,
    supportsTransactions: false,
    supportsErDiagram: false,
    supportsMoveTable: false,
    backupToolLabel: 'mongodump',
  },
  redis: {
    ...DEFAULT_RELATIONAL,
    category: 'keyvalue',
    defaultDatabase: 'db0',
    defaultPort: 6379,
    supportsForeignKeys: false,
    supportsTriggers: false,
    supportsAutoIncrement: false,
    supportsCollation: false,
    supportsRelationalIndexes: false,
    supportsTransactions: false,
    supportsErDiagram: false,
    supportsMoveTable: false,
    backupToolLabel: 'redis-cli',
  },
  qdrant: {
    ...DEFAULT_RELATIONAL,
    category: 'vector',
    defaultDatabase: 'default',
    defaultPort: 6333,
    supportsForeignKeys: false,
    supportsTriggers: false,
    supportsAutoIncrement: false,
    supportsCollation: false,
    supportsRelationalIndexes: false,
    supportsTransactions: false,
    supportsErDiagram: false,
    supportsMoveTable: false,
    supportsVectorSearch: true,
    backupToolLabel: 'Snapshot',
  },
  elasticsearch: {
    ...DEFAULT_RELATIONAL,
    category: 'search',
    defaultDatabase: 'default',
    defaultPort: 9200,
    supportsForeignKeys: false,
    supportsTriggers: false,
    supportsAutoIncrement: false,
    supportsCollation: false,
    supportsRelationalIndexes: false,
    supportsTransactions: false,
    supportsErDiagram: false,
    supportsMoveTable: false,
    supportsVectorSearch: true,
    backupToolLabel: 'Snapshot',
  },
};

export function getDriverCapabilities(driver?: string | null): DriverCapabilities {
  const key = (driver || '').toLowerCase().trim();
  if (key === 'es') return CAPABILITY_MAP.elasticsearch;
  if (key === 'mongo') return CAPABILITY_MAP.mongodb;
  return CAPABILITY_MAP[key] || DEFAULT_RELATIONAL;
}

export function isClickHouseDriver(driver?: string | null): boolean {
  return (driver || '').toLowerCase().trim() === 'clickhouse';
}
