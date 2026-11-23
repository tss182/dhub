import React, { useState, useEffect } from 'react';
import {
  X,
  ArrowLeftRight,
  Play,
  Copy,
  Check,
  AlertCircle,
  Plus,
  Minus,
  RefreshCw,
  UploadCloud,
} from 'lucide-react';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { SchemaService, QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';
import { buildAlertConnectionContext } from '../../types/domain';

interface DataDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenInConsole?: (sql: string, connectionId: string, database: string, schema: string) => void;
}

export const DataDiffModal: React.FC<DataDiffModalProps> = ({
  isOpen,
  onClose,
  onOpenInConsole,
}) => {
  const { connections, activeConnectionId, activeDatabase, activeSchema } = useConnectionStore();

  const [srcConnId, setSrcConnId] = useState('');
  const [srcDB, setSrcDB] = useState('');
  const [srcSchema, setSrcSchema] = useState('');
  const [srcTable, setSrcTable] = useState('');
  const [srcDBs, setSrcDBs] = useState<string[]>([]);
  const [srcSchemas, setSrcSchemas] = useState<string[]>([]);
  const [srcTables, setSrcTables] = useState<string[]>([]);

  const [dstConnId, setDstConnId] = useState('');
  const [dstDB, setDstDB] = useState('');
  const [dstSchema, setDstSchema] = useState('');
  const [dstTable, setDstTable] = useState('');
  const [dstDBs, setDstDBs] = useState<string[]>([]);
  const [dstSchemas, setDstSchemas] = useState<string[]>([]);
  const [dstTables, setDstTables] = useState<string[]>([]);

  const [keyColsInput, setKeyColsInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'added' | 'modified' | 'removed'>('all');
  const [isComparing, setIsComparing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [diffResult, setDiffResult] = useState<any>(null);
  const [copied, setCopied] = useState(false);

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
    SchemaService.GetDatabases(srcConnId)
      .then((dbs) => {
        setSrcDBs(dbs || []);
        if (dbs && dbs.length > 0 && !dbs.includes(srcDB)) setSrcDB(dbs[0]);
      })
      .catch(() => setSrcDBs([]));
  }, [srcConnId]);

  useEffect(() => {
    if (!srcConnId || !srcDB) return;
    SchemaService.GetSchemas(srcConnId, srcDB)
      .then((schemas) => {
        setSrcSchemas(schemas || []);
        if (schemas && schemas.length > 0 && !schemas.includes(srcSchema)) setSrcSchema(schemas[0]);
      })
      .catch(() => setSrcSchemas([]));
  }, [srcConnId, srcDB]);

  useEffect(() => {
    if (!srcConnId || !srcDB) return;
    SchemaService.GetObjects(srcConnId, srcDB, srcSchema)
      .then((objs) => {
        const tbls = (objs || []).filter((o: any) => o.type === 'table').map((o: any) => o.name);
        setSrcTables(tbls);
        if (tbls.length > 0 && !tbls.includes(srcTable)) setSrcTable(tbls[0]);
      })
      .catch(() => setSrcTables([]));
  }, [srcConnId, srcDB, srcSchema]);

  useEffect(() => {
    if (!dstConnId) return;
    SchemaService.GetDatabases(dstConnId)
      .then((dbs) => {
        setDstDBs(dbs || []);
        if (dbs && dbs.length > 0 && !dbs.includes(dstDB)) setDstDB(dbs[0]);
      })
      .catch(() => setDstDBs([]));
  }, [dstConnId]);

  useEffect(() => {
    if (!dstConnId || !dstDB) return;
    SchemaService.GetSchemas(dstConnId, dstDB)
      .then((schemas) => {
        setDstSchemas(schemas || []);
        if (schemas && schemas.length > 0 && !schemas.includes(dstSchema)) setDstSchema(schemas[0]);
      })
      .catch(() => setDstSchemas([]));
  }, [dstConnId, dstDB]);

  useEffect(() => {
    if (!dstConnId || !dstDB) return;
    SchemaService.GetObjects(dstConnId, dstDB, dstSchema)
      .then((objs) => {
        const tbls = (objs || []).filter((o: any) => o.type === 'table').map((o: any) => o.name);
        setDstTables(tbls);
        if (tbls.length > 0 && !tbls.includes(dstTable)) {
          setDstTable(srcTable && tbls.includes(srcTable) ? srcTable : tbls[0]);
        }
      })
      .catch(() => setDstTables([]));
  }, [dstConnId, dstDB, dstSchema]);

  if (!isOpen) return null;

  const handleCompare = async () => {
    if (!srcConnId || !srcTable || !dstConnId || !dstTable) {
      alertError('Please select source and target connections and tables.');
      return;
    }
    setIsComparing(true);
    setDiffResult(null);
    try {
      const keyCols = keyColsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await (SchemaService as any).CompareTableData({
        srcConnId,
        srcDb: srcDB,
        srcSchema,
        srcTable,
        dstConnId,
        dstDb: dstDB,
        dstSchema,
        dstTable,
        keyCols,
        limit: 2000,
      });
      setDiffResult(res);
    } catch (err: any) {
      alertError(err?.message || String(err), 'Data Compare Failed');
    } finally {
      setIsComparing(false);
    }
  };

  const handleCopySql = async () => {
    if (!diffResult?.syncSql) return;
    try {
      await navigator.clipboard.writeText(diffResult.syncSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleApplySync = async () => {
    if (!diffResult?.syncChanges?.length) return;
    const dstConn = connections.find((c) => c.id === dstConnId);
    if (dstConn?.isReadOnly) {
      alertError(`Target connection "${dstConn.name}" is Read-Only.`, 'Sync Blocked');
      return;
    }

    const ok = await confirmDialog({
      title: 'Apply Data Sync to Target?',
      message: `Apply ${diffResult.syncChanges.length} change(s) (${diffResult.added} inserts, ${diffResult.modified} updates, ${diffResult.removed} deletes) to "${dstTable}"?`,
      connectionContext: buildAlertConnectionContext(dstConn, {
        database: dstDB,
        schema: dstSchema,
        targetName: dstTable,
        targetLabel: 'Table',
      }),
      confirmLabel: 'Apply Sync',
      isDanger: true,
    });
    if (!ok) return;

    setIsSyncing(true);
    try {
      const affected = await QueryService.SubmitChanges(
        dstConnId,
        dstDB,
        dstSchema,
        dstTable,
        diffResult.syncChanges
      );
      alertSuccess(`Successfully synced ${affected} row(s) to "${dstTable}".`, 'Data Sync Complete');
      handleCompare();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Data Sync Failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const filteredDiffs = (diffResult?.rowDiffs || []).filter((d: any) =>
    statusFilter === 'all' ? true : d.status === statusFilter
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-5xl max-h-[90vh] rounded-xl border border-[#272932] bg-[#14151a] shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#272932] px-5 py-3.5 bg-[#191a20]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-400">
              <ArrowLeftRight className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Data Compare &amp; Table Sync</h2>
              <p className="text-[11px] text-zinc-400">
                Compare row data between two tables and generate or apply sync DML
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 border-b border-[#272932] bg-[#16171d]">
          {/* Source */}
          <div className="p-3 rounded-lg border border-[#272932] bg-[#14151a] space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              Source (Reference)
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <select
                value={srcConnId}
                onChange={(e) => setSrcConnId(e.target.value)}
                className="col-span-2 rounded border border-[#272932] bg-[#1e2029] px-2 py-1.5 text-zinc-200 outline-none"
              >
                <option value="">Select Connection...</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.driver})
                  </option>
                ))}
              </select>
              <select
                value={srcDB}
                onChange={(e) => setSrcDB(e.target.value)}
                className="rounded border border-[#272932] bg-[#1e2029] px-2 py-1.5 text-zinc-200 outline-none"
              >
                {srcDBs.map((db) => (
                  <option key={db} value={db}>
                    {db}
                  </option>
                ))}
              </select>
              <select
                value={srcSchema}
                onChange={(e) => setSrcSchema(e.target.value)}
                className="rounded border border-[#272932] bg-[#1e2029] px-2 py-1.5 text-zinc-200 outline-none"
              >
                {srcSchemas.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={srcTable}
                onChange={(e) => setSrcTable(e.target.value)}
                className="col-span-2 rounded border border-[#272932] bg-[#1e2029] px-2 py-1.5 text-zinc-200 outline-none font-mono"
              >
                <option value="">Select Source Table...</option>
                {srcTables.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Target */}
          <div className="p-3 rounded-lg border border-[#272932] bg-[#14151a] space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
              Target (To Sync)
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <select
                value={dstConnId}
                onChange={(e) => setDstConnId(e.target.value)}
                className="col-span-2 rounded border border-[#272932] bg-[#1e2029] px-2 py-1.5 text-zinc-200 outline-none"
              >
                <option value="">Select Connection...</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.driver})
                  </option>
                ))}
              </select>
              <select
                value={dstDB}
                onChange={(e) => setDstDB(e.target.value)}
                className="rounded border border-[#272932] bg-[#1e2029] px-2 py-1.5 text-zinc-200 outline-none"
              >
                {dstDBs.map((db) => (
                  <option key={db} value={db}>
                    {db}
                  </option>
                ))}
              </select>
              <select
                value={dstSchema}
                onChange={(e) => setDstSchema(e.target.value)}
                className="rounded border border-[#272932] bg-[#1e2029] px-2 py-1.5 text-zinc-200 outline-none"
              >
                {dstSchemas.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={dstTable}
                onChange={(e) => setDstTable(e.target.value)}
                className="col-span-2 rounded border border-[#272932] bg-[#1e2029] px-2 py-1.5 text-zinc-200 outline-none font-mono"
              >
                <option value="">Select Target Table...</option>
                {dstTables.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Key Columns + Compare Button */}
          <div className="md:col-span-2 flex flex-wrap items-center gap-2 pt-1">
            <input
              type="text"
              value={keyColsInput}
              onChange={(e) => setKeyColsInput(e.target.value)}
              placeholder="Key columns (optional, comma-separated; defaults to Primary Key)"
              className="flex-1 min-w-[240px] rounded-lg border border-[#272932] bg-[#1e2029] px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-cyan-500"
            />
            <button
              type="button"
              onClick={handleCompare}
              disabled={isComparing || !srcTable || !dstTable}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              {isComparing ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              <span>{isComparing ? 'Comparing...' : 'Compare Data'}</span>
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!diffResult ? (
            <div className="py-12 text-center text-xs text-zinc-500">
              Select source and target tables above and click <strong>Compare Data</strong>.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 font-mono">
                    Identical: {diffResult.identical}
                  </span>
                  <button
                    type="button"
                    onClick={() => setStatusFilter(statusFilter === 'added' ? 'all' : 'added')}
                    className={`px-2.5 py-1 rounded font-mono cursor-pointer border ${
                      statusFilter === 'added'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                        : 'bg-emerald-950/30 border-emerald-800/40 text-emerald-400'
                    }`}
                  >
                    + Added: {diffResult.added}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter(statusFilter === 'modified' ? 'all' : 'modified')}
                    className={`px-2.5 py-1 rounded font-mono cursor-pointer border ${
                      statusFilter === 'modified'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-amber-950/30 border-amber-800/40 text-amber-400'
                    }`}
                  >
                    ~ Modified: {diffResult.modified}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter(statusFilter === 'removed' ? 'all' : 'removed')}
                    className={`px-2.5 py-1 rounded font-mono cursor-pointer border ${
                      statusFilter === 'removed'
                        ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                        : 'bg-rose-950/30 border-rose-800/40 text-rose-400'
                    }`}
                  >
                    - Removed: {diffResult.removed}
                  </button>
                </div>

                {diffResult.truncated && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Showing first 2,000 rows per table
                  </span>
                )}
              </div>

              {filteredDiffs.length === 0 ? (
                <div className="py-8 text-center text-xs text-emerald-400 bg-emerald-950/20 border border-emerald-800/30 rounded-lg">
                  Tables are in sync for the selected filter!
                </div>
              ) : (
                <div className="rounded-lg border border-[#272932] overflow-hidden divide-y divide-[#22242c]">
                  {filteredDiffs.slice(0, 200).map((d: any, idx: number) => (
                    <div key={`${d.key}-${idx}`} className="p-2.5 bg-[#16171d] text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-mono">
                          {d.status === 'added' && <Plus className="h-3.5 w-3.5 text-emerald-400" />}
                          {d.status === 'removed' && <Minus className="h-3.5 w-3.5 text-rose-400" />}
                          {d.status === 'modified' && (
                            <ArrowLeftRight className="h-3.5 w-3.5 text-amber-400" />
                          )}
                          <span className="font-semibold text-zinc-200">
                            Key ({(diffResult.keyColumns || []).join(', ')}): {d.key}
                          </span>
                        </div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">
                          {d.status}
                        </span>
                      </div>

                      {d.status === 'modified' && d.diffFields?.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-5 text-[11px] font-mono">
                          {d.diffFields.map((f: string) => (
                            <div
                              key={f}
                              className="px-2 py-1 rounded bg-[#121317] border border-[#272932] flex flex-col"
                            >
                              <span className="text-zinc-400">{f}</span>
                              <span className="text-rose-400 line-through truncate">
                                {d.dstRow?.[f] == null
                                  ? 'NULL'
                                  : typeof d.dstRow[f] === 'object'
                                  ? JSON.stringify(d.dstRow[f])
                                  : String(d.dstRow[f])}
                              </span>
                              <span className="text-emerald-400 truncate">
                                {d.srcRow?.[f] == null
                                  ? 'NULL'
                                  : typeof d.srcRow[f] === 'object'
                                  ? JSON.stringify(d.srcRow[f])
                                  : String(d.srcRow[f])}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {diffResult?.syncSql && (
          <div className="flex items-center justify-between border-t border-[#272932] px-5 py-3 bg-[#191a20]">
            <div className="text-[11px] text-zinc-400">
              {diffResult.syncChanges?.length || 0} sync statement(s) generated
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopySql}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#22242c] hover:bg-[#2b2e38] text-zinc-200 text-xs font-medium cursor-pointer"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? 'Copied' : 'Copy Sync SQL'}</span>
              </button>
              {onOpenInConsole && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenInConsole(diffResult.syncSql, dstConnId, dstDB, dstSchema);
                    onClose();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 text-xs font-medium cursor-pointer"
                >
                  Open in Console
                </button>
              )}
              <button
                type="button"
                onClick={handleApplySync}
                disabled={isSyncing}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                <span>{isSyncing ? 'Syncing...' : 'Apply Sync to Target'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
