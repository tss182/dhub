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
} from 'lucide-react';

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
}) => {
  const [filterText, setFilterText] = useState('');
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; colIndex: number } | null>(null);
  const [editVal, setEditVal] = useState<string>('');
  const globalViewMode = useSettingsStore((state) => state.dataViewMode);
  const globalDefaultPageSize = useSettingsStore((state) => state.defaultPageSize);
  const viewMode = globalViewMode;

  const [currentPage, setCurrentPage] = useState(page || 1);
  const [localPageSize, setLocalPageSize] = useState(pageSize || globalDefaultPageSize || 100);
  const [isBatchSizeOpen, setIsBatchSizeOpen] = useState(false);
  const [knownTotal, setKnownTotal] = useState<number | undefined>(totalCount);

  const containerRef = useRef<HTMLDivElement>(null);
  const batchSizeRef = useRef<HTMLDivElement>(null);

  // Sync external page prop
  useEffect(() => {
    if (page && page !== currentPage) {
      setCurrentPage(page);
    }
  }, [page]);

  // Sync external totalCount prop
  useEffect(() => {
    if (totalCount !== undefined) {
      setKnownTotal(totalCount);
    }
  }, [totalCount]);

  // Reset knownTotal when tabId changes unless totalCount is provided
  useEffect(() => {
    setKnownTotal(totalCount);
  }, [tabId, totalCount]);

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

  // When we hit a page where hasMore is false, the exact total count is known
  useEffect(() => {
    if (!hasMore && displayedRows.length >= 0) {
      const exact = isMultiPageInMemory
        ? filteredRows.length
        : (currentPage - 1) * localPageSize + displayedRows.length;
      setKnownTotal(exact);
    }
  }, [hasMore, currentPage, localPageSize, displayedRows.length, isMultiPageInMemory, filteredRows.length]);

  // Determine effective total rows
  const effectiveTotal =
    knownTotal !== undefined
      ? knownTotal
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
      if (scrollHeight - scrollTop - clientHeight < 120) {
        onLoadMore();
      }
    }
  };

  const handleNavigatePage = (targetPage: number) => {
    const clamped = Math.max(1, Math.min(targetPage, totalPages));
    setCurrentPage(clamped);
    if (onPageChange) {
      onPageChange(clamped);
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setLocalPageSize(newSize);
    setCurrentPage(1);
    setKnownTotal(totalCount);
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
              {columns.map((col) => (
                <th
                  key={col.name}
                  className="px-3 py-1.5 text-left font-semibold border-r border-[#272932] text-zinc-200"
                >
                  <div className="flex items-center gap-1.5">
                    <span>{col.name}</span>
                    {col.isPrimaryKey && <span className="text-[10px] text-amber-400 font-normal">(PK)</span>}
                    <span className="text-[10px] text-zinc-500 font-normal font-sans">{col.dataType}</span>
                  </div>
                </th>
              ))}
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
                knownTotal !== undefined
                  ? String(knownTotal)
                  : hasMore
                  ? `${endRow}+`
                  : String(endRow);

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
                {knownTotal !== undefined ? (
                  <> of <strong className="text-zinc-200">{knownTotal}</strong></>
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
                {totalPages}{knownTotal === undefined && hasMore ? '+' : ''}
              </strong>
              {isLoadingMore && <RefreshCw className="h-3 w-3 animate-spin text-blue-400 ml-1" />}
            </span>

            <button
              onClick={() => handleNavigatePage(currentPage + 1)}
              disabled={(knownTotal !== undefined ? currentPage >= totalPages : !hasMore) || isLoadingMore}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title="Next Page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handleNavigatePage(totalPages)}
              disabled={knownTotal === undefined || currentPage >= totalPages || isLoadingMore}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title={knownTotal !== undefined ? `Last Page (${totalPages})` : 'Last page unknown until end reached'}
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
    </div>
  );
};
