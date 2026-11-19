export function quoteSqlIdentifier(driver: string | undefined, name: string): string {
  if (!name) return '';
  const d = (driver || '').toLowerCase();
  if (d === 'mysql' || d === 'mariadb' || d === 'clickhouse') {
    return '`' + name.replace(/`/g, '``') + '`';
  }
  if (d === 'mssql' || d === 'sqlserver') {
    return '[' + name.replace(/\]/g, ']]') + ']';
  }
  return '"' + name.replace(/"/g, '""') + '"';
}

export function buildQualifiedTablePath(
  driver: string | undefined,
  database: string | undefined,
  schema: string | undefined,
  table: string
): string {
  const d = (driver || '').toLowerCase();
  const quotedTable = quoteSqlIdentifier(d, table);

  if (d === 'mysql' || d === 'mariadb' || d === 'clickhouse') {
    if (database && database !== 'main') {
      return `${quoteSqlIdentifier(d, database)}.${quotedTable}`;
    }
    return quotedTable;
  }

  if (d === 'postgres' || d === 'mssql' || d === 'sqlserver' || d === 'oracle') {
    if (schema && schema !== 'main') {
      return `${quoteSqlIdentifier(d, schema)}.${quotedTable}`;
    }
    return quotedTable;
  }

  return quotedTable;
}
