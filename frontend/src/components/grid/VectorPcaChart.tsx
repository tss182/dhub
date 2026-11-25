import React, { useEffect, useId, useMemo, useState } from 'react';
import { Download, AlertCircle, Sparkles } from 'lucide-react';
import { ColumnMeta } from '../../types/domain';
import { isVectorColumn } from './gridFormatters';
import { parsePgBitVec, parsePgSparseVec } from '../../utils/pgvector';

export interface VectorPcaChartProps {
  columns: ColumnMeta[];
  rows: any[][];
  title?: string;
  queryVector?: number[] | null;
}

const PALETTE = [
  '#8b5cf6',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16',
];

function parseNumericVector(val: any): number[] | null {
  if (Array.isArray(val)) {
    if (val.length > 0 && typeof val[0] === 'number') {
      return val as number[];
    }
    return null;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'number') {
        return parsed;
      }
    } catch {}
  }
  return null;
}

/**
 * Computes 3D PCA coordinates via the N x N Gram matrix (O(N^2 * D)),
 * keeping projection fast even for 1536–3072 dimensional embeddings.
 */
function computePca3D(vectors: number[][]): Array<[number, number, number]> {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [[0, 0, 0]];

  const d = vectors[0].length;
  if (d === 0) return vectors.map(() => [0, 0, 0]);
  if (d === 1) return vectors.map((v) => [v[0] || 0, 0, 0]);
  if (d === 2) return vectors.map((v) => [v[0] || 0, v[1] || 0, 0]);
  if (d === 3) return vectors.map((v) => [v[0] || 0, v[1] || 0, v[2] || 0]);

  // 1. Center vectors
  const mean = new Float64Array(d);
  for (let i = 0; i < n; i++) {
    const v = vectors[i];
    for (let k = 0; k < d; k++) {
      mean[k] += v[k] || 0;
    }
  }
  for (let k = 0; k < d; k++) mean[k] /= n;

  const centered: Float64Array[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(d);
    const v = vectors[i];
    for (let k = 0; k < d; k++) {
      row[k] = (v[k] || 0) - mean[k];
    }
    centered[i] = row;
  }

  // 2. Build N x N Gram matrix G = X * X^T
  const G: Float64Array[] = new Array(n);
  for (let i = 0; i < n; i++) G[i] = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const ci = centered[i];
    for (let j = i; j < n; j++) {
      const cj = centered[j];
      let dot = 0;
      for (let k = 0; k < d; k++) {
        dot += ci[k] * cj[k];
      }
      G[i][j] = dot;
      G[j][i] = dot;
    }
  }

  // 3. Power iteration with Gram-Schmidt orthogonalization against prior eigenvectors
  const powerIter = (mat: Float64Array[], orthos: Float64Array[]): { vec: Float64Array; val: number } => {
    const u = new Float64Array(n);
    const seedOffset = orthos.length * 5 + 3;
    for (let i = 0; i < n; i++) u[i] = ((i * 7 + seedOffset) % 13) - 6;

    const norm = (arr: Float64Array) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += arr[i] * arr[i];
      const len = Math.sqrt(s) || 1;
      for (let i = 0; i < n; i++) arr[i] /= len;
    };

    for (const o of orthos) {
      let proj = 0;
      for (let i = 0; i < n; i++) proj += u[i] * o[i];
      for (let i = 0; i < n; i++) u[i] -= proj * o[i];
    }
    norm(u);

    const next = new Float64Array(n);
    let eigVal = 0;
    for (let iter = 0; iter < 35; iter++) {
      for (let i = 0; i < n; i++) {
        let sum = 0;
        const gi = mat[i];
        for (let j = 0; j < n; j++) sum += gi[j] * u[j];
        next[i] = sum;
      }
      for (const o of orthos) {
        let proj = 0;
        for (let i = 0; i < n; i++) proj += next[i] * o[i];
        for (let i = 0; i < n; i++) next[i] -= proj * o[i];
      }
      let rayleigh = 0;
      for (let i = 0; i < n; i++) rayleigh += next[i] * u[i];
      eigVal = Math.max(0, rayleigh);

      for (let i = 0; i < n; i++) u[i] = next[i];
      norm(u);
    }
    return { vec: u, val: eigVal };
  };

  const pc1 = powerIter(G, []);
  const pc2 = powerIter(G, [pc1.vec]);
  const pc3 = powerIter(G, [pc1.vec, pc2.vec]);
  const s1 = Math.sqrt(Math.max(0, pc1.val));
  const s2 = Math.sqrt(Math.max(0, pc2.val));
  const s3 = Math.sqrt(Math.max(0, pc3.val));

  const coords: Array<[number, number, number]> = new Array(n);
  for (let i = 0; i < n; i++) {
    coords[i] = [pc1.vec[i] * s1, pc2.vec[i] * s2, pc3.vec[i] * s3];
  }
  return coords;
}

