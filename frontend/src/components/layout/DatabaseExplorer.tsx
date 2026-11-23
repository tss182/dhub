import React, { useEffect, useState, Suspense, lazy } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { ConnectionService, SchemaService, QueryService } from '../../../bindings/dhub/internal/services';
import { Call, Dialogs, Events } from '@wailsio/runtime';
import { Popover } from '../common/Popover';
import { RedisAddKeyModal } from '../modals/RedisAddKeyModal';
import { RedisFlushModal } from '../modals/RedisFlushModal';
import { RedisInfoModal } from '../modals/RedisInfoModal';
import { QdrantInfoModal } from '../modals/QdrantInfoModal';
import { QdrantBatchOpsModal } from '../modals/QdrantBatchOpsModal';
import { QdrantCloneModal } from '../modals/QdrantCloneModal';

const ExportModal = lazy(() =>
  import('../modals/ExportModal').then((m) => ({ default: m.ExportModal }))
);
const ImportModal = lazy(() =>
  import('../modals/ImportModal').then((m) => ({ default: m.ImportModal }))
);
import {
  Database,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderInput,
  Table,
  Eye,
  ChevronRight,
  ChevronDown,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Terminal,
  Copy,
  X,
  Check,
  Download,
  Upload,
  PanelLeftClose,
  FileCode,
  Filter,
  User,
  Search,
  Zap,
  Layers,
  ArrowRightLeft,
  Key,
  Activity,
  Hash,
  Sparkles,
  Clock,
  Eraser,
  Wrench,
  ArrowDownUp,
} from 'lucide-react';
import {
  ConnectionConfig,
  ConnectionFolder,
  ObjectSummary,
  TableGroup,
  resolveConnectionEnv,
  getConnectionEnvInfo,
  buildAlertConnectionContext,
} from '../../types/domain';
import { alertSuccess, alertError, alertInfo, alertWarning, confirmDialog } from '../../stores/useAlertStore';
import { SchemaFilterModal } from '../modals/SchemaFilterModal';
import { BackupRestoreModal } from '../modals/BackupRestoreModal';
import {
  CreateDatabaseModal,
  CreateSchemaModal,
  MoveTableModal,
} from '../modals/ExplorerSchemaModals';
import { DbDriverIcon } from '../common/DbDriverIcon';

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  type: 'connection' | 'folder' | 'database' | 'schema' | 'table' | 'table-group' | 'empty';
  connection?: ConnectionConfig;
  folder?: ConnectionFolder;
  database?: string;
  schema?: string;
  table?: ObjectSummary;
  tableGroup?: TableGroup;
}

const FOLDER_COLORS = [
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Emerald', value: '#10b981' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Rose', value: '#f43f5e' },
  { label: 'Cyan', value: '#06b6d4' },
  { label: 'Zinc', value: '#71717a' },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);

