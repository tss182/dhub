import React, { useState } from 'react';
import { X, Play, Loader2, AlertTriangle, Search } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';

interface MongoBatchOpsModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  collectionName: string;
  onSuccess?: () => void;
}

export const MongoBatchOpsModal: React.FC<MongoBatchOpsModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  collectionName,
  onSuccess,
}) => {
  const [opMode, setOpMode] = useState<'updateMany' | 'deleteMany'>('updateMany');
  const [filterText, setFilterText] = useState('{ "status": "pending" }');
  const [updateText, setUpdateText] = useState('{ "$set": { "status": "archived" } }');
  const [dryRunCount, setDryRunCount] = useState<number | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  if (!isOpen) return null;

  const collRef = `db.getCollection(${JSON.stringify(collectionName)})`;

  const handleDryRun = async () => {
    setIsChecking(true);
    try {
      const res = await QueryService.ExecuteQuery({
        executionId: 'mongo-dryrun-' + Date.now(),
        connectionId,
        database,
        schema: database,
        sql: `${collRef}.countDocuments(${filterText.trim() || '{}'});`,
        limit: 1,
        offset: 0,
      } as any);
      const cnt = Number(res?.rows?.[0]?.[0] ?? 0);
      setDryRunCount(cnt);
    } catch (err: any) {
      alertError(err?.message || String(err), 'Dry-Run Count Failed');
    } finally {
      setIsChecking(false);
    }
  };

  const handleExecute = async () => {
    const f = filterText.trim() || '{}';
    const isMatchAll = f.replace(/\s+/g, '') === '{}';
    const ok = await confirmDialog({
      title: opMode === 'deleteMany' ? 'Confirm Batch Delete' : 'Confirm Batch Update',
      message: `${
        opMode === 'deleteMany' ? 'DELETE' : 'UPDATE'
      } matching documents in "${collectionName}"${isMatchAll ? ' (ALL DOCUMENTS)' : ''}?${
        dryRunCount !== null ? ` Estimated matched: ${dryRunCount}.` : ''
      }`,
      confirmLabel: opMode === 'deleteMany' ? 'Delete Many' : 'Update Many',
      isDanger: opMode === 'deleteMany' || isMatchAll,
    });
    if (!ok) return;

    setIsExecuting(true);
    try {
      const mql =
        opMode === 'deleteMany'
          ? `${collRef}.deleteMany(${f});`
          : `${collRef}.updateMany(${f}, ${updateText.trim()});`;
      await QueryService.ExecuteQuery({
        executionId: 'mongo-batch-' + Date.now(),
        connectionId,
        database,
        schema: database,
        sql: mql,
        limit: 10,
        offset: 0,
      } as any);
      alertSuccess(`Batch ${opMode} completed on "${collectionName}".`, 'Batch Operation Complete');
      onSuccess?.();
      onClose();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Batch Operation Failed');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl rounded-xl border border-[#282b36] bg-[#14161d] shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#222530]">
          <h3 className="text-sm font-semibold text-zinc-100">
            Batch Update / Delete — {database}.{collectionName}
          </h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs">
          <div className="flex gap-2">
            {(['updateMany', 'deleteMany'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setOpMode(m)}
                className={`px-3 py-1.5 rounded-md font-mono font-medium border cursor-pointer ${
                  opMode === m
                    ? m === 'deleteMany'
                      ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                      : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-[#1a1d26] border-[#292c38] text-zinc-400'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Filter Query (JSON/MQL)</label>
            <textarea
              rows={4}
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setDryRunCount(null);
              }}
              className="w-full rounded-lg border border-[#282b36] bg-[#0b0c10] p-2.5 font-mono text-zinc-100 outline-none"
            />
          </div>

          {opMode === 'updateMany' && (
            <div>
              <label className="block text-zinc-400 mb-1">
                Update Document ($set, $unset, $inc, $rename, $push, $pull)
              </label>
              <textarea
                rows={4}
                value={updateText}
                onChange={(e) => setUpdateText(e.target.value)}
                className="w-full rounded-lg border border-[#282b36] bg-[#0b0c10] p-2.5 font-mono text-zinc-100 outline-none"
              />
            </div>
          )}

          {opMode === 'deleteMany' && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>deleteMany permanently removes all matching documents. Run Dry-Run Count first.</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={handleDryRun}
              disabled={isChecking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#1f232e] hover:bg-[#2a2f3d] text-zinc-200 border border-[#2e3342] cursor-pointer"
            >
              {isChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Dry-Run Count
            </button>
            {dryRunCount !== null && (
              <span className="font-mono text-emerald-400">
                Matched documents: <strong>{dryRunCount}</strong>
              </span>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#222530]">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md text-xs bg-[#1e212b] hover:bg-[#282c3a] text-zinc-300 cursor-pointer">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExecute}
            disabled={isExecuting}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium text-white cursor-pointer ${
              opMode === 'deleteMany' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Execute {opMode}
          </button>
        </div>
      </div>
    </div>
  );
};
