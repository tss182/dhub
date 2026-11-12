import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Table,
  Plus,
  Minus,
  Trash2,
  Key,
  ArrowUp,
  ArrowDown,
  Code,
  FileCode,
  Check,
  AlertCircle,
  Copy,
  Sparkles,
  Database,
  ChevronDown,
  ChevronRight,
  Pencil,
  Save,
  RefreshCw,
  GripVertical,
  HelpCircle,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Hash,
  Server,
  Zap,
} from 'lucide-react';
import { ConnectionConfig, ColumnMeta, resolveConnectionEnv } from '../../types/domain';
import { IndexMeta } from '../../../bindings/dhub/internal/driver/models';
import { QueryService, SchemaService } from '../../../bindings/dhub/internal/services';
import { alertSuccess, alertError, alertWarning } from '../../stores/useAlertStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';

export interface ColumnDefinition {
  id: string;
  name: string;
  originalName?: string;
  dataType: string;
  lengthOrValues: string;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  isNotNull: boolean;
  defaultValue: string;
  comment: string;
}

export interface IndexColumnConfig {
  name: string;
  order: 'ASC' | 'DESC';
  length?: string;
}

export interface IndexDefinition {
  id: string;
  name: string;
  originalName?: string;
  type: 'INDEX' | 'UNIQUE' | 'FULLTEXT' | 'SPATIAL';
  method: string;
  columns: IndexColumnConfig[];
  comment?: string;
}

export interface CreateTableModalProps {
  isOpen: boolean;
  mode?: 'create' | 'edit';
  initialTableName?: string;
  connection: ConnectionConfig | null;
  database: string;
  schema?: string;
  onClose: () => void;
  onTableCreated?: (tableName: string) => void;
  onTableUpdated?: (tableName: string) => void;
}

interface TypeGroup {
  group: string;
  types: string[];
}

const MYSQL_TYPE_GROUPS: TypeGroup[] = [
  {
    group: 'Numeric',
    types: ['INT', 'BIGINT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'DECIMAL', 'FLOAT', 'DOUBLE'],
  },
  {
    group: 'String / Text',
    types: ['VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYTEXT', 'ENUM'],
  },
  {
    group: 'Date / Time',
    types: ['DATETIME', 'TIMESTAMP', 'DATE', 'TIME', 'YEAR'],
  },
  {
    group: 'Boolean / Logical',
    types: ['BOOLEAN', 'BIT'],
  },
  {
    group: 'JSON / Binary',
    types: ['JSON', 'BLOB', 'LONGBLOB', 'BINARY', 'VARBINARY'],
  },
];

const POSTGRES_TYPE_GROUPS: TypeGroup[] = [
  {
    group: 'Numeric',
    types: ['INTEGER', 'BIGINT', 'SMALLINT', 'NUMERIC', 'REAL', 'DOUBLE PRECISION', 'SERIAL', 'BIGSERIAL'],
  },
  {
    group: 'String / Text',
    types: ['VARCHAR', 'TEXT', 'CHAR'],
  },
  {
    group: 'Date / Time',
    types: ['TIMESTAMP', 'TIMESTAMPTZ', 'DATE', 'TIME', 'INTERVAL'],
  },
  {
    group: 'Boolean',
    types: ['BOOLEAN'],
  },
  {
    group: 'JSON / UUID / Binary',
    types: ['JSON', 'JSONB', 'UUID', 'BYTEA'],
  },
];

const SQLITE_TYPE_GROUPS: TypeGroup[] = [
  {
    group: 'Standard Types',
    types: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  },
  {
    group: 'Common Types',
    types: ['VARCHAR', 'DATETIME', 'BOOLEAN'],
  },
];

interface CustomSelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  className?: string;
}

