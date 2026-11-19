import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWorkbenchStore } from './stores/useWorkbenchStore';
import { useConnectionStore } from './stores/useConnectionStore';
import { useGridEditStore } from './stores/useGridEditStore';
import { QueryService, SchemaService, ConnectionService, WorkspaceService } from '../bindings/dhub/internal/services';
import { LeftSidebar, LeftSidebarTab } from './components/layout/LeftSidebar';
import { DatabaseExplorer } from './components/layout/DatabaseExplorer';
import { RightSidebar } from './components/layout/RightSidebar';
import { ConsoleList } from './components/layout/ConsoleList';
import { AlertModal } from './components/modals/AlertModal';
import { ToastContainer } from './components/common/ToastContainer';
import { Popover } from './components/common/Popover';
import { CopyFormatSelector } from './components/grid/CopyFormatSelector';
import { ResultChartPanel } from './components/grid/ResultChartPanel';

const SqlWorksheet = lazy(() =>
  import('./components/editor/SqlWorksheet').then((m) => ({ default: m.SqlWorksheet }))
);
const DataGrid = lazy(() =>
  import('./components/grid/DataGrid').then((m) => ({ default: m.DataGrid }))
);
const ConnectionDialog = lazy(() =>
  import('./components/modals/ConnectionDialog').then((m) => ({ default: m.ConnectionDialog }))
);
const SearchEverywhere = lazy(() =>
  import('./components/modals/SearchEverywhere').then((m) => ({ default: m.SearchEverywhere }))
);
const SettingsModal = lazy(() =>
  import('./components/modals/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const HelpModal = lazy(() =>
  import('./components/modals/HelpModal').then((m) => ({ default: m.HelpModal }))
);
const TableStructureModal = lazy(() =>
  import('./components/modals/CreateTableModal').then((m) => ({ default: m.TableStructureModal }))
);
const ViewDdlModal = lazy(() =>
  import('./components/modals/ViewDdlModal').then((m) => ({ default: m.ViewDdlModal }))
);
const QueryHistoryPanel = lazy(() =>
  import('./components/history/QueryHistoryPanel').then((m) => ({ default: m.QueryHistoryPanel }))
);
const ExplainPlanPanel = lazy(() =>
  import('./components/explain/ExplainPlanPanel').then((m) => ({ default: m.ExplainPlanPanel }))
);
const ERDiagramView = lazy(() =>
  import('./components/diagram/ERDiagramView').then((m) => ({ default: m.ERDiagramView }))
);
const ExportModal = lazy(() =>
  import('./components/modals/ExportModal').then((m) => ({ default: m.ExportModal }))
);
const ImportModal = lazy(() =>
  import('./components/modals/ImportModal').then((m) => ({ default: m.ImportModal }))
);
const UpdateModal = lazy(() =>
  import('./components/modals/UpdateModal').then((m) => ({ default: m.UpdateModal }))
);
const DmlPreviewModal = lazy(() =>
  import('./components/modals/DmlPreviewModal').then((m) => ({ default: m.DmlPreviewModal }))
);
const RenameTabModal = lazy(() =>
  import('./components/modals/RenameTabModal').then((m) => ({ default: m.RenameTabModal }))
);
const SchemaDiffModal = lazy(() =>
  import('./components/modals/SchemaDiffModal').then((m) => ({ default: m.SchemaDiffModal }))
);
const SnippetsModal = lazy(() =>
  import('./components/modals/SnippetsModal').then((m) => ({ default: m.SnippetsModal }))
);
const MockDataModal = lazy(() =>
  import('./components/modals/MockDataModal').then((m) => ({ default: m.MockDataModal }))
);
const UserManager = lazy(() =>
  import('./components/users/UserManager').then((m) => ({ default: m.UserManager }))
);
import { useAlertStore, alertSuccess, alertError, alertWarning, confirmDialog } from './stores/useAlertStore';
import { useSettingsStore } from './stores/useSettingsStore';
import { useUpdateStore } from './stores/useUpdateStore';
import { useWorkspaceSessionStore } from './stores/useWorkspaceSessionStore';
import { WorkspaceSelector } from './components/layout/WorkspaceSelector';
import { WorkbenchHeader } from './components/layout/WorkbenchHeader';
import { WorkbenchStatusBar } from './components/layout/WorkbenchStatusBar';
import { EmptyWorkbenchState } from './components/layout/EmptyWorkbenchState';
import { TabContextMenu } from './components/layout/TabContextMenu';
import { DHubLogo } from './components/common/DHubLogo';
import { APP_VERSION } from './version';
import {
  Database,
  Briefcase,
  Terminal,
  Search,
  Settings as SettingsIcon,
  Sparkles,
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
  Eye,
  LocateFixed,
  Check,
  Download,
  Upload,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightOpen,
  Users,
  GitCompare,
  Bookmark,
  Wand2,
  HelpCircle,
  BookOpen,
  Plus,
  Eraser,
  Trash2,
  BarChart3,
  Columns,
  ArrowLeftRight,
} from 'lucide-react';
import { QueryResult, ColumnMeta, WorkbenchTab, resolveConnectionEnv, buildAlertConnectionContext } from './types/domain';
import { parseSingleTableSelect } from './utils/querySource';
import { quoteSqlIdentifier, buildQualifiedTablePath } from './utils/sqlIdentifier';

interface ChangeTarget {
  stagedKey: string;
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  onApplied: () => void;
}

interface ResultSource {
  table: string;
  database: string;
  schema: string;
  primaryKeys: string[];
  columns: ColumnMeta[];
}

export function App() {
  const {
    tabs,
    activeTabId,
    splitTabId,
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
    setSplitTabId,
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
    setLeftPanelOpen,
    setSearchEverywhereOpen,
    setConnectionDialogOpen,
    openHelpModal,
    tabRefreshTrigger,
    tableStructureModal,
    openEditTableModal,
    closeTableStructureModal,
    ddlModal,
    openDdlModal,
    closeDdlModal,
  } = useWorkbenchStore(
    useShallow((s) => ({
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      splitTabId: s.splitTabId,
      activeBottomTab: s.activeBottomTab,
      isBottomPanelOpen: s.isBottomPanelOpen,
      isRightPanelOpen: s.isRightPanelOpen,
      activeRightSidebarTab: s.activeRightSidebarTab,
      setActiveRightSidebarTab: s.setActiveRightSidebarTab,
      setRightPanelOpen: s.setRightPanelOpen,
      isLeftPanelOpen: s.isLeftPanelOpen,
      consoles: s.consoles,
      hasLoadedConsoles: s.hasLoadedConsoles,
      loadConsoles: s.loadConsoles,
      openTab: s.openTab,
      closeTab: s.closeTab,
      closeTabsMatching: s.closeTabsMatching,
      setActiveTabId: s.setActiveTabId,
      setSplitTabId: s.setSplitTabId,
      reorderTab: s.reorderTab,
      swapTabs: s.swapTabs,
      updateTabContent: s.updateTabContent,
      updateTabDatabase: s.updateTabDatabase,
      updateTabConnection: s.updateTabConnection,
      renameTab: s.renameTab,
      duplicateTab: s.duplicateTab,
      setActiveBottomTab: s.setActiveBottomTab,
      toggleBottomPanel: s.toggleBottomPanel,
      toggleRightPanel: s.toggleRightPanel,
      toggleLeftPanel: s.toggleLeftPanel,
      setLeftPanelOpen: s.setLeftPanelOpen,
      setSearchEverywhereOpen: s.setSearchEverywhereOpen,
      setConnectionDialogOpen: s.setConnectionDialogOpen,
      openHelpModal: s.openHelpModal,
      tabRefreshTrigger: s.tabRefreshTrigger,
      tableStructureModal: s.tableStructureModal,
      openEditTableModal: s.openEditTableModal,
      closeTableStructureModal: s.closeTableStructureModal,
      ddlModal: s.ddlModal,
      openDdlModal: s.openDdlModal,
      closeDdlModal: s.closeDdlModal,
    }))
  );

  const {
    activeConnectionId,
    activeDatabase,
    activeSchema,
    connections,
    setConnections,
    treeDatabases,
    visibleDatabases,
    setTreeDatabases,
    treeObjects,
    setTreeObjects,
    removeTreeObject,
    setActiveConnection,
  } = useConnectionStore(
    useShallow((s) => ({
      activeConnectionId: s.activeConnectionId,
      activeDatabase: s.activeDatabase,
      activeSchema: s.activeSchema,
      connections: s.connections,
      setConnections: s.setConnections,
      treeDatabases: s.treeDatabases,
      visibleDatabases: s.visibleDatabases,
      setTreeDatabases: s.setTreeDatabases,
      treeObjects: s.treeObjects,
      setTreeObjects: s.setTreeObjects,
      removeTreeObject: s.removeTreeObject,
      setActiveConnection: s.setActiveConnection,
    }))
  );
  const [isRunningByTab, setIsRunningByTab] = useState<Record<string, boolean>>({});
  const [queryResultByTab, setQueryResultByTab] = useState<Record<string, QueryResult | null>>({});
  const [activeResultIndexByTab, setActiveResultIndexByTab] = useState<Record<string, number>>({});
  const [statusMessageByTab, setStatusMessageByTab] = useState<Record<string, string>>({});
  const [activeExecIdByTab, setActiveExecIdByTab] = useState<Record<string, string>>({});
  // Ref so global keyboard handlers (registered once) always see the latest exec IDs
  const activeExecIdRef = useRef<Record<string, string>>({});
  activeExecIdRef.current = activeExecIdByTab;
  // Last processed refresh-trigger value per tab (reload only when it changes)
  const lastRefreshHandledRef = useRef<Record<string, number>>({});
  // Latest "replace" load request id per tab (used to drop out-of-order responses)
  const tableReqIdRef = useRef<Record<string, number>>({});
  // Latest running-state / workspace-save timer for use in global handlers & debounce
  const isRunningRef = useRef<Record<string, boolean>>({});
  isRunningRef.current = isRunningByTab;
  const saveWorkspaceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dmlPreview, setDmlPreview] = useState<string[] | null>(null);
  const [copiedResultRawSql, setCopiedResultRawSql] = useState(false);
  const [isTableExportOpen, setIsTableExportOpen] = useState(false);
  const [isTableImportOpen, setIsTableImportOpen] = useState(false);
  const [isSchemaDiffOpen, setIsSchemaDiffOpen] = useState(false);
  const [isSnippetsOpen, setIsSnippetsOpen] = useState(false);
  const [isMockDataOpen, setIsMockDataOpen] = useState(false);
  const [resultViewMode, setResultViewMode] = useState<'table' | 'chart'>('table');
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  const { updateInfo, isUpdateModalOpen, checkUpdate, openUpdateModal } = useUpdateStore();
  const checkUpdatesPeriodically = useSettingsStore((s) => s.checkUpdatesPeriodically);

  useEffect(() => {
    // Check for updates automatically on startup and prompt modal if a newer version is found
    const timer = setTimeout(() => {
      if (useSettingsStore.getState().checkUpdatesOnStartup) {
        checkUpdate(true);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [checkUpdate]);

  useEffect(() => {
    // Periodically check for updates every 10 minutes while the app is open
    if (!checkUpdatesPeriodically) return;
    const interval = setInterval(() => {
      const state = useUpdateStore.getState();
      if (!state.isChecking && !state.isDownloading && !state.isInstalling) {
        state.checkUpdate(true);
      }
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkUpdatesPeriodically]);

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
        isLoadingPrevious?: boolean;
        error: string | null;
        totalCount?: number;
        hasMore: boolean;
        hasPrevious?: boolean;
        pageSize: number;
        page: number;
        startOffset?: number;
        whereClause?: string;
        sortConfigs?: { column: string; direction: 'asc' | 'desc' }[];
      }
    >
  >({});

  // Query Result pagination & lazy load state per tab
  const [queryPaginationByTab, setQueryPaginationByTab] = useState<
    Record<
      string,
      {
        page: number;
        pageSize: number;
        totalCount?: number;
        isLoadingMore: boolean;
        lastSql: string;
        connectionId: string;
        tabId?: string;
        database: string;
        schema: string;
      }
    >
  >({});

  // Track manual transaction status per tab
  const [txStatusByTab, setTxStatusByTab] = useState<
    Record<string, { mode: 'auto' | 'manual'; isOpen: boolean; count: number }>
  >({});

  useEffect(() => {
    const tabIdSet = new Set(tabs.map((t) => t.id));
    Object.entries(txStatusByTab).forEach(([tId, st]) => {
      if (!tabIdSet.has(tId) && st.isOpen) {
        // Remove entry first so rollback is only sent once per closed tab
        setTxStatusByTab((prev) => {
          const next = { ...prev };
          delete next[tId];
          return next;
        });
        QueryService.RollbackTransaction(tId).catch((err) =>
          console.warn('Auto-rollback on tab close failed:', err)
        );
      }
    });
  }, [tabs, txStatusByTab]);

  // Left & Right sidebar resizable widths
  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('dhub_left_sidebar_w');
    return saved ? Math.max(180, Math.min(600, Number(saved))) : 256;
  });
  const [isDraggingLeftResizer, setIsDraggingLeftResizer] = useState(false);

  const [activeLeftSidebarTab, setActiveLeftSidebarTab] = useState<LeftSidebarTab>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('dhub_left_sidebar_tab');
      if (saved === 'explorer' || saved === 'workspaces') return saved as LeftSidebarTab;
    }
    return 'explorer';
  });

  const handleLeftSidebarTabChange = (tab: LeftSidebarTab) => {
    setActiveLeftSidebarTab(tab);
    localStorage.setItem('dhub_left_sidebar_tab', tab);
  };

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
      const tabConn = connections.find((c) => c.id === tab.connectionId);
      const targetDb = tab.database || tabConn?.databaseName || 'main';
      const targetSchema = tab.schema || (tabConn?.driver === 'postgres' ? 'public' : tabConn?.driver === 'mssql' ? 'dbo' : tabConn?.driver === 'oracle' ? '' : targetDb);
      const struct = await SchemaService.GetTableStructure(
        tab.connectionId,
        targetDb,
        targetSchema,
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

  const resolveTableTabMeta = (tab: WorkbenchTab) => {
    const conn = connections.find((c) => c.id === tab.connectionId);
    const driver = conn?.driver || tab.driver || '';
    const targetDb = tab.database || conn?.databaseName || 'main';
    const targetSchema =
      tab.schema ||
      (driver === 'postgres'
        ? 'public'
        : driver === 'mssql'
        ? 'dbo'
        : driver === 'oracle'
        ? ''
        : targetDb);
    const schemaKey = `${tab.connectionId}:${targetDb}:${targetSchema}`;
    const treeObj = (treeObjects[schemaKey] || []).find((o) => o.name === tab.table);
    const objectType = treeObj?.type || 'table';
    return { conn, driver, targetDb, targetSchema, schemaKey, objectType };
  };

  const handleTruncateTableFromTab = async (tab: WorkbenchTab) => {
    if (!tab.connectionId || !tab.table) return;
    const { conn, driver, targetDb, targetSchema, schemaKey, objectType } = resolveTableTabMeta(tab);
    if (conn?.isReadOnly || driver === 'redis') return;

    if (objectType === 'view' || objectType === 'materialized_view') {
      alertWarning('Views cannot be truncated. Use Drop View instead.', 'Cannot Truncate View');
      return;
    }

    const tableName = tab.table;
    const ok = await confirmDialog({
      title: 'Truncate Table',
      message: `Are you sure you want to TRUNCATE table "${tableName}"? All rows in this table will be permanently deleted and auto-increment sequences may be reset. This action cannot be undone.`,
      connectionContext: buildAlertConnectionContext(conn, {
        database: targetDb,
        schema: targetSchema,
        targetName: tableName,
        targetLabel: 'Table',
      }),
      confirmLabel: 'Truncate Table',
      isDanger: true,
    });
    if (!ok) return;

    let sql = '';
    const fullTablePath = buildQualifiedTablePath(driver, targetDb, targetSchema, tableName);
    if (driver === 'postgres') {
      sql = `TRUNCATE TABLE ${fullTablePath} RESTART IDENTITY;`;
    } else if (driver === 'sqlite') {
      const escapedLiteral = tableName.replace(/'/g, "''");
      sql = `DELETE FROM ${quoteSqlIdentifier(driver, tableName)}; DELETE FROM sqlite_sequence WHERE name = '${escapedLiteral}';`;
    } else if (driver === 'mongodb') {
      sql = `db.${tableName}.deleteMany({});`;
    } else {
      sql = `TRUNCATE TABLE ${fullTablePath};`;
    }

    try {
      const execId = 'truncate-table-' + Date.now();
      const res = await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: tab.connectionId,
        database: targetDb,
        schema: targetSchema,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      if (res?.error) {
        throw new Error(res.error);
      }

      SchemaService.GetObjects(tab.connectionId, targetDb, targetSchema)
        .then((objs) => {
          if (objs) setTreeObjects(schemaKey, objs as any);
        })
        .catch(() => {});

      loadTableData(tab);
      alertSuccess(`Table "${tableName}" was truncated successfully.`, 'Table Truncated');
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Truncate Table');
    }
  };

  const handleDropTableFromTab = async (tab: WorkbenchTab) => {
    if (!tab.connectionId || !tab.table) return;
    const { conn, driver, targetDb, targetSchema, schemaKey, objectType } = resolveTableTabMeta(tab);
    if (conn?.isReadOnly || driver === 'redis') return;

    const isView = objectType === 'view';
    const keyword = isView ? 'VIEW' : 'TABLE';
    const tableName = tab.table;

    const ok = await confirmDialog({
      title: `Drop ${isView ? 'View' : 'Table'}`,
      message: `Are you sure you want to DROP ${keyword.toLowerCase()} "${tableName}"? All data in this ${keyword.toLowerCase()} will be permanently lost. This action cannot be undone.`,
      connectionContext: buildAlertConnectionContext(conn, {
        database: targetDb,
        schema: targetSchema,
        targetName: tableName,
        targetLabel: isView ? 'View' : 'Table',
      }),
      confirmLabel: `Drop ${keyword.toLowerCase()}`,
      isDanger: true,
    });
    if (!ok) return;

    let sql = '';
    if (driver === 'mongodb') {
      sql = `db.${tableName}.drop();`;
    } else {
      const fullTablePath = buildQualifiedTablePath(driver, targetDb, targetSchema, tableName);
      sql = `DROP ${keyword} ${fullTablePath};`;
    }

    try {
      const execId = 'drop-table-' + Date.now();
      const res = await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: tab.connectionId,
        database: targetDb,
        schema: targetSchema,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      if (res?.error) {
        throw new Error(res.error);
      }

      removeTreeObject(schemaKey, tableName);
      closeTab(tab.id);

      SchemaService.GetObjects(tab.connectionId, targetDb, targetSchema)
        .then((objs) => {
          if (objs) setTreeObjects(schemaKey, objs as any);
        })
        .catch(() => {});

      alertSuccess(`Dropped ${keyword.toLowerCase()} "${tableName}".`, `${keyword} Dropped`);
    } catch (err: any) {
      alertError(err?.message || String(err), `Failed to Drop ${keyword}`);
    }
  };

  const computeVisibleTabCount = (bar: HTMLElement | null, tabCount: number): number => {
    if (tabCount === 0) return 0;
    if (!bar) return tabCount;

    const totalBarWidth = bar.clientWidth;
    if (totalBarWidth <= 0) return tabCount;

    const paddingX = 12; // px-1.5 (6px left + 6px right)
    const gap = 4; // gap-1 (4px)
    const triggerButtonReserve = 44; // space for >> {{count}} button
    const tabSlotWidth = 124; // max-w-[124px] per tab

    const maxWithoutTrigger = Math.max(
      1,
      Math.floor((totalBarWidth - paddingX + gap) / (tabSlotWidth + gap))
    );

    if (tabCount <= maxWithoutTrigger) {
      return tabCount;
    }

    const maxAvail = Math.max(tabSlotWidth, totalBarWidth - triggerButtonReserve - paddingX);
    return Math.min(
      tabCount - 1,
      Math.max(1, Math.floor((maxAvail + gap) / (tabSlotWidth + gap)))
    );
  };

  const updateOverflowTabs = React.useCallback(() => {
    setVisibleCount(computeVisibleTabCount(tabBarContainerRef.current, tabs.length));
  }, [tabs.length]);

  useEffect(() => {
    updateOverflowTabs();
    const raf = requestAnimationFrame(updateOverflowTabs);
    const timer = setTimeout(updateOverflowTabs, 120);
    window.addEventListener('resize', updateOverflowTabs);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener('resize', updateOverflowTabs);
    };
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
    const currentVisibleCount = computeVisibleTabCount(tabBarContainerRef.current, tabs.length);
    if (!activeTabId || currentVisibleCount <= 0 || tabs.length <= currentVisibleCount) return;
    const activeIdx = tabs.findIndex((t) => t.id === activeTabId);
    if (activeIdx >= currentVisibleCount) {
      const lastVisibleTab = tabs[currentVisibleCount - 1];
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
    };

    const handleMouseUp = () => {
      setIsDraggingLeftResizer(false);
      localStorage.setItem('dhub_left_sidebar_w', String(latestWidth));
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
    };

    const handleMouseUp = () => {
      setIsDraggingRightResizer(false);
      localStorage.setItem('dhub_right_sidebar_w', String(latestWidth));
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

  // Load persisted panel dimensions and workspaces from SQLite on mount
  useEffect(() => {
    useWorkspaceSessionStore.getState().loadWorkspaces();
    WorkspaceService.GetSettings()
      .then((settings) => {
        if (!settings) return;
        if (settings['dhub_left_sidebar_w']) {
          const w = Math.max(180, Math.min(600, Number(settings['dhub_left_sidebar_w'])));
          if (!Number.isNaN(w)) setLeftSidebarWidth(w);
        }
        if (settings['dhub_right_sidebar_w']) {
          const w = Math.max(180, Math.min(1000, Number(settings['dhub_right_sidebar_w'])));
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
    };

    const handleMouseUp = () => {
      setIsDraggingBottomResizer(false);
      localStorage.setItem('dhub_bottom_panel_h', String(latestHeight));
      WorkspaceService.SaveSetting('dhub_bottom_panel_h', String(latestHeight)).catch(() => {});
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const splitTab = splitTabId && splitTabId !== activeTabId ? tabs.find((t) => t.id === splitTabId) : undefined;
  const currentTabId = activeTab?.id || '';

  const isRunning = isRunningByTab[currentTabId] || false;
  const queryResult = queryResultByTab[currentTabId] || null;
  const activeResultIndex = activeResultIndexByTab[currentTabId] || 0;
  const statusMessage = statusMessageByTab[currentTabId] || 'Ready';
  const defaultPageSize = useSettingsStore((s) => s.defaultPageSize) || 100;
  const queryPagination = queryPaginationByTab[currentTabId] || {
    page: 1,
    pageSize: defaultPageSize,
    isLoadingMore: false,
    lastSql: '',
    connectionId: '',
    tabId: currentTabId,
    database: '',
    schema: '',
  };

  // Editable source table detection for console query results
  const [resultSourceByKey, setResultSourceByKey] = useState<Record<string, ResultSource | null>>({});
  const activeResultRes: any =
    queryResult?.results && queryResult.results.length > 0
      ? (queryResult.results[activeResultIndex] ?? queryResult.results[queryResult.results.length - 1])
      : queryResult;
  const activeResultSql: string =
    activeResultRes?.sql || queryResult?.sql || queryPagination.lastSql || '';
  const resultGridKey = `${currentTabId}|${queryResult?.executionId || ''}|${activeResultSql}`;
  const resultGridTabId = `bottom-result-${currentTabId}`;

  useEffect(() => {
    if (!activeTab || activeTab.type !== 'worksheet') return;
    if (!queryResult || queryResult.error || !(activeResultRes?.columns?.length > 0)) return;
    if (resultSourceByKey[resultGridKey] !== undefined) return;

    const parsed = parseSingleTableSelect(activeResultSql);
    if (!parsed) {
      setResultSourceByKey((prev) => ({ ...prev, [resultGridKey]: null }));
      return;
    }

    let cancelled = false;
    (async () => {
      let resolved: ResultSource | null = null;
      try {
        const connId = activeTab.connectionId || useConnectionStore.getState().activeConnectionId || '';
        const conn = useConnectionStore.getState().connections.find((c) => c.id === connId);
        const driver = conn?.driver;
        const isMy = driver === 'mysql' || driver === 'mariadb';
        const baseDb = queryPagination.database || activeTab.database || conn?.databaseName || 'main';
        let db = baseDb;
        let schema =
          queryPagination.schema ||
          activeTab.schema ||
          (driver === 'postgres' ? 'public' : driver === 'mssql' ? 'dbo' : driver === 'oracle' ? '' : baseDb);
        if (parsed.qualifier) {
          if (isMy) {
            db = parsed.qualifier;
            schema = parsed.qualifier;
          } else {
            schema = parsed.qualifier;
          }
        }
        const struct: any = await SchemaService.GetTableStructure(connId, db, schema, parsed.table);
        const structCols: ColumnMeta[] = struct?.columns || [];
        const pks: string[] = struct?.primaryKeys || [];
        const resCols: ColumnMeta[] = activeResultRes.columns || [];
        const lower = (s: string) => s.toLowerCase();
        const allMapped = resCols.every((c) => structCols.some((sc) => lower(sc.name) === lower(c.name)));
        const pksPresent = pks.every((pk) => resCols.some((c) => lower(c.name) === lower(pk)));
        if (structCols.length > 0 && pks.length > 0 && allMapped && pksPresent) {
          resolved = {
            table: parsed.table,
            database: db,
            schema,
            primaryKeys: pks,
            columns: resCols.map((c) => {
              const found = structCols.find((sc) => lower(sc.name) === lower(c.name))!;
              return {
                ...c,
                ...found,
                name: c.name,
                isPrimaryKey: pks.some((pk) => lower(pk) === lower(c.name)),
              };
            }),
          };
        }
      } catch (err) {
        console.warn('Could not resolve editable source for query result:', err);
      }
      if (!cancelled) {
        setResultSourceByKey((prev) => ({ ...prev, [resultGridKey]: resolved }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resultGridKey, activeTab?.type, queryResult]);

  const resultSource: ResultSource | null = resultSourceByKey[resultGridKey] ?? null;

  const setQueryResult = (
    res: QueryResult | null | ((prev: QueryResult | null) => QueryResult | null)
  ) => {
    if (!currentTabId) return;
    setQueryResultByTab((prev) => {
      const current = prev[currentTabId] || null;
      const next = typeof res === 'function' ? (res as any)(current) : res;
      return { ...prev, [currentTabId]: next };
    });
  };

  const setActiveResultIndex = (idx: number | ((prev: number) => number)) => {
    if (!currentTabId) return;
    setActiveResultIndexByTab((prev) => {
      const current = prev[currentTabId] || 0;
      const next = typeof idx === 'function' ? (idx as any)(current) : idx;
      return { ...prev, [currentTabId]: next };
    });
  };

  const setIsRunning = (running: boolean | ((prev: boolean) => boolean)) => {
    if (!currentTabId) return;
    setIsRunningByTab((prev) => {
      const current = prev[currentTabId] || false;
      const next = typeof running === 'function' ? (running as any)(current) : running;
      return { ...prev, [currentTabId]: next };
    });
  };

  const setStatusMessage = (msg: string | ((prev: string) => string)) => {
    if (!currentTabId) return;
    setStatusMessageByTab((prev) => {
      const current = prev[currentTabId] || 'Ready';
      const next = typeof msg === 'function' ? (msg as any)(current) : msg;
      return { ...prev, [currentTabId]: next };
    });
  };

  const setQueryPagination = (
    val:
      | {
          page: number;
          pageSize: number;
          totalCount?: number;
          isLoadingMore: boolean;
          lastSql: string;
          connectionId: string;
          tabId?: string;
          database: string;
          schema: string;
        }
      | ((prev: {
          page: number;
          pageSize: number;
          totalCount?: number;
          isLoadingMore: boolean;
          lastSql: string;
          connectionId: string;
          tabId?: string;
          database: string;
          schema: string;
        }) => {
          page: number;
          pageSize: number;
          totalCount?: number;
          isLoadingMore: boolean;
          lastSql: string;
          connectionId: string;
          tabId?: string;
          database: string;
          schema: string;
        })
  ) => {
    if (!currentTabId) return;
    setQueryPaginationByTab((prev) => {
      const current = prev[currentTabId] || {
        page: 1,
        pageSize: defaultPageSize,
        isLoadingMore: false,
        lastSql: '',
        connectionId: '',
        tabId: currentTabId,
        database: '',
        schema: '',
      };
      const next = typeof val === 'function' ? (val as any)(current) : val;
      return { ...prev, [currentTabId]: next };
    });
  };

  const handleCancelQuery = async (tabId: string) => {
    const execId = activeExecIdRef.current[tabId];
    // Nothing running on this tab: don't cancel or show a misleading status
    if (!execId || !isRunningRef.current[tabId]) return;
    if (execId) {
      try {
        await QueryService.CancelQuery(execId);
      } catch (err) {
        console.error('CancelQuery error:', err);
      }
    }
    setIsRunningByTab((prev) => ({ ...prev, [tabId]: false }));
    setStatusMessageByTab((prev) => ({ ...prev, [tabId]: 'Query execution cancelled' }));
  };

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
  const searchShortcutLabel = isMac ? '⌘P' : 'Ctrl+P';

  // Global Keyboard shortcuts: Ctrl+P / Cmd+P for Search Everywhere
  useEffect(() => {
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

      // Toggle Right Sidebar: Ctrl+R / Cmd+R
      if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        toggleRightPanel();
        return;
      }

      // Settings shortcut: Ctrl+I / Cmd+I
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        useSettingsStore.getState().toggleSettings();
        return;
      }

      // Close Active Tab: Ctrl+W / Cmd+W
      if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        const activeId = useWorkbenchStore.getState().activeTabId;
        if (activeId) {
          useWorkbenchStore.getState().closeTab(activeId);
        }
        return;
      }

      // Stop Query Execution: Ctrl+Shift+D / Cmd+Shift+D
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        const activeId = useWorkbenchStore.getState().activeTabId;
        if (activeId) {
          handleCancelQuery(activeId);
        }
        return;
      }

      // Open Help & User Guide: Ctrl+H / Cmd+H
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        useWorkbenchStore.getState().toggleHelpModal();
        return;
      }

      // Views / Value Viewer: Ctrl+T / Cmd+T
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 't' || e.key === 'T')) {
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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isSettingsMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setIsSettingsMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSettingsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isSettingsMenuOpen]);

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
    const menuHeight = tab.type === 'table_data' ? 300 : 220;
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
    mode: 'replace' | 'append' | 'prepend' | boolean = 'replace',
    page = 1,
    newWhereClause?: string,
    newSortConfigs?: { column: string; direction: 'asc' | 'desc' }[]
  ) => {
    const fetchMode: 'replace' | 'append' | 'prepend' =
      typeof mode === 'boolean' ? (mode ? 'append' : 'replace') : mode;

    const connId = tab.connectionId || activeConnectionId;
    if (!tab || tab.type !== 'table_data' || !connId || !tab.table) return;

    // Request tracking: a 'replace' load supersedes everything in flight for this tab;
    // append/prepend loads are dropped if a 'replace' started after them.
    if (fetchMode === 'replace') {
      tableReqIdRef.current[tab.id] = (tableReqIdRef.current[tab.id] || 0) + 1;
    }
    const reqId = tableReqIdRef.current[tab.id] || 0;
    const isStale = () =>
      (tableReqIdRef.current[tab.id] || 0) !== reqId ||
      !useWorkbenchStore.getState().tabs.some((t) => t.id === tab.id);
    // Status messages belong to the tab being loaded, not whichever tab is active now
    const setStatusMessage = (msg: string) =>
      setStatusMessageByTab((prev) => ({ ...prev, [tab.id]: msg }));

    const freshTab = useWorkbenchStore.getState().tabs.find((t) => t.id === tab.id);
    const savedViewState = freshTab?.tableViewState ?? tab.tableViewState;
    const prevTabData = tableDataByTab[tab.id];

    // Priority: new param -> prevTabData -> saved tab state -> defaults
    const whereClause =
      newWhereClause !== undefined
        ? newWhereClause
        : prevTabData?.whereClause !== undefined
        ? prevTabData.whereClause
        : savedViewState?.whereClause ?? '';

    const sortConfigs =
      newSortConfigs !== undefined
        ? newSortConfigs
        : prevTabData?.sortConfigs !== undefined
        ? prevTabData.sortConfigs
        : savedViewState?.sortConfigs ?? [];

    const effectivePageSize =
      limit > 0
        ? limit
        : prevTabData?.pageSize || savedViewState?.pageSize || useSettingsStore.getState().defaultPageSize || 100;

    // Windowed / Centered Offset calculation
    let effectiveOffset = offset;
    let effectivePage = page;
    let fetchLimit = effectivePageSize + 1;

    if (fetchMode === 'prepend') {
      const currentStart = prevTabData?.startOffset || 0;
      if (currentStart <= 0) return;
      fetchLimit = Math.min(effectivePageSize, currentStart);
      effectiveOffset = Math.max(0, currentStart - fetchLimit);
      effectivePage = Math.floor(effectiveOffset / effectivePageSize) + 1;
    } else if (fetchMode === 'append') {
      const currentStart = prevTabData?.startOffset || 0;
      const currentLength = prevTabData?.rows?.length || 0;
      effectiveOffset = currentStart + currentLength;
      effectivePage = Math.floor(effectiveOffset / effectivePageSize) + 1;
      fetchLimit = effectivePageSize + 1;
    } else {
      // 'replace': restore active page from savedViewState if opening/restoring tab
      if (offset === 0 && page === 1 && savedViewState && newWhereClause === undefined && newSortConfigs === undefined) {
        const savedPage =
          savedViewState.page ||
          (savedViewState.offset ? Math.floor(savedViewState.offset / effectivePageSize) + 1 : 1);
        if (savedPage > 1) {
          effectivePage = savedPage;
          effectiveOffset = (savedPage - 1) * effectivePageSize;
        }
      }
      fetchLimit = effectivePageSize + 1;
    }

    const filtersChanged = newWhereClause !== undefined;

    if (fetchMode === 'append') {
      setTableDataByTab((prev) => ({
        ...prev,
        [tab.id]: {
          ...prev[tab.id],
          isLoadingMore: true,
          error: null,
        },
      }));
    } else if (fetchMode === 'prepend') {
      setTableDataByTab((prev) => ({
        ...prev,
        [tab.id]: {
          ...prev[tab.id],
          isLoadingPrevious: true,
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
          isLoadingPrevious: false,
          error: null,
          totalCount: filtersChanged ? undefined : prev[tab.id]?.totalCount,
          hasMore: false,
          hasPrevious: false,
          startOffset: effectiveOffset,
          pageSize: effectivePageSize,
          page: effectivePage,
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
      const effectiveDriver = conn?.driver || tab.driver;
      const isMSSQL = effectiveDriver === 'mssql';
      const targetDb = tab.database || conn?.databaseName || 'main';
      const targetSchema = tab.schema || (effectiveDriver === 'postgres' ? 'public' : isMSSQL ? 'dbo' : effectiveDriver === 'oracle' ? '' : targetDb);

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

      const quoteIdent = (name: string) => quoteSqlIdentifier(effectiveDriver, name);
      const fullTablePath = buildQualifiedTablePath(effectiveDriver, targetDb, targetSchema, tab.table);

      // 2. Build SQL WHERE clause
      const trimmedCustom = (whereClause || '').trim();
      const cleanCustom = trimmedCustom.replace(/^where\s+/i, '').trim();
      const combinedWhere = cleanCustom ? ` WHERE (${cleanCustom})` : '';

      // 2b. Build ORDER BY clause (multi-column sort: first added column has primary priority)
      let orderByClause = '';
      if (sortConfigs && sortConfigs.length > 0) {
        const orderParts = sortConfigs.map((sc) => {
          const quotedSortCol = quoteIdent(sc.column);
          return `${quotedSortCol} ${sc.direction.toUpperCase()}`;
        });
        orderByClause = ` ORDER BY ${orderParts.join(', ')}`;
      }

      // 3. Query table data with LIMIT, OFFSET, WHERE and ORDER BY
      const sql = `SELECT * FROM ${fullTablePath}${combinedWhere}${orderByClause} LIMIT ${fetchLimit} OFFSET ${effectiveOffset};`;

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

        if (isStale()) return;
        const rawRows = (res.rows as any) || [];
        let fetchedRows: any[][] = [];
        let hasMore = prevTabData?.hasMore ?? false;

        if (fetchMode === 'prepend') {
          fetchedRows = rawRows;
        } else {
          hasMore = rawRows.length > effectivePageSize;
          fetchedRows = hasMore ? rawRows.slice(0, effectivePageSize) : rawRows;
        }

        const currentEnd = effectiveOffset + fetchedRows.length;

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
          const currentTabState = prev[tab.id];
          let combinedRows: any[][] = [];
          let newStartOffset = currentTabState?.startOffset || 0;
          let newHasPrevious = false;
          let newHasMore = hasMore;

          const MAX_CACHED_ROWS_PER_TAB = 1000;

          if (fetchMode === 'append') {
            combinedRows = [...(currentTabState?.rows || []), ...fetchedRows];
            newStartOffset = currentTabState?.startOffset || 0;
            if (combinedRows.length > MAX_CACHED_ROWS_PER_TAB) {
              const excess = combinedRows.length - MAX_CACHED_ROWS_PER_TAB;
              combinedRows = combinedRows.slice(excess);
              newStartOffset += excess;
            }
            newHasPrevious = newStartOffset > 0;
          } else if (fetchMode === 'prepend') {
            combinedRows = [...fetchedRows, ...(currentTabState?.rows || [])];
            newStartOffset = effectiveOffset;
            newHasPrevious = newStartOffset > 0;
            newHasMore = currentTabState?.hasMore ?? false;
            if (combinedRows.length > MAX_CACHED_ROWS_PER_TAB) {
              combinedRows = combinedRows.slice(0, MAX_CACHED_ROWS_PER_TAB);
              newHasMore = true;
            }
          } else {
            // replace
            combinedRows = fetchedRows;
            newStartOffset = effectiveOffset;
            newHasPrevious = effectiveOffset > 0;
          }

          const prevTotal = currentTabState?.totalCount;
          const knownTotal = !newHasMore
            ? Math.max(prevTotal || 0, newStartOffset + combinedRows.length)
            : prevTotal !== undefined
            ? Math.max(prevTotal, newStartOffset + combinedRows.length)
            : undefined;

          return {
            ...prev,
            [tab.id]: {
              columns: finalCols,
              rows: combinedRows,
              primaryKeys: detectedPKs,
              isLoading: false,
              isLoadingMore: false,
              isLoadingPrevious: false,
              error: null,
              totalCount: knownTotal,
              hasMore: newHasMore,
              hasPrevious: newHasPrevious,
              startOffset: newStartOffset,
              pageSize: effectivePageSize,
              page: fetchMode === 'append' ? currentTabState?.page || 1 : effectivePage,
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
          `Loaded ${fetchedRows.length} rows (${effectiveOffset + fetchedRows.length} total) from ${tab.table}${filterNotice}${sortNotice}`
        );
      }
    } catch (e: any) {
      console.error(`Failed to load data for ${tab.table}:`, e);
      if (isStale()) return;
      setTableDataByTab((prev) => ({
        ...prev,
        [tab.id]: {
          columns: structureColumns.length > 0 ? structureColumns : (prev[tab.id]?.columns || []),
          rows: prev[tab.id]?.rows || [],
          primaryKeys: primaryKeys.length > 0 ? primaryKeys : (prev[tab.id]?.primaryKeys || []),
          isLoading: false,
          isLoadingMore: false,
          isLoadingPrevious: false,
          error: e?.message || String(e),
          hasMore: false,
          hasPrevious: (prev[tab.id]?.startOffset || 0) > 0,
          startOffset: prev[tab.id]?.startOffset || 0,
          pageSize: limit,
          page: fetchMode === 'append' ? prev[tab.id]?.page || 1 : page,
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
      const refreshed = refreshCount !== (lastRefreshHandledRef.current[activeTab.id] || 0);
      if (refreshed) lastRefreshHandledRef.current[activeTab.id] = refreshCount;
      if (refreshed || !existing || (!existing.isLoading && existing.rows.length === 0 && !existing.error)) {
        loadTableData(activeTab);
      }
    }
    if (splitTab && splitTab.type === 'table_data') {
      const existingSplit = tableDataByTab[splitTab.id];
      const refreshCount = tabRefreshTrigger[splitTab.id] || 0;
      const refreshed = refreshCount !== (lastRefreshHandledRef.current[splitTab.id] || 0);
      if (refreshed) lastRefreshHandledRef.current[splitTab.id] = refreshCount;
      if (refreshed || !existingSplit || (!existingSplit.isLoading && existingSplit.rows.length === 0 && !existingSplit.error)) {
        loadTableData(splitTab);
      }
    }
  }, [activeTabId, splitTabId, tabRefreshTrigger[activeTabId || ''], tabRefreshTrigger[splitTabId || '']]);

  // Free cached rows and query results of closed tabs so they can be garbage collected
  useEffect(() => {
    const openIds = new Set(tabs.map((t) => t.id));
    const cleanStale = <T extends Record<string, any>>(prev: T): T => {
      let changed = false;
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (!openIds.has(k)) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    };
    setTableDataByTab(cleanStale);
    setQueryResultByTab(cleanStale);
    setActiveResultIndexByTab(cleanStale);
    setQueryPaginationByTab(cleanStale);
    setIsRunningByTab(cleanStale);
    setStatusMessageByTab(cleanStale);
    setActiveExecIdByTab(cleanStale);
    setResultSourceByKey((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        const tabId = k.split('|')[0];
        if (tabId && !openIds.has(tabId)) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tabs]);

  // Load saved consoles from SQLite on startup
  useEffect(() => {
    loadConsoles();
    useWorkspaceSessionStore.getState().loadWorkspaces();
  }, [loadConsoles]);

  // Auto-save active workspace when tabs change
  useEffect(() => {
    if (useWorkspaceSessionStore.getState().hasLoaded) {
      if (saveWorkspaceTimerRef.current) clearTimeout(saveWorkspaceTimerRef.current);
      saveWorkspaceTimerRef.current = setTimeout(() => {
        useWorkspaceSessionStore.getState().saveCurrentWorkspace(tabs, activeTabId);
      }, 500);
    }
  }, [tabs, activeTabId]);

  // Pre-load databases for connections so console dropdowns are always populated
  useEffect(() => {
    connections.forEach((c) => {
      const isRedis = c.driver?.toLowerCase() === 'redis';
      if (isRedis && (!treeDatabases[c.id] || treeDatabases[c.id].includes('default') || treeDatabases[c.id].includes('main'))) {
        const redisDbs = Array.from({ length: 16 }, (_, i) => `db${i}`);
        setTreeDatabases(c.id, redisDbs);
      } else if (!treeDatabases[c.id]) {
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
      if (currentTab) {
        setActiveExecIdByTab((prev) => ({ ...prev, [currentTab.id]: execId }));
      }
      const defaultLimit = useSettingsStore.getState().defaultPageSize || 100;
      const res = await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: targetConnId,
        tabId: currentTab?.id || '',
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
      const lastResultIdx = Math.max(0, ((res as any)?.results?.length || 1) - 1);
      setActiveResultIndex(lastResultIdx);
      setQueryPagination({
        page: 1,
        pageSize: defaultLimit,
        totalCount: undefined,
        isLoadingMore: false,
        lastSql: sql,
        connectionId: targetConnId,
        tabId: currentTab?.id || '',
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

  // For multi-statement runs, page/reload the currently selected statement
  const getPagingSql = () => {
    const results = queryResult?.results;
    if (results && results.length > 0) {
      const active = (results[activeResultIndex] ?? results[results.length - 1]) as any;
      if (active?.sql) return active.sql;
    }
    return queryPagination.lastSql;
  };

  const handleCountTableRows = async (tab: WorkbenchTab) => {
    if (!tab.connectionId || !tab.table) return;
    const conn = connections.find((c) => c.id === tab.connectionId);
    const driver = conn?.driver || tab.driver;
    if (driver === 'redis' || driver === 'mongodb') return;

    const isMSSQL = driver === 'mssql';
    const targetDb = tab.database || conn?.databaseName || 'main';
    const targetSchema =
      tab.schema || (driver === 'postgres' ? 'public' : isMSSQL ? 'dbo' : driver === 'oracle' ? '' : targetDb);
    const fullTablePath = buildQualifiedTablePath(driver, targetDb, targetSchema, tab.table);

    const whereClause = tableDataByTab[tab.id]?.whereClause ?? tab.tableViewState?.whereClause ?? '';
    const cleanCustom = whereClause.trim().replace(/^where\s+/i, '').trim();
    const combinedWhere = cleanCustom ? ` WHERE (${cleanCustom})` : '';

    try {
      const countRes = await QueryService.ExecuteQuery({
        executionId: 'exec-count-' + Date.now(),
        connectionId: tab.connectionId,
        database: targetDb,
        schema: targetSchema,
        sql: `SELECT COUNT(*) FROM ${fullTablePath}${combinedWhere};`,
        limit: 1,
        offset: 0,
      } as any);
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
    } catch (err) {
      console.warn('Count query failed:', err);
    }
  };

  const handleCountQueryRows = async () => {
    const pagingSql = getPagingSql();
    if (!pagingSql || !queryPagination.connectionId) return;
    const cleanSql = pagingSql.trim().replace(/;+\s*$/, '');
    if (!cleanSql) return;

    try {
      const countRes = await QueryService.ExecuteQuery({
        executionId: 'exec-qcount-' + Date.now(),
        connectionId: queryPagination.connectionId,
        tabId: queryPagination.tabId || currentTabId || '',
        database: queryPagination.database,
        schema: queryPagination.schema,
        sql: `SELECT COUNT(*) FROM (${cleanSql}) _dhub_count_subq`,
        limit: 1,
        offset: 0,
      } as any);
      const countVal = countRes?.rows?.[0]?.[0];
      const num = typeof countVal === 'number' ? countVal : parseInt(String(countVal), 10);
      if (!isNaN(num) && num >= 0) {
        setQueryPagination((p) => ({ ...p, totalCount: num }));
      }
    } catch (err) {
      console.warn('Query count failed:', err);
    }
  };

  const handleQueryLoadMore = async () => {
    if (queryPagination.isLoadingMore || !queryResult || !queryPagination.lastSql) return;
    const currentRes =
      queryResult.results && queryResult.results.length > 0
        ? (queryResult.results[activeResultIndex] ?? queryResult.results[queryResult.results.length - 1])
        : queryResult;
    const currentRows = currentRes?.rows || [];
    const limit = queryPagination.pageSize || useSettingsStore.getState().defaultPageSize || 100;
    const offset = currentRows.length;

    setQueryPagination((p) => ({ ...p, isLoadingMore: true }));
    try {
      const res = await QueryService.ExecuteQuery({
        executionId: 'exec-more-' + Date.now(),
        connectionId: queryPagination.connectionId,
        tabId: queryPagination.tabId || currentTabId || '',
        database: queryPagination.database,
        schema: queryPagination.schema,
        sql: getPagingSql(),
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
        tabId: queryPagination.tabId || currentTabId || '',
        database: queryPagination.database,
        schema: queryPagination.schema,
        sql: getPagingSql(),
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
        tabId: queryPagination.tabId || currentTabId || '',
        database: queryPagination.database,
        schema: queryPagination.schema,
        sql: getPagingSql(),
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

  const resolveTableTabTarget = (): ChangeTarget | null => {
    const currentTab =
      useWorkbenchStore.getState().tabs.find((t) => t.id === useWorkbenchStore.getState().activeTabId) ||
      activeTab;
    const connId = currentTab?.connectionId || activeConnectionId;
    if (!currentTab || currentTab.type !== 'table_data' || !connId) return null;
    return {
      stagedKey: currentTab.id,
      connectionId: connId,
      database: currentTab.database || '',
      schema: currentTab.schema || '',
      table: currentTab.table || '',
      onApplied: () => {
        if (currentTab.table) loadTableData(currentTab);
      },
    };
  };

  const handlePreviewChanges = async (explicitTarget?: ChangeTarget) => {
    const target = explicitTarget || resolveTableTabTarget();
    if (!target) return;
    const staged = useGridEditStore.getState().stagedByTab[target.stagedKey] || {};
    const changeList = Object.values(staged);
    if (changeList.length === 0) return;

    try {
      const sqls = await QueryService.PreviewChanges(
        target.connectionId,
        target.database,
        target.schema,
        target.table,
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

  const handleSubmitChanges = async (skipConfirm = false, explicitTarget?: ChangeTarget) => {
    const target = explicitTarget || resolveTableTabTarget();
    if (!target) return;
    const staged = useGridEditStore.getState().stagedByTab[target.stagedKey] || {};
    const changeList = Object.values(staged);
    if (changeList.length === 0) return;

    const executeApply = async () => {
      try {
        const affected = await QueryService.SubmitChanges(
          target.connectionId,
          target.database,
          target.schema,
          target.table,
          changeList as any
        );
        useAlertStore.getState().showAlert({
          type: 'success',
          title: 'Changes Applied Successfully',
          message: `Successfully applied ${affected} change(s) to table "${target.table}".`,
        });
        useGridEditStore.getState().revertTabChanges(target.stagedKey);
        target.onApplied();
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
      message: `Are you sure you want to apply ${changeList.length} staged change(s) to table "${target.table}"?`,
      details: summaryParts.join(' • '),
      confirmLabel: 'Apply Changes',
      cancelLabel: 'Cancel',
      confirmVariant: 'emerald',
      onConfirm: () => {
        executeApply();
      },
    });
  };

  const buildResultTarget = (): ChangeTarget | null => {
    if (!resultSource) return null;
    const connId = activeTab?.connectionId || activeConnectionId;
    if (!connId) return null;
    return {
      stagedKey: resultGridTabId,
      connectionId: connId,
      database: resultSource.database,
      schema: resultSource.schema,
      table: resultSource.table,
      onApplied: () => {
        handleQueryPageChange(queryPagination.page);
      },
    };
  };

  return (
    <Suspense fallback={null}>
    <div className="flex h-screen w-screen flex-col bg-[#121317] text-zinc-300 font-sans select-none overflow-hidden">
      {/* Top Titlebar / Islands Header */}
      <WorkbenchHeader
        isMac={isMac}
        updateInfo={updateInfo}
        isUpdateModalOpen={isUpdateModalOpen}
        isSettingsMenuOpen={isSettingsMenuOpen}
        settingsMenuRef={settingsMenuRef}
        onToggleSettingsMenu={() => setIsSettingsMenuOpen((prev) => !prev)}
        onCloseSettingsMenu={() => setIsSettingsMenuOpen(false)}
        onOpenUpdateModal={openUpdateModal}
        onOpenSnippets={() => setIsSnippetsOpen(true)}
        onOpenSchemaDiff={() => setIsSchemaDiffOpen(true)}
        onOpenHelp={openHelpModal}
      />

      {/* Main Workspace Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left Sidebar: Database Explorer & Workspaces */}
        {isLeftPanelOpen ? (
          <>
            <div
              style={{ width: `${leftSidebarWidth}px` }}
              className="h-full shrink-0 overflow-hidden"
            >
              <LeftSidebar
                activeTab={activeLeftSidebarTab}
                onTabChange={handleLeftSidebarTabChange}
                onCollapse={toggleLeftPanel}
              />
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
              title="Drag to resize Left Sidebar (Double-click to reset)"
            >
              <div className="w-0.5 h-8 rounded-full bg-zinc-700 group-hover:bg-blue-200 transition-colors" />
            </div>
          </>
        ) : (
          /* Minimized Left Sidebar Strip */
          <div className="h-full w-9 shrink-0 bg-[#16171d] border-r border-[#272932] flex flex-col items-center py-3 select-none z-10">
            {/* EXPLORER Button */}
            <Popover
              content="Open Explorer"
              shortcut={isMac ? '⌘B' : 'Ctrl+B'}
              side="right"
              align="start"
            >
              <div
                onClick={() => {
                  setLeftPanelOpen(true);
                  handleLeftSidebarTabChange('explorer');
                }}
                className="flex flex-col items-center cursor-pointer group px-1 py-2 rounded hover:bg-[#22242c]/60 transition-colors"
              >
                <Database className="h-4 w-4 text-zinc-500 group-hover:text-blue-400 transition-colors mb-2" />
                <div className="text-[10px] tracking-widest font-semibold uppercase text-zinc-500 group-hover:text-zinc-300 transition-colors [writing-mode:vertical-rl] rotate-180">
                  EXPLORER
                </div>
              </div>
            </Popover>

            {/* WORKSPACES Button */}
            <Popover
              content="Open Workspaces"
              shortcut={isMac ? '⌘B' : 'Ctrl+B'}
              side="right"
              align="start"
            >
              <div
                onClick={() => {
                  setLeftPanelOpen(true);
                  handleLeftSidebarTabChange('workspaces');
                }}
                className="mt-6 flex flex-col items-center cursor-pointer group px-1 py-2 rounded hover:bg-[#22242c]/60 transition-colors"
              >
                <Briefcase className="h-4 w-4 text-zinc-500 group-hover:text-blue-400 transition-colors mb-2" />
                <div className="text-[10px] tracking-widest font-semibold uppercase text-zinc-500 group-hover:text-zinc-300 transition-colors [writing-mode:vertical-rl] rotate-180">
                  WORKSPACES
                </div>
              </div>
            </Popover>
          </div>
        )}

        {/* Center Workbench: Tabs + Editor/Grid + Services Bottom Panel */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#14151a]">
          {/* Tab Bar */}
          {(() => {
            const clampedVisibleCount =
              tabs.length === 0 ? 0 : Math.max(1, Math.min(visibleCount || tabs.length, tabs.length));
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

          {/* Active Tab View (supports optional Split View side-by-side) */}
          <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
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
              const effectiveSchema =
                activeTab.schema ||
                useConnectionStore.getState().activeSchema ||
                (tabConn?.driver === 'postgres' ? 'public' : effectiveDb);
              const availableDbs =
                visibleDbs.length > 0
                  ? visibleDbs
                  : (visibleList !== undefined
                      ? visibleList
                      : (tabConn?.databaseName ? [tabConn.databaseName] : (tabConn?.driver === 'sqlite' ? ['main'] : [])));

              return (
                <div className="flex-1 min-h-0">
                  <SqlWorksheet
                    tabId={activeTab.id}
                    sql={activeTab.content || ''}
                    connection={tabConn}
                    database={effectiveDb}
                    schema={effectiveSchema}
                    availableDatabases={availableDbs}
                    isRunning={isRunning}
                    onChange={(val) => updateTabContent(activeTab.id, val)}
                    onExecute={(sqlText, selectedDb) => handleExecuteQuery(sqlText, selectedDb || effectiveDb)}
                    onCancel={() => handleCancelQuery(activeTab.id)}
                    onExplain={(explainSql) => {
                      handleExecuteQuery(explainSql, effectiveDb);
                      setActiveBottomTab('explain');
                    }}
                    onTxStatusChange={(st) => {
                      setTxStatusByTab((prev) => ({ ...prev, [activeTab.id]: st }));
                    }}
                    onDatabaseChange={(newDb) => {
                      const currentTab = useWorkbenchStore
                        .getState()
                        .tabs.find((t) => t.id === useWorkbenchStore.getState().activeTabId);
                      const connId = currentTab?.connectionId || activeConnectionId || '';
                      const conn = connections.find((c) => c.id === connId);
                      const targetSchema =
                        currentTab?.schema ||
                        (conn?.driver === 'postgres' ? (useConnectionStore.getState().activeSchema || 'public') : newDb);
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
                    {activeTab.driver?.toLowerCase() !== 'redis' &&
                      connections.find((c) => c.id === activeTab.connectionId)?.driver?.toLowerCase() !== 'redis' && (
                        <>
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
                          <button
                            type="button"
                            onClick={() => {
                              const conn = connections.find((c) => c.id === activeTab.connectionId) || null;
                              openDdlModal({
                                scope: 'table',
                                conn,
                                database: activeTab.database || 'main',
                                schema: activeTab.schema || 'main',
                                tableName: activeTab.table,
                              });
                            }}
                            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] transition-colors cursor-pointer shrink-0"
                            title="View Table DDL"
                          >
                            <Eye className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!activeTab.connectionId || !activeTab.table) return;
                              const { targetDb, targetSchema } = resolveTableTabMeta(activeTab);
                              setLeftPanelOpen(true);
                              handleLeftSidebarTabChange('explorer');
                              useConnectionStore.getState().setRevealTarget({
                                connectionId: activeTab.connectionId,
                                database: targetDb,
                                schema: targetSchema,
                                table: activeTab.table,
                                ts: Date.now(),
                              });
                            }}
                            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] transition-colors cursor-pointer shrink-0"
                            title="Reveal Table in Left Sidebar"
                          >
                            <LocateFixed className="h-3 w-3" />
                          </button>
                        </>
                      )}
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
                  <div className="flex items-center gap-1.5">
                    {tableDataByTab[activeTab.id]?.whereClause && (
                      <button
                        onClick={() => {
                          const currentSize = tableDataByTab[activeTab.id]?.pageSize || 100;
                          loadTableData(activeTab, 0, currentSize, false, 1, '');
                        }}
                        className="flex items-center gap-1 h-6 px-2 rounded text-[11px] text-rose-400 hover:text-white hover:bg-rose-900/40 border border-rose-800/40 transition-colors cursor-pointer mr-0.5"
                        title="Reset WHERE filter to show all rows"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Reset Filter</span>
                      </button>
                    )}

                    <CopyFormatSelector />

                    <button
                      type="button"
                      onClick={() => setIsTableExportOpen(true)}
                      className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-[#22242c] transition-colors cursor-pointer"
                      title="Export Data (CSV, JSON, SQL Insert)"
                    >
                      <Download className="h-3.5 w-3.5 text-blue-400" />
                    </button>

                    {activeTab.table && !tableConn?.isReadOnly && (
                      <>
                        <button
                          type="button"
                          onClick={() => setIsTableImportOpen(true)}
                          className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-[#22242c] transition-colors cursor-pointer"
                          title="Import Data Wizard (CSV)"
                        >
                          <Upload className="h-3.5 w-3.5 text-emerald-400" />
                        </button>
                        <button
                          type="button"
                          disabled={tableEnv === 'prod'}
                          onClick={() => {
                            if (tableEnv !== 'prod') {
                              setIsMockDataOpen(true);
                            }
                          }}
                          className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                            tableEnv === 'prod'
                              ? 'text-zinc-600 opacity-40 cursor-not-allowed'
                              : 'text-zinc-400 hover:text-white hover:bg-[#22242c] cursor-pointer'
                          }`}
                          title={
                            tableEnv === 'prod'
                              ? 'Generate Mock Data (Disabled on PROD connections)'
                              : 'Generate Mock Data'
                          }
                        >
                          <Wand2 className={`h-3.5 w-3.5 ${tableEnv === 'prod' ? 'text-zinc-600' : 'text-purple-400'}`} />
                        </button>
                      </>
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
                      connectionId={activeTab.connectionId}
                      driver={tableConn?.driver || activeTab.driver}
                      database={activeTab.database}
                      schema={activeTab.schema}
                      tableName={activeTab.table}
                      envType={tableEnv}
                      columns={tableDataByTab[activeTab.id]?.columns || []}
                      rows={tableDataByTab[activeTab.id]?.rows || []}
                      primaryKeys={tableDataByTab[activeTab.id]?.primaryKeys || []}
                      totalCount={tableDataByTab[activeTab.id]?.totalCount}
                      onCountRows={() => handleCountTableRows(activeTab)}
                      hasMore={tableDataByTab[activeTab.id]?.hasMore}
                      isLoadingMore={tableDataByTab[activeTab.id]?.isLoadingMore}
                      startOffset={tableDataByTab[activeTab.id]?.startOffset ?? activeTab.tableViewState?.offset ?? 0}
                      page={tableDataByTab[activeTab.id]?.page || 1}
                      pageSize={tableDataByTab[activeTab.id]?.pageSize || 100}
                      whereClause={tableDataByTab[activeTab.id]?.whereClause}
                      errorMessage={tableDataByTab[activeTab.id]?.error}
                      onApplyWhere={(whereText) => {
                        const currentSize = tableDataByTab[activeTab.id]?.pageSize || 100;
                        const currTabs = useWorkbenchStore.getState().tabs;
                        useWorkbenchStore.setState({
                          tabs: currTabs.map((t) =>
                            t.id === activeTab.id
                              ? {
                                  ...t,
                                  tableViewState: {
                                    ...(t.tableViewState || {}),
                                    whereClause: whereText,
                                    page: 1,
                                    offset: 0,
                                    scrollTop: 0,
                                    activeRowIndex: 0,
                                  },
                                }
                              : t
                          ),
                        });
                        loadTableData(activeTab, 0, currentSize, 'replace', 1, whereText);
                      }}
                      isTableTab={true}
                      sortConfigs={tableDataByTab[activeTab.id]?.sortConfigs || []}
                      onSortChange={(newSorts) => {
                        const currentSize = tableDataByTab[activeTab.id]?.pageSize || 100;
                        // update tab's tableViewState
                        const currTabs = useWorkbenchStore.getState().tabs;
                        useWorkbenchStore.setState({
                          tabs: currTabs.map((t) =>
                            t.id === activeTab.id
                              ? {
                                  ...t,
                                  tableViewState: {
                                    ...(t.tableViewState || {}),
                                    sortConfigs: newSorts,
                                  },
                                }
                              : t
                          ),
                        });
                        loadTableData(activeTab, 0, currentSize, 'replace', 1, undefined, newSorts);
                      }}
                      onPageChange={(newPage) => {
                        const size = tableDataByTab[activeTab.id]?.pageSize || 100;
                        const newOffset = (newPage - 1) * size;
                        const currTabs = useWorkbenchStore.getState().tabs;
                        useWorkbenchStore.setState({
                          tabs: currTabs.map((t) =>
                            t.id === activeTab.id
                              ? {
                                  ...t,
                                  tableViewState: {
                                    ...(t.tableViewState || {}),
                                    page: newPage,
                                    offset: newOffset,
                                    pageSize: size,
                                    scrollTop: 0,
                                  },
                                }
                              : t
                          ),
                        });
                        loadTableData(activeTab, newOffset, size, 'replace', newPage);
                      }}
                      onPageSizeChange={(newSize) => {
                        const currTabs = useWorkbenchStore.getState().tabs;
                        useWorkbenchStore.setState({
                          tabs: currTabs.map((t) =>
                            t.id === activeTab.id
                              ? {
                                  ...t,
                                  tableViewState: {
                                    ...(t.tableViewState || {}),
                                    page: 1,
                                    offset: 0,
                                    pageSize: newSize,
                                    scrollTop: 0,
                                  },
                                }
                              : t
                          ),
                        });
                        loadTableData(activeTab, 0, newSize, 'replace', 1);
                      }}
                      onRefresh={() => {
                        const currentSize = tableDataByTab[activeTab.id]?.pageSize || 100;
                        const currentPage = tableDataByTab[activeTab.id]?.page || 1;
                        const currentStart = (currentPage - 1) * currentSize;
                        loadTableData(activeTab, currentStart, currentSize, 'replace', currentPage);
                      }}
                      onSubmitChanges={(skip) => handleSubmitChanges(skip === true)}
                      onPreviewChanges={() => handlePreviewChanges()}
                      isReadOnly={Boolean(tableConn?.isReadOnly)}
                      initialFrozenColumns={activeTab.tableViewState?.frozenColumns}
                      onFrozenColumnsChange={(frozenCols) => {
                        const currTabs = useWorkbenchStore.getState().tabs;
                        useWorkbenchStore.setState({
                          tabs: currTabs.map((t) =>
                            t.id === activeTab.id
                              ? {
                                  ...t,
                                  tableViewState: {
                                    ...(t.tableViewState || {}),
                                    frozenColumns: frozenCols,
                                  },
                                }
                              : t
                          ),
                        });
                      }}
                      targetRowIndex={activeTab.tableViewState?.activeRowIndex}
                      initialScrollTop={activeTab.tableViewState?.scrollTop}
                      initialScrollLeft={activeTab.tableViewState?.scrollLeft}
                      onActiveRowChange={(rIdx) => {
                        const currTabs = useWorkbenchStore.getState().tabs;
                        useWorkbenchStore.setState({
                          tabs: currTabs.map((t) =>
                            t.id === activeTab.id
                              ? {
                                  ...t,
                                  tableViewState: {
                                    ...(t.tableViewState || {}),
                                    activeRowIndex: rIdx,
                                  },
                                }
                              : t
                          ),
                        });
                      }}
                      onScrollChange={(scrollTop, scrollLeft, approxRowIndex, topRowOffsetPx) => {
                        const currTabs = useWorkbenchStore.getState().tabs;
                        const currentTab = currTabs.find((t) => t.id === activeTab.id);
                        if (!currentTab) return;
                        const oldState = currentTab.tableViewState || {};
                        const currentTopOffset = topRowOffsetPx ?? (scrollTop % 28);
                        if (
                          oldState.scrollTop === scrollTop &&
                          oldState.scrollLeft === scrollLeft &&
                          oldState.topRowIndex === approxRowIndex &&
                          oldState.topRowOffsetPx === currentTopOffset
                        ) {
                          return;
                        }
                        useWorkbenchStore.setState({
                          tabs: currTabs.map((t) =>
                            t.id === activeTab.id
                              ? {
                                  ...t,
                                  tableViewState: {
                                    ...oldState,
                                    scrollTop,
                                    scrollLeft,
                                    topRowIndex: approxRowIndex,
                                    topRowOffsetPx: currentTopOffset,
                                    activeRowIndex:
                                      oldState.activeRowIndex !== undefined
                                        ? oldState.activeRowIndex
                                        : approxRowIndex,
                                    offset: tableDataByTab[activeTab.id]?.startOffset ?? oldState.offset,
                                  },
                                }
                              : t
                          ),
                        });
                      }}
                    />
                  )}

                  {isTableExportOpen && (
                    <ExportModal
                      isOpen={isTableExportOpen}
                      onClose={() => setIsTableExportOpen(false)}
                      connectionId={activeTab.connectionId}
                      database={activeTab.database}
                      schema={activeTab.schema}
                      table={activeTab.table}
                    />
                  )}

                  {isTableImportOpen && activeTab.table && (
                    <ImportModal
                      isOpen={isTableImportOpen}
                      onClose={() => setIsTableImportOpen(false)}
                      connectionId={activeTab.connectionId}
                      database={activeTab.database || ''}
                      schema={activeTab.schema || ''}
                      table={activeTab.table}
                      onImportComplete={() => loadTableData(activeTab)}
                    />
                  )}

                  {isMockDataOpen && activeTab.table && tableEnv !== 'prod' && (
                    <MockDataModal
                      isOpen={isMockDataOpen}
                      onClose={() => setIsMockDataOpen(false)}
                      connectionId={activeTab.connectionId}
                      database={activeTab.database || ''}
                      schema={activeTab.schema || ''}
                      tableName={activeTab.table}
                      onSuccess={async () => {
                        const tabSnapshot = activeTab;
                        setTableDataByTab((prev) => {
                          const existing = prev[tabSnapshot.id];
                          if (!existing) return prev;
                          return {
                            ...prev,
                            [tabSnapshot.id]: {
                              ...existing,
                              totalCount: undefined,
                            },
                          };
                        });
                        await loadTableData(tabSnapshot);
                        await handleCountTableRows(tabSnapshot);

                        const { targetDb, targetSchema, schemaKey } = resolveTableTabMeta(tabSnapshot);
                        SchemaService.GetObjects(tabSnapshot.connectionId, targetDb, targetSchema)
                          .then((objs) => {
                            if (objs) setTreeObjects(schemaKey, objs as any);
                          })
                          .catch(() => {});
                      }}
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
            })() : activeTab?.type === 'er_diagram' ? (() => {
              return (
                <div className="flex-1 min-h-0 flex flex-col">
                  <ERDiagramView
                    connectionId={activeTab.connectionId}
                    database={activeTab.database}
                    schema={activeTab.schema}
                    onOpenTable={(tableName) => {
                      const conn = connections.find((c) => c.id === activeTab.connectionId);
                      openTab({
                        id: `table-${activeTab.connectionId}-${activeTab.database}-${tableName}`,
                        type: 'table_data',
                        title: tableName,
                        connectionId: activeTab.connectionId,
                        driver: conn?.driver,
                        database: activeTab.database,
                        schema: activeTab.schema,
                        table: tableName,
                      });
                    }}
                  />
                </div>
              );
            })() : (
              <EmptyWorkbenchState
                isMac={isMac}
                searchShortcutLabel={searchShortcutLabel}
                onNewConnection={() => setConnectionDialogOpen(true)}
                onOpenSearchEverywhere={() => setSearchEverywhereOpen(true)}
                onOpenHelp={openHelpModal}
              />
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
                    queryResult?.results && queryResult.results.length > 0
                      ? (queryResult.results[activeResultIndex] ?? queryResult.results[queryResult.results.length - 1])
                      : queryResult;
                  const currentRawSql =
                    (currentActiveRes as any)?.sql ||
                    queryResult?.sql ||
                    queryPagination?.lastSql ||
                    '';

                  return (
                    <div className="flex h-8 items-center justify-between border-b border-[#272932] px-3 bg-[#14151a] shrink-0 select-none gap-2">
                      <div className="flex items-center gap-2 overflow-x-auto min-w-0">
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
                        <button
                          onClick={() => setActiveBottomTab('history')}
                          className={`text-xs pb-1 border-b-2 font-medium cursor-pointer whitespace-nowrap ${
                            activeBottomTab === 'history'
                              ? 'border-zinc-400 text-white font-semibold'
                              : 'border-transparent text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          Query History
                        </button>
                        <button
                          onClick={() => setActiveBottomTab('explain')}
                          className={`text-xs pb-1 border-b-2 font-medium cursor-pointer whitespace-nowrap ${
                            activeBottomTab === 'explain'
                              ? 'border-zinc-400 text-white font-semibold'
                              : 'border-transparent text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          Explain Plan
                        </button>
                      </div>

                      {/* Table / Chart View Toggle & Raw Query Preview */}
                      {activeBottomTab === 'result' && (currentActiveRes?.columns?.length ?? 0) > 0 && (
                        <div className="flex items-center rounded bg-[#101115] border border-[#272932] p-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setResultViewMode('table')}
                            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                              resultViewMode === 'table'
                                ? 'bg-blue-600/25 text-blue-300 font-medium'
                                : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            <Table className="h-3 w-3" />
                            <span>Table</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setResultViewMode('chart')}
                            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                              resultViewMode === 'chart'
                                ? 'bg-blue-600/25 text-blue-300 font-medium'
                                : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            <BarChart3 className="h-3 w-3" />
                            <span>Chart</span>
                          </button>
                        </div>
                      )}

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
                      const resultsList = queryResult?.results || [];
                      const hasMultiResults = resultsList.length > 1;
                      const safeResultIdx =
                        hasMultiResults && activeResultIndex >= 0 && activeResultIndex < resultsList.length
                          ? activeResultIndex
                          : Math.max(0, resultsList.length - 1);
                      const currentRes: any = hasMultiResults ? resultsList[safeResultIdx] : queryResult;
                      const hasCols = currentRes?.columns && currentRes.columns.length > 0;

                      const multiResultTabsBar = hasMultiResults ? (
                        <div className="flex items-center gap-1 px-2 py-1 bg-[#14151a] border-b border-[#272932] overflow-x-auto shrink-0">
                          {resultsList.map((r: any, idx: number) => {
                            const isSelected = idx === safeResultIdx;
                            const hasErr = Boolean(r?.error);
                            const rowCountLabel = r?.columns?.length > 0
                              ? `${r.rows?.length || 0}r`
                              : `${r?.rowsAffected ?? 0} aff`;
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setActiveResultIndex(idx)}
                                title={r?.sql || `Result #${idx + 1}`}
                                className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer shrink-0 border ${
                                  isSelected
                                    ? hasErr
                                      ? 'bg-rose-950/60 border-rose-500/50 text-rose-200 font-semibold'
                                      : 'bg-blue-600/20 border-blue-500/50 text-blue-200 font-semibold'
                                    : hasErr
                                    ? 'bg-transparent border-transparent text-rose-400/80 hover:bg-rose-950/30'
                                    : 'bg-transparent border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#1e2029]'
                                }`}
                              >
                                <span>Result #{idx + 1}</span>
                                <span className="text-[10px] opacity-75">
                                  ({hasErr ? 'err' : rowCountLabel})
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null;

                      if (currentRes?.error) {
                        return (
                          <div className="flex flex-1 flex-col min-h-0">
                            {multiResultTabsBar}
                            <div className="p-4 m-2 text-xs font-mono text-rose-400 bg-rose-950/20 rounded border border-rose-900/40 whitespace-pre-wrap overflow-auto">
                              {currentRes.error}
                            </div>
                          </div>
                        );
                      }

                      if (!hasCols) {
                        return (
                          <div className="flex flex-1 flex-col min-h-0">
                            {multiResultTabsBar}
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
                          </div>
                        );
                      }

                      const currentResSql =
                        (currentRes as any)?.sql ||
                        queryResult?.sql ||
                        queryPagination?.lastSql ||
                        '';

                      return (
                        <div className="flex flex-1 flex-col min-h-0">
                          {multiResultTabsBar}
                          <div className="flex-1 min-h-0">
                            {resultViewMode === 'chart' ? (
                              <ResultChartPanel
                                columns={resultSource?.columns || currentRes.columns || []}
                                rows={currentRes.rows || []}
                                title={activeTab?.title}
                              />
                            ) : (
                              <DataGrid
                                key={`result-grid-${queryResult?.executionId || ''}-${safeResultIdx}`}
                            tabId={resultGridTabId}
                            connectionId={activeTab?.connectionId || activeConnectionId || undefined}
                            database={resultSource?.database ?? activeTab?.database}
                            schema={resultSource?.schema ?? activeTab?.schema}
                            tableName={resultSource?.table}
                            primaryKeys={resultSource?.primaryKeys}
                            envType={resolveConnectionEnv(
                              connections.find((c) => c.id === (activeTab?.connectionId || activeConnectionId))
                            )}
                            columns={resultSource?.columns || currentRes.columns || []}
                            rows={currentRes.rows || []}
                            totalCount={queryPagination.totalCount}
                            onCountRows={handleCountQueryRows}
                            hasMore={currentRes.hasMore}
                            isLoadingMore={queryPagination.isLoadingMore}
                            page={queryPagination.page}
                            pageSize={queryPagination.pageSize}
                            onPageChange={handleQueryPageChange}
                            onPageSizeChange={handleQueryPageSizeChange}
                            onLoadMore={handleQueryLoadMore}
                            onRefresh={() => handleQueryPageChange(queryPagination.page)}
                            onSubmitChanges={(skip) => handleSubmitChanges(skip === true, buildResultTarget() || undefined)}
                            onPreviewChanges={() => handlePreviewChanges(buildResultTarget() || undefined)}
                            rawSql={currentResSql}
                              isReadOnly={
                                Boolean(
                                  connections.find((c) => c.id === (activeTab?.connectionId || activeConnectionId))?.isReadOnly
                                ) || !resultSource
                              }
                            />
                            )}
                          </div>
                        </div>
                      );
                    })()
                  ) : activeBottomTab === 'history' ? (
                    <div className="flex-1 min-h-0">
                      <QueryHistoryPanel
                        onInsertToEditor={(sql) => {
                          if (activeTab?.type === 'worksheet') {
                            const existing = activeTab.content ? activeTab.content + '\n\n' : '';
                            updateTabContent(activeTab.id, existing + sql);
                          }
                        }}
                        onExecuteQuery={(sql, targetDb) => {
                          handleExecuteQuery(sql, targetDb);
                        }}
                      />
                    </div>
                  ) : activeBottomTab === 'explain' ? (
                    <div className="flex-1 min-h-0">
                      <ExplainPlanPanel
                        planRows={queryResult?.rows}
                        elapsedMs={queryResult?.elapsedMs}
                      />
                    </div>
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

          {/* Optional Right Split View Pane */}
          {splitTab && (
            <div className="w-[45%] min-w-[320px] max-w-[65%] h-full flex flex-col border-l-2 border-[#2b2e3a] bg-[#14151a] shrink-0">
              <div className="flex h-8 items-center justify-between border-b border-[#272932] bg-[#16171d] px-3 shrink-0 select-none">
                <div className="flex items-center gap-2 min-w-0">
                  <Columns className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                  <span className="text-[11px] font-semibold text-zinc-200 truncate" title={splitTab.title}>
                    {splitTab.title}
                  </span>
                  {splitTab.database && (
                    <span className="text-[10px] font-mono text-zinc-500 truncate">
                      /{splitTab.database}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeTab) return;
                      const prevActive = activeTab.id;
                      setActiveTabId(splitTab.id);
                      setSplitTabId(prevActive);
                    }}
                    className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] transition-colors cursor-pointer"
                    title="Swap Left & Right Panes"
                  >
                    <ArrowLeftRight className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitTabId(null)}
                    className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] transition-colors cursor-pointer"
                    title="Close Split View"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 flex flex-col">
                {splitTab.type === 'table_data' ? (() => {
                  const splitConn = connections.find((c) => c.id === splitTab.connectionId);
                  const splitEnv = resolveConnectionEnv(splitConn);
                  return (
                    <DataGrid
                      tabId={splitTab.id}
                      connectionId={splitTab.connectionId}
                      driver={splitConn?.driver || splitTab.driver}
                      database={splitTab.database}
                      schema={splitTab.schema}
                      tableName={splitTab.table}
                      envType={splitEnv}
                      columns={tableDataByTab[splitTab.id]?.columns || []}
                      rows={tableDataByTab[splitTab.id]?.rows || []}
                      primaryKeys={tableDataByTab[splitTab.id]?.primaryKeys || []}
                      totalCount={tableDataByTab[splitTab.id]?.totalCount}
                      onCountRows={() => handleCountTableRows(splitTab)}
                      hasMore={tableDataByTab[splitTab.id]?.hasMore}
                      isLoadingMore={tableDataByTab[splitTab.id]?.isLoadingMore}
                      startOffset={tableDataByTab[splitTab.id]?.startOffset ?? 0}
                      page={tableDataByTab[splitTab.id]?.page || 1}
                      pageSize={tableDataByTab[splitTab.id]?.pageSize || 100}
                      whereClause={tableDataByTab[splitTab.id]?.whereClause}
                      errorMessage={tableDataByTab[splitTab.id]?.error}
                      isTableTab={true}
                      sortConfigs={tableDataByTab[splitTab.id]?.sortConfigs || []}
                      onRefresh={() => loadTableData(splitTab)}
                      onSubmitChanges={(skip) => handleSubmitChanges(skip === true, {
                        stagedKey: splitTab.id,
                        connectionId: splitTab.connectionId,
                        database: splitTab.database || '',
                        schema: splitTab.schema || '',
                        table: splitTab.table || '',
                        onApplied: () => loadTableData(splitTab),
                      })}
                      onPreviewChanges={() => handlePreviewChanges({
                        stagedKey: splitTab.id,
                        connectionId: splitTab.connectionId,
                        database: splitTab.database || '',
                        schema: splitTab.schema || '',
                        table: splitTab.table || '',
                        onApplied: () => loadTableData(splitTab),
                      })}
                      isReadOnly={Boolean(splitConn?.isReadOnly)}
                    />
                  );
                })() : splitTab.type === 'er_diagram' ? (
                  <ERDiagramView
                    connectionId={splitTab.connectionId}
                    database={splitTab.database}
                    schema={splitTab.schema}
                    onOpenTable={(tblName) => {
                      const conn = connections.find((c) => c.id === splitTab.connectionId);
                      openTab({
                        id: `table-${splitTab.connectionId}-${splitTab.database}-${tblName}`,
                        type: 'table_data',
                        title: tblName,
                        connectionId: splitTab.connectionId,
                        driver: conn?.driver,
                        database: splitTab.database,
                        schema: splitTab.schema,
                        table: tblName,
                      });
                    }}
                  />
                ) : splitTab.type === 'users' ? (
                  <UserManager
                    tab={splitTab}
                    connection={connections.find((c) => c.id === splitTab.connectionId) || null}
                  />
                ) : (
                  <SqlWorksheet
                    tabId={splitTab.id}
                    sql={splitTab.content || ''}
                    connection={connections.find((c) => c.id === splitTab.connectionId)}
                    database={splitTab.database || ''}
                    schema={splitTab.schema || ''}
                    availableDatabases={treeDatabases[splitTab.connectionId] || []}
                    isRunning={isRunningByTab[splitTab.id] || false}
                    onChange={(val) => updateTabContent(splitTab.id, val)}
                    onExecute={(sqlText, selectedDb) => handleExecuteQuery(sqlText, selectedDb || splitTab.database)}
                    onCancel={() => handleCancelQuery(splitTab.id)}
                  />
                )}
              </div>
            </div>
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
          <div className="h-full w-9 shrink-0 bg-[#16171d] border-l border-[#272932] flex flex-col items-center py-3 select-none z-10">
            {/* VIEWS Button */}
            <Popover
              content="Open Views"
              shortcut={isMac ? '⌘R' : 'Ctrl+R'}
              side="left"
              align="start"
            >
              <div
                onClick={() => {
                  setRightPanelOpen(true);
                  setActiveRightSidebarTab('views');
                }}
                className="flex flex-col items-center cursor-pointer group px-1 py-2 rounded hover:bg-[#22242c]/60 transition-colors"
              >
                <PanelRight className="h-4 w-4 text-zinc-500 group-hover:text-blue-400 transition-colors mb-2" />
                <div className="text-[10px] tracking-widest font-semibold uppercase text-zinc-500 group-hover:text-zinc-300 transition-colors [writing-mode:vertical-rl]">
                  VIEWS
                </div>
              </div>
            </Popover>

            {/* CONSOLES Button */}
            <Popover
              content="Open Consoles"
              shortcut={isMac ? '⌘R' : 'Ctrl+R'}
              side="left"
              align="start"
            >
              <div
                onClick={() => {
                  setRightPanelOpen(true);
                  setActiveRightSidebarTab('consoles');
                }}
                className="mt-6 flex flex-col items-center cursor-pointer group px-1 py-2 rounded hover:bg-[#22242c]/60 transition-colors"
              >
                <Terminal className="h-4 w-4 text-zinc-500 group-hover:text-blue-400 transition-colors mb-2" />
                <div className="text-[10px] tracking-widest font-semibold uppercase text-zinc-500 group-hover:text-zinc-300 transition-colors [writing-mode:vertical-rl]">
                  CONSOLES
                </div>
              </div>
            </Popover>
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
      <TabContextMenu
        isOpen={tabContextMenu.isOpen}
        x={tabContextMenu.x}
        y={tabContextMenu.y}
        tab={tabContextMenu.tab}
        activeTabId={activeTabId}
        splitTabId={splitTabId}
        resolveTableTabMeta={resolveTableTabMeta}
        onCloseMenu={() => setTabContextMenu((prev) => ({ ...prev, isOpen: false }))}
        onOpenRename={handleOpenRename}
        onDuplicateTab={duplicateTab}
        onOpenSplitView={(id) => setSplitTabId(id)}
        onCloseSplitView={() => setSplitTabId(null)}
        onReloadTableData={loadTableData}
        onTruncateTable={handleTruncateTableFromTab}
        onDropTable={handleDropTableFromTab}
        onCloseTab={closeTab}
        onCloseOtherTabs={(id) => closeTabsMatching((t) => t.id !== id)}
        onCloseAllTabs={() => closeTabsMatching(() => false)}
      />

      {/* Rename Modal Dialog */}
      <RenameTabModal
        isOpen={renameModal.isOpen}
        title={renameModal.title}
        connection={connections.find(
          (c) =>
            c.id ===
            (tabs.find((t) => t.id === renameModal.id)?.connectionId ||
              activeTab?.connectionId ||
              activeConnectionId)
        )}
        onChangeTitle={(title) => setRenameModal((prev) => ({ ...prev, title }))}
        onClose={() => setRenameModal({ isOpen: false, id: '', title: '' })}
        onSubmit={handleRenameSubmit}
      />

      {/* DML Preview Modal */}
      <DmlPreviewModal
        statements={dmlPreview}
        connection={connections.find((c) => c.id === (activeTab?.connectionId || activeConnectionId))}
        onClose={() => setDmlPreview(null)}
        onApply={() =>
          handleSubmitChanges(
            true,
            activeTab?.type === 'worksheet' ? buildResultTarget() || undefined : undefined
          )
        }
      />

      {/* Schema Diff Modal */}
      <SchemaDiffModal
        isOpen={isSchemaDiffOpen}
        onClose={() => setIsSchemaDiffOpen(false)}
        onOpenInConsole={(sql, connId, db, sch) => {
          const conn = connections.find((c) => c.id === connId);
          openTab({
            id: `console-diff-${Date.now()}`,
            type: 'worksheet',
            title: 'Schema Migration',
            connectionId: connId,
            driver: conn?.driver,
            database: db,
            schema: sch,
            content: sql,
          });
        }}
      />

      {/* Snippets Modal */}
      <SnippetsModal
        isOpen={isSnippetsOpen}
        onClose={() => setIsSnippetsOpen(false)}
        onInsertSql={(sql) => {
          if (activeTab?.type === 'worksheet') {
            const current = activeTab.content || '';
            const next = current ? `${current.trimEnd()}\n\n${sql}` : sql;
            updateTabContent(activeTab.id, next);
          } else if (activeConnectionId) {
            const conn = connections.find((c) => c.id === activeConnectionId);
            openTab({
              id: `console-snippet-${Date.now()}`,
              type: 'worksheet',
              title: 'Snippet Console',
              connectionId: activeConnectionId,
              driver: conn?.driver,
              database: activeDatabase || conn?.databaseName || '',
              schema: activeSchema || '',
              content: sql,
            });
          }
        }}
      />

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
      <HelpModal />
      <UpdateModal />
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
      <ViewDdlModal
        isOpen={ddlModal.isOpen}
        scope={ddlModal.scope}
        connection={ddlModal.conn}
        database={ddlModal.database}
        schema={ddlModal.schema}
        tableName={ddlModal.tableName}
        onClose={closeDdlModal}
      />

      {/* Status Bar */}
      <WorkbenchStatusBar
        isMac={isMac}
        statusMessage={statusMessage}
        currentTx={activeTabId ? txStatusByTab[activeTabId] : undefined}
        updateInfo={updateInfo}
        onOpenUpdateModal={openUpdateModal}
        onOpenHelp={openHelpModal}
      />
    </div>
    </Suspense>
  );
}

export default App;
