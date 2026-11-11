import React, { useState, useRef, useEffect } from 'react';
import { useWorkspaceSessionStore } from '../../stores/useWorkspaceSessionStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { Briefcase, ChevronDown, Check, Plus, Layers } from 'lucide-react';

export const WorkspaceSelector: React.FC = () => {
  const {
    workspaces,
    activeWorkspaceId,
    switchWorkspace,
    createBlankWorkspace,
    loadWorkspaces,
    hasLoaded,
    isLoading,
  } = useWorkspaceSessionStore();

  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hasLoaded && !isLoading) {
      loadWorkspaces();
    }
  }, [hasLoaded, isLoading, loadWorkspaces]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsCreating(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isCreating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreating]);

  const handleSelectWorkspace = async (wsId: string) => {
    if (wsId === activeWorkspaceId) {
      setIsOpen(false);
      return;
    }
    await switchWorkspace(
      wsId,
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
    setIsOpen(false);
  };

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    const newId = await createBlankWorkspace(newWsName.trim());
    if (newId) {
      useWorkbenchStore.setState({
        tabs: [],
        activeTabId: null,
      });
      setNewWsName('');
      setIsCreating(false);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded bg-[#1e2027] px-2.5 py-1 text-xs text-zinc-300 border border-[#272932] hover:border-zinc-500 hover:text-white cursor-pointer shadow-xs transition-colors group max-w-[200px]"
        title="Active Workspace - Click to switch or create new"
      >
        <Briefcase className="h-3.5 w-3.5 text-zinc-400 group-hover:text-blue-400 transition-colors shrink-0" />
        <span className="truncate font-medium text-xs">
          {activeWorkspace?.name || 'Default Workspace'}
        </span>
        <ChevronDown className={`h-3 w-3 text-zinc-500 transition-transform duration-150 shrink-0 ${isOpen ? 'rotate-180 text-zinc-300' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-md border border-[#373946] bg-[#1a1b22] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3 py-1.5 border-b border-[#292b36] flex items-center justify-between text-[11px] font-semibold text-zinc-400 uppercase tracking-wider bg-[#14151a]">
            <span>Workspaces</span>
            <span className="text-[10px] text-zinc-500 font-normal lowercase">
              {workspaces.length} saved
            </span>
          </div>

          <div className="max-h-60 overflow-y-auto py-1 divide-y divide-[#22242e]/50">
            {workspaces.map((ws) => {
              const isActive = ws.id === activeWorkspaceId;
              let tabCount = 0;
              try {
                tabCount = JSON.parse(ws.tabsJson || '[]').length;
              } catch {}

              return (
                <button
                  key={ws.id}
                  type="button"
                  onClick={() => handleSelectWorkspace(ws.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[#232530] transition-colors cursor-pointer group ${
                    isActive ? 'bg-blue-600/10 text-white' : 'text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Briefcase className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-zinc-500 group-hover:text-zinc-300'}`} />
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate group-hover:text-white">
                        {ws.name}
                      </div>
                      <div className="text-[10px] text-zinc-500 flex items-center gap-1 mt-0.5">
                        <Layers className="h-2.5 w-2.5" />
                        <span>{tabCount} tabs</span>
                      </div>
                    </div>
                  </div>

                  {isActive && (
                    <Check className="h-3.5 w-3.5 text-blue-400 shrink-0 ml-2" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Create New Workspace */}
          <div className="p-2 border-t border-[#292b36] bg-[#14151a]">
            {isCreating ? (
              <form onSubmit={handleCreateNew} className="flex flex-col gap-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  placeholder="New workspace name..."
                  className="w-full px-2 py-1 rounded bg-[#1e2027] border border-[#3b3e4f] text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setNewWsName('');
                    }}
                    className="px-2 py-0.5 rounded text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!newWsName.trim()}
                    className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[11px] font-medium text-white cursor-pointer shadow-xs"
                  >
                    Create
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center justify-center gap-1.5 py-1 rounded hover:bg-[#232530] text-[11px] font-medium text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                <span>New Blank Workspace</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

