import React from 'react';
import {
  Key,
  Hash,
  AlertCircle,
  ArrowUpDown,
  ArrowDownAZ,
  ArrowDownZA,
  ChevronUp,
  ChevronDown,
  X,
  Snowflake,
  Clock,
} from 'lucide-react';
import { ColumnHoverInfo, SortConfig, TtlModalState } from './gridTypes';

/* 1. Column Hover Metadata Popover Card */
export const ColumnHoverPopover: React.FC<{
  hoveredCol: ColumnHoverInfo;
  isRedis: boolean;
  isColumnEditable: (colName: string) => boolean;
}> = ({ hoveredCol, isRedis, isColumnEditable }) => (
  <div
    className="fixed z-50 pointer-events-none rounded-lg border border-[#3b3e4f] bg-[#16171f]/95 backdrop-blur-md shadow-2xl p-3 text-xs font-sans min-w-[220px] max-w-[320px] animate-in fade-in zoom-in-95 duration-100"
    style={{ top: hoveredCol.y, left: hoveredCol.x }}
  >
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
      {isRedis && !isColumnEditable(hoveredCol.col.name) && (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-800 border border-zinc-700/60 text-zinc-400 font-mono shrink-0">
          READ ONLY
        </span>
      )}
      {isRedis && isColumnEditable(hoveredCol.col.name) && (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono shrink-0">
          EDITABLE
        </span>
      )}
    </div>

    <div className="space-y-1.5 text-[11px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-zinc-500">Data Type:</span>
        <span className="font-mono font-medium text-blue-400 uppercase bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-900/40">
          {hoveredCol.col.dataType || 'UNKNOWN'}
        </span>
      </div>

      {hoveredCol.details.size && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-500">Length / Size:</span>
          <span className="font-mono text-zinc-300">{hoveredCol.details.size}</span>
        </div>
      )}

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

      {isRedis && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-500">Editable:</span>
          <span
            className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              isColumnEditable(hoveredCol.col.name)
                ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/40'
                : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/50'
            }`}
          >
            {isColumnEditable(hoveredCol.col.name)
              ? hoveredCol.col.name.toLowerCase() === 'ttl'
                ? 'YES (DOUBLE-CLICK TO UPDATE TTL)'
                : 'YES'
              : 'NO (DISABLED)'}
          </span>
        </div>
      )}

      {hoveredCol.col.isAutoIncrement && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-500">Extra:</span>
          <span className="font-mono text-emerald-400 text-[10px]">auto_increment</span>
        </div>
      )}

      {hoveredCol.col.defaultValue !== undefined && hoveredCol.col.defaultValue !== '' && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-500">Default:</span>
          <span className="font-mono text-zinc-400 truncate max-w-[150px]">{hoveredCol.col.defaultValue}</span>
        </div>
      )}

      {hoveredCol.col.comment && (
        <div className="mt-2 pt-2 border-t border-[#272932]">
          <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-0.5">
            Description
          </div>
          <div className="text-zinc-300 text-[11px] leading-relaxed italic">{hoveredCol.col.comment}</div>
        </div>
      )}
    </div>
  </div>
);

/* 2. Cancel Changes Confirmation Modal */
export const CancelChangesModal: React.FC<{
  stagedCount: number;
  onKeep: () => void;
  onDiscard: () => void;
}> = ({ stagedCount, onKeep, onDiscard }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    onClick={onKeep}
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
          <h3 className="text-sm font-semibold text-zinc-100">Discard Staged Changes?</h3>
          <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
            There are <span className="font-semibold text-rose-300 font-mono">{stagedCount}</span> unsaved change(s). All pending row additions, edits, or deletions will be reverted to database values.
          </p>
          <p className="text-xs text-zinc-400 mt-1">Are you sure you want to discard these changes?</p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530]">
        <button
          type="button"
          onClick={onKeep}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#20222a] hover:bg-[#2b2d38] border border-[#2d303f] text-zinc-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
        >
          <span>Keep Changes</span>
          <kbd className="text-[10px] text-zinc-500 font-mono bg-[#14151a] px-1 rounded border border-[#2d303f]">
            Esc
          </kbd>
        </button>
        <button
          type="button"
          autoFocus
          onClick={onDiscard}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors cursor-pointer shadow-sm"
        >
          <span>Discard Changes</span>
          <kbd className="text-[10px] text-rose-200 font-mono bg-rose-700/60 px-1 rounded">↵ Enter</kbd>
        </button>
      </div>
    </div>
  </div>
);

/* 3. All Sorted Columns Modal */
export const AllSortsModal: React.FC<{
  localSortConfigs: SortConfig[];
  onClose: () => void;
  onUpdateSorts: (next: SortConfig[]) => void;
  onClearAllSort: () => void;
}> = ({ localSortConfigs, onClose, onUpdateSorts, onClearAllSort }) => (
  <div
    onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
  >
    <div className="w-full max-w-md rounded-xl border border-[#2b2e3a] bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100">
      <div className="flex items-center justify-between border-b border-[#272932] px-4 py-3 bg-[#1e2029]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
            <ArrowUpDown className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
              <span>Order By Columns</span>
              <span className="px-1.5 py-0.2 rounded-full bg-blue-600/20 text-blue-400 text-[10px] font-mono font-bold">
                {localSortConfigs.length}
              </span>
            </h3>
            <p className="text-[11px] text-zinc-400">Adjust sorting priority and direction</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto p-3 space-y-2">
        {localSortConfigs.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-500">No active sorting</div>
        ) : (
          localSortConfigs.map((sc, idx) => (
            <div
              key={sc.column}
              className="flex items-center justify-between p-2 rounded-lg bg-[#14151a] border border-[#272932] text-xs"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="flex items-center justify-center h-5 w-5 rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-400 font-mono text-[10px] font-bold shrink-0">
                  #{idx + 1}
                </span>
                <span className="font-mono text-zinc-100 font-medium truncate" title={sc.column}>
                  {sc.column}
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0 ml-2">
                <button
                  type="button"
                  onClick={() => {
                    const nextDir: 'asc' | 'desc' = sc.direction === 'asc' ? 'desc' : 'asc';
                    onUpdateSorts(
                      localSortConfigs.map((s, i) => (i === idx ? { ...s, direction: nextDir } : s))
                    );
                  }}
                  className={`flex items-center justify-center h-6 w-6 rounded font-mono text-[10px] font-bold transition-colors cursor-pointer border ${
                    sc.direction === 'asc'
                      ? 'bg-blue-600/20 text-blue-300 border-blue-500/40 hover:bg-blue-600/30'
                      : 'bg-amber-600/20 text-amber-300 border-amber-500/40 hover:bg-amber-600/30'
                  }`}
                  title={`Click to toggle (${
                    sc.direction === 'asc' ? 'A → Z (ASC) to Z → A (DESC)' : 'Z → A (DESC) to A → Z (ASC)'
                  })`}
                >
                  {sc.direction === 'asc' ? (
                    <ArrowDownAZ className="h-4 w-4 stroke-[2]" />
                  ) : (
                    <ArrowDownZA className="h-4 w-4 stroke-[2]" />
                  )}
                </button>

                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => {
                    if (idx === 0) return;
                    const next = [...localSortConfigs];
                    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                    onUpdateSorts(next);
                  }}
                  className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                  title="Increase priority"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  disabled={idx === localSortConfigs.length - 1}
                  onClick={() => {
                    if (idx === localSortConfigs.length - 1) return;
                    const next = [...localSortConfigs];
                    [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                    onUpdateSorts(next);
                  }}
                  className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                  title="Decrease priority"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = localSortConfigs.filter((_, i) => i !== idx);
                    onUpdateSorts(next);
                    if (next.length === 0) onClose();
                  }}
                  className="p-1 rounded text-rose-500 hover:text-rose-400 hover:bg-rose-950/40 cursor-pointer ml-0.5"
                  title={`Remove ${sc.column} from sort`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[#272932] px-4 py-2.5 bg-[#14151a]">
        <button
          type="button"
          onClick={() => {
            onClearAllSort();
            onClose();
          }}
          className="px-2.5 py-1 rounded border border-rose-800/60 bg-rose-950/30 text-rose-400 hover:bg-rose-900/50 hover:text-rose-200 text-xs font-medium cursor-pointer transition-colors"
        >
          Clear All Sorts
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1 rounded bg-[#272932] hover:bg-[#323541] text-zinc-200 text-xs font-medium cursor-pointer transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  </div>
);

/* 4. All Frozen Columns Modal */
export const AllFrozenModal: React.FC<{
  frozenColumns: string[];
  onClose: () => void;
  onUpdateFrozen: (next: string[]) => void;
}> = ({ frozenColumns, onClose, onUpdateFrozen }) => (
  <div
    onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
  >
    <div className="w-full max-w-md rounded-xl border border-[#2b2e3a] bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100">
      <div className="flex items-center justify-between border-b border-[#272932] px-4 py-3 bg-[#1e2029]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
            <Snowflake className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
              <span>Frozen Columns</span>
              <span className="px-1.5 py-0.2 rounded-full bg-cyan-600/20 text-cyan-400 text-[10px] font-mono font-bold">
                {frozenColumns.length}
              </span>
            </h3>
            <p className="text-[11px] text-zinc-400">Manage columns pinned to the left table edge</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto p-3 space-y-2">
        {frozenColumns.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-500">No frozen columns</div>
        ) : (
          frozenColumns.map((colName, idx) => (
            <div
              key={colName}
              className="flex items-center justify-between p-2 rounded-lg bg-[#14151a] border border-[#272932] text-xs"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="flex items-center justify-center h-5 w-5 rounded-full bg-cyan-600/20 border border-cyan-500/40 text-cyan-400 font-mono text-[10px] font-bold shrink-0">
                  #{idx + 1}
                </span>
                <span className="font-mono text-zinc-100 font-medium truncate" title={colName}>
                  {colName}
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0 ml-2">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => {
                    if (idx === 0) return;
                    const next = [...frozenColumns];
                    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                    onUpdateFrozen(next);
                  }}
                  className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                  title="Move left in freeze order"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  disabled={idx === frozenColumns.length - 1}
                  onClick={() => {
                    if (idx === frozenColumns.length - 1) return;
                    const next = [...frozenColumns];
                    [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                    onUpdateFrozen(next);
                  }}
                  className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                  title="Move right in freeze order"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = frozenColumns.filter((c) => c !== colName);
                    onUpdateFrozen(next);
                    if (next.length === 0) onClose();
                  }}
                  className="p-1 rounded text-rose-500 hover:text-rose-400 hover:bg-rose-950/40 cursor-pointer ml-0.5"
                  title={`Unfreeze ${colName}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[#272932] px-4 py-2.5 bg-[#14151a]">
        <button
          type="button"
          onClick={() => {
            onUpdateFrozen([]);
            onClose();
          }}
          className="px-2.5 py-1 rounded border border-rose-800/60 bg-rose-950/30 text-rose-400 hover:bg-rose-900/50 hover:text-rose-200 text-xs font-medium cursor-pointer transition-colors"
        >
          Unfreeze All
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1 rounded bg-[#272932] hover:bg-[#323541] text-zinc-200 text-xs font-medium cursor-pointer transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  </div>
);

/* 5. Redis TTL Modal */
const TTL_PRESETS = [
  { label: '10s', amount: '10', unit: 's' as const },
  { label: '1m', amount: '1', unit: 'm' as const },
  { label: '10m', amount: '10', unit: 'm' as const },
  { label: '1h', amount: '1', unit: 'h' as const },
  { label: '1d', amount: '1', unit: 'd' as const },
  { label: '7d', amount: '7', unit: 'd' as const },
  { label: '30d', amount: '30', unit: 'd' as const },
];

export const RedisTtlModal: React.FC<{
  ttlModal: TtlModalState;
  ttlMode: 'persist' | 'custom';
  ttlAmount: string;
  ttlUnit: 's' | 'm' | 'h' | 'd';
  onClose: () => void;
  onChangeMode: (mode: 'persist' | 'custom') => void;
  onChangeAmount: (amount: string) => void;
  onChangeUnit: (unit: 's' | 'm' | 'h' | 'd') => void;
  onSave: (applyImmediately: boolean) => void;
}> = ({
  ttlModal,
  ttlMode,
  ttlAmount,
  ttlUnit,
  onClose,
  onChangeMode,
  onChangeAmount,
  onChangeUnit,
  onSave,
}) => (
  <div
    onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
  >
    <div className="w-full max-w-md rounded-xl border border-[#2b2e3a] bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100">
      <div className="flex items-center justify-between border-b border-[#272932] px-4 py-3 bg-[#1e2029]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
              <span>Update Redis TTL (Time-To-Live)</span>
            </h3>
            <p className="text-[11px] text-zinc-400">Set key expiration time or make it persist</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div className="bg-[#121318] border border-[#252833] rounded-lg p-3 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500 text-[11px] uppercase tracking-wider font-semibold">Target Key</span>
            <span className="text-[10px] text-zinc-500 font-mono">
              Current: <span className="text-zinc-300 font-medium">{ttlModal.currentTtl}</span>
            </span>
          </div>
          <div className="font-mono text-xs font-semibold text-amber-300 truncate">
            {ttlModal.keyName || '(Active Key)'}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Expiration Mode</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChangeMode('persist')}
              className={`flex flex-col items-start p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                ttlMode === 'persist'
                  ? 'border-emerald-500 bg-emerald-950/20 text-white shadow-xs'
                  : 'border-[#272932] bg-[#14151b] hover:bg-[#1a1c24] text-zinc-400'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    ttlMode === 'persist' ? 'bg-emerald-400 ring-2 ring-emerald-400/30' : 'bg-zinc-600'
                  }`}
                />
                <span className="text-xs font-semibold text-zinc-200">Persist</span>
              </div>
              <span className="text-[10px] text-zinc-500 mt-1">No TTL, never expires</span>
            </button>

            <button
              type="button"
              onClick={() => onChangeMode('custom')}
              className={`flex flex-col items-start p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                ttlMode === 'custom'
                  ? 'border-amber-500 bg-amber-950/20 text-white shadow-xs'
                  : 'border-[#272932] bg-[#14151b] hover:bg-[#1a1c24] text-zinc-400'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    ttlMode === 'custom' ? 'bg-amber-400 ring-2 ring-amber-400/30' : 'bg-zinc-600'
                  }`}
                />
                <span className="text-xs font-semibold text-zinc-200">Set Expiration</span>
              </div>
              <span className="text-[10px] text-zinc-500 mt-1">Expire after duration</span>
            </button>
          </div>
        </div>

        {ttlMode === 'custom' && (
          <div className="space-y-2 animate-in fade-in duration-100">
            <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Duration</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                autoFocus
                value={ttlAmount}
                onChange={(e) => onChangeAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSave(false);
                }}
                placeholder="e.g. 3600"
                className="flex-1 bg-[#101115] border border-[#2b2e3a] focus:border-amber-500 px-3 py-1.5 text-xs text-white outline-none rounded-lg font-mono"
              />
              <select
                value={ttlUnit}
                onChange={(e) => onChangeUnit(e.target.value as 's' | 'm' | 'h' | 'd')}
                className="bg-[#101115] border border-[#2b2e3a] focus:border-amber-500 px-2 py-1.5 text-xs text-white outline-none rounded-lg font-medium cursor-pointer"
              >
                <option value="s">Seconds (s)</option>
                <option value="m">Minutes (m)</option>
                <option value="h">Hours (h)</option>
                <option value="d">Days (d)</option>
              </select>
            </div>

            <div className="pt-1">
              <span className="text-[10px] text-zinc-500 mb-1.5 block">Quick Presets:</span>
              <div className="flex flex-wrap gap-1.5">
                {TTL_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      onChangeMode('custom');
                      onChangeAmount(preset.amount);
                      onChangeUnit(preset.unit);
                    }}
                    className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors cursor-pointer ${
                      ttlAmount === preset.amount && ttlUnit === preset.unit
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-semibold'
                        : 'bg-[#121318] border-[#272932] text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1c24]'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="bg-[#101116] border border-[#232530] rounded-lg px-3 py-2 flex items-center justify-between text-[11px] font-mono text-zinc-400">
          <span className="text-zinc-500 text-[10px] uppercase font-sans font-semibold">Command:</span>
          <span className="text-amber-400 font-bold truncate">
            {ttlMode === 'persist'
              ? `PERSIST "${ttlModal.keyName || 'key'}"`
              : `EXPIRE "${ttlModal.keyName || 'key'}" ${
                  ttlUnit === 'd'
                    ? Number(ttlAmount || 1) * 86400
                    : ttlUnit === 'h'
                    ? Number(ttlAmount || 1) * 3600
                    : ttlUnit === 'm'
                    ? Number(ttlAmount || 1) * 60
                    : Number(ttlAmount || 1)
                }s`}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[#272932] px-4 py-3 bg-[#1e2029]">
        <span className="text-[10px] text-zinc-500">Staged until applied</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-[#2b2e3a] bg-[#14151b] hover:bg-[#20222a] text-zinc-300 text-xs font-medium transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(false)}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors cursor-pointer shadow-xs"
          >
            Stage Changes
          </button>
          <button
            type="button"
            onClick={() => onSave(true)}
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors cursor-pointer shadow-xs"
          >
            Apply Now
          </button>
        </div>
      </div>
    </div>
  </div>
);
