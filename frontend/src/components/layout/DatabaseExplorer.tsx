import React, { useEffect, useState } from 'react';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { ConnectionService, SchemaService, QueryService } from '../../../bindings/dhub/internal/services';
import {
  Database,
  Folder,
  Table,
  Eye,
  ChevronRight,
  ChevronDown,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Terminal,
  Code2,
  Copy,
  ExternalLink,
  X,
} from 'lucide-react';
import { ConnectionConfig, ObjectSummary } from '../../types/domain';
import { alertSuccess, alertError, alertInfo, alertWarning } from '../../stores/useAlertStore';

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  type: 'connection' | 'database' | 'table' | 'empty';
  connection?: ConnectionConfig;
  database?: string;
  schema?: string;
  table?: ObjectSummary;
}

export const DatabaseExplorer: React.FC = () => {
  const {
    connections,
    activeConnectionId,
    activeDatabase,
    setConnections,
    setActiveConnection,
    treeDatabases,
    setTreeDatabases,
    removeTreeDatabase,
    treeObjects,
    setTreeObjects,
    removeTreeObject,
    expandedNodes,
    toggleNode,
  } = useConnectionStore();

  const {
    tabs,
    openTab,
    closeTab,
    closeTabsMatching,
    refreshTab,
    setConnectionDialogOpen,
  } = useWorkbenchStore();

  const [filterText, setFilterText] = useState('');
  const [loadingConnId, setLoadingConnId] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

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
      const list = await ConnectionService.ListConnections();
      const safeList = list ?? [];
      setConnections(safeList as any);
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

        const currentDb = conn?.databaseName || safeDbs[0];
        const currentSchema = conn?.driver === 'postgres' ? 'public' : currentDb;
        setActiveConnection(connId, currentDb, currentSchema);

        // Pre-fetch objects for all databases in background
        for (const dbName of safeDbs) {
          const targetSchema = conn?.driver === 'postgres' ? 'public' : dbName;
          const sKey = `${connId}:${dbName}:${targetSchema}`;
          SchemaService.GetObjects(connId, dbName, targetSchema)
            .then((objs) => {
              if (objs) {
                setTreeObjects(sKey, objs as any);
              }
            })
            .catch(() => {});
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
    const targetSchema = conn?.driver === 'postgres' ? 'public' : dbName;
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
    if (!confirm(`Are you sure you want to delete connection "${name}"?`)) return;
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
      charset: conn.driver === 'mysql' ? 'utf8mb4' : 'UTF8',
      collation: conn.driver === 'mysql' ? 'utf8mb4_unicode_ci' : '',
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
    if (conn.driver === 'mysql') {
      sql = `CREATE DATABASE \`${dbName}\` CHARACTER SET ${createDbModal.charset || 'utf8mb4'} COLLATE ${createDbModal.collation || 'utf8mb4_unicode_ci'};`;
    } else if (conn.driver === 'postgres') {
      sql = `CREATE DATABASE "${dbName}" ENCODING '${createDbModal.charset || 'UTF8'}';`;
    }

    try {
      const execId = 'create-db-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: conn.driver === 'mysql' ? (conn.databaseName || 'mysql') : 'postgres',
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

  // Database handlers
  const handleRefreshDatabase = async (connId: string, dbName: string) => {
    const conn = connections.find((c) => c.id === connId);
    const targetSchema = conn?.driver === 'postgres' ? 'public' : dbName;
    const schemaKey = `${connId}:${dbName}:${targetSchema}`;
    try {
      const objects = (await SchemaService.GetObjects(connId, dbName, targetSchema)) ?? [];
      setTreeObjects(schemaKey, objects as any);
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Refresh Database');
    }
  };

  const handleEditDatabase = (conn: ConnectionConfig, dbName: string) => {
    if (conn.driver === 'postgres') {
      const newName = prompt(`Enter new name for database "${dbName}":`, dbName);
      if (!newName || newName.trim() === '' || newName === dbName) return;
      const execId = 'rename-db-' + Date.now();
      QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: 'postgres',
        schema: 'public',
        sql: `ALTER DATABASE "${dbName}" RENAME TO "${newName.trim()}";`,
        limit: 10,
        offset: 0,
      } as any)
        .then(async () => {
          const dbs = (await SchemaService.GetDatabases(conn.id)) ?? [];
          setTreeDatabases(conn.id, dbs);
          alertSuccess(`Database successfully renamed to "${newName.trim()}"`, 'Database Renamed');
        })
        .catch((err: any) => {
          alertError(err?.message || String(err), 'Failed to Rename Database');
        });
    } else if (conn.driver === 'mysql') {
      // Open a query console pre-populated with ALTER DATABASE statement
      const consoleCount = tabs.filter((t) => t.type === 'worksheet').length + 1;
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

    if (
      !confirm(
        `Are you sure you want to DROP database "${dbName}"?\n\nWARNING: This will permanently delete the database and all its tables and data. This action cannot be undone.`
      )
    ) {
      return;
    }

    const sql =
      conn.driver === 'mysql'
        ? `DROP DATABASE \`${dbName}\`;`
        : `DROP DATABASE "${dbName}";`;

    try {
      const execId = 'drop-db-' + Date.now();
      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: conn.id,
        database: conn.driver === 'mysql' ? '' : 'postgres',
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

  const handleEditTableStructure = (conn: ConnectionConfig, db: string, schema: string, tableName: string) => {
    let sql = '';
    if (conn.driver === 'mysql') {
      sql = `-- View Structure & DDL for ${tableName}\nSHOW CREATE TABLE \`${tableName}\`;\nDESCRIBE \`${tableName}\`;\n`;
    } else if (conn.driver === 'postgres') {
      sql = `-- Columns structure for ${tableName}\nSELECT column_name, data_type, is_nullable, column_default\nFROM information_schema.columns\nWHERE table_schema = '${schema}' AND table_name = '${tableName}'\nORDER BY ordinal_position;\n`;
    } else {
      sql = `-- SQLite Table DDL for ${tableName}\nSELECT sql FROM sqlite_master WHERE name = '${tableName}';\nPRAGMA table_info("${tableName}");\n`;
    }

    openTab({
      id: `console-ddl-${Date.now()}`,
      type: 'worksheet',
      title: `${tableName}_structure.sql`,
      connectionId: conn.id,
      database: db,
      schema: schema,
      content: sql,
    });
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

    if (
      !confirm(
        `Are you sure you want to DROP ${keyword.toLowerCase()} "${obj.name}"?\n\nWARNING: All data in this ${keyword.toLowerCase()} will be permanently lost. This action cannot be undone.`
      )
    ) {
      return;
    }

    let sql = '';
    if (conn.driver === 'mysql') {
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

  const handleNewConsole = (connId: string, dbName?: string, schema?: string, tableName?: string) => {
    const conn = connections.find((c) => c.id === connId);
    const targetDb = dbName || conn?.databaseName || 'main';
    const targetSchema = schema || (conn?.driver === 'postgres' ? 'public' : targetDb);
    const count = tabs.filter((t) => t.type === 'worksheet').length + 1;

    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);
    let content = `-- Query Console for ${targetDb}\n-- ${isMac ? 'Cmd' : 'Ctrl'}+Enter to execute\n\n`;
    if (tableName) {
      const quoted = conn?.driver === 'mysql' ? `\`${tableName}\`` : `"${tableName}"`;
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

  return (
    <div
      onContextMenu={(e) => openContextMenu(e, 'empty', {})}
      className="flex h-full flex-col bg-[#191a20] border-r border-[#272932] text-xs relative select-none"
    >
      {/* Header */}
      <div className="flex h-10 items-center justify-between border-b border-[#272932] px-3">
        <span className="font-semibold uppercase tracking-wider text-[11px] text-zinc-400">
          Database Explorer
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setConnectionDialogOpen(true, null)}
            className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
            title="New Connection"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={loadConnections}
            className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
            title="Refresh All"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
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
      <div className="flex-1 overflow-auto p-2">
        {connections.length === 0 ? (
          <div className="py-8 text-center text-zinc-500">
            <p>No connections configured</p>
            <button
              onClick={() => setConnectionDialogOpen(true, null)}
              className="mt-2 text-blue-400 hover:underline cursor-pointer"
            >
              Add Connection
            </button>
          </div>
        ) : (
          connections.map((c) => {
            const isConnExpanded = !!expandedNodes[c.id];
            const isConnLoading = loadingConnId === c.id;
            const databases = treeDatabases[c.id] || (c.databaseName ? [c.databaseName] : []);
            const isSQLite = c.driver === 'sqlite';

            return (
              <div key={c.id} className="mb-1">
                {/* Connection Node */}
                <div
                  onClick={() => handleExpandConnection(c.id)}
                  onContextMenu={(e) => openContextMenu(e, 'connection', { connection: c })}
                  className={`group flex items-center justify-between px-2 py-1 rounded cursor-pointer hover:bg-[#22242c] text-zinc-300 ${
                    activeConnectionId === c.id ? 'bg-[#22242c] font-medium text-white' : ''
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {isConnExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                    )}
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: c.colorTag || '#3b82f6' }}
                    />
                    <Database className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                    <span className="truncate">{c.name}</span>
                    <span className="text-[9px] text-zinc-500 font-mono uppercase bg-[#14151a] px-1 rounded shrink-0">
                      {c.driver}
                    </span>
                  </div>

                  {/* Actions on hover */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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

                {/* Sub Nodes */}
                {isConnExpanded && (
                  <div className="ml-4 mt-1 border-l border-[#272932] pl-2 space-y-1">
                    {isConnLoading && databases.length === 0 && (
                      <div className="text-[11px] text-zinc-500 italic py-1">Connecting & loading databases...</div>
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
                            <div className="text-[11px] text-zinc-500 flex items-center gap-1 py-0.5">
                              <Folder className="h-3 w-3" />
                              <span>tables ({objects.length})</span>
                            </div>
                            {objects.map((obj) => (
                              <div
                                key={obj.name}
                                onClick={() => handleTableClick(c.id, 'main', 'main', obj.name)}
                                onContextMenu={(e) =>
                                  openContextMenu(e, 'table', {
                                    connection: c,
                                    database: 'main',
                                    schema: 'main',
                                    table: obj,
                                  })
                                }
                                className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                              >
                                {obj.type === 'view' ? (
                                  <Eye className="h-3.5 w-3.5 text-purple-400 shrink-0" />
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
                        <div className="text-[11px] text-zinc-500 italic py-1">No databases found</div>
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
                          const tables = (filterLower && !dbMatches ? matchingObjects : allObjects).filter(
                            (o) => o.type !== 'view'
                          );
                          const views = (filterLower && !dbMatches ? matchingObjects : allObjects).filter(
                            (o) => o.type === 'view'
                          );
                          const isDbActive = activeConnectionId === c.id && activeDatabase === dbName;

                          return (
                            <div key={dbName} className="mb-0.5">
                              {/* Database Node */}
                              <div
                                onClick={() => handleExpandDatabase(c.id, dbName)}
                                onContextMenu={(e) =>
                                  openContextMenu(e, 'database', {
                                    connection: c,
                                    database: dbName,
                                    schema: targetSchema,
                                  })
                                }
                                className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer hover:bg-[#22242c] text-zinc-300 ${
                                  isDbActive ? 'bg-[#22242c] text-blue-300 font-medium' : ''
                                }`}
                              >
                                {isDbExpanded ? (
                                  <ChevronDown className="h-3 w-3 text-zinc-500 shrink-0" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 text-zinc-500 shrink-0" />
                                )}
                                <Database
                                  className={`h-3 w-3 shrink-0 ${isDbActive ? 'text-blue-400' : 'text-zinc-400'}`}
                                />
                                <span className="truncate flex-1">{dbName}</span>
                                {filterLower && hasMatchingObject && !dbMatches && (
                                  <span className="text-[9px] text-amber-400 bg-amber-950/40 px-1 rounded font-mono">
                                    {matchingObjects.length} match
                                  </span>
                                )}
                              </div>

                              {/* Tables & Views under this database */}
                              {isDbExpanded && (
                                <div className="ml-4 mt-0.5 border-l border-[#272932] pl-2 space-y-0.5">
                                  <div className="text-[10px] text-zinc-500 flex items-center gap-1 py-0.5">
                                    <Folder className="h-2.5 w-2.5" />
                                    <span>tables ({tables.length})</span>
                                  </div>
                                  {tables.map((obj) => {
                                    const isMatch = filterLower && obj.name.toLowerCase().includes(filterLower);
                                    return (
                                      <div
                                        key={obj.name}
                                        onClick={() => handleTableClick(c.id, dbName, targetSchema, obj.name)}
                                        onContextMenu={(e) =>
                                          openContextMenu(e, 'table', {
                                            connection: c,
                                            database: dbName,
                                            schema: targetSchema,
                                            table: obj,
                                          })
                                        }
                                        className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] ${
                                          isMatch
                                            ? 'text-amber-300 bg-amber-950/20 font-medium'
                                            : 'text-zinc-400 hover:text-white'
                                        }`}
                                      >
                                        <Table
                                          className={`h-3 w-3 shrink-0 ${
                                            isMatch ? 'text-amber-400' : 'text-emerald-400'
                                          }`}
                                        />
                                        <span className="truncate">{obj.name}</span>
                                      </div>
                                    );
                                  })}

                                  {views.length > 0 && (
                                    <>
                                      <div className="text-[10px] text-zinc-500 flex items-center gap-1 pt-1 py-0.5">
                                        <Folder className="h-2.5 w-2.5" />
                                        <span>views ({views.length})</span>
                                      </div>
                                      {views.map((obj) => {
                                        const isMatch = filterLower && obj.name.toLowerCase().includes(filterLower);
                                        return (
                                          <div
                                            key={obj.name}
                                            onClick={() => handleTableClick(c.id, dbName, targetSchema, obj.name)}
                                            onContextMenu={(e) =>
                                              openContextMenu(e, 'table', {
                                                connection: c,
                                                database: dbName,
                                                schema: targetSchema,
                                                table: obj,
                                              })
                                            }
                                            className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] ${
                                              isMatch
                                                ? 'text-amber-300 bg-amber-950/20 font-medium'
                                                : 'text-zinc-400 hover:text-white'
                                            }`}
                                          >
                                            <Eye
                                              className={`h-3 w-3 shrink-0 ${
                                                isMatch ? 'text-amber-400' : 'text-purple-400'
                                              }`}
                                            />
                                            <span className="truncate">{obj.name}</span>
                                          </div>
                                        );
                                      })}
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
          })
        )}
      </div>

      {/* Floating JetBrains-style Context Menu */}
      {contextMenu.isOpen && (
        <div
          className="fixed z-50 min-w-[210px] rounded-lg border border-[#2e313d] bg-[#181920]/95 backdrop-blur-md p-1 shadow-2xl text-[12px] text-zinc-300 select-none animate-in fade-in zoom-in-95 duration-100"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Menu Header */}
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-[#272932] mb-1 flex items-center justify-between">
            <span className="truncate">
              {contextMenu.type === 'connection' && `Connection: ${contextMenu.connection?.name}`}
              {contextMenu.type === 'database' && `Database: ${contextMenu.database}`}
              {contextMenu.type === 'table' &&
                `${contextMenu.table?.type === 'view' ? 'View' : 'Table'}: ${contextMenu.table?.name}`}
              {contextMenu.type === 'empty' && 'Explorer Menu'}
            </span>
            {copiedText && <span className="text-[9px] text-emerald-400 lowercase font-normal">copied!</span>}
          </div>

          {/* Connection Menu Items */}
          {contextMenu.type === 'connection' && contextMenu.connection && (
            <>
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

          {/* Table Menu Items */}
          {contextMenu.type === 'table' && contextMenu.connection && contextMenu.table && (
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
                <Code2 className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                <span>Edit Structure (DDL)...</span>
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

          {/* Empty Space Menu Items */}
          {contextMenu.type === 'empty' && (
            <>
              <button
                type="button"
                onClick={() => {
                  closeContextMenu();
                  setConnectionDialogOpen(true, null);
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

      {/* Create Database Dialog */}
      {createDbModal.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() =>
            setCreateDbModal((prev) => ({ ...prev, isOpen: false }))
          }
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[#2b2e3a] bg-[#14151a] p-6 shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col gap-4 text-zinc-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-zinc-100">
                    Create New Database
                  </h3>
                  <p className="text-[11px] text-zinc-500 font-mono">
                    Connection: {createDbModal.connection?.name} ({createDbModal.connection?.driver?.toUpperCase()})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setCreateDbModal((prev) => ({ ...prev, isOpen: false }))
                }
                className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-[#20222a] transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleConfirmCreateDatabase} className="space-y-4">
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

              {createDbModal.connection?.driver === 'mysql' && (
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
      )}
    </div>
  );
};
