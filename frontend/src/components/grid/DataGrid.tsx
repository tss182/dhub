import React, { useState } from 'react';
import { ColumnMeta } from '../../types/domain';
import { useGridEditStore } from '../../stores/useGridEditStore';
import { Plus, Trash2, RotateCcw, Check, Eye } from 'lucide-react';

const EMPTY_STAGED: Record<number, any> = {};

interface DataGridProps {
  tabId: string;
  columns: ColumnMeta[];
  rows: any[][];
  primaryKeys?: string[];
  onSubmitChanges: () => void;
  onPreviewChanges: () => void;
}

export const DataGrid: React.FC<DataGridProps> = ({
  tabId,
  columns,
  rows,
  primaryKeys = [],
  onSubmitChanges,
  onPreviewChanges,
}) => {
  const [filterText, setFilterText] = useState('');
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; colIndex: number } | null>(null);
  const [editVal, setEditVal] = useState<string>('');

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

  const filteredRows = rows.filter((r) => {
    if (!filterText) return true;
    return r.some((cell) => String(cell).toLowerCase().includes(filterText.toLowerCase()));
  });

  return (
    <div className="flex h-full flex-col bg-[#191a20] text-xs select-text">
      {/* Table Toolbar */}
      <div className="flex h-10 items-center justify-between border-b border-[#272932] px-3">
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

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter in result..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="h-6 rounded bg-[#121317] px-2 text-[11px] text-zinc-200 border border-[#272932] focus:border-blue-500 focus:outline-none w-48"
          />
          <span className="text-[11px] text-zinc-500 font-mono">
            {filteredRows.length} rows
          </span>
        </div>
      </div>

      {/* Grid Table Container */}
      <div className="flex-1 overflow-auto">
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
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="py-12 text-center text-zinc-500 font-sans">
                  No data to display
                </td>
              </tr>
            ) : (
              filteredRows.map((row, rIdx) => {
                const staged = stagedChanges[rIdx];
                const isDeleted = staged?.type === 'delete';
                const isInserted = staged?.type === 'insert';

                let rowClass = 'border-b border-[#22242c] hover:bg-[#20222a]';
                if (isDeleted) rowClass += ' bg-rose-950/20 text-zinc-500 line-through';
                if (isInserted) rowClass += ' bg-emerald-950/20 border-l-2 border-emerald-500';

                return (
                  <tr key={rIdx} className={rowClass}>
                    <td className="px-2 py-1 text-center text-zinc-600 border-r border-[#272932] select-none text-[11px]">
                      {rIdx + 1}
                    </td>
                    {columns.map((col, cIdx) => {
                      const isEditing = editingCell?.rowIndex === rIdx && editingCell?.colIndex === cIdx;
                      const hasColChange = staged?.type === 'update' && staged.changes[col.name] !== undefined;
                      const displayVal = hasColChange ? staged.changes[col.name] : row[cIdx];

                      return (
                        <td
                          key={col.name}
                          onDoubleClick={() => handleStartEdit(rIdx, cIdx, displayVal)}
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
          </tbody>
        </table>
      </div>
    </div>
  );
};

