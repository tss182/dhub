import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { ColumnMeta, ConnectionEnvType } from '../../types/domain';
import { useGridEditStore, StagedRowChange } from '../../stores/useGridEditStore';
import { useSettingsStore, CopyFormat } from '../../stores/useSettingsStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useAlertStore, alertWarning, alertSuccess } from '../../stores/useAlertStore';
import { CopyFormatSelector, COPY_FORMAT_LABELS } from './CopyFormatSelector';
import {
  Plus,
  Trash2,
  RotateCcw,
  Check,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  Search,
  X,
  Layers,
  ArrowDownCircle,
  ArrowUpCircle,
  Filter,
  Key,
  Hash,
  Info,
  ArrowUp,
  ArrowDown,
  ArrowDownAZ,
  ArrowDownZA,
  ArrowUpDown,
  Copy,
  AlertCircle,
  FileText,
  Code,
  Edit3,
  Ban,
  CheckSquare,
  ClipboardPaste,
  Clock,
  PanelRight,
  Download,
  Upload,
  Snowflake,
} from 'lucide-react';
import { ExportModal } from '../modals/ExportModal';
import { ImportModal } from '../modals/ImportModal';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);
const modKey = isMac ? 'Cmd' : 'Ctrl';

function parseColumnTypeDetails(dataType?: string) {
  if (!dataType) return { baseType: 'UNKNOWN', size: null, extra: null };
  const trimmed = dataType.trim();
  const match = trimmed.match(/^([a-zA-Z\s_]+)(?:\(([^)]+)\))?(.*)$/);
  if (!match) {
    return { baseType: trimmed.toUpperCase(), size: null, extra: null };
  }
  const baseType = match[1].trim().toUpperCase();
  const size = match[2]?.trim() || null;
  const extra = match[3]?.trim().toUpperCase() || null;
  return { baseType, size, extra };
}

export function formatSqlLiteral(val: any, dataType?: string): string {
  if (val === null || val === undefined) return 'NULL';
  const rawType = (dataType || '').toLowerCase();
  const isNum = /int|float|double|decimal|numeric|real|serial|number/.test(rawType);
  if (isNum && !isNaN(Number(val)) && String(val).trim() !== '') {
    return String(val);
  }
  if (typeof val === 'boolean') {
    return val ? 'TRUE' : 'FALSE';
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

function getColumnInputType(dataType?: string): 'date' | 'datetime-local' | 'time' | 'text' {
  if (!dataType) return 'text';
  const { baseType } = parseColumnTypeDetails(dataType);
  const upper = baseType.toUpperCase();

  if (upper === 'DATE') {
    return 'date';
  }
  if (
    upper.includes('TIMESTAMP') ||
    upper.includes('DATETIME')
  ) {
    return 'datetime-local';
  }
  if (upper.includes('TIME') && !upper.includes('TIMESTAMP')) {
    return 'time';
  }
  return 'text';
}

function formatToDateInputValue(val: any, type: 'date' | 'datetime-local' | 'time' | 'text'): string {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (!str) return '';

  if (type === 'date') {
    const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    return '';
  }

  if (type === 'datetime-local') {
    const normalized = str.replace(' ', 'T').replace(/Z$/, '');
    const match = normalized.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)/);
    if (match) return match[1];
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    return '';
  }

  if (type === 'time') {
    const match = str.match(/(\d{2}:\d{2}(?::\d{2})?)/);
    if (match) return match[1];
    return '';
  }

  return str;
}

function normalizeDateCommitValue(val: string, inputType: 'date' | 'datetime-local' | 'time' | 'text'): string | null {
  if (val === null || val === undefined) return null;
  const trimmed = String(val).trim();
  if (!trimmed) return null;

  if (inputType === 'datetime-local') {
    let s = trimmed.replace('T', ' ').replace(/Z$/, '').trim();
    s = s.replace(/([+-]\d{2}:?\d{2})$/, '').trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) {
      s += ':00';
    }
    return s;
  }
  if (inputType === 'date') {
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    return trimmed;
  }
  if (inputType === 'time') {
    const match = trimmed.match(/(\d{2}:\d{2}(?::\d{2})?)/);
    if (match) {
      let t = match[1];
      if (/^\d{2}:\d{2}$/.test(t)) t += ':00';
      return t;
    }
    return trimmed;
  }
  return trimmed;
}

function unquoteIdentifier(ident: string): string {
  const trimmed = ident.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return trimmed.slice(1, -1).replace(/""|``|\]\]/g, (m) => m[0]);
  }
  return trimmed;
}

function unquoteSqlLiteral(literal: string): string | null {
  const trimmed = literal.trim();
  if (/^null$/i.test(trimmed)) return null;
  if (/^default$/i.test(trimmed)) return null;
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed
      .slice(1, -1)
      .replace(/''|\\'/g, "'")
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""|\\"/g, '"');
  }
  return trimmed;
}

function splitSqlList(str: string): string[] {
  const items: string[] = [];
  let curr = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let parenDepth = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "'" && !inDoubleQuote && !inBacktick) {
      if (inSingleQuote && str[i + 1] === "'") {
        curr += "''";
        i++;
      } else {
        inSingleQuote = !inSingleQuote;
        curr += ch;
      }
    } else if (ch === '"' && !inSingleQuote && !inBacktick) {
      if (inDoubleQuote && str[i + 1] === '"') {
        curr += '""';
        i++;
      } else {
        inDoubleQuote = !inDoubleQuote;
        curr += ch;
      }
    } else if (ch === '`' && !inSingleQuote && !inDoubleQuote) {
      inBacktick = !inBacktick;
      curr += ch;
    } else if (ch === '(' && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      parenDepth++;
      curr += ch;
    } else if (ch === ')' && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      parenDepth = Math.max(0, parenDepth - 1);
      curr += ch;
    } else if (ch === ',' && !inSingleQuote && !inDoubleQuote && !inBacktick && parenDepth === 0) {
      items.push(curr.trim());
      curr = '';
    } else {
      curr += ch;
    }
  }
  if (curr.trim().length > 0) {
    items.push(curr.trim());
  }
  return items;
}

function tryParseSqlInsert(sqlText: string): { headers?: string[]; rows: (string | null)[][] } | null {
  const clean = sqlText.trim();
  if (!/^INSERT\s+INTO\b/i.test(clean)) return null;

  const insertMatch = clean.match(/^INSERT\s+INTO\s+[^\(]+?(?:\(([\s\S]+?)\))?\s*VALUES\s*([\s\S]+)$/i);
  if (!insertMatch) return null;

  let headers: string[] | undefined;
  if (insertMatch[1]) {
    headers = splitSqlList(insertMatch[1]).map(unquoteIdentifier);
  }

  const rawValues = insertMatch[2];
  const rows: (string | null)[][] = [];

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let parenDepth = 0;
  let tupleStart = -1;

  for (let i = 0; i < rawValues.length; i++) {
    const ch = rawValues[i];
    if (ch === "'" && !inDoubleQuote && !inBacktick) {
      if (inSingleQuote && rawValues[i + 1] === "'") {
        i++;
      } else {
        inSingleQuote = !inSingleQuote;
      }
    } else if (ch === '"' && !inSingleQuote && !inBacktick) {
      if (inDoubleQuote && rawValues[i + 1] === '"') {
        i++;
      } else {
        inDoubleQuote = !inDoubleQuote;
      }
    } else if (ch === '`' && !inSingleQuote && !inDoubleQuote) {
      inBacktick = !inBacktick;
    } else if (ch === '(' && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (parenDepth === 0) tupleStart = i + 1;
      parenDepth++;
    } else if (ch === ')' && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      parenDepth--;
      if (parenDepth === 0 && tupleStart !== -1) {
        const tupleContent = rawValues.substring(tupleStart, i);
        const cellLiterals = splitSqlList(tupleContent);
        rows.push(cellLiterals.map(unquoteSqlLiteral));
        tupleStart = -1;
      }
    } else if (parenDepth === 0 && (ch === ';' || /^[oO][nN]\s/i.test(rawValues.slice(i)))) {
      break;
    }
  }

  if (rows.length > 0) {
    return { headers, rows };
  }
  return null;
}

function tryParseSqlUpdate(sqlText: string): { headers?: string[]; rows: (string | null)[][] } | null {
  const clean = sqlText.trim();
  if (!/^UPDATE\s+/i.test(clean)) return null;

  const statements = clean.split(/;\s*(?=UPDATE\b)/i).filter((s) => s.trim().length > 0);
  const rows: (string | null)[][] = [];
  const headerSet: string[] = [];
  const parsedStatements: Array<Record<string, string | null>> = [];

  for (const stmt of statements) {
    const setMatch = stmt.match(/SET\s+([\s\S]+?)(?:\s+WHERE\b|$|;)/i);
    if (!setMatch) continue;

    const setClauses = splitSqlList(setMatch[1]);
    const rowObj: Record<string, string | null> = {};

    for (const clause of setClauses) {
      const eqIdx = clause.indexOf('=');
      if (eqIdx === -1) continue;
      const colName = unquoteIdentifier(clause.substring(0, eqIdx));
      const valStr = unquoteSqlLiteral(clause.substring(eqIdx + 1));
      rowObj[colName] = valStr;
      if (!headerSet.includes(colName)) {
        headerSet.push(colName);
      }
    }

    if (Object.keys(rowObj).length > 0) {
      parsedStatements.push(rowObj);
    }
  }

  if (parsedStatements.length === 0) return null;

  for (const rowObj of parsedStatements) {
    rows.push(headerSet.map((h) => rowObj[h] ?? null));
  }

  return { headers: headerSet, rows };
}

function tryParseJson(text: string): { headers?: string[]; rows: (string | null)[][] } | null {
  const trimmed = text.trim();
  if (!((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}')))) {
    return null;
  }
  try {
    const json = JSON.parse(trimmed);
    if (Array.isArray(json)) {
      if (json.length === 0) return null;

      if (Array.isArray(json[0])) {
        const rows = json.map((subArr) =>
          Array.isArray(subArr)
            ? subArr.map((v) =>
                v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)
              )
            : [String(subArr)]
        );
        return { rows };
      }

      if (typeof json[0] === 'object' && json[0] !== null) {
        const keys: string[] = [];
        json.forEach((item) => {
          if (typeof item === 'object' && item !== null) {
            Object.keys(item).forEach((k) => {
              if (!keys.includes(k)) keys.push(k);
            });
          }
        });
        const rows = json.map((item) =>
          keys.map((k) => {
            const v = item?.[k];
            if (v === null || v === undefined) return null;
            return typeof v === 'object' ? JSON.stringify(v) : String(v);
          })
        );
        return { headers: keys, rows };
      }

      const rows = json.map((v) => [v === null || v === undefined ? null : String(v)]);
      return { rows };
    }

    if (typeof json === 'object' && json !== null) {
      const keys = Object.keys(json);
      const row = keys.map((k) => {
        const v = json[k];
        if (v === null || v === undefined) return null;
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
      });
      return { headers: keys, rows: [row] };
    }
  } catch {}
  return null;
}

function cleanPastedValue(val: any, dataType?: string): any {
  if (val === null || val === undefined) return null;
  let str = String(val).trim();
  if (str === '' || str.toUpperCase() === 'NULL' || str.toLowerCase() === '<null>') {
    return null;
  }
  // Strip surrounding quotes if present
  if ((str.startsWith("'") && str.endsWith("'")) || (str.startsWith('"') && str.endsWith('"'))) {
    str = str.slice(1, -1).trim();
  }
  if (str === '' || str.toUpperCase() === 'NULL' || str.toLowerCase() === '<null>') {
    return null;
  }

  const upperType = (dataType || '').toUpperCase();
  if (upperType.includes('BOOL') || upperType.includes('BIT')) {
    if (str === 'true' || str === 't' || str === '1') return true;
    if (str === 'false' || str === 'f' || str === '0') return false;
  }

  const inputType = getColumnInputType(dataType);
  if (inputType !== 'text') {
    return normalizeDateCommitValue(str, inputType);
  }
  return str;
}

export interface SortConfig {
  column: string;
  direction: 'asc' | 'desc';
}

const EMPTY_STAGED: Record<number, any> = {};

export interface WhereSuggestionItem {
  id: string;
  type: 'column' | 'keyword';
  name: string;
  dataType?: string;
  isPK?: boolean;
  iconType?: 'pk' | 'number' | 'date' | 'boolean' | 'text';
}

const SQL_WHERE_KEYWORDS = [
  'AND',
  'OR',
  'LIKE',
  'NOT LIKE',
  'ILIKE',
  'IN',
  'NOT IN',
  'IS NULL',
  'IS NOT NULL',
  'BETWEEN',
  'ORDER BY',
  'ASC',
  'DESC',
  'LIMIT',
];

function getWhereColumnIconType(dataType?: string, isPK?: boolean): 'pk' | 'number' | 'date' | 'boolean' | 'text' {
  if (isPK) return 'pk';
  if (!dataType) return 'text';
  const upper = dataType.toUpperCase();
  if (
    upper.includes('INT') ||
    upper.includes('NUMERIC') ||
    upper.includes('DECIMAL') ||
    upper.includes('FLOAT') ||
    upper.includes('DOUBLE') ||
    upper.includes('REAL') ||
    upper.includes('SERIAL')
  ) {
    return 'number';
  }
  if (upper.includes('DATE') || upper.includes('TIME')) {
    return 'date';
  }
  if (upper.includes('BOOL') || upper.includes('BIT')) {
    return 'boolean';
  }
  return 'text';
}

function isInsideQuotes(text: string, cursor: number): boolean {
  const textBefore = text.slice(0, cursor);
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < textBefore.length; i++) {
    const ch = textBefore[i];
    if (ch === "'" && !inDouble) {
      if (inSingle && textBefore[i + 1] === "'") {
        i++; // Escaped ''
      } else {
        inSingle = !inSingle;
      }
    } else if (ch === '"' && !inSingle) {
      if (inDouble && textBefore[i + 1] === '"') {
        i++; // Escaped ""
      } else {
        inDouble = !inDouble;
      }
    }
  }

  return inSingle || inDouble;
}

