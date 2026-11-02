import { create } from 'zustand';
import { WorkbenchTab } from '../types/domain';
import { WorkspaceService } from '../../bindings/dhub/internal/services';

export interface ConsoleRecord {
  id: string;
  title: string;
  connectionId: string;
  database: string;
  schema: string;
  content: string;
  updatedAt: number;
}

const contentSaveTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};

function persistWorksheet(record: ConsoleRecord) {
  WorkspaceService.SaveWorksheet({
    id: record.id,
    connectionId: record.connectionId || '',
    title: record.title || 'console.sql',
    content: record.content || '',
    targetDatabase: record.database || '',
    targetSchema: record.schema || '',
    isPinned: false,
    cursorLine: 1,
    cursorCol: 1,
    sortOrder: 0,
    updatedAt: new Date().toISOString(),
  }).catch((err) => {
    console.error('Failed to save worksheet to SQLite:', err);
  });
}

function debouncedSaveWorksheet(record: ConsoleRecord, delayMs = 400) {
  if (contentSaveTimeouts[record.id]) {
    clearTimeout(contentSaveTimeouts[record.id]);
  }
  contentSaveTimeouts[record.id] = setTimeout(() => {
    persistWorksheet(record);
    delete contentSaveTimeouts[record.id];
  }, delayMs);
}

const TAB_STORAGE_KEY = 'dhub_open_tabs';
const ACTIVE_TAB_STORAGE_KEY = 'dhub_active_tab_id';

function getSavedTabs(): { tabs: WorkbenchTab[]; activeTabId: string | null } {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { tabs: [], activeTabId: null };
  }
  try {
    const savedTabsRaw = localStorage.getItem(TAB_STORAGE_KEY);
    const savedActiveId = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (!savedTabsRaw) {
      return { tabs: [], activeTabId: null };
    }
    const parsed = JSON.parse(savedTabsRaw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { tabs: [], activeTabId: null };
    }
    const activeId = parsed.some((t: any) => t && t.id === savedActiveId)
      ? savedActiveId
      : parsed[0]?.id || null;
    return { tabs: parsed, activeTabId: activeId };
  } catch (e) {
    console.warn('Failed to parse saved tabs from localStorage:', e);
    return { tabs: [], activeTabId: null };
  }
}

function saveTabsToStorage(tabs: WorkbenchTab[], activeTabId: string | null) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(tabs));
    if (activeTabId) {
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
    } else {
      localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    }
  } catch (e) {
    console.warn('Failed to persist tabs to localStorage:', e);
  }
}

// Flush pending console saves and tabs state when window is closing
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    for (const id of Object.keys(contentSaveTimeouts)) {
      clearTimeout(contentSaveTimeouts[id]);
      delete contentSaveTimeouts[id];
      const target = useWorkbenchStore.getState().consoles.find((c) => c.id === id);
      if (target) {
        persistWorksheet(target);
      }
    }
    const { tabs, activeTabId } = useWorkbenchStore.getState();
    saveTabsToStorage(tabs, activeTabId);
  });
}

export interface TableStructureModalConfig {
  isOpen: boolean;
  mode: 'create' | 'edit';
  conn: any;
  database: string;
  schema?: string;
  tableName?: string;
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
  hasLoadedConsoles: boolean;
  tableStructureModal: TableStructureModalConfig;

  loadConsoles: () => Promise<void>;
  openTab: (tab: WorkbenchTab) => void;
  closeTab: (tabId: string) => void;
  closeTabsMatching: (predicate: (tab: WorkbenchTab) => boolean) => void;
  refreshTab: (tabId: string) => void;
  setActiveTabId: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  updateTabDatabase: (tabId: string, database: string, schema?: string) => void;
  updateTabConnection: (
    tabId: string,
    connectionId: string,
    database?: string,
    schema?: string
  ) => void;
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
  openCreateTableModal: (conn: any, database: string, schema?: string) => void;
  openEditTableModal: (conn: any, database: string, schema?: string, tableName?: string) => void;
  closeTableStructureModal: () => void;
}

