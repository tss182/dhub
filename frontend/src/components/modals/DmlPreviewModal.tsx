import React from 'react';
import { X } from 'lucide-react';
import { ConnectionConfig, resolveConnectionEnv } from '../../types/domain';

interface DmlPreviewModalProps {
  statements: string[] | null;
  connection?: ConnectionConfig;
  onClose: () => void;
  onApply: () => void;
}

export const DmlPreviewModal: React.FC<DmlPreviewModalProps> = ({
  statements,
  connection,
  onClose,
  onApply,
}) => {
  if (!statements) return null;

  const env = resolveConnectionEnv(connection);
  const headerClass =
    env === 'prod'
      ? 'bg-rose-950/75 border-rose-800/70'
      : env === 'dev'
      ? 'bg-emerald-950/75 border-emerald-800/70'
      : 'bg-[#14151a] border-[#272932]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="w-[600px] rounded-lg bg-[#191a20] border border-[#272932] overflow-hidden text-xs text-zinc-300 shadow-2xl">
        <div className={`flex items-center justify-between border-b px-4 py-3 ${headerClass}`}>
          <span className="font-semibold text-sm text-zinc-100">Pending DML Statements</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">
          <pre className="p-3 bg-[#121317] rounded border border-[#272932] font-mono text-xs text-emerald-400 max-h-60 overflow-auto">
            {statements.join('\n\n')}
          </pre>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-[#272932] hover:bg-[#22242c] cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={() => {
                onClose();
                onApply();
              }}
              className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm cursor-pointer"
            >
              Apply Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