const CustomSelect: React.FC<CustomSelectProps> = ({ value, onChange, options, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const selectedOption = options.find((o) => o.value === value) || { value, label: value };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-7 rounded bg-[#2b2d30] hover:bg-[#323438] border border-[#393b40] hover:border-[#4b4e54] px-2.5 text-xs font-mono text-[#dfe1e5] flex items-center justify-between gap-1.5 transition-colors cursor-pointer select-none"
      >
        <span className="truncate">{selectedOption.label}</span>
        <ChevronDown
          className={`h-3 w-3 text-[#999ca3] shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-[#3574f0]' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 min-w-full rounded border border-[#393b40] bg-[#2b2d30] shadow-2xl p-1 z-50 animate-in fade-in duration-100">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-mono transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[#3574f0] text-white font-semibold'
                    : 'text-[#dfe1e5] hover:bg-[#35373c] hover:text-white'
                }`}
              >
                <span>{opt.label}</span>
                {isSelected && <Check className="h-3 w-3 text-white shrink-0" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface CustomTypeSelectProps {
  value: string;
  onChange: (newType: string) => void;
  typeGroups: TypeGroup[];
}

const CustomTypeSelect: React.FC<CustomTypeSelectProps> = ({ value, onChange, typeGroups }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const filteredGroups = useMemo(() => {
    if (!filterText.trim()) return typeGroups;
    const query = filterText.trim().toUpperCase();
    return typeGroups
      .map((g) => ({
        group: g.group,
        types: g.types.filter((t) => t.toUpperCase().includes(query)),
      }))
      .filter((g) => g.types.length > 0);
  }, [typeGroups, filterText]);

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          setFilterText('');
        }}
        className="w-full h-7 rounded bg-[#2b2d30] hover:bg-[#323438] border border-[#393b40] hover:border-[#4b4e54] px-2.5 text-xs font-mono text-[#cf8e6d] flex items-center justify-between gap-1 transition-colors cursor-pointer select-none font-semibold"
        title="Select Data Type"
      >
        <span className="truncate">{value ? value.toLowerCase() : 'select type'}</span>
        <ChevronDown
          className={`h-3 w-3 text-[#999ca3] shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-[#3574f0]' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-64 max-h-72 overflow-y-auto rounded border border-[#393b40] bg-[#2b2d30] shadow-2xl p-1 z-50 animate-in fade-in duration-100">
          <div className="p-1 pb-1.5 border-b border-[#393b40] sticky top-0 bg-[#2b2d30] z-10">
            <input
              type="text"
              autoFocus
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search type..."
              className="w-full h-6 px-2 text-[11px] font-mono rounded bg-[#1e1f22] border border-[#393b40] text-[#dfe1e5] placeholder-[#6f737a] focus:border-[#3574f0] focus:outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="py-1">
            {filteredGroups.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[#6f737a] italic text-center">
                No matching type
              </div>
            ) : (
              filteredGroups.map((grp) => (
                <div key={grp.group} className="mb-1.5 last:mb-0">
                  <div className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#999ca3] bg-[#1e1f22] rounded mb-0.5 select-none">
                    {grp.group}
                  </div>
                  <div className="space-y-0.5">
                    {grp.types.map((t) => {
                      const isSelected = t.toUpperCase() === value.toUpperCase();
                      return (
                        <div
                          key={t}
                          onClick={() => {
                            onChange(t);
                            setIsOpen(false);
                          }}
                          className={`flex items-center justify-between px-2 py-1 rounded text-xs font-mono cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#3574f0] text-white font-bold'
                              : 'text-[#cf8e6d] hover:bg-[#35373c] hover:text-white'
                          }`}
                        >
                          <span>{t.toLowerCase()}</span>
                          {isSelected && <Check className="h-3 w-3 text-white shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function parseColumnType(typeStr: string): { baseType: string; lengthOrValues: string } {
  if (!typeStr) return { baseType: 'VARCHAR', lengthOrValues: '255' };
  const clean = typeStr.trim();
  const parenIdx = clean.indexOf('(');
  if (parenIdx !== -1) {
    const closeParenIdx = clean.lastIndexOf(')');
    const base = clean.substring(0, parenIdx).trim().toUpperCase();
    const lenOrVals = closeParenIdx > parenIdx ? clean.substring(parenIdx + 1, closeParenIdx).trim() : '';
    return { baseType: base, lengthOrValues: lenOrVals };
  }
  const parts = clean.split(/\s+/);
  return { baseType: parts[0].toUpperCase(), lengthOrValues: '' };
}

function generateAlterSql({
  driver,
  database,
  targetSchema,
  initialTableName,
  newTableName,
  originalColumns,
  columns,
  originalIndexes,
  indexes,
  originalPrimaryKeys,
  originalTableComment,
  tableComment,
}: {
  driver: string;
  database: string;
  targetSchema: string;
  initialTableName: string;
  newTableName: string;
  originalColumns: ColumnMeta[];
  columns: ColumnDefinition[];
  originalIndexes: IndexMeta[];
  indexes: IndexDefinition[];
  originalPrimaryKeys: string[];
  originalTableComment: string;
  tableComment: string;
}): string {
  const statements: string[] = [];
  const cleanTable = newTableName.trim() || initialTableName;
  const isMySQL = driver === 'mysql' || driver === 'mariadb';
  const isPostgres = driver === 'postgres';

  const dbPrefix = isMySQL && database && database !== 'main' ? `\`${database}\`.` : '';
  const schemaPrefix = isPostgres && targetSchema ? `"${targetSchema}".` : '';
  const tableTarget = isMySQL
    ? `${dbPrefix}\`${initialTableName}\``
    : isPostgres
    ? `${schemaPrefix}"${initialTableName}"`
    : `"${initialTableName}"`;

  const validNewCols = columns.filter((c) => c.name.trim().length > 0);

  if (isMySQL) {
    // A. Dropped columns
    originalColumns.forEach((orig) => {
      const stillExists = validNewCols.some(
        (c) => c.originalName === orig.name || c.name.trim().toLowerCase() === orig.name.toLowerCase()
      );
      if (!stillExists) {
        statements.push(`ALTER TABLE ${tableTarget} DROP COLUMN \`${orig.name}\`;`);
      }
    });

    // Track simulated column order in MySQL table
    let currentOrder = originalColumns
      .map((o) => o.name)
      .filter((origName) =>
        validNewCols.some(
          (c) => c.originalName === origName || c.name.trim().toLowerCase() === origName.toLowerCase()
        )
      );

    // B. Added & Changed columns
    validNewCols.forEach((col, idx) => {
      const colName = col.name.trim();
      let colDef = `\`${colName}\` ${col.dataType.toUpperCase()}`;
      if (col.lengthOrValues.trim()) {
        colDef += `(${col.lengthOrValues.trim()})`;
      }
      if (col.isNotNull || col.isPrimaryKey) {
        colDef += ' NOT NULL';
      } else {
        colDef += ' NULL';
      }
      if (col.isAutoIncrement) {
        colDef += ' AUTO_INCREMENT';
      }
      if (col.defaultValue.trim()) {
        const val = col.defaultValue.trim();
        if (val.toUpperCase() === 'CURRENT_TIMESTAMP' || val.toUpperCase() === 'NULL' || !isNaN(Number(val))) {
          colDef += ` DEFAULT ${val}`;
        } else if (val.startsWith("'") && val.endsWith("'")) {
          colDef += ` DEFAULT ${val}`;
        } else {
          colDef += ` DEFAULT '${val}'`;
        }
      }
      if (col.comment.trim()) {
        colDef += ` COMMENT '${col.comment.trim().replace(/'/g, "\\'")}'`;
      }

      const origMatch = originalColumns.find(
        (o) => o.name === col.originalName || o.name.toLowerCase() === colName.toLowerCase()
      );

      const positionClause = idx === 0 ? ' FIRST' : ` AFTER \`${validNewCols[idx - 1].name.trim()}\``;

      if (!origMatch) {
        statements.push(`ALTER TABLE ${tableTarget} ADD COLUMN ${colDef}${positionClause};`);
        currentOrder.splice(idx, 0, colName);
      } else {
        const origParsed = parseColumnType(origMatch.dataType);
        const nameChanged = origMatch.name !== colName;
        const typeChanged =
          origParsed.baseType !== col.dataType.toUpperCase() ||
          origParsed.lengthOrValues !== col.lengthOrValues.trim();
        const nullChanged = origMatch.isNullable === col.isNotNull;
        const autoIncrChanged = Boolean(origMatch.isAutoIncrement) !== Boolean(col.isAutoIncrement);
        const defaultChanged = (origMatch.defaultValue || '') !== col.defaultValue.trim();
        const commentChanged = (origMatch.comment || '') !== col.comment.trim();

        const currentPos = currentOrder.findIndex(
          (name) => name === origMatch.name || name.toLowerCase() === origMatch.name.toLowerCase()
        );
        const positionChanged = currentPos !== idx;

        if (nameChanged || typeChanged || nullChanged || autoIncrChanged || defaultChanged || commentChanged || positionChanged) {
          const posToAppend = positionChanged ? positionClause : '';
          statements.push(`ALTER TABLE ${tableTarget} CHANGE COLUMN \`${origMatch.name}\` ${colDef}${posToAppend};`);
          if (currentPos !== -1) {
            currentOrder.splice(currentPos, 1);
          }
          currentOrder.splice(idx, 0, colName);
        } else {
          if (currentPos !== -1 && currentOrder[currentPos] !== colName) {
            currentOrder[currentPos] = colName;
          }
        }
      }
    });

    // C. Primary Keys
    const newPKs = validNewCols.filter((c) => c.isPrimaryKey).map((c) => c.name.trim());
    const origPKs = [...originalPrimaryKeys];
    const pksChanged =
      newPKs.length !== origPKs.length ||
      !newPKs.every((name) => origPKs.includes(name)) ||
      !origPKs.every((name) => newPKs.includes(name));

    if (pksChanged) {
      if (origPKs.length > 0) {
        statements.push(`ALTER TABLE ${tableTarget} DROP PRIMARY KEY;`);
      }
      if (newPKs.length > 0) {
        statements.push(`ALTER TABLE ${tableTarget} ADD PRIMARY KEY (${newPKs.map((k) => `\`${k}\``).join(', ')});`);
      }
    }

    // D. Indexes
    const origNonPKIdxs = originalIndexes.filter((idx) => !idx.isPrimary && idx.name !== 'PRIMARY');
    origNonPKIdxs.forEach((origIdx) => {
      const stillExists = indexes.some(
        (idx) => idx.originalName === origIdx.name || idx.name.trim() === origIdx.name
      );
      if (!stillExists) {
        statements.push(`ALTER TABLE ${tableTarget} DROP INDEX \`${origIdx.name}\`;`);
      }
    });

    indexes.forEach((idx) => {
      const validCols = idx.columns.filter((c) => c.name.trim() && validNewCols.some((nc) => nc.name.trim() === c.name.trim()));
      if (validCols.length === 0) return;

      const autoPrefix = idx.type === 'UNIQUE' ? 'uk' : 'idx';
      const idxName = idx.name.trim() || `${autoPrefix}_${cleanTable}_${validCols.map((c) => c.name.trim()).join('_')}`;

      const colParts = validCols
        .map((c) => {
          let part = `\`${c.name.trim()}\``;
          if (c.length && c.length.trim()) part += `(${c.length.trim()})`;
          if (c.order === 'DESC') part += ' DESC';
          return part;
        })
        .join(', ');

      let idxKeyword = 'KEY';
      if (idx.type === 'UNIQUE') idxKeyword = 'UNIQUE KEY';
      else if (idx.type === 'FULLTEXT') idxKeyword = 'FULLTEXT KEY';
      else if (idx.type === 'SPATIAL') idxKeyword = 'SPATIAL KEY';

      let idxDef = `ADD ${idxKeyword} \`${idxName}\` (${colParts})`;
      if (idx.method && (idx.method === 'BTREE' || idx.method === 'HASH')) {
        idxDef += ` USING ${idx.method}`;
      }
      if (idx.comment && idx.comment.trim()) {
        idxDef += ` COMMENT '${idx.comment.trim().replace(/'/g, "\\'")}'`;
      }

      const origIdxMatch = origNonPKIdxs.find(
        (o) => o.name === idx.originalName || o.name === idx.name.trim()
      );

      if (!origIdxMatch) {
        statements.push(`ALTER TABLE ${tableTarget} ${idxDef};`);
      } else {
        const colsMatch =
          origIdxMatch.columns &&
          origIdxMatch.columns.length === validCols.length &&
          origIdxMatch.columns.every((c, i) => c === validCols[i].name.trim());
        const nameMatch = origIdxMatch.name === idxName;
        const typeMatch = (origIdxMatch.isUnique ? 'UNIQUE' : 'INDEX') === idx.type;

        if (!colsMatch || !nameMatch || !typeMatch) {
          statements.push(`ALTER TABLE ${tableTarget} DROP INDEX \`${origIdxMatch.name}\`;`);
          statements.push(`ALTER TABLE ${tableTarget} ${idxDef};`);
        }
      }
    });

    if (tableComment.trim() !== (originalTableComment || '').trim()) {
      statements.push(`ALTER TABLE ${tableTarget} COMMENT = '${tableComment.trim().replace(/'/g, "\\")}';`);
    }

    if (cleanTable !== initialTableName) {
      statements.push(`ALTER TABLE ${tableTarget} RENAME TO \`${cleanTable}\`;`);
    }
  } else if (isPostgres) {
    originalColumns.forEach((orig) => {
      const stillExists = validNewCols.some(
        (c) => c.originalName === orig.name || c.name.trim().toLowerCase() === orig.name.toLowerCase()
      );
      if (!stillExists) {
        statements.push(`ALTER TABLE ${tableTarget} DROP COLUMN "${orig.name}";`);
      }
    });

    validNewCols.forEach((col) => {
      const colName = col.name.trim();
      const origMatch = originalColumns.find(
        (o) => o.name === col.originalName || o.name.toLowerCase() === colName.toLowerCase()
      );
      let colDef = `"${colName}" ${col.dataType.toUpperCase()}`;
      if (col.lengthOrValues.trim()) colDef += `(${col.lengthOrValues.trim()})`;

      if (!origMatch) {
        if (col.isNotNull || col.isPrimaryKey) colDef += ' NOT NULL';
        if (col.defaultValue.trim()) colDef += ` DEFAULT ${col.defaultValue.trim()}`;
        statements.push(`ALTER TABLE ${tableTarget} ADD COLUMN ${colDef};`);
      } else {
        if (origMatch.name !== colName) {
          statements.push(`ALTER TABLE ${tableTarget} RENAME COLUMN "${origMatch.name}" TO "${colName}";`);
        }
        if (origMatch.dataType.toUpperCase() !== col.dataType.toUpperCase()) {
          statements.push(`ALTER TABLE ${tableTarget} ALTER COLUMN "${colName}" TYPE ${col.dataType.toUpperCase()};`);
        }
        if (origMatch.isNullable === col.isNotNull) {
          statements.push(
            `ALTER TABLE ${tableTarget} ALTER COLUMN "${colName}" ${col.isNotNull ? 'SET NOT NULL' : 'DROP NOT NULL'};`
          );
        }
      }
    });

    indexes.forEach((idx) => {
      const validCols = idx.columns.filter((c) => c.name.trim() && validNewCols.some((nc) => nc.name.trim() === c.name.trim()));
      if (validCols.length === 0) return;
      const idxName = idx.name.trim() || `idx_${cleanTable}_${validCols.map((c) => c.name.trim()).join('_')}`;
      const uniqueKw = idx.type === 'UNIQUE' ? 'UNIQUE ' : '';
      const methodKw = idx.method ? ` USING ${idx.method}` : '';
      const cols = validCols.map((c) => `"${c.name.trim()}" ${c.order}`).join(', ');
      statements.push(`CREATE ${uniqueKw}INDEX IF NOT EXISTS "${idxName}" ON ${tableTarget}${methodKw} (${cols});`);
    });

    if (cleanTable !== initialTableName) {
      statements.push(`ALTER TABLE ${tableTarget} RENAME TO "${cleanTable}";`);
    }
  } else {
    validNewCols.forEach((col) => {
      const colName = col.name.trim();
      const origMatch = originalColumns.find(
        (o) => o.name === col.originalName || o.name.toLowerCase() === colName.toLowerCase()
      );
      if (!origMatch) {
        let colDef = `"${colName}" ${col.dataType.toUpperCase()}`;
        if (col.isNotNull || col.isPrimaryKey) colDef += ' NOT NULL DEFAULT ""';
        statements.push(`ALTER TABLE "${initialTableName}" ADD COLUMN ${colDef};`);
      } else if (origMatch.name !== colName) {
        statements.push(`ALTER TABLE "${initialTableName}" RENAME COLUMN "${origMatch.name}" TO "${colName}";`);
      }
    });

    indexes.forEach((idx) => {
      const validCols = idx.columns.filter((c) => c.name.trim());
      if (validCols.length === 0) return;
      const idxName = idx.name.trim() || `idx_${cleanTable}_${validCols.map((c) => c.name.trim()).join('_')}`;
      const uniqueKw = idx.type === 'UNIQUE' ? 'UNIQUE ' : '';
      const cols = validCols.map((c) => `"${c.name.trim()}" ${c.order}`).join(', ');
      statements.push(`CREATE ${uniqueKw}INDEX IF NOT EXISTS "${idxName}" ON "${cleanTable}" (${cols});`);
    });

    if (cleanTable !== initialTableName) {
      statements.push(`ALTER TABLE "${initialTableName}" RENAME TO "${cleanTable}";`);
    }
  }

  if (statements.length === 0) {
    return `-- No changes detected for table "${initialTableName}"`;
  }
  return statements.join('\n');
}

