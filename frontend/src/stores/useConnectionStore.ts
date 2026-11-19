import { create } from 'zustand';
import { ConnectionConfig, ConnectionFolder, ObjectSummary, TableGroup } from '../types/domain';
import { ConnectionService, WorkspaceService } from '../../bindings/dhub/internal/services';

const LEGACY_FOLDERS_KEY = 'dhub_connection_folders_v1';
const LEGACY_CONN_FOLDER_MAP_KEY = 'dhub_connection_folder_map_v1';
const LEGACY_CONN_ORDER_KEY = 'dhub_connection_order_v1';
const VISIBLE_DATABASES_STORAGE_KEY = 'dhub_visible_databases_v1';
const TABLE_GROUPS_STORAGE_KEY = 'dhub_table_groups_v1';

interface VisibleDbConfig {
  selected: string[];
  total?: number;
}

function loadStoredVisibleDatabases(): {
  visibleDatabases: Record<string, string[]>;
  databaseTotals: Record<string, number>;
} {
  const visibleDatabases: Record<string, string[]> = {};
  const databaseTotals: Record<string, number> = {};
  if (typeof window === 'undefined' || !window.localStorage) {
    return { visibleDatabases, databaseTotals };
  }
  try {
    const raw = localStorage.getItem(VISIBLE_DATABASES_STORAGE_KEY);
    if (raw) {
      const parsed: Record<string, VisibleDbConfig> = JSON.parse(raw);
      for (const [connId, cfg] of Object.entries(parsed)) {
        if (cfg && Array.isArray(cfg.selected)) {
          visibleDatabases[connId] = cfg.selected;
        }
        if (cfg && typeof cfg.total === 'number') {
          databaseTotals[connId] = cfg.total;
        }
      }
    }
  } catch (e) {
    console.warn('Failed to load visible databases from localStorage:', e);
  }
  return { visibleDatabases, databaseTotals };
}

function persistVisibleDatabases(
  visibleDatabases: Record<string, string[]>,
  databaseTotals: Record<string, number>
) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const payload: Record<string, VisibleDbConfig> = {};
    const allKeys = new Set([...Object.keys(visibleDatabases), ...Object.keys(databaseTotals)]);
    allKeys.forEach((connId) => {
      payload[connId] = {
        selected: visibleDatabases[connId] || [],
        total: databaseTotals[connId],
      };
    });
    const serialized = JSON.stringify(payload);
    localStorage.setItem(VISIBLE_DATABASES_STORAGE_KEY, serialized);
    WorkspaceService.SaveSetting(VISIBLE_DATABASES_STORAGE_KEY, serialized).catch(() => {});
  } catch (e) {
    console.warn('Failed to persist visible databases:', e);
  }
}

const initialVisibleDbData = loadStoredVisibleDatabases();

interface TableGroupsStoragePayload {
  groups: Record<string, TableGroup[]>;
  assignments: Record<string, Record<string, string>>;
}

function loadStoredTableGroups(): TableGroupsStoragePayload {
  const groups: Record<string, TableGroup[]> = {};
  const assignments: Record<string, Record<string, string>> = {};
  if (typeof window === 'undefined' || !window.localStorage) {
    return { groups, assignments };
  }
  try {
    const raw = localStorage.getItem(TABLE_GROUPS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TableGroupsStoragePayload>;
      if (parsed.groups && typeof parsed.groups === 'object') {
        for (const [k, v] of Object.entries(parsed.groups)) {
          if (Array.isArray(v)) groups[k] = v;
        }
      }
      if (parsed.assignments && typeof parsed.assignments === 'object') {
        for (const [k, v] of Object.entries(parsed.assignments)) {
          if (v && typeof v === 'object') assignments[k] = v;
        }
      }
    }
  } catch (e) {
    console.warn('Failed to load table groups from localStorage:', e);
  }
  return { groups, assignments };
}

