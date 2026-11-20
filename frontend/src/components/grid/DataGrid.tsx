import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, Suspense, lazy } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useGridEditStore, StagedRowChange } from '../../stores/useGridEditStore';
import { useSettingsStore, CopyFormat } from '../../stores/useSettingsStore';
import { APP_DEFAULTS } from '../../config/defaults';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useAlertStore, alertWarning } from '../../stores/useAlertStore';
import { SchemaService } from '../../../bindings/dhub/internal/services';
import { ForeignKeyMeta } from '../../types/domain';
import { quoteSqlIdentifier } from '../../utils/sqlIdentifier';
import {
  RefreshCw,
  RotateCcw,
  Key,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  Lock,
  ArrowUpCircle,
  Snowflake,
} from 'lucide-react';
import { RedisAddKeyModal } from '../modals/RedisAddKeyModal';
import { RedisRenameKeyModal } from '../modals/RedisRenameKeyModal';
import { CopyAsModal } from '../modals/CopyAsModal';

const ExportModal = lazy(() =>
  import('../modals/ExportModal').then((m) => ({ default: m.ExportModal }))
);
const ImportModal = lazy(() =>
  import('../modals/ImportModal').then((m) => ({ default: m.ImportModal }))
);

import {
  isMac,
  ROW_NUM_COL_WIDTH,
  EMPTY_STAGED,
  EMPTY_PRIMARY_KEYS,
  EMPTY_SORT_CONFIGS,
  SortConfig,
  WhereSuggestionItem,
  CellRect,
  VisualRow,
  ColumnHoverInfo,
  TtlModalState,
  ContextMenuState,
  DataGridProps,
} from './gridTypes';
import {
  parseColumnTypeDetails,
  formatSqlLiteral,
  getColumnInputType,
  formatToDateInputValue,
  normalizeDateCommitValue,
  tryParseSqlInsert,
  tryParseSqlUpdate,
  tryParseJson,
  cleanPastedValue,
  buildUpdateSql,
  formatSelectedCells,
} from './gridFormatters';
import {
  getColWidthsStorageKey,
  saveColWidths,
  loadColWidths,
  getMinimumColumnWidth,
  getInitialColumnWidth,
} from './gridColumnWidths';
import { getWhereCurrentToken, computeWhereSuggestions } from './whereAutocomplete';
import { GridToolbar } from './GridToolbar';
import { GridPagination } from './GridPagination';
import { GridContextMenu } from './GridContextMenu';
import { GridCellEditor } from './GridCellEditor';
import { DataGridRow } from './DataGridRow';
import {
  ColumnHoverPopover,
  CancelChangesModal,
  AllSortsModal,
  AllFrozenModal,
  RedisTtlModal,
} from './GridModals';

export { formatSqlLiteral };
export type { SortConfig, WhereSuggestionItem };

