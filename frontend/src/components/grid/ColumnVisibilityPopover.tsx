import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Eye, GripVertical, Key, RotateCcw, Search } from 'lucide-react';
import { ColumnMeta } from '../../types/domain';

interface ColumnVisibilityPopoverProps {
  columns: ColumnMeta[];
  primaryKeys?: string[];
  hiddenColumns?: string[];
  columnOrder?: string[];
  onChange: (nextHidden: string[], nextOrder: string[]) => void;
}

export function resolveOrderedColumns(
  columns: ColumnMeta[],
  columnOrder?: string[]
): ColumnMeta[] {
  if (!columnOrder || columnOrder.length === 0) return columns;
  const colMap = new Map(columns.map((c) => [c.name, c]));
  const ordered: ColumnMeta[] = [];
  const seen = new Set<string>();

  for (const name of columnOrder) {
    const col = colMap.get(name);
    if (col && !seen.has(name)) {
      ordered.push(col);
      seen.add(name);
    }
  }
  for (const col of columns) {
    if (!seen.has(col.name)) {
      ordered.push(col);
    }
  }
  return ordered;
}

export const ColumnVisibilityPopover: React.FC<ColumnVisibilityPopoverProps> = ({
  columns,
  primaryKeys = [],
  hiddenColumns = [],
  columnOrder = [],
  onChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draggedName, setDraggedName] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ name: string; pos: 'before' | 'after' } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const orderedColumns = useMemo(
    () => resolveOrderedColumns(columns, columnOrder),
    [columns, columnOrder]
  );

  const hiddenSet = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);
  const pkSet = useMemo(() => new Set(primaryKeys), [primaryKeys]);

  const visibleCount = useMemo(
    () => orderedColumns.filter((c) => !hiddenSet.has(c.name)).length,
    [orderedColumns, hiddenSet]
  );

  const hasCustomOrder = useMemo(() => {
    if (!columnOrder || columnOrder.length === 0) return false;
    return orderedColumns.some((c, idx) => columns[idx]?.name !== c.name);
  }, [orderedColumns, columns, columnOrder]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const handleToggleColumn = (colName: string) => {
    const isCurrentlyHidden = hiddenSet.has(colName);
    if (!isCurrentlyHidden && visibleCount <= 1) {
      // Keep at least 1 column visible so the grid never becomes completely empty
      return;
    }
    const nextHidden = isCurrentlyHidden
      ? hiddenColumns.filter((name) => name !== colName)
      : [...hiddenColumns, colName];
    const currentOrder = orderedColumns.map((c) => c.name);
    onChange(nextHidden, currentOrder);
  };

  const handleShowAll = () => {
    const currentOrder = orderedColumns.map((c) => c.name);
    onChange([], currentOrder);
  };

  const handleResetAll = () => {
    onChange([], []);
  };

  const handleDrop = (targetName: string, pos: 'before' | 'after') => {
    if (!draggedName || draggedName === targetName) {
      setDraggedName(null);
      setDropTarget(null);
      return;
    }

    const currentNames = orderedColumns.map((c) => c.name);
    const filtered = currentNames.filter((n) => n !== draggedName);
    const targetIdx = filtered.indexOf(targetName);
    if (targetIdx === -1) return;

    const insertIdx = pos === 'before' ? targetIdx : targetIdx + 1;
    filtered.splice(insertIdx, 0, draggedName);

    onChange(hiddenColumns, filtered);
    setDraggedName(null);
    setDropTarget(null);
  };

  const filteredColumns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orderedColumns;
    return orderedColumns.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.dataType || '').toLowerCase().includes(q)
    );
  }, [orderedColumns, search]);

  const hiddenCount = columns.length - visibleCount;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center gap-1 p-1 rounded transition-colors cursor-pointer shrink-0 ${
          isOpen || hiddenCount > 0 || hasCustomOrder
            ? 'text-blue-400 bg-blue-500/10 hover:bg-blue-500/20'
            : 'text-zinc-400 hover:text-white hover:bg-[#22242c]'
        }`}
        title={
          hiddenCount > 0
            ? `Show / Hide & Reorder Fields (${visibleCount}/${columns.length} visible)`
            : 'Show / Hide & Reorder Fields'
        }
      >
        <Eye className="h-3.5 w-3.5" />
        {hiddenCount > 0 && (
          <span className="text-[10px] font-mono font-semibold leading-none">
            {visibleCount}/{columns.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-lg border border-[#373946] bg-[#191a20] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3 py-2 border-b border-[#272932] bg-[#14151a] flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-xs font-semibold text-zinc-100">Fields</span>
              <span className="text-[10px] font-mono text-zinc-400">
                ({visibleCount}/{columns.length})
              </span>
            </div>
            <div className="flex items-center gap-2">
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={handleShowAll}
                  className="text-[11px] text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
                >
                  Show All
                </button>
              )}
              {(hiddenCount > 0 || hasCustomOrder) && (
                <button
                  type="button"
                  onClick={handleResetAll}
                  className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  title="Reset visibility & original column order"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset</span>
                </button>
              )}
            </div>
          </div>

          {columns.length > 6 && (
            <div className="p-2 border-b border-[#272932] bg-[#16171d]">
              <div className="relative">
                <Search className="h-3 w-3 text-zinc-500 absolute left-2.5 top-2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter fields..."
                  className="w-full rounded bg-[#121317] pl-7 pr-2 py-1 text-[11px] text-zinc-200 border border-[#272932] focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto py-1 divide-y divide-[#22242e]/40">
            {filteredColumns.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-zinc-500">
                No matching fields
              </div>
            ) : (
              filteredColumns.map((col) => {
                const isVisible = !hiddenSet.has(col.name);
                const isPK = Boolean(col.isPrimaryKey || pkSet.has(col.name));
                const isDragging = draggedName === col.name;
                const isDropBefore =
                  dropTarget?.name === col.name && dropTarget.pos === 'before';
                const isDropAfter =
                  dropTarget?.name === col.name && dropTarget.pos === 'after';

                return (
                  <div
                    key={col.name}
                    draggable={!search.trim()}
                    onDragStart={(e) => {
                      setDraggedName(col.name);
                      e.dataTransfer.effectAllowed = 'move';
                      try {
                        e.dataTransfer.setData('text/plain', col.name);
                      } catch {}
                    }}
                    onDragOver={(e) => {
                      if (!draggedName || draggedName === col.name) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const pos: 'before' | 'after' =
                        e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                      if (dropTarget?.name !== col.name || dropTarget?.pos !== pos) {
                        setDropTarget({ name: col.name, pos });
                      }
                    }}
                    onDragLeave={() => {
                      if (dropTarget?.name === col.name) {
                        setDropTarget(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!draggedName || draggedName === col.name) return;
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const pos: 'before' | 'after' =
                        e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                      handleDrop(col.name, pos);
                    }}
                    onDragEnd={() => {
                      setDraggedName(null);
                      setDropTarget(null);
                    }}
                    className={`relative flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs transition-colors hover:bg-[#232530] ${
                      isDragging ? 'opacity-40' : ''
                    } ${
                      isDropBefore
                        ? 'border-t-2 border-t-blue-500'
                        : isDropAfter
                        ? 'border-b-2 border-b-blue-500'
                        : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className={`text-zinc-500 hover:text-zinc-300 shrink-0 ${
                          search.trim() ? 'opacity-30 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
                        }`}
                        title={search.trim() ? 'Clear filter to reorder' : 'Drag to reorder field'}
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </span>

                      <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isVisible}
                          onChange={() => handleToggleColumn(col.name)}
                          disabled={isVisible && visibleCount <= 1}
                          className="rounded border-[#3b3e4f] bg-[#22242c] text-blue-500 focus:ring-0 cursor-pointer disabled:opacity-50"
                        />
                        {isPK && <Key className="h-3 w-3 text-amber-400 shrink-0" />}
                        <span
                          className={`font-mono truncate ${
                            isVisible ? 'text-zinc-200' : 'text-zinc-500 line-through'
                          }`}
                          title={col.name}
                        >
                          {col.name}
                        </span>
                      </label>
                    </div>

                    <span className="font-mono text-[10px] text-zinc-500 shrink-0 max-w-[80px] truncate">
                      {col.dataType}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="px-3 py-1.5 border-t border-[#272932] bg-[#14151a] text-[10px] text-zinc-500">
            Drag handle to reorder • Checkbox to show/hide
          </div>
        </div>
      )}
    </div>
  );
};
