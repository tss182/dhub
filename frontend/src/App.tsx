import React, { useState, useEffect } from 'react';
import { useWorkbenchStore } from './stores/useWorkbenchStore';
import { useConnectionStore } from './stores/useConnectionStore';
import { useGridEditStore } from './stores/useGridEditStore';
import { QueryService, SchemaService, ConnectionService, WorkspaceService } from '../bindings/dhub/internal/services';
import { DatabaseExplorer } from './components/layout/DatabaseExplorer';
import { RightSidebar } from './components/layout/RightSidebar';
import { ConsoleList } from './components/layout/ConsoleList';
import { SqlWorksheet } from './components/editor/SqlWorksheet';
import { DataGrid } from './components/grid/DataGrid';
import { ConnectionDialog } from './components/modals/ConnectionDialog';
import { SearchEverywhere } from './components/modals/SearchEverywhere';
import { SettingsModal } from './components/modals/SettingsModal';
import { AlertModal } from './components/modals/AlertModal';
import { ToastContainer } from './components/common/ToastContainer';
import { TableStructureModal } from './components/modals/CreateTableModal';
import { useAlertStore, alertSuccess, alertError, alertWarning } from './stores/useAlertStore';
import { useSettingsStore } from './stores/useSettingsStore';
import { DHubLogo } from './components/common/DHubLogo';
import { APP_VERSION } from './version';
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
  ChevronsRight,
  RefreshCw,
  Pencil,
  Copy,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightOpen,
  Users,
} from 'lucide-react';
import { QueryResult, ColumnMeta, WorkbenchTab, resolveConnectionEnv } from './types/domain';
import { UserManager } from './components/users/UserManager';

