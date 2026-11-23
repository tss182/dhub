import React, { useEffect, useState } from 'react';
import { X, Layers, Trash2, Edit3, Loader2, Eye } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';

interface ElasticsearchBatchOpsModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  indexName: string;
  onSuccess?: () => void;
}

export const ElasticsearchBatchOpsModal: React.FC<ElasticsearchBatchOpsModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  indexName,
  onSuccess,
}) => {
  const [opMode, setOpMode] = useState<'update_by_query' | 'delete_by_query'>('update_by_query');
  const [updateAction, setUpdateAction] = useState<'set' | 'remove' | 'rename' | 'custom'>('set');
  const [queryJson, setQueryJson] = useState('{\n  "term": {\n    "status": "archived"\n  }\n}');

  const [fieldName, setFieldName] = useState('archived');
  const [fieldValue, setFieldValue] = useState('true');
  const [renameTo, setRenameTo] = useState('');
  const [customScript, setCustomScript] = useState('ctx._source.updated_at = "2026-11-23";');

  const [conflictsProceed, setConflictsProceed] = useState(true);
  const [refreshAfter, setRefreshAfter] = useState(true);

  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [isCounting, setIsCounting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setOpMode('update_by_query');
      setUpdateAction('set');
      setQueryJson('{\n  "term": {\n    "status": "archived"\n  }\n}');
      setFieldName('archived');
      setFieldValue('true');
      setRenameTo('');
      setCustomScript('ctx._source.updated_at = "2026-11-23";');
      setConflictsProceed(true);
      setRefreshAfter(true);
      setPreviewCount(null);
      setError(null);
    }
  }, [isOpen, indexName]);

  if (!isOpen) return null;

  const parseQuery = (): Record<string, any> => {
    const trimmed = queryJson.trim();
    if (!trimmed) return { match_all: {} };
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Query must be a JSON object.');
    }
    return parsed;
  };

  const parseTypedScalar = (raw: string): any => {
    const t = raw.trim();
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try {
        return JSON.parse(t);
      } catch {}
    }
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return t.slice(1, -1);
    }
    return t;
  };

  const buildRequestBody = (): Record<string, any> => {
    const query = parseQuery();
    if (opMode === 'delete_by_query') {
      return { query };
    }

    let script: Record<string, any>;
    if (updateAction === 'set') {
      if (!fieldName.trim()) throw new Error('Target field name is required.');
      script = {
        source: 'ctx._source[params.f] = params.v',
        lang: 'painless',
        params: { f: fieldName.trim(), v: parseTypedScalar(fieldValue) },
      };
    } else if (updateAction === 'remove') {
      if (!fieldName.trim()) throw new Error('Field name to remove is required.');
      script = {
        source: 'ctx._source.remove(params.f)',
        lang: 'painless',
        params: { f: fieldName.trim() },
      };
    } else if (updateAction === 'rename') {
      if (!fieldName.trim() || !renameTo.trim()) throw new Error('Source and target field names are required.');
      script = {
        source:
          'if (ctx._source.containsKey(params.old)) { ctx._source[params.new] = ctx._source.remove(params.old); }',
        lang: 'painless',
        params: { old: fieldName.trim(), new: renameTo.trim() },
      };
    } else {
      if (!customScript.trim()) throw new Error('Painless script source is required.');
      script = {
        source: customScript.trim(),
        lang: 'painless',
      };
    }

    return { query, script };
  };

  const handlePreviewCount = async () => {
    setError(null);
    setPreviewCount(null);
    let queryObj: Record<string, any>;
    try {
      queryObj = parseQuery();
    } catch (err: any) {
      setError(`Invalid Query JSON: ${err?.message || err}`);
      return;
    }

    setIsCounting(true);
    try {
      const cmd = `POST /${encodeURIComponent(indexName)}/_count\n${JSON.stringify({ query: queryObj })}`;
      const res = await QueryService.ExecuteQuery({
        executionId: `es-batch-cnt-${Date.now()}`,
        connectionId,
        database: 'default',
        schema: 'default',
        sql: cmd,
        limit: 1,
        offset: 0,
      } as any);
      if (res?.error) throw new Error(res.error);
      const raw = res?.rows?.[0]?.[0];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      setPreviewCount(Number(parsed?.count ?? 0));
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setIsCounting(false);
    }
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let body: Record<string, any>;
    try {
      body = buildRequestBody();
    } catch (err: any) {
      setError(err?.message || String(err));
      return;
    }

    const idxEsc = encodeURIComponent(indexName);
    const qsParams: string[] = [];
    if (conflictsProceed) qsParams.push('conflicts=proceed');
    if (refreshAfter) qsParams.push('refresh=true');
    const qs = qsParams.length > 0 ? `?${qsParams.join('&')}` : '';

    if (opMode === 'delete_by_query') {
      const ok = await confirmDialog({
        title: 'Delete Documents by Query',
        message: `Permanently delete matching documents${
          previewCount !== null ? ` (~${previewCount.toLocaleString()} docs)` : ''
        } in index "${indexName}"?`,
        confirmLabel: 'Delete Matching Docs',
        isDanger: true,
      });
      if (!ok) return;
    }

    const endpoint = opMode === 'delete_by_query' ? '_delete_by_query' : '_update_by_query';
    const cmd = `POST /${idxEsc}/${endpoint}${qs}\n${JSON.stringify(body)}`;

    setIsExecuting(true);
    try {
      const res = await QueryService.ExecuteQuery({
        executionId: `es-batch-exec-${Date.now()}`,
        connectionId,
        database: 'default',
        schema: 'default',
        sql: cmd,
        limit: 10,
        offset: 0,
      } as any);
      if (res?.error) throw new Error(res.error);
      const raw = res?.rows?.[0]?.[0];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const updated = Number(parsed?.updated ?? 0);
      const deleted = Number(parsed?.deleted ?? 0);
      const failures = Array.isArray(parsed?.failures) ? parsed.failures : [];
      if (failures.length > 0) {
        throw new Error(`Completed with ${failures.length} failure(s): ${JSON.stringify(failures[0])}`);
      }
      alertSuccess(
        opMode === 'delete_by_query'
          ? `Deleted ${deleted.toLocaleString()} document(s) in "${indexName}".`
          : `Updated ${updated.toLocaleString()} document(s) in "${indexName}".`,
        'Batch Operation Completed'
      );
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setIsExecuting(false);
    }
  };

  let previewRest = '';
  try {
    const qsParams: string[] = [];
    if (conflictsProceed) qsParams.push('conflicts=proceed');
    if (refreshAfter) qsParams.push('refresh=true');
    const qs = qsParams.length > 0 ? `?${qsParams.join('&')}` : '';
    const ep = opMode === 'delete_by_query' ? '_delete_by_query' : '_update_by_query';
    previewRest = `POST /${encodeURIComponent(indexName)}/${ep}${qs}\n${JSON.stringify(buildRequestBody(), null, 2)}`;
  } catch (err: any) {
    previewRest = `// ${err?.message || 'Invalid input'}`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden text-xs">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d] shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-amber-400" />
            <span className="font-semibold text-sm text-zinc-100">
              Batch Operations: <code className="text-amber-300 font-mono">{indexName}</code>
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded text-zinc-400 hover:text-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleExecute} className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Operation Type */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpMode('update_by_query')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                opMode === 'update_by_query'
                  ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                  : 'bg-[#14151b] border-[#272934] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span>Update by Query (_update_by_query)</span>
            </button>
            <button
              type="button"
              onClick={() => setOpMode('delete_by_query')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                opMode === 'delete_by_query'
                  ? 'bg-rose-600/20 border-rose-500 text-rose-200'
                  : 'bg-[#14151b] border-[#272934] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete by Query (_delete_by_query)</span>
            </button>
          </div>

          {/* Query DSL Filter */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-zinc-400">
                Target Query DSL (empty defaults to <code>{"{\"match_all\": {}}"}</code>)
              </label>
              <button
                type="button"
                disabled={isCounting}
                onClick={handlePreviewCount}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#242733] hover:bg-[#2e3242] text-zinc-200 border border-[#343848] text-[10px] cursor-pointer"
              >
                {isCounting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3 text-cyan-400" />}
                <span>Preview Matched Docs (_count)</span>
              </button>
            </div>
            <textarea
              rows={5}
              value={queryJson}
              onChange={(e) => setQueryJson(e.target.value)}
              spellCheck={false}
              className="w-full rounded bg-[#121317] border border-[#272932] p-2 font-mono text-[11px] text-zinc-200 focus:border-amber-500 focus:outline-none"
            />
            {previewCount !== null && (
              <div className="mt-1 text-[11px] text-cyan-300 font-mono">
                Matched documents: <strong>{previewCount.toLocaleString()}</strong>
              </div>
            )}
          </div>

          {/* Update Script Builder */}
          {opMode === 'update_by_query' && (
            <div className="rounded-lg border border-[#272934] bg-[#14151b] p-3 space-y-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'set', label: 'Set Field Value' },
                    { id: 'remove', label: 'Remove Field' },
                    { id: 'rename', label: 'Rename Field' },
                    { id: 'custom', label: 'Custom Painless Script' },
                  ] as const
                ).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setUpdateAction(a.id)}
                    className={`px-2.5 py-1 rounded text-[11px] cursor-pointer border ${
                      updateAction === a.id
                        ? 'bg-amber-600/20 border-amber-500/50 text-amber-200 font-medium'
                        : 'bg-[#101116] border-[#272932] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              {updateAction === 'set' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">Field Name</label>
                    <input
                      type="text"
                      value={fieldName}
                      onChange={(e) => setFieldName(e.target.value)}
                      placeholder="status"
                      className="w-full rounded bg-[#101116] border border-[#272932] px-2 py-1.5 font-mono text-zinc-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">New Value (JSON / number / boolean / text)</label>
                    <input
                      type="text"
                      value={fieldValue}
                      onChange={(e) => setFieldValue(e.target.value)}
                      placeholder="true or 42 or active"
                      className="w-full rounded bg-[#101116] border border-[#272932] px-2 py-1.5 font-mono text-zinc-100"
                    />
                  </div>
                </div>
              )}

              {updateAction === 'remove' && (
                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">Field Name to Remove from _source</label>
                  <input
                    type="text"
                    value={fieldName}
                    onChange={(e) => setFieldName(e.target.value)}
                    placeholder="legacy_field"
                    className="w-full rounded bg-[#101116] border border-[#272932] px-2 py-1.5 font-mono text-zinc-100"
                  />
                </div>
              )}

              {updateAction === 'rename' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">Current Field Name</label>
                    <input
                      type="text"
                      value={fieldName}
                      onChange={(e) => setFieldName(e.target.value)}
                      placeholder="old_name"
                      className="w-full rounded bg-[#101116] border border-[#272932] px-2 py-1.5 font-mono text-zinc-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">New Field Name</label>
                    <input
                      type="text"
                      value={renameTo}
                      onChange={(e) => setRenameTo(e.target.value)}
                      placeholder="new_name"
                      className="w-full rounded bg-[#101116] border border-[#272932] px-2 py-1.5 font-mono text-zinc-100"
                    />
                  </div>
                </div>
              )}

              {updateAction === 'custom' && (
                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">Painless Script Source</label>
                  <textarea
                    rows={3}
                    value={customScript}
                    onChange={(e) => setCustomScript(e.target.value)}
                    spellCheck={false}
                    className="w-full rounded bg-[#101116] border border-[#272932] p-2 font-mono text-[11px] text-zinc-100"
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-4 text-[11px] text-zinc-300">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={conflictsProceed}
                onChange={(e) => setConflictsProceed(e.target.checked)}
              />
              <span><code>conflicts=proceed</code></span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={refreshAfter}
                onChange={(e) => setRefreshAfter(e.target.checked)}
              />
              <span><code>refresh=true</code></span>
            </label>
          </div>

          <details className="rounded-lg border border-[#272934] bg-[#121317] p-2">
            <summary className="cursor-pointer text-[11px] text-zinc-400 hover:text-zinc-200">
              REST Request Preview
            </summary>
            <pre className="mt-2 text-[10px] font-mono text-zinc-300 whitespace-pre-wrap break-all">
              {previewRest}
            </pre>
          </details>

          {error && (
            <div className="rounded-lg bg-rose-950/30 border border-rose-500/40 px-3 py-2 text-[11px] text-rose-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2b2e3a]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-[#242733] hover:bg-[#2d3140] text-zinc-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isExecuting}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-white font-medium cursor-pointer disabled:opacity-50 ${
                opMode === 'delete_by_query' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-amber-600 hover:bg-amber-500'
              }`}
            >
              {isExecuting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{opMode === 'delete_by_query' ? 'Execute Delete by Query' : 'Execute Update by Query'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
