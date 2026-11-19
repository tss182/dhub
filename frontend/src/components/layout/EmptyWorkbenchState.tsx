import React from 'react';
import { Terminal, Plus, Search, BookOpen, Database } from 'lucide-react';
import { HelpTab } from '../../stores/useWorkbenchStore';

export interface EmptyWorkbenchStateProps {
  isMac: boolean;
  searchShortcutLabel: string;
  onNewConnection: () => void;
  onOpenSearchEverywhere: () => void;
  onOpenHelp: (tab: HelpTab) => void;
}

export const EmptyWorkbenchState: React.FC<EmptyWorkbenchStateProps> = ({
  isMac,
  searchShortcutLabel,
  onNewConnection,
  onOpenSearchEverywhere,
  onOpenHelp,
}) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500 select-none">
      <Terminal className="h-10 w-10 text-zinc-600 mb-3 stroke-[1.5]" />
      <h3 className="text-sm font-semibold text-zinc-300">No Open Tabs</h3>
      <p className="text-xs text-zinc-500 mt-1 max-w-md">
        Select a table from Database Explorer, right-click a connection to open a Query Console, or explore the User Guide to get started.
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={onNewConnection}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600/90 hover:bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer shadow-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New Connection</span>
        </button>

        <button
          type="button"
          onClick={onOpenSearchEverywhere}
          className="flex items-center gap-2 rounded-lg bg-[#1e2027] hover:bg-[#252834] border border-[#2b2e3a] px-3 py-1.5 text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer"
        >
          <Search className="h-3.5 w-3.5 text-emerald-400" />
          <span>Search Everywhere</span>
          <kbd className="rounded bg-[#14151a] border border-[#2d303d] px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
            {searchShortcutLabel}
          </kbd>
        </button>

        <button
          type="button"
          onClick={() => onOpenHelp('quickstart')}
          className="flex items-center gap-2 rounded-lg bg-[#1e2027] hover:bg-[#252834] border border-[#2b2e3a] px-3 py-1.5 text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer"
        >
          <BookOpen className="h-3.5 w-3.5 text-blue-400" />
          <span>User Guide &amp; Help</span>
          <kbd className="rounded bg-[#14151a] border border-[#2d303d] px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
            {isMac ? '⌘H' : 'Ctrl+H'}
          </kbd>
        </button>

        <button
          type="button"
          onClick={() => onOpenHelp('databases')}
          className="flex items-center gap-1.5 rounded-lg bg-[#1e2027] hover:bg-[#252834] border border-[#2b2e3a] px-3 py-1.5 text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer"
        >
          <Database className="h-3.5 w-3.5 text-amber-400" />
          <span>Database Query Guide</span>
        </button>
      </div>
    </div>
  );
};
