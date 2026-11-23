import { ColumnMeta } from '../../types/domain';
import { CopyFormat } from '../../stores/useSettingsStore';
import { StagedRowChange } from '../../stores/useGridEditStore';
import { CellRect, VisualRow } from './gridTypes';

export function parseColumnTypeDetails(dataType?: string) {
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

export function getColumnInputType(dataType?: string): 'date' | 'datetime-local' | 'time' | 'text' {
  if (!dataType) return 'text';
  const { baseType } = parseColumnTypeDetails(dataType);
  const upper = baseType.toUpperCase();

  if (upper === 'DATE') {
    return 'date';
  }
  if (upper.includes('TIMESTAMP') || upper.includes('DATETIME')) {
    return 'datetime-local';
  }
  if (upper.includes('TIME') && !upper.includes('TIMESTAMP')) {
    return 'time';
  }
  return 'text';
}

export function formatToDateInputValue(
  val: any,
  type: 'date' | 'datetime-local' | 'time' | 'text'
): string {
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

export function normalizeDateCommitValue(
  val: string,
  inputType: 'date' | 'datetime-local' | 'time' | 'text'
): string | null {
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

export function unquoteIdentifier(ident: string): string {
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

export function unquoteSqlLiteral(literal: string): string | null {
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

export function splitSqlList(str: string): string[] {
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

export function tryParseSqlInsert(sqlText: string): { headers?: string[]; rows: (string | null)[][] } | null {
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

export function tryParseSqlUpdate(sqlText: string): { headers?: string[]; rows: (string | null)[][] } | null {
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

export function tryParseJson(text: string): { headers?: string[]; rows: (string | null)[][] } | null {
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

export function cleanPastedValue(val: any, dataType?: string): any {
  if (val === null || val === undefined) return null;
  let str = String(val).trim();
  if (str === '' || str.toUpperCase() === 'NULL' || str.toLowerCase() === '<null>') {
    return null;
  }
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

export function quoteSqlIdentifier(name: string, driver?: string): string {
  const d = (driver || '').toLowerCase();
  const isMySQL = d === 'mysql' || d === 'mariadb' || d === 'clickhouse';
  const isMSSQL = d === 'mssql' || d === 'sqlserver';
  const isNoSQL = d === 'redis' || d === 'mongodb';
  if (isNoSQL) return name;
  if (isMySQL) return `\`${name.replace(/`/g, '``')}\``;
  if (isMSSQL) return `[${name.replace(/]/g, ']]')}]`;
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteTableName(tableName: string | undefined, driver?: string): string {
  const tbl = tableName || 'table_name';
  return tbl.includes('.')
    ? tbl.split('.').map((p) => quoteSqlIdentifier(p, driver)).join('.')
    : quoteSqlIdentifier(tbl, driver);
}

export function buildUpdateSql(params: {
  driver?: string;
  tableName?: string;
  columns: ColumnMeta[];
  primaryKeys: string[];
  targetRow: any[] | undefined;
  colName: string;
  newVal: any;
}): string {
  const { driver, tableName, columns, primaryKeys, targetRow, colName, newVal } = params;
  const quoteIdent = (name: string) => quoteSqlIdentifier(name, driver);
  const quotedTbl = quoteTableName(tableName, driver);

  const col = columns.find((c) => c.name === colName);
  const colDataType = col?.dataType;
  const formattedVal = formatSqlLiteral(newVal, colDataType);

  let whereClause = '';
  const detectedPKs =
    primaryKeys.length > 0 ? primaryKeys : columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

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

  if ((driver || '').toLowerCase() === 'qdrant') {
    const coll = encodeURIComponent(tableName || 'collection');
    const pkColIdx = columns.findIndex((c) => c.name === 'id');
    const rawId = pkColIdx !== -1 ? targetRow?.[pkColIdx] : undefined;
    const trimmedId = typeof rawId === 'string' ? rawId.trim() : '';
    const parsedId =
      typeof rawId === 'string' && /^\d+$/.test(trimmedId) && Number.isSafeInteger(Number(trimmedId))
        ? Number(trimmedId)
        : rawId;
    if (colName === 'vector' || colName.startsWith('vector.')) {
      let vecVal = newVal;
      if (typeof newVal === 'string') {
        try { vecVal = JSON.parse(newVal); } catch {}
      }
      const vecPayload = colName.startsWith('vector.')
        ? { [colName.slice('vector.'.length)]: vecVal }
        : vecVal;
      const body = JSON.stringify({ points: [{ id: parsedId ?? 1, vector: vecPayload }] }, null, 2);
      return `PUT /collections/${coll}/points/vectors?wait=true\n${body}`;
    }
    let payloadVal = newVal;
    if (typeof newVal === 'string') {
      const t = newVal.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        try { payloadVal = JSON.parse(t); } catch {}
      }
    }
    const body = JSON.stringify({ payload: { [colName]: payloadVal }, points: [parsedId ?? 1] }, null, 2);
    return `POST /collections/${coll}/points/payload?wait=true\n${body}`;
  }

  return `UPDATE ${quotedTbl}\nSET ${quoteIdent(colName)} = ${formattedVal}\nWHERE ${whereClause};`;
}

export function formatSelectedCells(params: {
  targetFormat: CopyFormat;
  allSelectionRanges: CellRect[];
  columns: ColumnMeta[];
  visualRows: VisualRow[];
  stagedChanges: Record<number, StagedRowChange>;
  primaryKeys: string[];
  tableName?: string;
  driver?: string;
  isCellSelected: (vIdx: number, cIdx: number) => boolean;
}): string {
  const {
    targetFormat,
    allSelectionRanges,
    columns,
    visualRows,
    stagedChanges,
    primaryKeys,
    tableName,
    driver,
    isCellSelected,
  } = params;

  if (allSelectionRanges.length === 0 || columns.length === 0) return '';
  const selectedRowSet = new Set<number>();
  const selectedColSet = new Set<number>();
  allSelectionRanges.forEach((rng) => {
    for (let r = rng.startR; r <= rng.endR; r++) selectedRowSet.add(r);
    for (let c = rng.startC; c <= rng.endC; c++) selectedColSet.add(c);
  });
  const selectedRowIndices = Array.from(selectedRowSet).sort((a, b) => a - b);
  const selectedColIndices = Array.from(selectedColSet).sort((a, b) => a - b);
  if (selectedRowIndices.length === 0 || selectedColIndices.length === 0) return '';
  const isMultiRange = allSelectionRanges.length > 1;

  const d = (driver || '').toLowerCase();
  const isMySQL = d === 'mysql' || d === 'mariadb' || d === 'clickhouse';
  const quoteIdent = (name: string) => quoteSqlIdentifier(name, driver);
  const quotedTbl = quoteTableName(tableName, driver);

  const getVal = (vr: VisualRow, cIdx: number, colName: string) => {
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

  if (targetFormat === 'json') {
    const list: Record<string, any>[] = [];
    for (const r of selectedRowIndices) {
      const vr = visualRows[r];
      if (!vr) continue;
      const rowObj: Record<string, any> = {};
      for (const c of selectedColIndices) {
        if (isMultiRange && !isCellSelected(r, c)) continue;
        const col = columns[c];
        if (!col) continue;
        rowObj[col.name] = getVal(vr, c, col.name);
      }
      list.push(rowObj);
    }
    return JSON.stringify(list, null, 2);
  }

  if (targetFormat === 'sql_insert') {
    const selectedCols: Array<{ col: ColumnMeta; cIdx: number }> = [];
    for (const c of selectedColIndices) {
      if (columns[c]) selectedCols.push({ col: columns[c], cIdx: c });
    }
    if (selectedCols.length === 0) return '';
    const colNames = selectedCols.map(({ col }) => quoteIdent(col.name)).join(', ');
    const valueTuples: string[] = [];
    for (const r of selectedRowIndices) {
      const vr = visualRows[r];
      if (!vr) continue;
      const vals = selectedCols.map(({ col, cIdx }) => {
        const val = !isMultiRange || isCellSelected(r, cIdx) ? getVal(vr, cIdx, col.name) : null;
        return formatSqlLiteral(val, col.dataType);
      });
      valueTuples.push(`  (${vals.join(', ')})`);
    }
    return `INSERT INTO ${quotedTbl} (${colNames})\nVALUES\n${valueTuples.join(',\n')};`;
  }

  if (targetFormat === 'sql_update') {
    const statements: string[] = [];
    for (const r of selectedRowIndices) {
      const vr = visualRows[r];
      if (!vr) continue;

      const rowSelectedCols = selectedColIndices.filter((c) => !isMultiRange || isCellSelected(r, c));
      const setClauses: string[] = [];
      for (const c of rowSelectedCols) {
        const col = columns[c];
        if (!col) continue;
        const isPK = Boolean(col.isPrimaryKey || primaryKeys.includes(col.name));
        if (!isPK || rowSelectedCols.length === 1) {
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
        for (const c of rowSelectedCols) {
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

      statements.push(`UPDATE ${quotedTbl}\nSET ${setClauses.join(', ')}\nWHERE ${whereClause};`);
    }
    return statements.join('\n\n');
  }

  if (targetFormat === 'qdrant_upsert') {
    const coll = encodeURIComponent(tableName || 'collection');
    const points: any[] = [];
    for (const r of selectedRowIndices) {
      const vr = visualRows[r];
      if (!vr) continue;
      const pt: Record<string, any> = { payload: {} };
      let namedVecs: Record<string, any> | null = null;
      for (const c of selectedColIndices) {
        if (isMultiRange && !isCellSelected(r, c)) continue;
        const col = columns[c];
        if (!col) continue;
        const val = getVal(vr, c, col.name);
        if (col.name === 'score') continue;
        if (col.name === 'id') {
          const tVal = typeof val === 'string' ? val.trim() : '';
          pt.id =
            typeof val === 'string' && /^\d+$/.test(tVal) && Number.isSafeInteger(Number(tVal))
              ? Number(tVal)
              : val;
        } else if (col.name === 'vector') {
          if (typeof val === 'string') {
            try { pt.vector = JSON.parse(val); } catch { pt.vector = val; }
          } else {
            pt.vector = val;
          }
        } else if (col.name.startsWith('vector.')) {
          namedVecs = namedVecs || {};
          const vName = col.name.slice('vector.'.length);
          if (typeof val === 'string') {
            try { namedVecs[vName] = JSON.parse(val); } catch { namedVecs[vName] = val; }
          } else {
            namedVecs[vName] = val;
          }
        } else {
          if (typeof val === 'string') {
            const t = val.trim();
            if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
              try { pt.payload[col.name] = JSON.parse(t); } catch { pt.payload[col.name] = val; }
              continue;
            }
          }
          pt.payload[col.name] = val;
        }
      }
      if (namedVecs) {
        if (pt.vector !== undefined) {
          namedVecs[''] = pt.vector;
        }
        pt.vector = namedVecs;
      }
      points.push(pt);
    }
    return `PUT /collections/${coll}/points?wait=true\n${JSON.stringify({ points }, null, 2)}`;
  }

  if (targetFormat === 'sql_upsert') {
    const selectedColsWithIdx: Array<{ col: ColumnMeta; cIdx: number }> = [];
    for (const c of selectedColIndices) {
      if (columns[c]) selectedColsWithIdx.push({ col: columns[c], cIdx: c });
    }
    if (selectedColsWithIdx.length === 0) return '';
    const selectedCols = selectedColsWithIdx.map(({ col }) => col);
    const colNames = selectedCols.map((c) => quoteIdent(c.name)).join(', ');
    const valueTuples: string[] = [];
    for (const r of selectedRowIndices) {
      const vr = visualRows[r];
      if (!vr) continue;
      const vals = selectedColsWithIdx.map(({ col, cIdx }) => {
        const val = !isMultiRange || isCellSelected(r, cIdx) ? getVal(vr, cIdx, col.name) : null;
        return formatSqlLiteral(val, col.dataType);
      });
      valueTuples.push(`  (${vals.join(', ')})`);
    }

    const detectedPKs =
      primaryKeys.length > 0 ? primaryKeys : columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

    const fallbackPK =
      columns.find((c) => /^id$/i.test(c.name))?.name ||
      selectedCols.find((c) => /^id$/i.test(c.name))?.name ||
      selectedCols[0]?.name ||
      'id';

    const effectivePKs = detectedPKs.length > 0 ? detectedPKs : [fallbackPK];
    const updateCols = selectedCols.filter((c) => !effectivePKs.includes(c.name));

    if (isMySQL) {
      const setClauses =
        updateCols.length > 0
          ? updateCols.map((c) => `  ${quoteIdent(c.name)} = VALUES(${quoteIdent(c.name)})`).join(',\n')
          : `  ${quoteIdent(effectivePKs[0])} = ${quoteIdent(effectivePKs[0])}`;

      return `INSERT INTO ${quotedTbl} (${colNames})\nVALUES\n${valueTuples.join(',\n')}\nON DUPLICATE KEY UPDATE\n${setClauses};`;
    }

    const conflictTargets = effectivePKs.map((pk) => quoteIdent(pk)).join(', ');

    if (updateCols.length === 0) {
      return `INSERT INTO ${quotedTbl} (${colNames})\nVALUES\n${valueTuples.join(',\n')}\nON CONFLICT (${conflictTargets}) DO NOTHING;`;
    }

    const setClauses = updateCols
      .map((c) => `  ${quoteIdent(c.name)} = EXCLUDED.${quoteIdent(c.name)}`)
      .join(',\n');

    return `INSERT INTO ${quotedTbl} (${colNames})\nVALUES\n${valueTuples.join(',\n')}\nON CONFLICT (${conflictTargets}) DO UPDATE SET\n${setClauses};`;
  }

  if (targetFormat === 'markdown') {
    const escMd = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const headers: string[] = [];
    const colIndices: number[] = [];
    for (const c of selectedColIndices) {
      if (columns[c]) {
        headers.push(escMd(columns[c].name));
        colIndices.push(c);
      }
    }
    if (headers.length === 0) return '';
    const mdLines: string[] = [
      `| ${headers.join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
    ];
    for (const r of selectedRowIndices) {
      const vr = visualRows[r];
      if (!vr) continue;
      const cells = colIndices.map((c) => {
        const col = columns[c];
        const raw = !isMultiRange || isCellSelected(r, c) ? getVal(vr, c, col.name) : null;
        if (raw === null || raw === undefined) return 'NULL';
        return escMd(String(raw));
      });
      mdLines.push(`| ${cells.join(' | ')} |`);
    }
    return mdLines.join('\n');
  }

  // Default: CSV (RFC 4180 standard)
  const lines: string[] = [];
  const headerCols: string[] = [];
  for (const c of selectedColIndices) {
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

  for (const r of selectedRowIndices) {
    const vr = visualRows[r];
    if (!vr) continue;
    const cellVals: string[] = [];
    for (const c of selectedColIndices) {
      const col = columns[c];
      if (!col) continue;
      const raw = !isMultiRange || isCellSelected(r, c) ? getVal(vr, c, col.name) : null;
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
}

/** Checks whether column metadata represents a vector / embedding column. */
export function isVectorColumn(dataType?: string, rawType?: string): boolean {
  const dt = (dataType || '').trim().toLowerCase();
  const rt = (rawType || '').trim().toLowerCase();
  return (
    dt.startsWith('vector') ||
    dt.startsWith('halfvec') ||
    dt.startsWith('sparsevec') ||
    dt.startsWith('dense_vector') ||
    rt === 'vector' ||
    rt === 'halfvec' ||
    rt === 'sparsevec' ||
    rt === 'dense_vector'
  );
}

/**
 * Formats a vector embedding (array or pgvector string) into a compact preview
 * without parsing the full payload on every cell render.
 */
export function parseVectorPreview(
  val: any,
  dataType?: string,
  rawType?: string,
  maxPreview = 4
): { dims: number; preview: string; kind?: 'dense' | 'sparse' | 'multi' } | null {
  if (val === null || val === undefined) return null;
  const knownVector = isVectorColumn(dataType, rawType);
  const dtLower = (dataType || '').toLowerCase();

  // Sparse vector object or JSON string: {"indices": [...], "values": [...]}
  if (typeof val === 'object' && !Array.isArray(val) && Array.isArray(val.indices) && Array.isArray(val.values)) {
    const nnz = val.indices.length;
    return { dims: nnz, preview: `sparse (${nnz} nnz)`, kind: 'sparse' };
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('{') && trimmed.includes('"indices"') && trimmed.includes('"values"')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && Array.isArray(parsed.indices) && Array.isArray(parsed.values)) {
          const nnz = parsed.indices.length;
          return { dims: nnz, preview: `sparse (${nnz} nnz)`, kind: 'sparse' };
        }
      } catch {}
    }
    // Multi-vector JSON string: [[0.1, 0.2], ...]
    if (trimmed.startsWith('[[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
          const subLen = parsed[0].length;
          return { dims: subLen, preview: `${parsed.length}×${subLen}d multi`, kind: 'multi' };
        }
      } catch {}
    }
  }

  if (Array.isArray(val)) {
    const len = val.length;
    if (len === 0) return knownVector ? { dims: 0, preview: '[]', kind: 'dense' } : null;
    if (Array.isArray(val[0]) && typeof val[0][0] === 'number') {
      return { dims: val[0].length, preview: `${len}×${val[0].length}d multi`, kind: 'multi' };
    }
    if (!knownVector && len < 8) return null;
    if (typeof val[0] !== 'number' || typeof val[len - 1] !== 'number') return null;

    const head = val.slice(0, maxPreview).map((n) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(4))));
    const suffix = len > maxPreview ? ', …' : '';
    return { dims: len, preview: `[${head.join(', ')}${suffix}]`, kind: dtLower.includes('multi') ? 'multi' : 'dense' };
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return knownVector ? { dims: 0, preview: '[]', kind: 'dense' } : null;

    // Fast validation: first token must be numeric
    const firstComma = inner.indexOf(',');
    const firstToken = (firstComma === -1 ? inner : inner.slice(0, firstComma)).trim();
    if (!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(firstToken)) return null;

    // Count dimensions in a single pass without splitting the entire string
    let dims = 1;
    for (let i = 0; i < inner.length; i++) {
      if (inner.charCodeAt(i) === 44) dims++; // ','
    }
    if (!knownVector && dims < 8) return null;

    // Extract first maxPreview items
    const previewItems: string[] = [];
    let start = 0;
    for (let i = 0; i <= inner.length && previewItems.length < maxPreview; i++) {
      if (i === inner.length || inner.charCodeAt(i) === 44) {
        const rawNum = inner.slice(start, i).trim();
        const num = Number(rawNum);
        if (Number.isNaN(num)) return null;
        previewItems.push(Number.isInteger(num) ? String(num) : String(Number(num.toFixed(4))));
        start = i + 1;
      }
    }

    const suffix = dims > maxPreview ? ', …' : '';
    return { dims, preview: `[${previewItems.join(', ')}${suffix}]`, kind: 'dense' };
  }

  return null;
}