function withConnTimeout<T>(promise: Promise<T>, ms = 12000, msg = 'Connection timed out'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(msg)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

interface DatabaseExplorerProps {
  onCollapse?: () => void;
}

export const DatabaseExplorer: React.FC<DatabaseExplorerProps> = ({ onCollapse }) => {
  const {
    connections,
    folders,
    connectionFolders,
    activeConnectionId,
    activeDatabase,
    activeSchema,
    setConnections,
    loadConnectionsAndFolders,
    setActiveConnection,
    treeDatabases,
    visibleDatabases,
    databaseTotals,
    getVisibleDatabases,
    setTreeDatabases,
    setVisibleDatabases,
    removeTreeDatabase,
    treeObjects,
    setTreeObjects,
    removeTreeObject,
    expandedNodes,
    toggleNode,
    setNodeExpanded,
    setPendingFolderIdForNewConn,
    createFolder,
    renameFolder,
    deleteFolder,
    moveConnectionToFolder,
    reorderConnection,
    reorderFolder,
    tableGroups,
    tableGroupAssignments,
    createTableGroup,
    renameTableGroup,
    deleteTableGroup,
    assignTableToGroup,
    reorderTableGroup,
    revealTarget,
    setRevealTarget,
  } = useConnectionStore(
    useShallow((s) => ({
      connections: s.connections,
      folders: s.folders,
      connectionFolders: s.connectionFolders,
      activeConnectionId: s.activeConnectionId,
      activeDatabase: s.activeDatabase,
      activeSchema: s.activeSchema,
      setConnections: s.setConnections,
      loadConnectionsAndFolders: s.loadConnectionsAndFolders,
      setActiveConnection: s.setActiveConnection,
      treeDatabases: s.treeDatabases,
      visibleDatabases: s.visibleDatabases,
      databaseTotals: s.databaseTotals,
      getVisibleDatabases: s.getVisibleDatabases,
      setTreeDatabases: s.setTreeDatabases,
      setVisibleDatabases: s.setVisibleDatabases,
      removeTreeDatabase: s.removeTreeDatabase,
      treeObjects: s.treeObjects,
      setTreeObjects: s.setTreeObjects,
      removeTreeObject: s.removeTreeObject,
      expandedNodes: s.expandedNodes,
      toggleNode: s.toggleNode,
      setNodeExpanded: s.setNodeExpanded,
      setPendingFolderIdForNewConn: s.setPendingFolderIdForNewConn,
      createFolder: s.createFolder,
      renameFolder: s.renameFolder,
      deleteFolder: s.deleteFolder,
      moveConnectionToFolder: s.moveConnectionToFolder,
      reorderConnection: s.reorderConnection,
      reorderFolder: s.reorderFolder,
      tableGroups: s.tableGroups,
      tableGroupAssignments: s.tableGroupAssignments,
      createTableGroup: s.createTableGroup,
      renameTableGroup: s.renameTableGroup,
      deleteTableGroup: s.deleteTableGroup,
      assignTableToGroup: s.assignTableToGroup,
      reorderTableGroup: s.reorderTableGroup,
      revealTarget: s.revealTarget,
      setRevealTarget: s.setRevealTarget,
    }))
  );

  const {
    tabs,
    openTab,
    closeTab,
    closeTabsMatching,
    refreshTab,
    setConnectionDialogOpen,
    openCreateTableModal,
    openEditTableModal,
    openDdlModal,
  } = useWorkbenchStore(
    useShallow((s) => ({
      tabs: s.tabs,
      openTab: s.openTab,
      closeTab: s.closeTab,
      closeTabsMatching: s.closeTabsMatching,
      refreshTab: s.refreshTab,
      setConnectionDialogOpen: s.setConnectionDialogOpen,
      openCreateTableModal: s.openCreateTableModal,
      openEditTableModal: s.openEditTableModal,
      openDdlModal: s.openDdlModal,
    }))
  );

  const [filterText, setFilterText] = useState('');
  const [loadingConnId, setLoadingConnId] = useState<string | null>(null);
  const [failedConnErrors, setFailedConnErrors] = useState<Record<string, string>>({});
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Schema Filter Modal / Popover state (e.g. "3 of 10")
  const [schemaFilterModal, setSchemaFilterModal] = useState<{
    isOpen: boolean;
    connection: ConnectionConfig | null;
    anchorRect: DOMRect | null;
  }>({
    isOpen: false,
    connection: null,
    anchorRect: null,
  });

  // Redis Modals State
  const [redisAddKeyModal, setRedisAddKeyModal] = useState<{
    isOpen: boolean;
    connectionId: string;
    database: string;
  }>({ isOpen: false, connectionId: '', database: '' });

  const [redisFlushModal, setRedisFlushModal] = useState<{
    isOpen: boolean;
    connectionId: string;
    database: string;
    mode: 'FLUSHDB' | 'FLUSHALL';
  }>({ isOpen: false, connectionId: '', database: '', mode: 'FLUSHDB' });

  const [redisInfoModal, setRedisInfoModal] = useState<{
    isOpen: boolean;
    connectionId: string;
    connectionName: string;
  }>({ isOpen: false, connectionId: '', connectionName: '' });
  const [qdrantInfoModal, setQdrantInfoModal] = useState<{
    isOpen: boolean;
    connectionId: string;
    connectionName: string;
  }>({ isOpen: false, connectionId: '', connectionName: '' });
  const [qdrantBatchOpsModal, setQdrantBatchOpsModal] = useState<{
    isOpen: boolean;
    connectionId: string;
    collectionName: string;
  }>({ isOpen: false, connectionId: '', collectionName: '' });
  const [qdrantCloneModal, setQdrantCloneModal] = useState<{
    isOpen: boolean;
    connectionId: string;
    collectionName: string;
  }>({ isOpen: false, connectionId: '', collectionName: '' });
  const [qdrantAliasesByConn, setQdrantAliasesByConn] = useState<Record<string, Record<string, string[]>>>({});

  const fetchQdrantAliases = React.useCallback(async (connId: string) => {
    try {
      const res = await QueryService.ExecuteQuery({
        executionId: `qdrant-aliases-${Date.now()}`,
        connectionId: connId,
        database: 'default',
        schema: 'default',
        sql: 'GET /aliases',
        limit: 100,
        offset: 0,
      } as any);
      const raw = res?.rows?.[0]?.[0];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const list = Array.isArray(parsed?.result?.aliases) ? parsed.result.aliases : [];
      const map: Record<string, string[]> = {};
      for (const a of list) {
        if (a?.collection_name && a?.alias_name) {
          map[a.collection_name] = map[a.collection_name] || [];
          map[a.collection_name].push(a.alias_name);
        }
      }
      setQdrantAliasesByConn((prev) => ({ ...prev, [connId]: map }));
    } catch {}
  }, []);

  const handleOpenDatabaseFilter = (conn: ConnectionConfig, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const target = e?.currentTarget as HTMLElement | undefined;
    const rect = target ? target.getBoundingClientRect() : null;
    setSchemaFilterModal({
      isOpen: true,
      connection: conn,
      anchorRect: rect,
    });
  };

  const handleOpenUsersTab = (conn: ConnectionConfig) => {
    openTab({
      id: `users-${conn.id}`,
      type: 'users',
      title: `${conn.name} - Users`,
      connectionId: conn.id,
      driver: conn.driver,
      database: conn.databaseName || (conn.driver === 'postgres' ? 'postgres' : conn.driver === 'mssql' ? 'master' : conn.driver === 'oracle' ? 'ORCL' : 'mysql'),
      schema: conn.driver === 'postgres' ? 'public' : conn.driver === 'mssql' ? 'dbo' : conn.driver === 'oracle' ? (conn.username || 'SYSTEM').toUpperCase() : 'main',
    });
  };

  const handleOpenActivityMonitor = (conn: ConnectionConfig) => {
    openTab({
      id: `activity-${conn.id}`,
      type: 'activity',
      title: `${conn.name} - Activity`,
      connectionId: conn.id,
      driver: conn.driver,
      database: conn.databaseName || 'main',
      schema: conn.driver === 'postgres' ? 'public' : conn.driver === 'mssql' ? 'dbo' : 'main',
    });
  };

  // Hover Tooltip state for long folder, connection, database, table, and view names
  const [hoveredItem, setHoveredItem] = useState<{
    kind: 'folder' | 'connection' | 'database' | 'schema' | 'table' | 'view';
    title: string;
    badge: string;
    subtitle?: string;
    colorTag?: string;
    x: number;
    y: number;
  } | null>(null);
  const hoverTimeoutRef = React.useRef<any>(null);

  const handleItemMouseEnter = (
    e: React.MouseEvent,
    item: {
      kind: 'folder' | 'connection' | 'database' | 'schema' | 'table' | 'view';
      title: string;
      badge: string;
      subtitle?: string;
      colorTag?: string;
    }
  ) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const tooltipMaxW = 320;
    const x =
      rect.right + 8 + tooltipMaxW < window.innerWidth
        ? rect.right + 8
        : Math.max(8, window.innerWidth - tooltipMaxW - 12);
    const y = Math.max(8, Math.min(rect.top - 2, window.innerHeight - 90));

    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredItem({
        ...item,
        x,
        y,
      });
    }, 120);
  };

  const handleItemMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoveredItem(null);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  // PostgreSQL discovered schemas per database: key = `${connId}:${dbName}`
  const [treeSchemas, setTreeSchemas] = useState<Record<string, string[]>>({});
  const [highlightedRevealKey, setHighlightedRevealKey] = useState<string | null>(null);

  useEffect(() => {
    if (!revealTarget) return;
    let cancelled = false;
    const { connectionId, database, schema, table } = revealTarget;

    const runReveal = async () => {
      const conn = connections.find((c) => c.id === connectionId);
      if (!conn) {
        setRevealTarget(null);
        return;
      }

      // Expand any ancestor folders containing this connection
      let curFolderId = connectionFolders[connectionId] ?? conn.folderId ?? null;
      const visitedFolders = new Set<string>();
      while (curFolderId && !visitedFolders.has(curFolderId)) {
        visitedFolders.add(curFolderId);
        setNodeExpanded(`folder:${curFolderId}`, true);
        const fObj = folders.find((f) => f.id === curFolderId);
        curFolderId = fObj?.parentId ?? null;
      }

      // Clear search filter if active so the target table is visible
      setFilterText('');

      setNodeExpanded(connectionId, true);

      const targetDb = database || conn.databaseName || 'main';
      const isSchemaDriver =
        conn.driver === 'postgres' || conn.driver === 'mssql' || conn.driver === 'oracle';
      const defaultSchema =
        conn.driver === 'postgres'
          ? 'public'
          : conn.driver === 'mssql'
          ? 'dbo'
          : conn.driver === 'oracle'
          ? (conn.username || 'SYSTEM').toUpperCase()
          : targetDb;
      const targetSchema = schema || defaultSchema;

      try {
        if (!treeDatabases[connectionId] || treeDatabases[connectionId].length === 0) {
          await withConnTimeout(
            ConnectionService.Connect(connectionId),
            12000,
            'Connection timed out after 12s'
          );
          const dbs = (await SchemaService.GetDatabases(connectionId)) ?? [];
          const safeDbs =
            dbs.length > 0 ? dbs : conn.databaseName ? [conn.databaseName] : ['main'];
          if (!cancelled) setTreeDatabases(connectionId, safeDbs);
        }

        const dbNodeKey = `${connectionId}:${targetDb}`;
        setNodeExpanded(dbNodeKey, true);

        if (isSchemaDriver) {
          let schemas = treeSchemas[dbNodeKey];
          if (!schemas || schemas.length === 0) {
            schemas = (await SchemaService.GetSchemas(connectionId, targetDb)) ?? [];
            if (schemas.length === 0) schemas = [defaultSchema];
            if (!cancelled) {
              setTreeSchemas((prev) => ({ ...prev, [dbNodeKey]: schemas }));
            }
          }
          setNodeExpanded(`${dbNodeKey}:schema:${targetSchema}`, true);
        }

        const schemaKey = `${connectionId}:${targetDb}:${targetSchema}`;
        if (!treeObjects[schemaKey] || treeObjects[schemaKey].length === 0) {
          const objs = (await SchemaService.GetObjects(connectionId, targetDb, targetSchema)) ?? [];
          if (!cancelled) setTreeObjects(schemaKey, objs as any);
        }

        // Expand table group if table is assigned to one
        const dbAssign = tableGroupAssignments[dbNodeKey];
        const grpId = dbAssign?.[table];
        if (grpId) {
          setNodeExpanded(`tblgroup:${dbNodeKey}:${grpId}`, true);
        }

        setActiveConnection(connectionId, targetDb, targetSchema);
      } catch (err) {
        console.warn('Failed to reveal table in sidebar:', err);
      }

      if (cancelled) return;
      const revealKey = `${connectionId}:${targetDb}:${targetSchema}:${table}`;
      setHighlightedRevealKey(revealKey);
      setRevealTarget(null);

      // Wait for tree DOM to render, then scroll the target table into view
      setTimeout(() => {
        const el = document.querySelector(
          `[data-explorer-table="${CSS.escape(revealKey)}"]`
        ) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 80);

      setTimeout(() => {
        setHighlightedRevealKey((prev) => (prev === revealKey ? null : prev));
      }, 2200);
    };

    runReveal();
    return () => {
      cancelled = true;
    };
  }, [revealTarget]);

  // Drag & Drop state for sorting and grouping connections/folders or moving tables between schemas/groups
  const [draggedItem, setDraggedItem] = useState<{
    type: 'connection' | 'folder' | 'table' | 'table-group';
    id: string;
    connId?: string;
    database?: string;
    schema?: string;
    table?: ObjectSummary;
    tableGroup?: TableGroup;
  } | null>(null);

  const [dropTarget, setDropTarget] = useState<{
    type: 'connection' | 'folder-into' | 'folder-sort' | 'root-ungrouped' | 'table-group-into' | 'table-group-sort' | 'table-ungrouped';
    id: string;
    position?: 'before' | 'after';
    folderId?: string | null;
    connId?: string;
    database?: string;
  } | null>(null);

  // Create / Rename Folder Modal state
  const [folderModal, setFolderModal] = useState<{
    isOpen: boolean;
    mode: 'create' | 'rename';
    folderId: string | null;
    name: string;
    color: string;
    moveConnectionIdAfterCreate?: string | null;
  }>({
    isOpen: false,
    mode: 'create',
    folderId: null,
    name: '',
    color: '#3b82f6',
    moveConnectionIdAfterCreate: null,
  });

  const handleOpenCreateFolder = (moveConnId?: string | null) => {
    setFolderModal({
      isOpen: true,
      mode: 'create',
      folderId: null,
      name: '',
      color: '#3b82f6',
      moveConnectionIdAfterCreate: moveConnId || null,
    });
  };

  const handleOpenRenameFolder = (folder: ConnectionFolder, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setFolderModal({
      isOpen: true,
      mode: 'rename',
      folderId: folder.id,
      name: folder.name,
      color: folder.color || '#3b82f6',
      moveConnectionIdAfterCreate: null,
    });
  };

  const handleFolderModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = folderModal.name.trim();
    if (!clean) return;
    if (folderModal.mode === 'create') {
      const newFolderId = createFolder(clean, folderModal.color);
      if (folderModal.moveConnectionIdAfterCreate) {
        moveConnectionToFolder(folderModal.moveConnectionIdAfterCreate, newFolderId);
      }
    } else if (folderModal.mode === 'rename' && folderModal.folderId) {
      renameFolder(folderModal.folderId, clean, folderModal.color);
    }
    setFolderModal({
      isOpen: false,
      mode: 'create',
      folderId: null,
      name: '',
      color: '#3b82f6',
      moveConnectionIdAfterCreate: null,
    });
  };

  const handleDeleteFolder = async (folder: ConnectionFolder, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const count = connections.filter((c) => connectionFolders[c.id] === folder.id).length;
    const msg =
      count > 0
        ? `Delete folder "${folder.name}"? (${count} connection(s) inside will not be deleted and will be moved to Ungrouped.)`
        : `Delete folder "${folder.name}"?`;
    const okFolder = await confirmDialog({
      title: 'Delete Folder',
      message: msg,
      confirmLabel: 'Delete',
      isDanger: true,
    });
    if (!okFolder) return;
    deleteFolder(folder.id);
  };

  const handleNewConnectionInFolder = (folderId: string | null) => {
    setPendingFolderIdForNewConn(folderId);
    setConnectionDialogOpen(true, null);
  };

  // Create / Rename Table Group Modal state (MySQL / MariaDB)
  const [tableGroupModal, setTableGroupModal] = useState<{
    isOpen: boolean;
    mode: 'create' | 'rename';
    connId: string;
    database: string;
    groupId: string | null;
    name: string;
    color: string;
    assignTableNameAfterCreate?: string | null;
  }>({
    isOpen: false,
    mode: 'create',
    connId: '',
    database: '',
    groupId: null,
    name: '',
    color: '#3b82f6',
    assignTableNameAfterCreate: null,
  });

  const handleOpenCreateTableGroup = (connId: string, database: string, assignTableName?: string | null) => {
    setTableGroupModal({
      isOpen: true,
      mode: 'create',
      connId,
      database,
      groupId: null,
      name: '',
      color: '#3b82f6',
      assignTableNameAfterCreate: assignTableName || null,
    });
  };

  const handleOpenRenameTableGroup = (connId: string, database: string, group: TableGroup, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTableGroupModal({
      isOpen: true,
      mode: 'rename',
      connId,
      database,
      groupId: group.id,
      name: group.name,
      color: group.color || '#3b82f6',
      assignTableNameAfterCreate: null,
    });
  };

  const handleTableGroupModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = tableGroupModal.name.trim();
    if (!clean || !tableGroupModal.connId || !tableGroupModal.database) return;
    if (tableGroupModal.mode === 'create') {
      const newGroupId = createTableGroup(tableGroupModal.connId, tableGroupModal.database, clean, tableGroupModal.color);
      if (tableGroupModal.assignTableNameAfterCreate) {
        assignTableToGroup(tableGroupModal.connId, tableGroupModal.database, tableGroupModal.assignTableNameAfterCreate, newGroupId);
      }
    } else if (tableGroupModal.mode === 'rename' && tableGroupModal.groupId) {
      renameTableGroup(tableGroupModal.connId, tableGroupModal.database, tableGroupModal.groupId, clean, tableGroupModal.color);
    }
    setTableGroupModal({
      isOpen: false,
      mode: 'create',
      connId: '',
      database: '',
      groupId: null,
      name: '',
      color: '#3b82f6',
      assignTableNameAfterCreate: null,
    });
  };

  const handleDeleteTableGroup = async (connId: string, database: string, group: TableGroup, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const dbKey = `${connId}:${database}`;
    const assignMap = tableGroupAssignments[dbKey] || {};
    const count = Object.values(assignMap).filter((gId) => gId === group.id).length;
    const msg =
      count > 0
        ? `Delete table group "${group.name}"? (${count} table/view(s) inside will not be dropped and will be moved back to ungrouped.)`
        : `Delete table group "${group.name}"?`;
    const ok = await confirmDialog({
      title: 'Delete Table Group',
      message: msg,
      confirmLabel: 'Delete',
      isDanger: true,
    });
    if (!ok) return;
    deleteTableGroup(connId, database, group.id);
  };

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    type: 'empty',
  });

  // Create Database Dialog state
  const [createDbModal, setCreateDbModal] = useState<{
    isOpen: boolean;
    connection: ConnectionConfig | null;
    dbName: string;
    charset: string;
    collation: string;
  }>({
    isOpen: false,
    connection: null,
    dbName: '',
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci',
  });

  // Backup / Restore Database Modal state
  const [backupRestoreModal, setBackupRestoreModal] = useState<{
    isOpen: boolean;
    mode: 'backup' | 'restore';
    connection: ConnectionConfig | null;
    database: string;
    filePath: string;
    isProcessing: boolean;
    dumpMode: 'full' | 'schema_only' | 'data_only';
    includeRoutines: boolean;
    includeTriggers: boolean;
    includeEvents: boolean;
    singleTransaction: boolean;
    tableSelection: 'all' | 'include' | 'exclude';
    selectedTables: string[];
    availableTables: string[];
    tableSearch: string;
    isLoadingTables: boolean;
    toolPath: string;
    backupProgress: {
      percent: number;
      currentTable?: string;
      tablesDone: number;
      totalTables: number;
      bytesWritten: number;
      totalBytes?: number;
      message?: string;
    } | null;
  }>({
    isOpen: false,
    mode: 'backup',
    connection: null,
    database: '',
    filePath: '',
    isProcessing: false,
    dumpMode: 'full',
    includeRoutines: true,
    includeTriggers: true,
    includeEvents: false,
    singleTransaction: true,
    tableSelection: 'all',
    selectedTables: [],
    availableTables: [],
    tableSearch: '',
    isLoadingTables: false,
    toolPath: '',
    backupProgress: null,
  });

  // Export / Import Table Modal state
  const [exportModal, setExportModal] = useState<{
    isOpen: boolean;
    connId: string;
    db: string;
    schema: string;
    table: string;
  }>({ isOpen: false, connId: '', db: '', schema: '', table: '' });

  const [importModal, setImportModal] = useState<{
    isOpen: boolean;
    connId: string;
    db: string;
    schema: string;
    table: string;
  }>({ isOpen: false, connId: '', db: '', schema: '', table: '' });

  // Create Schema / Collection Modal state (PostgreSQL)
  const [createSchemaModal, setCreateSchemaModal] = useState<{
    isOpen: boolean;
    connection: ConnectionConfig | null;
    database: string;
    schemaName: string;
    authorization: string;
  }>({
    isOpen: false,
    connection: null,
    database: '',
    schemaName: '',
    authorization: '',
  });

  // Move Table to Another Schema / Collection Modal (PostgreSQL)
  const [moveTableModal, setMoveTableModal] = useState<{
    isOpen: boolean;
    connection: ConnectionConfig | null;
    database: string;
    sourceSchema: string;
    tableName: string;
    targetSchema: string;
    objectType: string;
    availableSchemas: string[];
  }>({
    isOpen: false,
    connection: null,
    database: '',
    sourceSchema: '',
    tableName: '',
    targetSchema: '',
    objectType: 'table',
    availableSchemas: [],
  });

  const getBackupCliTool = (drv?: string) => {
    switch (drv) {
      case 'postgres':
        return 'pg_dump';
      case 'sqlite':
        return 'sqlite3';
      case 'mariadb':
        return 'mariadb-dump';
      case 'mongodb':
        return 'mongodump';
      case 'redis':
        return 'redis-cli';
      case 'mssql':
        return 'sqlcmd';
      case 'oracle':
        return 'sqlplus';
      case 'clickhouse':
        return drv;
      default:
        return 'mysqldump';
    }
  };

  const getRestoreCliTool = (drv?: string, filePath?: string) => {
    switch (drv) {
      case 'postgres': {
        const lower = (filePath || '').toLowerCase();
        return lower.endsWith('.dump') || lower.endsWith('.backup') || lower.endsWith('.tar')
          ? 'pg_restore'
          : 'psql';
      }
      case 'mariadb':
        return 'mariadb';
      case 'mongodb':
        return 'mongorestore';
      case 'mssql':
        return 'sqlcmd';
      case 'oracle':
        return 'sqlplus';
      case 'sqlite':
        return 'sqlite3';
      case 'clickhouse':
        return '';
      default:
        return 'mysql';
    }
  };

  useEffect(() => {
    if (!backupRestoreModal.isOpen) return;
    const eventName = backupRestoreModal.mode === 'backup' ? 'backup:progress' : 'restore:progress';
    const unsubscribe = Events.On(eventName, (event: any) => {
      const payload = event?.data ?? event;
      if (!payload) return;
      if (
        payload.connectionId === backupRestoreModal.connection?.id &&
        payload.database === backupRestoreModal.database
      ) {
        setBackupRestoreModal((prev) => ({
          ...prev,
          backupProgress: {
            percent: typeof payload.percent === 'number' ? payload.percent : 0,
            currentTable: payload.currentTable || '',
            tablesDone: payload.tablesDone || 0,
            totalTables: payload.totalTables || 0,
            bytesWritten: payload.bytesWritten || 0,
            totalBytes: payload.totalBytes || 0,
            message: payload.message || '',
          },
        }));
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [
    backupRestoreModal.isOpen,
    backupRestoreModal.mode,
    backupRestoreModal.connection?.id,
    backupRestoreModal.database,
  ]);

  const handleOpenBackupModal = async (conn: ConnectionConfig, database: string) => {
    let defaultPath = `${database}_backup.sql`;
    try {
      const suggested = await SchemaService.GetDefaultBackupPath(database);
      if (suggested) defaultPath = suggested;
    } catch {}

    const cliTool = getBackupCliTool(conn.driver);
    const savedToolPath = useSettingsStore.getState().backupToolPaths?.[cliTool] || '';

    setBackupRestoreModal({
      isOpen: true,
      mode: 'backup',
      connection: conn,
      database,
      filePath: defaultPath,
      isProcessing: false,
      dumpMode: 'full',
      includeRoutines: true,
      includeTriggers: true,
      includeEvents: false,
      singleTransaction: true,
      tableSelection: 'all',
      selectedTables: [],
      availableTables: [],
      tableSearch: '',
      isLoadingTables: true,
      toolPath: savedToolPath,
      backupProgress: null,
    });

    try {
      const targetSchema = conn.driver === 'postgres' ? 'public' : conn.driver === 'mssql' ? 'dbo' : conn.driver === 'oracle' ? '' : database;
      const objs = await SchemaService.GetObjects(conn.id, database, targetSchema);
      const tables = (objs || [])
        .filter((o) => o.type === 'table')
        .map((o) => o.name)
        .sort((a, b) => a.localeCompare(b));
      setBackupRestoreModal((prev) => ({
        ...prev,
        availableTables: tables,
        isLoadingTables: false,
      }));
    } catch (e) {
      console.warn('Failed to load tables for backup:', e);
      setBackupRestoreModal((prev) => ({
        ...prev,
        isLoadingTables: false,
      }));
    }
  };

  const handleBrowseBackupToolPath = async () => {
    const cliTool =
      backupRestoreModal.mode === 'backup'
        ? getBackupCliTool(backupRestoreModal.connection?.driver)
        : getRestoreCliTool(backupRestoreModal.connection?.driver, backupRestoreModal.filePath);
    if (!cliTool) return;
    try {
      const chosen: any = await Dialogs.OpenFile({
        Title: `Select ${cliTool} Executable`,
        CanChooseFiles: true,
        AllowsMultipleSelection: false,
      });
      const picked = Array.isArray(chosen) ? chosen[0] : chosen;
      if (picked && typeof picked === 'string' && picked.trim()) {
        const clean = picked.trim();
        setBackupRestoreModal((prev) => ({
          ...prev,
          toolPath: clean,
        }));
        useSettingsStore.getState().setBackupToolPath(cliTool, clean);
      }
    } catch (e) {
      console.warn('OpenFile dialog error:', e);
    }
  };

  const handleBrowseBackupFile = async () => {
    const dbName = backupRestoreModal.database || 'database';
    const currentPath = backupRestoreModal.filePath || '';
    const defaultFilename =
      currentPath.split(/[\\/]/).pop() || `${dbName}_backup.sql`;
    try {
      const chosen = await Dialogs.SaveFile({
        Title: `Save Database Backup (${dbName})`,
        Filename: defaultFilename,
        CanCreateDirectories: true,
        Filters: [
          {
            DisplayName: 'SQL Backup File (*.sql, *.sql.gz)',
            Pattern: '*.sql;*.sql.gz;*.gz',
          },
        ],
      });
      if (chosen && typeof chosen === 'string' && chosen.trim()) {
        setBackupRestoreModal((prev) => ({
          ...prev,
          filePath: chosen.trim(),
        }));
      }
    } catch (e) {
      console.warn('SaveFile dialog error:', e);
    }
  };

  const handleBrowseRestoreFile = async (): Promise<void> => {
    try {
      const chosen: any = await Dialogs.OpenFile({
        Title: `Select SQL File to Restore (${backupRestoreModal.database || 'Database'})`,
        CanChooseFiles: true,
        AllowsMultipleSelection: false,
        Filters: [
          {
            DisplayName: 'SQL Backup File (*.sql, *.sql.gz)',
            Pattern: '*.sql;*.sql.gz;*.gz',
          },
        ],
      });
      const picked = Array.isArray(chosen) ? chosen[0] : chosen;
      if (picked && typeof picked === 'string' && picked.trim()) {
        const clean = picked.trim();
        setBackupRestoreModal((prev) => ({
          ...prev,
          filePath: clean,
        }));
      }
    } catch (e) {
      console.warn('OpenFile dialog error:', e);
    }
  };

  const handleOpenRestoreModal = async (conn: ConnectionConfig, database: string) => {
    if (conn.isReadOnly) {
      alertWarning(
        `Connection "${conn.name}" is configured as Read-Only. Restore is disabled.`,
        'Read-Only Connection'
      );
      return;
    }
    const cliTool = getRestoreCliTool(conn.driver);
    const savedToolPath = cliTool ? (useSettingsStore.getState().backupToolPaths?.[cliTool] || '') : '';
    setBackupRestoreModal((prev) => ({
      ...prev,
      isOpen: true,
      mode: 'restore',
      connection: conn,
      database,
      filePath: '',
      isProcessing: false,
      toolPath: savedToolPath,
      backupProgress: null,
    }));

    // Prompt user immediately to pick the .sql file to restore
    try {
      const chosen: any = await Dialogs.OpenFile({
        Title: `Select SQL File to Restore into [${database}]`,
        CanChooseFiles: true,
        AllowsMultipleSelection: false,
        Filters: [
          {
            DisplayName: 'SQL Backup File (*.sql, *.sql.gz)',
            Pattern: '*.sql;*.sql.gz;*.gz',
          },
        ],
      });
      const picked = Array.isArray(chosen) ? chosen[0] : chosen;
      if (picked && typeof picked === 'string' && picked.trim()) {
        setBackupRestoreModal((prev) => ({
          ...prev,
          filePath: picked.trim(),
        }));
      }
    } catch (e) {
      console.warn('OpenFile dialog error:', e);
    }
  };

  const handleConfirmBackupRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    const { mode, connection, database, filePath, isProcessing } = backupRestoreModal;
    if (!connection || !database || isProcessing) return;

    const cleanPath = filePath.trim();
    if (!cleanPath) {
      alertWarning(
        mode === 'backup'
          ? 'Please specify a target backup file path (.sql).'
          : 'Please select a .sql file to restore first.',
        mode === 'backup' ? 'Missing Backup Path' : 'Missing Restore File'
      );
      return;
    }

    if (
      mode === 'backup' &&
      backupRestoreModal.tableSelection === 'include' &&
      backupRestoreModal.selectedTables.length === 0
    ) {
      alertWarning(
        'Please select at least one table to include in the backup, or switch to "All Tables".',
        'No Tables Selected'
      );
      return;
    }

    setBackupRestoreModal((prev) => ({
      ...prev,
      isProcessing: true,
      backupProgress: {
        percent: 0,
        tablesDone: 0,
        totalTables: 0,
        bytesWritten: 0,
        message: mode === 'backup' ? 'Preparing backup...' : 'Preparing restore...',
      },
    }));

    try {
      if (mode === 'backup') {
        const cliTool = getBackupCliTool(connection.driver);
        const cleanToolPath = backupRestoreModal.toolPath.trim();
        useSettingsStore.getState().setBackupToolPath(cliTool, cleanToolPath);
        const backupOpts = {
          mode: backupRestoreModal.dumpMode,
          tableSelection: backupRestoreModal.tableSelection,
          tables: backupRestoreModal.selectedTables,
          includeRoutines: backupRestoreModal.includeRoutines,
          includeTriggers: backupRestoreModal.includeTriggers,
          includeEvents: backupRestoreModal.includeEvents,
          singleTransaction: backupRestoreModal.singleTransaction,
          toolPath: cleanToolPath || undefined,
        };
        const msg = await SchemaService.BackupDatabase(
          connection.id,
          database,
          cleanPath,
          JSON.stringify(backupOpts)
        );
        setBackupRestoreModal((prev) => ({
          ...prev,
          isOpen: false,
          isProcessing: false,
          backupProgress: null,
        }));
        alertSuccess(msg, 'Database Backup Completed');
      } else {
        const cliTool = getRestoreCliTool(connection.driver, cleanPath);
        const cleanToolPath = backupRestoreModal.toolPath.trim();
        if (cliTool) {
          useSettingsStore.getState().setBackupToolPath(cliTool, cleanToolPath);
        }
        const msg = await Call.ByName(
          'dhub/internal/services.SchemaService.RestoreDatabaseWithOptions',
          connection.id,
          database,
          cleanPath,
          JSON.stringify({ toolPath: cleanToolPath || undefined })
        );
        setBackupRestoreModal((prev) => ({
          ...prev,
          isOpen: false,
          isProcessing: false,
          backupProgress: null,
        }));
        await handleRefreshDatabase(connection.id, database);
        alertSuccess(String(msg || ''), 'Database Restore Completed');
      }
    } catch (err: any) {
      setBackupRestoreModal((prev) => ({ ...prev, isProcessing: false, backupProgress: null }));
      alertError(
        err?.message || String(err),
        mode === 'backup' ? 'Database Backup Failed' : 'Database Restore Failed'
      );
    }
  };

  const handleCancelBackupRestore = async () => {
    const { connection, database, isProcessing } = backupRestoreModal;
    if (!connection || !database || !isProcessing) return;
    try {
      await Call.ByName(
        'dhub/internal/services.SchemaService.CancelBackupRestore',
        connection.id,
        database
      );
    } catch (e) {
      console.warn('CancelBackupRestore failed:', e);
    }
  };

  const handleOpenCreateTable = (conn: ConnectionConfig, database: string, schema?: string) => {
    openCreateTableModal(conn, database, schema);
  };

  const closeContextMenu = () => {
    setContextMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
  };

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      closeContextMenu();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };

    window.addEventListener('click', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const openContextMenu = (
    e: React.MouseEvent,
    type: ContextMenuState['type'],
    data: Partial<ContextMenuState>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const menuWidth = 220;
    const menuHeight = 250;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

    setContextMenu({
      isOpen: true,
      x: Math.max(10, x),
      y: Math.max(10, y),
      type,
      ...data,
    });
  };

  const loadConnections = async () => {
    try {
      const safeList = await loadConnectionsAndFolders();
      if (safeList.length > 0 && !activeConnectionId) {
        const first = safeList[0];
        setActiveConnection(first.id, first.databaseName || 'main', first.driver === 'postgres' ? 'public' : 'main');
      }
    } catch (e) {
      console.error('Failed to list connections:', e);
    }
  };

  useEffect(() => {
    loadConnections();
  }, []);

  const handleExpandConnection = async (connId: string) => {
    toggleNode(connId);
    if (!expandedNodes[connId]) {
      setLoadingConnId(connId);
      try {
        await withConnTimeout(
          ConnectionService.Connect(connId),
          12000,
          'Connection timed out after 12s'
        );
        setFailedConnErrors((prev) => {
          if (!prev[connId]) return prev;
          const next = { ...prev };
          delete next[connId];
          return next;
        });
        const conn = connections.find((c) => c.id === connId);
        const isRedis = conn?.driver?.toLowerCase() === 'redis';
        const dbs = (await SchemaService.GetDatabases(connId)) ?? [];
        const redisDbs = Array.from({ length: 16 }, (_, i) => `db${i}`);
        let safeDbs =
          dbs.length > 0
            ? dbs
            : isRedis
            ? redisDbs
            : conn?.databaseName
            ? [conn.databaseName]
            : ['main'];
        if (isRedis) {
          const filtered = safeDbs.filter((d) => d !== 'default' && d !== 'main');
          safeDbs = filtered.length > 0 ? filtered : redisDbs;
        }
        setTreeDatabases(connId, safeDbs);

        const currentVisibleList = useConnectionStore.getState().visibleDatabases[connId];
        const prefetchedDbs =
          currentVisibleList !== undefined && currentVisibleList.length > 0
            ? safeDbs.filter((d) => currentVisibleList.includes(d))
            : safeDbs;

        const currentDb =
          conn?.databaseName && prefetchedDbs.includes(conn.databaseName)
            ? conn.databaseName
            : prefetchedDbs[0] || conn?.databaseName || 'main';
        const currentSchema = conn?.driver === 'postgres' ? 'public' : conn?.driver === 'mssql' ? 'dbo' : conn?.driver === 'oracle' ? (conn?.username || '').toUpperCase() : currentDb;
        setActiveConnection(connId, currentDb, currentSchema);

        // Pre-fetch objects for visible databases in background
        for (const dbName of prefetchedDbs) {
          if (conn?.driver === 'postgres' || conn?.driver === 'mssql' || conn?.driver === 'oracle') {
            SchemaService.GetSchemas(connId, dbName)
              .then((schemas) => {
                const defaultSchema = conn?.driver === 'mssql' ? 'dbo' : conn?.driver === 'oracle' ? (conn?.username || 'SYSTEM').toUpperCase() : 'public';
                const safeSchemas = schemas && schemas.length > 0 ? schemas : [defaultSchema];
                setTreeSchemas((prev) => ({ ...prev, [`${connId}:${dbName}`]: safeSchemas }));
                for (const s of safeSchemas) {
                  const sKey = `${connId}:${dbName}:${s}`;
                  SchemaService.GetObjects(connId, dbName, s)
                    .then((objs) => {
                      if (objs) setTreeObjects(sKey, objs as any);
                    })
                    .catch(() => {});
                }
              })
              .catch(() => {});
          } else {
            const targetSchema = dbName;
            const sKey = `${connId}:${dbName}:${targetSchema}`;
            SchemaService.GetObjects(connId, dbName, targetSchema)
              .then((objs) => {
                if (objs) {
                  setTreeObjects(sKey, objs as any);
                }
              })
              .catch(() => {});
          }
        }
      } catch (e: any) {
        console.error('Failed to load databases for connection:', e);
        setFailedConnErrors((prev) => ({
          ...prev,
          [connId]: e?.message || String(e),
        }));
        if (!treeDatabases[connId] || treeDatabases[connId].length === 0) {
          setNodeExpanded(connId, false);
        }
      } finally {
        setLoadingConnId(null);
      }
    }
  };

  const handleExpandDatabase = async (connId: string, dbName: string) => {
    const nodeKey = `${connId}:${dbName}`;
    toggleNode(nodeKey);
    const conn = connections.find((c) => c.id === connId);

    if (conn?.driver === 'postgres' || conn?.driver === 'mssql' || conn?.driver === 'oracle') {
      try {
        let schemas = treeSchemas[nodeKey];
        const defaultSchema = conn?.driver === 'mssql' ? 'dbo' : conn?.driver === 'oracle' ? (conn?.username || 'SYSTEM').toUpperCase() : 'public';
        if (!schemas || schemas.length === 0) {
          schemas = (await SchemaService.GetSchemas(connId, dbName)) ?? [];
          if (schemas.length === 0) schemas = [defaultSchema];
          setTreeSchemas((prev) => ({ ...prev, [nodeKey]: schemas }));
        }
        const activeS = schemas.includes(defaultSchema) ? defaultSchema : schemas[0] || defaultSchema;
        setActiveConnection(connId, dbName, activeS);
        // Pre-fetch objects for discovered schemas
        for (const s of schemas) {
          const sKey = `${connId}:${dbName}:${s}`;
          if (!treeObjects[sKey]) {
            const objs = (await SchemaService.GetObjects(connId, dbName, s)) ?? [];
            setTreeObjects(sKey, objs as any);
          }
        }
      } catch (e) {
        console.error(`Failed to load schemas for ${dbName}:`, e);
      }
    } else {
      const targetSchema = dbName;
      setActiveConnection(connId, dbName, targetSchema);

      const schemaKey = `${connId}:${dbName}:${targetSchema}`;
      if (!expandedNodes[nodeKey] && (!treeObjects[schemaKey] || treeObjects[schemaKey].length === 0)) {
        try {
          const objects = (await SchemaService.GetObjects(connId, dbName, targetSchema)) ?? [];
          setTreeObjects(schemaKey, objects as any);
        } catch (e) {
          console.error(`Failed to load objects for ${dbName}:`, e);
        }
      }
    }
  };

  const handleRefreshConnection = async (connId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setLoadingConnId(connId);
    try {
      await withConnTimeout(
        ConnectionService.Connect(connId),
        12000,
        'Connection refresh timed out after 12s'
      );
      setFailedConnErrors((prev) => {
        if (!prev[connId]) return prev;
        const next = { ...prev };
        delete next[connId];
        return next;
      });
      const conn = connections.find((c) => c.id === connId);
      const isRedis = conn?.driver?.toLowerCase() === 'redis';
      const dbs = (await SchemaService.GetDatabases(connId)) ?? [];
      const redisDbs = Array.from({ length: 16 }, (_, i) => `db${i}`);
      let safeDbs =
        dbs.length > 0
          ? dbs
          : isRedis
          ? redisDbs
          : conn?.databaseName
          ? [conn.databaseName]
          : ['main'];
      if (isRedis) {
        const filtered = safeDbs.filter((d) => d !== 'default' && d !== 'main');
        safeDbs = filtered.length > 0 ? filtered : redisDbs;
      }
      setTreeDatabases(connId, safeDbs);

      // Refresh currently selected database objects
      const isQdrant = conn?.driver?.toLowerCase() === 'qdrant';
      const currentDb = isQdrant ? 'default' : activeDatabase || safeDbs[0];
      const targetSchema = isQdrant
        ? 'default'
        : conn?.driver === 'postgres'
        ? 'public'
        : conn?.driver === 'mssql'
        ? 'dbo'
        : currentDb;
      const objects = (await SchemaService.GetObjects(connId, currentDb, targetSchema)) ?? [];
      setTreeObjects(`${connId}:${currentDb}:${targetSchema}`, objects as any);
      if (isQdrant) {
        fetchQdrantAliases(connId);
      }
    } catch (e: any) {
      console.error('Failed to refresh connection:', e);
      setFailedConnErrors((prev) => ({
        ...prev,
        [connId]: e?.message || String(e),
      }));
    } finally {
      setLoadingConnId(null);
    }
  };

  const handleDeleteConnection = async (connId: string, name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const okDel = await confirmDialog({
      title: 'Delete Connection',
      message: `Are you sure you want to delete connection "${name}"?`,
      confirmLabel: 'Delete',
      isDanger: true,
    });
    if (!okDel) return;
    try {
      await ConnectionService.DeleteConnection(connId);
      closeTabsMatching((t) => t.connectionId === connId);
      const list = await ConnectionService.ListConnections();
      setConnections((list ?? []) as any);
      if (activeConnectionId === connId) {
        if (list && list.length > 0) {
          const first = list[0];
          setActiveConnection(first.id, first.databaseName || 'main', first.driver === 'postgres' ? 'public' : first.driver === 'mssql' ? 'dbo' : 'main');
        } else {
          setActiveConnection('', '', '');
        }
      }
    } catch (e: any) {
      alertError(e?.message || String(e), 'Failed to Delete Connection');
    }
  };

  const handleEditConnection = (connId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setConnectionDialogOpen(true, connId);
  };

  const handleOpenCreateDatabase = (conn: ConnectionConfig) => {
    if (conn.driver === 'sqlite') {
      alertInfo(
        'SQLite uses a local database file. To create a new SQLite database, add a new connection pointing to your desired SQLite file path.',
        'SQLite Database'
      );
      return;
    }
    setCreateDbModal({
      isOpen: true,
      connection: conn,
      dbName: '',
      charset: (conn.driver === 'mysql' || conn.driver === 'mariadb') ? 'utf8mb4' : 'UTF8',
      collation: (conn.driver === 'mysql' || conn.driver === 'mariadb') ? 'utf8mb4_unicode_ci' : '',
    });
  };

  const handleConfirmCreateDatabase = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!createDbModal.connection || !createDbModal.dbName.trim()) return;

    const conn = createDbModal.connection;
    const dbName = createDbModal.dbName.trim();

    // Validate identifier (letters, numbers, underscore, dash, dollar sign)
    if (!/^[a-zA-Z0-9_$-]+$/.test(dbName)) {
      alertWarning(
        'Database name can only contain letters, numbers, underscores, dashes, and dollar signs.',
        'Invalid Database Name'
      );
      return;
    }

    let sql = '';
    if (conn.driver === 'mysql' || conn.driver === 'mariadb') {
      sql = `CREATE DATABASE \`${dbName}\` CHARACTER SET ${createDbModal.charset || 'utf8mb4'} COLLATE ${createDbModal.collation || 'utf8mb4_unicode_ci'};`;
    } else if (conn.driver === 'mssql') {
      sql = `CREATE DATABASE [${dbName}];`;
    } else if (conn.driver === 'mongodb') {
      sql = `db.createCollection("init");`;
    } else if (conn.driver === 'clickhouse') {
      sql = `CREATE DATABASE \`${dbName}\`;`;
    } else if (conn.driver === 'postgres') {
      sql = `CREATE DATABASE "${dbName}" ENCODING '${createDbModal.charset || 'UTF8'}';`;
    }

    try {
      const execId = 'create-db-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: (conn.driver === 'mysql' || conn.driver === 'mariadb') ? (conn.databaseName || '') : (conn.driver === 'mssql' ? 'master' : conn.driver === 'mongodb' ? dbName : conn.driver === 'clickhouse' ? (conn.databaseName || 'default') : 'postgres'),
        schema: conn.driver === 'postgres' ? 'public' : '',
        sql,
        limit: 10,
        offset: 0,
      } as any);

      // Re-fetch connection databases
      const dbs = (await SchemaService.GetDatabases(conn.id)) ?? [];
      const safeDbs = dbs.length > 0 ? dbs : [dbName];
      setTreeDatabases(conn.id, safeDbs);

      // Ensure the newly created database is visible by default
      const currentVisible = useConnectionStore.getState().visibleDatabases[conn.id];
      if (currentVisible !== undefined && !currentVisible.includes(dbName)) {
        const nextVisibleSet = new Set([...currentVisible, dbName]);
        const orderedVisible = safeDbs.filter((d) => nextVisibleSet.has(d));
        setVisibleDatabases(
          conn.id,
          orderedVisible.length > 0 ? orderedVisible : [...currentVisible, dbName],
          safeDbs.length
        );
      }

      // Expand node if not expanded
      if (!expandedNodes[conn.id]) {
        toggleNode(conn.id);
      }

      setCreateDbModal({
        isOpen: false,
        connection: null,
        dbName: '',
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
      });
      alertSuccess(`Database "${dbName}" has been created successfully.`, 'Database Created');
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Create Database');
    }
  };

  // Schema / Collection Handlers (PostgreSQL)
  const handleOpenCreateSchema = (conn: ConnectionConfig, database: string) => {
    setCreateSchemaModal({
      isOpen: true,
      connection: conn,
      database,
      schemaName: '',
      authorization: '',
    });
  };

  const handleConfirmCreateSchema = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!createSchemaModal.connection || !createSchemaModal.database || !createSchemaModal.schemaName.trim()) return;

    const conn = createSchemaModal.connection;
    const dbName = createSchemaModal.database;
    const schemaName = createSchemaModal.schemaName.trim();
    const auth = createSchemaModal.authorization.trim();

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
      alertWarning(
        'Collection / Schema name must start with a letter or underscore, and can only contain letters, numbers, and underscores.',
        'Invalid Schema Name'
      );
      return;
    }

    let sql = `CREATE SCHEMA "${schemaName}"`;
    if (auth) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(auth)) {
        alertWarning('Authorization owner name contains invalid characters.', 'Invalid Owner Name');
        return;
      }
      sql += ` AUTHORIZATION "${auth}"`;
    }
    sql += `;`;

    try {
      const execId = 'create-schema-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: dbName,
        schema: 'public',
        sql,
        limit: 10,
        offset: 0,
      } as any);

      const schemas = (await SchemaService.GetSchemas(conn.id, dbName)) ?? [];
      const safeSchemas = schemas.length > 0 ? schemas : [schemaName];
      const nodeKey = `${conn.id}:${dbName}`;
      setTreeSchemas((prev) => ({ ...prev, [nodeKey]: safeSchemas }));

      const sKey = `${conn.id}:${dbName}:${schemaName}`;
      setTreeObjects(sKey, []);

      if (!expandedNodes[nodeKey]) {
        toggleNode(nodeKey);
      }
      setNodeExpanded(`${conn.id}:${dbName}:schema:${schemaName}`, true);

      setCreateSchemaModal({
        isOpen: false,
        connection: null,
        database: '',
        schemaName: '',
        authorization: '',
      });
      alertSuccess(`Collection / Schema "${schemaName}" created successfully.`, 'Collection Created');
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Create Collection');
    }
  };

  const handleRefreshSchema = async (connId: string, dbName: string, schemaName: string) => {
    const schemaKey = `${connId}:${dbName}:${schemaName}`;
    try {
      const objects = (await SchemaService.GetObjects(connId, dbName, schemaName)) ?? [];
      setTreeObjects(schemaKey, objects as any);
      alertSuccess(`Collection / Schema "${schemaName}" refreshed.`, 'Refreshed');
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Refresh Collection');
    }
  };

  const handleDeleteSchema = async (conn: ConnectionConfig, dbName: string, schemaName: string) => {
    if (schemaName === 'public') {
      alertWarning('Cannot drop default "public" schema.', 'Action Not Allowed');
      return;
    }
    const ok = await confirmDialog({
      title: 'Drop Collection / Schema',
      message: `Are you sure you want to DROP collection/schema "${schemaName}" in database "${dbName}"? All tables, views, and data in this collection will be permanently deleted (CASCADE). This action cannot be undone.`,
      connectionContext: buildAlertConnectionContext(conn, {
        database: dbName,
        targetName: schemaName,
        targetLabel: 'Schema',
      }),
      confirmLabel: 'Drop Schema',
      isDanger: true,
    });
    if (!ok) return;

    try {
      const execId = 'drop-schema-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: dbName,
        schema: schemaName,
        sql: `DROP SCHEMA "${schemaName}" CASCADE;`,
        limit: 10,
        offset: 0,
      } as any);

      const nodeKey = `${conn.id}:${dbName}`;
      const schemas = (await SchemaService.GetSchemas(conn.id, dbName)) ?? [];
      const safeSchemas = schemas.length > 0 ? schemas : ['public'];
      setTreeSchemas((prev) => ({ ...prev, [nodeKey]: safeSchemas }));
      alertSuccess(`Collection / Schema "${schemaName}" dropped successfully.`, 'Schema Dropped');
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Drop Schema');
    }
  };

  const handleOpenMoveTable = async (
    conn: ConnectionConfig,
    database: string,
    sourceSchema: string,
    table: ObjectSummary
  ) => {
    const isMySQL = conn.driver === 'mysql' || conn.driver === 'mariadb';
    let schemas: string[] = [];

    if (isMySQL) {
      schemas = treeDatabases[conn.id] || [];
      if (schemas.length === 0) {
        try {
          schemas = (await SchemaService.GetDatabases(conn.id)) ?? [];
        } catch {
          schemas = [database];
        }
      }
    } else {
      schemas = treeSchemas[`${conn.id}:${database}`] || [];
      if (schemas.length === 0) {
        try {
          schemas = (await SchemaService.GetSchemas(conn.id, database)) ?? [];
        } catch {
          schemas = ['public'];
        }
      }
    }

    const currentSource = isMySQL ? (database || sourceSchema) : sourceSchema;
    const otherSchemas = schemas.filter((s) => s !== currentSource);
    const defaultTarget = otherSchemas.length > 0 ? otherSchemas[0] : '';

    setMoveTableModal({
      isOpen: true,
      connection: conn,
      database,
      sourceSchema: currentSource,
      tableName: table.name,
      targetSchema: defaultTarget,
      objectType: table.type || 'table',
      availableSchemas: schemas,
    });
  };

  const handleConfirmMoveTable = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (
      !moveTableModal.connection ||
      !moveTableModal.database ||
      !moveTableModal.tableName ||
      !moveTableModal.targetSchema.trim()
    ) {
      return;
    }

    const { connection: conn, database: db, sourceSchema, targetSchema: rawTarget, tableName, objectType } = moveTableModal;
    const targetSchema = rawTarget.trim();

    if (targetSchema === sourceSchema) {
      alertWarning('Target collection/schema/database must be different from current.', 'Same Target');
      return;
    }

    const isMySQL = conn.driver === 'mysql' || conn.driver === 'mariadb';
    let keyword = 'TABLE';
    if (objectType === 'view') {
      keyword = 'VIEW';
    } else if (objectType === 'materialized_view') {
      keyword = 'MATERIALIZED VIEW';
    } else if (objectType === 'sequence') {
      keyword = 'SEQUENCE';
    }

    let sql = '';
    if (isMySQL) {
      sql = `RENAME TABLE \`${sourceSchema}\`.\`${tableName}\` TO \`${targetSchema}\`.\`${tableName}\`;`;
    } else {
      sql = `ALTER ${keyword} "${sourceSchema}"."${tableName}" SET SCHEMA "${targetSchema}";`;
    }

    try {
      const execId = 'move-table-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: db,
        schema: sourceSchema,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      if (isMySQL) {
        removeTreeObject(`${conn.id}:${sourceSchema}:${sourceSchema}`, tableName);
        handleRefreshDatabase(conn.id, sourceSchema);
        handleRefreshDatabase(conn.id, targetSchema);
      } else {
        // Update tree: remove from old schema
        const oldKey = `${conn.id}:${db}:${sourceSchema}`;
        removeTreeObject(oldKey, tableName);

        // Refresh both source and target schema objects
        const [oldObjs, newObjs] = await Promise.all([
          SchemaService.GetObjects(conn.id, db, sourceSchema).catch(() => null),
          SchemaService.GetObjects(conn.id, db, targetSchema).catch(() => null),
        ]);
        if (oldObjs) setTreeObjects(oldKey, oldObjs as any);
        if (newObjs) setTreeObjects(`${conn.id}:${db}:${targetSchema}`, newObjs as any);

        // Ensure treeSchemas has targetSchema if it was new
        const dbKey = `${conn.id}:${db}`;
        const currSchemas = treeSchemas[dbKey] || [];
        if (!currSchemas.includes(targetSchema)) {
          const refreshedSchemas = (await SchemaService.GetSchemas(conn.id, db)) ?? [];
          setTreeSchemas((prev) => ({ ...prev, [dbKey]: refreshedSchemas }));
        }
      }

      setMoveTableModal({
        isOpen: false,
        connection: null,
        database: '',
        sourceSchema: '',
        tableName: '',
        targetSchema: '',
        objectType: 'table',
        availableSchemas: [],
      });

      alertSuccess(
        `Moved ${keyword.toLowerCase()} "${tableName}" from "${sourceSchema}" to "${targetSchema}".`,
        'Table Moved'
      );
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Move Table');
    }
  };

  // Database handlers
  const handleRefreshDatabase = async (connId: string, dbName: string) => {
    const conn = connections.find((c) => c.id === connId);
    if (conn?.driver === 'postgres' || conn?.driver === 'mssql' || conn?.driver === 'oracle') {
      try {
        const defaultSchema = conn?.driver === 'mssql' ? 'dbo' : conn?.driver === 'oracle' ? (conn?.username || 'SYSTEM').toUpperCase() : 'public';
        const schemas = (await SchemaService.GetSchemas(connId, dbName)) ?? [];
        const safeSchemas = schemas.length > 0 ? schemas : [defaultSchema];
        setTreeSchemas((prev) => ({ ...prev, [`${connId}:${dbName}`]: safeSchemas }));
        for (const s of safeSchemas) {
          const sKey = `${connId}:${dbName}:${s}`;
          const objects = (await SchemaService.GetObjects(connId, dbName, s)) ?? [];
          setTreeObjects(sKey, objects as any);
        }
        alertSuccess(`Database "${dbName}" refreshed.`, 'Refreshed');
      } catch (err: any) {
        alertError(err?.message || String(err), 'Failed to Refresh Database');
      }
      return;
    }

    const targetSchema = dbName;
    const schemaKey = `${connId}:${dbName}:${targetSchema}`;
    try {
      const objects = (await SchemaService.GetObjects(connId, dbName, targetSchema)) ?? [];
      setTreeObjects(schemaKey, objects as any);
      if (conn?.driver === 'qdrant') {
        fetchQdrantAliases(connId);
      }
      alertSuccess(`Database "${dbName}" refreshed.`, 'Refreshed');
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Refresh Database');
    }
  };

  const handleEditDatabase = (conn: ConnectionConfig, dbName: string) => {
    if (conn.driver === 'postgres') {
      openTab({
        id: `console-alter-${Date.now()}`,
        type: 'worksheet',
        title: `alter_${dbName}.sql`,
        connectionId: conn.id,
        database: 'postgres',
        schema: 'public',
        content: `-- Rename or Modify Database: ${dbName}\n-- Note: You must be connected to an administrative database (e.g. postgres) to rename.\nALTER DATABASE "${dbName}" RENAME TO "${dbName}_renamed";\n`,
      });
    } else if (conn.driver === 'mysql' || conn.driver === 'mariadb') {
      // Open a query console pre-populated with ALTER DATABASE statement
      openTab({
        id: `console-alter-${Date.now()}`,
        type: 'worksheet',
        title: `alter_${dbName}.sql`,
        connectionId: conn.id,
        database: dbName,
        schema: dbName,
        content: `-- Modify Character Set / Collation for Database: ${dbName}\nALTER DATABASE \`${dbName}\` CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;\n`,
      });
    } else if (conn.driver === 'mssql') {
      openTab({
        id: `console-alter-${Date.now()}`,
        type: 'worksheet',
        title: `alter_${dbName}.sql`,
        connectionId: conn.id,
        database: 'master',
        schema: 'dbo',
        content: `-- Rename Database in SQL Server: ${dbName}\nALTER DATABASE [${dbName}] MODIFY NAME = [${dbName}_renamed];\n`,
      });
    } else {
      alertInfo('SQLite databases are local files and do not support database modification queries.', 'SQLite Information');
    }
  };

  const handleDeleteDatabase = async (conn: ConnectionConfig, dbName: string) => {
    if (conn.driver === 'sqlite') {
      alertInfo('SQLite uses a local database file. To remove it, delete the connection or delete the file from your disk.', 'SQLite Information');
      return;
    }

    const okDrop = await confirmDialog({
      title: 'Drop Database',
      message: `Are you sure you want to DROP database "${dbName}"? This will permanently delete the database and all its tables and data. This action cannot be undone.`,
      connectionContext: buildAlertConnectionContext(conn, {
        database: dbName,
        targetName: dbName,
        targetLabel: 'Database',
      }),
      confirmLabel: 'Drop Database',
      isDanger: true,
    });
    if (!okDrop) return;

    const sql =
      (conn.driver === 'mysql' || conn.driver === 'mariadb' || conn.driver === 'clickhouse')
        ? `DROP DATABASE \`${dbName}\`;`
        : conn.driver === 'mssql'
        ? `DROP DATABASE [${dbName}];`
        : conn.driver === 'mongodb'
        ? `db.dropDatabase();`
        : `DROP DATABASE "${dbName}";`;

    try {
      const execId = 'drop-db-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: (conn.driver === 'mysql' || conn.driver === 'mariadb') ? '' : (conn.driver === 'mssql' ? 'master' : conn.driver === 'mongodb' ? dbName : conn.driver === 'clickhouse' ? 'default' : 'postgres'),
        schema: conn.driver === 'postgres' ? 'public' : '',
        sql,
        limit: 10,
        offset: 0,
      } as any);

      removeTreeDatabase(conn.id, dbName);
      closeTabsMatching((t) => t.connectionId === conn.id && t.database === dbName);

      if (activeConnectionId === conn.id && activeDatabase === dbName) {
        const remaining = (treeDatabases[conn.id] || []).filter((d) => d !== dbName);
        setActiveConnection(conn.id, remaining[0] || '', '');
      }

      // Re-fetch remaining databases
      const dbs = (await SchemaService.GetDatabases(conn.id)) ?? [];
      setTreeDatabases(conn.id, dbs);
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Drop Database');
    }
  };

  // Table handlers
  const handleTableClick = (connId: string, db: string, schema: string, tableName: string) => {
    const conn = connections.find((c) => c.id === connId);
    openTab({
      id: `table-${connId}-${db}-${tableName}`,
      type: 'table_data',
      title: tableName,
      connectionId: connId,
      driver: conn?.driver,
      database: db,
      schema: schema,
      table: tableName,
    });
  };

  const handleOpenERDiagram = (connId: string, db: string, schema: string) => {
    const conn = connections.find((c) => c.id === connId);
    openTab({
      id: `erd-${connId}-${db}-${schema || 'public'}`,
      type: 'er_diagram',
      title: `ERD: ${db}${schema && schema !== db && schema !== 'main' ? `.${schema}` : ''}`,
      connectionId: connId,
      driver: conn?.driver,
      database: db,
      schema: schema || (conn?.driver === 'postgres' ? 'public' : db),
    });
  };

  const handleEditTableStructure = (conn: ConnectionConfig, db: string, schema: string, tableName: string) => {
    if (conn?.driver?.toLowerCase() === 'redis') return;
    openEditTableModal(conn, db, schema, tableName);
  };

  const handleRefreshTable = async (connId: string, db: string, schema: string, tableName: string) => {
    try {
      await SchemaService.GetTableStructure(connId, db, schema, tableName);
      const objects = (await SchemaService.GetObjects(connId, db, schema)) ?? [];
      setTreeObjects(`${connId}:${db}:${schema}`, objects as any);
      // Trigger grid refresh if table tab is open
      refreshTab(`table-${connId}-${db}-${tableName}`);
    } catch (err: any) {
      console.warn('Failed to refresh table:', err);
    }
  };

  const handleDeleteTable = async (
    conn: ConnectionConfig,
    db: string,
    schema: string,
    obj: ObjectSummary
  ) => {
    const isRedis = conn.driver === 'redis';
    const isView = obj.type === 'view';
    const keyword = isRedis ? 'KEY' : isView ? 'VIEW' : 'TABLE';

    const ok = await confirmDialog({
      title: isRedis ? 'Delete Key' : `Drop ${isView ? 'View' : 'Table'}`,
      message: isRedis
        ? `Are you sure you want to delete key "${obj.name}" from ${db}? This action cannot be undone.`
        : `Are you sure you want to DROP ${keyword.toLowerCase()} "${obj.name}"? All data in this ${keyword.toLowerCase()} will be permanently lost. This action cannot be undone.`,
      connectionContext: buildAlertConnectionContext(conn, {
        database: db,
        schema,
        targetName: obj.name,
        targetLabel: isRedis ? 'Key' : isView ? 'View' : 'Table',
      }),
      confirmLabel: isRedis ? 'Delete Key' : `Drop ${keyword.toLowerCase()}`,
      isDanger: true,
    });
    if (!ok) return;

    let sql = '';
    if (isRedis) {
      sql = `DEL ${obj.name}`;
    } else if (conn.driver === 'qdrant') {
      sql = `DELETE /collections/${encodeURIComponent(obj.name)}`;
    } else if (conn.driver === 'elasticsearch') {
      sql = `DELETE /${encodeURIComponent(obj.name)}`;
    } else if (conn.driver === 'mysql' || conn.driver === 'mariadb' || conn.driver === 'clickhouse') {
      sql = `DROP ${keyword} \`${obj.name}\`;`;
    } else if (conn.driver === 'mssql') {
      sql = `DROP ${keyword} [${schema}].[${obj.name}];`;
    } else if (conn.driver === 'mongodb') {
      sql = `db.${obj.name}.drop();`;
    } else if (conn.driver === 'postgres') {
      sql = `DROP ${keyword} "${schema}"."${obj.name}";`;
    } else {
      sql = `DROP ${keyword} "${obj.name}";`;
    }

    try {
      const execId = 'drop-table-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: db,
        schema: schema,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      const schemaKey = `${conn.id}:${db}:${schema}`;
      removeTreeObject(schemaKey, obj.name);
      closeTab(`table-${conn.id}-${db}-${obj.name}`);

      // Background refresh
      SchemaService.GetObjects(conn.id, db, schema)
        .then((objs) => {
          if (objs) setTreeObjects(schemaKey, objs as any);
        })
        .catch(() => {});

      alertSuccess(
        isRedis ? `Deleted key "${obj.name}".` : `Dropped ${keyword.toLowerCase()} "${obj.name}".`,
        isRedis ? 'Key Deleted' : `${keyword} Dropped`
      );
    } catch (err: any) {
      alertError(err?.message || String(err), isRedis ? 'Failed to Delete Key' : `Failed to Drop ${keyword}`);
    }
  };

  const handleTruncateTable = async (
    conn: ConnectionConfig,
    db: string,
    schema: string,
    obj: ObjectSummary
  ) => {
    if (obj.type === 'view' || obj.type === 'materialized_view') {
      alertWarning('Views cannot be truncated. Use Drop View instead.', 'Cannot Truncate View');
      return;
    }

    const ok = await confirmDialog({
      title: 'Truncate Table',
      message: `Are you sure you want to TRUNCATE table "${obj.name}"? All rows in this table will be permanently deleted and auto-increment sequences may be reset. This action cannot be undone.`,
      connectionContext: buildAlertConnectionContext(conn, {
        database: db,
        schema,
        targetName: obj.name,
        targetLabel: 'Table',
      }),
      confirmLabel: 'Truncate Table',
      isDanger: true,
    });
    if (!ok) return;

    let sql = '';
    if (conn.driver === 'mysql' || conn.driver === 'mariadb' || conn.driver === 'clickhouse') {
      const dbPrefix = db && db !== 'main' ? `\`${db}\`.` : '';
      sql = `TRUNCATE TABLE ${dbPrefix}\`${obj.name}\`;`;
    } else if (conn.driver === 'postgres') {
      const sch = schema || 'public';
      sql = `TRUNCATE TABLE "${sch}"."${obj.name}" RESTART IDENTITY;`;
    } else if (conn.driver === 'mssql') {
      const sch = schema || 'dbo';
      sql = `TRUNCATE TABLE [${sch}].[${obj.name}];`;
    } else if (conn.driver === 'sqlite') {
      sql = `DELETE FROM "${obj.name}"; DELETE FROM sqlite_sequence WHERE name = '${obj.name}';`;
    } else if (conn.driver === 'mongodb') {
      sql = `db.${obj.name}.deleteMany({});`;
    } else if (conn.driver === 'qdrant') {
      sql = `POST /collections/${encodeURIComponent(obj.name)}/points/delete?wait=true\n{"filter":{}}`;
    } else if (conn.driver === 'elasticsearch') {
      sql = `POST /${encodeURIComponent(obj.name)}/_delete_by_query\n{"query":{"match_all":{}}}`;
    } else {
      sql = `TRUNCATE TABLE "${obj.name}";`;
    }

    try {
      const execId = 'truncate-table-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: db,
        schema,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      // Refresh table structure / metadata
      const schemaKey = `${conn.id}:${db}:${schema}`;
      SchemaService.GetObjects(conn.id, db, schema)
        .then((objs) => {
          if (objs) setTreeObjects(schemaKey, objs as any);
        })
        .catch(() => {});

      alertSuccess(`Table "${obj.name}" was truncated successfully.`, 'Table Truncated');
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Truncate Table');
    }
  };

  const handleTableMaintenance = async (
    conn: ConnectionConfig,
    db: string,
    table: string,
    action: 'OPTIMIZE' | 'ANALYZE' | 'CHECK' | 'REPAIR'
  ) => {
    const dbPrefix = db && db !== 'main' ? `\`${db}\`.` : '';
    const sql = `${action} TABLE ${dbPrefix}\`${table}\`;`;

    try {
      const execId = `maint-${action.toLowerCase()}-${Date.now()}`;
      const res = await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: db,
        schema: db,
        sql,
        limit: 100,
        offset: 0,
      } as any);

      if (res?.error) {
        alertError(`Failed to ${action.toLowerCase()} table: ${res.error}`, `${action} Table Failed`);
        return;
      }

      alertSuccess(`Table "${table}": ${action} TABLE completed successfully.`, `${action} Table Completed`);
    } catch (err: any) {
      alertError(err?.message || String(err), `Failed to ${action} Table`);
    }
  };

  const handleEventClick = async (
    conn: ConnectionConfig,
    db: string,
    eventName: string
  ) => {
    let content = `-- Scheduled Event: ${eventName}\n-- Connection: ${conn.name} | Database: ${db}\n\n`;
    try {
      const ddl = await Call.ByName(
        'dhub/internal/services.SchemaService.GetObjectDDL',
        conn.id,
        db,
        db,
        'event',
        eventName
      );
      if (ddl && typeof ddl === 'string') {
        content += `${ddl.trim().replace(/;$/, '')};\n`;
      }
    } catch {
      content += `-- 1. View event definition:\nSHOW CREATE EVENT \`${db}\`.\`${eventName}\`;\n\n-- 2. Alter event status:\n-- ALTER EVENT \`${db}\`.\`${eventName}\` DISABLE;\n-- ALTER EVENT \`${db}\`.\`${eventName}\` ENABLE;\n`;
    }

    openTab({
      id: `event-${conn.id}-${db}-${eventName}`,
      type: 'worksheet',
      title: `${eventName}.sql`,
      connectionId: conn.id,
      database: db,
      schema: db,
      content,
    });
  };

  const handleDeleteEvent = async (
    conn: ConnectionConfig,
    db: string,
    eventName: string
  ) => {
    const ok = await confirmDialog({
      title: 'Drop Event',
      message: `Are you sure you want to DROP scheduled event "${eventName}"? This action cannot be undone.`,
      connectionContext: buildAlertConnectionContext(conn, {
        database: db,
        targetName: eventName,
        targetLabel: 'Event',
      }),
      confirmLabel: 'Drop Event',
      isDanger: true,
    });
    if (!ok) return;

    const sql = `DROP EVENT \`${db}\`.\`${eventName}\`;`;
    try {
      const execId = 'drop-event-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: db,
        schema: db,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      alertSuccess(`Event "${eventName}" dropped successfully.`, 'Event Dropped');
      handleRefreshDatabase(conn.id, db);
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Drop Event');
    }
  };

  const handleSequenceClick = async (
    conn: ConnectionConfig,
    db: string,
    schema: string,
    seqName: string
  ) => {
    let content = `-- Sequence: ${seqName}\n-- Connection: ${conn.name} | Database: ${db} | Schema: ${schema}\n\n`;
    try {
      const ddl = await Call.ByName(
        'dhub/internal/services.SchemaService.GetObjectDDL',
        conn.id,
        db,
        schema,
        'sequence',
        seqName
      );
      if (ddl && typeof ddl === 'string') {
        content += `${ddl.trim()}\n`;
      }
    } catch {
      if (conn.driver === 'mariadb') {
        content += `-- 1. View sequence definition:\nSHOW CREATE SEQUENCE \`${db}\`.\`${seqName}\`;\n\n-- 2. Get next value / last value:\n-- SELECT NEXT VALUE FOR \`${db}\`.\`${seqName}\`;\n-- SELECT LASTVAL(\`${db}\`.\`${seqName}\`);\n`;
      } else if (conn.driver === 'postgres') {
        content += `-- 1. View sequence state:\nSELECT * FROM "${schema}"."${seqName}";\n\n-- 2. Get next value:\n-- SELECT nextval('"${schema}"."${seqName}"');\n`;
      } else if (conn.driver === 'mssql') {
        content += `-- 1. View sequence metadata:\nSELECT * FROM sys.sequences WHERE name = '${seqName}';\n\n-- 2. Get next value:\n-- SELECT NEXT VALUE FOR [${schema}].[${seqName}];\n`;
      } else {
        content += `-- Sequence inspection for ${conn.driver}\nSELECT '${seqName}';\n`;
      }
    }

    openTab({
      id: `sequence-${conn.id}-${db}-${schema}-${seqName}`,
      type: 'worksheet',
      title: `${seqName}.sql`,
      connectionId: conn.id,
      database: db,
      schema: schema,
      content,
    });
  };

  const handleDeleteSequence = async (
    conn: ConnectionConfig,
    db: string,
    schema: string,
    seqName: string
  ) => {
    const ok = await confirmDialog({
      title: 'Drop Sequence',
      message: `Are you sure you want to DROP sequence "${seqName}"? This action cannot be undone.`,
      connectionContext: buildAlertConnectionContext(conn, {
        database: db,
        schema,
        targetName: seqName,
        targetLabel: 'Sequence',
      }),
      confirmLabel: 'Drop Sequence',
      isDanger: true,
    });
    if (!ok) return;

    let sql = '';
    if (conn.driver === 'mariadb' || conn.driver === 'mysql') {
      sql = `DROP SEQUENCE IF EXISTS \`${db}\`.\`${seqName}\`;`;
    } else if (conn.driver === 'postgres') {
      sql = `DROP SEQUENCE IF EXISTS "${schema}"."${seqName}";`;
    } else if (conn.driver === 'mssql') {
      sql = `DROP SEQUENCE IF EXISTS [${schema}].[${seqName}];`;
    } else {
      return;
    }

    try {
      const execId = 'drop-sequence-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: db,
        schema: schema,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      const schemaKey = `${conn.id}:${db}:${schema}`;
      removeTreeObject(schemaKey, seqName);
      SchemaService.GetObjects(conn.id, db, schema)
        .then((objs) => {
          if (objs) setTreeObjects(schemaKey, objs as any);
        })
        .catch(() => {});
      alertSuccess(`Sequence "${seqName}" dropped successfully.`, 'Sequence Dropped');
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Drop Sequence');
    }
  };

  const handleRoutineClick = async (
    conn: ConnectionConfig,
    db: string,
    schema: string,
    routineName: string,
    routineComment?: string
  ) => {
    const isFunction = (routineComment || '').toUpperCase().startsWith('[FUNCTION]');
    const isProcedure = (routineComment || '').toUpperCase().startsWith('[PROCEDURE]');
    let content = `-- Routine${isFunction ? ' (FUNCTION)' : isProcedure ? ' (PROCEDURE)' : ''}: ${routineName}\n-- Connection: ${conn.name} | Database: ${db} | Schema: ${schema}\n\n`;

    try {
      const ddl = await Call.ByName(
        'dhub/internal/services.SchemaService.GetObjectDDL',
        conn.id,
        db,
        schema,
        'routine',
        routineName
      );
      if (ddl && typeof ddl === 'string') {
        content += `${ddl.trim()}\n`;
      }
    } catch {
      if (conn.driver === 'postgres') {
        content += `-- 1. View definition source:\nSELECT pg_get_functiondef(p.oid)\nFROM pg_proc p\nJOIN pg_namespace n ON n.oid = p.pronamespace\nWHERE n.nspname = '${schema}' AND p.proname = '${routineName}';\n\n-- 2. Execute / Call routine:\n-- SELECT "${schema}"."${routineName}"();\n`;
      } else if (conn.driver === 'mysql' || conn.driver === 'mariadb') {
        if (isFunction) {
          content += `-- 1. View function definition:\nSHOW CREATE FUNCTION \`${db}\`.\`${routineName}\`;\n\n-- 2. Call function:\n-- SELECT \`${db}\`.\`${routineName}\`();\n`;
        } else if (isProcedure) {
          content += `-- 1. View procedure definition:\nSHOW CREATE PROCEDURE \`${db}\`.\`${routineName}\`;\n\n-- 2. Call procedure:\n-- CALL \`${db}\`.\`${routineName}\`();\n`;
        } else {
          content += `-- 1. View definition source:\nSHOW CREATE PROCEDURE \`${db}\`.\`${routineName}\`;\n-- Or function:\n-- SHOW CREATE FUNCTION \`${db}\`.\`${routineName}\`;\n\n-- 2. Call procedure:\n-- CALL \`${db}\`.\`${routineName}\`();\n`;
        }
      } else if (conn.driver === 'mssql') {
        content += `-- 1. View definition source:\nSELECT OBJECT_DEFINITION(OBJECT_ID('[${schema}].[${routineName}]'));\n\n-- 2. Execute routine:\n-- EXEC [${schema}].[${routineName}];\n`;
      } else {
        content += `-- SQLite does not support stored procedures or routines.\n`;
      }
    }

    openTab({
      id: `routine-${conn.id}-${db}-${schema}-${routineName}`,
      type: 'worksheet',
      title: `${routineName}.sql`,
      connectionId: conn.id,
      database: db,
      schema: schema,
      content,
    });
  };

  const handleTriggerClick = async (
    conn: ConnectionConfig,
    db: string,
    schema: string,
    triggerName: string
  ) => {
    let content = `-- Trigger: ${triggerName}\n-- Connection: ${conn.name} | Database: ${db} | Schema: ${schema}\n\n`;
    try {
      const ddl = await Call.ByName(
        'dhub/internal/services.SchemaService.GetObjectDDL',
        conn.id,
        db,
        schema,
        'trigger',
        triggerName
      );
      if (ddl && typeof ddl === 'string') {
        content += `${ddl.trim()}\n`;
      }
    } catch {
      if (conn.driver === 'postgres') {
        content += `-- 1. View trigger definition:\nSELECT pg_get_triggerdef(t.oid)\nFROM pg_trigger t\nJOIN pg_class c ON c.oid = t.tgrelid\nJOIN pg_namespace n ON n.oid = c.relnamespace\nWHERE n.nspname = '${schema}' AND t.tgname = '${triggerName}';\n`;
      } else if (conn.driver === 'mysql' || conn.driver === 'mariadb') {
        content += `-- 1. View trigger definition:\nSHOW CREATE TRIGGER \`${db}\`.\`${triggerName}\`;\n`;
      } else if (conn.driver === 'mssql') {
        content += `-- 1. View trigger definition:\nSELECT OBJECT_DEFINITION(OBJECT_ID('[${schema}].[${triggerName}]'));\n`;
      } else {
        content += `-- 1. View trigger definition in SQLite:\nSELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = '${triggerName}';\n`;
      }
    }

    openTab({
      id: `trigger-${conn.id}-${db}-${schema}-${triggerName}`,
      type: 'worksheet',
      title: `${triggerName}.sql`,
      connectionId: conn.id,
      database: db,
      schema: schema,
      content,
    });
  };

  const handleDeleteRoutine = async (
    conn: ConnectionConfig,
    db: string,
    schema: string,
    routineName: string,
    routineComment?: string
  ) => {
    const isFunction = (routineComment || '').toUpperCase().startsWith('[FUNCTION]');
    const isProcedure = (routineComment || '').toUpperCase().startsWith('[PROCEDURE]');
    const ok = await confirmDialog({
      title: isFunction ? 'Drop Function' : isProcedure ? 'Drop Procedure' : 'Drop Routine',
      message: `Are you sure you want to DROP ${isFunction ? 'function' : isProcedure ? 'procedure' : 'routine/function'} "${routineName}"? This action cannot be undone.`,
      connectionContext: buildAlertConnectionContext(conn, {
        database: db,
        schema,
        targetName: routineName,
        targetLabel: isFunction ? 'Function' : isProcedure ? 'Procedure' : 'Routine',
      }),
      confirmLabel: isFunction ? 'Drop Function' : isProcedure ? 'Drop Procedure' : 'Drop Routine',
      isDanger: true,
    });
    if (!ok) return;

    let sql = '';
    if (conn.driver === 'mysql' || conn.driver === 'mariadb') {
      if (isFunction) {
        sql = `DROP FUNCTION IF EXISTS \`${db}\`.\`${routineName}\`;`;
      } else if (isProcedure) {
        sql = `DROP PROCEDURE IF EXISTS \`${db}\`.\`${routineName}\`;`;
      } else {
        sql = `DROP PROCEDURE IF EXISTS \`${db}\`.\`${routineName}\`; DROP FUNCTION IF EXISTS \`${db}\`.\`${routineName}\`;`;
      }
    } else if (conn.driver === 'mssql') {
      sql = `DROP PROCEDURE IF EXISTS [${schema}].[${routineName}]; DROP FUNCTION IF EXISTS [${schema}].[${routineName}];`;
    } else if (conn.driver === 'postgres') {
      sql = `DROP ROUTINE IF EXISTS "${schema}"."${routineName}";`;
    } else {
      alertInfo('SQLite does not support routines/procedures.', 'Information');
      return;
    }

    try {
      const execId = 'drop-routine-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: db,
        schema: schema,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      const schemaKey = `${conn.id}:${db}:${schema}`;
      removeTreeObject(schemaKey, routineName);
      SchemaService.GetObjects(conn.id, db, schema)
        .then((objs) => {
          if (objs) setTreeObjects(schemaKey, objs as any);
        })
        .catch(() => {});
      alertSuccess(`Routine "${routineName}" has been dropped.`);
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Drop Routine');
    }
  };

  const handleDeleteTrigger = async (
    conn: ConnectionConfig,
    db: string,
    schema: string,
    triggerName: string
  ) => {
    const ok = await confirmDialog({
      title: 'Drop Trigger',
      message: `Are you sure you want to DROP trigger "${triggerName}"? This action cannot be undone.`,
      connectionContext: buildAlertConnectionContext(conn, {
        database: db,
        schema,
        targetName: triggerName,
        targetLabel: 'Trigger',
      }),
      confirmLabel: 'Drop Trigger',
      isDanger: true,
    });
    if (!ok) return;

    let sql = '';
    if (conn.driver === 'mysql' || conn.driver === 'mariadb') {
      sql = `DROP TRIGGER IF EXISTS \`${db}\`.\`${triggerName}\`;`;
    } else if (conn.driver === 'mssql') {
      sql = `DROP TRIGGER IF EXISTS [${schema}].[${triggerName}];`;
    } else if (conn.driver === 'postgres') {
      openTab({
        id: `drop-trigger-${Date.now()}`,
        type: 'worksheet',
        title: `drop_${triggerName}.sql`,
        connectionId: conn.id,
        database: db,
        schema: schema,
        content: `-- PostgreSQL requires the table name to drop a trigger:\nDROP TRIGGER IF EXISTS "${triggerName}" ON "${schema}"."<table_name>";\n`,
      });
      return;
    } else {
      sql = `DROP TRIGGER IF EXISTS "${triggerName}";`;
    }

    try {
      const execId = 'drop-trigger-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: db,
        schema: schema,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      const schemaKey = `${conn.id}:${db}:${schema}`;
      removeTreeObject(schemaKey, triggerName);
      SchemaService.GetObjects(conn.id, db, schema)
        .then((objs) => {
          if (objs) setTreeObjects(schemaKey, objs as any);
        })
        .catch(() => {});
      alertSuccess(`Trigger "${triggerName}" has been dropped.`);
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Drop Trigger');
    }
  };

  const handleNewConsole = (connId: string, dbName?: string, schema?: string, tableName?: string) => {
    const conn = connections.find((c) => c.id === connId);
    const targetDb = dbName || conn?.databaseName || 'main';
    const targetSchema = schema || (conn?.driver === 'postgres' ? 'public' : conn?.driver === 'mssql' ? 'dbo' : targetDb);
    const count = tabs.filter((t) => t.type === 'worksheet').length + 1;

    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);

