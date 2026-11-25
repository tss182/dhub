import React, { Suspense, lazy } from 'react';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { SchemaService } from '../../../bindings/dhub/internal/services';
import { ConsoleList } from './ConsoleList';
import { Popover } from '../common/Popover';
import {
  Terminal,
  PanelRight,
  Plus,
  X,
} from 'lucide-react';
import { alertWarning } from '../../stores/useAlertStore';
import { getDriverCapabilities, getDefaultDatabase, getDefaultSchema } from '../../utils/driverCapabilities';

const ValueViewerPanel = lazy(() =>
  import('../grid/ValueViewerPanel').then((m) => ({ default: m.ValueViewerPanel }))
);

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);

interface RightSidebarProps {
  onRename: (id: string, currentTitle: string) => void;
  width: number;
  onWidthChange: (newWidth: number) => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  onRename,
  width,
  onWidthChange,
}) => {
  const consoles = useWorkbenchStore((state) => state.consoles);
  const activeRightSidebarTab = useWorkbenchStore((state) => state.activeRightSidebarTab);
  const setActiveRightSidebarTab = useWorkbenchStore((state) => state.setActiveRightSidebarTab);
  const activeCellViewer = useWorkbenchStore((state) => state.activeCellViewer);
  const toggleRightPanel = useWorkbenchStore((state) => state.toggleRightPanel);
  const createConsole = useWorkbenchStore((state) => state.createConsole);

  const {
    connections,
    activeConnectionId,
    treeDatabases,
    visibleDatabases,
    setTreeDatabases,
  } = useConnectionStore();

  const handleCreateNewConsole = async () => {
    const conn = connections.find((c) => c.id === activeConnectionId) || connections[0];
    if (!conn) {
      alertWarning('Please select or add a connection in Database Explorer first.', 'No Active Connection');
      return;
    }

    let dbs = treeDatabases[conn.id] || [];
    if (dbs.length === 0) {
      try {
        const fetched = await SchemaService.GetDatabases(conn.id);
        if (fetched && fetched.length > 0) {
          dbs = fetched;
          setTreeDatabases(conn.id, fetched);
        }
      } catch (e) {
        console.warn('Could not fetch databases for connection:', e);
      }
    }

    const visibleList = visibleDatabases[conn.id];
    const effectiveDbs =
      visibleList !== undefined
        ? dbs.filter((db) => visibleList.includes(db) || visibleList.some((v) => v.toLowerCase() === db.toLowerCase()))
        : dbs;

    const { activeDatabase, activeSchema } = useConnectionStore.getState();
    const isActiveConn = conn.id === activeConnectionId;
    const caps = getDriverCapabilities(conn.driver);
    const systemDbs = caps.systemDatabases;
    const nonSystemDb = effectiveDbs.find((d) => !systemDbs.includes(d.toLowerCase()));
    const fallbackDb = getDefaultDatabase(conn.driver) || 'default';
    const targetDb =
      (isActiveConn && activeDatabase && activeDatabase !== 'main' ? activeDatabase : '') ||
      (conn.databaseName && (!visibleList || visibleList.includes(conn.databaseName) || visibleList.some((v) => v.toLowerCase() === conn.databaseName.toLowerCase())) ? conn.databaseName : '') ||
      nonSystemDb ||
      (effectiveDbs.length > 0 ? effectiveDbs[0] : fallbackDb);
    const targetSchema = caps.hasSeparateSchemas
      ? (isActiveConn && activeSchema && activeSchema !== 'main' ? activeSchema : getDefaultSchema(conn.driver, targetDb))
      : targetDb;

    const count = consoles.filter((c) => c.connectionId === conn.id).length + 1;
    const title = `${conn.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_console_${count}.sql`;
    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);
    let starter: string | undefined;
    if (conn.driver === 'elasticsearch') {
      starter = `-- Elasticsearch Query Console\n-- Run REST commands (GET /_cat/indices, POST /index/_search) or SQL (SELECT * FROM "index" LIMIT 50)\n-- ${isMac ? 'Cmd' : 'Ctrl'}+Enter to execute\n\nGET /_cat/indices?format=json\n`;
    } else if (conn.driver === 'qdrant') {
      starter = `-- Qdrant Query Console\n-- Run pseudo-SQL (SELECT * FROM collection LIMIT 50, SHOW COLLECTIONS) or REST API commands\n-- ${isMac ? 'Cmd' : 'Ctrl'}+Enter to execute\n\nSHOW COLLECTIONS;\n`;
    } else if (conn.driver === 'redis') {
      starter = `-- Redis Query Console for ${targetDb}\n-- Type Redis commands directly (e.g. GET key, SET key val, KEYS *)\n-- ${isMac ? 'Cmd' : 'Ctrl'}+Enter to execute\n\nKEYS *\n`;
    } else if (conn.driver === 'mongodb') {
      starter = `-- MongoDB Query Console for ${targetDb}\n-- ${isMac ? 'Cmd' : 'Ctrl'}+Enter to execute\n\nshow collections;\n`;
    }

    createConsole(conn.id, targetDb, targetSchema, title, starter);
  };

  return (
    <div className="flex h-full flex-col bg-[#191a20] text-xs select-none relative overflow-hidden">
      {/* Unified Tab Bar Header */}
      <div className="flex h-10 items-center justify-between border-b border-[#272932] px-2 bg-[#14151a] shrink-0">
        {/* Tabs: Console & Views */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveRightSidebarTab('consoles')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors cursor-pointer select-none ${
              activeRightSidebarTab === 'consoles'
                ? 'bg-[#22242c] text-white font-medium border border-[#2e313d]'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1b22]'
            }`}
            title="Consoles List"
          >
            <Terminal className="h-3.5 w-3.5 text-blue-400" />
            <span>Console</span>
            <span className="rounded bg-[#272932] px-1 text-[10px] text-zinc-400 font-mono">
              {consoles.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveRightSidebarTab('views')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors cursor-pointer select-none ${
              activeRightSidebarTab === 'views'
                ? 'bg-[#22242c] text-white font-medium border border-[#2e313d]'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1b22]'
            }`}
            title="View As / Cell Value Viewer (Ctrl+T / ⌘T)"
          >
            <PanelRight className="h-3.5 w-3.5 text-blue-400" />
            <span>Views</span>
          </button>
        </div>

        {/* Right Header Controls */}
        <div className="flex items-center gap-1">
          {activeRightSidebarTab === 'consoles' && (
            <Popover content="New Query Console" side="bottom" align="end">
              <button
                type="button"
                onClick={handleCreateNewConsole}
                className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </Popover>
          )}

          <Popover
            content="Close Sidebar"
            shortcut={isMac ? '⌘R' : 'Ctrl+R'}
            side="bottom"
            align="end"
          >
            <button
              type="button"
              onClick={toggleRightPanel}
              className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Popover>
        </div>
      </div>

      {/* Tab Panels */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {activeRightSidebarTab === 'consoles' ? (
          <ConsoleList onRename={onRename} hideHeader={true} />
        ) : (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-zinc-500">Loading viewer...</div>}>
            <ValueViewerPanel
              inSidebar={true}
              isOpen={true}
              width={width}
              onWidthChange={onWidthChange}
              columnName={activeCellViewer?.columnName}
              columnType={activeCellViewer?.columnType}
              rowIndex={activeCellViewer?.rowIndex}
              columnIndex={activeCellViewer?.columnIndex}
              tableName={activeCellViewer?.tableName}
              rawValue={activeCellViewer?.rawValue}
              onSave={activeCellViewer?.onSave}
              onClose={toggleRightPanel}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
};

