export type PgVectorKind = 'vector' | 'halfvec' | 'sparsevec' | 'bit';

export type PgVectorMetric = 'cosine' | 'l2' | 'ip' | 'l1' | 'hamming' | 'jaccard';

export interface PgVectorColumnKind {
  kind: PgVectorKind | null;
  dims: number | null;
}

export interface ParsedPgSparseVec {
  dims: number;
  entries: Array<{ index: number; value: number }>;
  nnz: number;
}

export interface ParsedPgBitVec {
  dims: number;
  ones: number;
  zeros: number;
  density: number;
}

/**
 * Detects pgvector column kind (`vector`, `halfvec`, `sparsevec`, `bit`) and optional dimensions.
 */
export function detectPgVectorColumnKind(dataType?: string, rawType?: string): PgVectorColumnKind {
  const dt = (dataType || '').trim().toLowerCase();
  const rt = (rawType || '').trim().toLowerCase();

  const check = (src: string): PgVectorColumnKind | null => {
    if (!src) return null;
    let m = src.match(/^(?:pg_catalog\.)?(?:public\.)?vector(?:\(\s*(\d+)\s*\))?$/);
    if (m) return { kind: 'vector', dims: m[1] ? Number(m[1]) : null };

    m = src.match(/^(?:pg_catalog\.)?(?:public\.)?halfvec(?:\(\s*(\d+)\s*\))?$/);
    if (m) return { kind: 'halfvec', dims: m[1] ? Number(m[1]) : null };

    m = src.match(/^(?:pg_catalog\.)?(?:public\.)?sparsevec(?:\(\s*(\d+)\s*\))?$/);
    if (m) return { kind: 'sparsevec', dims: m[1] ? Number(m[1]) : null };

    m = src.match(/^(?:pg_catalog\.)?(?:bit\s+varying|varbit|bit)\(\s*(\d+)\s*\)$/);
    if (m) return { kind: 'bit', dims: Number(m[1]) };

    if (src === 'bit' || src === 'varbit' || src === 'bit varying') {
      return { kind: 'bit', dims: null };
    }
    return null;
  };

  return check(dt) || check(rt) || { kind: null, dims: null };
}

/**
 * Parses pgvector native sparsevec literal `{1:0.5,3:0.8}/1000` (1-based indices).
 */
export function parsePgSparseVec(raw: string): ParsedPgSparseVec | null {
  const trimmed = raw.trim();
  const m = trimmed.match(/^\{([^}]*)\}\s*\/\s*(\d+)$/);
  if (!m) return null;

  const dims = Number(m[2]);
  if (!Number.isInteger(dims) || dims <= 0) return null;

  const body = m[1].trim();
  if (!body) {
    return { dims, entries: [], nnz: 0 };
  }

  const entries: Array<{ index: number; value: number }> = [];
  for (const part of body.split(',')) {
    const seg = part.trim();
    if (!seg) continue;
    const colonIdx = seg.indexOf(':');
    if (colonIdx <= 0) return null;
    const index = Number(seg.slice(0, colonIdx).trim());
    const value = Number(seg.slice(colonIdx + 1).trim());
    if (!Number.isInteger(index) || index < 1 || index > dims || !Number.isFinite(value)) {
      return null;
    }
    entries.push({ index, value });
  }

  return { dims, entries, nnz: entries.length };
}

/**
 * Formats entries back into pgvector native sparsevec literal `{1:0.5,3:0.8}/1000`.
 */
export function formatPgSparseVec(entries: Array<{ index: number; value: number }>, dims: number): string {
  const sorted = [...entries]
    .filter((e) => Number.isInteger(e.index) && e.index >= 1 && e.index <= dims && Number.isFinite(e.value) && e.value !== 0)
    .sort((a, b) => a.index - b.index);
  return `{${sorted.map((e) => `${e.index}:${e.value}`).join(',')}}/${dims}`;
}

/**
 * Parses pgvector bitstring `'1011001...'`.
 */
export function parsePgBitVec(raw: string): ParsedPgBitVec | null {
  const trimmed = raw.trim();
  if (!trimmed || !/^[01]+$/.test(trimmed)) return null;
  let ones = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) === 49) ones++;
  }
  const dims = trimmed.length;
  const zeros = dims - ones;
  return {
    dims,
    ones,
    zeros,
    density: dims > 0 ? ones / dims : 0,
  };
}

/**
 * Sign-quantizes a float vector into a binary bitstring (`v > 0 ? '1' : '0'`).
 */
export function floatArrayToBitString(vec: number[]): string {
  return vec.map((v) => (v > 0 ? '1' : '0')).join('');
}

export function getSupportedMetricsForKind(kind: PgVectorKind | null): PgVectorMetric[] {
  if (kind === 'bit') {
    return ['hamming', 'jaccard'];
  }
  return ['cosine', 'l2', 'ip', 'l1'];
}

export function getOpclassFor(kind: PgVectorKind, metric: PgVectorMetric): string | null {
  const map: Record<PgVectorKind, Partial<Record<PgVectorMetric, string>>> = {
    vector: {
      cosine: 'vector_cosine_ops',
      l2: 'vector_l2_ops',
      ip: 'vector_ip_ops',
      l1: 'vector_l1_ops',
    },
    halfvec: {
      cosine: 'halfvec_cosine_ops',
      l2: 'halfvec_l2_ops',
      ip: 'halfvec_ip_ops',
      l1: 'halfvec_l1_ops',
    },
    sparsevec: {
      cosine: 'sparsevec_cosine_ops',
      l2: 'sparsevec_l2_ops',
      ip: 'sparsevec_ip_ops',
      l1: 'sparsevec_l1_ops',
    },
    bit: {
      hamming: 'bit_hamming_ops',
      jaccard: 'bit_jaccard_ops',
    },
  };
  return map[kind]?.[metric] || null;
}

export function getMaxIndexDimsForKind(kind: PgVectorKind): number {
  switch (kind) {
    case 'vector':
      return 2000;
    case 'halfvec':
      return 4000;
    case 'bit':
      return 64000;
    case 'sparsevec':
      return 1000; // max non-zero elements per HNSW/IVFFlat entry
  }
}

