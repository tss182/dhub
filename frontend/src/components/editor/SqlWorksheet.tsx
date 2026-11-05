import React, { useRef, useCallback, useState, useEffect } from 'react';
import Editor, { OnMount, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

loader.config({ monaco });
import {
  Play,
  Square,
  Database,
  Terminal,
  ChevronDown,
  Check,
  AlignLeft,
  Activity,
  RotateCcw,
  Zap,
} from 'lucide-react';
import { format } from 'sql-formatter';
import { ConnectionConfig, ColumnMeta, ForeignKeyMeta, resolveConnectionEnv } from '../../types/domain';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { SchemaService } from '../../../bindings/dhub/internal/services';
import * as QueryService from '../../../bindings/dhub/internal/services/queryservice';
import { ParameterPromptModal } from '../modals/ParameterPromptModal';
import { DangerousQueryModal } from '../modals/DangerousQueryModal';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);
const modKey = isMac ? 'Cmd' : 'Ctrl';

interface TableColumnMeta {
  name: string;
  type: 'table' | 'view';
  columns: ColumnMeta[];
  foreignKeys?: ForeignKeyMeta[];
}

interface SqlKeywordDef {
  label: string;
  detail: string;
  documentation?: string;
  snippet?: string;
}

const SQL_KEYWORDS: SqlKeywordDef[] = [
  { label: 'SELECT', detail: 'SQL Keyword', snippet: 'SELECT ' },
  { label: 'SELECT * FROM', detail: 'SQL Snippet', snippet: 'SELECT * FROM ${1:table} WHERE ${2:1=1};' },
  { label: 'FROM', detail: 'SQL Clause', snippet: 'FROM ' },
  { label: 'WHERE', detail: 'SQL Clause', snippet: 'WHERE ' },
  { label: 'JOIN', detail: 'SQL Join', snippet: 'JOIN ${1:table} ON ${2:condition}' },
  { label: 'INNER JOIN', detail: 'SQL Join', snippet: 'INNER JOIN ${1:table} ON ${2:condition}' },
  { label: 'LEFT JOIN', detail: 'SQL Join', snippet: 'LEFT JOIN ${1:table} ON ${2:condition}' },
  { label: 'RIGHT JOIN', detail: 'SQL Join', snippet: 'RIGHT JOIN ${1:table} ON ${2:condition}' },
  { label: 'FULL JOIN', detail: 'SQL Join', snippet: 'FULL JOIN ${1:table} ON ${2:condition}' },
  { label: 'CROSS JOIN', detail: 'SQL Join', snippet: 'CROSS JOIN ${1:table}' },
  { label: 'ON', detail: 'SQL Clause', snippet: 'ON ' },
  { label: 'USING', detail: 'SQL Clause', snippet: 'USING (${1:column})' },
  { label: 'GROUP BY', detail: 'SQL Clause', snippet: 'GROUP BY ' },
  { label: 'ORDER BY', detail: 'SQL Clause', snippet: 'ORDER BY ${1:column} ${2|ASC,DESC|}' },
  { label: 'HAVING', detail: 'SQL Clause', snippet: 'HAVING ' },
  { label: 'LIMIT', detail: 'SQL Clause', snippet: 'LIMIT ${1:100}' },
  { label: 'OFFSET', detail: 'SQL Clause', snippet: 'OFFSET ${1:0}' },
  { label: 'INSERT INTO', detail: 'SQL Statement', snippet: 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values});' },
  { label: 'VALUES', detail: 'SQL Clause', snippet: 'VALUES (${1:values})' },
  { label: 'UPDATE', detail: 'SQL Statement', snippet: 'UPDATE ${1:table}\nSET ${2:col} = ${3:val}\nWHERE ${4:condition};' },
  { label: 'SET', detail: 'SQL Clause', snippet: 'SET ' },
  { label: 'DELETE FROM', detail: 'SQL Statement', snippet: 'DELETE FROM ${1:table} WHERE ${2:condition};' },
  { label: 'TRUNCATE TABLE', detail: 'SQL Statement', snippet: 'TRUNCATE TABLE ${1:table};' },
  { label: 'CREATE TABLE', detail: 'DDL Statement', snippet: 'CREATE TABLE ${1:table_name} (\n  ${2:id} INT PRIMARY KEY AUTO_INCREMENT,\n  ${3:name} VARCHAR(255) NOT NULL\n);' },
  { label: 'ALTER TABLE', detail: 'DDL Statement', snippet: 'ALTER TABLE ${1:table} ' },
  { label: 'DROP TABLE', detail: 'DDL Statement', snippet: 'DROP TABLE IF EXISTS ${1:table};' },
  { label: 'CREATE VIEW', detail: 'DDL Statement', snippet: 'CREATE VIEW ${1:view_name} AS\nSELECT ${2:*}\nFROM ${3:table};' },
  { label: 'DISTINCT', detail: 'SQL Keyword', snippet: 'DISTINCT ' },
  { label: 'UNION', detail: 'SQL Set Operator', snippet: 'UNION\n' },
  { label: 'UNION ALL', detail: 'SQL Set Operator', snippet: 'UNION ALL\n' },
  { label: 'INTERSECT', detail: 'SQL Set Operator', snippet: 'INTERSECT\n' },
  { label: 'EXCEPT', detail: 'SQL Set Operator', snippet: 'EXCEPT\n' },
  { label: 'AND', detail: 'SQL Operator', snippet: 'AND ' },
  { label: 'OR', detail: 'SQL Operator', snippet: 'OR ' },
  { label: 'NOT', detail: 'SQL Operator', snippet: 'NOT ' },
  { label: 'IN', detail: 'SQL Operator', snippet: 'IN (${1:list})' },
  { label: 'NOT IN', detail: 'SQL Operator', snippet: 'NOT IN (${1:list})' },
  { label: 'EXISTS', detail: 'SQL Operator', snippet: 'EXISTS (${1:subquery})' },
  { label: 'NOT EXISTS', detail: 'SQL Operator', snippet: 'NOT EXISTS (${1:subquery})' },
  { label: 'BETWEEN', detail: 'SQL Operator', snippet: 'BETWEEN ${1:min} AND ${2:max}' },
  { label: 'LIKE', detail: 'SQL Operator', snippet: "LIKE '%${1:pattern}%'" },
  { label: 'NOT LIKE', detail: 'SQL Operator', snippet: "NOT LIKE '%${1:pattern}%'" },
  { label: 'ILIKE', detail: 'SQL Operator (Case-Insensitive)', snippet: "ILIKE '%${1:pattern}%'" },
  { label: 'IS NULL', detail: 'SQL Condition', snippet: 'IS NULL' },
  { label: 'IS NOT NULL', detail: 'SQL Condition', snippet: 'IS NOT NULL' },
  { label: 'ASC', detail: 'Sort Order', snippet: 'ASC' },
  { label: 'DESC', detail: 'Sort Order', snippet: 'DESC' },
  { label: 'AS', detail: 'SQL Alias', snippet: 'AS ' },
  { label: 'CASE WHEN', detail: 'Conditional Expression', snippet: 'CASE\n  WHEN ${1:condition} THEN ${2:result}\n  ELSE ${3:default}\nEND' },
  { label: 'PRIMARY KEY', detail: 'Constraint', snippet: 'PRIMARY KEY' },
  { label: 'FOREIGN KEY', detail: 'Constraint', snippet: 'FOREIGN KEY (${1:col}) REFERENCES ${2:ref_tbl}(${3:ref_col})' },
];

