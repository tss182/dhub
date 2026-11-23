import { ColumnMeta } from '../../types/domain';
import { WhereSuggestionItem } from './gridTypes';

export const SQL_WHERE_KEYWORDS = [
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

export const MONGO_FILTER_OPERATORS = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$regex',
  '$exists',
  '$and',
  '$or',
  '$elemMatch',
];

export function getWhereColumnIconType(
  dataType?: string,
  isPK?: boolean
): 'pk' | 'number' | 'date' | 'boolean' | 'text' {
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
    upper.includes('SERIAL') ||
    upper === 'LONG' ||
    upper === 'UNSIGNED_LONG' ||
    upper === 'SHORT' ||
    upper === 'BYTE'
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

export function isInsideQuotes(text: string, cursor: number): boolean {
  const textBefore = text.slice(0, cursor);
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < textBefore.length; i++) {
    const ch = textBefore[i];
    if (ch === "'" && !inDouble) {
      if (inSingle && textBefore[i + 1] === "'") {
        i++;
      } else {
        inSingle = !inSingle;
      }
    } else if (ch === '"' && !inSingle) {
      if (inDouble && textBefore[i + 1] === '"') {
        i++;
      } else {
        inDouble = !inDouble;
      }
    }
  }

  return inSingle || inDouble;
}

export function getWhereCurrentToken(text: string, cursor: number) {
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

export function computeWhereSuggestions(params: {
  isTableTab: boolean;
  columns: ColumnMeta[];
  primaryKeys: string[];
  whereInput: string;
  whereCursorPos: number;
  forceShowSuggestions: boolean;
}): WhereSuggestionItem[] {
  const { isTableTab, columns, primaryKeys, whereInput, whereCursorPos, forceShowSuggestions } = params;
  if (!isTableTab || !columns || columns.length === 0) return [];

  if (isInsideQuotes(whereInput, whereCursorPos)) {
    return [];
  }

  const token = getWhereCurrentToken(whereInput, whereCursorPos);
  const search = token.word.toLowerCase();

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

  const matchedKeywords: WhereSuggestionItem[] = SQL_WHERE_KEYWORDS
    .filter((kw) => kw.toLowerCase().startsWith(search))
    .map((kw) => ({
      id: `kw-${kw}`,
      type: 'keyword',
      name: kw,
    }));

  return [...matchedCols, ...matchedKeywords];
}