function withConnTimeout<T>(promise: Promise<T>, ms = 12000, msg = 'Connection timed out'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(msg)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
    let content = `-- Query Console for ${targetDb}\n-- ${isMac ? 'Cmd' : 'Ctrl'}+Enter to execute\n\n`;
    if (conn?.driver === 'redis') {
      content = `-- Redis Query Console for ${targetDb}\n-- Type Redis commands directly (e.g. GET key, SET key val, KEYS *)\n-- ${isMac ? 'Cmd' : 'Ctrl'}+Enter to execute\n\nKEYS *\n`;
    } else if (conn?.driver === 'mongodb') {
      content = `-- MongoDB Query Console for ${targetDb}\n-- Run Mongo shell syntax or SQL:\n-- e.g. db.${tableName || 'collection'}.find() or SELECT * FROM ${tableName || 'collection'}\n-- ${isMac ? 'Cmd' : 'Ctrl'}+Enter to execute\n\n${tableName ? `db.${tableName}.find()` : `show collections`};\n`;
    } else if (conn?.driver === 'qdrant') {
      content = `-- Qdrant Query Console\n-- Run pseudo-SQL (SELECT * FROM collection LIMIT 50, SHOW COLLECTIONS) or REST API commands\n-- ${isMac ? 'Cmd' : 'Ctrl'}+Enter to execute\n\n${tableName ? `SELECT * FROM "${tableName}" LIMIT 50;` : `SHOW COLLECTIONS;`}\n`;
    } else if (tableName) {
      const quoted = (conn?.driver === 'mysql' || conn?.driver === 'mariadb' || conn?.driver === 'clickhouse') ? `\`${tableName}\`` : conn?.driver === 'mssql' ? `[${tableName}]` : `"${tableName}"`;
      content += conn?.driver === 'mssql' ? `SELECT TOP 100 * FROM ${quoted};\n` : conn?.driver === 'oracle' ? `SELECT * FROM ${quoted} FETCH FIRST 100 ROWS ONLY;\n` : `SELECT * FROM ${quoted} LIMIT 100;\n`;
    } else {
      content += conn?.driver === 'oracle' ? `SELECT 1 FROM DUAL;\n` : `SELECT 1;\n`;
    }

    openTab({
      id: `console-${Date.now()}`,
      type: 'worksheet',
      title: tableName ? `${tableName}.sql` : `console_${count}.sql`,
      connectionId: connId,
      database: targetDb,
      schema: targetSchema,
      content,
    });
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 1500);
  };

  const handleCopyTableSchema = async (
    conn: ConnectionConfig,
    database: string,
    schema: string,
    tableName: string
  ) => {
    try {
      const struct = await SchemaService.GetTableStructure(
        conn.id,
        database,
        schema,
        tableName
      );
      const ddl = struct?.ddl || '';
      if (ddl) {
        await navigator.clipboard.writeText(ddl);
        setCopiedText(ddl);
        setTimeout(() => setCopiedText(null), 1500);
        alertSuccess(`Schema (DDL) for "${tableName}" copied to clipboard`);
      } else {
        alertWarning(`No DDL schema available for "${tableName}"`);
      }
    } catch (err: any) {
      alertError('Failed to copy table schema: ' + (err?.message || String(err)));
    }
  };

  const renderConnectionNode = (c: ConnectionConfig, currentFolderId: string | null) => {
    const isConnExpanded = !!expandedNodes[c.id];
    const isConnLoading = loadingConnId === c.id;
    const connError = failedConnErrors[c.id];
    const isConnFailed = Boolean(connError);
    const isRedis = c.driver?.toLowerCase() === 'redis';
    const redisDefaultDbs = Array.from({ length: 16 }, (_, i) => `db${i}`);

    let allKnownDbs = treeDatabases[c.id] || (c.databaseName ? [c.databaseName] : []);
    if (isRedis) {
      const filtered = allKnownDbs.filter((d) => d !== 'default' && d !== 'main');
      allKnownDbs = filtered.length > 0 ? filtered : redisDefaultDbs;
    }
    const totalDbsCount =
      allKnownDbs.length > 0
        ? allKnownDbs.length
        : (databaseTotals[c.id] ?? (c.databaseName ? 1 : 0));
    const visibleList = visibleDatabases[c.id];
    const visibleDbsCount =
      visibleList !== undefined ? visibleList.length : totalDbsCount;

    let schemaBadgeText = '';
    if (totalDbsCount > 0) {
      schemaBadgeText = `${visibleDbsCount} of ${totalDbsCount}`;
    } else if (visibleList !== undefined) {
      schemaBadgeText = `${visibleList.length} of ${visibleList.length}`;
    }

    const databases =
      visibleList !== undefined
        ? allKnownDbs.filter((db) => visibleList.includes(db))
        : allKnownDbs;

    const isSQLite = c.driver === 'sqlite';
    const connSubtitle = isSQLite
      ? (c.filePath || c.databaseName || 'SQLite File')
      : `${c.host || 'localhost'}${c.port ? `:${c.port}` : ''}${c.databaseName ? ` / ${c.databaseName}` : ''}`;

    const isBeingDragged = draggedItem?.type === 'connection' && draggedItem.id === c.id;
    const isDropTargetBefore =
      dropTarget?.type === 'connection' && dropTarget.id === c.id && dropTarget.position === 'before';
    const isDropTargetAfter =
      dropTarget?.type === 'connection' && dropTarget.id === c.id && dropTarget.position === 'after';

    return (
      <div
        key={c.id}
        className={`mb-1 relative transition-opacity ${isBeingDragged ? 'opacity-40' : ''}`}
      >
        {isDropTargetBefore && (
          <div className="absolute -top-0.5 left-1 right-1 h-0.5 bg-blue-500 rounded-full z-20 pointer-events-none" />
        )}

        {/* Connection Node */}
        <div
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            handleItemMouseLeave();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', `conn:${c.id}`);
            setDraggedItem({ type: 'connection', id: c.id });
          }}
          onDragEnd={() => {
            setDraggedItem(null);
            setDropTarget(null);
          }}
          onDragOver={(e) => {
            if (!draggedItem || draggedItem.type !== 'connection' || draggedItem.id === c.id) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const pos: 'before' | 'after' =
              e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
            setDropTarget({
              type: 'connection',
              id: c.id,
              position: pos,
              folderId: currentFolderId,
            });
          }}
          onDragLeave={(e) => {
            e.stopPropagation();
            if (dropTarget?.type === 'connection' && dropTarget.id === c.id) {
              setDropTarget(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (draggedItem?.type === 'connection' && draggedItem.id !== c.id) {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const pos: 'before' | 'after' =
                e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
              reorderConnection(draggedItem.id, c.id, pos, currentFolderId);
            }
            setDraggedItem(null);
            setDropTarget(null);
          }}
          onClick={() => {
            handleItemMouseLeave();
            handleExpandConnection(c.id);
          }}
          onContextMenu={(e) => {
            handleItemMouseLeave();
            openContextMenu(e, 'connection', { connection: c });
          }}
          onMouseEnter={(e) => {
            const envInfo = getConnectionEnvInfo(c);
            handleItemMouseEnter(e, {
              kind: 'connection',
              title: c.name,
              badge: envInfo.label
                ? `${(c.driver || 'DB').toUpperCase()} • ${envInfo.label}`
                : (c.driver || 'DB').toUpperCase(),
              subtitle: isConnFailed ? `${connSubtitle} • Error: ${connError}` : connSubtitle,
              colorTag: envInfo.color || undefined,
            });
          }}
          onMouseLeave={handleItemMouseLeave}
          title={`${c.name} (${c.driver.toUpperCase()})`}
          className={`group flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors ${
            (() => {
              const env = resolveConnectionEnv(c);
              const isActive = activeConnectionId === c.id;
              if (env === 'dev') {
                return isActive
                  ? 'bg-emerald-950/60 text-emerald-200 font-medium border border-emerald-600/50'
                  : 'bg-emerald-950/30 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-950/50 hover:text-emerald-300';
              }
              if (env === 'prod') {
                return isActive
                  ? 'bg-rose-950/60 text-rose-200 font-medium border border-rose-600/50'
                  : 'bg-rose-950/30 text-rose-400 border border-rose-800/40 hover:bg-rose-950/50 hover:text-rose-300';
              }
              return isActive
                ? 'bg-[#22242c] font-medium text-white'
                : 'text-zinc-300 hover:bg-[#22242c]';
            })()
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {isConnExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
            )}
            <div className="relative shrink-0 flex items-center justify-center">
              <DbDriverIcon driver={c.driver} className="h-3.5 w-3.5" />
              {isConnFailed && (
                <span
                  className="absolute -bottom-1 -right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-[#14151a] ring-1 ring-red-500/80"
                  title={`Connection failed: ${connError}`}
                >
                  <X className="h-2 w-2 text-red-500 stroke-[3]" />
                </span>
              )}
            </div>
            <span className={`truncate ${isConnFailed ? 'text-red-400 font-medium' : ''}`}>{c.name}</span>
            {!isSQLite && (
              <button
                type="button"
                onMouseEnter={(e) => {
                  e.stopPropagation();
                  handleItemMouseLeave();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenDatabaseFilter(c, e);
                }}
                className="opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity text-[8.5px] font-medium tracking-tight px-1 py-0.5 rounded bg-[#181a22] hover:bg-[#252836] text-zinc-400 hover:text-zinc-200 shrink-0 cursor-pointer flex items-center leading-none"
                title={`Filter visible databases/schemas (${schemaBadgeText || 'select'})`}
              >
                <span>{schemaBadgeText || 'schemas'}</span>
              </button>
            )}
          </div>

          {/* Actions on hover */}
          <div
            onMouseEnter={(e) => {
              e.stopPropagation();
              handleItemMouseLeave();
            }}
            className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <button
              type="button"
              onClick={(e) => handleEditConnection(c.id, e)}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#2d303b]"
              title="Edit Connection"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => handleRefreshConnection(c.id, e)}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#2d303b]"
              title="Refresh Connection"
            >
              <RefreshCw className={`h-3 w-3 ${isConnLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={(e) => handleDeleteConnection(c.id, c.name, e)}
              className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-[#2d303b]"
              title="Delete Connection"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        {isDropTargetAfter && (
          <div className="absolute -bottom-0.5 left-1 right-1 h-0.5 bg-blue-500 rounded-full z-20 pointer-events-none" />
        )}

        {/* Sub Nodes */}
        {isConnExpanded && (
          <div className="ml-4 mt-1 border-l border-[#272932] pl-2 space-y-1">
            {isConnLoading && databases.length === 0 && (
              <div className="text-[11px] text-zinc-500 italic py-1">Connecting & loading databases...</div>
            )}

            {/* Users Node (Yellow with User icon, placed at the top) */}
            {c.driver?.toLowerCase() !== 'redis' && c.driver?.toLowerCase() !== 'qdrant' && (
              <div
                onClick={() => {
                  handleItemMouseLeave();
                  handleOpenUsersTab(c);
                }}
                onMouseEnter={(e) =>
                  handleItemMouseEnter(e, {
                    kind: 'database',
                    title: 'Users & Permissions',
                    badge: 'USERS',
                    subtitle: `${c.name} • Manage database users, grant permissions, and roles`,
                    colorTag: '#eab308',
                  })
                }
                onMouseLeave={handleItemMouseLeave}
                title={`Users & Permissions (${c.name})`}
                className="group/users flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer hover:bg-[#22242c] text-amber-300 hover:text-amber-200 transition-colors mb-0.5"
              >
                <User className="h-3 w-3 shrink-0 text-amber-400 group-hover/users:text-amber-300" />
                <span className="truncate font-medium flex-1 text-amber-300 group-hover/users:text-amber-200">
                  users
                </span>
                <span className="text-[9px] font-mono text-amber-400/80 border border-amber-500/30 bg-amber-500/10 px-1 rounded uppercase shrink-0">
                  AUTH
                </span>
              </div>
            )}

            {/* SQLite Direct Mode */}
            {isSQLite ? (
              (() => {
                const schemaKey = `${c.id}:main:main`;
                const objects = (treeObjects[schemaKey] || []).filter((o) =>
                  !filterText ? true : o.name.toLowerCase().includes(filterText.toLowerCase())
                );
                return (
                  <div>
                    <div className="text-[11px] text-zinc-500 flex items-center justify-between py-0.5 group/tbl">
                      <div className="flex items-center gap-1">
                        <Folder className="h-3 w-3" />
                        <span>tables ({objects.length})</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenCreateTable(c, 'main', 'main');
                        }}
                        className="opacity-0 group-hover/tbl:opacity-100 p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-opacity cursor-pointer"
                        title="Create New Table"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    {objects.map((obj) => (
                      <div
                        key={obj.name}
                        onClick={() => {
                          handleItemMouseLeave();
                          handleTableClick(c.id, 'main', 'main', obj.name);
                        }}
                        onContextMenu={(e) => {
                          handleItemMouseLeave();
                          openContextMenu(e, 'table', {
                            connection: c,
                            database: 'main',
                            schema: 'main',
                            table: obj,
                          });
                        }}
                        onMouseEnter={(e) =>
                          handleItemMouseEnter(e, {
                            kind: obj.type === 'view' ? 'view' : 'table',
                            title: obj.name,
                            badge: obj.type === 'view' ? 'VIEW' : 'TABLE',
                            subtitle: `${c.name} / main`,
                          })
                        }
                        onMouseLeave={handleItemMouseLeave}
                        data-explorer-table={`${c.id}:main:main:${obj.name}`}
                        title={obj.name}
                        className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white transition-colors ${
                          highlightedRevealKey === `${c.id}:main:main:${obj.name}`
                            ? 'bg-blue-600/25 text-white ring-1 ring-blue-400/70'
                            : ''
                        }`}
                      >
                        {obj.type === 'view' ? (
                          <Eye className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                        ) : obj.type === 'trigger' ? (
                          <Zap className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                        ) : (
                          <Table className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        )}
                        <span className="truncate">{obj.name}</span>
                      </div>
                    ))}
                  </div>
                );
              })()
            ) : (
              /* Multi-Database Mode (MySQL / PostgreSQL) */
              databases.length === 0 && !isConnLoading ? (
                allKnownDbs.length > 0 ? (
                  <div className="text-[11px] text-zinc-500 italic py-1 px-1 flex items-center justify-between">
                    <span>No schemas visible (0 of {allKnownDbs.length})</span>
                    <button
                      type="button"
                      onClick={(e) => handleOpenDatabaseFilter(c, e)}
                      className="text-blue-400 hover:underline not-italic cursor-pointer"
                    >
                      Select
                    </button>
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-500 italic py-1">No databases found</div>
                )
              ) : (
                databases.map((dbName) => {
                  const filterLower = filterText.toLowerCase().trim();
                  const targetSchema = c.driver === 'postgres' ? 'public' : c.driver === 'mssql' ? 'dbo' : dbName;
                  const schemaKey = `${c.id}:${dbName}:${targetSchema}`;
                  const allObjects = treeObjects[schemaKey] || [];

                  const dbMatches = !filterLower || dbName.toLowerCase().includes(filterLower);
                  const matchingObjects = filterLower
                    ? allObjects.filter((o) => o.name.toLowerCase().includes(filterLower))
                    : allObjects;
                  const hasMatchingObject = matchingObjects.length > 0;

                  if (filterLower && !dbMatches && !hasMatchingObject) {
                    return null;
                  }

                  const isDbExpanded =
                    !!expandedNodes[`${c.id}:${dbName}`] || (!!filterLower && hasMatchingObject);
                  const baseList = filterLower && !dbMatches ? matchingObjects : allObjects;
                  const tables =
                    c.driver === 'redis'
                      ? baseList
                      : baseList.filter((o) => o.type === 'table' || (!o.type && !['view', 'materialized_view', 'routine', 'trigger', 'event', 'sequence', 'extension'].includes(o.type)));
                  const views = c.driver === 'redis' ? [] : baseList.filter((o) => o.type === 'view');
                  const matViews = c.driver === 'redis' ? [] : baseList.filter((o) => o.type === 'materialized_view');
                  const routines = c.driver === 'redis' ? [] : baseList.filter((o) => o.type === 'routine');
                  const triggers = c.driver === 'redis' ? [] : baseList.filter((o) => o.type === 'trigger');
                  const events = c.driver === 'redis' ? [] : baseList.filter((o) => o.type === 'event');
                  const sequences = c.driver === 'redis' ? [] : baseList.filter((o) => o.type === 'sequence');
                  const isDbActive = activeConnectionId === c.id && activeDatabase === dbName;

                  return (
                    <div key={dbName} className="mb-0.5">
                      {/* Database Node */}
                      <div
                        onClick={() => {
                          handleItemMouseLeave();
                          handleExpandDatabase(c.id, dbName);
                        }}
                        onContextMenu={(e) => {
                          handleItemMouseLeave();
                          openContextMenu(e, 'database', {
                            connection: c,
                            database: dbName,
                            schema: targetSchema,
                          });
                        }}
                        onMouseEnter={(e) =>
                          handleItemMouseEnter(e, {
                            kind: 'database',
                            title: dbName,
                            badge: 'DATABASE',
                            subtitle: `${c.name} (${c.driver.toUpperCase()})`,
                          })
                        }
                        onMouseLeave={handleItemMouseLeave}
                        title={dbName}
                        className={`group/db flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer hover:bg-[#22242c] text-zinc-300 ${
                          isDbActive ? 'bg-[#22242c] text-zinc-100 font-medium' : ''
                        }`}
                      >
                        {isDbExpanded ? (
                          <ChevronDown className="h-3 w-3 text-zinc-500 shrink-0" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-zinc-500 shrink-0" />
                        )}
                        <Database className="h-3 w-3 shrink-0 text-zinc-400" />
                        <span className="truncate flex-1">{dbName}</span>
                        <div
                          onMouseEnter={(e) => {
                            e.stopPropagation();
                            handleItemMouseLeave();
                          }}
                          className="opacity-0 group-hover/db:opacity-100 flex items-center gap-0.5 transition-opacity ml-1"
                        >
                          {c.driver?.toLowerCase() === 'redis' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveConnection(c.id, dbName, dbName);
                                openTab({
                                  id: `table-${c.id}-${dbName}-keys`,
                                  type: 'table_data',
                                  title: `${dbName} (keys)`,
                                  connectionId: c.id,
                                  driver: c.driver,
                                  database: dbName,
                                  schema: dbName,
                                  table: 'keys',
                                });
                              }}
                              className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-colors cursor-pointer"
                              title={`View Keys in "${dbName}"`}
                            >
                              <Eye className="h-3 w-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRefreshDatabase(c.id, dbName);
                            }}
                            className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-colors cursor-pointer"
                            title={`Refresh "${dbName}"`}
                          >
                            <RefreshCw className="h-3 w-3" />
                          </button>
                          {c.driver === 'postgres' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenCreateSchema(c, dbName);
                              }}
                              className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-colors cursor-pointer"
                              title={`Create New Collection / Schema in "${dbName}"`}
                            >
                              <Layers className="h-3 w-3 text-cyan-400" />
                            </button>
                          )}
                          {c.driver !== 'redis' && !c.isReadOnly && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenCreateTable(c, dbName, targetSchema);
                              }}
                              className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-colors cursor-pointer"
                              title={
                                c.driver === 'mongodb' || c.driver === 'qdrant'
                                  ? `Create New Collection in "${dbName}"`
                                  : `Create New Table in "${dbName}"`
                              }
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Tables & Views under this database */}
                      {isDbExpanded && (
                        <div className="ml-4 mt-0.5 border-l border-[#272932] pl-2 space-y-0.5">
                          {c.driver === 'postgres' || c.driver === 'mssql' || c.driver === 'oracle' ? (
                            (treeSchemas[`${c.id}:${dbName}`] || (c.driver === 'mssql' ? ['dbo'] : c.driver === 'oracle' ? [(c.username || 'SYSTEM').toUpperCase()] : ['public'])).map((sName) => {
                              const sNodeKey = `${c.id}:${dbName}:schema:${sName}`;
                              const isSExpanded = expandedNodes[sNodeKey] !== false; // default open
                              const sKey = `${c.id}:${dbName}:${sName}`;
                              const sAllObjects = treeObjects[sKey] || [];
                              const sMatchingObjects = filterLower
                                ? sAllObjects.filter((o) => o.name.toLowerCase().includes(filterLower))
                                : sAllObjects;
                              const sBaseList = filterLower && !dbMatches ? sMatchingObjects : sAllObjects;
                              const sTables = sBaseList.filter((o) => o.type === 'table' || (!o.type && !['view', 'materialized_view', 'routine', 'trigger', 'event', 'sequence', 'extension'].includes(o.type)));
                              const sViews = sBaseList.filter((o) => o.type === 'view');
                              const sMatViews = sBaseList.filter((o) => o.type === 'materialized_view');
                              const sRoutines = sBaseList.filter((o) => o.type === 'routine');
                              const sTriggers = sBaseList.filter((o) => o.type === 'trigger');
                              const sEvents = sBaseList.filter((o) => o.type === 'event');
                              const sSequences = sBaseList.filter((o) => o.type === 'sequence');
                              const isSchemaActive = activeConnectionId === c.id && activeDatabase === dbName && activeSchema === sName;

                              return (
                                <div key={sName} className="mb-0.5">
                                  {/* Schema Node Header */}
                                  <div
                                    onClick={() => {
                                      handleItemMouseLeave();
                                      toggleNode(sNodeKey);
                                      setActiveConnection(c.id, dbName, sName);
                                      if (!treeObjects[sKey]) {
                                        SchemaService.GetObjects(c.id, dbName, sName)
                                          .then((objs) => {
                                            if (objs) setTreeObjects(sKey, objs as any);
                                          })
                                          .catch(() => {});
                                      }
                                    }}
                                    onContextMenu={(e) => {
                                      handleItemMouseLeave();
                                      openContextMenu(e, 'schema', {
                                        connection: c,
                                        database: dbName,
                                        schema: sName,
                                      });
                                    }}
                                    onMouseEnter={(e) =>
                                      handleItemMouseEnter(e, {
                                        kind: 'schema',
                                        title: sName,
                                        badge: 'SCHEMA',
                                        subtitle: `${c.name} / ${dbName}`,
                                      })
                                    }
                                    onMouseLeave={handleItemMouseLeave}
                                    onDragOver={(e) => {
                                      if (
                                        draggedItem?.type === 'table' &&
                                        draggedItem.connId === c.id &&
                                        draggedItem.database === dbName &&
                                        draggedItem.schema !== sName
                                      ) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                      }
                                    }}
                                    onDrop={async (e) => {
                                      if (
                                        draggedItem?.type !== 'table' ||
                                        draggedItem.connId !== c.id ||
                                        draggedItem.database !== dbName ||
                                        draggedItem.schema === sName ||
                                        !draggedItem.table
                                      ) {
                                        return;
                                      }
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const sourceSchema = draggedItem.schema!;
                                      const targetSchema = sName;
                                      const tbl = draggedItem.table;
                                      setDraggedItem(null);

                                      const ok = await confirmDialog({
                                        title: 'Move Table to Another Collection',
                                        message: `Move table "${tbl.name}" from collection "${sourceSchema}" to "${targetSchema}"?`,
                                        confirmLabel: 'Move Table',
                                      });
                                      if (!ok) return;

                                      try {
                                        const keyword =
                                          tbl.type === 'view'
                                            ? 'VIEW'
                                            : tbl.type === 'materialized_view'
                                            ? 'MATERIALIZED VIEW'
                                            : 'TABLE';
                                        const sql = `ALTER ${keyword} "${sourceSchema}"."${tbl.name}" SET SCHEMA "${targetSchema}";`;
                                        const execId = 'move-table-' + Date.now();
                                        await QueryService.ExecuteQuery({
                                          executionId: execId,
                                          connectionId: c.id,
                                          database: dbName,
                                          schema: sourceSchema,
                                          sql,
                                          limit: 10,
                                          offset: 0,
                                        } as any);

                                        const oldKey = `${c.id}:${dbName}:${sourceSchema}`;
                                        removeTreeObject(oldKey, tbl.name);

                                        const [oldObjs, newObjs] = await Promise.all([
                                          SchemaService.GetObjects(c.id, dbName, sourceSchema).catch(() => null),
                                          SchemaService.GetObjects(c.id, dbName, targetSchema).catch(() => null),
                                        ]);
                                        if (oldObjs) setTreeObjects(oldKey, oldObjs as any);
                                        if (newObjs) setTreeObjects(`${c.id}:${dbName}:${targetSchema}`, newObjs as any);

                                        alertSuccess(`Moved table "${tbl.name}" to "${targetSchema}".`, 'Table Moved');
                                      } catch (err: any) {
                                        alertError(err?.message || String(err), 'Failed to Move Table');
                                      }
                                    }}
                                    className={`group/sch flex items-center gap-1.5 px-1.5 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-300 transition-colors ${
                                      isSchemaActive ? 'bg-[#22242c] text-zinc-100 font-medium' : ''
                                    } ${
                                      draggedItem?.type === 'table' &&
                                      draggedItem.connId === c.id &&
                                      draggedItem.database === dbName &&
                                      draggedItem.schema !== sName
                                        ? 'ring-1 ring-cyan-400 bg-cyan-950/40 text-cyan-200'
                                        : ''
                                    }`}
                                  >
                                    {isSExpanded ? (
                                      <ChevronDown className="h-2.5 w-2.5 text-zinc-500 shrink-0" />
                                    ) : (
                                      <ChevronRight className="h-2.5 w-2.5 text-zinc-500 shrink-0" />
                                    )}
                                    <Layers className="h-3 w-3 text-cyan-400 shrink-0" />
                                    <span className="truncate flex-1 text-[11px]">{sName}</span>
                                    <div
                                      onClick={(e) => e.stopPropagation()}
                                      className="opacity-0 group-hover/sch:opacity-100 flex items-center gap-0.5 transition-opacity"
                                    >
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenCreateSchema(c, dbName);
                                        }}
                                        className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-colors"
                                        title={`Create New Collection / Schema in "${dbName}"`}
                                      >
                                        <Layers className="h-2.5 w-2.5 text-cyan-400" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenCreateTable(c, dbName, sName);
                                        }}
                                        className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-colors"
                                        title={`Create New Table in schema "${sName}"`}
                                      >
                                        <Plus className="h-2.5 w-2.5" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Schema Tables & Views */}
                                  {isSExpanded && (
                                    <div className="ml-3 mt-0.5 border-l border-[#272932] pl-2 space-y-0.5">
                                      <div className="text-[10px] text-zinc-500 flex items-center justify-between py-0.5 group/tbl">
                                        <div className="flex items-center gap-1">
                                          <Folder className="h-2.5 w-2.5" />
                                          <span>tables ({sTables.length})</span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenCreateTable(c, dbName, sName);
                                          }}
                                          className="opacity-0 group-hover/tbl:opacity-100 p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-opacity cursor-pointer"
                                          title={`Create New Table in schema "${sName}"`}
                                        >
                                          <Plus className="h-2.5 w-2.5" />
                                        </button>
                                      </div>
                                      {sTables.map((obj) => {
                                        const objDragId = `${c.id}:${dbName}:${sName}:${obj.name}`;
                                        return (
                                          <div
                                            key={obj.name}
                                            draggable={(c.driver === 'postgres' || c.driver === 'mssql') && !c.isReadOnly}
                                            onDragStart={(e) => {
                                              e.stopPropagation();
                                              setDraggedItem({
                                                type: 'table',
                                                id: objDragId,
                                                connId: c.id,
                                                database: dbName,
                                                schema: sName,
                                                table: obj,
                                              });
                                            }}
                                            onDragEnd={() => {
                                              setDraggedItem(null);
                                            }}
                                            onClick={() => {
                                              handleItemMouseLeave();
                                              handleTableClick(c.id, dbName, sName, obj.name);
                                            }}
                                            onContextMenu={(e) => {
                                              handleItemMouseLeave();
                                              openContextMenu(e, 'table', {
                                                connection: c,
                                                database: dbName,
                                                schema: sName,
                                                table: obj,
                                              });
                                            }}
                                            onMouseEnter={(e) =>
                                              handleItemMouseEnter(e, {
                                                kind: 'table',
                                                title: obj.name,
                                                badge: 'TABLE',
                                                subtitle: `${c.name} / ${dbName}.${sName}`,
                                              })
                                            }
                                            onMouseLeave={handleItemMouseLeave}
                                            data-explorer-table={`${c.id}:${dbName}:${sName}:${obj.name}`}
                                            title={obj.name}
                                            className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white transition-opacity ${
                                              draggedItem?.type === 'table' && draggedItem.id === objDragId
                                                ? 'opacity-40'
                                                : ''
                                            } ${
                                              highlightedRevealKey === `${c.id}:${dbName}:${sName}:${obj.name}`
                                                ? 'bg-blue-600/25 text-white ring-1 ring-blue-400/70'
                                                : ''
                                            }`}
                                          >
                                            <Table className="h-3 w-3 shrink-0 text-emerald-400" />
                                            <span className="truncate">{obj.name}</span>
                                          </div>
                                        );
                                      })}

                                      {sViews.length > 0 && (
                                        <>
                                          <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                            <Folder className="h-2.5 w-2.5" />
                                            <span>views ({sViews.length})</span>
                                          </div>
                                          {sViews.map((obj) => {
                                            const objDragId = `${c.id}:${dbName}:${sName}:${obj.name}`;
                                            return (
                                              <div
                                                key={obj.name}
                                                draggable={(c.driver === 'postgres' || c.driver === 'mssql') && !c.isReadOnly}
                                                onDragStart={(e) => {
                                                  e.stopPropagation();
                                                  setDraggedItem({
                                                    type: 'table',
                                                    id: objDragId,
                                                    connId: c.id,
                                                    database: dbName,
                                                    schema: sName,
                                                    table: obj,
                                                  });
                                                }}
                                                onDragEnd={() => {
                                                  setDraggedItem(null);
                                                }}
                                                onClick={() => {
                                                  handleItemMouseLeave();
                                                  handleTableClick(c.id, dbName, sName, obj.name);
                                                }}
                                                onContextMenu={(e) => {
                                                  handleItemMouseLeave();
                                                  openContextMenu(e, 'table', {
                                                    connection: c,
                                                    database: dbName,
                                                    schema: sName,
                                                    table: obj,
                                                  });
                                                }}
                                                onMouseEnter={(e) =>
                                                  handleItemMouseEnter(e, {
                                                    kind: 'view',
                                                    title: obj.name,
                                                    badge: 'VIEW',
                                                    subtitle: `${c.name} / ${dbName}.${sName}`,
                                                  })
                                                }
                                                onMouseLeave={handleItemMouseLeave}
                                                data-explorer-table={`${c.id}:${dbName}:${sName}:${obj.name}`}
                                                title={obj.name}
                                                className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white transition-opacity ${
                                                  draggedItem?.type === 'table' && draggedItem.id === objDragId
                                                    ? 'opacity-40'
                                                    : ''
                                                } ${
                                                  highlightedRevealKey === `${c.id}:${dbName}:${sName}:${obj.name}`
                                                    ? 'bg-blue-600/25 text-white ring-1 ring-blue-400/70'
                                                    : ''
                                                }`}
                                              >
                                                <Eye className="h-3 w-3 shrink-0 text-purple-400" />
                                                <span className="truncate">{obj.name}</span>
                                              </div>
                                            );
                                          })}
                                        </>
                                      )}

                                      {sMatViews.length > 0 && (
                                        <>
                                          <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                            <Folder className="h-2.5 w-2.5" />
                                            <span>materialized views ({sMatViews.length})</span>
                                          </div>
                                          {sMatViews.map((obj) => {
                                            const objDragId = `${c.id}:${dbName}:${sName}:${obj.name}`;
                                            return (
                                              <div
                                                key={obj.name}
                                                draggable={(c.driver === 'postgres' || c.driver === 'mssql') && !c.isReadOnly}
                                                onDragStart={(e) => {
                                                  e.stopPropagation();
                                                  setDraggedItem({
                                                    type: 'table',
                                                    id: objDragId,
                                                    connId: c.id,
                                                    database: dbName,
                                                    schema: sName,
                                                    table: obj,
                                                  });
                                                }}
                                                onDragEnd={() => {
                                                  setDraggedItem(null);
                                                }}
                                                onClick={() => {
                                                  handleItemMouseLeave();
                                                  handleTableClick(c.id, dbName, sName, obj.name);
                                                }}
                                                onContextMenu={(e) => {
                                                  handleItemMouseLeave();
                                                  openContextMenu(e, 'table', {
                                                    connection: c,
                                                    database: dbName,
                                                    schema: sName,
                                                    table: obj,
                                                  });
                                                }}
                                                onMouseEnter={(e) =>
                                                  handleItemMouseEnter(e, {
                                                    kind: 'view',
                                                    title: obj.name,
                                                    badge: 'MAT VIEW',
                                                    subtitle: `${c.name} / ${dbName}.${sName}`,
                                                  })
                                                }
                                                onMouseLeave={handleItemMouseLeave}
                                                data-explorer-table={`${c.id}:${dbName}:${sName}:${obj.name}`}
                                                title={obj.name}
                                                className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white transition-opacity ${
                                                  draggedItem?.type === 'table' && draggedItem.id === objDragId
                                                    ? 'opacity-40'
                                                    : ''
                                                } ${
                                                  highlightedRevealKey === `${c.id}:${dbName}:${sName}:${obj.name}`
                                                    ? 'bg-blue-600/25 text-white ring-1 ring-blue-400/70'
                                                    : ''
                                                }`}
                                              >
                                                <Layers className="h-3 w-3 shrink-0 text-blue-400" />
                                                <span className="truncate">{obj.name}</span>
                                              </div>
                                            );
                                          })}
                                        </>
                                      )}

                                      {sRoutines.length > 0 && (
                                        <>
                                          <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                            <Folder className="h-2.5 w-2.5" />
                                            <span>routines ({sRoutines.length})</span>
                                          </div>
                                          {sRoutines.map((obj) => (
                                            <div
                                              key={obj.name}
                                              onClick={() => {
                                                handleItemMouseLeave();
                                                handleRoutineClick(c, dbName, sName, obj.name, obj.comment);
                                              }}
                                              onContextMenu={(e) => {
                                                handleItemMouseLeave();
                                                openContextMenu(e, 'table', {
                                                  connection: c,
                                                  database: dbName,
                                                  schema: sName,
                                                  table: obj,
                                                });
                                              }}
                                              onMouseEnter={(e) =>
                                                handleItemMouseEnter(e, {
                                                  kind: 'table',
                                                  title: obj.name,
                                                  badge: (obj.comment || '').toUpperCase().startsWith('[FUNCTION]') ? 'FUNCTION' : (obj.comment || '').toUpperCase().startsWith('[PROCEDURE]') ? 'PROCEDURE' : 'ROUTINE',
                                                  subtitle: `${c.name} / ${dbName}.${sName}${obj.comment ? ` • ${obj.comment}` : ''}`,
                                                })
                                              }
                                              onMouseLeave={handleItemMouseLeave}
                                              title={obj.comment ? `${obj.name} ${obj.comment}` : obj.name}
                                              className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                            >
                                              <FileCode className="h-3 w-3 shrink-0 text-amber-400" />
                                              <span className="truncate">{obj.name}</span>
                                            </div>
                                          ))}
                                        </>
                                      )}

                                      {sSequences.length > 0 && (
                                        <>
                                          <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                            <Folder className="h-2.5 w-2.5" />
                                            <span>sequences ({sSequences.length})</span>
                                          </div>
                                          {sSequences.map((obj) => (
                                            <div
                                              key={obj.name}
                                              onClick={() => {
                                                handleItemMouseLeave();
                                                handleSequenceClick(c, dbName, sName, obj.name);
                                              }}
                                              onContextMenu={(e) => {
                                                handleItemMouseLeave();
                                                openContextMenu(e, 'table', {
                                                  connection: c,
                                                  database: dbName,
                                                  schema: sName,
                                                  table: obj,
                                                });
                                              }}
                                              onMouseEnter={(e) =>
                                                handleItemMouseEnter(e, {
                                                  kind: 'table',
                                                  title: obj.name,
                                                  badge: 'SEQUENCE',
                                                  subtitle: `${c.name} / ${dbName}.${sName}`,
                                                })
                                              }
                                              onMouseLeave={handleItemMouseLeave}
                                              title={obj.name}
                                              className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                            >
                                              <Hash className="h-3 w-3 shrink-0 text-indigo-400" />
                                              <span className="truncate">{obj.name}</span>
                                            </div>
                                          ))}
                                        </>
                                      )}

                                      {sTriggers.length > 0 && (
                                        <>
                                          <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                            <Folder className="h-2.5 w-2.5" />
                                            <span>triggers ({sTriggers.length})</span>
                                          </div>
                                          {sTriggers.map((obj) => (
                                            <div
                                              key={obj.name}
                                              onClick={() => {
                                                handleItemMouseLeave();
                                                handleTriggerClick(c, dbName, sName, obj.name);
                                              }}
                                              onContextMenu={(e) => {
                                                handleItemMouseLeave();
                                                openContextMenu(e, 'table', {
                                                  connection: c,
                                                  database: dbName,
                                                  schema: sName,
                                                  table: obj,
                                                });
                                              }}
                                              onMouseEnter={(e) =>
                                                handleItemMouseEnter(e, {
                                                  kind: 'table',
                                                  title: obj.name,
                                                  badge: 'TRIGGER',
                                                  subtitle: `${c.name} / ${dbName}.${sName}${obj.comment ? ` • ${obj.comment}` : ''}${obj.parentTable ? ` on ${obj.parentTable}` : ''}`,
                                                })
                                              }
                                              onMouseLeave={handleItemMouseLeave}
                                              title={obj.parentTable ? `${obj.name} (${obj.comment ? obj.comment + ' ' : ''}on ${obj.parentTable})` : obj.name}
                                              className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                            >
                                              <Zap className="h-3 w-3 shrink-0 text-rose-400" />
                                              <span className="truncate">{obj.name}</span>
                                              {obj.parentTable && (
                                                <span className="ml-auto text-[9px] text-zinc-500 font-mono truncate max-w-[90px]">
                                                  {obj.parentTable}
                                                </span>
                                              )}
                                            </div>
                                          ))}
                                        </>
                                      )}

                                      {sEvents.length > 0 && (
                                        <>
                                          <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                            <Folder className="h-2.5 w-2.5" />
                                            <span>scheduled events ({sEvents.length})</span>
                                          </div>
                                          {sEvents.map((obj) => (
                                            <div
                                              key={obj.name}
                                              onClick={() => {
                                                handleItemMouseLeave();
                                                handleEventClick(c, dbName, obj.name);
                                              }}
                                              onContextMenu={(e) => {
                                                handleItemMouseLeave();
                                                openContextMenu(e, 'table', {
                                                  connection: c,
                                                  database: dbName,
                                                  schema: sName,
                                                  table: obj,
                                                });
                                              }}
                                              onMouseEnter={(e) =>
                                                handleItemMouseEnter(e, {
                                                  kind: 'table',
                                                  title: obj.name,
                                                  badge: 'EVENT',
                                                  subtitle: `${c.name} / ${dbName}.${sName}${obj.comment ? ` • ${obj.comment}` : ''}`,
                                                })
                                              }
                                              onMouseLeave={handleItemMouseLeave}
                                              title={obj.comment ? `${obj.name} (${obj.comment})` : obj.name}
                                              className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                            >
                                              <Clock className="h-3 w-3 shrink-0 text-cyan-400" />
                                              <span className="truncate">{obj.name}</span>
                                            </div>
                                          ))}
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          ) : (
                            (() => {
                              const isMysqlFamily = c.driver === 'mysql' || c.driver === 'mariadb';
                              const dbKey = `${c.id}:${dbName}`;
                              const dbGroups = isMysqlFamily ? (tableGroups[dbKey] || []) : [];
                              const dbAssignments = isMysqlFamily ? (tableGroupAssignments[dbKey] || {}) : {};
                              const validGroupIds = new Set(dbGroups.map((g) => g.id));

                              const ungroupedTables = isMysqlFamily
                                ? tables.filter((t) => !dbAssignments[t.name] || !validGroupIds.has(dbAssignments[t.name]))
                                : tables;
                              const ungroupedViews = isMysqlFamily
                                ? views.filter((v) => !dbAssignments[v.name] || !validGroupIds.has(dbAssignments[v.name]))
                                : views;

                              const renderFlatObjectRow = (obj: ObjectSummary, isView: boolean) => {
                                const objDragId = `${c.id}:${dbName}:${obj.name}`;
                                return (
                                  <div
                                    key={obj.name}
                                    draggable={isMysqlFamily}
                                    onDragStart={(e) => {
                                      if (!isMysqlFamily) return;
                                      e.stopPropagation();
                                      setDraggedItem({
                                        type: 'table',
                                        id: objDragId,
                                        connId: c.id,
                                        database: dbName,
                                        schema: targetSchema,
                                        table: obj,
                                      });
                                    }}
                                    onDragEnd={() => {
                                      setDraggedItem(null);
                                      setDropTarget(null);
                                    }}
                                    onClick={() => {
                                      handleItemMouseLeave();
                                      handleTableClick(c.id, dbName, targetSchema, obj.name);
                                    }}
                                    onContextMenu={(e) => {
                                      handleItemMouseLeave();
                                      openContextMenu(e, 'table', {
                                        connection: c,
                                        database: dbName,
                                        schema: targetSchema,
                                        table: obj,
                                      });
                                    }}
                                    onMouseEnter={(e) =>
                                      handleItemMouseEnter(e, {
                                        kind: isView ? 'view' : 'table',
                                        title: obj.name,
                                        badge: isView
                                          ? 'VIEW'
                                          : c.driver === 'redis'
                                          ? (obj.type || 'KEY').toUpperCase()
                                          : 'TABLE',
                                        subtitle: `${c.name} / ${dbName}${obj.comment ? ` • ${obj.comment}` : ''}`,
                                      })
                                    }
                                    onMouseLeave={handleItemMouseLeave}
                                    data-explorer-table={`${c.id}:${dbName}:${targetSchema}:${obj.name}`}
                                    title={obj.comment ? `${obj.name} (${obj.comment})` : obj.name}
                                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white transition-opacity ${
                                      draggedItem?.type === 'table' && draggedItem.id === objDragId
                                        ? 'opacity-40'
                                        : ''
                                    } ${
                                      highlightedRevealKey === `${c.id}:${dbName}:${targetSchema}:${obj.name}`
                                        ? 'bg-blue-600/25 text-white ring-1 ring-blue-400/70'
                                        : ''
                                    }`}
                                  >
                                    {isView ? (
                                      <Eye className="h-3 w-3 shrink-0 text-purple-400" />
                                    ) : c.driver === 'redis' ? (
                                      <Key className="h-3 w-3 shrink-0 text-amber-400" />
                                    ) : (
                                      <Table className="h-3 w-3 shrink-0 text-emerald-400" />
                                    )}
                                    <span className="truncate">{obj.name}</span>
                                    {!isView && c.driver === 'redis' && (
                                      <span className="ml-auto text-[9px] font-mono px-1 rounded bg-[#272932] text-zinc-400 uppercase shrink-0">
                                        {obj.type || 'key'}
                                      </span>
                                    )}
                                    {!isView && c.driver === 'qdrant' && (qdrantAliasesByConn[c.id]?.[obj.name]?.length ?? 0) > 0 && (
                                      <span
                                        className="ml-auto text-[9px] font-mono px-1 rounded bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 shrink-0 truncate max-w-[90px]"
                                        title={`Aliases: ${qdrantAliasesByConn[c.id][obj.name].join(', ')}`}
                                      >
                                        → {qdrantAliasesByConn[c.id][obj.name][0]}
                                        {qdrantAliasesByConn[c.id][obj.name].length > 1
                                          ? ` +${qdrantAliasesByConn[c.id][obj.name].length - 1}`
                                          : ''}
                                      </span>
                                    )}
                                  </div>
                                );
                              };

                              return (
                                <>
                                  {/* Custom Table & View Groups (MySQL / MariaDB) */}
                                  {isMysqlFamily && dbGroups.length > 0 && (
                                    <div className="space-y-0.5 mb-1">
                                      {dbGroups.map((grp) => {
                                        const grpTables = tables.filter((t) => dbAssignments[t.name] === grp.id);
                                        const grpViews = views.filter((v) => dbAssignments[v.name] === grp.id);
                                        const totalInGrp = grpTables.length + grpViews.length;
                                        const grpMatches = !filterLower || grp.name.toLowerCase().includes(filterLower);
                                        if (filterLower && !grpMatches && totalInGrp === 0) {
                                          return null;
                                        }

                                        const grpNodeKey = `tblgroup:${dbKey}:${grp.id}`;
                                        const isGrpExpanded =
                                          expandedNodes[grpNodeKey] !== false || (!!filterLower && totalInGrp > 0);
                                        const isTableDropOver =
                                          dropTarget?.type === 'table-group-into' &&
                                          dropTarget.id === grp.id &&
                                          dropTarget.connId === c.id &&
                                          dropTarget.database === dbName;
                                        const isSortBefore =
                                          dropTarget?.type === 'table-group-sort' &&
                                          dropTarget.id === grp.id &&
                                          dropTarget.position === 'before';
                                        const isSortAfter =
                                          dropTarget?.type === 'table-group-sort' &&
                                          dropTarget.id === grp.id &&
                                          dropTarget.position === 'after';

                                        return (
                                          <div key={grp.id} className="mb-0.5">
                                            <div
                                              draggable
                                              onDragStart={(e) => {
                                                e.stopPropagation();
                                                setDraggedItem({
                                                  type: 'table-group',
                                                  id: grp.id,
                                                  connId: c.id,
                                                  database: dbName,
                                                  tableGroup: grp,
                                                });
                                              }}
                                              onDragEnd={() => {
                                                setDraggedItem(null);
                                                setDropTarget(null);
                                              }}
                                              onDragOver={(e) => {
                                                if (!draggedItem || draggedItem.connId !== c.id || draggedItem.database !== dbName) {
                                                  return;
                                                }
                                                if (draggedItem.type === 'table') {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  e.dataTransfer.dropEffect = 'move';
                                                  setDropTarget({
                                                    type: 'table-group-into',
                                                    id: grp.id,
                                                    connId: c.id,
                                                    database: dbName,
                                                  });
                                                } else if (draggedItem.type === 'table-group' && draggedItem.id !== grp.id) {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  e.dataTransfer.dropEffect = 'move';
                                                  const rect = e.currentTarget.getBoundingClientRect();
                                                  const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                                                  setDropTarget({
                                                    type: 'table-group-sort',
                                                    id: grp.id,
                                                    position: pos,
                                                    connId: c.id,
                                                    database: dbName,
                                                  });
                                                }
                                              }}
                                              onDragLeave={(e) => {
                                                if (e.currentTarget === e.target) {
                                                  setDropTarget(null);
                                                }
                                              }}
                                              onDrop={(e) => {
                                                if (!draggedItem || draggedItem.connId !== c.id || draggedItem.database !== dbName) {
                                                  return;
                                                }
                                                e.preventDefault();
                                                e.stopPropagation();
                                                if (draggedItem.type === 'table' && draggedItem.table) {
                                                  assignTableToGroup(c.id, dbName, draggedItem.table.name, grp.id);
                                                } else if (draggedItem.type === 'table-group' && draggedItem.id !== grp.id) {
                                                  const rect = e.currentTarget.getBoundingClientRect();
                                                  const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                                                  reorderTableGroup(c.id, dbName, draggedItem.id, grp.id, pos);
                                                }
                                                setDraggedItem(null);
                                                setDropTarget(null);
                                              }}
                                              onClick={() => {
                                                handleItemMouseLeave();
                                                toggleNode(grpNodeKey);
                                              }}
                                              onContextMenu={(e) => {
                                                handleItemMouseLeave();
                                                openContextMenu(e, 'table-group', {
                                                  connection: c,
                                                  database: dbName,
                                                  tableGroup: grp,
                                                });
                                              }}
                                              className={`group/tgrp flex items-center gap-1.5 px-1.5 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-300 transition-colors ${
                                                isTableDropOver ? 'ring-1 ring-blue-400 bg-blue-950/40 text-blue-200' : ''
                                              } ${isSortBefore ? 'border-t-2 border-blue-400' : ''} ${
                                                isSortAfter ? 'border-b-2 border-blue-400' : ''
                                              } ${
                                                draggedItem?.type === 'table-group' && draggedItem.id === grp.id
                                                  ? 'opacity-40'
                                                  : ''
                                              }`}
                                            >
                                              {isGrpExpanded ? (
                                                <ChevronDown className="h-2.5 w-2.5 text-zinc-500 shrink-0" />
                                              ) : (
                                                <ChevronRight className="h-2.5 w-2.5 text-zinc-500 shrink-0" />
                                              )}
                                              {isGrpExpanded ? (
                                                <FolderOpen
                                                  className="h-3 w-3 shrink-0"
                                                  style={{ color: grp.color || '#3b82f6' }}
                                                />
                                              ) : (
                                                <Folder
                                                  className="h-3 w-3 shrink-0"
                                                  style={{ color: grp.color || '#3b82f6' }}
                                                />
                                              )}
                                              <span className="truncate flex-1 text-[11px] font-medium">
                                                {grp.name}
                                              </span>
                                              <span className="text-[9px] text-zinc-500 font-mono shrink-0">
                                                {totalInGrp}
                                              </span>
                                              <div
                                                onClick={(e) => e.stopPropagation()}
                                                className="opacity-0 group-hover/tgrp:opacity-100 flex items-center gap-0.5 transition-opacity"
                                              >
                                                <button
                                                  type="button"
                                                  onClick={(e) => handleOpenRenameTableGroup(c.id, dbName, grp, e)}
                                                  className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-colors cursor-pointer"
                                                  title={`Rename group "${grp.name}"`}
                                                >
                                                  <Pencil className="h-2.5 w-2.5" />
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={(e) => handleDeleteTableGroup(c.id, dbName, grp, e)}
                                                  className="p-0.5 rounded text-zinc-400 hover:text-rose-400 hover:bg-[#2c303c] transition-colors cursor-pointer"
                                                  title={`Delete group "${grp.name}"`}
                                                >
                                                  <Trash2 className="h-2.5 w-2.5" />
                                                </button>
                                              </div>
                                            </div>

                                            {isGrpExpanded && (
                                              <div className="ml-3 mt-0.5 border-l border-[#272932] pl-2 space-y-0.5">
                                                {totalInGrp === 0 ? (
                                                  <div className="px-2 py-0.5 text-[10px] italic text-zinc-600">
                                                    Drag tables/views here
                                                  </div>
                                                ) : (
                                                  <>
                                                    {grpTables.map((obj) => renderFlatObjectRow(obj, false))}
                                                    {grpViews.map((obj) => renderFlatObjectRow(obj, true))}
                                                  </>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {/* Ungrouped Tables Header (also drop target to ungroup) */}
                                  <div
                                    onDragOver={(e) => {
                                      if (
                                        isMysqlFamily &&
                                        draggedItem?.type === 'table' &&
                                        draggedItem.connId === c.id &&
                                        draggedItem.database === dbName &&
                                        draggedItem.table &&
                                        dbAssignments[draggedItem.table.name]
                                      ) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        e.dataTransfer.dropEffect = 'move';
                                        setDropTarget({
                                          type: 'table-ungrouped',
                                          id: dbKey,
                                          connId: c.id,
                                          database: dbName,
                                        });
                                      }
                                    }}
                                    onDragLeave={(e) => {
                                      if (e.currentTarget === e.target && dropTarget?.type === 'table-ungrouped') {
                                        setDropTarget(null);
                                      }
                                    }}
                                    onDrop={(e) => {
                                      if (
                                        isMysqlFamily &&
                                        draggedItem?.type === 'table' &&
                                        draggedItem.connId === c.id &&
                                        draggedItem.database === dbName &&
                                        draggedItem.table
                                      ) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        assignTableToGroup(c.id, dbName, draggedItem.table.name, null);
                                        setDraggedItem(null);
                                        setDropTarget(null);
                                      }
                                    }}
                                    className={`text-[10px] text-zinc-500 flex items-center justify-between py-0.5 rounded group/tbl ${
                                      dropTarget?.type === 'table-ungrouped' && dropTarget.id === dbKey
                                        ? 'ring-1 ring-amber-400 bg-amber-950/30 text-amber-200 px-1'
                                        : ''
                                    }`}
                                  >
                                    <div className="flex items-center gap-1">
                                      <Folder className="h-2.5 w-2.5" />
                                      <span>
                                        {c.driver?.toLowerCase() === 'redis'
                                          ? `keys (${ungroupedTables.length})`
                                          : c.driver === 'mongodb' || c.driver === 'qdrant'
                                          ? `collections (${ungroupedTables.length})`
                                          : c.driver === 'elasticsearch'
                                          ? `indices (${ungroupedTables.length})`
                                          : isMysqlFamily && dbGroups.length > 0
                                          ? `ungrouped tables (${ungroupedTables.length})`
                                          : `tables (${ungroupedTables.length})`}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-0.5">
                                      {isMysqlFamily && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenCreateTableGroup(c.id, dbName);
                                          }}
                                          className="opacity-0 group-hover/tbl:opacity-100 p-0.5 rounded text-zinc-400 hover:text-amber-300 hover:bg-[#2c303c] transition-opacity cursor-pointer"
                                          title={`New Table Group in "${dbName}"`}
                                        >
                                          <FolderPlus className="h-2.5 w-2.5" />
                                        </button>
                                      )}
                                      {c.driver === 'redis' || c.driver === 'qdrant' || c.driver === 'elasticsearch' ? (
                                        <div className="flex items-center gap-0.5">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleRefreshDatabase(c.id, dbName);
                                            }}
                                            className="opacity-0 group-hover/tbl:opacity-100 p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-opacity cursor-pointer"
                                            title={`Refresh ${c.driver === 'redis' ? 'keys' : c.driver === 'qdrant' ? 'collections' : 'indices'} in "${dbName}"`}
                                          >
                                            <RefreshCw className="h-2.5 w-2.5" />
                                          </button>
                                          {c.driver === 'qdrant' && (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleOpenCreateTable(c, dbName, targetSchema);
                                              }}
                                              className="opacity-0 group-hover/tbl:opacity-100 p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-opacity cursor-pointer"
                                              title={`Create New Collection in "${dbName}"`}
                                            >
                                              <Plus className="h-2.5 w-2.5" />
                                            </button>
                                          )}
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenCreateTable(c, dbName, targetSchema);
                                          }}
                                          className="opacity-0 group-hover/tbl:opacity-100 p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-opacity cursor-pointer"
                                          title={
                                c.driver === 'mongodb'
                                  ? `Create New Collection in "${dbName}"`
                                  : `Create New Table in "${dbName}"`
                              }
                                        >
                                          <Plus className="h-2.5 w-2.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  {ungroupedTables.map((obj) => renderFlatObjectRow(obj, false))}

                                  {ungroupedViews.length > 0 && (
                                    <>
                                      <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                        <Folder className="h-2.5 w-2.5" />
                                        <span>
                                          {isMysqlFamily && dbGroups.length > 0
                                            ? `ungrouped views (${ungroupedViews.length})`
                                            : `views (${ungroupedViews.length})`}
                                        </span>
                                      </div>
                                      {ungroupedViews.map((obj) => renderFlatObjectRow(obj, true))}
                                    </>
                                  )}

                              {matViews.length > 0 && (
                                <>
                                  <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                    <Folder className="h-2.5 w-2.5" />
                                    <span>materialized views ({matViews.length})</span>
                                  </div>
                                  {matViews.map((obj) => (
                                    <div
                                      key={obj.name}
                                      onClick={() => {
                                        handleItemMouseLeave();
                                        handleTableClick(c.id, dbName, targetSchema, obj.name);
                                      }}
                                      onContextMenu={(e) => {
                                        handleItemMouseLeave();
                                        openContextMenu(e, 'table', {
                                          connection: c,
                                          database: dbName,
                                          schema: targetSchema,
                                          table: obj,
                                        });
                                      }}
                                      onMouseEnter={(e) =>
                                        handleItemMouseEnter(e, {
                                          kind: 'view',
                                          title: obj.name,
                                          badge: 'MAT VIEW',
                                          subtitle: `${c.name} / ${dbName}`,
                                        })
                                      }
                                      onMouseLeave={handleItemMouseLeave}
                                      title={obj.name}
                                      className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                    >
                                      <Layers className="h-3 w-3 shrink-0 text-blue-400" />
                                      <span className="truncate">{obj.name}</span>
                                    </div>
                                  ))}
                                </>
                              )}

                              {routines.length > 0 && (
                                <>
                                  <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                    <Folder className="h-2.5 w-2.5" />
                                    <span>routines ({routines.length})</span>
                                  </div>
                                  {routines.map((obj) => (
                                    <div
                                      key={obj.name}
                                      onClick={() => {
                                        handleItemMouseLeave();
                                        handleRoutineClick(c, dbName, targetSchema, obj.name, obj.comment);
                                      }}
                                      onContextMenu={(e) => {
                                        handleItemMouseLeave();
                                        openContextMenu(e, 'table', {
                                          connection: c,
                                          database: dbName,
                                          schema: targetSchema,
                                          table: obj,
                                        });
                                      }}
                                      onMouseEnter={(e) =>
                                        handleItemMouseEnter(e, {
                                          kind: 'table',
                                          title: obj.name,
                                          badge: (obj.comment || '').toUpperCase().startsWith('[FUNCTION]') ? 'FUNCTION' : (obj.comment || '').toUpperCase().startsWith('[PROCEDURE]') ? 'PROCEDURE' : 'ROUTINE',
                                          subtitle: `${c.name} / ${dbName}${obj.comment ? ` • ${obj.comment}` : ''}`,
                                        })
                                      }
                                      onMouseLeave={handleItemMouseLeave}
                                      title={obj.comment ? `${obj.name} ${obj.comment}` : obj.name}
                                      className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                    >
                                      <FileCode className="h-3 w-3 shrink-0 text-amber-400" />
                                      <span className="truncate">{obj.name}</span>
                                    </div>
                                  ))}
                                </>
                              )}

                              {sequences.length > 0 && (
                                <>
                                  <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                    <Folder className="h-2.5 w-2.5" />
                                    <span>sequences ({sequences.length})</span>
                                  </div>
                                  {sequences.map((obj) => (
                                    <div
                                      key={obj.name}
                                      onClick={() => {
                                        handleItemMouseLeave();
                                        handleSequenceClick(c, dbName, targetSchema, obj.name);
                                      }}
                                      onContextMenu={(e) => {
                                        handleItemMouseLeave();
                                        openContextMenu(e, 'table', {
                                          connection: c,
                                          database: dbName,
                                          schema: targetSchema,
                                          table: obj,
                                        });
                                      }}
                                      onMouseEnter={(e) =>
                                        handleItemMouseEnter(e, {
                                          kind: 'table',
                                          title: obj.name,
                                          badge: 'SEQUENCE',
                                          subtitle: `${c.name} / ${dbName}`,
                                        })
                                      }
                                      onMouseLeave={handleItemMouseLeave}
                                      title={obj.name}
                                      className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                    >
                                      <Hash className="h-3 w-3 shrink-0 text-indigo-400" />
                                      <span className="truncate">{obj.name}</span>
                                    </div>
                                  ))}
                                </>
                              )}

                              {triggers.length > 0 && (
                                <>
                                  <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                    <Folder className="h-2.5 w-2.5" />
                                    <span>triggers ({triggers.length})</span>
                                  </div>
                                  {triggers.map((obj) => (
                                    <div
                                      key={obj.name}
                                      onClick={() => {
                                        handleItemMouseLeave();
                                        handleTriggerClick(c, dbName, targetSchema, obj.name);
                                      }}
                                      onContextMenu={(e) => {
                                        handleItemMouseLeave();
                                        openContextMenu(e, 'table', {
                                          connection: c,
                                          database: dbName,
                                          schema: targetSchema,
                                          table: obj,
                                        });
                                      }}
                                      onMouseEnter={(e) =>
                                        handleItemMouseEnter(e, {
                                          kind: 'table',
                                          title: obj.name,
                                          badge: 'TRIGGER',
                                          subtitle: `${c.name} / ${dbName}${obj.comment ? ` • ${obj.comment}` : ''}${obj.parentTable ? ` on ${obj.parentTable}` : ''}`,
                                        })
                                      }
                                      onMouseLeave={handleItemMouseLeave}
                                      title={obj.parentTable ? `${obj.name} (${obj.comment ? obj.comment + ' ' : ''}on ${obj.parentTable})` : obj.name}
                                      className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                    >
                                      <Zap className="h-3 w-3 shrink-0 text-rose-400" />
                                      <span className="truncate">{obj.name}</span>
                                      {obj.parentTable && (
                                        <span className="ml-auto text-[9px] text-zinc-500 font-mono truncate max-w-[90px]">
                                          {obj.parentTable}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </>
                              )}

                              {events.length > 0 && (
                                <>
                                  <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                    <Folder className="h-2.5 w-2.5" />
                                    <span>scheduled events ({events.length})</span>
                                  </div>
                                  {events.map((obj) => (
                                    <div
                                      key={obj.name}
                                      onClick={() => {
                                        handleItemMouseLeave();
                                        handleEventClick(c, dbName, obj.name);
                                      }}
                                      onContextMenu={(e) => {
                                        handleItemMouseLeave();
                                        openContextMenu(e, 'table', {
                                          connection: c,
                                          database: dbName,
                                          schema: targetSchema,
                                          table: obj,
                                        });
                                      }}
                                      onMouseEnter={(e) =>
                                        handleItemMouseEnter(e, {
                                          kind: 'table',
                                          title: obj.name,
                                          badge: 'EVENT',
                                          subtitle: `${c.name} / ${dbName}${obj.comment ? ` • ${obj.comment}` : ''}`,
                                        })
                                      }
                                      onMouseLeave={handleItemMouseLeave}
                                      title={obj.comment ? `${obj.name} (${obj.comment})` : obj.name}
                                      className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                    >
                                      <Clock className="h-3 w-3 shrink-0 text-cyan-400" />
                                      <span className="truncate">{obj.name}</span>
                                    </div>
                                  ))}
                                </>
                              )}
                                </>
                              );
                            })()
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )
            )}
          </div>
        )}
      </div>
    );
  };

  const validFolderIds = new Set(folders.map((f) => f.id));
  const ungroupedConnections = connections.filter((c) => {
    const fId = connectionFolders[c.id];
    return !fId || !validFolderIds.has(fId);
  });

  return (
    <div
      onContextMenu={(e) => {
        handleItemMouseLeave();
        openContextMenu(e, 'empty', {});
      }}
      className="flex h-full flex-col bg-[#191a20] text-xs relative select-none"
    >
      {/* Header */}
      <div className="flex h-10 items-center justify-between border-b border-[#272932] px-3">
        <span className="font-semibold uppercase tracking-wider text-[11px] text-zinc-400">
          Database Explorer
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleNewConnectionInFolder(null)}
            className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
            title="New Connection"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleOpenCreateFolder(null)}
            className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
            title="New Folder / Group"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={loadConnections}
            className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
            title="Refresh All"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <Popover content="Import & Export Config / Settings" side="bottom" align="center">
            <button
              onClick={() => useSettingsStore.getState().openSettings('backup')}
              className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
            >
              <ArrowDownUp className="h-3.5 w-3.5" />
            </button>
          </Popover>
          {onCollapse && (
            <Popover
              content="Close Explorer"
              shortcut={isMac ? '⌘B' : 'Ctrl+B'}
              side="bottom"
              align="end"
            >
              <button
                onClick={onCollapse}
                className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </Popover>
          )}
        </div>
      </div>

      {/* Speed Search */}
      <div className="p-2 border-b border-[#272932]">
        <input
          type="text"
          placeholder="Filter tree... (Speed Search)"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-full rounded bg-[#121317] px-2 py-1 text-[11px] text-zinc-200 border border-[#272932] focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Connection & Table Tree */}
      <div
        onScroll={handleItemMouseLeave}
        onDragOver={(e) => {
          if (draggedItem?.type === 'connection') {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDropTarget({ type: 'root-ungrouped', id: 'root' });
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target && dropTarget?.type === 'root-ungrouped') {
            setDropTarget(null);
          }
        }}
        onDrop={(e) => {
          if (draggedItem?.type === 'connection') {
            e.preventDefault();
            moveConnectionToFolder(draggedItem.id, null);
            setDraggedItem(null);
            setDropTarget(null);
          }
        }}
        className="flex-1 overflow-auto p-2"
      >
        {connections.length === 0 && folders.length === 0 ? (
          <div className="py-8 text-center text-zinc-500">
            <p>No connections configured</p>
            <div className="flex items-center justify-center gap-3 mt-2">
              <button
                onClick={() => handleNewConnectionInFolder(null)}
                className="text-blue-400 hover:underline cursor-pointer"
              >
                Add Connection
              </button>
              <span>•</span>
              <button
                onClick={() => handleOpenCreateFolder(null)}
                className="text-zinc-400 hover:text-zinc-200 hover:underline cursor-pointer"
              >
                New Folder
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Folder Groups */}
            {folders.map((folder) => {
              const folderKey = `folder:${folder.id}`;
              const isFolderExpanded = expandedNodes[folderKey] !== false;
              const folderConns = connections.filter((c) => connectionFolders[c.id] === folder.id);
              const isDropIntoFolder =
                dropTarget?.type === 'folder-into' && dropTarget.id === folder.id;
              const isFolderSortBefore =
                dropTarget?.type === 'folder-sort' &&
                dropTarget.id === folder.id &&
                dropTarget.position === 'before';
              const isFolderSortAfter =
                dropTarget?.type === 'folder-sort' &&
                dropTarget.id === folder.id &&
                dropTarget.position === 'after';
              const isFolderDragged =
                draggedItem?.type === 'folder' && draggedItem.id === folder.id;

              return (
                <div
                  key={folder.id}
                  className={`mb-1.5 relative transition-opacity ${
                    isFolderDragged ? 'opacity-40' : ''
                  }`}
                >
                  {isFolderSortBefore && (
                    <div className="absolute -top-0.5 left-1 right-1 h-0.5 bg-blue-500 rounded-full z-20 pointer-events-none" />
                  )}

                  {/* Folder Header Row */}
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      handleItemMouseLeave();
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', `folder:${folder.id}`);
                      setDraggedItem({ type: 'folder', id: folder.id });
                    }}
                    onDragEnd={() => {
                      setDraggedItem(null);
                      setDropTarget(null);
                    }}
                    onDragOver={(e) => {
                      if (!draggedItem) return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'move';
                      if (draggedItem.type === 'connection') {
                        setDropTarget({ type: 'folder-into', id: folder.id });
                      } else if (draggedItem.type === 'folder' && draggedItem.id !== folder.id) {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const pos: 'before' | 'after' =
                          e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                        setDropTarget({ type: 'folder-sort', id: folder.id, position: pos });
                      }
                    }}
                    onDragLeave={(e) => {
                      e.stopPropagation();
                      if (
                        (dropTarget?.type === 'folder-into' || dropTarget?.type === 'folder-sort') &&
                        dropTarget.id === folder.id
                      ) {
                        setDropTarget(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (draggedItem?.type === 'connection') {
                        moveConnectionToFolder(draggedItem.id, folder.id);
                      } else if (
                        draggedItem?.type === 'folder' &&
                        draggedItem.id !== folder.id
                      ) {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const pos: 'before' | 'after' =
                          e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                        reorderFolder(draggedItem.id, folder.id, pos);
                      }
                      setDraggedItem(null);
                      setDropTarget(null);
                    }}
                    onClick={() => {
                      handleItemMouseLeave();
                      setNodeExpanded(folderKey, !isFolderExpanded);
                    }}
                    onContextMenu={(e) => {
                      handleItemMouseLeave();
                      openContextMenu(e, 'folder', { folder });
                    }}
                    onMouseEnter={(e) =>
                      handleItemMouseEnter(e, {
                        kind: 'folder',
                        title: folder.name,
                        badge: 'FOLDER',
                        subtitle: `${folderConns.length} connection(s) • Drag connections here`,
                        colorTag: folder.color || '#3b82f6',
                      })
                    }
                    onMouseLeave={handleItemMouseLeave}
                    title={`${folder.name} (${folderConns.length} connections)`}
                    className={`group/folder flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors ${
                      isDropIntoFolder
                        ? 'bg-blue-600/25 ring-1 ring-blue-500 text-white'
                        : 'hover:bg-[#22242c] text-zinc-200 font-medium'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {isFolderExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                      )}
                      {isFolderExpanded ? (
                        <FolderOpen
                          className="h-3.5 w-3.5 shrink-0"
                          style={{ color: folder.color || '#3b82f6' }}
                        />
                      ) : (
                        <Folder
                          className="h-3.5 w-3.5 shrink-0"
                          style={{ color: folder.color || '#3b82f6' }}
                        />
                      )}
                      <span className="truncate">{folder.name}</span>
                      <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                        ({folderConns.length})
                      </span>
                    </div>

                    {/* Hover actions on folder */}
                    <div
                      onMouseEnter={(e) => {
                        e.stopPropagation();
                        handleItemMouseLeave();
                      }}
                      className="flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNewConnectionInFolder(folder.id);
                        }}
                        className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#2d303b]"
                        title={`New Connection in "${folder.name}"`}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleOpenRenameFolder(folder, e)}
                        className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#2d303b]"
                        title="Rename Folder"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteFolder(folder, e)}
                        className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-[#2d303b]"
                        title="Delete Folder"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {isFolderSortAfter && (
                    <div className="absolute -bottom-0.5 left-1 right-1 h-0.5 bg-blue-500 rounded-full z-20 pointer-events-none" />
                  )}

                  {/* Connections inside this Folder */}
                  {isFolderExpanded && (
                    <div
                      onDragOver={(e) => {
                        if (draggedItem?.type === 'connection') {
                          e.preventDefault();
                          e.stopPropagation();
                          setDropTarget({ type: 'folder-into', id: folder.id });
                        }
                      }}
                      onDrop={(e) => {
                        if (draggedItem?.type === 'connection') {
                          e.preventDefault();
                          e.stopPropagation();
                          moveConnectionToFolder(draggedItem.id, folder.id);
                          setDraggedItem(null);
                          setDropTarget(null);
                        }
                      }}
                      className="ml-3.5 mt-0.5 border-l border-[#272932] pl-1.5 space-y-0.5"
                    >
                      {folderConns.length === 0 ? (
                        <div className="px-2 py-1 text-[10px] text-zinc-500 italic">
                          Empty folder (drag connection here)
                        </div>
                      ) : (
                        folderConns.map((c) => renderConnectionNode(c, folder.id))
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Ungrouped Connections */}
            {ungroupedConnections.map((c) => renderConnectionNode(c, null))}

            {/* Drop zone to move connection out of folder back to root */}
            {draggedItem?.type === 'connection' &&
              connectionFolders[draggedItem.id] && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDropTarget({ type: 'root-ungrouped', id: 'root' });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    moveConnectionToFolder(draggedItem.id, null);
                    setDraggedItem(null);
                    setDropTarget(null);
                  }}
                  className={`mt-2 py-2 px-3 rounded border border-dashed text-center text-[11px] transition-colors ${
                    dropTarget?.type === 'root-ungrouped'
                      ? 'border-blue-500 bg-blue-600/15 text-blue-300 font-medium'
                      : 'border-[#2e313d] text-zinc-500'
                  }`}
                >
                  Drop here to remove from folder (Ungrouped)
                </div>
              )}
          </>
        )}
      </div>

      {/* Floating Hover Tooltip Card for Full Name */}
      {hoveredItem && !contextMenu.isOpen && !draggedItem && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border border-[#3b3e4f] bg-[#16171f]/95 backdrop-blur-md shadow-2xl px-3 py-2 text-xs font-sans min-w-[180px] max-w-[340px] animate-in fade-in zoom-in-95 duration-100"
          style={{ top: hoveredItem.y, left: hoveredItem.x }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5 min-w-0">
              {hoveredItem.kind === 'folder' && (
                <Folder
                  className="h-3.5 w-3.5 shrink-0 mt-0.5"
                  style={{ color: hoveredItem.colorTag || '#3b82f6' }}
                />
              )}
              {hoveredItem.kind === 'connection' && (
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0 mt-1"
                  style={{ backgroundColor: hoveredItem.colorTag || '#71717a' }}
                />
              )}
              {hoveredItem.kind === 'database' && (
                <Database className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
              )}
              {hoveredItem.kind === 'table' && (
                <Table className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
              )}
              {hoveredItem.kind === 'view' && (
                <Eye className="h-3.5 w-3.5 text-purple-400 shrink-0 mt-0.5" />
              )}
              <span className="font-mono font-semibold text-zinc-100 break-all leading-snug text-[12px]">
                {hoveredItem.title}
              </span>
            </div>
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold shrink-0 border ${
                hoveredItem.kind === 'table'
                  ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300'
                  : hoveredItem.kind === 'view'
                  ? 'bg-purple-950/40 border-purple-800/40 text-purple-300'
                  : hoveredItem.kind === 'database' || hoveredItem.kind === 'folder'
                  ? 'bg-blue-950/40 border-blue-800/40 text-blue-300'
                  : 'bg-zinc-800/60 border-zinc-700 text-zinc-300'
              }`}
            >
              {hoveredItem.badge}
            </span>
          </div>
          {hoveredItem.subtitle && (
            <div className="mt-1 pt-1 border-t border-[#272932] text-[10px] font-mono text-zinc-400 break-all">
              {hoveredItem.subtitle}
            </div>
          )}
        </div>
      )}

      {/* Floating JetBrains-style Context Menu */}
      {contextMenu.isOpen && (
        <div
          className="fixed z-50 min-w-[220px] rounded-lg border border-[#2e313d] bg-[#181920]/95 backdrop-blur-md p-1 shadow-2xl text-[12px] text-zinc-300 select-none animate-in fade-in zoom-in-95 duration-100"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Menu Header */}
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-[#272932] mb-1 flex items-center justify-between">
            <span className="truncate">
              {contextMenu.type === 'folder' && `Folder: ${contextMenu.folder?.name}`}
              {contextMenu.type === 'connection' && `Connection: ${contextMenu.connection?.name}`}
              {contextMenu.type === 'database' && `Database: ${contextMenu.database}`}
              {contextMenu.type === 'schema' && `Collection / Schema: ${contextMenu.schema}`}
              {contextMenu.type === 'table' &&
                `${
                  contextMenu.connection?.driver === 'redis'
                    ? `Key (${(contextMenu.table?.type || 'key').toUpperCase()}): ${contextMenu.table?.name}`
                    : contextMenu.table?.type === 'routine'
                    ? 'Routine'
                    : contextMenu.table?.type === 'sequence'
                    ? 'Sequence'
                    : contextMenu.table?.type === 'trigger'
                    ? 'Trigger'
                    : contextMenu.table?.type === 'event'
                    ? 'Scheduled Event'
                    : contextMenu.table?.type === 'materialized_view'
                    ? 'Mat View'
                    : contextMenu.table?.type === 'view'
                    ? 'View'
                    : 'Table'
                }: ${contextMenu.table?.name}`}
              {contextMenu.type === 'empty' && 'Explorer Menu'}
            </span>
            {copiedText && <span className="text-[9px] text-emerald-400 lowercase font-normal">copied!</span>}
          </div>

          {/* Folder Menu Items */}
          {contextMenu.type === 'folder' && contextMenu.folder && (
            <>
              <button
                type="button"
                onClick={() => {
                  const f = contextMenu.folder!;
                  closeContextMenu();
                  handleNewConnectionInFolder(f.id);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
              >
                <Plus className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                <span>New Connection in Folder...</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleOpenCreateFolder(null);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <FolderPlus className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>New Folder / Group...</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const f = contextMenu.folder!;
                  closeContextMenu();
                  handleOpenRenameFolder(f);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Pencil className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Rename Folder...</span>
              </button>

              <div className="my-1 border-t border-[#272932]" />

              <button
                type="button"
                onClick={() => {
                  const f = contextMenu.folder!;
                  closeContextMenu();
                  handleDeleteFolder(f);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                <span>Delete Folder</span>
              </button>
            </>
          )}

          {/* Connection Menu Items */}
          {contextMenu.type === 'connection' && contextMenu.connection && (
            <>
              {contextMenu.connection.driver === 'sqlite' ? (
                <button
                  type="button"
                  onClick={() => {
                    closeContextMenu();
                    handleOpenCreateTable(contextMenu.connection!, 'main', 'main');
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                >
                  <Plus className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                  <span>New Table...</span>
                </button>
              ) : contextMenu.connection.driver === 'qdrant' ? (
                !contextMenu.connection.isReadOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleOpenCreateTable(contextMenu.connection!, 'default', 'default');
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                  >
                    <Plus className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                    <span>New Collection...</span>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    closeContextMenu();
                    handleOpenCreateDatabase(contextMenu.connection!);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                >
                  <Plus className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                  <span>New Database...</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleNewConsole(contextMenu.connection!.id, contextMenu.connection!.databaseName);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Terminal className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>New Query Console</span>
              </button>

              {contextMenu.connection.driver !== 'qdrant' && contextMenu.connection.driver !== 'redis' && (
                <button
                  type="button"
                  onClick={() => {
                    closeContextMenu();
                    handleOpenERDiagram(
                      contextMenu.connection!.id,
                      contextMenu.database!,
                      contextMenu.schema || contextMenu.database!
                    );
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                >
                  <Layers className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                  <span>Open ER Diagram...</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleEditConnection(contextMenu.connection!.id);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Pencil className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Edit Connection...</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleRefreshConnection(contextMenu.connection!.id);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <RefreshCw className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Refresh Connection</span>
              </button>

              {contextMenu.connection.driver !== 'sqlite' && contextMenu.connection.driver !== 'qdrant' && (
                <button
                  type="button"
                  onClick={() => {
                    const conn = contextMenu.connection!;
                    closeContextMenu();
                    handleOpenUsersTab(conn);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-amber-600 hover:text-white text-amber-300 transition-colors text-left cursor-pointer group"
                >
                  <User className="h-3.5 w-3.5 text-amber-400 group-hover:text-white" />
                  <span>Manage Users & Permissions...</span>
                </button>
              )}

              {contextMenu.connection.driver !== 'sqlite' && contextMenu.connection.driver !== 'qdrant' && (
                <button
                  type="button"
                  onClick={() => {
                    const conn = contextMenu.connection!;
                    closeContextMenu();
                    handleOpenActivityMonitor(conn);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-cyan-600 hover:text-white text-cyan-300 transition-colors text-left cursor-pointer group"
                >
                  <Activity className="h-3.5 w-3.5 text-cyan-400 group-hover:text-white" />
                  <span>Server Activity / Process Monitor...</span>
                </button>
              )}

              {contextMenu.connection.driver !== 'sqlite' && contextMenu.connection.driver !== 'qdrant' && (
                <button
                  type="button"
                  onClick={() => {
                    const conn = contextMenu.connection!;
                    closeContextMenu();
                    handleOpenDatabaseFilter(conn);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                >
                  <Filter className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                  <span>Select Visible Schemas / Databases...</span>
                </button>
              )}

              {/* Move to Folder / Group Section */}
              <div className="my-1 border-t border-[#272932]" />
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Folder / Group
              </div>
              {folders.map((f) => {
                const isCurrent = connectionFolders[contextMenu.connection!.id] === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      const connId = contextMenu.connection!.id;
                      closeContextMenu();
                      moveConnectionToFolder(connId, isCurrent ? null : f.id);
                    }}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Folder
                        className="h-3.5 w-3.5 shrink-0"
                        style={{ color: f.color || '#3b82f6' }}
                      />
                      <span className="truncate">{f.name}</span>
                    </div>
                    {isCurrent && <Check className="h-3.5 w-3.5 text-emerald-400 group-hover:text-white shrink-0" />}
                  </button>
                );
              })}

              {connectionFolders[contextMenu.connection.id] && (
                <button
                  type="button"
                  onClick={() => {
                    const connId = contextMenu.connection!.id;
                    closeContextMenu();
                    moveConnectionToFolder(connId, null);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-400 transition-colors text-left cursor-pointer group"
                >
                  <FolderInput className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                  <span>Remove from Folder (Ungroup)</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const connId = contextMenu.connection!.id;
                  closeContextMenu();
                  handleOpenCreateFolder(connId);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-blue-400 transition-colors text-left cursor-pointer group"
              >
                <FolderPlus className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                <span>New Folder with this Connection...</span>
              </button>

              {contextMenu.connection.driver?.toLowerCase() === 'qdrant' && (
                <button
                  type="button"
                  onClick={() => {
                    const connId = contextMenu.connection!.id;
                    const connName = contextMenu.connection!.name;
                    closeContextMenu();
                    setQdrantInfoModal({
                      isOpen: true,
                      connectionId: connId,
                      connectionName: connName,
                    });
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                >
                  <Activity className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                  <span>Server &amp; Cluster Info...</span>
                </button>
              )}

              {contextMenu.connection.driver?.toLowerCase() === 'redis' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const connId = contextMenu.connection!.id;
                      const connName = contextMenu.connection!.name;
                      closeContextMenu();
                      setRedisInfoModal({
                        isOpen: true,
                        connectionId: connId,
                        connectionName: connName,
                      });
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                  >
                    <Activity className="h-3.5 w-3.5 text-red-400 group-hover:text-white" />
                    <span>Server Info & Stats</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const connId = contextMenu.connection!.id;
                      closeContextMenu();
                      setRedisFlushModal({
                        isOpen: true,
                        connectionId: connId,
                        database: 'db0',
                        mode: 'FLUSHALL',
                      });
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 group-hover:text-white transition-colors text-left cursor-pointer group font-medium"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                    <span>Flush All Databases (FLUSHALL)...</span>
                  </button>
                </>
              )}

              <div className="my-1 border-t border-[#272932]" />

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleDeleteConnection(contextMenu.connection!.id, contextMenu.connection!.name);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                <span>Delete Connection</span>
              </button>
            </>
          )}

          {/* Database Menu Items */}
          {contextMenu.type === 'database' && contextMenu.connection && contextMenu.database && (
            <>
              {contextMenu.connection.driver?.toLowerCase() === 'redis' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      setActiveConnection(contextMenu.connection!.id, contextMenu.database!, contextMenu.database!);
                      openTab({
                        id: `table-${contextMenu.connection!.id}-${contextMenu.database}-keys`,
                        type: 'table_data',
                        title: `${contextMenu.database} (keys)`,
                        connectionId: contextMenu.connection!.id,
                        driver: contextMenu.connection!.driver,
                        database: contextMenu.database!,
                        schema: contextMenu.database!,
                        table: 'keys',
                      });
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                  >
                    <Eye className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                    <span>View Keys</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const connId = contextMenu.connection!.id;
                      const dbName = contextMenu.database!;
                      closeContextMenu();
                      setActiveConnection(connId, dbName, dbName);
                      setRedisAddKeyModal({
                        isOpen: true,
                        connectionId: connId,
                        database: dbName,
                      });
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                  >
                    <Plus className="h-3.5 w-3.5 text-emerald-400 group-hover:text-white" />
                    <span>Add New Key...</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const connId = contextMenu.connection!.id;
                      const connName = contextMenu.connection!.name;
                      closeContextMenu();
                      setRedisInfoModal({
                        isOpen: true,
                        connectionId: connId,
                        connectionName: connName,
                      });
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                  >
                    <Activity className="h-3.5 w-3.5 text-red-400 group-hover:text-white" />
                    <span>Server Info & Stats</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const connId = contextMenu.connection!.id;
                      const dbName = contextMenu.database!;
                      closeContextMenu();
                      setRedisFlushModal({
                        isOpen: true,
                        connectionId: connId,
                        database: dbName,
                        mode: 'FLUSHDB',
                      });
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 group-hover:text-white transition-colors text-left cursor-pointer group font-medium"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                    <span>Flush Database...</span>
                  </button>
                  <div className="my-1 border-t border-[#272932]" />
                </>
              )}

              {contextMenu.connection.driver?.toLowerCase() !== 'redis' && (
                <button
                  type="button"
                  onClick={() => {
                    closeContextMenu();
                    handleOpenCreateTable(
                      contextMenu.connection!,
                      contextMenu.database!,
                      contextMenu.schema || contextMenu.database!
                    );
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                >
                  <Plus className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                  <span>
                    {contextMenu.connection.driver === 'mongodb' || contextMenu.connection.driver === 'qdrant'
                      ? 'New Collection...'
                      : 'New Table...'}
                  </span>
                </button>
              )}

              {contextMenu.connection.driver === 'postgres' && (
                <button
                  type="button"
                  onClick={() => {
                    closeContextMenu();
                    handleOpenCreateSchema(contextMenu.connection!, contextMenu.database!);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                >
                  <Layers className="h-3.5 w-3.5 text-cyan-400 group-hover:text-white" />
                  <span>New Collection / Schema...</span>
                </button>
              )}

              {(contextMenu.connection.driver === 'mysql' || contextMenu.connection.driver === 'mariadb') && (
                <button
                  type="button"
                  onClick={() => {
                    const connId = contextMenu.connection!.id;
                    const db = contextMenu.database!;
                    closeContextMenu();
                    handleOpenCreateTableGroup(connId, db);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                >
                  <FolderPlus className="h-3.5 w-3.5 text-amber-400 group-hover:text-white" />
                  <span>New Table Group...</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleNewConsole(contextMenu.connection!.id, contextMenu.database);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Terminal className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>New Query Console</span>
              </button>

              {contextMenu.connection.driver !== 'redis' && contextMenu.connection.driver !== 'qdrant' && (
                <button
                  type="button"
                  onClick={() => {
                    closeContextMenu();
                    handleOpenERDiagram(
                      contextMenu.connection!.id,
                      contextMenu.database!,
                      contextMenu.schema || contextMenu.database!
                    );
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                >
                  <Layers className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                  <span>Open ER Diagram...</span>
                </button>
              )}

              {contextMenu.connection.driver !== 'redis' && contextMenu.connection.driver !== 'qdrant' && (
                <button
                  type="button"
                  onClick={() => {
                    closeContextMenu();
                    handleEditDatabase(contextMenu.connection!, contextMenu.database!);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                >
                  <Pencil className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                  <span>Edit Database (Alter/Properties)...</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleRefreshDatabase(contextMenu.connection!.id, contextMenu.database!);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <RefreshCw className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>{contextMenu.connection.driver === 'qdrant' ? 'Refresh Collections' : 'Refresh Database'}</span>
              </button>

              <button
                type="button"
                onClick={() => handleCopyText(contextMenu.database!)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Copy Database Name</span>
              </button>

              {contextMenu.connection.driver?.toLowerCase() !== 'redis' && contextMenu.connection.driver !== 'qdrant' && (
                <button
                  type="button"
                  onClick={() => {
                    const conn = contextMenu.connection!;
                    const db = contextMenu.database!;
                    closeContextMenu();
                    openDdlModal({
                      scope: 'database',
                      conn,
                      database: db,
                    });
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                >
                  <Eye className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                  <span>View Database DDL (Schema Only)</span>
                </button>
              )}

              {contextMenu.connection.driver !== 'redis' && contextMenu.connection.driver !== 'qdrant' && (
                <>
                  <div className="my-1 border-t border-[#272932]" />

                  <button
                    type="button"
                    onClick={() => {
                      const conn = contextMenu.connection!;
                      const db = contextMenu.database!;
                      closeContextMenu();
                      handleOpenBackupModal(conn, db);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-emerald-300 transition-colors text-left cursor-pointer group"
                  >
                    <Download className="h-3.5 w-3.5 text-emerald-400 group-hover:text-white" />
                    <span>
                      Backup Database ({contextMenu.connection.driver === 'postgres' ? 'pg_dump' : contextMenu.connection.driver === 'mariadb' ? 'mariadb-dump' : 'mysqldump'})...
                    </span>
                  </button>

                  {!contextMenu.connection.isReadOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        const conn = contextMenu.connection!;
                        const db = contextMenu.database!;
                        closeContextMenu();
                        handleOpenRestoreModal(conn, db);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-amber-300 transition-colors text-left cursor-pointer group"
                    >
                      <Upload className="h-3.5 w-3.5 text-amber-400 group-hover:text-white" />
                      <span>
                        Restore Database ({contextMenu.connection.driver === 'postgres' ? 'psql' : contextMenu.connection.driver === 'mariadb' ? 'mariadb' : 'mysql'})...
                      </span>
                    </button>
                  )}

                  <div className="my-1 border-t border-[#272932]" />

                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleDeleteDatabase(contextMenu.connection!, contextMenu.database!);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                    <span>Drop Database...</span>
                  </button>
                </>
              )}
            </>
          )}

          {/* Schema / Collection Menu Items (PostgreSQL) */}
          {contextMenu.type === 'schema' && contextMenu.connection && contextMenu.database && contextMenu.schema && (
            <>
              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleOpenCreateTable(
                    contextMenu.connection!,
                    contextMenu.database!,
                    contextMenu.schema!
                  );
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
              >
                <Plus className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                <span>New Table in "{contextMenu.schema}"...</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleOpenCreateSchema(contextMenu.connection!, contextMenu.database!);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
              >
                <Layers className="h-3.5 w-3.5 text-cyan-400 group-hover:text-white" />
                <span>New Collection / Schema...</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleNewConsole(contextMenu.connection!.id, contextMenu.database, contextMenu.schema);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Terminal className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>New Query Console</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleOpenERDiagram(
                    contextMenu.connection!.id,
                    contextMenu.database!,
                    contextMenu.schema!
                  );
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Layers className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                <span>Open ER Diagram...</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleRefreshSchema(
                    contextMenu.connection!.id,
                    contextMenu.database!,
                    contextMenu.schema!
                  );
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <RefreshCw className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Refresh Collection / Schema</span>
              </button>

              <button
                type="button"
                onClick={() => handleCopyText(contextMenu.schema!)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Copy Schema Name</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const conn = contextMenu.connection!;
                  const db = contextMenu.database!;
                  const sch = contextMenu.schema!;
                  closeContextMenu();
                  openDdlModal({
                    scope: 'schema',
                    conn,
                    database: db,
                    schema: sch,
                  });
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Eye className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                <span>View Schema DDL (No Data)</span>
              </button>

              {contextMenu.schema !== 'public' && !contextMenu.connection!.isReadOnly && (
                <>
                  <div className="my-1 border-t border-[#272932]" />
                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleDeleteSchema(
                        contextMenu.connection!,
                        contextMenu.database!,
                        contextMenu.schema!
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                    <span>Drop Collection / Schema...</span>
                  </button>
                </>
              )}
            </>
          )}

          {/* Table / Object Menu Items */}
          {contextMenu.type === 'table' && contextMenu.connection && contextMenu.table && (
            <>
              {contextMenu.table.type === 'routine' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleRoutineClick(
                        contextMenu.connection!,
                        contextMenu.database || 'main',
                        contextMenu.schema || 'main',
                        contextMenu.table!.name,
                        contextMenu.table!.comment
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                  >
                    <FileCode className="h-3.5 w-3.5 text-amber-400 group-hover:text-white" />
                    <span>Open Definition & Execute</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyText(contextMenu.table!.name)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>Copy Routine Name</span>
                  </button>

                  <div className="my-1 border-t border-[#272932]" />

                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleDeleteRoutine(
                        contextMenu.connection!,
                        contextMenu.database || 'main',
                        contextMenu.schema || 'main',
                        contextMenu.table!.name,
                        contextMenu.table!.comment
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                    <span>Drop Routine...</span>
                  </button>
                </>
              ) : contextMenu.table.type === 'sequence' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleSequenceClick(
                        contextMenu.connection!,
                        contextMenu.database || 'main',
                        contextMenu.schema || 'main',
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                  >
                    <Hash className="h-3.5 w-3.5 text-indigo-400 group-hover:text-white" />
                    <span>Open Sequence Definition</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyText(contextMenu.table!.name)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>Copy Sequence Name</span>
                  </button>

                  <div className="my-1 border-t border-[#272932]" />

                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleDeleteSequence(
                        contextMenu.connection!,
                        contextMenu.database || 'main',
                        contextMenu.schema || 'main',
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                    <span>Drop Sequence...</span>
                  </button>
                </>
              ) : contextMenu.table.type === 'trigger' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleTriggerClick(
                        contextMenu.connection!,
                        contextMenu.database || 'main',
                        contextMenu.schema || 'main',
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                  >
                    <Zap className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                    <span>Open Trigger Definition</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyText(contextMenu.table!.name)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>Copy Trigger Name</span>
                  </button>

                  <div className="my-1 border-t border-[#272932]" />

                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleDeleteTrigger(
                        contextMenu.connection!,
                        contextMenu.database || 'main',
                        contextMenu.schema || 'main',
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                    <span>Drop Trigger...</span>
                  </button>
                </>
              ) : contextMenu.table.type === 'event' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleEventClick(
                        contextMenu.connection!,
                        contextMenu.database || 'main',
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group font-medium"
                  >
                    <Clock className="h-3.5 w-3.5 text-cyan-400 group-hover:text-white" />
                    <span>Open Event Definition</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyText(contextMenu.table!.name)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>Copy Event Name</span>
                  </button>

                  <div className="my-1 border-t border-[#272932]" />

                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleDeleteEvent(
                        contextMenu.connection!,
                        contextMenu.database || 'main',
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                    <span>Drop Event...</span>
                  </button>
                </>
              ) : contextMenu.connection.driver?.toLowerCase() === 'redis' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleTableClick(
                        contextMenu.connection!.id,
                        contextMenu.database || 'db0',
                        contextMenu.schema || contextMenu.database || 'db0',
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <Key className="h-3.5 w-3.5 text-amber-400 group-hover:text-white" />
                    <span>View / Edit Key</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleNewConsole(
                        contextMenu.connection!.id,
                        contextMenu.database || 'db0',
                        contextMenu.schema || contextMenu.database || 'db0',
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <Terminal className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>New Query Console</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleRefreshTable(
                        contextMenu.connection!.id,
                        contextMenu.database || 'db0',
                        contextMenu.schema || contextMenu.database || 'db0',
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>Refresh Key</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyText(contextMenu.table!.name)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>Copy Key Name</span>
                  </button>

                  <div className="my-1 border-t border-[#272932]" />

                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleDeleteTable(
                        contextMenu.connection!,
                        contextMenu.database || 'db0',
                        contextMenu.schema || contextMenu.database || 'db0',
                        contextMenu.table!
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                    <span>Delete Key...</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleTableClick(
                        contextMenu.connection!.id,
                        contextMenu.database || 'main',
                        contextMenu.schema || 'main',
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <Table className="h-3.5 w-3.5 text-emerald-400 group-hover:text-white" />
                    <span>
                      {contextMenu.connection!.driver === 'qdrant'
                        ? 'Browse Points (Open Collection)'
                        : 'Edit Data (Open Table)'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleEditTableStructure(
                        contextMenu.connection!,
                        contextMenu.database || 'main',
                        contextMenu.schema || 'main',
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <Pencil className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>
                      {contextMenu.connection!.driver === 'qdrant'
                        ? 'Manage Collection & Indexes...'
                        : 'Edit Table Structure...'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleNewConsole(
                        contextMenu.connection!.id,
                        contextMenu.database || 'main',
                        contextMenu.schema || 'main',
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <Terminal className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>New Query Console</span>
                  </button>

                  {contextMenu.connection!.driver !== 'qdrant' && (
                    <button
                      type="button"
                      onClick={() => {
                        closeContextMenu();
                        handleOpenERDiagram(
                          contextMenu.connection!.id,
                          contextMenu.database!,
                          contextMenu.schema || contextMenu.database!
                        );
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                    >
                      <Layers className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                      <span>Open ER Diagram...</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      handleRefreshTable(
                        contextMenu.connection!.id,
                        contextMenu.database || 'main',
                        contextMenu.schema || 'main',
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>
                      {contextMenu.connection!.driver === 'qdrant' ? 'Refresh Collection' : 'Refresh Table'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyText(contextMenu.table!.name)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>
                      {contextMenu.connection!.driver === 'qdrant' ? 'Copy Collection Name' : 'Copy Table Name'}
                    </span>
                  </button>

                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const conn = contextMenu.connection!;
                        const db = contextMenu.database || 'main';
                        const sch = contextMenu.schema || 'main';
                        const tbl = contextMenu.table!.name;
                        closeContextMenu();
                        openDdlModal({
                          scope: 'table',
                          conn,
                          database: db,
                          schema: sch,
                          tableName: tbl,
                        });
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                    >
                      <Eye className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                      <span>
                        {contextMenu.connection!.driver === 'qdrant'
                          ? 'View Collection Config (JSON)'
                          : `View ${contextMenu.table!.type === 'view' ? 'View' : 'Table'} DDL`}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleCopyTableSchema(
                          contextMenu.connection!,
                          contextMenu.database || 'main',
                          contextMenu.schema || 'main',
                          contextMenu.table!.name
                        );
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                    >
                      <FileCode className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                      <span>
                        {contextMenu.connection!.driver === 'qdrant'
                          ? 'Copy Collection Config (JSON)'
                          : 'Copy Table Schema (DDL)'}
                      </span>
                    </button>
                  </>

                  {(contextMenu.connection!.driver === 'postgres' || contextMenu.connection!.driver === 'mysql' || contextMenu.connection!.driver === 'mariadb') && !contextMenu.connection!.isReadOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        closeContextMenu();
                        handleOpenMoveTable(
                          contextMenu.connection!,
                          contextMenu.database || (contextMenu.connection!.driver === 'postgres' ? 'postgres' : 'mysql'),
                          contextMenu.schema || (contextMenu.connection!.driver === 'postgres' ? 'public' : contextMenu.database || 'mysql'),
                          contextMenu.table!
                        );
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5 text-cyan-400 group-hover:text-white" />
                      <span>Move to Another {contextMenu.connection!.driver === 'postgres' ? 'Collection / Schema' : 'Database'}...</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const conn = contextMenu.connection!;
                      const db = contextMenu.database || 'main';
                      const sch = contextMenu.schema || 'main';
                      const tbl = contextMenu.table!.name;
                      closeContextMenu();
                      setExportModal({
                        isOpen: true,
                        connId: conn.id,
                        db,
                        schema: sch,
                        table: tbl,
                      });
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <Download className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>Export Data...</span>
                  </button>

                  {contextMenu.table!.type !== 'view' && !contextMenu.connection!.isReadOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        const conn = contextMenu.connection!;
                        const db = contextMenu.database || 'main';
                        const sch = contextMenu.schema || 'main';
                        const tbl = contextMenu.table!.name;
                        closeContextMenu();
                        setImportModal({
                          isOpen: true,
                          connId: conn.id,
                          db,
                          schema: sch,
                          table: tbl,
                        });
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                    >
                      <Upload className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                      <span>Import Data (CSV)...</span>
                    </button>
                  )}

                  {(contextMenu.connection!.driver === 'mysql' || contextMenu.connection!.driver === 'mariadb') && (contextMenu.table!.type === 'table' || contextMenu.table!.type === 'view' || !contextMenu.table!.type) && (() => {
                    const conn = contextMenu.connection!;
                    const db = contextMenu.database || 'main';
                    const tblName = contextMenu.table!.name;
                    const dbKey = `${conn.id}:${db}`;
                    const dbGroups = tableGroups[dbKey] || [];
                    const currentGroupId = (tableGroupAssignments[dbKey] || {})[tblName];
                    return (
                      <>
                        <div className="my-1 border-t border-[#272932]" />
                        <div className="px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          Table / View Group
                        </div>
                        {dbGroups.map((grp) => {
                          const isAssigned = currentGroupId === grp.id;
                          return (
                            <button
                              key={grp.id}
                              type="button"
                              onClick={() => {
                                closeContextMenu();
                                assignTableToGroup(conn.id, db, tblName, isAssigned ? null : grp.id);
                              }}
                              className="w-full flex items-center justify-between gap-2 px-2.5 py-1 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Folder
                                  className="h-3 w-3 shrink-0"
                                  style={{ color: grp.color || '#3b82f6' }}
                                />
                                <span className="truncate">{grp.name}</span>
                              </div>
                              {isAssigned && <Check className="h-3 w-3 text-emerald-400 group-hover:text-white shrink-0" />}
                            </button>
                          );
                        })}
                        {currentGroupId && (
                          <button
                            type="button"
                            onClick={() => {
                              closeContextMenu();
                              assignTableToGroup(conn.id, db, tblName, null);
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1 rounded-md hover:bg-blue-600 hover:text-white text-zinc-400 transition-colors text-left cursor-pointer group text-xs"
                          >
                            <FolderInput className="h-3 w-3 text-zinc-400 group-hover:text-white" />
                            <span>Remove from Group (Ungroup)</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            closeContextMenu();
                            handleOpenCreateTableGroup(conn.id, db, tblName);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-1 rounded-md hover:bg-blue-600 hover:text-white text-blue-400 transition-colors text-left cursor-pointer group text-xs"
                        >
                          <FolderPlus className="h-3 w-3 text-blue-400 group-hover:text-white" />
                          <span>New Group with this {contextMenu.table!.type === 'view' ? 'View' : 'Table'}...</span>
                        </button>
                      </>
                    );
                  })()}

                  {(contextMenu.connection!.driver === 'mysql' || contextMenu.connection!.driver === 'mariadb') && contextMenu.table!.type !== 'view' && !contextMenu.connection!.isReadOnly && (
                    <>
                      <div className="my-1 border-t border-[#272932]" />
                      <div className="px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Table Maintenance
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const conn = contextMenu.connection!;
                          const db = contextMenu.database || 'main';
                          const tbl = contextMenu.table!.name;
                          closeContextMenu();
                          handleTableMaintenance(conn, db, tbl, 'OPTIMIZE');
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group text-xs"
                      >
                        <Wrench className="h-3 w-3 text-cyan-400 group-hover:text-white" />
                        <span>Optimize Table</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const conn = contextMenu.connection!;
                          const db = contextMenu.database || 'main';
                          const tbl = contextMenu.table!.name;
                          closeContextMenu();
                          handleTableMaintenance(conn, db, tbl, 'ANALYZE');
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group text-xs"
                      >
                        <Activity className="h-3 w-3 text-indigo-400 group-hover:text-white" />
                        <span>Analyze Table</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const conn = contextMenu.connection!;
                          const db = contextMenu.database || 'main';
                          const tbl = contextMenu.table!.name;
                          closeContextMenu();
                          handleTableMaintenance(conn, db, tbl, 'CHECK');
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group text-xs"
                      >
                        <Check className="h-3 w-3 text-emerald-400 group-hover:text-white" />
                        <span>Check Table</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const conn = contextMenu.connection!;
                          const db = contextMenu.database || 'main';
                          const tbl = contextMenu.table!.name;
                          closeContextMenu();
                          handleTableMaintenance(conn, db, tbl, 'REPAIR');
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group text-xs"
                      >
                        <RefreshCw className="h-3 w-3 text-amber-400 group-hover:text-white" />
                        <span>Repair Table</span>
                      </button>
                    </>
                  )}

                  <div className="my-1 border-t border-[#272932]" />

                  {contextMenu.connection!.driver === 'qdrant' && !contextMenu.connection!.isReadOnly && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const connId = contextMenu.connection!.id;
                          const tbl = contextMenu.table!.name;
                          closeContextMenu();
                          setQdrantBatchOpsModal({ isOpen: true, connectionId: connId, collectionName: tbl });
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                      >
                        <Layers className="h-3.5 w-3.5 text-amber-400 group-hover:text-white" />
                        <span>Batch Delete / Update by Filter...</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const connId = contextMenu.connection!.id;
                          const tbl = contextMenu.table!.name;
                          closeContextMenu();
                          setQdrantCloneModal({ isOpen: true, connectionId: connId, collectionName: tbl });
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                      >
                        <Copy className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                        <span>Clone / Reindex Collection...</span>
                      </button>

                      <div className="my-1 border-t border-[#272932]" />
                    </>
                  )}

                  {contextMenu.table!.type !== 'view' && !contextMenu.connection!.isReadOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        const conn = contextMenu.connection!;
                        const db = contextMenu.database || 'main';
                        const sch = contextMenu.schema || 'main';
                        const tbl = contextMenu.table!;
                        closeContextMenu();
                        handleTruncateTable(conn, db, sch, tbl);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
                    >
                      <Eraser className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                      <span>
                        {contextMenu.connection!.driver === 'qdrant'
                          ? 'Clear All Points...'
                          : 'Truncate Table...'}
                      </span>
                    </button>
                  )}

                  {!contextMenu.connection!.isReadOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        closeContextMenu();
                        handleDeleteTable(
                          contextMenu.connection!,
                          contextMenu.database || 'main',
                          contextMenu.schema || 'main',
                          contextMenu.table!
                        );
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                      <span>
                        {contextMenu.connection!.driver === 'qdrant'
                          ? 'Drop Collection...'
                          : `Drop ${contextMenu.table!.type === 'view' ? 'View' : 'Table'}...`}
                      </span>
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {/* Table Group Menu Items (MySQL / MariaDB) */}
          {contextMenu.type === 'table-group' && contextMenu.connection && contextMenu.database && contextMenu.tableGroup && (
            <>
              <button
                type="button"
                onClick={() => {
                  const connId = contextMenu.connection!.id;
                  const db = contextMenu.database!;
                  const grp = contextMenu.tableGroup!;
                  closeContextMenu();
                  handleOpenRenameTableGroup(connId, db, grp);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Pencil className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Rename Group...</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const connId = contextMenu.connection!.id;
                  const db = contextMenu.database!;
                  closeContextMenu();
                  handleOpenCreateTableGroup(connId, db);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <FolderPlus className="h-3.5 w-3.5 text-amber-400 group-hover:text-white" />
                <span>New Table Group...</span>
              </button>

              <div className="my-1 border-t border-[#272932]" />

              <button
                type="button"
                onClick={() => {
                  const connId = contextMenu.connection!.id;
                  const db = contextMenu.database!;
                  const grp = contextMenu.tableGroup!;
                  closeContextMenu();
                  handleDeleteTableGroup(connId, db, grp);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                <span>Delete Group (Ungroup Tables)...</span>
              </button>
            </>
          )}

          {/* Empty Space Menu Items */}
          {contextMenu.type === 'empty' && (
            <>
              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleNewConnectionInFolder(null);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Plus className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>New Connection...</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleOpenCreateFolder(null);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <FolderPlus className="h-3.5 w-3.5 text-amber-400 group-hover:text-white" />
                <span>New Folder / Group...</span>
              </button>

              <div className="my-1 border-t border-[#2d303f]" />

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  loadConnections();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <RefreshCw className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Refresh All Connections</span>
              </button>

              <div className="my-1 border-t border-[#2d303f]" />

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  useSettingsStore.getState().openSettings('backup');
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <ArrowDownUp className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                <span>Import & Export Config...</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Create / Rename Folder Modal */}
      {folderModal.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() =>
            setFolderModal((prev) => ({ ...prev, isOpen: false }))
          }
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[#2b2e3a] bg-[#14151a] p-6 shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col gap-4 text-zinc-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                  style={{
                    backgroundColor: `${folderModal.color}20`,
                    borderColor: `${folderModal.color}50`,
                    color: folderModal.color,
                  }}
                >
                  <Folder className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-zinc-100">
                    {folderModal.mode === 'create'
                      ? 'New Folder / Group'
                      : 'Rename Folder'}
                  </h3>
                  <p className="text-[11px] text-zinc-500">
                    Organize and group your database connections
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setFolderModal((prev) => ({ ...prev, isOpen: false }))
                }
                className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-[#20222a] transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleFolderModalSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Folder Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. Production, Staging, Analytics"
                  value={folderModal.name}
                  onChange={(e) =>
                    setFolderModal((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="w-full rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                  Folder Color
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {FOLDER_COLORS.map((c) => {
                    const isSelected = folderModal.color === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() =>
                          setFolderModal((prev) => ({ ...prev, color: c.value }))
                        }
                        title={c.label}
                        className={`h-7 w-7 rounded-full flex items-center justify-center transition-all cursor-pointer border-2 ${
                          isSelected
                            ? 'scale-110 border-white shadow-md'
                            : 'border-transparent opacity-75 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: c.value }}
                      >
                        {isSelected && <Check className="h-3.5 w-3.5 text-white" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530]">
                <button
                  type="button"
                  onClick={() =>
                    setFolderModal((prev) => ({ ...prev, isOpen: false }))
                  }
                  className="px-3.5 py-1.5 rounded-lg bg-[#20222a] hover:bg-[#2b2d38] border border-[#2d303f] text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!folderModal.name.trim()}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm"
                >
                  {folderModal.mode === 'create' ? 'Create Folder' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Rename Table Group Modal (MySQL / MariaDB) */}
      {tableGroupModal.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() =>
            setTableGroupModal((prev) => ({ ...prev, isOpen: false }))
          }
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[#2b2e3a] bg-[#14151a] p-6 shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col gap-4 text-zinc-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                  style={{
                    backgroundColor: `${tableGroupModal.color}20`,
                    borderColor: `${tableGroupModal.color}50`,
                    color: tableGroupModal.color,
                  }}
                >
                  <Folder className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-zinc-100">
                    {tableGroupModal.mode === 'create'
                      ? 'New Table Group'
                      : 'Rename Table Group'}
                  </h3>
                  <p className="text-[11px] text-zinc-500">
                    Group tables &amp; views in <span className="text-zinc-300 font-mono">{tableGroupModal.database}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setTableGroupModal((prev) => ({ ...prev, isOpen: false }))
                }
                className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-[#20222a] transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleTableGroupModalSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Group Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. Auth, Billing, Master Data, Logs"
                  value={tableGroupModal.name}
                  onChange={(e) =>
                    setTableGroupModal((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="w-full rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                  Group Color
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {FOLDER_COLORS.map((c) => {
                    const isSelected = tableGroupModal.color === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() =>
                          setTableGroupModal((prev) => ({ ...prev, color: c.value }))
                        }
                        title={c.label}
                        className={`h-7 w-7 rounded-full flex items-center justify-center transition-all cursor-pointer border-2 ${
                          isSelected
                            ? 'scale-110 border-white shadow-md'
                            : 'border-transparent opacity-75 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: c.value }}
                      >
                        {isSelected && <Check className="h-3.5 w-3.5 text-white" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530]">
                <button
                  type="button"
                  onClick={() =>
                    setTableGroupModal((prev) => ({ ...prev, isOpen: false }))
                  }
                  className="px-3.5 py-1.5 rounded-lg bg-[#20222a] hover:bg-[#2b2d38] border border-[#2d303f] text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!tableGroupModal.name.trim()}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm"
                >
                  {tableGroupModal.mode === 'create' ? 'Create Group' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Database Dialog */}
      <CreateDatabaseModal
        state={createDbModal}
        setState={setCreateDbModal}
        onSubmit={handleConfirmCreateDatabase}
      />

      {/* Backup / Restore Database Modal */}
      <BackupRestoreModal
        state={backupRestoreModal}
        setState={setBackupRestoreModal}
        getBackupCliTool={getBackupCliTool}
        getRestoreCliTool={getRestoreCliTool}
        onSubmit={handleConfirmBackupRestore}
        onCancelProcessing={handleCancelBackupRestore}
        onBrowseBackupFile={handleBrowseBackupFile}
        onBrowseRestoreFile={handleBrowseRestoreFile}
        onBrowseBackupToolPath={handleBrowseBackupToolPath}
      />

      {/* Create Schema / Collection Modal (PostgreSQL) */}
      <CreateSchemaModal
        state={createSchemaModal}
        setState={setCreateSchemaModal}
        onSubmit={handleConfirmCreateSchema}
      />

      {/* Move Table to Another Schema / Collection Modal (PostgreSQL) */}
      <MoveTableModal
        state={moveTableModal}
        setState={setMoveTableModal}
        onSubmit={handleConfirmMoveTable}
      />

      {/* Schema Filter Popover / Modal (e.g. 3 of 10) */}
      <SchemaFilterModal
        isOpen={schemaFilterModal.isOpen}
        onClose={() => setSchemaFilterModal((prev) => ({ ...prev, isOpen: false }))}
        connection={schemaFilterModal.connection}
        anchorRect={schemaFilterModal.anchorRect}
      />

      {/* Export Table Modal */}
      {exportModal.isOpen && (
        <Suspense fallback={null}>
          <ExportModal
            isOpen={exportModal.isOpen}
            onClose={() => setExportModal((prev) => ({ ...prev, isOpen: false }))}
            connectionId={exportModal.connId}
            database={exportModal.db}
            schema={exportModal.schema}
            table={exportModal.table}
          />
        </Suspense>
      )}

      {/* Import Table Modal */}
      {importModal.isOpen && (
        <Suspense fallback={null}>
          <ImportModal
            isOpen={importModal.isOpen}
            onClose={() => setImportModal((prev) => ({ ...prev, isOpen: false }))}
            connectionId={importModal.connId}
            database={importModal.db}
            schema={importModal.schema}
            table={importModal.table}
          />
        </Suspense>
      )}

      {/* Redis Modals */}
      <RedisAddKeyModal
        isOpen={redisAddKeyModal.isOpen}
        onClose={() => setRedisAddKeyModal((prev) => ({ ...prev, isOpen: false }))}
        connectionId={redisAddKeyModal.connectionId}
        database={redisAddKeyModal.database}
        onSuccess={() => {
          handleRefreshDatabase(redisAddKeyModal.connectionId, redisAddKeyModal.database);
        }}
      />

      <RedisFlushModal
        isOpen={redisFlushModal.isOpen}
        onClose={() => setRedisFlushModal((prev) => ({ ...prev, isOpen: false }))}
        connectionId={redisFlushModal.connectionId}
        database={redisFlushModal.database}
        mode={redisFlushModal.mode}
        onSuccess={() => {
          if (redisFlushModal.mode === 'FLUSHALL') {
            handleRefreshConnection(redisFlushModal.connectionId);
          } else {
            handleRefreshDatabase(redisFlushModal.connectionId, redisFlushModal.database);
          }
        }}
      />

      <RedisInfoModal
        isOpen={redisInfoModal.isOpen}
        onClose={() => setRedisInfoModal((prev) => ({ ...prev, isOpen: false }))}
        connectionId={redisInfoModal.connectionId}
        connectionName={redisInfoModal.connectionName}
      />

      <QdrantInfoModal
        isOpen={qdrantInfoModal.isOpen}
        onClose={() => setQdrantInfoModal((prev) => ({ ...prev, isOpen: false }))}
        connectionId={qdrantInfoModal.connectionId}
        connectionName={qdrantInfoModal.connectionName}
        isReadOnly={Boolean(connections.find((c) => c.id === qdrantInfoModal.connectionId)?.isReadOnly)}
        onAliasesChanged={() => fetchQdrantAliases(qdrantInfoModal.connectionId)}
      />

      <QdrantBatchOpsModal
        isOpen={qdrantBatchOpsModal.isOpen}
        onClose={() => setQdrantBatchOpsModal((prev) => ({ ...prev, isOpen: false }))}
        connectionId={qdrantBatchOpsModal.connectionId}
        collectionName={qdrantBatchOpsModal.collectionName}
        onSuccess={() => handleRefreshConnection(qdrantBatchOpsModal.connectionId)}
      />

      <QdrantCloneModal
        isOpen={qdrantCloneModal.isOpen}
        onClose={() => setQdrantCloneModal((prev) => ({ ...prev, isOpen: false }))}
        connectionId={qdrantCloneModal.connectionId}
        sourceCollection={qdrantCloneModal.collectionName}
        onCloned={() => handleRefreshConnection(qdrantCloneModal.connectionId)}
      />
    </div>
  );
};