function generateCreateTableSql({
  driver,
  database,
  targetSchema,
  tableName,
  columns,
  indexes,
  engine = 'InnoDB',
  charset = 'utf8mb4',
  collation = 'utf8mb4_unicode_ci',
  tableComment = '',
}: {
  driver: string;
  database?: string;
  targetSchema?: string;
  tableName: string;
  columns: ColumnDefinition[];
  indexes: IndexDefinition[];
  engine?: string;
  charset?: string;
  collation?: string;
  tableComment?: string;
}): string {
  const cleanTable = tableName.trim();
  if (!cleanTable) {
    return '-- Enter table name to generate DDL statement';
  }

  const lines: string[] = [];
  const pkCols = columns.filter((c) => c.isPrimaryKey && c.name.trim());
  const validColNames = columns.map((c) => c.name.trim()).filter(Boolean);

  if (driver === 'mysql' || driver === 'mariadb') {
    const dbPrefix = database && database !== 'main' ? `\`${database}\`.` : '';
    columns.forEach((col) => {
      const cName = col.name.trim();
      if (!cName) return;

      let colDef = `  \`${cName}\` ${col.dataType.toUpperCase()}`;
      if (col.lengthOrValues.trim()) {
        colDef += `(${col.lengthOrValues.trim()})`;
      }
      if (col.isNotNull || col.isPrimaryKey) {
        colDef += ' NOT NULL';
      } else {
        colDef += ' NULL';
      }
      if (col.isAutoIncrement) {
        colDef += ' AUTO_INCREMENT';
      }
      if (col.defaultValue.trim()) {
        const val = col.defaultValue.trim();
        if (val.toUpperCase() === 'CURRENT_TIMESTAMP' || val.toUpperCase() === 'NULL' || !isNaN(Number(val))) {
          colDef += ` DEFAULT ${val}`;
        } else if (val.startsWith("'") && val.endsWith("'")) {
          colDef += ` DEFAULT ${val}`;
        } else {
          colDef += ` DEFAULT '${val}'`;
        }
      }
      if (col.comment.trim()) {
        colDef += ` COMMENT '${col.comment.trim().replace(/'/g, "\\'")}'`;
      }
      lines.push(colDef);
    });

    if (pkCols.length > 0) {
      lines.push(`  PRIMARY KEY (${pkCols.map((c) => `\`${c.name.trim()}\``).join(', ')})`);
    }

    indexes.forEach((idx) => {
      const validCols = idx.columns.filter((c) => c.name.trim() && validColNames.includes(c.name.trim()));
      if (validCols.length === 0) return;

      const colParts = validCols
        .map((c) => {
          let part = `\`${c.name.trim()}\``;
          if (c.length && c.length.trim()) part += `(${c.length.trim()})`;
          if (c.order === 'DESC') part += ' DESC';
          return part;
        })
        .join(', ');

      const autoPrefix = idx.type === 'UNIQUE' ? 'uk' : 'idx';
      const idxName = idx.name.trim() || `${autoPrefix}_${cleanTable}_${validCols.map((c) => c.name.trim()).join('_')}`;

      let idxKeyword = 'KEY';
      if (idx.type === 'UNIQUE') idxKeyword = 'UNIQUE KEY';
      else if (idx.type === 'FULLTEXT') idxKeyword = 'FULLTEXT KEY';
      else if (idx.type === 'SPATIAL') idxKeyword = 'SPATIAL KEY';

      let idxDef = `  ${idxKeyword} \`${idxName}\` (${colParts})`;
      if (idx.method && (idx.method === 'BTREE' || idx.method === 'HASH')) {
        idxDef += ` USING ${idx.method}`;
      }
      if (idx.comment && idx.comment.trim()) {
        idxDef += ` COMMENT '${idx.comment.trim().replace(/'/g, "\\'")}'`;
      }
      lines.push(idxDef);
    });

    let ddl = `CREATE TABLE ${dbPrefix}\`${cleanTable}\` (\n${lines.join(',\n')}\n) ENGINE=${engine} DEFAULT CHARSET=${charset} COLLATE=${collation}`;
    if (tableComment.trim()) {
      ddl += ` COMMENT='${tableComment.trim().replace(/'/g, "\\'")}'`;
    }
    return ddl + ';';
  } else if (driver === 'postgres') {
    const schemaPrefix = targetSchema ? `"${targetSchema}".` : '';
    columns.forEach((col) => {
      const cName = col.name.trim();
      if (!cName) return;

      let colDef = `  "${cName}" ${col.dataType.toUpperCase()}`;
      if (col.lengthOrValues.trim()) {
        colDef += `(${col.lengthOrValues.trim()})`;
      }
      if (col.isNotNull || col.isPrimaryKey) {
        colDef += ' NOT NULL';
      }
      if (col.defaultValue.trim()) {
        const val = col.defaultValue.trim();
        if (val.toUpperCase() === 'CURRENT_TIMESTAMP' || val.toUpperCase() === 'NULL' || !isNaN(Number(val))) {
          colDef += ` DEFAULT ${val}`;
        } else if (val.startsWith("'") && val.endsWith("'")) {
          colDef += ` DEFAULT ${val}`;
        } else {
          colDef += ` DEFAULT '${val}'`;
        }
      }
      lines.push(colDef);
    });

    if (pkCols.length > 0) {
      lines.push(`  PRIMARY KEY (${pkCols.map((c) => `"${c.name.trim()}"`).join(', ')})`);
    }

    const statements: string[] = [];
    statements.push(`CREATE TABLE ${schemaPrefix}"${cleanTable}" (\n${lines.join(',\n')}\n);`);

    indexes.forEach((idx) => {
      const validCols = idx.columns.filter((c) => c.name.trim() && validColNames.includes(c.name.trim()));
      if (validCols.length === 0) return;

      const colParts = validCols
        .map((c) => {
          let part = `"${c.name.trim()}"`;
          if (c.order === 'DESC') part += ' DESC';
          return part;
        })
        .join(', ');

      const autoPrefix = idx.type === 'UNIQUE' ? 'uk' : 'idx';
      const idxName = idx.name.trim() || `${autoPrefix}_${cleanTable}_${validCols.map((c) => c.name.trim()).join('_')}`;
      const isUnique = idx.type === 'UNIQUE' ? 'UNIQUE ' : '';
      const methodClause = idx.method && ['BTREE', 'HASH', 'GIN', 'GIST'].includes(idx.method) ? ` USING ${idx.method}` : '';

      statements.push(`CREATE ${isUnique}INDEX "${idxName}" ON ${schemaPrefix}"${cleanTable}"${methodClause} (${colParts});`);
    });

    return statements.join('\n\n');
  } else if (driver === 'mssql') {
    const schemaPrefix = targetSchema ? `[${targetSchema}].` : '';
    columns.forEach((col) => {
      const cName = col.name.trim();
      if (!cName) return;

      let colDef = `  [${cName}] ${col.dataType.toUpperCase()}`;
      if (col.lengthOrValues.trim()) {
        colDef += `(${col.lengthOrValues.trim()})`;
      }
      if (col.isAutoIncrement) {
        colDef += ' IDENTITY(1,1)';
      }
      if (col.isNotNull || col.isPrimaryKey) {
        colDef += ' NOT NULL';
      } else {
        colDef += ' NULL';
      }
      if (col.defaultValue.trim()) {
        const val = col.defaultValue.trim();
        if (val.toUpperCase() === 'CURRENT_TIMESTAMP' || val.toUpperCase() === 'NULL' || !isNaN(Number(val))) {
          colDef += ` DEFAULT ${val}`;
        } else if (val.startsWith("'") && val.endsWith("'")) {
          colDef += ` DEFAULT ${val}`;
        } else {
          colDef += ` DEFAULT '${val}'`;
        }
      }
      lines.push(colDef);
    });

    if (pkCols.length > 0) {
      lines.push(`  PRIMARY KEY (${pkCols.map((c) => `[${c.name.trim()}]`).join(', ')})`);
    }

    const statements: string[] = [];
    statements.push(`CREATE TABLE ${schemaPrefix}[${cleanTable}] (\n${lines.join(',\n')}\n);`);

    indexes.forEach((idx) => {
      const validCols = idx.columns.filter((c) => c.name.trim() && validColNames.includes(c.name.trim()));
      if (validCols.length === 0) return;

      const colParts = validCols
        .map((c) => {
          let part = `[${c.name.trim()}]`;
          if (c.order === 'DESC') part += ' DESC';
          return part;
        })
        .join(', ');

      const autoPrefix = idx.type === 'UNIQUE' ? 'uk' : 'idx';
      const idxName = idx.name.trim() || `${autoPrefix}_${cleanTable}_${validCols.map((c) => c.name.trim()).join('_')}`;
      const isUnique = idx.type === 'UNIQUE' ? 'UNIQUE ' : '';

      statements.push(`CREATE ${isUnique}INDEX [${idxName}] ON ${schemaPrefix}[${cleanTable}] (${colParts});`);
    });

    return statements.join('\n\n');
  } else {
    // SQLite
    columns.forEach((col) => {
      const cName = col.name.trim();
      if (!cName) return;

      let colDef = `  "${cName}" ${col.dataType.toUpperCase()}`;
      if (col.lengthOrValues.trim()) {
        colDef += `(${col.lengthOrValues.trim()})`;
      }
      if (col.isPrimaryKey && pkCols.length === 1) {
        colDef += ' PRIMARY KEY';
        if (col.isAutoIncrement) {
          colDef += ' AUTOINCREMENT';
        }
      } else if (col.isNotNull) {
        colDef += ' NOT NULL';
      }

      if (col.defaultValue.trim()) {
        const val = col.defaultValue.trim();
        if (val.toUpperCase() === 'CURRENT_TIMESTAMP' || val.toUpperCase() === 'NULL' || !isNaN(Number(val))) {
          colDef += ` DEFAULT ${val}`;
        } else if (val.startsWith("'") && val.endsWith("'")) {
          colDef += ` DEFAULT ${val}`;
        } else {
          colDef += ` DEFAULT '${val}'`;
        }
      }
      lines.push(colDef);
    });

    if (pkCols.length > 1) {
      lines.push(`  PRIMARY KEY (${pkCols.map((c) => `"${c.name.trim()}"`).join(', ')})`);
    }

    const statements: string[] = [];
    statements.push(`CREATE TABLE "${cleanTable}" (\n${lines.join(',\n')}\n);`);

    indexes.forEach((idx) => {
      const validCols = idx.columns.filter((c) => c.name.trim() && validColNames.includes(c.name.trim()));
      if (validCols.length === 0) return;

      const colParts = validCols
        .map((c) => {
          let part = `"${c.name.trim()}"`;
          if (c.order === 'DESC') part += ' DESC';
          return part;
        })
        .join(', ');

      const autoPrefix = idx.type === 'UNIQUE' ? 'uk' : 'idx';
      const idxName = idx.name.trim() || `${autoPrefix}_${cleanTable}_${validCols.map((c) => c.name.trim()).join('_')}`;
      const isUnique = idx.type === 'UNIQUE' ? 'UNIQUE ' : '';

      statements.push(`CREATE ${isUnique}INDEX "${idxName}" ON "${cleanTable}" (${colParts});`);
    });

    return statements.join('\n\n');
  }
}

