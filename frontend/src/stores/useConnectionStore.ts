import { create } from 'zustand';
import { ConnectionConfig, ConnectionFolder, ObjectSummary } from '../types/domain';
import { ConnectionService } from '../../bindings/dhub/internal/services';

const LEGACY_FOLDERS_KEY = 'dhub_connection_folders_v1';
const LEGACY_CONN_FOLDER_MAP_KEY = 'dhub_connection_folder_map_v1';
const LEGACY_CONN_ORDER_KEY = 'dhub_connection_order_v1';

function sortConnectionsList(conns: ConnectionConfig[], order: string[]): ConnectionConfig[] {
  if (!order || order.length === 0) return conns;
  const orderMap = new Map<string, number>();
  order.forEach((id, idx) => orderMap.set(id, idx));
  return [...conns].sort((a, b) => {
    const idxA = orderMap.has(a.id) ? orderMap.get(a.id)! : (a.sortOrder ?? 999999);
    const idxB = orderMap.has(b.id) ? orderMap.get(b.id)! : (b.sortOrder ?? 999999);
    if (idxA !== idxB) return idxA - idxB;
    return (a.name || '').localeCompare(b.name || '');
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
  setFolders: (folders: ConnectionFolder[]) => void;
  loadConnectionsAndFolders: () => Promise<ConnectionConfig[]>;
  setActiveConnection: (id: string, database?: string, schema?: string) => void;
  setTreeDatabases: (connId: string, databases: string[]) => void;
  removeTreeDatabase: (connId: string, database: string) => void;
  setTreeObjects: (key: string, objects: ObjectSummary[]) => void;
  removeTreeObject: (key: string, objectName: string) => void;
  toggleNode: (nodeKey: string) => void;
  setNodeExpanded: (nodeKey: string, expanded: boolean) => void;
  setSelectedTable: (table: string | null) => void;
  setLoading: (loading: boolean) => void;

  // Folder & Ordering actions (persisted to SQLite)
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

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  folders: [],
  connectionFolders: {},
  connectionOrder: [],
  pendingFolderIdForNewConn: null,
  activeConnectionId: null,
  activeDatabase: '',
  activeSchema: '',
  treeDatabases: {},
  treeObjects: {},
  expandedNodes: {},
  isLoading: false,
  selectedTable: null,

  setFolders: (folders) =>
    set((state) => {
      const nextExpanded = { ...state.expandedNodes };
      folders.forEach((f) => {
        if (nextExpanded[`folder:${f.id}`] === undefined) {
          nextExpanded[`folder:${f.id}`] = true;
        }
      });
      return {
        folders,
        expandedNodes: nextExpanded,
      };
    }),

  setConnections: (rawConns) =>
    set((state) => {
      const list = rawConns || [];
      const nextMap: Record<string, string | null> = {};
      list.forEach((c) => {
        if (c.folderId) {
          nextMap[c.id] = c.folderId;
        }
      });
      const order = list.map((c) => c.id);
      return {
        connections: list,
        connectionFolders: nextMap,
        connectionOrder: order,
      };
    }),

  loadConnectionsAndFolders: async () => {
    try {
      let dbFolders = (await ConnectionService.ListFolders()) || [];
      let dbConns = ((await ConnectionService.ListConnections()) || []) as unknown as ConnectionConfig[];

      // One-time migration if legacy localStorage folders exist and SQLite has none yet
      if (typeof window !== 'undefined' && window.localStorage) {
        const legacyFoldersRaw = localStorage.getItem(LEGACY_FOLDERS_KEY);
        if (legacyFoldersRaw && dbFolders.length === 0) {
          try {
            const legacyFolders: ConnectionFolder[] = JSON.parse(legacyFoldersRaw) || [];
            const legacyMap: Record<string, string | null> = JSON.parse(
              localStorage.getItem(LEGACY_CONN_FOLDER_MAP_KEY) || '{}'
            );
            const legacyOrder: string[] = JSON.parse(
              localStorage.getItem(LEGACY_CONN_ORDER_KEY) || '[]'
            );

            for (let i = 0; i < legacyFolders.length; i++) {
              const f = legacyFolders[i];
              await ConnectionService.SaveFolder({
                id: f.id,
                name: f.name,
                color: f.color || '#3b82f6',
                parentId: null,
                sortOrder: i,
              });
            }

            if (dbConns.length > 0) {
              const orderedConns = sortConnectionsList(dbConns, legacyOrder);
              await ConnectionService.UpdateConnectionsLayout(
                orderedConns.map((c, idx) => ({
                  id: c.id,
                  folderId: legacyMap[c.id] || c.folderId || null,
                  sortOrder: idx,
                }))
              );
            }

            localStorage.removeItem(LEGACY_FOLDERS_KEY);
            localStorage.removeItem(LEGACY_CONN_FOLDER_MAP_KEY);
            localStorage.removeItem(LEGACY_CONN_ORDER_KEY);

            dbFolders = (await ConnectionService.ListFolders()) || [];
            dbConns = ((await ConnectionService.ListConnections()) || []) as unknown as ConnectionConfig[];
          } catch (e) {
            console.warn('Legacy folder migration skipped:', e);
          }
        }
      }

      get().setFolders(dbFolders as ConnectionFolder[]);
      get().setConnections(dbConns);
      return dbConns;
    } catch (e) {
      console.error('Failed to load connections and folders from SQLite:', e);
      return [];
    }
  },

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
    const currentFolders = get().folders;
    const sortOrder = currentFolders.length;
    const newFolder: ConnectionFolder = { id, name: cleanName, color, parentId: null, sortOrder };

    set((state) => ({
      folders: [...state.folders, newFolder],
      expandedNodes: {
        ...state.expandedNodes,
        [`folder:${id}`]: true,
      },
    }));

    ConnectionService.SaveFolder({
      id,
      name: cleanName,
      color,
      parentId: null,
      sortOrder,
    }).catch((err) => {
      console.error('Failed to save folder to SQLite:', err);
    });

    return id;
  },

  renameFolder: (folderId, name, color) => {
    const cleanName = name.trim();
    if (!cleanName) return;

    const existingIdx = get().folders.findIndex((f) => f.id === folderId);
    const existing = existingIdx !== -1 ? get().folders[existingIdx] : null;
    const nextColor = color ?? existing?.color ?? '#3b82f6';
    const sortOrder = existing?.sortOrder ?? (existingIdx !== -1 ? existingIdx : 0);

    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === folderId ? { ...f, name: cleanName, color: nextColor } : f
      ),
    }));

    ConnectionService.SaveFolder({
      id: folderId,
      name: cleanName,
      color: nextColor,
      parentId: existing?.parentId || null,
      sortOrder,
    }).catch((err) => {
      console.error('Failed to rename folder in SQLite:', err);
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
      const nextConns = state.connections.map((c) =>
        c.folderId === folderId ? { ...c, folderId: null } : c
      );
      return {
        folders: nextFolders,
        connectionFolders: nextMap,
        connections: nextConns,
      };
    });

    ConnectionService.DeleteFolder(folderId).catch((err) => {
      console.error('Failed to delete folder from SQLite:', err);
    });
  },

  moveConnectionToFolder: (connId, folderId) => {
    const normalizedFolderId = folderId || null;
    set((state) => {
      const nextMap = { ...state.connectionFolders };
      if (normalizedFolderId) {
        nextMap[connId] = normalizedFolderId;
      } else {
        delete nextMap[connId];
      }
      const nextConns = state.connections.map((c) =>
        c.id === connId ? { ...c, folderId: normalizedFolderId } : c
      );
      return {
        connections: nextConns,
        connectionFolders: nextMap,
        expandedNodes: normalizedFolderId
          ? { ...state.expandedNodes, [`folder:${normalizedFolderId}`]: true }
          : state.expandedNodes,
      };
    });

    ConnectionService.MoveConnectionToFolder(connId, normalizedFolderId).catch((err) => {
      console.error('Failed to move connection to folder in SQLite:', err);
    });
  },

  reorderConnection: (draggedConnId, targetConnId, position, targetFolderId) => {
    const normalizedFolderId = targetFolderId || null;
    let layoutUpdates: Array<{ id: string; folderId: string | null; sortOrder: number }> = [];

    set((state) => {
      const nextMap = { ...state.connectionFolders };
      if (normalizedFolderId) {
        nextMap[draggedConnId] = normalizedFolderId;
      } else {
        delete nextMap[draggedConnId];
      }

      const currentIds = state.connections.map((c) => c.id);
      const baseOrder = [
        ...state.connectionOrder.filter((id) => currentIds.includes(id)),
        ...currentIds.filter((id) => !state.connectionOrder.includes(id)),
      ];

      let nextOrder = baseOrder;
      if (draggedConnId !== targetConnId) {
        const withoutDragged = baseOrder.filter((id) => id !== draggedConnId);
        const targetIdx = withoutDragged.indexOf(targetConnId);
        if (targetIdx !== -1) {
          const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
          withoutDragged.splice(insertIdx, 0, draggedConnId);
        } else {
          withoutDragged.push(draggedConnId);
        }
        nextOrder = withoutDragged;
      }

      const sorted = sortConnectionsList(state.connections, nextOrder).map((c, idx) => ({
        ...c,
        folderId: nextMap[c.id] || null,
        sortOrder: idx,
      }));

      layoutUpdates = sorted.map((c, idx) => ({
        id: c.id,
        folderId: nextMap[c.id] || null,
        sortOrder: idx,
      }));

      return {
        connections: sorted,
        connectionFolders: nextMap,
        connectionOrder: nextOrder,
      };
    });

    if (layoutUpdates.length > 0) {
      ConnectionService.UpdateConnectionsLayout(layoutUpdates).catch((err) => {
        console.error('Failed to update connections layout in SQLite:', err);
      });
    }
  },

  reorderFolder: (draggedFolderId, targetFolderId, position) => {
    if (draggedFolderId === targetFolderId) return;
    let orderedIds: string[] = [];

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

      const updatedFolders = withoutDragged.map((f, idx) => ({
        ...f,
        sortOrder: idx,
      }));
      orderedIds = updatedFolders.map((f) => f.id);

      return { folders: updatedFolders };
    });

    if (orderedIds.length > 0) {
      ConnectionService.UpdateFoldersOrder(orderedIds).catch((err) => {
        console.error('Failed to update folders order in SQLite:', err);
      });
    }
  },
}));

