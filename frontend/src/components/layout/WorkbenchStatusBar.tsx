import React from 'react';
import { Sparkles, HelpCircle } from 'lucide-react';
import { APP_VERSION } from '../../version';
import { HelpTab } from '../../stores/useWorkbenchStore';

export interface WorkbenchStatusBarProps {
  isMac: boolean;
  statusMessage: string;
  currentTx?: { mode: 'auto' | 'manual'; isOpen: boolean; count: number };
  updateInfo: { hasUpdate?: boolean; latestVersion?: string } | null;
  onOpenUpdateModal: () => void;
  onOpenHelp: (tab: HelpTab) => void;
}

export const WorkbenchStatusBar: React.FC<WorkbenchStatusBarProps> = ({
  isMac,
  statusMessage,
  currentTx,
  updateInfo,
  onOpenUpdateModal,
  onOpenHelp,
}) => {
  return (
    <footer className="flex h-6 items-center justify-between border-t border-[#272932] px-3 text-[11px] bg-[#121317] text-zinc-500 font-mono">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {statusMessage}
        </span>
      </div>
      <div className="flex items-center gap-4">
        {currentTx?.mode === 'manual' ? (
          currentTx.isOpen ? (
            <span
              className="text-amber-400 font-semibold flex items-center gap-1.5"
              title="Active transaction with uncommitted statements"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>Tx: MANUAL (ACTIVE: {currentTx.count})</span>
            </span>
          ) : (
            <span className="text-zinc-400">Tx: MANUAL (IDLE)</span>
          )
        ) : (
          <span>Tx: AUTO</span>
        )}
        {updateInfo?.hasUpdate && (
          <button
            type="button"
            onClick={onOpenUpdateModal}
            className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer animate-pulse transition-colors"
            title="New version available! Click to view details and install"
          >
            <Sparkles className="h-3 w-3" />
            <span>Update ({updateInfo.latestVersion})</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenHelp('quickstart')}
          className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          title={`Open Help & User Guide (${isMac ? '⌘H' : 'Ctrl+H'})`}
        >
          <HelpCircle className="h-3 w-3 text-blue-400" />
          <span>Help ({isMac ? '⌘H' : 'Ctrl+H'})</span>
        </button>
        <span>DHub Desktop v{APP_VERSION}</span>
      </div>
    </footer>
  );
};
