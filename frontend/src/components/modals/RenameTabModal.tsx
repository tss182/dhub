import React from 'react';
import { Pencil, X } from 'lucide-react';
import { ConnectionConfig, resolveConnectionEnv } from '../../types/domain';

interface RenameTabModalProps {
  isOpen: boolean;
  title: string;
  connection?: ConnectionConfig;
  onChangeTitle: (title: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const RenameTabModal: React.FC<RenameTabModalProps> = ({
  isOpen,
  title,
  connection,
  onChangeTitle,
  onClose,
  onSubmit,
}) => {
  if (!isOpen) return null;

  const env = resolveConnectionEnv(connection);
  const headerClass =
    env === 'prod'
      ? 'bg-rose-950/75 border-rose-800/70'
      : env === 'dev'
      ? 'bg-emerald-950/75 border-emerald-800/70'
      : 'bg-[#14151a] border-[#272932]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="w-80 rounded-lg bg-[#191a20] border border-[#272932] overflow-hidden text-xs text-zinc-300 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
        <div className={`flex items-center justify-between px-4 py-2.5 border-b ${headerClass}`}>
          <span className="font-semibold text-sm text-zinc-100 flex items-center gap-1.5">
            <Pencil className="h-4 w-4 text-blue-400" />
            Rename Tab / Console
          </span>
          <button onClick={onClose} className="text-zinc-400 hover:text-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-4">
          <label className="block text-[11px] text-zinc-400 mb-1.5 font-medium">New Name:</label>
          <input
            type="text"
            value={title}
            onChange={(e) => onChangeTitle(e.target.value)}
            className="w-full rounded bg-[#121317] px-2.5 py-1.5 text-xs text-zinc-100 border border-[#272932] focus:border-blue-500 focus:outline-none"
            autoFocus
            onFocus={(e) => e.target.select()}
          />
          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-[#272932] hover:bg-[#22242c] text-zinc-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-sm cursor-pointer"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

