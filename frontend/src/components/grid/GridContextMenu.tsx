import React from 'react';
import {
  Copy,
  ChevronRight,
  FileText,
  Check,
  ClipboardPaste,
  Plus,
  Trash2,
  Clock,
  Edit3,
  Pencil,
  Code,
  Ban,
  Snowflake,
  ArrowUpDown,
  RotateCcw,
  PanelRight,
  CheckSquare,
  Eye,
  EyeOff,
  Sparkles,
  BarChart3,
} from 'lucide-react';
import { ColumnMeta } from '../../types/domain';
import { CopyFormat } from '../../stores/useSettingsStore';
import { StagedRowChange } from '../../stores/useGridEditStore';
import { COPY_FORMAT_LABELS, COPY_FORMAT_OPTIONS } from './CopyFormatSelector';
import { ContextMenuState, VisualRow, isMac, modKey } from './gridTypes';

interface GridContextMenuProps {
  contextMenu: ContextMenuState;
  selectionSummary?: string;
  copyFormat: CopyFormat;
  isCopyAsSubmenuOpen: boolean;
  isRedis: boolean;
  isQdrant?: boolean;
  isElasticsearch?: boolean;
  isReadOnly?: boolean;
  disableFreeze?: boolean;
  columns: ColumnMeta[];
  visualRows: VisualRow[];
  stagedChanges: Record<number, StagedRowChange>;
  frozenColumns: string[];
  isCellEditable: (rowId: number, cIdx: number) => boolean;
  onSetCopyAsSubmenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onClose: () => void;
  onCopy: (fmt?: CopyFormat) => void;
  onOpenCopyAsModal: () => void;
  onPaste: (text: string) => void;
  onDuplicateRow: () => void;
  onAddRow: () => void;
  onDeleteActiveRow: () => void;
  onOpenTtlModal: (rowId: number, currentDisplayVal: any, isInsert: boolean) => void;
  onStartEdit: (rowId: number, cIdx: number, currentVal: any) => void;
  onOpenRedisRenameModal: (oldKeyName: string) => void;
  onOpenUpdateQueryInTab: (globalRowIndex: number, colName: string, currentVal: any) => void;
  onFindSimilarPoint?: (globalRowIndex: number) => void;
  onOpenQdrantEditPoint?: (globalRowIndex: number) => void;
  onOpenQdrantFacet?: (colName: string) => void;
  onSetSelectedToNull: (vIdx: number, cIdx: number) => void;
  onToggleFreeze: (colName: string) => void;
  onUnfreezeAll: () => void;
  onAutoFitColumn: (cIdx: number) => void;
  onResetAllColumnWidths: () => void;
  onToggleValuePanel: () => void;
  onSelectAll: () => void;
  onHideColumn?: (colName: string) => void;
  hiddenColumnsCount?: number;
  onShowAllColumns?: () => void;
}

