import React from 'react';
import { ExternalLink } from 'lucide-react';
import { ColumnMeta, ForeignKeyMeta } from '../../types/domain';
import { StagedRowChange } from '../../stores/useGridEditStore';
import { GridCellEditor } from './GridCellEditor';
import { ROW_NUM_COL_WIDTH, VisualRow } from './gridTypes';
import { isSensitiveColumn, maskCellValue } from './piiMasker';
import { parseVectorPreview } from './gridFormatters';

export interface DataGridRowProps {
  vr: VisualRow;
  columns: ColumnMeta[];
  visibleColIndices?: number[];
  leftColSpacerWidth?: number;
  rightColSpacerWidth?: number;
  colWidths: Record<string, number>;
  colInputTypes: Array<'date' | 'datetime-local' | 'time' | 'text'>;
  colEditableUpdate: boolean[];
  colEditableInsert: boolean[];
  frozenColumnSet: Set<string>;
  lastFrozenColName: string | null;
  frozenOffsets: Record<string, number>;
  isScrolledX: boolean;
  staged?: StagedRowChange;
  isRowInSelection: boolean;
  isFullRowSelected: boolean;
  /** Compact serialized selection signature for this row (e.g. "0:2,4:4") for React.memo diffing */
  rowSelectionSig: string;
  selectedColSet: Set<number>;
  editingColIndex: number | null;
  editVal: string;
  isFirstEditRenderRef: React.MutableRefObject<boolean>;
  isRedis: boolean;
  gridCellBorder: string;
  gridRowClass: string;
  onRowHeaderMouseDown: (e: React.MouseEvent, vIdx: number) => void;
  onRowHeaderMouseEnter: (vIdx: number) => void;
  onRowHeaderContextMenu: (e: React.MouseEvent, vIdx: number) => void;
  onCellMouseDown: (e: React.MouseEvent, vIdx: number, cIdx: number) => void;
  onCellMouseEnter: (vIdx: number, cIdx: number) => void;
  onCellContextMenu: (e: React.MouseEvent, vIdx: number, cIdx: number) => void;
  onStartEdit: (rowIndex: number, colIndex: number, currentVal: any) => void;
  onOpenTtlModal: (rowIndex: number, currentDisplayVal: any, isInsert: boolean) => void;
  onEditValChange: (val: string) => void;
  onFinishEdit: () => void;
  onCancelEdit: () => void;
  onTabNextFromEditor: (vIdx: number, cIdx: number) => void;
  fkMapByCol?: Record<string, ForeignKeyMeta>;
  onForeignKeyJump?: (fk: ForeignKeyMeta, val: any) => void;
  maskSensitiveData?: boolean;
}