export function App() {
  const {
    tabs,
    activeTabId,
    activeBottomTab,
    isBottomPanelOpen,
    isRightPanelOpen,
    activeRightSidebarTab,
    setActiveRightSidebarTab,
    setRightPanelOpen,
    isLeftPanelOpen,
    consoles,
    hasLoadedConsoles,
    loadConsoles,
    openTab,
    closeTab,
    closeTabsMatching,
    setActiveTabId,
    reorderTab,
    swapTabs,
    updateTabContent,
    updateTabDatabase,
    updateTabConnection,
    renameTab,
    duplicateTab,
    setActiveBottomTab,
    toggleBottomPanel,
    toggleRightPanel,
    toggleLeftPanel,
    setSearchEverywhereOpen,
    setConnectionDialogOpen,
    tabRefreshTrigger,
    tableStructureModal,
    openEditTableModal,
    closeTableStructureModal,
  } = useWorkbenchStore();

  const {
    activeConnectionId,
    activeDatabase,
    activeSchema,
    connections,
    setConnections,
    treeDatabases,
    visibleDatabases,
    setTreeDatabases,
    setActiveConnection,
  } = useConnectionStore();
  const [isRunning, setIsRunning] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [dmlPreview, setDmlPreview] = useState<string[] | null>(null);
  const [copiedResultRawSql, setCopiedResultRawSql] = useState(false);

  const handleCopyResultRawSql = async (rawSql: string) => {
    if (!rawSql) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(rawSql);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = rawSql;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedResultRawSql(true);
      setTimeout(() => setCopiedResultRawSql(false), 2000);
    } catch (_) {}
  };

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

  // Left & Right sidebar resizable widths
  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('dhub_left_sidebar_w');
    return saved ? Math.max(180, Math.min(600, Number(saved))) : 256;
  });
  const [isDraggingLeftResizer, setIsDraggingLeftResizer] = useState(false);

  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('dhub_right_sidebar_w');
    return saved ? Math.max(180, Math.min(1000, Number(saved))) : 280;
  });
  const [isDraggingRightResizer, setIsDraggingRightResizer] = useState(false);

  // Hovered workbench tab popover state
  const [hoveredTab, setHoveredTab] = useState<{
    tab: WorkbenchTab;
    connName?: string;
    x: number;
    y: number;
  } | null>(null);
  const tabHoverTimeoutRef = React.useRef<any>(null);

  // Overflow tabs (>> count) & dropdown state (no horizontal scrolling; only fitting tabs shown in tab bar)
  const tabBarContainerRef = React.useRef<HTMLDivElement | null>(null);
  const tabDropdownRef = React.useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState<number>(() => Math.max(1, tabs.length));
  const [isTabDropdownOpen, setIsTabDropdownOpen] = useState(false);
  const [tabDropdownSearch, setTabDropdownSearch] = useState('');
  const [tabDropdownSelectedIndex, setTabDropdownSelectedIndex] = useState(0);
  const [hoveredDropdownTab, setHoveredDropdownTab] = useState<{
    tab: WorkbenchTab;
    connName?: string;
    x: number;
    y: number;
  } | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [tabDropTarget, setTabDropTarget] = useState<{
    id: string;
    position: 'before' | 'after';
  } | null>(null);

  const [copiedSchemaTabId, setCopiedSchemaTabId] = useState<string | null>(null);
  const handleCopyCurrentTableSchema = async (tab: WorkbenchTab) => {
    if (!tab.connectionId || !tab.table) return;
    try {
      const struct = await SchemaService.GetTableStructure(
        tab.connectionId,
        tab.database || 'main',
        tab.schema || 'main',
        tab.table
      );
      const ddl = struct?.ddl || '';
      if (ddl) {
        await navigator.clipboard.writeText(ddl);
        setCopiedSchemaTabId(tab.id);
        setTimeout(() => setCopiedSchemaTabId(null), 1500);
        alertSuccess(`Schema (DDL) for "${tab.table}" copied to clipboard`);
      } else {
        alertWarning(`No DDL schema available for "${tab.table}"`);
      }
    } catch (err: any) {
      alertError('Failed to copy table schema: ' + (err?.message || String(err)));
    }
  };

  const updateOverflowTabs = React.useCallback(() => {
    const bar = tabBarContainerRef.current;
    if (!bar || tabs.length === 0) {
      setVisibleCount(0);
      return;
    }

    const totalBarWidth = bar.clientWidth;
    if (totalBarWidth <= 0) return;

    const paddingX = 12; // px-1.5 (6px left + 6px right)
    const gap = 4; // gap-1 (4px)
    const triggerButtonReserve = 44; // space for >> {{count}} button
    const tabSlotWidth = 124; // max-w-[124px] per tab

    const maxWithoutTrigger = Math.max(
      1,
      Math.floor((totalBarWidth - paddingX + gap) / (tabSlotWidth + gap))
    );

    if (tabs.length <= maxWithoutTrigger) {
      setVisibleCount(tabs.length);
      return;
    }

    const maxAvail = Math.max(tabSlotWidth, totalBarWidth - triggerButtonReserve - paddingX);
    const countWithTrigger = Math.min(
      tabs.length - 1,
      Math.max(1, Math.floor((maxAvail + gap) / (tabSlotWidth + gap)))
    );
    setVisibleCount(countWithTrigger);
  }, [tabs.length]);

  useEffect(() => {
    updateOverflowTabs();
    const raf = requestAnimationFrame(updateOverflowTabs);
    return () => cancelAnimationFrame(raf);
  }, [tabs.length, leftSidebarWidth, rightSidebarWidth, isRightPanelOpen, isLeftPanelOpen, updateOverflowTabs]);

  useEffect(() => {
    const bar = tabBarContainerRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      updateOverflowTabs();
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, [updateOverflowTabs]);

  // If the active tab is in the overflow list (e.g. newly opened tab), swap it with the last visible tab
  useEffect(() => {
    if (!activeTabId || visibleCount <= 0 || tabs.length <= visibleCount) return;
    const activeIdx = tabs.findIndex((t) => t.id === activeTabId);
    if (activeIdx >= visibleCount) {
      const lastVisibleTab = tabs[visibleCount - 1];
      if (lastVisibleTab && lastVisibleTab.id !== activeTabId) {
        swapTabs(lastVisibleTab.id, activeTabId);
      }
    }
  }, [activeTabId, visibleCount, tabs, swapTabs]);

  const handleSelectOverflowTab = (targetTabId: string) => {
    const clampedVisible = Math.min(visibleCount, tabs.length);
    const lastVisibleTab = clampedVisible > 0 ? tabs[clampedVisible - 1] : undefined;
    if (lastVisibleTab && lastVisibleTab.id !== targetTabId) {
      swapTabs(lastVisibleTab.id, targetTabId);
    }
    setActiveTabId(targetTabId);
    setIsTabDropdownOpen(false);
    setHoveredDropdownTab(null);
  };

  const handleTabMouseEnter = (e: React.MouseEvent, tab: WorkbenchTab) => {
    if (tabHoverTimeoutRef.current) clearTimeout(tabHoverTimeoutRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const tooltipWidth = 260;
    const x = Math.min(Math.max(8, rect.left), window.innerWidth - tooltipWidth - 16);
    const y = rect.bottom + 6;
    const conn = connections.find((c) => c.id === tab.connectionId);

    tabHoverTimeoutRef.current = setTimeout(() => {
      setHoveredTab({
        tab,
        connName: conn?.name,
        x,
        y,
      });
    }, 150);
  };

  const handleTabMouseLeave = () => {
    if (tabHoverTimeoutRef.current) clearTimeout(tabHoverTimeoutRef.current);
    setHoveredTab(null);
  };

  const handleLeftResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLeftResizer(true);
    const startX = e.clientX;
    const startWidth = leftSidebarWidth;
    let latestWidth = startWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const maxW = Math.max(220, Math.min(650, window.innerWidth - 360));
      const newWidth = Math.max(180, Math.min(maxW, startWidth + deltaX));
      latestWidth = newWidth;
      setLeftSidebarWidth(newWidth);
      localStorage.setItem('dhub_left_sidebar_w', String(newWidth));
    };

    const handleMouseUp = () => {
      setIsDraggingLeftResizer(false);
      WorkspaceService.SaveSetting('dhub_left_sidebar_w', String(latestWidth)).catch(() => {});
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleRightResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingRightResizer(true);
    const startX = e.clientX;
    const startWidth = rightSidebarWidth;
    let latestWidth = startWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const maxW = Math.max(260, Math.min(1000, window.innerWidth - 200));
      const newWidth = Math.max(180, Math.min(maxW, startWidth + deltaX));
      latestWidth = newWidth;
      setRightSidebarWidth(newWidth);
      localStorage.setItem('dhub_right_sidebar_w', String(newWidth));
    };

    const handleMouseUp = () => {
      setIsDraggingRightResizer(false);
      WorkspaceService.SaveSetting('dhub_right_sidebar_w', String(latestWidth)).catch(() => {});
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Bottom panel resizable height
  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(() => {
    const saved = localStorage.getItem('dhub_bottom_panel_h');
    return saved ? Math.max(120, Math.min(800, Number(saved))) : 280;
  });
  const [isDraggingBottomResizer, setIsDraggingBottomResizer] = useState(false);

  // Load persisted panel dimensions from SQLite on mount
  useEffect(() => {
    WorkspaceService.GetSettings()
      .then((settings) => {
        if (!settings) return;
        if (settings['dhub_left_sidebar_w']) {
          const w = Math.max(180, Math.min(600, Number(settings['dhub_left_sidebar_w'])));
          if (!Number.isNaN(w)) setLeftSidebarWidth(w);
        }
        if (settings['dhub_right_sidebar_w']) {
          const w = Math.max(180, Math.min(600, Number(settings['dhub_right_sidebar_w'])));
          if (!Number.isNaN(w)) setRightSidebarWidth(w);
        }
        if (settings['dhub_bottom_panel_h']) {
          const h = Math.max(120, Math.min(800, Number(settings['dhub_bottom_panel_h'])));
          if (!Number.isNaN(h)) setBottomPanelHeight(h);
        }
      })
      .catch(() => {});
  }, []);

  const handleBottomResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingBottomResizer(true);
    const startY = e.clientY;
    const startHeight = bottomPanelHeight;
    let latestHeight = startHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const maxH = Math.max(180, window.innerHeight - 160);
      const newHeight = Math.max(100, Math.min(maxH, startHeight + deltaY));
      latestHeight = newHeight;
      setBottomPanelHeight(newHeight);
      localStorage.setItem('dhub_bottom_panel_h', String(newHeight));
    };

    const handleMouseUp = () => {
      setIsDraggingBottomResizer(false);
      WorkspaceService.SaveSetting('dhub_bottom_panel_h', String(latestHeight)).catch(() => {});
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

      // Toggle Left Explorer: Ctrl+B / Cmd+B
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggleLeftPanel();
        return;
      }

      // Settings shortcut: Ctrl+, / Cmd+,
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        useSettingsStore.getState().toggleSettings();
        return;
      }

      // Views / Value Viewer: F7
      if (e.key === 'F7') {
        e.preventDefault();
        const store = useWorkbenchStore.getState();
        if (!store.isRightPanelOpen) {
          store.setRightPanelOpen(true);
          store.setActiveRightSidebarTab('views');
        } else if (store.activeRightSidebarTab === 'views') {
          store.setRightPanelOpen(false);
        } else {
          store.setActiveRightSidebarTab('views');
        }
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

  // Listeners to close Tab Context Menu, Tab Overflow Dropdown & escape Rename Modal
  useEffect(() => {
    const handleClose = (e: MouseEvent) => {
      if (tabContextMenu.isOpen) {
        setTabContextMenu((prev) => ({ ...prev, isOpen: false }));
      }
      if (
        isTabDropdownOpen &&
        tabDropdownRef.current &&
        !tabDropdownRef.current.contains(e.target as Node)
      ) {
        setIsTabDropdownOpen(false);
        setHoveredDropdownTab(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (tabContextMenu.isOpen) {
          setTabContextMenu((prev) => ({ ...prev, isOpen: false }));
        }
        if (isTabDropdownOpen) {
          setIsTabDropdownOpen(false);
          setHoveredDropdownTab(null);
        }
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
  }, [tabContextMenu.isOpen, renameModal.isOpen, isTabDropdownOpen]);

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

    let primaryKeys: string[] = tableDataByTab[tab.id]?.primaryKeys || [];
    let structureColumns: ColumnMeta[] = tableDataByTab[tab.id]?.columns || [];

    try {
      let connList = connections;
      if (connList.length === 0) {
        try {
          const fetched = await ConnectionService.ListConnections();
          if (fetched && fetched.length > 0) {
            connList = fetched as any;
            setConnections(connList);
          }
        } catch {}
      }
      const conn = connList.find((c) => c.id === connId);
      const isMySQL = (conn?.driver || tab.driver) === 'mysql';
      const targetDb = tab.database || conn?.databaseName || 'main';
      const targetSchema = tab.schema || ((conn?.driver || tab.driver) === 'postgres' ? 'public' : targetDb);

      // 1. Fetch table structure for primary keys & detailed column definitions (size, nullability, comment, etc.)
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
        isMySQL && targetDb && targetDb !== 'main'
          ? `\`${targetDb}\`.\`${tab.table}\``
          : (conn?.driver || tab.driver) === 'postgres' && targetSchema
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
          columns: structureColumns.length > 0 ? structureColumns : (prev[tab.id]?.columns || []),
          rows: prev[tab.id]?.rows || [],
          primaryKeys: primaryKeys.length > 0 ? primaryKeys : (prev[tab.id]?.primaryKeys || []),
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

  // Free cached rows of closed tabs so they can be garbage collected
  useEffect(() => {
    setTableDataByTab((prev) => {
      const openIds = new Set(tabs.map((t) => t.id));
      const staleKeys = Object.keys(prev).filter((id) => !openIds.has(id));
      if (staleKeys.length === 0) return prev;
      const next = { ...prev };
      staleKeys.forEach((id) => delete next[id]);
      return next;
    });
  }, [tabs]);

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
      alertWarning('Please select or add a connection in Database Explorer first.', 'No Active Connection');
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

      setQueryResult({
        ...res,
        sql: (res as any)?.sql || sql,
      } as any);
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
      alertError(
        'An error occurred while generating SQL DML preview for staged changes.',
        'SQL Preview Failed',
        e?.message || String(e)
      );
    }
  };

  const handleSubmitChanges = async (skipConfirm = false) => {
    if (!activeTab || activeTab.type !== 'table_data' || !activeConnectionId) return;
    const staged = useGridEditStore.getState().stagedByTab[activeTab.id] || {};
    const changeList = Object.values(staged);
    if (changeList.length === 0) return;

    const executeApply = async () => {
      try {
        const affected = await QueryService.SubmitChanges(
          activeConnectionId,
          activeTab.database || activeTab.schema || 'main',
          activeTab.table || '',
          changeList as any
        );
        useAlertStore.getState().showAlert({
          type: 'success',
          title: 'Changes Applied Successfully',
          message: `Successfully applied ${affected} change(s) to table "${activeTab.table}".`,
        });
        useGridEditStore.getState().revertTabChanges(activeTab.id);
        // Refresh table data
        if (activeTab.table) {
          loadTableData(activeTab);
        }
      } catch (e: any) {
        useAlertStore.getState().showAlert({
          type: 'error',
          title: 'Failed to Apply Changes',
          message: 'The database rejected the changes or encountered an error during DML execution.',
          details: e?.message || String(e),
        });
      }
    };

    if (skipConfirm) {
      await executeApply();
      return;
    }

    const inserts = changeList.filter((c) => c.type === 'insert').length;
    const updates = changeList.filter((c) => c.type === 'update').length;
    const deletes = changeList.filter((c) => c.type === 'delete').length;

    const summaryParts: string[] = [];
    if (inserts > 0) summaryParts.push(`${inserts} new row(s) to INSERT`);
    if (updates > 0) summaryParts.push(`${updates} row(s) to UPDATE`);
    if (deletes > 0) summaryParts.push(`${deletes} row(s) to DELETE`);

    useAlertStore.getState().showConfirm({
      title: 'Apply Staged Changes?',
      message: `Are you sure you want to apply ${changeList.length} staged change(s) to table "${activeTab.table}"?`,
      details: summaryParts.join(' • '),
      confirmLabel: 'Apply Changes',
      cancelLabel: 'Cancel',
      confirmVariant: 'emerald',
      onConfirm: () => {
        executeApply();
      },
    });
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-[#121317] text-zinc-300 font-sans select-none overflow-hidden">
      {/* Top Titlebar / Islands Header */}
      <header className="flex h-11 items-center justify-between border-b border-[#272932] px-4 bg-[#14151a]">
        <div className="flex items-center gap-2">
          <DHubLogo variant="full" size={26} />
        </div>

        <div className="flex items-center gap-2">
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
            title={`Open Settings & Preferences (${isMac ? 'Cmd+,' : 'Ctrl+,'})`}
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            <span>Settings</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left Sidebar: Database Explorer */}
        {isLeftPanelOpen ? (
          <>
            <div
              style={{ width: `${leftSidebarWidth}px` }}
              className="h-full shrink-0 overflow-hidden"
            >
              <DatabaseExplorer onCollapse={toggleLeftPanel} />
            </div>

            {/* Left Sidebar Resizer Handle */}
            <div
              onMouseDown={handleLeftResizerMouseDown}
              onDoubleClick={() => {
                const defaultW = 256;
                setLeftSidebarWidth(defaultW);
                localStorage.setItem('dhub_left_sidebar_w', String(defaultW));
                WorkspaceService.SaveSetting('dhub_left_sidebar_w', String(defaultW)).catch(() => {});
              }}
              className={`group w-1.5 h-full bg-[#191a20] hover:bg-blue-600/90 cursor-col-resize transition-colors relative z-20 shrink-0 flex items-center justify-center border-r border-[#272932] ${
                isDraggingLeftResizer ? 'bg-blue-600' : ''
              }`}
              title="Drag to resize Database Explorer (Double-click to reset)"
            >
              <div className="w-0.5 h-8 rounded-full bg-zinc-700 group-hover:bg-blue-200 transition-colors" />
            </div>
          </>
        ) : (
          /* Minimized Left Sidebar Strip */
          <div className="h-full w-9 shrink-0 bg-[#16171d] border-r border-[#272932] flex flex-col items-center py-2 select-none z-10">
            <button
              onClick={toggleLeftPanel}
              className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-[#22242c] transition-colors cursor-pointer"
              title={`Expand Database Explorer (${isMac ? '⌘B' : 'Ctrl+B'})`}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
            <div
              onClick={toggleLeftPanel}
              className="mt-6 flex flex-1 flex-col items-center cursor-pointer group"
              title="Click to expand Database Explorer"
            >
              <Database className="h-4 w-4 text-zinc-500 group-hover:text-blue-400 transition-colors mb-3" />
              <div className="text-[10px] tracking-widest font-semibold uppercase text-zinc-500 group-hover:text-zinc-300 transition-colors [writing-mode:vertical-rl] rotate-180">
                EXPLORER
              </div>
            </div>
          </div>
        )}

        {/* Center Workbench: Tabs + Editor/Grid + Services Bottom Panel */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#14151a]">
          {/* Tab Bar */}
          {(() => {
            const clampedVisibleCount = Math.max(0, Math.min(visibleCount, tabs.length));
            const visibleTabs = tabs.slice(0, clampedVisibleCount);
            const overflowTabs = tabs.slice(clampedVisibleCount);

            return (
              <div
                ref={tabBarContainerRef}
                className="relative flex h-8 items-center border-b border-[#272932] bg-[#121317] shrink-0"
              >
                {/* Visible Tabs Strip (no horizontal scrolling, supports drag & drop reordering) */}
                <div className="flex flex-1 min-w-0 h-full items-center px-1.5 gap-1 overflow-hidden">
                  {visibleTabs.map((tab) => {
                    const isDraggingThis = draggedTabId === tab.id;
                    const isDropBefore =
                      tabDropTarget?.id === tab.id && tabDropTarget.position === 'before';
                    const isDropAfter =
                      tabDropTarget?.id === tab.id && tabDropTarget.position === 'after';
                    const tabConn = connections.find((c) => c.id === tab.connectionId);
                    const tabEnv = resolveConnectionEnv(tabConn);
                    const isActive = activeTabId === tab.id;
                    const tabColorClass =
                      tabEnv === 'prod'
                        ? isActive
                          ? 'bg-rose-950/75 border-rose-500 text-rose-100 font-medium shadow-xs'
                          : 'bg-rose-950/25 border-rose-900/50 text-rose-300/80 hover:text-rose-100 hover:bg-rose-950/45'
                        : tabEnv === 'dev'
                        ? isActive
                          ? 'bg-emerald-950/75 border-emerald-500 text-emerald-100 font-medium shadow-xs'
                          : 'bg-emerald-950/25 border-emerald-900/50 text-emerald-300/80 hover:text-emerald-100 hover:bg-emerald-950/45'
                        : isActive
                        ? 'bg-[#191a20] border-zinc-400 text-white font-medium'
                        : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#191a20]/50';

                    return (
                      <div
                        key={tab.id}
                        draggable
                        onDragStart={(e) => {
                          handleTabMouseLeave();
                          setDraggedTabId(tab.id);
                          e.dataTransfer.effectAllowed = 'move';
                          try {
                            e.dataTransfer.setData('text/plain', tab.id);
                          } catch {}
                        }}
                        onDragOver={(e) => {
                          if (!draggedTabId || draggedTabId === tab.id) return;
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'move';
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const pos: 'before' | 'after' =
                            e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                          if (
                            tabDropTarget?.id !== tab.id ||
                            tabDropTarget?.position !== pos
                          ) {
                            setTabDropTarget({ id: tab.id, position: pos });
                          }
                        }}
                        onDragLeave={(e) => {
                          e.stopPropagation();
                          if (tabDropTarget?.id === tab.id) {
                            setTabDropTarget(null);
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const sourceId =
                            draggedTabId || e.dataTransfer.getData('text/plain');
                          if (sourceId && sourceId !== tab.id) {
                            const rect = (
                              e.currentTarget as HTMLElement
                            ).getBoundingClientRect();
                            const pos: 'before' | 'after' =
                              e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                            reorderTab(sourceId, tab.id, pos);
                          }
                          setDraggedTabId(null);
                          setTabDropTarget(null);
                        }}
                        onDragEnd={() => {
                          setDraggedTabId(null);
                          setTabDropTarget(null);
                        }}
                        onClick={() => {
                          handleTabMouseLeave();
                          setActiveTabId(tab.id);
                        }}
                        onContextMenu={(e) => {
                          handleTabMouseLeave();
                          handleTabContextMenu(e, tab);
                        }}
                        onMouseEnter={(e) => handleTabMouseEnter(e, tab)}
                        onMouseLeave={handleTabMouseLeave}
                        className={`relative group shrink-0 max-w-[124px] flex items-center gap-1 px-2 py-1 rounded-t text-[11px] cursor-pointer border-t-2 transition-colors ${
                          isDraggingThis ? 'opacity-40 ' : ''
                        }${tabColorClass}`}
                      >
                        {isDropBefore && (
                          <div className="absolute -left-0.5 top-1 bottom-1 w-0.5 bg-blue-500 rounded-full z-20 pointer-events-none" />
                        )}
                        {tab.type === 'worksheet' ? (
                          <FileCode
                            className={`h-3 w-3 shrink-0 ${
                              tabEnv === 'prod'
                                ? 'text-rose-400'
                                : tabEnv === 'dev'
                                ? 'text-emerald-400'
                                : 'text-zinc-400'
                            }`}
                          />
                        ) : tab.type === 'users' ? (
                          <Users className="h-3 w-3 shrink-0 text-amber-400" />
                        ) : (
                          <Table
                            className={`h-3 w-3 shrink-0 ${
                              tabEnv === 'prod'
                                ? 'text-rose-400'
                                : 'text-emerald-400'
                            }`}
                          />
                        )}
                        <span
                          onDoubleClick={
                            tab.type === 'worksheet'
                              ? () => handleOpenRename(tab.id, tab.title)
                              : undefined
                          }
                          className="truncate max-w-[84px]"
                        >
                          {tab.title}
                        </span>
                        <X
                          className="h-2.5 w-2.5 text-zinc-500 hover:text-white ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTabMouseLeave();
                            closeTab(tab.id);
                          }}
                        />
                        {isDropAfter && (
                          <div className="absolute -right-0.5 top-1 bottom-1 w-0.5 bg-blue-500 rounded-full z-20 pointer-events-none" />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Overflow Tabs Dropdown Trigger (>> {{count}}) — only shown when there are excess tabs */}
                {overflowTabs.length > 0 && (
                  <div ref={tabDropdownRef} className="relative h-full flex items-center shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTabMouseLeave();
                        setIsTabDropdownOpen((prev) => {
                          const next = !prev;
                          if (next) {
                            setTabDropdownSearch('');
                            setTabDropdownSelectedIndex(0);
                          } else {
                            setHoveredDropdownTab(null);
                          }
                          return next;
                        });
                      }}
                      className={`flex h-full items-center gap-0.5 px-2 text-[11px] border-l border-[#272932] transition-colors cursor-pointer ${
                        isTabDropdownOpen
                          ? 'bg-[#22242c] text-white'
                          : 'bg-[#121317] text-zinc-400 hover:text-zinc-100 hover:bg-[#191a20]'
                      }`}
                      title={`Show ${overflowTabs.length} hidden tab(s)`}
                    >
                      <ChevronsRight className="h-3 w-3 stroke-[2.2]" />
                      <span className="text-[10px] font-mono leading-none translate-y-[2px] font-semibold">
                        {overflowTabs.length}
                      </span>
                    </button>

                    {isTabDropdownOpen && (() => {
                      const q = tabDropdownSearch.trim().toLowerCase();
                      const filteredOverflowTabs = overflowTabs.filter((t) => {
                        if (!q) return true;
                        const conn = connections.find((c) => c.id === t.connectionId);
                        return (
                          t.title.toLowerCase().includes(q) ||
                          (t.database || '').toLowerCase().includes(q) ||
                          (conn?.name || '').toLowerCase().includes(q)
                        );
                      });
                      const safeIndex = Math.min(
                        Math.max(0, tabDropdownSelectedIndex),
                        Math.max(0, filteredOverflowTabs.length - 1)
                      );

                      return (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-full mt-0.5 z-50 w-72 rounded border border-[#3b3e4f] bg-[#1e2027] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100"
                        >
                          {/* Top Filter Input */}
                          <div className="p-1.5 border-b border-[#2e313d] bg-[#181920]">
                            <input
                              type="text"
                              value={tabDropdownSearch}
                              onChange={(e) => {
                                setTabDropdownSearch(e.target.value);
                                setTabDropdownSelectedIndex(0);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  setTabDropdownSelectedIndex((i) =>
                                    filteredOverflowTabs.length > 0
                                      ? (i + 1) % filteredOverflowTabs.length
                                      : 0
                                  );
                                } else if (e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  setTabDropdownSelectedIndex((i) =>
                                    filteredOverflowTabs.length > 0
                                      ? (i - 1 + filteredOverflowTabs.length) %
                                        filteredOverflowTabs.length
                                      : 0
                                  );
                                } else if (
                                  e.key === 'Enter' &&
                                  filteredOverflowTabs[safeIndex]
                                ) {
                                  e.preventDefault();
                                  const target = filteredOverflowTabs[safeIndex];
                                  handleSelectOverflowTab(target.id);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setIsTabDropdownOpen(false);
                                  setHoveredDropdownTab(null);
                                }
                              }}
                              placeholder="Filter hidden tabs..."
                              autoFocus
                              className="w-full rounded-xs bg-[#121317] px-2 py-1 text-[11px] text-zinc-100 border border-[#323544] focus:border-blue-500 focus:outline-none"
                            />
                          </div>

                          {/* Excess / Overflow Tabs List Only */}
                          <div
                            onMouseLeave={() => setHoveredDropdownTab(null)}
                            className="max-h-80 overflow-y-auto divide-y divide-[#252730]/40"
                          >
                            {filteredOverflowTabs.length === 0 ? (
                              <div className="px-3 py-4 text-center text-[11px] text-zinc-500">
                                No matching tabs
                              </div>
                            ) : (
                              filteredOverflowTabs.map((tab, idx) => {
                                const conn = connections.find((c) => c.id === tab.connectionId);
                                const dropTabEnv = resolveConnectionEnv(conn);
                                const isSelected = idx === safeIndex;

                                return (
                                  <div
                                    key={tab.id}
                                    onClick={() => handleSelectOverflowTab(tab.id)}
                                    onMouseEnter={(e) => {
                                      setTabDropdownSelectedIndex(idx);
                                      const rect = (
                                        e.currentTarget as HTMLElement
                                      ).getBoundingClientRect();
                                      const tooltipW = 260;
                                      const preferRightX = rect.left + 32;
                                      const x = Math.min(
                                        Math.max(8, preferRightX),
                                        window.innerWidth - tooltipW - 12
                                      );
                                      const y = Math.min(rect.bottom + 2, window.innerHeight - 90);
                                      setHoveredDropdownTab({
                                        tab,
                                        connName: conn?.name,
                                        x,
                                        y,
                                      });
                                    }}
                                    className={`group flex items-center justify-between gap-2 px-2 py-1 text-[11px] cursor-pointer transition-colors border-l-2 ${
                                      dropTabEnv === 'prod'
                                        ? isSelected
                                          ? 'bg-rose-900/60 text-white border-l-rose-500'
                                          : 'bg-rose-950/25 text-rose-200 hover:bg-rose-950/45 border-l-rose-500/70'
                                        : dropTabEnv === 'dev'
                                        ? isSelected
                                          ? 'bg-emerald-900/60 text-white border-l-emerald-500'
                                          : 'bg-emerald-950/25 text-emerald-200 hover:bg-emerald-950/45 border-l-emerald-500/70'
                                        : isSelected
                                        ? 'bg-[#2b4c7e]/70 text-white border-l-blue-400'
                                        : 'text-zinc-200 hover:bg-[#262934] border-l-transparent'
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                      {tab.type === 'worksheet' ? (
                                        <FileCode className="h-3 w-3 text-blue-400 shrink-0" />
                                      ) : tab.type === 'users' ? (
                                        <Users className="h-3 w-3 text-amber-400 shrink-0" />
                                      ) : (
                                        <Table className="h-3 w-3 text-cyan-400 shrink-0" />
                                      )}
                                      <div className="truncate min-w-0 flex-1">
                                        <span>{tab.title}</span>
                                        {(conn?.name || tab.database) && (
                                          <span className="text-zinc-400/80">
                                            {' - '}
                                            {conn?.name || tab.database}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setHoveredDropdownTab(null);
                                        closeTab(tab.id);
                                      }}
                                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition-opacity shrink-0"
                                      title="Close Tab"
                                    >
                                      <X className="h-2.5 w-2.5" />
                                    </button>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Active Tab View */}
          <div className="flex-1 min-h-0 flex flex-col">
            {activeTab?.type === 'worksheet' ? (() => {
              const tabConn = connections.find((c) => c.id === (activeTab.connectionId || activeConnectionId));
              const tabConnDbs = treeDatabases[tabConn?.id || ''] || [];
              const visibleList = tabConn ? visibleDatabases[tabConn.id] : undefined;
              const visibleDbs =
                visibleList !== undefined
                  ? tabConnDbs.filter((db) => visibleList.includes(db) || visibleList.some((v) => v.toLowerCase() === db.toLowerCase()))
                  : tabConnDbs;

              const systemDbs = ['information_schema', 'performance_schema', 'mysql', 'sys'];
              const nonSystemDb = visibleDbs.find((d) => !systemDbs.includes(d.toLowerCase()));
              const isDbAllowed = (dbName?: string) => {
                if (!dbName) return false;
                if (!visibleList) return true;
                return visibleList.includes(dbName) || visibleList.some((v) => v.toLowerCase() === dbName.toLowerCase());
              };

              const effectiveDb =
                (activeTab.database && isDbAllowed(activeTab.database) ? activeTab.database : '') ||
                (tabConn?.databaseName && isDbAllowed(tabConn.databaseName) ? tabConn.databaseName : '') ||
                nonSystemDb ||
                (visibleDbs.length > 0 ? visibleDbs[0] : (tabConn?.driver === 'sqlite' ? 'main' : ''));
              const effectiveSchema = activeTab.schema || (tabConn?.driver === 'postgres' ? 'public' : effectiveDb);
              const availableDbs =
                visibleDbs.length > 0
                  ? visibleDbs
                  : (visibleList !== undefined
                      ? visibleList
                      : (tabConn?.databaseName ? [tabConn.databaseName] : (tabConn?.driver === 'sqlite' ? ['main'] : [])));

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
            })() : activeTab?.type === 'table_data' ? (() => {
              const tableConn = connections.find((c) => c.id === activeTab.connectionId);
              const tableEnv = resolveConnectionEnv(tableConn);
              const tableHeaderBgClass =
                tableEnv === 'prod'
                  ? 'bg-rose-950/50 border-rose-900/60'
                  : tableEnv === 'dev'
                  ? 'bg-emerald-950/50 border-emerald-900/60'
                  : 'bg-[#14151a] border-[#272932]';

              return (
              <div className="flex-1 min-h-0 flex flex-col">
                {/* Table Tab Bar with Table Name, Database, and Refresh Button */}
                <div className={`flex h-9 items-center justify-between border-b px-3 transition-colors ${tableHeaderBgClass}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <Table className={`h-3.5 w-3.5 shrink-0 ${tableEnv === 'prod' ? 'text-rose-400' : 'text-emerald-400'}`} />
                    <span
                      className="font-semibold text-xs text-white truncate max-w-[320px]"
                      title={activeTab.table}
                    >
                      {activeTab.table}
                    </span>
                    {tableEnv !== 'local' && (
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.2 rounded border uppercase shrink-0 ${
                          tableEnv === 'prod'
                            ? 'bg-rose-500/20 text-rose-200 border-rose-500/40'
                            : 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40'
                        }`}
                      >
                        {tableEnv}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const conn = connections.find((c) => c.id === activeTab.connectionId) || null;
                        openEditTableModal(
                          conn,
                          activeTab.database || 'main',
                          activeTab.schema || 'main',
                          activeTab.table
                        );
                      }}
                      className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] transition-colors cursor-pointer shrink-0"
                      title="Edit Table Structure"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyCurrentTableSchema(activeTab)}
                      className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] transition-colors cursor-pointer shrink-0"
                      title="Copy Table Schema (DDL)"
                    >
                      {copiedSchemaTabId === activeTab.id ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                    <span className="text-zinc-600 shrink-0">/</span>
                    <span
                      className="font-mono text-[11px] text-zinc-400 truncate max-w-[200px]"
                      title={activeTab.database || 'main'}
                    >
                      {activeTab.database || 'main'}
                    </span>
                    <span className="text-zinc-600 shrink-0">•</span>
                    <span className="text-[11px] text-zinc-500 font-mono shrink-0">
                      {tableDataByTab[activeTab.id]?.rows?.length ?? 0} rows
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {tableDataByTab[activeTab.id]?.whereClause && (
                      <button
                        onClick={() => {
                          const currentSize = tableDataByTab[activeTab.id]?.pageSize || 100;
                          loadTableData(activeTab, 0, currentSize, false, 1, '');
                        }}
                        className="flex items-center gap-1 h-6 px-2 rounded text-[11px] text-rose-400 hover:text-white hover:bg-rose-900/40 border border-rose-800/40 transition-colors cursor-pointer"
                        title="Reset WHERE filter to show all rows"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Reset Filter</span>
                      </button>
                    )}
                    <button
                      onClick={() => loadTableData(activeTab)}
                      disabled={tableDataByTab[activeTab.id]?.isLoading}
                      className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-[#22242c] transition-colors cursor-pointer"
                      title="Reload Table Data"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${tableDataByTab[activeTab.id]?.isLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0">
                  {tableDataByTab[activeTab.id]?.isLoading && (!tableDataByTab[activeTab.id]?.rows || tableDataByTab[activeTab.id]?.rows.length === 0) && !tableDataByTab[activeTab.id]?.error ? (
                    <div className="flex h-full items-center justify-center text-xs text-zinc-400 gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-blue-400" />
                      <span>Loading rows from `{activeTab.table}`...</span>
                    </div>
                  ) : (
                    <DataGrid
                      tabId={activeTab.id}
                      tableName={activeTab.table}
                      envType={tableEnv}
                      columns={tableDataByTab[activeTab.id]?.columns || []}
                      rows={tableDataByTab[activeTab.id]?.rows || []}
                      primaryKeys={tableDataByTab[activeTab.id]?.primaryKeys || []}
                      totalCount={tableDataByTab[activeTab.id]?.totalCount}
                      hasMore={tableDataByTab[activeTab.id]?.hasMore}
                      isLoadingMore={tableDataByTab[activeTab.id]?.isLoadingMore}
                      page={tableDataByTab[activeTab.id]?.page || 1}
                      pageSize={tableDataByTab[activeTab.id]?.pageSize || 100}
                      whereClause={tableDataByTab[activeTab.id]?.whereClause}
                      errorMessage={tableDataByTab[activeTab.id]?.error}
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
              );
            })() : activeTab?.type === 'users' ? (() => {
              const usersConn = connections.find((c) => c.id === activeTab.connectionId) || null;
              return (
                <div className="flex-1 min-h-0 flex flex-col">
                  <UserManager tab={activeTab} connection={usersConn} />
                </div>
              );
            })() : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500 select-none">
                <Terminal className="h-10 w-10 text-zinc-600 mb-3 stroke-[1.5]" />
                <h3 className="text-sm font-semibold text-zinc-300">No Open Tabs</h3>
                <p className="text-xs text-zinc-500 mt-1 max-w-sm">
                  Select a table from Database Explorer or right-click a connection to open a Query Console.
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
                      WorkspaceService.SaveSetting('dhub_bottom_panel_h', String(defaultH)).catch(() => {});
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
                {(() => {
                  const currentActiveRes =
                    queryResult?.results && queryResult.results[activeResultIndex]
                      ? queryResult.results[activeResultIndex]
                      : queryResult;
                  const currentRawSql =
                    (currentActiveRes as any)?.sql ||
                    queryResult?.sql ||
                    queryPagination?.lastSql ||
                    '';

                  return (
                    <div className="flex h-8 items-center justify-between border-b border-[#272932] px-3 bg-[#14151a] shrink-0 select-none gap-2">
                      <div className="flex items-center gap-2 overflow-x-auto min-w-0">
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
                                    ? 'border-zinc-400 text-white font-semibold'
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
                            className={`text-xs pb-1 border-b-2 font-medium cursor-pointer whitespace-nowrap ${
                              activeBottomTab === 'result'
                                ? 'border-zinc-400 text-white font-semibold'
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
                              ? 'border-zinc-400 text-white font-semibold'
                              : 'border-transparent text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          Output Log
                        </button>
                      </div>

                      {/* Raw Query Preview & 1-Click Copy in Tab Bar */}
                      {activeBottomTab === 'result' && currentRawSql && (
                        <div className="flex items-center gap-1.5 min-w-0 flex-1 justify-end max-w-xl mx-2">
                          <div className="flex items-center gap-1.5 min-w-0 bg-[#101115] border border-[#272932] rounded px-2 py-0.5 shadow-xs">
                            <Terminal className="h-3 w-3 text-amber-400 shrink-0" />
                            <span className="text-[10px] text-zinc-500 font-bold uppercase shrink-0 font-sans tracking-wider">
                              SQL:
                            </span>
                            <span
                              className="font-mono text-[11px] text-zinc-300 truncate select-all cursor-pointer hover:text-white transition-colors"
                              title={`${currentRawSql}\n\n(Click to copy raw query)`}
                              onClick={() => handleCopyResultRawSql(currentRawSql)}
                            >
                              {currentRawSql.replace(/[\r\n]+/g, ' ')}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyResultRawSql(currentRawSql)}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all shrink-0 cursor-pointer ${
                                copiedResultRawSql
                                  ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-[#1e2029] hover:bg-[#282b37] text-zinc-300 hover:text-white border border-[#2b2e3a]'
                              }`}
                              title="Copy raw query to clipboard"
                            >
                              {copiedResultRawSql ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-400" />
                                  <span>Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3 text-zinc-400" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      <button
                        onClick={toggleBottomPanel}
                        className="text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer ml-2 shrink-0"
                      >
                        Minimize
                      </button>
                    </div>
                  );
                })()}

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

                      const currentResSql =
                        (currentRes as any)?.sql ||
                        queryResult?.sql ||
                        queryPagination?.lastSql ||
                        '';

                      return (
                        <div className="flex-1 min-h-0">
                          <DataGrid
                            key={`result-grid-${activeResultIndex}-${queryResult?.executionId || ''}`}
                            tabId={`bottom-result-${activeResultIndex}`}
                            envType={resolveConnectionEnv(
                              connections.find((c) => c.id === (activeTab?.connectionId || activeConnectionId))
                            )}
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
                            rawSql={currentResSql}
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

        {/* Right Sidebar: Query Consoles & Views */}
        {isRightPanelOpen ? (
          <>
            {/* Right Sidebar Resizer Handle */}
            <div
              onMouseDown={handleRightResizerMouseDown}
              onDoubleClick={() => {
                const defaultW = 280;
                setRightSidebarWidth(defaultW);
                localStorage.setItem('dhub_right_sidebar_w', String(defaultW));
                WorkspaceService.SaveSetting('dhub_right_sidebar_w', String(defaultW)).catch(() => {});
              }}
              className={`group w-1.5 h-full bg-[#191a20] hover:bg-blue-600/90 cursor-col-resize transition-colors relative z-20 shrink-0 flex items-center justify-center border-l border-[#272932] ${
                isDraggingRightResizer ? 'bg-blue-600' : ''
              }`}
              title="Drag to resize Right Sidebar (Double-click to reset)"
            >
              <div className="w-0.5 h-8 rounded-full bg-zinc-700 group-hover:bg-blue-200 transition-colors" />
            </div>

            <div
              style={{ width: `${rightSidebarWidth}px` }}
              className="h-full shrink-0 overflow-hidden"
            >
              <RightSidebar
                onRename={handleOpenRename}
                width={rightSidebarWidth}
                onWidthChange={setRightSidebarWidth}
              />
            </div>
          </>
        ) : (
          /* Minimized Right Sidebar Strip */
          <div className="h-full w-9 shrink-0 bg-[#16171d] border-l border-[#272932] flex flex-col items-center py-2 select-none z-10">
            <button
              onClick={toggleRightPanel}
              className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-[#22242c] transition-colors cursor-pointer"
              title="Expand Right Sidebar (F7)"
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>

            {/* VIEWS Button */}
            <div
              onClick={() => {
                setRightPanelOpen(true);
                setActiveRightSidebarTab('views');
              }}
              className="mt-6 flex flex-col items-center cursor-pointer group px-1 py-2 rounded hover:bg-[#22242c]/60 transition-colors"
              title="Open Views / Value Viewer (F7)"
            >
              <PanelRight className="h-4 w-4 text-zinc-500 group-hover:text-blue-400 transition-colors mb-2" />
              <div className="text-[10px] tracking-widest font-semibold uppercase text-zinc-500 group-hover:text-zinc-300 transition-colors [writing-mode:vertical-rl]">
                VIEWS
              </div>
            </div>

            {/* CONSOLES Button */}
            <div
              onClick={() => {
                setRightPanelOpen(true);
                setActiveRightSidebarTab('consoles');
              }}
              className="mt-6 flex flex-col items-center cursor-pointer group px-1 py-2 rounded hover:bg-[#22242c]/60 transition-colors"
              title="Open Consoles"
            >
              <Terminal className="h-4 w-4 text-zinc-500 group-hover:text-blue-400 transition-colors mb-2" />
              <div className="text-[10px] tracking-widest font-semibold uppercase text-zinc-500 group-hover:text-zinc-300 transition-colors [writing-mode:vertical-rl]">
                CONSOLES
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hovered Workbench Tab Popover */}
      {hoveredTab && !tabContextMenu.isOpen && !isTabDropdownOpen && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border border-[#3b3e4f] bg-[#16171f]/95 backdrop-blur-md shadow-2xl px-3 py-2 text-xs font-sans min-w-[200px] max-w-[360px] animate-in fade-in zoom-in-95 duration-100"
          style={{ top: hoveredTab.y, left: hoveredTab.x }}
        >
          <div className="flex items-start gap-2">
            {hoveredTab.tab.type === 'worksheet' ? (
              <FileCode className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
            ) : hoveredTab.tab.type === 'users' ? (
              <Users className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <Table className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-zinc-100 break-all leading-snug">
                {hoveredTab.tab.title}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px] text-zinc-400 font-mono">
                <span className="px-1.5 py-0.2 rounded bg-[#22242c] border border-[#2e313d] uppercase text-zinc-300">
                  {hoveredTab.tab.type === 'worksheet' ? 'SQL Console' : hoveredTab.tab.type === 'users' ? 'User Management' : 'Table'}
                </span>
                {hoveredTab.connName && (
                  <span className="text-zinc-400 truncate max-w-[140px]">
                    {hoveredTab.connName}
                  </span>
                )}
                {hoveredTab.tab.database && (
                  <span className="text-amber-300/90 truncate max-w-[140px]">
                    /{hoveredTab.tab.database}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hovered Overflow Dropdown Item Tooltip */}
      {isTabDropdownOpen && hoveredDropdownTab && (
        <div
          className="fixed z-60 pointer-events-none rounded border border-[#4a4e62] bg-[#2a2d38] shadow-2xl px-2.5 py-1.5 text-[11px] text-zinc-200 font-sans leading-relaxed"
          style={{ top: hoveredDropdownTab.y, left: hoveredDropdownTab.x }}
        >
          <div>
            <span className="text-zinc-400">
              {hoveredDropdownTab.tab.type === 'worksheet' ? 'Console: ' : hoveredDropdownTab.tab.type === 'users' ? 'Users: ' : 'Table: '}
            </span>
            <span className="font-medium text-white">
              {hoveredDropdownTab.tab.table || hoveredDropdownTab.tab.title}
            </span>
          </div>
          {hoveredDropdownTab.tab.database && (
            <div>
              <span className="text-zinc-400">Database: </span>
              <span className="text-zinc-200">{hoveredDropdownTab.tab.database}</span>
            </div>
          )}
          {hoveredDropdownTab.connName && (
            <div>
              <span className="text-zinc-400">Connection: </span>
              <span className="text-zinc-200">{hoveredDropdownTab.connName}</span>
            </div>
          )}
        </div>
      )}

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
            ) : tabContextMenu.tab.type === 'users' ? (
              <Users className="h-3 w-3 text-amber-400" />
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
      {renameModal.isOpen && (() => {
        const targetTab = tabs.find((t) => t.id === renameModal.id);
        const renameConn = connections.find(
          (c) => c.id === (targetTab?.connectionId || activeTab?.connectionId || activeConnectionId)
        );
        const renameEnv = resolveConnectionEnv(renameConn);
        const renameHeaderClass =
          renameEnv === 'prod'
            ? 'bg-rose-950/75 border-rose-800/70'
            : renameEnv === 'dev'
            ? 'bg-emerald-950/75 border-emerald-800/70'
            : 'bg-[#14151a] border-[#272932]';

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
            <div className="w-80 rounded-lg bg-[#191a20] border border-[#272932] overflow-hidden text-xs text-zinc-300 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
              <div className={`flex items-center justify-between px-4 py-2.5 border-b ${renameHeaderClass}`}>
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
              <form onSubmit={handleRenameSubmit} className="p-4">
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
        );
      })()}

      {/* DML Preview Modal */}
      {dmlPreview && (() => {
        const dmlConn = connections.find((c) => c.id === (activeTab?.connectionId || activeConnectionId));
        const dmlEnv = resolveConnectionEnv(dmlConn);
        const dmlHeaderClass =
          dmlEnv === 'prod'
            ? 'bg-rose-950/75 border-rose-800/70'
            : dmlEnv === 'dev'
            ? 'bg-emerald-950/75 border-emerald-800/70'
            : 'bg-[#14151a] border-[#272932]';

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
            <div className="w-[600px] rounded-lg bg-[#191a20] border border-[#272932] overflow-hidden text-xs text-zinc-300 shadow-2xl">
              <div className={`flex items-center justify-between border-b px-4 py-3 ${dmlHeaderClass}`}>
                <span className="font-semibold text-sm text-zinc-100">Pending DML Statements</span>
                <button onClick={() => setDmlPreview(null)} className="text-zinc-400 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4">
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
                    Apply Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Resizing Backdrop Overlays */}
      {isDraggingBottomResizer && (
        <div className="fixed inset-0 z-50 cursor-row-resize select-none" />
      )}
      {(isDraggingLeftResizer || isDraggingRightResizer) && (
        <div className="fixed inset-0 z-50 cursor-col-resize select-none" />
      )}

      {/* Modals */}
      <ConnectionDialog />
      <SearchEverywhere />
      <SettingsModal />
      <AlertModal />
      <ToastContainer />
      <TableStructureModal
        isOpen={tableStructureModal.isOpen}
        mode={tableStructureModal.mode}
        initialTableName={tableStructureModal.tableName}
        connection={tableStructureModal.conn}
        database={tableStructureModal.database}
        schema={tableStructureModal.schema}
        onClose={closeTableStructureModal}
      />

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
          <span>DHub Desktop v{APP_VERSION}</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
