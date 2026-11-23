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
  entityLabel: string;
  entityPluralLabel: string;
  recordLabel: string;
  recordPluralLabel: string;
  queryLanguageLabel: string;
  // Schema & DDL
  hasSeparateSchemas: boolean;
  supportsTableEngines: boolean;
  supportsForeignKeys: boolean;
  supportsTriggers: boolean;
  supportsAutoIncrement: boolean;
  supportsCollation: boolean;
  supportsRelationalIndexes: boolean;
  supportsDocumentIndexes: boolean;
  supportsSkippingIndexes: boolean;
  supportsProjections: boolean;
  supportsPartitions: boolean;
  supportsMaterializedViews: boolean;
  supportsDictionaries: boolean;
  supportsSchemaValidation: boolean;
  // Query & Execution
  supportsTransactions: boolean;
  supportsStandardUpdate: boolean;
  supportsAlterTableMutations: boolean;
  supportsUpsertOnDuplicateKey: boolean;
  supportsFinalModifier: boolean;
  supportsPrewhere: boolean;
  supportsSqlExplain: boolean;
  supportsNativeExplain: boolean;
  supportsSqlParameters: boolean;
  // UI & Tools
  supportsErDiagram: boolean;
  supportsMoveTable: boolean;
  supportsDatabaseAlter: boolean;
  supportsSqlDmlCopy: boolean;
  supportsDocumentView: boolean;
  supportsAggregationPipeline: boolean;
  supportsVectorSearch: boolean;
  backupToolLabel: string;
}