const initialTabState = getSavedTabs();

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  tabs: initialTabState.tabs,
  activeTabId: initialTabState.activeTabId,
  activeBottomTab: 'result',
  isBottomPanelOpen: true,
  isRightPanelOpen: true,
  isSearchEverywhereOpen: false,
  isConnectionDialogOpen: false,
  editingConnectionId: null,
  tabRefreshTrigger: {},
  consoles: [],
  hasLoadedConsoles: false,
  tableStructureModal: {
    isOpen: false,
    mode: 'create',
    conn: null,
    database: '',
    schema: '',
    tableName: '',
  },

  openCreateTableModal: (conn, database, schema) => {
    set({
      tableStructureModal: {
        isOpen: true,
        mode: 'create',
        conn,
        database,
        schema: schema || (conn?.driver === 'postgres' ? 'public' : database),
        tableName: '',
      },
    });
  },

  openEditTableModal: (conn, database, schema, tableName) => {
    set({
      tableStructureModal: {
        isOpen: true,
        mode: 'edit',
        conn,
        database,
        schema: schema || (conn?.driver === 'postgres' ? 'public' : database),
        tableName: tableName || '',
      },
    });
  },

  closeTableStructureModal: () => {
    set((state) => ({
      tableStructureModal: {
        ...state.tableStructureModal,
        isOpen: false,
      },
    }));
  },

  loadConsoles: async () => {
    try {
      const list = await WorkspaceService.ListWorksheets('');
      if (list && list.length > 0) {
        const loaded: ConsoleRecord[] = list.map((w) => ({
          id: w.id,
          title: w.title,
          connectionId: w.connectionId || '',
          database: w.targetDatabase || '',
          schema: w.targetSchema || '',
          content: w.content || '',
          updatedAt: w.updatedAt ? new Date(w.updatedAt).getTime() : Date.now(),
        }));

        const { tabs } = get();

        // If user already had open worksheet tabs, sync their latest contents & titles from SQLite
        const updatedTabs = tabs.map((t) => {
          if (t.type === 'worksheet') {
            const match = loaded.find((c) => c.id === t.id);
            if (match) {
              return {
                ...t,
                title: match.title,
                content: match.content,
                database: match.database || t.database,
                schema: match.schema || t.schema,
                connectionId: match.connectionId || t.connectionId,
              };
            }
          }
          return t;
        });

        // NOTE: If tabs was empty on startup, keep it empty. Do not force-open all consoles!
        set({
          consoles: loaded,
          tabs: updatedTabs,
          hasLoadedConsoles: true,
        });
      } else {
        set({ hasLoadedConsoles: true });
      }
    } catch (err) {
      console.warn('Failed to load worksheets from SQLite:', err);
      set({ hasLoadedConsoles: true });
    }
  },

  openTab: (tab) => {
    const { tabs, consoles } = get();
    const existing = tabs.find((t) => t.id === tab.id);
    const nextTabs = existing ? tabs : [...tabs, tab];

    let nextConsoles = consoles;
    if (tab.type === 'worksheet' && !consoles.some((c) => c.id === tab.id)) {
      const newRecord: ConsoleRecord = {
        id: tab.id,
        title: tab.title,
        connectionId: tab.connectionId || '',
        database: tab.database || '',
        schema: tab.schema || '',
        content: tab.content || '',
        updatedAt: Date.now(),
      };
      nextConsoles = [...consoles, newRecord];
      persistWorksheet(newRecord);
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
    set((state) => {
      const updatedConsoles = state.consoles.map((c) =>
        c.id === tabId ? { ...c, content, updatedAt: Date.now() } : c
      );
      const targetConsole = updatedConsoles.find((c) => c.id === tabId);
      if (targetConsole) {
        debouncedSaveWorksheet(targetConsole);
      }
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, content, isDirty: true } : t
        ),
        consoles: updatedConsoles,
      };
    }),

  updateTabDatabase: (tabId, database, schema) => {
    const targetSchema = schema || (database === 'main' ? 'main' : database);
    return set((state) => {
      const updatedConsoles = state.consoles.map((c) =>
        c.id === tabId
          ? { ...c, database, schema: targetSchema, updatedAt: Date.now() }
          : c
      );
      const targetConsole = updatedConsoles.find((c) => c.id === tabId);
      if (targetConsole) {
        if (contentSaveTimeouts[tabId]) {
          clearTimeout(contentSaveTimeouts[tabId]);
          delete contentSaveTimeouts[tabId];
        }
        persistWorksheet(targetConsole);
      }
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, database, schema: targetSchema } : t
        ),
        consoles: updatedConsoles,
      };
    });
  },

  updateTabConnection: (tabId, connectionId, database, schema) =>
    set((state) => {
      const updatedConsoles = state.consoles.map((c) =>
        c.id === tabId
          ? {
              ...c,
              connectionId,
              database: database ?? c.database,
              schema: schema ?? c.schema,
              updatedAt: Date.now(),
            }
          : c
      );
      const targetConsole = updatedConsoles.find((c) => c.id === tabId);
      if (targetConsole) {
        if (contentSaveTimeouts[tabId]) {
          clearTimeout(contentSaveTimeouts[tabId]);
          delete contentSaveTimeouts[tabId];
        }
        persistWorksheet(targetConsole);
      }
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                connectionId,
                database: database ?? t.database,
                schema: schema ?? t.schema,
              }
            : t
        ),
        consoles: updatedConsoles,
      };
    }),

  renameTab: (tabId, newTitle) => {
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) return;
    set((state) => {
      const updatedConsoles = state.consoles.map((c) =>
        c.id === tabId ? { ...c, title: cleanTitle, updatedAt: Date.now() } : c
      );
      const targetConsole = updatedConsoles.find((c) => c.id === tabId);
      if (targetConsole) {
        if (contentSaveTimeouts[tabId]) {
          clearTimeout(contentSaveTimeouts[tabId]);
          delete contentSaveTimeouts[tabId];
        }
        persistWorksheet(targetConsole);
      }
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, title: cleanTitle } : t
        ),
        consoles: updatedConsoles,
      };
    });
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

    persistWorksheet(newConsole);
    return id;
  },

  deleteConsole: (id) => {
    const { tabs, activeTabId, consoles } = get();
    if (contentSaveTimeouts[id]) {
      clearTimeout(contentSaveTimeouts[id]);
      delete contentSaveTimeouts[id];
    }
    WorkspaceService.DeleteWorksheet(id).catch((err) => {
      console.warn('Failed to delete worksheet from SQLite:', err);
    });

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

// Automatically persist open tabs and active tab to localStorage on any state changes
if (typeof window !== 'undefined') {
  useWorkbenchStore.subscribe((state) => {
    saveTabsToStorage(state.tabs, state.activeTabId);
  });
}
