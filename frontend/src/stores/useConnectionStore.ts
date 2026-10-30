import { create } from 'zustand';
import { ConnectionConfig, ObjectSummary } from '../types/domain';

interface ConnectionState {
  connections: ConnectionConfig[];
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
  setTreeObjects: (key: string, objects: ObjectSummary[]) => void;
  toggleNode: (nodeKey: string) => void;
  setSelectedTable: (table: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connections: [],
  activeConnectionId: null,
  activeDatabase: '',
  activeSchema: '',
  treeDatabases: {},
  treeObjects: {},
  expandedNodes: {},
  isLoading: false,
  selectedTable: null,

  setConnections: (connections) => set({ connections }),
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
  setTreeObjects: (key, objects) =>
    set((state) => ({
      treeObjects: { ...state.treeObjects, [key]: objects },
    })),
  toggleNode: (nodeKey) =>
    set((state) => ({
      expandedNodes: {
        ...state.expandedNodes,
        [nodeKey]: !state.expandedNodes[nodeKey],
      },
    })),
  setSelectedTable: (table) => set({ selectedTable: table }),
  setLoading: (loading) => set({ isLoading: loading }),
}));

