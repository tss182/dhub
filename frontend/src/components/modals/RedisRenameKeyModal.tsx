import React, { useState } from 'react';
import { X, Pencil, ArrowRight } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertSuccess, alertError } from '../../stores/useAlertStore';

interface RedisRenameKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  oldKeyName: string;
  onSuccess?: () => void;
}

export const RedisRenameKeyModal: React.FC<RedisRenameKeyModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  oldKeyName,
  onSuccess,
}) => {
  const [newKeyName, setNewKeyName] = useState(oldKeyName);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalNew = newKeyName.trim();
    if (!finalNew) {
      alertError('New key name cannot be empty');
      return;
    }
    if (finalNew === oldKeyName) {
      onClose();
      return;
    }

    setIsSubmitting(true);
    try {
      const sql = `RENAME ${JSON.stringify(oldKeyName)} ${JSON.stringify(finalNew)}`;
      const res = await QueryService.ExecuteQuery({
        executionId: 'rename-key-' + Date.now(),
        connectionId,
        database,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      if (res?.error) {
        alertError(`Failed to rename key: ${res.error}`);
        return;
      }

      alertSuccess(`Key renamed from "${oldKeyName}" to "${finalNew}"!`);
      onClose();
      onSuccess?.();
    } catch (err: any) {
      alertError(err?.message || 'Error renaming key in Redis');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md rounded-xl border border-[#2b2e3a] bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#272932] px-5 py-3.5 bg-[#1e2029]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400">
              <Pencil className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Rename Redis Key</h3>
              <p className="text-[11px] text-zinc-400 font-mono">Database: {database}</p>
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
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Current Key Name</label>
            <div className="bg-[#101115] border border-[#2b2e3a] px-3 py-1.5 rounded-lg text-xs font-mono text-zinc-400 truncate">
              {oldKeyName}
            </div>
          </div>

          <div className="flex justify-center text-zinc-500">
            <ArrowRight className="h-4 w-4 rotate-90 md:rotate-0" />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
              New Key Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              autoFocus
              required
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="w-full bg-[#101115] border border-[#2b2e3a] focus:border-blue-500 px-3 py-1.5 text-xs text-white outline-none rounded-lg font-mono"
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
              disabled={isSubmitting || !newKeyName.trim() || newKeyName.trim() === oldKeyName}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer transition-colors shadow-xs"
            >
              {isSubmitting ? 'Renaming...' : 'Rename Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

