// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPgVectorColumnKind,
  parsePgSparseVec,
  formatPgSparseVec,
  parsePgBitVec,
  floatArrayToBitString,
  getSupportedMetricsForKind,
  getOpclassFor,
  getMaxIndexDimsForKind,
} from './pgvector.ts';

test('detectPgVectorColumnKind identifies vector, halfvec, sparsevec, and bit with dims', () => {
  assert.deepEqual(detectPgVectorColumnKind('vector(1536)', 'vector(1536)'), { kind: 'vector', dims: 1536 });
  assert.deepEqual(detectPgVectorColumnKind('halfvec(768)'), { kind: 'halfvec', dims: 768 });
  assert.deepEqual(detectPgVectorColumnKind('sparsevec(1000)'), { kind: 'sparsevec', dims: 1000 });
  assert.deepEqual(detectPgVectorColumnKind('bit(128)'), { kind: 'bit', dims: 128 });
  assert.deepEqual(detectPgVectorColumnKind('text'), { kind: null, dims: null });
});

test('parsePgSparseVec & formatPgSparseVec roundtrip', () => {
  const parsed = parsePgSparseVec('{1:0.5, 3:-0.25, 10:1.5}/1000');
  assert.ok(parsed);
  assert.equal(parsed.dims, 1000);
  assert.equal(parsed.nnz, 3);
  assert.equal(formatPgSparseVec(parsed.entries, parsed.dims), '{1:0.5,3:-0.25,10:1.5}/1000');
  assert.equal(parsePgSparseVec('invalid'), null);
});

test('parsePgBitVec & floatArrayToBitString', () => {
  const bv = parsePgBitVec('10110010');
  assert.deepEqual(bv, { dims: 8, ones: 4, zeros: 4, density: 0.5 });
  assert.equal(parsePgBitVec('1021'), null);
  assert.equal(floatArrayToBitString([0.4, -0.1, 0, 1.2]), '1001');
});

test('getSupportedMetricsForKind, getOpclassFor, and getMaxIndexDimsForKind', () => {
  assert.deepEqual(getSupportedMetricsForKind('bit'), ['hamming', 'jaccard']);
  assert.ok(getSupportedMetricsForKind('vector').includes('l1'));
  assert.equal(getOpclassFor('vector', 'cosine'), 'vector_cosine_ops');
  assert.equal(getOpclassFor('halfvec', 'l2'), 'halfvec_l2_ops');
  assert.equal(getOpclassFor('sparsevec', 'ip'), 'sparsevec_ip_ops');
  assert.equal(getOpclassFor('bit', 'hamming'), 'bit_hamming_ops');
  assert.equal(getMaxIndexDimsForKind('vector'), 2000);
  assert.equal(getMaxIndexDimsForKind('halfvec'), 4000);
  assert.equal(getMaxIndexDimsForKind('bit'), 64000);
});
