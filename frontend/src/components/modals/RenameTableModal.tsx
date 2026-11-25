import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Pencil, X } from 'lucide-react';
import { QueryService, SchemaService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess } from '../../stores/useAlertStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { ConnectionConfig, resolveConnectionEnv } from '../../types/domain';

interface RenameTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  connection: ConnectionConfig | null;
  database: string;
  schema: string;
  tableName: string;
  objectType?: string;
  onSuccess?: (newTableName: string) => void;
}

const escPg = (val: string) => val.replace(/"/g, '""');
const escMy = (val: string) => val.replace(/`/g, '``');

function buildRenameCommand(params: {
  driver: string;
  database: string;
  schema: string;
  oldName: string;
  newName: string;
  objectType?: string;
}): { sql: string | null; unsupportedReason: string | null } {
  const { driver, database, schema, oldName, newName, objectType } = params;
  const d = (driver || '').toLowerCase();
  const targetNew = newName.trim() || oldName;

  if (d === 'qdrant') {
    return {
      sql: null,
      unsupportedReason:
        'Qdrant does not support renaming collections directly. Use Collection Aliases or Clone Collection instead.',
    };
  }
  if (d === 'elasticsearch' || d === 'es') {
    return {
      sql: null,
      unsupportedReason:
        'Elasticsearch does not support renaming indices directly. Use Reindex (_reindex) or Index Aliases instead.',
    };
  }
  if (d === 'redis') {
    return {
      sql: null,
      unsupportedReason: 'Redis keys can be renamed from the grid context menu (Rename Key).',
    };
  }

  if (d === 'mongodb' || d === 'mongo') {
    return {
      sql: `db.getCollection(${JSON.stringify(oldName)}).renameCollection(${JSON.stringify(targetNew)});`,
      unsupportedReason: null,
    };
  }

  if (d === 'mysql' || d === 'mariadb' || d === 'clickhouse') {
    const dbPrefix = database && database !== 'main' ? `\`${escMy(database)}\`.` : '';
    return {
      sql: `RENAME TABLE ${dbPrefix}\`${escMy(oldName)}\` TO ${dbPrefix}\`${escMy(targetNew)}\`;`,
      unsupportedReason: null,
    };
  }

  if (d === 'mssql') {
    const oldPath = schema ? `${schema}.${oldName}` : oldName;
    return {
      sql: `EXEC sp_rename '${oldPath.replace(/'/g, "''")}', '${targetNew.replace(/'/g, "''")}';`,
      unsupportedReason: null,
    };
  }

  if (d === 'oracle') {
    const schemaPrefix = schema ? `"${escPg(schema)}".` : '';
    return {
      sql: `ALTER TABLE ${schemaPrefix}"${escPg(oldName)}" RENAME TO "${escPg(targetNew)}";`,
      unsupportedReason: null,
    };
  }

  if (d === 'postgres' || d === 'postgresql') {
    const schemaPrefix = schema ? `"${escPg(schema)}".` : '';
    const objKw =
      objectType === 'materialized_view'
        ? 'MATERIALIZED VIEW'
        : objectType === 'view'
        ? 'VIEW'
        : 'TABLE';
    return {
      sql: `ALTER ${objKw} ${schemaPrefix}"${escPg(oldName)}" RENAME TO "${escPg(targetNew)}";`,
      unsupportedReason: null,
    };
  }

  // SQLite and fallback ANSI SQL
  return {
    sql: `ALTER TABLE "${escPg(oldName)}" RENAME TO "${escPg(targetNew)}";`,
    unsupportedReason: null,
  };
}

