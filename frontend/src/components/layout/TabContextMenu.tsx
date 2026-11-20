import React, { useState, useEffect } from 'react';
import {
  FileCode,
  Users,
  Table,
  Pencil,
  Copy,
  RefreshCw,
  Eraser,
  Trash2,
  X,
  Columns,
  Terminal,
  ChevronRight,
  Plus,
} from 'lucide-react';
import { ConnectionConfig, WorkbenchTab } from '../../types/domain';
import { ConsoleRecord } from '../../stores/useWorkbenchStore';

export interface TabContextMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  tab?: WorkbenchTab;
  tabs?: WorkbenchTab[];
  consoles?: ConsoleRecord[];
  activeTabId?: string | null;
  splitTabId?: string | null;
  tabCount?: number;
  resolveTableTabMeta: (tab: WorkbenchTab) => {
    conn?: ConnectionConfig;
    driver: string;
    objectType: string;
  };
  onCloseMenu: () => void;
  onOpenRename: (id: string, title: string) => void;
  onDuplicateTab: (id: string) => void;
  onOpenSplitView?: (id: string) => void;
  onCloseSplitView?: () => void;
  onReloadTableData: (tab: WorkbenchTab) => void;
  onNewConsole?: (tab: WorkbenchTab) => void;
  onSelectConsole?: (consoleRecord: ConsoleRecord) => void;
  onTruncateTable: (tab: WorkbenchTab) => void;
  onDropTable: (tab: WorkbenchTab) => void;
  onCloseTab: (id: string) => void;
  onCloseOtherTabs: (id: string) => void;
  onCloseAllTabs: () => void;
}