const DEFAULT_RELATIONAL: DriverCapabilities = {
  category: 'relational',
  defaultDatabase: 'postgres',
  defaultPort: 5432,
  identifierQuote: '"',
  systemDatabases: [],
  entityLabel: 'Table',
  entityPluralLabel: 'Tables',
  recordLabel: 'Row',
  recordPluralLabel: 'Rows',
  queryLanguageLabel: 'SQL',
  hasSeparateSchemas: false,
  supportsTableEngines: false,
  supportsForeignKeys: true,
  supportsTriggers: true,
  supportsAutoIncrement: true,
  supportsCollation: true,
  supportsRelationalIndexes: true,
  supportsDocumentIndexes: false,
  supportsSkippingIndexes: false,
  supportsProjections: false,
  supportsPartitions: false,
  supportsMaterializedViews: false,
  supportsDictionaries: false,
  supportsSchemaValidation: false,
  supportsTransactions: true,
  supportsStandardUpdate: true,
  supportsAlterTableMutations: false,
  supportsUpsertOnDuplicateKey: false,
  supportsFinalModifier: false,
  supportsPrewhere: false,
  supportsSqlExplain: true,
  supportsNativeExplain: false,
  supportsSqlParameters: true,
  supportsErDiagram: true,
  supportsMoveTable: true,
  supportsDatabaseAlter: true,
  supportsSqlDmlCopy: true,
  supportsDocumentView: false,
  supportsAggregationPipeline: false,
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
    entityLabel: 'Table',
    entityPluralLabel: 'Tables',
    recordLabel: 'Row',
    recordPluralLabel: 'Rows',
    queryLanguageLabel: 'SQL',
    hasSeparateSchemas: false,
    supportsTableEngines: true,
    supportsForeignKeys: false,
    supportsTriggers: false,
    supportsAutoIncrement: false,
    supportsCollation: false,
    supportsRelationalIndexes: false,
    supportsDocumentIndexes: false,
    supportsSkippingIndexes: true,
    supportsProjections: true,
    supportsPartitions: true,
    supportsMaterializedViews: true,
    supportsDictionaries: true,
    supportsSchemaValidation: false,
    supportsTransactions: false,
    supportsStandardUpdate: false,
    supportsAlterTableMutations: true,
    supportsUpsertOnDuplicateKey: false,
    supportsFinalModifier: true,
    supportsPrewhere: true,
    supportsSqlExplain: true,
    supportsNativeExplain: false,
    supportsSqlParameters: true,
    supportsErDiagram: false,
    supportsMoveTable: true,
    supportsDatabaseAlter: true,
    supportsSqlDmlCopy: true,
    supportsDocumentView: false,
    supportsAggregationPipeline: false,
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
    systemDatabases: ['admin', 'local', 'config'],
    entityLabel: 'Collection',
    entityPluralLabel: 'Collections',
    recordLabel: 'Document',
    recordPluralLabel: 'Documents',
    queryLanguageLabel: 'MQL',
    supportsForeignKeys: false,
    supportsTriggers: false,
    supportsAutoIncrement: false,
    supportsCollation: false,
    supportsRelationalIndexes: false,
    supportsDocumentIndexes: true,
    supportsSchemaValidation: true,
    supportsTransactions: false,
    supportsStandardUpdate: false,
    supportsSqlExplain: false,
    supportsNativeExplain: true,
    supportsSqlParameters: false,
    supportsErDiagram: false,
    supportsMoveTable: false,
    supportsDatabaseAlter: false,
    supportsSqlDmlCopy: false,
    supportsDocumentView: true,
    supportsAggregationPipeline: true,
    backupToolLabel: 'mongodump',
  },
  redis: {
    ...DEFAULT_RELATIONAL,
    category: 'keyvalue',
    defaultDatabase: 'db0',
    defaultPort: 6379,
    entityLabel: 'Key',
    entityPluralLabel: 'Keys',
    recordLabel: 'Entry',
    recordPluralLabel: 'Entries',
    queryLanguageLabel: 'Redis CLI',
    supportsForeignKeys: false,
    supportsTriggers: false,
    supportsAutoIncrement: false,
    supportsCollation: false,
    supportsRelationalIndexes: false,
    supportsTransactions: false,
    supportsStandardUpdate: false,
    supportsSqlExplain: false,
    supportsSqlParameters: false,
    supportsErDiagram: false,
    supportsMoveTable: false,
    supportsDatabaseAlter: false,
    supportsSqlDmlCopy: false,
    backupToolLabel: 'redis-cli',
  },
  qdrant: {
    ...DEFAULT_RELATIONAL,
    category: 'vector',
    defaultDatabase: 'default',
    defaultPort: 6333,
    entityLabel: 'Collection',
    entityPluralLabel: 'Collections',
    recordLabel: 'Point',
    recordPluralLabel: 'Points',
    queryLanguageLabel: 'REST',
    supportsForeignKeys: false,
    supportsTriggers: false,
    supportsAutoIncrement: false,
    supportsCollation: false,
    supportsRelationalIndexes: false,
    supportsTransactions: false,
    supportsStandardUpdate: false,
    supportsSqlExplain: false,
    supportsSqlParameters: false,
    supportsErDiagram: false,
    supportsMoveTable: false,
    supportsDatabaseAlter: false,
    supportsSqlDmlCopy: false,
    supportsVectorSearch: true,
    backupToolLabel: 'Snapshot',
  },
  elasticsearch: {
    ...DEFAULT_RELATIONAL,
    category: 'search',
    defaultDatabase: 'default',
    defaultPort: 9200,
    entityLabel: 'Index',
    entityPluralLabel: 'Indices',
    recordLabel: 'Document',
    recordPluralLabel: 'Documents',
    queryLanguageLabel: 'REST / ES|QL',
    supportsForeignKeys: false,
    supportsTriggers: false,
    supportsAutoIncrement: false,
    supportsCollation: false,
    supportsRelationalIndexes: false,
    supportsTransactions: false,
    supportsStandardUpdate: false,
    supportsSqlExplain: false,
    supportsSqlParameters: false,
    supportsErDiagram: false,
    supportsMoveTable: false,
    supportsDatabaseAlter: false,
    supportsSqlDmlCopy: false,
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
