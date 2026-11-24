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

/**
 * Quotes a value as a MySQL/MariaDB/ClickHouse string literal under the default sql_mode, where the
 * backslash is an escape character. Escaping only the quote lets a value that ends in a backslash,
 * or contains \', break out of the literal.
 */
export function quoteMySqlString(value: string): string {
  const escapes: Record<string, string> = {
    '\\': '\\\\',
    "'": "\\'",
    '\0': '\\0',
    '\n': '\\n',
    '\r': '\\r',
    '\x1a': '\\Z',
  };
  return `'${value.replace(/[\\'\0\n\r\x1a]/g, (ch) => escapes[ch])}'`;
}

/** Builds the `user`@`host` account reference used by MySQL/MariaDB account statements. */
export function quoteMySqlAccount(user: string, host: string): string {
  return `${quoteSqlIdentifier('mysql', user)}@${quoteSqlIdentifier('mysql', host)}`;
}
