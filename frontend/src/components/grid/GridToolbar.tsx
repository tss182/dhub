import React, { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Copy,
  Trash2,
  Check,
  Code,
  Eye,
  X,
  Ban,
  Search,
  Filter,
  Key,
  Hash,
  Clock,
  FileText,
  ArrowDownAZ,
  ArrowDownZA,
  Shield,
  SlidersHorizontal,
} from 'lucide-react';
import { SortConfig, WhereSuggestionItem, isMac, modKey } from './gridTypes';

interface GridToolbarProps {
  gridBarBg: string;
  isReadOnly: boolean;
  isRedis: boolean;
  isQdrant?: boolean;
  rawSql?: string;
  copiedRawSql: boolean;
  stagedCount: number;
  isTableTab: boolean;
  hasApplyWhere: boolean;
  whereContainerRef: React.RefObject<HTMLDivElement>;
  whereInputRef: React.RefObject<HTMLInputElement>;
  suggestionListRef: React.RefObject<HTMLDivElement>;
  whereInput: string;
  showWhereSuggestions: boolean;
  whereSuggestions: WhereSuggestionItem[];
  selectedSuggestionIndex: number;
  localSortConfigs: SortConfig[];
  frozenColumns: string[];
  maskSensitiveData?: boolean;
  onToggleMaskSensitiveData?: () => void;
  onOpenRedisAddKey: () => void;
  onAddRow: () => void;
  onDeleteActiveRow: () => void;
  onCopyRawSql: () => void;
  onPreviewChanges: () => void;
  onCopyDml?: () => Promise<boolean | void> | void;
  onApplyChanges: () => void;
  onRequestCancelConfirm: () => void;
  onWhereInputChange: (value: string, cursorPos: number) => void;
  onWhereFocus: () => void;
  onWhereCursorChange: (cursorPos: number) => void;
  onWhereKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onClearWhere: () => void;
  onApplyWhereClick: () => void;
  onApplyWhereSuggestion: (item: WhereSuggestionItem) => void;
  onRemoveSortColumn: (colName: string) => void;
  onShowAllSorts: () => void;
  onClearAllSort: () => void;
  onToggleFreeze: (colName: string) => void;
  onShowAllFrozen: () => void;
  onClearAllFrozen: () => void;
}

