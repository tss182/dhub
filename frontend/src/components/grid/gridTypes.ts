import { ColumnMeta, ConnectionEnvType } from '../../types/domain';
import { StagedRowChange } from '../../stores/useGridEditStore';

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);
export const modKey = isMac ? 'Cmd' : 'Ctrl';

export const ROW_NUM_COL_WIDTH = 52;
export const EMPTY_STAGED: Record<number, StagedRowChange> = {};
export const EMPTY_PRIMARY_KEYS: string[] = [];
export const EMPTY_SORT_CONFIGS: SortConfig[] = [];

export interface SortConfig {
  column: string;
  direction: 'asc' | 'desc';
}

export interface WhereSuggestionItem {
  id: string;
  type: 'column' | 'keyword';
  name: string;
  dataType?: string;
  isPK?: boolean;
  iconType?: 'pk' | 'number' | 'date' | 'boolean' | 'text';
}

export type CellRect = {
  startR: number;
  endR: number;
  startC: number;
  endC: number;
};

export interface VisualRow {
  vIdx: number;
  rowId: number;
  isInsert: boolean;
  insertChange?: StagedRowChange & { type: 'insert' };
  rowData?: any[];
  globalRowIndex?: number;
}

export interface ColumnHoverInfo {
  col: ColumnMeta;
  isPK: boolean;
  details: { baseType: string; size: string | null; extra: string | null };
  x: number;
  y: number;
}

export interface TtlModalState {
  rowIndex: number;
  keyName: string;
  currentTtl: string;
  isInsert: boolean;
}

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  vIdx: number | null;
  cIdx: number | null;
}

export interface DataGridProps {
  tabId: string;
  connectionId?: string | null;
  database?: string;
  schema?: string;
  tableName?: string;
  driver?: string;
  isReadOnly?: boolean;
  columns: ColumnMeta[];
  rows: any[][];
  primaryKeys?: string[];
  onSubmitChanges: (skipConfirm?: boolean) => void;
  onPreviewChanges: () => void;
  onCopyDml?: () => Promise<boolean | void> | void;
  totalCount?: number;
  minTotalCount?: number;
  onCountRows?: () => Promise<void> | void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  hasPrevious?: boolean;
  isLoadingPrevious?: boolean;
  onLoadPrevious?: () => void;
  startOffset?: number;
  page?: number;
  onPageChange?: (newPage: number) => void;
  pageSize?: number;
  onPageSizeChange?: (newSize: number) => void;
  onLoadMore?: () => void;
  onRefresh?: () => void;
  whereClause?: string;
  errorMessage?: string | null;
  onApplyWhere?: (whereClause: string) => void;
  isTableTab?: boolean;
  sortConfigs?: SortConfig[];
  onSortChange?: (sortConfigs: SortConfig[]) => void;
  envType?: ConnectionEnvType;
  rawSql?: string;
  initialFrozenColumns?: string[];
  onFrozenColumnsChange?: (columns: string[]) => void;
  onColumnReorder?: (fromColName: string, toColName: string, position: 'before' | 'after') => void;
  onHideColumn?: (colName: string) => void;
  hiddenColumnsCount?: number;
  onShowAllColumns?: () => void;
  targetRowIndex?: number;
  onActiveRowChange?: (rowIndex: number) => void;
  initialScrollTop?: number;
  initialScrollLeft?: number;
  onScrollChange?: (
    scrollTop: number,
    scrollLeft: number,
    firstVisibleRowIndex: number,
    topRowOffsetPx?: number
  ) => void;
}