export const GridContextMenu: React.FC<GridContextMenuProps> = ({
  contextMenu,
  selectionSummary,
  copyFormat,
  isCopyAsSubmenuOpen,
  isRedis,
  isQdrant = false,
  isElasticsearch = false,
  isReadOnly = false,
  disableFreeze,
  columns,
  visualRows,
  stagedChanges,
  frozenColumns,
  isCellEditable,
  onSetCopyAsSubmenuOpen,
  onClose,
  onCopy,
  onOpenCopyAsModal,
  onPaste,
  onDuplicateRow,
  onAddRow,
  onDeleteActiveRow,
  onOpenTtlModal,
  onStartEdit,
  onOpenRedisRenameModal,
  onOpenUpdateQueryInTab,
  onFindSimilarPoint,
  onOpenQdrantEditPoint,
  onOpenQdrantFacet,
  onSetSelectedToNull,
  onToggleFreeze,
  onUnfreezeAll,
  onAutoFitColumn,
  onResetAllColumnWidths,
  onToggleValuePanel,
  onSelectAll,
  onHideColumn,
  hiddenColumnsCount = 0,
  onShowAllColumns,
}) => {
  if (!contextMenu.isOpen) return null;

  const isHeaderContextMenu = contextMenu.vIdx === null && contextMenu.cIdx !== null;
  if (isHeaderContextMenu) {
    const col = columns[contextMenu.cIdx!];
    if (!col) return null;
    const isFrozen = frozenColumns.includes(col.name);

    return (
      <div
        data-grid-context-menu="true"
        className="fixed z-50 w-60 rounded-lg border border-[#3b3e4f] bg-[#1a1b22] shadow-2xl p-1 text-xs text-zinc-200 select-none animate-in fade-in zoom-in-95 duration-75"
        style={{ top: contextMenu.y, left: contextMenu.x }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {onHideColumn && (
          <button
            type="button"
            disabled={columns.length <= 1}
            onClick={() => {
              onClose();
              onHideColumn(col.name);
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 disabled:opacity-40 disabled:pointer-events-none transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <EyeOff className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white shrink-0" />
              <span className="truncate">Hide Field ({col.name})</span>
            </div>
          </button>
        )}

        {onShowAllColumns && hiddenColumnsCount > 0 && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onShowAllColumns();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <Eye className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
              <span>Show All Fields ({hiddenColumnsCount} hidden)</span>
            </div>
          </button>
        )}

        {(onHideColumn || (onShowAllColumns && hiddenColumnsCount > 0)) && (
          <div className="my-1 border-t border-[#272932]" />
        )}

        {!(disableFreeze ?? isRedis) && (
          <>
            <button
              type="button"
              onClick={() => {
                onClose();
                onToggleFreeze(col.name);
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Snowflake
                  className={`h-3.5 w-3.5 shrink-0 ${
                    isFrozen ? 'text-cyan-400' : 'text-zinc-400'
                  } group-hover:text-white`}
                />
                <span className="truncate">
                  {isFrozen ? `Unfreeze Column (${col.name})` : `Freeze Column (${col.name})`}
                </span>
              </div>
              <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">Alt+Click</kbd>
            </button>

            {frozenColumns.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onUnfreezeAll();
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Snowflake className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                  <span>Unfreeze All Columns ({frozenColumns.length})</span>
                </div>
              </button>
            )}

            <div className="my-1 border-t border-[#272932]" />
          </>
        )}

        {isQdrant && onOpenQdrantFacet && col.name !== 'id' && col.name !== 'score' && !col.name.startsWith('vector') && (
          <>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenQdrantFacet(col.name);
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
            >
              <div className="flex items-center gap-2">
                <BarChart3 className="h-3.5 w-3.5 text-emerald-400 group-hover:text-white" />
                <span>Facet Value Distribution...</span>
              </div>
            </button>
            <div className="my-1 border-t border-[#272932]" />
          </>
        )}

        <button
          type="button"
          onClick={() => {
            const cIdx = contextMenu.cIdx!;
            onClose();
            onAutoFitColumn(cIdx);
          }}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
        >
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white rotate-90" />
            <span>Auto-fit Column Width</span>
          </div>
          <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">2x Click</kbd>
        </button>

        <button
          type="button"
          onClick={() => {
            onClose();
            onResetAllColumnWidths();
          }}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
        >
          <div className="flex items-center gap-2">
            <RotateCcw className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
            <span>Reset All Column Widths</span>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed z-50 min-w-[210px] rounded-lg border border-[#2e313d] bg-[#181920]/95 backdrop-blur-md p-1 shadow-2xl text-[12px] text-zinc-300 select-none animate-in fade-in zoom-in-95 duration-100"
      style={{ top: contextMenu.y, left: contextMenu.x }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-[#272932] mb-1 truncate flex items-center justify-between">
        <span>Grid Actions</span>
        {selectionSummary && <span className="text-zinc-600 font-mono text-[9px]">{selectionSummary}</span>}
      </div>

      <button
        type="button"
        onClick={() => {
          onCopy();
          onClose();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
      >
        <div className="flex items-center gap-2">
          <Copy className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
          <span>Copy</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          <span className="text-sky-400 font-semibold uppercase">{COPY_FORMAT_LABELS[copyFormat] || 'CSV'}</span>
          <kbd className="text-zinc-500 group-hover:text-white/80">{modKey}+C</kbd>
        </div>
      </button>

      <div
        className="relative"
        onMouseEnter={() => onSetCopyAsSubmenuOpen(true)}
        onMouseLeave={() => onSetCopyAsSubmenuOpen(false)}
      >
        <button
          type="button"
          onClick={() => onSetCopyAsSubmenuOpen((prev) => !prev)}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors text-left cursor-pointer group ${
            isCopyAsSubmenuOpen
              ? 'bg-blue-600 text-white'
              : 'hover:bg-blue-600 hover:text-white text-zinc-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <Copy
              className={`h-3.5 w-3.5 ${
                isCopyAsSubmenuOpen ? 'text-white' : 'text-zinc-400 group-hover:text-white'
              }`}
            />
            <span>Copy As</span>
          </div>
          <ChevronRight
            className={`h-3.5 w-3.5 ${
              isCopyAsSubmenuOpen ? 'text-white' : 'text-zinc-400 group-hover:text-white'
            }`}
          />
        </button>

        {isCopyAsSubmenuOpen &&
          (() => {
            const flipLeft = typeof window !== 'undefined' && contextMenu.x + 450 > window.innerWidth;
            return (
              <div className={`absolute top-0 z-50 ${flipLeft ? 'right-full pr-1' : 'left-full pl-1'}`}>
                <div className="min-w-[230px] rounded-lg border border-[#2e313d] bg-[#181920]/95 backdrop-blur-md p-1 shadow-2xl text-[12px] text-zinc-300 select-none animate-in fade-in zoom-in-95 duration-100">
                  <button
                    type="button"
                    onClick={() => {
                      onSetCopyAsSubmenuOpen(false);
                      onClose();
                      onOpenCopyAsModal();
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <span>Copy As ...</span>
                    <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono ml-3">
                      {modKey}+Shift+C
                    </kbd>
                  </button>

                  <div className="my-1 border-t border-[#272932]" />

                  {COPY_FORMAT_OPTIONS.filter((opt) =>
                    isQdrant
                      ? !opt.id.startsWith('sql_') && opt.id !== 'es_bulk'
                      : isElasticsearch
                      ? !opt.id.startsWith('sql_') && opt.id !== 'qdrant_upsert'
                      : opt.id !== 'qdrant_upsert' && opt.id !== 'es_bulk'
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        onCopy(opt.id);
                        onSetCopyAsSubmenuOpen(false);
                        onClose();
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                        <span>Copy as {opt.label}</span>
                      </div>
                      {opt.id === copyFormat && (
                        <Check className="h-3 w-3 text-sky-400 group-hover:text-white ml-2" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
      </div>

      {!isReadOnly && (
        <>
          <button
            type="button"
            onClick={() => {
              onClose();
              navigator.clipboard
                ?.readText?.()
                .then((text) => {
                  if (text) onPaste(text);
                })
                .catch(() => {});
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <ClipboardPaste className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
              <span>Paste</span>
            </div>
            <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">{modKey}+V</kbd>
          </button>

          <div className="my-1 border-t border-[#272932]" />

          <button
            type="button"
            onClick={() => {
              onClose();
              onDuplicateRow();
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
              onClose();
              onAddRow();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <Plus className="h-3.5 w-3.5 text-emerald-400 group-hover:text-white" />
              <span>Add New Row</span>
            </div>
            <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">{modKey}+I</kbd>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onDeleteActiveRow();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-300 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
              <span>Delete Row(s)</span>
            </div>
            <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">
              {isMac ? 'Cmd+⌫' : 'Del'}
            </kbd>
          </button>

          <div className="my-1 border-t border-[#272932]" />
        </>
      )}

      {contextMenu.vIdx !== null &&
        contextMenu.cIdx !== null &&
        (() => {
          const vr = visualRows[contextMenu.vIdx];
          const isTargetEditable = vr ? isCellEditable(vr.rowId, contextMenu.cIdx) : false;

          return (
            <>
              {isTargetEditable && (
                <button
                  type="button"
                  onClick={() => {
                    const { vIdx, cIdx } = contextMenu;
                    onClose();
                    if (vIdx !== null && cIdx !== null) {
                      const targetVr = visualRows[vIdx];
                      if (targetVr) {
                        const col = columns[cIdx];
                        let displayVal: any;
                        if (targetVr.isInsert) {
                          const staged = targetVr.insertChange;
                          displayVal =
                            staged?.changes[col.name] !== undefined
                              ? staged.changes[col.name]
                              : (col.defaultValue ?? '');
                        } else {
                          const staged = stagedChanges[targetVr.globalRowIndex!];
                          displayVal =
                            staged?.type === 'update' && staged.changes[col.name] !== undefined
                              ? staged.changes[col.name]
                              : targetVr.rowData?.[cIdx];
                        }
                        if (isRedis && col.name.toLowerCase() === 'ttl') {
                          onOpenTtlModal(targetVr.rowId, displayVal, targetVr.isInsert);
                          return;
                        }
                        onStartEdit(targetVr.rowId, cIdx, displayVal);
                      }
                    }
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    {isRedis && contextMenu.cIdx !== null && columns[contextMenu.cIdx]?.name.toLowerCase() === 'ttl' ? (
                      <>
                        <Clock className="h-3.5 w-3.5 text-amber-400 group-hover:text-white" />
                        <span>Update Key TTL...</span>
                      </>
                    ) : (
                      <>
                        <Edit3 className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                        <span>Edit Cell</span>
                      </>
                    )}
                  </div>
                  <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">Double-Click</kbd>
                </button>
              )}

              {isRedis && (
                <button
                  type="button"
                  onClick={() => {
                    const { vIdx } = contextMenu;
                    onClose();
                    if (vIdx !== null) {
                      const targetVr = visualRows[vIdx];
                      if (targetVr) {
                        const keyColIdx = columns.findIndex((c) => c.name.toLowerCase() === 'key');
                        const kName = targetVr.isInsert
                          ? String(targetVr.insertChange?.changes['key'] ?? '')
                          : keyColIdx !== -1
                          ? String(targetVr.rowData?.[keyColIdx] ?? '')
                          : '';
                        if (kName) {
                          onOpenRedisRenameModal(kName);
                        }
                      }
                    }
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    <Pencil className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
                    <span>Rename Key...</span>
                  </div>
                </button>
              )}

              {!isRedis && (
                <button
                  type="button"
                  onClick={() => {
                    const { vIdx, cIdx } = contextMenu;
                    onClose();
                    if (vIdx !== null && cIdx !== null) {
                      const targetVr = visualRows[vIdx];
                      if (targetVr && targetVr.globalRowIndex !== undefined) {
                        const col = columns[cIdx];
                        const currentVal = targetVr.rowData?.[cIdx];
                        onOpenUpdateQueryInTab(targetVr.globalRowIndex, col.name, currentVal);
                      }
                    }
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    <Code className="h-3.5 w-3.5 text-amber-400 group-hover:text-white" />
                    <span>
                      {isQdrant
                        ? 'Open Qdrant Update in Tab'
                        : isElasticsearch
                        ? 'Open Elasticsearch Update in Tab'
                        : 'Open UPDATE in Tab'}
                    </span>
                  </div>
                </button>
              )}

              {isQdrant && onFindSimilarPoint && vr && vr.globalRowIndex !== undefined && (
                <button
                  type="button"
                  onClick={() => {
                    const rowIdx = vr.globalRowIndex!;
                    onClose();
                    onFindSimilarPoint(rowIdx);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-violet-600 hover:text-white text-violet-300 transition-colors text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-violet-400 group-hover:text-white" />
                    <span>Find Similar Points</span>
                  </div>
                </button>
              )}

              {isQdrant && !isReadOnly && onOpenQdrantEditPoint && vr && vr.globalRowIndex !== undefined && (
                <button
                  type="button"
                  onClick={() => {
                    const rowIdx = vr.globalRowIndex!;
                    onClose();
                    onOpenQdrantEditPoint(rowIdx);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-emerald-600 hover:text-white text-emerald-300 transition-colors text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    <Pencil className="h-3.5 w-3.5 text-emerald-400 group-hover:text-white" />
                    <span>Edit Point JSON...</span>
                  </div>
                </button>
              )}

              {isTargetEditable && (
                <button
                  type="button"
                  onClick={() => {
                    const { vIdx, cIdx } = contextMenu;
                    onClose();
                    if (vIdx !== null && cIdx !== null) {
                      onSetSelectedToNull(vIdx, cIdx);
                    }
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    <Ban className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>Set to NULL</span>
                  </div>
                </button>
              )}

              {!(disableFreeze ?? isRedis) && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const { cIdx } = contextMenu;
                      onClose();
                      if (cIdx !== null && columns[cIdx]) {
                        onToggleFreeze(columns[cIdx].name);
                      }
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                  >
                    <div className="flex items-center gap-2">
                      <Snowflake
                        className={`h-3.5 w-3.5 ${
                          contextMenu.cIdx !== null && frozenColumns.includes(columns[contextMenu.cIdx]?.name)
                            ? 'text-cyan-400'
                            : 'text-zinc-400'
                        } group-hover:text-white`}
                      />
                      <span>
                        {contextMenu.cIdx !== null && frozenColumns.includes(columns[contextMenu.cIdx]?.name)
                          ? `Unfreeze Column (${columns[contextMenu.cIdx]?.name})`
                          : `Freeze Column (${columns[contextMenu.cIdx]?.name})`}
                      </span>
                    </div>
                    <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">Alt+Click</kbd>
                  </button>

                  {frozenColumns.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onUnfreezeAll();
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                    >
                      <div className="flex items-center gap-2">
                        <Snowflake className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                        <span>Unfreeze All Columns ({frozenColumns.length})</span>
                      </div>
                    </button>
                  )}
                </>
              )}

              {onHideColumn && contextMenu.cIdx !== null && columns[contextMenu.cIdx] && (
                <button
                  type="button"
                  disabled={columns.length <= 1}
                  onClick={() => {
                    const { cIdx } = contextMenu;
                    onClose();
                    if (cIdx !== null && columns[cIdx]) {
                      onHideColumn(columns[cIdx].name);
                    }
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 disabled:opacity-40 disabled:pointer-events-none transition-colors text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <EyeOff className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white shrink-0" />
                    <span className="truncate">Hide Field ({columns[contextMenu.cIdx]?.name})</span>
                  </div>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const { cIdx } = contextMenu;
                  onClose();
                  if (cIdx !== null && columns[cIdx]) {
                    onAutoFitColumn(cIdx);
                  }
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <ArrowUpDown className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white rotate-90" />
                  <span>Auto-fit Column Width</span>
                </div>
                <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">2x Click</kbd>
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onResetAllColumnWidths();
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <RotateCcw className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                  <span>Reset All Column Widths</span>
                </div>
              </button>
              <div className="my-1 border-t border-[#272932]" />
            </>
          );
        })()}

      <button
        type="button"
        onClick={() => {
          onClose();
          onToggleValuePanel();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
      >
        <div className="flex items-center gap-2">
          <PanelRight className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
          <span>View As</span>
        </div>
        <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">{modKey}+T</kbd>
      </button>

      <div className="my-1 border-t border-[#272932]" />

      <button
        type="button"
        onClick={() => {
          onClose();
          onSelectAll();
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
  );
};
