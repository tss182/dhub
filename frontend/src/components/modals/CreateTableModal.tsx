import React, { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { ConnectionConfig } from '../../types/domain';
import { QueryService, SchemaService } from '../../../bindings/dhub/internal/services';
import { alertSuccess, alertError, alertWarning } from '../../stores/useAlertStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';

export interface ColumnDefinition {
  id: string;
  name: string;
  dataType: string;
  lengthOrValues: string;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  isNotNull: boolean;
  defaultValue: string;
  comment: string;
}

interface CreateTableModalProps {
  isOpen: boolean;
  connection: ConnectionConfig | null;
  database: string;
  schema?: string;
  onClose: () => void;
  onTableCreated?: (tableName: string) => void;
}

const MYSQL_TYPES = [
  'INT',
  'BIGINT',
  'TINYINT',
  'SMALLINT',
  'VARCHAR',
  'CHAR',
  'TEXT',
  'MEDIUMTEXT',
  'LONGTEXT',
  'DATETIME',
  'TIMESTAMP',
  'DATE',
  'TIME',
  'DECIMAL',
  'FLOAT',
  'DOUBLE',
  'BOOLEAN',
  'JSON',
  'BLOB',
  'ENUM',
];

const POSTGRES_TYPES = [
  'VARCHAR',
  'TEXT',
  'INTEGER',
  'BIGINT',
  'SMALLINT',
  'BOOLEAN',
  'TIMESTAMP',
  'TIMESTAMPTZ',
  'DATE',
  'TIME',
  'NUMERIC',
  'REAL',
  'DOUBLE PRECISION',
  'JSON',
  'JSONB',
  'UUID',
  'BYTEA',
  'SERIAL',
  'BIGSERIAL',
];

const SQLITE_TYPES = [
  'INTEGER',
  'TEXT',
  'REAL',
  'BLOB',
  'NUMERIC',
  'VARCHAR',
  'DATETIME',
  'BOOLEAN',
];

export const CreateTableModal: React.FC<CreateTableModalProps> = ({
  isOpen,
  connection,
  database,
  schema,
  onClose,
  onTableCreated,
}) => {
  const [tableName, setTableName] = useState('');
  const [tableComment, setTableComment] = useState('');
  const [engine, setEngine] = useState('InnoDB');
  const [charset, setCharset] = useState('utf8mb4');
  const [collation, setCollation] = useState('utf8mb4_unicode_ci');
  const [columns, setColumns] = useState<ColumnDefinition[]>([]);
  const [showSqlPreview, setShowSqlPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  const driver = connection?.driver || 'mysql';
  const targetSchema = schema || (driver === 'postgres' ? 'public' : database);

  const availableTypes = useMemo(() => {
    if (driver === 'postgres') return POSTGRES_TYPES;
    if (driver === 'sqlite') return SQLITE_TYPES;
    return MYSQL_TYPES;
  }, [driver]);

  // Reset and initialize default starter columns when modal opens
  useEffect(() => {
    if (isOpen) {
      setTableName('');
      setTableComment('');
      setEngine('InnoDB');
      setCharset('utf8mb4');
      setCollation('utf8mb4_unicode_ci');
      setShowSqlPreview(false);
      setCopiedSql(false);

      if (driver === 'sqlite') {
        setColumns([
          {
            id: 'col-1',
            name: 'id',
            dataType: 'INTEGER',
            lengthOrValues: '',
            isPrimaryKey: true,
            isAutoIncrement: true,
            isNotNull: true,
            defaultValue: '',
            comment: '',
          },
          {
            id: 'col-2',
            name: 'created_at',
            dataType: 'DATETIME',
            lengthOrValues: '',
            isPrimaryKey: false,
            isAutoIncrement: false,
            isNotNull: true,
            defaultValue: 'CURRENT_TIMESTAMP',
            comment: '',
          },
          {
            id: 'col-3',
            name: 'updated_at',
            dataType: 'DATETIME',
            lengthOrValues: '',
            isPrimaryKey: false,
            isAutoIncrement: false,
            isNotNull: true,
            defaultValue: 'CURRENT_TIMESTAMP',
            comment: '',
          },
        ]);
      } else if (driver === 'postgres') {
        setColumns([
          {
            id: 'col-1',
            name: 'id',
            dataType: 'BIGSERIAL',
            lengthOrValues: '',
            isPrimaryKey: true,
            isAutoIncrement: false,
            isNotNull: true,
            defaultValue: '',
            comment: '',
          },
          {
            id: 'col-2',
            name: 'created_at',
            dataType: 'TIMESTAMP',
            lengthOrValues: '',
            isPrimaryKey: false,
            isAutoIncrement: false,
            isNotNull: true,
            defaultValue: 'CURRENT_TIMESTAMP',
            comment: '',
          },
          {
            id: 'col-3',
            name: 'updated_at',
            dataType: 'TIMESTAMP',
            lengthOrValues: '',
            isPrimaryKey: false,
            isAutoIncrement: false,
            isNotNull: true,
            defaultValue: 'CURRENT_TIMESTAMP',
            comment: '',
          },
        ]);
      } else {
        // MySQL / MariaDB
        setColumns([
          {
            id: 'col-1',
            name: 'id',
            dataType: 'BIGINT',
            lengthOrValues: '',
            isPrimaryKey: true,
            isAutoIncrement: true,
            isNotNull: true,
            defaultValue: '',
            comment: '',
          },
          {
            id: 'col-2',
            name: 'created_at',
            dataType: 'DATETIME',
            lengthOrValues: '',
            isPrimaryKey: false,
            isAutoIncrement: false,
            isNotNull: true,
            defaultValue: 'CURRENT_TIMESTAMP',
            comment: '',
          },
          {
            id: 'col-3',
            name: 'updated_at',
            dataType: 'DATETIME',
            lengthOrValues: '',
            isPrimaryKey: false,
            isAutoIncrement: false,
            isNotNull: true,
            defaultValue: 'CURRENT_TIMESTAMP',
            comment: '',
          },
        ]);
      }
    }
  }, [isOpen, driver]);

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
    if (columns.length <= 1) {
      alertWarning('A table must have at least one column.', 'Cannot Remove Column');
      return;
    }
    setColumns((prev) => prev.filter((c) => c.id !== id));
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
  };

  // Generate DDL SQL string
  const generatedSql = useMemo(() => {
    const cleanTable = tableName.trim();
    if (!cleanTable) {
      return '-- Enter table name to generate DDL statement';
    }

    const lines: string[] = [];
    const pkCols = columns.filter((c) => c.isPrimaryKey && c.name.trim());

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

      return `CREATE TABLE ${schemaPrefix}"${cleanTable}" (\n${lines.join(',\n')}\n);`;
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

      return `CREATE TABLE "${cleanTable}" (\n${lines.join(',\n')}\n);`;
    }
  }, [tableName, columns, database, targetSchema, engine, charset, collation, tableComment, driver]);

  const handleCopySql = () => {
    if (!generatedSql) return;
    navigator.clipboard.writeText(generatedSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 1500);
  };

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl border border-[#2b2e3a] bg-[#14151a] shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-[#272932] px-6 bg-[#16171f] shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
              <Table className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <span>Create New Table</span>
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
        <form onSubmit={handleCreateTable} className="flex-1 flex flex-col min-h-0">
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
                className="w-full h-8 rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none transition-colors"
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
                  className="w-full h-8 rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 text-xs text-zinc-200 placeholder-zinc-500 focus:border-blue-500 focus:outline-none transition-colors"
                />
              </div>
            )}

            {/* MySQL Engine & Charset options */}
            {driver === 'mysql' && (
              <>
                <div className="w-28">
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                    Engine
                  </label>
                  <select
                    value={engine}
                    onChange={(e) => setEngine(e.target.value)}
                    className="w-full h-8 rounded-lg bg-[#101115] border border-[#2b2e3a] px-2 text-xs font-mono text-zinc-200 focus:border-blue-500 focus:outline-none cursor-pointer"
                  >
                    <option value="InnoDB">InnoDB</option>
                    <option value="MyISAM">MyISAM</option>
                    <option value="MEMORY">MEMORY</option>
                  </select>
                </div>

                <div className="w-32">
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                    Charset
                  </label>
                  <select
                    value={charset}
                    onChange={(e) => {
                      setCharset(e.target.value);
                      if (e.target.value === 'utf8mb4') setCollation('utf8mb4_unicode_ci');
                      if (e.target.value === 'utf8') setCollation('utf8_general_ci');
                    }}
                    className="w-full h-8 rounded-lg bg-[#101115] border border-[#2b2e3a] px-2 text-xs font-mono text-zinc-200 focus:border-blue-500 focus:outline-none cursor-pointer"
                  >
                    <option value="utf8mb4">utf8mb4</option>
                    <option value="utf8">utf8</option>
                    <option value="latin1">latin1</option>
                  </select>
                </div>
              </>
            )}
          </div>

          {/* Columns Header Bar + Add Column Action */}
          <div className="flex h-11 items-center justify-between px-5 bg-[#14151a] border-b border-[#272932] shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                Columns & Fields
              </span>
              <span className="font-mono text-[11px] bg-[#20222b] px-2 py-0.5 rounded text-zinc-400 border border-[#2d303e]">
                {columns.length} field(s)
              </span>
            </div>

            <button
              type="button"
              onClick={handleAddColumn}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors cursor-pointer shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Column</span>
            </button>
          </div>

          {/* Columns Table List */}
          <div className="flex-1 overflow-auto min-h-0 bg-[#121317]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#181920] border-b border-[#272932] shadow-xs z-10 select-none">
                <tr className="text-zinc-400 font-semibold text-[11px]">
                  <th className="w-10 px-2 py-2 text-center border-r border-[#272932]">#</th>
                  <th className="w-48 px-3 py-2 border-r border-[#272932]">Column Name *</th>
                  <th className="w-40 px-3 py-2 border-r border-[#272932]">Data Type</th>
                  <th className="w-24 px-3 py-2 border-r border-[#272932]">Length/Values</th>
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
                  <th className="w-20 px-2 py-2 text-center">Actions</th>
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
                          className="w-full h-7 rounded bg-[#101115] border border-[#2b2e3a] px-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    </td>

                    {/* Data Type */}
                    <td className="px-2 py-1.5 border-r border-[#20222a]">
                      <div className="relative">
                        <input
                          type="text"
                          list={`types-${col.id}`}
                          value={col.dataType}
                          onChange={(e) =>
                            handleUpdateColumn(col.id, { dataType: e.target.value.toUpperCase() })
                          }
                          className="w-full h-7 rounded bg-[#101115] border border-[#2b2e3a] px-2 text-xs font-semibold text-blue-400 focus:border-blue-500 focus:outline-none"
                        />
                        <datalist id={`types-${col.id}`}>
                          {availableTypes.map((t) => (
                            <option key={t} value={t} />
                          ))}
                        </datalist>
                      </div>
                    </td>

                    {/* Length / Values */}
                    <td className="px-2 py-1.5 border-r border-[#20222a]">
                      <input
                        type="text"
                        placeholder="e.g. 255"
                        value={col.lengthOrValues}
                        onChange={(e) => handleUpdateColumn(col.id, { lengthOrValues: e.target.value })}
                        className="w-full h-7 rounded bg-[#101115] border border-[#2b2e3a] px-2 text-xs text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
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
                        className="w-full h-7 rounded bg-[#101115] border border-[#2b2e3a] px-2 text-xs text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                      />
                    </td>

                    {/* Comment */}
                    <td className="px-2 py-1.5 border-r border-[#20222a]">
                      <input
                        type="text"
                        placeholder="Optional comment..."
                        value={col.comment}
                        onChange={(e) => handleUpdateColumn(col.id, { comment: e.target.value })}
                        className="w-full h-7 rounded bg-[#101115] border border-[#2b2e3a] px-2 text-xs text-zinc-300 placeholder-zinc-600 focus:border-blue-500 focus:outline-none font-sans"
                      />
                    </td>

                    {/* Actions: Move Up, Move Down, Delete */}
                    <td className="px-2 py-1.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleMoveColumn(idx, 'up')}
                          disabled={idx === 0}
                          className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-[#252834] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                          title="Move Up"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveColumn(idx, 'down')}
                          disabled={idx === columns.length - 1}
                          className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-[#252834] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                          title="Move Down"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveColumn(col.id)}
                          className="p-1 rounded text-rose-500/80 hover:text-rose-400 hover:bg-rose-950/30 cursor-pointer ml-1"
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
                disabled={isSubmitting || !tableName.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:pointer-events-none text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Creating Table...</span>
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
      </div>
    </div>
  );
};

