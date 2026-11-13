import React, { useState } from 'react';
import { X, Trash2, AlertTriangle } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertSuccess, alertError } from '../../stores/useAlertStore';

interface RedisFlushModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  mode?: 'FLUSHDB' | 'FLUSHALL';
  onSuccess?: () => void;
}

export const RedisFlushModal: React.FC<RedisFlushModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  mode = 'FLUSHDB',
  onSuccess,
}) => {
  const [confirmText, setConfirmText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const expectedConfirm = mode === 'FLUSHALL' ? 'FLUSHALL' : database;
  const isMatch = confirmText.trim().toLowerCase() === expectedConfirm.toLowerCase();

  const handleFlush = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isMatch) return;

    setIsSubmitting(true);
    try {
      const sql = mode === 'FLUSHALL' ? 'FLUSHALL' : 'FLUSHDB';
      const res = await QueryService.ExecuteQuery({
        executionId: 'flush-' + Date.now(),
        connectionId,
        database,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      if (res?.error) {
        alertError(`Failed to flush database: ${res.error}`);
        return;
      }

      alertSuccess(
        mode === 'FLUSHALL'
          ? 'Successfully flushed all databases on this Redis server!'
          : `Successfully flushed all keys in database "${database}"!`
      );
      onClose();
      onSuccess?.();
    } catch (err: any) {
      alertError(err?.message || 'Error executing flush command in Redis');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md rounded-xl border border-rose-500/40 bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#272932] px-5 py-3.5 bg-rose-950/20">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/20 text-rose-400">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-rose-200">
                {mode === 'FLUSHALL' ? 'Flush Entire Redis Server' : `Flush Database "${database}"`}
              </h3>
              <p className="text-[11px] text-zinc-400">Irreversible data removal</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleFlush} className="p-5 space-y-4">
          <div className="rounded-lg border border-rose-900/40 bg-rose-950/30 p-3 text-xs text-rose-200/90 space-y-2">
            <p className="font-semibold text-rose-300">Warning: Dangerous Action!</p>
            <p>
              {mode === 'FLUSHALL'
                ? 'This will immediately purge all keys across ALL databases on this Redis instance. Any active sessions, caches, or persistent data will be lost.'
                : `This will immediately purge all keys currently stored in "${database}". Other databases will not be affected.`}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-300">
              Type <code className="px-1.5 py-0.5 rounded bg-[#101115] text-amber-300 font-mono text-xs">{expectedConfirm}</code> to confirm:
            </label>
            <input
              type="text"
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={`Type "${expectedConfirm}" here`}
              className="w-full bg-[#101115] border border-[#2b2e3a] focus:border-rose-500 px-3 py-1.5 text-xs text-white outline-none rounded-lg font-mono"
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#272932]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 rounded-lg border border-[#2b2e3a] bg-[#14151b] hover:bg-[#20222a] text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isMatch || isSubmitting}
              className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold cursor-pointer transition-colors shadow-xs flex items-center gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{isSubmitting ? 'Flushing...' : mode === 'FLUSHALL' ? 'Flush All Databases' : 'Flush Database'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

