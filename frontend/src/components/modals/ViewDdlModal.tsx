import React, { useEffect, useState, useCallback } from 'react';
import { Dialogs } from '@wailsio/runtime';
import { X, Eye, Copy, Check, Download, RefreshCw, AlertCircle, FileCode } from 'lucide-react';
import { SchemaService } from '../../../bindings/dhub/internal/services';
import { ConnectionConfig, resolveConnectionEnv } from '../../types/domain';
import { alertError, alertSuccess } from '../../stores/useAlertStore';

function stripTableOptionsFromDdl(rawDdl: string): string {
  // Remove MySQL/MariaDB trailing table options like ENGINE=InnoDB AUTO_INCREMENT=123 DEFAULT CHARSET=utf8mb4 COLLATE=...
  return rawDdl
    .replace(
      /\)\s*(?:ENGINE\s*=\s*\S+|AUTO_INCREMENT\s*=\s*\d+|DEFAULT\s+CHARSET\s*=\s*\S+|CHARSET\s*=\s*\S+|COLLATE\s*=\s*\S+|ROW_FORMAT\s*=\s*\S+|STATS_PERSISTENT\s*=\s*\S+|COMMENT\s*=\s*'[^']*')+\s*;?/gi,
      ');'
    )
    .replace(/\s+(?:CHARACTER\s+SET|CHARSET)\s+\S+/gi, '')
    .replace(/\s+COLLATE\s+\S+/gi, '')
    .trim();
}

function formatCleanTableDdl(tableName: string, struct: any): string {
  const cols: any[] = struct?.columns || [];
  if (cols.length === 0) {
    const raw = (struct?.ddl || '').trim();
    return raw ? stripTableOptionsFromDdl(raw) : '';
  }

  const rawDdl = (struct?.ddl || '').trim();
  if (/^\s*create\s+(?:or\s+replace\s+)?view\b/i.test(rawDdl)) {
    return rawDdl.endsWith(';') ? rawDdl : `${rawDdl};`;
  }

  const pks: string[] =
    struct?.primaryKeys && struct.primaryKeys.length > 0
      ? struct.primaryKeys
      : cols.filter((c) => c.isPrimaryKey).map((c) => c.name);
  const singlePk = pks.length === 1 ? pks[0] : null;

  const cleanType = (c: any) =>
    String(c.rawType || c.dataType || 'text')
      .replace(/\s+(?:CHARACTER\s+SET|CHARSET)\s+\S+/gi, '')
      .replace(/\s+COLLATE\s+\S+/gi, '')
      .trim()
      .toLowerCase();

  const maxNameLen = Math.max(...cols.map((c) => String(c.name || '').length), 1);
  const typesList = cols.map((c) => {
    const t = cleanType(c);
    return c.isAutoIncrement && !t.includes('auto_increment') ? `${t} auto_increment` : t;
  });
  const maxTypeLen = Math.max(...typesList.map((t) => t.length), 1);

  const lines: string[] = [];

  cols.forEach((c, idx) => {
    const name = String(c.name || '');
    const paddedName = name.padEnd(maxNameLen, ' ');
    const typeWithAuto = typesList[idx];
    const isSinglePk = singlePk !== null && name === singlePk;

    if (isSinglePk) {
      const def =
        c.defaultValue && !c.isAutoIncrement && !String(c.defaultValue).toLowerCase().includes('nextval')
          ? ` default ${c.defaultValue}`
          : '';
      const notNull = !c.isNullable && !c.isAutoIncrement ? ' not null' : '';
      lines.push(`    ${paddedName} ${typeWithAuto}${def}${notNull}\n        primary key`);
    } else {
      const paddedType = typeWithAuto.padEnd(maxTypeLen, ' ');
      const def =
        c.defaultValue !== undefined && c.defaultValue !== null && String(c.defaultValue).trim() !== ''
          ? `default ${c.defaultValue} `
          : '';
      const nullability = c.isNullable ? 'null' : 'not null';
      lines.push(`    ${paddedName} ${paddedType} ${def}${nullability}`);
    }
  });

  if (pks.length > 1) {
    lines.push(`    primary key (${pks.join(', ')})`);
  }

  const fks: any[] = struct?.foreignKeys || [];
  fks.forEach((fk) => {
    if (!fk?.columnName || !fk?.refTable || !fk?.refColumn) return;
    const cName = fk.constraintName ? `constraint ${fk.constraintName} ` : '';
    const onDel = fk.onDelete && fk.onDelete !== 'NO ACTION' ? ` on delete ${String(fk.onDelete).toLowerCase()}` : '';
    const onUpd = fk.onUpdate && fk.onUpdate !== 'NO ACTION' ? ` on update ${String(fk.onUpdate).toLowerCase()}` : '';
    lines.push(`    ${cName}foreign key (${fk.columnName}) references ${fk.refTable} (${fk.refColumn})${onDel}${onUpd}`);
  });

  return `-- auto-generated definition\ncreate table ${tableName}\n(\n${lines.join(',\n')}\n);`;
}

