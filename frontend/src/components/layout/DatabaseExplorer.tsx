import React, { useEffect, useState } from 'react';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { ConnectionService, SchemaService, QueryService } from '../../../bindings/dhub/internal/services';
import { Dialogs } from '@wailsio/runtime';
import { Popover } from '../common/Popover';
import { ExportModal } from '../modals/ExportModal';
import { ImportModal } from '../modals/ImportModal';
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
} from 'lucide-react';
import {
  ConnectionConfig,
  ConnectionFolder,
  ObjectSummary,
  resolveConnectionEnv,
  getConnectionEnvInfo,
} from '../../types/domain';
import { alertSuccess, alertError, alertInfo, alertWarning, confirmDialog } from '../../stores/useAlertStore';
import { SchemaFilterModal } from '../modals/SchemaFilterModal';
import { DbDriverIcon } from '../common/DbDriverIcon';

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  type: 'connection' | 'folder' | 'database' | 'schema' | 'table' | 'empty';
  connection?: ConnectionConfig;
  folder?: ConnectionFolder;
  database?: string;
  schema?: string;
  table?: ObjectSummary;
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
  } = useConnectionStore();

  const {
    tabs,
    openTab,
    closeTab,
    closeTabsMatching,
    refreshTab,
    setConnectionDialogOpen,
    openCreateTableModal,
    openEditTableModal,
  } = useWorkbenchStore();

  const [filterText, setFilterText] = useState('');
  const [loadingConnId, setLoadingConnId] = useState<string | null>(null);
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
      database: conn.databaseName || (conn.driver === 'postgres' ? 'postgres' : 'mysql'),
      schema: conn.driver === 'postgres' ? 'public' : 'main',
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

  // Drag & Drop state for sorting and grouping connections/folders or moving tables between schemas
  const [draggedItem, setDraggedItem] = useState<{
    type: 'connection' | 'folder' | 'table';
    id: string;
    connId?: string;
    database?: string;
    schema?: string;
    table?: ObjectSummary;
  } | null>(null);

  const [dropTarget, setDropTarget] = useState<{
    type: 'connection' | 'folder-into' | 'folder-sort' | 'root-ungrouped';
    id: string;
    position?: 'before' | 'after';
    folderId?: string | null;
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

  const handleOpenBackupModal = async (conn: ConnectionConfig, database: string) => {
    let defaultPath = `${database}_backup.sql`;
    try {
      const suggested = await SchemaService.GetDefaultBackupPath(database);
      if (suggested) defaultPath = suggested;
    } catch {}

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
    });

    try {
      const objs = await SchemaService.GetObjects(conn.id, database, '');
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
            DisplayName: 'SQL Backup File (*.sql)',
            Pattern: '*.sql',
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
            DisplayName: 'SQL Backup File (*.sql)',
            Pattern: '*.sql',
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
    setBackupRestoreModal((prev) => ({
      ...prev,
      isOpen: true,
      mode: 'restore',
      connection: conn,
      database,
      filePath: '',
      isProcessing: false,
    }));

    // Prompt user immediately to pick the .sql file to restore
    try {
      const chosen: any = await Dialogs.OpenFile({
        Title: `Select SQL File to Restore into [${database}]`,
        CanChooseFiles: true,
        AllowsMultipleSelection: false,
        Filters: [
          {
            DisplayName: 'SQL Backup File (*.sql)',
            Pattern: '*.sql',
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

    setBackupRestoreModal((prev) => ({ ...prev, isProcessing: true }));

    try {
      if (mode === 'backup') {
        const backupOpts = {
          mode: backupRestoreModal.dumpMode,
          tableSelection: backupRestoreModal.tableSelection,
          tables: backupRestoreModal.selectedTables,
          includeRoutines: backupRestoreModal.includeRoutines,
          includeTriggers: backupRestoreModal.includeTriggers,
          includeEvents: backupRestoreModal.includeEvents,
          singleTransaction: backupRestoreModal.singleTransaction,
        };
        const msg = await SchemaService.BackupDatabase(
          connection.id,
          database,
          cleanPath,
          JSON.stringify(backupOpts)
        );
        setBackupRestoreModal((prev) => ({ ...prev, isOpen: false, isProcessing: false }));
        alertSuccess(msg, 'Database Backup Completed');
      } else {
        const msg = await SchemaService.RestoreDatabase(connection.id, database, cleanPath);
        setBackupRestoreModal((prev) => ({ ...prev, isOpen: false, isProcessing: false }));
        await handleRefreshDatabase(connection.id, database);
        alertSuccess(msg, 'Database Restore Completed');
      }
    } catch (err: any) {
      setBackupRestoreModal((prev) => ({ ...prev, isProcessing: false }));
      alertError(
        err?.message || String(err),
        mode === 'backup' ? 'Database Backup Failed' : 'Database Restore Failed'
      );
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
        await ConnectionService.Connect(connId);
        const conn = connections.find((c) => c.id === connId);
        const dbs = (await SchemaService.GetDatabases(connId)) ?? [];
        const safeDbs = dbs.length > 0 ? dbs : conn?.databaseName ? [conn.databaseName] : ['main'];
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
        const currentSchema = conn?.driver === 'postgres' ? 'public' : currentDb;
        setActiveConnection(connId, currentDb, currentSchema);

        // Pre-fetch objects for visible databases in background
        for (const dbName of prefetchedDbs) {
          if (conn?.driver === 'postgres') {
            SchemaService.GetSchemas(connId, dbName)
              .then((schemas) => {
                const safeSchemas = schemas && schemas.length > 0 ? schemas : ['public'];
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
      } catch (e) {
        console.error('Failed to load databases for connection:', e);
      } finally {
        setLoadingConnId(null);
      }
    }
  };

  const handleExpandDatabase = async (connId: string, dbName: string) => {
    const nodeKey = `${connId}:${dbName}`;
    toggleNode(nodeKey);
    const conn = connections.find((c) => c.id === connId);

    if (conn?.driver === 'postgres') {
      try {
        let schemas = treeSchemas[nodeKey];
        if (!schemas || schemas.length === 0) {
          schemas = (await SchemaService.GetSchemas(connId, dbName)) ?? [];
          if (schemas.length === 0) schemas = ['public'];
          setTreeSchemas((prev) => ({ ...prev, [nodeKey]: schemas }));
        }
        const activeS = schemas.includes('public') ? 'public' : schemas[0] || 'public';
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
      if (!expandedNodes[nodeKey] && !treeObjects[schemaKey]) {
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
      await ConnectionService.Connect(connId);
      const dbs = (await SchemaService.GetDatabases(connId)) ?? [];
      const conn = connections.find((c) => c.id === connId);
      const safeDbs = dbs.length > 0 ? dbs : conn?.databaseName ? [conn.databaseName] : ['main'];
      setTreeDatabases(connId, safeDbs);

      // Refresh currently selected database objects
      const currentDb = activeDatabase || safeDbs[0];
      const targetSchema = conn?.driver === 'postgres' ? 'public' : currentDb;
      const objects = (await SchemaService.GetObjects(connId, currentDb, targetSchema)) ?? [];
      setTreeObjects(`${connId}:${currentDb}:${targetSchema}`, objects as any);
    } catch (e) {
      console.error('Failed to refresh connection:', e);
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
          setActiveConnection(first.id, first.databaseName || 'main', first.driver === 'postgres' ? 'public' : 'main');
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
    } else if (conn.driver === 'postgres') {
      sql = `CREATE DATABASE "${dbName}" ENCODING '${createDbModal.charset || 'UTF8'}';`;
    }

    try {
      const execId = 'create-db-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: (conn.driver === 'mysql' || conn.driver === 'mariadb') ? (conn.databaseName || 'mysql') : 'postgres',
        schema: 'public',
        sql,
        limit: 10,
        offset: 0,
      } as any);

      // Re-fetch connection databases
      const dbs = (await SchemaService.GetDatabases(conn.id)) ?? [];
      const safeDbs = dbs.length > 0 ? dbs : [dbName];
      setTreeDatabases(conn.id, safeDbs);

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
    let schemas = treeSchemas[`${conn.id}:${database}`] || [];
    if (schemas.length === 0) {
      try {
        schemas = (await SchemaService.GetSchemas(conn.id, database)) ?? [];
      } catch {
        schemas = ['public'];
      }
    }
    const otherSchemas = schemas.filter((s) => s !== sourceSchema);
    const defaultTarget = otherSchemas.length > 0 ? otherSchemas[0] : '';

    setMoveTableModal({
      isOpen: true,
      connection: conn,
      database,
      sourceSchema,
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
      alertWarning('Target collection/schema must be different from current schema.', 'Same Schema');
      return;
    }

    let keyword = 'TABLE';
    if (objectType === 'view') {
      keyword = 'VIEW';
    } else if (objectType === 'materialized_view') {
      keyword = 'MATERIALIZED VIEW';
    } else if (objectType === 'sequence') {
      keyword = 'SEQUENCE';
    }

    const sql = `ALTER ${keyword} "${sourceSchema}"."${tableName}" SET SCHEMA "${targetSchema}";`;

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
    if (conn?.driver === 'postgres') {
      try {
        const schemas = (await SchemaService.GetSchemas(connId, dbName)) ?? [];
        const safeSchemas = schemas.length > 0 ? schemas : ['public'];
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
      confirmLabel: 'Drop Database',
      isDanger: true,
    });
    if (!okDrop) return;

    const sql =
      (conn.driver === 'mysql' || conn.driver === 'mariadb')
        ? `DROP DATABASE \`${dbName}\`;`
        : `DROP DATABASE "${dbName}";`;

    try {
      const execId = 'drop-db-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: (conn.driver === 'mysql' || conn.driver === 'mariadb') ? '' : 'postgres',
        schema: 'public',
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
    const isView = obj.type === 'view';
    const keyword = isView ? 'VIEW' : 'TABLE';

    const ok = await confirmDialog({
      title: `Drop ${isView ? 'View' : 'Table'}`,
      message: `Are you sure you want to DROP ${keyword.toLowerCase()} "${obj.name}"? All data in this ${keyword.toLowerCase()} will be permanently lost. This action cannot be undone.`,
      confirmLabel: `Drop ${isView ? 'View' : 'Table'}`,
      isDanger: true,
    });
    if (!ok) return;

    let sql = '';
    if (conn.driver === 'mysql' || conn.driver === 'mariadb') {
      sql = `DROP ${keyword} \`${obj.name}\`;`;
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
    } catch (err: any) {
      alertError(err?.message || String(err), `Failed to Drop ${keyword}`);
    }
  };

  const handleRoutineClick = (
    conn: ConnectionConfig,
    db: string,
    schema: string,
    routineName: string
  ) => {
    let content = `-- Routine / Function / Procedure: ${routineName}\n-- Connection: ${conn.name} | Database: ${db} | Schema: ${schema}\n\n`;
    if (conn.driver === 'postgres') {
      content += `-- 1. View definition source:\nSELECT pg_get_functiondef(p.oid)\nFROM pg_proc p\nJOIN pg_namespace n ON n.oid = p.pronamespace\nWHERE n.nspname = '${schema}' AND p.proname = '${routineName}';\n\n-- 2. Execute / Call routine:\n-- SELECT "${schema}"."${routineName}"();\n`;
    } else if (conn.driver === 'mysql' || conn.driver === 'mariadb') {
      content += `-- 1. View definition source:\nSHOW CREATE PROCEDURE \`${db}\`.\`${routineName}\`;\n-- Or function:\n-- SHOW CREATE FUNCTION \`${db}\`.\`${routineName}\`;\n\n-- 2. Call procedure:\n-- CALL \`${db}\`.\`${routineName}\`();\n`;
    } else {
      content += `-- SQLite does not support stored procedures or routines.\n`;
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

  const handleTriggerClick = (
    conn: ConnectionConfig,
    db: string,
    schema: string,
    triggerName: string
  ) => {
    let content = `-- Trigger: ${triggerName}\n-- Connection: ${conn.name} | Database: ${db} | Schema: ${schema}\n\n`;
    if (conn.driver === 'postgres') {
      content += `-- 1. View trigger definition:\nSELECT pg_get_triggerdef(t.oid)\nFROM pg_trigger t\nJOIN pg_class c ON c.oid = t.tgrelid\nJOIN pg_namespace n ON n.oid = c.relnamespace\nWHERE n.nspname = '${schema}' AND t.tgname = '${triggerName}';\n`;
    } else if (conn.driver === 'mysql' || conn.driver === 'mariadb') {
      content += `-- 1. View trigger definition:\nSHOW CREATE TRIGGER \`${db}\`.\`${triggerName}\`;\n`;
    } else {
      content += `-- 1. View trigger definition in SQLite:\nSELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = '${triggerName}';\n`;
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
    routineName: string
  ) => {
    const ok = await confirmDialog({
      title: 'Drop Routine',
      message: `Are you sure you want to DROP routine/function "${routineName}"? This action cannot be undone.`,
      confirmLabel: 'Drop Routine',
      isDanger: true,
    });
    if (!ok) return;

    let sql = '';
    if (conn.driver === 'mysql' || conn.driver === 'mariadb') {
      sql = `DROP PROCEDURE IF EXISTS \`${db}\`.\`${routineName}\`; DROP FUNCTION IF EXISTS \`${db}\`.\`${routineName}\`;`;
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
      confirmLabel: 'Drop Trigger',
      isDanger: true,
    });
    if (!ok) return;

    let sql = '';
    if (conn.driver === 'mysql' || conn.driver === 'mariadb') {
      sql = `DROP TRIGGER IF EXISTS \`${db}\`.\`${triggerName}\`;`;
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
    const targetSchema = schema || (conn?.driver === 'postgres' ? 'public' : targetDb);
    const count = tabs.filter((t) => t.type === 'worksheet').length + 1;

    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);
    let content = `-- Query Console for ${targetDb}\n-- ${isMac ? 'Cmd' : 'Ctrl'}+Enter to execute\n\n`;
    if (tableName) {
      const quoted = (conn?.driver === 'mysql' || conn?.driver === 'mariadb') ? `\`${tableName}\`` : `"${tableName}"`;
      content += `SELECT * FROM ${quoted} LIMIT 100;\n`;
    } else {
      content += `SELECT 1;\n`;
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
    const allKnownDbs = treeDatabases[c.id] || (c.databaseName ? [c.databaseName] : []);
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
              subtitle: connSubtitle,
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
            <DbDriverIcon driver={c.driver} className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{c.name}</span>
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
                        title={obj.name}
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
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
                  const targetSchema = c.driver === 'postgres' ? 'public' : dbName;
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
                  const tables = baseList.filter((o) => o.type === 'table' || (!o.type && o.type !== 'view'));
                  const views = baseList.filter((o) => o.type === 'view');
                  const matViews = baseList.filter((o) => o.type === 'materialized_view');
                  const routines = baseList.filter((o) => o.type === 'routine');
                  const triggers = baseList.filter((o) => o.type === 'trigger');
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
                          {c.driver === 'postgres' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenCreateSchema(c, dbName);
                              }}
                              className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-colors"
                              title={`Create New Collection / Schema in "${dbName}"`}
                            >
                              <Layers className="h-3 w-3 text-cyan-400" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenCreateTable(c, dbName, targetSchema);
                            }}
                            className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-colors"
                            title={`Create New Table in "${dbName}"`}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      {/* Tables & Views under this database */}
                      {isDbExpanded && (
                        <div className="ml-4 mt-0.5 border-l border-[#272932] pl-2 space-y-0.5">
                          {c.driver === 'postgres' ? (
                            (treeSchemas[`${c.id}:${dbName}`] || ['public']).map((sName) => {
                              const sNodeKey = `${c.id}:${dbName}:schema:${sName}`;
                              const isSExpanded = expandedNodes[sNodeKey] !== false; // default open
                              const sKey = `${c.id}:${dbName}:${sName}`;
                              const sAllObjects = treeObjects[sKey] || [];
                              const sMatchingObjects = filterLower
                                ? sAllObjects.filter((o) => o.name.toLowerCase().includes(filterLower))
                                : sAllObjects;
                              const sBaseList = filterLower && !dbMatches ? sMatchingObjects : sAllObjects;
                              const sTables = sBaseList.filter((o) => o.type === 'table' || (!o.type && o.type !== 'view'));
                              const sViews = sBaseList.filter((o) => o.type === 'view');
                              const sMatViews = sBaseList.filter((o) => o.type === 'materialized_view');
                              const sRoutines = sBaseList.filter((o) => o.type === 'routine');
                              const sTriggers = sBaseList.filter((o) => o.type === 'trigger');
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
                                            draggable={c.driver === 'postgres' && !c.isReadOnly}
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
                                            title={obj.name}
                                            className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white transition-opacity ${
                                              draggedItem?.type === 'table' && draggedItem.id === objDragId
                                                ? 'opacity-40'
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
                                                draggable={c.driver === 'postgres' && !c.isReadOnly}
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
                                                title={obj.name}
                                                className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white transition-opacity ${
                                                  draggedItem?.type === 'table' && draggedItem.id === objDragId
                                                    ? 'opacity-40'
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
                                                draggable={c.driver === 'postgres' && !c.isReadOnly}
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
                                                title={obj.name}
                                                className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white transition-opacity ${
                                                  draggedItem?.type === 'table' && draggedItem.id === objDragId
                                                    ? 'opacity-40'
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
                                                handleRoutineClick(c, dbName, sName, obj.name);
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
                                                  badge: 'ROUTINE',
                                                  subtitle: `${c.name} / ${dbName}.${sName}`,
                                                })
                                              }
                                              onMouseLeave={handleItemMouseLeave}
                                              title={obj.name}
                                              className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                            >
                                              <FileCode className="h-3 w-3 shrink-0 text-amber-400" />
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
                                                  subtitle: `${c.name} / ${dbName}.${sName}`,
                                                })
                                              }
                                              onMouseLeave={handleItemMouseLeave}
                                              title={obj.name}
                                              className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                            >
                                              <Zap className="h-3 w-3 shrink-0 text-rose-400" />
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
                            <>
                              <div className="text-[10px] text-zinc-500 flex items-center justify-between py-0.5 group/tbl">
                                <div className="flex items-center gap-1">
                                  <Folder className="h-2.5 w-2.5" />
                                  <span>tables ({tables.length})</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenCreateTable(c, dbName, targetSchema);
                                  }}
                                  className="opacity-0 group-hover/tbl:opacity-100 p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-opacity cursor-pointer"
                                  title={`Create New Table in "${dbName}"`}
                                >
                                  <Plus className="h-2.5 w-2.5" />
                                </button>
                              </div>
                              {tables.map((obj) => (
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
                                      kind: 'table',
                                      title: obj.name,
                                      badge: 'TABLE',
                                      subtitle: `${c.name} / ${dbName}`,
                                    })
                                  }
                                  onMouseLeave={handleItemMouseLeave}
                                  title={obj.name}
                                  className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                >
                                  <Table className="h-3 w-3 shrink-0 text-emerald-400" />
                                  <span className="truncate">{obj.name}</span>
                                </div>
                              ))}

                              {views.length > 0 && (
                                <>
                                  <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                    <Folder className="h-2.5 w-2.5" />
                                    <span>views ({views.length})</span>
                                  </div>
                                  {views.map((obj) => (
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
                                          badge: 'VIEW',
                                          subtitle: `${c.name} / ${dbName}`,
                                        })
                                      }
                                      onMouseLeave={handleItemMouseLeave}
                                      title={obj.name}
                                      className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                    >
                                      <Eye className="h-3 w-3 shrink-0 text-purple-400" />
                                      <span className="truncate">{obj.name}</span>
                                    </div>
                                  ))}
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
                                        handleRoutineClick(c, dbName, targetSchema, obj.name);
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
                                          badge: 'ROUTINE',
                                          subtitle: `${c.name} / ${dbName}`,
                                        })
                                      }
                                      onMouseLeave={handleItemMouseLeave}
                                      title={obj.name}
                                      className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                    >
                                      <FileCode className="h-3 w-3 shrink-0 text-amber-400" />
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
                                          subtitle: `${c.name} / ${dbName}`,
                                        })
                                      }
                                      onMouseLeave={handleItemMouseLeave}
                                      title={obj.name}
                                      className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                                    >
                                      <Zap className="h-3 w-3 shrink-0 text-rose-400" />
                                      <span className="truncate">{obj.name}</span>
                                    </div>
                                  ))}
                                </>
                              )}
                            </>
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
                  contextMenu.table?.type === 'routine'
                    ? 'Routine'
                    : contextMenu.table?.type === 'trigger'
                    ? 'Trigger'
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

              {contextMenu.connection.driver !== 'sqlite' && (
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

              {contextMenu.connection.driver !== 'sqlite' && (
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
                <span>New Table...</span>
              </button>

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

              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  handleRefreshDatabase(contextMenu.connection!.id, contextMenu.database!);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <RefreshCw className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Refresh Database</span>
              </button>

              <button
                type="button"
                onClick={() => handleCopyText(contextMenu.database!)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Copy Database Name</span>
              </button>

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
                        contextMenu.table!.name
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
                        contextMenu.table!.name
                      );
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-400 transition-colors text-left cursor-pointer group"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
                    <span>Drop Routine...</span>
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
                    <span>Edit Data (Open Table)</span>
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
                    <span>Edit Table Structure...</span>
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
                    <span>Refresh Table</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyText(contextMenu.table!.name)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>Copy Table Name</span>
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
                    <span>Copy Table Schema (DDL)</span>
                  </button>

                  {contextMenu.connection!.driver === 'postgres' && !contextMenu.connection!.isReadOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        closeContextMenu();
                        handleOpenMoveTable(
                          contextMenu.connection!,
                          contextMenu.database || 'postgres',
                          contextMenu.schema || 'public',
                          contextMenu.table!
                        );
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5 text-cyan-400 group-hover:text-white" />
                      <span>Move to Another Collection / Schema...</span>
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

                  <div className="my-1 border-t border-[#272932]" />

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
                    <span>Drop {contextMenu.table!.type === 'view' ? 'View' : 'Table'}...</span>
                  </button>
                </>
              )}
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

      {/* Create Database Dialog */}
      {createDbModal.isOpen && (() => {
        const dbModalEnv = resolveConnectionEnv(createDbModal.connection);
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
            onClick={() =>
              setCreateDbModal((prev) => ({ ...prev, isOpen: false }))
            }
          >
            <div
              className={`w-full max-w-md rounded-2xl border bg-[#14151a] shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col overflow-hidden text-zinc-200 ${
                dbModalEnv === 'dev'
                  ? 'border-emerald-700/60'
                  : dbModalEnv === 'prod'
                  ? 'border-rose-700/60'
                  : 'border-[#2b2e3a]'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div
                className={`flex items-start justify-between gap-3 px-6 py-4 border-b ${
                  dbModalEnv === 'dev'
                    ? 'bg-emerald-950/60 border-emerald-800/60'
                    : dbModalEnv === 'prod'
                    ? 'bg-rose-950/60 border-rose-800/60'
                    : 'bg-[#16171f] border-[#272932]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                      dbModalEnv === 'dev'
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                        : dbModalEnv === 'prod'
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                        : 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                    }`}
                  >
                    <Database className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-zinc-100">
                        Create New Database
                      </h3>
                      {dbModalEnv !== 'local' && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase font-mono border ${
                            dbModalEnv === 'dev'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          }`}
                        >
                          {dbModalEnv === 'dev' ? 'DEV' : 'PROD'}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 font-mono">
                      Connection: {createDbModal.connection?.name} ({createDbModal.connection?.driver?.toUpperCase()})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setCreateDbModal((prev) => ({ ...prev, isOpen: false }))
                  }
                  className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleConfirmCreateDatabase} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Database Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. sales_db"
                  value={createDbModal.dbName}
                  onChange={(e) =>
                    setCreateDbModal((prev) => ({ ...prev, dbName: e.target.value }))
                  }
                  className="w-full rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none transition-colors"
                />
              </div>

              {(createDbModal.connection?.driver === 'mysql' || createDbModal.connection?.driver === 'mariadb') && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                      Character Set
                    </label>
                    <input
                      type="text"
                      value={createDbModal.charset}
                      onChange={(e) =>
                        setCreateDbModal((prev) => ({ ...prev, charset: e.target.value }))
                      }
                      className="w-full rounded bg-[#101115] border border-[#2b2e3a] px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                      Collation
                    </label>
                    <input
                      type="text"
                      value={createDbModal.collation}
                      onChange={(e) =>
                        setCreateDbModal((prev) => ({ ...prev, collation: e.target.value }))
                      }
                      className="w-full rounded bg-[#101115] border border-[#2b2e3a] px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {createDbModal.connection?.driver === 'postgres' && (
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Encoding
                  </label>
                  <input
                    type="text"
                    value={createDbModal.charset}
                    onChange={(e) =>
                      setCreateDbModal((prev) => ({ ...prev, charset: e.target.value }))
                    }
                    className="w-full rounded bg-[#101115] border border-[#2b2e3a] px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530]">
                <button
                  type="button"
                  onClick={() =>
                    setCreateDbModal((prev) => ({ ...prev, isOpen: false }))
                  }
                  className="px-3.5 py-1.5 rounded-lg bg-[#20222a] hover:bg-[#2b2d38] border border-[#2d303f] text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!createDbModal.dbName.trim()}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm"
                >
                  Create Database
                </button>
              </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Backup / Restore Database Modal */}
      {backupRestoreModal.isOpen && (() => {
        const brEnv = resolveConnectionEnv(backupRestoreModal.connection);
        const isBackup = backupRestoreModal.mode === 'backup';
        const drv = backupRestoreModal.connection?.driver || 'mysql';
        const cliTool = isBackup
          ? drv === 'postgres'
            ? 'pg_dump'
            : drv === 'sqlite'
            ? 'sqlite3 .dump'
            : drv === 'mariadb'
            ? 'mariadb-dump'
            : 'mysqldump'
          : drv === 'postgres'
          ? 'psql'
          : drv === 'sqlite'
          ? 'sqlite3'
          : drv === 'mariadb'
          ? 'mariadb'
          : 'mysql';

        const filteredTables = backupRestoreModal.availableTables.filter((tbl) =>
          tbl.toLowerCase().includes(backupRestoreModal.tableSearch.toLowerCase().trim())
        );

        const toggleTable = (tbl: string) => {
          setBackupRestoreModal((prev) => {
            const has = prev.selectedTables.includes(tbl);
            return {
              ...prev,
              selectedTables: has
                ? prev.selectedTables.filter((t) => t !== tbl)
                : [...prev.selectedTables, tbl],
            };
          });
        };

        const selectAllTables = () => {
          setBackupRestoreModal((prev) => ({
            ...prev,
            selectedTables: Array.from(new Set([...prev.selectedTables, ...filteredTables])),
          }));
        };

        const deselectAllTables = () => {
          setBackupRestoreModal((prev) => {
            const fSet = new Set(filteredTables);
            return {
              ...prev,
              selectedTables: prev.selectedTables.filter((t) => !fSet.has(t)),
            };
          });
        };

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
            onClick={() => {
              if (!backupRestoreModal.isProcessing) {
                setBackupRestoreModal((prev) => ({ ...prev, isOpen: false }));
              }
            }}
          >
            <div
              className={`w-full ${
                isBackup ? 'max-w-2xl' : 'max-w-lg'
              } max-h-[90vh] rounded-2xl border bg-[#14151a] shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col overflow-hidden text-zinc-200 ${
                brEnv === 'dev'
                  ? 'border-emerald-700/60'
                  : brEnv === 'prod'
                  ? 'border-rose-700/60'
                  : 'border-[#2b2e3a]'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div
                className={`flex items-start justify-between gap-3 px-6 py-4 border-b ${
                  brEnv === 'dev'
                    ? 'bg-emerald-950/60 border-emerald-800/60'
                    : brEnv === 'prod'
                    ? 'bg-rose-950/60 border-rose-800/60'
                    : 'bg-[#16171f] border-[#272932]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                      isBackup
                        ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-400'
                        : 'bg-amber-500/15 border-amber-500/35 text-amber-400'
                    }`}
                  >
                    {isBackup ? (
                      <Download className="h-5 w-5" />
                    ) : (
                      <Upload className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-zinc-100">
                        {isBackup ? 'Backup Database' : 'Restore Database'}
                      </h3>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#22242c] border border-[#323544] text-zinc-300">
                        {cliTool}
                      </span>
                      {brEnv !== 'local' && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase font-mono border ${
                            brEnv === 'dev'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          }`}
                        >
                          {brEnv === 'dev' ? 'DEV' : 'PROD'}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                      Database: <span className="text-zinc-200 font-semibold">{backupRestoreModal.database}</span> •{' '}
                      {backupRestoreModal.connection?.name}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={backupRestoreModal.isProcessing}
                  onClick={() =>
                    setBackupRestoreModal((prev) => ({ ...prev, isOpen: false }))
                  }
                  className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-40"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal Body */}
              <form onSubmit={handleConfirmBackupRestore} className="p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                    {isBackup ? 'Backup File Location (.sql)' : 'SQL File to Restore (.sql)'}{' '}
                    <span className="text-rose-400">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      required
                      disabled={backupRestoreModal.isProcessing}
                      placeholder={
                        isBackup
                          ? '/path/to/backup.sql'
                          : 'Select a .sql file to restore...'
                      }
                      value={backupRestoreModal.filePath}
                      onChange={(e) =>
                        setBackupRestoreModal((prev) => ({
                          ...prev,
                          filePath: e.target.value,
                        }))
                      }
                      className="flex-1 rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none transition-colors"
                    />
                    <button
                      type="button"
                      disabled={backupRestoreModal.isProcessing}
                      onClick={
                        isBackup ? handleBrowseBackupFile : handleBrowseRestoreFile
                      }
                      className="px-3 py-2 rounded-lg bg-[#22242c] hover:bg-[#2c303c] border border-[#363948] text-xs font-medium text-zinc-200 hover:text-white transition-colors cursor-pointer shrink-0"
                    >
                      {isBackup ? 'Browse...' : 'Choose File...'}
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1.5">
                    {isBackup
                      ? `Exports database "${backupRestoreModal.database}" using ${cliTool}.`
                      : `Executes the .sql file into database "${backupRestoreModal.database}" using ${cliTool}.`}
                  </p>
                </div>

                {isBackup && (
                  <>
                    {/* Dump Content Mode */}
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                        Backup Content
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'full', label: 'Full', desc: 'Schema + Data' },
                          { id: 'schema_only', label: 'Schema Only', desc: 'Structure (DDL) only' },
                          { id: 'data_only', label: 'Data Only', desc: 'Data (INSERTs) only' },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            disabled={backupRestoreModal.isProcessing}
                            onClick={() =>
                              setBackupRestoreModal((prev) => ({
                                ...prev,
                                dumpMode: item.id as any,
                              }))
                            }
                            className={`px-3 py-2.5 rounded-xl border text-left cursor-pointer transition-colors ${
                              backupRestoreModal.dumpMode === item.id
                                ? 'bg-blue-600/20 border-blue-500 text-blue-200 shadow-xs'
                                : 'bg-[#181920] border-[#2b2e3a] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                            }`}
                          >
                            <div className="text-xs font-semibold">{item.label}</div>
                            <div className="text-[10px] text-zinc-500 mt-0.5">{item.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Stored Programs & Options */}
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                        Stored Programs & Options
                      </label>
                      <div className="grid grid-cols-2 gap-2 text-xs text-zinc-300 bg-[#101115] p-3 rounded-xl border border-[#2b2e3a]">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={backupRestoreModal.includeTriggers}
                            disabled={backupRestoreModal.isProcessing}
                            onChange={(e) =>
                              setBackupRestoreModal((prev) => ({
                                ...prev,
                                includeTriggers: e.target.checked,
                              }))
                            }
                            className="rounded border-[#3a3d4d] bg-[#1a1b22] text-blue-500 focus:ring-0"
                          />
                          <span>Include Triggers</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={backupRestoreModal.includeRoutines}
                            disabled={backupRestoreModal.isProcessing}
                            onChange={(e) =>
                              setBackupRestoreModal((prev) => ({
                                ...prev,
                                includeRoutines: e.target.checked,
                              }))
                            }
                            className="rounded border-[#3a3d4d] bg-[#1a1b22] text-blue-500 focus:ring-0"
                          />
                          <span>Include Routines (Procedures/Functions)</span>
                        </label>
                        {(drv === 'mysql' || drv === 'mariadb') && (
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={backupRestoreModal.includeEvents}
                              disabled={backupRestoreModal.isProcessing}
                              onChange={(e) =>
                                setBackupRestoreModal((prev) => ({
                                  ...prev,
                                  includeEvents: e.target.checked,
                                }))
                              }
                              className="rounded border-[#3a3d4d] bg-[#1a1b22] text-blue-500 focus:ring-0"
                            />
                            <span>Include Events</span>
                          </label>
                        )}
                        {(drv === 'mysql' || drv === 'mariadb') && (
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={backupRestoreModal.singleTransaction}
                              disabled={backupRestoreModal.isProcessing}
                              onChange={(e) =>
                                setBackupRestoreModal((prev) => ({
                                  ...prev,
                                  singleTransaction: e.target.checked,
                                }))
                              }
                              className="rounded border-[#3a3d4d] bg-[#1a1b22] text-blue-500 focus:ring-0"
                            />
                            <span>Single Transaction</span>
                          </label>
                        )}
                      </div>
                    </div>

                    {/* Table Selection */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                          Tables Selection
                        </label>
                        {backupRestoreModal.tableSelection !== 'all' && (
                          <span className="text-[11px] text-zinc-400 font-mono">
                            {backupRestoreModal.selectedTables.length} of{' '}
                            {backupRestoreModal.availableTables.length} tables selected
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        {[
                          { id: 'all', label: 'All Tables', desc: 'Dump entire database' },
                          { id: 'include', label: 'Include Selected', desc: 'Only dump chosen tables' },
                          { id: 'exclude', label: 'Exclude / Skip', desc: 'Skip chosen tables' },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            disabled={backupRestoreModal.isProcessing}
                            onClick={() =>
                              setBackupRestoreModal((prev) => ({
                                ...prev,
                                tableSelection: item.id as any,
                              }))
                            }
                            className={`px-3 py-2 rounded-xl border text-left cursor-pointer transition-colors ${
                              backupRestoreModal.tableSelection === item.id
                                ? 'bg-blue-600/20 border-blue-500 text-blue-200 shadow-xs'
                                : 'bg-[#181920] border-[#2b2e3a] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                            }`}
                          >
                            <div className="text-xs font-semibold">{item.label}</div>
                            <div className="text-[10px] text-zinc-500 mt-0.5">{item.desc}</div>
                          </button>
                        ))}
                      </div>

                      {backupRestoreModal.tableSelection !== 'all' && (
                        <div className="rounded-xl border border-[#2b2e3a] bg-[#101115] p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                              <input
                                type="text"
                                placeholder="Filter tables..."
                                value={backupRestoreModal.tableSearch}
                                onChange={(e) =>
                                  setBackupRestoreModal((prev) => ({
                                    ...prev,
                                    tableSearch: e.target.value,
                                  }))
                                }
                                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#181920] border border-[#2d303f] text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={selectAllTables}
                              className="px-2.5 py-1.5 rounded-lg bg-[#1f212a] hover:bg-[#2a2d3b] border border-[#323646] text-[11px] text-zinc-300 transition-colors cursor-pointer"
                            >
                              Select All
                            </button>
                            <button
                              type="button"
                              onClick={deselectAllTables}
                              className="px-2.5 py-1.5 rounded-lg bg-[#1f212a] hover:bg-[#2a2d3b] border border-[#323646] text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                            >
                              Clear
                            </button>
                          </div>

                          <div className="max-h-44 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                            {backupRestoreModal.isLoadingTables ? (
                              <div className="py-4 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                Loading tables...
                              </div>
                            ) : filteredTables.length === 0 ? (
                              <div className="py-4 text-center text-xs text-zinc-500">
                                {backupRestoreModal.availableTables.length === 0
                                  ? 'No tables found in this database.'
                                  : 'No matching tables found.'}
                              </div>
                            ) : (
                              filteredTables.map((tbl) => {
                                const isSelected = backupRestoreModal.selectedTables.includes(tbl);
                                return (
                                  <div
                                    key={tbl}
                                    onClick={() => toggleTable(tbl)}
                                    className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors text-xs select-none ${
                                      isSelected
                                        ? 'bg-blue-600/15 text-blue-200'
                                        : 'hover:bg-white/5 text-zinc-300'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {}}
                                      className="rounded border-[#3a3d4d] bg-[#1a1b22] text-blue-500 focus:ring-0"
                                    />
                                    <Table className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                                    <span className="font-mono truncate">{tbl}</span>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {!isBackup && brEnv === 'prod' && (
                  <div className="rounded-lg bg-rose-950/40 border border-rose-800/60 px-3 py-2 text-[11px] text-rose-200">
                    Warning: You are performing a <strong>Restore</strong> on a{' '}
                    <strong>PRODUCTION</strong> connection. Please make sure the selected SQL file is correct.
                  </div>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530] shrink-0">
                  <button
                    type="button"
                    disabled={backupRestoreModal.isProcessing}
                    onClick={() =>
                      setBackupRestoreModal((prev) => ({ ...prev, isOpen: false }))
                    }
                    className="px-3.5 py-1.5 rounded-lg bg-[#20222a] hover:bg-[#2b2d38] border border-[#2d303f] text-zinc-300 text-xs font-medium cursor-pointer transition-colors disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      backupRestoreModal.isProcessing ||
                      !backupRestoreModal.filePath.trim()
                    }
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm disabled:opacity-50 ${
                      isBackup
                        ? 'bg-emerald-600 hover:bg-emerald-500'
                        : 'bg-amber-600 hover:bg-amber-500'
                    }`}
                  >
                    {backupRestoreModal.isProcessing ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>{isBackup ? 'Backing up...' : 'Restoring...'}</span>
                      </>
                    ) : (
                      <>
                        {isBackup ? (
                          <Download className="h-3.5 w-3.5" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        <span>{isBackup ? 'Start Backup' : 'Restore Database'}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Create Schema / Collection Modal (PostgreSQL) */}
      {createSchemaModal.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setCreateSchemaModal((prev) => ({ ...prev, isOpen: false }))}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[#2b2e3a] bg-[#14151a] p-6 shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col gap-4 text-zinc-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-zinc-100">Create New Collection / Schema</h3>
                  <p className="text-[11px] text-zinc-400">
                    Database: <span className="font-mono text-cyan-300 font-medium">{createSchemaModal.database}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreateSchemaModal((prev) => ({ ...prev, isOpen: false }))}
                className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-[#20222a] transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmCreateSchema} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Collection / Schema Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. analytics, staging, v1"
                  value={createSchemaModal.schemaName}
                  onChange={(e) =>
                    setCreateSchemaModal((prev) => ({ ...prev, schemaName: e.target.value }))
                  }
                  className="w-full rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none font-mono transition-colors"
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  Must start with a letter or underscore and contain only alphanumeric characters and underscores.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Authorization / Owner <span className="text-zinc-500 text-[10px] font-normal lowercase">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. postgres or custom role name"
                  value={createSchemaModal.authorization}
                  onChange={(e) =>
                    setCreateSchemaModal((prev) => ({ ...prev, authorization: e.target.value }))
                  }
                  className="w-full rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none font-mono transition-colors"
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  Leave empty to create the collection under current logged-in user.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530]">
                <button
                  type="button"
                  onClick={() => setCreateSchemaModal((prev) => ({ ...prev, isOpen: false }))}
                  className="px-3.5 py-1.5 rounded-lg bg-[#20222a] hover:bg-[#2b2d38] border border-[#2d303f] text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!createSchemaModal.schemaName.trim()}
                  className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm"
                >
                  Create Collection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Move Table to Another Schema / Collection Modal (PostgreSQL) */}
      {moveTableModal.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setMoveTableModal((prev) => ({ ...prev, isOpen: false }))}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[#2b2e3a] bg-[#14151a] p-6 shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col gap-4 text-zinc-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                  <ArrowRightLeft className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-zinc-100">
                    Move {moveTableModal.objectType === 'view' ? 'View' : 'Table'} to Another Collection
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Database: <span className="font-mono text-zinc-200">{moveTableModal.database}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMoveTableModal((prev) => ({ ...prev, isOpen: false }))}
                className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-[#20222a] transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmMoveTable} className="space-y-4">
              <div className="rounded-lg bg-[#101115] border border-[#232530] p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Object Name:</span>
                  <span className="font-mono text-zinc-100 font-semibold">{moveTableModal.tableName}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Current Collection:</span>
                  <span className="font-mono text-cyan-300 bg-cyan-950/50 border border-cyan-800/50 px-2 py-0.5 rounded text-[11px]">
                    {moveTableModal.sourceSchema}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Target Collection / Schema <span className="text-rose-400">*</span>
                </label>
                <div className="space-y-2">
                  <select
                    value={moveTableModal.targetSchema}
                    onChange={(e) =>
                      setMoveTableModal((prev) => ({ ...prev, targetSchema: e.target.value }))
                    }
                    className="w-full rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none font-mono transition-colors"
                  >
                    <option value="" disabled>-- Select a target schema / collection --</option>
                    {moveTableModal.availableSchemas.map((s) => (
                      <option key={s} value={s} disabled={s === moveTableModal.sourceSchema}>
                        {s} {s === moveTableModal.sourceSchema ? '(Current)' : ''}
                      </option>
                    ))}
                  </select>

                  <div className="text-[11px] text-zinc-400">
                    Or enter another schema name:
                  </div>
                  <input
                    type="text"
                    placeholder="Enter schema name"
                    value={moveTableModal.targetSchema}
                    onChange={(e) =>
                      setMoveTableModal((prev) => ({ ...prev, targetSchema: e.target.value }))
                    }
                    className="w-full rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none font-mono transition-colors"
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-500 font-mono">
                  ALTER TABLE "{moveTableModal.sourceSchema}"."{moveTableModal.tableName}" SET SCHEMA "{moveTableModal.targetSchema || '...'}"
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530]">
                <button
                  type="button"
                  onClick={() => setMoveTableModal((prev) => ({ ...prev, isOpen: false }))}
                  className="px-3.5 py-1.5 rounded-lg bg-[#20222a] hover:bg-[#2b2d38] border border-[#2d303f] text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    !moveTableModal.targetSchema.trim() ||
                    moveTableModal.targetSchema.trim() === moveTableModal.sourceSchema
                  }
                  className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm"
                >
                  Move Table
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Schema Filter Popover / Modal (e.g. 3 of 10) */}
      <SchemaFilterModal
        isOpen={schemaFilterModal.isOpen}
        onClose={() => setSchemaFilterModal((prev) => ({ ...prev, isOpen: false }))}
        connection={schemaFilterModal.connection}
        anchorRect={schemaFilterModal.anchorRect}
      />

      {/* Export Table Modal */}
      <ExportModal
        isOpen={exportModal.isOpen}
        onClose={() => setExportModal((prev) => ({ ...prev, isOpen: false }))}
        connectionId={exportModal.connId}
        database={exportModal.db}
        schema={exportModal.schema}
        table={exportModal.table}
      />

      {/* Import Table Modal */}
      <ImportModal
        isOpen={importModal.isOpen}
        onClose={() => setImportModal((prev) => ({ ...prev, isOpen: false }))}
        connectionId={importModal.connId}
        database={importModal.db}
        schema={importModal.schema}
        table={importModal.table}
      />
    </div>
  );
};
