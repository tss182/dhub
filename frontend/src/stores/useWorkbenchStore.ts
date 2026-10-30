import { create } from 'zustand';
import { WorkbenchTab } from '../types/domain';

interface WorkbenchState {
  tabs: WorkbenchTab[];
  activeTabId: string | null;
  activeBottomTab: 'result' | 'output' | 'history' | 'explain';
  isBottomPanelOpen: boolean;
  isSearchEverywhereOpen: boolean;
  isConnectionDialogOpen: boolean;
  editingConnectionId: string | null;

  openTab: (tab: WorkbenchTab) => void;
  closeTab: (tabId: string) => void;
  setActiveTabId: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  setActiveBottomTab: (tab: 'result' | 'output' | 'history' | 'explain') => void;
  toggleBottomPanel: () => void;
  setSearchEverywhereOpen: (open: boolean) => void;
  setConnectionDialogOpen: (open: boolean, editingId?: string | null) => void;
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  tabs: [
    {
      id: 'default-console',
      type: 'worksheet',
      title: 'console_1.sql',
      connectionId: '',
      database: '',
      schema: '',
      content: `-- DHub DataGrip-grade Query Console\n-- Shortcut: Ctrl+Enter (Run at cursor), Ctrl+P / Cmd+P (Search Everywhere)\n\nSELECT 1 as id, 'Welcome to DHub' as message;\n`,
    },
  ],
  activeTabId: 'default-console',
  activeBottomTab: 'result',
  isBottomPanelOpen: true,
  isSearchEverywhereOpen: false,
  isConnectionDialogOpen: false,
  editingConnectionId: null,

  openTab: (tab) => {
    const existing = get().tabs.find((t) => t.id === tab.id);
    if (!existing) {
      set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
    } else {
      set({ activeTabId: tab.id });
    }
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const filtered = tabs.filter((t) => t.id !== tabId);
    let nextActive = activeTabId;
    if (activeTabId === tabId) {
      nextActive = filtered.length > 0 ? filtered[filtered.length - 1].id : null;
    }
    set({ tabs: filtered, activeTabId: nextActive });
  },

  setActiveTabId: (activeTabId) => set({ activeTabId }),

  updateTabContent: (tabId, content) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, content, isDirty: true } : t
      ),
    })),

  setActiveBottomTab: (activeBottomTab) =>
    set({ activeBottomTab, isBottomPanelOpen: true }),

  toggleBottomPanel: () =>
    set((state) => ({ isBottomPanelOpen: !state.isBottomPanelOpen })),

  setSearchEverywhereOpen: (isSearchEverywhereOpen) =>
    set({ isSearchEverywhereOpen }),

  setConnectionDialogOpen: (isConnectionDialogOpen, editingConnectionId = null) =>
    set({ isConnectionDialogOpen, editingConnectionId }),
}));

