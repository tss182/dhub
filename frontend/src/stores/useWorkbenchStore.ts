import { create } from 'zustand';
import { WorkbenchTab } from '../types/domain';

export interface ConsoleRecord {
  id: string;
  title: string;
  connectionId: string;
  database: string;
  schema: string;
  content: string;
  updatedAt: number;
}

interface WorkbenchState {
  tabs: WorkbenchTab[];
  activeTabId: string | null;
  activeBottomTab: 'result' | 'output' | 'history' | 'explain';
  isBottomPanelOpen: boolean;
  isRightPanelOpen: boolean;
  isSearchEverywhereOpen: boolean;
  isConnectionDialogOpen: boolean;
  editingConnectionId: string | null;
  tabRefreshTrigger: Record<string, number>;
  consoles: ConsoleRecord[];

  openTab: (tab: WorkbenchTab) => void;
  closeTab: (tabId: string) => void;
  closeTabsMatching: (predicate: (tab: WorkbenchTab) => boolean) => void;
  refreshTab: (tabId: string) => void;
  setActiveTabId: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  renameTab: (tabId: string, newTitle: string) => void;
  duplicateTab: (tabId: string) => void;
  createConsole: (
    connectionId?: string,
    database?: string,
    schema?: string,
    title?: string,
    content?: string
  ) => string;
  deleteConsole: (id: string) => void;
  setActiveBottomTab: (tab: 'result' | 'output' | 'history' | 'explain') => void;
  toggleBottomPanel: () => void;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  setSearchEverywhereOpen: (open: boolean) => void;
  setConnectionDialogOpen: (open: boolean, editingId?: string | null) => void;
}

const DEFAULT_CONSOLE_ID = 'default-console';
const DEFAULT_CONSOLE_CONTENT = `-- DHub DataGrip-grade Query Console\n-- Shortcut: Ctrl+Enter (Run at cursor), Ctrl+P / Cmd+P (Search Everywhere)\n\nSELECT 1 as id, 'Welcome to DHub' as message;\n`;

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  tabs: [
    {
      id: DEFAULT_CONSOLE_ID,
      type: 'worksheet',
      title: 'console_1.sql',
      connectionId: '',
      database: '',
      schema: '',
      content: DEFAULT_CONSOLE_CONTENT,
    },
  ],
  activeTabId: DEFAULT_CONSOLE_ID,
  activeBottomTab: 'result',
  isBottomPanelOpen: true,
  isRightPanelOpen: true,
  isSearchEverywhereOpen: false,
  isConnectionDialogOpen: false,
  editingConnectionId: null,
  tabRefreshTrigger: {},
  consoles: [
    {
      id: DEFAULT_CONSOLE_ID,
      title: 'console_1.sql',
      connectionId: '',
      database: '',
      schema: '',
      content: DEFAULT_CONSOLE_CONTENT,
      updatedAt: Date.now(),
    },
  ],

  openTab: (tab) => {
    const { tabs, consoles } = get();
    const existing = tabs.find((t) => t.id === tab.id);
    const nextTabs = existing ? tabs : [...tabs, tab];

    let nextConsoles = consoles;
    if (tab.type === 'worksheet' && !consoles.some((c) => c.id === tab.id)) {
      nextConsoles = [
        ...consoles,
        {
          id: tab.id,
          title: tab.title,
          connectionId: tab.connectionId || '',
          database: tab.database || '',
          schema: tab.schema || '',
          content: tab.content || '',
          updatedAt: Date.now(),
        },
      ];
    }

    set({ tabs: nextTabs, activeTabId: tab.id, consoles: nextConsoles });
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

  closeTabsMatching: (predicate) => {
    const { tabs, activeTabId } = get();
    const filtered = tabs.filter((t) => !predicate(t));
    let nextActive = activeTabId;
    if (activeTabId && !filtered.some((t) => t.id === activeTabId)) {
      nextActive = filtered.length > 0 ? filtered[filtered.length - 1].id : null;
    }
    set({ tabs: filtered, activeTabId: nextActive });
  },

  refreshTab: (tabId) => {
    set((state) => ({
      tabRefreshTrigger: {
        ...state.tabRefreshTrigger,
        [tabId]: (state.tabRefreshTrigger[tabId] || 0) + 1,
      },
    }));
  },

  setActiveTabId: (activeTabId) => set({ activeTabId }),

  updateTabContent: (tabId, content) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, content, isDirty: true } : t
      ),
      consoles: state.consoles.map((c) =>
        c.id === tabId ? { ...c, content, updatedAt: Date.now() } : c
      ),
    })),

  renameTab: (tabId, newTitle) => {
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) return;
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, title: cleanTitle } : t
      ),
      consoles: state.consoles.map((c) =>
        c.id === tabId ? { ...c, title: cleanTitle } : c
      ),
    }));
  },

  duplicateTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const newId = `console-${Date.now()}`;
    const newTitle = tab.title.includes('.')
      ? tab.title.replace(/(\.[^.]+)$/, '_copy$1')
      : `${tab.title}_copy`;
    get().openTab({
      ...tab,
      id: newId,
      title: newTitle,
    });
  },

  createConsole: (connectionId = '', database = '', schema = '', title, content) => {
    const { consoles } = get();
    const id = `console-${Date.now()}`;
    const defaultTitle = title || `console_${consoles.length + 1}.sql`;
    const defaultContent =
      content ||
      `-- Query Console: ${defaultTitle}\n-- Shortcut: Ctrl+Enter (Run at cursor), Ctrl+P / Cmd+P (Search Everywhere)\n\nSELECT 1;\n`;

    const newConsole: ConsoleRecord = {
      id,
      title: defaultTitle,
      connectionId,
      database,
      schema,
      content: defaultContent,
      updatedAt: Date.now(),
    };

    const newTab: WorkbenchTab = {
      id,
      type: 'worksheet',
      title: defaultTitle,
      connectionId,
      database,
      schema,
      content: defaultContent,
    };

    set((state) => ({
      consoles: [...state.consoles, newConsole],
      tabs: [...state.tabs, newTab],
      activeTabId: id,
    }));
    return id;
  },

  deleteConsole: (id) => {
    const { tabs, activeTabId, consoles } = get();
    const filteredTabs = tabs.filter((t) => t.id !== id);
    let nextActive = activeTabId;
    if (activeTabId === id) {
      nextActive = filteredTabs.length > 0 ? filteredTabs[filteredTabs.length - 1].id : null;
    }
    set({
      consoles: consoles.filter((c) => c.id !== id),
      tabs: filteredTabs,
      activeTabId: nextActive,
    });
  },

  setActiveBottomTab: (activeBottomTab) =>
    set({ activeBottomTab, isBottomPanelOpen: true }),

  toggleBottomPanel: () =>
    set((state) => ({ isBottomPanelOpen: !state.isBottomPanelOpen })),

  toggleRightPanel: () =>
    set((state) => ({ isRightPanelOpen: !state.isRightPanelOpen })),

  setRightPanelOpen: (isRightPanelOpen) => set({ isRightPanelOpen }),

  setSearchEverywhereOpen: (isSearchEverywhereOpen) =>
    set({ isSearchEverywhereOpen }),

  setConnectionDialogOpen: (isConnectionDialogOpen, editingConnectionId = null) =>
    set({ isConnectionDialogOpen, editingConnectionId }),
}));