export const GridToolbar: React.FC<GridToolbarProps> = ({
  gridBarBg,
  isReadOnly,
  isRedis,
  isQdrant = false,
  rawSql,
  copiedRawSql,
  stagedCount,
  isTableTab,
  hasApplyWhere,
  whereContainerRef,
  whereInputRef,
  suggestionListRef,
  whereInput,
  showWhereSuggestions,
  whereSuggestions,
  selectedSuggestionIndex,
  localSortConfigs,
  frozenColumns,
  maskSensitiveData = false,
  onToggleMaskSensitiveData,
  onOpenRedisAddKey,
  onAddRow,
  onDeleteActiveRow,
  onCopyRawSql,
  onPreviewChanges,
  onCopyDml,
  onApplyChanges,
  onRequestCancelConfirm,
  onWhereInputChange,
  onWhereFocus,
  onWhereCursorChange,
  onWhereKeyDown,
  onClearWhere,
  onApplyWhereClick,
  onApplyWhereSuggestion,
  onRemoveSortColumn,
  onShowAllSorts,
  onClearAllSort,
  onToggleFreeze,
  onShowAllFrozen,
  onClearAllFrozen,
}) => {
  const [copiedDml, setCopiedDml] = useState(false);
  const copyDmlTimerRef = useRef<number | null>(null);
  const [pillContextMenu, setPillContextMenu] = useState<{
    type: 'sort' | 'frozen';
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (copyDmlTimerRef.current !== null) {
        window.clearTimeout(copyDmlTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!pillContextMenu) return;
    const handleClose = () => setPillContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPillContextMenu(null);
    };
    window.addEventListener('click', handleClose);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [pillContextMenu]);

  const handleCopyDmlClick = async () => {
    if (!onCopyDml) return;
    const result = await onCopyDml();
    if (result === false) return;
    setCopiedDml(true);
    if (copyDmlTimerRef.current !== null) {
      window.clearTimeout(copyDmlTimerRef.current);
    }
    copyDmlTimerRef.current = window.setTimeout(() => setCopiedDml(false), 2000);
  };

  return (
    <div className={`flex h-10 items-center justify-between border-b px-3 ${gridBarBg}`}>
      <div className="flex items-center gap-1.5 shrink-0">
        {isReadOnly && (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 font-bold font-mono text-[10px] tracking-wider uppercase mr-1 select-none shadow-xs"
            title="This connection is configured as READ-ONLY. Modifying data or schema is disabled."
          >
            <Ban className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span>READ-ONLY</span>
          </div>
        )}

        {!isReadOnly && (
          <>
            {isRedis ? (
              <button
                type="button"
                onClick={onOpenRedisAddKey}
                className="flex h-7 items-center gap-1.5 px-2.5 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-colors cursor-pointer"
                title="Add New Redis Key"
              >
                <Plus className="h-3.5 w-3.5 text-emerald-400" />
                <span>Add Key</span>
              </button>
            ) : (
              <button
                onClick={onAddRow}
                className="flex h-7 w-7 items-center justify-center rounded bg-[#22242c] hover:bg-[#2b2d37] text-zinc-300 transition-colors cursor-pointer"
                title={`Add New Row (${modKey}+I)`}
              >
                <Plus className="h-4 w-4 text-emerald-400" />
              </button>
            )}

            <button
              onClick={onDeleteActiveRow}
              className="flex h-7 w-7 items-center justify-center rounded bg-[#22242c] hover:bg-[#2b2d37] text-zinc-300 transition-colors cursor-pointer"
              title={`Delete Active Row (${isMac ? 'Cmd+Backspace' : 'Delete'})`}
            >
              <Trash2 className="h-3.5 w-3.5 text-rose-400" />
            </button>
          </>
        )}

        {onToggleMaskSensitiveData && (
          <button
            type="button"
            onClick={onToggleMaskSensitiveData}
            className={`flex h-7 items-center gap-1 px-2 rounded text-[11px] font-medium border transition-colors cursor-pointer select-none ${
              maskSensitiveData
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-[#22242c] hover:bg-[#2b2d37] border-[#272932] text-zinc-400 hover:text-zinc-200'
            }`}
            title="Mask Sensitive Data (PII / Screen-Share Safe)"
          >
            <Shield className={`h-3.5 w-3.5 ${maskSensitiveData ? 'text-amber-400' : 'text-zinc-400'}`} />
            {maskSensitiveData && <span>Masked</span>}
          </button>
        )}

        {rawSql && (
          <button
            type="button"
            onClick={onCopyRawSql}
            className={`flex items-center gap-1.5 h-7 px-2.5 rounded font-sans text-xs transition-colors cursor-pointer select-none ${
              copiedRawSql
                ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                : 'bg-[#22242c] hover:bg-[#2b2d37] text-zinc-300 hover:text-white border border-[#272932]'
            }`}
            title={`Copy Raw Query to clipboard:\n${rawSql}`}
          >
            {copiedRawSql ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-[11px] font-semibold text-emerald-300">
                  {isQdrant ? 'Copied!' : 'Copied SQL!'}
                </span>
              </>
            ) : (
              <>
                <Code className="h-3.5 w-3.5 text-blue-400" />
                <span className="text-[11px] font-medium">Copy Query</span>
              </>
            )}
          </button>
        )}

        {stagedCount > 0 && (
          <>
            <button
              onClick={onPreviewChanges}
              className="flex h-7 w-7 items-center justify-center rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 transition-colors cursor-pointer"
              title={isQdrant ? 'Preview Qdrant REST Operations' : 'Preview SQL DML'}
            >
              <Eye className="h-4 w-4" />
            </button>

            {onCopyDml && (
              <button
                type="button"
                onClick={handleCopyDmlClick}
                className={`flex h-7 w-7 items-center justify-center rounded transition-colors cursor-pointer ${
                  copiedDml
                    ? 'bg-emerald-600/25 text-emerald-300'
                    : 'bg-blue-600/20 text-blue-300 hover:bg-blue-600/30'
                }`}
                title={isQdrant ? 'Copy Qdrant REST Operations' : 'Copy SQL DML'}
              >
                {copiedDml ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            )}

            <button
              onClick={onApplyChanges}
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
              onClick={onRequestCancelConfirm}
              className="flex h-7 w-7 items-center justify-center rounded bg-rose-950/40 border border-rose-800/60 hover:bg-rose-900/60 text-rose-400 hover:text-white transition-colors cursor-pointer"
              title="Revert Staged Changes (Esc)"
            >
              <X className="h-4 w-4 text-rose-400" />
            </button>
          </>
        )}
      </div>

      {/* Toolbar Center & Right: SQL WHERE Filter (Full width) + Chips */}
      <div className="flex items-center gap-2.5 flex-1 min-w-0 ml-2.5">
        {(isTableTab || hasApplyWhere) && (
          <div ref={whereContainerRef} className="relative flex-1 min-w-[200px]">
            <div className="relative flex items-center">
              <div className="absolute left-2.5 flex items-center gap-1 pointer-events-none select-none">
                {isRedis ? (
                  <>
                    <Search className="h-3 w-3 text-amber-400" />
                    <span className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-wider">
                      MATCH
                    </span>
                  </>
                ) : (
                  <>
                    <Filter className="h-3 w-3 text-blue-400" />
                    <span className="text-[10px] font-mono font-bold text-blue-400 uppercase tracking-wider">
                      WHERE
                    </span>
                  </>
                )}
              </div>
              <input
                ref={whereInputRef}
                type="text"
                data-where-input="true"
                placeholder={
                  isRedis
                    ? 'Redis pattern, e.g. user:* or *session* (Enter to scan)'
                    : isQdrant
                    ? `Qdrant filter, e.g. category = 'news' AND views >= 10 or {"must":[...]} (Enter)`
                    : "condition, e.g. status = 'active' AND id > 10 (Enter to filter)"
                }
                value={whereInput}
                onChange={(e) =>
                  onWhereInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
                }
                onFocus={onWhereFocus}
                onClick={(e) =>
                  onWhereCursorChange((e.target as HTMLInputElement).selectionStart ?? whereInput.length)
                }
                onKeyUp={(e) =>
                  onWhereCursorChange((e.target as HTMLInputElement).selectionStart ?? whereInput.length)
                }
                onKeyDown={onWhereKeyDown}
                className="h-7 w-full rounded bg-[#121317] pl-[68px] pr-14 text-[11px] text-zinc-100 font-mono border border-[#272932] focus:border-blue-500 focus:bg-[#16171d] focus:outline-none placeholder:text-zinc-600 shadow-inner"
              />

              <div className="absolute right-1.5 flex items-center gap-1">
                {whereInput && (
                  <button
                    type="button"
                    onClick={onClearWhere}
                    className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] cursor-pointer"
                    title="Clear filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onApplyWhereClick}
                  className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-medium font-sans cursor-pointer transition-colors shadow-xs"
                  title={isRedis ? 'Scan keys matching pattern (Enter)' : 'Apply WHERE condition (Enter)'}
                >
                  {isRedis ? 'Scan' : 'Filter'}
                </button>
              </div>
            </div>

            {showWhereSuggestions && whereSuggestions.length > 0 && (
              <div
                ref={suggestionListRef}
                className="absolute left-0 top-full mt-1 w-full max-h-56 overflow-y-auto rounded-md bg-[#16171d] border border-[#2b2e3a] shadow-2xl z-50 p-1 font-mono text-[11px]"
              >
                <div className="px-2 py-1 text-[9px] uppercase font-bold text-zinc-500 font-sans tracking-wider border-b border-[#22242c] mb-1 flex items-center justify-between">
                  <span>Suggestions (Tab / Enter to select, Esc to close)</span>
                  <span className="text-zinc-600">Ctrl+Space</span>
                </div>
                {whereSuggestions.map((item, sIdx) => {
                  const isSelected = sIdx === selectedSuggestionIndex;
                  return (
                    <div
                      key={item.id}
                      data-suggestion-index={sIdx}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onApplyWhereSuggestion(item);
                      }}
                      className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white font-medium'
                          : 'text-zinc-300 hover:bg-[#22242c]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {item.type === 'column' ? (
                          item.isPK ? (
                            <Key className="h-3 w-3 text-amber-400 shrink-0" />
                          ) : item.iconType === 'number' ? (
                            <Hash className="h-3 w-3 text-emerald-400 shrink-0" />
                          ) : item.iconType === 'date' ? (
                            <Clock className="h-3 w-3 text-cyan-400 shrink-0" />
                          ) : (
                            <FileText className="h-3 w-3 text-blue-400 shrink-0" />
                          )
                        ) : (
                          <span className="px-1 rounded bg-[#2b2e3a] text-[9px] font-bold text-amber-400">
                            SQL
                          </span>
                        )}
                        <span className="truncate">{item.name}</span>
                      </div>
                      {item.dataType && (
                        <span
                          className={`text-[10px] ml-2 shrink-0 ${
                            isSelected ? 'text-blue-100' : 'text-zinc-500'
                          }`}
                        >
                          {item.dataType}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {(localSortConfigs.length > 0 || frozenColumns.length > 0) && (
          <div className="flex items-center gap-2 shrink-0">
            {localSortConfigs.length > 0 && (
              <div
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPillContextMenu({ type: 'sort', x: e.clientX, y: e.clientY });
                }}
                className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-[#101115] border border-[#2b2e3a] text-[11px] font-mono select-none"
                title="Right-click to manage sorted columns"
              >
                <div className="flex items-center gap-1">
                  {localSortConfigs.slice(0, 2).map((sc, idx) => (
                    <span
                      key={sc.column}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#1e2029] border border-blue-500/30 text-[10px] text-zinc-200"
                      title={`#${idx + 1} priority: ${sc.column} (${sc.direction.toUpperCase()})`}
                    >
                      <span className="flex items-center justify-center h-3 w-3 rounded-full bg-blue-600 text-white text-[8px] font-bold">
                        {idx + 1}
                      </span>
                      <span className="text-zinc-100 font-medium">{sc.column}</span>
                      {sc.direction === 'asc' ? (
                        <ArrowDownAZ className="h-3.5 w-3.5 text-blue-400 stroke-[2]" />
                      ) : (
                        <ArrowDownZA className="h-3.5 w-3.5 text-amber-400 stroke-[2]" />
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveSortColumn(sc.column);
                        }}
                        className="text-zinc-500 hover:text-rose-400 cursor-pointer ml-0.5"
                        title={`Remove ${sc.column} from sort`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  {localSortConfigs.length > 2 && (
                    <button
                      type="button"
                      onClick={onShowAllSorts}
                      className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#1e2029] hover:bg-[#282b37] border border-blue-500/40 text-[10px] text-blue-300 font-mono font-bold cursor-pointer transition-colors"
                      title={`View all ${localSortConfigs.length} sorted columns (${localSortConfigs.length - 2} more)`}
                    >
                      ...
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClearAllSort}
                  className="p-0.5 rounded hover:bg-rose-950/40 text-rose-500 hover:text-rose-400 transition-colors cursor-pointer ml-0.5"
                  title="Clear all column sorting"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {frozenColumns.length > 0 && (
              <div
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPillContextMenu({ type: 'frozen', x: e.clientX, y: e.clientY });
                }}
                className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-[#101115] border border-cyan-800/40 text-[11px] font-mono select-none"
                title="Right-click to manage frozen columns"
              >
                <div className="flex items-center gap-1">
                  {frozenColumns.slice(0, 2).map((colName) => (
                    <span
                      key={colName}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0d222b] border border-cyan-500/30 text-[10px] text-cyan-200"
                      title={`Frozen column: ${colName}`}
                    >
                      <span className="text-zinc-100 font-medium">{colName}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFreeze(colName);
                        }}
                        className="text-zinc-400 hover:text-rose-400 cursor-pointer ml-0.5"
                        title={`Unfreeze ${colName}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  {frozenColumns.length > 2 && (
                    <button
                      type="button"
                      onClick={onShowAllFrozen}
                      className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#0d222b] hover:bg-[#13303d] border border-cyan-500/40 text-[10px] text-cyan-300 font-mono font-bold cursor-pointer transition-colors"
                      title={`View all ${frozenColumns.length} frozen columns (${frozenColumns.length - 2} more)`}
                    >
                      ...
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClearAllFrozen}
                  className="p-0.5 rounded hover:bg-rose-950/40 text-rose-500 hover:text-rose-400 transition-colors cursor-pointer ml-0.5"
                  title="Clear all column freezing"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {pillContextMenu && (
        <div
          style={{
            left: Math.min(pillContextMenu.x, window.innerWidth - 220),
            top: Math.min(pillContextMenu.y, window.innerHeight - 100),
          }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 min-w-[200px] rounded-lg border border-[#2d303d] bg-[#181920] p-1 text-xs shadow-2xl"
        >
          <button
            type="button"
            onClick={() => {
              const t = pillContextMenu.type;
              setPillContextMenu(null);
              if (t === 'sort') {
                onShowAllSorts();
              } else {
                onShowAllFrozen();
              }
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-200 transition-colors text-left cursor-pointer group"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-blue-400 group-hover:text-white shrink-0" />
            <span>
              {pillContextMenu.type === 'sort'
                ? `Manage Sort (${localSortConfigs.length})`
                : `Manage Frozen (${frozenColumns.length})`}
            </span>
          </button>
          <div className="my-1 border-t border-[#272932]" />
          <button
            type="button"
            onClick={() => {
              const t = pillContextMenu.type;
              setPillContextMenu(null);
              if (t === 'sort') {
                onClearAllSort();
              } else {
                onClearAllFrozen();
              }
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-300 transition-colors text-left cursor-pointer group"
          >
            <X className="h-3.5 w-3.5 text-rose-400 group-hover:text-white shrink-0" />
            <span>
              {pillContextMenu.type === 'sort' ? 'Clear All Sorting' : 'Unfreeze All Columns'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
