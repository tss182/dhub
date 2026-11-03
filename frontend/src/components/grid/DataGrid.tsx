import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ColumnMeta, ConnectionEnvType } from '../../types/domain';
import { useGridEditStore, StagedRowChange } from '../../stores/useGridEditStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import {
  Plus,
  Trash2,
  RotateCcw,
  Check,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  RefreshCw,
  Search,
  X,
  Layers,
  ArrowDownCircle,
  Filter,
  Key,
  Hash,
  Info,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Copy,
  AlertCircle,
  FileText,
  Code,
  Edit3,
  Ban,
  CheckSquare,
} from 'lucide-react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);
const modKey = isMac ? 'Cmd' : 'Ctrl';

function parseColumnTypeDetails(dataType?: string) {
  if (!dataType) return { baseType: 'UNKNOWN', size: null, extra: null };
  const trimmed = dataType.trim();
  const match = trimmed.match(/^([a-zA-Z\s_]+)(?:\(([^)]+)\))?(.*)$/);
  if (!match) {
    return { baseType: trimmed.toUpperCase(), size: null, extra: null };
  }
  const baseType = match[1].trim().toUpperCase();
  const size = match[2]?.trim() || null;
  const extra = match[3]?.trim().toUpperCase() || null;
  return { baseType, size, extra };
}

function getColumnInputType(dataType?: string): 'date' | 'datetime-local' | 'time' | 'text' {
  if (!dataType) return 'text';
  const { baseType } = parseColumnTypeDetails(dataType);
  const upper = baseType.toUpperCase();

  if (upper === 'DATE') {
    return 'date';
  }
  if (
    upper.includes('TIMESTAMP') ||
    upper.includes('DATETIME')
  ) {
    return 'datetime-local';
  }
  if (upper.includes('TIME') && !upper.includes('TIMESTAMP')) {
    return 'time';
  }
  return 'text';
}

function formatToDateInputValue(val: any, type: 'date' | 'datetime-local' | 'time' | 'text'): string {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (!str) return '';

  if (type === 'date') {
    const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    return '';
  }

  if (type === 'datetime-local') {
    const normalized = str.replace(' ', 'T').replace(/Z$/, '');
    const match = normalized.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)/);
    if (match) return match[1];
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    return '';
  }

  if (type === 'time') {
    const match = str.match(/(\d{2}:\d{2}(?::\d{2})?)/);
    if (match) return match[1];
    return '';
  }

  return str;
}

function normalizeDateCommitValue(val: string, inputType: 'date' | 'datetime-local' | 'time' | 'text'): string | null {
  if (val === null || val === undefined) return null;
  const trimmed = String(val).trim();
  if (!trimmed) return null;

  if (inputType === 'datetime-local') {
    let s = trimmed.replace('T', ' ').replace(/Z$/, '').trim();
    s = s.replace(/([+-]\d{2}:?\d{2})$/, '').trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) {
      s += ':00';
    }
    return s;
  }
  if (inputType === 'date') {
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    return trimmed;
  }
  if (inputType === 'time') {
    const match = trimmed.match(/(\d{2}:\d{2}(?::\d{2})?)/);
    if (match) {
      let t = match[1];
      if (/^\d{2}:\d{2}$/.test(t)) t += ':00';
      return t;
    }
    return trimmed;
  }
  return trimmed;
}

export interface SortConfig {
  column: string;
  direction: 'asc' | 'desc';
}

const EMPTY_STAGED: Record<number, any> = {};

interface DataGridProps {
  tabId: string;
  columns: ColumnMeta[];
  rows: any[][];
  primaryKeys?: string[];
  onSubmitChanges: () => void;
  onPreviewChanges: () => void;
  totalCount?: number;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  page?: number;
  onPageChange?: (newPage: number) => void;
  pageSize?: number;
  onPageSizeChange?: (newSize: number) => void;
  onLoadMore?: () => void;
  onRefresh?: () => void;
  whereClause?: string;
  errorMessage?: string | null;
  onApplyWhere?: (whereClause: string) => void;
  isTableTab?: boolean;
  sortConfigs?: SortConfig[];
  onSortChange?: (sortConfigs: SortConfig[]) => void;
  envType?: ConnectionEnvType;
}

