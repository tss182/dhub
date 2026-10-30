import React, { useEffect, useState } from 'react';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { ConnectionService, SchemaService } from '../../../bindings/dhub/internal/services';
import { Database, Folder, Table, Eye, ChevronRight, ChevronDown, Plus, RefreshCw, Pencil, Trash2 } from 'lucide-react';

export const DatabaseExplorer: React.FC = () => {
  const {
    connections,
    activeConnectionId,
    activeDatabase,
    setConnections,
    setActiveConnection,
    treeDatabases,
    setTreeDatabases,
    treeObjects,
    setTreeObjects,
    expandedNodes,
    toggleNode,
  } = useConnectionStore();

  const { openTab, setConnectionDialogOpen } = useWorkbenchStore();
  const [filterText, setFilterText] = useState('');
  const [loadingConnId, setLoadingConnId] = useState<string | null>(null);

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

        // Pre-fetch objects for all databases in background so Speed Search can find tables everywhere
        for (const dbName of safeDbs) {
          const targetSchema = conn?.driver === 'postgres' ? 'public' : dbName;
          const sKey = `${connId}:${dbName}:${targetSchema}`;
          SchemaService.GetObjects(connId, dbName, targetSchema).then((objs) => {
            if (objs) {
              setTreeObjects(sKey, objs as any);
            }
          }).catch(() => {});
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

      // Refresh currently selected database objects if any
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
      alert('Delete failed: ' + (e?.message || String(e)));
    }
  };

  const handleEditConnection = (connId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setConnectionDialogOpen(true, connId);
  };

  const handleTableClick = (connId: string, db: string, schema: string, tableName: string) => {
    openTab({
      id: `table-${connId}-${db}-${tableName}`,
      type: 'table_data',
      title: tableName,
      connectionId: connId,
      database: db,
      schema: schema,
      table: tableName,
    });
  };

  return (
    <div className="flex h-full flex-col bg-[#191a20] border-r border-[#272932] text-xs">
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
              <div key={c.id} className="mb-1 select-none">
                {/* Connection Node */}
                <div
                  onClick={() => handleExpandConnection(c.id)}
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
                      title="Refresh Metadata"
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
                        databases
                          .map((dbName) => {
                            const filterLower = filterText.toLowerCase().trim();
                            const targetSchema = c.driver === 'postgres' ? 'public' : dbName;
                            const schemaKey = `${c.id}:${dbName}:${targetSchema}`;
                            const allObjects = treeObjects[schemaKey] || [];
                            
                            const dbMatches = !filterLower || dbName.toLowerCase().includes(filterLower);
                            const matchingObjects = filterLower
                              ? allObjects.filter((o) => o.name.toLowerCase().includes(filterLower))
                              : allObjects;
                            const hasMatchingObject = matchingObjects.length > 0;

                            // Hide database if neither dbName nor any child table matches
                            if (filterLower && !dbMatches && !hasMatchingObject) {
                              return null;
                            }

                            // Auto-expand if a child table matches during search
                            const isDbExpanded = !!expandedNodes[`${c.id}:${dbName}`] || (!!filterLower && hasMatchingObject);
                            const tables = (filterLower && !dbMatches ? matchingObjects : allObjects).filter((o) => o.type !== 'view');
                            const views = (filterLower && !dbMatches ? matchingObjects : allObjects).filter((o) => o.type === 'view');
                            const isDbActive = activeConnectionId === c.id && activeDatabase === dbName;

                            return (
                              <div key={dbName} className="mb-0.5">
                                {/* Database Node */}
                                <div
                                  onClick={() => handleExpandDatabase(c.id, dbName)}
                                  className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer hover:bg-[#22242c] text-zinc-300 ${
                                    isDbActive ? 'bg-[#22242c] text-blue-300 font-medium' : ''
                                  }`}
                                >
                                  {isDbExpanded ? (
                                    <ChevronDown className="h-3 w-3 text-zinc-500 shrink-0" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3 text-zinc-500 shrink-0" />
                                  )}
                                  <Database className={`h-3 w-3 shrink-0 ${isDbActive ? 'text-blue-400' : 'text-zinc-400'}`} />
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
                                          className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] ${
                                            isMatch ? 'text-amber-300 bg-amber-950/20 font-medium' : 'text-zinc-400 hover:text-white'
                                          }`}
                                        >
                                          <Table className={`h-3 w-3 shrink-0 ${isMatch ? 'text-amber-400' : 'text-emerald-400'}`} />
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
                                              className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] ${
                                                isMatch ? 'text-amber-300 bg-amber-950/20 font-medium' : 'text-zinc-400 hover:text-white'
                                              }`}
                                            >
                                              <Eye className={`h-3 w-3 shrink-0 ${isMatch ? 'text-amber-400' : 'text-purple-400'}`} />
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
    </div>
  );
};