function persistTableGroups(
  groups: Record<string, TableGroup[]>,
  assignments: Record<string, Record<string, string>>
) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const serialized = JSON.stringify({ groups, assignments });
    localStorage.setItem(TABLE_GROUPS_STORAGE_KEY, serialized);
    WorkspaceService.SaveSetting(TABLE_GROUPS_STORAGE_KEY, serialized).catch(() => {});
  } catch (e) {
    console.warn('Failed to persist table groups:', e);
  }
}

const initialTableGroupsData = loadStoredTableGroups();

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
  visibleDatabases: Record<string, string[]>; // key: connId -> ['selected_db1', 'selected_db2']
  databaseTotals: Record<string, number>; // key: connId -> total db count on server
  treeObjects: Record<string, ObjectSummary[]>; // key: connId:db:schema
  expandedNodes: Record<string, boolean>;
  isLoading: boolean;
  selectedTable: string | null;

  setConnections: (conns: ConnectionConfig[]) => void;
  setFolders: (folders: ConnectionFolder[]) => void;
  loadConnectionsAndFolders: () => Promise<ConnectionConfig[]>;
  setActiveConnection: (id: string, database?: string, schema?: string) => void;
  setTreeDatabases: (connId: string, databases: string[]) => void;
  setVisibleDatabases: (connId: string, databases: string[], totalCount?: number) => void;
  getVisibleDatabases: (connId: string) => string[];
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

  // Table / View Grouping per database (MySQL / MariaDB)
  tableGroups: Record<string, TableGroup[]>; // key: connId:dbName
  tableGroupAssignments: Record<string, Record<string, string>>; // key: connId:dbName -> { tableName: groupId }
  createTableGroup: (connId: string, dbName: string, name: string, color?: string) => string;
  renameTableGroup: (connId: string, dbName: string, groupId: string, name: string, color?: string) => void;
  deleteTableGroup: (connId: string, dbName: string, groupId: string) => void;
  assignTableToGroup: (connId: string, dbName: string, tableName: string, groupId: string | null) => void;
  reorderTableGroup: (
    connId: string,
    dbName: string,
    draggedGroupId: string,
    targetGroupId: string,
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
  visibleDatabases: initialVisibleDbData.visibleDatabases,
  databaseTotals: initialVisibleDbData.databaseTotals,
  treeObjects: {},
  expandedNodes: {},
  isLoading: false,
  selectedTable: null,
  tableGroups: initialTableGroupsData.groups,
  tableGroupAssignments: initialTableGroupsData.assignments,

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
                createdAt: new Date().toISOString(),
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
    set((state) => {
      const nextTotals = { ...state.databaseTotals, [connId]: databases.length };
      let nextVisible = { ...state.visibleDatabases };
      if (nextVisible[connId] === undefined) {
        nextVisible[connId] = databases;
      } else if (databases.length > 0) {
        // Keep previously selected databases if they still exist in the new database list
        const currentSelected = nextVisible[connId] || [];
        const validSelected = currentSelected.filter((db) => databases.includes(db));
        nextVisible[connId] = validSelected.length > 0 ? validSelected : databases;
      }
      persistVisibleDatabases(nextVisible, nextTotals);
      return {
        treeDatabases: { ...state.treeDatabases, [connId]: databases },
        databaseTotals: nextTotals,
        visibleDatabases: nextVisible,
      };
    }),
  setVisibleDatabases: (connId, databases, totalCount) =>
    set((state) => {
      const nextVisible = { ...state.visibleDatabases, [connId]: databases };
      const currentTreeDbs = state.treeDatabases[connId];
      const count = totalCount !== undefined ? totalCount : (currentTreeDbs ? currentTreeDbs.length : (state.databaseTotals[connId] ?? databases.length));
      const nextTotals = {
        ...state.databaseTotals,
        [connId]: count,
      };
      persistVisibleDatabases(nextVisible, nextTotals);
      return {
        visibleDatabases: nextVisible,
        databaseTotals: nextTotals,
      };
    }),
  getVisibleDatabases: (connId) => {
    const state = get();
    if (state.visibleDatabases[connId] !== undefined) {
      return state.visibleDatabases[connId];
    }
    return state.treeDatabases[connId] || [];
  },
  removeTreeDatabase: (connId, database) =>
    set((state) => {
      const updatedDbs = (state.treeDatabases[connId] || []).filter((db) => db !== database);
      const currentVisible = state.visibleDatabases[connId];
      const nextVisible = { ...state.visibleDatabases };
      if (currentVisible) {
        nextVisible[connId] = currentVisible.filter((db) => db !== database);
      }
      const nextTotals = {
        ...state.databaseTotals,
        [connId]: updatedDbs.length,
      };
      persistVisibleDatabases(nextVisible, nextTotals);
      return {
        treeDatabases: {
          ...state.treeDatabases,
          [connId]: updatedDbs,
        },
        databaseTotals: nextTotals,
        visibleDatabases: nextVisible,
      };
    }),
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
      createdAt: new Date().toISOString(),
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
      createdAt: new Date().toISOString(),
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

  createTableGroup: (connId, dbName, name, color = '#3b82f6') => {
    const dbKey = `${connId}:${dbName}`;
    const id = `tgrp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const cleanName = name.trim() || 'New Group';

    set((state) => {
      const existing = state.tableGroups[dbKey] || [];
      const newGroup: TableGroup = {
        id,
        name: cleanName,
        color,
        sortOrder: existing.length,
      };
      const nextGroups = {
        ...state.tableGroups,
        [dbKey]: [...existing, newGroup],
      };
      persistTableGroups(nextGroups, state.tableGroupAssignments);
      return {
        tableGroups: nextGroups,
        expandedNodes: {
          ...state.expandedNodes,
          [`tblgroup:${dbKey}:${id}`]: true,
        },
      };
    });

    return id;
  },

  renameTableGroup: (connId, dbName, groupId, name, color) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    const dbKey = `${connId}:${dbName}`;

    set((state) => {
      const existing = state.tableGroups[dbKey] || [];
      const nextList = existing.map((g) =>
        g.id === groupId ? { ...g, name: cleanName, color: color ?? g.color ?? '#3b82f6' } : g
      );
      const nextGroups = { ...state.tableGroups, [dbKey]: nextList };
      persistTableGroups(nextGroups, state.tableGroupAssignments);
      return { tableGroups: nextGroups };
    });
  },

  deleteTableGroup: (connId, dbName, groupId) => {
    const dbKey = `${connId}:${dbName}`;

    set((state) => {
      const nextList = (state.tableGroups[dbKey] || []).filter((g) => g.id !== groupId);
      const nextGroups = { ...state.tableGroups };
      if (nextList.length > 0) {
        nextGroups[dbKey] = nextList;
      } else {
        delete nextGroups[dbKey];
      }

      const currentAssign = state.tableGroupAssignments[dbKey] || {};
      const nextAssignForDb: Record<string, string> = {};
      for (const [tblName, gId] of Object.entries(currentAssign)) {
        if (gId !== groupId) {
          nextAssignForDb[tblName] = gId;
        }
      }
      const nextAssignments = { ...state.tableGroupAssignments };
      if (Object.keys(nextAssignForDb).length > 0) {
        nextAssignments[dbKey] = nextAssignForDb;
      } else {
        delete nextAssignments[dbKey];
      }

      persistTableGroups(nextGroups, nextAssignments);
      return {
        tableGroups: nextGroups,
        tableGroupAssignments: nextAssignments,
      };
    });
  },

  assignTableToGroup: (connId, dbName, tableName, groupId) => {
    const dbKey = `${connId}:${dbName}`;
    const normalizedGroupId = groupId || null;

    set((state) => {
      const currentAssign = { ...(state.tableGroupAssignments[dbKey] || {}) };
      if (normalizedGroupId) {
        currentAssign[tableName] = normalizedGroupId;
      } else {
        delete currentAssign[tableName];
      }

      const nextAssignments = { ...state.tableGroupAssignments };
      if (Object.keys(currentAssign).length > 0) {
        nextAssignments[dbKey] = currentAssign;
      } else {
        delete nextAssignments[dbKey];
      }

      persistTableGroups(state.tableGroups, nextAssignments);
      return {
        tableGroupAssignments: nextAssignments,
        expandedNodes: normalizedGroupId
          ? { ...state.expandedNodes, [`tblgroup:${dbKey}:${normalizedGroupId}`]: true }
          : state.expandedNodes,
      };
    });
  },

  reorderTableGroup: (connId, dbName, draggedGroupId, targetGroupId, position) => {
    if (draggedGroupId === targetGroupId) return;
    const dbKey = `${connId}:${dbName}`;

    set((state) => {
      const existing = state.tableGroups[dbKey] || [];
      const dragged = existing.find((g) => g.id === draggedGroupId);
      if (!dragged) return state;

      const withoutDragged = existing.filter((g) => g.id !== draggedGroupId);
      const targetIdx = withoutDragged.findIndex((g) => g.id === targetGroupId);
      if (targetIdx !== -1) {
        const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
        withoutDragged.splice(insertIdx, 0, dragged);
      } else {
        withoutDragged.push(dragged);
      }

      const updated = withoutDragged.map((g, idx) => ({ ...g, sortOrder: idx }));
      const nextGroups = { ...state.tableGroups, [dbKey]: updated };
      persistTableGroups(nextGroups, state.tableGroupAssignments);
      return { tableGroups: nextGroups };
    });
  },
}));

if (typeof window !== 'undefined') {
  WorkspaceService.GetSettings()
    .then((settings) => {
      if (settings && settings[VISIBLE_DATABASES_STORAGE_KEY]) {
        try {
          const parsed = JSON.parse(settings[VISIBLE_DATABASES_STORAGE_KEY]);
          const currentVisible = { ...useConnectionStore.getState().visibleDatabases };
          const currentTotals = { ...useConnectionStore.getState().databaseTotals };
          let changed = false;
          for (const [connId, cfg] of Object.entries(parsed as Record<string, VisibleDbConfig>)) {
            if (cfg && Array.isArray(cfg.selected) && currentVisible[connId] === undefined) {
              currentVisible[connId] = cfg.selected;
              changed = true;
            }
            if (cfg && typeof cfg.total === 'number' && currentTotals[connId] === undefined) {
              currentTotals[connId] = cfg.total;
              changed = true;
            }
          }
          if (changed) {
            useConnectionStore.setState({
              visibleDatabases: currentVisible,
              databaseTotals: currentTotals,
            });
          }
        } catch {}
      }
      if (settings && settings[TABLE_GROUPS_STORAGE_KEY]) {
        try {
          const parsed = JSON.parse(settings[TABLE_GROUPS_STORAGE_KEY]) as Partial<TableGroupsStoragePayload>;
          const currentGroups = { ...useConnectionStore.getState().tableGroups };
          const currentAssignments = { ...useConnectionStore.getState().tableGroupAssignments };
          let changed = false;
          if (parsed.groups && typeof parsed.groups === 'object') {
            for (const [k, v] of Object.entries(parsed.groups)) {
              if (Array.isArray(v) && currentGroups[k] === undefined) {
                currentGroups[k] = v;
                changed = true;
              }
            }
          }
          if (parsed.assignments && typeof parsed.assignments === 'object') {
            for (const [k, v] of Object.entries(parsed.assignments)) {
              if (v && typeof v === 'object' && currentAssignments[k] === undefined) {
                currentAssignments[k] = v;
                changed = true;
              }
            }
          }
          if (changed) {
            useConnectionStore.setState({
              tableGroups: currentGroups,
              tableGroupAssignments: currentAssignments,
            });
          }
        } catch {}
      }
    })
    .catch(() => {});
}