const SQL_FUNCTIONS: SqlKeywordDef[] = [
  // Aggregates
  { label: 'COUNT', detail: 'Aggregate Function', snippet: 'COUNT(${1:*})' },
  { label: 'SUM', detail: 'Aggregate Function', snippet: 'SUM(${1:column})' },
  { label: 'AVG', detail: 'Aggregate Function', snippet: 'AVG(${1:column})' },
  { label: 'MIN', detail: 'Aggregate Function', snippet: 'MIN(${1:column})' },
  { label: 'MAX', detail: 'Aggregate Function', snippet: 'MAX(${1:column})' },
  { label: 'GROUP_CONCAT', detail: 'Aggregate Function', snippet: "GROUP_CONCAT(${1:column} SEPARATOR ', ')" },
  { label: 'STRING_AGG', detail: 'Aggregate Function (Postgres)', snippet: "STRING_AGG(${1:column}, ', ')" },

  // Conditional / Null handling
  { label: 'COALESCE', detail: 'Return first non-null', snippet: 'COALESCE(${1:val1}, ${2:val2})' },
  { label: 'NULLIF', detail: 'Return null if equal', snippet: 'NULLIF(${1:val1}, ${2:val2})' },
  { label: 'IFNULL', detail: 'MySQL null fallback', snippet: 'IFNULL(${1:val}, ${2:fallback})' },

  // String functions
  { label: 'CONCAT', detail: 'String Concatenation', snippet: 'CONCAT(${1:str1}, ${2:str2})' },
  { label: 'LOWER', detail: 'Lowercase String', snippet: 'LOWER(${1:str})' },
  { label: 'UPPER', detail: 'Uppercase String', snippet: 'UPPER(${1:str})' },
  { label: 'TRIM', detail: 'Trim whitespace', snippet: 'TRIM(${1:str})' },
  { label: 'SUBSTRING', detail: 'Extract substring', snippet: 'SUBSTRING(${1:str}, ${2:start}, ${3:length})' },
  { label: 'LENGTH', detail: 'String length', snippet: 'LENGTH(${1:str})' },
  { label: 'REPLACE', detail: 'Replace substring', snippet: 'REPLACE(${1:str}, ${2:from}, ${3:to})' },
  { label: 'LEFT', detail: 'Left substring', snippet: 'LEFT(${1:str}, ${2:len})' },
  { label: 'RIGHT', detail: 'Right substring', snippet: 'RIGHT(${1:str}, ${2:len})' },

  // Date & Time
  { label: 'NOW', detail: 'Current date and time', snippet: 'NOW()' },
  { label: 'CURRENT_TIMESTAMP', detail: 'Current timestamp', snippet: 'CURRENT_TIMESTAMP' },
  { label: 'CURRENT_DATE', detail: 'Current date', snippet: 'CURRENT_DATE' },
  { label: 'CURRENT_TIME', detail: 'Current time', snippet: 'CURRENT_TIME' },
  { label: 'DATE', detail: 'Extract date part', snippet: 'DATE(${1:timestamp})' },
  { label: 'DATEDIFF', detail: 'Date difference', snippet: 'DATEDIFF(${1:end_date}, ${2:start_date})' },
  { label: 'DATE_ADD', detail: 'Add interval to date', snippet: 'DATE_ADD(${1:date}, INTERVAL ${2:1} ${3|DAY,MONTH,YEAR,HOUR|})' },
  { label: 'DATE_SUB', detail: 'Subtract interval from date', snippet: 'DATE_SUB(${1:date}, INTERVAL ${2:1} ${3|DAY,MONTH,YEAR,HOUR|})' },
  { label: 'EXTRACT', detail: 'Extract date/time subfield', snippet: 'EXTRACT(${1|YEAR,MONTH,DAY,HOUR,MINUTE|} FROM ${2:date})' },

  // Math
  { label: 'ROUND', detail: 'Round number', snippet: 'ROUND(${1:num}, ${2:decimals})' },
  { label: 'FLOOR', detail: 'Round down to integer', snippet: 'FLOOR(${1:num})' },
  { label: 'CEIL', detail: 'Round up to integer', snippet: 'CEIL(${1:num})' },
  { label: 'ABS', detail: 'Absolute value', snippet: 'ABS(${1:num})' },

  // JSON / Conversion
  { label: 'CAST', detail: 'Type conversion', snippet: 'CAST(${1:expr} AS ${2|VARCHAR(255),INT,DECIMAL(10,2),DATE,DATETIME,JSON|})' },
  { label: 'JSON_EXTRACT', detail: 'Extract value from JSON', snippet: "JSON_EXTRACT(${1:json_doc}, '$.${2:path}')" },
  { label: 'JSON_UNQUOTE', detail: 'Unquote JSON string', snippet: 'JSON_UNQUOTE(${1:json_val})' },

  // Window
  { label: 'ROW_NUMBER', detail: 'Window Function', snippet: 'ROW_NUMBER() OVER (PARTITION BY ${1:col} ORDER BY ${2:col})' },
  { label: 'RANK', detail: 'Window Function', snippet: 'RANK() OVER (ORDER BY ${1:col})' },
  { label: 'DENSE_RANK', detail: 'Window Function', snippet: 'DENSE_RANK() OVER (ORDER BY ${1:col})' },
  { label: 'LAG', detail: 'Access previous row', snippet: 'LAG(${1:col}, ${2:1}) OVER (ORDER BY ${3:col})' },
  { label: 'LEAD', detail: 'Access next row', snippet: 'LEAD(${1:col}, ${2:1}) OVER (ORDER BY ${3:col})' },
];

