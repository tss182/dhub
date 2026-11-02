import React, { useState } from 'react';
import { useWorkbenchStore, ConsoleRecord } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { SchemaService } from '../../../bindings/dhub/internal/services';
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
  ChevronDown,
  ChevronRight,
  Database,
  RefreshCw,
} from 'lucide-react';
import { ConnectionConfig } from '../../types/domain';
import { alertWarning } from '../../stores/useAlertStore';

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

  const {
    connections,
    activeConnectionId,
    treeDatabases,
    setTreeDatabases,
  } = useConnectionStore();

  const [filterText, setFilterText] = useState('');
  const [expandedConns, setExpandedConns] = useState<Record<string, boolean>>({});

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
    type: 'connection' | 'console';
    connection?: ConnectionConfig;
    console?: ConsoleRecord;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
    type: 'console',
  });

  const toggleConnection = (connId: string) => {
    setExpandedConns((prev) => ({
      ...prev,
      [connId]: prev[connId] === undefined ? false : !prev[connId],
    }));
  };

  const isConnExpanded = (connId: string) => {
    // Default to true (expanded) if not explicitly collapsed
    return expandedConns[connId] !== false;
  };

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

  const handleCreateForConnection = async (conn: ConnectionConfig) => {
    // 1. Determine default database for this connection
    let dbs = treeDatabases[conn.id] || [];
    if (dbs.length === 0) {
      try {
        const fetched = await SchemaService.GetDatabases(conn.id);
        if (fetched && fetched.length > 0) {
          dbs = fetched;
          setTreeDatabases(conn.id, fetched);
        }
      } catch (e) {
        console.warn('Could not fetch databases for connection:', e);
      }
    }

    const systemDbs = ['information_schema', 'performance_schema', 'mysql', 'sys'];
    const nonSystemDb = dbs.find((d) => !systemDbs.includes(d.toLowerCase()));
    const targetDb = conn.databaseName || nonSystemDb || (dbs.length > 0 ? dbs[0] : (conn.driver === 'sqlite' ? 'main' : 'default'));
    const targetSchema = conn.driver === 'postgres' ? 'public' : targetDb;

    const count = consoles.filter((c) => c.connectionId === conn.id).length + 1;
    const title = `${conn.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_console_${count}.sql`;

    createConsole(conn.id, targetDb, targetSchema, title);
  };

  const handleRefreshDatabases = async (connId: string) => {
    try {
      const fetched = await SchemaService.GetDatabases(connId);
      if (fetched) {
        setTreeDatabases(connId, fetched);
      }
    } catch (e) {
      console.warn('Could not refresh databases:', e);
    }
  };

  const handleDelete = (id: string, title: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm(`Are you sure you want to delete console "${title}"?`)) return;
    deleteConsole(id);
  };

  const handleConsoleContextMenu = (e: React.MouseEvent, record: ConsoleRecord) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 190;
    const menuHeight = 210;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);

    setContextMenu({
      isOpen: true,
      x: Math.max(8, x),
      y: Math.max(8, y),
      type: 'console',
      console: record,
    });
  };

  const handleConnectionContextMenu = (e: React.MouseEvent, conn: ConnectionConfig) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 200;
    const menuHeight = 160;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);

    setContextMenu({
      isOpen: true,
      x: Math.max(8, x),
      y: Math.max(8, y),
      type: 'connection',
      connection: conn,
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

  const filterLower = filterText.toLowerCase().trim();

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
            onClick={() => {
              const activeConn = connections.find((c) => c.id === activeConnectionId) || connections[0];
              if (activeConn) {
                handleCreateForConnection(activeConn);
              } else {
                alertWarning('Please select or add a connection in Database Explorer first.', 'No Active Connection');
              }
            }}
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

      {/* Connections with their attached Consoles */}
      <div className="flex-1 overflow-auto p-2 space-y-2">
        {connections.length === 0 ? (
          <div className="py-8 text-center text-zinc-500">
            <p className="text-[11px]">No connections configured</p>
          </div>
        ) : (
          connections.map((conn) => {
            const connConsoles = consoles.filter((c) => c.connectionId === conn.id);
            const matchingConsoles = filterLower
              ? connConsoles.filter(
                  (c) =>
                    c.title.toLowerCase().includes(filterLower) ||
                    (c.database && c.database.toLowerCase().includes(filterLower))
                )
              : connConsoles;

            const connMatches = filterLower && conn.name.toLowerCase().includes(filterLower);
            if (filterLower && !connMatches && matchingConsoles.length === 0) {
              return null;
            }

            const isExpanded = isConnExpanded(conn.id) || !!filterLower;
            const displayedConsoles = filterLower && !connMatches ? matchingConsoles : connConsoles;

            return (
              <div key={conn.id} className="rounded bg-[#14151a]/40 border border-[#272932]/70 overflow-hidden">
                {/* Connection Header Row */}
                <div
                  onClick={() => toggleConnection(conn.id)}
                  onContextMenu={(e) => handleConnectionContextMenu(e, conn)}
                  className="group flex items-center justify-between px-2 py-1.5 bg-[#191a20] hover:bg-[#22242c] cursor-pointer text-zinc-300 transition-colors"
                  title="Right-click for options (Tambah Console)"
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 text-zinc-500 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-zinc-500 shrink-0" />
                    )}
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: conn.colorTag || '#3b82f6' }}
                    />
                    <span className="font-semibold text-[11px] truncate">{conn.name}</span>
                    <span className="text-[9px] text-zinc-500 font-mono uppercase bg-[#121317] px-1 rounded shrink-0">
                      {conn.driver}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-500 font-mono px-1">
                      {connConsoles.length}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateForConnection(conn);
                      }}
                      className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#2d303b] opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Tambah Console untuk koneksi ini"
                    >
                      <Plus className="h-3 w-3 text-emerald-400" />
                    </button>
                  </div>
                </div>

                {/* Consoles under this Connection */}
                {isExpanded && (
                  <div className="p-1 space-y-1 bg-[#121317]/50">
                    {displayedConsoles.length === 0 ? (
                      <div className="px-3 py-2 text-[10px] text-zinc-500 italic flex items-center justify-between">
                        <span>No consoles yet</span>
                        <button
                          type="button"
                          onClick={() => handleCreateForConnection(conn)}
                          className="text-blue-400 hover:underline cursor-pointer not-italic text-[10px]"
                        >
                          + Tambah Console
                        </button>
                      </div>
                    ) : (
                      displayedConsoles.map((record) => {
                        const isTabActive = activeTabId === record.id;
                        const isTabOpen = tabs.some((t) => t.id === record.id);

                        return (
                          <div
                            key={record.id}
                            onClick={() => handleOpenConsole(record)}
                            onContextMenu={(e) => handleConsoleContextMenu(e, record)}
                            className={`group flex flex-col p-2 rounded cursor-pointer border transition-colors ${
                              isTabActive
                                ? 'bg-[#22242c] border-blue-500/60 text-white'
                                : 'bg-[#191a20]/80 border-transparent hover:bg-[#22242c]/50 text-zinc-300'
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

                              {/* Hover actions */}
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
                                <button
                                  type="button"
                                  onClick={(e) => handleDelete(record.id, record.title, e)}
                                  className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-[#2d303b]"
                                  title="Delete Console"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>

                            {/* Database info tag */}
                            <div className="flex items-center gap-1.5 mt-1 text-[10px] text-zinc-500">
                              <Database className="h-2.5 w-2.5 text-blue-400 shrink-0" />
                              <span className="font-mono text-zinc-400 truncate">
                                {record.database || 'main'}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Floating Context Menu */}
      {contextMenu.isOpen && (
        <div
          className="fixed z-50 min-w-[190px] rounded-lg border border-[#2e313d] bg-[#181920]/95 backdrop-blur-md p-1 shadow-2xl text-[12px] text-zinc-300 select-none animate-in fade-in zoom-in-95 duration-100"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Connection Context Menu */}
          {contextMenu.type === 'connection' && contextMenu.connection && (
            <>
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-[#272932] mb-1 truncate flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: contextMenu.connection.colorTag || '#3b82f6' }}
                />
                <span className="truncate">{contextMenu.connection.name}</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  const conn = contextMenu.connection!;
                  closeContextMenu();
                  handleCreateForConnection(conn);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Plus className="h-3.5 w-3.5 text-emerald-400 group-hover:text-white" />
                <span>Tambah Console (New Console)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const connId = contextMenu.connection!.id;
                  closeContextMenu();
                  handleRefreshDatabases(connId);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <RefreshCw className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Refresh Databases</span>
              </button>
            </>
          )}

          {/* Console Context Menu */}
          {contextMenu.type === 'console' && contextMenu.console && (
            <>
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
