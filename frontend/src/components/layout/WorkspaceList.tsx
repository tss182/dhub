import React, { useState } from 'react';
import { useWorkspaceSessionStore } from '../../stores/useWorkspaceSessionStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import {
  Briefcase,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Layers,
  Search,
  Sparkles,
  FileCode,
  Table,
} from 'lucide-react';
import { confirmDialog } from '../../stores/useAlertStore';

export const WorkspaceList: React.FC = () => {
  const {
    workspaces,
    activeWorkspaceId,
    createBlankWorkspace,
    switchWorkspace,
    renameWorkspace,
    deleteWorkspace,
  } = useWorkspaceSessionStore();

  const { tabs, activeTabId } = useWorkbenchStore();

  const [filterText, setFilterText] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');

  // Inline Rename state
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editNameVal, setEditNameVal] = useState('');

  const handleStartRename = (id: string, currentName: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingWorkspaceId(id);
    setEditNameVal(currentName);
  };

  const handleConfirmRename = async (id: string) => {
    if (editNameVal.trim()) {
      await renameWorkspace(id, editNameVal.trim());
    }
    setEditingWorkspaceId(null);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;

    // Snapshot current workspace tabs first
    const currentTabs = useWorkbenchStore.getState().tabs;
    const currentActiveId = useWorkbenchStore.getState().activeTabId;
    if (activeWorkspaceId) {
      await useWorkspaceSessionStore.getState().saveCurrentWorkspace(currentTabs, currentActiveId);
    }

    const createdId = await createBlankWorkspace(newWorkspaceName.trim());
    if (createdId) {
      // Clear tabs for the new blank workspace
      useWorkbenchStore.setState({ tabs: [], activeTabId: null });
      setIsCreating(false);
      setNewWorkspaceName('');
    }
  };

  const handleSwitch = async (targetId: string) => {
    if (targetId === activeWorkspaceId) return;

    await switchWorkspace(
      targetId,
      () => ({
        tabs: useWorkbenchStore.getState().tabs,
        activeTabId: useWorkbenchStore.getState().activeTabId,
      }),
      (newTabs, newActiveId) => {
        useWorkbenchStore.setState({
          tabs: newTabs,
          activeTabId: newActiveId,
        });
      }
    );
  };

  const handleDelete = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirmDialog({
      title: 'Delete Workspace',
      message: `Are you sure you want to delete workspace "${name}"? All saved tabs and view conditions in this workspace will be removed.`,
      confirmLabel: 'Delete',
      isDanger: true,
    });
    if (!ok) return;

    await deleteWorkspace(id, () => {
      // If deleted workspace was active, reset tabs or load next active
      const nextWs = useWorkspaceSessionStore.getState().workspaces.find((w) => w.isActive);
      if (nextWs) {
        let parsedTabs: any[] = [];
        try {
          parsedTabs = JSON.parse(nextWs.tabsJson || '[]');
        } catch {}
        const defaultActiveId = parsedTabs.length > 0 ? (parsedTabs[0]?.id as string) : null;
        useWorkbenchStore.setState({
          tabs: parsedTabs,
          activeTabId: nextWs.activeTabId || defaultActiveId,
        });
      } else {
        useWorkbenchStore.setState({ tabs: [], activeTabId: null });
      }
    });
  };

  const filtered = workspaces.filter((w) =>
    w.name.toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <div className="flex h-full flex-col bg-[#191a20] text-xs select-none relative">
      {/* Search & Actions Bar */}
      <div className="p-2 border-b border-[#272932] flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="h-3 w-3 text-zinc-500 absolute left-2 top-2 pointer-events-none" />
          <input
            type="text"
            placeholder="Filter workspaces..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full rounded bg-[#121317] pl-6 pr-2 py-1 text-[11px] text-zinc-200 border border-[#272932] focus:border-blue-500 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setIsCreating(true);
            setNewWorkspaceName(`Workspace ${workspaces.length + 1}`);
          }}
          className="flex items-center gap-1 h-6 px-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-[11px] cursor-pointer transition-colors shrink-0 shadow-xs"
          title="Create New Blank Workspace"
        >
          <Plus className="h-3 w-3 stroke-[2.5]" />
          <span>New</span>
        </button>
      </div>

      {/* Creation Modal / In-place Box */}
      {isCreating && (
        <form
          onSubmit={handleCreateSubmit}
          className="p-3 bg-[#14151a] border-b border-[#272932] flex flex-col gap-2.5 animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-200 text-[11px] flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-blue-400" />
              New Blank Workspace
            </span>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="p-0.5 text-zinc-400 hover:text-white rounded hover:bg-[#22242c]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <input
            type="text"
            autoFocus
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            placeholder="Workspace name..."
            className="w-full rounded bg-[#121317] px-2.5 py-1 text-xs text-white border border-blue-500/50 focus:border-blue-500 focus:outline-none"
          />

          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-2 py-0.5 rounded text-[11px] text-zinc-400 hover:text-white hover:bg-[#22242c]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-2.5 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-[11px] shadow-xs"
            >
              Create
            </button>
          </div>
        </form>
      )}

      {/* Workspaces List */}
      <div className="flex-1 overflow-auto p-2 space-y-1.5">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-zinc-500">
            <Briefcase className="h-8 w-8 mx-auto mb-2 text-zinc-600 stroke-[1.5]" />
            <p>No workspaces found</p>
            <button
              onClick={() => {
                setIsCreating(true);
                setNewWorkspaceName(`Workspace ${workspaces.length + 1}`);
              }}
              className="mt-2 text-blue-400 hover:underline cursor-pointer text-[11px]"
            >
              + Create Blank Workspace
            </button>
          </div>
        ) : (
          filtered.map((ws) => {
            const isActive = ws.id === activeWorkspaceId;
            let tabCount = 0;
            let tabPreviews: Array<{ title: string; type: string }> = [];
            try {
              const parsed = JSON.parse(ws.tabsJson || '[]');
              tabCount = parsed.length;
              tabPreviews = parsed.slice(0, 3);
            } catch {}

            const isEditingThis = editingWorkspaceId === ws.id;

            return (
              <div
                key={ws.id}
                onClick={() => handleSwitch(ws.id)}
                className={`group relative rounded-lg border p-2.5 cursor-pointer transition-all ${
                  isActive
                    ? 'bg-[#1e222d] border-blue-500/60 shadow-sm'
                    : 'bg-[#15161c] border-[#272932] hover:bg-[#1a1b24] hover:border-[#383b49]'
                }`}
              >
                {/* Active Indicator Strip */}
                <div
                  className={`absolute left-0 top-2 bottom-2 w-1 rounded-r bg-blue-500 ${
                    isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'
                  }`}
                />

                <div className="flex items-start justify-between gap-2 pl-1.5">
                  <div className="flex-1 min-w-0">
                    {isEditingThis ? (
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          autoFocus
                          value={editNameVal}
                          onChange={(e) => setEditNameVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleConfirmRename(ws.id);
                            if (e.key === 'Escape') setEditingWorkspaceId(null);
                          }}
                          className="w-full bg-[#101115] border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleConfirmRename(ws.id)}
                          className="p-1 rounded text-emerald-400 hover:bg-emerald-950"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingWorkspaceId(null)}
                          className="p-1 rounded text-zinc-400 hover:bg-[#22242c]"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span
                          onDoubleClick={(e) => handleStartRename(ws.id, ws.name, e)}
                          className={`font-semibold truncate text-[12px] ${
                            isActive ? 'text-white' : 'text-zinc-200'
                          }`}
                          title="Double-click to rename"
                        >
                          {ws.name}
                        </span>
                        {isActive && (
                          <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-mono text-[9px] font-bold uppercase tracking-wider shrink-0">
                            Active
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-1 text-[10.5px] text-zinc-400 font-mono">
                      <span className="flex items-center gap-1">
                        <Layers className="h-3 w-3 text-zinc-500" />
                        {tabCount} tab{tabCount !== 1 ? 's' : ''}
                      </span>
                      {isActive && (
                        <span className="text-emerald-400/90 text-[10px] font-sans flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Auto-saving
                        </span>
                      )}
                    </div>

                    {/* Previews of open tabs */}
                    {tabPreviews.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 mt-1.5">
                        {tabPreviews.map((t, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 max-w-[120px] px-1.5 py-0.5 rounded bg-[#101115] border border-[#272932] text-[9.5px] text-zinc-400 truncate"
                          >
                            {t.type === 'worksheet' ? (
                              <FileCode className="h-2.5 w-2.5 text-blue-400 shrink-0" />
                            ) : (
                              <Table className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
                            )}
                            <span className="truncate">{t.title}</span>
                          </span>
                        ))}
                        {tabCount > 3 && (
                          <span className="text-[9px] text-zinc-500 font-mono">
                            +{tabCount - 3} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Quick Action Buttons on Hover */}
                  {!isEditingThis && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        type="button"
                        onClick={(e) => handleStartRename(ws.id, ws.name, e)}
                        className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#2c303c] transition-colors"
                        title="Rename Workspace"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(ws.id, ws.name, e)}
                        className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-[#2c303c] transition-colors"
                        title="Delete Workspace"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