export interface ViewDdlModalProps {
  isOpen: boolean;
  scope: 'table' | 'database' | 'schema';
  connection: ConnectionConfig | null;
  database: string;
  schema?: string;
  tableName?: string;
  onClose: () => void;
}

export const ViewDdlModal: React.FC<ViewDdlModalProps> = ({
  isOpen,
  scope,
  connection,
  database,
  schema = '',
  tableName = '',
  onClose,
}) => {
  const [ddl, setDdl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const loadDdl = useCallback(async () => {
    if (!isOpen || !connection?.id) return;
    setIsLoading(true);
    setError(null);
    setDdl('');
    setCopied(false);

    try {
      const targetDb = database || connection.databaseName || 'main';
      const targetSchema =
        schema ||
        (connection.driver === 'postgres'
          ? 'public'
          : connection.driver === 'mssql'
          ? 'dbo'
          : connection.driver === 'oracle'
          ? ''
          : targetDb);

      if (scope === 'table') {
        if (!tableName) {
          setError('Table name is required.');
          return;
        }
        const struct = await SchemaService.GetTableStructure(
          connection.id,
          targetDb,
          targetSchema,
          tableName
        );
        const resultDdl = formatCleanTableDdl(tableName, struct);
        if (!resultDdl) {
          setError(`No DDL available for "${tableName}".`);
        } else {
          setDdl(resultDdl.endsWith(';') ? resultDdl : `${resultDdl};`);
        }
      } else {
        const schemaArg = scope === 'schema' ? targetSchema : '';
        const resultDdl = await SchemaService.GetDatabaseDDL(
          connection.id,
          targetDb,
          schemaArg
        );
        setDdl(resultDdl ? stripTableOptionsFromDdl(resultDdl) : '');
      }
    } catch (err: any) {
      setError(err?.message || String(err) || 'Failed to load DDL');
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, scope, connection, database, schema, tableName]);

  useEffect(() => {
    if (isOpen) {
      loadDdl();
    }
  }, [isOpen, loadDdl]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const env = resolveConnectionEnv(connection);
  const headerClass =
    env === 'prod'
      ? 'bg-rose-950/75 border-rose-800/70'
      : env === 'dev'
      ? 'bg-emerald-950/75 border-emerald-800/70'
      : 'bg-[#14151a] border-[#272932]';

  const title =
    scope === 'table'
      ? `Table DDL — ${tableName}`
      : scope === 'schema'
      ? `Schema DDL — ${schema || database}`
      : `Database DDL — ${database}`;

  const subtitle =
    scope === 'table'
      ? `${connection?.name || ''} • ${database}${schema && schema !== database ? `.${schema}` : ''}`
      : `${connection?.name || ''} • Structure only (no data)`;

  const defaultFileName = (() => {
    const base =
      scope === 'table'
        ? tableName || 'table'
        : scope === 'schema'
        ? `${database}_${schema || 'schema'}`
        : database || 'database';
    const safe = base.replace(/[^a-zA-Z0-9_-]+/g, '_');
    return `${safe}_ddl.sql`;
  })();

  const handleCopy = async () => {
    if (!ddl) return;
    try {
      await navigator.clipboard.writeText(ddl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      alertSuccess('DDL copied to clipboard');
    } catch (err: any) {
      alertError('Failed to copy DDL: ' + (err?.message || String(err)));
    }
  };

  const handleDownload = async () => {
    if (!ddl || isSaving) return;
    setIsSaving(true);
    try {
      const chosen = await Dialogs.SaveFile({
        Title: 'Save DDL Script',
        Filename: defaultFileName,
        CanCreateDirectories: true,
        Filters: [
          { DisplayName: 'SQL Files (*.sql)', Pattern: '*.sql' },
          { DisplayName: 'All Files (*.*)', Pattern: '*.*' },
        ],
      });
      if (chosen && typeof chosen === 'string' && chosen.trim()) {
        await SchemaService.SaveDDLFile(chosen.trim(), ddl);
        alertSuccess(`DDL saved to ${chosen.trim()}`);
      }
    } catch {
      // Fallback to browser download if native dialog is unavailable
      try {
        const blob = new Blob([ddl], { type: 'application/sql;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alertSuccess(`Downloaded ${defaultFileName}`);
      } catch (fallbackErr: any) {
        alertError('Failed to download DDL: ' + (fallbackErr?.message || String(fallbackErr)));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const lineCount = ddl ? ddl.split('\n').length : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-4xl max-h-[88vh] rounded-2xl border bg-[#191a20] shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col overflow-hidden text-xs text-zinc-300 ${
          env === 'prod'
            ? 'border-rose-700/60'
            : env === 'dev'
            ? 'border-emerald-700/60'
            : 'border-[#2b2e3a]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between border-b px-5 py-3.5 shrink-0 ${headerClass}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400">
              <Eye className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm text-zinc-100 truncate">{title}</h3>
                {env !== 'local' && (
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase font-mono border ${
                      env === 'prod'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    }`}
                  >
                    {env}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-400 font-mono truncate">{subtitle}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 p-4 flex flex-col gap-3 overflow-hidden">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-400">
              <RefreshCw className="h-6 w-6 animate-spin text-blue-400" />
              <span className="text-xs">
                {scope === 'table'
                  ? `Loading DDL for "${tableName}"...`
                  : `Generating DDL for "${scope === 'schema' ? schema : database}" (structure only)...`}
              </span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <div className="flex items-center gap-2 text-rose-400">
                <AlertCircle className="h-5 w-5" />
                <span className="font-medium text-sm">Failed to Load DDL</span>
              </div>
              <p className="text-xs text-zinc-400 max-w-md font-mono">{error}</p>
              <button
                type="button"
                onClick={loadDdl}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#22242c] hover:bg-[#2c2f3b] border border-[#323544] text-zinc-200 text-xs cursor-pointer transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Retry</span>
              </button>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-[#272932] bg-[#121317] overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#232530] bg-[#16171d] text-[11px] text-zinc-400 shrink-0">
                <div className="flex items-center gap-1.5 font-mono">
                  <FileCode className="h-3.5 w-3.5 text-blue-400" />
                  <span>{defaultFileName}</span>
                </div>
                <span className="font-mono text-zinc-500">{lineCount} lines</span>
              </div>
              <pre className="flex-1 min-h-0 p-4 font-mono text-xs text-emerald-300/95 overflow-auto select-text whitespace-pre leading-relaxed">
                {ddl}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-[#272932] px-5 py-3 bg-[#14151a] shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadDdl}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#272932] bg-[#1c1d24] hover:bg-[#252730] text-zinc-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh DDL"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={isLoading || !ddl}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-[#2d303f] bg-[#20222a] hover:bg-[#2b2d38] text-zinc-200 hover:text-white font-medium transition-colors cursor-pointer disabled:opacity-40"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy DDL</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              disabled={isLoading || !ddl || isSaving}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-sm transition-colors cursor-pointer disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{isSaving ? 'Saving...' : 'Download .sql'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-[#272932] hover:bg-[#22242c] text-zinc-300 transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
