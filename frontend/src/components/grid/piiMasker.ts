const SENSITIVE_COL_RE =
  /(?:^|_)(?:e[-_]?mail|pass(?:word|wd)?|pwd|secret|token|api[-_]?key|auth[-_]?key|private[-_]?key|phone|mobile|telp?|whatsapp|wa|nik|ktp|ssn|npwp|credit[-_]?card|card[-_]?number|cvv|pin|salary|gaji|address|alamat)(?:$|_)/i;

export function isSensitiveColumn(colName: string): boolean {
  if (!colName) return false;
  return SENSITIVE_COL_RE.test(colName.trim());
}

export function maskCellValue(colName: string, val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (!str) return '';

  const lowerCol = colName.toLowerCase();
  if (lowerCol.includes('mail') && str.includes('@')) {
    const [local, domain] = str.split('@');
    const prefix = local.slice(0, 1) || '*';
    return `${prefix}***@${domain || '***'}`;
  }

  if (
    (lowerCol.includes('phone') ||
      lowerCol.includes('mobile') ||
      lowerCol.includes('tel') ||
      lowerCol.includes('whatsapp')) &&
    str.length >= 6
  ) {
    return `${str.slice(0, 2)}••••${str.slice(-2)}`;
  }

  return str.length <= 4 ? '••••' : '••••••••';
}
