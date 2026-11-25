import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Search,
  Filter,
  Folder,
  Check,
  Minus,
  Layers,
} from 'lucide-react';
import {
  WorkspaceItem,
  ConnectionConfig,
  parseWorkspaceConnectionIds,
  getConnectionEnvInfo,
  formatConnectionLocation,
} from '../../types/domain';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useWorkspaceSessionStore } from '../../stores/useWorkspaceSessionStore';
import { DbDriverIcon } from '../common/DbDriverIcon';

interface WorkspaceConnectionFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: WorkspaceItem | null;
}

export const WorkspaceConnectionFilterModal: React.FC<WorkspaceConnectionFilterModalProps> = ({
  isOpen,
  onClose,
  workspace,
}) => {
  const { connections, folders, connectionFolders } = useConnectionStore();
  const { updateWorkspaceConnectionFilter } = useWorkspaceSessionStore();

  const [mode, setMode] = useState<'all' | 'custom'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !workspace) return;
    const parsed = parseWorkspaceConnectionIds(workspace.connectionIdsJson);
    if (parsed === null) {
      setMode('all');
      setSelectedIds(new Set(connections.map((c) => c.id)));
    } else {
      setMode('custom');
      setSelectedIds(new Set(parsed));
    }
    setSearchText('');
  }, [isOpen, workspace, connections]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filteredConnections = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter((c) => {
      const location = formatConnectionLocation(c).toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.driver.toLowerCase().includes(q) ||
        location.includes(q) ||
        (c.databaseName || '').toLowerCase().includes(q)
      );
    });
  }, [connections, searchText]);

  const grouped = useMemo(() => {
    const validFolderIds = new Set(folders.map((f) => f.id));
    const byFolder: Array<{
      folderId: string | null;
      folderName: string;
      folderColor?: string;
      items: ConnectionConfig[];
    }> = [];

    folders.forEach((folder) => {
      const items = filteredConnections.filter((c) => connectionFolders[c.id] === folder.id);
      if (items.length > 0) {
        byFolder.push({
          folderId: folder.id,
          folderName: folder.name,
          folderColor: folder.color,
          items,
        });
      }
    });

    const ungrouped = filteredConnections.filter((c) => {
      const fId = connectionFolders[c.id];
      return !fId || !validFolderIds.has(fId);
    });
    if (ungrouped.length > 0) {
      byFolder.push({
        folderId: null,
        folderName: folders.length > 0 ? 'Ungrouped' : 'Connections',
        items: ungrouped,
      });
    }

    return byFolder;
  }, [filteredConnections, folders, connectionFolders]);

  if (!isOpen || !workspace) return null;

  const toggleConnection = (connId: string) => {
    setMode('custom');
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(connId)) {
        next.delete(connId);
      } else {
        next.add(connId);
      }
      return next;
    });
  };

  const toggleFolder = (items: ConnectionConfig[]) => {
    setMode('custom');
    const allSelected = items.every((c) => selectedIds.has(c.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        items.forEach((c) => next.delete(c.id));
      } else {
        items.forEach((c) => next.add(c.id));
      }
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    setMode('custom');
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredConnections.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const handleClearFiltered = () => {
    setMode('custom');
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredConnections.forEach((c) => next.delete(c.id));
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (mode === 'all') {
        await updateWorkspaceConnectionFilter(workspace.id, null);
      } else {
        // Keep only IDs that still exist in connections
        const validIds = new Set(connections.map((c) => c.id));
        const finalIds = Array.from(selectedIds).filter((id) => validIds.has(id));
        await updateWorkspaceConnectionFilter(workspace.id, finalIds);
      }
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const activeSelectedCount = connections.filter((c) => selectedIds.has(c.id)).length;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-[#2f323d] bg-[#191a20] shadow-2xl overflow-hidden flex flex-col max-h-[82vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#272932] bg-[#14151a]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400 shrink-0">
              <Filter className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-white truncate">
                Workspace Connections — {workspace.name}
              </h3>
              <p className="text-[11px] text-zinc-400 truncate">
                Choose which connections appear when this workspace is active
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-[#22242c] hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Selector */}
        <div className="px-4 pt-3 pb-2 border-b border-[#272932] bg-[#16171d] space-y-2.5">
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#101116] border border-[#272932]">
            <button
              type="button"
              onClick={() => {
                setMode('all');
                setSelectedIds(new Set(connections.map((c) => c.id)));
              }}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                mode === 'all'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1c24]'
              }`}
            >
              <Layers className="h-3 w-3" />
              <span>All Connections ({connections.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('custom')}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                mode === 'custom'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1c24]'
              }`}
            >
              <Filter className="h-3 w-3" />
              <span>Selected Only ({activeSelectedCount})</span>
            </button>
          </div>

          {/* Search & Quick Actions */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-2.5 top-2 pointer-events-none" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search by name, driver, host, database..."
                className="w-full rounded-md bg-[#111217] pl-8 pr-7 py-1.5 text-xs text-zinc-200 border border-[#2a2d38] focus:border-blue-500 focus:outline-none placeholder-zinc-500"
              />
              {searchText && (
                <button
                  type="button"
                  onClick={() => setSearchText('')}
                  className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleSelectAllFiltered}
              className="px-2 py-1.5 rounded-md border border-[#2a2d38] bg-[#111217] hover:bg-[#22242c] text-[11px] text-zinc-300 hover:text-white transition-colors cursor-pointer shrink-0"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={handleClearFiltered}
              className="px-2 py-1.5 rounded-md border border-[#2a2d38] bg-[#111217] hover:bg-[#22242c] text-[11px] text-zinc-400 hover:text-white transition-colors cursor-pointer shrink-0"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Connection List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {connections.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-500">
              No connections configured yet.
            </div>
          ) : grouped.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-500">
              No connections match "{searchText}".
            </div>
          ) : (
            grouped.map((group) => {
              const allGroupChecked =
                mode === 'all' || group.items.every((c) => selectedIds.has(c.id));
              const someGroupChecked =
                mode === 'custom' &&
                !allGroupChecked &&
                group.items.some((c) => selectedIds.has(c.id));

              return (
                <div
                  key={group.folderId ?? '__ungrouped__'}
                  className="rounded-lg border border-[#272932] bg-[#14151a] overflow-hidden"
                >
                  {/* Group Header */}
                  <button
                    type="button"
                    onClick={() => toggleFolder(group.items)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-[#181920] border-b border-[#242630] hover:bg-[#1e2029] transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded border transition-colors shrink-0 ${
                          allGroupChecked
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : someGroupChecked
                            ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                            : 'bg-[#101116] border-[#383b49] text-transparent'
                        }`}
                      >
                        {allGroupChecked ? (
                          <Check className="h-3 w-3 stroke-[2.5]" />
                        ) : someGroupChecked ? (
                          <Minus className="h-3 w-3 stroke-[2.5]" />
                        ) : null}
                      </span>
                      {group.folderId && (
                        <Folder
                          className="h-3.5 w-3.5 shrink-0"
                          style={{ color: group.folderColor || '#3b82f6' }}
                        />
                      )}
                      <span className="text-[11px] font-semibold text-zinc-200 truncate">
                        {group.folderName}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                      {group.items.filter((c) => mode === 'all' || selectedIds.has(c.id)).length}/
                      {group.items.length}
                    </span>
                  </button>

                  {/* Group Items */}
                  <div className="divide-y divide-[#20222b]">
                    {group.items.map((conn) => {
                      const isChecked = mode === 'all' || selectedIds.has(conn.id);
                      const envInfo = getConnectionEnvInfo(conn);
                      const location = formatConnectionLocation(conn);

                      return (
                        <button
                          key={conn.id}
                          type="button"
                          onClick={() => toggleConnection(conn.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer ${
                            isChecked
                              ? 'bg-blue-500/[0.04] hover:bg-blue-500/[0.08]'
                              : 'hover:bg-[#1a1c24] opacity-70 hover:opacity-100'
                          }`}
                        >
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded border transition-colors shrink-0 ${
                              isChecked
                                ? 'bg-blue-600 border-blue-500 text-white'
                                : 'bg-[#101116] border-[#383b49] text-transparent'
                            }`}
                          >
                            {isChecked && <Check className="h-3 w-3 stroke-[2.5]" />}
                          </span>

                          <DbDriverIcon driver={conn.driver} className="h-4 w-4 shrink-0" />

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-zinc-100 truncate">
                                {conn.name}
                              </span>
                              {envInfo.label && (
                                <span
                                  className="px-1 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider shrink-0"
                                  style={{
                                    backgroundColor: `${envInfo.color}20`,
                                    color: envInfo.color,
                                    border: `1px solid ${envInfo.color}40`,
                                  }}
                                >
                                  {envInfo.label}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-zinc-500 font-mono truncate">
                              {conn.driver} • {location}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#272932] bg-[#14151a]">
          <div className="text-[11px] text-zinc-400">
            {mode === 'all' ? (
              <span>Showing all {connections.length} connections</span>
            ) : (
              <span>
                <span className="text-blue-400 font-semibold">{activeSelectedCount}</span> of{' '}
                {connections.length} connections selected
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-white hover:bg-[#22242c] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white shadow-xs transition-colors cursor-pointer"
            >
              {isSaving ? 'Saving...' : 'Apply Filter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
