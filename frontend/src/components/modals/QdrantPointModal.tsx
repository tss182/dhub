import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Sparkles, Loader2, RefreshCw } from 'lucide-react';
import { ColumnMeta } from '../../types/domain';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess } from '../../stores/useAlertStore';
import { isVectorColumn } from '../grid/gridFormatters';

interface QdrantPointModalProps {
  isOpen: boolean;
  mode: 'insert' | 'edit';
  connectionId: string;
  database: string;
  schema: string;
  collectionName: string;
  columns: ColumnMeta[];
  initialRow?: any[];
  onClose: () => void;
  onSaved: () => void;
}

const EMBEDDING_CFG_KEY = 'dhub_vector_embedding_cfg';

function parseMaybeJson(val: any): any {
  if (typeof val !== 'string') return val;
  const t = val.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      return JSON.parse(t);
    } catch {}
  }
  return val;
}

function parsePointIdValue(raw: string): string | number {
  const trimmed = raw.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isSafeInteger(n)) return n;
  }
  return trimmed;
}

export const QdrantPointModal: React.FC<QdrantPointModalProps> = ({
  isOpen,
  mode,
  connectionId,
  database,
  schema,
  collectionName,
  columns,
  initialRow,
  onClose,
  onSaved,
}) => {
  const vectorCols = useMemo(
    () => columns.filter((c) => isVectorColumn(c.dataType, c.rawType)),
    [columns]
  );

  const [pointId, setPointId] = useState('');
  const [vectorInputs, setVectorInputs] = useState<Record<string, string>>({});
  const [payloadJson, setPayloadJson] = useState('{}');
  const [embedTargetCol, setEmbedTargetCol] = useState('');
  const [embedText, setEmbedText] = useState('');
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setEmbedText('');

    const initVecs: Record<string, string> = {};
    const vecNames = vectorCols.length > 0 ? vectorCols.map((c) => c.name) : ['vector'];
    setEmbedTargetCol(vecNames[0] || 'vector');

    if (mode === 'edit' && initialRow) {
      const idIdx = columns.findIndex((c) => c.name === 'id');
      setPointId(idIdx >= 0 && initialRow[idIdx] != null ? String(initialRow[idIdx]) : '');

      const payloadObj: Record<string, any> = {};
      columns.forEach((c, idx) => {
        if (c.name === 'id' || c.name === 'score') return;
        const val = initialRow[idx];
        if (isVectorColumn(c.dataType, c.rawType) || c.name === 'vector' || c.name.startsWith('vector.')) {
          if (val !== null && val !== undefined) {
            initVecs[c.name] = typeof val === 'string' ? val : JSON.stringify(val);
          } else {
            initVecs[c.name] = '';
          }
        } else if (val !== undefined && val !== null) {
          payloadObj[c.name] = parseMaybeJson(val);
        }
      });
      setVectorInputs(initVecs);
      setPayloadJson(JSON.stringify(payloadObj, null, 2));
    } else {
      const uuid =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : String(Date.now());
      setPointId(uuid);
      for (const vn of vecNames) {
        initVecs[vn] = '';
      }
      setVectorInputs(initVecs);

      const templatePayload: Record<string, any> = {};
      columns.forEach((c) => {
        if (c.name === 'id' || c.name === 'score' || isVectorColumn(c.dataType, c.rawType) || c.name === 'vector' || c.name.startsWith('vector.')) {
          return;
        }
        templatePayload[c.name] = null;
      });
      setPayloadJson(JSON.stringify(templatePayload, null, 2));
    }
  }, [isOpen, mode, initialRow, columns, vectorCols]);

  if (!isOpen) return null;

  const handleGenerateEmbedding = async () => {
    if (!embedText.trim()) {
      setError('Enter text to generate an embedding.');
      return;
    }
    setError(null);
    setIsEmbedding(true);
    try {
      const rawCfg = localStorage.getItem(EMBEDDING_CFG_KEY);
      const cfg = rawCfg ? JSON.parse(rawCfg) : {};
      const provider = cfg.provider === 'gemini' ? 'gemini' : 'openai';
      const endpoint = cfg.endpoint || 'https://api.openai.com/v1/embeddings';
      const model = cfg.model || (provider === 'gemini' ? 'gemini-embedding-001' : 'text-embedding-3-small');
      const apiKey = cfg.apiKey || '';

      let vec: number[];
      if (provider === 'gemini') {
        const base = endpoint.replace(/\/+$/, '');
        const url = base.includes(':embedContent') ? base : `${base}/models/${encodeURIComponent(model)}:embedContent`;
        const finalUrl = apiKey ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}` : url;
        const res = await fetch(finalUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text: embedText.trim() }] } }),
        });
        if (!res.ok) throw new Error(`Gemini error (${res.status}): ${await res.text()}`);
        const data = await res.json();
        vec = data?.embedding?.values;
      } else {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, input: embedText.trim() }),
        });
        if (!res.ok) throw new Error(`Embedding error (${res.status}): ${await res.text()}`);
        const data = await res.json();
        vec = data?.data?.[0]?.embedding;
      }

      if (!Array.isArray(vec)) throw new Error('Unexpected embedding response format');
      setVectorInputs((prev) => ({ ...prev, [embedTargetCol || 'vector']: JSON.stringify(vec) }));
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setIsEmbedding(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!pointId.trim()) {
      setError('Point ID is required.');
      return;
    }

    let parsedPayload: Record<string, any> = {};
    try {
      const p = JSON.parse(payloadJson.trim() || '{}');
      if (typeof p !== 'object' || p === null || Array.isArray(p)) {
        setError('Payload must be a valid JSON object.');
        return;
      }
      parsedPayload = p;
    } catch (err: any) {
      setError(`Invalid Payload JSON: ${err?.message || err}`);
      return;
    }

    const parsedVectors: Record<string, any> = {};
    let hasSingleVector = false;
    let singleVectorVal: any = null;

    for (const [k, rawStr] of Object.entries(vectorInputs)) {
      const trimmed = rawStr.trim();
      if (!trimmed) continue;
      try {
        const val = JSON.parse(trimmed);
        if (k === 'vector') {
          hasSingleVector = true;
          singleVectorVal = val;
        } else if (k.startsWith('vector.')) {
          parsedVectors[k.slice('vector.'.length)] = val;
        } else {
          parsedVectors[k] = val;
        }
      } catch {
        setError(`Invalid JSON for vector "${k}". Expected array or sparse object.`);
        return;
      }
    }

    const collEsc = encodeURIComponent(collectionName);
    const idVal = parsePointIdValue(pointId);
    setIsSaving(true);
    try {
      if (mode === 'insert') {
        const pt: Record<string, any> = {
          id: idVal,
          payload: parsedPayload,
          vector: hasSingleVector ? singleVectorVal : Object.keys(parsedVectors).length > 0 ? parsedVectors : {},
        };
        const cmd = `PUT /collections/${collEsc}/points?wait=true\n${JSON.stringify({ points: [pt] })}`;
        const res = await QueryService.ExecuteQuery({
          connectionId,
          database,
          schema,
          sql: cmd,
          executionId: `qdrant-pt-ins-${Date.now()}`,
          limit: 1,
          offset: 0,
        });
        if (res?.error) throw new Error(res.error);
        alertSuccess(`Point "${pointId}" inserted into ${collectionName}.`, 'Point Added');
      } else {
        // Overwrite full payload (handles schemaless key additions AND deletions cleanly)
        const payloadCmd = `PUT /collections/${collEsc}/points/payload?wait=true\n${JSON.stringify({
          payload: parsedPayload,
          points: [idVal],
        })}`;
        const pRes = await QueryService.ExecuteQuery({
          connectionId,
          database,
          schema,
          sql: payloadCmd,
          executionId: `qdrant-pt-pay-${Date.now()}`,
          limit: 1,
          offset: 0,
        });
        if (pRes?.error) throw new Error(pRes.error);

        if (hasSingleVector || Object.keys(parsedVectors).length > 0) {
          const vecCmd = `PUT /collections/${collEsc}/points/vectors?wait=true\n${JSON.stringify({
            points: [{ id: idVal, vector: hasSingleVector ? singleVectorVal : parsedVectors }],
          })}`;
          const vRes = await QueryService.ExecuteQuery({
            connectionId,
            database,
            schema,
            sql: vecCmd,
            executionId: `qdrant-pt-vec-${Date.now()}`,
            limit: 1,
            offset: 0,
          });
          if (vRes?.error) throw new Error(vRes.error);
        }
        alertSuccess(`Point "${pointId}" updated.`, 'Point Updated');
      }
      onSaved();
      onClose();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setError(msg);
      alertError(msg, 'Qdrant Point Save Failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d] shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <Plus className="h-3.5 w-3.5" />
            </span>
            <span className="font-semibold text-zinc-100 text-sm">
              {mode === 'insert' ? `Add Point to ${collectionName}` : `Edit Point in ${collectionName}`}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Point ID */}
          <div>
            <label className="block text-[11px] font-medium text-zinc-300 mb-1">
              Point ID <span className="text-zinc-500 text-[10px]">(UUID or integer)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={pointId}
                disabled={mode === 'edit'}
                onChange={(e) => setPointId(e.target.value)}
                className="flex-1 rounded-lg border border-[#2f3240] bg-[#121318] px-3 py-1.5 font-mono text-zinc-100 disabled:opacity-60 focus:border-blue-500 focus:outline-none"
              />
              {mode === 'insert' && (
                <button
                  type="button"
                  onClick={() =>
                    setPointId(
                      typeof crypto !== 'undefined' && crypto.randomUUID
                        ? crypto.randomUUID()
                        : String(Date.now())
                    )
                  }
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#232632] hover:bg-[#2d3140] border border-[#343848] text-zinc-200 cursor-pointer"
                  title="Generate UUID"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>UUID</span>
                </button>
              )}
            </div>
          </div>

          {/* Vectors */}
          <div className="space-y-2.5 border-t border-[#272934] pt-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-zinc-200">Vectors</label>
              <span className="text-[10px] text-zinc-500">
                Dense: [0.1, 0.2, ...] | Sparse: {"{\"indices\":[...],\"values\":[...]}"}
              </span>
            </div>

            {/* Text-to-Embed Helper */}
            <div className="flex items-center gap-2 p-2 rounded-lg bg-[#14151b] border border-[#272932]">
              <Sparkles className="h-3.5 w-3.5 text-violet-400 shrink-0" />
              <input
                type="text"
                placeholder="Type text to auto-embed into vector..."
                value={embedText}
                onChange={(e) => setEmbedText(e.target.value)}
                className="flex-1 bg-transparent text-[11px] text-zinc-200 focus:outline-none"
              />
              {Object.keys(vectorInputs).length > 1 && (
                <select
                  value={embedTargetCol}
                  onChange={(e) => setEmbedTargetCol(e.target.value)}
                  className="rounded bg-[#101115] border border-[#272932] px-1.5 py-1 text-[10px] text-zinc-300 font-mono"
                >
                  {Object.keys(vectorInputs).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={isEmbedding}
                onClick={handleGenerateEmbedding}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-violet-600/25 hover:bg-violet-600/40 border border-violet-500/40 text-violet-200 text-[11px] font-medium cursor-pointer"
              >
                {isEmbedding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                <span>Embed</span>
              </button>
            </div>

            {Object.entries(vectorInputs).map(([vecCol, val]) => (
              <div key={vecCol}>
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">{vecCol}</label>
                <textarea
                  rows={2}
                  value={val}
                  onChange={(e) => setVectorInputs((prev) => ({ ...prev, [vecCol]: e.target.value }))}
                  placeholder="[0.012, -0.045, ...]"
                  className="w-full rounded-lg border border-[#2f3240] bg-[#121318] px-3 py-1.5 font-mono text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
                />
              </div>
            ))}
          </div>

          {/* Schemaless JSON Payload */}
          <div className="border-t border-[#272934] pt-3">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-semibold text-zinc-200">
                Payload JSON <span className="text-zinc-500 font-normal">(schemaless — add or remove any keys)</span>
              </label>
            </div>
            <textarea
              rows={7}
              value={payloadJson}
              onChange={(e) => setPayloadJson(e.target.value)}
              className="w-full rounded-lg border border-[#2f3240] bg-[#121318] px-3 py-2 font-mono text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-rose-950/30 border border-rose-500/40 px-3 py-2 text-[11px] text-rose-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#272934]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-[#23252f] hover:bg-[#2d303d] text-zinc-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium cursor-pointer"
            >
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{mode === 'insert' ? 'Insert Point' : 'Save Point'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
