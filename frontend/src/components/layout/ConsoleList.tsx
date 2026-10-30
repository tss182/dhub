import React, { useState } from 'react';
import { useWorkbenchStore, ConsoleRecord } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import {
  Terminal,
  FileCode,
  Plus,
  Pencil,
  Trash2,
  Copy,
  PanelRightClose,
  Search,
  X,
} from 'lucide-react';

interface ConsoleListProps {
  onRename: (id: string, currentTitle: string) => void;
}

export const ConsoleList: React.FC<ConsoleListProps> = ({ onRename }) => {
  const {
    consoles,
    tabs,
    activeTabId,
    openTab,
    closeTab,
    setActiveTabId,
    createConsole,
    deleteConsole,
    duplicateTab,
    toggleRightPanel,
  } = useWorkbenchStore();

  const { connections, activeConnectionId, activeDatabase, activeSchema } = useConnectionStore();

  const [filterText, setFilterText] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
    console?: ConsoleRecord;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
  });

  const handleOpenConsole = (record: ConsoleRecord) => {
    const existing = tabs.find((t) => t.id === record.id);
    if (existing) {
      setActiveTabId(record.id);
    } else {
      openTab({
        id: record.id,
        type: 'worksheet',
        title: record.title,
        connectionId: record.connectionId,
        database: record.database,
        schema: record.schema,
        content: record.content,
      });
    }
  };

  const handleCreateNew = () => {
    createConsole(activeConnectionId || '', activeDatabase || '', activeSchema || '');
  };

  const handleDelete = (id: string, title: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm(`Are you sure you want to delete console "${title}"?`)) return;
    deleteConsole(id);
  };

  const handleContextMenu = (e: React.MouseEvent, record: ConsoleRecord) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 190;
    const menuHeight = 200;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);

    setContextMenu({
      isOpen: true,
      x: Math.max(8, x),
      y: Math.max(8, y),
      console: record,
    });
  };

  const closeContextMenu = () => {
    setContextMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
  };

  React.useEffect(() => {
    const handleClose = () => closeContextMenu();
    window.addEventListener('click', handleClose);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeContextMenu();
    });
    return () => {
      window.removeEventListener('click', handleClose);
    };
  }, []);

  const filteredConsoles = consoles.filter((c) => {
    if (!filterText) return true;
    const term = filterText.toLowerCase();
    return (
      c.title.toLowerCase().includes(term) ||
      (c.database && c.database.toLowerCase().includes(term))
    );
  });

  return (
    <div className="flex h-full flex-col bg-[#191a20] text-xs select-none relative">
      {/* Panel Header */}
      <div className="flex h-10 items-center justify-between border-b border-[#272932] px-3 bg-[#14151a]">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-blue-400" />
          <span className="font-semibold uppercase tracking-wider text-[11px] text-zinc-400">
            Consoles
          </span>
          <span className="rounded bg-[#272932] px-1.5 py-0.2 text-[10px] text-zinc-400 font-mono">
            {consoles.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleCreateNew}
            className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
            title="New Query Console"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={toggleRightPanel}
            className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
            title="Collapse Consoles Panel"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Speed Search */}
      <div className="p-2 border-b border-[#272932]">
        <div className="relative">
          <input
            type="text"
            placeholder="Filter consoles..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full rounded bg-[#121317] pl-6 pr-2 py-1 text-[11px] text-zinc-200 border border-[#272932] focus:border-blue-500 focus:outline-none"
          />
          <Search className="h-3 w-3 text-zinc-500 absolute left-2 top-2 pointer-events-none" />
        </div>
      </div>

      {/* Consoles List */}
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {filteredConsoles.length === 0 ? (
          <div className="py-8 text-center text-zinc-500">
            <p className="text-[11px]">No consoles found</p>
            <button
              onClick={handleCreateNew}
              className="mt-2 text-[11px] text-blue-400 hover:underline cursor-pointer"
            >
              + Create New Console
            </button>
          </div>
        ) : (
          filteredConsoles.map((record) => {
            const isTabActive = activeTabId === record.id;
            const isTabOpen = tabs.some((t) => t.id === record.id);
            const conn = connections.find((c) => c.id === record.connectionId);

            return (
              <div
                key={record.id}
                onClick={() => handleOpenConsole(record)}
                onContextMenu={(e) => handleContextMenu(e, record)}
                className={`group flex flex-col p-2 rounded cursor-pointer border transition-colors ${
                  isTabActive
                    ? 'bg-[#22242c] border-blue-500/60 text-white'
                    : 'bg-[#14151a]/50 border-transparent hover:bg-[#22242c]/50 text-zinc-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <FileCode
                      className={`h-3.5 w-3.5 shrink-0 ${
                        isTabActive ? 'text-blue-400' : 'text-zinc-400'
                      }`}
                    />
                    <span className="font-medium truncate text-xs">{record.title}</span>
                    {isTabOpen && (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0"
                        title="Tab is currently open"
                      />
                    )}
                  </div>

                  {/* Actions on hover */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRename(record.id, record.title);
                      }}
                      className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#2d303b]"
                      title="Rename Console"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    {consoles.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => handleDelete(record.id, record.title, e)}
                        className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-[#2d303b]"
                        title="Delete Console"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Database / Connection info */}
                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-zinc-500">
                  <span
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: conn?.colorTag || '#71717a' }}
                  />
                  <span className="truncate">{conn ? conn.name : 'Default'}</span>
                  {record.database && (
                    <>
                      <span>/</span>
                      <span className="truncate text-zinc-400">{record.database}</span>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Context Menu for right-click on console item */}
      {contextMenu.isOpen && contextMenu.console && (
        <div
          className="fixed z-50 min-w-[190px] rounded-lg border border-[#2e313d] bg-[#181920]/95 backdrop-blur-md p-1 shadow-2xl text-[12px] text-zinc-300 select-none animate-in fade-in zoom-in-95 duration-100"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-[#272932] mb-1 truncate flex items-center gap-1.5">
            <FileCode className="h-3 w-3 text-blue-400" />
            <span className="truncate">{contextMenu.console.title}</span>
          </div>

          <button
            type="button"
            onClick={() => {
              const c = contextMenu.console!;
              closeContextMenu();
              handleOpenConsole(c);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <FileCode className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
            <span>Open in Editor</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const c = contextMenu.console!;
              closeContextMenu();
              onRename(c.id, c.title);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <Pencil className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
            <span>Rename Console...</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const c = contextMenu.console!;
              closeContextMenu();
              duplicateTab(c.id);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
            <span>Duplicate Console</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const content = contextMenu.console!.content || '';
              closeContextMenu();
              navigator.clipboard.writeText(content).catch(() => {});
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
            <span>Copy SQL</span>
          </button>

          {tabs.some((t) => t.id === contextMenu.console!.id) && (
            <button
              type="button"
              onClick={() => {
                const id = contextMenu.console!.id;
                closeContextMenu();
                closeTab(id);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-zinc-700 hover:text-white text-zinc-400 transition-colors text-left cursor-pointer group"
            >
              <X className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
              <span>Close Tab</span>
            </button>
          )}

          {consoles.length > 1 && (
            <>
              <div className="my-1 border-t border-[#272932]" />
              <button
                type="button"
                onClick={() => {
                  const c = contextMenu.console!;
                  closeContextMenu();
                  handleDelete(c.id, c.title);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                <span>Delete Console</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
