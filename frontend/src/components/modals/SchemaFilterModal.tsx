import React, { useEffect, useState, useRef } from 'react';
import {
  Database,
  RefreshCw,
  X,
  Search,
  Check,
  Minus,
  Zap,
} from 'lucide-react';
import { ConnectionConfig } from '../../types/domain';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { ConnectionService, SchemaService } from '../../../bindings/dhub/internal/services';
import { alertError } from '../../stores/useAlertStore';

interface SchemaFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  connection: ConnectionConfig | null;
  anchorRect?: DOMRect | null;
}

function isSystemDatabase(driver: string, dbName: string): boolean {
  const lower = dbName.toLowerCase();
  if (driver === 'mysql') {
    return ['information_schema', 'mysql', 'performance_schema', 'sys'].includes(lower);
  }
  if (driver === 'postgres') {
    return (
      ['information_schema', 'pg_catalog', 'pg_toast'].includes(lower) ||
      lower.startsWith('pg_')
    );
  }
  return false;
}

export const SchemaFilterModal: React.FC<SchemaFilterModalProps> = ({
  isOpen,
  onClose,
  connection,
  anchorRect,
}) => {
  const {
    treeDatabases,
    visibleDatabases,
    setTreeDatabases,
    setVisibleDatabases,
    setActiveConnection,
    activeConnectionId,
    activeDatabase,
  } = useConnectionStore();

  const [allDatabases, setAllDatabases] = useState<string[]>([]);
  const [selectedDatabases, setSelectedDatabases] = useState<string[]>([]);
  const [filterText, setFilterText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [patternInput, setPatternInput] = useState('');
  const [showPatternInput, setShowPatternInput] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize databases and selected visible list when opened
  useEffect(() => {
    if (!isOpen || !connection) return;

    setFilterText('');
    setPatternInput('');
    setShowPatternInput(false);

    const connId = connection.id;
    const knownDbs = treeDatabases[connId];

    if (knownDbs && knownDbs.length > 0) {
      setAllDatabases(knownDbs);
      const currentlyVisible = visibleDatabases[connId];
      if (currentlyVisible !== undefined) {
        setSelectedDatabases(currentlyVisible);
      } else {
        setSelectedDatabases([...knownDbs]);
      }
    } else {
      // Not loaded yet, fetch from server
      setIsLoading(true);
      (async () => {
        try {
          await ConnectionService.Connect(connId);
          const fetched = (await SchemaService.GetDatabases(connId)) ?? [];
          const safe =
            fetched.length > 0
              ? fetched
              : connection.databaseName
              ? [connection.databaseName]
              : ['main'];
          setTreeDatabases(connId, safe);
          setAllDatabases(safe);

          const currentlyVisible = visibleDatabases[connId];
          if (currentlyVisible !== undefined) {
            setSelectedDatabases(currentlyVisible);
          } else {
            setSelectedDatabases([...safe]);
          }
        } catch (err: any) {
          console.error('Failed to load databases for filter modal:', err);
          alertError(err?.message || String(err), 'Failed to Load Schemas');
        } finally {
          setIsLoading(false);
        }
      })();
    }
  }, [isOpen, connection]);

  const handleRefresh = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!connection) return;
    setIsRefreshing(true);
    try {
      await ConnectionService.Connect(connection.id);
      const fetched = (await SchemaService.GetDatabases(connection.id)) ?? [];
      const safe =
        fetched.length > 0
          ? fetched
          : connection.databaseName
          ? [connection.databaseName]
          : ['main'];
      setTreeDatabases(connection.id, safe);
      setAllDatabases(safe);

      // Keep only selected databases that still exist
      setSelectedDatabases((prev) => {
        const stillExist = prev.filter((d) => safe.includes(d));
        return stillExist.length > 0 ? stillExist : safe;
      });
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Refresh Schemas');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleApply = () => {
    if (!connection) {
      onClose();
      return;
    }

    const connId = connection.id;
    setVisibleDatabases(connId, selectedDatabases, allDatabases.length);

    // If active database was deselected, switch to first visible database if possible
    if (activeConnectionId === connId && !selectedDatabases.includes(activeDatabase)) {
      const fallbackDb = selectedDatabases[0] || '';
      const fallbackSchema = connection.driver === 'postgres' ? 'public' : fallbackDb;
      setActiveConnection(connId, fallbackDb, fallbackSchema);
    }

    onClose();
  };

  // Keyboard navigation: Enter to apply, Escape to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        // Apply if not currently entering a pattern search or text input that needs Enter
        e.preventDefault();
        handleApply();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedDatabases, allDatabases, connection]);

  if (!isOpen || !connection) return null;

  // Toggle individual database
  const toggleDatabase = (db: string) => {
    setSelectedDatabases((prev) =>
      prev.includes(db) ? prev.filter((d) => d !== db) : [...prev, db]
    );
  };

  // All schemas toggle state
  const isAllSelected =
    allDatabases.length > 0 &&
    allDatabases.every((db) => selectedDatabases.includes(db));
  const isPartiallySelected =
    selectedDatabases.length > 0 && !isAllSelected;

  const handleToggleAll = () => {
    if (isAllSelected) {
      setSelectedDatabases([]);
    } else {
      setSelectedDatabases([...allDatabases]);
    }
  };

  // Default schema toggle
  const defaultSchema = connection.databaseName || '';
  const isDefaultSelected =
    !!defaultSchema && selectedDatabases.includes(defaultSchema);

  const handleToggleDefault = () => {
    if (!defaultSchema) return;
    if (isDefaultSelected) {
      setSelectedDatabases((prev) => prev.filter((d) => d !== defaultSchema));
    } else {
      setSelectedDatabases((prev) => [...prev, defaultSchema]);
    }
  };

  // Apply pattern matching (e.g. *dev*, test_*)
  const handleApplyPattern = () => {
    const raw = patternInput.trim();
    if (!raw) return;

    // Convert glob pattern to RegExp
    const regexStr = '^' + raw.replace(/([.+?^=!:${}()|[\]/\\])/g, '\\$1').replace(/\*/g, '.*') + '$';
    try {
      const reg = new RegExp(regexStr, 'i');
      const matches = allDatabases.filter((d) => reg.test(d));
      setSelectedDatabases((prev) => Array.from(new Set([...prev, ...matches])));
      setShowPatternInput(false);
      setPatternInput('');
    } catch {}
  };

  // Filtered list by speed filter input
  const filteredDatabases = allDatabases.filter((db) => {
    if (!filterText.trim()) return true;
    return db.toLowerCase().includes(filterText.toLowerCase().trim());
  });

  // Calculate position
  let popoverStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 60,
    width: '310px',
  };

  if (anchorRect) {
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const popoverHeight = 440;
    let top = anchorRect.bottom + 4;
    if (spaceBelow < popoverHeight && anchorRect.top > popoverHeight) {
      top = Math.max(8, anchorRect.top - popoverHeight - 4);
    } else {
      top = Math.min(top, Math.max(8, window.innerHeight - popoverHeight - 12));
    }

    const left = Math.max(
      8,
      Math.min(anchorRect.left, window.innerWidth - 330)
    );
    popoverStyle.top = `${top}px`;
    popoverStyle.left = `${left}px`;
  } else {
    popoverStyle.top = '15%';
    popoverStyle.left = '50%';
    popoverStyle.transform = 'translateX(-50%)';
  }

  return (
    <>
      {/* Click outside backdrop to auto-apply, just like DataGrip */}
      <div
        className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[0.5px]"
        onClick={handleApply}
      />

      <div
        ref={containerRef}
        style={popoverStyle}
        className="bg-[#1b1c23] border border-[#2e313d] rounded-lg shadow-2xl flex flex-col text-xs text-zinc-200 select-none overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#282a36] bg-[#16171d]">
          <div className="flex items-center gap-1.5 min-w-0">
            <Database className="h-3.5 w-3.5 text-blue-400 shrink-0" />
            <span className="font-semibold text-[11px] truncate text-zinc-200">
              {connection.name}
            </span>
            <span className="text-[10px] font-mono text-zinc-400 bg-[#22242c] px-1.5 py-0.2 rounded border border-[#2e313d] shrink-0">
              {selectedDatabases.length} of {allDatabases.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleRefresh}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#282a36] transition-colors"
              title="Refresh databases from server"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#282a36] transition-colors"
              title="Apply & Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Quick Search */}
        <div className="px-2.5 pt-2 pb-1 bg-[#1b1c23]">
          <div className="relative flex items-center">
            <Search className="absolute left-2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search schemas..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="w-full bg-[#131419] pl-7 pr-2 py-1 rounded text-[11px] text-zinc-200 placeholder-zinc-500 border border-[#2b2d38] focus:border-blue-500 focus:outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* Top Preset Checkboxes: All schemas & Default schema */}
        <div className="px-2.5 py-1 space-y-0.5 border-b border-[#282a36]">
          {/* All schemas row */}
          <div
            onClick={handleToggleAll}
            className="group flex items-center justify-between px-2 py-1 rounded cursor-pointer hover:bg-[#252733] transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-3.5 h-3.5 rounded flex items-center justify-center transition-colors shrink-0 ${
                  isAllSelected
                    ? 'bg-blue-600 text-white'
                    : isPartiallySelected
                    ? 'bg-blue-600/80 text-white'
                    : 'border border-zinc-600 bg-[#131419] group-hover:border-zinc-400'
                }`}
              >
                {isAllSelected ? (
                  <Check className="h-2.5 w-2.5 stroke-[3]" />
                ) : isPartiallySelected ? (
                  <Minus className="h-2.5 w-2.5 stroke-[3]" />
                ) : null}
              </div>
              <span className="text-[11px] font-medium text-zinc-200 truncate">
                All schemas
              </span>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowPatternInput(!showPatternInput);
              }}
              className="text-[10px] text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
            >
              add pattern
            </button>
          </div>

          {/* Add Pattern popup input if opened */}
          {showPatternInput && (
            <div
              className="flex items-center gap-1.5 px-2 py-1 bg-[#131419] rounded border border-[#2e313d] my-1"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                placeholder="Pattern (e.g. test_*, *dev*)"
                value={patternInput}
                onChange={(e) => setPatternInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    handleApplyPattern();
                  }
                }}
                className="flex-1 bg-transparent text-[11px] text-zinc-200 outline-none placeholder-zinc-500"
              />
              <button
                type="button"
                onClick={handleApplyPattern}
                className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px] font-medium cursor-pointer"
              >
                Add
              </button>
            </div>
          )}

          {/* Default schema row (if connection has default db configured) */}
          {defaultSchema ? (
            <div
              onClick={handleToggleDefault}
              className="group flex items-center justify-between px-2 py-1 rounded cursor-pointer hover:bg-[#252733] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-3.5 h-3.5 rounded flex items-center justify-center transition-colors shrink-0 ${
                    isDefaultSelected
                      ? 'bg-blue-600 text-white'
                      : 'border border-zinc-600 bg-[#131419] group-hover:border-zinc-400'
                  }`}
                >
                  {isDefaultSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                </div>
                <span className="text-[11px] text-zinc-200 truncate">
                  Default schema
                </span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500 truncate max-w-[110px]">
                {defaultSchema}
              </span>
            </div>
          ) : null}
        </div>

        {/* Database Checklist (Scrollable) */}
        <div className="flex-1 max-h-60 overflow-y-auto px-2 py-1 space-y-0.5">
          {isLoading ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-zinc-400">
              <RefreshCw className="h-5 w-5 animate-spin text-blue-400" />
              <span className="text-[11px]">Connecting and loading schemas...</span>
            </div>
          ) : filteredDatabases.length === 0 ? (
            <div className="py-6 text-center text-zinc-500 text-[11px]">
              {filterText ? `No schemas matching "${filterText}"` : 'No schemas found'}
            </div>
          ) : (
            filteredDatabases.map((db) => {
              const isChecked = selectedDatabases.includes(db);
              const isSystem = isSystemDatabase(connection.driver, db);

              return (
                <div
                  key={db}
                  onClick={() => toggleDatabase(db)}
                  className={`group flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors ${
                    isChecked
                      ? 'bg-[#21232e] text-zinc-100 hover:bg-[#282a38]'
                      : 'hover:bg-[#252733] text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div
                      className={`w-3.5 h-3.5 rounded flex items-center justify-center transition-colors shrink-0 ${
                        isChecked
                          ? 'bg-blue-600 text-white'
                          : 'border border-zinc-600 bg-[#131419] group-hover:border-zinc-400'
                      }`}
                    >
                      {isChecked && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                    </div>

                    <span className="truncate text-[11px]">{db}</span>

                    {/* Lightning bolt indicator for system schemas (DataGrip style) */}
                    {isSystem && (
                      <span title="System schema" className="inline-flex items-center">
                        <Zap className="h-3 w-3 text-amber-400 shrink-0 ml-0.5" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer: DataGrip style hint & Action Buttons */}
        <div className="border-t border-[#282a36] bg-[#16171d] px-3 py-1.5 flex flex-col gap-1.5">
          <div className="text-[10px] text-zinc-500 tracking-tight">
            Press Enter or click outside the list to apply
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedDatabases([...allDatabases])}
                className="text-[10px] text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
              >
                Select all
              </button>
              <span className="text-zinc-600">•</span>
              <button
                type="button"
                onClick={() => setSelectedDatabases([])}
                className="text-[10px] text-zinc-400 hover:text-zinc-300 hover:underline cursor-pointer"
              >
                Clear
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onClose}
                className="px-2 py-0.5 rounded text-[11px] text-zinc-400 hover:text-white hover:bg-[#252733] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="px-2.5 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium shadow cursor-pointer transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
