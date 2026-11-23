import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Sparkles, Loader2, FileCode, Copy } from 'lucide-react';
import { ColumnMeta } from '../../types/domain';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess } from '../../stores/useAlertStore';
import { isVectorColumn } from '../grid/gridFormatters';

interface ElasticsearchDocumentModalProps {
  isOpen: boolean;
  mode: 'insert' | 'edit' | 'clone';
  connectionId: string;
  database: string;
  schema: string;
  indexName: string;
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

export const ElasticsearchDocumentModal: React.FC<ElasticsearchDocumentModalProps> = ({
  isOpen,
  mode,
  connectionId,
  database,
  schema,
  indexName,
  columns,
  initialRow,
  onClose,
  onSaved,
}) => {
  const vectorCols = useMemo(
    () => columns.filter((c) => isVectorColumn(c.dataType, c.rawType)),
    [columns]
  );

  const [docId, setDocId] = useState('');
  const [routing, setRouting] = useState('');
  const [pipeline, setPipeline] = useState('');
  const [sourceJson, setSourceJson] = useState('{}');
  const [docMeta, setDocMeta] = useState<{ version?: number; seqNo?: number; primaryTerm?: number } | null>(null);

  const [embedTargetCol, setEmbedTargetCol] = useState('');
  const [embedText, setEmbedText] = useState('');
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setEmbedText('');
    setRouting('');
    setPipeline('');
    setDocMeta(null);
    setEmbedTargetCol(vectorCols[0]?.name || '');

    let cancelled = false;
    if ((mode === 'edit' || mode === 'clone') && initialRow) {
      const idIdx = columns.findIndex((c) => c.name === '_id');
      const rawIdStr = idIdx >= 0 && initialRow[idIdx] != null ? String(initialRow[idIdx]) : '';
      setDocId(mode === 'clone' ? `${rawIdStr}_copy` : rawIdStr);

      const initialDoc: Record<string, any> = {};
      columns.forEach((c, idx) => {
        if (c.name === '_id' || c.name === '_score') return;
        const val = initialRow[idx];
        if (val !== undefined && val !== null) {
          initialDoc[c.name] = parseMaybeJson(val);
        }
      });
      setSourceJson(JSON.stringify(initialDoc, null, 2));

      // Fetch full nested _source and metadata from GET /<index>/_doc/<id>
      if (rawIdStr && connectionId && indexName) {
        QueryService.ExecuteQuery({
          connectionId,
          database,
          schema,
          sql: `GET /${encodeURIComponent(indexName)}/_doc/${encodeURIComponent(rawIdStr)}`,
          executionId: `es-doc-get-${Date.now()}`,
          limit: 1,
          offset: 0,
        } as any)
          .then((res) => {
            if (cancelled || res?.error) return;
            const raw = res?.rows?.[0]?.[0];
            if (typeof raw === 'string') {
              try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                  if (parsed._source && typeof parsed._source === 'object') {
                    setSourceJson(JSON.stringify(parsed._source, null, 2));
                  }
                  setDocMeta({
                    version: parsed._version,
                    seqNo: parsed._seq_no,
                    primaryTerm: parsed._primary_term,
                  });
                }
              } catch {}
            }
          })
          .catch(() => {});
      }
      return () => {
        cancelled = true;
      };
    } else {
      setDocId('');
      const templateDoc: Record<string, any> = {};
      columns.forEach((c) => {
        if (c.name === '_id' || c.name === '_score') return;
        templateDoc[c.name] = isVectorColumn(c.dataType, c.rawType) ? [] : null;
      });
      setSourceJson(JSON.stringify(templateDoc, null, 2));
    }
  }, [isOpen, mode, initialRow, columns, vectorCols, connectionId, database, schema, indexName]);

  if (!isOpen) return null;

  const handleGenerateEmbedding = async () => {
    if (!embedText.trim() || !embedTargetCol) {
      setError('Select a vector field and enter text to generate an embedding.');
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
      const currentObj = JSON.parse(sourceJson.trim() || '{}');
      currentObj[embedTargetCol] = vec;
      setSourceJson(JSON.stringify(currentObj, null, 2));
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setIsEmbedding(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let parsedDoc: Record<string, any> = {};
    try {
      const p = JSON.parse(sourceJson.trim() || '{}');
      if (typeof p !== 'object' || p === null || Array.isArray(p)) {
        setError('Document _source must be a valid JSON object.');
        return;
      }
      parsedDoc = p;
    } catch (err: any) {
      setError(`Invalid Document JSON: ${err?.message || err}`);
      return;
    }

    if (mode === 'edit' && !docId.trim()) {
      setError('Document _id is required when editing an existing document.');
      return;
    }

    const idxEsc = encodeURIComponent(indexName);
    const idTrim = docId.trim();
    const queryParams = ['refresh=wait_for'];
    if (routing.trim()) queryParams.push(`routing=${encodeURIComponent(routing.trim())}`);
    if (pipeline.trim()) queryParams.push(`pipeline=${encodeURIComponent(pipeline.trim())}`);
    const qs = queryParams.join('&');

    const cmd = idTrim
      ? `PUT /${idxEsc}/_doc/${encodeURIComponent(idTrim)}?${qs}\n${JSON.stringify(parsedDoc)}`
      : `POST /${idxEsc}/_doc?${qs}\n${JSON.stringify(parsedDoc)}`;

    setIsSaving(true);
    try {
      const res = await QueryService.ExecuteQuery({
        connectionId,
        database,
        schema,
        sql: cmd,
        executionId: `es-doc-save-${Date.now()}`,
        limit: 1,
        offset: 0,
      } as any);
      if (res?.error) throw new Error(res.error);

      alertSuccess(
        mode === 'edit'
          ? `Document "${idTrim}" updated in ${indexName}.`
          : `Document indexed into ${indexName}.`,
        mode === 'edit' ? 'Document Updated' : 'Document Indexed'
      );
      onSaved();
      onClose();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setError(msg);
      alertError(msg, 'Elasticsearch Document Save Failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden text-xs">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d] shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              {mode === 'clone' ? <Copy className="h-3.5 w-3.5" /> : mode === 'edit' ? <FileCode className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            </span>
            <span className="font-semibold text-zinc-100 text-sm">
              {mode === 'insert'
                ? `Add Document to ${indexName}`
                : mode === 'clone'
                ? `Clone Document in ${indexName}`
                : `Edit Document JSON in ${indexName}`}
            </span>
            {docMeta?.version !== undefined && (
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 font-mono text-[10px]">
                v{docMeta.version} • seq #{docMeta.seqNo ?? '-'}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 space-y-3.5">
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-rose-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                Document <code className="text-amber-300">_id</code>{' '}
                {mode !== 'edit' && <span className="text-zinc-500 text-[10px]">(empty = auto)</span>}
              </label>
              <input
                type="text"
                disabled={mode === 'edit'}
                placeholder="Auto-generated if empty"
                value={docId}
                onChange={(e) => setDocId(e.target.value)}
                className="w-full rounded-lg bg-[#121318] border border-[#2d303d] px-2.5 py-1.5 text-zinc-100 font-mono disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                Routing <span className="text-zinc-500 text-[10px]">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="Shard routing key"
                value={routing}
                onChange={(e) => setRouting(e.target.value)}
                className="w-full rounded-lg bg-[#121318] border border-[#2d303d] px-2.5 py-1.5 text-zinc-100 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                Ingest Pipeline <span className="text-zinc-500 text-[10px]">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="Pipeline ID"
                value={pipeline}
                onChange={(e) => setPipeline(e.target.value)}
                className="w-full rounded-lg bg-[#121318] border border-[#2d303d] px-2.5 py-1.5 text-zinc-100 font-mono"
              />
            </div>
          </div>

          {vectorCols.length > 0 && (
            <div className="rounded-lg border border-violet-500/30 bg-violet-950/15 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-violet-300 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Generate Vector Embedding into Document</span>
                </span>
                <select
                  value={embedTargetCol}
                  onChange={(e) => setEmbedTargetCol(e.target.value)}
                  className="rounded bg-[#121318] border border-[#2d303d] px-2 py-0.5 text-[11px] font-mono text-violet-200"
                >
                  {vectorCols.map((vc) => (
                    <option key={vc.name} value={vc.name}>
                      {vc.name} ({vc.dataType})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter text to embed with configured AI provider..."
                  value={embedText}
                  onChange={(e) => setEmbedText(e.target.value)}
                  className="flex-1 rounded bg-[#121318] border border-[#2d303d] px-2.5 py-1 text-zinc-100"
                />
                <button
                  type="button"
                  disabled={isEmbedding}
                  onClick={handleGenerateEmbedding}
                  className="flex items-center gap-1 px-3 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white font-medium cursor-pointer disabled:opacity-50"
                >
                  {isEmbedding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  <span>Embed</span>
                </button>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-zinc-300">
                Document <code className="text-emerald-300">_source</code> (JSON)
              </label>
              <button
                type="button"
                onClick={() => {
                  try {
                    setSourceJson(JSON.stringify(JSON.parse(sourceJson), null, 2));
                    setError(null);
                  } catch (err: any) {
                    setError(`Invalid JSON: ${err?.message || err}`);
                  }
                }}
                className="text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer"
              >
                Format JSON
              </button>
            </div>
            <textarea
              rows={14}
              value={sourceJson}
              onChange={(e) => setSourceJson(e.target.value)}
              className="w-full rounded-lg bg-[#101116] border border-[#2d303d] p-3 font-mono text-xs text-emerald-300 focus:border-blue-500 focus:outline-none leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2b2e3a]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-lg bg-[#252834] hover:bg-[#2f3342] text-zinc-300 font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer disabled:opacity-50"
            >
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{mode === 'edit' ? 'Save Document' : mode === 'clone' ? 'Create Clone' : 'Index Document'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
