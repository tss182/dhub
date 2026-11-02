import React, { useState, useEffect, useRef } from 'react';
import { ColumnMeta } from '../../types/domain';
import { useGridEditStore } from '../../stores/useGridEditStore';
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
} from 'lucide-react';

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

export interface ColumnFilterItem {
  op: string;
  value: string;
}

export const FILTER_OPERATORS = [
  { label: '= (Equals)', value: '=' },
  { label: 'LIKE (Contains)', value: 'LIKE' },
  { label: 'NOT LIKE', value: 'NOT LIKE' },
  { label: '!= (Not Equals)', value: '!=' },
  { label: '> (Greater Than)', value: '>' },
  { label: '< (Less Than)', value: '<' },
  { label: '>= (Greater or Equal)', value: '>=' },
  { label: '<= (Less or Equal)', value: '<=' },
  { label: 'IS NULL', value: 'IS NULL' },
  { label: 'IS NOT NULL', value: 'IS NOT NULL' },
];

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
  columnFilters?: Record<string, ColumnFilterItem>;
  onApplyFilters?: (whereClause: string, columnFilters: Record<string, ColumnFilterItem>) => void;
  isTableTab?: boolean;
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
  columnFilters = {},
  onApplyFilters,
  isTableTab = false,
}) => {
  const [filterText, setFilterText] = useState('');
  const [whereInput, setWhereInput] = useState(whereClause || '');
  const [localColFilters, setLocalColFilters] = useState<Record<string, ColumnFilterItem>>(columnFilters || {});
  const [openColFilter, setOpenColFilter] = useState<{
    colName: string;
    x: number;
    y: number;
    op: string;
    value: string;
  } | null>(null);

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

  const colFilterRef = useRef<HTMLDivElement>(null);

  // Sync external filter props
  useEffect(() => {
    setWhereInput(whereClause || '');
  }, [whereClause]);

  useEffect(() => {
    setLocalColFilters(columnFilters || {});
  }, [columnFilters]);

  // Close column filter popover on click outside or Escape
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (colFilterRef.current && !colFilterRef.current.contains(e.target as Node)) {
        setOpenColFilter(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenColFilter(null);
    };

    if (openColFilter) {
      window.addEventListener('mousedown', handleOutsideClick);
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openColFilter]);

  const handleApplyAllFilters = (wText: string, cFilters: Record<string, ColumnFilterItem>) => {
    onApplyFilters?.(wText, cFilters);
  };

  const handleOpenColFilter = (e: React.MouseEvent, colName: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const current = localColFilters[colName] || { op: 'LIKE', value: '' };
    const popoverWidth = 260;
    const x = Math.min(rect.left, window.innerWidth - popoverWidth - 16);
    const y = rect.bottom + 4;
    setOpenColFilter({
      colName,
      x: Math.max(8, x),
      y,
      op: current.op || 'LIKE',
      value: current.value || '',
    });
  };

  const handleSaveColFilter = () => {
    if (!openColFilter) return;
    const isNullOp = ['IS NULL', 'IS NOT NULL'].includes(openColFilter.op);
    if (!isNullOp && !openColFilter.value.trim()) {
      handleRemoveColFilter(openColFilter.colName);
      return;
    }

    const updated = {
      ...localColFilters,
      [openColFilter.colName]: {
        op: openColFilter.op,
        value: openColFilter.value.trim(),
      },
    };
    setLocalColFilters(updated);
    setOpenColFilter(null);
    handleApplyAllFilters(whereInput, updated);
  };

  const handleRemoveColFilter = (colName: string) => {
    const updated = { ...localColFilters };
    delete updated[colName];
    setLocalColFilters(updated);
    if (openColFilter?.colName === colName) {
      setOpenColFilter(null);
    }
    handleApplyAllFilters(whereInput, updated);
  };

  const handleResetAllFilters = () => {
    setWhereInput('');
    setLocalColFilters({});
    handleApplyAllFilters('', {});
  };

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

  const handleStartEdit = (rowIndex: number, colIndex: number, currentVal: any) => {
    setEditingCell({ rowIndex, colIndex });
    setEditVal(currentVal !== null && currentVal !== undefined ? String(currentVal) : '');
  };

  const handleFinishEdit = () => {
    if (!editingCell) return;
    const { rowIndex, colIndex } = editingCell;
    const col = columns[colIndex];
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

    stageCellUpdate(tabId, rowIndex, pkMap, originalRowValues, col.name, editVal);
    setEditingCell(null);
  };

  // Filter rows client-side
  const filteredRows = rows.filter((r) => {
    if (!filterText) return true;
    return r.some((cell) => String(cell).toLowerCase().includes(filterText.toLowerCase()));
  });

  const isMultiPageInMemory = filteredRows.length > localPageSize;

  // Rows to display based on viewMode
  const displayedRows =
    viewMode === 'paged'
      ? isMultiPageInMemory
        ? filteredRows.slice((currentPage - 1) * localPageSize, currentPage * localPageSize)
        : filteredRows
      : filteredRows;

  // Determine effective total rows
  const effectiveTotal =
    totalCount !== undefined
      ? totalCount
      : isMultiPageInMemory
      ? filteredRows.length
      : hasMore
      ? currentPage * localPageSize + 1
      : (currentPage - 1) * localPageSize + displayedRows.length;

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
    const maxPage =
      totalCount !== undefined ? totalPages : hasMore ? Math.max(totalPages, targetPage) : totalPages;
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

  return (
    <div className="flex h-full flex-col bg-[#191a20] text-xs select-text">
      {/* Table Toolbar */}
      <div className="flex h-10 items-center justify-between border-b border-[#272932] px-3 bg-[#14151a]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => stageRowInsert(tabId, -Date.now())}
            className="flex items-center gap-1 rounded bg-[#22242c] hover:bg-[#2b2d37] px-2 py-1 text-zinc-300 transition-colors cursor-pointer"
            title="Add New Row"
          >
            <Plus className="h-3.5 w-3.5 text-emerald-400" />
            <span>Add Row</span>
          </button>

          <button
            onClick={() => {
              if (rows.length > 0) {
                const pkMap: Record<string, unknown> = {};
                primaryKeys.forEach((pk) => {
                  const idx = columns.findIndex((c) => c.name === pk);
                  if (idx !== -1) pkMap[pk] = rows[0][idx];
                });
                stageRowDelete(tabId, 0, pkMap, {});
              }
            }}
            className="flex items-center gap-1 rounded bg-[#22242c] hover:bg-[#2b2d37] px-2 py-1 text-zinc-300 transition-colors cursor-pointer"
            title="Delete Selected Row"
          >
            <Trash2 className="h-3.5 w-3.5 text-rose-400" />
            <span>Delete</span>
          </button>

          <div className="h-4 w-[1px] bg-[#272932] mx-1" />

          {onRefresh && (
            <button
              onClick={onRefresh}
              className="flex items-center gap-1 rounded bg-[#22242c] hover:bg-[#2b2d37] px-2 py-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              title="Refresh / Reload data"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Reload</span>
            </button>
          )}

          {stagedCount > 0 && (
            <>
              <button
                onClick={onPreviewChanges}
                className="flex items-center gap-1 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 px-2.5 py-1 transition-colors cursor-pointer"
                title="Preview SQL DML"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Preview DML</span>
              </button>

              <button
                onClick={onSubmitChanges}
                className="flex items-center gap-1 rounded bg-emerald-600 text-white hover:bg-emerald-500 px-2.5 py-1 font-medium transition-colors cursor-pointer shadow-sm"
                title="Submit Changes (Ctrl+Enter)"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Submit ({stagedCount})</span>
              </button>

              <button
                onClick={() => revertTabChanges(tabId)}
                className="flex items-center gap-1 rounded bg-[#22242c] hover:bg-[#2b2d37] px-2 py-1 text-zinc-400 transition-colors cursor-pointer"
                title="Revert Staged Changes"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Revert</span>
              </button>
            </>
          )}
        </div>

        {/* Toolbar Right: Filter Input + View Mode Toggle */}
        <div className="flex items-center gap-3">
          {/* Quick Filter */}
          <div className="relative flex items-center">
            <Search className="h-3 w-3 text-zinc-500 absolute left-2 pointer-events-none" />
            <input
              type="text"
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
      {onApplyFilters && (
        <div className="flex flex-col border-b border-[#272932] bg-[#14151a]">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <div className="flex items-center gap-1.5 shrink-0 select-none">
              <span className="font-mono text-[11px] font-bold text-blue-400 bg-blue-950/40 border border-blue-800/40 px-2 py-0.5 rounded">
                WHERE
              </span>
            </div>
            <div className="relative flex-1 flex items-center">
              <input
                type="text"
                placeholder="e.g. name like '%user' and id = '1'  (Press Enter to apply)"
                value={whereInput}
                onChange={(e) => setWhereInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleApplyAllFilters(whereInput, localColFilters);
                  }
                }}
                className="w-full h-7 rounded bg-[#101115] border border-[#2b2e3a] pl-3 pr-7 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none transition-colors"
              />
              {whereInput && (
                <button
                  type="button"
                  onClick={() => {
                    setWhereInput('');
                    handleApplyAllFilters('', localColFilters);
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
              onClick={() => handleApplyAllFilters(whereInput, localColFilters)}
              className="flex items-center gap-1.5 h-7 px-3 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors cursor-pointer shadow-xs shrink-0"
              title="Apply WHERE filter (Enter)"
            >
              <Filter className="h-3 w-3" />
              <span>Apply</span>
            </button>

            {(whereInput || Object.keys(localColFilters).length > 0) && (
              <button
                type="button"
                onClick={handleResetAllFilters}
                className="flex items-center gap-1 h-7 px-2.5 rounded bg-[#20222b] hover:bg-rose-950/40 hover:text-rose-300 text-zinc-400 border border-[#272932] text-xs transition-colors cursor-pointer shrink-0"
                title="Clear all filters (WHERE + Column filters)"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset All</span>
              </button>
            )}
          </div>

          {/* Active Column Filter Badges / Pills */}
          {Object.keys(localColFilters).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 py-1 bg-[#101115] border-t border-[#22242c] text-[11px]">
              <span className="text-zinc-500 text-[10px] uppercase font-semibold tracking-wider select-none">
                Column Filters ({Object.keys(localColFilters).length}):
              </span>
              {Object.entries(localColFilters).map(([cName, f]) => (
                <span
                  key={cName}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-950/60 border border-blue-800/40 text-blue-300 font-mono text-[11px]"
                >
                  <span className="font-semibold text-zinc-200">{cName}</span>
                  <span className="text-blue-400 font-semibold">{f.op}</span>
                  {!['IS NULL', 'IS NOT NULL'].includes(f.op) && (
                    <span className="text-zinc-300 truncate max-w-[120px]">'{f.value}'</span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveColFilter(cName)}
                    className="text-zinc-400 hover:text-white cursor-pointer ml-0.5"
                    title={`Remove filter for ${cName}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Grid Table Container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto min-h-0 relative"
      >
        <table className="w-full border-collapse font-mono text-[12px] text-zinc-300">
          <thead className="sticky top-0 bg-[#14151a] shadow-sm z-10">
            <tr className="border-b border-[#272932]">
              <th className="w-12 px-2 py-1.5 text-center text-zinc-500 font-normal border-r border-[#272932]">#</th>
              {columns.map((col) => {
                const isFiltered = Boolean(localColFilters[col.name]);
                const isPK = Boolean(col.isPrimaryKey || primaryKeys.includes(col.name));
                return (
                  <th
                    key={col.name}
                    onMouseEnter={(e) => handleColMouseEnter(e, col, isPK)}
                    onMouseLeave={handleColMouseLeave}
                    className="px-3 py-1.5 text-left font-semibold border-r border-[#272932] text-zinc-200 group/th select-none hover:bg-[#1a1b24] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 truncate cursor-default">
                        {isPK && (
                          <Key className="h-3 w-3 text-amber-400 fill-amber-400/30 shrink-0" />
                        )}
                        <span className="truncate font-semibold text-zinc-200">{col.name}</span>
                      </div>

                      {onApplyFilters && (
                        <button
                          type="button"
                          onClick={(e) => {
                            handleColMouseLeave();
                            handleOpenColFilter(e, col.name);
                          }}
                          className={`p-1 rounded transition-colors cursor-pointer shrink-0 ${
                            isFiltered
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'text-zinc-500 hover:text-zinc-200 hover:bg-[#252834] opacity-40 group-hover/th:opacity-100'
                          }`}
                          title={
                            isFiltered
                              ? `Filter active: ${col.name} ${localColFilters[col.name].op} '${localColFilters[col.name].value}'`
                              : `Filter by ${col.name}`
                          }
                        >
                          <Filter className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="py-12 text-center text-zinc-500 font-sans">
                  No data to display
                </td>
              </tr>
            ) : (
              displayedRows.map((row, rIdx) => {
                const globalRowIndex =
                  viewMode === 'paged' ? (currentPage - 1) * localPageSize + rIdx : rIdx;
                const staged = stagedChanges[globalRowIndex];
                const isDeleted = staged?.type === 'delete';
                const isInserted = staged?.type === 'insert';

                let rowClass = 'border-b border-[#22242c] hover:bg-[#20222a]';
                if (isDeleted) rowClass += ' bg-rose-950/20 text-zinc-500 line-through';
                if (isInserted) rowClass += ' bg-emerald-950/20 border-l-2 border-emerald-500';

                return (
                  <tr key={globalRowIndex} className={rowClass}>
                    <td className="px-2 py-1 text-center text-zinc-600 border-r border-[#272932] select-none text-[11px]">
                      {globalRowIndex + 1}
                    </td>
                    {columns.map((col, cIdx) => {
                      const isEditing = editingCell?.rowIndex === globalRowIndex && editingCell?.colIndex === cIdx;
                      const hasColChange = staged?.type === 'update' && staged.changes[col.name] !== undefined;
                      const displayVal = hasColChange ? staged.changes[col.name] : row[cIdx];

                      return (
                        <td
                          key={col.name}
                          onDoubleClick={() => handleStartEdit(globalRowIndex, cIdx, displayVal)}
                          className={`px-3 py-1 border-r border-[#22242c] truncate max-w-xs ${
                            hasColChange ? 'bg-blue-900/30 text-blue-200 font-medium' : ''
                          }`}
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              autoFocus
                              value={editVal}
                              onChange={(e) => setEditVal(e.target.value)}
                              onBlur={handleFinishEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleFinishEdit();
                                if (e.key === 'Escape') setEditingCell(null);
                              }}
                              className="w-full bg-[#121317] border border-blue-500 px-1 py-0.5 text-white outline-none rounded"
                            />
                          ) : displayVal === null || displayVal === undefined ? (
                            <span className="text-zinc-600 italic">NULL</span>
                          ) : (
                            String(displayVal)
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
      <div className="flex h-9 items-center justify-between border-t border-[#272932] px-3 bg-[#14151a] text-zinc-400 text-xs shrink-0 select-none">
        {/* Left: Row Count Info */}
        <div className="flex items-center gap-2 font-sans text-[11px]">
          {viewMode === 'paged' ? (
            (() => {
              const startRow = displayedRows.length === 0 ? 0 : (currentPage - 1) * localPageSize + 1;
              const endRow = (currentPage - 1) * localPageSize + displayedRows.length;
              const totalText =
                totalCount !== undefined
                  ? String(totalCount)
                  : hasMore
                  ? `${endRow}+`
                  : String(effectiveTotal);

              return (
                <span>
                  Showing <strong className="text-zinc-200">{startRow}</strong> –{' '}
                  <strong className="text-zinc-200">{endRow}</strong> of{' '}
                  <strong className="text-zinc-200">{totalText}</strong> rows
                </span>
              );
            })()
          ) : (
            <div className="flex items-center gap-2">
              <span>
                Loaded <strong className="text-zinc-200">{rows.length}</strong>
                {totalCount !== undefined ? (
                  <> of <strong className="text-zinc-200">{totalCount}</strong></>
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
                {totalPages}{totalCount === undefined && hasMore ? '+' : ''}
              </strong>
              {isLoadingMore && <RefreshCw className="h-3 w-3 animate-spin text-blue-400 ml-1" />}
            </span>

            <button
              onClick={() => handleNavigatePage(currentPage + 1)}
              disabled={(totalCount !== undefined ? currentPage >= totalPages : !hasMore) || isLoadingMore}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title="Next Page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handleNavigatePage(totalPages)}
              disabled={totalCount === undefined || currentPage >= totalPages || isLoadingMore}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title={totalCount !== undefined ? `Last Page (${totalPages})` : 'Last page unknown until end reached'}
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

      {/* Floating Column Filter Popover */}
      {openColFilter && (
        <div
          ref={colFilterRef}
          style={{ top: openColFilter.y, left: openColFilter.x }}
          className="fixed z-50 w-68 rounded-lg bg-[#181920] border border-[#2e313d] shadow-2xl p-3 text-xs text-zinc-300 font-sans select-none animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-[#272932] pb-2 mb-2.5">
            <div className="flex items-center gap-1.5 truncate">
              <Filter className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <span className="font-semibold text-zinc-100 truncate">{openColFilter.colName}</span>
              <span className="text-[10px] text-zinc-500 font-mono">
                {columns.find((c) => c.name === openColFilter.colName)?.dataType}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpenColFilter(null)}
              className="text-zinc-400 hover:text-white cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="text-[10px] uppercase font-semibold text-zinc-400 block mb-1 tracking-wider">
                Operator
              </label>
              <select
                value={openColFilter.op}
                onChange={(e) =>
                  setOpenColFilter((prev) => (prev ? { ...prev, op: e.target.value } : null))
                }
                className="w-full h-7 rounded bg-[#101115] border border-[#2e313f] px-2 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none cursor-pointer"
              >
                {FILTER_OPERATORS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            {!['IS NULL', 'IS NOT NULL'].includes(openColFilter.op) && (
              <div>
                <label className="text-[10px] uppercase font-semibold text-zinc-400 block mb-1 tracking-wider">
                  Filter Value
                </label>
                <input
                  type="text"
                  autoFocus
                  placeholder={openColFilter.op === 'LIKE' ? 'e.g. %user or text' : 'Value...'}
                  value={openColFilter.value}
                  onChange={(e) =>
                    setOpenColFilter((prev) => (prev ? { ...prev, value: e.target.value } : null))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveColFilter();
                    }
                  }}
                  className="w-full h-7 rounded bg-[#101115] border border-[#2e313f] px-2 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-[#272932]">
              {localColFilters[openColFilter.colName] ? (
                <button
                  type="button"
                  onClick={() => handleRemoveColFilter(openColFilter.colName)}
                  className="text-rose-400 hover:text-rose-300 text-[11px] cursor-pointer"
                >
                  Clear Filter
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpenColFilter(null)}
                  className="px-2.5 py-1 rounded bg-[#20222b] hover:bg-[#282a35] text-zinc-300 text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveColFilter}
                  className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors cursor-pointer shadow-xs"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Column Hover Metadata Tooltip Card */}
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
    </div>
  );
};
