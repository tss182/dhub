import { create } from 'zustand';
import { ConnectionConfig, ConnectionFolder, ObjectSummary } from '../types/domain';

const FOLDERS_STORAGE_KEY = 'dhub_connection_folders_v1';
const CONN_FOLDER_MAP_KEY = 'dhub_connection_folder_map_v1';
const CONN_ORDER_KEY = 'dhub_connection_order_v1';

function loadFoldersFromStorage(): ConnectionFolder[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(FOLDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadConnFolderMap(): Record<string, string | null> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = localStorage.getItem(CONN_FOLDER_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function loadConnOrder(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(CONN_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFolderState(
  folders: ConnectionFolder[],
  connectionFolders: Record<string, string | null>,
  connectionOrder: string[]
) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
    localStorage.setItem(CONN_FOLDER_MAP_KEY, JSON.stringify(connectionFolders));
    localStorage.setItem(CONN_ORDER_KEY, JSON.stringify(connectionOrder));
  } catch (e) {
    console.warn('Failed to persist connection folders/order:', e);
  }
}

function sortConnectionsList(conns: ConnectionConfig[], order: string[]): ConnectionConfig[] {
  if (!order || order.length === 0) return conns;
  const orderMap = new Map<string, number>();
  order.forEach((id, idx) => orderMap.set(id, idx));
  return [...conns].sort((a, b) => {
    const idxA = orderMap.has(a.id) ? orderMap.get(a.id)! : 999999;
    const idxB = orderMap.has(b.id) ? orderMap.get(b.id)! : 999999;
    if (idxA !== idxB) return idxA - idxB;
    return 0;
  });
}

interface ConnectionState {
  connections: ConnectionConfig[];
  folders: ConnectionFolder[];
  connectionFolders: Record<string, string | null>;
  connectionOrder: string[];
  pendingFolderIdForNewConn: string | null;
  activeConnectionId: string | null;
  activeDatabase: string;
  activeSchema: string;
  treeDatabases: Record<string, string[]>; // key: connId -> ['db1', 'db2']
  treeObjects: Record<string, ObjectSummary[]>; // key: connId:db:schema
  expandedNodes: Record<string, boolean>;
  isLoading: boolean;
  selectedTable: string | null;

  setConnections: (conns: ConnectionConfig[]) => void;
  setActiveConnection: (id: string, database?: string, schema?: string) => void;
  setTreeDatabases: (connId: string, databases: string[]) => void;
  removeTreeDatabase: (connId: string, database: string) => void;
  setTreeObjects: (key: string, objects: ObjectSummary[]) => void;
  removeTreeObject: (key: string, objectName: string) => void;
  toggleNode: (nodeKey: string) => void;
  setNodeExpanded: (nodeKey: string, expanded: boolean) => void;
  setSelectedTable: (table: string | null) => void;
  setLoading: (loading: boolean) => void;

  // Folder & Ordering actions
  setPendingFolderIdForNewConn: (folderId: string | null) => void;
  createFolder: (name: string, color?: string) => string;
  renameFolder: (folderId: string, name: string, color?: string) => void;
  deleteFolder: (folderId: string) => void;
  moveConnectionToFolder: (connId: string, folderId: string | null) => void;
  reorderConnection: (
    draggedConnId: string,
    targetConnId: string,
    position: 'before' | 'after',
    targetFolderId: string | null
  ) => void;
  reorderFolder: (
    draggedFolderId: string,
    targetFolderId: string,
    position: 'before' | 'after'
  ) => void;
}

const initialFolders = loadFoldersFromStorage();
const initialConnFolderMap = loadConnFolderMap();
const initialConnOrder = loadConnOrder();
const initialExpandedFolders: Record<string, boolean> = {};
initialFolders.forEach((f) => {
  initialExpandedFolders[`folder:${f.id}`] = true;
});

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  folders: initialFolders,
  connectionFolders: initialConnFolderMap,
  connectionOrder: initialConnOrder,
  pendingFolderIdForNewConn: null,
  activeConnectionId: null,
  activeDatabase: '',
  activeSchema: '',
  treeDatabases: {},
  treeObjects: {},
  expandedNodes: initialExpandedFolders,
  isLoading: false,
  selectedTable: null,

  setConnections: (rawConns) =>
    set((state) => {
      const existingOrder = state.connectionOrder;
      const newIds = rawConns.map((c) => c.id);
      const mergedOrder = [
        ...existingOrder.filter((id) => newIds.includes(id)),
        ...newIds.filter((id) => !existingOrder.includes(id)),
      ];
      const sorted = sortConnectionsList(rawConns, mergedOrder);
      saveFolderState(state.folders, state.connectionFolders, mergedOrder);
      return {
        connections: sorted,
        connectionOrder: mergedOrder,
      };
    }),
  setActiveConnection: (id, database = '', schema = '') =>
    set({
      activeConnectionId: id,
      activeDatabase: database,
      activeSchema: schema,
    }),
  setTreeDatabases: (connId, databases) =>
    set((state) => ({
      treeDatabases: { ...state.treeDatabases, [connId]: databases },
    })),
  removeTreeDatabase: (connId, database) =>
    set((state) => ({
      treeDatabases: {
        ...state.treeDatabases,
        [connId]: (state.treeDatabases[connId] || []).filter((db) => db !== database),
      },
    })),
  setTreeObjects: (key, objects) =>
    set((state) => ({
      treeObjects: { ...state.treeObjects, [key]: objects },
    })),
  removeTreeObject: (key, objectName) =>
    set((state) => ({
      treeObjects: {
        ...state.treeObjects,
        [key]: (state.treeObjects[key] || []).filter((o) => o.name !== objectName),
      },
    })),
  toggleNode: (nodeKey) =>
    set((state) => ({
      expandedNodes: {
        ...state.expandedNodes,
        [nodeKey]: !state.expandedNodes[nodeKey],
      },
    })),
  setNodeExpanded: (nodeKey, expanded) =>
    set((state) => ({
      expandedNodes: {
        ...state.expandedNodes,
        [nodeKey]: expanded,
      },
    })),
  setSelectedTable: (table) => set({ selectedTable: table }),
  setLoading: (loading) => set({ isLoading: loading }),

  setPendingFolderIdForNewConn: (folderId) => set({ pendingFolderIdForNewConn: folderId }),

  createFolder: (name, color = '#3b82f6') => {
    const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const cleanName = name.trim() || 'New Folder';
    const newFolder: ConnectionFolder = { id, name: cleanName, color };
    set((state) => {
      const nextFolders = [...state.folders, newFolder];
      saveFolderState(nextFolders, state.connectionFolders, state.connectionOrder);
      return {
        folders: nextFolders,
        expandedNodes: {
          ...state.expandedNodes,
          [`folder:${id}`]: true,
        },
      };
    });
    return id;
  },

  renameFolder: (folderId, name, color) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    set((state) => {
      const nextFolders = state.folders.map((f) =>
        f.id === folderId ? { ...f, name: cleanName, color: color ?? f.color } : f
      );
      saveFolderState(nextFolders, state.connectionFolders, state.connectionOrder);
      return { folders: nextFolders };
    });
  },

  deleteFolder: (folderId) => {
    set((state) => {
      const nextFolders = state.folders.filter((f) => f.id !== folderId);
      const nextMap = { ...state.connectionFolders };
      Object.keys(nextMap).forEach((connId) => {
        if (nextMap[connId] === folderId) {
          delete nextMap[connId];
        }
      });
      saveFolderState(nextFolders, nextMap, state.connectionOrder);
      return {
        folders: nextFolders,
        connectionFolders: nextMap,
      };
    });
  },

  moveConnectionToFolder: (connId, folderId) => {
    set((state) => {
      const nextMap = { ...state.connectionFolders };
      if (folderId) {
        nextMap[connId] = folderId;
      } else {
        delete nextMap[connId];
      }
      saveFolderState(state.folders, nextMap, state.connectionOrder);
      return {
        connectionFolders: nextMap,
        expandedNodes: folderId
          ? { ...state.expandedNodes, [`folder:${folderId}`]: true }
          : state.expandedNodes,
      };
    });
  },

  reorderConnection: (draggedConnId, targetConnId, position, targetFolderId) => {
    set((state) => {
      const nextMap = { ...state.connectionFolders };
      if (targetFolderId) {
        nextMap[draggedConnId] = targetFolderId;
      } else {
        delete nextMap[draggedConnId];
      }

      const currentIds = state.connections.map((c) => c.id);
      const baseOrder = [
        ...state.connectionOrder.filter((id) => currentIds.includes(id)),
        ...currentIds.filter((id) => !state.connectionOrder.includes(id)),
      ];

      if (draggedConnId !== targetConnId) {
        const withoutDragged = baseOrder.filter((id) => id !== draggedConnId);
        const targetIdx = withoutDragged.indexOf(targetConnId);
        if (targetIdx !== -1) {
          const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
          withoutDragged.splice(insertIdx, 0, draggedConnId);
        } else {
          withoutDragged.push(draggedConnId);
        }
        const sorted = sortConnectionsList(state.connections, withoutDragged);
        saveFolderState(state.folders, nextMap, withoutDragged);
        return {
          connections: sorted,
          connectionFolders: nextMap,
          connectionOrder: withoutDragged,
        };
      }

      saveFolderState(state.folders, nextMap, baseOrder);
      return {
        connectionFolders: nextMap,
      };
    });
  },

  reorderFolder: (draggedFolderId, targetFolderId, position) => {
    if (draggedFolderId === targetFolderId) return;
    set((state) => {
      const withoutDragged = state.folders.filter((f) => f.id !== draggedFolderId);
      const draggedFolder = state.folders.find((f) => f.id === draggedFolderId);
      if (!draggedFolder) return state;

      const targetIdx = withoutDragged.findIndex((f) => f.id === targetFolderId);
      if (targetIdx !== -1) {
        const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
        withoutDragged.splice(insertIdx, 0, draggedFolder);
      } else {
        withoutDragged.push(draggedFolder);
      }

      saveFolderState(withoutDragged, state.connectionFolders, state.connectionOrder);
      return { folders: withoutDragged };
    });
  },
}));

