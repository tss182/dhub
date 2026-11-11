import { create } from 'zustand';
import { WorkspaceService } from '../../bindings/dhub/internal/services';
import { WorkspaceItem, WorkbenchTab } from '../types/domain';
import { alertSuccess, alertError, alertWarning } from './useAlertStore';
import { useWorkbenchStore } from './useWorkbenchStore';

interface WorkspaceSessionState {
  workspaces: WorkspaceItem[];
  activeWorkspaceId: string | null;
  isLoading: boolean;
  hasLoaded: boolean;

  loadWorkspaces: () => Promise<void>;
  createBlankWorkspace: (name: string, colorTag?: string) => Promise<string | null>;
  switchWorkspace: (
    workspaceId: string,
    getCurrentTabsState: () => { tabs: WorkbenchTab[]; activeTabId: string | null },
    applyTabsState: (tabs: WorkbenchTab[], activeTabId: string | null) => void
  ) => Promise<void>;
  saveCurrentWorkspace: (
    tabs: WorkbenchTab[],
    activeTabId: string | null
  ) => Promise<void>;
  renameWorkspace: (id: string, newName: string) => Promise<void>;
  deleteWorkspace: (
    id: string,
    onDeletedActive?: () => void
  ) => Promise<void>;
  updateWorkspaceMetadata: (
    id: string,
    updates: Partial<Pick<WorkspaceItem, 'name' | 'colorTag' | 'description' | 'icon'>>
  ) => Promise<void>;
}

let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;

