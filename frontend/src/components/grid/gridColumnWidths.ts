import { ColumnMeta } from '../../types/domain';

export function getColWidthsStorageKey(
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

export function saveColWidths(key: string, widths: Record<string, number>) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(key, JSON.stringify(widths));
    }
  } catch {}
}

export function loadColWidths(key: string): Record<string, number> | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    }
  } catch {}
  return null;
}

export function getLongestWordLength(str: string): number {
  if (!str) return 0;
  const words = str.split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return str.length;
  return Math.max(...words.map((w) => w.length));
}

export function getMinimumColumnWidth(col: ColumnMeta, isPK?: boolean): number {
  const longestWordLen = getLongestWordLength(col.name || '');
  const chromeWidth = isPK ? 112 : 94;
  const wordWidth = Math.ceil(longestWordLen * 8.5);
  const nameLen = (col.name || '').length;
  const nameWidth = Math.ceil(Math.min(nameLen, 24) * 8.5);

  const calculatedMin = Math.max(wordWidth, nameWidth) + chromeWidth;
  return Math.max(isPK ? 160 : 140, Math.min(calculatedMin, 340));
}

export function getInitialColumnWidth(
  col: ColumnMeta,
  sampleRows: any[][],
  colIdx: number,
  isPK?: boolean
): number {
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

  const effectiveDataLen = Math.max(Math.min(maxDataLen, 45), Math.min(maxDataWordLen, 30));
  const dataCalculated = Math.ceil(effectiveDataLen * 8.5) + 28;

  return Math.max(minWidth, Math.min(dataCalculated, 480));
}
