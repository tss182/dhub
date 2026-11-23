export interface ParsedQuerySource {
  qualifier?: string;
  table: string;
}

const IDENT = '(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|[A-Za-z_][\\w$.-]*)';

function unquote(ident: string): string {
  const t = ident.trim();
  if (
    (t.startsWith('`') && t.endsWith('`')) ||
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith('[') && t.endsWith(']'))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n\r]*/g, ' ');
}

/**
 * Detects a plain `SELECT ... FROM <one table> [WHERE/ORDER BY/LIMIT ...]` statement
 * or a single-index Elasticsearch `GET/POST /<index>/_search` request.
 * Returns null for joins, unions, grouping, DISTINCT, CTEs, subqueries, multi-statements, etc.
 */
export function parseSingleTableSelect(rawSql: string): ParsedQuerySource | null {
  if (!rawSql) return null;
  const sql = stripComments(rawSql).trim().replace(/;+\s*$/, '').trim();
  if (!sql) return null;

  const esSearchMatch = /^(?:GET|POST)\s+\/([A-Za-z0-9_.-]+)\/_search(?:\?[^\s]*)?(?:\s+[\s\S]*)?$/i.exec(sql);
  if (esSearchMatch) {
    const idxName = decodeURIComponent(esSearchMatch[1]);
    if (!idxName.startsWith('_') && !idxName.includes('*') && !idxName.includes(',')) {
      return { table: idxName };
    }
  }

  const mongoFindMatch = /^db\s*\.\s*(?:getCollection\(\s*["']([^"']+)["']\s*\)|([A-Za-z0-9_$-]+))\s*\.\s*find(?:One)?\s*\(/i.exec(sql);
  if (mongoFindMatch) {
    const collName = (mongoFindMatch[1] || mongoFindMatch[2] || '').trim();
    if (collName) {
      return { table: collName };
    }
  }

  if (sql.includes(';')) return null;
  if (!/^select\b/i.test(sql)) return null;
  if (/\b(join|union|intersect|except|group\s+by|having|distinct|window)\b/i.test(sql)) return null;

  const re = new RegExp(
    `\\bfrom\\s+(${IDENT}(?:\\s*\\.\\s*${IDENT})?)((?:\\s+(?:as\\s+)?[A-Za-z_]\\w*)?)\\s*(,|\\bwhere\\b|\\border\\b|\\blimit\\b|\\boffset\\b|\\bfetch\\b|\\bfor\\b|$)`,
    'i'
  );
  const m = re.exec(sql);
  if (!m) return null;
  if (m[3] === ',') return null;

  const parts = m[1].split(/\s*\.\s*/).map(unquote);
  if (parts.length === 1) return { table: parts[0] };
  return { qualifier: parts[parts.length - 2], table: parts[parts.length - 1] };
}