export const DataGrid: React.FC<DataGridProps> = ({
  tabId,
  columns,
  rows,
  primaryKeys = [],
  onSubmitChanges,
  onPreviewChanges,
  totalCount,
  hasMore = false,
  isLoadingMore = false,
  page,
  onPageChange,
  pageSize = 100,
  onPageSizeChange,
  onLoadMore,
  onRefresh,
  whereClause = '',
  errorMessage,
  onApplyWhere,
  isTableTab = false,
  sortConfigs = [],
  onSortChange,
  envType = 'local',
}) => {
  const [filterText, setFilterText] = useState('');
  const [whereInput, setWhereInput] = useState(whereClause || '');
  const [localSortConfigs, setLocalSortConfigs] = useState<SortConfig[]>(sortConfigs || []);

  useEffect(() => {
    setWhereInput(whereClause || '');
  }, [whereClause]);

  useEffect(() => {
    setLocalSortConfigs(sortConfigs || []);
  }, [sortConfigs]);

  const handleToggleSort = (colName: string, e?: React.MouseEvent) => {
    const existingIdx = localSortConfigs.findIndex((s) => s.column === colName);
    let nextConfigs: SortConfig[] = [];

    // Optional Alt or Ctrl key to sort exclusively by this single column
    const isSingleExclusive = e && (e.altKey || (e.ctrlKey && !e.shiftKey));

    if (isSingleExclusive) {
      if (existingIdx === -1) {
        nextConfigs = [{ column: colName, direction: 'asc' }];
      } else if (localSortConfigs[existingIdx].direction === 'asc') {
        nextConfigs = [{ column: colName, direction: 'desc' }];
      } else {
        nextConfigs = [];
      }
    } else {
      if (existingIdx === -1) {
        // Multi-sort: Append to the end. The first clicked remains first (priority 1), next is priority 2, etc.
        nextConfigs = [...localSortConfigs, { column: colName, direction: 'asc' }];
      } else {
        const existing = localSortConfigs[existingIdx];
        if (existing.direction === 'asc') {
          // Switch to desc in-place (keeps its priority index)
          nextConfigs = localSortConfigs.map((s, idx) =>
            idx === existingIdx ? { ...s, direction: 'desc' as const } : s
          );
        } else {
          // 3rd click: remove from sort list; remaining sorted columns shift up in priority
          nextConfigs = localSortConfigs.filter((_, idx) => idx !== existingIdx);
        }
      }
    }

    setLocalSortConfigs(nextConfigs);
    onSortChange?.(nextConfigs);
  };

  const handleClearAllSort = () => {
    setLocalSortConfigs([]);
    onSortChange?.([]);
  };

  const [hoveredCol, setHoveredCol] = useState<{
    col: ColumnMeta;
    isPK: boolean;
    details: { baseType: string; size: string | null; extra: string | null };
    x: number;
    y: number;
  } | null>(null);

  const hoverTimeoutRef = useRef<any>(null);

  const handleColMouseEnter = (e: React.MouseEvent, col: ColumnMeta, isPK: boolean) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const tooltipWidth = 240;
    const x = Math.min(Math.max(8, rect.left), window.innerWidth - tooltipWidth - 16);
    const y = rect.bottom + 4;
    const details = parseColumnTypeDetails(col.dataType);

    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredCol({
        col,
        isPK,
        details,
        x,
        y,
      });
    }, 120);
  };

  const handleColMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoveredCol(null);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  const [editingCell, setEditingCell] = useState<{ rowIndex: number; colIndex: number } | null>(null);
  const [editVal, setEditVal] = useState<string>('');
  const globalViewMode = useSettingsStore((state) => state.dataViewMode);
  const globalDefaultPageSize = useSettingsStore((state) => state.defaultPageSize);
  const viewMode = globalViewMode;

  const [currentPage, setCurrentPage] = useState(page || 1);
  const [localPageSize, setLocalPageSize] = useState(pageSize || globalDefaultPageSize || 100);
  const [isBatchSizeOpen, setIsBatchSizeOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const batchSizeRef = useRef<HTMLDivElement>(null);

  // Sync external page prop
  useEffect(() => {
    if (page && page !== currentPage) {
      setCurrentPage(page);
    }
  }, [page]);

  // Close batch size dropdown on outside click or Escape
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (batchSizeRef.current && !batchSizeRef.current.contains(e.target as Node)) {
        setIsBatchSizeOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsBatchSizeOpen(false);
    };
    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Sync external pageSize prop
  useEffect(() => {
    if (pageSize && pageSize !== localPageSize) {
      setLocalPageSize(pageSize);
    }
  }, [pageSize]);

  // Fix inverted horizontal scrolling (WebKitGTK on Linux / Shift+Wheel)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // 1. Shift + Wheel: scroll horizontally
      if (e.shiftKey) {
        e.preventDefault();
        const multiplier = e.deltaMode === 1 ? 24 : 1;
        const delta = (e.deltaY !== 0 ? e.deltaY : -e.deltaX) * multiplier;
        container.scrollLeft += delta;
        return;
      }

      // 2. Direct horizontal scroll (touchpad swipe / tilt wheel):
      // WebKitGTK on Linux sends inverted deltaX, so we flip the sign
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 0.5) {
        e.preventDefault();
        const multiplier = e.deltaMode === 1 ? 24 : 1;
        container.scrollLeft -= e.deltaX * multiplier;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const stagedChanges = useGridEditStore((state) => state.stagedByTab[tabId] ?? EMPTY_STAGED);
  const stageCellUpdate = useGridEditStore((state) => state.stageCellUpdate);
  const stageRowInsert = useGridEditStore((state) => state.stageRowInsert);
  const stageRowDelete = useGridEditStore((state) => state.stageRowDelete);
  const revertTabChanges = useGridEditStore((state) => state.revertTabChanges);
  const stagedCount = Object.keys(stagedChanges).length;

  const [selectionAnchor, setSelectionAnchor] = useState<{ r: number; c: number } | null>(null);
  const [selectionFocus, setSelectionFocus] = useState<{ r: number; c: number } | null>(null);
  const isDraggingRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
    vIdx: number | null;
    cIdx: number | null;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
    vIdx: null,
    cIdx: null,
  });
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const insertedChanges = useMemo(() => {
    return Object.values(stagedChanges).filter(
      (c): c is StagedRowChange & { type: 'insert' } => c?.type === 'insert'
    );
  }, [stagedChanges]);

  const handleStartEdit = (rowIndex: number, colIndex: number, currentVal: any) => {
    const col = columns[colIndex];
    const inputType = getColumnInputType(col?.dataType);
    setEditingCell({ rowIndex, colIndex });
    setEditVal(formatToDateInputValue(currentVal, inputType));
  };

  const handleAddRow = () => {
    const newRowId = -Date.now();
    stageRowInsert(tabId, newRowId);
    setSelectionAnchor({ r: 0, c: 0 });
    setSelectionFocus({ r: 0, c: columns.length > 0 ? columns.length - 1 : 0 });

    // Auto-focus first editable column of the newly inserted row
    const firstColIdx = columns.findIndex((c) => !c.isAutoIncrement);
    const targetColIdx = firstColIdx !== -1 ? firstColIdx : 0;
    if (columns.length > 0) {
      setTimeout(() => {
        handleStartEdit(newRowId, targetColIdx, '');
      }, 50);
    }
  };

  const handleFinishEdit = () => {
    if (!editingCell) return;
    const { rowIndex, colIndex } = editingCell;
    const col = columns[colIndex];
    if (!col) {
      setEditingCell(null);
      return;
    }

    const inputType = getColumnInputType(col.dataType);
    const finalVal = normalizeDateCommitValue(editVal, inputType);

    if (rowIndex < 0) {
      // Staged inserted row (negative rowIndex)
      stageCellUpdate(tabId, rowIndex, {}, {}, col.name, finalVal);
    } else {
      // Existing database row
      const originalRowValues: Record<string, unknown> = {};
      columns.forEach((c, idx) => {
        originalRowValues[c.name] = rows[rowIndex]?.[idx];
      });

      const pkMap: Record<string, unknown> = {};
      primaryKeys.forEach((pk) => {
        const idx = columns.findIndex((c) => c.name === pk);
        if (idx !== -1) {
          pkMap[pk] = rows[rowIndex]?.[idx];
        }
      });

      stageCellUpdate(tabId, rowIndex, pkMap, originalRowValues, col.name, finalVal);
    }
    setEditingCell(null);
  };

  const handleApplyChanges = () => {
    if (editingCell) {
      handleFinishEdit();
    }
    const currentStaged = useGridEditStore.getState().stagedByTab[tabId] || {};
    const count = Object.keys(currentStaged).length;
    if (count > 0 && onSubmitChanges) {
      onSubmitChanges();
    }
  };

  // Filter rows client-side
  const filteredRows = useMemo(() => {
    if (!filterText) return rows;
    const lower = filterText.toLowerCase();
    return rows.filter((r) => r.some((cell) => String(cell).toLowerCase().includes(lower)));
  }, [rows, filterText]);

  // Sort rows client-side (when onSortChange is not provided, e.g. query console results)
  const sortedRows = useMemo(() => {
    if (onSortChange || localSortConfigs.length === 0) return filteredRows;

    return [...filteredRows].sort((rowA, rowB) => {
      for (const sortItem of localSortConfigs) {
        const colIdx = columns.findIndex((c) => c.name === sortItem.column);
        if (colIdx === -1) continue;

        const valA = rowA[colIdx];
        const valB = rowB[colIdx];

        if (valA === valB) continue;
        if (valA === null || valA === undefined) return sortItem.direction === 'asc' ? 1 : -1;
        if (valB === null || valB === undefined) return sortItem.direction === 'asc' ? -1 : 1;

        const colMeta = columns[colIdx];
        const rawType = (colMeta?.rawType || colMeta?.dataType || '').toLowerCase();
        const isNum = /int|float|double|decimal|numeric|real|serial|number/.test(rawType);

        let cmp = 0;
        if (isNum) {
          const numA = Number(valA);
          const numB = Number(valB);
          if (!isNaN(numA) && !isNaN(numB)) {
            cmp = numA - numB;
          } else {
            cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
          }
        } else {
          cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
        }

        if (cmp !== 0) {
          return sortItem.direction === 'asc' ? cmp : -cmp;
        }
      }
      return 0;
    });
  }, [filteredRows, localSortConfigs, onSortChange, columns]);

  const isMultiPageInMemory = sortedRows.length > localPageSize;

  // Rows to display based on viewMode
  const displayedRows =
    viewMode === 'paged'
      ? isMultiPageInMemory
        ? sortedRows.slice((currentPage - 1) * localPageSize, currentPage * localPageSize)
        : sortedRows
      : sortedRows;


  // Visual rows in display order (inserted changes first, then displayed database rows)
  const visualRows = useMemo(() => {
    const list: Array<{
      vIdx: number;
      rowId: number;
      isInsert: boolean;
      insertChange?: (typeof insertedChanges)[0];
      rowData?: any[];
      globalRowIndex?: number;
    }> = [];

    insertedChanges.forEach((change) => {
      list.push({
        vIdx: list.length,
        rowId: change.rowIndex,
        isInsert: true,
        insertChange: change,
      });
    });

    displayedRows.forEach((row, rIdx) => {
      const globalRowIndex = viewMode === 'paged' ? (currentPage - 1) * localPageSize + rIdx : rIdx;
      list.push({
        vIdx: list.length,
        rowId: globalRowIndex,
        isInsert: false,
        rowData: row,
        globalRowIndex,
      });
    });

    return list;
  }, [insertedChanges, displayedRows, viewMode, currentPage, localPageSize]);

  // Rectangular cell selection range
  const selectionRange = useMemo(() => {
    if (!selectionAnchor || !selectionFocus) return null;
    return {
      startR: Math.min(selectionAnchor.r, selectionFocus.r),
      endR: Math.max(selectionAnchor.r, selectionFocus.r),
      startC: Math.min(selectionAnchor.c, selectionFocus.c),
      endC: Math.max(selectionAnchor.c, selectionFocus.c),
    };
  }, [selectionAnchor, selectionFocus]);

  const isCellSelected = (vIdx: number, cIdx: number) => {
    if (!selectionRange) return false;
    return (
      vIdx >= selectionRange.startR &&
      vIdx <= selectionRange.endR &&
      cIdx >= selectionRange.startC &&
      cIdx <= selectionRange.endC
    );
  };

  const selectedRowKeys = useMemo(() => {
    if (!selectionRange) return new Set<number>();
    const set = new Set<number>();
    for (let r = selectionRange.startR; r <= selectionRange.endR; r++) {
      const vr = visualRows[r];
      if (vr) set.add(vr.rowId);
    }
    return set;
  }, [selectionRange, visualRows]);

  const selectedRowIndex = useMemo(() => {
    if (!selectionFocus) return null;
    return visualRows[selectionFocus.r]?.rowId ?? null;
  }, [selectionFocus, visualRows]);

  // Global mouseup to release cell drag selection and close context menu
  useEffect(() => {
    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };
    const handleClickOutside = () => {
      setContextMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
    };
    const handleKeyDownOutside = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
      }
    };
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKeyDownOutside);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDownOutside);
    };
  }, []);

  const handleCellContextMenu = (e: React.MouseEvent, vIdx: number, cIdx: number) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isCellSelected(vIdx, cIdx)) {
      setSelectionAnchor({ r: vIdx, c: cIdx });
      setSelectionFocus({ r: vIdx, c: cIdx });
    }

    const menuWidth = 220;
    const menuHeight = 340;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

    setContextMenu({
      isOpen: true,
      x: Math.max(10, x),
      y: Math.max(10, y),
      vIdx,
      cIdx,
    });
  };

  const handleRowHeaderContextMenu = (e: React.MouseEvent, vIdx: number) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isCellSelected(vIdx, 0)) {
      setSelectionAnchor({ r: vIdx, c: 0 });
      setSelectionFocus({ r: vIdx, c: columns.length - 1 });
    }

    const menuWidth = 220;
    const menuHeight = 340;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

    setContextMenu({
      isOpen: true,
      x: Math.max(10, x),
      y: Math.max(10, y),
      vIdx,
      cIdx: 0,
    });
  };

  const handleCopySelection = (includeHeaders = false) => {
    if (!selectionRange || columns.length === 0) return;
    const lines: string[] = [];
    if (includeHeaders) {
      const headerCols: string[] = [];
      for (let c = selectionRange.startC; c <= selectionRange.endC; c++) {
        if (columns[c]) headerCols.push(columns[c].name);
      }
      lines.push(headerCols.join('\t'));
    }
    for (let r = selectionRange.startR; r <= selectionRange.endR; r++) {
      const vr = visualRows[r];
      if (!vr) continue;
      const cellTexts: string[] = [];
      for (let c = selectionRange.startC; c <= selectionRange.endC; c++) {
        const col = columns[c];
        if (!col) continue;
        let val: any;
        if (vr.isInsert) {
          const staged = vr.insertChange;
          val = staged?.changes[col.name] !== undefined ? staged.changes[col.name] : (col.defaultValue ?? '');
        } else {
          const staged = stagedChanges[vr.globalRowIndex!];
          if (staged?.type === 'update' && staged.changes[col.name] !== undefined) {
            val = staged.changes[col.name];
          } else {
            val = vr.rowData?.[c];
          }
        }
        cellTexts.push(val === null || val === undefined ? '' : String(val));
      }
      lines.push(cellTexts.join('\t'));
    }
    if (lines.length > 0) {
      navigator.clipboard.writeText(lines.join('\n'));
    }
  };

  const handleCopyAsJson = () => {
    if (!selectionRange || columns.length === 0) return;
    const list: Record<string, any>[] = [];
    for (let r = selectionRange.startR; r <= selectionRange.endR; r++) {
      const vr = visualRows[r];
      if (!vr) continue;
      const rowObj: Record<string, any> = {};
      for (let c = selectionRange.startC; c <= selectionRange.endC; c++) {
        const col = columns[c];
        if (!col) continue;
        let val: any;
        if (vr.isInsert) {
          const staged = vr.insertChange;
          val = staged?.changes[col.name] !== undefined ? staged.changes[col.name] : (col.defaultValue ?? null);
        } else {
          const staged = stagedChanges[vr.globalRowIndex!];
          if (staged?.type === 'update' && staged.changes[col.name] !== undefined) {
            val = staged.changes[col.name];
          } else {
            val = vr.rowData?.[c];
          }
        }
        rowObj[col.name] = val;
      }
      list.push(rowObj);
    }
    navigator.clipboard.writeText(JSON.stringify(list, null, 2));
  };

  const handleSetSelectedToNull = () => {
    if (!selectionRange) return;
    for (let r = selectionRange.startR; r <= selectionRange.endR; r++) {
      const vr = visualRows[r];
      if (!vr) continue;
      for (let c = selectionRange.startC; c <= selectionRange.endC; c++) {
        const col = columns[c];
        if (!col || col.isPrimaryKey || col.isAutoIncrement) continue;
        if (vr.isInsert) {
          stageCellUpdate(tabId, vr.rowId, {}, {}, col.name, null);
        } else {
          const originalRowValues: Record<string, unknown> = {};
          columns.forEach((colMeta, idx) => {
            originalRowValues[colMeta.name] = rows[vr.globalRowIndex!]?.[idx];
          });
          const pkMap: Record<string, unknown> = {};
          primaryKeys.forEach((pk) => {
            const idx = columns.findIndex((colMeta) => colMeta.name === pk);
            if (idx !== -1) pkMap[pk] = rows[vr.globalRowIndex!]?.[idx];
          });
          stageCellUpdate(tabId, vr.globalRowIndex!, pkMap, originalRowValues, col.name, null);
        }
      }
    }
  };

  const handleCellMouseDown = (e: React.MouseEvent, vIdx: number, cIdx: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    if (editingCell) {
      handleFinishEdit();
    }

    if (e.shiftKey && selectionAnchor) {
      window.getSelection()?.removeAllRanges();
      setSelectionFocus({ r: vIdx, c: cIdx });
    } else {
      isDraggingRef.current = true;
      setSelectionAnchor({ r: vIdx, c: cIdx });
      setSelectionFocus({ r: vIdx, c: cIdx });
    }
  };

  const handleCellMouseEnter = (vIdx: number, cIdx: number) => {
    if (isDraggingRef.current) {
      setSelectionFocus({ r: vIdx, c: cIdx });
    }
  };

  const handleRowHeaderMouseDown = (e: React.MouseEvent, vIdx: number) => {
    if (e.button !== 0) return;
    if (editingCell) handleFinishEdit();

    if (e.shiftKey && selectionAnchor) {
      window.getSelection()?.removeAllRanges();
      setSelectionFocus({ r: vIdx, c: columns.length - 1 });
    } else {
      isDraggingRef.current = true;
      setSelectionAnchor({ r: vIdx, c: 0 });
      setSelectionFocus({ r: vIdx, c: columns.length - 1 });
    }
  };

  const handleRowHeaderMouseEnter = (vIdx: number) => {
    if (isDraggingRef.current) {
      setSelectionFocus((prev) => (prev ? { r: vIdx, c: prev.c } : { r: vIdx, c: columns.length - 1 }));
    }
  };

  const handleDuplicateRow = () => {
    if (editingCell) {
      handleFinishEdit();
    }

    const targets =
      selectedRowKeys.size > 0
        ? Array.from(selectedRowKeys).sort((x, y) => (x < 0 && y < 0 ? y - x : x < 0 ? 1 : y < 0 ? -1 : x - y))
        : visualRows.length > 0
        ? [visualRows[0].rowId]
        : [];

    if (targets.length === 0) return;

    const latestStaged = useGridEditStore.getState().stagedByTab[tabId] || {};

    const buildValues = (targetRowIndex: number) => {
      const initialValues: Record<string, unknown> = {};
      if (targetRowIndex < 0) {
        const staged = latestStaged[targetRowIndex];
        if (staged && staged.type === 'insert') {
          columns.forEach((col) => {
            if (!col.isAutoIncrement && staged.changes[col.name] !== undefined) {
              const rawVal = staged.changes[col.name];
              if (rawVal !== undefined && rawVal !== null) {
                const inputType = getColumnInputType(col.dataType);
                const val = inputType !== 'text' ? normalizeDateCommitValue(String(rawVal), inputType) : rawVal;
                initialValues[col.name] = val !== null ? val : rawVal;
              }
            }
          });
        }
      } else {
        const sourceRow = rows[targetRowIndex];
        if (sourceRow) {
          const staged = latestStaged[targetRowIndex];
          columns.forEach((col, idx) => {
            if (!col.isAutoIncrement) {
              const rawVal =
                staged?.type === 'update' && staged.changes[col.name] !== undefined
                  ? staged.changes[col.name]
                  : sourceRow[idx];
              if (rawVal !== undefined && rawVal !== null) {
                const inputType = getColumnInputType(col.dataType);
                const val = inputType !== 'text' ? normalizeDateCommitValue(String(rawVal), inputType) : rawVal;
                initialValues[col.name] = val !== null ? val : rawVal;
              }
            }
          });
        }
      }
      return initialValues;
    };

    const baseId = Date.now();
    const newIds: number[] = [];
    let lastValues: Record<string, unknown> = {};
    targets.forEach((t, i) => {
      const newRowId = -(baseId + i);
      lastValues = buildValues(t);
      stageRowInsert(tabId, newRowId, lastValues);
      newIds.push(newRowId);
    });

    setSelectionAnchor({ r: 0, c: 0 });
    setSelectionFocus({ r: newIds.length - 1, c: columns.length - 1 });

    if (newIds.length === 1 && columns.length > 0) {
      const firstColIdx = columns.findIndex((c) => !c.isAutoIncrement);
      const targetColIdx = firstColIdx !== -1 ? firstColIdx : 0;
      setTimeout(() => {
        const val = lastValues[columns[targetColIdx].name];
        handleStartEdit(newIds[0], targetColIdx, val !== undefined && val !== null ? String(val) : '');
      }, 50);
    }
  };

  const handleDeleteActiveRow = () => {
    const rowKeysToDelete =
      selectedRowKeys.size > 0
        ? Array.from(selectedRowKeys)
        : visualRows.length > 0
        ? [visualRows[0].rowId]
        : [];

    if (rowKeysToDelete.length === 0) return;

    rowKeysToDelete.forEach((idx) => {
      if (idx < 0) {
        stageRowDelete(tabId, idx, {}, {});
        return;
      }
      const pkMap: Record<string, unknown> = {};
      const originalRowValues: Record<string, unknown> = {};
      columns.forEach((c, ci) => {
        originalRowValues[c.name] = rows[idx]?.[ci];
      });
      primaryKeys.forEach((pk) => {
        const ci = columns.findIndex((c) => c.name === pk);
        if (ci !== -1) pkMap[pk] = rows[idx]?.[ci];
      });
      stageRowDelete(tabId, idx, pkMap, originalRowValues);
    });

    setSelectionAnchor(null);
    setSelectionFocus(null);
  };

  // Keyboard shortcuts: Range Copy (Ctrl+C), Apply (Ctrl+S), Duplicate (Ctrl+D), Delete, Cancel (Esc), Arrow Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('.monaco-editor')) return;

      if (showCancelConfirm) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setShowCancelConfirm(false);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          revertTabChanges(tabId);
          setEditingCell(null);
          setSelectionAnchor(null);
          setSelectionFocus(null);
          setShowCancelConfirm(false);
          return;
        }
        return;
      }

      const isInFilterOrWhere = target?.closest?.('[data-filter-input]') || target?.closest?.('[data-where-input]');

      if (e.key === 'Escape') {
        if (isInFilterOrWhere) return;
        if (editingCell) {
          e.preventDefault();
          setEditingCell(null);
          if (stagedCount > 0) {
            setShowCancelConfirm(true);
          }
          return;
        }
        if (stagedCount > 0) {
          e.preventDefault();
          setShowCancelConfirm(true);
          return;
        }
      }

      const activeEl = document.activeElement;
      const isTyping =
        (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) ||
        (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA'));

      // Arrow keys navigation across grid cells
      if (!isTyping && selectionFocus && visualRows.length > 0 && columns.length > 0) {
        let deltaR = 0;
        let deltaC = 0;
        if (e.key === 'ArrowUp') deltaR = -1;
        else if (e.key === 'ArrowDown') deltaR = 1;
        else if (e.key === 'ArrowLeft') deltaC = -1;
        else if (e.key === 'ArrowRight') deltaC = 1;

        if (deltaR !== 0 || deltaC !== 0) {
          e.preventDefault();
          const newR = Math.max(0, Math.min(visualRows.length - 1, selectionFocus.r + deltaR));
          const newC = Math.max(0, Math.min(columns.length - 1, selectionFocus.c + deltaC));
          if (e.shiftKey) {
            setSelectionFocus({ r: newR, c: newC });
          } else {
            setSelectionAnchor({ r: newR, c: newC });
            setSelectionFocus({ r: newR, c: newC });
          }
          return;
        }
      }

      // Delete active / selected row(s)
      const isMacDelete = isMac && e.metaKey && (e.key === 'Backspace' || e.key === 'Delete');
      const isOtherDelete = !isMac && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Delete';

      if (!isTyping && (isMacDelete || isOtherDelete)) {
        e.preventDefault();
        handleDeleteActiveRow();
        return;
      }

      const isMod = isMac ? e.metaKey : e.ctrlKey;
      if (!isMod) return;

      if (isTyping && !target?.closest?.('[data-grid-container]')) {
        return;
      }

      // Select All
      if (e.key === 'a' || e.key === 'A') {
        if (!isTyping && visualRows.length > 0 && columns.length > 0) {
          e.preventDefault();
          setSelectionAnchor({ r: 0, c: 0 });
          setSelectionFocus({ r: visualRows.length - 1, c: columns.length - 1 });
          return;
        }
      }

      // Copy selected cells as TSV
      if (e.key === 'c' || e.key === 'C') {
        if (!isTyping && selectionRange && columns.length > 0) {
          e.preventDefault();
          const rowsText: string[] = [];
          for (let r = selectionRange.startR; r <= selectionRange.endR; r++) {
            const vr = visualRows[r];
            if (!vr) continue;
            const cellTexts: string[] = [];
            for (let c = selectionRange.startC; c <= selectionRange.endC; c++) {
              const col = columns[c];
              if (!col) continue;
              let val: any;
              if (vr.isInsert) {
                const staged = vr.insertChange;
                val = staged?.changes[col.name] !== undefined ? staged.changes[col.name] : (col.defaultValue ?? '');
              } else {
                const staged = stagedChanges[vr.globalRowIndex!];
                if (staged?.type === 'update' && staged.changes[col.name] !== undefined) {
                  val = staged.changes[col.name];
                } else {
                  val = vr.rowData?.[c];
                }
              }
              cellTexts.push(val === null || val === undefined ? '' : String(val));
            }
            rowsText.push(cellTexts.join('\t'));
          }
          if (rowsText.length > 0) {
            navigator.clipboard.writeText(rowsText.join('\n'));
          }
          return;
        }
      }

      // Shortcut: Apply (Ctrl+S on Linux/Win, Cmd+S on macOS)
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleApplyChanges();
        return;
      }

      // Shortcut: Duplicate (Ctrl+D on Linux/Win, Cmd+D on macOS)
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        handleDuplicateRow();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabId, isMac, editingCell, editVal, columns, rows, selectionAnchor, selectionFocus, selectionRange, visualRows, selectedRowKeys, onSubmitChanges, stagedCount, showCancelConfirm]);
  const currentOffset = (currentPage - 1) * localPageSize;
  const startRow = displayedRows.length === 0 ? 0 : currentOffset + 1;
  const endRow = currentOffset + displayedRows.length;

  // Determine effective total rows:
  // 1. If explicit totalCount is provided and >= endRow, use it.
  // 2. If client-side multi-page in memory, use filteredRows.length.
  // 3. If !hasMore (we reached the end of the dataset), total is EXACTLY endRow!
  // 4. Otherwise, total is at least endRow + 1.
  const effectiveTotal =
    totalCount !== undefined && totalCount >= endRow
      ? totalCount
      : isMultiPageInMemory
      ? filteredRows.length
      : !hasMore
      ? endRow
      : Math.max(endRow + 1, totalCount || 0);

  const isExactTotalKnown =
    (totalCount !== undefined && totalCount >= endRow) || !hasMore || isMultiPageInMemory;

  const totalPages = Math.max(1, Math.ceil(effectiveTotal / localPageSize));

  // Reset page when filter changes (only for client-side pagination)
  useEffect(() => {
    if (!onPageChange) {
      setCurrentPage(1);
    }
  }, [filterText, localPageSize, onPageChange]);

  // Infinite scroll listener for lazy loading
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (viewMode !== 'infinite') return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (hasMore && !isLoadingMore && onLoadMore) {
      if (scrollHeight - scrollTop - clientHeight < 250) {
        onLoadMore();
      }
    }
  };

  const handleNavigatePage = (targetPage: number) => {
    const maxPage = isExactTotalKnown ? totalPages : Math.max(totalPages, targetPage);
    const clamped = Math.max(1, Math.min(targetPage, maxPage));
    setCurrentPage(clamped);
    if (onPageChange) {
      onPageChange(clamped);
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setLocalPageSize(newSize);
    setCurrentPage(1);
    onPageSizeChange?.(newSize);
  };

  // Only borders are tinted by environment; backgrounds stay neutral.
  // Thick frame around the whole grid + tinted toolbars; grid body stays neutral.
  const gridContainerBg =
    envType === 'prod'
      ? 'bg-[#191a20] border-[3px] border-[#7a3b3f]'
      : envType === 'dev'
      ? 'bg-[#191a20] border-[3px] border-[#2f6b52]'
      : 'bg-[#191a20]';
  const gridBarBg =
    envType === 'prod'
      ? 'bg-[#5a2d31] border-[#7a3b3f]'
      : envType === 'dev'
      ? 'bg-[#244f3d] border-[#2f6b52]'
      : 'bg-[#14151a] border-[#272932]';
  const gridTheadBg = 'bg-[#14151a]';
  const gridCellBorder = 'border-[#272932]';
  const gridRowClass = 'border-b border-[#22242c] hover:bg-[#20222a] transition-colors';

  return (
    <div data-grid-container="true" className={`flex h-full flex-col ${gridContainerBg} text-xs select-text transition-colors`}>
      {/* Table Toolbar */}
      <div className={`flex h-10 items-center justify-between border-b px-3 ${gridBarBg}`}>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleAddRow}
            className="flex h-7 w-7 items-center justify-center rounded bg-[#22242c] hover:bg-[#2b2d37] text-zinc-300 transition-colors cursor-pointer"
            title="Add New Row"
          >
            <Plus className="h-4 w-4 text-emerald-400" />
          </button>

          <button
            onClick={handleDuplicateRow}
            className="flex h-7 w-7 items-center justify-center rounded bg-[#22242c] hover:bg-[#2b2d37] text-zinc-300 transition-colors cursor-pointer"
            title={`Duplicate Selected Row (${modKey}+D)`}
          >
            <Copy className="h-3.5 w-3.5 text-sky-400" />
          </button>

          <button
            onClick={handleDeleteActiveRow}
            className="flex h-7 w-7 items-center justify-center rounded bg-[#22242c] hover:bg-[#2b2d37] text-zinc-300 transition-colors cursor-pointer"
            title={`Delete Active Row (${isMac ? 'Cmd+Backspace' : 'Delete'})`}
          >
            <Trash2 className="h-3.5 w-3.5 text-rose-400" />
          </button>

          <div className="h-4 w-[1px] bg-[#272932] mx-0.5" />

          {onRefresh && (
            <button
              onClick={onRefresh}
              className="flex h-7 w-7 items-center justify-center rounded bg-[#22242c] hover:bg-[#2b2d37] text-zinc-400 hover:text-white transition-colors cursor-pointer"
              title="Reload / Refresh Data"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}

          {stagedCount > 0 && (
            <>
              <div className="h-4 w-[1px] bg-[#272932] mx-0.5" />

              <button
                onClick={onPreviewChanges}
                className="flex h-7 w-7 items-center justify-center rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 transition-colors cursor-pointer"
                title="Preview SQL DML"
              >
                <Eye className="h-4 w-4" />
              </button>

              <button
                onClick={handleApplyChanges}
                className="relative flex h-7 w-7 items-center justify-center rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer shadow-sm"
                title={`Apply Changes (${stagedCount}) (${modKey}+S)`}
              >
                <Check className="h-4 w-4 stroke-[2.5]" />
                {stagedCount > 1 && (
                  <span className="absolute -top-1 -right-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-emerald-400 text-[9px] font-bold text-zinc-950 px-0.5 pointer-events-none">
                    {stagedCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setShowCancelConfirm(true)}
                className="flex h-7 w-7 items-center justify-center rounded bg-rose-950/40 border border-rose-800/60 hover:bg-rose-900/60 text-rose-400 hover:text-white transition-colors cursor-pointer"
                title="Revert Staged Changes (Esc)"
              >
                <X className="h-4 w-4 text-rose-400" />
              </button>
            </>
          )}
        </div>

        {/* Toolbar Right: Active Multi-Sort Chips + Quick Filter */}
        <div className="flex items-center gap-2.5">
          {localSortConfigs.length > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#101115] border border-[#2b2e3a] text-[11px] font-mono select-none">
              <span className="text-[10px] uppercase font-bold text-zinc-500 font-sans tracking-wider">
                Order:
              </span>
              <div className="flex items-center gap-1">
                {localSortConfigs.map((sc, idx) => (
                  <span
                    key={sc.column}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#1e2029] border border-blue-500/30 text-[10px] text-zinc-200"
                    title={`#${idx + 1} priority: ${sc.column} (${sc.direction.toUpperCase()})`}
                  >
                    <span className="flex items-center justify-center h-3 w-3 rounded-full bg-blue-600 text-white text-[8px] font-bold">
                      {idx + 1}
                    </span>
                    <span className="text-zinc-100 font-medium">{sc.column}</span>
                    <span className="text-blue-400 font-bold">{sc.direction.toUpperCase()}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = localSortConfigs.filter((_, i) => i !== idx);
                        setLocalSortConfigs(next);
                        onSortChange?.(next);
                      }}
                      className="text-zinc-500 hover:text-rose-400 cursor-pointer ml-0.5"
                      title={`Remove ${sc.column} from sort`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={handleClearAllSort}
                className="text-[10px] text-zinc-400 hover:text-rose-400 hover:underline cursor-pointer ml-1"
                title="Clear all column sorting"
              >
                Clear
              </button>
            </div>
          )}

          {/* Quick Filter */}
          <div className="relative flex items-center">
            <Search className="h-3 w-3 text-zinc-500 absolute left-2 pointer-events-none" />
            <input
              type="text"
              data-filter-input="true"
              placeholder="Filter in result..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="h-6 rounded bg-[#121317] pl-6 pr-6 text-[11px] text-zinc-200 border border-[#272932] focus:border-blue-500 focus:outline-none w-48 font-sans"
            />
            {filterText && (
              <button
                onClick={() => setFilterText('')}
                className="absolute right-1.5 text-zinc-500 hover:text-white cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SQL WHERE Filter Bar (Below Add Row toolbar) */}
      {isTableTab && (
        <div className={`flex items-center gap-2 px-3 py-1.5 border-b ${gridBarBg}`}>
          <div className="flex items-center gap-1.5 shrink-0 select-none">
            <span className="font-mono text-[11px] font-bold text-blue-400 bg-blue-950/40 border border-blue-800/40 px-2 py-0.5 rounded">
              WHERE
            </span>
          </div>
          <div className="relative flex-1 flex items-center">
            <input
              type="text"
              data-where-input="true"
              placeholder="e.g. name like '%user' and id = '1' (Press Enter to apply)"
              value={whereInput}
              onChange={(e) => setWhereInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onApplyWhere?.(whereInput);
                }
              }}
              className={`w-full h-7 rounded bg-[#101115] border pl-3 pr-7 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:outline-none transition-colors ${
                errorMessage
                  ? 'border-rose-500/80 focus:border-rose-500 ring-1 ring-rose-500/30'
                  : 'border-[#2b2e3a] focus:border-blue-500'
              }`}
            />
            {whereInput && (
              <button
                type="button"
                onClick={() => {
                  setWhereInput('');
                  onApplyWhere?.('');
                }}
                className="absolute right-2 text-zinc-500 hover:text-white cursor-pointer"
                title="Clear WHERE filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => onApplyWhere?.(whereInput)}
            className="flex items-center gap-1.5 h-7 px-3 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors cursor-pointer shadow-xs shrink-0"
            title="Apply WHERE filter (Enter)"
          >
            <Filter className="h-3 w-3" />
            <span>Apply</span>
          </button>

          {whereInput && (
            <button
              type="button"
              onClick={() => {
                setWhereInput('');
                onApplyWhere?.('');
              }}
              className="flex items-center gap-1 h-7 px-2.5 rounded bg-[#20222b] hover:bg-rose-950/40 hover:text-rose-300 text-zinc-400 border border-[#272932] text-xs transition-colors cursor-pointer shrink-0"
              title="Reset WHERE filter"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      )}

      {/* Error Banner when query or WHERE filter fails */}
      {errorMessage && (
        <div className="flex items-center justify-between px-3.5 py-2 bg-rose-950/40 border-b border-rose-900/60 text-xs font-mono text-rose-300 select-text">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span className="truncate">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setWhereInput('');
              onApplyWhere?.('');
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-sans font-medium transition-colors shrink-0 ml-3 cursor-pointer shadow-xs"
            title="Clear WHERE filter and reload data"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset Filter</span>
          </button>
        </div>
      )}

      {/* Grid Table Container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto min-h-0 relative"
      >
        <table className="w-full border-collapse font-mono text-[12px] text-zinc-300">
          <thead className={`sticky top-0 ${gridTheadBg} shadow-sm z-10`}>
            <tr className={`border-b ${gridCellBorder}`}>
              <th
                onClick={() => {
                  if (visualRows.length > 0 && columns.length > 0) {
                    setSelectionAnchor({ r: 0, c: 0 });
                    setSelectionFocus({ r: visualRows.length - 1, c: columns.length - 1 });
                  }
                }}
                className={`w-12 px-2 py-1.5 text-center text-zinc-500 font-normal border-r ${gridCellBorder} select-none cursor-pointer hover:bg-zinc-800/60`}
                title="Click to select all cells"
              >
                #
              </th>
              {columns.map((col) => {
                const isPK = Boolean(col.isPrimaryKey || primaryKeys.includes(col.name));
                const sortIndex = localSortConfigs.findIndex((s) => s.column === col.name);
                const isSorted = sortIndex !== -1;
                const sortItem = isSorted ? localSortConfigs[sortIndex] : null;

                return (
                  <th
                    key={col.name}
                    onClick={(e) => handleToggleSort(col.name, e)}
                    onMouseEnter={(e) => handleColMouseEnter(e, col, isPK)}
                    onMouseLeave={handleColMouseLeave}
                    className={`px-3 py-1.5 text-left font-semibold border-r ${gridCellBorder} text-zinc-200 group/th select-none ${
                      envType === 'prod'
                        ? 'hover:bg-rose-950/60'
                        : envType === 'dev'
                        ? 'hover:bg-emerald-950/60'
                        : 'hover:bg-[#1c1d28]'
                    } transition-colors cursor-pointer`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        {isPK && (
                          <Key className="h-3 w-3 text-amber-400 fill-amber-400/30 shrink-0" />
                        )}
                        <span className="truncate font-semibold text-zinc-200 group-hover/th:text-white transition-colors">
                          {col.name}
                        </span>
                      </div>

                      {/* Sort Indicator / Button */}
                      <div className="flex items-center shrink-0">
                        {isSorted && sortItem ? (
                          <span
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-600/25 text-blue-400 text-[10px] font-mono border border-blue-500/30 shadow-xs"
                          >
                            {sortItem.direction === 'asc' ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )}
                            <span className="text-[9px] font-bold">{sortItem.direction.toUpperCase()}</span>
                            {localSortConfigs.length > 1 && (
                              <span
                                className="flex items-center justify-center h-3.5 w-3.5 rounded-full bg-blue-500 text-white text-[9px] font-bold font-mono ml-0.5"
                              >
                                {sortIndex + 1}
                              </span>
                            )}
                          </span>
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-zinc-500 opacity-0 group-hover/th:opacity-75 transition-opacity" />
                        )}
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* 1. Staged Inserted Rows (at top of grid for immediate visibility & editing) */}
            {insertedChanges.map((change, insIdx) => {
              const rowClass = 'border-b border-emerald-800/40 bg-emerald-950/25 hover:bg-emerald-900/35 border-l-4 border-l-emerald-500 transition-colors group/insert';

              return (
                <tr
                  key={change.rowIndex}
                  className={rowClass}
                >
                  <td
                    onMouseDown={(e) => handleRowHeaderMouseDown(e, insIdx)}
                    onMouseEnter={() => handleRowHeaderMouseEnter(insIdx)}
                    onContextMenu={(e) => handleRowHeaderContextMenu(e, insIdx)}
                    className="w-12 px-1 py-1 text-center border-r border-[#272932] select-none text-[11px] font-bold cursor-pointer"
                    title="Click to select row"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span className="text-emerald-400 font-mono text-xs" title="New Staged Row">
                        +{insIdx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          stageRowDelete(tabId, change.rowIndex, {}, {});
                          setSelectionAnchor(null);
                          setSelectionFocus(null);
                        }}
                        className="opacity-0 group-hover/insert:opacity-100 p-0.5 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 rounded transition-opacity cursor-pointer"
                        title="Discard this new row"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </td>

                  {columns.map((col, cIdx) => {
                    const isSelected = isCellSelected(insIdx, cIdx);
                    const isEditing = editingCell?.rowIndex === change.rowIndex && editingCell?.colIndex === cIdx;
                    const colVal = change.changes[col.name];
                    const isSet = colVal !== undefined;
                    const displayVal = isSet ? colVal : (col.defaultValue || null);
                    const colInputType = getColumnInputType(col.dataType);

                    return (
                      <td
                        key={col.name}
                        onMouseDown={(e) => handleCellMouseDown(e, insIdx, cIdx)}
                        onMouseEnter={() => handleCellMouseEnter(insIdx, cIdx)}
                        onContextMenu={(e) => handleCellContextMenu(e, insIdx, cIdx)}
                        onDoubleClick={() => {
                          if (!isEditing) {
                            handleStartEdit(change.rowIndex, cIdx, displayVal ?? '');
                          }
                        }}
                        className={`px-3 py-1 border-r border-[#22242c] truncate max-w-xs cursor-text select-none transition-colors ${
                          isSelected
                            ? 'bg-[#1b4ea3] text-white font-medium'
                            : isSet
                            ? 'bg-emerald-900/40 text-emerald-100 font-medium'
                            : 'text-zinc-500'
                        }`}
                        title="Click to select, double click to edit"
                      >
                        {isEditing ? (
                          <input
                            type={colInputType === 'text' ? 'text' : colInputType}
                            step={colInputType === 'datetime-local' || colInputType === 'time' ? '1' : undefined}
                            autoFocus
                            ref={(el) => {
                              if (colInputType !== 'text') {
                                try { el?.showPicker?.(); } catch {}
                              }
                            }}
                            value={editVal}
                            onChange={(e) => setEditVal(e.target.value)}
                            onBlur={handleFinishEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleFinishEdit();
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingCell(null);
                                if (stagedCount > 0) {
                                  setShowCancelConfirm(true);
                                }
                              }
                              if (e.key === 'Tab') {
                                e.preventDefault();
                                handleFinishEdit();
                                const nextCol = (cIdx + 1) % columns.length;
                                setTimeout(() => {
                                  const nextVal = change.changes[columns[nextCol].name];
                                  handleStartEdit(change.rowIndex, nextCol, nextVal ?? '');
                                }, 10);
                              }
                            }}
                            className={`[color-scheme:dark] w-full bg-[#101115] border border-emerald-500 px-1 py-0.5 text-white outline-none rounded font-mono text-xs shadow-inner ${
                              colInputType !== 'text' ? 'cursor-pointer' : ''
                            }`}
                          />
                        ) : displayVal === null || displayVal === undefined || displayVal === '' ? (
                          <span className={isSelected ? "text-blue-200/80 italic" : "text-zinc-600 italic"}>
                            {col.isAutoIncrement ? '(Auto)' : 'NULL'}
                          </span>
                        ) : (
                          colInputType !== 'text' ? String(displayVal).replace('T', ' ').replace(/Z$/, '') : String(displayVal)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {/* 2. Existing Database Rows */}
            {displayedRows.length === 0 && insertedChanges.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="py-12 text-center text-zinc-500 font-sans">
                  {errorMessage ? (
                    <div className="max-w-lg mx-auto flex flex-col items-center gap-2.5 text-rose-400/90 font-mono text-xs select-text">
                      <div className="flex items-center gap-2 font-semibold text-rose-300">
                        <AlertCircle className="h-4 w-4 text-rose-400" />
                        <span>Query Execution Error</span>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed max-w-md">
                        {errorMessage}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setWhereInput('');
                          onApplyWhere?.('');
                        }}
                        className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-sans font-medium transition-colors cursor-pointer shadow-sm"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Reset WHERE Filter</span>
                      </button>
                    </div>
                  ) : (
                    'No data to display'
                  )}
                </td>
              </tr>
            ) : (
              displayedRows.map((row, rIdx) => {
                const globalRowIndex =
                  viewMode === 'paged' ? (currentPage - 1) * localPageSize + rIdx : rIdx;
                const vIdx = insertedChanges.length + rIdx;
                const staged = stagedChanges[globalRowIndex];
                const isDeleted = staged?.type === 'delete';

                let rowClass = gridRowClass;
                if (isDeleted) rowClass += ' bg-rose-950/20 text-zinc-500 line-through';

                return (
                  <tr
                    key={globalRowIndex}
                    className={rowClass}
                  >
                    <td
                      onMouseDown={(e) => handleRowHeaderMouseDown(e, vIdx)}
                      onMouseEnter={() => handleRowHeaderMouseEnter(vIdx)}
                      onContextMenu={(e) => handleRowHeaderContextMenu(e, vIdx)}
                      className={`px-2 py-1 text-center text-zinc-500 border-r ${gridCellBorder} select-none text-[11px] cursor-pointer hover:text-zinc-300`}
                      title="Click to select row"
                    >
                      {globalRowIndex + 1}
                    </td>
                    {columns.map((col, cIdx) => {
                      const isSelected = isCellSelected(vIdx, cIdx);
                      const isEditing = editingCell?.rowIndex === globalRowIndex && editingCell?.colIndex === cIdx;
                      const hasColChange = staged?.type === 'update' && staged.changes[col.name] !== undefined;
                      const displayVal = hasColChange ? staged.changes[col.name] : row[cIdx];
                      const colInputType = getColumnInputType(col.dataType);

                      return (
                        <td
                          key={col.name}
                          onMouseDown={(e) => handleCellMouseDown(e, vIdx, cIdx)}
                          onMouseEnter={() => handleCellMouseEnter(vIdx, cIdx)}
                          onContextMenu={(e) => handleCellContextMenu(e, vIdx, cIdx)}
                          onDoubleClick={() => handleStartEdit(globalRowIndex, cIdx, displayVal)}
                          className={`px-3 py-1 border-r ${gridCellBorder} truncate max-w-xs select-none transition-colors ${
                            isSelected
                              ? 'bg-[#1b4ea3] text-white font-medium'
                              : hasColChange
                              ? 'bg-blue-900/30 text-blue-200 font-medium'
                              : ''
                          }`}
                        >
                          {isEditing ? (
                            <input
                              type={colInputType === 'text' ? 'text' : colInputType}
                              step={colInputType === 'datetime-local' || colInputType === 'time' ? '1' : undefined}
                              autoFocus
                              ref={(el) => {
                                if (colInputType !== 'text') {
                                  try { el?.showPicker?.(); } catch {}
                                }
                              }}
                              value={editVal}
                              onChange={(e) => setEditVal(e.target.value)}
                              onBlur={handleFinishEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleFinishEdit();
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setEditingCell(null);
                                  if (stagedCount > 0) {
                                    setShowCancelConfirm(true);
                                  }
                                }
                                if (e.key === 'Tab') {
                                  e.preventDefault();
                                  handleFinishEdit();
                                  const nextCol = (cIdx + 1) % columns.length;
                                  setTimeout(() => {
                                    handleStartEdit(globalRowIndex, nextCol, row[nextCol]);
                                  }, 10);
                                }
                              }}
                              className={`[color-scheme:dark] w-full bg-[#121317] border border-blue-500 px-1 py-0.5 text-white outline-none rounded ${
                                colInputType !== 'text' ? 'cursor-pointer' : ''
                              }`}
                            />
                          ) : displayVal === null || displayVal === undefined ? (
                            <span className={isSelected ? "text-blue-200/80 italic" : "text-zinc-600 italic"}>NULL</span>
                          ) : (
                            colInputType !== 'text' ? String(displayVal).replace('T', ' ').replace(/Z$/, '') : String(displayVal)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}

            {/* Bottom Row: Lazy Loading Indicator or Manual Load More */}
            {viewMode === 'infinite' && hasMore && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="py-3 text-center bg-[#14151a]/60 border-t border-[#272932]"
                >
                  {isLoadingMore ? (
                    <div className="flex items-center justify-center gap-2 text-zinc-400 font-sans text-xs">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-400" />
                      <span>Loading next {localPageSize} rows...</span>
                    </div>
                  ) : onLoadMore ? (
                    <button
                      type="button"
                      onClick={onLoadMore}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-[#22242c] hover:bg-blue-600 hover:text-white text-zinc-300 font-sans text-xs transition-colors cursor-pointer border border-[#272932]"
                    >
                      <ArrowDownCircle className="h-3.5 w-3.5 text-blue-400" />
                      <span>Load Next {localPageSize} Rows (Lazy Load)</span>
                    </button>
                  ) : null}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className={`flex h-9 items-center justify-between border-t px-3 ${gridBarBg} text-zinc-400 text-xs shrink-0 select-none`}>
        {/* Left: Row Count Info */}
        <div className="flex items-center gap-2 font-sans text-[11px]">
          {viewMode === 'paged' ? (
            (() => {
              const totalDisplay = isExactTotalKnown ? String(effectiveTotal) : `${endRow}+`;

              return (
                <span>
                  Showing <strong className="text-zinc-200">{startRow}</strong> –{' '}
                  <strong className="text-zinc-200">{endRow}</strong> of{' '}
                  <strong className="text-zinc-200">{totalDisplay}</strong> rows
                </span>
              );
            })()
          ) : (
            <div className="flex items-center gap-2">
              <span>
                Loaded <strong className="text-zinc-200">{rows.length}</strong>
                {isExactTotalKnown ? (
                  <> of <strong className="text-zinc-200">{effectiveTotal}</strong></>
                ) : hasMore ? (
                  <>+ rows</>
                ) : null}{' '}
                rows
              </span>
              {hasMore && onLoadMore && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={isLoadingMore}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 hover:text-blue-300 text-[10px] font-medium border border-blue-500/30 cursor-pointer ml-1 transition-colors"
                  title="Click to load next batch"
                >
                  {isLoadingMore ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <ArrowDownCircle className="h-3 w-3" />
                  )}
                  <span>+{localPageSize} more</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Center: Paged Navigation Controls (if Paged Mode) */}
        {viewMode === 'paged' ? (
          <div className="flex items-center gap-1 font-mono">
            <button
              onClick={() => handleNavigatePage(1)}
              disabled={currentPage <= 1 || isLoadingMore}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title="First Page"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handleNavigatePage(currentPage - 1)}
              disabled={currentPage <= 1 || isLoadingMore}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title="Previous Page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>

            <span className="px-2 text-zinc-300 font-sans text-[11px] flex items-center gap-1">
              <span>Page</span>
              <strong className="text-white font-mono">{currentPage}</strong>
              <span>of</span>
              <strong className="text-white font-mono">
                {totalPages}{!isExactTotalKnown ? '+' : ''}
              </strong>
              {isLoadingMore && <RefreshCw className="h-3 w-3 animate-spin text-blue-400 ml-1" />}
            </span>

            <button
              onClick={() => handleNavigatePage(currentPage + 1)}
              disabled={(isExactTotalKnown ? currentPage >= totalPages : !hasMore) || isLoadingMore}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title="Next Page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handleNavigatePage(totalPages)}
              disabled={!isExactTotalKnown || currentPage >= totalPages || isLoadingMore}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title={isExactTotalKnown ? `Last Page (${totalPages})` : 'Last page unknown until end reached'}
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-zinc-500 font-sans text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span>Lazy Load Active</span>
          </div>
        )}

        {/* Right: Batch Size Selector (Opens Upward) */}
        <div className="relative flex items-center gap-2" ref={batchSizeRef}>
          <span className="text-zinc-400 font-sans text-[11px] font-medium">Batch size:</span>
          <button
            type="button"
            onClick={() => setIsBatchSizeOpen((prev) => !prev)}
            className="flex items-center gap-1.5 h-6 rounded bg-[#22242c] hover:bg-[#2c303c] border border-[#3b3e4f] px-2 text-[11px] font-mono font-medium text-amber-300 hover:text-amber-200 transition-colors cursor-pointer shadow-xs"
            title="Batch size per page or lazy load batch (opens upward)"
          >
            <span>{localPageSize} rows</span>
            <ChevronUp
              className={`h-3 w-3 text-zinc-400 transition-transform duration-150 ${
                isBatchSizeOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isBatchSizeOpen && (
            <div className="absolute bottom-full right-0 mb-1.5 min-w-[130px] rounded-md border border-[#3b3e4f] bg-[#191a20] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 border-b border-[#272932] mb-1 flex items-center justify-between">
                <span>Batch Size</span>
                <span className="font-mono text-zinc-500 text-[9px]">LIMIT</span>
              </div>
              {Array.from(new Set([25, 50, 100, 250, 500, globalDefaultPageSize, localPageSize]))
                .sort((a, b) => a - b)
                .map((size) => {
                const isSelected = size === localPageSize;
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      handlePageSizeChange(size);
                      setIsBatchSizeOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-2.5 py-1.5 rounded cursor-pointer text-xs font-mono transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white font-bold'
                        : 'text-zinc-200 hover:bg-[#2c303c] hover:text-white'
                    }`}
                  >
                    <span>{size} rows</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-white shrink-0 ml-2" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Column Hover Metadata Popover Card */}
      {hoveredCol && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border border-[#3b3e4f] bg-[#16171f]/95 backdrop-blur-md shadow-2xl p-3 text-xs font-sans min-w-[220px] max-w-[320px] animate-in fade-in zoom-in-95 duration-100"
          style={{ top: hoveredCol.y, left: hoveredCol.x }}
        >
          {/* Header: Name + PK Badge */}
          <div className="flex items-center justify-between gap-2 border-b border-[#272932] pb-2 mb-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {hoveredCol.isPK ? (
                <Key className="h-3.5 w-3.5 text-amber-400 fill-amber-400/30 shrink-0" />
              ) : (
                <Hash className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
              )}
              <span className="font-bold text-zinc-100 truncate text-[13px]">{hoveredCol.col.name}</span>
            </div>
            {hoveredCol.isPK && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono shrink-0">
                PRIMARY KEY
              </span>
            )}
          </div>

          {/* Metadata Rows */}
          <div className="space-y-1.5 text-[11px]">
            {/* Data Type */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">Data Type:</span>
              <span className="font-mono font-medium text-blue-400 uppercase bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-900/40">
                {hoveredCol.col.dataType || 'UNKNOWN'}
              </span>
            </div>

            {/* Size / Length if extracted */}
            {hoveredCol.details.size && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500">Length / Size:</span>
                <span className="font-mono text-zinc-300">{hoveredCol.details.size}</span>
              </div>
            )}

            {/* Nullable */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">Nullable:</span>
              <span
                className={`font-mono text-[10px] ${
                  hoveredCol.col.isNullable ? 'text-zinc-400' : 'text-amber-400/90 font-semibold'
                }`}
              >
                {hoveredCol.col.isNullable ? 'YES (NULL)' : 'NO (NOT NULL)'}
              </span>
            </div>

            {/* Auto Increment */}
            {hoveredCol.col.isAutoIncrement && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500">Extra:</span>
                <span className="font-mono text-emerald-400 text-[10px]">auto_increment</span>
              </div>
            )}

            {/* Default Value */}
            {hoveredCol.col.defaultValue !== undefined && hoveredCol.col.defaultValue !== '' && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500">Default:</span>
                <span className="font-mono text-zinc-400 truncate max-w-[150px]">
                  {hoveredCol.col.defaultValue}
                </span>
              </div>
            )}

            {/* Comment / Description */}
            {hoveredCol.col.comment && (
              <div className="mt-2 pt-2 border-t border-[#272932]">
                <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-0.5">
                  Description
                </div>
                <div className="text-zinc-300 text-[11px] leading-relaxed italic">
                  {hoveredCol.col.comment}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cancel Changes Confirmation Modal */}
      {showCancelConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setShowCancelConfirm(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[#2b2e3a] bg-[#14151a] p-5 shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/10 border border-rose-500/25 text-rose-400">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-zinc-100">
                  Discard Staged Changes?
                </h3>
                <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                  There are <span className="font-semibold text-rose-300 font-mono">{stagedCount}</span> unsaved change(s). All pending row additions, edits, or deletions will be reverted to database values.
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  Are you sure you want to discard these changes?
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530]">
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#20222a] hover:bg-[#2b2d38] border border-[#2d303f] text-zinc-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
              >
                <span>Keep Changes</span>
                <kbd className="text-[10px] text-zinc-500 font-mono bg-[#14151a] px-1 rounded border border-[#2d303f]">Esc</kbd>
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  revertTabChanges(tabId);
                  setEditingCell(null);
                  if (selectedRowIndex !== null && selectedRowIndex < 0) {
                    setSelectionAnchor(null);
                    setSelectionFocus(null);
                  }
                  setShowCancelConfirm(false);
                }}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors cursor-pointer shadow-sm"
              >
                <span>Discard Changes</span>
                <kbd className="text-[10px] text-rose-200 font-mono bg-rose-700/60 px-1 rounded">↵ Enter</kbd>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Floating Context Menu */}
      {contextMenu.isOpen && (
        <div
          className="fixed z-50 min-w-[210px] rounded-lg border border-[#2e313d] bg-[#181920]/95 backdrop-blur-md p-1 shadow-2xl text-[12px] text-zinc-300 select-none animate-in fade-in zoom-in-95 duration-100"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-[#272932] mb-1 truncate flex items-center justify-between">
            <span>Grid Actions</span>
            {selectionRange && (
              <span className="text-zinc-600 font-mono text-[9px]">
                {selectionRange.endR - selectionRange.startR + 1}r × {selectionRange.endC - selectionRange.startC + 1}c
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              handleCopySelection(false);
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
              <span>Copy Selection</span>
            </div>
            <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">{modKey}+C</kbd>
          </button>

          <button
            type="button"
            onClick={() => {
              handleCopySelection(true);
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
              <span>Copy with Headers</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              handleCopyAsJson();
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <Code className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
              <span>Copy as JSON</span>
            </div>
          </button>

          <div className="my-1 border-t border-[#272932]" />

          <button
            type="button"
            onClick={() => {
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
              handleDuplicateRow();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <Copy className="h-3.5 w-3.5 text-sky-400 group-hover:text-white" />
              <span>Duplicate Row(s)</span>
            </div>
            <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">{modKey}+D</kbd>
          </button>

          <button
            type="button"
            onClick={() => {
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
              handleAddRow();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <Plus className="h-3.5 w-3.5 text-emerald-400 group-hover:text-white" />
              <span>Add New Row</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
              handleDeleteActiveRow();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-300 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
              <span>Delete Row(s)</span>
            </div>
            <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">{isMac ? 'Cmd+⌫' : 'Del'}</kbd>
          </button>

          <div className="my-1 border-t border-[#272932]" />

          {contextMenu.vIdx !== null && contextMenu.cIdx !== null && (
            <>
              <button
                type="button"
                onClick={() => {
                  const { vIdx, cIdx } = contextMenu;
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                  if (vIdx !== null && cIdx !== null) {
                    const vr = visualRows[vIdx];
                    if (vr) {
                      const col = columns[cIdx];
                      let displayVal: any;
                      if (vr.isInsert) {
                        const staged = vr.insertChange;
                        displayVal = staged?.changes[col.name] !== undefined ? staged.changes[col.name] : (col.defaultValue ?? '');
                      } else {
                        const staged = stagedChanges[vr.globalRowIndex!];
                        displayVal = staged?.type === 'update' && staged.changes[col.name] !== undefined ? staged.changes[col.name] : vr.rowData?.[cIdx];
                      }
                      handleStartEdit(vr.rowId, cIdx, displayVal);
                    }
                  }
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Edit3 className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                  <span>Edit Cell</span>
                </div>
                <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">Double-Click</kbd>
              </button>

              <button
                type="button"
                onClick={() => {
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                  handleSetSelectedToNull();
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Ban className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                  <span>Set to NULL</span>
                </div>
              </button>
              <div className="my-1 border-t border-[#272932]" />
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
              if (visualRows.length > 0 && columns.length > 0) {
                setSelectionAnchor({ r: 0, c: 0 });
                setSelectionFocus({ r: visualRows.length - 1, c: columns.length - 1 });
              }
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <CheckSquare className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
              <span>Select All</span>
            </div>
            <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">{modKey}+A</kbd>
          </button>
        </div>
      )}
    </div>
  );
};