export const VectorPcaChart: React.FC<VectorPcaChartProps> = ({ columns, rows, title, queryVector }) => {
  const svgDomId = useId();
  const vectorCols = useMemo(
    () =>
      columns
        .map((c, idx) => ({ col: c, idx }))
        .filter(({ col, idx }) => {
          const dt = (col.dataType || '').toLowerCase();
          if (dt.includes('sparse') || dt.includes('multi')) return false;
          if (isVectorColumn(col.dataType, col.rawType)) return true;
          return rows.some((r) => parseNumericVector(r?.[idx]) !== null);
        }),
    [columns, rows]
  );

  const labelCols = useMemo(
    () =>
      columns
        .map((c, idx) => ({ col: c, idx }))
        .filter(({ col }) => !isVectorColumn(col.dataType, col.rawType)),
    [columns]
  );

  const [selectedVecIdx, setSelectedVecIdx] = useState<number>(() => vectorCols[0]?.idx ?? -1);
  const [labelColIdx, setLabelColIdx] = useState<number>(() => {
    const pref = labelCols.find((c) => /title|name|category|label|id|_id/i.test(c.col.name));
    return pref?.idx ?? labelCols[0]?.idx ?? 0;
  });
  const [colorColIdx, setColorColIdx] = useState<number>(() => {
    const pref = labelCols.find((c) => /category|type|group|label|score|_score/i.test(c.col.name));
    return pref?.idx ?? -1;
  });
  const [maxPoints, setMaxPoints] = useState<number>(200);
  const [dimMode, setDimMode] = useState<'2d' | '3d'>('2d');
  const [angles, setAngles] = useState<{ yaw: number; pitch: number }>({ yaw: 0.5, pitch: 0.35 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const [hoveredPointIdx, setHoveredPointIdx] = useState<number | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

  useEffect(() => {
    const prefLabel = labelCols.find((c) => /title|name|category|label|id|_id/i.test(c.col.name));
    setLabelColIdx(prefLabel?.idx ?? labelCols[0]?.idx ?? 0);
    const prefColor = labelCols.find((c) => /category|type|group|label|score|_score/i.test(c.col.name));
    setColorColIdx(prefColor?.idx ?? -1);
    setSelectedIndices([]);
    setHoveredPointIdx(null);
  }, [columns, labelCols]);

  const activeVecIdx = vectorCols.some((v) => v.idx === selectedVecIdx)
    ? selectedVecIdx
    : vectorCols[0]?.idx ?? -1;

  const projected = useMemo(() => {
    if (activeVecIdx < 0 || rows.length === 0) return [];
    const limit = maxPoints > 0 ? Math.min(rows.length, maxPoints) : rows.length;

    const validItems: Array<{
      rowIdx: number;
      vec: number[];
      label: string;
      colorGroup: string;
      score?: number;
      isQuery?: boolean;
    }> = [];

    const scoreColIdx = columns.findIndex((c) => c.name === 'score' || c.name === '_score' || c.name === 'distance');
    let expectedDim = -1;

    // Collect sparsevec top-64 active indices if column is sparsevec
    const rawCol = columns[activeVecIdx];
    const rawColType = ((rawCol?.dataType || rawCol?.rawType || '') as string).toLowerCase();
    const isSparseCol = rawColType.includes('sparsevec');
    const isBitCol = rawColType.includes('bit');

    let topSparseIndices: number[] = [];
    if (isSparseCol) {
      const freq = new Map<number, number>();
      for (let i = 0; i < limit; i++) {
        const sp = parsePgSparseVec(String(rows[i]?.[activeVecIdx] ?? ''));
        if (!sp) continue;
        for (const e of sp.entries) {
          freq.set(e.index, (freq.get(e.index) || 0) + 1);
        }
      }
      topSparseIndices = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 64)
        .map(([idx]) => idx);
    }

    for (let i = 0; i < limit; i++) {
      const r = rows[i];
      const cell = r?.[activeVecIdx];
      let vec: number[] | null = null;
      if (isSparseCol && topSparseIndices.length > 0) {
        const sp = parsePgSparseVec(String(cell ?? ''));
        if (sp) {
          const valMap = new Map(sp.entries.map((e) => [e.index, e.value]));
          vec = topSparseIndices.map((idx) => valMap.get(idx) ?? 0);
        }
      } else if (isBitCol || (typeof cell === 'string' && /^[01]{8,}$/.test(cell.trim()))) {
        const bv = parsePgBitVec(String(cell ?? ''));
        if (bv) {
          const s = String(cell).trim();
          vec = Array.from(s, (ch) => (ch === '1' ? 1 : -1));
        }
      } else {
        vec = parseNumericVector(cell);
      }
      if (!vec) continue;
      if (expectedDim === -1) expectedDim = vec.length;
      if (vec.length !== expectedDim) continue;

      const rawLabel = r?.[labelColIdx];
      const label = rawLabel === null || rawLabel === undefined ? `Row ${i + 1}` : String(rawLabel);
      const rawGroup = colorColIdx >= 0 ? r?.[colorColIdx] : 'default';
      const colorGroup = rawGroup === null || rawGroup === undefined ? 'NULL' : String(rawGroup);
      const score = scoreColIdx >= 0 && Number.isFinite(Number(r?.[scoreColIdx])) ? Number(r?.[scoreColIdx]) : undefined;

      validItems.push({ rowIdx: i, vec, label, colorGroup, score });
    }

    if (validItems.length === 0) return [];
    const pcaInputs = validItems.map((it) => it.vec);
    const hasQueryVec = Boolean(queryVector && queryVector.length === expectedDim);
    if (hasQueryVec && queryVector) {
      pcaInputs.push(queryVector);
    }
    const coords = computePca3D(pcaInputs);

    const out = validItems.map((it, idx) => ({
      ...it,
      x: coords[idx][0],
      y: coords[idx][1],
      z: coords[idx][2],
      dims: it.vec.length,
    }));
    if (hasQueryVec && coords.length > validItems.length) {
      const qCoord = coords[validItems.length];
      out.push({
        rowIdx: -1,
        vec: queryVector!,
        label: '★ Query Vector',
        colorGroup: '__query__',
        score: undefined,
        isQuery: true,
        x: qCoord[0],
        y: qCoord[1],
        z: qCoord[2],
        dims: queryVector!.length,
      });
    }
    return out;
  }, [activeVecIdx, rows, maxPoints, columns, labelColIdx, colorColIdx, queryVector]);

  const { groupColors, numericColorStats } = useMemo(() => {
    const map = new Map<string, string>();
    const numericVals = projected
      .map((p) => Number(p.colorGroup))
      .filter((n, idx) => projected[idx].colorGroup !== 'NULL' && Number.isFinite(n));

    if (colorColIdx >= 0 && projected.length > 1 && numericVals.length === projected.length) {
      const minV = Math.min(...numericVals);
      const maxV = Math.max(...numericVals);
      const span = maxV - minV || 1;
      for (const pt of projected) {
        const t = Math.max(0, Math.min(1, (Number(pt.colorGroup) - minV) / span));
        // Continuous gradient: indigo (#6366f1) -> cyan (#06b6d4) -> emerald (#10b981) -> amber (#f59e0b)
        const hue = Math.round(240 - t * 200);
        map.set(pt.colorGroup, `hsl(${hue}, 82%, 58%)`);
      }
      return { groupColors: map, numericColorStats: { min: minV, max: maxV } };
    }

    let idx = 0;
    for (const pt of projected) {
      if (!map.has(pt.colorGroup)) {
        map.set(pt.colorGroup, PALETTE[idx % PALETTE.length]);
        idx++;
      }
    }
    return { groupColors: map, numericColorStats: null };
  }, [projected, colorColIdx]);

  const handleExportSvg = () => {
    const svg = document.getElementById(svgDomId);
    if (!svg) return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(title || 'vector_pca').replace(/[^a-zA-Z0-9_-]/g, '_')}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (vectorCols.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-2 p-6">
        <AlertCircle className="h-6 w-6 opacity-50" />
        <p className="text-xs">No vector columns with numeric embeddings found in current rows.</p>
      </div>
    );
  }

  const width = 760;
  const height = 380;
  const pad = { top: 24, right: 24, bottom: 32, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of projected) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const spanZ = maxZ - minZ || 1;

  const cosY = Math.cos(angles.yaw);
  const sinY = Math.sin(angles.yaw);
  const cosP = Math.cos(angles.pitch);
  const sinP = Math.sin(angles.pitch);

  const displayPoints = projected.map((p, idx) => {
    if (dimMode === '2d') {
      return {
        ...p,
        origIdx: idx,
        sx: pad.left + ((p.x - minX) / spanX) * plotW,
        sy: pad.top + plotH - ((p.y - minY) / spanY) * plotH,
        depth: 0,
        radius: 4.5,
      };
    }
    // Normalize to [-1, 1] then rotate in 3D
    const nx = ((p.x - minX) / spanX) * 2 - 1;
    const ny = ((p.y - minY) / spanY) * 2 - 1;
    const nz = ((p.z - minZ) / spanZ) * 2 - 1;

    const x1 = nx * cosY - nz * sinY;
    const z1 = nx * sinY + nz * cosY;
    const y2 = ny * cosP - z1 * sinP;
    const z2 = ny * sinP + z1 * cosP;

    const persp = 2.6 / (2.6 - z2 * 0.65);
    const sx = pad.left + plotW / 2 + x1 * (plotW * 0.36) * persp;
    const sy = pad.top + plotH / 2 - y2 * (plotH * 0.36) * persp;
    const radius = Math.max(2.5, Math.min(7.5, 4.5 * persp));
    return { ...p, origIdx: idx, sx, sy, depth: z2, radius };
  });

  if (dimMode === '3d') {
    displayPoints.sort((a, b) => a.depth - b.depth);
  }

  const hovered = hoveredPointIdx !== null ? projected[hoveredPointIdx] : null;

  return (
    <div className="flex flex-col h-full bg-[#111216] text-xs select-none">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[#22242c] bg-[#16171d]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-violet-300 font-medium">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{dimMode === '3d' ? '3D PCA Projection' : '2D PCA Projection'}</span>
          </span>

          <select
            value={activeVecIdx}
            onChange={(e) => setSelectedVecIdx(Number(e.target.value))}
            className="rounded bg-[#101115] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200 font-mono"
            title="Vector column"
          >
            {vectorCols.map((v) => (
              <option key={v.idx} value={v.idx}>
                {v.col.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <span className="text-[11px] text-zinc-500">Label:</span>
            <select
              value={labelColIdx}
              onChange={(e) => setLabelColIdx(Number(e.target.value))}
              className="rounded bg-[#101115] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200"
            >
              {labelCols.map((c) => (
                <option key={c.idx} value={c.idx}>
                  {c.col.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[11px] text-zinc-500">Color:</span>
            <select
              value={colorColIdx}
              onChange={(e) => setColorColIdx(Number(e.target.value))}
              className="rounded bg-[#101115] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200"
            >
              <option value={-1}>Single color</option>
              {labelCols.map((c) => (
                <option key={c.idx} value={c.idx}>
                  {c.col.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[11px] text-zinc-500">Max pts:</span>
            <select
              value={maxPoints}
              onChange={(e) => setMaxPoints(Number(e.target.value))}
              className="rounded bg-[#101115] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded bg-[#101115] border border-[#272932] p-0.5">
            <button
              type="button"
              onClick={() => setDimMode('2d')}
              className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                dimMode === '2d' ? 'bg-violet-600 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              2D
            </button>
            <button
              type="button"
              onClick={() => setDimMode('3d')}
              className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                dimMode === '3d' ? 'bg-violet-600 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              3D
            </button>
          </div>

          {projected.length > 0 && (
            <span className="text-[11px] text-zinc-400">
              {projected.length} vectors ({projected[0].dims}d → {dimMode})
            </span>
          )}
          <button
            type="button"
            onClick={handleExportSvg}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#1e2028] hover:bg-[#272a35] text-zinc-300 border border-[#2d303c] text-[11px] cursor-pointer"
          >
            <Download className="h-3 w-3" />
            <span>SVG</span>
          </button>
        </div>
      </div>

      {/* Plot Canvas */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center p-2 overflow-hidden">
        {projected.length === 0 ? (
          <div className="text-zinc-500 text-xs">No valid vectors to project.</div>
        ) : (
          <svg
            id={svgDomId}
            viewBox={`0 0 ${width} ${height}`}
            className={`w-full h-full max-w-[960px] max-h-full ${dimMode === '3d' ? 'cursor-grab active:cursor-grabbing' : ''}`}
            onMouseDown={(e) => {
              if (dimMode !== '3d') return;
              setDragStart({ x: e.clientX, y: e.clientY, yaw: angles.yaw, pitch: angles.pitch });
            }}
            onMouseMove={(e) => {
              if (!dragStart || dimMode !== '3d') return;
              const dx = e.clientX - dragStart.x;
              const dy = e.clientY - dragStart.y;
              setAngles({
                yaw: dragStart.yaw + dx * 0.01,
                pitch: Math.max(-1.4, Math.min(1.4, dragStart.pitch + dy * 0.01)),
              });
            }}
            onMouseUp={() => setDragStart(null)}
            onMouseLeave={() => setDragStart(null)}
          >
            {/* Grid lines */}
            <line x1={pad.left} y1={pad.top + plotH / 2} x2={pad.left + plotW} y2={pad.top + plotH / 2} stroke="#232530" strokeDasharray="3 3" />
            <line x1={pad.left + plotW / 2} y1={pad.top} x2={pad.left + plotW / 2} y2={pad.top + plotH} stroke="#232530" strokeDasharray="3 3" />
            <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="none" stroke="#272932" />

            {/* Axis captions */}
            <text x={pad.left + plotW / 2} y={height - 8} textAnchor="middle" fill="#71717a" fontSize="10">
              {dimMode === '3d' ? 'Drag to rotate 3D PCA space (PC1 / PC2 / PC3)' : 'PC1'}
            </text>
            <text x={14} y={pad.top + plotH / 2} textAnchor="middle" fill="#71717a" fontSize="10" transform={`rotate(-90 14 ${pad.top + plotH / 2})`}>
              PC2
            </text>

            {/* Query Vector Lines to Top-3 Neighbors & Star Marker */}
            {(() => {
              const qPt = displayPoints.find((p: any) => p.isQuery);
              if (!qPt) return null;
              const neighbors = displayPoints
                .filter((p: any) => !p.isQuery)
                .map((p) => ({
                  p,
                  d2: (p.sx - qPt.sx) ** 2 + (p.sy - qPt.sy) ** 2,
                }))
                .sort((a, b) => a.d2 - b.d2)
                .slice(0, 3);
              return (
                <g>
                  {neighbors.map(({ p }) => (
                    <line
                      key={`qline-${p.rowIdx}`}
                      x1={qPt.sx}
                      y1={qPt.sy}
                      x2={p.sx}
                      y2={p.sy}
                      stroke="#fbbf24"
                      strokeOpacity={0.5}
                      strokeWidth={1.2}
                      strokeDasharray="3 3"
                    />
                  ))}
                  <text
                    x={qPt.sx}
                    y={qPt.sy + 4}
                    textAnchor="middle"
                    fill="#fbbf24"
                    stroke="#111216"
                    strokeWidth={0.6}
                    fontSize="16"
                    className="pointer-events-none select-none"
                  >
                    ★
                  </text>
                </g>
              );
            })()}

            {/* Points */}
            {displayPoints.filter((p: any) => !p.isQuery).map((pt) => {
              const isHovered = hoveredPointIdx === pt.origIdx;
              const isSelected = selectedIndices.includes(pt.origIdx);
              const fill = groupColors.get(pt.colorGroup) || '#8b5cf6';
              return (
                <g key={pt.rowIdx}>
                  <circle
                    cx={pt.sx}
                    cy={pt.sy}
                    r={isHovered || isSelected ? pt.radius + 2.5 : pt.radius}
                    fill={fill}
                    fillOpacity={isHovered || isSelected ? 1 : 0.82}
                    stroke={isSelected ? '#38bdf8' : isHovered ? '#ffffff' : '#111216'}
                    strokeWidth={isSelected || isHovered ? 2 : 1}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedIndices((prev) => {
                        if (prev.includes(pt.origIdx)) {
                          return prev.filter((id) => id !== pt.origIdx);
                        }
                        if (prev.length >= 2) {
                          return [prev[1], pt.origIdx];
                        }
                        return [...prev, pt.origIdx];
                      });
                    }}
                    onMouseEnter={() => setHoveredPointIdx(pt.origIdx)}
                    onMouseLeave={() => setHoveredPointIdx(null)}
                  />
                </g>
              );
            })}
          </svg>
        )}

        {/* Selected Points Inspector / Distance Comparison */}
        {selectedIndices.length > 0 && (
          <div className="absolute bottom-3 left-3 rounded bg-[#181920]/95 border border-sky-500/40 px-3 py-2 text-[11px] shadow-xl max-w-sm space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-sky-300">
                {selectedIndices.length === 2 ? 'Point Comparison (2 selected)' : 'Selected Point'}
              </span>
              <button
                type="button"
                onClick={() => setSelectedIndices([])}
                className="text-[10px] text-zinc-400 hover:text-white cursor-pointer"
              >
                Clear
              </button>
            </div>
            {selectedIndices.map((idx, pos) => {
              const pt = projected[idx];
              if (!pt) return null;
              return (
                <div key={idx} className="text-zinc-300 truncate">
                  <span className="text-zinc-500 font-mono mr-1">#{pos + 1}</span>
                  <span className="font-medium text-zinc-100">{pt.label}</span>
                  {pt.score !== undefined && (
                    <span className="ml-2 text-emerald-300 font-mono text-[10px]">
                      score={pt.score.toFixed(4)}
                    </span>
                  )}
                </div>
              );
            })}
            {selectedIndices.length === 2 &&
              projected[selectedIndices[0]] &&
              projected[selectedIndices[1]] && (() => {
                const a = projected[selectedIndices[0]].vec;
                const b = projected[selectedIndices[1]].vec;
                let dot = 0, na = 0, nb = 0, sqDist = 0;
                for (let i = 0; i < a.length; i++) {
                  dot += a[i] * b[i];
                  na += a[i] * a[i];
                  nb += b[i] * b[i];
                  const d = a[i] - b[i];
                  sqDist += d * d;
                }
                const cosSim = na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
                const euclid = Math.sqrt(sqDist);
                return (
                  <div className="pt-1 border-t border-[#272932] flex items-center gap-3 font-mono text-[10px] text-cyan-300">
                    <span>Cosine: {cosSim.toFixed(4)}</span>
                    <span>L2 Dist: {euclid.toFixed(4)}</span>
                  </div>
                );
              })()}
          </div>
        )}

        {numericColorStats && (
          <div className="pointer-events-none absolute top-4 left-4 rounded bg-[#181920]/90 border border-[#272932] px-2 py-1 text-[10px] font-mono text-zinc-400">
            <span>{numericColorStats.min.toFixed(3)}</span>
            <span className="mx-1.5 inline-block h-2 w-14 rounded-sm align-middle" style={{ background: 'linear-gradient(to right, hsl(240,82%,58%), hsl(140,82%,58%), hsl(40,82%,58%))' }} />
            <span>{numericColorStats.max.toFixed(3)}</span>
          </div>
        )}

        {/* Floating Tooltip */}
        {hovered && (
          <div className="pointer-events-none absolute top-4 right-4 rounded bg-[#1a1c23]/95 border border-[#2f3342] px-3 py-2 text-[11px] shadow-xl max-w-xs space-y-0.5">
            <div className="font-semibold text-zinc-100 truncate">{hovered.label}</div>
            {colorColIdx >= 0 && (
              <div className="text-zinc-400">
                Group: <span className="text-zinc-200">{hovered.colorGroup}</span>
              </div>
            )}
            {hovered.score !== undefined && (
              <div className="text-emerald-300 font-mono">Score: {hovered.score.toFixed(4)}</div>
            )}
            <div className="text-zinc-500 font-mono text-[10px]">
              PC1: {hovered.x.toFixed(3)}, PC2: {hovered.y.toFixed(3)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