export const useWorkspaceSessionStore = create<WorkspaceSessionState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  isLoading: false,
  hasLoaded: false,

  loadWorkspaces: async () => {
    set({ isLoading: true });
    try {
      const list = await WorkspaceService.ListWorkspaces();
      const safeList: WorkspaceItem[] = (list || []).map((w: any) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        icon: w.icon || 'briefcase',
        colorTag: w.colorTag || '#3b82f6',
        isActive: Boolean(w.isActive),
        tabsJson: w.tabsJson || '[]',
        activeTabId: w.activeTabId || '',
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      }));

      let activeId = safeList.find((w) => w.isActive)?.id || null;
      if (!activeId && safeList.length > 0) {
        activeId = safeList[0].id;
      }

      // If no workspace exists yet in SQLite, auto-create "Default Workspace"
      if (safeList.length === 0) {
        const currentTabs = useWorkbenchStore.getState().tabs || [];
        const currentActiveId = useWorkbenchStore.getState().activeTabId || '';
        const defaultWs: WorkspaceItem = {
          id: '',
          name: 'Default Workspace',
          description: 'Primary workspace',
          icon: 'briefcase',
          colorTag: '#3b82f6',
          isActive: true,
          tabsJson: JSON.stringify(currentTabs),
          activeTabId: currentActiveId,
        };
        try {
          const newId = await WorkspaceService.SaveWorkspace(defaultWs as any);
          defaultWs.id = newId;
          safeList.push(defaultWs);
          activeId = newId;
        } catch (e) {
          console.warn('Failed to auto-seed default workspace:', e);
        }
      } else if (activeId) {
        // Restore active workspace tabs if workbench tabs are currently empty
        const activeWs = safeList.find((w) => w.id === activeId);
        if (activeWs && activeWs.tabsJson && activeWs.tabsJson !== '[]') {
          try {
            const currentTabs = useWorkbenchStore.getState().tabs;
            if (!currentTabs || currentTabs.length === 0) {
              const restoredTabs = JSON.parse(activeWs.tabsJson);
              if (Array.isArray(restoredTabs) && restoredTabs.length > 0) {
                useWorkbenchStore.setState({
                  tabs: restoredTabs,
                  activeTabId: activeWs.activeTabId || restoredTabs[0]?.id || null,
                });
              }
            }
          } catch (e) {
            console.warn('Failed to restore active workspace tabs:', e);
          }
        }
      }

      set({
        workspaces: safeList,
        activeWorkspaceId: activeId,
        isLoading: false,
        hasLoaded: true,
      });
    } catch (err: any) {
      console.warn('Failed to load workspaces:', err);
      set({ isLoading: false, hasLoaded: true });
    }
  },

  createBlankWorkspace: async (name: string, colorTag = '#3b82f6') => {
    const cleanName = name.trim();
    if (!cleanName) {
      alertWarning('Workspace name cannot be empty.');
      return null;
    }

    try {
      const newWs: WorkspaceItem = {
        id: '',
        name: cleanName,
        description: '',
        icon: 'briefcase',
        colorTag,
        isActive: true,
        tabsJson: '[]',
        activeTabId: '',
      };

      const savedId = await WorkspaceService.SaveWorkspace(newWs as any);
      newWs.id = savedId;

      set((state) => ({
        workspaces: [
          newWs,
          ...state.workspaces.map((w) => ({ ...w, isActive: false })),
        ],
        activeWorkspaceId: savedId,
      }));

      alertSuccess(`Workspace "${cleanName}" created!`);
      return savedId;
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to create workspace');
      return null;
    }
  },

  switchWorkspace: async (targetId, getCurrentTabsState, applyTabsState) => {
    const { workspaces, activeWorkspaceId } = get();
    if (activeWorkspaceId === targetId) return;

    // 1. Flush & Auto-save current active workspace tabs first
    if (activeWorkspaceId) {
      const current = getCurrentTabsState();
      try {
        const currentWs = workspaces.find((w) => w.id === activeWorkspaceId);
        if (currentWs) {
          await WorkspaceService.SaveWorkspace({
            ...currentWs,
            tabsJson: JSON.stringify(current.tabs),
            activeTabId: current.activeTabId || '',
          } as any);
        }
      } catch (e) {
        console.warn('Failed to snapshot current workspace before switch:', e);
      }
    }

    // 2. Load target workspace
    try {
      const target = workspaces.find((w) => w.id === targetId);
      if (!target) return;

      await WorkspaceService.SetActiveWorkspace(targetId);

      let loadedTabs: WorkbenchTab[] = [];
      try {
        loadedTabs = JSON.parse(target.tabsJson || '[]');
      } catch {
        loadedTabs = [];
      }

      set((state) => ({
        activeWorkspaceId: targetId,
        workspaces: state.workspaces.map((w) => ({
          ...w,
          isActive: w.id === targetId,
        })),
      }));

      // Apply restored tabs into workbench store
      applyTabsState(loadedTabs, target.activeTabId || (loadedTabs[0]?.id ?? null));
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to switch workspace');
    }
  },

  saveCurrentWorkspace: async (tabs, activeTabId) => {
    const { activeWorkspaceId, workspaces } = get();
    if (!activeWorkspaceId) return;

    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }

    autoSaveTimeout = setTimeout(async () => {
      const target = workspaces.find((w) => w.id === activeWorkspaceId);
      if (!target) return;

      const serializedTabs = JSON.stringify(tabs);
      try {
        await WorkspaceService.SaveWorkspace({
          ...target,
          tabsJson: serializedTabs,
          activeTabId: activeTabId || '',
          isActive: true,
        } as any);

        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === activeWorkspaceId
              ? {
                  ...w,
                  tabsJson: serializedTabs,
                  activeTabId: activeTabId || '',
                  updatedAt: new Date().toISOString(),
                }
              : w
          ),
        }));
      } catch (e) {
        console.warn('Auto-save workspace failed:', e);
      }
    }, 500);
  },

  renameWorkspace: async (id, newName) => {
    const clean = newName.trim();
    if (!clean) return;
    try {
      await WorkspaceService.RenameWorkspace(id, clean);
      set((state) => ({
        workspaces: state.workspaces.map((w) =>
          w.id === id ? { ...w, name: clean, updatedAt: new Date().toISOString() } : w
        ),
      }));
      alertSuccess(`Workspace renamed to "${clean}"`);
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to rename workspace');
    }
  },

  deleteWorkspace: async (id, onDeletedActive) => {
    try {
      await WorkspaceService.DeleteWorkspace(id);
      const { workspaces, activeWorkspaceId } = get();
      const remaining = workspaces.filter((w) => w.id !== id);
      const isDeletingActive = activeWorkspaceId === id;

      let nextActiveId = activeWorkspaceId;
      if (isDeletingActive) {
        nextActiveId = remaining.length > 0 ? remaining[0].id : null;
        if (nextActiveId) {
          await WorkspaceService.SetActiveWorkspace(nextActiveId);
        }
      }

      set({
        workspaces: remaining.map((w) => ({
          ...w,
          isActive: w.id === nextActiveId,
        })),
        activeWorkspaceId: nextActiveId,
      });

      if (isDeletingActive && onDeletedActive) {
        onDeletedActive();
      }

      alertSuccess('Workspace deleted successfully.');
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to delete workspace');
    }
  },

  updateWorkspaceMetadata: async (id, updates) => {
    const target = get().workspaces.find((w) => w.id === id);
    if (!target) return;
    const updated = { ...target, ...updates };
    try {
      await WorkspaceService.SaveWorkspace(updated as any);
      set((state) => ({
        workspaces: state.workspaces.map((w) => (w.id === id ? updated : w)),
      }));
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to update workspace');
    }
  },
}));

// Auto-sync workbench tabs state into active workspace in SQLite
if (typeof window !== 'undefined') {
  useWorkbenchStore.subscribe((state) => {
    const activeWsId = useWorkspaceSessionStore.getState().activeWorkspaceId;
    if (activeWsId) {
      useWorkspaceSessionStore.getState().saveCurrentWorkspace(state.tabs, state.activeTabId);
    }
  });
}