const DataGridRowInner: React.FC<DataGridRowProps> = ({
  vr,
  columns,
  visibleColIndices,
  leftColSpacerWidth = 0,
  rightColSpacerWidth = 0,
  colWidths,
  colInputTypes,
  colEditableUpdate,
  colEditableInsert,
  frozenColumnSet,
  lastFrozenColName,
  frozenOffsets,
  isScrolledX,
  staged,
  isRowInSelection,
  isFullRowSelected,
  selectedColSet,
  editingColIndex,
  editVal,
  isFirstEditRenderRef,
  isRedis,
  gridCellBorder,
  gridRowClass,
  onRowHeaderMouseDown,
  onRowHeaderMouseEnter,
  onRowHeaderContextMenu,
  onCellMouseDown,
  onCellMouseEnter,
  onCellContextMenu,
  onStartEdit,
  onOpenTtlModal,
  onEditValChange,
  onFinishEdit,
  onCancelEdit,
  onTabNextFromEditor,
  fkMapByCol,
  onForeignKeyJump,
  maskSensitiveData = false,
}) => {
  const vIdx = vr.vIdx;
  const colIndicesToRender = visibleColIndices ?? columns.map((_, idx) => idx);

  if (!vr.isInsert) {
    const row = vr.rowData!;
    const globalRowIndex = vr.globalRowIndex!;
    const isDeleted = staged?.type === 'delete';

    let rowClass = gridRowClass;
    if (isDeleted) rowClass += ' bg-rose-950/20 text-zinc-500 line-through';

    return (
      <tr style={{ height: '28px' }} className={`${rowClass} group/row`}>
        <td
          onMouseDown={(e) => onRowHeaderMouseDown(e, vIdx)}
          onMouseEnter={() => onRowHeaderMouseEnter(vIdx)}
          onContextMenu={(e) => onRowHeaderContextMenu(e, vIdx)}
          className={`sticky left-0 z-10 px-2 py-1 text-center text-[11px] tabular-nums border-r border-b border-b-[#22242c] ${gridCellBorder} select-none cursor-pointer transition-colors ${
            isFullRowSelected
              ? 'bg-[#1b4ea3] text-white font-semibold'
              : isRowInSelection
              ? 'bg-[#1e293b] text-blue-300 font-medium'
              : isDeleted
              ? 'bg-[#2a1219] text-rose-400/70 line-through'
              : 'bg-[#14151a] text-zinc-500 group-hover/row:bg-[#20222a] group-hover/row:text-zinc-300'
          } ${
            frozenColumnSet.size === 0 && isScrolledX
              ? 'border-r-2 border-r-zinc-600/60 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.45)]'
              : ''
          }`}
          style={{
            width: `${ROW_NUM_COL_WIDTH}px`,
            minWidth: `${ROW_NUM_COL_WIDTH}px`,
            maxWidth: `${ROW_NUM_COL_WIDTH}px`,
          }}
          title={`Row ${globalRowIndex + 1} (Click to select entire row)`}
        >
          {globalRowIndex + 1}
        </td>
        {leftColSpacerWidth > 0 && (
          <td
            aria-hidden="true"
            style={{ width: `${leftColSpacerWidth}px`, minWidth: `${leftColSpacerWidth}px`, padding: 0, border: 0 }}
          />
        )}
        {colIndicesToRender.map((cIdx) => {
          const col = columns[cIdx];
          if (!col) return null;
          const isSelected = selectedColSet.has(cIdx);
          const isEditing = editingColIndex === cIdx;
          const hasColChange = staged?.type === 'update' && staged.changes[col.name] !== undefined;
          const displayVal = hasColChange ? staged.changes[col.name] : row[cIdx];
          const colInputType = colInputTypes[cIdx];
          const isFrozen = frozenColumnSet.has(col.name);
          const isLastFrozen = col.name === lastFrozenColName;
          const stickyLeft = isFrozen ? frozenOffsets[col.name] : undefined;
          const w = colWidths[col.name] || 120;
          const isEditable = colEditableUpdate[cIdx];

          return (
            <td
              key={col.name}
              data-vidx={vIdx}
              data-cidx={cIdx}
              onMouseDown={(e) => onCellMouseDown(e, vIdx, cIdx)}
              onMouseEnter={() => onCellMouseEnter(vIdx, cIdx)}
              onContextMenu={(e) => onCellContextMenu(e, vIdx, cIdx)}
              onDoubleClick={() => {
                if (isEditable) {
                  if (isRedis && col.name.toLowerCase() === 'ttl') {
                    onOpenTtlModal(globalRowIndex, displayVal, false);
                    return;
                  }
                  onStartEdit(globalRowIndex, cIdx, displayVal);
                }
              }}
              className={`group/cell relative px-3 py-1 border-r border-b border-b-[#22242c] ${gridCellBorder} truncate select-none transition-colors ${
                isFrozen
                  ? `sticky z-10 ${
                      isSelected
                        ? 'bg-[#1b4ea3] text-white font-medium'
                        : hasColChange
                        ? 'bg-[#17284a] text-blue-200 font-medium'
                        : isDeleted
                        ? 'bg-[#2a1219] text-zinc-500 line-through'
                        : !isEditable
                        ? 'bg-[#121318] text-zinc-400/80 group-hover/row:bg-[#1a1c23]'
                        : 'bg-[#14151a] group-hover/row:bg-[#20222a]'
                    }`
                  : isSelected
                  ? 'bg-[#1b4ea3] text-white font-medium'
                  : hasColChange
                  ? 'bg-blue-900/30 text-blue-200 font-medium'
                  : !isEditable
                  ? 'bg-[#111216]/50 text-zinc-400/80 group-hover/row:bg-[#181920]'
                  : ''
              } ${!isEditable ? 'cursor-default' : 'cursor-text'} ${
                isLastFrozen && isScrolledX
                  ? 'border-r-2 border-r-cyan-500/50 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.5)]'
                  : ''
              }`}
              style={{
                width: `${w}px`,
                minWidth: `${w}px`,
                maxWidth: `${w}px`,
                ...(isFrozen && stickyLeft !== undefined ? { left: stickyLeft } : {}),
              }}
              title={
                isEditable
                  ? isRedis && col.name.toLowerCase() === 'ttl'
                    ? 'Double-click to update TTL (Time-To-Live)'
                    : 'Click to select, type or double-click to edit'
                  : 'Read-only: this column cannot be edited'
              }
            >
              {isEditing ? (
                <GridCellEditor
                  colInputType={colInputType}
                  editVal={editVal}
                  variant="update"
                  isFirstEditRenderRef={isFirstEditRenderRef}
                  onChange={onEditValChange}
                  onFinishEdit={onFinishEdit}
                  onCancelEdit={onCancelEdit}
                  onTabNext={() => onTabNextFromEditor(vIdx, cIdx)}
                />
              ) : displayVal === null || displayVal === undefined ? (
                <span className={isSelected ? 'text-blue-200/80 italic' : 'text-zinc-600 italic'}>
                  NULL
                </span>
              ) : maskSensitiveData && isSensitiveColumn(col.name) ? (
                <span className={isSelected ? 'text-amber-200 font-mono' : 'text-amber-300/80 font-mono'}>
                  {maskCellValue(col.name, displayVal)}
                </span>
              ) : colInputType !== 'text' ? (
                String(displayVal).replace('T', ' ').replace(/Z$/, '')
              ) : (() => {
                const vec = parseVectorPreview(displayVal, col.dataType, col.rawType);
                if (vec) {
                  const badgeLabel =
                    vec.kind === 'sparse'
                      ? 'sparse'
                      : vec.kind === 'multi'
                      ? `${vec.dims}d multi`
                      : `${vec.dims}d`;
                  const badgeClass =
                    vec.kind === 'sparse'
                      ? isSelected
                        ? 'bg-emerald-500/40 text-emerald-100'
                        : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : isSelected
                      ? 'bg-blue-500/40 text-blue-100'
                      : 'bg-violet-500/15 text-violet-300 border border-violet-500/30';
                  return (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                      <span className={`px-1 py-0.2 rounded text-[10px] font-semibold ${badgeClass}`}>
                        {badgeLabel}
                      </span>
                      <span className={isSelected ? 'text-blue-100' : 'text-zinc-300'}>
                        {vec.preview}
                      </span>
                    </span>
                  );
                }
                return String(displayVal);
              })()}
              {!isEditing &&
                fkMapByCol?.[col.name] &&
                onForeignKeyJump &&
                displayVal !== null &&
                displayVal !== undefined && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onForeignKeyJump(fkMapByCol[col.name], displayVal);
                    }}
                    className="opacity-0 group-hover/cell:opacity-100 absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded bg-[#1e2029]/90 hover:bg-blue-600 text-blue-400 hover:text-white border border-[#2f3342] transition-all cursor-pointer"
                    title={`Jump to ${fkMapByCol[col.name].refTable}.${fkMapByCol[col.name].refColumn} = ${String(displayVal)}`}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
            </td>
          );
        })}
        {rightColSpacerWidth > 0 && (
          <td
            aria-hidden="true"
            style={{ width: `${rightColSpacerWidth}px`, minWidth: `${rightColSpacerWidth}px`, padding: 0, border: 0 }}
          />
        )}
        <td className="p-0 border-none pointer-events-none" />
      </tr>
    );
  }

  const change = vr.insertChange!;
  const rowClass =
    'border-b border-emerald-800/40 bg-emerald-950/25 hover:bg-emerald-900/35 border-l-4 border-l-emerald-500 transition-colors group/insert';

  return (
    <tr style={{ height: '28px' }} className={rowClass}>
      <td
        onMouseDown={(e) => onRowHeaderMouseDown(e, vIdx)}
        onMouseEnter={() => onRowHeaderMouseEnter(vIdx)}
        onContextMenu={(e) => onRowHeaderContextMenu(e, vIdx)}
        className={`sticky left-0 z-10 px-2 py-1 text-center text-[11px] font-bold border-r border-b border-b-emerald-800/40 border-[#22242c] select-none cursor-pointer transition-colors ${
          isFullRowSelected
            ? 'bg-[#1b4ea3] text-white'
            : isRowInSelection
            ? 'bg-[#1e293b] text-blue-300'
            : 'bg-[#0d1e17] group-hover/insert:bg-[#132b21] text-emerald-400'
        } ${
          frozenColumnSet.size === 0 && isScrolledX
            ? 'border-r-2 border-r-zinc-600/60 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.45)]'
            : ''
        }`}
        style={{
          width: `${ROW_NUM_COL_WIDTH}px`,
          minWidth: `${ROW_NUM_COL_WIDTH}px`,
          maxWidth: `${ROW_NUM_COL_WIDTH}px`,
        }}
        title="New row (Click to select entire row)"
      >
        +
      </td>
      {leftColSpacerWidth > 0 && (
        <td
          aria-hidden="true"
          style={{ width: `${leftColSpacerWidth}px`, minWidth: `${leftColSpacerWidth}px`, padding: 0, border: 0 }}
        />
      )}
      {colIndicesToRender.map((cIdx) => {
        const col = columns[cIdx];
        if (!col) return null;
        const isSelected = selectedColSet.has(cIdx);
        const isEditing = editingColIndex === cIdx;
        const colVal = change.changes[col.name];
        const isSet = colVal !== undefined;
        const displayVal = isSet ? colVal : col.defaultValue || null;
        const colInputType = colInputTypes[cIdx];
        const isFrozen = frozenColumnSet.has(col.name);
        const isLastFrozen = col.name === lastFrozenColName;
        const stickyLeft = isFrozen ? frozenOffsets[col.name] : undefined;
        const w = colWidths[col.name] || 120;
        const isInsEditable = colEditableInsert[cIdx];

        return (
          <td
            key={col.name}
            data-vidx={vIdx}
            data-cidx={cIdx}
            onMouseDown={(e) => onCellMouseDown(e, vIdx, cIdx)}
            onMouseEnter={() => onCellMouseEnter(vIdx, cIdx)}
            onContextMenu={(e) => onCellContextMenu(e, vIdx, cIdx)}
            onDoubleClick={() => {
              if (!isEditing && isInsEditable) {
                if (isRedis && col.name.toLowerCase() === 'ttl') {
                  onOpenTtlModal(change.rowIndex, displayVal ?? '', true);
                  return;
                }
                onStartEdit(change.rowIndex, cIdx, displayVal ?? '');
              }
            }}
            className={`px-3 py-1 border-r border-b border-b-emerald-800/40 border-[#22242c] truncate select-none transition-colors ${
              isFrozen
                ? `sticky z-10 ${
                    isSelected
                      ? 'bg-[#1b4ea3] text-white font-medium'
                      : isSet
                      ? 'bg-[#0c3b2a] text-emerald-100 font-medium'
                      : !isInsEditable
                      ? 'bg-[#0a1611] text-zinc-500'
                      : 'bg-[#0d1e17] group-hover/insert:bg-[#132b21] text-zinc-400'
                  }`
                : isSelected
                ? 'bg-[#1b4ea3] text-white font-medium'
                : isSet
                ? 'bg-emerald-900/40 text-emerald-100 font-medium'
                : !isInsEditable
                ? 'bg-[#08120e]/60 text-zinc-500'
                : 'text-zinc-400'
            } ${!isInsEditable ? 'cursor-default' : 'cursor-text'} ${
              isLastFrozen && isScrolledX
                ? 'border-r-2 border-r-cyan-500/50 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.5)]'
                : ''
            }`}
            style={{
              width: `${w}px`,
              minWidth: `${w}px`,
              maxWidth: `${w}px`,
              ...(isFrozen && stickyLeft !== undefined ? { left: stickyLeft } : {}),
            }}
            title={
              isInsEditable
                ? 'Click to select, type or double-click to edit'
                : 'Read-only: generated or calculated metadata'
            }
          >
            {isEditing ? (
              <GridCellEditor
                colInputType={colInputType}
                editVal={editVal}
                variant="insert"
                isFirstEditRenderRef={isFirstEditRenderRef}
                onChange={onEditValChange}
                onFinishEdit={onFinishEdit}
                onCancelEdit={onCancelEdit}
                onTabNext={() => onTabNextFromEditor(vIdx, cIdx)}
              />
            ) : displayVal === null || displayVal === undefined || displayVal === '' ? (
              <span className={isSelected ? 'text-blue-200/80 italic' : 'text-zinc-600 italic'}>
                {col.isAutoIncrement ? '(Auto)' : 'NULL'}
              </span>
            ) : colInputType !== 'text' ? (
              String(displayVal).replace('T', ' ').replace(/Z$/, '')
            ) : (
              String(displayVal)
            )}
          </td>
        );
      })}
      {rightColSpacerWidth > 0 && (
        <td
          aria-hidden="true"
          style={{ width: `${rightColSpacerWidth}px`, minWidth: `${rightColSpacerWidth}px`, padding: 0, border: 0 }}
        />
      )}
      <td className="p-0 border-none pointer-events-none" />
    </tr>
  );
};

export const DataGridRow = React.memo(DataGridRowInner, (prev, next) => {
  if (
    prev.vr !== next.vr ||
    prev.staged !== next.staged ||
    prev.isRowInSelection !== next.isRowInSelection ||
    prev.isFullRowSelected !== next.isFullRowSelected ||
    prev.rowSelectionSig !== next.rowSelectionSig ||
    prev.editingColIndex !== next.editingColIndex ||
    (next.editingColIndex !== null && prev.editVal !== next.editVal) ||
    prev.isScrolledX !== next.isScrolledX ||
    prev.colWidths !== next.colWidths ||
    prev.frozenOffsets !== next.frozenOffsets ||
    prev.lastFrozenColName !== next.lastFrozenColName ||
    prev.columns !== next.columns ||
    prev.visibleColIndices !== next.visibleColIndices ||
    prev.leftColSpacerWidth !== next.leftColSpacerWidth ||
    prev.rightColSpacerWidth !== next.rightColSpacerWidth ||
    prev.gridRowClass !== next.gridRowClass ||
    prev.fkMapByCol !== next.fkMapByCol
  ) {
    return false;
  }
  return true;
});
