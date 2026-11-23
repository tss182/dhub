import React from 'react';
import { Database, Layers, ArrowRightLeft, X } from 'lucide-react';
import { ConnectionConfig, resolveConnectionEnv } from '../../types/domain';

export interface CreateDbModalState {
  isOpen: boolean;
  connection: ConnectionConfig | null;
  dbName: string;
  charset: string;
  collation: string;
}

export interface CreateSchemaModalState {
  isOpen: boolean;
  connection: ConnectionConfig | null;
  database: string;
  schemaName: string;
  authorization: string;
}

export interface MoveTableModalState {
  isOpen: boolean;
  connection: ConnectionConfig | null;
  database: string;
  sourceSchema: string;
  tableName: string;
  targetSchema: string;
  objectType: string;
  availableSchemas: string[];
}

export const CreateDatabaseModal: React.FC<{
  state: CreateDbModalState;
  setState: React.Dispatch<React.SetStateAction<CreateDbModalState>>;
  onSubmit: (e: React.FormEvent) => void;
}> = ({ state: createDbModal, setState: setCreateDbModal, onSubmit: handleConfirmCreateDatabase }) => {
  if (!createDbModal.isOpen) return null;
  const dbModalEnv = resolveConnectionEnv(createDbModal.connection);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => setCreateDbModal((prev) => ({ ...prev, isOpen: false }))}
    >
      <div
        className={`w-full max-w-md rounded-2xl border bg-[#14151a] shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col overflow-hidden text-zinc-200 ${
          dbModalEnv === 'dev'
            ? 'border-emerald-700/60'
            : dbModalEnv === 'prod'
            ? 'border-rose-700/60'
            : 'border-[#2b2e3a]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex items-start justify-between gap-3 px-6 py-4 border-b ${
            dbModalEnv === 'dev'
              ? 'bg-emerald-950/60 border-emerald-800/60'
              : dbModalEnv === 'prod'
              ? 'bg-rose-950/60 border-rose-800/60'
              : 'bg-[#16171f] border-[#272932]'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                dbModalEnv === 'dev'
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                  : dbModalEnv === 'prod'
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                  : 'bg-blue-500/15 border-blue-500/30 text-blue-400'
              }`}
            >
              <Database className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-zinc-100">Create New Database</h3>
                {dbModalEnv !== 'local' && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase font-mono border ${
                      dbModalEnv === 'dev'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    }`}
                  >
                    {dbModalEnv === 'dev' ? 'DEV' : 'PROD'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-400 font-mono">
                Connection: {createDbModal.connection?.name} ({createDbModal.connection?.driver?.toUpperCase()})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCreateDbModal((prev) => ({ ...prev, isOpen: false }))}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleConfirmCreateDatabase} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
              Database Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              autoFocus
              required
              placeholder="e.g. sales_db"
              value={createDbModal.dbName}
              onChange={(e) => setCreateDbModal((prev) => ({ ...prev, dbName: e.target.value }))}
              className="w-full rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>

          {(createDbModal.connection?.driver === 'mysql' || createDbModal.connection?.driver === 'mariadb') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">Character Set</label>
                <input
                  type="text"
                  value={createDbModal.charset}
                  onChange={(e) => setCreateDbModal((prev) => ({ ...prev, charset: e.target.value }))}
                  className="w-full rounded bg-[#101115] border border-[#2b2e3a] px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">Collation</label>
                <input
                  type="text"
                  value={createDbModal.collation}
                  onChange={(e) => setCreateDbModal((prev) => ({ ...prev, collation: e.target.value }))}
                  className="w-full rounded bg-[#101115] border border-[#2b2e3a] px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {createDbModal.connection?.driver === 'postgres' && (
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">Encoding</label>
              <input
                type="text"
                value={createDbModal.charset}
                onChange={(e) => setCreateDbModal((prev) => ({ ...prev, charset: e.target.value }))}
                className="w-full rounded bg-[#101115] border border-[#2b2e3a] px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530]">
            <button
              type="button"
              onClick={() => setCreateDbModal((prev) => ({ ...prev, isOpen: false }))}
              className="px-3.5 py-1.5 rounded-lg bg-[#20222a] hover:bg-[#2b2d38] border border-[#2d303f] text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!createDbModal.dbName.trim()}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm"
            >
              Create Database
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const CreateSchemaModal: React.FC<{
  state: CreateSchemaModalState;
  setState: React.Dispatch<React.SetStateAction<CreateSchemaModalState>>;
  onSubmit: (e: React.FormEvent) => void;
}> = ({ state: createSchemaModal, setState: setCreateSchemaModal, onSubmit: handleConfirmCreateSchema }) => {
  if (!createSchemaModal.isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => setCreateSchemaModal((prev) => ({ ...prev, isOpen: false }))}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#2b2e3a] bg-[#14151a] p-6 shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col gap-4 text-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-100">Create New Schema</h3>
              <p className="text-[11px] text-zinc-400">
                Database: <span className="font-mono text-cyan-300 font-medium">{createSchemaModal.database}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCreateSchemaModal((prev) => ({ ...prev, isOpen: false }))}
            className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-[#20222a] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleConfirmCreateSchema} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
              Schema Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              autoFocus
              required
              placeholder="e.g. analytics, staging, v1"
              value={createSchemaModal.schemaName}
              onChange={(e) => setCreateSchemaModal((prev) => ({ ...prev, schemaName: e.target.value }))}
              className="w-full rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none font-mono transition-colors"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Must start with a letter or underscore and contain only alphanumeric characters and underscores.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
              Authorization / Owner <span className="text-zinc-500 text-[10px] font-normal lowercase">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. postgres or custom role name"
              value={createSchemaModal.authorization}
              onChange={(e) => setCreateSchemaModal((prev) => ({ ...prev, authorization: e.target.value }))}
              className="w-full rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none font-mono transition-colors"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Leave empty to create the schema under current logged-in user.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530]">
            <button
              type="button"
              onClick={() => setCreateSchemaModal((prev) => ({ ...prev, isOpen: false }))}
              className="px-3.5 py-1.5 rounded-lg bg-[#20222a] hover:bg-[#2b2d38] border border-[#2d303f] text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!createSchemaModal.schemaName.trim()}
              className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm"
            >
              Create Schema
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const MoveTableModal: React.FC<{
  state: MoveTableModalState;
  setState: React.Dispatch<React.SetStateAction<MoveTableModalState>>;
  onSubmit: (e: React.FormEvent) => void;
}> = ({ state: moveTableModal, setState: setMoveTableModal, onSubmit: handleConfirmMoveTable }) => {
  if (!moveTableModal.isOpen) return null;
  const isMysqlLike =
    moveTableModal.connection?.driver === 'mysql' || moveTableModal.connection?.driver === 'mariadb';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => setMoveTableModal((prev) => ({ ...prev, isOpen: false }))}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#2b2e3a] bg-[#14151a] p-6 shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col gap-4 text-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
              <ArrowRightLeft className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-100">
                Move {moveTableModal.objectType === 'view' ? 'View' : moveTableModal.objectType === 'materialized_view' ? 'Materialized View' : 'Table'} to Another{' '}
                {isMysqlLike ? 'Database' : 'Schema'}
              </h3>
              <p className="text-[11px] text-zinc-400">
                Database: <span className="font-mono text-zinc-200">{moveTableModal.database}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMoveTableModal((prev) => ({ ...prev, isOpen: false }))}
            className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-[#20222a] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleConfirmMoveTable} className="space-y-4">
          <div className="rounded-lg bg-[#101115] border border-[#232530] p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Object Name:</span>
              <span className="font-mono text-zinc-100 font-semibold">{moveTableModal.tableName}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Current {isMysqlLike ? 'Database' : 'Schema'}:</span>
              <span className="font-mono text-cyan-300 bg-cyan-950/50 border border-cyan-800/50 px-2 py-0.5 rounded text-[11px]">
                {moveTableModal.sourceSchema}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
              Target {isMysqlLike ? 'Database' : 'Schema'} <span className="text-rose-400">*</span>
            </label>
            <div className="space-y-2">
              <select
                value={moveTableModal.targetSchema}
                onChange={(e) => setMoveTableModal((prev) => ({ ...prev, targetSchema: e.target.value }))}
                className="w-full rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none font-mono transition-colors"
              >
                <option value="" disabled>
                  -- Select a target {isMysqlLike ? 'database' : 'schema'} --
                </option>
                {moveTableModal.availableSchemas.map((s) => (
                  <option key={s} value={s} disabled={s === moveTableModal.sourceSchema}>
                    {s} {s === moveTableModal.sourceSchema ? '(Current)' : ''}
                  </option>
                ))}
              </select>

              <div className="text-[11px] text-zinc-400">
                Or enter another {isMysqlLike ? 'database' : 'schema'} name:
              </div>
              <input
                type="text"
                placeholder={isMysqlLike ? 'Enter database name' : 'Enter schema name'}
                value={moveTableModal.targetSchema}
                onChange={(e) => setMoveTableModal((prev) => ({ ...prev, targetSchema: e.target.value }))}
                className="w-full rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none font-mono transition-colors"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-500 font-mono">
              {isMysqlLike
                ? `RENAME TABLE \`${moveTableModal.sourceSchema}\`.\`${moveTableModal.tableName}\` TO \`${moveTableModal.targetSchema || '...'}\`.\`${moveTableModal.tableName}\`;`
                : `ALTER ${moveTableModal.objectType === 'view' ? 'VIEW' : moveTableModal.objectType === 'materialized_view' ? 'MATERIALIZED VIEW' : 'TABLE'} "${moveTableModal.sourceSchema}"."${moveTableModal.tableName}" SET SCHEMA "${moveTableModal.targetSchema || '...'}"`}
            </p>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530]">
            <button
              type="button"
              onClick={() => setMoveTableModal((prev) => ({ ...prev, isOpen: false }))}
              className="px-3.5 py-1.5 rounded-lg bg-[#20222a] hover:bg-[#2b2d38] border border-[#2d303f] text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                !moveTableModal.targetSchema.trim() ||
                moveTableModal.targetSchema.trim() === moveTableModal.sourceSchema
              }
              className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm"
            >
              Move {moveTableModal.objectType === 'view' ? 'View' : moveTableModal.objectType === 'materialized_view' ? 'Materialized View' : 'Table'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