type SelectedNodeType =
  | { type: 'table' }
  | { type: 'columns_folder' }
  | { type: 'column'; id: string }
  | { type: 'keys_folder' }
  | { type: 'key'; id: string }
  | { type: 'indexes_folder' }
  | { type: 'index'; id: string }
  | { type: 'foreign_keys_folder' }
  | { type: 'checks_folder' }
  | { type: 'triggers_folder' }
  | { type: 'virtual_columns_folder' }
  | { type: 'virtual_foreign_keys_folder' };

export const CreateTableModal: React.FC<CreateTableModalProps> = ({
  isOpen,
  mode = 'create',
  initialTableName = '',
  connection,
  database,
  schema,
  onClose,
  onTableCreated,
  onTableUpdated,
}) => {
  const isEditMode = mode === 'edit';
  const [tableName, setTableName] = useState('');
  const [tableComment, setTableComment] = useState('');
  const [engine, setEngine] = useState('InnoDB');
  const [charset, setCharset] = useState('utf8mb4');
  const [collation, setCollation] = useState('utf8mb4_unicode_ci');
  const [columns, setColumns] = useState<ColumnDefinition[]>([]);
  const [indexes, setIndexes] = useState<IndexDefinition[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);
  const [dragOverColIndex, setDragOverColIndex] = useState<number | null>(null);

  // Tree selection & expansion
  const [selectedNode, setSelectedNode] = useState<SelectedNodeType>({ type: 'table' });
  const [showPreviewPane, setShowPreviewPane] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<{ [key: string]: boolean }>({
    columns: true,
    keys: true,
    indexes: true,
    foreign_keys: false,
    checks: false,
    triggers: false,
    virtual_columns: false,
    virtual_foreign_keys: false,
  });

  // States for Edit Mode tracking
  const [originalColumns, setOriginalColumns] = useState<ColumnMeta[]>([]);
  const [originalIndexes, setOriginalIndexes] = useState<IndexMeta[]>([]);
  const [originalPrimaryKeys, setOriginalPrimaryKeys] = useState<string[]>([]);
  const [originalTableComment, setOriginalTableComment] = useState('');
  const [isLoadingStructure, setIsLoadingStructure] = useState(false);

  const driver = connection?.driver || 'mysql';
  const targetSchema = schema || (driver === 'postgres' ? 'public' : driver === 'mssql' ? 'dbo' : database);

  const typeGroups = useMemo(() => {
    if (driver === 'postgres') return POSTGRES_TYPE_GROUPS;
    if (driver === 'sqlite') return SQLITE_TYPE_GROUPS;
    return MYSQL_TYPE_GROUPS;
  }, [driver]);

  const indexTypeOptions = useMemo(() => {
    if (driver === 'mysql' || driver === 'mariadb') {
      return [
        { value: 'INDEX', label: 'INDEX (Normal)' },
        { value: 'UNIQUE', label: 'UNIQUE' },
        { value: 'FULLTEXT', label: 'FULLTEXT' },
        { value: 'SPATIAL', label: 'SPATIAL' },
      ];
    }
    return [
      { value: 'INDEX', label: 'INDEX (Normal)' },
      { value: 'UNIQUE', label: 'UNIQUE' },
    ];
  }, [driver]);

  const indexMethodOptions = useMemo(() => {
    if (driver === 'postgres') {
      return [
        { value: 'BTREE', label: 'BTREE' },
        { value: 'HASH', label: 'HASH' },
        { value: 'GIN', label: 'GIN' },
        { value: 'GIST', label: 'GIST' },
      ];
    }
    return [
      { value: 'BTREE', label: 'BTREE' },
      { value: 'HASH', label: 'HASH' },
    ];
  }, [driver]);

  const toggleFolder = (key: string) => {
    setExpandedFolders((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (!isOpen) return;

    setCopiedSql(false);
    setDraggedColIndex(null);
    setDragOverColIndex(null);

    if (isEditMode && initialTableName && connection) {
      setIsLoadingStructure(true);
      setTableName(initialTableName);
      SchemaService.GetTableStructure(
        connection.id,
        database || connection.databaseName || 'main',
        targetSchema,
        initialTableName
      )
        .then((structure) => {
          if (!structure) return;
          if (structure.engine) setEngine(structure.engine);
          if (structure.collation) setCollation(structure.collation);
          const cmt = structure.comment || '';
          setTableComment(cmt);
          setOriginalTableComment(cmt);

          const cols = structure.columns || [];
          setOriginalColumns(cols);
          const pks = structure.primaryKeys || [];
          setOriginalPrimaryKeys(pks);

          const mappedCols: ColumnDefinition[] = cols.map((col, idx) => {
            const parsed = parseColumnType(col.dataType);
            return {
              id: 'col-' + idx + '-' + col.name,
              name: col.name,
              originalName: col.name,
              dataType: parsed.baseType,
              lengthOrValues: parsed.lengthOrValues,
              isPrimaryKey: Boolean(col.isPrimaryKey || pks.includes(col.name)),
              isAutoIncrement: Boolean(col.isAutoIncrement),
              isNotNull: !col.isNullable,
              defaultValue: col.defaultValue || '',
              comment: col.comment || '',
            };
          });

          const finalCols =
            mappedCols.length > 0
              ? mappedCols
              : [
                  {
                    id: 'col-1',
                    name: 'id',
                    dataType: driver === 'sqlite' ? 'INTEGER' : driver === 'postgres' ? 'BIGINT' : 'INT',
                    lengthOrValues: '',
                    isPrimaryKey: true,
                    isAutoIncrement: true,
                    isNotNull: true,
                    defaultValue: '',
                    comment: '',
                  },
                ];

          setColumns(finalCols);
          setSelectedNode({ type: 'column', id: finalCols[0].id });

          const idxs = (structure.indexes || []).filter(
            (idx) => !idx.isPrimary && idx.name !== 'PRIMARY'
          );
          setOriginalIndexes(idxs);
          const mappedIdxs: IndexDefinition[] = idxs.map((idx, i) => {
            let idxType: 'INDEX' | 'UNIQUE' | 'FULLTEXT' | 'SPATIAL' = 'INDEX';
            if (idx.isUnique) idxType = 'UNIQUE';
            else if (idx.type === 'FULLTEXT') idxType = 'FULLTEXT';
            else if (idx.type === 'SPATIAL') idxType = 'SPATIAL';

            return {
              id: 'idx-' + i + '-' + idx.name,
              name: idx.name,
              originalName: idx.name,
              type: idxType,
              method: idx.method ? idx.method.toUpperCase() : 'BTREE',
              columns: (idx.columns || []).map((colName) => ({
                name: colName,
                order: 'ASC',
                length: '',
              })),
              comment: idx.comment || '',
            };
          });
          setIndexes(mappedIdxs);
        })
        .catch((err) => {
          console.error('Failed to load table structure:', err);
          alertError(
            err?.message || 'Failed to fetch table structure',
            'Error Loading Structure'
          );
        })
        .finally(() => {
          setIsLoadingStructure(false);
        });
    } else {
      setTableName('');
      setTableComment('');
      setEngine('InnoDB');
      setCharset('utf8mb4');
      setCollation('utf8mb4_unicode_ci');
      setIndexes([]);
      setOriginalColumns([]);
      setOriginalIndexes([]);
      setOriginalPrimaryKeys([]);
      setOriginalTableComment('');
      setIsLoadingStructure(false);

      const defaultCols: ColumnDefinition[] = [
        {
          id: 'col-1',
          name: 'id',
          dataType: driver === 'sqlite' ? 'INTEGER' : driver === 'postgres' ? 'BIGINT' : 'INT',
          lengthOrValues: '',
          isPrimaryKey: true,
          isAutoIncrement: true,
          isNotNull: true,
          defaultValue: '',
          comment: '',
        },
      ];
      setColumns(defaultCols);
      setSelectedNode({ type: 'column', id: defaultCols[0].id });
    }
  }, [isOpen, isEditMode, initialTableName, connection, database, targetSchema, driver]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleAddColumn = () => {
    const newCol: ColumnDefinition = {
      id: 'col-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      name: `col_${columns.length + 1}`,
      dataType: driver === 'sqlite' ? 'TEXT' : 'VARCHAR',
      lengthOrValues: driver === 'sqlite' ? '' : '255',
      isPrimaryKey: false,
      isAutoIncrement: false,
      isNotNull: false,
      defaultValue: '',
      comment: '',
    };
    setColumns((prev) => [...prev, newCol]);
    setSelectedNode({ type: 'column', id: newCol.id });
    setExpandedFolders((prev) => ({ ...prev, columns: true }));
  };

  const handleRemoveColumn = (id: string) => {
    if (columns.length <= 1) {
      alertWarning('A table must have at least one column.', 'Cannot Remove Column');
      return;
    }
    const colToRemove = columns.find((c) => c.id === id);
    const remaining = columns.filter((c) => c.id !== id);
    setColumns(remaining);

    if (selectedNode.type === 'column' && selectedNode.id === id) {
      setSelectedNode({ type: 'column', id: remaining[0].id });
    }

    if (colToRemove?.name) {
      setIndexes((prev) =>
        prev.map((idx) => ({
          ...idx,
          columns: idx.columns.filter((c) => c.name !== colToRemove.name),
        }))
      );
    }
  };

  const handleMoveColumn = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= columns.length) return;
    setColumns((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  const handleUpdateColumn = (id: string, updates: Partial<ColumnDefinition>) => {
    const oldCol = columns.find((c) => c.id === id);
    const oldName = oldCol?.name;

    setColumns((prev) =>
      prev.map((col) => {
        if (col.id !== id) return col;
        const next = { ...col, ...updates };

        if (updates.isPrimaryKey === true) {
          next.isNotNull = true;
        }

        if (updates.isAutoIncrement === true) {
          next.isPrimaryKey = true;
          next.isNotNull = true;
          if (driver === 'sqlite' && next.dataType !== 'INTEGER') {
            next.dataType = 'INTEGER';
          }
        }

        return next;
      })
    );

    if (updates.name && oldName && updates.name !== oldName) {
      setIndexes((prev) =>
        prev.map((idx) => ({
          ...idx,
          columns: idx.columns.map((c) => (c.name === oldName ? { ...c, name: updates.name! } : c)),
        }))
      );
    }
  };

  const handleAddIndex = () => {
    const namedCols = columns.filter((c) => c.name.trim());
    const firstCol = namedCols[0]?.name.trim() || '';
    const cleanTbl = tableName.trim() || 'table';
    const newIdx: IndexDefinition = {
      id: 'idx-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      name: firstCol ? `idx_${cleanTbl}_${firstCol}` : `idx_${cleanTbl}_${indexes.length + 1}`,
      type: 'INDEX',
      method: driver === 'sqlite' ? '' : 'BTREE',
      columns: firstCol ? [{ name: firstCol, order: 'ASC' }] : [],
      comment: '',
    };
    setIndexes((prev) => [...prev, newIdx]);
    setSelectedNode({ type: 'index', id: newIdx.id });
    setExpandedFolders((prev) => ({ ...prev, indexes: true }));
  };

  const handleUpdateIndex = (id: string, updates: Partial<IndexDefinition>) => {
    setIndexes((prev) => prev.map((idx) => (idx.id === id ? { ...idx, ...updates } : idx)));
  };

  const handleRemoveIndex = (id: string) => {
    const remaining = indexes.filter((idx) => idx.id !== id);
    setIndexes(remaining);
    if (selectedNode.type === 'index' && selectedNode.id === id) {
      setSelectedNode(remaining.length > 0 ? { type: 'index', id: remaining[0].id } : { type: 'indexes_folder' });
    }
  };

  const handleAddColumnToIndex = (indexId: string, colName: string) => {
    if (!colName) return;
    setIndexes((prev) =>
      prev.map((idx) => {
        if (idx.id !== indexId) return idx;
        if (idx.columns.some((c) => c.name === colName)) return idx;
        const newCols = [...idx.columns, { name: colName, order: 'ASC' as const }];
        return {
          ...idx,
          columns: newCols,
        };
      })
    );
  };

  const handleRemoveColumnFromIndex = (indexId: string, colIndex: number) => {
    setIndexes((prev) =>
      prev.map((idx) => {
        if (idx.id !== indexId) return idx;
        const newCols = idx.columns.filter((_, i) => i !== colIndex);
        return { ...idx, columns: newCols };
      })
    );
  };

  // Generate DDL SQL string
  const generatedSql = useMemo(() => {
    if (isEditMode) {
      return generateAlterSql({
        driver,
        database,
        targetSchema,
        initialTableName,
        newTableName: tableName,
        originalColumns,
        columns,
        originalIndexes,
        indexes,
        originalPrimaryKeys,
        originalTableComment,
        tableComment,
      });
    }

    return generateCreateTableSql({
      driver,
      database,
      targetSchema,
      tableName,
      columns,
      indexes,
      engine,
      charset,
      collation,
      tableComment,
    });
  }, [
    tableName,
    columns,
    indexes,
    database,
    targetSchema,
    engine,
    charset,
    collation,
    tableComment,
    driver,
    isEditMode,
    initialTableName,
    originalColumns,
    originalIndexes,
    originalPrimaryKeys,
    originalTableComment,
  ]);

  const handleCopySql = () => {
    if (!generatedSql) return;
    navigator.clipboard.writeText(generatedSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 1500);
  };

  const handleCreateTable = async () => {
    if (!connection) return;

    const cleanTable = tableName.trim();
    if (!cleanTable) {
      alertWarning('Please enter a valid table name.', 'Missing Table Name');
      return;
    }

    if (!/^[a-zA-Z0-9_$-]+$/.test(cleanTable)) {
      alertWarning(
        'Table name can only contain letters, numbers, underscores, dashes, and dollar signs.',
        'Invalid Table Name'
      );
      return;
    }

    const validCols = columns.filter((c) => c.name.trim().length > 0);
    if (validCols.length === 0) {
      alertWarning('Please define at least one column with a valid name.', 'Missing Column Names');
      return;
    }

    const nameSet = new Set<string>();
    for (const c of validCols) {
      const lower = c.name.trim().toLowerCase();
      if (nameSet.has(lower)) {
        alertWarning(`Duplicate column name detected: "${c.name.trim()}".`, 'Duplicate Column Name');
        return;
      }
      nameSet.add(lower);
    }

    setIsSubmitting(true);
    try {
      const execId = 'create-table-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: connection.id,
        database: database || connection.databaseName || 'main',
        schema: targetSchema,
        sql: generatedSql,
        limit: 10,
        offset: 0,
      } as any);

      const schemaKey = `${connection.id}:${database}:${targetSchema}`;
      try {
        const objects = await SchemaService.GetObjects(connection.id, database, targetSchema);
        if (objects) {
          useConnectionStore.getState().setTreeObjects(schemaKey, objects as any);
        }
      } catch {}

      useWorkbenchStore.getState().openTab({
        id: `table-${connection.id}-${database}-${cleanTable}`,
        title: cleanTable,
        type: 'table_data',
        connectionId: connection.id,
        database: database,
        schema: targetSchema,
        table: cleanTable,
        driver: connection.driver,
      });

      alertSuccess(
        `Table "${cleanTable}" has been created successfully in database "${database}".`,
        'Table Created'
      );

      onTableCreated?.(cleanTable);
      onClose();
    } catch (err: any) {
      alertError(
        err?.message || String(err),
        'Failed to Create Table',
        generatedSql
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditTable = async () => {
    if (!connection) return;
    const cleanTable = tableName.trim();
    if (!cleanTable) {
      alertWarning('Please enter a valid table name.', 'Missing Table Name');
      return;
    }

    if (!generatedSql || generatedSql.startsWith('-- No changes')) {
      alertWarning('No structure changes detected to apply.', 'No Changes');
      return;
    }

    const validCols = columns.filter((c) => c.name.trim().length > 0);
    if (validCols.length === 0) {
      alertWarning('Please define at least one column with a valid name.', 'Missing Column Names');
      return;
    }

    const nameSet = new Set<string>();
    for (const c of validCols) {
      const lower = c.name.trim().toLowerCase();
      if (nameSet.has(lower)) {
        alertWarning(`Duplicate column name detected: "${c.name.trim()}".`, 'Duplicate Column Name');
        return;
      }
      nameSet.add(lower);
    }

    setIsSubmitting(true);
    try {
      const execId = 'alter-table-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: connection.id,
        database: database || connection.databaseName || 'main',
        schema: targetSchema,
        sql: generatedSql,
        limit: 10,
        offset: 0,
      } as any);

      const schemaKey = `${connection.id}:${database}:${targetSchema}`;
      try {
        const objects = await SchemaService.GetObjects(connection.id, database, targetSchema);
        if (objects) {
          useConnectionStore.getState().setTreeObjects(schemaKey, objects as any);
        }
      } catch {}

      const workbenchTabs = useWorkbenchStore.getState().tabs;
      const matchingTab = workbenchTabs.find(
        (t) => t.type === 'table_data' && (t.table === initialTableName || t.table === cleanTable)
      );
      if (matchingTab) {
        if (cleanTable !== initialTableName) {
          useWorkbenchStore.getState().renameTab(matchingTab.id, cleanTable);
        }
        useWorkbenchStore.getState().refreshTab(matchingTab.id);
      }

      alertSuccess(
        `Structure for table "${cleanTable}" has been updated successfully.`,
        'Table Structure Updated'
      );

      onTableUpdated?.(cleanTable);
      onClose();
    } catch (err: any) {
      alertError(
        err?.message || String(err),
        'Failed to Update Table Structure',
        generatedSql
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isEditMode) {
      await handleEditTable();
    } else {
      await handleCreateTable();
    }
  };

  if (!isOpen) return null;

  const pkCols = columns.filter((c) => c.isPrimaryKey && c.name.trim());
  const activeCol =
    selectedNode.type === 'column'
      ? columns.find((c) => c.id === selectedNode.id) || columns[0]
      : columns[0];
  const activeIdx =
    selectedNode.type === 'index'
      ? indexes.find((i) => i.id === selectedNode.id) || indexes[0]
      : indexes[0];

  return (
    <div className="fixed inset-0 z-50 bg-[#1e1f22] text-[#bcbec4] flex flex-col font-sans select-none overflow-hidden animate-in fade-in duration-100">
      {/* 1. Window Title Bar */}
      <div className="flex h-10 items-center justify-between border-b border-[#393b40] px-3.5 bg-[#1e1f22] shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-5 h-5 rounded bg-[#2e436e] text-blue-400">
            <Table className="w-3.5 h-3.5 text-blue-300" />
          </div>
          <span className="text-xs font-semibold text-[#dfe1e5]">
            {isEditMode ? 'Modify' : 'New Table'}
          </span>
          {isEditMode && initialTableName && (
            <span className="text-xs text-[#999ca3] font-mono">
              — {initialTableName}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded text-[#999ca3] hover:text-[#dfe1e5] hover:bg-[#35373c] transition-colors cursor-pointer"
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isLoadingStructure ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#999ca3]">
          <RefreshCw className="h-6 w-6 animate-spin text-blue-400" />
          <span className="text-xs">Loading structure for table &ldquo;{initialTableName}&rdquo;...</span>
        </div>
      ) : (
        <>
          {/* 2. Main Middle Area: Split Left Tree & Right Form Editor */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Left Tree Panel */}
            <div className="w-[360px] shrink-0 border-r border-[#393b40] flex flex-col h-full bg-[#1e1f22]">
              {/* Tree Action Toolbar */}
              <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#393b40] bg-[#1e1f22] shrink-0">
                <div className="flex items-center gap-0.5">
                  {/* Add Button */}
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedNode.type === 'index' || selectedNode.type === 'indexes_folder') {
                        handleAddIndex();
                      } else {
                        handleAddColumn();
                      }
                    }}
                    className="p-1 rounded text-[#999ca3] hover:text-[#dfe1e5] hover:bg-[#35373c] transition-colors cursor-pointer"
                    title="Add (Alt+Insert)"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>

                  {/* Remove Button */}
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedNode.type === 'column') {
                        handleRemoveColumn(selectedNode.id);
                      } else if (selectedNode.type === 'index') {
                        handleRemoveIndex(selectedNode.id);
                      }
                    }}
                    disabled={selectedNode.type !== 'column' && selectedNode.type !== 'index'}
                    className="p-1 rounded text-[#999ca3] hover:text-rose-400 hover:bg-[#35373c] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                    title="Remove (Delete)"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>

                  {/* Edit Button */}
                  <button
                    type="button"
                    className="p-1 rounded text-[#999ca3] hover:text-[#dfe1e5] hover:bg-[#35373c] transition-colors cursor-pointer"
                    title="Edit"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>

                  {/* Move Up Button (hidden on postgres) */}
                  {driver !== 'postgres' && (
                    <button
                      type="button"
                      disabled={
                        selectedNode.type !== 'column' ||
                        columns.findIndex((c) => c.id === selectedNode.id) <= 0
                      }
                      onClick={() => {
                        if (selectedNode.type === 'column') {
                          const idx = columns.findIndex((c) => c.id === selectedNode.id);
                          if (idx > 0) handleMoveColumn(idx, 'up');
                        }
                      }}
                      className="p-1 rounded text-[#999ca3] hover:text-[#dfe1e5] hover:bg-[#35373c] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                      title="Move Up (Alt+Up)"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {/* Move Down Button (hidden on postgres) */}
                  {driver !== 'postgres' && (
                    <button
                      type="button"
                      disabled={
                        selectedNode.type !== 'column' ||
                        columns.findIndex((c) => c.id === selectedNode.id) === -1 ||
                        columns.findIndex((c) => c.id === selectedNode.id) >= columns.length - 1
                      }
                      onClick={() => {
                        if (selectedNode.type === 'column') {
                          const idx = columns.findIndex((c) => c.id === selectedNode.id);
                          if (idx !== -1 && idx < columns.length - 1) handleMoveColumn(idx, 'down');
                        }
                      }}
                      className="p-1 rounded text-[#999ca3] hover:text-[#dfe1e5] hover:bg-[#35373c] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                      title="Move Down (Alt+Down)"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Tree Content */}
              <div className="flex-1 overflow-y-auto py-1 font-mono text-xs select-none">
                {/* 1. Table Root Node */}
                <div
                  onClick={() => setSelectedNode({ type: 'table' })}
                  className={`flex items-center gap-1.5 px-3 py-1 cursor-pointer transition-colors ${
                    selectedNode.type === 'table'
                      ? 'bg-[#2e436e] text-white font-medium'
                      : 'text-[#dfe1e5] hover:bg-[#2b2d30]'
                  }`}
                >
                  <ChevronDown className="w-3.5 h-3.5 text-[#999ca3] shrink-0" />
                  <Table className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className="font-semibold text-[11px] truncate">
                    {tableName.trim() || initialTableName || 'table'}
                  </span>
                  <span className="text-[10px] text-[#999ca3] truncate font-normal">
                    {database || 'db'} [{connection?.host || 'localhost'}]
                  </span>
                </div>

                <div className="pl-4">
                  {/* 2. Columns Folder */}
                  <div>
                    <div
                      onClick={() => {
                        toggleFolder('columns');
                        setSelectedNode({ type: 'columns_folder' });
                      }}
                      className={`flex items-center justify-between px-3 py-1 cursor-pointer transition-colors ${
                        selectedNode.type === 'columns_folder'
                          ? 'bg-[#2e436e] text-white font-medium'
                          : 'text-[#dfe1e5] hover:bg-[#2b2d30]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-[#999ca3] shrink-0 transition-transform ${
                            expandedFolders.columns ? '' : '-rotate-90'
                          }`}
                        />
                        {expandedFolders.columns ? (
                          <FolderOpen className="w-3.5 h-3.5 text-[#e5a065] shrink-0" />
                        ) : (
                          <Folder className="w-3.5 h-3.5 text-[#e5a065] shrink-0" />
                        )}
                        <span className="text-[11px]">columns</span>
                      </div>
                      <span className="text-[10px] text-[#999ca3] pr-2 font-mono">
                        {columns.length}
                      </span>
                    </div>

                    {/* Columns Items */}
                    {expandedFolders.columns && (
                      <div className="pl-6 space-y-0.5 py-0.5">
                        {columns.map((col, idx) => {
                          const isSelected = selectedNode.type === 'column' && selectedNode.id === col.id;
                          const isBeingDragged = draggedColIndex === idx;
                          const isDragOver = dragOverColIndex === idx && draggedColIndex !== idx;

                          return (
                            <div
                              key={col.id}
                              onClick={() => setSelectedNode({ type: 'column', id: col.id })}
                              draggable={driver !== 'postgres'}
                              onDragStart={(e) => {
                                e.stopPropagation();
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', String(idx));
                                setDraggedColIndex(idx);
                              }}
                              onDragEnd={() => {
                                setDraggedColIndex(null);
                                setDragOverColIndex(null);
                              }}
                              onDragOver={(e) => {
                                if (draggedColIndex === null || driver === 'postgres') return;
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                if (dragOverColIndex !== idx) setDragOverColIndex(idx);
                              }}
                              onDragLeave={() => {
                                if (dragOverColIndex === idx) setDragOverColIndex(null);
                              }}
                              onDrop={(e) => {
                                if (draggedColIndex === null || driver === 'postgres') return;
                                e.preventDefault();
                                if (draggedColIndex !== idx) {
                                  setColumns((prev) => {
                                    const copy = [...prev];
                                    const [moved] = copy.splice(draggedColIndex, 1);
                                    copy.splice(idx, 0, moved);
                                    return copy;
                                  });
                                }
                                setDraggedColIndex(null);
                                setDragOverColIndex(null);
                              }}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded-sm cursor-pointer transition-colors group ${
                                isSelected
                                  ? 'bg-[#2e436e] text-white font-medium'
                                  : 'text-[#dfe1e5] hover:bg-[#2b2d30]'
                              } ${isBeingDragged ? 'opacity-35 bg-blue-950/40' : ''} ${
                                isDragOver ? 'bg-blue-600/20 border-t-2 border-t-blue-500' : ''
                              }`}
                            >
                              {driver !== 'postgres' ? (
                                <GripVertical className="w-3 h-3 text-[#6f737a] group-hover:text-[#999ca3] shrink-0 cursor-grab" />
                              ) : null}

                              <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                                {col.isPrimaryKey ? (
                                  <Key className="w-3 h-3 text-amber-400" />
                                ) : (
                                  <span className="text-[10px] text-[#999ca3] font-bold">🔤</span>
                                )}
                              </div>

                              <span className="text-[11px] font-mono truncate">
                                {col.name || 'unnamed'}
                              </span>

                              <span className="text-[10px] text-[#cf8e6d] truncate font-mono">
                                {col.dataType.toLowerCase()}
                                {col.lengthOrValues ? `(${col.lengthOrValues})` : ''}
                              </span>

                              {col.isAutoIncrement && (
                                <span className="text-[9px] text-[#999ca3] truncate font-normal">
                                  (auto increment)
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 3. Keys Folder */}
                  <div>
                    <div
                      onClick={() => {
                        toggleFolder('keys');
                        setSelectedNode({ type: 'keys_folder' });
                      }}
                      className={`flex items-center justify-between px-3 py-1 cursor-pointer transition-colors ${
                        selectedNode.type === 'keys_folder'
                          ? 'bg-[#2e436e] text-white font-medium'
                          : 'text-[#dfe1e5] hover:bg-[#2b2d30]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-[#999ca3] shrink-0 transition-transform ${
                            expandedFolders.keys ? '' : '-rotate-90'
                          }`}
                        />
                        {expandedFolders.keys ? (
                          <FolderOpen className="w-3.5 h-3.5 text-[#e5a065] shrink-0" />
                        ) : (
                          <Folder className="w-3.5 h-3.5 text-[#e5a065] shrink-0" />
                        )}
                        <span className="text-[11px]">keys</span>
                      </div>
                      <span className="text-[10px] text-[#999ca3] pr-2 font-mono">
                        {pkCols.length > 0 ? 1 : 0}
                      </span>
                    </div>

                    {expandedFolders.keys && pkCols.length > 0 && (
                      <div className="pl-6 py-0.5">
                        <div
                          onClick={() => setSelectedNode({ type: 'key', id: 'primary' })}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-sm cursor-pointer transition-colors ${
                            selectedNode.type === 'key'
                              ? 'bg-[#2e436e] text-white font-medium'
                              : 'text-[#dfe1e5] hover:bg-[#2b2d30]'
                          }`}
                        >
                          <Key className="w-3 h-3 text-amber-400 shrink-0" />
                          <span className="text-[11px] font-mono">
                            PRIMARY ({pkCols.map((c) => c.name).join(', ')})
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 4. Foreign Keys Folder */}
                  <div>
                    <div
                      onClick={() => {
                        toggleFolder('foreign_keys');
                        setSelectedNode({ type: 'foreign_keys_folder' });
                      }}
                      className="flex items-center justify-between px-3 py-1 cursor-pointer hover:bg-[#2b2d30] text-[#dfe1e5]"
                    >
                      <div className="flex items-center gap-1.5">
                        <ChevronRight className="w-3.5 h-3.5 text-[#999ca3] shrink-0" />
                        <Folder className="w-3.5 h-3.5 text-[#e5a065] shrink-0" />
                        <span className="text-[11px]">foreign keys</span>
                      </div>
                    </div>
                  </div>

                  {/* 5. Indexes Folder */}
                  <div>
                    <div
                      onClick={() => {
                        toggleFolder('indexes');
                        setSelectedNode({ type: 'indexes_folder' });
                      }}
                      className={`flex items-center justify-between px-3 py-1 cursor-pointer transition-colors ${
                        selectedNode.type === 'indexes_folder'
                          ? 'bg-[#2e436e] text-white font-medium'
                          : 'text-[#dfe1e5] hover:bg-[#2b2d30]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-[#999ca3] shrink-0 transition-transform ${
                            expandedFolders.indexes ? '' : '-rotate-90'
                          }`}
                        />
                        {expandedFolders.indexes ? (
                          <FolderOpen className="w-3.5 h-3.5 text-[#e5a065] shrink-0" />
                        ) : (
                          <Folder className="w-3.5 h-3.5 text-[#e5a065] shrink-0" />
                        )}
                        <span className="text-[11px]">indexes</span>
                      </div>
                      <span className="text-[10px] text-[#999ca3] pr-2 font-mono">
                        {indexes.length}
                      </span>
                    </div>

                    {expandedFolders.indexes && (
                      <div className="pl-6 space-y-0.5 py-0.5">
                        {indexes.map((idx) => {
                          const isSelected = selectedNode.type === 'index' && selectedNode.id === idx.id;
                          return (
                            <div
                              key={idx.id}
                              onClick={() => setSelectedNode({ type: 'index', id: idx.id })}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded-sm cursor-pointer transition-colors ${
                                isSelected
                                  ? 'bg-[#2e436e] text-white font-medium'
                                  : 'text-[#dfe1e5] hover:bg-[#2b2d30]'
                              }`}
                            >
                              <Zap className="w-3 h-3 text-emerald-400 shrink-0" />
                              <span className="text-[11px] font-mono truncate">
                                {idx.name} ({idx.columns.map((c) => c.name).join(', ')})
                              </span>
                              {idx.type === 'UNIQUE' && (
                                <span className="text-[9px] text-[#999ca3] font-normal uppercase">
                                  UNIQUE
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 6. Static Tree Folders like DataGrip */}
                  <div className="flex items-center gap-1.5 px-3 py-1 cursor-pointer hover:bg-[#2b2d30] text-[#999ca3]">
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                    <Folder className="w-3.5 h-3.5 text-[#e5a065] shrink-0" />
                    <span className="text-[11px]">checks</span>
                  </div>

                  <div className="flex items-center gap-1.5 px-3 py-1 cursor-pointer hover:bg-[#2b2d30] text-[#999ca3]">
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                    <Folder className="w-3.5 h-3.5 text-[#e5a065] shrink-0" />
                    <span className="text-[11px]">triggers</span>
                  </div>

                  <div className="flex items-center gap-1.5 px-3 py-1 cursor-pointer hover:bg-[#2b2d30] text-[#999ca3]">
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                    <Folder className="w-3.5 h-3.5 text-[#e5a065] shrink-0" />
                    <span className="text-[11px]">virtual columns</span>
                  </div>

                  <div className="flex items-center gap-1.5 px-3 py-1 cursor-pointer hover:bg-[#2b2d30] text-[#999ca3]">
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                    <Folder className="w-3.5 h-3.5 text-[#e5a065] shrink-0" />
                    <span className="text-[11px]">virtual foreign keys</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Detail Properties Editor Panel */}
            <div className="flex-1 flex flex-col h-full bg-[#1e1f22] overflow-y-auto">
              {/* Case 1: Column Properties */}
              {selectedNode.type === 'column' && activeCol && (
                <div className="p-6 max-w-3xl space-y-4">
                  {/* Top Item Header */}
                  <div className="flex items-center justify-between pb-3 border-b border-[#393b40]/60">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded border border-[#6f737a] flex items-center justify-center">
                        <Check className="w-3 h-3 text-[#3574f0]" />
                      </div>
                      <span className="font-mono text-sm text-[#dfe1e5] font-semibold">
                        {activeCol.name || 'unnamed_column'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="p-1 rounded text-[#999ca3] hover:text-[#dfe1e5] hover:bg-[#35373c] transition-colors"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Form Grid */}
                  <div className="space-y-3 text-xs">
                    {/* Name */}
                    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-[#999ca3] font-medium">Name</label>
                      <input
                        type="text"
                        value={activeCol.name}
                        onChange={(e) => handleUpdateColumn(activeCol.id, { name: e.target.value })}
                        className="w-full h-7 px-2.5 rounded bg-[#2b2d30] border border-[#393b40] focus:border-[#3574f0] focus:outline-none text-[#dfe1e5] font-mono"
                      />
                    </div>

                    {/* Comment */}
                    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-[#999ca3] font-medium">Comment</label>
                      <input
                        type="text"
                        value={activeCol.comment}
                        onChange={(e) => handleUpdateColumn(activeCol.id, { comment: e.target.value })}
                        placeholder=""
                        className="w-full h-7 px-2.5 rounded bg-[#2b2d30] border border-[#393b40] focus:border-[#3574f0] focus:outline-none text-[#dfe1e5]"
                      />
                    </div>

                    {/* Data Type */}
                    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-[#999ca3] font-medium">Data Type</label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <CustomTypeSelect
                            value={activeCol.dataType}
                            typeGroups={typeGroups}
                            onChange={(newType) => {
                              let autoLen = activeCol.lengthOrValues;
                              if (newType === 'VARCHAR' && !activeCol.lengthOrValues) autoLen = '255';
                              if (newType === 'CHAR' && !activeCol.lengthOrValues) autoLen = '50';
                              if (newType === 'DECIMAL' && !activeCol.lengthOrValues) autoLen = '10,2';
                              if (
                                ['INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'DATETIME', 'TIMESTAMP', 'TEXT', 'JSON', 'BOOLEAN'].includes(newType) &&
                                (activeCol.lengthOrValues === '255' || activeCol.lengthOrValues === '50')
                              ) {
                                autoLen = '';
                              }
                              handleUpdateColumn(activeCol.id, { dataType: newType, lengthOrValues: autoLen });
                            }}
                          />
                        </div>
                        {/* Length / Precision */}
                        <input
                          type="text"
                          placeholder="Length"
                          value={activeCol.lengthOrValues}
                          onChange={(e) => handleUpdateColumn(activeCol.id, { lengthOrValues: e.target.value })}
                          className="w-28 h-7 px-2 rounded bg-[#2b2d30] border border-[#393b40] focus:border-[#3574f0] focus:outline-none text-[#dfe1e5] font-mono text-[11px]"
                        />
                      </div>
                    </div>

                    {/* Checkboxes: Not Null, Auto Increment, Primary Key */}
                    <div className="grid grid-cols-[140px_1fr] items-center gap-4 py-1">
                      <div />
                      <div className="flex items-center gap-8">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={activeCol.isNotNull}
                            disabled={activeCol.isPrimaryKey}
                            onChange={(e) => handleUpdateColumn(activeCol.id, { isNotNull: e.target.checked })}
                            className="w-4 h-4 rounded border-[#393b40] bg-[#2b2d30] text-[#3574f0] focus:ring-0 cursor-pointer accent-[#3574f0]"
                          />
                          <span className="text-[#dfe1e5]">Not Null</span>
                        </label>

                        {(driver === 'mysql' || driver === 'mariadb' || driver === 'sqlite' || driver === 'mssql') && (
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={activeCol.isAutoIncrement}
                              onChange={(e) => handleUpdateColumn(activeCol.id, { isAutoIncrement: e.target.checked })}
                              className="w-4 h-4 rounded border-[#393b40] bg-[#2b2d30] text-[#3574f0] focus:ring-0 cursor-pointer accent-[#3574f0]"
                            />
                            <span className="text-[#dfe1e5]">{driver === 'mssql' ? 'Identity' : 'Auto Increment'}</span>
                          </label>
                        )}

                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={activeCol.isPrimaryKey}
                            onChange={(e) =>
                              handleUpdateColumn(activeCol.id, {
                                isPrimaryKey: e.target.checked,
                                isAutoIncrement: e.target.checked ? activeCol.isAutoIncrement : false,
                              })
                            }
                            className="w-4 h-4 rounded border-[#393b40] bg-[#2b2d30] text-[#3574f0] focus:ring-0 cursor-pointer accent-[#3574f0]"
                          />
                          <span className="text-[#dfe1e5] flex items-center gap-1">
                            <Key className="w-3 h-3 text-amber-400" />
                            <span>Primary Key</span>
                          </span>
                        </label>
                      </div>
                    </div>

                    {/* Column Kind */}
                    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-[#999ca3] font-medium">Column Kind</label>
                      <select
                        className="w-full h-7 px-2 rounded bg-[#2b2d30] border border-[#393b40] focus:border-[#3574f0] focus:outline-none text-[#dfe1e5] font-mono text-xs"
                        defaultValue="NORMAL"
                      >
                        <option value="NORMAL">NORMAL</option>
                        <option value="VIRTUAL">VIRTUAL</option>
                        <option value="STORED">STORED</option>
                      </select>
                    </div>

                    {/* Default Expression */}
                    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-[#999ca3] font-medium">Default Expression</label>
                      <input
                        type="text"
                        placeholder=""
                        value={activeCol.defaultValue}
                        onChange={(e) => handleUpdateColumn(activeCol.id, { defaultValue: e.target.value })}
                        className="w-full h-7 px-2.5 rounded bg-[#2b2d30] border border-[#393b40] focus:border-[#3574f0] focus:outline-none text-[#dfe1e5] font-mono"
                      />
                    </div>

                    {/* Hidden */}
                    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <div />
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-[#393b40] bg-[#2b2d30] text-[#3574f0] focus:ring-0 cursor-pointer accent-[#3574f0]"
                        />
                        <span className="text-[#dfe1e5]">Hidden</span>
                      </label>
                    </div>

                    {/* On Update (MySQL) */}
                    {(driver === 'mysql' || driver === 'mariadb') && (
                      <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                        <label className="text-[#999ca3] font-medium">On Update</label>
                        <input
                          type="text"
                          placeholder=""
                          className="w-full h-7 px-2.5 rounded bg-[#2b2d30] border border-[#393b40] focus:border-[#3574f0] focus:outline-none text-[#dfe1e5] font-mono"
                        />
                      </div>
                    )}

                    {/* Collation */}
                    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-[#999ca3] font-medium">Collation</label>
                      <select
                        value={collation}
                        onChange={(e) => setCollation(e.target.value)}
                        className="w-full h-7 px-2 rounded bg-[#2b2d30] border border-[#393b40] focus:border-[#3574f0] focus:outline-none text-[#dfe1e5] font-mono text-xs"
                      >
                        <option value="utf8mb4_unicode_ci">utf8mb4_unicode_ci</option>
                        <option value="utf8mb4_general_ci">utf8mb4_general_ci</option>
                        <option value="utf8mb4_0900_ai_ci">utf8mb4_0900_ai_ci</option>
                        <option value="utf8_general_ci">utf8_general_ci</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Case 2: Table Properties */}
              {selectedNode.type === 'table' && (
                <div className="p-6 max-w-3xl space-y-4">
                  <div className="flex items-center gap-2 pb-3 border-b border-[#393b40]/60">
                    <Table className="w-4 h-4 text-blue-400" />
                    <span className="font-mono text-sm text-[#dfe1e5] font-semibold">
                      {tableName || initialTableName || 'table'}
                    </span>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-[#999ca3] font-medium">Table Name *</label>
                      <input
                        type="text"
                        required
                        value={tableName}
                        onChange={(e) => setTableName(e.target.value)}
                        placeholder="e.g. users, products, orders"
                        className="w-full h-7 px-2.5 rounded bg-[#2b2d30] border border-[#393b40] focus:border-[#3574f0] focus:outline-none text-[#dfe1e5] font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-[#999ca3] font-medium">Database / Schema</label>
                      <div className="text-[#dfe1e5] font-mono text-xs px-2.5 py-1 bg-[#2b2d30]/60 rounded border border-[#393b40]">
                        {database || 'main'} {targetSchema ? `(${targetSchema})` : ''}
                      </div>
                    </div>

                    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-[#999ca3] font-medium">Comment</label>
                      <input
                        type="text"
                        value={tableComment}
                        onChange={(e) => setTableComment(e.target.value)}
                        placeholder="Optional table comment..."
                        className="w-full h-7 px-2.5 rounded bg-[#2b2d30] border border-[#393b40] focus:border-[#3574f0] focus:outline-none text-[#dfe1e5]"
                      />
                    </div>

                    {(driver === 'mysql' || driver === 'mariadb') && (
                      <>
                        <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                          <label className="text-[#999ca3] font-medium">Engine</label>
                          <CustomSelect
                            value={engine}
                            onChange={setEngine}
                            options={[
                              { value: 'InnoDB', label: 'InnoDB' },
                              { value: 'MyISAM', label: 'MyISAM' },
                              { value: 'MEMORY', label: 'MEMORY' },
                            ]}
                          />
                        </div>

                        <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                          <label className="text-[#999ca3] font-medium">Charset</label>
                          <CustomSelect
                            value={charset}
                            onChange={(val) => {
                              setCharset(val);
                              if (val === 'utf8mb4') setCollation('utf8mb4_unicode_ci');
                              if (val === 'utf8') setCollation('utf8_general_ci');
                            }}
                            options={[
                              { value: 'utf8mb4', label: 'utf8mb4' },
                              { value: 'utf8', label: 'utf8' },
                              { value: 'latin1', label: 'latin1' },
                            ]}
                          />
                        </div>

                        <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                          <label className="text-[#999ca3] font-medium">Collation</label>
                          <CustomSelect
                            value={collation}
                            onChange={setCollation}
                            options={[
                              { value: 'utf8mb4_unicode_ci', label: 'utf8mb4_unicode_ci' },
                              { value: 'utf8mb4_general_ci', label: 'utf8mb4_general_ci' },
                              { value: 'utf8mb4_0900_ai_ci', label: 'utf8mb4_0900_ai_ci' },
                              { value: 'utf8_general_ci', label: 'utf8_general_ci' },
                              { value: 'utf8_unicode_ci', label: 'utf8_unicode_ci' },
                            ]}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Case 3: Index Properties */}
              {selectedNode.type === 'index' && activeIdx && (
                <div className="p-6 max-w-3xl space-y-4">
                  <div className="flex items-center gap-2 pb-3 border-b border-[#393b40]/60">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    <span className="font-mono text-sm text-[#dfe1e5] font-semibold">
                      {activeIdx.name}
                    </span>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-[#999ca3] font-medium">Index Name</label>
                      <input
                        type="text"
                        value={activeIdx.name}
                        onChange={(e) => handleUpdateIndex(activeIdx.id, { name: e.target.value })}
                        className="w-full h-7 px-2.5 rounded bg-[#2b2d30] border border-[#393b40] focus:border-[#3574f0] focus:outline-none text-[#dfe1e5] font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-[#999ca3] font-medium">Index Type</label>
                      <CustomSelect
                        value={activeIdx.type}
                        onChange={(val) => handleUpdateIndex(activeIdx.id, { type: val as any })}
                        options={indexTypeOptions}
                      />
                    </div>

                    {driver !== 'sqlite' && (
                      <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                        <label className="text-[#999ca3] font-medium">Method</label>
                        <CustomSelect
                          value={activeIdx.method}
                          onChange={(val) => handleUpdateIndex(activeIdx.id, { method: val })}
                          options={indexMethodOptions}
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-[140px_1fr] items-start gap-4">
                      <label className="text-[#999ca3] font-medium pt-1">Indexed Columns</label>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {activeIdx.columns.map((c, i) => (
                            <span
                              key={c.name}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#2b2d30] border border-[#393b40] text-xs font-mono"
                            >
                              <span>{c.name}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateIndex(activeIdx.id, {
                                    columns: activeIdx.columns.map((col, idx) =>
                                      idx === i
                                        ? { ...col, order: col.order === 'ASC' ? 'DESC' : 'ASC' }
                                        : col
                                    ),
                                  })
                                }
                                className="text-[10px] text-blue-400 font-bold hover:underline"
                              >
                                {c.order}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveColumnFromIndex(activeIdx.id, i)}
                                className="text-[#999ca3] hover:text-rose-400"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>

                        {/* Add Column Dropdown */}
                        <div className="flex items-center gap-2 pt-1">
                          <select
                            onChange={(e) => {
                              if (e.target.value) {
                                handleAddColumnToIndex(activeIdx.id, e.target.value);
                                e.target.value = '';
                              }
                            }}
                            className="h-7 px-2 rounded bg-[#2b2d30] border border-[#393b40] text-xs font-mono text-[#dfe1e5]"
                            defaultValue=""
                          >
                            <option value="" disabled>
                              + Add column to index...
                            </option>
                            {columns
                              .filter((c) => c.name.trim() && !activeIdx.columns.some((ic) => ic.name === c.name.trim()))
                              .map((c) => (
                                <option key={c.id} value={c.name.trim()}>
                                  {c.name.trim()}
                                </option>
                              ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
                      <label className="text-[#999ca3] font-medium">Comment</label>
                      <input
                        type="text"
                        value={activeIdx.comment || ''}
                        onChange={(e) => handleUpdateIndex(activeIdx.id, { comment: e.target.value })}
                        className="w-full h-7 px-2.5 rounded bg-[#2b2d30] border border-[#393b40] focus:border-[#3574f0] focus:outline-none text-[#dfe1e5]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Case 4: Keys Folder or Primary Key */}
              {(selectedNode.type === 'key' || selectedNode.type === 'keys_folder') && (
                <div className="p-6 max-w-3xl space-y-4">
                  <div className="flex items-center gap-2 pb-3 border-b border-[#393b40]/60">
                    <Key className="w-4 h-4 text-amber-400" />
                    <span className="font-mono text-sm text-[#dfe1e5] font-semibold">
                      PRIMARY KEY
                    </span>
                  </div>

                  <div className="space-y-3 text-xs">
                    <p className="text-[#999ca3]">
                      Select the columns that make up the primary key constraint:
                    </p>

                    <div className="space-y-1.5 border border-[#393b40] rounded p-2 bg-[#2b2d30]/40">
                      {columns.map((c) => (
                        <label
                          key={c.id}
                          className="flex items-center gap-2 px-2 py-1 hover:bg-[#2b2d30] rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={c.isPrimaryKey}
                            onChange={(e) =>
                              handleUpdateColumn(c.id, {
                                isPrimaryKey: e.target.checked,
                                isAutoIncrement: e.target.checked ? c.isAutoIncrement : false,
                              })
                            }
                            className="w-4 h-4 rounded border-[#393b40] bg-[#2b2d30] text-[#3574f0] focus:ring-0 cursor-pointer accent-[#3574f0]"
                          />
                          <span className="font-mono text-[#dfe1e5]">{c.name || 'unnamed'}</span>
                          <span className="text-[#999ca3] font-mono text-[10px]">
                            ({c.dataType.toLowerCase()})
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Case 5: Columns Folder */}
              {selectedNode.type === 'columns_folder' && (
                <div className="p-6 max-w-3xl space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#393b40]/60">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-[#e5a065]" />
                      <span className="font-mono text-sm text-[#dfe1e5] font-semibold">
                        Columns ({columns.length})
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddColumn}
                      className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#3574f0] hover:bg-[#3068d9] text-white text-xs font-medium cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Column</span>
                    </button>
                  </div>

                  <div className="space-y-1">
                    {columns.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => setSelectedNode({ type: 'column', id: c.id })}
                        className="flex items-center justify-between p-2 rounded hover:bg-[#2b2d30] border border-[#393b40]/50 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2 font-mono text-xs">
                          {c.isPrimaryKey && <Key className="w-3 h-3 text-amber-400" />}
                          <span className="font-semibold text-[#dfe1e5]">{c.name || 'unnamed'}</span>
                          <span className="text-[#cf8e6d]">
                            {c.dataType.toLowerCase()}
                            {c.lengthOrValues ? `(${c.lengthOrValues})` : ''}
                          </span>
                        </div>
                        <span className="text-[11px] text-[#999ca3]">
                          {c.isNotNull ? 'NOT NULL' : 'NULL'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Case 6: Indexes Folder */}
              {selectedNode.type === 'indexes_folder' && (
                <div className="p-6 max-w-3xl space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#393b40]/60">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-[#e5a065]" />
                      <span className="font-mono text-sm text-[#dfe1e5] font-semibold">
                        Indexes ({indexes.length})
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddIndex}
                      className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#3574f0] hover:bg-[#3068d9] text-white text-xs font-medium cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Index</span>
                    </button>
                  </div>

                  <div className="space-y-1">
                    {indexes.map((idx) => (
                      <div
                        key={idx.id}
                        onClick={() => setSelectedNode({ type: 'index', id: idx.id })}
                        className="flex items-center justify-between p-2 rounded hover:bg-[#2b2d30] border border-[#393b40]/50 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2 font-mono text-xs">
                          <Zap className="w-3 h-3 text-emerald-400" />
                          <span className="font-semibold text-[#dfe1e5]">{idx.name}</span>
                          <span className="text-[#999ca3]">
                            ({idx.columns.map((c) => c.name).join(', ')})
                          </span>
                        </div>
                        <span className="text-[11px] text-blue-400 font-mono">{idx.type}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 3. Live DDL Preview Panel (Collapsible) */}
          <div className="border-t border-[#393b40] flex flex-col shrink-0 bg-[#1e1f22]">
            <div
              className="flex h-7 items-center justify-between px-3 bg-[#1e1f22] border-b border-[#393b40]/70 cursor-pointer select-none hover:bg-[#2b2d30]/60 transition-colors"
              onClick={() => setShowPreviewPane((prev) => !prev)}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#dfe1e5]">
                <ChevronDown
                  className={`w-3.5 h-3.5 text-[#999ca3] transition-transform duration-150 ${
                    showPreviewPane ? '' : '-rotate-90'
                  }`}
                />
                <span>Preview</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopySql();
                  }}
                  className="p-0.5 rounded text-[#999ca3] hover:text-[#dfe1e5] hover:bg-[#35373c] transition-colors"
                  title="Copy SQL"
                >
                  {copiedSql ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                <span title="Valid DDL statement" className="flex items-center">
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                </span>
              </div>
            </div>

            {showPreviewPane && (
              <div className="h-44 bg-[#141517] overflow-auto p-3 font-mono text-[11px] leading-relaxed text-[#a9b7c6] border-b border-[#393b40]/50">
                <pre className="whitespace-pre-wrap selection:bg-[#2e436e]">{generatedSql}</pre>
              </div>
            )}
          </div>

          {/* 4. Footer Bar */}
          <div className="flex h-11 items-center justify-between px-4 bg-[#1e1f22] border-t border-[#393b40] shrink-0">
            <button
              type="button"
              className="w-5 h-5 rounded-full border border-[#4e5157] text-[#999ca3] hover:text-[#dfe1e5] hover:border-[#6f737a] flex items-center justify-center text-xs font-bold transition-colors cursor-pointer"
              title="Help"
            >
              ?
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSave()}
                disabled={isSubmitting}
                className="px-5 py-1 rounded bg-[#3574f0] hover:bg-[#3068d9] active:bg-[#2b5ec2] text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
              >
                {isSubmitting ? 'Applying...' : 'OK'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-1 rounded bg-[#2b2d30] hover:bg-[#35373c] active:bg-[#3b3e44] text-[#dfe1e5] border border-[#393b40] text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export const TableStructureModal = CreateTableModal;