export const DataGrid: React.FC<DataGridProps> = ({
  tabId,
  connectionId,
  database,
  schema,
  tableName,
  driver,
  isReadOnly = false,
  columns,
  rows,
  primaryKeys = EMPTY_PRIMARY_KEYS,
  onSubmitChanges,
  onPreviewChanges,
  onCopyDml,
  totalCount,
  onCountRows,
  hasMore = false,
  isLoadingMore = false,
  hasPrevious = false,
  isLoadingPrevious = false,
  onLoadPrevious,
  startOffset = 0,
  page,
  onPageChange,
  pageSize = APP_DEFAULTS.pageSize,
  onPageSizeChange,
  onRefresh,
  whereClause = '',
  errorMessage,
  onApplyWhere,
  isTableTab = false,
  sortConfigs = EMPTY_SORT_CONFIGS,
  onSortChange,
  envType = 'local',
  rawSql,
  initialFrozenColumns,
  onFrozenColumnsChange,
  onColumnReorder,
  onHideColumn,
  hiddenColumnsCount = 0,
  onShowAllColumns,
  targetRowIndex,
  onActiveRowChange,
  initialScrollTop,
  initialScrollLeft,
  onScrollChange,
}) => {
  const isRedis = useMemo(() => {
    if ((driver || '').toLowerCase() === 'redis') return true;
    if (connectionId) {
      const conn = useConnectionStore.getState().connections.find((c) => c.id === connectionId);
      if (conn?.driver?.toLowerCase() === 'redis') return true;
    }
    return false;
  }, [driver, connectionId]);

  const [whereInput, setWhereInput] = useState(whereClause || '');
  const [whereCursorPos, setWhereCursorPos] = useState<number>(0);
  const [showWhereSuggestions, setShowWhereSuggestions] = useState<boolean>(false);
  const [forceShowSuggestions, setForceShowSuggestions] = useState<boolean>(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<number>(0);
  const whereInputRef = useRef<HTMLInputElement>(null);
  const whereContainerRef = useRef<HTMLDivElement>(null);
  const suggestionListRef = useRef<HTMLDivElement>(null);
  const [localSortConfigs, setLocalSortConfigs] = useState<SortConfig[]>(sortConfigs || []);
  const [frozenColumns, setFrozenColumns] = useState<string[]>(() => {
    if (isRedis) return [];
    return initialFrozenColumns && initialFrozenColumns.length > 0
      ? initialFrozenColumns
      : Array.from(new Set(columns.filter((c) => c.isPrimaryKey || primaryKeys.includes(c.name)).map((c) => c.name)));
  });
  const prevTabTableKeyRef = useRef<string>(`${tabId || ''}::${tableName || ''}`);
  const hasInitializedPKsRef = useRef<boolean>(false);
  const primaryKeysKey = primaryKeys.join(',');

  // O(1) lookup structures for columns, primary keys, and frozen columns
  const primaryKeySet = useMemo(() => new Set(primaryKeys), [primaryKeys]);
  const frozenColumnSet = useMemo(() => new Set(frozenColumns), [frozenColumns]);
  const colIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    columns.forEach((col, idx) => map.set(col.name, idx));
    return map;
  }, [columns]);

  const stagedChanges = useGridEditStore((state) => state.stagedByTab[tabId] ?? EMPTY_STAGED);
  const stageCellUpdate = useGridEditStore((state) => state.stageCellUpdate);
  const stageRowInsert = useGridEditStore((state) => state.stageRowInsert);
  const stageRowDelete = useGridEditStore((state) => state.stageRowDelete);
  const revertTabChanges = useGridEditStore((state) => state.revertTabChanges);
  const stagedCount = Object.keys(stagedChanges).length;

  const thRefs = useRef<Record<string, HTMLTableCellElement | null>>({});
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const [draggedColName, setDraggedColName] = useState<string | null>(null);
  const [colDropTarget, setColDropTarget] = useState<{ name: string; pos: 'before' | 'after' } | null>(null);
  const resizingRef = useRef<{ colName: string; startX: number; startWidth: number } | null>(null);
  const isResizingRef = useRef(false);
  const currentWidthsRef = useRef<Record<string, number>>({});
  const userHasResizedRef = useRef<boolean>(false);
  const hasSampledRowsRef = useRef<boolean>(false);
  const [isScrolledX, setIsScrolledX] = useState<boolean>(false);
  const [copiedRawSql, setCopiedRawSql] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [showAllSortsModal, setShowAllSortsModal] = useState(false);
  const [showAllFrozenModal, setShowAllFrozenModal] = useState(false);
  const [isCopyAsOpen, setIsCopyAsOpen] = useState(false);
  const [isCopyAsSubmenuOpen, setIsCopyAsSubmenuOpen] = useState(false);
  const [maskSensitiveData, setMaskSensitiveData] = useState(false);
  const [fkMapByCol, setFkMapByCol] = useState<Record<string, ForeignKeyMeta>>({});

  const [ttlModal, setTtlModal] = useState<TtlModalState | null>(null);
  const [ttlMode, setTtlMode] = useState<'persist' | 'custom'>('custom');
  const [ttlAmount, setTtlAmount] = useState<string>('3600');
  const [ttlUnit, setTtlUnit] = useState<'s' | 'm' | 'h' | 'd'>('s');

  const [redisAddKeyOpen, setRedisAddKeyOpen] = useState(false);
  const [redisRenameModal, setRedisRenameModal] = useState<{
    isOpen: boolean;
    oldKeyName: string;
  }>({ isOpen: false, oldKeyName: '' });

  useEffect(() => {
    const currentKey = `${tabId || ''}::${tableName || ''}`;
    const pks = isRedis
      ? []
      : columns.filter((c) => c.isPrimaryKey || primaryKeySet.has(c.name)).map((c) => c.name);
    const uniquePKs = Array.from(new Set(pks));

    if (prevTabTableKeyRef.current !== currentKey) {
      prevTabTableKeyRef.current = currentKey;
      hasInitializedPKsRef.current = uniquePKs.length > 0;
      setFrozenColumns(uniquePKs);
      hasSampledRowsRef.current = false;
      userHasResizedRef.current = false;
    } else if (isRedis) {
      setFrozenColumns([]);
    } else if (!hasInitializedPKsRef.current && uniquePKs.length > 0) {
      hasInitializedPKsRef.current = true;
      setFrozenColumns((prev) => Array.from(new Set([...prev, ...uniquePKs])));
    }
  }, [tabId, tableName, columns, primaryKeysKey, primaryKeySet, isRedis]);

  useEffect(() => {
    if (!isTableTab || !connectionId || !database || !tableName || isRedis) {
      setFkMapByCol({});
      return;
    }
    let cancelled = false;
    const targetSchema = schema || (driver === 'postgres' ? 'public' : driver === 'mssql' ? 'dbo' : database);
    SchemaService.GetTableStructure(connectionId, database, targetSchema, tableName)
      .then((st) => {
        if (cancelled || !st?.foreignKeys) return;
        const next: Record<string, ForeignKeyMeta> = {};
        for (const fk of st.foreignKeys) {
          if (fk.columnName && fk.refTable && fk.refColumn) {
            next[fk.columnName] = fk as ForeignKeyMeta;
          }
        }
        setFkMapByCol(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isTableTab, connectionId, database, schema, tableName, driver, isRedis]);

  const handleForeignKeyJump = useCallback(
    (fk: ForeignKeyMeta, val: any) => {
      if (!connectionId || !database || val === null || val === undefined) return;
      const targetSchema = fk.refSchema || schema || database;
      const quotedCol = quoteSqlIdentifier(driver || '', fk.refColumn);
      const literal = formatSqlLiteral(val);
      const whereStr = `${quotedCol} = ${literal}`;
      const targetTabId = `table-${connectionId}-${database}-${fk.refTable}`;
      useWorkbenchStore.getState().openTab({
        id: targetTabId,
        type: 'table_data',
        title: fk.refTable,
        connectionId,
        driver,
        database,
        schema: targetSchema,
        table: fk.refTable,
        tableViewState: {
          whereClause: whereStr,
        },
      });
    },
    [connectionId, database, schema, driver]
  );

  const isColumnEditable = useCallback(
    (colName: string, isInsert: boolean = false): boolean => {
      if (isReadOnly) return false;
      if (isRedis) {
        const colNameLower = colName.toLowerCase();
        if (isInsert) {
          return colNameLower === 'key' || colNameLower === 'value' || colNameLower === 'ttl';
        }
        return colNameLower === 'value' || colNameLower === 'ttl';
      }
      return true;
    },
    [isReadOnly, isRedis]
  );

  const isCellEditable = useCallback(
    (rowIndex: number, colIndex: number): boolean => {
      if (isReadOnly) return false;
      const col = columns[colIndex];
      if (!col) return false;
      return isColumnEditable(col.name, rowIndex < 0);
    },
    [isReadOnly, columns, isColumnEditable]
  );

  const getRowByGlobalIndex = useCallback(
    (globalIdx: number) => {
      const rowInArray = globalIdx >= (startOffset || 0) ? globalIdx - (startOffset || 0) : globalIdx;
      return rows[rowInArray] || rows[globalIdx];
    },
    [rows, startOffset]
  );

  const buildRowMetaMaps = useCallback(
    (targetRow: any[] | undefined) => {
      const originalRowValues: Record<string, unknown> = {};
      columns.forEach((c, idx) => {
        originalRowValues[c.name] = targetRow?.[idx];
      });
      const pkMap: Record<string, unknown> = {};
      primaryKeys.forEach((pk) => {
        const idx = colIndexMap.get(pk);
        if (idx !== undefined) pkMap[pk] = targetRow?.[idx];
      });
      return { originalRowValues, pkMap };
    },
    [columns, primaryKeys, colIndexMap]
  );

  const handleOpenTtlModal = (rowIndex: number, currentDisplayVal: any, isInsert: boolean) => {
    let keyName = '';
    const keyColIdx = columns.findIndex((c) => c.name.toLowerCase() === 'key');
    if (isInsert) {
      const staged = stagedChanges[rowIndex];
      keyName = String(staged?.type === 'insert' ? staged.changes['key'] ?? '' : '');
    } else {
      const rowInArray = rowIndex >= (startOffset || 0) ? rowIndex - (startOffset || 0) : rowIndex;
      const targetRow = rows[rowInArray] || rows[rowIndex];
      keyName = keyColIdx !== -1 && targetRow ? String(targetRow[keyColIdx] ?? '') : '';
    }

    const cur = String(currentDisplayVal ?? 'no ttl').trim();
    setTtlModal({ rowIndex, keyName, currentTtl: cur, isInsert });

    if (cur === 'no ttl' || cur === '-1' || cur === 'persist' || cur === '') {
      setTtlMode('persist');
      setTtlAmount('3600');
      setTtlUnit('s');
    } else {
      setTtlMode('custom');
      const lower = cur.toLowerCase();
      if (lower.endsWith('days') || lower.endsWith('day') || lower.endsWith('d')) {
        setTtlAmount(lower.replace(/(days|day|d)/g, '').trim() || '1');
        setTtlUnit('d');
      } else if (lower.endsWith('hours') || lower.endsWith('hour') || lower.endsWith('h')) {
        setTtlAmount(lower.replace(/(hours|hour|h)/g, '').trim() || '1');
        setTtlUnit('h');
      } else if (lower.endsWith('minutes') || lower.endsWith('minute') || lower.endsWith('m')) {
        setTtlAmount(lower.replace(/(minutes|minute|m)/g, '').trim() || '1');
        setTtlUnit('m');
      } else if (lower.endsWith('seconds') || lower.endsWith('second') || lower.endsWith('s')) {
        setTtlAmount(lower.replace(/(seconds|second|s)/g, '').trim() || '60');
        setTtlUnit('s');
      } else if (!isNaN(Number(cur))) {
        setTtlAmount(cur);
        setTtlUnit('s');
      } else {
        setTtlAmount('3600');
        setTtlUnit('s');
      }
    }
  };

  const handleSaveTtl = (applyImmediately: boolean = false) => {
    if (!ttlModal) return;
    const finalVal = ttlMode === 'persist' ? 'no ttl' : `${ttlAmount}${ttlUnit}`;
    const targetIdx = ttlModal.rowIndex;

    if (ttlModal.isInsert) {
      stageCellUpdate(tabId, targetIdx, {}, {}, 'ttl', finalVal);
    } else {
      const rowInArray = targetIdx >= (startOffset || 0) ? targetIdx - (startOffset || 0) : targetIdx;
      const targetRow = rows[rowInArray] || rows[targetIdx];
      const { originalRowValues, pkMap } = buildRowMetaMaps(targetRow);
      stageCellUpdate(tabId, targetIdx, pkMap, originalRowValues, 'ttl', finalVal);
    }

    setTtlModal(null);

    if (applyImmediately) {
      setTimeout(() => {
        onSubmitChanges(true);
      }, 50);
    }
  };

  const handleCopyRawSql = async () => {
    if (!rawSql) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(rawSql);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = rawSql;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedRawSql(true);
      setTimeout(() => setCopiedRawSql(false), 2000);
    } catch (_) {}
  };

  const whereSuggestions = useMemo<WhereSuggestionItem[]>(
    () =>
      computeWhereSuggestions({
        isTableTab,
        columns,
        primaryKeys,
        whereInput,
        whereCursorPos,
        forceShowSuggestions,
      }),
    [isTableTab, columns, primaryKeys, whereInput, whereCursorPos, forceShowSuggestions]
  );

  const applyWhereSuggestion = (item: WhereSuggestionItem) => {
    const inputEl = whereInputRef.current;
    const cursor = inputEl ? (inputEl.selectionStart ?? whereInput.length) : whereInput.length;
    const token = getWhereCurrentToken(whereInput, cursor);

    const before = whereInput.slice(0, token.start);
    const after = whereInput.slice(token.end);

    let insertText = item.name;
    if (item.type === 'column' && /[^a-zA-Z0-9_]/.test(insertText)) {
      insertText = `\`${insertText}\``;
    }

    const needsSpaceAfter = !after.startsWith(' ');
    const nextValue = `${before}${insertText}${needsSpaceAfter ? ' ' : ''}${after}`;
    const nextCursor = before.length + insertText.length + (needsSpaceAfter ? 1 : 0);

    setWhereInput(nextValue);
    setWhereCursorPos(nextCursor);
    setShowWhereSuggestions(false);
    setSelectedSuggestionIndex(0);

    requestAnimationFrame(() => {
      if (whereInputRef.current) {
        whereInputRef.current.focus();
        whereInputRef.current.setSelectionRange(nextCursor, nextCursor);
      }
    });
  };

  const applyWhereValue = () => {
    setShowWhereSuggestions(false);
    setForceShowSuggestions(false);
    let finalVal = whereInput.trim();
    if (
      isRedis &&
      finalVal &&
      !finalVal.toLowerCase().includes('key') &&
      !finalVal.toLowerCase().includes('like') &&
      !finalVal.toLowerCase().includes('=')
    ) {
      finalVal = `key LIKE '${finalVal}'`;
    }
    onApplyWhere?.(finalVal);
  };

  const handleWhereKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      setForceShowSuggestions(true);
      setShowWhereSuggestions(true);
      setSelectedSuggestionIndex(0);
      return;
    }

    if (showWhereSuggestions && whereSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) => (prev + 1) % whereSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) => (prev - 1 + whereSuggestions.length) % whereSuggestions.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < whereSuggestions.length) {
          e.preventDefault();
          applyWhereSuggestion(whereSuggestions[selectedSuggestionIndex]);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowWhereSuggestions(false);
        setForceShowSuggestions(false);
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      applyWhereValue();
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (whereContainerRef.current && !whereContainerRef.current.contains(e.target as Node)) {
        setShowWhereSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (showWhereSuggestions && suggestionListRef.current) {
      const activeEl = suggestionListRef.current.querySelector<HTMLElement>(
        `[data-suggestion-index="${selectedSuggestionIndex}"]`
      );
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedSuggestionIndex, showWhereSuggestions]);

  useEffect(() => {
    setWhereInput(whereClause || '');
  }, [whereClause]);

  useEffect(() => {
    setLocalSortConfigs(sortConfigs || []);
  }, [sortConfigs]);

  const handleToggleSort = (colName: string, e?: React.MouseEvent) => {
    const existingIdx = localSortConfigs.findIndex((s) => s.column === colName);
    let nextConfigs: SortConfig[] = [];
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
        nextConfigs = [...localSortConfigs, { column: colName, direction: 'asc' }];
      } else {
        const existing = localSortConfigs[existingIdx];
        if (existing.direction === 'asc') {
          nextConfigs = localSortConfigs.map((s, idx) =>
            idx === existingIdx ? { ...s, direction: 'desc' as const } : s
          );
        } else {
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

  const handleToggleFreeze = (colName: string) => {
    if (isRedis) return;
    setFrozenColumns((prev) => {
      const next = prev.includes(colName) ? prev.filter((c) => c !== colName) : [...prev, colName];
      onFrozenColumnsChange?.(next);
      return next;
    });
  };

  const storageKey = useMemo(
    () => getColWidthsStorageKey(connectionId, database, tableName, tabId, columns),
    [connectionId, database, tableName, tabId, columns]
  );

  useLayoutEffect(() => {
    if (!columns || columns.length === 0) return;

    const saved = loadColWidths(storageKey) || {};
    const newWidths: Record<string, number> = {};

    columns.forEach((col, idx) => {
      const isPK = Boolean(col.isPrimaryKey || primaryKeySet.has(col.name));
      const minRequired = getMinimumColumnWidth(col, isPK);

      if (saved[col.name] && typeof saved[col.name] === 'number') {
        newWidths[col.name] = Math.max(saved[col.name], minRequired);
      } else if (currentWidthsRef.current[col.name]) {
        newWidths[col.name] = Math.max(currentWidthsRef.current[col.name], minRequired);
      } else {
        newWidths[col.name] = getInitialColumnWidth(col, rows, idx, isPK);
      }
    });

    const prevWidths = currentWidthsRef.current;
    const prevKeys = Object.keys(prevWidths);
    const nextKeys = Object.keys(newWidths);
    const changed =
      prevKeys.length !== nextKeys.length || nextKeys.some((k) => prevWidths[k] !== newWidths[k]);

    if (changed) {
      currentWidthsRef.current = newWidths;
      setColWidths(newWidths);
    }
  }, [columns, storageKey, primaryKeysKey, primaryKeySet]);

  useLayoutEffect(() => {
    if (rows.length > 0 && !hasSampledRowsRef.current && !userHasResizedRef.current) {
      hasSampledRowsRef.current = true;
      const saved = loadColWidths(storageKey) || {};
      setColWidths((prev) => {
        const next = { ...prev };
        let changed = false;
        columns.forEach((col, idx) => {
          const isPK = Boolean(col.isPrimaryKey || primaryKeySet.has(col.name));
          if (!saved[col.name]) {
            const optimal = getInitialColumnWidth(col, rows, idx, isPK);
            if (optimal > (prev[col.name] || 0)) {
              next[col.name] = optimal;
              changed = true;
            }
          }
        });
        if (changed) {
          currentWidthsRef.current = next;
          return next;
        }
        return prev;
      });
    }
  }, [rows.length, columns, storageKey, primaryKeysKey, primaryKeySet]);

  const handleResizeStart = (e: React.MouseEvent, colName: string) => {
    e.stopPropagation();
    e.preventDefault();
    isResizingRef.current = true;
    setResizingCol(colName);

    const startX = e.clientX;
    const currentWidth = colWidths[colName] || thRefs.current[colName]?.offsetWidth || 120;
    resizingRef.current = { colName, startX, startWidth: currentWidth };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    let rafId: number | null = null;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingRef.current) return;
      const deltaX = moveEvent.clientX - resizingRef.current.startX;
      const nextWidth = Math.max(60, resizingRef.current.startWidth + deltaX);

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setColWidths((prev) => {
          if (prev[colName] === nextWidth) return prev;
          const updated = { ...prev, [colName]: nextWidth };
          currentWidthsRef.current = updated;
          return updated;
        });
      });
    };

    const handleMouseUp = () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      resizingRef.current = null;
      setResizingCol(null);
      userHasResizedRef.current = true;
      saveColWidths(storageKey, currentWidthsRef.current);

      setTimeout(() => {
        isResizingRef.current = false;
      }, 100);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleResizeDoubleClick = (e: React.MouseEvent, colName: string, cIdx: number) => {
    e.stopPropagation();
    e.preventDefault();
    const col = columns[cIdx];
    if (!col) return;
    const isPK = Boolean(col.isPrimaryKey || primaryKeySet.has(col.name));
    const autoWidth = getInitialColumnWidth(col, rows, cIdx, isPK);
    setColWidths((prev) => {
      const next = { ...prev, [colName]: autoWidth };
      currentWidthsRef.current = next;
      saveColWidths(storageKey, next);
      return next;
    });
  };

  const frozenOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let currentLeft = ROW_NUM_COL_WIDTH;
    for (let idx = 0; idx < columns.length; idx++) {
      const col = columns[idx];
      if (frozenColumnSet.has(col.name)) {
        offsets[col.name] = currentLeft;
        const isPK = Boolean(col.isPrimaryKey || primaryKeySet.has(col.name));
        const w = colWidths[col.name] || getMinimumColumnWidth(col, isPK);
        currentLeft += w;
      }
    }
    return offsets;
  }, [columns, frozenColumnSet, colWidths, primaryKeySet]);

  const lastFrozenColName = useMemo(() => {
    for (let i = columns.length - 1; i >= 0; i--) {
      if (frozenColumnSet.has(columns[i].name)) {
        return columns[i].name;
      }
    }
    return null;
  }, [columns, frozenColumnSet]);

  const [hoveredCol, setHoveredCol] = useState<ColumnHoverInfo | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleColMouseEnter = (e: React.MouseEvent, col: typeof columns[0], isPK: boolean) => {
    if (isResizingRef.current || resizingRef.current) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const tooltipWidth = 240;
    const x = Math.min(Math.max(8, rect.left), window.innerWidth - tooltipWidth - 16);
    const y = rect.bottom + 4;
    const details = parseColumnTypeDetails(col.dataType);

    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredCol({ col, isPK, details, x, y });
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
  const isFirstEditRenderRef = useRef<boolean>(false);
  const globalDefaultPageSize = useSettingsStore((state) => state.defaultPageSize);
  const copyFormat = useSettingsStore((state) => state.copyFormat);

  const [currentPage, setCurrentPage] = useState(page || 1);
  const [localPageSize, setLocalPageSize] = useState(pageSize || globalDefaultPageSize || APP_DEFAULTS.pageSize);
  const [isCountingTotal, setIsCountingTotal] = useState(false);
  const [isPageSizeOpen, setIsPageSizeOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageSizeMenuRef = useRef<HTMLDivElement>(null);
  const rowVirtualizerRef = useRef<ReturnType<typeof useVirtualizer<HTMLDivElement, Element>> | null>(null);

  const onScrollChangeRef = useRef(onScrollChange);
  onScrollChangeRef.current = onScrollChange;

  const debouncedScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestScrollStateRef = useRef<{ scrollTop: number; scrollLeft: number; rowIndex: number }>({
    scrollTop: initialScrollTop || 0,
    scrollLeft: initialScrollLeft || 0,
    rowIndex: targetRowIndex || 0,
  });

  const scrollAdjustRef = useRef<{ prevScrollHeight: number; prevScrollTop: number } | null>(null);
  const hasRestoredScrollRef = useRef(false);

  useEffect(() => {
    hasRestoredScrollRef.current = false;
  }, [tabId]);

  useLayoutEffect(() => {
    if (scrollAdjustRef.current && containerRef.current) {
      const { prevScrollHeight, prevScrollTop } = scrollAdjustRef.current;
      const newScrollHeight = containerRef.current.scrollHeight;
      if (newScrollHeight > prevScrollHeight) {
        const delta = newScrollHeight - prevScrollHeight;
        containerRef.current.scrollTop = prevScrollTop + delta;
      }
      scrollAdjustRef.current = null;
    }
  }, [rows, startOffset]);

  useEffect(() => {
    return () => {
      if (debouncedScrollTimerRef.current) {
        clearTimeout(debouncedScrollTimerRef.current);
        const { scrollTop, scrollLeft, rowIndex } = latestScrollStateRef.current;
        onScrollChangeRef.current?.(scrollTop, scrollLeft, rowIndex, scrollTop % 28);
      }
    };
  }, []);

  const scrollToCell = useCallback(
    (vIdx: number, cIdx: number) => {
      rowVirtualizerRef.current?.scrollToIndex(vIdx, { align: 'auto' });
      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;

        const targetCell = container.querySelector<HTMLElement>(
          `td[data-vidx="${vIdx}"][data-cidx="${cIdx}"]`
        );
        if (!targetCell) return;

        const containerRect = container.getBoundingClientRect();
        const cellRect = targetCell.getBoundingClientRect();
        const thead = container.querySelector('thead');
        const theadHeight = thead ? thead.offsetHeight : 34;

        const targetCol = columns[cIdx];
        const isTargetFrozen = targetCol && frozenColumnSet.has(targetCol.name);

        let frozenLeftOffset = ROW_NUM_COL_WIDTH;
        if (!isTargetFrozen && frozenColumns.length > 0) {
          for (const col of columns) {
            if (frozenColumnSet.has(col.name)) {
              frozenLeftOffset += currentWidthsRef.current[col.name] || colWidths[col.name] || 120;
            }
          }
        }

        if (cellRect.top < containerRect.top + theadHeight) {
          const diff = containerRect.top + theadHeight - cellRect.top;
          container.scrollTop = Math.max(0, container.scrollTop - diff - 4);
        } else if (cellRect.bottom > containerRect.bottom) {
          const diff = cellRect.bottom - containerRect.bottom;
          container.scrollTop = container.scrollTop + diff + 4;
        }

        if (!isTargetFrozen) {
          if (cellRect.left < containerRect.left + frozenLeftOffset) {
            const diff = containerRect.left + frozenLeftOffset - cellRect.left;
            container.scrollLeft = Math.max(0, container.scrollLeft - diff - 8);
          } else if (cellRect.right > containerRect.right) {
            const diff = cellRect.right - containerRect.right;
            container.scrollLeft = container.scrollLeft + diff + 8;
          }
        }
      });
    },
    [columns, frozenColumns.length, frozenColumnSet, colWidths]
  );

  useEffect(() => {
    if (page && page !== currentPage) {
      setCurrentPage(page);
    }
  }, [page]);

  useEffect(() => {
    if (!isPageSizeOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (pageSizeMenuRef.current && !pageSizeMenuRef.current.contains(e.target as Node)) {
        setIsPageSizeOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsPageSizeOpen(false);
    };
    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPageSizeOpen]);

  useEffect(() => {
    if (pageSize && pageSize !== localPageSize) {
      setLocalPageSize(pageSize);
    }
  }, [pageSize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        const multiplier = e.deltaMode === 1 ? 24 : 1;
        const delta = (e.deltaY !== 0 ? e.deltaY : -e.deltaX) * multiplier;
        container.scrollLeft += delta;
        return;
      }

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

  const [selectionAnchor, setSelectionAnchor] = useState<{ r: number; c: number } | null>(null);
  const [selectionFocus, setSelectionFocus] = useState<{ r: number; c: number } | null>(null);
  const [additionalSelections, setAdditionalSelections] = useState<CellRect[]>([]);
  const isDraggingRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    vIdx: null,
    cIdx: null,
  });
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const isRightPanelOpen = useWorkbenchStore((state) => state.isRightPanelOpen);
  const activeRightSidebarTab = useWorkbenchStore((state) => state.activeRightSidebarTab);
  const setRightPanelOpen = useWorkbenchStore((state) => state.setRightPanelOpen);
  const setActiveRightSidebarTab = useWorkbenchStore((state) => state.setActiveRightSidebarTab);

  const handleToggleValuePanel = () => {
    if (!isRightPanelOpen) {
      setRightPanelOpen(true);
      setActiveRightSidebarTab('views');
    } else if (activeRightSidebarTab === 'views') {
      setRightPanelOpen(false);
    } else {
      setActiveRightSidebarTab('views');
    }
  };

  const insertedChanges = useMemo(() => {
    return Object.values(stagedChanges).filter(
      (c): c is StagedRowChange & { type: 'insert' } => c?.type === 'insert'
    );
  }, [stagedChanges]);

  const handleStartEdit = (rowIndex: number, colIndex: number, currentVal: any, initialVal?: string) => {
    if (isReadOnly) return;
    if (!isCellEditable(rowIndex, colIndex)) return;
    const col = columns[colIndex];
    if (!col) return;
    const inputType = getColumnInputType(col?.dataType);
    isFirstEditRenderRef.current = true;
    setEditingCell({ rowIndex, colIndex });
    if (initialVal !== undefined) {
      setEditVal(inputType === 'text' ? initialVal : formatToDateInputValue(currentVal, inputType));
    } else {
      setEditVal(formatToDateInputValue(currentVal, inputType));
    }
  };

  const sortedRows = useMemo(() => {
    if (onSortChange || localSortConfigs.length === 0) return rows;

    return [...rows].sort((rowA, rowB) => {
      for (const sortItem of localSortConfigs) {
        const colIdx = colIndexMap.get(sortItem.column);
        if (colIdx === undefined) continue;

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
  }, [rows, localSortConfigs, onSortChange, columns, colIndexMap]);

  const isMultiPageInMemory = sortedRows.length > localPageSize;
  const displayedRows = isMultiPageInMemory
    ? sortedRows.slice((currentPage - 1) * localPageSize, currentPage * localPageSize)
    : sortedRows;

  const visualRows = useMemo<VisualRow[]>(() => {
    const list: VisualRow[] = [];

    displayedRows.forEach((row, rIdx) => {
      const globalRowIndex = (currentPage - 1) * localPageSize + rIdx;
      list.push({
        vIdx: list.length,
        rowId: globalRowIndex,
        isInsert: false,
        rowData: row,
        globalRowIndex,
      });
    });

    insertedChanges.forEach((change) => {
      list.push({
        vIdx: list.length,
        rowId: change.rowIndex,
        isInsert: true,
        insertChange: change,
      });
    });

    return list;
  }, [displayedRows, insertedChanges, currentPage, localPageSize]);

  const rowVirtualizer = useVirtualizer({
    count: visualRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });
  rowVirtualizerRef.current = rowVirtualizer;

  const { frozenColIndices, scrollableColIndices } = useMemo(() => {
    const frozen: number[] = [];
    const scrollable: number[] = [];
    columns.forEach((col, idx) => {
      if (frozenColumnSet.has(col.name)) {
        frozen.push(idx);
      } else {
        scrollable.push(idx);
      }
    });
    return { frozenColIndices: frozen, scrollableColIndices: scrollable };
  }, [columns, frozenColumnSet]);

  const isColVirtualized = scrollableColIndices.length > 30;
  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: isColVirtualized ? scrollableColIndices.length : 0,
    getScrollElement: () => containerRef.current,
    estimateSize: (i) => {
      const cIdx = scrollableColIndices[i];
      const col = columns[cIdx];
      return (col && colWidths[col.name]) || 120;
    },
    overscan: 6,
  });

  useEffect(() => {
    if (isColVirtualized) {
      colVirtualizer.measure();
    }
  }, [isColVirtualized, colWidths, colVirtualizer]);

  const virtualCols = isColVirtualized ? colVirtualizer.getVirtualItems() : null;
  const firstVColIdx = virtualCols && virtualCols.length > 0 ? virtualCols[0].index : -1;
  const lastVColIdx = virtualCols && virtualCols.length > 0 ? virtualCols[virtualCols.length - 1].index : -1;
  const leftColSpacerWidth = virtualCols && virtualCols.length > 0 ? virtualCols[0].start : 0;
  const rightColSpacerWidth =
    virtualCols && virtualCols.length > 0
      ? Math.max(0, colVirtualizer.getTotalSize() - virtualCols[virtualCols.length - 1].end)
      : 0;

  const visibleColIndices = useMemo(() => {
    if (!isColVirtualized || !virtualCols) {
      return undefined as number[] | undefined;
    }
    const visibleScrollable = virtualCols.map((vc) => scrollableColIndices[vc.index]);
    return [...frozenColIndices, ...visibleScrollable];
  }, [isColVirtualized, firstVColIdx, lastVColIdx, frozenColIndices, scrollableColIndices]);

  const colInputTypes = useMemo(
    () => columns.map((col) => getColumnInputType(col.dataType)),
    [columns]
  );

  const colEditableUpdate = useMemo(
    () => columns.map((col) => isColumnEditable(col.name, false)),
    [columns, isColumnEditable]
  );

  const colEditableInsert = useMemo(
    () => columns.map((col) => isColumnEditable(col.name, true)),
    [columns, isColumnEditable]
  );

  const sortMap = useMemo(() => {
    const map = new Map<string, { index: number; direction: 'asc' | 'desc' }>();
    localSortConfigs.forEach((s, idx) => map.set(s.column, { index: idx, direction: s.direction }));
    return map;
  }, [localSortConfigs]);

  const handleAddRow = () => {
    if (isReadOnly) return;
    const newRowId = -Date.now();
    stageRowInsert(tabId, newRowId);
    const newRowVIdx = displayedRows.length + insertedChanges.length;
    setAdditionalSelections([]);
    setSelectionAnchor({ r: newRowVIdx, c: 0 });
    setSelectionFocus({ r: newRowVIdx, c: columns.length > 0 ? columns.length - 1 : 0 });

    setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }, 20);

    const firstColIdx = columns.findIndex((c) => !c.isAutoIncrement && isColumnEditable(c.name, true));
    const targetColIdx = firstColIdx !== -1 ? firstColIdx : 0;
    if (columns.length > 0 && targetColIdx !== -1) {
      setTimeout(() => {
        handleStartEdit(newRowId, targetColIdx, '');
      }, 50);
    }
  };

  const openUpdateQueryInTab = (rowIndex: number, colName: string, newVal: any) => {
    const rowInArray = rowIndex >= (startOffset || 0) ? rowIndex - (startOffset || 0) : rowIndex;
    const targetRow = rows[rowInArray] || rows[rowIndex];
    const sql = buildUpdateSql({ driver, tableName, columns, primaryKeys, targetRow, colName, newVal });
    const cleanTable = tableName || 'table';
    const consoleTitle = `update_${cleanTable}.sql`;

    const workbenchStore = useWorkbenchStore.getState();
    const currentTab = workbenchStore.tabs.find((t) => t.id === tabId);
    const connId = currentTab?.connectionId || '';
    const db = currentTab?.database || '';
    const sch = currentTab?.schema || '';

    const existingTab = workbenchStore.tabs.find(
      (t) => t.type === 'worksheet' && t.title === consoleTitle
    );

    if (existingTab) {
      workbenchStore.updateTabContent(existingTab.id, sql);
      workbenchStore.setActiveTabId(existingTab.id);
    } else {
      workbenchStore.createConsole(connId, db, sch, consoleTitle, sql);
    }

    useAlertStore.getState().showToast({
      type: 'info',
      message: `UPDATE query ready in [${consoleTitle}]. Press Ctrl+Enter to execute.`,
    });
  };

  const handleFinishEdit = () => {
    if (!editingCell) return;
    const { rowIndex, colIndex } = editingCell;
    const col = columns[colIndex];
    if (!col) {
      setEditingCell(null);
      return;
    }

    const inputType = getColumnInputType(col.dataType);
    const finalVal = normalizeDateCommitValue(editVal, inputType);

    if (rowIndex < 0) {
      stageCellUpdate(tabId, rowIndex, {}, {}, col.name, finalVal);
    } else {
      const rowInArray = rowIndex >= (startOffset || 0) ? rowIndex - (startOffset || 0) : rowIndex;
      const targetRow = rows[rowInArray] || rows[rowIndex];
      const { originalRowValues, pkMap } = buildRowMetaMaps(targetRow);
      stageCellUpdate(tabId, rowIndex, pkMap, originalRowValues, col.name, finalVal);
    }
    setEditingCell(null);
  };

  const handleTabNextFromEditor = (vIdx: number, cIdx: number) => {
    handleFinishEdit();
    let nextCol = (cIdx + 1) % columns.length;
    let nextVIdx = nextCol === 0 ? Math.min(visualRows.length - 1, vIdx + 1) : vIdx;
    let attempts = 0;
    while (attempts < columns.length * 2) {
      const targetVr = visualRows[nextVIdx];
      if (targetVr && isCellEditable(targetVr.rowId, nextCol)) {
        break;
      }
      nextCol = (nextCol + 1) % columns.length;
      if (nextCol === 0) {
        nextVIdx = Math.min(visualRows.length - 1, nextVIdx + 1);
      }
      attempts++;
    }
    const nextVr = visualRows[nextVIdx];
    setAdditionalSelections([]);
    setSelectionAnchor({ r: nextVIdx, c: nextCol });
    setSelectionFocus({ r: nextVIdx, c: nextCol });
    scrollToCell(nextVIdx, nextCol);
    setTimeout(() => {
      if (nextVr) {
        const nextColMeta = columns[nextCol];
        let nextVal: any;
        if (nextVr.isInsert) {
          nextVal = nextVr.insertChange?.changes[nextColMeta.name] ?? (nextColMeta.defaultValue ?? '');
        } else {
          const stagedNext = stagedChanges[nextVr.globalRowIndex!];
          nextVal =
            stagedNext?.type === 'update' && stagedNext.changes[nextColMeta.name] !== undefined
              ? stagedNext.changes[nextColMeta.name]
              : nextVr.rowData?.[nextCol];
        }
        handleStartEdit(nextVr.rowId, nextCol, nextVal ?? '');
      }
    }, 10);
  };

  const handleApplyChanges = () => {
    if (editingCell) {
      handleFinishEdit();
    }
    const currentStaged = useGridEditStore.getState().stagedByTab[tabId] || {};
    if (Object.keys(currentStaged).length > 0 && onSubmitChanges) {
      onSubmitChanges();
    }
  };

  const selectionRange = useMemo<CellRect | null>(() => {
    if (!selectionAnchor || !selectionFocus) return null;
    return {
      startR: Math.min(selectionAnchor.r, selectionFocus.r),
      endR: Math.max(selectionAnchor.r, selectionFocus.r),
      startC: Math.min(selectionAnchor.c, selectionFocus.c),
      endC: Math.max(selectionAnchor.c, selectionFocus.c),
    };
  }, [selectionAnchor, selectionFocus]);

  const allSelectionRanges = useMemo<CellRect[]>(() => {
    if (!selectionRange) return additionalSelections;
    return [...additionalSelections, selectionRange];
  }, [additionalSelections, selectionRange]);

  const isCellSelected = useCallback(
    (vIdx: number, cIdx: number) => {
      if (allSelectionRanges.length === 0) return false;
      return allSelectionRanges.some(
        (rng) => vIdx >= rng.startR && vIdx <= rng.endR && cIdx >= rng.startC && cIdx <= rng.endC
      );
    },
    [allSelectionRanges]
  );

  const isRowFullySelected = useCallback(
    (vIdx: number) => {
      if (columns.length === 0 || allSelectionRanges.length === 0) return false;
      return allSelectionRanges.some(
        (rng) => vIdx >= rng.startR && vIdx <= rng.endR && rng.startC === 0 && rng.endC === columns.length - 1
      );
    },
    [columns.length, allSelectionRanges]
  );

  const removeRowFromRects = (rects: CellRect[], targetR: number): CellRect[] => {
    const result: CellRect[] = [];
    for (const rect of rects) {
      if (targetR < rect.startR || targetR > rect.endR) {
        result.push(rect);
      } else {
        if (targetR > rect.startR) result.push({ ...rect, endR: targetR - 1 });
        if (targetR < rect.endR) result.push({ ...rect, startR: targetR + 1 });
      }
    }
    return result;
  };

  const removeCellFromRects = (rects: CellRect[], targetR: number, targetC: number): CellRect[] => {
    const result: CellRect[] = [];
    for (const rect of rects) {
      if (targetR < rect.startR || targetR > rect.endR || targetC < rect.startC || targetC > rect.endC) {
        result.push(rect);
      } else {
        if (targetR > rect.startR) {
          result.push({ startR: rect.startR, endR: targetR - 1, startC: rect.startC, endC: rect.endC });
        }
        if (targetR < rect.endR) {
          result.push({ startR: targetR + 1, endR: rect.endR, startC: rect.startC, endC: rect.endC });
        }
        if (targetC > rect.startC) {
          result.push({ startR: targetR, endR: targetR, startC: rect.startC, endC: targetC - 1 });
        }
        if (targetC < rect.endC) {
          result.push({ startR: targetR, endR: targetR, startC: targetC + 1, endC: rect.endC });
        }
      }
    }
    return result;
  };

  const applyRemainingRects = (remaining: CellRect[]) => {
    if (remaining.length === 0) {
      setAdditionalSelections([]);
      setSelectionAnchor(null);
      setSelectionFocus(null);
    } else {
      const last = remaining[remaining.length - 1];
      setAdditionalSelections(remaining.slice(0, -1));
      setSelectionAnchor({ r: last.startR, c: last.startC });
      setSelectionFocus({ r: last.endR, c: last.endC });
    }
  };

  const selectionSummary = useMemo(() => {
    if (allSelectionRanges.length === 0) return undefined;
    if (allSelectionRanges.length === 1) {
      const r = allSelectionRanges[0];
      return `${r.endR - r.startR + 1}r × ${r.endC - r.startC + 1}c`;
    }
    const rSet = new Set<number>();
    const cSet = new Set<number>();
    allSelectionRanges.forEach((rng) => {
      for (let r = rng.startR; r <= rng.endR; r++) rSet.add(r);
      for (let c = rng.startC; c <= rng.endC; c++) cSet.add(c);
    });
    return `${rSet.size}r × ${cSet.size}c`;
  }, [allSelectionRanges]);

  useEffect(() => {
    if (!hasRestoredScrollRef.current && containerRef.current && displayedRows.length > 0) {
      const st = initialScrollTop;
      const sl = initialScrollLeft;

      const applyScrollAndSelection = () => {
        if (!containerRef.current) return;

        if (st !== undefined && st > 0) containerRef.current.scrollTop = st;
        if (sl !== undefined && sl > 0) containerRef.current.scrollLeft = sl;

        if (targetRowIndex !== undefined && targetRowIndex >= 0) {
          const matchIdx = visualRows.findIndex((vr) => vr.globalRowIndex === targetRowIndex);
          if (matchIdx !== -1) {
            setAdditionalSelections([]);
            setSelectionAnchor({ r: matchIdx, c: 0 });
            setSelectionFocus({ r: matchIdx, c: Math.min(columns.length - 1, 1) });
            if (st === undefined || st === 0) {
              scrollToCell(matchIdx, 0);
            }
          }
        }
      };

      applyScrollAndSelection();
      requestAnimationFrame(applyScrollAndSelection);
      hasRestoredScrollRef.current = true;
    }
  }, [tabId, displayedRows.length, targetRowIndex, initialScrollTop, initialScrollLeft]);

  const selectedRowKeys = useMemo(() => {
    if (allSelectionRanges.length === 0) return new Set<number>();
    const set = new Set<number>();
    allSelectionRanges.forEach((rng) => {
      for (let r = rng.startR; r <= rng.endR; r++) {
        const vr = visualRows[r];
        if (vr) set.add(vr.rowId);
      }
    });
    return set;
  }, [allSelectionRanges, visualRows]);

  const selectedRowIndex = useMemo(() => {
    if (!selectionFocus) return null;
    return visualRows[selectionFocus.r]?.rowId ?? null;
  }, [selectionFocus, visualRows]);

  const activeFocusedCell = useMemo(() => {
    let r = selectionFocus?.r;
    let c = selectionFocus?.c;

    if ((r === undefined || c === undefined) && contextMenu.vIdx !== null && contextMenu.cIdx !== null) {
      r = contextMenu.vIdx;
      c = contextMenu.cIdx;
    }

    if (r === undefined || c === undefined) {
      if (visualRows.length > 0 && columns.length > 0) {
        r = 0;
        c = 0;
      } else {
        return null;
      }
    }

    const vr = visualRows[r];
    const col = columns[c];
    if (!vr || !col) return null;

    let rawVal: any;
    if (vr.isInsert) {
      const staged = vr.insertChange;
      rawVal =
        staged?.changes[col.name] !== undefined
          ? staged.changes[col.name]
          : (columns[c]?.defaultValue ?? null);
    } else {
      const staged = stagedChanges[vr.globalRowIndex!];
      rawVal =
        staged?.type === 'update' && staged.changes[col.name] !== undefined
          ? staged.changes[col.name]
          : vr.rowData?.[c];
    }

    return {
      rawValue: rawVal,
      columnName: col.name,
      columnType: col.dataType,
      rowIndex: r,
      columnIndex: c,
    };
  }, [selectionFocus, contextMenu.vIdx, contextMenu.cIdx, visualRows, columns, stagedChanges]);

  const handleUpdateCellFromValueViewer = (newVal: any) => {
    if (!activeFocusedCell) return;
    const { rowIndex: vIdx, columnIndex: cIdx } = activeFocusedCell;
    const vr = visualRows[vIdx];
    const col = columns[cIdx];
    if (!vr || !col || !isCellEditable(vr.rowId, cIdx)) return;

    if (vr.isInsert) {
      stageCellUpdate(tabId, vr.rowId, {}, {}, col.name, newVal);
    } else {
      const gRowIndex = vr.globalRowIndex!;
      const targetRow = vr.rowData || getRowByGlobalIndex(gRowIndex);
      const { originalRowValues, pkMap } = buildRowMetaMaps(targetRow);
      stageCellUpdate(tabId, gRowIndex, pkMap, originalRowValues, col.name, newVal);
    }
  };

  const handleUpdateRef = useRef(handleUpdateCellFromValueViewer);
  handleUpdateRef.current = handleUpdateCellFromValueViewer;

  const prevCellRef = useRef<{
    tabId: string;
    r?: number;
    c?: number;
    colName?: string;
    rawValue: any;
  } | null>(null);

  useEffect(() => {
    if (!activeFocusedCell) return;

    const prev = prevCellRef.current;
    if (
      prev &&
      prev.tabId === tabId &&
      prev.r === activeFocusedCell.rowIndex &&
      prev.c === activeFocusedCell.columnIndex &&
      prev.colName === activeFocusedCell.columnName &&
      Object.is(prev.rawValue, activeFocusedCell.rawValue)
    ) {
      return;
    }

    prevCellRef.current = {
      tabId,
      r: activeFocusedCell.rowIndex,
      c: activeFocusedCell.columnIndex,
      colName: activeFocusedCell.columnName,
      rawValue: activeFocusedCell.rawValue,
    };

    const focusedVr = visualRows[activeFocusedCell.rowIndex];
    const isFocusedEditable = focusedVr ? isCellEditable(focusedVr.rowId, activeFocusedCell.columnIndex) : false;

    useWorkbenchStore.getState().setActiveCellViewer({
      tabId,
      tableName,
      columnName: activeFocusedCell.columnName,
      columnType: activeFocusedCell.columnType,
      rowIndex: activeFocusedCell.rowIndex,
      columnIndex: activeFocusedCell.columnIndex,
      rawValue: activeFocusedCell.rawValue,
      onSave: isFocusedEditable ? (newVal) => handleUpdateRef.current(newVal) : undefined,
    });
  }, [
    tabId,
    tableName,
    activeFocusedCell?.rowIndex,
    activeFocusedCell?.columnIndex,
    activeFocusedCell?.columnName,
    activeFocusedCell?.columnType,
    activeFocusedCell?.rawValue,
  ]);

  useEffect(() => {
    return () => {
      const current = useWorkbenchStore.getState().activeCellViewer;
      if (current && current.tabId === tabId) {
        useWorkbenchStore.getState().setActiveCellViewer(null);
      }
    };
  }, [tabId]);

  useEffect(() => {
    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };
    const handleClickOutside = () => {
      setContextMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
    };
    const handleKeyDownOutside = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
      }
    };
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKeyDownOutside);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDownOutside);
    };
  }, []);

  const handleCellContextMenu = (e: React.MouseEvent, vIdx: number, cIdx: number) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isCellSelected(vIdx, cIdx)) {
      setAdditionalSelections([]);
      setSelectionAnchor({ r: vIdx, c: cIdx });
      setSelectionFocus({ r: vIdx, c: cIdx });
    }
    const targetVr = visualRows[vIdx];
    if (targetVr && targetVr.globalRowIndex !== undefined) {
      onActiveRowChange?.(targetVr.globalRowIndex);
    }

    const x = Math.min(e.clientX, window.innerWidth - 220 - 10);
    const y = Math.min(e.clientY, window.innerHeight - 340 - 10);
    setContextMenu({ isOpen: true, x: Math.max(10, x), y: Math.max(10, y), vIdx, cIdx });
  };

  const handleRowHeaderContextMenu = (e: React.MouseEvent, vIdx: number) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isCellSelected(vIdx, 0)) {
      setAdditionalSelections([]);
      setSelectionAnchor({ r: vIdx, c: 0 });
      setSelectionFocus({ r: vIdx, c: columns.length - 1 });
    }
    const targetVr = visualRows[vIdx];
    if (targetVr && targetVr.globalRowIndex !== undefined) {
      onActiveRowChange?.(targetVr.globalRowIndex);
    }

    const x = Math.min(e.clientX, window.innerWidth - 220 - 10);
    const y = Math.min(e.clientY, window.innerHeight - 340 - 10);
    setContextMenu({ isOpen: true, x: Math.max(10, x), y: Math.max(10, y), vIdx, cIdx: 0 });
  };

  const handleColHeaderContextMenu = (e: React.MouseEvent, cIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    handleColMouseLeave();

    const x = Math.min(e.clientX, window.innerWidth - 240 - 10);
    const y = Math.min(e.clientY, window.innerHeight - 280 - 10);
    setContextMenu({ isOpen: true, x: Math.max(10, x), y: Math.max(10, y), vIdx: null, cIdx });
  };

  const getFormattedCopyText = (fmt?: CopyFormat) => {
    const targetFormat = fmt || useSettingsStore.getState().copyFormat || copyFormat || 'csv';
    return formatSelectedCells({
      targetFormat,
      allSelectionRanges,
      columns,
      visualRows,
      stagedChanges,
      primaryKeys,
      tableName,
      driver,
      isCellSelected,
    });
  };

  const handleSetSelectedToNull = (targetVIdx?: number | null, targetCIdx?: number | null) => {
    let ranges: CellRect[] = allSelectionRanges;
    if (ranges.length === 0) {
      if (targetVIdx !== null && targetVIdx !== undefined && targetCIdx !== null && targetCIdx !== undefined) {
        ranges = [{ startR: targetVIdx, endR: targetVIdx, startC: targetCIdx, endC: targetCIdx }];
      } else {
        return;
      }
    }

    for (const rng of ranges) {
      for (let r = rng.startR; r <= rng.endR; r++) {
        const vr = visualRows[r];
        if (!vr) continue;
        for (let c = rng.startC; c <= rng.endC; c++) {
          const col = columns[c];
          if (!col || col.isPrimaryKey || col.isAutoIncrement || !isCellEditable(vr.rowId, c)) continue;
          if (vr.isInsert) {
            stageCellUpdate(tabId, vr.rowId, {}, {}, col.name, null);
          } else {
            const rowInArray =
              vr.globalRowIndex !== undefined && vr.globalRowIndex >= (startOffset || 0)
                ? vr.globalRowIndex - (startOffset || 0)
                : (vr.globalRowIndex ?? 0);
            const targetRow = vr.rowData || rows[rowInArray];
            const { originalRowValues, pkMap } = buildRowMetaMaps(targetRow);
            stageCellUpdate(tabId, vr.globalRowIndex!, pkMap, originalRowValues, col.name, null);
          }
        }
      }
    }
  };

  const handlePasteData = (text: string) => {
    if (!text || columns.length === 0) return;
    if (isReadOnly) {
      alertWarning('Cannot paste: this connection or table is in Read-Only mode.', 'Read-Only Mode');
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;

    let parsedRows: (string | null)[][] = [];
    let detectedHeaders: string[] | undefined;

    const sqlInsertResult = tryParseSqlInsert(trimmed);
    if (sqlInsertResult) {
      parsedRows = sqlInsertResult.rows;
      detectedHeaders = sqlInsertResult.headers;
    }

    if (parsedRows.length === 0) {
      const sqlUpdateResult = tryParseSqlUpdate(trimmed);
      if (sqlUpdateResult) {
        parsedRows = sqlUpdateResult.rows;
        detectedHeaders = sqlUpdateResult.headers;
      }
    }

    if (parsedRows.length === 0) {
      const jsonResult = tryParseJson(trimmed);
      if (jsonResult) {
        parsedRows = jsonResult.rows;
        detectedHeaders = jsonResult.headers;
      }
    }

    if (parsedRows.length === 0) {
      const rawLines = trimmed.split(/\r?\n/).filter((l) => l.length > 0);
      if (rawLines.length === 0) return;

      const isTsv = rawLines.some((l) => l.includes('\t'));
      if (isTsv) {
        parsedRows = rawLines.map((line) =>
          line.split('\t').map((c) => {
            const t = c.trim();
            return t === 'NULL' || t === '<null>' ? null : c;
          })
        );
      } else {
        parsedRows = rawLines.map((line) => {
          const cells: string[] = [];
          let inQuotes = false;
          let curr = '';
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
              if (inQuotes && line[i + 1] === '"') {
                curr += '"';
                i++;
              } else {
                inQuotes = !inQuotes;
              }
            } else if (ch === ',' && !inQuotes) {
              cells.push(curr);
              curr = '';
            } else {
              curr += ch;
            }
          }
          cells.push(curr);
          return cells.map((c) => {
            const t = c.trim();
            return t === 'NULL' || t === '<null>' ? null : c;
          });
        });
      }
    }

    if (parsedRows.length === 0) {
      alertWarning('Clipboard content could not be parsed into grid cells.', 'Paste Warning');
      return;
    }

    if (!detectedHeaders && parsedRows.length > 1) {
      const firstRow = parsedRows[0];
      const matchesHeader =
        firstRow.length > 0 &&
        firstRow.every((c) => c && columns.some((col) => col.name.toLowerCase() === c.trim().toLowerCase()));
      if (matchesHeader) {
        detectedHeaders = firstRow.map((c) => c || '');
        parsedRows = parsedRows.slice(1);
      }
    }

    const startR = selectionRange ? selectionRange.startR : selectionAnchor ? selectionAnchor.r : 0;
    const endR = selectionRange ? selectionRange.endR : startR;
    const startC = selectionRange ? selectionRange.startC : selectionAnchor ? selectionAnchor.c : 0;
    const endC = selectionRange ? selectionRange.endC : startC;

    const selRowCount = Math.max(1, endR - startR + 1);
    const selColCount = Math.max(1, endC - startC + 1);
    const hasMultiSelect = Boolean(
      selectionRange && (selectionRange.endR > selectionRange.startR || selectionRange.endC > selectionRange.startC)
    );

    let rowsToPaste: (string | null)[][] = parsedRows;

    if (hasMultiSelect) {
      const srcRowCount = parsedRows.length;
      const srcColCount = parsedRows[0]?.length || 0;

      if (srcRowCount === 1 && srcColCount === 1) {
        const singleVal = parsedRows[0][0];
        rowsToPaste = Array.from({ length: selRowCount }, () =>
          Array.from({ length: selColCount }, () => singleVal)
        );
      } else if (srcRowCount === 1 && selRowCount > 1) {
        const templateRow = parsedRows[0];
        if (selColCount > templateRow.length && templateRow.length === 1) {
          const singleVal = templateRow[0];
          rowsToPaste = Array.from({ length: selRowCount }, () =>
            Array.from({ length: selColCount }, () => singleVal)
          );
        } else {
          rowsToPaste = Array.from({ length: selRowCount }, () => [...templateRow]);
        }
      } else if (selRowCount > srcRowCount) {
        rowsToPaste = Array.from({ length: selRowCount }, (_, rIdx) => {
          const srcRow = parsedRows[rIdx % srcRowCount];
          if (selColCount > srcRow.length && srcRow.length === 1) {
            return Array.from({ length: selColCount }, () => srcRow[0]);
          }
          return [...srcRow];
        });
      }
    }

    const baseInsertId = Date.now();
    let maxAffectedVIdx = startR;
    let maxAffectedCIdx = startC;

    rowsToPaste.forEach((rowVals, rOffset) => {
      const targetVIdx = startR + rOffset;
      maxAffectedVIdx = Math.max(maxAffectedVIdx, targetVIdx);

      const targetColMap: Array<{ colIdx: number; col: typeof columns[0]; val: string | null }> = [];
      let mappedByHeader = false;

      if (!hasMultiSelect && detectedHeaders && detectedHeaders.length > 1) {
        const matchingCols = detectedHeaders.filter((h) =>
          columns.some((col) => col.name.toLowerCase() === h.toLowerCase())
        );
        if (matchingCols.length > 0) {
          detectedHeaders.forEach((h, hIdx) => {
            const colIdx = columns.findIndex((col) => col.name.toLowerCase() === h.toLowerCase());
            if (colIdx !== -1) {
              targetColMap.push({ colIdx, col: columns[colIdx], val: rowVals[hIdx] ?? null });
            }
          });
          mappedByHeader = targetColMap.length > 0;
        }
      }

      if (!mappedByHeader) {
        rowVals.forEach((val, cOffset) => {
          const colIdx = startC + cOffset;
          if (colIdx < columns.length) {
            targetColMap.push({ colIdx, col: columns[colIdx], val });
          }
        });
      }

      if (targetColMap.length === 0) return;
      targetColMap.forEach(({ colIdx }) => {
        maxAffectedCIdx = Math.max(maxAffectedCIdx, colIdx);
      });

      if (targetVIdx < visualRows.length) {
        const vr = visualRows[targetVIdx];
        if (vr.isInsert) {
          targetColMap.forEach(({ col, val }) => {
            if (col.isAutoIncrement || !isColumnEditable(col.name, true)) return;
            stageCellUpdate(tabId, vr.rowId, {}, {}, col.name, cleanPastedValue(val, col.dataType));
          });
        } else {
          const targetRow = vr.rowData || getRowByGlobalIndex(vr.globalRowIndex!);
          const { originalRowValues, pkMap } = buildRowMetaMaps(targetRow);
          targetColMap.forEach(({ col, val }) => {
            if (col.isAutoIncrement || !isColumnEditable(col.name, false)) return;
            stageCellUpdate(
              tabId,
              vr.globalRowIndex!,
              pkMap,
              originalRowValues,
              col.name,
              cleanPastedValue(val, col.dataType)
            );
          });
        }
      } else {
        const newRowId = -(baseInsertId + (targetVIdx - visualRows.length));
        const initialValues: Record<string, unknown> = {};
        targetColMap.forEach(({ col, val }) => {
          if (col.isAutoIncrement || !isColumnEditable(col.name, true)) return;
          initialValues[col.name] = cleanPastedValue(val, col.dataType);
        });
        stageRowInsert(tabId, newRowId, initialValues);
      }
    });

    setAdditionalSelections([]);
    setSelectionAnchor({ r: startR, c: startC });
    setSelectionFocus({ r: maxAffectedVIdx, c: Math.min(columns.length - 1, maxAffectedCIdx) });
  };

  const handleCellMouseDown = (e: React.MouseEvent, vIdx: number, cIdx: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    if (editingCell) handleFinishEdit();
    containerRef.current?.focus({ preventScroll: true });

    const isMod = e.ctrlKey || e.metaKey;

    if (e.shiftKey && selectionAnchor) {
      window.getSelection()?.removeAllRanges();
      if (!isMod) setAdditionalSelections([]);
      setSelectionFocus({ r: vIdx, c: cIdx });
    } else if (isMod) {
      window.getSelection()?.removeAllRanges();
      if (isCellSelected(vIdx, cIdx)) {
        applyRemainingRects(removeCellFromRects(allSelectionRanges, vIdx, cIdx));
        isDraggingRef.current = false;
      } else {
        if (selectionRange) setAdditionalSelections((prev) => [...prev, selectionRange]);
        isDraggingRef.current = true;
        setSelectionAnchor({ r: vIdx, c: cIdx });
        setSelectionFocus({ r: vIdx, c: cIdx });
      }
    } else {
      setAdditionalSelections([]);
      isDraggingRef.current = true;
      setSelectionAnchor({ r: vIdx, c: cIdx });
      setSelectionFocus({ r: vIdx, c: cIdx });
    }

    const vr = visualRows[vIdx];
    if (vr && vr.globalRowIndex !== undefined) {
      onActiveRowChange?.(vr.globalRowIndex);
    }
  };

  const handleCellMouseEnter = (vIdx: number, cIdx: number) => {
    if (isDraggingRef.current) {
      setSelectionFocus({ r: vIdx, c: cIdx });
    }
  };

  const handleRowHeaderMouseDown = (e: React.MouseEvent, vIdx: number) => {
    if (e.button !== 0) return;
    if (editingCell) handleFinishEdit();
    containerRef.current?.focus({ preventScroll: true });

    const isMod = e.ctrlKey || e.metaKey;
    const lastColIdx = Math.max(0, columns.length - 1);

    if (e.shiftKey && selectionAnchor) {
      window.getSelection()?.removeAllRanges();
      if (!isMod) setAdditionalSelections([]);
      setSelectionAnchor({ r: selectionAnchor.r, c: 0 });
      setSelectionFocus({ r: vIdx, c: lastColIdx });
    } else if (isMod) {
      window.getSelection()?.removeAllRanges();
      if (isRowFullySelected(vIdx)) {
        applyRemainingRects(removeRowFromRects(allSelectionRanges, vIdx));
        isDraggingRef.current = false;
      } else {
        if (selectionRange) setAdditionalSelections((prev) => [...prev, selectionRange]);
        isDraggingRef.current = true;
        setSelectionAnchor({ r: vIdx, c: 0 });
        setSelectionFocus({ r: vIdx, c: lastColIdx });
      }
    } else {
      setAdditionalSelections([]);
      isDraggingRef.current = true;
      setSelectionAnchor({ r: vIdx, c: 0 });
      setSelectionFocus({ r: vIdx, c: lastColIdx });
    }

    const vr = visualRows[vIdx];
    if (vr && vr.globalRowIndex !== undefined) {
      onActiveRowChange?.(vr.globalRowIndex);
    }
  };

  const handleRowHeaderMouseEnter = (vIdx: number) => {
    if (isDraggingRef.current) {
      setSelectionFocus((prev) => (prev ? { r: vIdx, c: prev.c } : { r: vIdx, c: columns.length - 1 }));
    }
  };

  const handleDuplicateRow = () => {
    if (isReadOnly) return;
    if (editingCell) handleFinishEdit();

    const targets =
      selectedRowKeys.size > 0
        ? Array.from(selectedRowKeys).sort((x, y) => (x < 0 && y < 0 ? y - x : x < 0 ? 1 : y < 0 ? -1 : x - y))
        : visualRows.length > 0
        ? [visualRows[0].rowId]
        : [];

    if (targets.length === 0) return;

    const latestStaged = useGridEditStore.getState().stagedByTab[tabId] || {};

    const buildValues = (targetRowIndex: number) => {
      const initialValues: Record<string, unknown> = {};
      if (targetRowIndex < 0) {
        const staged = latestStaged[targetRowIndex];
        if (staged && staged.type === 'insert') {
          columns.forEach((col) => {
            if (!col.isAutoIncrement && isColumnEditable(col.name, true) && staged.changes[col.name] !== undefined) {
              const rawVal = staged.changes[col.name];
              if (rawVal !== undefined && rawVal !== null) {
                initialValues[col.name] = cleanPastedValue(rawVal, col.dataType);
              }
            }
          });
        }
      } else {
        const sourceRow = getRowByGlobalIndex(targetRowIndex);
        if (sourceRow) {
          const staged = latestStaged[targetRowIndex];
          columns.forEach((col, idx) => {
            if (!col.isAutoIncrement && isColumnEditable(col.name, true)) {
              const rawVal =
                staged?.type === 'update' && staged.changes[col.name] !== undefined
                  ? staged.changes[col.name]
                  : sourceRow[idx];
              if (rawVal !== undefined && rawVal !== null) {
                initialValues[col.name] = cleanPastedValue(rawVal, col.dataType);
              }
            }
          });
        }
      }
      return initialValues;
    };

    const baseId = Date.now();
    const newIds: number[] = [];
    let lastValues: Record<string, unknown> = {};
    targets.forEach((t, i) => {
      const newRowId = -(baseId + i);
      lastValues = buildValues(t);
      stageRowInsert(tabId, newRowId, lastValues);
      newIds.push(newRowId);
    });

    const startVIdx = displayedRows.length + insertedChanges.length;
    setAdditionalSelections([]);
    setSelectionAnchor({ r: startVIdx, c: 0 });
    setSelectionFocus({ r: startVIdx + newIds.length - 1, c: columns.length - 1 });

    setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }, 20);

    if (newIds.length === 1 && columns.length > 0) {
      const firstColIdx = columns.findIndex((c) => !c.isAutoIncrement && isColumnEditable(c.name, true));
      const targetColIdx = firstColIdx !== -1 ? firstColIdx : 0;
      setTimeout(() => {
        const val = lastValues[columns[targetColIdx].name];
        handleStartEdit(newIds[0], targetColIdx, val !== undefined && val !== null ? String(val) : '');
      }, 50);
    }
  };

  const handleDeleteActiveRow = () => {
    if (isReadOnly) return;
    const rowKeysToDelete =
      selectedRowKeys.size > 0
        ? Array.from(selectedRowKeys)
        : visualRows.length > 0
        ? [visualRows[0].rowId]
        : [];

    if (rowKeysToDelete.length === 0) return;

    rowKeysToDelete.forEach((idx) => {
      if (idx < 0) {
        stageRowDelete(tabId, idx, {}, {});
        return;
      }
      const rowInArray = idx >= (startOffset || 0) ? idx - (startOffset || 0) : idx;
      const targetRow = rows[rowInArray] || rows[idx];
      const { originalRowValues, pkMap } = buildRowMetaMaps(targetRow);
      stageRowDelete(tabId, idx, pkMap, originalRowValues);
    });

    setAdditionalSelections([]);
    setSelectionAnchor(null);
    setSelectionFocus(null);
  };

  // Stable-listener pattern for global keyboard, copy, and paste shortcuts
  // Prevents re-attaching window listeners on every keystroke or selection change
  const keyDownHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyDownHandlerRef.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('.monaco-editor')) return;

    if (showCancelConfirm) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setShowCancelConfirm(false);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        revertTabChanges(tabId);
        setEditingCell(null);
        setAdditionalSelections([]);
        setSelectionAnchor(null);
        setSelectionFocus(null);
        setShowCancelConfirm(false);
        return;
      }
      return;
    }

    const isInFilterOrWhere = target?.closest?.('[data-filter-input]') || target?.closest?.('[data-where-input]');

    if (e.key === 'Escape') {
      if (isInFilterOrWhere) return;
      if (editingCell) {
        e.preventDefault();
        setEditingCell(null);
        if (stagedCount > 0) setShowCancelConfirm(true);
        return;
      }
      if (stagedCount > 0) {
        e.preventDefault();
        setShowCancelConfirm(true);
        return;
      }
    }

    const activeEl = document.activeElement;
    const isTyping =
      (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) ||
      (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA'));

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      handleToggleValuePanel();
      return;
    }

    if (!isTyping && visualRows.length > 0 && columns.length > 0) {
      const isNavKey =
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'PageUp' ||
        e.key === 'PageDown' ||
        e.key === 'Home' ||
        e.key === 'End' ||
        e.key === 'Tab';

      if (isNavKey) {
        if (e.key === 'Tab') {
          e.preventDefault();
          const currentR = selectionFocus ? selectionFocus.r : 0;
          const currentC = selectionFocus ? selectionFocus.c : 0;
          let nextR = currentR;
          let nextC = currentC + (e.shiftKey ? -1 : 1);
          if (nextC >= columns.length) {
            nextC = 0;
            nextR = Math.min(visualRows.length - 1, nextR + 1);
          } else if (nextC < 0) {
            nextC = columns.length - 1;
            nextR = Math.max(0, nextR - 1);
          }
          setAdditionalSelections([]);
          setSelectionAnchor({ r: nextR, c: nextC });
          setSelectionFocus({ r: nextR, c: nextC });
          scrollToCell(nextR, nextC);
          const targetVr = visualRows[nextR];
          if (targetVr && targetVr.globalRowIndex !== undefined) {
            onActiveRowChange?.(targetVr.globalRowIndex);
          }
          return;
        }

        e.preventDefault();
        const currentR = selectionFocus ? selectionFocus.r : 0;
        const currentC = selectionFocus ? selectionFocus.c : 0;
        let targetR = currentR;
        let targetC = currentC;

        if (e.key === 'ArrowUp') targetR -= 1;
        else if (e.key === 'ArrowDown') targetR += 1;
        else if (e.key === 'ArrowLeft') targetC -= 1;
        else if (e.key === 'ArrowRight') targetC += 1;
        else if (e.key === 'PageUp') targetR -= 15;
        else if (e.key === 'PageDown') targetR += 15;
        else if (e.key === 'Home') {
          if (e.ctrlKey || e.metaKey) {
            targetR = 0;
            targetC = 0;
          } else {
            targetC = 0;
          }
        } else if (e.key === 'End') {
          if (e.ctrlKey || e.metaKey) {
            targetR = visualRows.length - 1;
            targetC = columns.length - 1;
          } else {
            targetC = columns.length - 1;
          }
        }

        const newR = Math.max(0, Math.min(visualRows.length - 1, targetR));
        const newC = Math.max(0, Math.min(columns.length - 1, targetC));

        if (e.shiftKey && e.key.startsWith('Arrow')) {
          setSelectionFocus({ r: newR, c: newC });
        } else {
          setAdditionalSelections([]);
          setSelectionAnchor({ r: newR, c: newC });
          setSelectionFocus({ r: newR, c: newC });
        }
        scrollToCell(newR, newC);
        const navVr = visualRows[newR];
        if (navVr && navVr.globalRowIndex !== undefined) {
          onActiveRowChange?.(navVr.globalRowIndex);
        }
        return;
      }
    }

    const isMod = isMac ? e.metaKey : e.ctrlKey;

    if (!isTyping && !isMod && !e.shiftKey && e.key === 'Enter') {
      if (selectionFocus && visualRows.length > 0 && columns.length > 0 && !isReadOnly) {
        const vr = visualRows[selectionFocus.r];
        if (vr && isCellEditable(vr.rowId, selectionFocus.c)) {
          e.preventDefault();
          const col = columns[selectionFocus.c];
          let val: any;
          if (vr.isInsert) {
            val = vr.insertChange?.changes[col.name] ?? (col.defaultValue ?? '');
          } else {
            const staged = stagedChanges[vr.globalRowIndex!];
            val =
              staged?.type === 'update' && staged.changes[col.name] !== undefined
                ? staged.changes[col.name]
                : vr.rowData?.[selectionFocus.c];
          }
          handleStartEdit(vr.rowId, selectionFocus.c, val ?? '');
          return;
        }
      }
    }

    const isMacDelete = isMac && e.metaKey && (e.key === 'Backspace' || e.key === 'Delete');
    const isOtherDelete = !isMac && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Delete';

    if (!isTyping && (isMacDelete || isOtherDelete)) {
      e.preventDefault();
      handleDeleteActiveRow();
      return;
    }

    const noModalOpen =
      !isReadOnly &&
      !isExportOpen &&
      !isImportOpen &&
      !showAllSortsModal &&
      !showAllFrozenModal &&
      !isCopyAsOpen;

    if (!isTyping && !isMod && !e.altKey && e.key === 'Backspace') {
      if (selectionFocus && visualRows.length > 0 && columns.length > 0 && noModalOpen) {
        const vr = visualRows[selectionFocus.r];
        if (vr && isCellEditable(vr.rowId, selectionFocus.c) && columns[selectionFocus.c]) {
          e.preventDefault();
          handleStartEdit(vr.rowId, selectionFocus.c, '', '');
          setSelectionAnchor({ r: selectionFocus.r, c: selectionFocus.c });
          return;
        }
      }
    }

    if (!isTyping && !isMod && !e.altKey && e.key.length === 1 && selectionFocus && visualRows.length > 0 && columns.length > 0 && noModalOpen) {
      const vr = visualRows[selectionFocus.r];
      if (vr && isCellEditable(vr.rowId, selectionFocus.c) && columns[selectionFocus.c]) {
        e.preventDefault();
        handleStartEdit(vr.rowId, selectionFocus.c, '', e.key);
        setSelectionAnchor({ r: selectionFocus.r, c: selectionFocus.c });
        return;
      }
    }

    if (!isMod) return;
    if (isTyping && !target?.closest?.('[data-grid-container]')) return;

    if (e.key === 'a' || e.key === 'A') {
      if (!isTyping && visualRows.length > 0 && columns.length > 0) {
        e.preventDefault();
        setAdditionalSelections([]);
        setSelectionAnchor({ r: 0, c: 0 });
        setSelectionFocus({ r: visualRows.length - 1, c: columns.length - 1 });
        return;
      }
    }

    if (e.key === 'c' || e.key === 'C') {
      if (!isTyping && allSelectionRanges.length > 0 && columns.length > 0) {
        e.preventDefault();
        if (e.shiftKey) {
          setIsCopyAsOpen(true);
        } else {
          const text = getFormattedCopyText();
          if (text) navigator.clipboard.writeText(text);
        }
        return;
      }
    }

    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      handleApplyChanges();
      return;
    }

    if (e.key === 'v' || e.key === 'V') {
      if (!isTyping) {
        e.preventDefault();
        navigator.clipboard
          ?.readText?.()
          .then((text) => {
            if (text) handlePasteData(text);
          })
          .catch(() => {});
        return;
      }
    }

    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      handleAddRow();
      return;
    }

    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      handleDuplicateRow();
      return;
    }
  };

  const copyHandlerRef = useRef<(e: ClipboardEvent) => void>(() => {});
  copyHandlerRef.current = (e: ClipboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    if (allSelectionRanges.length > 0 && columns.length > 0) {
      const text = getFormattedCopyText();
      if (text) {
        e.preventDefault();
        e.clipboardData?.setData('text/plain', text);
      }
    }
  };

  const pasteHandlerRef = useRef<(e: ClipboardEvent) => void>(() => {});
  pasteHandlerRef.current = (e: ClipboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    const text = e.clipboardData?.getData('text/plain');
    if (text) {
      e.preventDefault();
      handlePasteData(text);
    }
  };

  useEffect(() => {
    const isGridActive = () => {
      const el = containerRef.current;
      return Boolean(el && el.offsetParent !== null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isGridActive()) return;
      keyDownHandlerRef.current(e);
    };
    const onCopy = (e: ClipboardEvent) => {
      if (!isGridActive()) return;
      copyHandlerRef.current(e);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!isGridActive()) return;
      pasteHandlerRef.current(e);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('copy', onCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  const currentOffset = (currentPage - 1) * localPageSize;
  const startRow = displayedRows.length === 0 ? 0 : currentOffset + 1;
  const endRow = currentOffset + displayedRows.length;

  const handleCountRows = async () => {
    if (!onCountRows || isCountingTotal) return;
    setIsCountingTotal(true);
    try {
      await onCountRows();
    } finally {
      setIsCountingTotal(false);
    }
  };

  const effectiveTotal =
    totalCount !== undefined && totalCount >= endRow
      ? totalCount
      : isMultiPageInMemory
      ? rows.length
      : !hasMore
      ? endRow
      : Math.max(endRow + 1, totalCount || 0);

  const isExactTotalKnown =
    (totalCount !== undefined && totalCount >= endRow) || !hasMore || isMultiPageInMemory;

  const totalPages = Math.max(1, Math.ceil(effectiveTotal / localPageSize));

  useEffect(() => {
    if (!onPageChange) {
      setCurrentPage(1);
    }
  }, [localPageSize, onPageChange]);

  // Keep latest row/cell handlers in a ref so memoized DataGridRow instances
  // never invoke stale closures over selectionRange / allSelectionRanges / editing state.
  const latestRowHandlersRef = useRef({
    handleRowHeaderMouseDown,
    handleRowHeaderMouseEnter,
    handleRowHeaderContextMenu,
    handleCellMouseDown,
    handleCellMouseEnter,
    handleCellContextMenu,
    handleStartEdit,
    handleOpenTtlModal,
    handleFinishEdit,
    handleTabNextFromEditor,
    handleCancelEdit: () => {
      setEditingCell(null);
      if (stagedCount > 0) setShowCancelConfirm(true);
    },
  });
  latestRowHandlersRef.current = {
    handleRowHeaderMouseDown,
    handleRowHeaderMouseEnter,
    handleRowHeaderContextMenu,
    handleCellMouseDown,
    handleCellMouseEnter,
    handleCellContextMenu,
    handleStartEdit,
    handleOpenTtlModal,
    handleFinishEdit,
    handleTabNextFromEditor,
    handleCancelEdit: () => {
      setEditingCell(null);
      if (stagedCount > 0) setShowCancelConfirm(true);
    },
  };

  const stableRowHeaderMouseDown = useCallback(
    (e: React.MouseEvent, vIdx: number) => latestRowHandlersRef.current.handleRowHeaderMouseDown(e, vIdx),
    []
  );
  const stableRowHeaderMouseEnter = useCallback(
    (vIdx: number) => latestRowHandlersRef.current.handleRowHeaderMouseEnter(vIdx),
    []
  );
  const stableRowHeaderContextMenu = useCallback(
    (e: React.MouseEvent, vIdx: number) => latestRowHandlersRef.current.handleRowHeaderContextMenu(e, vIdx),
    []
  );
  const stableCellMouseDown = useCallback(
    (e: React.MouseEvent, vIdx: number, cIdx: number) =>
      latestRowHandlersRef.current.handleCellMouseDown(e, vIdx, cIdx),
    []
  );
  const stableCellMouseEnter = useCallback(
    (vIdx: number, cIdx: number) => latestRowHandlersRef.current.handleCellMouseEnter(vIdx, cIdx),
    []
  );
  const stableCellContextMenu = useCallback(
    (e: React.MouseEvent, vIdx: number, cIdx: number) =>
      latestRowHandlersRef.current.handleCellContextMenu(e, vIdx, cIdx),
    []
  );
  const stableStartEdit = useCallback(
    (rowIndex: number, colIndex: number, currentVal: any) =>
      latestRowHandlersRef.current.handleStartEdit(rowIndex, colIndex, currentVal),
    []
  );
  const stableOpenTtlModal = useCallback(
    (rowIndex: number, currentDisplayVal: any, isInsert: boolean) =>
      latestRowHandlersRef.current.handleOpenTtlModal(rowIndex, currentDisplayVal, isInsert),
    []
  );
  const stableFinishEdit = useCallback(() => latestRowHandlersRef.current.handleFinishEdit(), []);
  const stableCancelEdit = useCallback(() => latestRowHandlersRef.current.handleCancelEdit(), []);
  const stableTabNextFromEditor = useCallback(
    (vIdx: number, cIdx: number) => latestRowHandlersRef.current.handleTabNextFromEditor(vIdx, cIdx),
    []
  );

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const sl = e.currentTarget.scrollLeft;
    if (sl > 0 !== isScrolledX) {
      setIsScrolledX(sl > 0);
    }
    const { scrollTop } = e.currentTarget;

    const rowHeight = 28;
    const visibleRowOffset = Math.max(0, Math.floor(scrollTop / rowHeight));
    const approxRowIndex = (startOffset || 0) + visibleRowOffset;
    const topRowOffsetPx = scrollTop % rowHeight;

    latestScrollStateRef.current = { scrollTop, scrollLeft: sl, rowIndex: approxRowIndex };

    if (onScrollChangeRef.current) {
      if (debouncedScrollTimerRef.current) clearTimeout(debouncedScrollTimerRef.current);
      debouncedScrollTimerRef.current = setTimeout(() => {
        onScrollChangeRef.current?.(scrollTop, sl, approxRowIndex, topRowOffsetPx);
      }, 200);
    }
  };

  const handleNavigatePage = (targetPage: number) => {
    const maxPage = isExactTotalKnown ? totalPages : Math.max(totalPages, targetPage);
    const clamped = Math.max(1, Math.min(targetPage, maxPage));
    setCurrentPage(clamped);
    onPageChange?.(clamped);
  };

  const handlePageSizeChange = (newSize: number) => {
    setLocalPageSize(newSize);
    setCurrentPage(1);
    onPageSizeChange?.(newSize);
  };

  const gridContainerBg =
    envType === 'prod'
      ? 'bg-[#191a20] border-[3px] border-[#7a3b3f]'
      : envType === 'dev'
      ? 'bg-[#191a20] border-[3px] border-[#2f6b52]'
      : 'bg-[#191a20]';
  const gridBarBg =
    envType === 'prod'
      ? 'bg-[#5a2d31] border-[#7a3b3f]'
      : envType === 'dev'
      ? 'bg-[#244f3d] border-[#2f6b52]'
      : 'bg-[#14151a] border-[#272932]';
  const gridTheadBg = 'bg-[#14151a]';
  const gridCellBorder = 'border-[#272932]';
  const gridRowClass = 'border-b border-[#22242c] bg-[#14151a] hover:bg-[#20222a] transition-colors';

  return (
    <div
      data-grid-container="true"
      onContextMenu={(e) => e.preventDefault()}
      className={`flex h-full flex-col ${gridContainerBg} text-xs select-text transition-colors`}
    >
      <GridToolbar
        gridBarBg={gridBarBg}
        isReadOnly={isReadOnly}
        isRedis={isRedis}
        rawSql={rawSql}
        copiedRawSql={copiedRawSql}
        stagedCount={stagedCount}
        isTableTab={isTableTab}
        hasApplyWhere={Boolean(onApplyWhere)}
        whereContainerRef={whereContainerRef}
        whereInputRef={whereInputRef}
        suggestionListRef={suggestionListRef}
        whereInput={whereInput}
        showWhereSuggestions={showWhereSuggestions}
        whereSuggestions={whereSuggestions}
        selectedSuggestionIndex={selectedSuggestionIndex}
        localSortConfigs={localSortConfigs}
        frozenColumns={frozenColumns}
        maskSensitiveData={maskSensitiveData}
        onToggleMaskSensitiveData={() => setMaskSensitiveData((prev) => !prev)}
        onOpenRedisAddKey={() => setRedisAddKeyOpen(true)}
        onAddRow={handleAddRow}
        onDeleteActiveRow={handleDeleteActiveRow}
        onCopyRawSql={handleCopyRawSql}
        onPreviewChanges={onPreviewChanges}
        onCopyDml={onCopyDml}
        onApplyChanges={handleApplyChanges}
        onRequestCancelConfirm={() => setShowCancelConfirm(true)}
        onWhereInputChange={(val, pos) => {
          setWhereInput(val);
          setWhereCursorPos(pos);
          setShowWhereSuggestions(true);
        }}
        onWhereFocus={() => setShowWhereSuggestions(true)}
        onWhereCursorChange={(pos) => setWhereCursorPos(pos)}
        onWhereKeyDown={handleWhereKeyDown}
        onClearWhere={() => {
          setWhereInput('');
          setShowWhereSuggestions(false);
          onApplyWhere?.('');
        }}
        onApplyWhereClick={applyWhereValue}
        onApplyWhereSuggestion={applyWhereSuggestion}
        onRemoveSortColumn={(colName) => {
          const next = localSortConfigs.filter((s) => s.column !== colName);
          setLocalSortConfigs(next);
          onSortChange?.(next);
        }}
        onShowAllSorts={() => setShowAllSortsModal(true)}
        onClearAllSort={handleClearAllSort}
        onToggleFreeze={handleToggleFreeze}
        onShowAllFrozen={() => setShowAllFrozenModal(true)}
        onClearAllFrozen={() => {
          setFrozenColumns([]);
          onFrozenColumnsChange?.([]);
        }}
      />

      {errorMessage && (
        <div className="flex items-center justify-between px-3.5 py-2 bg-rose-950/40 border-b border-rose-900/60 text-xs font-mono text-rose-300 select-text">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span className="truncate">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setWhereInput('');
              onApplyWhere?.('');
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-sans font-medium transition-colors shrink-0 ml-3 cursor-pointer shadow-xs"
            title="Clear WHERE filter and reload data"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset Filter</span>
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        <div
          ref={containerRef}
          tabIndex={0}
          onScroll={handleScroll}
          className="flex-1 overflow-auto min-h-0 relative outline-none focus:ring-1 focus:ring-blue-500/20 pb-12"
        >
          <table
            className="border-separate border-spacing-0 font-mono text-[12px] text-zinc-300 min-w-full"
            style={{ tableLayout: 'fixed', width: 'max-content' }}
          >
            <colgroup>
              <col style={{ width: `${ROW_NUM_COL_WIDTH}px`, minWidth: `${ROW_NUM_COL_WIDTH}px` }} />
              {leftColSpacerWidth > 0 && (
                <col style={{ width: `${leftColSpacerWidth}px`, minWidth: `${leftColSpacerWidth}px` }} />
              )}
              {(visibleColIndices ?? columns.map((_, i) => i)).map((cIdx) => {
                const col = columns[cIdx];
                if (!col) return null;
                const w = colWidths[col.name] || 120;
                return <col key={col.name} style={{ width: `${w}px`, minWidth: `${w}px` }} />;
              })}
              {rightColSpacerWidth > 0 && (
                <col style={{ width: `${rightColSpacerWidth}px`, minWidth: `${rightColSpacerWidth}px` }} />
              )}
              <col style={{ width: 'auto' }} />
            </colgroup>
            <thead className={`sticky top-0 ${gridTheadBg} shadow-sm z-30`}>
              <tr className={`border-b ${gridCellBorder}`}>
                <th
                  onClick={() => {
                    if (visualRows.length > 0 && columns.length > 0) {
                      setAdditionalSelections([]);
                      setSelectionAnchor({ r: 0, c: 0 });
                      setSelectionFocus({ r: visualRows.length - 1, c: columns.length - 1 });
                      containerRef.current?.focus({ preventScroll: true });
                    }
                  }}
                  className={`sticky left-0 z-40 px-2 py-1.5 text-center font-semibold border-r border-b ${gridCellBorder} ${gridTheadBg} text-zinc-500 hover:text-zinc-300 select-none cursor-pointer transition-colors ${
                    frozenColumns.length === 0 && isScrolledX
                      ? 'border-r-2 border-r-zinc-600/60 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.45)]'
                      : ''
                  }`}
                  style={{
                    width: `${ROW_NUM_COL_WIDTH}px`,
                    minWidth: `${ROW_NUM_COL_WIDTH}px`,
                    maxWidth: `${ROW_NUM_COL_WIDTH}px`,
                  }}
                  title="Click to select all visible rows"
                >
                  #
                </th>
                {leftColSpacerWidth > 0 && (
                  <th
                    aria-hidden="true"
                    className={`p-0 border-b ${gridCellBorder} ${gridTheadBg}`}
                    style={{ width: `${leftColSpacerWidth}px`, minWidth: `${leftColSpacerWidth}px` }}
                  />
                )}
                {(visibleColIndices ?? columns.map((_, i) => i)).map((cIdx) => {
                  const col = columns[cIdx];
                  if (!col) return null;
                  const isPK = Boolean(col.isPrimaryKey || primaryKeySet.has(col.name));
                  const sortEntry = sortMap.get(col.name);
                  const isSorted = sortEntry !== undefined;
                  const sortIndex = sortEntry ? sortEntry.index : -1;
                  const sortItem = sortEntry ?? null;
                  const isFrozen = frozenColumnSet.has(col.name);
                  const isLastFrozen = col.name === lastFrozenColName;
                  const stickyLeft = isFrozen ? frozenOffsets[col.name] : undefined;
                  const w = colWidths[col.name] || 120;
                  const isDraggingThisCol = draggedColName === col.name;
                  const isDropColBefore =
                    colDropTarget?.name === col.name && colDropTarget.pos === 'before';
                  const isDropColAfter =
                    colDropTarget?.name === col.name && colDropTarget.pos === 'after';

                  return (
                    <th
                      key={col.name}
                      ref={(el) => {
                        thRefs.current[col.name] = el;
                      }}
                      draggable={Boolean(onColumnReorder) && !resizingCol}
                      onDragStart={(e) => {
                        if (!onColumnReorder || isResizingRef.current) {
                          e.preventDefault();
                          return;
                        }
                        handleColMouseLeave();
                        setDraggedColName(col.name);
                        e.dataTransfer.effectAllowed = 'move';
                        try {
                          e.dataTransfer.setData('text/plain', col.name);
                        } catch {}
                      }}
                      onDragOver={(e) => {
                        if (!onColumnReorder || !draggedColName || draggedColName === col.name) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const pos: 'before' | 'after' =
                          e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                        if (colDropTarget?.name !== col.name || colDropTarget?.pos !== pos) {
                          setColDropTarget({ name: col.name, pos });
                        }
                      }}
                      onDragLeave={() => {
                        if (colDropTarget?.name === col.name) {
                          setColDropTarget(null);
                        }
                      }}
                      onDrop={(e) => {
                        if (!onColumnReorder || !draggedColName || draggedColName === col.name) return;
                        e.preventDefault();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const pos: 'before' | 'after' =
                          e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                        onColumnReorder(draggedColName, col.name, pos);
                        setDraggedColName(null);
                        setColDropTarget(null);
                      }}
                      onDragEnd={() => {
                        setDraggedColName(null);
                        setColDropTarget(null);
                      }}
                      onContextMenu={(e) => handleColHeaderContextMenu(e, cIdx)}
                      onClick={(e) => {
                        if (isResizingRef.current) return;
                        if (e.altKey && !isRedis) {
                          handleToggleFreeze(col.name);
                        }
                      }}
                      onMouseEnter={(e) => handleColMouseEnter(e, col, isPK)}
                      onMouseLeave={handleColMouseLeave}
                      className={`relative px-3 py-1.5 text-left font-semibold border-r border-b ${gridCellBorder} text-zinc-200 group/th select-none ${
                        isFrozen ? `sticky z-40 ${gridTheadBg}` : gridTheadBg
                      } ${
                        isLastFrozen && isScrolledX
                          ? 'border-r-2 border-r-cyan-500/50 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.5)]'
                          : ''
                      } ${
                        isDraggingThisCol ? 'opacity-40' : ''
                      } ${
                        isDropColBefore
                          ? 'border-l-2 border-l-blue-400'
                          : isDropColAfter
                          ? 'border-r-2 border-r-blue-400'
                          : ''
                      } ${
                        envType === 'prod'
                          ? 'hover:bg-rose-950'
                          : envType === 'dev'
                          ? 'hover:bg-emerald-950'
                          : 'hover:bg-[#1c1d28]'
                      } transition-colors`}
                      style={{
                        width: `${w}px`,
                        minWidth: `${w}px`,
                        maxWidth: `${w}px`,
                        ...(isFrozen && stickyLeft !== undefined ? { left: stickyLeft } : {}),
                      }}
                    >
                      <div className="flex items-center justify-between gap-1.5 min-w-0">
                        <div className="flex items-center gap-1.5 truncate min-w-0 flex-1">
                          {isPK && <Key className="h-3 w-3 text-amber-400 fill-amber-400/30 shrink-0" />}
                          {isRedis && !isColumnEditable(col.name) && (
                            <span title="Read-only column">
                              <Lock className="h-2.5 w-2.5 text-zinc-500 shrink-0" />
                            </span>
                          )}
                          <span
                            className={`truncate font-semibold transition-colors ${
                              isRedis && !isColumnEditable(col.name)
                                ? 'text-zinc-400 group-hover/th:text-zinc-200'
                                : 'text-zinc-200 group-hover/th:text-white'
                            }`}
                          >
                            {col.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {!isRedis && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleFreeze(col.name);
                              }}
                              className={`flex items-center p-1 rounded transition-all cursor-pointer ${
                                isFrozen
                                  ? 'text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 shadow-xs'
                                  : 'text-zinc-500 opacity-0 group-hover/th:opacity-100 hover:text-cyan-300 hover:bg-zinc-800'
                              }`}
                              title={
                                isFrozen
                                  ? `Unfreeze column "${col.name}"`
                                  : `Freeze column "${col.name}" (Alt+Click header)`
                              }
                            >
                              <Snowflake className={`h-3 w-3 ${isFrozen ? 'text-cyan-400' : ''}`} />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleSort(col.name, e);
                            }}
                            className={`flex items-center gap-1 rounded transition-all cursor-pointer ${
                              isSorted && sortItem
                                ? 'px-1 py-0.5 bg-blue-600/25 text-blue-400 border border-blue-500/30 shadow-xs'
                                : 'p-1 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
                            }`}
                            title={
                              isSorted && sortItem
                                ? `Sorted ${sortItem.direction === 'asc' ? 'A → Z (ASC)' : 'Z → A (DESC)'}${
                                    localSortConfigs.length > 1 ? ` (priority #${sortIndex + 1})` : ''
                                  }`
                                : `Sort by "${col.name}" (Shift+Click for multi-sort)`
                            }
                          >
                            {isSorted && sortItem ? (
                              <>
                                {sortItem.direction === 'asc' ? (
                                  <ChevronUp className="h-3.5 w-3.5 stroke-[2.2]" />
                                ) : (
                                  <ChevronDown className="h-3.5 w-3.5 stroke-[2.2]" />
                                )}
                                {localSortConfigs.length > 1 && (
                                  <span className="flex items-center justify-center h-3.5 w-3.5 rounded-full bg-blue-500 text-white text-[9px] font-bold font-mono ml-0.5">
                                    {sortIndex + 1}
                                  </span>
                                )}
                              </>
                            ) : (
                              <svg
                                viewBox="0 0 12 12"
                                className="h-3 w-3 fill-current"
                                aria-hidden="true"
                              >
                                <path d="M6 2L9 5H3L6 2Z" />
                                <path d="M6 10L3 7H9L6 10Z" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>

                      <div
                        onMouseDown={(e) => handleResizeStart(e, col.name)}
                        onDoubleClick={(e) => handleResizeDoubleClick(e, col.name, cIdx)}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                        className={`absolute right-0 top-0 bottom-0 w-3 -mr-1.5 cursor-col-resize z-20 flex justify-center items-center group/resizer select-none ${
                          resizingCol === col.name ? 'bg-blue-500/20' : ''
                        }`}
                        title={`Resize column "${col.name}" (Double-click to auto-fit)`}
                      >
                        <div
                          className={`w-[2px] h-full transition-colors ${
                            resizingCol === col.name
                              ? 'bg-blue-400'
                              : 'bg-transparent group-hover/resizer:bg-blue-400/80 group-active/resizer:bg-blue-400'
                          }`}
                        />
                      </div>
                    </th>
                  );
                })}
                {rightColSpacerWidth > 0 && (
                  <th
                    aria-hidden="true"
                    className={`p-0 border-b ${gridCellBorder} ${gridTheadBg}`}
                    style={{ width: `${rightColSpacerWidth}px`, minWidth: `${rightColSpacerWidth}px` }}
                  />
                )}
                <th className={`p-0 border-b ${gridCellBorder} ${gridTheadBg}`} />
              </tr>
            </thead>
            <tbody>
              {visualRows.length === 0 ? null : (() => {
                const virtualItems = rowVirtualizer.getVirtualItems();
                const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
                const paddingBottom =
                  virtualItems.length > 0
                    ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
                    : 0;
                const colSpanTotal =
                  (visibleColIndices ? visibleColIndices.length : columns.length) +
                  (leftColSpacerWidth > 0 ? 1 : 0) +
                  (rightColSpacerWidth > 0 ? 1 : 0) +
                  2;

                return (
                  <>
                    {paddingTop > 0 && (
                      <tr aria-hidden="true">
                        <td colSpan={colSpanTotal} style={{ height: `${paddingTop}px`, padding: 0, border: 0 }} />
                      </tr>
                    )}
                    {virtualItems.map((virtualRow) => {
                      const vr = visualRows[virtualRow.index];
                      if (!vr) return null;
                      const vIdx = vr.vIdx;
                      const staged = !vr.isInsert ? stagedChanges[vr.globalRowIndex!] : undefined;

                      let isRowInSelection = false;
                      let isFullRowSelected = false;
                      const selectedColSet = new Set<number>();
                      const sigParts: string[] = [];

                      for (const rng of allSelectionRanges) {
                        if (vIdx >= rng.startR && vIdx <= rng.endR) {
                          isRowInSelection = true;
                          if (rng.startC === 0 && rng.endC === columns.length - 1) {
                            isFullRowSelected = true;
                          }
                          sigParts.push(`${rng.startC}:${rng.endC}`);
                          for (let c = rng.startC; c <= rng.endC; c++) {
                            selectedColSet.add(c);
                          }
                        }
                      }

                      const rowSelectionSig = sigParts.join(',');
                      const editingColIndex =
                        editingCell?.rowIndex === vr.rowId ? editingCell.colIndex : null;

                      return (
                        <DataGridRow
                          key={vr.isInsert ? vr.rowId : vr.globalRowIndex!}
                          vr={vr}
                          columns={columns}
                          visibleColIndices={visibleColIndices}
                          leftColSpacerWidth={leftColSpacerWidth}
                          rightColSpacerWidth={rightColSpacerWidth}
                          colWidths={colWidths}
                          colInputTypes={colInputTypes}
                          colEditableUpdate={colEditableUpdate}
                          colEditableInsert={colEditableInsert}
                          frozenColumnSet={frozenColumnSet}
                          lastFrozenColName={lastFrozenColName}
                          frozenOffsets={frozenOffsets}
                          isScrolledX={isScrolledX}
                          staged={staged}
                          isRowInSelection={isRowInSelection}
                          isFullRowSelected={isFullRowSelected}
                          rowSelectionSig={rowSelectionSig}
                          selectedColSet={selectedColSet}
                          editingColIndex={editingColIndex}
                          editVal={editingColIndex !== null ? editVal : ''}
                          isFirstEditRenderRef={isFirstEditRenderRef}
                          isRedis={isRedis}
                          gridCellBorder={gridCellBorder}
                          gridRowClass={gridRowClass}
                          onRowHeaderMouseDown={stableRowHeaderMouseDown}
                          onRowHeaderMouseEnter={stableRowHeaderMouseEnter}
                          onRowHeaderContextMenu={stableRowHeaderContextMenu}
                          onCellMouseDown={stableCellMouseDown}
                          onCellMouseEnter={stableCellMouseEnter}
                          onCellContextMenu={stableCellContextMenu}
                          onStartEdit={stableStartEdit}
                          onOpenTtlModal={stableOpenTtlModal}
                          onEditValChange={setEditVal}
                          onFinishEdit={stableFinishEdit}
                          onCancelEdit={stableCancelEdit}
                          onTabNextFromEditor={stableTabNextFromEditor}
                          fkMapByCol={fkMapByCol}
                          onForeignKeyJump={handleForeignKeyJump}
                          maskSensitiveData={maskSensitiveData}
                        />
                      );
                    })}
                    {paddingBottom > 0 && (
                      <tr aria-hidden="true">
                        <td colSpan={colSpanTotal} style={{ height: `${paddingBottom}px`, padding: 0, border: 0 }} />
                      </tr>
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>
          {displayedRows.length === 0 && insertedChanges.length === 0 && (
            <div className="sticky left-0 w-full py-12 px-4 text-center text-zinc-500 font-sans">
              {errorMessage ? (
                <div className="max-w-lg mx-auto flex flex-col items-center gap-2.5 text-rose-400/90 font-mono text-xs select-text">
                  <div className="flex items-center gap-2 font-semibold text-rose-300">
                    <AlertCircle className="h-4 w-4 text-rose-400" />
                    <span>Query Execution Error</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed max-w-md">{errorMessage}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setWhereInput('');
                      onApplyWhere?.('');
                    }}
                    className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-sans font-medium transition-colors cursor-pointer shadow-sm"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset WHERE Filter</span>
                  </button>
                </div>
              ) : (
                'No data to display'
              )}
            </div>
          )}
        </div>

        {(displayedRows.length > 0 || currentPage > 1) && (
          <GridPagination
            currentPage={currentPage}
            totalPages={totalPages}
            startRow={startRow}
            endRow={endRow}
            effectiveTotal={effectiveTotal}
            isExactTotalKnown={isExactTotalKnown}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            isLoadingPrevious={isLoadingPrevious}
            isCountingTotal={isCountingTotal}
            hasCountRows={Boolean(onCountRows)}
            localPageSize={localPageSize}
            globalDefaultPageSize={globalDefaultPageSize}
            isPageSizeOpen={isPageSizeOpen}
            pageSizeMenuRef={pageSizeMenuRef}
            onTogglePageSizeMenu={() => setIsPageSizeOpen((prev) => !prev)}
            onClosePageSizeMenu={() => setIsPageSizeOpen(false)}
            onNavigatePage={handleNavigatePage}
            onPageSizeChange={handlePageSizeChange}
            onCountRows={handleCountRows}
          />
        )}
      </div>

      {hoveredCol && (
        <ColumnHoverPopover
          hoveredCol={hoveredCol}
          isRedis={isRedis}
          isColumnEditable={isColumnEditable}
        />
      )}

      {showCancelConfirm && (
        <CancelChangesModal
          stagedCount={stagedCount}
          onKeep={() => setShowCancelConfirm(false)}
          onDiscard={() => {
            revertTabChanges(tabId);
            setEditingCell(null);
            if (selectedRowIndex !== null && selectedRowIndex < 0) {
              setAdditionalSelections([]);
              setSelectionAnchor(null);
              setSelectionFocus(null);
            }
            setShowCancelConfirm(false);
          }}
        />
      )}

      <GridContextMenu
        contextMenu={contextMenu}
        selectionSummary={selectionSummary}
        copyFormat={copyFormat}
        isCopyAsSubmenuOpen={isCopyAsSubmenuOpen}
        isRedis={isRedis}
        columns={columns}
        visualRows={visualRows}
        stagedChanges={stagedChanges}
        frozenColumns={frozenColumns}
        isCellEditable={isCellEditable}
        onSetCopyAsSubmenuOpen={setIsCopyAsSubmenuOpen}
        onClose={() => setContextMenu((prev) => ({ ...prev, isOpen: false }))}
        onCopy={(fmt) => {
          const text = getFormattedCopyText(fmt);
          if (text) navigator.clipboard.writeText(text);
        }}
        onOpenCopyAsModal={() => setIsCopyAsOpen(true)}
        onPaste={handlePasteData}
        onDuplicateRow={handleDuplicateRow}
        onAddRow={handleAddRow}
        onDeleteActiveRow={handleDeleteActiveRow}
        onOpenTtlModal={handleOpenTtlModal}
        onStartEdit={handleStartEdit}
        onOpenRedisRenameModal={(oldKeyName) => setRedisRenameModal({ isOpen: true, oldKeyName })}
        onOpenUpdateQueryInTab={openUpdateQueryInTab}
        onSetSelectedToNull={handleSetSelectedToNull}
        onToggleFreeze={handleToggleFreeze}
        onUnfreezeAll={() => setFrozenColumns([])}
        onAutoFitColumn={(cIdx) => {
          const colName = columns[cIdx].name;
          const autoW = getInitialColumnWidth(columns[cIdx], rows, cIdx);
          setColWidths((prev) => {
            const next = { ...prev, [colName]: autoW };
            currentWidthsRef.current = next;
            saveColWidths(storageKey, next);
            return next;
          });
        }}
        onResetAllColumnWidths={() => {
          const resetWidths: Record<string, number> = {};
          columns.forEach((c, idx) => {
            resetWidths[c.name] = getInitialColumnWidth(c, rows, idx);
          });
          setColWidths(resetWidths);
          currentWidthsRef.current = resetWidths;
          saveColWidths(storageKey, resetWidths);
        }}
        onToggleValuePanel={handleToggleValuePanel}
        onSelectAll={() => {
          if (visualRows.length > 0 && columns.length > 0) {
            setAdditionalSelections([]);
            setSelectionAnchor({ r: 0, c: 0 });
            setSelectionFocus({ r: visualRows.length - 1, c: columns.length - 1 });
          }
        }}
        onHideColumn={onHideColumn}
        hiddenColumnsCount={hiddenColumnsCount}
        onShowAllColumns={onShowAllColumns}
      />

      {isExportOpen && (
        <Suspense fallback={null}>
          <ExportModal
            isOpen={isExportOpen}
            onClose={() => setIsExportOpen(false)}
            connectionId={connectionId || ''}
            database={database}
            schema={schema}
            table={tableName}
            sql={rawSql}
          />
        </Suspense>
      )}

      {tableName && isImportOpen && (
        <Suspense fallback={null}>
          <ImportModal
            isOpen={isImportOpen}
            onClose={() => setIsImportOpen(false)}
            connectionId={connectionId || ''}
            database={database || ''}
            schema={schema || ''}
            table={tableName}
            onImportComplete={onRefresh}
          />
        </Suspense>
      )}

      {showAllSortsModal && (
        <AllSortsModal
          localSortConfigs={localSortConfigs}
          onClose={() => setShowAllSortsModal(false)}
          onUpdateSorts={(next) => {
            setLocalSortConfigs(next);
            onSortChange?.(next);
          }}
          onClearAllSort={handleClearAllSort}
        />
      )}

      {showAllFrozenModal && (
        <AllFrozenModal
          frozenColumns={frozenColumns}
          onClose={() => setShowAllFrozenModal(false)}
          onUpdateFrozen={(next) => {
            setFrozenColumns(next);
            onFrozenColumnsChange?.(next);
          }}
        />
      )}

      {ttlModal && (
        <RedisTtlModal
          ttlModal={ttlModal}
          ttlMode={ttlMode}
          ttlAmount={ttlAmount}
          ttlUnit={ttlUnit}
          onClose={() => setTtlModal(null)}
          onChangeMode={setTtlMode}
          onChangeAmount={setTtlAmount}
          onChangeUnit={setTtlUnit}
          onSave={handleSaveTtl}
        />
      )}

      <RedisAddKeyModal
        isOpen={redisAddKeyOpen}
        onClose={() => setRedisAddKeyOpen(false)}
        connectionId={connectionId || ''}
        database={database || 'db0'}
        onSuccess={() => onRefresh?.()}
      />

      <RedisRenameKeyModal
        isOpen={redisRenameModal.isOpen}
        onClose={() => setRedisRenameModal({ isOpen: false, oldKeyName: '' })}
        connectionId={connectionId || ''}
        database={database || 'db0'}
        oldKeyName={redisRenameModal.oldKeyName}
        onSuccess={() => onRefresh?.()}
      />

      <CopyAsModal
        isOpen={isCopyAsOpen}
        defaultFormat={copyFormat}
        selectionSummary={selectionSummary}
        onClose={() => setIsCopyAsOpen(false)}
        onCopy={(fmt) => {
          const text = getFormattedCopyText(fmt);
          if (text) navigator.clipboard.writeText(text);
          setIsCopyAsOpen(false);
        }}
      />
    </div>
  );
};
