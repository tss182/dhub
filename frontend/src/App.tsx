import React, { useState, useEffect } from 'react';
import { useWorkbenchStore } from './stores/useWorkbenchStore';
import { useConnectionStore } from './stores/useConnectionStore';
import { useGridEditStore } from './stores/useGridEditStore';
import { QueryService, SchemaService } from '../bindings/dhub/internal/services';
import { DatabaseExplorer } from './components/layout/DatabaseExplorer';
import { ConsoleList } from './components/layout/ConsoleList';
import { SqlWorksheet } from './components/editor/SqlWorksheet';
import { DataGrid } from './components/grid/DataGrid';
import { ConnectionDialog } from './components/modals/ConnectionDialog';
import { SearchEverywhere } from './components/modals/SearchEverywhere';
import { DHubLogo } from './components/common/DHubLogo';
import {
  Database,
  Terminal,
  Search,
  X,
  FileCode,
  Table,
  Play,
  RotateCcw,
  CheckCircle,
  Clock,
  Layers,
  ChevronDown,
  RefreshCw,
  Pencil,
  Copy,
} from 'lucide-react';
import { QueryResult, ColumnMeta, WorkbenchTab } from './types/domain';

export function App() {
  const {
    tabs,
    activeTabId,
    activeBottomTab,
    isBottomPanelOpen,
    isRightPanelOpen,
    consoles,
    openTab,
    closeTab,
    closeTabsMatching,
    setActiveTabId,
    updateTabContent,
    updateTabDatabase,
    updateTabConnection,
    renameTab,
    duplicateTab,
    setActiveBottomTab,
    toggleBottomPanel,
    toggleRightPanel,
    setSearchEverywhereOpen,
    setConnectionDialogOpen,
    tabRefreshTrigger,
  } = useWorkbenchStore();

  const {
    activeConnectionId,
    activeDatabase,
    activeSchema,
    connections,
    treeDatabases,
    setTreeDatabases,
  } = useConnectionStore();
  const [isRunning, setIsRunning] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [dmlPreview, setDmlPreview] = useState<string[] | null>(null);

  // Tab Context Menu state
  const [tabContextMenu, setTabContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
    tab?: WorkbenchTab;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
  });

  // Rename Dialog state
  const [renameModal, setRenameModal] = useState<{
    isOpen: boolean;
    id: string;
    title: string;
  }>({
    isOpen: false,
    id: '',
    title: '',
  });

  // Tab-specific table data store
  const [tableDataByTab, setTableDataByTab] = useState<
    Record<
      string,
      {
        columns: ColumnMeta[];
        rows: any[][];
        primaryKeys: string[];
        isLoading: boolean;
        error: string | null;
      }
    >
  >({});

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
  const searchShortcutLabel = isMac ? '⌘P' : 'Ctrl+P';

  // Global Keyboard shortcuts: Ctrl+P / Cmd+P for Search Everywhere, Double Shift as secondary
  useEffect(() => {
    let lastShiftPress = 0;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Primary shortcut: Ctrl+P on Linux/Windows, Cmd+P on macOS
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setSearchEverywhereOpen(true);
        return;
      }

      // Secondary shortcut: Double Shift
      if (e.key === 'Shift') {
        const now = Date.now();
        if (now - lastShiftPress < 350) {
          setSearchEverywhereOpen(true);
          lastShiftPress = 0;
        } else {
          lastShiftPress = now;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Listeners to close Tab Context Menu & escape Rename Modal
  useEffect(() => {
    const handleClose = () => {
      if (tabContextMenu.isOpen) {
        setTabContextMenu((prev) => ({ ...prev, isOpen: false }));
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
        if (renameModal.isOpen) {
          setRenameModal({ isOpen: false, id: '', title: '' });
        }
      }
    };
    window.addEventListener('click', handleClose);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [tabContextMenu.isOpen, renameModal.isOpen]);

  const handleTabContextMenu = (e: React.MouseEvent, tab: WorkbenchTab) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 190;
    const menuHeight = 220;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);
    setTabContextMenu({
      isOpen: true,
      x: Math.max(10, x),
      y: Math.max(10, y),
      tab,
    });
  };

  const handleOpenRename = (id: string, currentTitle: string) => {
    setRenameModal({
      isOpen: true,
      id,
      title: currentTitle,
    });
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (renameModal.title.trim()) {
      renameTab(renameModal.id, renameModal.title.trim());
    }
    setRenameModal({ isOpen: false, id: '', title: '' });
  };

  const loadTableData = async (tab: WorkbenchTab) => {
    const connId = tab.connectionId || activeConnectionId;
    if (!tab || tab.type !== 'table_data' || !connId || !tab.table) return;

    setTableDataByTab((prev) => ({
      ...prev,
      [tab.id]: {
        columns: prev[tab.id]?.columns || [],
        rows: prev[tab.id]?.rows || [],
        primaryKeys: prev[tab.id]?.primaryKeys || [],
        isLoading: true,
        error: null,
      },
    }));

    try {
      const conn = connections.find((c) => c.id === connId);
      const isMySQL = conn?.driver === 'mysql';
      const targetDb = tab.database || conn?.databaseName || 'main';
      const targetSchema = tab.schema || (conn?.driver === 'postgres' ? 'public' : targetDb);

      // 1. Fetch table structure for primary keys
      let primaryKeys: string[] = [];
      try {
        const structure = await SchemaService.GetTableStructure(
          connId,
          targetDb,
          targetSchema,
          tab.table
        );
        if (structure && structure.primaryKeys) {
          primaryKeys = structure.primaryKeys;
        }
      } catch (structErr) {
        console.warn('Could not fetch structure for table:', structErr);
      }

      // 2. Query table data
      const quotedTable = isMySQL ? `\`${tab.table}\`` : `"${tab.table}"`;
      const sql = `SELECT * FROM ${quotedTable} LIMIT 500;`;

      const execId = 'exec-tab-' + Date.now();
      const res = await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: connId,
        database: targetDb,
        schema: targetSchema,
        sql,
        limit: 500,
        offset: 0,
      } as any);

      if (res) {
        const detectedPKs =
          primaryKeys.length > 0
            ? primaryKeys
            : (res.columns || []).filter((c: any) => (c as any).isPrimaryKey).map((c: any) => c.name);

        setTableDataByTab((prev) => ({
          ...prev,
          [tab.id]: {
            columns: (res.columns as any) || [],
            rows: (res.rows as any) || [],
            primaryKeys: detectedPKs,
            isLoading: false,
            error: null,
          },
        }));
        setStatusMessage(`Loaded ${res.rows?.length || 0} rows from ${tab.table}`);
      }
    } catch (e: any) {
      console.error(`Failed to load data for ${tab.table}:`, e);
      setTableDataByTab((prev) => ({
        ...prev,
        [tab.id]: {
          columns: [],
          rows: [],
          primaryKeys: [],
          isLoading: false,
          error: e?.message || String(e),
        },
      }));
      setStatusMessage(`Error loading ${tab.table}: ${e?.message || String(e)}`);
    }
  };

  // Automatically fetch table rows when switching to or opening a table_data tab, or when refreshed
  useEffect(() => {
    if (activeTab && activeTab.type === 'table_data') {
      const existing = tableDataByTab[activeTab.id];
      const refreshCount = tabRefreshTrigger[activeTab.id] || 0;
      if (refreshCount > 0 || !existing || (!existing.isLoading && existing.rows.length === 0 && !existing.error)) {
        loadTableData(activeTab);
      }
    }
  }, [activeTabId, tabRefreshTrigger[activeTabId || '']]);

  // Pre-load databases for connections so console dropdowns are always populated
  useEffect(() => {
    connections.forEach((c) => {
      if (!treeDatabases[c.id]) {
        SchemaService.GetDatabases(c.id)
          .then((dbs) => {
            if (dbs && dbs.length > 0) {
              setTreeDatabases(c.id, dbs);
            }
          })
          .catch(() => {});
      }
    });
  }, [connections]);

  const handleExecuteQuery = async (sql: string) => {
    const targetConnId = activeTab?.connectionId || activeConnectionId;
    if (!targetConnId) {
      alert('Please select or add a connection in Database Explorer first!');
      return;
    }
    const conn = connections.find((c) => c.id === targetConnId);
    const targetDb = activeTab?.database || conn?.databaseName || activeDatabase || 'main';
    const targetSchema = activeTab?.schema || (conn?.driver === 'postgres' ? 'public' : targetDb);

    setIsRunning(true);
    setStatusMessage(`Executing query on [${conn?.name || 'db'}] / [${targetDb}]...`);
    try {
      const execId = 'exec-' + Date.now();
      const res = await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: targetConnId,
        database: targetDb,
        schema: targetSchema,
        sql,
        limit: 500,
        offset: 0,
      } as any);

      setQueryResult(res as any);
      setStatusMessage(
        `[${targetDb}] Completed in ${res?.elapsedMs || 0}ms (${res?.rowsAffected || res?.rows?.length || 0} rows)`
      );
      setActiveBottomTab('result');
    } catch (e: any) {
      setStatusMessage(`[${targetDb}] Error: ${e?.message || String(e)}`);
      setQueryResult({
        executionId: '',
        columns: [],
        rows: [],
        rowsAffected: 0,
        elapsedMs: 0,
        hasMore: false,
        error: e?.message || String(e),
      });
      setActiveBottomTab('result');
    } finally {
      setIsRunning(false);
    }
  };

  const handlePreviewChanges = async () => {
    if (!activeTab || activeTab.type !== 'table_data' || !activeConnectionId) return;
    const staged = useGridEditStore.getState().stagedByTab[activeTab.id] || {};
    const changeList = Object.values(staged);
    if (changeList.length === 0) return;

    try {
      const sqls = await QueryService.PreviewChanges(
        activeConnectionId,
        activeTab.database || activeTab.schema || 'main',
        activeTab.table || '',
        changeList as any
      );
      setDmlPreview(sqls ?? []);
    } catch (e: any) {
      alert('Failed to preview SQL: ' + (e?.message || String(e)));
    }
  };

  const handleSubmitChanges = async () => {
    if (!activeTab || activeTab.type !== 'table_data' || !activeConnectionId) return;
    const staged = useGridEditStore.getState().stagedByTab[activeTab.id] || {};
    const changeList = Object.values(staged);
    if (changeList.length === 0) return;

    try {
      const affected = await QueryService.SubmitChanges(
        activeConnectionId,
        activeTab.database || activeTab.schema || 'main',
        activeTab.table || '',
        changeList as any
      );
      alert(`Successfully applied ${affected} change(s)!`);
      useGridEditStore.getState().revertTabChanges(activeTab.id);
      // Refresh table data
      if (activeTab.table) {
        loadTableData(activeTab);
      }
    } catch (e: any) {
      alert('Submit failed: ' + (e?.message || String(e)));
    }
  };

  const currentConn = connections.find((c) => c.id === activeConnectionId);

  return (
    <div className="flex h-screen w-screen flex-col bg-[#121317] text-zinc-300 font-sans select-none overflow-hidden">
      {/* Top Titlebar / Islands Header */}
      <header className="flex h-11 items-center justify-between border-b border-[#272932] px-4 bg-[#14151a]">
        <div className="flex items-center gap-3">
          <DHubLogo variant="full" size={26} />

          <div className="h-4 w-[1px] bg-[#272932]" />

          {/* Quick Active Connection Indicator */}
          <div
            onClick={() => setConnectionDialogOpen(true, activeConnectionId)}
            className="flex items-center gap-1.5 rounded bg-[#1e2027] px-2.5 py-1 text-xs border border-[#272932] cursor-pointer hover:border-zinc-500 transition-colors"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: currentConn?.colorTag || '#71717a' }}
            />
            <span className="font-medium text-zinc-200">
              {currentConn ? currentConn.name : 'Select Connection'}
            </span>
            <ChevronDown className="h-3 w-3 text-zinc-500" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle Consoles Panel Button */}
          <button
            onClick={toggleRightPanel}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs border transition-colors cursor-pointer ${
              isRightPanelOpen
                ? 'bg-blue-600/20 border-blue-500 text-blue-300 font-medium'
                : 'bg-[#1e2027] border-[#272932] text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
            }`}
            title="Toggle Consoles List Panel"
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>Consoles</span>
            <span className="rounded bg-[#2a2d37] px-1 text-[10px] font-mono">
              {consoles.length}
            </span>
          </button>

          {/* Search Everywhere Trigger */}
          <button
            onClick={() => setSearchEverywhereOpen(true)}
            className="flex items-center gap-2 rounded bg-[#1e2027] px-3 py-1 text-xs text-zinc-400 border border-[#272932] hover:border-zinc-500 hover:text-zinc-200 cursor-pointer shadow-xs"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search Everywhere</span>
            <kbd className="rounded bg-[#2a2d37] px-1 text-[10px] text-zinc-400 font-mono">
              {searchShortcutLabel}
            </kbd>
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left Sidebar: Database Explorer */}
        <div className="w-64 min-w-48 max-w-80 h-full shrink-0">
          <DatabaseExplorer />
        </div>

        {/* Center Workbench: Tabs + Editor/Grid + Services Bottom Panel */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#14151a]">
          {/* Tab Bar */}
          <div className="flex h-9 items-center border-b border-[#272932] bg-[#121317] px-2 gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                onContextMenu={(e) => handleTabContextMenu(e, tab)}
                className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs cursor-pointer border-t-2 transition-colors ${
                  activeTabId === tab.id
                    ? 'bg-[#191a20] border-blue-500 text-white font-medium'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#191a20]/50'
                }`}
              >
                {tab.type === 'worksheet' ? (
                  <FileCode className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                ) : (
                  <Table className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                )}
                <span
                  onDoubleClick={() => handleOpenRename(tab.id, tab.title)}
                  className="truncate max-w-[140px]"
                  title={`${tab.title} (Double-click or right-click to rename)`}
                >
                  {tab.title}
                </span>
                {tabs.length > 1 && (
                  <X
                    className="h-3 w-3 text-zinc-500 hover:text-white ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Active Tab View */}
          <div className="flex-1 min-h-0 flex flex-col">
            {activeTab?.type === 'worksheet' ? (
              <div className="flex-1 min-h-0">
                <SqlWorksheet
                  sql={activeTab.content || ''}
                  connectionId={activeTab.connectionId || activeConnectionId || ''}
                  connections={connections}
                  database={
                    activeTab.database ||
                    connections.find((c) => c.id === (activeTab.connectionId || activeConnectionId))?.databaseName ||
                    'main'
                  }
                  schema={activeTab.schema || 'public'}
                  availableDatabases={
                    treeDatabases[activeTab.connectionId || activeConnectionId || ''] ||
                    (connections.find((c) => c.id === (activeTab.connectionId || activeConnectionId))?.databaseName
                      ? [connections.find((c) => c.id === (activeTab.connectionId || activeConnectionId))!.databaseName!]
                      : ['main'])
                  }
                  isRunning={isRunning}
                  onChange={(val) => updateTabContent(activeTab.id, val)}
                  onExecute={handleExecuteQuery}
                  onCancel={() => setIsRunning(false)}
                  onDatabaseChange={(newDb) => {
                    const connId = activeTab.connectionId || activeConnectionId || '';
                    const conn = connections.find((c) => c.id === connId);
                    const targetSchema = conn?.driver === 'postgres' ? 'public' : newDb;
                    updateTabDatabase(activeTab.id, newDb, targetSchema);
                  }}
                  onConnectionChange={(newConnId) => {
                    const conn = connections.find((c) => c.id === newConnId);
                    const defaultDb = conn?.databaseName || treeDatabases[newConnId]?.[0] || 'main';
                    const defaultSchema = conn?.driver === 'postgres' ? 'public' : defaultDb;
                    updateTabConnection(activeTab.id, newConnId, defaultDb, defaultSchema);
                    if (!treeDatabases[newConnId]) {
                      SchemaService.GetDatabases(newConnId)
                        .then((dbs) => {
                          if (dbs) setTreeDatabases(newConnId, dbs);
                        })
                        .catch(() => {});
                    }
                  }}
                />
              </div>
            ) : activeTab?.type === 'table_data' ? (
              <div className="flex-1 min-h-0 flex flex-col">
                {/* Table Tab Bar with Table Name, Database, and Refresh Button */}
                <div className="flex h-9 items-center justify-between border-b border-[#272932] px-3 bg-[#14151a]">
                  <div className="flex items-center gap-2">
                    <Table className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="font-semibold text-xs text-white">{activeTab.table}</span>
                    <span className="text-zinc-600">/</span>
                    <span className="font-mono text-[11px] text-zinc-400">{activeTab.database || 'main'}</span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-[11px] text-zinc-500 font-mono">
                      {tableDataByTab[activeTab.id]?.rows?.length ?? 0} rows
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => loadTableData(activeTab)}
                      disabled={tableDataByTab[activeTab.id]?.isLoading}
                      className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs text-zinc-400 hover:text-white hover:bg-[#22242c] transition-colors cursor-pointer"
                      title="Reload Table Data"
                    >
                      <RefreshCw className={`h-3 w-3 ${tableDataByTab[activeTab.id]?.isLoading ? 'animate-spin' : ''}`} />
                      <span>Reload</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0">
                  {tableDataByTab[activeTab.id]?.isLoading && (!tableDataByTab[activeTab.id]?.rows || tableDataByTab[activeTab.id]?.rows.length === 0) ? (
                    <div className="flex h-full items-center justify-center text-xs text-zinc-400 gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-blue-400" />
                      <span>Loading rows from `{activeTab.table}`...</span>
                    </div>
                  ) : tableDataByTab[activeTab.id]?.error ? (
                    <div className="p-4 m-4 text-xs font-mono text-rose-400 bg-rose-950/20 rounded border border-rose-900/40">
                      Failed to load table: {tableDataByTab[activeTab.id]?.error}
                    </div>
                  ) : (
                    <DataGrid
                      tabId={activeTab.id}
                      columns={tableDataByTab[activeTab.id]?.columns || []}
                      rows={tableDataByTab[activeTab.id]?.rows || []}
                      primaryKeys={tableDataByTab[activeTab.id]?.primaryKeys || []}
                      onSubmitChanges={handleSubmitChanges}
                      onPreviewChanges={handlePreviewChanges}
                    />
                  )}
                </div>
              </div>
            ) : null}

            {/* Bottom Services Panel (Result / Output / Status) */}
            {isBottomPanelOpen && (
              <div className="h-64 border-t border-[#272932] flex flex-col bg-[#191a20]">
                {/* Services Bar */}
                <div className="flex h-8 items-center justify-between border-b border-[#272932] px-3 bg-[#14151a]">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setActiveBottomTab('result')}
                      className={`text-xs pb-1 border-b-2 font-medium cursor-pointer ${
                        activeBottomTab === 'result'
                          ? 'border-blue-500 text-white'
                          : 'border-transparent text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      Query Result
                    </button>
                    <button
                      onClick={() => setActiveBottomTab('output')}
                      className={`text-xs pb-1 border-b-2 font-medium cursor-pointer ${
                        activeBottomTab === 'output'
                          ? 'border-blue-500 text-white'
                          : 'border-transparent text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      Output Log
                    </button>
                  </div>
                  <button
                    onClick={toggleBottomPanel}
                    className="text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer"
                  >
                    Minimize
                  </button>
                </div>

                {/* Bottom Panel Content */}
                <div className="flex-1 min-h-0 overflow-auto p-2">
                  {activeBottomTab === 'result' ? (
                    queryResult?.error ? (
                      <div className="p-4 text-xs font-mono text-rose-400 bg-rose-950/20 rounded border border-rose-900/40">
                        {queryResult.error}
                      </div>
                    ) : (
                      <DataGrid
                        tabId="bottom-result"
                        columns={queryResult?.columns || []}
                        rows={queryResult?.rows || []}
                        onSubmitChanges={handleSubmitChanges}
                        onPreviewChanges={handlePreviewChanges}
                      />
                    )
                  ) : (
                    <div className="p-3 font-mono text-xs text-zinc-400 space-y-1">
                      <div>[{new Date().toLocaleTimeString()}] Status: {statusMessage}</div>
                      {queryResult && (
                        <div>
                          [{new Date().toLocaleTimeString()}] Rows returned: {queryResult.rows?.length || 0} (took {queryResult.elapsedMs}ms)
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar: Query Consoles List */}
        {isRightPanelOpen && (
          <div className="w-64 min-w-56 max-w-80 h-full border-l border-[#272932] shrink-0">
            <ConsoleList onRename={handleOpenRename} />
          </div>
        )}
      </div>

      {/* Floating Tab Context Menu */}
      {tabContextMenu.isOpen && tabContextMenu.tab && (
        <div
          className="fixed z-50 min-w-[190px] rounded-lg border border-[#2e313d] bg-[#181920]/95 backdrop-blur-md p-1 shadow-2xl text-[12px] text-zinc-300 select-none animate-in fade-in zoom-in-95 duration-100"
          style={{ top: tabContextMenu.y, left: tabContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-[#272932] mb-1 truncate flex items-center gap-1.5">
            {tabContextMenu.tab.type === 'worksheet' ? (
              <FileCode className="h-3 w-3 text-blue-400" />
            ) : (
              <Table className="h-3 w-3 text-emerald-400" />
            )}
            <span className="truncate">{tabContextMenu.tab.title}</span>
          </div>

          <button
            type="button"
            onClick={() => {
              const tab = tabContextMenu.tab!;
              setTabContextMenu((prev) => ({ ...prev, isOpen: false }));
              handleOpenRename(tab.id, tab.title);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <Pencil className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
            <span>Rename Tab...</span>
          </button>

          {tabContextMenu.tab.type === 'worksheet' && (
            <>
              <button
                type="button"
                onClick={() => {
                  const tab = tabContextMenu.tab!;
                  setTabContextMenu((prev) => ({ ...prev, isOpen: false }));
                  duplicateTab(tab.id);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Duplicate Console</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const content = tabContextMenu.tab!.content || '';
                  setTabContextMenu((prev) => ({ ...prev, isOpen: false }));
                  navigator.clipboard.writeText(content).catch(() => {});
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Copy SQL</span>
              </button>
            </>
          )}

          {tabContextMenu.tab.type === 'table_data' && (
            <button
              type="button"
              onClick={() => {
                const tab = tabContextMenu.tab!;
                setTabContextMenu((prev) => ({ ...prev, isOpen: false }));
                loadTableData(tab);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
            >
              <RefreshCw className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
              <span>Reload Data</span>
            </button>
          )}

          <div className="my-1 border-t border-[#272932]" />

          <button
            type="button"
            onClick={() => {
              const tabId = tabContextMenu.tab!.id;
              setTabContextMenu((prev) => ({ ...prev, isOpen: false }));
              closeTab(tabId);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
          >
            <X className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
            <span>Close Tab</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const tabId = tabContextMenu.tab!.id;
              setTabContextMenu((prev) => ({ ...prev, isOpen: false }));
              closeTabsMatching((t) => t.id !== tabId);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[#22242c] hover:text-zinc-200 text-zinc-400 transition-colors text-left cursor-pointer group"
          >
            <X className="h-3.5 w-3.5 text-zinc-500 group-hover:text-white" />
            <span>Close Other Tabs</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTabContextMenu((prev) => ({ ...prev, isOpen: false }));
              closeTabsMatching(() => false);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[#22242c] hover:text-zinc-200 text-zinc-400 transition-colors text-left cursor-pointer group"
          >
            <X className="h-3.5 w-3.5 text-zinc-500 group-hover:text-white" />
            <span>Close All Tabs</span>
          </button>
        </div>
      )}

      {/* Rename Modal Dialog */}
      {renameModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <div className="w-80 rounded-lg bg-[#191a20] border border-[#272932] p-4 text-xs text-zinc-300 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#272932]">
              <span className="font-semibold text-sm text-zinc-100 flex items-center gap-1.5">
                <Pencil className="h-4 w-4 text-blue-400" />
                Rename Tab / Console
              </span>
              <button
                onClick={() => setRenameModal({ isOpen: false, id: '', title: '' })}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleRenameSubmit}>
              <label className="block text-[11px] text-zinc-400 mb-1.5 font-medium">
                New Name:
              </label>
              <input
                type="text"
                value={renameModal.title}
                onChange={(e) => setRenameModal((prev) => ({ ...prev, title: e.target.value }))}
                className="w-full rounded bg-[#121317] px-2.5 py-1.5 text-xs text-zinc-100 border border-[#272932] focus:border-blue-500 focus:outline-none"
                autoFocus
                onFocus={(e) => e.target.select()}
              />
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setRenameModal({ isOpen: false, id: '', title: '' })}
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
      )}

      {/* DML Preview Modal */}
      {dmlPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <div className="w-[600px] rounded-lg bg-[#191a20] border border-[#272932] p-4 text-xs text-zinc-300 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#272932] pb-2 mb-3">
              <span className="font-semibold text-sm text-zinc-100">Pending DML Statements</span>
              <button onClick={() => setDmlPreview(null)} className="text-zinc-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="p-3 bg-[#121317] rounded border border-[#272932] font-mono text-xs text-emerald-400 max-h-60 overflow-auto">
              {dmlPreview.join('\n\n')}
            </pre>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setDmlPreview(null)}
                className="px-3 py-1.5 rounded border border-[#272932] hover:bg-[#22242c]"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setDmlPreview(null);
                  handleSubmitChanges();
                }}
                className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm"
              >
                Execute DML
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <ConnectionDialog />
      <SearchEverywhere />

      {/* Status Bar */}
      <footer className="flex h-6 items-center justify-between border-t border-[#272932] px-3 text-[11px] bg-[#121317] text-zinc-500 font-mono">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {statusMessage}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span>Tx: AUTO</span>
          <span>DHub Desktop v0.1.0</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
