import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Table,
  Plus,
  Trash2,
  Key,
  ArrowUp,
  ArrowDown,
  Code,
  Check,
  AlertCircle,
  Copy,
  Sparkles,
  Database,
  ChevronDown,
  Pencil,
  Save,
  RefreshCw,
} from 'lucide-react';
import { ConnectionConfig, ColumnMeta } from '../../types/domain';
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
        className="w-full h-8 rounded-lg bg-[#101115] hover:bg-[#16171f] border border-[#2b2e3a] hover:border-[#3b3e4f] px-2.5 text-xs font-mono font-medium text-white flex items-center justify-between gap-1.5 transition-colors cursor-pointer select-none"
      >
        <span className="truncate text-white font-medium">{selectedOption.label}</span>
        <ChevronDown
          className={`h-3 w-3 text-zinc-400 shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-blue-400' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 min-w-full rounded-lg border border-[#2b2e3a] bg-[#16171f] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
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
                    ? 'bg-blue-600 text-white font-bold'
                    : 'text-zinc-200 hover:bg-[#252834] hover:text-white'
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
  const [openUpwards, setOpenUpwards] = useState(false);
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

  const handleToggle = () => {
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpwards(spaceBelow < 280);
    }
    setIsOpen(!isOpen);
    setFilterText('');
  };

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
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={handleToggle}
        className="w-full h-7 rounded bg-[#101115] hover:bg-[#16171f] border border-[#2b2e3a] hover:border-[#3b3e4f] px-2 text-xs font-mono font-semibold text-white flex items-center justify-between gap-1 transition-colors cursor-pointer select-none"
        title="Select Data Type"
      >
        <span className="truncate text-white">{value || 'SELECT TYPE'}</span>
        <ChevronDown
          className={`h-3 w-3 text-zinc-400 shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-blue-400' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute left-0 w-64 max-h-72 overflow-y-auto rounded-lg border border-[#2b2e3a] bg-[#16171f] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100 ${
            openUpwards ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {/* Quick search input */}
          <div className="p-1 pb-1.5 border-b border-[#272932] sticky top-0 bg-[#16171f] z-10">
            <input
              type="text"
              autoFocus
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search type..."
              className="w-full h-6 px-2 text-[11px] font-mono rounded bg-[#101115] border border-[#2d303f] text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="py-1">
            {filteredGroups.length === 0 ? (
              <div className="px-3 py-2 text-xs text-zinc-500 italic text-center">
                No matching type
              </div>
            ) : (
              filteredGroups.map((grp) => (
                <div key={grp.group} className="mb-1.5 last:mb-0">
                  <div className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 bg-[#121317] rounded mb-0.5 select-none">
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
                          className={`flex items-center justify-between px-2.5 py-1 rounded text-xs font-mono cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-600 text-white font-bold'
                              : 'text-zinc-200 hover:bg-[#252834] hover:text-white'
                          }`}
                        >
                          <span>{t}</span>
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

interface AddColumnToIndexDropdownProps {
  columns: string[];
  onSelect: (colName: string) => void;
}

const AddColumnToIndexDropdown: React.FC<AddColumnToIndexDropdownProps> = ({ columns, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
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

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium text-blue-400 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/30 cursor-pointer transition-colors"
        title="Add column to this index"
      >
        <Plus className="h-3 w-3" />
        <span>Column</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 min-w-[140px] max-h-48 overflow-y-auto rounded-lg border border-[#2b2e3a] bg-[#16171f] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-2 py-0.5 text-[9px] font-bold uppercase text-zinc-400 border-b border-[#272932] mb-1 select-none">
            Add Column
          </div>
          {columns.map((c) => (
            <div
              key={c}
              onClick={() => {
                onSelect(c);
                setIsOpen(false);
              }}
              className="px-2 py-1 rounded text-xs font-mono text-zinc-200 hover:bg-blue-600 hover:text-white cursor-pointer transition-colors flex items-center justify-between"
            >
              <span>{c}</span>
              <Plus className="h-3 w-3 text-zinc-400" />
            </div>
          ))}
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
  const isMySQL = driver === 'mysql';
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

    // B. Added & Changed columns
    validNewCols.forEach((col) => {
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

      if (!origMatch) {
        statements.push(`ALTER TABLE ${tableTarget} ADD COLUMN ${colDef};`);
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

        if (nameChanged || typeChanged || nullChanged || autoIncrChanged || defaultChanged || commentChanged) {
          statements.push(`ALTER TABLE ${tableTarget} CHANGE COLUMN \`${origMatch.name}\` ${colDef};`);
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
      statements.push(`ALTER TABLE ${tableTarget} COMMENT = '${tableComment.trim().replace(/'/g, "\\'")}';`);
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
  const [activeSubTab, setActiveSubTab] = useState<'columns' | 'indexes'>('columns');
  const [showSqlPreview, setShowSqlPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // States for Edit Mode tracking
  const [originalColumns, setOriginalColumns] = useState<ColumnMeta[]>([]);
  const [originalIndexes, setOriginalIndexes] = useState<IndexMeta[]>([]);
  const [originalPrimaryKeys, setOriginalPrimaryKeys] = useState<string[]>([]);
  const [originalTableComment, setOriginalTableComment] = useState('');
  const [isLoadingStructure, setIsLoadingStructure] = useState(false);

  const driver = connection?.driver || 'mysql';
  const targetSchema = schema || (driver === 'postgres' ? 'public' : database);

  const typeGroups = useMemo(() => {
    if (driver === 'postgres') return POSTGRES_TYPE_GROUPS;
    if (driver === 'sqlite') return SQLITE_TYPE_GROUPS;
    return MYSQL_TYPE_GROUPS;
  }, [driver]);

  const indexTypeOptions = useMemo(() => {
    if (driver === 'mysql') {
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

  useEffect(() => {
    if (!isOpen) return;

    setShowSqlPreview(false);
    setCopiedSql(false);
    setActiveSubTab('columns');

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
          setColumns(
            mappedCols.length > 0
              ? mappedCols
              : [
                  {
                    id: 'col-1',
                    name: '',
                    dataType: driver === 'sqlite' ? 'INTEGER' : driver === 'postgres' ? 'BIGINT' : 'INT',
                    lengthOrValues: '',
                    isPrimaryKey: false,
                    isAutoIncrement: false,
                    isNotNull: false,
                    defaultValue: '',
                    comment: '',
                  },
                ]
          );

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

      setColumns([
        {
          id: 'col-1',
          name: '',
          dataType: driver === 'sqlite' ? 'INTEGER' : driver === 'postgres' ? 'BIGINT' : 'INT',
          lengthOrValues: '',
          isPrimaryKey: false,
          isAutoIncrement: false,
          isNotNull: false,
          defaultValue: '',
          comment: '',
        },
      ]);
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
      name: '',
      dataType: driver === 'sqlite' ? 'TEXT' : 'VARCHAR',
      lengthOrValues: driver === 'sqlite' ? '' : '255',
      isPrimaryKey: false,
      isAutoIncrement: false,
      isNotNull: false,
      defaultValue: '',
      comment: '',
    };
    setColumns((prev) => [...prev, newCol]);
  };

  const handleRemoveColumn = (id: string) => {
    const colToRemove = columns.find((c) => c.id === id);
    if (columns.length <= 1) {
      alertWarning('A table must have at least one column.', 'Cannot Remove Column');
      return;
    }
    setColumns((prev) => prev.filter((c) => c.id !== id));
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

        // If user marks as PK, ensure Not Null is enabled
        if (updates.isPrimaryKey === true) {
          next.isNotNull = true;
        }

        // If user selects Auto Increment, adjust types if needed
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

    // Sync renamed column into index definitions
    if (updates.name && oldName && updates.name !== oldName) {
      setIndexes((prev) =>
        prev.map((idx) => ({
          ...idx,
          columns: idx.columns.map((c) => (c.name === oldName ? { ...c, name: updates.name! } : c)),
        }))
      );
    }
  };

  // Index Management Handlers
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
  };

  const handleUpdateIndex = (id: string, updates: Partial<IndexDefinition>) => {
    setIndexes((prev) => prev.map((idx) => (idx.id === id ? { ...idx, ...updates } : idx)));
  };

  const handleRemoveIndex = (id: string) => {
    setIndexes((prev) => prev.filter((idx) => idx.id !== id));
  };

  const handleAddColumnToIndex = (indexId: string, colName: string) => {
    if (!colName) return;
    setIndexes((prev) =>
      prev.map((idx) => {
        if (idx.id !== indexId) return idx;
        if (idx.columns.some((c) => c.name === colName)) return idx;
        const newCols = [...idx.columns, { name: colName, order: 'ASC' as const }];
        const cleanTbl = tableName.trim() || 'table';
        const prefix = idx.type === 'UNIQUE' ? 'uk' : 'idx';
        const autoName = `${prefix}_${cleanTbl}_${newCols.map((c) => c.name).join('_')}`;
        const shouldUpdateName = !idx.name || idx.name.startsWith('idx_') || idx.name.startsWith('uk_');
        return {
          ...idx,
          name: shouldUpdateName ? autoName : idx.name,
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

  const handleMoveIndexColumn = (indexId: string, colIndex: number, direction: 'left' | 'right') => {
    setIndexes((prev) =>
      prev.map((idx) => {
        if (idx.id !== indexId) return idx;
        const targetIdx = direction === 'left' ? colIndex - 1 : colIndex + 1;
        if (targetIdx < 0 || targetIdx >= idx.columns.length) return idx;
        const newCols = [...idx.columns];
        const temp = newCols[colIndex];
        newCols[colIndex] = newCols[targetIdx];
        newCols[targetIdx] = temp;
        return { ...idx, columns: newCols };
      })
    );
  };

  const handleToggleIndexColumnOrder = (indexId: string, colIndex: number) => {
    setIndexes((prev) =>
      prev.map((idx) => {
        if (idx.id !== indexId) return idx;
        const newCols = idx.columns.map((col, i) =>
          i === colIndex ? { ...col, order: (col.order === 'ASC' ? 'DESC' : 'ASC') as 'ASC' | 'DESC' } : col
        );
        return { ...idx, columns: newCols };
      })
    );
  };

  // Generate DDL SQL string with complete composite indexing support
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

    const cleanTable = tableName.trim();
    if (!cleanTable) {
      return '-- Enter table name to generate DDL statement';
    }

    const lines: string[] = [];
    const pkCols = columns.filter((c) => c.isPrimaryKey && c.name.trim());
    const validColNames = columns.map((c) => c.name.trim()).filter(Boolean);

    if (driver === 'mysql') {
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

      // Add Indexes to MySQL CREATE TABLE
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

      // Add PostgreSQL CREATE INDEX statements
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

      // Add SQLite CREATE INDEX statements
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

        statements.push(`CREATE ${isUnique}INDEX IF NOT EXISTS "${idxName}" ON "${cleanTable}" (${colParts});`);
      });

      return statements.join('\n\n');
    }
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

    // Validate table name identifier
    if (!/^[a-zA-Z0-9_$-]+$/.test(cleanTable)) {
      alertWarning(
        'Table name can only contain letters, numbers, underscores, dashes, and dollar signs.',
        'Invalid Table Name'
      );
      return;
    }

    // Validate column names
    const validCols = columns.filter((c) => c.name.trim().length > 0);
    if (validCols.length === 0) {
      alertWarning('Please define at least one column with a valid name.', 'Missing Column Names');
      return;
    }

    // Check for duplicate column names
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

      // Refresh database objects
      const schemaKey = `${connection.id}:${database}:${targetSchema}`;
      try {
        const objects = await SchemaService.GetObjects(connection.id, database, targetSchema);
        if (objects) {
          useConnectionStore.getState().setTreeObjects(schemaKey, objects as any);
        }
      } catch {}

      // Auto-open newly created table tab in Workbench
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

    // Validate column names
    const validCols = columns.filter((c) => c.name.trim().length > 0);
    if (validCols.length === 0) {
      alertWarning('Please define at least one column with a valid name.', 'Missing Column Names');
      return;
    }

    // Check for duplicate column names
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

      // Refresh database objects in Explorer
      const schemaKey = `${connection.id}:${database}:${targetSchema}`;
      try {
        const objects = await SchemaService.GetObjects(connection.id, database, targetSchema);
        if (objects) {
          useConnectionStore.getState().setTreeObjects(schemaKey, objects as any);
        }
      } catch {}

      // Refresh workbench table tab if open
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditMode) {
      await handleEditTable();
    } else {
      await handleCreateTable();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      {/* Modal Container: wider width and taller height */}
      <div
        className="w-[96vw] max-w-[1400px] h-[88vh] min-h-[550px] max-h-[94vh] rounded-2xl border border-[#2b2e3a] bg-[#14151a] shadow-2xl overflow-hidden flex flex-col text-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-[#272932] px-6 bg-[#16171f] shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
              {isEditMode ? <Pencil className="h-4 w-4" /> : <Table className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <span>{isEditMode ? 'Edit Table Structure' : 'Create New Table'}</span>
                {isEditMode && initialTableName && (
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">
                    {initialTableName}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-2 text-[11px] text-zinc-400 font-mono">
                <span className="flex items-center gap-1 text-zinc-300">
                  <Database className="h-3 w-3 text-blue-400" />
                  <span>{database || 'main'}</span>
                </span>
                <span className="text-zinc-600">•</span>
                <span>{connection?.name}</span>
                <span className="rounded bg-[#20222b] px-1.5 py-0.2 text-[10px] text-zinc-400 uppercase">
                  {driver}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <kbd className="hidden sm:inline-block rounded bg-[#22242c] px-1.5 py-0.5 text-[10px] text-zinc-400 font-mono border border-[#2d303d]">
              ESC
            </kbd>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[#252834] transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        {isLoadingStructure ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400">
            <RefreshCw className="h-6 w-6 animate-spin text-emerald-400" />
            <span className="text-xs">Loading structure for table &ldquo;{initialTableName}&rdquo;...</span>
          </div>
        ) : (
          <form onSubmit={handleSave} className="flex-1 flex flex-col min-h-0">
          {/* Top Bar: Table Name & Options */}
          <div className="p-5 border-b border-[#272932] bg-[#181920]/70 flex flex-wrap items-center gap-4 shrink-0">
            {/* Table Name */}
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs font-semibold text-zinc-200 uppercase tracking-wider mb-1.5">
                Table Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                autoFocus
                required
                placeholder="e.g. users, products, orders"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                className="w-full h-8 rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 text-xs font-mono text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none transition-colors"
              />
            </div>

            {/* Comment (MySQL) */}
            {driver === 'mysql' && (
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Table Comment
                </label>
                <input
                  type="text"
                  placeholder="Optional description..."
                  value={tableComment}
                  onChange={(e) => setTableComment(e.target.value)}
                  className="w-full h-8 rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 text-xs text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none transition-colors"
                />
              </div>
            )}

            {/* MySQL Engine & Charset options with custom dropdowns */}
            {driver === 'mysql' && (
              <>
                <div className="w-36">
                  <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                    Engine
                  </label>
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

                <div className="w-36">
                  <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                    Charset
                  </label>
                  <CustomSelect
                    value={charset}
                    onChange={(newVal) => {
                      setCharset(newVal);
                      if (newVal === 'utf8mb4') setCollation('utf8mb4_unicode_ci');
                      if (newVal === 'utf8') setCollation('utf8_general_ci');
                    }}
                    options={[
                      { value: 'utf8mb4', label: 'utf8mb4' },
                      { value: 'utf8', label: 'utf8' },
                      { value: 'latin1', label: 'latin1' },
                    ]}
                  />
                </div>

                <div className="w-48">
                  <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                    Collation
                  </label>
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

          {/* Sub-Tabs Navigation Bar: Columns vs Indexes */}
          <div className="flex h-11 items-center justify-between px-5 bg-[#14151a] border-b border-[#272932] shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveSubTab('columns')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeSubTab === 'columns'
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/40 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1f212a] border border-transparent'
                }`}
              >
                <span>Columns & Fields</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    activeSubTab === 'columns' ? 'bg-blue-500/25 text-blue-300 font-bold' : 'bg-[#22242c] text-zinc-400'
                  }`}
                >
                  {columns.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSubTab('indexes')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeSubTab === 'indexes'
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/40 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1f212a] border border-transparent'
                }`}
              >
                <span>Indexes & Keys</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    activeSubTab === 'indexes' ? 'bg-blue-500/25 text-blue-300 font-bold' : 'bg-[#22242c] text-zinc-400'
                  }`}
                >
                  {indexes.length}
                </span>
              </button>
            </div>

            {/* Contextual Action Button */}
            {activeSubTab === 'columns' ? (
              <button
                type="button"
                onClick={handleAddColumn}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors cursor-pointer shadow-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Column</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleAddIndex}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors cursor-pointer shadow-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Index</span>
              </button>
            )}
          </div>

          {/* Tab 1 Content: Columns Table */}
          {activeSubTab === 'columns' && (
            <div className="flex-1 overflow-auto min-h-0 bg-[#121317]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#181920] border-b border-[#272932] shadow-xs z-10 select-none">
                <tr className="text-zinc-400 font-semibold text-[11px]">
                  <th className="w-10 px-2 py-2 text-center border-r border-[#272932]">#</th>
                  <th className="w-56 px-3 py-2 border-r border-[#272932]">Column Name *</th>
                  <th className="w-48 px-3 py-2 border-r border-[#272932]">Data Type</th>
                  <th className="w-32 px-3 py-2 border-r border-[#272932]">Length/Values</th>
                  <th className="w-16 px-2 py-2 text-center border-r border-[#272932]" title="Primary Key">PK</th>
                  {driver === 'mysql' && (
                    <th className="w-16 px-2 py-2 text-center border-r border-[#272932]" title="Auto Increment">AI</th>
                  )}
                  {driver === 'sqlite' && (
                    <th className="w-16 px-2 py-2 text-center border-r border-[#272932]" title="Auto Increment">AI</th>
                  )}
                  <th className="w-20 px-2 py-2 text-center border-r border-[#272932]" title="Not Nullable">Not Null</th>
                  <th className="w-44 px-3 py-2 border-r border-[#272932]">Default Value</th>
                  <th className="px-3 py-2 border-r border-[#272932]">Comment</th>
                  <th className="w-24 px-2 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#20222a] font-mono">
                {columns.map((col, idx) => (
                  <tr
                    key={col.id}
                    className={`hover:bg-[#1a1c24] transition-colors group ${
                      col.isPrimaryKey ? 'bg-amber-950/10' : ''
                    }`}
                  >
                    {/* Index */}
                    <td className="px-2 py-1.5 text-center text-zinc-500 border-r border-[#20222a] text-[11px]">
                      {idx + 1}
                    </td>

                    {/* Column Name */}
                    <td className="px-2 py-1.5 border-r border-[#20222a]">
                      <div className="flex items-center gap-1.5">
                        {col.isPrimaryKey && (
                          <Key className="h-3 w-3 text-amber-400 fill-amber-400/20 shrink-0" />
                        )}
                        <input
                          type="text"
                          required
                          placeholder="column_name"
                          value={col.name}
                          onChange={(e) => handleUpdateColumn(col.id, { name: e.target.value })}
                          className="w-full h-7 rounded bg-[#101115] border border-[#2b2e3a] px-2 text-xs text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    </td>

                    {/* Data Type Custom Dropdown */}
                    <td className="px-2 py-1.5 border-r border-[#20222a]">
                      <CustomTypeSelect
                        value={col.dataType}
                        typeGroups={typeGroups}
                        onChange={(newType) => {
                          let autoLen = col.lengthOrValues;
                          if (newType === 'VARCHAR' && !col.lengthOrValues) autoLen = '255';
                          if (newType === 'CHAR' && !col.lengthOrValues) autoLen = '50';
                          if (newType === 'DECIMAL' && !col.lengthOrValues) autoLen = '10,2';
                          if (
                            ['INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'DATETIME', 'TIMESTAMP', 'TEXT', 'JSON', 'BOOLEAN'].includes(newType) &&
                            (col.lengthOrValues === '255' || col.lengthOrValues === '50')
                          ) {
                            autoLen = '';
                          }
                          handleUpdateColumn(col.id, { dataType: newType, lengthOrValues: autoLen });
                        }}
                      />
                    </td>

                    {/* Length / Values */}
                    <td className="px-2 py-1.5 border-r border-[#20222a]">
                      <input
                        type="text"
                        placeholder="e.g. 255"
                        value={col.lengthOrValues}
                        onChange={(e) => handleUpdateColumn(col.id, { lengthOrValues: e.target.value })}
                        className="w-full h-7 rounded bg-[#101115] border border-[#2b2e3a] px-2 text-xs text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                      />
                    </td>

                    {/* Primary Key Checkbox */}
                    <td className="px-2 py-1.5 text-center border-r border-[#20222a]">
                      <input
                        type="checkbox"
                        checked={col.isPrimaryKey}
                        onChange={(e) =>
                          handleUpdateColumn(col.id, {
                            isPrimaryKey: e.target.checked,
                            isAutoIncrement: e.target.checked ? col.isAutoIncrement : false,
                          })
                        }
                        className="h-4 w-4 rounded border-zinc-700 text-blue-600 focus:ring-0 cursor-pointer accent-blue-600"
                      />
                    </td>

                    {/* Auto Increment Checkbox (MySQL & SQLite) */}
                    {(driver === 'mysql' || driver === 'sqlite') && (
                      <td className="px-2 py-1.5 text-center border-r border-[#20222a]">
                        <input
                          type="checkbox"
                          checked={col.isAutoIncrement}
                          onChange={(e) =>
                            handleUpdateColumn(col.id, { isAutoIncrement: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-zinc-700 text-blue-600 focus:ring-0 cursor-pointer accent-blue-600"
                        />
                      </td>
                    )}

                    {/* Not Null Checkbox */}
                    <td className="px-2 py-1.5 text-center border-r border-[#20222a]">
                      <input
                        type="checkbox"
                        checked={col.isNotNull}
                        disabled={col.isPrimaryKey}
                        onChange={(e) =>
                          handleUpdateColumn(col.id, { isNotNull: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-zinc-700 text-blue-600 focus:ring-0 cursor-pointer accent-blue-600 disabled:opacity-50"
                      />
                    </td>

                    {/* Default Value */}
                    <td className="px-2 py-1.5 border-r border-[#20222a]">
                      <input
                        type="text"
                        placeholder="NULL or 'value'"
                        value={col.defaultValue}
                        onChange={(e) => handleUpdateColumn(col.id, { defaultValue: e.target.value })}
                        className="w-full h-7 rounded bg-[#101115] border border-[#2b2e3a] px-2 text-xs text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                      />
                    </td>

                    {/* Comment */}
                    <td className="px-2 py-1.5 border-r border-[#20222a]">
                      <input
                        type="text"
                        placeholder="Optional comment..."
                        value={col.comment}
                        onChange={(e) => handleUpdateColumn(col.id, { comment: e.target.value })}
                        className="w-full h-7 rounded bg-[#101115] border border-[#2b2e3a] px-2 text-xs text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none font-sans"
                      />
                    </td>

                    {/* Actions: Move Up, Move Down, Delete */}
                    <td className="px-2 py-1.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleMoveColumn(idx, 'up')}
                          disabled={idx === 0}
                          className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#252834] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                          title="Move Up"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveColumn(idx, 'down')}
                          disabled={idx === columns.length - 1}
                          className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#252834] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                          title="Move Down"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveColumn(col.id)}
                          className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 cursor-pointer ml-1"
                          title="Delete Column"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {/* Tab 2 Content: Indexes & Keys Table (Composite Indexing Support) */}
          {activeSubTab === 'indexes' && (
            <div className="flex-1 overflow-auto min-h-0 bg-[#121317]">
              {indexes.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center text-zinc-500 select-none">
                  <div className="h-12 w-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-3">
                    <Key className="h-6 w-6 stroke-[1.5]" />
                  </div>
                  <h3 className="text-sm font-semibold text-zinc-200">No Indexes Configured</h3>
                  <p className="text-xs text-zinc-400 mt-1 max-w-md">
                    Indexes speed up queries and enforce uniqueness. You can configure single or composite indexes across multiple columns.
                  </p>
                  <button
                    type="button"
                    onClick={handleAddIndex}
                    className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Create First Index</span>
                  </button>
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-[#181920] border-b border-[#272932] shadow-xs z-10 select-none">
                    <tr className="text-zinc-400 font-semibold text-[11px]">
                      <th className="w-10 px-2 py-2 text-center border-r border-[#272932]">#</th>
                      <th className="w-64 px-3 py-2 border-r border-[#272932]">Index Name *</th>
                      <th className="w-44 px-3 py-2 border-r border-[#272932]">Index Type</th>
                      {driver !== 'sqlite' && (
                        <th className="w-32 px-3 py-2 border-r border-[#272932]">Method</th>
                      )}
                      <th className="px-3 py-2 border-r border-[#272932]">Indexed Columns (Composite in Order)</th>
                      {driver === 'mysql' && (
                        <th className="w-44 px-3 py-2 border-r border-[#272932]">Comment</th>
                      )}
                      <th className="w-20 px-2 py-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#20222a] font-mono">
                    {indexes.map((idx, indexIdx) => {
                      const availableColsForIndex = columns
                        .map((c) => c.name.trim())
                        .filter((name) => name && !idx.columns.some((ic) => ic.name === name));

                      return (
                        <tr key={idx.id} className="hover:bg-[#1a1c24] transition-colors group">
                          {/* Number */}
                          <td className="px-2 py-2 text-center text-zinc-500 border-r border-[#20222a] text-[11px]">
                            {indexIdx + 1}
                          </td>

                          {/* Index Name */}
                          <td className="px-2 py-2 border-r border-[#20222a]">
                            <input
                              type="text"
                              placeholder="e.g. idx_table_col1_col2"
                              value={idx.name}
                              onChange={(e) => handleUpdateIndex(idx.id, { name: e.target.value })}
                              className="w-full h-7 rounded bg-[#101115] border border-[#2b2e3a] px-2 text-xs font-mono text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                            />
                          </td>

                          {/* Index Type Dropdown */}
                          <td className="px-2 py-2 border-r border-[#20222a]">
                            <CustomSelect
                              value={idx.type}
                              onChange={(val) => {
                                const newType = val as any;
                                const cleanTbl = tableName.trim() || 'table';
                                const prefix = newType === 'UNIQUE' ? 'uk' : 'idx';
                                const autoName = `${prefix}_${cleanTbl}_${idx.columns.map((c) => c.name).join('_')}`;
                                const shouldUpdate = !idx.name || idx.name.startsWith('idx_') || idx.name.startsWith('uk_');
                                handleUpdateIndex(idx.id, {
                                  type: newType,
                                  name: shouldUpdate && idx.columns.length > 0 ? autoName : idx.name,
                                });
                              }}
                              options={indexTypeOptions}
                            />
                          </td>

                          {/* Method Dropdown */}
                          {driver !== 'sqlite' && (
                            <td className="px-2 py-2 border-r border-[#20222a]">
                              <CustomSelect
                                value={idx.method}
                                onChange={(val) => handleUpdateIndex(idx.id, { method: val })}
                                options={indexMethodOptions}
                              />
                            </td>
                          )}

                          {/* Indexed Columns (Composite in Order) */}
                          <td className="px-3 py-2 border-r border-[#20222a]">
                            <div className="flex flex-wrap items-center gap-1.5 min-h-[30px]">
                              {idx.columns.map((col, cIdx) => (
                                <div
                                  key={col.name + '-' + cIdx}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#20222b] border border-[#323647] text-white text-xs font-mono group/col shadow-xs"
                                >
                                  <span className="font-semibold text-emerald-300">{col.name}</span>

                                  {/* Order toggle: ASC / DESC */}
                                  <button
                                    type="button"
                                    onClick={() => handleToggleIndexColumnOrder(idx.id, cIdx)}
                                    className="px-1.5 py-0.2 rounded text-[10px] font-bold text-blue-400 hover:text-white hover:bg-blue-600/40 cursor-pointer transition-colors"
                                    title="Toggle ASC / DESC"
                                  >
                                    {col.order}
                                  </button>

                                  {/* Reorder in composite */}
                                  {idx.columns.length > 1 && (
                                    <div className="flex items-center opacity-60 group-hover/col:opacity-100">
                                      <button
                                        type="button"
                                        disabled={cIdx === 0}
                                        onClick={() => handleMoveIndexColumn(idx.id, cIdx, 'left')}
                                        className="px-1 text-zinc-400 hover:text-white disabled:opacity-20 cursor-pointer"
                                        title="Move Left (Higher Priority)"
                                      >
                                        ←
                                      </button>
                                      <button
                                        type="button"
                                        disabled={cIdx === idx.columns.length - 1}
                                        onClick={() => handleMoveIndexColumn(idx.id, cIdx, 'right')}
                                        className="px-1 text-zinc-400 hover:text-white disabled:opacity-20 cursor-pointer"
                                        title="Move Right (Lower Priority)"
                                      >
                                        →
                                      </button>
                                    </div>
                                  )}

                                  {/* Remove column from index */}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveColumnFromIndex(idx.id, cIdx)}
                                    className="text-zinc-500 hover:text-rose-400 cursor-pointer ml-0.5"
                                    title="Remove from Index"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}

                              {/* Add Column Dropdown */}
                              {availableColsForIndex.length > 0 ? (
                                <AddColumnToIndexDropdown
                                  columns={availableColsForIndex}
                                  onSelect={(c) => handleAddColumnToIndex(idx.id, c)}
                                />
                              ) : idx.columns.length === 0 ? (
                                <span className="text-[11px] text-zinc-500 italic">
                                  {columns.filter((c) => c.name.trim()).length === 0
                                    ? 'Add column names first in Columns tab'
                                    : 'No column selected'}
                                </span>
                              ) : null}
                            </div>
                          </td>

                          {/* Comment (MySQL) */}
                          {driver === 'mysql' && (
                            <td className="px-2 py-2 border-r border-[#20222a]">
                              <input
                                type="text"
                                placeholder="Optional comment..."
                                value={idx.comment || ''}
                                onChange={(e) => handleUpdateIndex(idx.id, { comment: e.target.value })}
                                className="w-full h-7 rounded bg-[#101115] border border-[#2b2e3a] px-2 text-xs text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                              />
                            </td>
                          )}

                          {/* Actions */}
                          <td className="px-2 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveIndex(idx.id)}
                              className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 cursor-pointer transition-colors"
                              title="Delete Index"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* SQL Preview Drawer */}
          {showSqlPreview && (
            <div className="border-t border-[#272932] bg-[#101115] p-4 shrink-0 max-h-48 overflow-auto">
              <div className="flex items-center justify-between mb-2 select-none">
                <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Code className="h-3.5 w-3.5 text-blue-400" />
                  <span>Generated DDL Statement</span>
                </span>
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  {copiedSql ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy SQL</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="font-mono text-xs text-blue-300 bg-[#16171f] p-3 rounded-lg border border-[#272932] overflow-x-auto select-text leading-relaxed">
                {generatedSql}
              </pre>
            </div>
          )}

          {/* Footer Controls */}
          <div className="flex h-14 items-center justify-between border-t border-[#272932] px-6 bg-[#16171f] shrink-0">
            <button
              type="button"
              onClick={() => setShowSqlPreview(!showSqlPreview)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                showSqlPreview
                  ? 'bg-blue-600/15 border-blue-500/50 text-blue-400'
                  : 'bg-[#20222a] border-[#2d303f] text-zinc-300 hover:text-white hover:bg-[#282a36]'
              }`}
            >
              <Code className="h-3.5 w-3.5" />
              <span>{showSqlPreview ? 'Hide SQL Preview' : 'Preview SQL'}</span>
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSubmitting || !tableName.trim() || isLoadingStructure}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:pointer-events-none text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>{isEditMode ? 'Saving Changes...' : 'Creating Table...'}</span>
                  </>
                ) : isEditMode ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>Save Changes</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Create Table</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
        )}
      </div>
    </div>
  );
};

export { CreateTableModal as TableStructureModal };
