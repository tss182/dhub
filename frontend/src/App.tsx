import React, { useState, useEffect } from 'react';
import { useWorkbenchStore } from './stores/useWorkbenchStore';
import { useConnectionStore } from './stores/useConnectionStore';
import { useGridEditStore } from './stores/useGridEditStore';
import { QueryService, SchemaService } from '../bindings/dhub/internal/services';
import { DatabaseExplorer } from './components/layout/DatabaseExplorer';
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
  ChevronDown
} from 'lucide-react';
import { QueryResult } from './types/domain';

export function App() {
  const {
    tabs,
    activeTabId,
    activeBottomTab,
    isBottomPanelOpen,
    openTab,
    closeTab,
    setActiveTabId,
    updateTabContent,
    setActiveBottomTab,
    toggleBottomPanel,
    setSearchEverywhereOpen,
    setConnectionDialogOpen,
  } = useWorkbenchStore();

  const { activeConnectionId, activeDatabase, activeSchema, connections } = useConnectionStore();
  const [isRunning, setIsRunning] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [dmlPreview, setDmlPreview] = useState<string[] | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Global Keyboard shortcuts: Double Shift for Search Everywhere, Ctrl+Enter to Run
  useEffect(() => {
    let lastShiftPress = 0;
    const handleKeyDown = (e: KeyboardEvent) => {
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

  const handleExecuteQuery = async (sql: string) => {
    if (!activeConnectionId) {
      alert('Please select or add a connection in Database Explorer first!');
      return;
    }
    setIsRunning(true);
    setStatusMessage('Executing query...');
    try {
      const execId = 'exec-' + Date.now();
      const res = await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: activeConnectionId,
        database: activeDatabase || 'main',
        schema: activeSchema || 'main',
        sql,
        limit: 500,
        offset: 0,
      } as any);

      setQueryResult(res as any);
      setStatusMessage(`Completed in ${res?.elapsedMs || 0}ms (${res?.rowsAffected || res?.rows?.length || 0} rows)`);
      setActiveBottomTab('result');
    } catch (e: any) {
      setStatusMessage(`Error: ${e?.message || String(e)}`);
      setQueryResult({
        executionId: '',
        columns: [],
        rows: [],
        rowsAffected: 0,
        elapsedMs: 0,
        hasMore: false,
        error: e?.message || String(e),
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handlePreviewChanges = async () => {
    if (!activeTab || !activeConnectionId) return;
    const stagedChanges = useGridEditStore.getState().stagedByTab[activeTab.id] || {};
    const changeList = Object.values(stagedChanges);
    try {
      const sqls = await QueryService.PreviewChanges(
        activeConnectionId,
        activeTab.schema || 'main',
        activeTab.table || '',
        changeList as any
      );
      setDmlPreview(sqls);
    } catch (e: any) {
      alert('Preview failed: ' + (e?.message || String(e)));
    }
  };

  const handleSubmitChanges = async () => {
    if (!activeTab || !activeConnectionId) return;
    const stagedChanges = useGridEditStore.getState().stagedByTab[activeTab.id] || {};
    const changeList = Object.values(stagedChanges);
    try {
      const affected = await QueryService.SubmitChanges(
        activeConnectionId,
        activeTab.schema || 'main',
        activeTab.table || '',
        changeList as any
      );
      alert(`Successfully applied ${affected} change(s)!`);
      useGridEditStore.getState().revertTabChanges(activeTab.id);
      // Refresh table data
      if (activeTab.table) {
        handleExecuteQuery(`SELECT * FROM "${activeTab.table}" LIMIT 500;`);
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
            onClick={() => setConnectionDialogOpen(true)}
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

        {/* Search Everywhere Trigger */}
        <button
          onClick={() => setSearchEverywhereOpen(true)}
          className="flex items-center gap-2 rounded bg-[#1e2027] px-3 py-1 text-xs text-zinc-400 border border-[#272932] hover:border-zinc-500 hover:text-zinc-200 cursor-pointer shadow-xs"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search Everywhere</span>
          <kbd className="rounded bg-[#2a2d37] px-1 text-[10px] text-zinc-400 font-mono">
            Shift × 2
          </kbd>
        </button>
      </header>

      {/* Main Workspace Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left Sidebar: Database Explorer */}
        <div className="w-64 min-w-48 max-w-80 h-full">
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs cursor-pointer border-t-2 transition-colors ${
                  activeTabId === tab.id
                    ? 'bg-[#191a20] border-blue-500 text-white font-medium'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#191a20]/50'
                }`}
              >
                {tab.type === 'worksheet' ? (
                  <FileCode className="h-3.5 w-3.5 text-blue-400" />
                ) : (
                  <Table className="h-3.5 w-3.5 text-emerald-400" />
                )}
                <span>{tab.title}</span>
                {tabs.length > 1 && (
                  <X
                    className="h-3 w-3 text-zinc-500 hover:text-white ml-1"
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
                  database={activeTab.database || activeDatabase}
                  schema={activeTab.schema || activeSchema}
                  isRunning={isRunning}
                  onChange={(val) => updateTabContent(activeTab.id, val)}
                  onExecute={handleExecuteQuery}
                  onCancel={() => setIsRunning(false)}
                />
              </div>
            ) : activeTab?.type === 'table_data' ? (
              <div className="flex-1 min-h-0">
                <DataGrid
                  tabId={activeTab.id}
                  columns={queryResult?.columns || []}
                  rows={queryResult?.rows || []}
                  onSubmitChanges={handleSubmitChanges}
                  onPreviewChanges={handlePreviewChanges}
                />
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
      </div>

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