export const RenameTableModal: React.FC<RenameTableModalProps> = ({
  isOpen,
  onClose,
  connection,
  database,
  schema,
  tableName,
  objectType,
  onSuccess,
}) => {
  const [newName, setNewName] = useState(tableName);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setNewName(tableName);
    }
  }, [isOpen, tableName]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  const driver = (connection?.driver || '').toLowerCase();
  const isMongo = driver === 'mongodb' || driver === 'mongo';
  const entityLabel = isMongo
    ? 'Collection'
    : objectType === 'materialized_view'
    ? 'Materialized View'
    : objectType === 'view'
    ? 'View'
    : 'Table';

  const { sql, unsupportedReason } = useMemo(
    () =>
      buildRenameCommand({
        driver,
        database,
        schema,
        oldName: tableName,
        newName,
        objectType,
      }),
    [driver, database, schema, tableName, newName, objectType]
  );

  if (!isOpen) return null;

  const env = resolveConnectionEnv(connection);
  const headerClass =
    env === 'prod'
      ? 'bg-rose-950/75 border-rose-800/70'
      : env === 'dev'
      ? 'bg-emerald-950/75 border-emerald-800/70'
      : 'bg-[#1e2029] border-[#272932]';

  const cleanNewName = newName.trim();
  const isUnchanged = cleanNewName === tableName;
  const isDisabled =
    isSubmitting ||
    Boolean(connection?.isReadOnly) ||
    Boolean(unsupportedReason) ||
    !cleanNewName ||
    isUnchanged;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connection) {
      alertError('No active connection found for this table.');
      return;
    }
    if (connection.isReadOnly) {
      alertError('Cannot rename table on a read-only connection.');
      return;
    }
    if (unsupportedReason || !sql) {
      alertError(unsupportedReason || 'Rename is not supported for this driver.');
      return;
    }
    if (!cleanNewName) {
      alertError(`New ${entityLabel.toLowerCase()} name cannot be empty.`);
      return;
    }
    if (isUnchanged) {
      onClose();
      return;
    }

    setIsSubmitting(true);
    try {
      const targetDb = database || connection.databaseName || 'main';
      const targetSchema =
        schema ||
        (driver === 'postgres' ? 'public' : driver === 'mssql' ? 'dbo' : targetDb);

      const res = await QueryService.ExecuteQuery({
        executionId: 'rename-table-' + Date.now(),
        connectionId: connection.id,
        database: targetDb,
        schema: targetSchema,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      if ((res as any)?.error) {
        alertError((res as any).error, `Failed to Rename ${entityLabel}`, sql);
        return;
      }

      const schemaKey = `${connection.id}:${targetDb}:${targetSchema}`;
      try {
        const objects = await SchemaService.GetObjects(connection.id, targetDb, targetSchema);
        if (objects) {
          useConnectionStore.getState().setTreeObjects(schemaKey, objects as any);
        }
      } catch {
        // Ignore explorer refresh errors after successful rename
      }

      alertSuccess(
        `${entityLabel} "${tableName}" renamed to "${cleanNewName}".`,
        `${entityLabel} Renamed`
      );
      onSuccess?.(cleanNewName);
      onClose();
    } catch (err: any) {
      alertError(err?.message || String(err), `Failed to Rename ${entityLabel}`, sql);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md rounded-xl border border-[#2b2e3a] bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {/* Header */}
        <div className={`flex items-center justify-between border-b px-5 py-3.5 ${headerClass}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400 shrink-0">
              <Pencil className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-zinc-100 truncate">
                Rename {entityLabel}
              </h3>
              <p className="text-[11px] text-zinc-400 font-mono truncate">
                {schema && schema !== database ? `${database} / ${schema}` : database || 'main'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg p-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {connection?.isReadOnly && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              This connection is read-only. Renaming is disabled.
            </div>
          )}

          {unsupportedReason && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {unsupportedReason}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              Current {entityLabel} Name
            </label>
            <div className="bg-[#101115] border border-[#2b2e3a] px-3 py-1.5 rounded-lg text-xs font-mono text-zinc-400 truncate">
              {tableName}
            </div>
          </div>

          <div className="flex justify-center text-zinc-500">
            <ArrowRight className="h-4 w-4 rotate-90" />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
              New {entityLabel} Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              autoFocus
              required
              disabled={isSubmitting || Boolean(connection?.isReadOnly) || Boolean(unsupportedReason)}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="w-full bg-[#101115] border border-[#2b2e3a] focus:border-blue-500 px-3 py-1.5 text-xs text-white outline-none rounded-lg font-mono disabled:opacity-50"
            />
          </div>

          {sql && !unsupportedReason && (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                Command Preview
              </span>
              <pre className="bg-[#101115] border border-[#272932] rounded-lg px-3 py-2 text-[11px] font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all">
                {sql}
              </pre>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#272932]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 rounded-lg border border-[#2b2e3a] bg-[#14151b] hover:bg-[#20222a] text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isDisabled}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold cursor-pointer transition-colors shadow-xs"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isSubmitting ? 'Renaming...' : `Rename ${entityLabel}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
