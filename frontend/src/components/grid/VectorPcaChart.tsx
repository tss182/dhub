import React, { useMemo, useState } from 'react';
import { Download, AlertCircle, Sparkles } from 'lucide-react';
import { ColumnMeta } from '../../types/domain';
import { isVectorColumn } from './gridFormatters';

export interface VectorPcaChartProps {
  columns: ColumnMeta[];
  rows: any[][];
  title?: string;
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
  const s1 = Math.sqrt(pc1.val) || 1;
  const s2 = Math.sqrt(pc2.val) || 1;
  const s3 = Math.sqrt(pc3.val) || 1;

  const coords: Array<[number, number, number]> = new Array(n);
  for (let i = 0; i < n; i++) {
    coords[i] = [pc1.vec[i] * s1, pc2.vec[i] * s2, pc3.vec[i] * s3];
  }
  return coords;
}

export const VectorPcaChart: React.FC<VectorPcaChartProps> = ({ columns, rows, title }) => {
  const vectorCols = useMemo(
    () =>
      columns
        .map((c, idx) => ({ col: c, idx }))
        .filter(({ col, idx }) => {
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
    }> = [];

    const scoreColIdx = columns.findIndex((c) => c.name === 'score' || c.name === '_score' || c.name === 'distance');
    let expectedDim = -1;

    for (let i = 0; i < limit; i++) {
      const r = rows[i];
      const vec = parseNumericVector(r?.[activeVecIdx]);
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
    const coords = computePca3D(validItems.map((it) => it.vec));

    return validItems.map((it, idx) => ({
      ...it,
      x: coords[idx][0],
      y: coords[idx][1],
      z: coords[idx][2],
      dims: it.vec.length,
    }));
  }, [activeVecIdx, rows, maxPoints, columns, labelColIdx, colorColIdx]);

  const groupColors = useMemo(() => {
    const map = new Map<string, string>();
    let idx = 0;
    for (const pt of projected) {
      if (!map.has(pt.colorGroup)) {
        map.set(pt.colorGroup, PALETTE[idx % PALETTE.length]);
        idx++;
      }
    }
    return map;
  }, [projected]);

  const handleExportSvg = () => {
    const svg = document.getElementById('dhub-vector-pca-svg');
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
            <span>2D PCA Projection</span>
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
            id="dhub-vector-pca-svg"
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

            {/* Points */}
            {displayPoints.map((pt) => {
              const isHovered = hoveredPointIdx === pt.origIdx;
              const fill = groupColors.get(pt.colorGroup) || '#8b5cf6';
              return (
                <g key={pt.rowIdx}>
                  <circle
                    cx={pt.sx}
                    cy={pt.sy}
                    r={isHovered ? pt.radius + 2.5 : pt.radius}
                    fill={fill}
                    fillOpacity={isHovered ? 1 : 0.82}
                    stroke={isHovered ? '#ffffff' : '#111216'}
                    strokeWidth={isHovered ? 2 : 1}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredPointIdx(pt.origIdx)}
                    onMouseLeave={() => setHoveredPointIdx(null)}
                  />
                </g>
              );
            })}
          </svg>
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
