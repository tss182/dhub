import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  RefreshCw,
  Check,
} from 'lucide-react';
import { APP_DEFAULTS } from '../../config/defaults';

interface GridPaginationProps {
  currentPage: number;
  totalPages: number;
  startRow: number;
  endRow: number;
  effectiveTotal: number;
  isExactTotalKnown: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  isLoadingPrevious: boolean;
  isCountingTotal: boolean;
  hasCountRows: boolean;
  localPageSize: number;
  globalDefaultPageSize: number;
  isPageSizeOpen: boolean;
  pageSizeMenuRef: React.RefObject<HTMLDivElement>;
  onTogglePageSizeMenu: () => void;
  onClosePageSizeMenu: () => void;
  onNavigatePage: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onCountRows: () => void;
  onLastPage: () => void;
}

export const GridPagination: React.FC<GridPaginationProps> = ({
  currentPage,
  totalPages,
  startRow,
  endRow,
  effectiveTotal,
  isExactTotalKnown,
  hasMore,
  isLoadingMore,
  isLoadingPrevious,
  isCountingTotal,
  hasCountRows,
  localPageSize,
  globalDefaultPageSize,
  isPageSizeOpen,
  pageSizeMenuRef,
  onTogglePageSizeMenu,
  onClosePageSizeMenu,
  onNavigatePage,
  onPageSizeChange,
  onCountRows,
  onLastPage,
}) => {
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-lg border border-[#3b3e4f] bg-[#23252c]/95 backdrop-blur-md px-2 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.55)] text-xs text-zinc-300 select-none">
      <button
        type="button"
        onClick={() => onNavigatePage(1)}
        disabled={currentPage <= 1 || isLoadingMore}
        className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#323541] disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition-colors"
        title="First Page"
      >
        <ChevronsLeft className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onNavigatePage(currentPage - 1)}
        disabled={currentPage <= 1 || isLoadingMore}
        className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#323541] disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition-colors"
        title="Previous Page"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-center gap-1.5 px-1.5 text-[11px] font-mono tabular-nums">
        <div className="relative" ref={pageSizeMenuRef}>
          <button
            type="button"
            onClick={onTogglePageSizeMenu}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[#323541] text-zinc-100 font-medium transition-colors cursor-pointer"
            title="Select rows per page"
          >
            <span>
              {startRow}-{endRow}
            </span>
            <ChevronDown
              className={`h-3 w-3 text-zinc-400 transition-transform duration-150 ${
                isPageSizeOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isPageSizeOpen && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 min-w-[120px] rounded-md border border-[#3b3e4f] bg-[#191a20] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2 py-1 text-[10px] font-sans font-semibold uppercase tracking-wider text-zinc-400 border-b border-[#272932] mb-1">
                Rows per page
              </div>
              {Array.from(new Set([...APP_DEFAULTS.pageSizeOptions, globalDefaultPageSize, localPageSize]))
                .sort((a, b) => a - b)
                .map((size) => {
                  const isSelected = size === localPageSize;
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => {
                        onPageSizeChange(size);
                        onClosePageSizeMenu();
                      }}
                      className={`flex w-full items-center justify-between px-2.5 py-1.5 rounded cursor-pointer text-xs font-mono transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white font-bold'
                          : 'text-zinc-200 hover:bg-[#2c303c] hover:text-white'
                      }`}
                    >
                      <span>{size}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-white shrink-0 ml-2" />}
                    </button>
                  );
                })}
            </div>
          )}
        </div>

        <span className="font-sans text-zinc-400">of</span>
        {isExactTotalKnown ? (
          <span className="text-zinc-200 font-medium">{effectiveTotal}</span>
        ) : (
          <button
            type="button"
            onClick={onCountRows}
            disabled={isCountingTotal || !hasCountRows}
            className={`font-medium transition-colors ${
              hasCountRows
                ? 'text-zinc-200 hover:text-blue-400 underline decoration-dotted decoration-zinc-500 hover:decoration-blue-400 underline-offset-2 cursor-pointer'
                : 'text-zinc-200 cursor-default'
            }`}
            title={hasCountRows ? 'Click to count total rows' : undefined}
          >
            {isCountingTotal ? (
              <span className="inline-flex items-center gap-1 text-blue-400">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span>{effectiveTotal}+</span>
              </span>
            ) : (
              `${effectiveTotal}+`
            )}
          </button>
        )}
        {(isLoadingMore || isLoadingPrevious) && (
          <RefreshCw className="h-3 w-3 animate-spin text-blue-400 ml-0.5" />
        )}
      </div>

      <button
        type="button"
        onClick={() => onNavigatePage(currentPage + 1)}
        disabled={(isExactTotalKnown ? currentPage >= totalPages : !hasMore) || isLoadingMore}
        className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#323541] disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition-colors"
        title="Next Page"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onLastPage}
        disabled={
          (isExactTotalKnown ? currentPage >= totalPages : !hasMore || !hasCountRows) ||
          isLoadingMore ||
          isCountingTotal
        }
        className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#323541] disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition-colors"
        title={isExactTotalKnown ? `Last Page (${totalPages})` : 'Last Page (counts total rows first)'}
      >
        <ChevronsRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
