import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
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
  onApplyWhere?: (whereClause: string) => void;
  isTableTab?: boolean;
  sortConfigs?: SortConfig[];
  onSortChange?: (sortConfigs: SortConfig[]) => void;
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
  onApplyWhere,
  isTableTab = false,
  sortConfigs = [],
  onSortChange,
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
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#272932] bg-[#14151a]">
          <div className="flex items-center gap-1.5 shrink-0 select-none">
            <span className="font-mono text-[11px] font-bold text-blue-400 bg-blue-950/40 border border-blue-800/40 px-2 py-0.5 rounded">
              WHERE
            </span>
          </div>
          <div className="relative flex-1 flex items-center">
            <input
              type="text"
              placeholder="e.g. name like '%user' and id = '1' (Press Enter to apply)"
              value={whereInput}
              onChange={(e) => setWhereInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onApplyWhere?.(whereInput);
                }
              }}
              className="w-full h-7 rounded bg-[#101115] border border-[#2b2e3a] pl-3 pr-7 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none transition-colors"
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
                    className="px-3 py-1.5 text-left font-semibold border-r border-[#272932] text-zinc-200 group/th select-none hover:bg-[#1c1d28] transition-colors cursor-pointer"
                    title={
                      isSorted && sortItem
                        ? `Sort priority #${sortIndex + 1} (${sortItem.direction.toUpperCase()}). Click to switch to ${
                            sortItem.direction === 'asc' ? 'DESC' : 'remove sort'
                          }.`
                        : `Click to add ${col.name} to multi-sort (Priority #${localSortConfigs.length + 1})`
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        {isPK && (
                          <Key className="h-3 w-3 text-amber-400 fill-amber-400/30 shrink-0" />
                        )}
                        <span className="truncate font-semibold text-zinc-200 group-hover/th:text-white transition-colors">
                          {col.name}
                        </span>
                        <span className="text-[10px] text-zinc-500 font-normal font-sans">
                          {col.dataType}
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
                                title={`Sort priority #${sortIndex + 1}`}
                              >
                                {sortIndex + 1}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span title={`Click to sort by ${col.name}`}>
                            <ArrowUpDown className="h-3 w-3 text-zinc-500 opacity-0 group-hover/th:opacity-75 transition-opacity" />
                          </span>
                        )}
                      </div>
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
