import React, { useEffect, useState } from 'react';
import { X, Filter, Trash2, Edit3, Loader2, Eye } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';

interface QdrantBatchOpsModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  collectionName: string;
  onSuccess?: () => void;
}

export const QdrantBatchOpsModal: React.FC<QdrantBatchOpsModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  collectionName,
  onSuccess,
}) => {
  const [opType, setOpType] = useState<'delete_points' | 'set_payload' | 'delete_keys'>('set_payload');
  const [filterJson, setFilterJson] = useState('{\n  "must": [\n    { "key": "status", "match": { "value": "archived" } }\n  ]\n}');
  const [payloadJson, setPayloadJson] = useState('{\n  "archived": true\n}');
  const [keysInput, setKeysInput] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [isCounting, setIsCounting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setOpType('set_payload');
      setFilterJson('{\n  "must": [\n    { "key": "status", "match": { "value": "archived" } }\n  ]\n}');
      setPayloadJson('{\n  "archived": true\n}');
      setKeysInput('');
      setPreviewCount(null);
      setError(null);
    }
  }, [isOpen, collectionName]);

  if (!isOpen) return null;

  const parseFilter = (): Record<string, any> => {
    const trimmed = filterJson.trim();
    if (!trimmed) return {};
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Filter must be a JSON object.');
    }
    return parsed;
  };

  const handleDryRunCount = async () => {
    setError(null);
    setPreviewCount(null);
    let filterObj: Record<string, any>;
    try {
      filterObj = parseFilter();
    } catch (err: any) {
      setError(`Invalid Filter JSON: ${err?.message || err}`);
      return;
    }
    setIsCounting(true);
    try {
      const cmd = `POST /collections/${encodeURIComponent(collectionName)}/points/count\n${JSON.stringify({
        filter: filterObj,
        exact: true,
      })}`;
      const res = await QueryService.ExecuteQuery({
        executionId: `qdrant-batch-cnt-${Date.now()}`,
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
      const cnt = parsed?.result?.count ?? 0;
      setPreviewCount(Number(cnt));
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setIsCounting(false);
    }
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    let filterObj: Record<string, any>;
    try {
      filterObj = parseFilter();
    } catch (err: any) {
      setError(`Invalid Filter JSON: ${err?.message || err}`);
      return;
    }

    const collEsc = encodeURIComponent(collectionName);
    let cmd = '';

    if (opType === 'delete_points') {
      const ok = await confirmDialog({
        title: 'Delete Points by Filter',
        message: `Permanently delete matching points${previewCount !== null ? ` (~${previewCount.toLocaleString()} points)` : ''} in "${collectionName}"?`,
        confirmLabel: 'Delete Points',
        isDanger: true,
      });
      if (!ok) return;
      cmd = `POST /collections/${collEsc}/points/delete?wait=true\n${JSON.stringify({ filter: filterObj })}`;
    } else if (opType === 'set_payload') {
      let payloadObj: Record<string, any>;
      try {
        payloadObj = JSON.parse(payloadJson.trim() || '{}');
        if (typeof payloadObj !== 'object' || payloadObj === null || Array.isArray(payloadObj)) {
          throw new Error('Payload must be a JSON object.');
        }
      } catch (err: any) {
        setError(`Invalid Payload JSON: ${err?.message || err}`);
        return;
      }
      if (Object.keys(filterObj).length === 0) {
        const ok = await confirmDialog({
          title: 'Update Payload on ALL Points',
          message: `The filter is empty ({}). This will set payload on ALL points in "${collectionName}". Continue?`,
          confirmLabel: 'Update All',
          isDanger: true,
        });
        if (!ok) return;
      }
      cmd = `POST /collections/${collEsc}/points/payload?wait=true\n${JSON.stringify({
        payload: payloadObj,
        filter: filterObj,
      })}`;
    } else {
      const keys = keysInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (keys.length === 0) {
        setError('Enter at least one payload key to delete.');
        return;
      }
      if (Object.keys(filterObj).length === 0) {
        const ok = await confirmDialog({
          title: 'Delete Payload Keys on ALL Points',
          message: `The filter is empty ({}). This will delete keys [${keys.join(', ')}] from ALL points in "${collectionName}". Continue?`,
          confirmLabel: 'Delete Keys on All',
          isDanger: true,
        });
        if (!ok) return;
      }
      cmd = `POST /collections/${collEsc}/points/payload/delete?wait=true\n${JSON.stringify({
        keys,
        filter: filterObj,
      })}`;
    }

    setIsExecuting(true);
    try {
      const res = await QueryService.ExecuteQuery({
        executionId: `qdrant-batch-exec-${Date.now()}`,
        connectionId,
        database: 'default',
        schema: 'default',
        sql: cmd,
        limit: 1,
        offset: 0,
      } as any);
      if (res?.error) throw new Error(res.error);
      alertSuccess(`Batch operation completed on "${collectionName}".`, 'Batch Operation Complete');
      onSuccess?.();
      onClose();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setError(msg);
      alertError(msg, 'Batch Operation Failed');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-xl rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden text-xs">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d]">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-amber-400" />
            <span className="font-semibold text-sm text-zinc-100">Batch Operations — {collectionName}</span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded text-zinc-400 hover:text-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleExecute} className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'set_payload', label: 'Set Payload', icon: Edit3 },
                { id: 'delete_keys', label: 'Delete Keys', icon: Trash2 },
                { id: 'delete_points', label: 'Delete Points', icon: Trash2 },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setOpType(opt.id)}
                  className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg border font-medium cursor-pointer transition-colors ${
                    opType === opt.id
                      ? opt.id === 'delete_points'
                        ? 'bg-rose-600/20 border-rose-500 text-rose-200'
                        : 'bg-blue-600/20 border-blue-500 text-blue-200'
                      : 'bg-[#14151b] border-[#282b36] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-medium text-zinc-300">Qdrant Filter JSON</label>
              <button
                type="button"
                disabled={isCounting}
                onClick={handleDryRunCount}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#232632] hover:bg-[#2d3140] border border-[#343848] text-[11px] text-cyan-300 cursor-pointer"
              >
                {isCounting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                <span>Dry-Run Count</span>
              </button>
            </div>
            <textarea
              rows={5}
              value={filterJson}
              onChange={(e) => {
                setFilterJson(e.target.value);
                setPreviewCount(null);
              }}
              className="w-full rounded-lg border border-[#2f3240] bg-[#121318] px-3 py-2 font-mono text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
            />
            {previewCount !== null && (
              <div className="mt-1 text-[11px] text-cyan-300 font-mono">
                Matched points: {previewCount.toLocaleString()}
              </div>
            )}
          </div>

          {opType === 'set_payload' && (
            <div>
              <label className="block font-medium text-zinc-300 mb-1">Payload JSON to Merge/Set</label>
              <textarea
                rows={4}
                value={payloadJson}
                onChange={(e) => setPayloadJson(e.target.value)}
                className="w-full rounded-lg border border-[#2f3240] bg-[#121318] px-3 py-2 font-mono text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}

          {opType === 'delete_keys' && (
            <div>
              <label className="block font-medium text-zinc-300 mb-1">Payload Keys to Remove (comma-separated)</label>
              <input
                type="text"
                placeholder="e.g. legacy_tag, temp_flag"
                value={keysInput}
                onChange={(e) => setKeysInput(e.target.value)}
                className="w-full rounded-lg border border-[#2f3240] bg-[#121318] px-3 py-1.5 font-mono text-zinc-200 focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-rose-950/30 border border-rose-500/40 px-3 py-2 text-[11px] text-rose-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-[#272934]">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg bg-[#23252f] text-zinc-300 cursor-pointer">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isExecuting}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white font-medium cursor-pointer disabled:opacity-50 ${
                opType === 'delete_points' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-blue-600 hover:bg-blue-500'
              }`}
            >
              {isExecuting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{opType === 'delete_points' ? 'Execute Delete' : 'Apply to Matched Points'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
