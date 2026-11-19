import React from 'react';
import { FileCode, Users, Table, Pencil, Copy, RefreshCw, Eraser, Trash2, X } from 'lucide-react';
import { ConnectionConfig, WorkbenchTab } from '../../types/domain';

export interface TabContextMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  tab?: WorkbenchTab;
  resolveTableTabMeta: (tab: WorkbenchTab) => {
    conn?: ConnectionConfig;
    driver: string;
    objectType: string;
  };
  onCloseMenu: () => void;
  onOpenRename: (id: string, title: string) => void;
  onDuplicateTab: (id: string) => void;
  onReloadTableData: (tab: WorkbenchTab) => void;
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
  resolveTableTabMeta,
  onCloseMenu,
  onOpenRename,
  onDuplicateTab,
  onReloadTableData,
  onTruncateTable,
  onDropTable,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
}) => {
  if (!isOpen || !tab) return null;

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

      {tab.type === 'table_data' && (() => {
        const { conn, driver, objectType } = resolveTableTabMeta(tab);
        const canMutateTable = !!tab.table && !conn?.isReadOnly && driver !== 'redis';
        const isView = objectType === 'view' || objectType === 'materialized_view';
        return (
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
                  <span>Drop {objectType === 'view' ? 'View' : 'Table'}...</span>
                </button>
              </>
            )}
          </>
        );
      })()}

      <div className="my-1 border-t border-[#272932]" />

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
    </div>
  );
};