function isInsideStringLiteral(lineContent: string, column: number): boolean {
  let insideSingle = false;
  let insideDouble = false;
  for (let i = 0; i < column - 1; i++) {
    const ch = lineContent[i];
    const prev = i > 0 ? lineContent[i - 1] : '';
    if (ch === "'" && prev !== '\\') {
      if (!insideDouble) insideSingle = !insideSingle;
    } else if (ch === '"' && prev !== '\\') {
      if (!insideSingle) insideDouble = !insideDouble;
    }
  }
  return insideSingle || insideDouble;
}

interface ParsedQueryTables {
  aliasToTable: Map<string, string>;
  tableToAlias: Map<string, string>;
  tables: string[];
}

function extractTableAliases(sqlText: string): ParsedQueryTables {
  const aliasToTable = new Map<string, string>();
  const tableToAlias = new Map<string, string>();
  const tables: string[] = [];

  const regex = /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:`?([a-zA-Z0-9_]+)`?\.)?`?([a-zA-Z0-9_]+)`?(?:\s+(?:AS\s+)?([a-zA-Z0-9_]+))?/gi;

  const nonAliases = new Set([
    'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'ON', 'USING',
    'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'SET', 'SELECT', 'VALUES',
    'AND', 'OR', 'NOT', 'AS', 'NATURAL'
  ]);

  let match: RegExpExecArray | null;
  while ((match = regex.exec(sqlText)) !== null) {
    const tableName = match[2];
    const alias = match[3];

    if (tableName) {
      const tblLower = tableName.toLowerCase();
      if (!tables.some((t) => t.toLowerCase() === tblLower)) {
        tables.push(tableName);
      }
      aliasToTable.set(tblLower, tableName);
      if (alias && !nonAliases.has(alias.toUpperCase())) {
        aliasToTable.set(alias.toLowerCase(), tableName);
        tableToAlias.set(tblLower, alias);
      } else if (!tableToAlias.has(tblLower)) {
        tableToAlias.set(tblLower, tableName);
      }
    }
  }

  return { aliasToTable, tableToAlias, tables };
}

function detectSqlParameters(sqlText: string): string[] {
  const params: string[] = [];
  const seen = new Set<string>();

  // Match :paramName (ensure not ::type cast by checking preceding char is not :)
  const namedRegex = /(?<!:):([a-zA-Z][a-zA-Z0-9_]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = namedRegex.exec(sqlText)) !== null) {
    const p = match[0];
    if (!seen.has(p)) {
      seen.add(p);
      params.push(p);
    }
  }

  // Match $1, $2
  const posRegex = /\$([0-9]+)\b/g;
  while ((match = posRegex.exec(sqlText)) !== null) {
    const p = match[0];
    if (!seen.has(p)) {
      seen.add(p);
      params.push(p);
    }
  }

  // Match ? (only if no named or $ params were found)
  if (params.length === 0 && sqlText.includes('?')) {
    let qIdx = 1;
    const qMatches = sqlText.match(/\?/g);
    if (qMatches) {
      qMatches.forEach(() => {
        const name = `?${qIdx++}`;
        if (!seen.has(name)) {
          seen.add(name);
          params.push(name);
        }
      });
    }
  }

  return params;
}

function isDangerousQuery(sqlText: string): boolean {
  const clean = sqlText.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const upper = clean.toUpperCase();
  const isUpdate = /^UPDATE\s+/i.test(upper);
  const isDelete = /^DELETE\s+FROM\s+/i.test(upper);

  if (isUpdate || isDelete) {
    if (!/\bWHERE\b/i.test(upper)) {
      return true;
    }
  }
  return false;
}

interface SqlWorksheetProps {
  tabId?: string;
  sql: string;
  connection?: ConnectionConfig;
  database: string;
  schema: string;
  availableDatabases?: string[];
  isRunning: boolean;
  schemaMetadata?: Array<{ table: string; columns: Array<{ name: string; dataType: string }> }>;
  onChange: (value: string) => void;
  onExecute: (statementSql: string, explicitDatabase?: string) => void;
  onCancel: () => void;
  onDatabaseChange?: (newDatabase: string) => void;
  onExplain?: (statementSql: string, isAnalyze: boolean) => void;
  onTxStatusChange?: (status: { mode: 'auto' | 'manual'; isOpen: boolean; count: number }) => void;
}

