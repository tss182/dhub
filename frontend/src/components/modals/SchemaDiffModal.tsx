import React, { useState, useEffect } from 'react';
import { X, GitCompare, Play, Copy, Check, AlertCircle, Plus, Minus, RefreshCw } from 'lucide-react';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { SchemaService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess } from '../../stores/useAlertStore';

interface SchemaDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenInConsole?: (sql: string, connectionId: string, database: string, schema: string) => void;
}

export const SchemaDiffModal: React.FC<SchemaDiffModalProps> = ({
  isOpen,
  onClose,
  onOpenInConsole,
}) => {
  const { connections, activeConnectionId, activeDatabase, activeSchema } = useConnectionStore();

  const [srcConnId, setSrcConnId] = useState('');
  const [srcDB, setSrcDB] = useState('');
  const [srcSchema, setSrcSchema] = useState('');
  const [srcDBs, setSrcDBs] = useState<string[]>([]);
  const [srcSchemas, setSrcSchemas] = useState<string[]>([]);

  const [dstConnId, setDstConnId] = useState('');
  const [dstDB, setDstDB] = useState('');
  const [dstSchema, setDstSchema] = useState('');
  const [dstDBs, setDstDBs] = useState<string[]>([]);
  const [dstSchemas, setDstSchemas] = useState<string[]>([]);

  const [isComparing, setIsComparing] = useState(false);
  const [diffResult, setDiffResult] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [wrapInTx, setWrapInTx] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    if (activeConnectionId) {
      setSrcConnId(activeConnectionId);
      setSrcDB(activeDatabase || '');
      setSrcSchema(activeSchema || '');
      if (!dstConnId) {
        setDstConnId(activeConnectionId);
        setDstDB(activeDatabase || '');
        setDstSchema(activeSchema || '');
      }
    }
  }, [isOpen, activeConnectionId, activeDatabase, activeSchema]);

  useEffect(() => {
    if (!srcConnId) return;
    let cancelled = false;
    SchemaService.GetDatabases(srcConnId)
      .then((dbs) => {
        if (cancelled) return;
        setSrcDBs(dbs || []);
        if (dbs && dbs.length > 0 && !dbs.includes(srcDB)) setSrcDB(dbs[0]);
      })
      .catch(() => { if (!cancelled) setSrcDBs([]); });
    return () => { cancelled = true; };
  }, [srcConnId]);

  useEffect(() => {
    if (!srcConnId || !srcDB) return;
    let cancelled = false;
    SchemaService.GetSchemas(srcConnId, srcDB)
      .then((schemas) => {
        if (cancelled) return;
        setSrcSchemas(schemas || []);
        if (schemas && schemas.length > 0 && !schemas.includes(srcSchema)) setSrcSchema(schemas[0]);
      })
      .catch(() => { if (!cancelled) setSrcSchemas([]); });
    return () => { cancelled = true; };
  }, [srcConnId, srcDB]);

  useEffect(() => {
    if (!dstConnId) return;
    let cancelled = false;
    SchemaService.GetDatabases(dstConnId)
      .then((dbs) => {
        if (cancelled) return;
        setDstDBs(dbs || []);
        if (dbs && dbs.length > 0 && !dbs.includes(dstDB)) setDstDB(dbs[0]);
      })
      .catch(() => { if (!cancelled) setDstDBs([]); });
    return () => { cancelled = true; };
  }, [dstConnId]);

  useEffect(() => {
    if (!dstConnId || !dstDB) return;
    let cancelled = false;
    SchemaService.GetSchemas(dstConnId, dstDB)
      .then((schemas) => {
        if (cancelled) return;
        setDstSchemas(schemas || []);
        if (schemas && schemas.length > 0 && !schemas.includes(dstSchema)) setDstSchema(schemas[0]);
      })
      .catch(() => { if (!cancelled) setDstSchemas([]); });
    return () => { cancelled = true; };
  }, [dstConnId, dstDB]);

  const effectiveMigrationSql = React.useMemo(() => {
    const raw = diffResult?.migrationSql || '';
    if (!raw) return '';
    const dDrv = connections.find((c) => c.id === dstConnId)?.driver;
    if (wrapInTx && (dDrv === 'postgres' || dDrv === 'sqlite')) {
      return `BEGIN;\n\n${raw}\n\nCOMMIT;`;
    }
    return raw;
  }, [diffResult?.migrationSql, wrapInTx, connections, dstConnId]);

  if (!isOpen) return null;

  const handleCompare = async () => {
    if (!srcConnId || !dstConnId) {
      alertError('Please select both source and target connections.');
      return;
    }
    setIsComparing(true);
    setDiffResult(null);
    try {
      const res = await (SchemaService as any).CompareSchemas(
        srcConnId,
        srcDB,
        srcSchema,
        dstConnId,
        dstDB,
        dstSchema
      );
      setDiffResult(res);
    } catch (err: any) {
      alertError(err?.message || String(err), 'Schema Compare Failed');
    } finally {
      setIsComparing(false);
    }
  };

  const handleCopySql = async () => {
    if (!effectiveMigrationSql) return;
    try {
      await navigator.clipboard.writeText(effectiveMigrationSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      alertSuccess('Migration SQL copied to clipboard.');
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4">
      <div className="w-[860px] max-w-full max-h-[88vh] rounded-xl bg-[#191a20] border border-[#272932] flex flex-col overflow-hidden text-xs text-zinc-200 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#272932] bg-[#14151a]">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-blue-400" />
            <span className="font-semibold text-sm text-white">Schema Diff & Migration Generator</span>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Selectors */}
        <div className="p-4 border-b border-[#272932] bg-[#16171d] grid grid-cols-2 gap-4">
          <div className="space-y-2 p-3 rounded-lg border border-[#272932] bg-[#121317]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
              Source (Reference)
            </div>
            <select
              value={srcConnId}
              onChange={(e) => setSrcConnId(e.target.value)}
              className="w-full rounded bg-[#191a20] border border-[#272932] px-2.5 py-1.5 text-zinc-200"
            >
              <option value="">Select Connection...</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.driver})
                </option>
              ))}
            </select>
            {(() => {
              const sDrv = connections.find((c) => c.id === srcConnId)?.driver;
              if (sDrv === 'elasticsearch' || sDrv === 'qdrant') return null;
              return (
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={srcDB}
                    onChange={(e) => setSrcDB(e.target.value)}
                    className="rounded bg-[#191a20] border border-[#272932] px-2 py-1 text-zinc-200"
                  >
                    {srcDBs.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <select
                    value={srcSchema}
                    onChange={(e) => setSrcSchema(e.target.value)}
                    className="rounded bg-[#191a20] border border-[#272932] px-2 py-1 text-zinc-200"
                  >
                    {srcSchemas.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })()}
          </div>

          <div className="space-y-2 p-3 rounded-lg border border-[#272932] bg-[#121317]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
              Target (To Migrate)
            </div>
            <select
              value={dstConnId}
              onChange={(e) => setDstConnId(e.target.value)}
              className="w-full rounded bg-[#191a20] border border-[#272932] px-2.5 py-1.5 text-zinc-200"
            >
              <option value="">Select Connection...</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.driver})
                </option>
              ))}
            </select>
            {(() => {
              const dDrv = connections.find((c) => c.id === dstConnId)?.driver;
              if (dDrv === 'elasticsearch' || dDrv === 'qdrant') return null;
              return (
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={dstDB}
                    onChange={(e) => setDstDB(e.target.value)}
                    className="rounded bg-[#191a20] border border-[#272932] px-2 py-1 text-zinc-200"
                  >
                    {dstDBs.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <select
                    value={dstSchema}
                    onChange={(e) => setDstSchema(e.target.value)}
                    className="rounded bg-[#191a20] border border-[#272932] px-2 py-1 text-zinc-200"
                  >
                    {dstSchemas.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#272932] bg-[#14151a]">
          <div className="flex items-center gap-3 text-[11px]">
            {diffResult && (
              <>
                <span className="text-zinc-400">
                  Identical: <strong className="text-zinc-200">{diffResult.identical}</strong>
                </span>
                <span className="text-emerald-400">
                  Missing in Target: <strong>{diffResult.missingTarget}</strong>
                </span>
                <span className="text-amber-400">
                  Modified: <strong>{diffResult.modified}</strong>
                </span>
                <span className="text-rose-400">
                  Extra in Target: <strong>{diffResult.extraTarget}</strong>
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={handleCompare}
            disabled={isComparing}
            className="flex items-center gap-1.5 rounded bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 text-white font-medium cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isComparing ? 'animate-spin' : ''}`} />
            <span>{isComparing ? 'Comparing...' : 'Compare Schemas'}</span>
          </button>
        </div>

        {/* Diff Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!diffResult && !isComparing && (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
              <GitCompare className="h-8 w-8 mb-2 opacity-40" />
              <p>Select Source & Target schemas and click Compare Schemas.</p>
            </div>
          )}

          {diffResult && diffResult.tableDiffs?.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-emerald-400">
              <Check className="h-8 w-8 mb-2" />
              <p className="font-medium">Both schemas are completely identical!</p>
            </div>
          )}

          {diffResult?.tableDiffs?.map((td: any) => (
            <div
              key={td.tableName}
              className="rounded-lg border border-[#272932] bg-[#14151a] overflow-hidden"
            >
              <div className="flex items-center justify-between px-3 py-2 bg-[#1c1e26] border-b border-[#272932]">
                <span className="font-mono font-semibold text-zinc-100">{td.tableName}</span>
                <span
                  className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                    td.status === 'missing_in_target'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : td.status === 'extra_in_target'
                      ? 'bg-rose-500/20 text-rose-300'
                      : 'bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {td.status.replace(/_/g, ' ')}
                </span>
              </div>
              {td.columnDiffs && td.columnDiffs.length > 0 && (
                <div className="p-2.5 space-y-1">
                  {td.columnDiffs.map((cd: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                      {cd.status === 'added' && <Plus className="h-3 w-3 text-emerald-400 shrink-0" />}
                      {cd.status === 'removed' && <Minus className="h-3 w-3 text-rose-400 shrink-0" />}
                      {cd.status === 'modified' && (
                        <AlertCircle className="h-3 w-3 text-amber-400 shrink-0" />
                      )}
                      <span className="text-zinc-200 font-semibold">{cd.columnName}</span>
                      <span className="text-zinc-400">{cd.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {diffResult?.migrationSql && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-zinc-300">Generated Migration Script</span>
                  {(connections.find((c) => c.id === dstConnId)?.driver === 'postgres' ||
                    connections.find((c) => c.id === dstConnId)?.driver === 'sqlite') && (
                    <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={wrapInTx}
                        onChange={(e) => setWrapInTx(e.target.checked)}
                        className="accent-blue-500 cursor-pointer"
                      />
                      <span>Wrap in BEGIN; ... COMMIT;</span>
                    </label>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopySql}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#22242c] hover:bg-[#2c2f3a] text-zinc-300 cursor-pointer"
                  >
                    {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{copied ? 'Copied' : 'Copy SQL'}</span>
                  </button>
                  {onOpenInConsole && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenInConsole(effectiveMigrationSql, dstConnId, dstDB, dstSchema);
                        onClose();
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium cursor-pointer"
                    >
                      <Play className="h-3 w-3" />
                      <span>Open in Target Console</span>
                    </button>
                  )}
                </div>
              </div>
              <pre className="p-3 rounded-lg bg-[#101115] border border-[#272932] font-mono text-[11px] text-emerald-300 max-h-56 overflow-auto select-text">
                {effectiveMigrationSql}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

