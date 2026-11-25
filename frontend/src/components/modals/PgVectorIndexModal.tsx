import React, { useEffect, useMemo, useState } from 'react';
import { Call } from '@wailsio/runtime';
import * as QueryService from '../../../bindings/dhub/internal/services/queryservice';
import {
  X,
  Sparkles,
  RefreshCw,
  Trash2,
  RotateCw,
  Terminal,
  Play,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Loader2,
} from 'lucide-react';
import { getMaxIndexDimsForKind, getOpclassFor, PgVectorKind } from '../../utils/pgvector';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';

export interface PgVectorIndexModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  schema: string;
  tableName: string;
  onOpenInConsole?: (sql: string) => void;
  onChanged?: () => void;
}

interface PgVectorStatus {
  installed: boolean;
  installedVersion: string;
  defaultVersion: string;
  schema: string;
  supportsHnsw: boolean;
  supportsParallelHnsw: boolean;
  supportsHalfvec: boolean;
  supportsSparsevec: boolean;
  supportsBit: boolean;
  supportsL1: boolean;
  supportsIterative: boolean;
  hasPgTrgm: boolean;
}

interface PgVectorColumnInfo {
  name: string;
  dataType: string;
  kind: PgVectorKind;
  dims: number;
}

interface PgVectorIndexInfo {
  indexName: string;
  method: string;
  columnOrExpr: string;
  opclass: string;
  withParams: Record<string, string>;
  wherePredicate: string;
  isExpressionQuantized: boolean;
  isValid: boolean;
  sizePretty: string;
  idxScan: number;
  definition: string;
}

interface PgVectorProgressInfo {
  indexName: string;
  phase: string;
  tuplesDone: number;
  tuplesTotal: number;
  blocksDone: number;
  blocksTotal: number;
  percent: number;
}

interface TableVectorOverview {
  columns: PgVectorColumnInfo[];
  indexes: PgVectorIndexInfo[];
  inProgress: PgVectorProgressInfo[];
  rowEstimate: number;
}

function qIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export const PgVectorIndexModal: React.FC<PgVectorIndexModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  schema,
  tableName,
  onOpenInConsole,
  onChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'existing' | 'create'>('existing');
  const [status, setStatus] = useState<PgVectorStatus | null>(null);
  const [overview, setOverview] = useState<TableVectorOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Create / Advise form state
  const [selectedCol, setSelectedCol] = useState('');
  const [method, setMethod] = useState<'hnsw' | 'ivfflat'>('hnsw');
  const [metric, setMetric] = useState<'cosine' | 'l2' | 'ip' | 'l1' | 'hamming' | 'jaccard'>('cosine');
  const [quantization, setQuantization] = useState<'none' | 'halfvec' | 'binary'>('none');
  const [opclass, setOpclass] = useState('vector_cosine_ops');
  const [indexName, setIndexName] = useState('');
  const [withM, setWithM] = useState('16');
  const [withEfConstruction, setWithEfConstruction] = useState('64');
  const [withLists, setWithLists] = useState('100');
  const [whereClause, setWhereClause] = useState('');
  const [concurrently, setConcurrently] = useState(true);

  const loadAll = async (silent = false) => {
    if (!connectionId || !tableName) return;
    if (!silent) setLoading(true);
    try {
      const [st, ov] = await Promise.all([
        Call.ByName('dhub/internal/services.SchemaService.GetPgVectorStatus', connectionId, database || 'postgres'),
        Call.ByName(
          'dhub/internal/services.SchemaService.GetTableVectorOverview',
          connectionId,
          database || 'postgres',
          schema || 'public',
          tableName
        ),
      ]);
      setStatus(st as PgVectorStatus);
      const ovTyped = ov as TableVectorOverview;
      setOverview(ovTyped);
      if (ovTyped?.columns?.length && !selectedCol) {
        const first = ovTyped.columns[0];
        setSelectedCol(first.name);
        const recLists = Math.max(
          10,
          Math.round(
            (ovTyped.rowEstimate || 0) < 1_000_000
              ? Math.max(1000, ovTyped.rowEstimate || 1000) / 1000
              : Math.sqrt(ovTyped.rowEstimate || 1000)
          )
        );
        setWithLists(String(recLists));
        if (first.kind === 'bit') {
          setMetric('hamming');
          setOpclass(getOpclassFor('bit', 'hamming') || 'bit_hamming_ops');
        } else {
          setOpclass(getOpclassFor(first.kind, 'cosine') || 'vector_cosine_ops');
        }
      }
    } catch (err: any) {
      if (!silent) alertError('pgvector Error', err?.message || String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadAll();
  }, [isOpen, connectionId, database, schema, tableName]);

  // Poll pg_stat_progress_create_index every 2s while index builds are in progress
  useEffect(() => {
    if (!isOpen || !overview?.inProgress?.length) return;
    const timer = window.setInterval(() => {
      loadAll(true);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isOpen, overview?.inProgress?.length, connectionId, database, schema, tableName]);

  const activeColMeta = useMemo(
    () => overview?.columns?.find((c) => c.name === selectedCol) || overview?.columns?.[0],
    [overview, selectedCol]
  );

  const effectiveKind: PgVectorKind = useMemo(() => {
    if (quantization === 'halfvec') return 'halfvec';
    if (quantization === 'binary') return 'bit';
    return activeColMeta?.kind || 'vector';
  }, [quantization, activeColMeta]);

  useEffect(() => {
    const nextOp = getOpclassFor(effectiveKind, metric);
    if (nextOp) setOpclass(nextOp);
  }, [effectiveKind, metric]);

  const dims = activeColMeta?.dims || 0;
  const maxDims = getMaxIndexDimsForKind(effectiveKind);
  const exceedsDimsLimit = dims > 0 && dims > maxDims;
  const rowEstimate = overview?.rowEstimate || 0;
  const recommendedLists = Math.max(
    10,
    Math.round(rowEstimate < 1_000_000 ? Math.max(1000, rowEstimate) / 1000 : Math.sqrt(Math.max(100, rowEstimate)))
  );
  const estimatedBuildMemMb = useMemo(() => {
    if (!dims || !rowEstimate) return null;
    // Rough rule of thumb for HNSW graph: ~ (dims * 4 + m * 8) bytes per vector
    const mVal = parseInt(withM || '16', 10) || 16;
    const bytesPerRow = effectiveKind === 'halfvec' ? dims * 2 + mVal * 8 : effectiveKind === 'bit' ? Math.ceil(dims / 8) + mVal * 8 : dims * 4 + mVal * 8;
    return Math.max(64, Math.ceil((bytesPerRow * rowEstimate) / (1024 * 1024) * 1.3));
  }, [dims, rowEstimate, withM, effectiveKind]);

  const generatedSql = useMemo(() => {
    const col = selectedCol || activeColMeta?.name || 'embedding';
    const schPrefix = schema ? `${qIdent(schema)}.` : '';
    const tblRef = `${schPrefix}${qIdent(tableName)}`;
    const autoName = indexName.trim() || `idx_${tableName}_${col}_${method}${quantization !== 'none' ? `_${quantization}` : ''}`;
    let expr = qIdent(col);
    if (quantization === 'halfvec' && dims > 0) {
      expr = `(${expr}::halfvec(${dims}))`;
    } else if (quantization === 'binary' && dims > 0) {
      expr = `(binary_quantize(${expr})::bit(${dims}))`;
    }
    const withParts: string[] = [];
    if (method === 'hnsw') {
      if (withM.trim()) withParts.push(`m = ${withM.trim()}`);
      if (withEfConstruction.trim()) withParts.push(`ef_construction = ${withEfConstruction.trim()}`);
    } else {
      if (withLists.trim()) withParts.push(`lists = ${withLists.trim()}`);
    }
    const withClause = withParts.length > 0 ? ` WITH (${withParts.join(', ')})` : '';
    const whereSql = whereClause.trim() ? ` WHERE ${whereClause.trim()}` : '';
    const concSql = concurrently ? 'CONCURRENTLY ' : '';
    return `CREATE INDEX ${concSql}${qIdent(autoName)} ON ${tblRef} USING ${method} (${expr} ${opclass})${withClause}${whereSql};`;
  }, [selectedCol, activeColMeta, schema, tableName, indexName, method, quantization, dims, withM, withEfConstruction, withLists, opclass, whereClause, concurrently]);

  if (!isOpen) return null;

  const execSql = async (sql: string, label: string, switchTabOnSuccess?: 'existing' | 'create') => {
    setBusyAction(label);
    try {
      const res: any = await QueryService.ExecuteQuery({
        executionId: `pgvec-idx-${Date.now()}`,
        connectionId,
        database: database || 'postgres',
        schema: schema || 'public',
        sql,
        limit: 100,
        offset: 0,
      } as any);
      if (res?.error) {
        alertError(label, res.error);
        return;
      }
      alertSuccess(label, 'Completed successfully.');
      if (switchTabOnSuccess) setActiveTab(switchTabOnSuccess);
      await loadAll();
      onChanged?.();
    } catch (err: any) {
      alertError(label, err?.message || String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleInstallOrUpgrade = async (action: 'install' | 'upgrade') => {
    setBusyAction(action);
    try {
      const st = await Call.ByName(
        'dhub/internal/services.SchemaService.InstallOrUpgradePgVector',
        connectionId,
        database || 'postgres',
        action
      );
      setStatus(st as PgVectorStatus);
      alertSuccess('pgvector', `Extension ${action === 'install' ? 'installed' : 'upgraded'} successfully.`);
      await loadAll();
    } catch (err: any) {
      alertError('pgvector Extension', err?.message || String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDropIndex = async (idx: PgVectorIndexInfo) => {
    const ok = await confirmDialog({
      title: 'Drop Vector Index',
      message: `Drop index "${idx.indexName}" CONCURRENTLY?`,
      confirmLabel: 'Drop Index',
    });
    if (!ok) return;
    const schPrefix = schema ? `${qIdent(schema)}.` : '';
    await execSql(`DROP INDEX CONCURRENTLY IF EXISTS ${schPrefix}${qIdent(idx.indexName)};`, 'Drop Vector Index');
  };

  const handleReindex = async (idx: PgVectorIndexInfo) => {
    const schPrefix = schema ? `${qIdent(schema)}.` : '';
    await execSql(`REINDEX INDEX CONCURRENTLY ${schPrefix}${qIdent(idx.indexName)};`, 'Reindex Vector Index');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4">
      <div className="w-full max-w-3xl rounded-xl border border-[#2b2d36] bg-[#14151a] text-[#dfe1e5] shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#252730] bg-[#181920]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-7 w-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <Layers className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white truncate">
                pgvector Index Manager & Advisor
              </h3>
              <p className="text-[11px] font-mono text-zinc-400 truncate">
                {schema ? `${schema}.` : ''}{tableName}
                {overview ? ` • ~${overview.rowEstimate.toLocaleString()} rows` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {status && (
              status.installed ? (
                <div className="flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    vector v{status.installedVersion}
                  </span>
                  {status.defaultVersion && status.installedVersion !== status.defaultVersion && (
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => handleInstallOrUpgrade('upgrade')}
                      className="px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 cursor-pointer"
                    >
                      Upgrade to v{status.defaultVersion}
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => handleInstallOrUpgrade('install')}
                  className="px-2.5 py-1 rounded text-[11px] font-medium bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                >
                  Install pgvector Extension
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => loadAll()}
              disabled={loading}
              className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-[#23252e] cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-[#23252e] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 pt-2 border-b border-[#252730] bg-[#16171d]">
          <button
            type="button"
            onClick={() => setActiveTab('existing')}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors cursor-pointer ${
              activeTab === 'existing'
                ? 'border-emerald-400 text-emerald-300 bg-[#1e2029]'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Existing Vector Indexes ({overview?.indexes?.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'create'
                ? 'border-emerald-400 text-emerald-300 bg-[#1e2029]'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sparkles className="h-3 w-3" />
            <span>Create / Advise Index</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {activeTab === 'existing' ? (
            <>
              {/* Live build progress */}
              {overview?.inProgress && overview.inProgress.length > 0 && (
                <div className="rounded-lg border border-blue-500/35 bg-blue-500/10 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Index Build in Progress (pg_stat_progress_create_index)</span>
                  </div>
                  {overview.inProgress.map((p, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-zinc-200">
                        <span>{p.indexName || 'building index'} — {p.phase}</span>
                        <span>{p.percent.toFixed(1)}% ({p.tuplesDone.toLocaleString()}/{p.tuplesTotal.toLocaleString()} tuples)</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(2, p.percent))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {loading && !overview ? (
                <div className="py-10 text-center text-xs text-zinc-400">Loading vector indexes...</div>
              ) : !overview?.indexes?.length ? (
                <div className="rounded-lg border border-dashed border-[#2c2f3a] p-6 text-center space-y-2">
                  <p className="text-xs text-zinc-300">No pgvector indexes (HNSW or IVFFlat) found on this table.</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('create')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Design & Create Vector Index</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {overview.indexes.map((idx) => (
                    <div
                      key={idx.indexName}
                      className="rounded-lg border border-[#282a34] bg-[#1a1c23] p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono font-semibold text-white">{idx.indexName}</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              {idx.method}
                            </span>
                            {idx.isValid ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-300">
                                <CheckCircle2 className="h-3 w-3" /> VALID
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                <AlertTriangle className="h-3 w-3" /> INVALID (needs REINDEX)
                              </span>
                            )}
                            {idx.isExpressionQuantized && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/15 text-purple-300 border border-purple-500/30">
                                Quantized Expression
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-zinc-400">
                            Target: <span className="text-zinc-200">{idx.columnOrExpr}</span> • Opclass:{' '}
                            <span className="text-cyan-300">{idx.opclass || 'default'}</span> • Size:{' '}
                            <span className="text-zinc-200">{idx.sizePretty || '0 bytes'}</span> • Scans:{' '}
                            <span className="text-zinc-200">{idx.idxScan.toLocaleString()}</span>
                          </div>
                          {idx.wherePredicate && (
                            <div className="text-[11px] font-mono text-amber-300">
                              WHERE {idx.wherePredicate}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => handleReindex(idx)}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border cursor-pointer ${
                              !idx.isValid
                                ? 'bg-amber-500/20 border-amber-500/40 text-amber-200 hover:bg-amber-500/30'
                                : 'bg-[#232630] border-[#343846] text-zinc-200 hover:bg-[#2b2e3a]'
                            }`}
                            title="REINDEX INDEX CONCURRENTLY"
                          >
                            <RotateCw className="h-3 w-3" />
                            <span>Reindex</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => handleDropIndex(idx)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-rose-500/15 border border-rose-500/35 text-rose-300 hover:bg-rose-500/25 cursor-pointer"
                            title="DROP INDEX CONCURRENTLY"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Drop</span>
                          </button>
                        </div>
                      </div>
                      <pre className="text-[10px] font-mono text-zinc-400 bg-[#121318] rounded p-2 overflow-x-auto border border-[#23252e]">
                        {idx.definition}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              {/* Advisor Card */}
              <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Index Advisor</span>
                </div>
                <p className="text-[11px] text-zinc-300">
                  Table has <strong className="text-white">~{rowEstimate.toLocaleString()}</strong> rows
                  {activeColMeta ? (
                    <>
                      {' '}and column <code className="text-cyan-300">{activeColMeta.name}</code> is{' '}
                      <code className="text-cyan-300">{activeColMeta.dataType}</code> ({dims || '?'} dims).
                    </>
                  ) : '.'}{' '}
                  {rowEstimate < 100_000
                    ? 'HNSW is recommended for best recall/QPS without requiring a training step.'
                    : `HNSW gives best recall/QPS; IVFFlat builds faster with recommended lists = ${recommendedLists}.`}
                  {estimatedBuildMemMb && method === 'hnsw'
                    ? ` Estimated HNSW graph memory: ~${estimatedBuildMemMb} MB (consider increasing maintenance_work_mem before building).`
                    : ''}
                </p>
                {exceedsDimsLimit && (
                  <div className="mt-1 rounded bg-amber-500/15 border border-amber-500/40 px-2.5 py-1.5 text-[11px] text-amber-200">
                    Warning: {dims} dims exceeds the {maxDims}-dim limit for {effectiveKind}. Choose{' '}
                    <strong>Scalar Halfvec</strong> (up to 4,000 dims) or <strong>Binary Quantize</strong> (up to 64,000 bits).
                  </div>
                )}
              </div>

              {/* Form */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">Vector Column</span>
                  <select
                    value={selectedCol}
                    onChange={(e) => setSelectedCol(e.target.value)}
                    className="w-full h-8 px-2.5 rounded bg-[#1d1f27] border border-[#2f323e] font-mono text-zinc-100"
                  >
                    {(overview?.columns || []).map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} ({c.dataType})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">Index Name (optional)</span>
                  <input
                    type="text"
                    value={indexName}
                    onChange={(e) => setIndexName(e.target.value)}
                    placeholder={`idx_${tableName}_${selectedCol || 'vec'}_${method}`}
                    className="w-full h-8 px-2.5 rounded bg-[#1d1f27] border border-[#2f323e] font-mono text-zinc-100"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">Index Method</span>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as 'hnsw' | 'ivfflat')}
                    className="w-full h-8 px-2.5 rounded bg-[#1d1f27] border border-[#2f323e] text-zinc-100"
                  >
                    <option value="hnsw">HNSW (recommended)</option>
                    <option value="ivfflat">IVFFlat (fast build)</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">Distance Metric</span>
                  <select
                    value={metric}
                    onChange={(e) => setMetric(e.target.value as any)}
                    className="w-full h-8 px-2.5 rounded bg-[#1d1f27] border border-[#2f323e] text-zinc-100"
                  >
                    <option value="cosine">Cosine (&lt;=&gt;)</option>
                    <option value="l2">L2 / Euclidean (&lt;-&gt;)</option>
                    <option value="ip">Inner Product (&lt;#&gt;)</option>
                    <option value="l1">L1 / Manhattan (&lt;+&gt;)</option>
                    <option value="hamming">Hamming (&lt;~&gt; bit)</option>
                    <option value="jaccard">Jaccard (&lt;%&gt; bit)</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">Quantization</span>
                  <select
                    value={quantization}
                    onChange={(e) => setQuantization(e.target.value as any)}
                    className="w-full h-8 px-2.5 rounded bg-[#1d1f27] border border-[#2f323e] text-zinc-100"
                  >
                    <option value="none">None (native column type)</option>
                    <option value="halfvec">Scalar Halfvec (col::halfvec(dims))</option>
                    <option value="binary">Binary Quantize (binary_quantize(col)::bit(dims))</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">Operator Class</span>
                  <input
                    type="text"
                    value={opclass}
                    onChange={(e) => setOpclass(e.target.value)}
                    className="w-full h-8 px-2.5 rounded bg-[#1d1f27] border border-[#2f323e] font-mono text-cyan-300"
                  />
                </label>
              </div>

              {method === 'hnsw' ? (
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400">HNSW m (max connections/layer)</span>
                    <input
                      type="number"
                      min={2}
                      max={100}
                      value={withM}
                      onChange={(e) => setWithM(e.target.value)}
                      className="w-full h-8 px-2.5 rounded bg-[#1d1f27] border border-[#2f323e] font-mono text-zinc-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-400">HNSW ef_construction</span>
                    <input
                      type="number"
                      min={4}
                      max={1000}
                      value={withEfConstruction}
                      onChange={(e) => setWithEfConstruction(e.target.value)}
                      className="w-full h-8 px-2.5 rounded bg-[#1d1f27] border border-[#2f323e] font-mono text-zinc-100"
                    />
                  </label>
                </div>
              ) : (
                <label className="block space-y-1 text-xs">
                  <span className="text-[11px] text-zinc-400">IVFFlat lists (recommended: {recommendedLists})</span>
                  <input
                    type="number"
                    min={1}
                    value={withLists}
                    onChange={(e) => setWithLists(e.target.value)}
                    className="w-full h-8 px-2.5 rounded bg-[#1d1f27] border border-[#2f323e] font-mono text-zinc-100"
                  />
                </label>
              )}

              <label className="block space-y-1 text-xs">
                <span className="text-[11px] text-zinc-400">Partial Index WHERE Predicate (optional)</span>
                <input
                  type="text"
                  value={whereClause}
                  onChange={(e) => setWhereClause(e.target.value)}
                  placeholder="e.g. tenant_id = 42 AND deleted_at IS NULL"
                  className="w-full h-8 px-2.5 rounded bg-[#1d1f27] border border-[#2f323e] font-mono text-zinc-100"
                />
              </label>

              <label className="inline-flex items-center gap-2 text-xs text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={concurrently}
                  onChange={(e) => setConcurrently(e.target.checked)}
                  className="rounded border-[#2f323e] bg-[#1d1f27] accent-emerald-500"
                />
                <span>CREATE INDEX CONCURRENTLY (non-blocking, cannot run inside transaction)</span>
              </label>

              {/* SQL Preview */}
              <div className="space-y-1">
                <div className="text-[11px] text-zinc-400">Generated DDL Preview</div>
                <pre className="text-[11px] font-mono text-emerald-300 bg-[#0f1014] rounded-lg p-3 border border-[#262832] overflow-x-auto whitespace-pre-wrap">
                  {generatedSql}
                </pre>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                {onOpenInConsole && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenInConsole(generatedSql);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#232630] hover:bg-[#2c303d] border border-[#343846] text-xs text-zinc-200 cursor-pointer"
                  >
                    <Terminal className="h-3.5 w-3.5" />
                    <span>Open in Console</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyAction !== null || exceedsDimsLimit}
                  onClick={() => execSql(generatedSql, 'Create Vector Index', 'existing')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-medium text-white cursor-pointer"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>{busyAction === 'Create Vector Index' ? 'Creating...' : 'Create Index Now'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
