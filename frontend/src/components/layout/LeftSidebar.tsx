import React from 'react';
import { DatabaseExplorer } from './DatabaseExplorer';
import { WorkspaceList } from './WorkspaceList';
import { Database, Briefcase, Plus, X } from 'lucide-react';
import { Popover } from '../common/Popover';

export type LeftSidebarTab = 'explorer' | 'workspaces';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);

interface LeftSidebarProps {
  activeTab: LeftSidebarTab;
  onTabChange: (tab: LeftSidebarTab) => void;
  onCollapse?: () => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  activeTab,
  onTabChange,
  onCollapse,
}) => {
  return (
    <div className="flex h-full flex-col bg-[#191a20] text-xs select-none relative overflow-hidden">
      {/* Unified Tab Bar Header (Symmetric to RightSidebar) */}
      <div className="flex h-10 items-center justify-between border-b border-[#272932] px-2 bg-[#14151a] shrink-0">
        {/* Switcher Buttons: Explorer & Workspaces */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onTabChange('explorer')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors cursor-pointer select-none ${
              activeTab === 'explorer'
                ? 'bg-[#22242c] text-white font-medium border border-[#2e313d]'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1b22]'
            }`}
            title="Database Explorer Tree"
          >
            <Database className="h-3.5 w-3.5 text-blue-400" />
            <span>Explorer</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('workspaces')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors cursor-pointer select-none ${
              activeTab === 'workspaces'
                ? 'bg-[#22242c] text-white font-medium border border-[#2e313d]'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1b22]'
            }`}
            title="Saved Workspaces / Sessions"
          >
            <Briefcase className="h-3.5 w-3.5 text-blue-400" />
            <span>Workspaces</span>
          </button>
        </div>

        {/* Right Header Controls */}
        <div className="flex items-center gap-1">
          {onCollapse && (
            <Popover
              content="Close Left Sidebar"
              shortcut={isMac ? '⌘B' : 'Ctrl+B'}
              side="bottom"
              align="end"
            >
              <button
                type="button"
                onClick={onCollapse}
                className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </Popover>
          )}
        </div>
      </div>

      {/* Body Views */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {activeTab === 'explorer' ? (
          <DatabaseExplorer onCollapse={onCollapse} />
        ) : (
          <WorkspaceList />
        )}
      </div>
    </div>
  );
};

