import type { ColumnMeta, IndexMeta } from '../types/domain';

// Types whose equality comparison is unreliable, so they must not identify a row.
const UNRELIABLE_KEY_TYPES = new Set([
  'float',
  'double',
  'real',
  'json',
  'blob',
  'tinyblob',
  'mediumblob',
  'longblob',
  'text',
  'tinytext',
  'mediumtext',
  'longtext',
  'geometry',
  'point',
  'linestring',
  'polygon',
]);

function baseType(col: ColumnMeta): string {
  const raw = (col.rawType || col.dataType || '').toLowerCase().trim();
  return raw.split(/[\s(]/)[0];
}

/**
 * Chooses the columns that identify a row for editing: the primary key when present, otherwise the
 * first unique index whose columns are all NOT NULL and have a reliable equality comparison, with
 * no prefix lengths or expressions. Returns an empty list when no such key exists.
 */
export function pickRowKey(
  primaryKeys: string[] | null | undefined,
  indexes: IndexMeta[] | null | undefined,
  columns: ColumnMeta[] | null | undefined
): string[] {
  if (primaryKeys && primaryKeys.length > 0) return primaryKeys;
  const byName = new Map((columns || []).map((c) => [c.name.toLowerCase(), c]));
  for (const idx of indexes || []) {
    if (!idx.isUnique || idx.isPrimary || idx.expression) continue;
    if (idx.subParts && idx.subParts.some((n) => n > 0)) continue;
    if (idx.isVisible === false) continue;
    const cols = (idx.columns || []).map((n) => byName.get(n.toLowerCase()));
    if (cols.length === 0 || cols.some((c) => !c)) continue;
    if (cols.some((c) => c!.isNullable !== false)) continue;
    if (cols.some((c) => UNRELIABLE_KEY_TYPES.has(baseType(c!)))) continue;
    return idx.columns as string[];
  }
  return [];
}
