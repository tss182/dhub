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

let tabsSqliteTimeout: ReturnType<typeof setTimeout> | null = null;

function saveTabsToStorage(tabs: WorkbenchTab[], activeTabId: string | null) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const serializedTabs = JSON.stringify(tabs);
    localStorage.setItem(TAB_STORAGE_KEY, serializedTabs);
    if (activeTabId) {
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
    } else {
      localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    }

    if (tabsSqliteTimeout) {
      clearTimeout(tabsSqliteTimeout);
    }
    tabsSqliteTimeout = setTimeout(() => {
      WorkspaceService.SaveSetting(TAB_STORAGE_KEY, serializedTabs).catch(() => {});
      WorkspaceService.SaveSetting(ACTIVE_TAB_STORAGE_KEY, activeTabId || '').catch(() => {});
    }, 350);
  } catch (e) {
    console.warn('Failed to persist tabs:', e);
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
  isLeftPanelOpen: boolean;
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
  reorderTab: (draggedTabId: string, targetTabId: string, position: 'before' | 'after') => void;
  swapTabs: (tabIdA: string, tabIdB: string) => void;
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
  toggleLeftPanel: () => void;
  setLeftPanelOpen: (open: boolean) => void;
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
  isLeftPanelOpen: (() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('dhub_left_sidebar_open');
      if (saved !== null) return saved === 'true';
    }
    return true;
  })(),
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

  reorderTab: (draggedTabId, targetTabId, position) =>
    set((state) => {
      if (draggedTabId === targetTabId) return state;
      const draggedTab = state.tabs.find((t) => t.id === draggedTabId);
      if (!draggedTab) return state;
      const remaining = state.tabs.filter((t) => t.id !== draggedTabId);
      const targetIndex = remaining.findIndex((t) => t.id === targetTabId);
      if (targetIndex === -1) return state;
      const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
      const nextTabs = [...remaining];
      nextTabs.splice(insertIndex, 0, draggedTab);
      return { tabs: nextTabs };
    }),

  swapTabs: (tabIdA, tabIdB) =>
    set((state) => {
      if (tabIdA === tabIdB) return state;
      const idxA = state.tabs.findIndex((t) => t.id === tabIdA);
      const idxB = state.tabs.findIndex((t) => t.id === tabIdB);
      if (idxA === -1 || idxB === -1) return state;
      const nextTabs = [...state.tabs];
      const temp = nextTabs[idxA];
      nextTabs[idxA] = nextTabs[idxB];
      nextTabs[idxB] = temp;
      return { tabs: nextTabs };
    }),

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

  toggleLeftPanel: () =>
    set((state) => {
      const next = !state.isLeftPanelOpen;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dhub_left_sidebar_open', String(next));
      }
      return { isLeftPanelOpen: next };
    }),

  setLeftPanelOpen: (isLeftPanelOpen) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('dhub_left_sidebar_open', String(isLeftPanelOpen));
    }
    set({ isLeftPanelOpen });
  },

  setSearchEverywhereOpen: (isSearchEverywhereOpen) =>
    set({ isSearchEverywhereOpen }),

  setConnectionDialogOpen: (isConnectionDialogOpen, editingConnectionId = null) =>
    set({ isConnectionDialogOpen, editingConnectionId }),
}));

// Automatically persist open tabs and active tab to SQLite & localStorage on any state changes
if (typeof window !== 'undefined') {
  useWorkbenchStore.subscribe((state) => {
    saveTabsToStorage(state.tabs, state.activeTabId);
  });

  WorkspaceService.GetSettings()
    .then((settings) => {
      if (!settings) return;
      const currentTabs = useWorkbenchStore.getState().tabs;
      if (currentTabs.length === 0 && settings[TAB_STORAGE_KEY]) {
        try {
          const parsed = JSON.parse(settings[TAB_STORAGE_KEY]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const savedActiveId = settings[ACTIVE_TAB_STORAGE_KEY] || null;
            const activeId = parsed.some((t: any) => t && t.id === savedActiveId)
              ? savedActiveId
              : parsed[0]?.id || null;
            useWorkbenchStore.setState({ tabs: parsed, activeTabId: activeId });
          }
        } catch {
          // ignore
        }
      }
    })
    .catch(() => {});
}