export const TabContextMenu: React.FC<TabContextMenuProps> = ({
  isOpen,
  x,
  y,
  tab,
  tabs = [],
  consoles = [],
  activeTabId,
  splitTabId,
  tabCount = 0,
  resolveTableTabMeta,
  onCloseMenu,
  onOpenRename,
  onDuplicateTab,
  onOpenSplitView,
  onCloseSplitView,
  onReloadTableData,
  onNewConsole,
  onSelectConsole,
  onTruncateTable,
  onDropTable,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
}) => {
  const [isConsoleSubmenuOpen, setIsConsoleSubmenuOpen] = useState(false);

  useEffect(() => {
    setIsConsoleSubmenuOpen(false);
  }, [isOpen, tab?.id]);

  if (!isOpen || !tab) return null;

  const isTableTab = tab.type === 'table_data';
  const tableMeta = isTableTab ? resolveTableTabMeta(tab) : null;
  const canMutateTable = Boolean(
    isTableTab && tab.table && !tableMeta?.conn?.isReadOnly && tableMeta?.driver !== 'redis'
  );
  const isView = tableMeta?.objectType === 'view' || tableMeta?.objectType === 'materialized_view';
  const connectionConsoles = isTableTab && tab.connectionId
    ? consoles.filter((c) => c.connectionId === tab.connectionId)
    : [];
  const openSubmenuLeft =
    typeof window !== 'undefined' && x + 190 + 210 > window.innerWidth;

  return (
    <div
      className="fixed z-50 min-w-[190px] rounded-lg border border-[#2e313d] bg-[#181920]/95 backdrop-blur-md p-1 shadow-2xl text-[12px] text-zinc-300 select-none animate-in fade-in zoom-in-95 duration-100"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-[#272932] mb-1 truncate flex items-center gap-1.5">
        {tab.type === 'worksheet' ? (
          <FileCode className="h-3 w-3 text-blue-400" />
        ) : tab.type === 'users' ? (
          <Users className="h-3 w-3 text-amber-400" />
        ) : (
          <Table className="h-3 w-3 text-emerald-400" />
        )}
        <span className="truncate">{tab.title}</span>
      </div>

      {tab.type === 'worksheet' && (
        <>
          <button
            type="button"
            onClick={() => {
              onCloseMenu();
              onOpenRename(tab.id, tab.title);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <Pencil className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
            <span>Rename Tab...</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onCloseMenu();
              onDuplicateTab(tab.id);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
            <span>Duplicate Console</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const content = tab.content || '';
              onCloseMenu();
              navigator.clipboard.writeText(content).catch(() => {});
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
            <span>Copy SQL</span>
          </button>
        </>
      )}

      {isTableTab && (
        <>
          <button
            type="button"
            onClick={() => {
              onCloseMenu();
              onReloadTableData(tab);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <RefreshCw className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
            <span>Reload Data</span>
          </button>

          <div
            className="relative"
            onMouseEnter={() => setIsConsoleSubmenuOpen(true)}
            onMouseLeave={() => setIsConsoleSubmenuOpen(false)}
          >
            <button
              type="button"
              onClick={() => setIsConsoleSubmenuOpen((prev) => !prev)}
              className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md transition-colors text-left cursor-pointer group ${
                isConsoleSubmenuOpen
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-blue-600 hover:text-white text-zinc-300'
              }`}
            >
              <span className="flex items-center gap-2">
                <Terminal
                  className={`h-3.5 w-3.5 ${
                    isConsoleSubmenuOpen
                      ? 'text-white'
                      : 'text-zinc-400 group-hover:text-white'
                  }`}
                />
                <span>Console</span>
              </span>
              <ChevronRight
                className={`h-3.5 w-3.5 ${
                  isConsoleSubmenuOpen
                    ? 'text-white'
                    : 'text-zinc-500 group-hover:text-white'
                }`}
              />
            </button>

            {isConsoleSubmenuOpen && (
              <div
                className={`absolute top-0 z-50 ${
                  openSubmenuLeft ? 'right-full pr-1' : 'left-full pl-1'
                }`}
              >
                <div className="min-w-[200px] max-w-[280px] max-h-[260px] overflow-y-auto rounded-lg border border-[#2e313d] bg-[#181920]/95 backdrop-blur-md p-1 shadow-2xl text-[12px] text-zinc-300">
                  <button
                    type="button"
                    onClick={() => {
                      onCloseMenu();
                      onNewConsole?.(tab);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-200 transition-colors text-left cursor-pointer group"
                  >
                    <Plus className="h-3.5 w-3.5 text-blue-400 group-hover:text-white shrink-0" />
                    <span>New Console</span>
                  </button>

                  {connectionConsoles.length > 0 && (
                    <>
                      <div className="my-1 border-t border-[#272932]" />
                      {connectionConsoles.map((consoleRecord) => {
                        const isOpenTab = tabs.some((t) => t.id === consoleRecord.id);
                        return (
                          <button
                            key={consoleRecord.id}
                            type="button"
                            onClick={() => {
                              onCloseMenu();
                              onSelectConsole?.(consoleRecord);
                            }}
                            title={
                              consoleRecord.database
                                ? `${consoleRecord.title} (${consoleRecord.database})`
                                : consoleRecord.title
                            }
                            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <FileCode className="h-3.5 w-3.5 text-blue-400 group-hover:text-white shrink-0" />
                              <span className="truncate">{consoleRecord.title}</span>
                              {isOpenTab && (
                                <span
                                  className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0"
                                  title="Currently open"
                                />
                              )}
                            </span>
                            {consoleRecord.database && (
                              <span className="text-[10px] font-mono text-zinc-500 group-hover:text-blue-100 truncate max-w-[80px] shrink-0">
                                {consoleRecord.database}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="my-1 border-t border-[#272932]" />

      {onOpenSplitView && splitTabId !== tab.id && (tab.id !== activeTabId || tabCount > 1) && (
        <button
          type="button"
          onClick={() => {
            onCloseMenu();
            onOpenSplitView(tab.id);
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
        >
          <Columns className="h-3.5 w-3.5 text-cyan-400 group-hover:text-white" />
          <span>Open in Right Sidebar (Split)</span>
        </button>
      )}

      {onCloseSplitView && splitTabId === tab.id && (
        <button
          type="button"
          onClick={() => {
            onCloseMenu();
            onCloseSplitView();
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[#22242c] hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
        >
          <Columns className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
          <span>Close Right Sidebar (Split)</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          onCloseMenu();
          onCloseTab(tab.id);
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
      >
        <X className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
        <span>Close Tab</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onCloseMenu();
          onCloseOtherTabs(tab.id);
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[#22242c] hover:text-zinc-200 text-zinc-400 transition-colors text-left cursor-pointer group"
      >
        <X className="h-3.5 w-3.5 text-zinc-500 group-hover:text-white" />
        <span>Close Other Tabs</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onCloseMenu();
          onCloseAllTabs();
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[#22242c] hover:text-zinc-200 text-zinc-400 transition-colors text-left cursor-pointer group"
      >
        <X className="h-3.5 w-3.5 text-zinc-500 group-hover:text-white" />
        <span>Close All Tabs</span>
      </button>

      {canMutateTable && (
        <>
          <div className="my-1 border-t border-[#272932]" />
          {!isView && (
            <button
              type="button"
              onClick={() => {
                onCloseMenu();
                onTruncateTable(tab);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
            >
              <Eraser className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
              <span>Truncate Table...</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onCloseMenu();
              onDropTable(tab);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
          >
            <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
            <span>Drop {tableMeta?.objectType === 'view' ? 'View' : 'Table'}...</span>
          </button>
        </>
      )}
    </div>
  );
};
