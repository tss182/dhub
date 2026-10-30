import React, { useEffect, useState } from 'react';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { ConnectionService, SchemaService } from '../../../bindings/dhub/internal/services';
import { Database, Folder, Table, Eye, ChevronRight, ChevronDown, Plus, RefreshCw, Key } from 'lucide-react';

export const DatabaseExplorer: React.FC = () => {
  const {
    connections,
    activeConnectionId,
    setConnections,
    setActiveConnection,
    treeObjects,
    setTreeObjects,
    expandedNodes,
    toggleNode,
  } = useConnectionStore();

  const { openTab, setConnectionDialogOpen } = useWorkbenchStore();
  const [filterText, setFilterText] = useState('');

  const loadConnections = async () => {
    try {
      const list = await ConnectionService.ListConnections();
      const safeList = list ?? [];
      setConnections(safeList as any);
      if (safeList.length > 0 && !activeConnectionId) {
        setActiveConnection(safeList[0].id, safeList[0].databaseName || 'main', 'main');
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
      try {
        await ConnectionService.Connect(connId);
        const dbs = (await SchemaService.GetDatabases(connId)) ?? [];
        const targetDb = dbs.length > 0 ? dbs[0] : 'main';
        const schemas = (await SchemaService.GetSchemas(connId, targetDb)) ?? [];
        const targetSchema = schemas.length > 0 ? schemas[0] : 'main';
        setActiveConnection(connId, targetDb, targetSchema);

        const objects = (await SchemaService.GetObjects(connId, targetDb, targetSchema)) ?? [];
        setTreeObjects(`${connId}:${targetDb}:${targetSchema}`, objects as any);
      } catch (e) {
        console.error('Failed to load schema objects:', e);
      }
    }
  };

  const handleTableClick = (connId: string, db: string, schema: string, tableName: string) => {
    openTab({
      id: `table-${connId}-${tableName}`,
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
            onClick={() => setConnectionDialogOpen(true)}
            className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
            title="New Connection"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={loadConnections}
            className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
            title="Refresh"
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
              onClick={() => setConnectionDialogOpen(true)}
              className="mt-2 text-blue-400 hover:underline cursor-pointer"
            >
              Add Connection
            </button>
          </div>
        ) : (
          connections.map((c) => {
            const isConnExpanded = !!expandedNodes[c.id];
            const targetDb = c.databaseName || 'main';
            const schemaKey = `${c.id}:${targetDb}:main`;
            const objects = (treeObjects[schemaKey] || []).filter((o) =>
              !filterText ? true : o.name.toLowerCase().includes(filterText.toLowerCase())
            );

            return (
              <div key={c.id} className="mb-1">
                {/* Connection Node */}
                <div
                  onClick={() => handleExpandConnection(c.id)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer hover:bg-[#22242c] text-zinc-300 ${
                    activeConnectionId === c.id ? 'bg-[#22242c] font-medium text-white' : ''
                  }`}
                >
                  {isConnExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                  )}
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: c.colorTag || '#3b82f6' }}
                  />
                  <Database className="h-3.5 w-3.5 text-blue-400" />
                  <span className="truncate flex-1">{c.name}</span>
                  <span className="text-[10px] text-zinc-500 uppercase">{c.driver}</span>
                </div>

                {/* Sub Nodes: Tables / Views */}
                {isConnExpanded && (
                  <div className="ml-4 mt-1 border-l border-[#272932] pl-2">
                    <div className="text-[11px] text-zinc-500 flex items-center gap-1 py-0.5">
                      <Folder className="h-3 w-3" />
                      <span>tables ({objects.length})</span>
                    </div>

                    {objects.map((obj) => (
                      <div
                        key={obj.name}
                        onClick={() => handleTableClick(c.id, targetDb, obj.schema || 'main', obj.name)}
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer hover:bg-[#22242c] text-zinc-400 hover:text-white"
                      >
                        {obj.type === 'view' ? (
                          <Eye className="h-3.5 w-3.5 text-purple-400" />
                        ) : (
                          <Table className="h-3.5 w-3.5 text-emerald-400" />
                        )}
                        <span className="truncate">{obj.name}</span>
                      </div>
                    ))}
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

