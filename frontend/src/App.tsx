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
import { SettingsModal } from './components/modals/SettingsModal';
import { useSettingsStore } from './stores/useSettingsStore';
import { DHubLogo } from './components/common/DHubLogo';
import {
  Database,
  Terminal,
  Search,
  Settings as SettingsIcon,
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
    hasLoadedConsoles,
    loadConsoles,
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
    setActiveConnection,
  } = useConnectionStore();
  const [isRunning, setIsRunning] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
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
        isLoadingMore: boolean;
        error: string | null;
        totalCount?: number;
        hasMore: boolean;
        pageSize: number;
        page: number;
        whereClause?: string;
        sortConfigs?: { column: string; direction: 'asc' | 'desc' }[];
      }
    >
  >({});

  // Query Result pagination & lazy load state
  const [queryPagination, setQueryPagination] = useState<{
    page: number;
    pageSize: number;
    isLoadingMore: boolean;
    lastSql: string;
    connectionId: string;
    database: string;
    schema: string;
  }>({
    page: 1,
    pageSize: useSettingsStore.getState().defaultPageSize || 100,
    isLoadingMore: false,
    lastSql: '',
    connectionId: '',
    database: '',
    schema: '',
  });

  // Bottom panel resizable height
  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(() => {
    const saved = localStorage.getItem('dhub_bottom_panel_h');
    return saved ? Math.max(120, Math.min(800, Number(saved))) : 280;
  });
  const [isDraggingBottomResizer, setIsDraggingBottomResizer] = useState(false);

  const handleBottomResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingBottomResizer(true);
    const startY = e.clientY;
    const startHeight = bottomPanelHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const maxH = Math.max(180, window.innerHeight - 160);
      const newHeight = Math.max(100, Math.min(maxH, startHeight + deltaY));
      setBottomPanelHeight(newHeight);
      localStorage.setItem('dhub_bottom_panel_h', String(newHeight));
    };

    const handleMouseUp = () => {
      setIsDraggingBottomResizer(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

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

      // Settings shortcut: Ctrl+, / Cmd+,
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        useSettingsStore.getState().toggleSettings();
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
    const targetTab = tabs.find((t) => t.id === id);
    if (targetTab && targetTab.type !== 'worksheet') return;
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

  const loadTableData = async (
    tab: WorkbenchTab,
    offset = 0,
    limit = useSettingsStore.getState().defaultPageSize || 100,
    append = false,
    page = 1,
    newWhereClause?: string,
    newSortConfigs?: { column: string; direction: 'asc' | 'desc' }[]
  ) => {
    const connId = tab.connectionId || activeConnectionId;
    if (!tab || tab.type !== 'table_data' || !connId || !tab.table) return;

    const prevTabData = tableDataByTab[tab.id];
    const whereClause = newWhereClause !== undefined ? newWhereClause : (prevTabData?.whereClause ?? '');
    const sortConfigs = newSortConfigs !== undefined ? newSortConfigs : (prevTabData?.sortConfigs ?? []);
    const filtersChanged = newWhereClause !== undefined;

    if (append) {
      setTableDataByTab((prev) => ({
        ...prev,
        [tab.id]: {
          ...prev[tab.id],
          isLoadingMore: true,
          error: null,
        },
      }));
    } else {
      setTableDataByTab((prev) => ({
        ...prev,
        [tab.id]: {
          columns: prev[tab.id]?.columns || [],
          rows: [],
          primaryKeys: prev[tab.id]?.primaryKeys || [],
          isLoading: true,
          isLoadingMore: false,
          error: null,
          totalCount: filtersChanged ? undefined : prev[tab.id]?.totalCount,
          hasMore: false,
          pageSize: limit,
          page,
          whereClause,
          sortConfigs,
        },
      }));
    }

    try {
      const conn = connections.find((c) => c.id === connId);
      const isMySQL = conn?.driver === 'mysql';
      const targetDb = tab.database || conn?.databaseName || 'main';
      const targetSchema = tab.schema || (conn?.driver === 'postgres' ? 'public' : targetDb);

      // 1. Fetch table structure for primary keys & detailed column definitions (size, nullability, comment, etc.)
      let primaryKeys: string[] = tableDataByTab[tab.id]?.primaryKeys || [];
      let structureColumns: ColumnMeta[] = tableDataByTab[tab.id]?.columns || [];
      if (primaryKeys.length === 0 || structureColumns.length === 0 || !structureColumns[0]?.dataType?.includes('(')) {
        try {
          const structure = await SchemaService.GetTableStructure(
            connId,
            targetDb,
            targetSchema,
            tab.table
          );
          if (structure) {
            if (structure.primaryKeys && structure.primaryKeys.length > 0) {
              primaryKeys = structure.primaryKeys;
            }
            if (structure.columns && structure.columns.length > 0) {
              structureColumns = structure.columns;
            }
          }
        } catch (structErr) {
          console.warn('Could not fetch structure for table:', structErr);
        }
      }

      const quotedTable = isMySQL ? `\`${tab.table}\`` : `"${tab.table}"`;
      const fullTablePath =
        conn?.driver === 'mysql' && targetDb && targetDb !== 'main'
          ? `\`${targetDb}\`.\`${tab.table}\``
          : conn?.driver === 'postgres' && targetSchema
          ? `"${targetSchema}"."${tab.table}"`
          : quotedTable;

      // 2. Build SQL WHERE clause
      const trimmedCustom = (whereClause || '').trim();
      const cleanCustom = trimmedCustom.replace(/^where\s+/i, '').trim();
      const combinedWhere = cleanCustom ? ` WHERE (${cleanCustom})` : '';

      // 2b. Build ORDER BY clause (multi-column sort: first added column has primary priority)
      let orderByClause = '';
      if (sortConfigs && sortConfigs.length > 0) {
        const orderParts = sortConfigs.map((sc) => {
          const quotedSortCol = isMySQL ? `\`${sc.column}\`` : `"${sc.column}"`;
          return `${quotedSortCol} ${sc.direction.toUpperCase()}`;
        });
        orderByClause = ` ORDER BY ${orderParts.join(', ')}`;
      }

      // 3. Fetch total row count in background (on initial load or when filters change)
      if (!append && (filtersChanged || tableDataByTab[tab.id]?.totalCount === undefined)) {
        QueryService.ExecuteQuery({
          executionId: 'exec-count-' + Date.now(),
          connectionId: connId,
          database: targetDb,
          schema: targetSchema,
          sql: `SELECT COUNT(*) FROM ${fullTablePath}${combinedWhere};`,
          limit: 1,
          offset: 0,
        } as any)
          .then((countRes) => {
            const countVal = countRes?.rows?.[0]?.[0];
            const num = typeof countVal === 'number' ? countVal : parseInt(String(countVal), 10);
            if (!isNaN(num) && num >= 0) {
              setTableDataByTab((prev) => ({
                ...prev,
                [tab.id]: {
                  ...prev[tab.id],
                  totalCount: num,
                },
              }));
            }
          })
          .catch((err) => {
            console.warn('Count query failed:', err);
          });
      }

      // 4. Query table data with LIMIT, OFFSET, WHERE and ORDER BY
      const fetchLimit = limit + 1;
      const sql = `SELECT * FROM ${fullTablePath}${combinedWhere}${orderByClause} LIMIT ${fetchLimit} OFFSET ${offset};`;

      const execId = 'exec-tab-' + Date.now();
      const res = await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: connId,
        database: targetDb,
        schema: targetSchema,
        sql,
        limit: fetchLimit,
        offset: 0,
      } as any);

      if (res) {
        const detectedPKs =
          primaryKeys.length > 0
            ? primaryKeys
            : (res.columns || []).filter((c: any) => (c as any).isPrimaryKey).map((c: any) => c.name);

        const rawRows = (res.rows as any) || [];
        const hasMore = rawRows.length > limit;
        const fetchedRows = hasMore ? rawRows.slice(0, limit) : rawRows;
        const currentEnd = offset + fetchedRows.length;

        // Merge columns: prefer structureColumns because they contain full types, size, nullable, comments, etc.
        let finalCols: ColumnMeta[] = (res.columns as any) || [];
        if (structureColumns.length > 0) {
          finalCols = finalCols.map((c) => {
            const found = structureColumns.find((sc) => sc.name.toLowerCase() === c.name.toLowerCase());
            if (found) {
              return {
                ...c,
                ...found,
                isPrimaryKey: detectedPKs.includes(c.name) || found.isPrimaryKey,
              };
            }
            return {
              ...c,
              isPrimaryKey: detectedPKs.includes(c.name),
            };
          });
        } else {
          finalCols = finalCols.map((c) => ({
            ...c,
            isPrimaryKey: detectedPKs.includes(c.name),
          }));
        }

        setTableDataByTab((prev) => {
          const prevRows = append ? prev[tab.id]?.rows || [] : [];
          const combinedRows = [...prevRows, ...fetchedRows];
          const prevTotal = prev[tab.id]?.totalCount;
          // If we reached the end (!hasMore), the total count is at least currentEnd
          const knownTotal = !hasMore
            ? Math.max(prevTotal || 0, currentEnd)
            : prevTotal !== undefined
            ? Math.max(prevTotal, currentEnd)
            : undefined;

          return {
            ...prev,
            [tab.id]: {
              columns: finalCols,
              rows: combinedRows,
              primaryKeys: detectedPKs,
              isLoading: false,
              isLoadingMore: false,
              error: null,
              totalCount: knownTotal,
              hasMore,
              pageSize: limit,
              page: append ? prev[tab.id]?.page || 1 : page,
              whereClause,
              sortConfigs,
            },
          };
        });
        const filterNotice = cleanCustom ? ' (filtered by WHERE condition)' : '';
        const sortNotice = sortConfigs.length > 0
          ? ` [sorted by: ${sortConfigs.map((s, idx) => `#${idx + 1} ${s.column} ${s.direction.toUpperCase()}`).join(', ')}]`
          : '';
        setStatusMessage(
          `Loaded ${fetchedRows.length} rows (${offset + fetchedRows.length} total) from ${tab.table}${filterNotice}${sortNotice}`
        );
      }
    } catch (e: any) {
      console.error(`Failed to load data for ${tab.table}:`, e);
      setTableDataByTab((prev) => ({
        ...prev,
        [tab.id]: {
          columns: prev[tab.id]?.columns || [],
          rows: prev[tab.id]?.rows || [],
          primaryKeys: prev[tab.id]?.primaryKeys || [],
          isLoading: false,
          isLoadingMore: false,
          error: e?.message || String(e),
          hasMore: false,
          pageSize: limit,
          page: append ? prev[tab.id]?.page || 1 : page,
          whereClause,
          sortConfigs,
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

  // Load saved consoles from SQLite on startup
  useEffect(() => {
    loadConsoles();
  }, [loadConsoles]);

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

  // Synchronize active connection & database in explorer when switching tabs
  useEffect(() => {
    if (activeTab && activeTab.connectionId) {
      setActiveConnection(
        activeTab.connectionId,
        activeTab.database || '',
        activeTab.schema || ''
      );
    }
  }, [activeTab?.id, activeTab?.database, activeTab?.schema, activeTab?.connectionId]);

  const handleExecuteQuery = async (sql: string, explicitDb?: string) => {
    const currentTab = useWorkbenchStore
      .getState()
      .tabs.find((t) => t.id === useWorkbenchStore.getState().activeTabId);
    const targetConnId = currentTab?.connectionId || useConnectionStore.getState().activeConnectionId;
    if (!targetConnId) {
      alert('Please select or add a connection in Database Explorer first!');
      return;
    }
    const currentConns = useConnectionStore.getState().connections;
    const conn = currentConns.find((c) => c.id === targetConnId);
    const connDbs = useConnectionStore.getState().treeDatabases[targetConnId] || [];
    const systemDbs = ['information_schema', 'performance_schema', 'mysql', 'sys'];
    const nonSystemDb = connDbs.find((d) => !systemDbs.includes(d.toLowerCase()));

    // explicitDb has top priority, then tab's database, then conn.databaseName, then nonSystemDb, then activeDatabase
    const targetDb =
      explicitDb ||
      currentTab?.database ||
      conn?.databaseName ||
      nonSystemDb ||
      (connDbs.length > 0 ? connDbs[0] : useConnectionStore.getState().activeDatabase) ||
      (conn?.driver === 'sqlite' ? 'main' : '');

    const targetSchema =
      currentTab?.schema ||
      useConnectionStore.getState().activeSchema ||
      (conn?.driver === 'postgres' ? 'public' : targetDb);

    setIsRunning(true);
    setStatusMessage(`Executing query on [${conn?.name || 'db'}] / [${targetDb}]...`);
    try {
      const execId = 'exec-' + Date.now();
      const defaultLimit = useSettingsStore.getState().defaultPageSize || 100;
      const res = await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: targetConnId,
        database: targetDb,
        schema: targetSchema,
        sql,
        limit: defaultLimit,
        offset: 0,
      } as any);

      setQueryResult(res as any);
      setActiveResultIndex(0);
      setQueryPagination({
        page: 1,
        pageSize: defaultLimit,
        isLoadingMore: false,
        lastSql: sql,
        connectionId: targetConnId,
        database: targetDb,
        schema: targetSchema,
      });
      const stmtCount = (res as any)?.results?.length || 1;
      if (stmtCount > 1) {
        setStatusMessage(
          `[${targetDb}] Executed ${stmtCount} statements in ${res?.elapsedMs || 0}ms`
        );
      } else {
        setStatusMessage(
          `[${targetDb}] Completed in ${res?.elapsedMs || 0}ms (${res?.rowsAffected || res?.rows?.length || 0} rows)`
        );
      }
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

  const handleQueryLoadMore = async () => {
    if (queryPagination.isLoadingMore || !queryResult || !queryPagination.lastSql) return;
    const currentRes =
      queryResult.results && queryResult.results[activeResultIndex]
        ? queryResult.results[activeResultIndex]
        : queryResult;
    const currentRows = currentRes?.rows || [];
    const limit = queryPagination.pageSize || useSettingsStore.getState().defaultPageSize || 100;
    const offset = currentRows.length;

    setQueryPagination((p) => ({ ...p, isLoadingMore: true }));
    try {
      const res = await QueryService.ExecuteQuery({
        executionId: 'exec-more-' + Date.now(),
        connectionId: queryPagination.connectionId,
        database: queryPagination.database,
        schema: queryPagination.schema,
        sql: queryPagination.lastSql,
        limit,
        offset,
      } as any);

      if (res) {
        const fetchedRows = res.rows || [];
        const combined = [...currentRows, ...fetchedRows];
        const hasMore = res.hasMore;

        setQueryResult((prev: any) => {
          if (!prev) return prev;
          if (prev.results && prev.results[activeResultIndex]) {
            const nextResults = [...prev.results];
            nextResults[activeResultIndex] = {
              ...nextResults[activeResultIndex],
              rows: combined,
              hasMore,
            };
            return {
              ...prev,
              results: nextResults,
              rows: combined,
              hasMore,
            };
          }
          return {
            ...prev,
            rows: combined,
            hasMore,
          };
        });
        setStatusMessage(`Loaded +${fetchedRows.length} more rows (${combined.length} total)`);
      }
    } catch (e: any) {
      setStatusMessage(`Error loading more rows: ${e?.message || String(e)}`);
    } finally {
      setQueryPagination((p) => ({ ...p, isLoadingMore: false }));
    }
  };

  const handleQueryPageChange = async (newPage: number) => {
    if (queryPagination.isLoadingMore || !queryResult || !queryPagination.lastSql) return;
    const limit = queryPagination.pageSize || useSettingsStore.getState().defaultPageSize || 100;
    const offset = (newPage - 1) * limit;

    setQueryPagination((p) => ({ ...p, page: newPage, isLoadingMore: true }));
    try {
      const res = await QueryService.ExecuteQuery({
        executionId: 'exec-page-' + Date.now(),
        connectionId: queryPagination.connectionId,
        database: queryPagination.database,
        schema: queryPagination.schema,
        sql: queryPagination.lastSql,
        limit,
        offset,
      } as any);

      if (res) {
        const fetchedRows = res.rows || [];
        const hasMore = res.hasMore;

        setQueryResult((prev: any) => {
          if (!prev) return prev;
          if (prev.results && prev.results[activeResultIndex]) {
            const nextResults = [...prev.results];
            nextResults[activeResultIndex] = {
              ...nextResults[activeResultIndex],
              rows: fetchedRows,
              hasMore,
            };
            return {
              ...prev,
              results: nextResults,
              rows: fetchedRows,
              hasMore,
            };
          }
          return {
            ...prev,
            rows: fetchedRows,
            hasMore,
          };
        });
        setStatusMessage(`Page ${newPage}: Loaded ${fetchedRows.length} rows`);
      }
    } catch (e: any) {
      setStatusMessage(`Error loading page ${newPage}: ${e?.message || String(e)}`);
    } finally {
      setQueryPagination((p) => ({ ...p, isLoadingMore: false }));
    }
  };

  const handleQueryPageSizeChange = async (newSize: number) => {
    if (!queryResult || !queryPagination.lastSql) return;
    setQueryPagination((p) => ({ ...p, pageSize: newSize, page: 1, isLoadingMore: true }));
    try {
      const res = await QueryService.ExecuteQuery({
        executionId: 'exec-size-' + Date.now(),
        connectionId: queryPagination.connectionId,
        database: queryPagination.database,
        schema: queryPagination.schema,
        sql: queryPagination.lastSql,
        limit: newSize,
        offset: 0,
      } as any);

      if (res) {
        const fetchedRows = res.rows || [];
        const hasMore = res.hasMore;

        setQueryResult((prev: any) => {
          if (!prev) return prev;
          if (prev.results && prev.results[activeResultIndex]) {
            const nextResults = [...prev.results];
            nextResults[activeResultIndex] = {
              ...nextResults[activeResultIndex],
              rows: fetchedRows,
              hasMore,
            };
            return {
              ...prev,
              results: nextResults,
              rows: fetchedRows,
              hasMore,
            };
          }
          return {
            ...prev,
            rows: fetchedRows,
            hasMore,
          };
        });
        setStatusMessage(`Batch size changed to ${newSize} rows`);
      }
    } catch (e: any) {
      setStatusMessage(`Error changing batch size: ${e?.message || String(e)}`);
    } finally {
      setQueryPagination((p) => ({ ...p, isLoadingMore: false }));
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

          {/* Settings Trigger */}
          <button
            onClick={() => useSettingsStore.getState().openSettings()}
            className="flex items-center gap-1.5 rounded bg-[#1e2027] px-2.5 py-1 text-xs text-zinc-400 border border-[#272932] hover:border-zinc-500 hover:text-zinc-200 cursor-pointer shadow-xs transition-colors"
            title="Open Settings & Preferences (Ctrl+,)"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            <span>Settings</span>
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
          <div
            onWheel={(e) => {
              if (e.deltaY !== 0 || e.deltaX !== 0) {
                e.currentTarget.scrollLeft += (e.deltaY !== 0 ? e.deltaY : -e.deltaX);
              }
            }}
            className="flex h-9 items-center border-b border-[#272932] bg-[#121317] px-2 gap-1 overflow-x-auto"
          >
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
                  onDoubleClick={tab.type === 'worksheet' ? () => handleOpenRename(tab.id, tab.title) : undefined}
                  className="truncate max-w-[140px]"
                  title={tab.type === 'worksheet' ? `${tab.title} (Double-click or right-click to rename)` : tab.title}
                >
                  {tab.title}
                </span>
                <X
                  className="h-3 w-3 text-zinc-500 hover:text-white ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                />
              </div>
            ))}
          </div>

          {/* Active Tab View */}
          <div className="flex-1 min-h-0 flex flex-col">
            {activeTab?.type === 'worksheet' ? (() => {
              const tabConn = connections.find((c) => c.id === (activeTab.connectionId || activeConnectionId));
              const tabConnDbs = treeDatabases[tabConn?.id || ''] || [];
              const systemDbs = ['information_schema', 'performance_schema', 'mysql', 'sys'];
              const nonSystemDb = tabConnDbs.find((d) => !systemDbs.includes(d.toLowerCase()));
              const effectiveDb =
                activeTab.database ||
                tabConn?.databaseName ||
                nonSystemDb ||
                (tabConnDbs.length > 0 ? tabConnDbs[0] : (tabConn?.driver === 'sqlite' ? 'main' : ''));
              const effectiveSchema = activeTab.schema || (tabConn?.driver === 'postgres' ? 'public' : effectiveDb);
              const availableDbs =
                tabConnDbs.length > 0
                  ? tabConnDbs
                  : (tabConn?.databaseName ? [tabConn.databaseName] : (tabConn?.driver === 'sqlite' ? ['main'] : []));

              return (
                <div className="flex-1 min-h-0">
                  <SqlWorksheet
                    sql={activeTab.content || ''}
                    connection={tabConn}
                    database={effectiveDb}
                    schema={effectiveSchema}
                    availableDatabases={availableDbs}
                    isRunning={isRunning}
                    onChange={(val) => updateTabContent(activeTab.id, val)}
                    onExecute={(sqlText, selectedDb) => handleExecuteQuery(sqlText, selectedDb || effectiveDb)}
                    onCancel={() => setIsRunning(false)}
                    onDatabaseChange={(newDb) => {
                      const currentTab = useWorkbenchStore
                        .getState()
                        .tabs.find((t) => t.id === useWorkbenchStore.getState().activeTabId);
                      const connId = currentTab?.connectionId || activeConnectionId || '';
                      const conn = connections.find((c) => c.id === connId);
                      const targetSchema = conn?.driver === 'postgres' ? 'public' : newDb;
                      if (currentTab) {
                        updateTabDatabase(currentTab.id, newDb, targetSchema);
                      }
                      setActiveConnection(connId, newDb, targetSchema);
                      setStatusMessage(`Switched database to [${newDb}] for [${conn?.name || 'connection'}]`);
                    }}
                  />
                </div>
              );
            })() : activeTab?.type === 'table_data' ? (
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
                      totalCount={tableDataByTab[activeTab.id]?.totalCount}
                      hasMore={tableDataByTab[activeTab.id]?.hasMore}
                      isLoadingMore={tableDataByTab[activeTab.id]?.isLoadingMore}
                      page={tableDataByTab[activeTab.id]?.page || 1}
                      pageSize={tableDataByTab[activeTab.id]?.pageSize || 100}
                      whereClause={tableDataByTab[activeTab.id]?.whereClause}
                      onApplyWhere={(whereText) => {
                        const currentSize = tableDataByTab[activeTab.id]?.pageSize || 100;
                        loadTableData(activeTab, 0, currentSize, false, 1, whereText);
                      }}
                      isTableTab={true}
                      sortConfigs={tableDataByTab[activeTab.id]?.sortConfigs || []}
                      onSortChange={(newSorts) => {
                        const currentSize = tableDataByTab[activeTab.id]?.pageSize || 100;
                        loadTableData(activeTab, 0, currentSize, false, 1, undefined, newSorts);
                      }}
                      onPageChange={(newPage) => {
                        const size = tableDataByTab[activeTab.id]?.pageSize || 100;
                        loadTableData(activeTab, (newPage - 1) * size, size, false, newPage);
                      }}
                      onPageSizeChange={(newSize) => {
                        loadTableData(activeTab, 0, newSize, false, 1);
                      }}
                      onLoadMore={() => {
                        const currentCount = tableDataByTab[activeTab.id]?.rows?.length || 0;
                        const currentSize = tableDataByTab[activeTab.id]?.pageSize || 100;
                        loadTableData(activeTab, currentCount, currentSize, true);
                      }}
                      onRefresh={() => {
                        const currentSize = tableDataByTab[activeTab.id]?.pageSize || 100;
                        loadTableData(activeTab, 0, currentSize, false, 1);
                      }}
                      onSubmitChanges={handleSubmitChanges}
                      onPreviewChanges={handlePreviewChanges}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500 select-none">
                <Terminal className="h-10 w-10 text-zinc-600 mb-3 stroke-[1.5]" />
                <h3 className="text-sm font-semibold text-zinc-300">No Open Tabs</h3>
                <p className="text-xs text-zinc-500 mt-1 max-w-sm">
                  Pilih table dari Database Explorer atau klik kanan koneksi untuk membuat Query Console.
                </p>
                <div className="flex items-center gap-2 mt-4 text-[11px] text-zinc-400">
                  <span className="rounded bg-[#1e2027] border border-[#272932] px-2 py-0.5 font-mono">{searchShortcutLabel}</span>
                  <span>Search Everywhere</span>
                </div>
              </div>
            )}

            {/* Splitter & Bottom Services Panel: Only shown on Query Console / SQL Worksheet */}
            {activeTab?.type === 'worksheet' && (
              <>
                {/* Splitter Resizer Handle between Console and Bottom Panel */}
                {isBottomPanelOpen && (
                  <div
                    onMouseDown={handleBottomResizerMouseDown}
                    onDoubleClick={() => {
                      const defaultH = 280;
                      setBottomPanelHeight(defaultH);
                      localStorage.setItem('dhub_bottom_panel_h', String(defaultH));
                    }}
                    className={`group h-2 w-full bg-[#1e2027] hover:bg-blue-600/90 cursor-row-resize transition-colors relative z-20 shrink-0 flex items-center justify-center border-t border-b border-[#272932] ${
                      isDraggingBottomResizer ? 'bg-blue-600' : ''
                    }`}
                    title="Drag to resize Result / Console (Double-click to reset)"
                  >
                    <div className="h-0.5 w-10 rounded-full bg-zinc-600 group-hover:bg-blue-200 transition-colors" />
                  </div>
                )}

                {/* Bottom Services Panel (Result / Output / Status) */}
                {isBottomPanelOpen ? (
                  <div
                    style={{ height: `${bottomPanelHeight}px` }}
                    className="flex flex-col bg-[#191a20] shrink-0"
                  >
                {/* Services Bar */}
                <div className="flex h-8 items-center justify-between border-b border-[#272932] px-3 bg-[#14151a]">
                  <div className="flex items-center gap-2 overflow-x-auto">
                    {queryResult?.results && queryResult.results.length > 1 ? (
                      queryResult.results.map((res: any, idx: number) => {
                        const isSelected = activeBottomTab === 'result' && activeResultIndex === idx;
                        const hasCols = res.columns && res.columns.length > 0;
                        const label = hasCols
                          ? `Result ${idx + 1} (${res.rows?.length || 0})`
                          : `Result ${idx + 1} (${res.rowsAffected || 0} aff)`;
                        return (
                          <button
                            key={idx}
                            onClick={() => {
                              setActiveBottomTab('result');
                              setActiveResultIndex(idx);
                            }}
                            className={`text-xs pb-1 border-b-2 font-medium cursor-pointer transition-colors whitespace-nowrap ${
                              isSelected
                                ? 'border-blue-500 text-white font-semibold'
                                : 'border-transparent text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })
                    ) : (
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
                    )}
                    <button
                      onClick={() => setActiveBottomTab('output')}
                      className={`text-xs pb-1 border-b-2 font-medium cursor-pointer whitespace-nowrap ${
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
                    className="text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer ml-2"
                  >
                    Minimize
                  </button>
                </div>

                {/* Bottom Panel Content */}
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  {activeBottomTab === 'result' ? (
                    queryResult?.error ? (
                      <div className="p-4 m-2 text-xs font-mono text-rose-400 bg-rose-950/20 rounded border border-rose-900/40 whitespace-pre-wrap overflow-auto">
                        {queryResult.error}
                      </div>
                    ) : (() => {
                      const currentRes =
                        queryResult?.results && queryResult.results[activeResultIndex]
                          ? queryResult.results[activeResultIndex]
                          : queryResult;
                      const hasCols = currentRes?.columns && currentRes.columns.length > 0;

                      if (!hasCols) {
                        return (
                          <div className="flex flex-1 flex-col items-center justify-center p-6 text-zinc-400 font-mono text-xs select-none">
                            <CheckCircle className="h-6 w-6 text-emerald-400 mb-2" />
                            <span className="font-semibold text-zinc-200">Statement executed successfully</span>
                            <span className="text-zinc-500 mt-1">
                              {currentRes?.rowsAffected ?? 0} rows affected ({currentRes?.elapsedMs ?? 0}ms)
                            </span>
                            {(currentRes as any)?.sql && (
                              <div className="mt-3 px-3 py-1.5 rounded bg-[#121317] border border-[#272932] text-zinc-400 text-[11px] max-w-xl truncate">
                                {(currentRes as any).sql}
                              </div>
                            )}
                          </div>
                        );
                      }

                      return (
                        <div className="flex-1 min-h-0">
                          <DataGrid
                            key={`result-grid-${activeResultIndex}-${queryResult?.executionId || ''}`}
                            tabId={`bottom-result-${activeResultIndex}`}
                            columns={currentRes.columns || []}
                            rows={currentRes.rows || []}
                            hasMore={currentRes.hasMore}
                            isLoadingMore={queryPagination.isLoadingMore}
                            page={queryPagination.page}
                            pageSize={queryPagination.pageSize}
                            onPageChange={handleQueryPageChange}
                            onPageSizeChange={handleQueryPageSizeChange}
                            onLoadMore={handleQueryLoadMore}
                            onRefresh={() => handleQueryPageChange(queryPagination.page)}
                            onSubmitChanges={handleSubmitChanges}
                            onPreviewChanges={handlePreviewChanges}
                          />
                        </div>
                      );
                    })()
                  ) : (
                    <div className="flex-1 min-h-0 overflow-auto p-3 font-mono text-xs text-zinc-400 space-y-2">
                      <div>[{new Date().toLocaleTimeString()}] Status: {statusMessage}</div>
                      {queryResult?.results && queryResult.results.length > 1 ? (
                        <div className="space-y-1.5 border-t border-[#272932] pt-2">
                          <div className="text-zinc-300 font-semibold">
                            Executed {queryResult.results.length} statements ({queryResult.elapsedMs}ms total):
                          </div>
                          {queryResult.results.map((res: any, idx: number) => (
                            <div key={idx} className="p-2 rounded bg-[#14151a] border border-[#272932] text-[11px]">
                              <div className="flex items-center justify-between text-zinc-300">
                                <span className="font-semibold text-blue-400">Statement #{idx + 1}</span>
                                <span className="text-zinc-500">{res.elapsedMs}ms</span>
                              </div>
                              <div className="text-zinc-400 truncate mt-0.5">{res.sql}</div>
                              <div className="text-zinc-500 text-[10px] mt-0.5">
                                {res.columns && res.columns.length > 0
                                  ? `${res.rows?.length || 0} rows returned`
                                  : `${res.rowsAffected || 0} rows affected`}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : queryResult ? (
                        <div>
                          [{new Date().toLocaleTimeString()}] Rows returned: {queryResult.rows?.length || 0} (took {queryResult.elapsedMs}ms)
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-7 border-t border-[#272932] bg-[#14151a] px-3 flex items-center justify-between text-xs text-zinc-400 shrink-0 select-none">
                <button
                  onClick={toggleBottomPanel}
                  className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors cursor-pointer text-[11px]"
                >
                  <Terminal className="h-3 w-3 text-blue-400" />
                  <span>Show Query Result / Services Panel</span>
                </button>
              </div>
            )}
          </>
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

          {tabContextMenu.tab.type === 'worksheet' && (
            <>
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

      {/* Resizing Backdrop Overlay */}
      {isDraggingBottomResizer && (
        <div className="fixed inset-0 z-50 cursor-row-resize select-none" />
      )}

      {/* Modals */}
      <ConnectionDialog />
      <SearchEverywhere />
      <SettingsModal />

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
