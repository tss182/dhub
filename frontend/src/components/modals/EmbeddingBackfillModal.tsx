import React, { useRef, useState } from 'react';
import * as QueryService from '../../../bindings/dhub/internal/services/queryservice';
import { X, Sparkles, Play, Square, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ColumnMeta } from '../../types/domain';
import { detectPgVectorColumnKind } from '../../utils/pgvector';
import { alertError, alertSuccess } from '../../stores/useAlertStore';

export interface EmbeddingConfigLike {
  provider: 'openai' | 'gemini' | 'ollama';
  endpoint: string;
  model: string;
  apiKey: string;
  dimensions?: number;
}

export interface EmbeddingBackfillModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  schema: string;
  tableName: string;
  columns: ColumnMeta[];
  primaryKeys: string[];
  embedCfg: EmbeddingConfigLike;
  onCompleted?: () => void;
}

function qIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function formatPkLiteral(val: any): string {
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function fetchSingleEmbedding(text: string, cfg: EmbeddingConfigLike): Promise<number[]> {
  const endpoint = cfg.endpoint.trim();
  if (!endpoint) throw new Error('Embedding endpoint URL is required.');
  const dims = cfg.dimensions && cfg.dimensions > 0 ? Math.floor(cfg.dimensions) : undefined;

  if (cfg.provider === 'gemini') {
    const modelName = cfg.model.trim() || 'gemini-embedding-001';
    const base = endpoint.replace(/\/+$/, '');
    const url = base.includes(':embedContent')
      ? base
      : `${base}/models/${encodeURIComponent(modelName)}:embedContent`;
    const finalUrl = cfg.apiKey.trim()
      ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(cfg.apiKey.trim())}`
      : url;
    const body: Record<string, any> = {
      model: `models/${modelName}`,
      content: { parts: [{ text }] },
    };
    if (dims) body.outputDimensionality = dims;
    const res = await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Gemini error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    const vec = data?.embedding?.values;
    if (!Array.isArray(vec)) throw new Error('Unexpected Gemini response format.');
    return vec;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey.trim()) headers['Authorization'] = `Bearer ${cfg.apiKey.trim()}`;

  if (cfg.provider === 'ollama' || endpoint.includes('/api/embed')) {
    const body: Record<string, any> = {
      model: cfg.model.trim() || 'nomic-embed-text',
      input: text,
    };
    if (dims) body.dimensions = dims;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Ollama error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    const vec = data?.embeddings?.[0] || data?.embedding || data?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) throw new Error('Unexpected Ollama embedding response format.');
    return vec;
  }

  const body: Record<string, any> = {
    model: cfg.model.trim() || 'text-embedding-3-small',
    input: text,
  };
  if (dims) body.dimensions = dims;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Embedding API error (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('Unexpected OpenAI embedding response format.');
  return vec;
}

export const EmbeddingBackfillModal: React.FC<EmbeddingBackfillModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  schema,
  tableName,
  columns,
  primaryKeys,
  embedCfg,
  onCompleted,
}) => {
  const vectorCols = columns.filter((c) => {
    const k = detectPgVectorColumnKind(c.dataType, c.rawType).kind;
    return k === 'vector' || k === 'halfvec';
  });
  const textCols = columns.filter((c) => {
    const dt = (c.dataType || c.rawType || '').toLowerCase();
    return dt.includes('text') || dt.includes('char');
  });

  const [targetCol, setTargetCol] = useState<string>(vectorCols[0]?.name || '');
  const [selectedSourceCols, setSelectedSourceCols] = useState<string[]>(() =>
    textCols.slice(0, 2).map((c) => c.name)
  );
  const [batchSize, setBatchSize] = useState<number>(20);
  const [whereFilter, setWhereFilter] = useState<string>(() =>
    vectorCols[0]?.name ? `${qIdent(vectorCols[0].name)} IS NULL` : ''
  );
  const [running, setRunning] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const cancelRef = useRef(false);

  if (!isOpen) return null;

  const pkCol = primaryKeys[0] || columns[0]?.name || 'id';
  const effectiveTarget = targetCol || vectorCols[0]?.name || '';
  const targetMeta = vectorCols.find((c) => c.name === effectiveTarget);
  const targetKind = detectPgVectorColumnKind(targetMeta?.dataType, targetMeta?.rawType).kind || 'vector';

  const toggleSourceCol = (colName: string) => {
    setSelectedSourceCols((prev) =>
      prev.includes(colName) ? prev.filter((c) => c !== colName) : [...prev, colName]
    );
  };

  const handleStart = async () => {
    if (!effectiveTarget) {
      alertError('Backfill Embeddings', 'Select a target vector/halfvec column.');
      return;
    }
    if (selectedSourceCols.length === 0) {
      alertError('Backfill Embeddings', 'Select at least one source text column.');
      return;
    }

    cancelRef.current = false;
    setRunning(true);
    setProcessed(0);
    setFailedCount(0);
    setStatusMsg('Starting backfill...');

    const tblRef = schema ? `${qIdent(schema)}.${qIdent(tableName)}` : qIdent(tableName);
    const srcExpr = selectedSourceCols
      .map((c) => `COALESCE(${qIdent(c)}::text, '')`)
      .join(` || ' ' || `);
    const whereClause = whereFilter.trim() ? `WHERE ${whereFilter.trim()}` : '';

    let totalDone = 0;
    let totalErr = 0;
    let offset = 0;

    try {
      while (!cancelRef.current) {
        const useOffset = whereFilter.trim().toUpperCase().includes('IS NULL') ? 0 : offset;
        const fetchSql = `SELECT ${qIdent(pkCol)} AS __pk, (${srcExpr}) AS __src FROM ${tblRef} ${whereClause} ORDER BY ${qIdent(pkCol)} LIMIT ${Math.max(1, batchSize)} OFFSET ${useOffset};`;
        const res: any = await QueryService.ExecuteQuery({
          executionId: `pgvec-bf-sel-${Date.now()}`,
          connectionId,
          database: database || 'postgres',
          schema: schema || 'public',
          sql: fetchSql,
          limit: batchSize,
          offset: 0,
        } as any);

        if (res?.error) {
          throw new Error(res.error);
        }
        const rows: any[][] = res?.rows || [];
        if (rows.length === 0) {
          setStatusMsg(`Completed! Backfilled ${totalDone} row(s).`);
          break;
        }

        const updateStmts: string[] = [];
        for (const r of rows) {
          if (cancelRef.current) break;
          const pkVal = r[0];
          const srcText = String(r[1] ?? '').trim();
          if (!srcText) {
            totalErr++;
            setFailedCount(totalErr);
            continue;
          }
          try {
            const vec = await fetchSingleEmbedding(srcText, embedCfg);
            updateStmts.push(
              `UPDATE ${tblRef} SET ${qIdent(effectiveTarget)} = '${JSON.stringify(vec)}'::${targetKind} WHERE ${qIdent(pkCol)} = ${formatPkLiteral(pkVal)};`
            );
          } catch {
            totalErr++;
            setFailedCount(totalErr);
          }
        }

        if (updateStmts.length > 0 && !cancelRef.current) {
          const updRes: any = await QueryService.ExecuteQuery({
            executionId: `pgvec-bf-upd-${Date.now()}`,
            connectionId,
            database: database || 'postgres',
            schema: schema || 'public',
            sql: updateStmts.join('\n'),
            limit: 10,
            offset: 0,
          } as any);
          if (updRes?.error) {
            throw new Error(updRes.error);
          }
          totalDone += updateStmts.length;
          setProcessed(totalDone);
          setStatusMsg(`Backfilled ${totalDone} row(s)...`);
        }

        offset += rows.length;
        if (rows.length < batchSize) {
          setStatusMsg(`Completed! Backfilled ${totalDone} row(s).`);
          break;
        }
      }

      if (cancelRef.current) {
        setStatusMsg(`Cancelled after ${totalDone} row(s).`);
      } else if (totalDone > 0) {
        alertSuccess('Backfill Embeddings', `Successfully backfilled ${totalDone} row(s).`);
        onCompleted?.();
      }
    } catch (err: any) {
      alertError('Backfill Embeddings', err?.message || String(err));
      setStatusMsg(`Stopped: ${err?.message || String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4">
      <div className="w-full max-w-xl rounded-xl border border-[#2b2d36] bg-[#14151a] text-[#dfe1e5] shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#252730] bg-[#181920]">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-white">Batch Backfill Null Embeddings</h3>
          </div>
          <button
            type="button"
            disabled={running}
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#23252e] disabled:opacity-40 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs">
          <div className="rounded bg-[#1a1c23] border border-[#282a34] p-2.5 text-[11px] text-zinc-300">
            Provider: <strong className="text-white">{embedCfg.provider}</strong> • Model:{' '}
            <code className="text-cyan-300">{embedCfg.model}</code>
            {embedCfg.dimensions ? ` • Matryoshka dims: ${embedCfg.dimensions}` : ''}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[11px] text-zinc-400">Target Vector Column</span>
              <select
                value={effectiveTarget}
                onChange={(e) => {
                  setTargetCol(e.target.value);
                  setWhereFilter(`${qIdent(e.target.value)} IS NULL`);
                }}
                disabled={running}
                className="w-full h-8 px-2 rounded bg-[#1d1f27] border border-[#2f323e] font-mono text-zinc-100"
              >
                {vectorCols.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.dataType})
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-zinc-400">Batch Size</span>
              <input
                type="number"
                min={1}
                max={200}
                value={batchSize}
                disabled={running}
                onChange={(e) => setBatchSize(Math.max(1, Number(e.target.value) || 20))}
                className="w-full h-8 px-2 rounded bg-[#1d1f27] border border-[#2f323e] font-mono text-zinc-100"
              />
            </label>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] text-zinc-400">Source Text Column(s) (concatenated)</span>
            <div className="flex flex-wrap gap-1.5">
              {textCols.map((c) => {
                const active = selectedSourceCols.includes(c.name);
                return (
                  <button
                    key={c.name}
                    type="button"
                    disabled={running}
                    onClick={() => toggleSourceCol(c.name)}
                    className={`px-2 py-1 rounded text-[11px] font-mono border cursor-pointer ${
                      active
                        ? 'bg-violet-600/25 border-violet-500/50 text-violet-200'
                        : 'bg-[#1d1f27] border-[#2f323e] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-400">Filter (WHERE)</span>
            <input
              type="text"
              value={whereFilter}
              disabled={running}
              onChange={(e) => setWhereFilter(e.target.value)}
              className="w-full h-8 px-2.5 rounded bg-[#1d1f27] border border-[#2f323e] font-mono text-zinc-100"
            />
          </label>

          {statusMsg && (
            <div className="rounded bg-[#101115] border border-[#272932] p-2.5 flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-zinc-200">
                {running ? (
                  <Sparkles className="h-3.5 w-3.5 text-violet-400 animate-pulse" />
                ) : failedCount > 0 ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                )}
                <span>{statusMsg}</span>
              </span>
              <span className="font-mono text-zinc-400">
                done: {processed} {failedCount > 0 ? `• skipped/err: ${failedCount}` : ''}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#252730] bg-[#16171d]">
          {running ? (
            <button
              type="button"
              onClick={() => {
                cancelRef.current = true;
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-xs font-medium text-white cursor-pointer"
            >
              <Square className="h-3 w-3" />
              <span>Cancel</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStart}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white cursor-pointer"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Start Backfill</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