export const SqlWorksheet: React.FC<SqlWorksheetProps> = ({
  tabId,
  sql,
  connection,
  database,
  schema,
  availableDatabases = [],
  isRunning,
  schemaMetadata = [],
  onChange,
  onExecute,
  onCancel,
  onDatabaseChange,
  onExplain,
  onTxStatusChange,
}) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [isDbOpen, setIsDbOpen] = useState(false);
  const dbDropdownRef = useRef<HTMLDivElement>(null);

  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const showMinimap = useSettingsStore((s) => s.showMinimap);
  const theme = useSettingsStore((s) => s.theme);
  const visibleDatabases = useConnectionStore((s) => s.visibleDatabases);

  const [txMode, setTxMode] = useState<'auto' | 'manual'>('auto');
  const [isTxOpen, setIsTxOpen] = useState(false);
  const [txCount, setTxCount] = useState(0);

  const [pendingParams, setPendingParams] = useState<{
    parameters: string[];
    sql: string;
    targetDb?: string;
  } | null>(null);

  const [pendingDangerous, setPendingDangerous] = useState<{
    sql: string;
    targetDb?: string;
  } | null>(null);

  const [isExplainOpen, setIsExplainOpen] = useState(false);
  const explainDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        explainDropdownRef.current &&
        !explainDropdownRef.current.contains(event.target as Node)
      ) {
        setIsExplainOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter available databases so that only visible databases are shown in the dropdown
  const displayedDatabases = React.useMemo(() => {
    if (!connection?.id) return availableDatabases;
    const visibleList = visibleDatabases[connection.id];
    if (visibleList !== undefined) {
      return availableDatabases.filter(
        (db) => visibleList.includes(db) || visibleList.some((v) => v.toLowerCase() === db.toLowerCase())
      );
    }
    return availableDatabases;
  }, [availableDatabases, connection?.id, visibleDatabases]);

  // Keep fresh references to avoid stale closure issues inside Monaco callbacks
  const onExecuteRef = useRef(onExecute);
  useEffect(() => {
    onExecuteRef.current = onExecute;
  }, [onExecute]);

  const databaseRef = useRef(database);
  useEffect(() => {
    databaseRef.current = database;
  }, [database]);

  // Current metadata cache ref for Monaco completion provider
  const metadataRef = useRef<{
    connectionId?: string;
    database: string;
    schema: string;
    driver?: string;
    tableMap: Map<string, TableColumnMeta>;
    availableDatabases: string[];
  }>({
    connectionId: connection?.id,
    database,
    schema,
    driver: connection?.driver,
    tableMap: new Map(),
    availableDatabases,
  });

  useEffect(() => {
    metadataRef.current.connectionId = connection?.id;
    metadataRef.current.database = database;
    metadataRef.current.schema = schema;
    metadataRef.current.driver = connection?.driver;
    metadataRef.current.availableDatabases = displayedDatabases;
  }, [connection?.id, connection?.driver, database, schema, displayedDatabases]);

  // Load and cache database tables & columns
  useEffect(() => {
    if (!connection?.id || !database) return;

    let isCancelled = false;
    const connId = connection.id;
    const dbName = database;
    const schemaName = schema || (connection.driver === 'postgres' ? 'public' : dbName);

    const loadMeta = async () => {
      const currentMap = new Map<string, TableColumnMeta>();

      // Incorporate any schemaMetadata prop if provided
      if (schemaMetadata && schemaMetadata.length > 0) {
        for (const sm of schemaMetadata) {
          currentMap.set(sm.table.toLowerCase(), {
            name: sm.table,
            type: 'table',
            columns: sm.columns.map((c) => ({
              name: c.name,
              dataType: c.dataType,
              rawType: c.dataType,
              isNullable: true,
              isPrimaryKey: false,
              isAutoIncrement: false,
              defaultValue: '',
            })),
          });
        }
      }

      // 1. Check in-memory treeObjects from connection store
      const schemaKey = `${connId}:${dbName}:${schemaName}`;
      const storeObjects = useConnectionStore.getState().treeObjects[schemaKey] || [];
      for (const obj of storeObjects) {
        if (!currentMap.has(obj.name.toLowerCase())) {
          currentMap.set(obj.name.toLowerCase(), {
            name: obj.name,
            type: (obj.type as any) || 'table',
            columns: [],
          });
        }
      }

      // 2. Load cached objects from local SQLite schema_cache
      try {
        const cached = await SchemaService.GetCachedSchema(connId, dbName, schemaName);
        if (cached && !isCancelled) {
          for (const item of cached) {
            const existing = currentMap.get(item.objectName.toLowerCase());
            currentMap.set(item.objectName.toLowerCase(), {
              name: item.objectName,
              type: (item.objectType as any) || existing?.type || 'table',
              columns: item.columns || existing?.columns || [],
              foreignKeys: (item.foreignKeys as any) || existing?.foreignKeys || [],
            });
          }
        }
      } catch (err) {
        console.warn('Failed to load cached schema for autocomplete:', err);
      }

      // 3. If no objects found, fetch list from server
      if (currentMap.size === 0 && !isCancelled) {
        try {
          const objs = await SchemaService.GetObjects(connId, dbName, schemaName);
          if (objs && !isCancelled) {
            for (const o of objs) {
              currentMap.set(o.name.toLowerCase(), {
                name: o.name,
                type: (o.type as any) || 'table',
                columns: [],
                foreignKeys: [],
              });
            }
          }
        } catch (err) {
          console.warn('Failed to fetch objects for autocomplete:', err);
        }
      }

      if (isCancelled) return;

      // Update ref immediately
      metadataRef.current.tableMap = new Map(currentMap);

      // 4. Background fetch column structure for tables without columns (up to 40 tables)
      const tablesNeedingCols = Array.from(currentMap.values())
        .filter((t) => t.columns.length === 0)
        .slice(0, 40);

      const concurrency = 4;
      for (let i = 0; i < tablesNeedingCols.length; i += concurrency) {
        if (isCancelled) break;
        const batch = tablesNeedingCols.slice(i, i + concurrency);
        await Promise.allSettled(
          batch.map(async (tbl) => {
            try {
              const struct = await SchemaService.GetTableStructure(connId, dbName, schemaName, tbl.name);
              if (struct && !isCancelled) {
                const currentEntry = metadataRef.current.tableMap.get(tbl.name.toLowerCase());
                if (currentEntry) {
                  if (struct.columns) currentEntry.columns = struct.columns;
                  if (struct.foreignKeys) currentEntry.foreignKeys = struct.foreignKeys;
                }
              }
            } catch (_) {}
          })
        );
      }
    };

    loadMeta();

    return () => {
      isCancelled = true;
    };
  }, [connection?.id, database, schema, schemaMetadata]);

  // Register SQL completion item provider with Monaco
  useEffect(() => {
    const provider = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', ' ', '(', ',', '\n'],
      provideCompletionItems: async (model, position) => {
        const lineContent = model.getLineContent(position.lineNumber);
        const textUntilPosition = lineContent.slice(0, position.column - 1);

        // 1. Check if inside string literal or comment
        if (isInsideStringLiteral(lineContent, position.column)) {
          return { suggestions: [] };
        }
        if (textUntilPosition.includes('--')) {
          return { suggestions: [] };
        }

        const word = model.getWordUntilPosition(position);
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const { connectionId, database, schema, driver, tableMap, availableDatabases } = metadataRef.current;
        const suggestions: monaco.languages.CompletionItem[] = [];

        // Check if typing after a dot: e.g. "users." or "u." or "mydb."
        const textBeforeWord = lineContent.slice(0, word.startColumn - 1);
        const dotMatch = /([a-zA-Z0-9_`"\[\]]+)\.\s*$/.exec(textBeforeWord);

        const fullSql = model.getValue();
        const parsedTables = extractTableAliases(fullSql);

        if (dotMatch) {
          const rawQualifier = dotMatch[1].replace(/[`"\[\]]/g, '');
          const qualifierLower = rawQualifier.toLowerCase();

          // Check if qualifier is an alias or table name
          const resolvedTableName = parsedTables.aliasToTable.get(qualifierLower) || qualifierLower;
          let targetTable = tableMap.get(resolvedTableName.toLowerCase());

          // If table found in our map:
          if (targetTable) {
            // If columns not loaded yet, fetch on-demand!
            if (targetTable.columns.length === 0 && connectionId && database) {
              try {
                const targetSchema = schema || (driver === 'postgres' ? 'public' : database);
                const struct = await SchemaService.GetTableStructure(connectionId, database, targetSchema, targetTable.name);
                if (struct?.columns) {
                  targetTable.columns = struct.columns;
                }
                if (struct?.foreignKeys) {
                  targetTable.foreignKeys = struct.foreignKeys;
                }
              } catch (_) {}
            }

            // Suggest all columns of this table
            targetTable.columns.forEach((col) => {
              suggestions.push({
                label: col.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.dataType || 'column'}${col.isPrimaryKey ? ' • PRIMARY KEY' : ''}${col.isNullable ? '' : ' • NOT NULL'} (${targetTable.name})`,
                documentation: col.comment ? { value: col.comment } : undefined,
                insertText: col.name,
                sortText: col.isPrimaryKey ? `0_${col.name}` : `1_${col.name}`,
                range,
              });
            });

            // Also suggest '*'
            suggestions.unshift({
              label: '*',
              kind: monaco.languages.CompletionItemKind.Value,
              detail: `All columns of ${targetTable.name}`,
              insertText: '*',
              sortText: '0_0_*',
              range,
            });

            return { suggestions };
          }

          // Check if qualifier is a database / schema name
          if (availableDatabases && availableDatabases.some((d) => d.toLowerCase() === qualifierLower)) {
            const otherDb = availableDatabases.find((d) => d.toLowerCase() === qualifierLower) || rawQualifier;
            const otherKey = `${connectionId}:${otherDb}:${otherDb}`;
            const otherObjs = useConnectionStore.getState().treeObjects[otherKey] || [];
            otherObjs.forEach((o) => {
              suggestions.push({
                label: o.name,
                kind: o.type === 'view' ? monaco.languages.CompletionItemKind.Class : monaco.languages.CompletionItemKind.Struct,
                detail: `${o.type === 'view' ? 'View' : 'Table'} (${otherDb})`,
                insertText: o.name,
                range,
              });
            });

            return { suggestions };
          }

          return { suggestions: [] };
        }

        // --- NOT AFTER A DOT (General / Clause Context) ---

        // 1. Check for ON clause context: e.g. "JOIN orders o ON " or "... ON c"
        const onMatch = /\bON\s+([a-zA-Z0-9_`"\[\].]*)$/i.exec(textBeforeWord);
        if (onMatch) {
          // Extract table joined just prior to ON in the statement
          const textBeforeOn = textUntilPosition.replace(/\bON\s+[a-zA-Z0-9_`"\[\].]*$/i, '');
          const lastJoinMatch = /(?:FROM|(?:(?:INNER\s+|LEFT\s+|RIGHT\s+|FULL\s+|CROSS\s+)?JOIN))\s+(?:`?([a-zA-Z0-9_]+)`?\.)?`?([a-zA-Z0-9_]+)`?(?:\s+(?:AS\s+)?([a-zA-Z0-9_]+))?\s*$/i.exec(textBeforeOn);

          if (lastJoinMatch) {
            const joinedTable = lastJoinMatch[2];
            const joinedAlias = lastJoinMatch[3];
            const joinedQualifier = joinedAlias || joinedTable;
            const joinedMeta = tableMap.get(joinedTable.toLowerCase());

            // Check FKs between joinedTable and any preceding tables
            parsedTables.tables.forEach((otherTable) => {
              if (otherTable.toLowerCase() === joinedTable.toLowerCase()) return;
              const otherQualifier = parsedTables.tableToAlias.get(otherTable.toLowerCase()) || otherTable;
              const otherMeta = tableMap.get(otherTable.toLowerCase());

              // 1. joinedTable -> otherTable
              if (joinedMeta?.foreignKeys) {
                joinedMeta.foreignKeys.forEach((fk) => {
                  if (fk.refTable.toLowerCase() === otherTable.toLowerCase()) {
                    const cond = `${joinedQualifier}.${fk.columnName} = ${otherQualifier}.${fk.refColumn}`;
                    suggestions.push({
                      label: cond,
                      kind: monaco.languages.CompletionItemKind.Snippet,
                      detail: `FK Join: ${joinedTable}.${fk.columnName} -> ${otherTable}.${fk.refColumn}`,
                      insertText: cond,
                      sortText: `0_0_${cond}`,
                      range,
                    });
                  }
                });
              }

              // 2. otherTable -> joinedTable
              if (otherMeta?.foreignKeys) {
                otherMeta.foreignKeys.forEach((fk) => {
                  if (fk.refTable.toLowerCase() === joinedTable.toLowerCase()) {
                    const cond = `${joinedQualifier}.${fk.refColumn} = ${otherQualifier}.${fk.columnName}`;
                    suggestions.push({
                      label: cond,
                      kind: monaco.languages.CompletionItemKind.Snippet,
                      detail: `FK Join: ${otherTable}.${fk.columnName} -> ${joinedTable}.${fk.refColumn}`,
                      insertText: cond,
                      sortText: `0_0_${cond}`,
                      range,
                    });
                  }
                });
              }
            });
          }

          // Also suggest columns of the tables in query
          parsedTables.tables.forEach((tblName) => {
            const meta = tableMap.get(tblName.toLowerCase());
            const qualifier = parsedTables.tableToAlias.get(tblName.toLowerCase()) || tblName;
            meta?.columns.forEach((col) => {
              const fullCol = `${qualifier}.${col.name}`;
              suggestions.push({
                label: fullCol,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.dataType} (${tblName})`,
                insertText: fullCol,
                sortText: `1_${fullCol}`,
                range,
              });
            });
          });

          return { suggestions };
        }

        // 2. Check for JOIN context: e.g. "JOIN ", "INNER JOIN ", "LEFT JOIN "
        const joinMatch = /\b(?:INNER\s+|LEFT\s+|RIGHT\s+|FULL\s+|CROSS\s+)?JOIN\s+([a-zA-Z0-9_`"\[\]]*)$/i.exec(textBeforeWord);
        if (joinMatch) {
          const suggestedJoins = new Set<string>();

          parsedTables.tables.forEach((existingTable) => {
            const existingQualifier = parsedTables.tableToAlias.get(existingTable.toLowerCase()) || existingTable;
            const existingMeta = tableMap.get(existingTable.toLowerCase());

            // 1. Outbound FK: existingTable has FK pointing to another table
            if (existingMeta?.foreignKeys) {
              existingMeta.foreignKeys.forEach((fk) => {
                const targetName = fk.refTable;
                const snippet = `${targetName} ON ${targetName}.${fk.refColumn} = ${existingQualifier}.${fk.columnName}`;
                if (!suggestedJoins.has(snippet)) {
                  suggestedJoins.add(snippet);
                  suggestions.push({
                    label: snippet,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    detail: `Smart FK JOIN: ${existingTable}.${fk.columnName} -> ${targetName}.${fk.refColumn}`,
                    insertText: snippet,
                    sortText: `0_0_${targetName}`,
                    range,
                  });
                }
              });
            }

            // 2. Inbound FK: another table has FK pointing to existingTable
            tableMap.forEach((otherMeta) => {
              if (otherMeta.name.toLowerCase() === existingTable.toLowerCase()) return;
              otherMeta.foreignKeys?.forEach((fk) => {
                if (fk.refTable.toLowerCase() === existingTable.toLowerCase()) {
                  const targetName = otherMeta.name;
                  const snippet = `${targetName} ON ${targetName}.${fk.columnName} = ${existingQualifier}.${fk.refColumn}`;
                  if (!suggestedJoins.has(snippet)) {
                    suggestedJoins.add(snippet);
                    suggestions.push({
                      label: snippet,
                      kind: monaco.languages.CompletionItemKind.Snippet,
                      detail: `Smart FK JOIN: ${targetName}.${fk.columnName} -> ${existingTable}.${fk.refColumn}`,
                      insertText: snippet,
                      sortText: `0_0_${targetName}`,
                      range,
                    });
                  }
                }
              });
            });
          });

          // Also suggest plain tables and views
          tableMap.forEach((tbl) => {
            const isView = tbl.type === 'view';
            suggestions.push({
              label: tbl.name,
              kind: isView ? monaco.languages.CompletionItemKind.Class : monaco.languages.CompletionItemKind.Struct,
              detail: `${isView ? 'View' : 'Table'} (${schema || database || 'db'})${tbl.columns.length > 0 ? ` • ${tbl.columns.length} columns` : ''}`,
              insertText: tbl.name,
              sortText: `1_${tbl.name}`,
              range,
            });
          });

          return { suggestions };
        }

        // Check if cursor is immediately after a table-expecting keyword: FROM, JOIN, UPDATE, INTO, TABLE
        const isTableContext = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([a-zA-Z0-9_`"\[\]]*)$/i.test(textBeforeWord);

        // 1. Tables and Views
        tableMap.forEach((tbl) => {
          const isView = tbl.type === 'view';
          suggestions.push({
            label: tbl.name,
            kind: isView ? monaco.languages.CompletionItemKind.Class : monaco.languages.CompletionItemKind.Struct,
            detail: `${isView ? 'View' : 'Table'} (${schema || database || 'db'})${tbl.columns.length > 0 ? ` • ${tbl.columns.length} columns` : ''}`,
            insertText: tbl.name,
            sortText: isTableContext ? `0_${tbl.name}` : `2_${tbl.name}`,
            range,
          });
        });

        // 2. If not strictly expecting a table, suggest Columns!
        if (!isTableContext) {
          const queryTableNames = new Set(Array.from(parsedTables.aliasToTable.values()).map((t) => t.toLowerCase()));

          const seenCols = new Set<string>();
          tableMap.forEach((tbl) => {
            const isTableInQuery = queryTableNames.has(tbl.name.toLowerCase());
            tbl.columns.forEach((col) => {
              const colKey = `${tbl.name}.${col.name}`;
              if (!seenCols.has(colKey)) {
                seenCols.add(colKey);
                suggestions.push({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  detail: `${col.dataType || 'column'}${col.isPrimaryKey ? ' • PK' : ''} — ${tbl.name}`,
                  documentation: col.comment ? { value: col.comment } : undefined,
                  insertText: col.name,
                  sortText: isTableInQuery ? (col.isPrimaryKey ? `0_0_${col.name}` : `0_1_${col.name}`) : `1_${col.name}`,
                  range,
                });
              }
            });
          });

          // 3. SQL Functions
          SQL_FUNCTIONS.forEach((fn) => {
            suggestions.push({
              label: fn.label,
              kind: monaco.languages.CompletionItemKind.Function,
              detail: fn.detail,
              insertText: fn.snippet || fn.label,
              insertTextRules: fn.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              sortText: `3_${fn.label}`,
              range,
            });
          });

          // 4. SQL Keywords & Snippets
          SQL_KEYWORDS.forEach((kw) => {
            suggestions.push({
              label: kw.label,
              kind: kw.snippet && kw.snippet.includes('${') ? monaco.languages.CompletionItemKind.Snippet : monaco.languages.CompletionItemKind.Keyword,
              detail: kw.detail,
              insertText: kw.snippet || kw.label,
              insertTextRules: kw.snippet && kw.snippet.includes('${') ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              sortText: `4_${kw.label}`,
              range,
            });
          });
        }

        return { suggestions };
      },
    });

    return () => {
      provider.dispose();
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dbDropdownRef.current && !dbDropdownRef.current.contains(e.target as Node)) {
        setIsDbOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDbOpen(false);
    };

    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const extractActiveStatement = useCallback((): string => {
    const editor = editorRef.current;
    if (!editor) return '';

    const selection = editor.getSelection();
    if (selection && !selection.isEmpty()) {
      return editor.getModel()?.getValueInRange(selection) || '';
    }

    const model = editor.getModel();
    const pos = editor.getPosition();
    if (!model || !pos) return '';

    const fullText = model.getValue();
    const offset = model.getOffsetAt(pos);

    const before = fullText.lastIndexOf(';', Math.max(0, offset - 1));
    const after = fullText.indexOf(';', offset);

    const startIdx = before === -1 ? 0 : before + 1;
    const endIdx = after === -1 ? fullText.length : after;

    const candidate = fullText.slice(startIdx, endIdx).trim();
    return candidate || fullText.trim();
  }, []);

  const proceedExecution = useCallback(
    async (statementText: string, targetDb?: string) => {
      const effectiveDb = targetDb || databaseRef.current;
      if (txMode === 'manual' && tabId && connection?.id && !isTxOpen) {
        try {
          const st = await QueryService.BeginTransaction(tabId, connection.id, effectiveDb);
          if (st) {
            setIsTxOpen(true);
            setTxCount(0);
            onTxStatusChange?.({ mode: 'manual', isOpen: true, count: 0 });
          }
        } catch (err) {
          console.warn('BeginTransaction failed:', err);
        }
      }

      if (txMode === 'manual') {
        setTxCount((c) => {
          const next = c + 1;
          onTxStatusChange?.({ mode: 'manual', isOpen: true, count: next });
          return next;
        });
      }

      onExecuteRef.current(statementText, effectiveDb);
    },
    [txMode, tabId, connection?.id, isTxOpen, onTxStatusChange]
  );

  const executeWithChecks = useCallback(
    (statementText: string, targetDb?: string) => {
      const trimmed = statementText.trim();
      if (!trimmed) return;

      // Check parameters
      const params = detectSqlParameters(trimmed);
      if (params.length > 0) {
        setPendingParams({
          parameters: params,
          sql: trimmed,
          targetDb,
        });
        return;
      }

      // Check dangerous query
      if (isDangerousQuery(trimmed)) {
        setPendingDangerous({
          sql: trimmed,
          targetDb,
        });
        return;
      }

      proceedExecution(trimmed, targetDb);
    },
    [proceedExecution]
  );

  const handleFormatSql = () => {
    try {
      const drv = connection?.driver || 'sqlite';
      let lang: any = 'sql';
      if (drv === 'postgres') lang = 'postgresql';
      else if (drv === 'mysql') lang = 'mysql';
      else if (drv === 'sqlite') lang = 'sqlite';

      const formatted = format(sql, {
        language: lang,
        tabWidth: 2,
        useTabs: false,
        keywordCase: 'upper',
        linesBetweenQueries: 2,
      });
      onChange(formatted);
    } catch (e) {
      console.warn('Formatting failed:', e);
    }
  };

  const handleExplain = (isAnalyze: boolean) => {
    setIsExplainOpen(false);
    const stmt = extractActiveStatement();
    if (!stmt) return;

    const drv = connection?.driver || 'sqlite';
    let prefix = 'EXPLAIN ';
    if (drv === 'postgres') {
      prefix = isAnalyze
        ? 'EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS) '
        : 'EXPLAIN (COSTS, VERBOSE) ';
    } else if (drv === 'mysql') {
      prefix = isAnalyze ? 'EXPLAIN ANALYZE ' : 'EXPLAIN ';
    } else if (drv === 'sqlite') {
      prefix = 'EXPLAIN QUERY PLAN ';
    }

    const explainSql = prefix + stmt;
    if (onExplain) {
      onExplain(explainSql, isAnalyze);
    } else {
      executeWithChecks(explainSql, databaseRef.current);
    }
  };

  const handleCommitTx = async () => {
    if (!tabId) return;
    try {
      await QueryService.CommitTransaction(tabId);
      setIsTxOpen(false);
      setTxCount(0);
      onTxStatusChange?.({ mode: 'manual', isOpen: false, count: 0 });
    } catch (e: any) {
      alert(`Commit failed: ${e?.message || e}`);
    }
  };

  const handleRollbackTx = async () => {
    if (!tabId) return;
    try {
      await QueryService.RollbackTransaction(tabId);
      setIsTxOpen(false);
      setTxCount(0);
      onTxStatusChange?.({ mode: 'manual', isOpen: false, count: 0 });
    } catch (e: any) {
      alert(`Rollback failed: ${e?.message || e}`);
    }
  };

  const toggleTxMode = () => {
    if (txMode === 'auto') {
      setTxMode('manual');
      onTxStatusChange?.({ mode: 'manual', isOpen: isTxOpen, count: txCount });
    } else {
      if (isTxOpen) {
        if (!confirm('You have an active transaction. Switching to Auto will rollback uncommitted changes. Proceed?')) {
          return;
        }
        handleRollbackTx();
      }
      setTxMode('auto');
      onTxStatusChange?.({ mode: 'auto', isOpen: false, count: 0 });
    }
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Shortcut Ctrl+Enter / Cmd+Enter to execute statement at cursor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      const stmt = extractActiveStatement();
      if (stmt) executeWithChecks(stmt, databaseRef.current);
    });

    // Shortcut Shift+Alt+F to format SQL
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
      () => {
        handleFormatSql();
      }
    );

    // Intercept Ctrl+S / Cmd+S in editor to prevent browser save dialog
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {});
  };

  const connEnv = resolveConnectionEnv(connection);
  const toolbarBgClass =
    connEnv === 'prod'
      ? 'bg-rose-950/35 border-rose-900/50'
      : connEnv === 'dev'
      ? 'bg-emerald-950/35 border-emerald-900/50'
      : 'bg-[#14151a] border-[#272932]';

  return (
    <div className="flex h-full flex-col bg-[#191a20]">
      {/* Worksheet Toolbar */}
      <div className={`flex h-10 items-center justify-between border-b px-3 text-xs transition-colors ${toolbarBgClass}`}>
        <div className="flex items-center gap-2">
          {!isRunning ? (
            <button
              onClick={() => executeWithChecks(extractActiveStatement(), database)}
              className="flex items-center gap-1.5 rounded bg-emerald-600/90 px-2.5 py-1 font-medium text-white hover:bg-emerald-500 transition-colors shadow-sm cursor-pointer"
              title={`Execute Statement at Cursor (${modKey}+Enter)`}
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>Run</span>
            </button>
          ) : (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 rounded bg-rose-600/90 px-2.5 py-1 font-medium text-white hover:bg-rose-500 transition-colors shadow-sm cursor-pointer"
              title={`Stop Execution (${modKey}+F2)`}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>Stop</span>
            </button>
          )}

          {/* Explain Split Button */}
          <div className="relative" ref={explainDropdownRef}>
            <div className="flex items-center rounded bg-[#22242c] border border-[#272932]">
              <button
                type="button"
                onClick={() => handleExplain(false)}
                className="flex items-center gap-1 px-2 py-1 text-zinc-300 hover:text-white hover:bg-[#2b2e3b] rounded-l transition-colors cursor-pointer"
                title="Explain Query Execution Plan"
              >
                <Activity className="h-3.5 w-3.5 text-blue-400" />
                <span>Explain</span>
              </button>
              <button
                type="button"
                onClick={() => setIsExplainOpen(!isExplainOpen)}
                className="px-1 py-1 text-zinc-400 hover:text-white hover:bg-[#2b2e3b] rounded-r border-l border-[#272932] transition-colors cursor-pointer"
                title="Explain Options"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            {isExplainOpen && (
              <div className="absolute top-full left-0 mt-1 w-44 rounded-md border border-[#3b3e4f] bg-[#191a20] shadow-xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                <button
                  type="button"
                  onClick={() => handleExplain(false)}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[#2c303c] text-zinc-200 text-xs flex items-center justify-between"
                >
                  <span>Explain Plan</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExplain(true)}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[#2c303c] text-amber-300 text-xs flex items-center justify-between"
                >
                  <span>Explain Analyze</span>
                  <Zap className="h-3 w-3 text-amber-400" />
                </button>
              </div>
            )}
          </div>

          {/* Format SQL Button */}
          <button
            type="button"
            onClick={handleFormatSql}
            className="flex items-center gap-1.5 rounded bg-[#22242c] hover:bg-[#2b2e3b] border border-[#272932] px-2 py-1 text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title="Format SQL (Shift+Alt+F)"
          >
            <AlignLeft className="h-3.5 w-3.5 text-zinc-400" />
            <span>Format</span>
          </button>

          <div className="h-4 w-[1px] bg-[#272932] mx-1" />

          {/* Transaction Controls */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleTxMode}
              className={`px-2 py-1 rounded border font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                txMode === 'manual'
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                  : 'bg-[#22242c] border-[#272932] text-zinc-400 hover:text-zinc-200'
              }`}
              title={`Transaction Mode: ${txMode.toUpperCase()} (Click to toggle)`}
            >
              Tx: {txMode.toUpperCase()}
            </button>

            {txMode === 'manual' && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!isTxOpen || isRunning}
                  onClick={handleCommitTx}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[11px] font-medium"
                  title="Commit Transaction"
                >
                  <Check className="h-3 w-3" />
                  <span>Commit</span>
                  {txCount > 0 && <span className="text-[10px] bg-emerald-500/30 px-1 rounded-full">{txCount}</span>}
                </button>

                <button
                  type="button"
                  disabled={!isTxOpen || isRunning}
                  onClick={handleRollbackTx}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[11px] font-medium"
                  title="Rollback Transaction"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Rollback</span>
                </button>
              </div>
            )}
          </div>

          <div className="h-4 w-[1px] bg-[#272932] mx-1" />

          {/* Fixed Connection Display - No connection switching */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-zinc-200 ${
              connEnv === 'prod'
                ? 'bg-rose-950/60 border-rose-700/60 text-rose-100'
                : connEnv === 'dev'
                ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-100'
                : 'bg-[#1e2027] border-[#2e313d]'
            }`}
            title={connection ? `${connection.name} (${connection.driver.toUpperCase()})` : 'Console'}
          >
            {connEnv !== 'local' && (
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  connEnv === 'prod' ? 'bg-rose-500' : 'bg-emerald-500'
                }`}
              />
            )}
            <span className="font-semibold text-xs truncate max-w-[150px]">
              {connection ? connection.name : 'Console'}
            </span>
            {connEnv !== 'local' && (
              <span
                className={`text-[9px] font-bold px-1 py-0.2 rounded border uppercase ${
                  connEnv === 'prod'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                }`}
              >
                {connEnv}
              </span>
            )}
            {connection?.driver && (
              <span className="text-[9px] text-zinc-400 font-mono uppercase bg-[#14151a] px-1 py-0.2 rounded border border-[#272932]">
                {connection.driver}
              </span>
            )}
          </div>

          <span className="text-zinc-600 font-mono">/</span>

          {/* High-Contrast Custom Database Dropdown */}
          <div className="relative" ref={dbDropdownRef}>
            <button
              type="button"
              onClick={() => setIsDbOpen(!isDbOpen)}
              className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#22242c] hover:bg-[#2b2e3b] border border-[#3b3e4f] text-amber-300 font-mono text-xs font-semibold transition-colors cursor-pointer shadow-xs"
              title={database ? `${database} (Click to switch database)` : 'Click to select database'}
            >
              <Database className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <span className="truncate max-w-[160px]">{database || 'Select Database'}</span>
              <ChevronDown
                className={`h-3 w-3 text-zinc-400 shrink-0 transition-transform duration-150 ${
                  isDbOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isDbOpen && (
              <div className="absolute top-full left-0 mt-1 min-w-[210px] max-w-[320px] max-h-64 overflow-auto rounded-md border border-[#3b3e4f] bg-[#191a20] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 border-b border-[#272932] mb-1 flex items-center justify-between">
                  <span>Databases</span>
                  <span className="font-mono text-zinc-500">{displayedDatabases.length}</span>
                </div>

                {displayedDatabases.length === 0 ? (
                  <div className="px-2.5 py-2 text-[11px] text-zinc-500 italic">No databases found</div>
                ) : (
                  displayedDatabases.map((db) => {
                    const isSelected = db === database;
                    return (
                      <div
                        key={db}
                        onClick={() => {
                          databaseRef.current = db;
                          onDatabaseChange?.(db);
                          setIsDbOpen(false);
                        }}
                        title={db}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer font-mono text-xs transition-colors ${
                          isSelected
                            ? 'bg-blue-600 text-white font-bold'
                            : 'text-zinc-200 hover:bg-[#2c303c] hover:text-white'
                        }`}
                      >
                        <span className="truncate">{db}</span>
                        {isSelected && <Check className="h-3.5 w-3.5 text-white shrink-0 ml-2" />}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-zinc-400">
          <Terminal className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-[11px] text-zinc-400">{modKey}+Enter to Execute</span>
        </div>
      </div>

      {/* Monaco Editor Container */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage="sql"
          theme={theme === 'light' ? 'vs' : 'vs-dark'}
          value={sql}
          onChange={(v) => onChange(v ?? '')}
          onMount={handleEditorDidMount}
          options={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: editorFontSize,
            lineHeight: Math.round(editorFontSize * 1.5),
            minimap: { enabled: showMinimap },
            wordWrap: wordWrap ? 'on' : 'off',
            padding: { top: 8, bottom: 8 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            renderLineHighlight: 'all',
            automaticLayout: true,
            quickSuggestions: {
              other: true,
              comments: false,
              strings: false,
            },
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnEnter: 'smart',
            tabCompletion: 'on',
            suggest: {
              showWords: false,
              showKeywords: true,
              showSnippets: true,
              showClasses: true,
              showFields: true,
              showFunctions: true,
              showStructs: true,
            },
          }}
        />
      </div>

      {/* Parameter Prompt Modal */}
      <ParameterPromptModal
        isOpen={pendingParams !== null}
        parameters={pendingParams?.parameters || []}
        sql={pendingParams?.sql || ''}
        onClose={() => setPendingParams(null)}
        onSubmit={(subSql) => {
          const target = pendingParams?.targetDb;
          setPendingParams(null);
          if (isDangerousQuery(subSql)) {
            setPendingDangerous({ sql: subSql, targetDb: target });
          } else {
            proceedExecution(subSql, target);
          }
        }}
      />

      {/* Dangerous Query Modal */}
      <DangerousQueryModal
        isOpen={pendingDangerous !== null}
        sql={pendingDangerous?.sql || ''}
        isProduction={connEnv === 'prod'}
        onClose={() => setPendingDangerous(null)}
        onConfirm={() => {
          const sqlToRun = pendingDangerous?.sql || '';
          const target = pendingDangerous?.targetDb;
          setPendingDangerous(null);
          proceedExecution(sqlToRun, target);
        }}
      />
    </div>
  );
};