function getWhereCurrentToken(text: string, cursor: number) {
  const textBefore = text.slice(0, cursor);
  const match = textBefore.match(/([a-zA-Z0-9_`"'.%]+)$/);
  if (!match) {
    return { start: cursor, end: cursor, word: '' };
  }
  const rawWord = match[1];
  const word = rawWord.replace(/[`"']/g, '');
  const start = cursor - rawWord.length;
  const textAfter = text.slice(cursor);
  const afterMatch = textAfter.match(/^([a-zA-Z0-9_`"'.%]+)/);
  const end = cursor + (afterMatch ? afterMatch[1].length : 0);
  return { start, end, word };
}

interface DataGridProps {
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
  onSubmitChanges: () => void;
  onPreviewChanges: () => void;
  totalCount?: number;
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
  targetRowIndex?: number;
  onActiveRowChange?: (rowIndex: number) => void;
  initialScrollTop?: number;
  initialScrollLeft?: number;
  onScrollChange?: (scrollTop: number, scrollLeft: number, firstVisibleRowIndex: number) => void;
}

function getColWidthsStorageKey(
  connectionId?: string | null,
  database?: string,
  tableName?: string,
  tabId?: string,
  columns?: ColumnMeta[]
): string {
  if (tableName) {
    return `dhub:col_widths:table:${connectionId || 'default'}:${database || ''}:${tableName}`;
  }
  const colSig = (columns || []).map((c) => c.name).slice(0, 10).join(',');
  return `dhub:col_widths:query:${tabId || 'default'}:${colSig}`;
}

function saveColWidths(key: string, widths: Record<string, number>) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(key, JSON.stringify(widths));
    }
  } catch {}
}

function loadColWidths(key: string): Record<string, number> | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    }
  } catch {}
  return null;
}

function getLongestWordLength(str: string): number {
  if (!str) return 0;
  // Treat underscore '_' and whitespace as word separators
  const words = str.split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return str.length;
  return Math.max(...words.map((w) => w.length));
}

function getMinimumColumnWidth(col: ColumnMeta, isPK?: boolean): number {
  // Longest word in column name with _ or space as separator
  const longestWordLen = getLongestWordLength(col.name || '');
  // Chrome width: 24px (px-3) + 20px (freeze button) + 40px (sort badge) + 8px (gap)
  const chromeWidth = isPK ? 112 : 94;
  const wordWidth = Math.ceil(longestWordLen * 8.5);
  // Full column name width if it's reasonably short (up to 24 chars)
  const nameLen = (col.name || '').length;
  const nameWidth = Math.ceil(Math.min(nameLen, 24) * 8.5);

  const calculatedMin = Math.max(wordWidth, nameWidth) + chromeWidth;
  // Ensure minimum is at least 140px (or 160px for PK) so no column ever squishes to tiny width
  return Math.max(isPK ? 160 : 140, Math.min(calculatedMin, 340));
}

function getInitialColumnWidth(col: ColumnMeta, sampleRows: any[][], colIdx: number, isPK?: boolean): number {
  const minWidth = getMinimumColumnWidth(col, isPK);

  let maxDataLen = 0;
  let maxDataWordLen = 0;
  const maxRowsToCheck = Math.min(sampleRows.length, 60);

  for (let i = 0; i < maxRowsToCheck; i++) {
    const v = sampleRows[i]?.[colIdx];
    if (v !== null && v !== undefined) {
      const s = String(v).trim();
      if (s) {
        if (s.length > maxDataLen) maxDataLen = s.length;
        const words = s.split(/[_\s]+/).filter(Boolean);
        for (const w of words) {
          if (w.length > maxDataWordLen) maxDataWordLen = w.length;
        }
      }
    }
  }

  // Cover data values up to 50 chars, or at least data words up to 30 chars
  const effectiveDataLen = Math.max(Math.min(maxDataLen, 45), Math.min(maxDataWordLen, 30));
  // 24px padding for data cell (px-3) + 4px buffer
  const dataCalculated = Math.ceil(effectiveDataLen * 8.5) + 28;

  // The final width is at least minWidth (which covers at least 1 word of column name + chrome),
  // and expands to fit data content up to 480px.
  return Math.max(minWidth, Math.min(dataCalculated, 480));
}

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
  primaryKeys = [],
  onSubmitChanges,
  onPreviewChanges,
  totalCount,
  hasMore = false,
  isLoadingMore = false,
  hasPrevious = false,
  isLoadingPrevious = false,
  onLoadPrevious,
  startOffset = 0,
  page,
  onPageChange,
  pageSize = 100,
  onPageSizeChange,
  onLoadMore,
  onRefresh,
  whereClause = '',
  errorMessage,
  onApplyWhere,
  isTableTab = false,
  sortConfigs = [],
  onSortChange,
  envType = 'local',
  rawSql,
  initialFrozenColumns,
  onFrozenColumnsChange,
  targetRowIndex,
  onActiveRowChange,
  initialScrollTop,
  initialScrollLeft,
  onScrollChange,
}) => {
  const [whereInput, setWhereInput] = useState(whereClause || '');
  const [whereCursorPos, setWhereCursorPos] = useState<number>(0);
  const [showWhereSuggestions, setShowWhereSuggestions] = useState<boolean>(false);
  const [forceShowSuggestions, setForceShowSuggestions] = useState<boolean>(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<number>(0);
  const whereInputRef = useRef<HTMLInputElement>(null);
  const whereContainerRef = useRef<HTMLDivElement>(null);
  const suggestionListRef = useRef<HTMLDivElement>(null);
  const [localSortConfigs, setLocalSortConfigs] = useState<SortConfig[]>(sortConfigs || []);
  const [frozenColumns, setFrozenColumns] = useState<string[]>(
    initialFrozenColumns && initialFrozenColumns.length > 0
      ? initialFrozenColumns
      : Array.from(new Set(columns.filter((c) => c.isPrimaryKey || primaryKeys.includes(c.name)).map((c) => c.name)))
  );
  const prevTabTableKeyRef = useRef<string>(`${tabId || ''}::${tableName || ''}`);
  const hasInitializedPKsRef = useRef<boolean>(false);

  useEffect(() => {
    const currentKey = `${tabId || ''}::${tableName || ''}`;
    const pks = columns.filter((c) => c.isPrimaryKey || primaryKeys.includes(c.name)).map((c) => c.name);
    const uniquePKs = Array.from(new Set(pks));

    if (prevTabTableKeyRef.current !== currentKey) {
      prevTabTableKeyRef.current = currentKey;
      hasInitializedPKsRef.current = uniquePKs.length > 0;
      setFrozenColumns(uniquePKs);
      hasSampledRowsRef.current = false;
      userHasResizedRef.current = false;
    } else if (!hasInitializedPKsRef.current && uniquePKs.length > 0) {
      // If table just loaded and primary keys arrived asynchronously
      hasInitializedPKsRef.current = true;
      setFrozenColumns((prev) => Array.from(new Set([...prev, ...uniquePKs])));
    }
  }, [tabId, tableName, columns, primaryKeys]);
  const thRefs = useRef<Record<string, HTMLTableCellElement | null>>({});
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [resizingCol, setResizingCol] = useState<string | null>(null);
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

  const whereSuggestions = useMemo<WhereSuggestionItem[]>(() => {
    if (!isTableTab || !columns || columns.length === 0) return [];

    // 1. NEVER show autocomplete inside string literals (single or double quotes)
    if (isInsideQuotes(whereInput, whereCursorPos)) {
      return [];
    }

    const token = getWhereCurrentToken(whereInput, whereCursorPos);
    const search = token.word.toLowerCase();

    // 2. NEVER show autocomplete if typing numbers, wildcards %, or operators
    if (/^[0-9%'".,+\-*/<>=!]/.test(search)) {
      return [];
    }

    const columnItems: WhereSuggestionItem[] = columns.map((col) => {
      const isPK = Boolean(col.isPrimaryKey || primaryKeys.includes(col.name));
      return {
        id: `col-${col.name}`,
        type: 'column',
        name: col.name,
        dataType: col.dataType,
        isPK,
        iconType: getWhereColumnIconType(col.dataType, isPK),
      };
    });

    // 3. If no search prefix typed, only show if user explicitly pressed Ctrl+Space
    if (!search) {
      if (!forceShowSuggestions) {
        return [];
      }
      return columnItems.sort((a, b) => {
        if (a.isPK && !b.isPK) return -1;
        if (!a.isPK && b.isPK) return 1;
        return a.name.localeCompare(b.name);
      });
    }

    // 4. Filter columns by prefix or contains
    const matchedCols = columnItems
      .filter((col) => col.name.toLowerCase().includes(search))
      .sort((a, b) => {
        const aLower = a.name.toLowerCase();
        const bLower = b.name.toLowerCase();
        const aStarts = aLower.startsWith(search);
        const bStarts = bLower.startsWith(search);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        if (a.isPK && !b.isPK) return -1;
        if (!a.isPK && b.isPK) return 1;
        return a.name.localeCompare(b.name);
      });

    // 5. Filter keywords (starts-with only)
    const matchedKeywords: WhereSuggestionItem[] = SQL_WHERE_KEYWORDS
      .filter((kw) => kw.toLowerCase().startsWith(search))
      .map((kw) => ({
        id: `kw-${kw}`,
        type: 'keyword',
        name: kw,
      }));

    return [...matchedCols, ...matchedKeywords];
  }, [isTableTab, columns, primaryKeys, whereInput, whereCursorPos, forceShowSuggestions]);

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

  const handleWhereKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Explicit trigger: Ctrl+Space opens all columns
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
      setShowWhereSuggestions(false);
      setForceShowSuggestions(false);
      onApplyWhere?.(whereInput);
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

    // Optional Alt or Ctrl key to sort exclusively by this single column
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
        // Multi-sort: Append to the end. The first clicked remains first (priority 1), next is priority 2, etc.
        nextConfigs = [...localSortConfigs, { column: colName, direction: 'asc' }];
      } else {
        const existing = localSortConfigs[existingIdx];
        if (existing.direction === 'asc') {
          // Switch to desc in-place (keeps its priority index)
          nextConfigs = localSortConfigs.map((s, idx) =>
            idx === existingIdx ? { ...s, direction: 'desc' as const } : s
          );
        } else {
          // 3rd click: remove from sort list; remaining sorted columns shift up in priority
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
    setFrozenColumns((prev) => {
      const next = prev.includes(colName) ? prev.filter((c) => c !== colName) : [...prev, colName];
      onFrozenColumnsChange?.(next);
      return next;
    });
  };


  const storageKey = useMemo(() => {
    return getColWidthsStorageKey(connectionId, database, tableName, tabId, columns);
  }, [connectionId, database, tableName, tabId, columns]);

  // Initialize and load column widths from localStorage or calculate initial widths
  useEffect(() => {
    if (!columns || columns.length === 0) return;

    const saved = loadColWidths(storageKey) || {};
    const newWidths: Record<string, number> = {};

    columns.forEach((col, idx) => {
      const isPK = Boolean(col.isPrimaryKey || primaryKeys.includes(col.name));
      const minRequired = getMinimumColumnWidth(col, isPK);

      if (saved[col.name] && typeof saved[col.name] === 'number') {
        newWidths[col.name] = Math.max(saved[col.name], minRequired);
      } else if (colWidths[col.name]) {
        newWidths[col.name] = Math.max(colWidths[col.name], minRequired);
      } else {
        newWidths[col.name] = getInitialColumnWidth(col, rows, idx, isPK);
      }
    });

    setColWidths(newWidths);
    currentWidthsRef.current = newWidths;
  }, [columns, storageKey, primaryKeys]);

  // When rows arrive asynchronously and user hasn't resized manually, recalculate initial widths
  useEffect(() => {
    if (rows.length > 0 && !hasSampledRowsRef.current && !userHasResizedRef.current) {
      hasSampledRowsRef.current = true;
      const saved = loadColWidths(storageKey) || {};
      setColWidths((prev) => {
        const next = { ...prev };
        let changed = false;
        columns.forEach((col, idx) => {
          const isPK = Boolean(col.isPrimaryKey || primaryKeys.includes(col.name));
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
  }, [rows.length, columns, storageKey, primaryKeys]);

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

      // Persist to localStorage
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
    const isPK = Boolean(col.isPrimaryKey || primaryKeys.includes(col.name));
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
    let currentLeft = 0;
    for (const col of columns) {
      if (frozenColumns.includes(col.name)) {
        offsets[col.name] = currentLeft;
        currentLeft += colWidths[col.name] || 120;
      }
    }
    return offsets;
  }, [columns, frozenColumns, colWidths]);

  const lastFrozenColName = useMemo(() => {
    for (let i = columns.length - 1; i >= 0; i--) {
      if (frozenColumns.includes(columns[i].name)) {
        return columns[i].name;
      }
    }
    return null;
  }, [columns, frozenColumns]);

  const [hoveredCol, setHoveredCol] = useState<{
    col: ColumnMeta;
    isPK: boolean;
    details: { baseType: string; size: string | null; extra: string | null };
    x: number;
    y: number;
  } | null>(null);

  const hoverTimeoutRef = useRef<any>(null);

  const handleColMouseEnter = (e: React.MouseEvent, col: ColumnMeta, isPK: boolean) => {
    if (isResizingRef.current || resizingRef.current) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const tooltipWidth = 240;
    const x = Math.min(Math.max(8, rect.left), window.innerWidth - tooltipWidth - 16);
    const y = rect.bottom + 4;
    const details = parseColumnTypeDetails(col.dataType);

    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredCol({
        col,
        isPK,
        details,
        x,
        y,
      });
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
  const globalViewMode = useSettingsStore((state) => state.dataViewMode);
  const globalDefaultPageSize = useSettingsStore((state) => state.defaultPageSize);
  const copyFormat = useSettingsStore((state) => state.copyFormat);
  const viewMode = globalViewMode;

  const [currentPage, setCurrentPage] = useState(page || 1);
  const [localPageSize, setLocalPageSize] = useState(pageSize || globalDefaultPageSize || 100);
  const [isBatchSizeOpen, setIsBatchSizeOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const batchSizeRef = useRef<HTMLDivElement>(null);

  const onScrollChangeRef = useRef(onScrollChange);
  onScrollChangeRef.current = onScrollChange;

  const debouncedScrollTimerRef = useRef<any>(null);
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

  // Preserve scroll position when previous rows are prepended to grid
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

  // Flush debounced scroll change on unmount
  useEffect(() => {
    return () => {
      if (debouncedScrollTimerRef.current) {
        clearTimeout(debouncedScrollTimerRef.current);
        const { scrollTop, scrollLeft, rowIndex } = latestScrollStateRef.current;
        onScrollChangeRef.current?.(scrollTop, scrollLeft, rowIndex);
      }
    };
  }, []);

  const scrollToCell = (vIdx: number, cIdx: number) => {
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
      const isTargetFrozen = targetCol && frozenColumns.includes(targetCol.name);

      let frozenLeftOffset = 0;
      if (!isTargetFrozen && frozenColumns.length > 0) {
        for (const col of columns) {
          if (frozenColumns.includes(col.name)) {
            frozenLeftOffset += (currentWidthsRef.current[col.name] || colWidths[col.name] || 120);
          }
        }
      }

      // Vertical scrolling
      if (cellRect.top < containerRect.top + theadHeight) {
        const diff = containerRect.top + theadHeight - cellRect.top;
        container.scrollTop = Math.max(0, container.scrollTop - diff - 4);
      } else if (cellRect.bottom > containerRect.bottom) {
        const diff = cellRect.bottom - containerRect.bottom;
        container.scrollTop = container.scrollTop + diff + 4;
      }

      // Horizontal scrolling
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
  };

  // Sync external page prop
  useEffect(() => {
    if (page && page !== currentPage) {
      setCurrentPage(page);
    }
  }, [page]);

  // Close batch size dropdown on outside click or Escape
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (batchSizeRef.current && !batchSizeRef.current.contains(e.target as Node)) {
        setIsBatchSizeOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsBatchSizeOpen(false);
    };
    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
  return () => {

      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Sync external pageSize prop
  useEffect(() => {
    if (pageSize && pageSize !== localPageSize) {
      setLocalPageSize(pageSize);
    }
  }, [pageSize]);

  // Fix inverted horizontal scrolling (touchpad swipe, tilt wheel, and Shift + Wheel on WebKitGTK / Linux)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // 1. Shift + Wheel: scroll horizontally
      if (e.shiftKey) {
        e.preventDefault();
        const multiplier = e.deltaMode === 1 ? 24 : 1;
        const delta = (e.deltaY !== 0 ? e.deltaY : -e.deltaX) * multiplier;
        container.scrollLeft += delta;
        return;
      }

      // 2. Direct horizontal scroll (touchpad swipe / tilt wheel):
      // WebKitGTK on Linux sends inverted deltaX, so we flip the sign
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

  const stagedChanges = useGridEditStore((state) => state.stagedByTab[tabId] ?? EMPTY_STAGED);
  const stageCellUpdate = useGridEditStore((state) => state.stageCellUpdate);
  const stageRowInsert = useGridEditStore((state) => state.stageRowInsert);
  const stageRowDelete = useGridEditStore((state) => state.stageRowDelete);
  const revertTabChanges = useGridEditStore((state) => state.revertTabChanges);
  const stagedCount = Object.keys(stagedChanges).length;

  const [selectionAnchor, setSelectionAnchor] = useState<{ r: number; c: number } | null>(null);
  const [selectionFocus, setSelectionFocus] = useState<{ r: number; c: number } | null>(null);
  const isDraggingRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
    vIdx: number | null;
    cIdx: number | null;
  }>({
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

  const isValuePanelOpen = isRightPanelOpen && activeRightSidebarTab === 'views';

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

  const handleStartEdit = (rowIndex: number, colIndex: number, currentVal: any) => {
    if (isReadOnly) return;
    const col = columns[colIndex];
    const inputType = getColumnInputType(col?.dataType);
    setEditingCell({ rowIndex, colIndex });
    setEditVal(formatToDateInputValue(currentVal, inputType));
  };

  const handleAddRow = () => {
    if (isReadOnly) return;
    const newRowId = -Date.now();
    stageRowInsert(tabId, newRowId);
    const newRowVIdx = displayedRows.length + insertedChanges.length;
    setSelectionAnchor({ r: newRowVIdx, c: 0 });
    setSelectionFocus({ r: newRowVIdx, c: columns.length > 0 ? columns.length - 1 : 0 });

    // Scroll to bottom so new row is visible
    setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }, 20);

    // Auto-focus first editable column of the newly inserted row
    const firstColIdx = columns.findIndex((c) => !c.isAutoIncrement);
    const targetColIdx = firstColIdx !== -1 ? firstColIdx : 0;
    if (columns.length > 0) {
      setTimeout(() => {
        handleStartEdit(newRowId, targetColIdx, '');
      }, 50);
    }
  };

  const generateUpdateSql = (rowIndex: number, colName: string, newVal: any): string => {
    const isMySQL = (driver || '').toLowerCase() === 'mysql' || (driver || '').toLowerCase() === 'mariadb';
    const quoteIdent = (name: string) =>
      isMySQL ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`;
    const tbl = tableName || 'table_name';
    const quotedTbl = tbl.includes('.')
      ? tbl.split('.').map(quoteIdent).join('.')
      : quoteIdent(tbl);

    const col = columns.find((c) => c.name === colName);
    const colDataType = col?.dataType;
    const formattedVal = formatSqlLiteral(newVal, colDataType);

    const rowInArray = rowIndex >= (startOffset || 0) ? rowIndex - (startOffset || 0) : rowIndex;
    const targetRow = rows[rowInArray] || rows[rowIndex];

    // Build WHERE clause using primary keys if available
    let whereClause = '';
    const detectedPKs = primaryKeys.length > 0
      ? primaryKeys
      : columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

    if (detectedPKs.length > 0) {
      const pkConds: string[] = [];
      detectedPKs.forEach((pk) => {
        const cIdx = columns.findIndex((c) => c.name === pk);
        const colMeta = columns[cIdx];
        const pkVal = cIdx !== -1 ? targetRow?.[cIdx] : undefined;
        if (pkVal !== undefined && pkVal !== null) {
          pkConds.push(`${quoteIdent(pk)} = ${formatSqlLiteral(pkVal, colMeta?.dataType)}`);
        }
      });
      if (pkConds.length > 0) {
        whereClause = pkConds.join(' AND ');
      }
    }

    if (!whereClause) {
      // Fallback: match using original row values
      const fallbackConds: string[] = [];
      columns.forEach((c, idx) => {
        const val = targetRow?.[idx];
        if (val === null || val === undefined) {
          fallbackConds.push(`${quoteIdent(c.name)} IS NULL`);
        } else {
          fallbackConds.push(`${quoteIdent(c.name)} = ${formatSqlLiteral(val, c.dataType)}`);
        }
      });
      whereClause =
        fallbackConds.length > 0
          ? fallbackConds.join(' AND ')
          : `${quoteIdent(colName)} = ${formatSqlLiteral(
              targetRow?.[columns.findIndex((c) => c.name === colName)],
              colDataType
            )}`;
    }

    return `UPDATE ${quotedTbl}
SET ${quoteIdent(colName)} = ${formattedVal}
WHERE ${whereClause};`;
  };

  const openUpdateQueryInTab = (rowIndex: number, colName: string, newVal: any) => {
    const sql = generateUpdateSql(rowIndex, colName, newVal);
    const cleanTable = tableName || 'table';
    const consoleTitle = `update_${cleanTable}.sql`;

    const workbenchStore = useWorkbenchStore.getState();
    const currentTab = workbenchStore.tabs.find((t) => t.id === tabId);
    const connId = currentTab?.connectionId || '';
    const database = currentTab?.database || '';
    const schema = currentTab?.schema || '';

    // Check if an update console tab for this table already exists
    const existingTab = workbenchStore.tabs.find(
      (t) => t.type === 'worksheet' && t.title === consoleTitle
    );

    if (existingTab) {
      workbenchStore.updateTabContent(existingTab.id, sql);
      workbenchStore.setActiveTabId(existingTab.id);
    } else {
      workbenchStore.createConsole(connId, database, schema, consoleTitle, sql);
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
      // Staged inserted row (negative rowIndex)
      stageCellUpdate(tabId, rowIndex, {}, {}, col.name, finalVal);
    } else {
      // Existing database row
      const originalRowValues: Record<string, unknown> = {};
      const rowInArray = rowIndex >= (startOffset || 0) ? rowIndex - (startOffset || 0) : rowIndex;
      const targetRow = rows[rowInArray] || rows[rowIndex];
      columns.forEach((c, idx) => {
        originalRowValues[c.name] = targetRow?.[idx];
      });

      const pkMap: Record<string, unknown> = {};
      primaryKeys.forEach((pk) => {
        const idx = columns.findIndex((c) => c.name === pk);
        if (idx !== -1) {
          pkMap[pk] = targetRow?.[idx];
        }
      });

      stageCellUpdate(tabId, rowIndex, pkMap, originalRowValues, col.name, finalVal);
    }
    setEditingCell(null);
  };

  const handleUpdateCellFromValueViewer = (newVal: any) => {
    if (!activeFocusedCell) return;
    const { rowIndex: vIdx, columnIndex: cIdx } = activeFocusedCell;
    const vr = visualRows[vIdx];
    const col = columns[cIdx];
    if (!vr || !col) return;

    if (vr.isInsert) {
      stageCellUpdate(tabId, vr.rowId, {}, {}, col.name, newVal);
    } else {
      const gRowIndex = vr.globalRowIndex!;
      const originalRowValues: Record<string, unknown> = {};
      columns.forEach((c, idx) => {
        originalRowValues[c.name] = rows[gRowIndex]?.[idx];
      });

      const pkMap: Record<string, unknown> = {};
      primaryKeys.forEach((pk) => {
        const idx = columns.findIndex((c) => c.name === pk);
        if (idx !== -1) {
          pkMap[pk] = rows[gRowIndex]?.[idx];
        }
      });

      stageCellUpdate(tabId, gRowIndex, pkMap, originalRowValues, col.name, newVal);
    }
  };

  const handleApplyChanges = () => {
    if (editingCell) {
      handleFinishEdit();
    }
    const currentStaged = useGridEditStore.getState().stagedByTab[tabId] || {};
    const count = Object.keys(currentStaged).length;
    if (count > 0 && onSubmitChanges) {
      onSubmitChanges();
    }
  };

  // Sort rows client-side (when onSortChange is not provided, e.g. query console results)
  const sortedRows = useMemo(() => {
    if (onSortChange || localSortConfigs.length === 0) return rows;

    return [...rows].sort((rowA, rowB) => {
      for (const sortItem of localSortConfigs) {
        const colIdx = columns.findIndex((c) => c.name === sortItem.column);
        if (colIdx === -1) continue;

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
  }, [rows, localSortConfigs, onSortChange, columns]);

  const isMultiPageInMemory = sortedRows.length > localPageSize;

  // Rows to display based on viewMode
  const displayedRows =
    viewMode === 'paged'
      ? isMultiPageInMemory
        ? sortedRows.slice((currentPage - 1) * localPageSize, currentPage * localPageSize)
        : sortedRows
      : sortedRows;


  // Visual rows in display order (displayed database rows first, then new added rows at bottom)
  const visualRows = useMemo(() => {
    const list: Array<{
      vIdx: number;
      rowId: number;
      isInsert: boolean;
      insertChange?: (typeof insertedChanges)[0];
      rowData?: any[];
      globalRowIndex?: number;
    }> = [];

    displayedRows.forEach((row, rIdx) => {
      const globalRowIndex =
        viewMode === 'paged'
          ? (currentPage - 1) * localPageSize + rIdx
          : (startOffset !== undefined ? startOffset + rIdx : rIdx);
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
  }, [displayedRows, insertedChanges, viewMode, currentPage, localPageSize, startOffset]);

  // Rectangular cell selection range
  const selectionRange = useMemo(() => {
    if (!selectionAnchor || !selectionFocus) return null;
    return {
      startR: Math.min(selectionAnchor.r, selectionFocus.r),
      endR: Math.max(selectionAnchor.r, selectionFocus.r),
      startC: Math.min(selectionAnchor.c, selectionFocus.c),
      endC: Math.max(selectionAnchor.c, selectionFocus.c),
    };
  }, [selectionAnchor, selectionFocus]);

  const isCellSelected = (vIdx: number, cIdx: number) => {
    if (!selectionRange) return false;
    return (
      vIdx >= selectionRange.startR &&
      vIdx <= selectionRange.endR &&
      cIdx >= selectionRange.startC &&
      cIdx <= selectionRange.endC
    );
  };

  // Restore initial scroll or scroll to target row on mount or workspace restore
  useEffect(() => {
    if (!hasRestoredScrollRef.current && containerRef.current && displayedRows.length > 0) {
      const st = initialScrollTop;
      const sl = initialScrollLeft;

      if (st !== undefined && st > 0) {
        containerRef.current.scrollTop = st;
      }
      if (sl !== undefined && sl > 0) {
        containerRef.current.scrollLeft = sl;
      }

      if (targetRowIndex !== undefined && targetRowIndex >= 0) {
        const matchIdx = visualRows.findIndex((vr) => vr.globalRowIndex === targetRowIndex);
        if (matchIdx !== -1) {
          setSelectionAnchor({ r: matchIdx, c: 0 });
          setSelectionFocus({ r: matchIdx, c: Math.min(columns.length - 1, 1) });
          if (st === undefined || st === 0) {
            scrollToCell(matchIdx, 0);
          }
        }
      }

      hasRestoredScrollRef.current = true;
    }
  }, [tabId, displayedRows.length, targetRowIndex, initialScrollTop, initialScrollLeft]);

  const selectedRowKeys = useMemo(() => {
    if (!selectionRange) return new Set<number>();
    const set = new Set<number>();
    for (let r = selectionRange.startR; r <= selectionRange.endR; r++) {
      const vr = visualRows[r];
      if (vr) set.add(vr.rowId);
    }
    return set;
  }, [selectionRange, visualRows]);

  const selectedRowIndex = useMemo(() => {
    if (!selectionFocus) return null;
    return visualRows[selectionFocus.r]?.rowId ?? null;
  }, [selectionFocus, visualRows]);

  // Active focused cell details for ValueViewerPanel
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

  const handleUpdateRef = useRef(handleUpdateCellFromValueViewer);
  handleUpdateRef.current = handleUpdateCellFromValueViewer;

  const prevCellRef = useRef<{
    tabId: string;
    r?: number;
    c?: number;
    colName?: string;
    rawValue: any;
  } | null>(null);

  // Sync active focused cell with the right sidebar Views tab
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

    useWorkbenchStore.getState().setActiveCellViewer({
      tabId,
      tableName,
      columnName: activeFocusedCell.columnName,
      columnType: activeFocusedCell.columnType,
      rowIndex: activeFocusedCell.rowIndex,
      columnIndex: activeFocusedCell.columnIndex,
      rawValue: activeFocusedCell.rawValue,
      onSave: (newVal) => handleUpdateRef.current(newVal),
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

  // Global mouseup to release cell drag selection and close context menu
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
      setSelectionAnchor({ r: vIdx, c: cIdx });
      setSelectionFocus({ r: vIdx, c: cIdx });
    }

    const menuWidth = 220;
    const menuHeight = 340;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

    setContextMenu({
      isOpen: true,
      x: Math.max(10, x),
      y: Math.max(10, y),
      vIdx,
      cIdx,
    });
  };

  const handleRowHeaderContextMenu = (e: React.MouseEvent, vIdx: number) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isCellSelected(vIdx, 0)) {
      setSelectionAnchor({ r: vIdx, c: 0 });
      setSelectionFocus({ r: vIdx, c: columns.length - 1 });
    }

    const menuWidth = 220;
    const menuHeight = 340;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

    setContextMenu({
      isOpen: true,
      x: Math.max(10, x),
      y: Math.max(10, y),
      vIdx,
      cIdx: 0,
    });
  };

  const getFormattedCopyText = (fmt?: CopyFormat) => {
    const targetFormat = fmt || useSettingsStore.getState().copyFormat || copyFormat || 'csv';
    if (!selectionRange || columns.length === 0) return '';
    const tbl = tableName || 'table_name';
    const isMySQL = (driver || '').toLowerCase() === 'mysql' || (driver || '').toLowerCase() === 'mariadb';
    const quoteIdent = (name: string) =>
      isMySQL ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`;
    const quotedTbl = tbl.includes('.')
      ? tbl.split('.').map((p) => quoteIdent(p)).join('.')
      : quoteIdent(tbl);

    const getVal = (vr: (typeof visualRows)[0], cIdx: number, colName: string) => {
      if (vr.isInsert) {
        const staged = vr.insertChange;
        return staged?.changes[colName] !== undefined
          ? staged.changes[colName]
          : (columns[cIdx]?.defaultValue ?? null);
      }
      const staged = stagedChanges[vr.globalRowIndex!];
      if (staged?.type === 'update' && staged.changes[colName] !== undefined) {
        return staged.changes[colName];
      }
      return vr.rowData?.[cIdx];
    };

    // 1. JSON
    if (targetFormat === 'json') {
      const list: Record<string, any>[] = [];
      for (let r = selectionRange.startR; r <= selectionRange.endR; r++) {
        const vr = visualRows[r];
        if (!vr) continue;
        const rowObj: Record<string, any> = {};
        for (let c = selectionRange.startC; c <= selectionRange.endC; c++) {
          const col = columns[c];
          if (!col) continue;
          rowObj[col.name] = getVal(vr, c, col.name);
        }
        list.push(rowObj);
      }
      return JSON.stringify(list, null, 2);
    }

    // 2. SQL INSERT
    if (targetFormat === 'sql_insert') {
      const selectedCols: ColumnMeta[] = [];
      for (let c = selectionRange.startC; c <= selectionRange.endC; c++) {
        if (columns[c]) selectedCols.push(columns[c]);
      }
      if (selectedCols.length === 0) return '';
      const colNames = selectedCols.map((c) => quoteIdent(c.name)).join(', ');
      const valueTuples: string[] = [];
      for (let r = selectionRange.startR; r <= selectionRange.endR; r++) {
        const vr = visualRows[r];
        if (!vr) continue;
        const vals = selectedCols.map((col, idx) => {
          const cIdx = selectionRange.startC + idx;
          const val = getVal(vr, cIdx, col.name);
          return formatSqlLiteral(val, col.dataType);
        });
        valueTuples.push(`  (${vals.join(', ')})`);
      }
      return `INSERT INTO ${quotedTbl} (${colNames})
VALUES
${valueTuples.join(',\n')};`;
    }

    // 3. SQL UPDATE
    if (targetFormat === 'sql_update') {
      const statements: string[] = [];
      for (let r = selectionRange.startR; r <= selectionRange.endR; r++) {
        const vr = visualRows[r];
        if (!vr) continue;

        const setClauses: string[] = [];
        for (let c = selectionRange.startC; c <= selectionRange.endC; c++) {
          const col = columns[c];
          if (!col) continue;
          const isPK = Boolean(col.isPrimaryKey || primaryKeys.includes(col.name));
          if (!isPK || selectionRange.startC === selectionRange.endC) {
            const val = getVal(vr, c, col.name);
            setClauses.push(`${quoteIdent(col.name)} = ${formatSqlLiteral(val, col.dataType)}`);
          }
        }

        let whereClause = '';
        if (primaryKeys.length > 0) {
          const pkConds: string[] = [];
          primaryKeys.forEach((pk) => {
            const cIdx = columns.findIndex((c) => c.name === pk);
            const colMeta = columns[cIdx];
            const pkVal = cIdx !== -1 ? getVal(vr, cIdx, pk) : undefined;
            if (pkVal !== undefined && pkVal !== null) {
              pkConds.push(`${quoteIdent(pk)} = ${formatSqlLiteral(pkVal, colMeta?.dataType)}`);
            }
          });
          if (pkConds.length > 0) {
            whereClause = pkConds.join(' AND ');
          }
        }

        if (!whereClause) {
          const fallbackConds: string[] = [];
          for (let c = selectionRange.startC; c <= selectionRange.endC; c++) {
            const col = columns[c];
            if (!col) continue;
            const val = getVal(vr, c, col.name);
            if (val === null || val === undefined) {
              fallbackConds.push(`${quoteIdent(col.name)} IS NULL`);
            } else {
              fallbackConds.push(`${quoteIdent(col.name)} = ${formatSqlLiteral(val, col.dataType)}`);
            }
          }
          whereClause = fallbackConds.join(' AND ');
        }

        statements.push(`UPDATE ${quotedTbl}
SET ${setClauses.join(', ')}
WHERE ${whereClause};`);
      }
      return statements.join('\n\n');
    }

    // 4. SQL UPSERT
    if (targetFormat === 'sql_upsert') {
      const selectedCols: ColumnMeta[] = [];
      for (let c = selectionRange.startC; c <= selectionRange.endC; c++) {
        if (columns[c]) selectedCols.push(columns[c]);
      }
      if (selectedCols.length === 0) return '';
      const colNames = selectedCols.map((c) => quoteIdent(c.name)).join(', ');
      const valueTuples: string[] = [];
      for (let r = selectionRange.startR; r <= selectionRange.endR; r++) {
        const vr = visualRows[r];
        if (!vr) continue;
        const vals = selectedCols.map((col, idx) => {
          const cIdx = selectionRange.startC + idx;
          const val = getVal(vr, cIdx, col.name);
          return formatSqlLiteral(val, col.dataType);
        });
        valueTuples.push(`  (${vals.join(', ')})`);
      }

      // Determine Primary / Conflict Keys
      const detectedPKs = primaryKeys.length > 0
        ? primaryKeys
        : columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

      const fallbackPK =
        columns.find((c) => /^id$/i.test(c.name))?.name ||
        selectedCols.find((c) => /^id$/i.test(c.name))?.name ||
        selectedCols[0]?.name ||
        'id';

      const effectivePKs = detectedPKs.length > 0 ? detectedPKs : [fallbackPK];

      // Non-PK columns to be updated upon collision
      const updateCols = selectedCols.filter((c) => !effectivePKs.includes(c.name));

      if (isMySQL) {
        // MySQL ON DUPLICATE KEY UPDATE
        const setClauses =
          updateCols.length > 0
            ? updateCols
                .map((c) => `  ${quoteIdent(c.name)} = VALUES(${quoteIdent(c.name)})`)
                .join(',\n')
            : `  ${quoteIdent(effectivePKs[0])} = ${quoteIdent(effectivePKs[0])}`;

        return `INSERT INTO ${quotedTbl} (${colNames})
VALUES
${valueTuples.join(',\n')}
ON DUPLICATE KEY UPDATE
${setClauses};`;
      }

      // PostgreSQL / SQLite ON CONFLICT (...) DO UPDATE SET ...
      const conflictTargets = effectivePKs.map((pk) => quoteIdent(pk)).join(', ');

      if (updateCols.length === 0) {
        return `INSERT INTO ${quotedTbl} (${colNames})
VALUES
${valueTuples.join(',\n')}
ON CONFLICT (${conflictTargets}) DO NOTHING;`;
      }

      const setClauses = updateCols
        .map((c) => `  ${quoteIdent(c.name)} = EXCLUDED.${quoteIdent(c.name)}`)
        .join(',\n');

      return `INSERT INTO ${quotedTbl} (${colNames})
VALUES
${valueTuples.join(',\n')}
ON CONFLICT (${conflictTargets}) DO UPDATE SET
${setClauses};`;
    }

    // 4. Default: CSV (RFC 4180 standard)
    const lines: string[] = [];
    const headerCols: string[] = [];
    for (let c = selectionRange.startC; c <= selectionRange.endC; c++) {
      if (columns[c]) {
        const name = columns[c].name;
        headerCols.push(
          name.includes(',') || name.includes('"') || name.includes('\n')
            ? `"${name.replace(/"/g, '""')}"`
            : name
        );
      }
    }
    lines.push(headerCols.join(','));

    for (let r = selectionRange.startR; r <= selectionRange.endR; r++) {
      const vr = visualRows[r];
      if (!vr) continue;
      const cellVals: string[] = [];
      for (let c = selectionRange.startC; c <= selectionRange.endC; c++) {
        const col = columns[c];
        if (!col) continue;
        const raw = getVal(vr, c, col.name);
        if (raw === null || raw === undefined) {
          cellVals.push('');
        } else {
          const s = String(raw);
          if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
            cellVals.push(`"${s.replace(/"/g, '""')}"`);
          } else {
            cellVals.push(s);
          }
        }
      }
      lines.push(cellVals.join(','));
    }
    return lines.join('\n');
  };

  const handleSetSelectedToNull = (targetVIdx?: number | null, targetCIdx?: number | null) => {
    let startR = selectionRange?.startR;
    let endR = selectionRange?.endR;
    let startC = selectionRange?.startC;
    let endC = selectionRange?.endC;

    if (startR === undefined || endR === undefined || startC === undefined || endC === undefined) {
      if (targetVIdx !== null && targetVIdx !== undefined && targetCIdx !== null && targetCIdx !== undefined) {
        startR = targetVIdx;
        endR = targetVIdx;
        startC = targetCIdx;
        endC = targetCIdx;
      } else {
        return;
      }
    }

    for (let r = startR; r <= endR; r++) {
      const vr = visualRows[r];
      if (!vr) continue;
      for (let c = startC; c <= endC; c++) {
        const col = columns[c];
        if (!col || col.isPrimaryKey || col.isAutoIncrement) continue;
        if (vr.isInsert) {
          stageCellUpdate(tabId, vr.rowId, {}, {}, col.name, null);
        } else {
          const originalRowValues: Record<string, unknown> = {};
          const rowInArray =
            vr.globalRowIndex !== undefined && vr.globalRowIndex >= (startOffset || 0)
              ? vr.globalRowIndex - (startOffset || 0)
              : (vr.globalRowIndex ?? 0);
          const targetRow = vr.rowData || rows[rowInArray];
          columns.forEach((colMeta, idx) => {
            originalRowValues[colMeta.name] = targetRow?.[idx];
          });
          const pkMap: Record<string, unknown> = {};
          primaryKeys.forEach((pk) => {
            const idx = columns.findIndex((colMeta) => colMeta.name === pk);
            if (idx !== -1) pkMap[pk] = targetRow?.[idx];
          });
          stageCellUpdate(tabId, vr.globalRowIndex!, pkMap, originalRowValues, col.name, null);
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

    // A. Check if SQL INSERT (e.g. from copyFormat = 'sql_insert' or 'sql_upsert')
    const sqlInsertResult = tryParseSqlInsert(trimmed);
    if (sqlInsertResult) {
      parsedRows = sqlInsertResult.rows;
      detectedHeaders = sqlInsertResult.headers;
    }

    // B. Check if SQL UPDATE (e.g. from copyFormat = 'sql_update')
    if (parsedRows.length === 0) {
      const sqlUpdateResult = tryParseSqlUpdate(trimmed);
      if (sqlUpdateResult) {
        parsedRows = sqlUpdateResult.rows;
        detectedHeaders = sqlUpdateResult.headers;
      }
    }

    // C. Check if JSON (e.g. from copyFormat = 'json')
    if (parsedRows.length === 0) {
      const jsonResult = tryParseJson(trimmed);
      if (jsonResult) {
        parsedRows = jsonResult.rows;
        detectedHeaders = jsonResult.headers;
      }
    }

    // D. Check if TSV or CSV
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
        // Standard CSV parser
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

    // Detect if first row is headers matching column names
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

    const startR = selectionRange
      ? selectionRange.startR
      : selectionAnchor
      ? selectionAnchor.r
      : 0;
    const endR = selectionRange
      ? selectionRange.endR
      : startR;
    const startC = selectionRange
      ? selectionRange.startC
      : selectionAnchor
      ? selectionAnchor.c
      : 0;
    const endC = selectionRange
      ? selectionRange.endC
      : startC;

    const selRowCount = Math.max(1, endR - startR + 1);
    const selColCount = Math.max(1, endC - startC + 1);
    const hasMultiSelect = Boolean(selectionRange && (selectionRange.endR > selectionRange.startR || selectionRange.endC > selectionRange.startC));

    let rowsToPaste: (string | null)[][] = parsedRows;

    // If user has multi-cell selection, expand clipboard data to fill the selected cells
    if (hasMultiSelect) {
      const srcRowCount = parsedRows.length;
      const srcColCount = parsedRows[0]?.length || 0;

      // Case A: Single cell copied (1x1) -> fill entire selected range with that single value
      if (srcRowCount === 1 && srcColCount === 1) {
        const singleVal = parsedRows[0][0];
        rowsToPaste = Array.from({ length: selRowCount }, () =>
          Array.from({ length: selColCount }, () => singleVal)
        );
      }
      // Case B: 1 row copied -> replicate row across all selected rows
      else if (srcRowCount === 1 && selRowCount > 1) {
        const templateRow = parsedRows[0];
        if (selColCount > templateRow.length && templateRow.length === 1) {
          const singleVal = templateRow[0];
          rowsToPaste = Array.from({ length: selRowCount }, () =>
            Array.from({ length: selColCount }, () => singleVal)
          );
        } else {
          rowsToPaste = Array.from({ length: selRowCount }, () => [...templateRow]);
        }
      }
      // Case C: Multi-row copied and selected area has more rows -> repeat rows modularly
      else if (selRowCount > srcRowCount) {
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

      const targetColMap: Array<{ colIdx: number; col: ColumnMeta; val: string | null }> = [];
      let mappedByHeader = false;

      // Only map by header if NOT multi-select (multi-selection targets the exact selected columns)
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

      // If headers didn't match or multi-selection, map positionally starting from startC
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

      // Target row exists in visualRows
      if (targetVIdx < visualRows.length) {
        const vr = visualRows[targetVIdx];
        if (vr.isInsert) {
          targetColMap.forEach(({ col, val }) => {
            if (col.isAutoIncrement) return;
            const finalVal = cleanPastedValue(val, col.dataType);
            stageCellUpdate(tabId, vr.rowId, {}, {}, col.name, finalVal);
          });
        } else {
          const originalRowValues: Record<string, unknown> = {};
          columns.forEach((c, idx) => {
            originalRowValues[c.name] = rows[vr.globalRowIndex!]?.[idx];
          });
          const pkMap: Record<string, unknown> = {};
          primaryKeys.forEach((pk) => {
            const idx = columns.findIndex((c) => c.name === pk);
            if (idx !== -1) pkMap[pk] = rows[vr.globalRowIndex!]?.[idx];
          });

          targetColMap.forEach(({ col, val }) => {
            if (col.isAutoIncrement) return;
            const finalVal = cleanPastedValue(val, col.dataType);
            stageCellUpdate(
              tabId,
              vr.globalRowIndex!,
              pkMap,
              originalRowValues,
              col.name,
              finalVal
            );
          });
        }
      } else {
        // Target row is beyond current rows: auto create a new staged inserted row at bottom!
        const newRowId = -(baseInsertId + (targetVIdx - visualRows.length));
        const initialValues: Record<string, unknown> = {};
        targetColMap.forEach(({ col, val }) => {
          if (col.isAutoIncrement) return;
          initialValues[col.name] = cleanPastedValue(val, col.dataType);
        });
        stageRowInsert(tabId, newRowId, initialValues);
      }
    });

    // Update selection range to highlight the newly pasted cells
    setSelectionAnchor({ r: startR, c: startC });
    setSelectionFocus({ r: maxAffectedVIdx, c: Math.min(columns.length - 1, maxAffectedCIdx) });
  };

  const handleCellMouseDown = (e: React.MouseEvent, vIdx: number, cIdx: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    if (editingCell) {
      handleFinishEdit();
    }

    if (e.shiftKey && selectionAnchor) {
      window.getSelection()?.removeAllRanges();
      setSelectionFocus({ r: vIdx, c: cIdx });
    } else {
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

    if (e.shiftKey && selectionAnchor) {
      window.getSelection()?.removeAllRanges();
      setSelectionFocus({ r: vIdx, c: columns.length - 1 });
    } else {
      isDraggingRef.current = true;
      setSelectionAnchor({ r: vIdx, c: 0 });
      setSelectionFocus({ r: vIdx, c: columns.length - 1 });
    }
  };

  const handleRowHeaderMouseEnter = (vIdx: number) => {
    if (isDraggingRef.current) {
      setSelectionFocus((prev) => (prev ? { r: vIdx, c: prev.c } : { r: vIdx, c: columns.length - 1 }));
    }
  };

  const handleDuplicateRow = () => {
    if (isReadOnly) return;
    if (editingCell) {
      handleFinishEdit();
    }

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
            if (!col.isAutoIncrement && staged.changes[col.name] !== undefined) {
              const rawVal = staged.changes[col.name];
              if (rawVal !== undefined && rawVal !== null) {
                initialValues[col.name] = cleanPastedValue(rawVal, col.dataType);
              }
            }
          });
        }
      } else {
        const sourceRow = rows[targetRowIndex];
        if (sourceRow) {
          const staged = latestStaged[targetRowIndex];
          columns.forEach((col, idx) => {
            if (!col.isAutoIncrement) {
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
    setSelectionAnchor({ r: startVIdx, c: 0 });
    setSelectionFocus({ r: startVIdx + newIds.length - 1, c: columns.length - 1 });

    setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }, 20);

    if (newIds.length === 1 && columns.length > 0) {
      const firstColIdx = columns.findIndex((c) => !c.isAutoIncrement);
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
      const pkMap: Record<string, unknown> = {};
      const originalRowValues: Record<string, unknown> = {};
      columns.forEach((c, ci) => {
        originalRowValues[c.name] = rows[idx]?.[ci];
      });
      primaryKeys.forEach((pk) => {
        const ci = columns.findIndex((c) => c.name === pk);
        if (ci !== -1) pkMap[pk] = rows[idx]?.[ci];
      });
      stageRowDelete(tabId, idx, pkMap, originalRowValues);
    });

    setSelectionAnchor(null);
    setSelectionFocus(null);
  };

  // Keyboard shortcuts: Range Copy (Ctrl+C), Apply (Ctrl+S), Duplicate (Ctrl+D), Delete, Cancel (Esc), Arrow Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
          if (stagedCount > 0) {
            setShowCancelConfirm(true);
          }
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

      // Shortcut: F7 to Toggle Result Panels (Value Panel)
      if (e.key === 'F7') {
        e.preventDefault();
        handleToggleValuePanel();
        return;
      }

      // Arrow keys / PageUp / PageDown / Home / End / Tab navigation across grid cells
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
            setSelectionAnchor({ r: nextR, c: nextC });
            setSelectionFocus({ r: nextR, c: nextC });
            scrollToCell(nextR, nextC);
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
            setSelectionAnchor({ r: newR, c: newC });
            setSelectionFocus({ r: newR, c: newC });
          }
          scrollToCell(newR, newC);
          return;
        }
      }

      const isMod = isMac ? e.metaKey : e.ctrlKey;

      // Enter to start editing selected cell
      if (!isTyping && !isMod && !e.shiftKey && e.key === 'Enter') {
        if (selectionFocus && visualRows.length > 0 && columns.length > 0 && !isReadOnly) {
          const vr = visualRows[selectionFocus.r];
          if (vr) {
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

      // Delete active / selected row(s)
      const isMacDelete = isMac && e.metaKey && (e.key === 'Backspace' || e.key === 'Delete');
      const isOtherDelete = !isMac && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Delete';

      if (!isTyping && (isMacDelete || isOtherDelete)) {
        e.preventDefault();
        handleDeleteActiveRow();
        return;
      }

      if (!isMod) return;

      if (isTyping && !target?.closest?.('[data-grid-container]')) {
        return;
      }

      // Select All
      if (e.key === 'a' || e.key === 'A') {
        if (!isTyping && visualRows.length > 0 && columns.length > 0) {
          e.preventDefault();
          setSelectionAnchor({ r: 0, c: 0 });
          setSelectionFocus({ r: visualRows.length - 1, c: columns.length - 1 });
          return;
        }
      }

      // Copy selected cells based on active copyFormat
      if (e.key === 'c' || e.key === 'C') {
        if (!isTyping && selectionRange && columns.length > 0) {
          e.preventDefault();
          const text = getFormattedCopyText();
          if (text) {
            navigator.clipboard.writeText(text);
          }
          return;
        }
      }

      // Shortcut: Apply (Ctrl+S on Linux/Win, Cmd+S on macOS)
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleApplyChanges();
        return;
      }

      // Paste selected cells / multi rows (Ctrl+V on Linux/Win, Cmd+V on macOS)
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

      // Shortcut: Add Row (Ctrl+I on Linux/Win, Cmd+I on macOS)
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        handleAddRow();
        return;
      }

      // Shortcut: Duplicate (Ctrl+D on Linux/Win, Cmd+D on macOS)
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        handleDuplicateRow();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabId, isMac, isReadOnly, editingCell, editVal, columns, rows, selectionAnchor, selectionFocus, selectionRange, visualRows, selectedRowKeys, onSubmitChanges, stagedCount, showCancelConfirm, copyFormat, tableName, primaryKeys, driver, frozenColumns, colWidths]);

  // Global clipboard copy event to ensure Ctrl+C always outputs the selected format
  useEffect(() => {
    const handleNativeCopy = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (isTyping) return;

      if (selectionRange && columns.length > 0) {
        const text = getFormattedCopyText();
        if (text) {
          e.preventDefault();
          e.clipboardData?.setData('text/plain', text);
        }
      }
    };

    const handleNativePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (isTyping) return;

      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        e.preventDefault();
        handlePasteData(text);
      }
    };

    window.addEventListener('copy', handleNativeCopy);
    window.addEventListener('paste', handleNativePaste);
    return () => {
      window.removeEventListener('copy', handleNativeCopy);
      window.removeEventListener('paste', handleNativePaste);
    };
  }, [selectionRange, columns, visualRows, stagedChanges, tableName, primaryKeys, copyFormat, driver]);
  const currentOffset = (currentPage - 1) * localPageSize;
  const startRow = displayedRows.length === 0 ? 0 : currentOffset + 1;
  const endRow = currentOffset + displayedRows.length;

  // Determine effective total rows:
  // 1. If explicit totalCount is provided and >= endRow, use it.
  // 2. If client-side multi-page in memory, use rows.length.
  // 3. If !hasMore (we reached the end of the dataset), total is EXACTLY endRow!
  // 4. Otherwise, total is at least endRow + 1.
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

  // Reset page when pageSize changes (only for client-side pagination)
  useEffect(() => {
    if (!onPageChange) {
      setCurrentPage(1);
    }
  }, [localPageSize, onPageChange]);

  // Scroll listener for horizontal sticky separator, workspace scroll tracking, and bidirectional infinite scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const sl = e.currentTarget.scrollLeft;
    if (sl > 0 !== isScrolledX) {
      setIsScrolledX(sl > 0);
    }
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;

    // Track scroll position and approximate visible database row for workspace auto-save
    const rowHeight = 28;
    const visibleRowOffset = Math.max(0, Math.floor(scrollTop / rowHeight));
    const approxRowIndex = (startOffset || 0) + visibleRowOffset;

    latestScrollStateRef.current = {
      scrollTop,
      scrollLeft: sl,
      rowIndex: approxRowIndex,
    };

    if (onScrollChangeRef.current) {
      if (debouncedScrollTimerRef.current) {
        clearTimeout(debouncedScrollTimerRef.current);
      }
      debouncedScrollTimerRef.current = setTimeout(() => {
        onScrollChangeRef.current?.(scrollTop, sl, approxRowIndex);
      }, 200);
    }

    if (viewMode !== 'infinite') return;

    // Downward infinite scroll (Load Next Batch)
    if (hasMore && !isLoadingMore && onLoadMore) {
      if (scrollHeight - scrollTop - clientHeight < 250) {
        onLoadMore();
      }
    }

    // Upward infinite scroll (Load Previous Batch)
    if (hasPrevious && !isLoadingPrevious && onLoadPrevious) {
      if (scrollTop < 150) {
        scrollAdjustRef.current = {
          prevScrollHeight: scrollHeight,
          prevScrollTop: scrollTop,
        };
        onLoadPrevious();
      }
    }
  };

  const handleNavigatePage = (targetPage: number) => {
    const maxPage = isExactTotalKnown ? totalPages : Math.max(totalPages, targetPage);
    const clamped = Math.max(1, Math.min(targetPage, maxPage));
    setCurrentPage(clamped);
    if (onPageChange) {
      onPageChange(clamped);
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setLocalPageSize(newSize);
    setCurrentPage(1);
    onPageSizeChange?.(newSize);
  };

  // Only borders are tinted by environment; backgrounds stay neutral.
  // Thick frame around the whole grid + tinted toolbars; grid body stays neutral.
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
      {/* Table Toolbar */}
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
              <button
                onClick={handleAddRow}
                className="flex h-7 w-7 items-center justify-center rounded bg-[#22242c] hover:bg-[#2b2d37] text-zinc-300 transition-colors cursor-pointer"
                title={`Add New Row (${modKey}+I)`}
              >
                <Plus className="h-4 w-4 text-emerald-400" />
              </button>

              <button
                onClick={handleDuplicateRow}
                className="flex h-7 w-7 items-center justify-center rounded bg-[#22242c] hover:bg-[#2b2d37] text-zinc-300 transition-colors cursor-pointer"
                title={`Duplicate Selected Row (${modKey}+D)`}
              >
                <Copy className="h-3.5 w-3.5 text-sky-400" />
              </button>

              <button
                onClick={handleDeleteActiveRow}
                className="flex h-7 w-7 items-center justify-center rounded bg-[#22242c] hover:bg-[#2b2d37] text-zinc-300 transition-colors cursor-pointer"
                title={`Delete Active Row (${isMac ? 'Cmd+Backspace' : 'Delete'})`}
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-400" />
              </button>
            </>
          )}

          {rawSql && (
            <button
              type="button"
              onClick={handleCopyRawSql}
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
                  <span className="text-[11px] font-semibold text-emerald-300">Copied SQL!</span>
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
                title="Preview SQL DML"
              >
                <Eye className="h-4 w-4" />
              </button>

              <button
                onClick={handleApplyChanges}
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
                onClick={() => setShowCancelConfirm(true)}
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
          {/* SQL WHERE Filter Bar (Only for Table Tabs - Takes full available space) */}
          {(isTableTab || onApplyWhere) && (
            <div
              ref={whereContainerRef}
              className="relative flex-1 min-w-[200px]"
            >
              <div className="relative flex items-center">
                <div className="absolute left-2.5 flex items-center gap-1 pointer-events-none select-none">
                  <Filter className="h-3 w-3 text-blue-400" />
                  <span className="text-[10px] font-mono font-bold text-blue-400 uppercase tracking-wider">
                    WHERE
                  </span>
                </div>
                <input
                  ref={whereInputRef}
                  type="text"
                  data-where-input="true"
                  placeholder="condition, e.g. status = 'active' AND id > 10 (Enter to filter)"
                  value={whereInput}
                  onChange={(e) => {
                    setWhereInput(e.target.value);
                    setWhereCursorPos(e.target.selectionStart ?? e.target.value.length);
                    setShowWhereSuggestions(true);
                  }}
                  onFocus={() => {
                    setShowWhereSuggestions(true);
                  }}
                  onClick={(e) => {
                    setWhereCursorPos((e.target as HTMLInputElement).selectionStart ?? whereInput.length);
                  }}
                  onKeyUp={(e) => {
                    setWhereCursorPos((e.target as HTMLInputElement).selectionStart ?? whereInput.length);
                  }}
                  onKeyDown={handleWhereKeyDown}
                  className="h-7 w-full rounded bg-[#121317] pl-[68px] pr-14 text-[11px] text-zinc-100 font-mono border border-[#272932] focus:border-blue-500 focus:bg-[#16171d] focus:outline-none placeholder:text-zinc-600 shadow-inner"
                />

                <div className="absolute right-1.5 flex items-center gap-1">
                  {whereInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setWhereInput('');
                        setShowWhereSuggestions(false);
                        onApplyWhere?.('');
                      }}
                      className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] cursor-pointer"
                      title="Clear WHERE filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowWhereSuggestions(false);
                      onApplyWhere?.(whereInput);
                    }}
                    className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-medium font-sans cursor-pointer transition-colors shadow-xs"
                    title="Apply WHERE condition (Enter)"
                  >
                    Filter
                  </button>
                </div>
              </div>

              {/* Autocomplete Suggestion Popup */}
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
                          applyWhereSuggestion(item);
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

          {/* Right Chips: Multi-Sort & Frozen Columns */}
          {(localSortConfigs.length > 0 || frozenColumns.length > 0) && (
            <div className="flex items-center gap-2 shrink-0">
              {localSortConfigs.length > 0 && (
                <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-[#101115] border border-[#2b2e3a] text-[11px] font-mono select-none">
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
                            const next = localSortConfigs.filter((s) => s.column !== sc.column);
                            setLocalSortConfigs(next);
                            onSortChange?.(next);
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
                        onClick={() => setShowAllSortsModal(true)}
                        className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#1e2029] hover:bg-[#282b37] border border-blue-500/40 text-[10px] text-blue-300 font-mono font-bold cursor-pointer transition-colors"
                        title={`View all ${localSortConfigs.length} sorted columns (${localSortConfigs.length - 2} more)`}
                      >
                        ...
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleClearAllSort}
                    className="p-0.5 rounded hover:bg-rose-950/40 text-rose-500 hover:text-rose-400 transition-colors cursor-pointer ml-0.5"
                    title="Clear all column sorting"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Frozen Columns Chips */}
              {frozenColumns.length > 0 && (
                <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-[#101115] border border-cyan-800/40 text-[11px] font-mono select-none">
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
                            handleToggleFreeze(colName);
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
                        onClick={() => setShowAllFrozenModal(true)}
                        className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#0d222b] hover:bg-[#13303d] border border-cyan-500/40 text-[10px] text-cyan-300 font-mono font-bold cursor-pointer transition-colors"
                        title={`View all ${frozenColumns.length} frozen columns (${frozenColumns.length - 2} more)`}
                      >
                        ...
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFrozenColumns([]);
                      onFrozenColumnsChange?.([]);
                    }}
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
      </div>



      {/* Error Banner when query or WHERE filter fails */}
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

      {/* Grid Table & Side Value Panel Container */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Grid Table Container */}
        <div
          ref={containerRef}
          tabIndex={0}
          onScroll={handleScroll}
          className="flex-1 overflow-auto min-h-0 relative outline-none focus:ring-1 focus:ring-blue-500/20"
        >
        <table
          className="border-collapse font-mono text-[12px] text-zinc-300 min-w-full"
          style={{ tableLayout: 'fixed', width: 'max-content' }}
        >
          <colgroup>
            {columns.map((col) => {
              const w = colWidths[col.name] || 120;
              return <col key={col.name} style={{ width: `${w}px`, minWidth: `${w}px` }} />;
            })}
            <col style={{ width: 'auto' }} />
          </colgroup>
          <thead className={`sticky top-0 ${gridTheadBg} shadow-sm z-30`}>
            <tr className={`border-b ${gridCellBorder}`}>
              {columns.map((col, cIdx) => {
                const isPK = Boolean(col.isPrimaryKey || primaryKeys.includes(col.name));
                const sortIndex = localSortConfigs.findIndex((s) => s.column === col.name);
                const isSorted = sortIndex !== -1;
                const sortItem = isSorted ? localSortConfigs[sortIndex] : null;
                const isFrozen = frozenColumns.includes(col.name);
                const isLastFrozen = col.name === lastFrozenColName;
                const stickyLeft = isFrozen ? frozenOffsets[col.name] : undefined;
                const w = colWidths[col.name] || 120;

              
  return (
                  <th
                    key={col.name}
                    ref={(el) => {
                      thRefs.current[col.name] = el;
                    }}
                    onClick={(e) => {
                      if (isResizingRef.current) return;
                      if (e.altKey) {
                        handleToggleFreeze(col.name);
                        return;
                      }
                      handleToggleSort(col.name, e);
                    }}
                    onMouseEnter={(e) => handleColMouseEnter(e, col, isPK)}
                    onMouseLeave={handleColMouseLeave}
                    className={`relative px-3 py-1.5 text-left font-semibold border-r ${gridCellBorder} text-zinc-200 group/th select-none ${
                      isFrozen ? `sticky z-40 ${gridTheadBg}` : ''
                    } ${
                      isLastFrozen && isScrolledX
                        ? 'border-r-2 border-r-cyan-500/50 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.5)]'
                        : ''
                    } ${
                      envType === 'prod'
                        ? 'hover:bg-rose-950/60'
                        : envType === 'dev'
                        ? 'hover:bg-emerald-950/60'
                        : 'hover:bg-[#1c1d28]'
                    } transition-colors cursor-pointer`}
                    style={{
                      width: `${w}px`,
                      minWidth: `${w}px`,
                      maxWidth: `${w}px`,
                      ...(isFrozen && stickyLeft !== undefined ? { left: stickyLeft } : {}),
                    }}
                  >
                    <div className="flex items-center justify-between gap-1.5 min-w-0">
                      <div className="flex items-center gap-1.5 truncate min-w-0 flex-1">
                        {isPK && (
                          <Key className="h-3 w-3 text-amber-400 fill-amber-400/30 shrink-0" />
                        )}
                        <span className="truncate font-semibold text-zinc-200 group-hover/th:text-white transition-colors">
                          {col.name}
                        </span>
                      </div>

                      {/* Header Actions: Freeze & Sort */}
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Freeze Indicator / Button */}
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

                        {/* Sort Indicator / Button */}
                        {isSorted && sortItem ? (
                          <span
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-600/25 text-blue-400 text-[10px] font-mono border border-blue-500/30 shadow-xs"
                            title={`Sorted ${sortItem.direction === 'asc' ? 'A → Z (ASC)' : 'Z → A (DESC)'}${localSortConfigs.length > 1 ? ` (priority #${sortIndex + 1})` : ''}`}
                          >
                            {sortItem.direction === 'asc' ? (
                              <ArrowDownAZ className="h-3.5 w-3.5 stroke-[2]" />
                            ) : (
                              <ArrowDownZA className="h-3.5 w-3.5 stroke-[2] text-amber-400" />
                            )}
                            {localSortConfigs.length > 1 && (
                              <span
                                className="flex items-center justify-center h-3.5 w-3.5 rounded-full bg-blue-500 text-white text-[9px] font-bold font-mono ml-0.5"
                              >
                                {sortIndex + 1}
                              </span>
                            )}
                          </span>
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-zinc-500 opacity-0 group-hover/th:opacity-75 transition-opacity" />
                        )}
                      </div>
                    </div>

                    {/* Column Resizer Divider */}
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
              {/* Dummy header cell for remaining horizontal space */}
              <th className={`p-0 border-none ${gridTheadBg}`} />
            </tr>
          </thead>
          <tbody>
            {displayedRows.length === 0 && insertedChanges.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="py-12 text-center text-zinc-500 font-sans">
                  {errorMessage ? (
                    <div className="max-w-lg mx-auto flex flex-col items-center gap-2.5 text-rose-400/90 font-mono text-xs select-text">
                      <div className="flex items-center gap-2 font-semibold text-rose-300">
                        <AlertCircle className="h-4 w-4 text-rose-400" />
                        <span>Query Execution Error</span>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed max-w-md">
                        {errorMessage}
                      </p>
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
                </td>
              </tr>
            ) : (
              <>
                {/* 0. Top Load Previous Rows Banner */}
                {hasPrevious && (
                  <tr className="bg-[#121318] border-b border-[#22242c] hover:bg-[#181a22] transition-colors">
                    <td
                      colSpan={columns.length + 1}
                      className="py-1 px-3 text-center"
                      style={{ position: 'sticky', left: 0 }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (containerRef.current) {
                            scrollAdjustRef.current = {
                              prevScrollHeight: containerRef.current.scrollHeight,
                              prevScrollTop: containerRef.current.scrollTop,
                            };
                          }
                          onLoadPrevious?.();
                        }}
                        disabled={isLoadingPrevious}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 hover:text-blue-300 text-[11px] font-medium border border-blue-500/30 cursor-pointer transition-colors shadow-xs"
                        title="Load previous batch of rows"
                      >
                        {isLoadingPrevious ? (
                          <RefreshCw className="h-3 w-3 animate-spin text-blue-400" />
                        ) : (
                          <ArrowUpCircle className="h-3 w-3" />
                        )}
                        <span>
                          {isLoadingPrevious
                            ? 'Loading previous rows...'
                            : `Load previous rows (${Math.min(localPageSize, startOffset || 0)} rows above)`}
                        </span>
                      </button>
                    </td>
                  </tr>
                )}

                {/* 1. Existing Database Rows */}
                {displayedRows.map((row, rIdx) => {
                  const globalRowIndex =
                    viewMode === 'paged'
                      ? (currentPage - 1) * localPageSize + rIdx
                      : (startOffset !== undefined ? startOffset + rIdx : rIdx);
                  const vIdx = rIdx;
                  const staged = stagedChanges[globalRowIndex];
                  const isDeleted = staged?.type === 'delete';

                  let rowClass = gridRowClass;
                  if (isDeleted) rowClass += ' bg-rose-950/20 text-zinc-500 line-through';

                
  return (
                    <tr
                      key={globalRowIndex}
                      className={`${rowClass} group/row`}
                    >
                      {columns.map((col, cIdx) => {
                        const isSelected = isCellSelected(vIdx, cIdx);
                        const isEditing = editingCell?.rowIndex === globalRowIndex && editingCell?.colIndex === cIdx;
                        const hasColChange = staged?.type === 'update' && staged.changes[col.name] !== undefined;
                        const displayVal = hasColChange ? staged.changes[col.name] : row[cIdx];
                        const colInputType = getColumnInputType(col.dataType);
                        const isFrozen = frozenColumns.includes(col.name);
                        const isLastFrozen = col.name === lastFrozenColName;
                        const stickyLeft = isFrozen ? frozenOffsets[col.name] : undefined;
                        const w = colWidths[col.name] || 120;

                      
  return (
                          <td
                            key={col.name}
                            data-vidx={vIdx}
                            data-cidx={cIdx}
                            onMouseDown={(e) => handleCellMouseDown(e, vIdx, cIdx)}
                            onMouseEnter={() => handleCellMouseEnter(vIdx, cIdx)}
                            onContextMenu={(e) => handleCellContextMenu(e, vIdx, cIdx)}
                            onDoubleClick={() => handleStartEdit(globalRowIndex, cIdx, displayVal)}
                            className={`px-3 py-1 border-r ${gridCellBorder} truncate select-none transition-colors ${
                              isFrozen
                                ? `sticky z-10 ${
                                    isSelected
                                      ? 'bg-[#1b4ea3] text-white font-medium'
                                      : hasColChange
                                      ? 'bg-blue-900/40 text-blue-200 font-medium'
                                      : isDeleted
                                      ? 'bg-rose-950/40 text-zinc-500 line-through'
                                      : 'bg-[#14151a] group-hover/row:bg-[#20222a]'
                                  }`
                                : isSelected
                                ? 'bg-[#1b4ea3] text-white font-medium'
                                : hasColChange
                                ? 'bg-blue-900/30 text-blue-200 font-medium'
                                : ''
                            } ${
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
                          >
                            {isEditing ? (
                              <input
                                type={colInputType === 'text' ? 'text' : colInputType}
                                step={colInputType === 'datetime-local' || colInputType === 'time' ? '1' : undefined}
                                autoFocus
                                ref={(el) => {
                                  if (colInputType !== 'text') {
                                    try { el?.showPicker?.(); } catch {}
                                  }
                                }}
                                value={editVal}
                                onChange={(e) => setEditVal(e.target.value)}
                                onBlur={handleFinishEdit}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleFinishEdit();
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setEditingCell(null);
                                    if (stagedCount > 0) {
                                      setShowCancelConfirm(true);
                                    }
                                  }
                                  if (e.key === 'Tab') {
                                    e.preventDefault();
                                    handleFinishEdit();
                                    const nextCol = (cIdx + 1) % columns.length;
                                    const nextVIdx = nextCol === 0 ? Math.min(visualRows.length - 1, vIdx + 1) : vIdx;
                                    const nextVr = visualRows[nextVIdx];
                                    setSelectionAnchor({ r: nextVIdx, c: nextCol });
                                    setSelectionFocus({ r: nextVIdx, c: nextCol });
                                    scrollToCell(nextVIdx, nextCol);
                                    setTimeout(() => {
                                      if (nextVr) {
                                        const nextColMeta = columns[nextCol];
                                        const stagedNext = stagedChanges[nextVr.globalRowIndex!];
                                        const nextVal =
                                          stagedNext?.type === 'update' && stagedNext.changes[nextColMeta.name] !== undefined
                                            ? stagedNext.changes[nextColMeta.name]
                                            : nextVr.rowData?.[nextCol];
                                        handleStartEdit(nextVr.rowId, nextCol, nextVal ?? '');
                                      }
                                    }, 10);
                                  }
                                }}
                                className={`[color-scheme:dark] w-full bg-[#121317] border border-blue-500 px-1 py-0.5 text-white outline-none rounded ${
                                  colInputType !== 'text' ? 'cursor-pointer' : ''
                                }`}
                              />
                            ) : displayVal === null || displayVal === undefined ? (
                              <span className={isSelected ? "text-blue-200/80 italic" : "text-zinc-600 italic"}>NULL</span>
                            ) : (
                              colInputType !== 'text' ? String(displayVal).replace('T', ' ').replace(/Z$/, '') : String(displayVal)
                            )}
                          </td>
                        );
                      })}
                      <td className="p-0 border-none pointer-events-none" />
                    </tr>
                  );
                })}

                {/* 2. Staged Inserted Rows (at bottom of grid) */}
                {insertedChanges.map((change, insIdx) => {
                  const vIdx = displayedRows.length + insIdx;
                  const rowClass = 'border-b border-emerald-800/40 bg-emerald-950/25 hover:bg-emerald-900/35 border-l-4 border-l-emerald-500 transition-colors group/insert';

                
  return (
                    <tr
                      key={change.rowIndex}
                      className={rowClass}
                    >
                      {columns.map((col, cIdx) => {
                        const isSelected = isCellSelected(vIdx, cIdx);
                        const isEditing = editingCell?.rowIndex === change.rowIndex && editingCell?.colIndex === cIdx;
                        const colVal = change.changes[col.name];
                        const isSet = colVal !== undefined;
                        const displayVal = isSet ? colVal : (col.defaultValue || null);
                        const colInputType = getColumnInputType(col.dataType);
                        const isFrozen = frozenColumns.includes(col.name);
                        const isLastFrozen = col.name === lastFrozenColName;
                        const stickyLeft = isFrozen ? frozenOffsets[col.name] : undefined;
                        const w = colWidths[col.name] || 120;

                      
  return (
                          <td
                            key={col.name}
                            data-vidx={vIdx}
                            data-cidx={cIdx}
                            onMouseDown={(e) => handleCellMouseDown(e, vIdx, cIdx)}
                            onMouseEnter={() => handleCellMouseEnter(vIdx, cIdx)}
                            onContextMenu={(e) => handleCellContextMenu(e, vIdx, cIdx)}
                            onDoubleClick={() => {
                              if (!isEditing) {
                                handleStartEdit(change.rowIndex, cIdx, displayVal ?? '');
                              }
                            }}
                            className={`px-3 py-1 border-r border-[#22242c] truncate cursor-text select-none transition-colors ${
                              isFrozen
                                ? `sticky z-10 ${
                                    isSelected
                                      ? 'bg-[#1b4ea3] text-white font-medium'
                                      : isSet
                                      ? 'bg-emerald-900/50 text-emerald-100 font-medium'
                                      : 'bg-[#0d1e17] group-hover/insert:bg-[#132b21] text-zinc-500'
                                  }`
                                : isSelected
                                ? 'bg-[#1b4ea3] text-white font-medium'
                                : isSet
                                ? 'bg-emerald-900/40 text-emerald-100 font-medium'
                                : 'text-zinc-500'
                            } ${
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
                            title="Click to select, double click to edit"
                          >
                            {isEditing ? (
                              <input
                                type={colInputType === 'text' ? 'text' : colInputType}
                                step={colInputType === 'datetime-local' || colInputType === 'time' ? '1' : undefined}
                                autoFocus
                                ref={(el) => {
                                  if (colInputType !== 'text') {
                                    try { el?.showPicker?.(); } catch {}
                                  }
                                }}
                                value={editVal}
                                onChange={(e) => setEditVal(e.target.value)}
                                onBlur={handleFinishEdit}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleFinishEdit();
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setEditingCell(null);
                                    if (stagedCount > 0) {
                                      setShowCancelConfirm(true);
                                    }
                                  }
                                  if (e.key === 'Tab') {
                                    e.preventDefault();
                                    handleFinishEdit();
                                    const nextCol = (cIdx + 1) % columns.length;
                                    const nextVIdx = nextCol === 0 ? Math.min(visualRows.length - 1, vIdx + 1) : vIdx;
                                    const nextVr = visualRows[nextVIdx];
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
                                  }
                                }}
                                className={`[color-scheme:dark] w-full bg-[#101115] border border-emerald-500 px-1 py-0.5 text-white outline-none rounded font-mono text-xs shadow-inner ${
                                  colInputType !== 'text' ? 'cursor-pointer' : ''
                                }`}
                              />
                            ) : displayVal === null || displayVal === undefined || displayVal === '' ? (
                              <span className={isSelected ? "text-blue-200/80 italic" : "text-zinc-600 italic"}>
                                {col.isAutoIncrement ? '(Auto)' : 'NULL'}
                              </span>
                            ) : (
                              colInputType !== 'text' ? String(displayVal).replace('T', ' ').replace(/Z$/, '') : String(displayVal)
                            )}
                          </td>
                        );
                      })}
                      <td className="p-0 border-none pointer-events-none" />
                    </tr>
                  );
                })}
              </>
            )}          </tbody>
        </table>
      </div>
    </div>

      {/* Pagination Footer */}
      <div className={`flex h-9 items-center justify-between border-t px-3 ${gridBarBg} text-zinc-400 text-xs shrink-0 select-none`}>
        {/* Left: Row Count Info */}
        <div className="flex items-center gap-2 font-sans text-[11px]">
          {viewMode === 'paged' ? (
            (() => {
              const totalDisplay = isExactTotalKnown ? String(effectiveTotal) : `${endRow}+`;

            
  return (
                <span>
                  Showing <strong className="text-zinc-200">{startRow}</strong> –{' '}
                  <strong className="text-zinc-200">{endRow}</strong> of{' '}
                  <strong className="text-zinc-200">{totalDisplay}</strong> rows
                </span>
              );
            })()
          ) : (
            <div className="flex items-center gap-2">
              <span>
                Loaded <strong className="text-zinc-200">{rows.length}</strong>
                {isExactTotalKnown ? (
                  <> of <strong className="text-zinc-200">{effectiveTotal}</strong></>
                ) : hasMore ? (
                  <>+ rows</>
                ) : null}{' '}
                rows
                {startOffset !== undefined && startOffset > 0 && (
                  <span className="text-zinc-500 text-[10px] ml-1">
                    (from #{startOffset + 1})
                  </span>
                )}
              </span>
              {hasPrevious && onLoadPrevious && (
                <button
                  type="button"
                  onClick={() => {
                    if (containerRef.current) {
                      scrollAdjustRef.current = {
                        prevScrollHeight: containerRef.current.scrollHeight,
                        prevScrollTop: containerRef.current.scrollTop,
                      };
                    }
                    onLoadPrevious();
                  }}
                  disabled={isLoadingPrevious}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 hover:text-blue-300 text-[10px] font-medium border border-blue-500/30 cursor-pointer ml-1 transition-colors"
                  title="Click to load previous batch"
                >
                  {isLoadingPrevious ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <ArrowUpCircle className="h-3 w-3" />
                  )}
                  <span>Prev</span>
                </button>
              )}
              {hasMore && onLoadMore && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={isLoadingMore}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 hover:text-blue-300 text-[10px] font-medium border border-blue-500/30 cursor-pointer ml-1 transition-colors"
                  title="Click to load next batch"
                >
                  {isLoadingMore ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <ArrowDownCircle className="h-3 w-3" />
                  )}
                  <span>+{localPageSize} more</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Center: Paged Navigation Controls (if Paged Mode) */}
        {viewMode === 'paged' ? (
          <div className="flex items-center gap-1 font-mono">
            <button
              onClick={() => handleNavigatePage(1)}
              disabled={currentPage <= 1 || isLoadingMore}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title="First Page"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handleNavigatePage(currentPage - 1)}
              disabled={currentPage <= 1 || isLoadingMore}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title="Previous Page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>

            <span className="px-2 text-zinc-300 font-sans text-[11px] flex items-center gap-1">
              <span>Page</span>
              <strong className="text-white font-mono">{currentPage}</strong>
              <span>of</span>
              <strong className="text-white font-mono">
                {totalPages}{!isExactTotalKnown ? '+' : ''}
              </strong>
              {isLoadingMore && <RefreshCw className="h-3 w-3 animate-spin text-blue-400 ml-1" />}
            </span>

            <button
              onClick={() => handleNavigatePage(currentPage + 1)}
              disabled={(isExactTotalKnown ? currentPage >= totalPages : !hasMore) || isLoadingMore}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title="Next Page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handleNavigatePage(totalPages)}
              disabled={!isExactTotalKnown || currentPage >= totalPages || isLoadingMore}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title={isExactTotalKnown ? `Last Page (${totalPages})` : 'Last page unknown until end reached'}
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-zinc-500 font-sans text-[11px]">
            {isLoadingPrevious ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin text-blue-400" />
                <span className="text-blue-400">Loading previous...</span>
              </>
            ) : isLoadingMore ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin text-blue-400" />
                <span className="text-blue-400">Loading more...</span>
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                <span>Lazy Load Active</span>
              </>
            )}
          </div>
        )}

        {/* Right: Batch Size Selector (Opens Upward) */}
        <div className="relative flex items-center gap-2" ref={batchSizeRef}>
          <span className="text-zinc-400 font-sans text-[11px] font-medium">Batch size:</span>
          <button
            type="button"
            onClick={() => setIsBatchSizeOpen((prev) => !prev)}
            className="flex items-center gap-1.5 h-6 rounded bg-[#22242c] hover:bg-[#2c303c] border border-[#3b3e4f] px-2 text-[11px] font-mono font-medium text-amber-300 hover:text-amber-200 transition-colors cursor-pointer shadow-xs"
            title="Batch size per page or lazy load batch (opens upward)"
          >
            <span>{localPageSize} rows</span>
            <ChevronUp
              className={`h-3 w-3 text-zinc-400 transition-transform duration-150 ${
                isBatchSizeOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isBatchSizeOpen && (
            <div className="absolute bottom-full right-0 mb-1.5 min-w-[130px] rounded-md border border-[#3b3e4f] bg-[#191a20] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 border-b border-[#272932] mb-1 flex items-center justify-between">
                <span>Batch Size</span>
                <span className="font-mono text-zinc-500 text-[9px]">LIMIT</span>
              </div>
              {Array.from(new Set([25, 50, 100, 250, 500, globalDefaultPageSize, localPageSize]))
                .sort((a, b) => a - b)
                .map((size) => {
                const isSelected = size === localPageSize;
              
  return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      handlePageSizeChange(size);
                      setIsBatchSizeOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-2.5 py-1.5 rounded cursor-pointer text-xs font-mono transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white font-bold'
                        : 'text-zinc-200 hover:bg-[#2c303c] hover:text-white'
                    }`}
                  >
                    <span>{size} rows</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-white shrink-0 ml-2" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Column Hover Metadata Popover Card */}
      {hoveredCol && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border border-[#3b3e4f] bg-[#16171f]/95 backdrop-blur-md shadow-2xl p-3 text-xs font-sans min-w-[220px] max-w-[320px] animate-in fade-in zoom-in-95 duration-100"
          style={{ top: hoveredCol.y, left: hoveredCol.x }}
        >
          {/* Header: Name + PK Badge */}
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
          </div>

          {/* Metadata Rows */}
          <div className="space-y-1.5 text-[11px]">
            {/* Data Type */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">Data Type:</span>
              <span className="font-mono font-medium text-blue-400 uppercase bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-900/40">
                {hoveredCol.col.dataType || 'UNKNOWN'}
              </span>
            </div>

            {/* Size / Length if extracted */}
            {hoveredCol.details.size && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500">Length / Size:</span>
                <span className="font-mono text-zinc-300">{hoveredCol.details.size}</span>
              </div>
            )}

            {/* Nullable */}
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

            {/* Auto Increment */}
            {hoveredCol.col.isAutoIncrement && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500">Extra:</span>
                <span className="font-mono text-emerald-400 text-[10px]">auto_increment</span>
              </div>
            )}

            {/* Default Value */}
            {hoveredCol.col.defaultValue !== undefined && hoveredCol.col.defaultValue !== '' && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500">Default:</span>
                <span className="font-mono text-zinc-400 truncate max-w-[150px]">
                  {hoveredCol.col.defaultValue}
                </span>
              </div>
            )}

            {/* Comment / Description */}
            {hoveredCol.col.comment && (
              <div className="mt-2 pt-2 border-t border-[#272932]">
                <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-0.5">
                  Description
                </div>
                <div className="text-zinc-300 text-[11px] leading-relaxed italic">
                  {hoveredCol.col.comment}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cancel Changes Confirmation Modal */}
      {showCancelConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setShowCancelConfirm(false)}
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
                <h3 className="text-sm font-semibold text-zinc-100">
                  Discard Staged Changes?
                </h3>
                <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                  There are <span className="font-semibold text-rose-300 font-mono">{stagedCount}</span> unsaved change(s). All pending row additions, edits, or deletions will be reverted to database values.
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  Are you sure you want to discard these changes?
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530]">
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#20222a] hover:bg-[#2b2d38] border border-[#2d303f] text-zinc-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
              >
                <span>Keep Changes</span>
                <kbd className="text-[10px] text-zinc-500 font-mono bg-[#14151a] px-1 rounded border border-[#2d303f]">Esc</kbd>
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  revertTabChanges(tabId);
                  setEditingCell(null);
                  if (selectedRowIndex !== null && selectedRowIndex < 0) {
                    setSelectionAnchor(null);
                    setSelectionFocus(null);
                  }
                  setShowCancelConfirm(false);
                }}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors cursor-pointer shadow-sm"
              >
                <span>Discard Changes</span>
                <kbd className="text-[10px] text-rose-200 font-mono bg-rose-700/60 px-1 rounded">↵ Enter</kbd>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Floating Context Menu */}
      {contextMenu.isOpen && (
        <div
          className="fixed z-50 min-w-[210px] rounded-lg border border-[#2e313d] bg-[#181920]/95 backdrop-blur-md p-1 shadow-2xl text-[12px] text-zinc-300 select-none animate-in fade-in zoom-in-95 duration-100"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-[#272932] mb-1 truncate flex items-center justify-between">
            <span>Grid Actions</span>
            {selectionRange && (
              <span className="text-zinc-600 font-mono text-[9px]">
                {selectionRange.endR - selectionRange.startR + 1}r × {selectionRange.endC - selectionRange.startC + 1}c
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              const text = getFormattedCopyText();
              if (text) navigator.clipboard.writeText(text);
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
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

          <button
            type="button"
            onClick={() => {
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
              navigator.clipboard
                ?.readText?.()
                .then((text) => {
                  if (text) handlePasteData(text);
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
          </button>          <div className="my-1 border-t border-[#272932]" />

          <button
            type="button"
            onClick={() => {
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
              handleDuplicateRow();
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
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
              handleAddRow();
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
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
              handleDeleteActiveRow();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-rose-600 hover:text-white text-rose-300 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <Trash2 className="h-3.5 w-3.5 text-rose-400 group-hover:text-white" />
              <span>Delete Row(s)</span>
            </div>
            <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">{isMac ? 'Cmd+⌫' : 'Del'}</kbd>
          </button>

          <div className="my-1 border-t border-[#272932]" />

          {contextMenu.vIdx !== null && contextMenu.cIdx !== null && (
            <>
              <button
                type="button"
                onClick={() => {
                  const { vIdx, cIdx } = contextMenu;
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                  if (vIdx !== null && cIdx !== null) {
                    const vr = visualRows[vIdx];
                    if (vr) {
                      const col = columns[cIdx];
                      let displayVal: any;
                      if (vr.isInsert) {
                        const staged = vr.insertChange;
                        displayVal = staged?.changes[col.name] !== undefined ? staged.changes[col.name] : (col.defaultValue ?? '');
                      } else {
                        const staged = stagedChanges[vr.globalRowIndex!];
                        displayVal = staged?.type === 'update' && staged.changes[col.name] !== undefined ? staged.changes[col.name] : vr.rowData?.[cIdx];
                      }
                      handleStartEdit(vr.rowId, cIdx, displayVal);
                    }
                  }
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Edit3 className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                  <span>Edit Cell</span>
                </div>
                <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">Double-Click</kbd>
              </button>

              <button
                type="button"
                onClick={() => {
                  const { vIdx, cIdx } = contextMenu;
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                  if (vIdx !== null && cIdx !== null) {
                    const vr = visualRows[vIdx];
                    if (vr && vr.globalRowIndex !== undefined) {
                      const col = columns[cIdx];
                      const currentVal = vr.rowData?.[cIdx];
                      openUpdateQueryInTab(vr.globalRowIndex, col.name, currentVal);
                    }
                  }
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Code className="h-3.5 w-3.5 text-amber-400 group-hover:text-white" />
                  <span>Open UPDATE in Tab</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  const { vIdx, cIdx } = contextMenu;
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                  handleSetSelectedToNull(vIdx, cIdx);
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <Ban className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                  <span>Set to NULL</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  const { cIdx } = contextMenu;
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                  if (cIdx !== null && columns[cIdx]) {
                    handleToggleFreeze(columns[cIdx].name);
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
                    setContextMenu((prev) => ({ ...prev, isOpen: false }));
                    setFrozenColumns([]);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    <Snowflake className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white" />
                    <span>Unfreeze All Columns ({frozenColumns.length})</span>
                  </div>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const { cIdx } = contextMenu;
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                  if (cIdx !== null && columns[cIdx]) {
                    const colName = columns[cIdx].name;
                    const autoW = getInitialColumnWidth(columns[cIdx], rows, cIdx);
                    setColWidths((prev) => {
                      const next = { ...prev, [colName]: autoW };
                      currentWidthsRef.current = next;
                      saveColWidths(storageKey, next);
                      return next;
                    });
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
                  setContextMenu((prev) => ({ ...prev, isOpen: false }));
                  const resetWidths: Record<string, number> = {};
                  columns.forEach((c, idx) => {
                    resetWidths[c.name] = getInitialColumnWidth(c, rows, idx);
                  });
                  setColWidths(resetWidths);
                  currentWidthsRef.current = resetWidths;
                  saveColWidths(storageKey, resetWidths);
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
          )}

          <button
            type="button"
            onClick={() => {
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
              handleToggleValuePanel();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-blue-600 hover:text-white text-zinc-300 transition-colors text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <PanelRight className="h-3.5 w-3.5 text-blue-400 group-hover:text-white" />
              <span>View As</span>
            </div>
            <kbd className="text-[10px] text-zinc-500 group-hover:text-white/80 font-mono">F7</kbd>
          </button>

          <div className="my-1 border-t border-[#272932]" />

          <button
            type="button"
            onClick={() => {
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
              if (visualRows.length > 0 && columns.length > 0) {
                setSelectionAnchor({ r: 0, c: 0 });
                setSelectionFocus({ r: visualRows.length - 1, c: columns.length - 1 });
              }
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
      )}

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        connectionId={connectionId || ''}
        database={database}
        schema={schema}
        table={tableName}
        sql={rawSql}
      />

      {/* Import Modal */}
      {tableName && (
        <ImportModal
          isOpen={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          connectionId={connectionId || ''}
          database={database || ''}
          schema={schema || ''}
          table={tableName}
          onImportComplete={onRefresh}
        />
      )}

      {/* All Sorted Columns Modal */}
      {showAllSortsModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAllSortsModal(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
        >
          <div className="w-full max-w-md rounded-xl border border-[#2b2e3a] bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100">
            {/* Header */}
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
                onClick={() => setShowAllSortsModal(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* List */}
            <div className="max-h-72 overflow-y-auto p-3 space-y-2">
              {localSortConfigs.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  No active sorting
                </div>
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
                      {/* Direction Toggle */}
                      <button
                        type="button"
                        onClick={() => {
                          const nextDir: 'asc' | 'desc' = sc.direction === 'asc' ? 'desc' : 'asc';
                          const next: SortConfig[] = localSortConfigs.map((s, i) =>
                            i === idx ? { ...s, direction: nextDir } : s
                          );
                          setLocalSortConfigs(next);
                          onSortChange?.(next);
                        }}
                        className={`flex items-center justify-center h-6 w-6 rounded font-mono text-[10px] font-bold transition-colors cursor-pointer border ${
                          sc.direction === 'asc'
                            ? 'bg-blue-600/20 text-blue-300 border-blue-500/40 hover:bg-blue-600/30'
                            : 'bg-amber-600/20 text-amber-300 border-amber-500/40 hover:bg-amber-600/30'
                        }`}
                        title={`Click to toggle (${sc.direction === 'asc' ? 'A → Z (ASC) to Z → A (DESC)' : 'Z → A (DESC) to A → Z (ASC)'})`}
                      >
                        {sc.direction === 'asc' ? (
                          <ArrowDownAZ className="h-4 w-4 stroke-[2]" />
                        ) : (
                          <ArrowDownZA className="h-4 w-4 stroke-[2]" />
                        )}
                      </button>

                      {/* Move Up */}
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => {
                          if (idx === 0) return;
                          const next = [...localSortConfigs];
                          const temp = next[idx - 1];
                          next[idx - 1] = next[idx];
                          next[idx] = temp;
                          setLocalSortConfigs(next);
                          onSortChange?.(next);
                        }}
                        className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                        title="Increase priority"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>

                      {/* Move Down */}
                      <button
                        type="button"
                        disabled={idx === localSortConfigs.length - 1}
                        onClick={() => {
                          if (idx === localSortConfigs.length - 1) return;
                          const next = [...localSortConfigs];
                          const temp = next[idx + 1];
                          next[idx + 1] = next[idx];
                          next[idx] = temp;
                          setLocalSortConfigs(next);
                          onSortChange?.(next);
                        }}
                        className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                        title="Decrease priority"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>

                      {/* Remove */}
                      <button
                        type="button"
                        onClick={() => {
                          const next = localSortConfigs.filter((_, i) => i !== idx);
                          setLocalSortConfigs(next);
                          onSortChange?.(next);
                          if (next.length === 0) setShowAllSortsModal(false);
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

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-[#272932] px-4 py-2.5 bg-[#14151a]">
              <button
                type="button"
                onClick={() => {
                  handleClearAllSort();
                  setShowAllSortsModal(false);
                }}
                className="px-2.5 py-1 rounded border border-rose-800/60 bg-rose-950/30 text-rose-400 hover:bg-rose-900/50 hover:text-rose-200 text-xs font-medium cursor-pointer transition-colors"
              >
                Clear All Sorts
              </button>
              <button
                type="button"
                onClick={() => setShowAllSortsModal(false)}
                className="px-3 py-1 rounded bg-[#272932] hover:bg-[#323541] text-zinc-200 text-xs font-medium cursor-pointer transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* All Frozen Columns Modal */}
      {showAllFrozenModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAllFrozenModal(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
        >
          <div className="w-full max-w-md rounded-xl border border-[#2b2e3a] bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100">
            {/* Header */}
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
                onClick={() => setShowAllFrozenModal(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* List */}
            <div className="max-h-72 overflow-y-auto p-3 space-y-2">
              {frozenColumns.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  No frozen columns
                </div>
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
                      {/* Move Up */}
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => {
                          if (idx === 0) return;
                          const next = [...frozenColumns];
                          const temp = next[idx - 1];
                          next[idx - 1] = next[idx];
                          next[idx] = temp;
                          setFrozenColumns(next);
                          onFrozenColumnsChange?.(next);
                        }}
                        className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                        title="Move left in freeze order"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>

                      {/* Move Down */}
                      <button
                        type="button"
                        disabled={idx === frozenColumns.length - 1}
                        onClick={() => {
                          if (idx === frozenColumns.length - 1) return;
                          const next = [...frozenColumns];
                          const temp = next[idx + 1];
                          next[idx + 1] = next[idx];
                          next[idx] = temp;
                          setFrozenColumns(next);
                          onFrozenColumnsChange?.(next);
                        }}
                        className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#22242c] disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                        title="Move right in freeze order"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>

                      {/* Unfreeze */}
                      <button
                        type="button"
                        onClick={() => {
                          const next = frozenColumns.filter((c) => c !== colName);
                          setFrozenColumns(next);
                          onFrozenColumnsChange?.(next);
                          if (next.length === 0) setShowAllFrozenModal(false);
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

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-[#272932] px-4 py-2.5 bg-[#14151a]">
              <button
                type="button"
                onClick={() => {
                  setFrozenColumns([]);
                  onFrozenColumnsChange?.([]);
                  setShowAllFrozenModal(false);
                }}
                className="px-2.5 py-1 rounded border border-rose-800/60 bg-rose-950/30 text-rose-400 hover:bg-rose-900/50 hover:text-rose-200 text-xs font-medium cursor-pointer transition-colors"
              >
                Unfreeze All
              </button>
              <button
                type="button"
                onClick={() => setShowAllFrozenModal(false)}
                className="px-3 py-1 rounded bg-[#272932] hover:bg-[#323541] text-zinc-200 text-xs font-medium cursor-pointer transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
