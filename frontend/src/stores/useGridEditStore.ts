import { create } from 'zustand';

export interface StagedRowChange {
  type: 'insert' | 'update' | 'delete';
  rowIndex: number;
  primaryKey: Record<string, unknown>;
  originalRow: Record<string, unknown>;
  changes: Record<string, unknown>;
}

interface GridEditState {
  stagedByTab: Record<string, Record<number, StagedRowChange>>;
  stageCellUpdate: (
    tabId: string,
    rowIndex: number,
    primaryKey: Record<string, unknown>,
    originalRow: Record<string, unknown>,
    column: string,
    newValue: unknown
  ) => void;
  stageRowInsert: (tabId: string, tempRowIndex: number, initialValues?: Record<string, unknown>) => void;
  stageRowDelete: (tabId: string, rowIndex: number, primaryKey: Record<string, unknown>, originalRow: Record<string, unknown>) => void;
  revertTabChanges: (tabId: string) => void;
  getTabChangeCount: (tabId: string) => number;
}

export const useGridEditStore = create<GridEditState>((set, get) => ({
  stagedByTab: {},

  stageCellUpdate: (tabId, rowIndex, primaryKey, originalRow, column, newValue) =>
    set((state) => {
      const tabChanges = { ...(state.stagedByTab[tabId] || {}) };
      const existing = tabChanges[rowIndex];

      if (existing?.type === 'insert') {
        tabChanges[rowIndex] = {
          ...existing,
          changes: { ...existing.changes, [column]: newValue },
        };
      } else {
        const updatedChanges = { ...(existing?.changes || {}), [column]: newValue };
        if (originalRow[column] === newValue) {
          delete updatedChanges[column];
        }
        if (Object.keys(updatedChanges).length === 0) {
          delete tabChanges[rowIndex];
        } else {
          tabChanges[rowIndex] = {
            type: 'update',
            rowIndex,
            primaryKey,
            originalRow,
            changes: updatedChanges,
          };
        }
      }
      return { stagedByTab: { ...state.stagedByTab, [tabId]: tabChanges } };
    }),

  stageRowInsert: (tabId, tempRowIndex, initialValues = {}) =>
    set((state) => {
      const tabChanges = { ...(state.stagedByTab[tabId] || {}) };
      tabChanges[tempRowIndex] = {
        type: 'insert',
        rowIndex: tempRowIndex,
        primaryKey: {},
        originalRow: {},
        changes: initialValues,
      };
      return { stagedByTab: { ...state.stagedByTab, [tabId]: tabChanges } };
    }),

  stageRowDelete: (tabId, rowIndex, primaryKey, originalRow) =>
    set((state) => {
      const tabChanges = { ...(state.stagedByTab[tabId] || {}) };
      if (tabChanges[rowIndex]?.type === 'insert') {
        delete tabChanges[rowIndex];
      } else if (tabChanges[rowIndex]?.type === 'delete') {
        delete tabChanges[rowIndex];
      } else {
        tabChanges[rowIndex] = {
          type: 'delete',
          rowIndex,
          primaryKey,
          originalRow,
          changes: {},
        };
      }
      return { stagedByTab: { ...state.stagedByTab, [tabId]: tabChanges } };
    }),

  revertTabChanges: (tabId) =>
    set((state) => {
      const next = { ...state.stagedByTab };
      delete next[tabId];
      return { stagedByTab: next };
    }),

  getTabChangeCount: (tabId) => Object.keys(get().stagedByTab[tabId] || {}).length,
}));

