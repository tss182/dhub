import React, { useMemo, useState } from 'react';
import { BarChart3, LineChart, AreaChart, PieChart, Download, AlertCircle, ScatterChart } from 'lucide-react';
import { ColumnMeta } from '../../types/domain';
import { isVectorColumn } from './gridFormatters';
import { VectorPcaChart } from './VectorPcaChart';

export interface ResultChartPanelProps {
  columns: ColumnMeta[];
  rows: any[][];
  title?: string;
}

type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'pca';
type AggMode = 'raw' | 'sum' | 'avg' | 'count';

const PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16',
];

function isNumericColumn(col: ColumnMeta, rows: any[][], colIdx: number): boolean {
  const dt = (col.rawType || col.dataType || '').toLowerCase();
  if (/int|float|double|decimal|numeric|real|serial|number|bigint|smallint|tinyint|long|short|byte|half_float|scaled_float|unsigned_long/.test(dt)) {
    return true;
  }
  let validCount = 0;
  let checked = 0;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const v = rows[i]?.[colIdx];
    if (v === null || v === undefined || v === '') continue;
    checked++;
    if (typeof v === 'number' && Number.isFinite(v)) {
      validCount++;
    } else if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      validCount++;
    }
  }
  return checked > 0 && validCount === checked;
}

function formatAxisNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

export const ResultChartPanel: React.FC<ResultChartPanelProps> = ({ columns, rows, title }) => {
  const numericColIndices = useMemo(() => {
    const idxs: number[] = [];
    columns.forEach((col, i) => {
      if (isNumericColumn(col, rows, i)) idxs.push(i);
    });
    return idxs;
  }, [columns, rows]);

  const defaultXIdx = useMemo(() => {
    const nonNum = columns.findIndex((_, i) => !numericColIndices.includes(i));
    return nonNum !== -1 ? nonNum : 0;
  }, [columns, numericColIndices]);

  const defaultYIdx = useMemo(() => {
    if (numericColIndices.length > 0) {
      const diff = numericColIndices.find((i) => i !== defaultXIdx);
      return diff !== undefined ? diff : numericColIndices[0];
    }
    return Math.min(1, Math.max(0, columns.length - 1));
  }, [numericColIndices, defaultXIdx, columns.length]);

  const hasVectorCol = useMemo(
    () => columns.some((c) => isVectorColumn(c.dataType, c.rawType)),
    [columns]
  );

  const [chartType, setChartType] = useState<ChartType>('bar');
  const [xColIdx, setXColIdx] = useState<number>(defaultXIdx);
  const [yColIdx, setYColIdx] = useState<number>(defaultYIdx);
  const [aggMode, setAggMode] = useState<AggMode>('raw');
  const [maxPoints, setMaxPoints] = useState<number>(50);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const safeXIdx = xColIdx < columns.length ? xColIdx : 0;
  const safeYIdx = yColIdx < columns.length ? yColIdx : 0;

  const series = useMemo(() => {
    if (columns.length === 0 || rows.length === 0) return [];

    if (aggMode === 'raw') {
      const sliced = maxPoints > 0 ? rows.slice(0, maxPoints) : rows;
      return sliced.map((r, i) => {
        const rawX = r?.[safeXIdx];
        const label =
          rawX === null || rawX === undefined ? `Row ${i + 1}` : String(rawX);
        const rawY = r?.[safeYIdx];
        const num = Number(rawY);
        return {
          label,
          value: Number.isFinite(num) ? num : 0,
        };
      });
    }

    const grouped = new Map<string, { sum: number; count: number }>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rawX = r?.[safeXIdx];
      const label = rawX === null || rawX === undefined ? 'NULL' : String(rawX);
      const num = Number(r?.[safeYIdx]);
      const val = Number.isFinite(num) ? num : 0;
      const cur = grouped.get(label) || { sum: 0, count: 0 };
      cur.sum += val;
      cur.count += 1;
      grouped.set(label, cur);
    }

    const items = Array.from(grouped.entries()).map(([label, st]) => ({
      label,
      value:
        aggMode === 'sum'
          ? st.sum
          : aggMode === 'avg'
          ? st.count > 0
            ? st.sum / st.count
            : 0
          : st.count,
    }));

    return maxPoints > 0 ? items.slice(0, maxPoints) : items;
  }, [columns.length, rows, safeXIdx, safeYIdx, aggMode, maxPoints]);

  const handleExportSvg = () => {
    const svg = document.getElementById('dhub-result-chart-svg');
    if (!svg) return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(title || 'query_chart').replace(/[^a-zA-Z0-9_-]/g, '_')}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-zinc-500 gap-2 bg-[#14151a]">
        <AlertCircle className="h-4 w-4 text-zinc-500" />
        <span>No data available to visualize.</span>
      </div>
    );
  }

  const svgWidth = 860;
  const svgHeight = 320;
  const pad = { top: 24, right: 24, bottom: 56, left: 60 };
  const plotW = svgWidth - pad.left - pad.right;
  const plotH = svgHeight - pad.top - pad.bottom;

  const values = series.map((d) => d.value);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const span = rawMax - rawMin || 1;
  const minVal = rawMin < 0 ? rawMin - span * 0.05 : 0;
  const maxVal = rawMax + span * 0.08 || 1;
  const range = maxVal - minVal || 1;

  const yToPx = (val: number) => pad.top + plotH - ((val - minVal) / range) * plotH;
  const zeroY = yToPx(0);

  const ticks = Array.from({ length: 5 }, (_, i) => minVal + (range * i) / 4);

  const hoveredItem = hoveredIdx !== null ? series[hoveredIdx] : null;

  return (
    <div className="flex h-full flex-col bg-[#14151a] text-xs select-none">
      {/* Chart Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#272932] bg-[#191a20] px-3 py-1.5 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          {/* Chart Type Selector */}
          <div className="flex items-center rounded bg-[#14151a] border border-[#272932] p-0.5">
            {(
              [
                { id: 'bar', label: 'Bar', icon: BarChart3 },
                { id: 'line', label: 'Line', icon: LineChart },
                { id: 'area', label: 'Area', icon: AreaChart },
                { id: 'pie', label: 'Pie', icon: PieChart },
                ...(hasVectorCol ? [{ id: 'pca', label: 'Vector PCA', icon: ScatterChart }] : []),
              ] as const
            ).map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setChartType(t.id as ChartType)}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] cursor-pointer transition-colors ${
                    chartType === t.id
                      ? 'bg-blue-600/25 text-blue-300 font-medium'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* X-Axis */}
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span>X:</span>
            <select
              value={safeXIdx}
              onChange={(e) => setXColIdx(Number(e.target.value))}
              className="rounded border border-[#272932] bg-[#14151a] px-2 py-0.5 text-[11px] text-zinc-200 font-mono outline-none focus:border-blue-500 max-w-[140px]"
            >
              {columns.map((c, idx) => (
                <option key={c.name + idx} value={idx}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {/* Y-Axis */}
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span>Y:</span>
            <select
              value={safeYIdx}
              onChange={(e) => setYColIdx(Number(e.target.value))}
              className="rounded border border-[#272932] bg-[#14151a] px-2 py-0.5 text-[11px] text-zinc-200 font-mono outline-none focus:border-blue-500 max-w-[140px]"
            >
              {columns.map((c, idx) => (
                <option key={c.name + idx} value={idx}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {/* Aggregation */}
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span>Agg:</span>
            <select
              value={aggMode}
              onChange={(e) => setAggMode(e.target.value as AggMode)}
              className="rounded border border-[#272932] bg-[#14151a] px-2 py-0.5 text-[11px] text-zinc-200 font-mono outline-none focus:border-blue-500"
            >
              <option value="raw">Raw</option>
              <option value="sum">Sum</option>
              <option value="avg">Avg</option>
              <option value="count">Count</option>
            </select>
          </label>

          {/* Limit */}
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span>Rows:</span>
            <select
              value={maxPoints}
              onChange={(e) => setMaxPoints(Number(e.target.value))}
              className="rounded border border-[#272932] bg-[#14151a] px-2 py-0.5 text-[11px] text-zinc-200 font-mono outline-none focus:border-blue-500"
            >
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
              <option value={100}>Top 100</option>
              <option value={0}>All ({rows.length})</option>
            </select>
          </label>
        </div>

        <div className="flex items-center gap-2">
          {hoveredItem && (
            <div className="px-2 py-0.5 rounded bg-[#14151a] border border-blue-500/40 text-[11px] font-mono text-zinc-200">
              <span className="text-zinc-400">{hoveredItem.label}:</span>{' '}
              <span className="text-blue-300 font-semibold">
                {hoveredItem.value.toLocaleString()}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={handleExportSvg}
            className="flex items-center gap-1 rounded bg-[#22242c] hover:bg-[#2c303c] px-2 py-1 text-[11px] text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title="Export Chart as SVG"
          >
            <Download className="h-3 w-3 text-blue-400" />
            <span>SVG</span>
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-2 overflow-hidden">
        {chartType === 'pca' ? (
          <div className="w-full h-full">
            <VectorPcaChart columns={columns} rows={rows} title={title} />
          </div>
        ) : chartType === 'pie' ? (() => {
          const positives = series.map((s) => ({ ...s, val: Math.max(0, s.value) })).filter((s) => s.val > 0);
          const total = positives.reduce((acc, s) => acc + s.val, 0);
          if (total <= 0) {
            return <div className="text-zinc-500 text-xs">No positive values for Pie chart.</div>;
          }
          const cx = 180;
          const cy = 150;
          const rOuter = 115;
          const rInner = 52;
          let angle = -Math.PI / 2;

          return (
            <div className="flex items-center gap-6 h-full w-full justify-center overflow-auto">
              <svg
                id="dhub-result-chart-svg"
                viewBox="0 0 360 300"
                className="h-full max-h-[290px] w-auto shrink-0"
              >
                {positives.map((item, idx) => {
                  const sliceAngle = (item.val / total) * Math.PI * 2;
                  const startA = angle;
                  const endA = angle + sliceAngle;
                  angle = endA;
                  const largeArc = sliceAngle > Math.PI ? 1 : 0;

                  const x1 = cx + rOuter * Math.cos(startA);
                  const y1 = cy + rOuter * Math.sin(startA);
                  const x2 = cx + rOuter * Math.cos(endA);
                  const y2 = cy + rOuter * Math.sin(endA);

                  const ix1 = cx + rInner * Math.cos(endA);
                  const iy1 = cy + rInner * Math.sin(endA);
                  const ix2 = cx + rInner * Math.cos(startA);
                  const iy2 = cy + rInner * Math.sin(startA);

                  const d =
                    positives.length === 1
                      ? `M ${cx} ${cy - rOuter} A ${rOuter} ${rOuter} 0 1 1 ${cx - 0.01} ${cy - rOuter} Z`
                      : `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${rInner} ${rInner} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;

                  const color = PALETTE[idx % PALETTE.length];
                  const isHovered = hoveredIdx === idx;

                  return (
                    <path
                      key={idx}
                      d={d}
                      fill={color}
                      stroke="#14151a"
                      strokeWidth={2}
                      opacity={hoveredIdx === null || isHovered ? 0.95 : 0.45}
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      className="transition-opacity cursor-pointer"
                    />
                  );
                })}
                <text x={cx} y={cy - 4} textAnchor="middle" fill="#a1a1aa" fontSize="11">
                  Total
                </text>
                <text x={cx} y={cy + 14} textAnchor="middle" fill="#f4f4f5" fontSize="13" fontWeight="bold">
                  {formatAxisNumber(total)}
                </text>
              </svg>

              <div className="max-h-[260px] overflow-y-auto space-y-1 pr-2 text-[11px] font-mono">
                {positives.slice(0, 20).map((item, idx) => (
                  <div
                    key={idx}
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    className={`flex items-center gap-2 px-2 py-0.5 rounded cursor-pointer ${
                      hoveredIdx === idx ? 'bg-[#22242c] text-white' : 'text-zinc-300'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
                    />
                    <span className="truncate max-w-[140px]">{item.label}</span>
                    <span className="text-zinc-500 ml-auto">
                      {((item.val / total) * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })() : (
          <svg
            id="dhub-result-chart-svg"
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-full max-h-full"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Horizontal grid lines & Y ticks */}
            {ticks.map((t, i) => {
              const y = yToPx(t);
              return (
                <g key={i}>
                  <line
                    x1={pad.left}
                    y1={y}
                    x2={svgWidth - pad.right}
                    y2={y}
                    stroke="#272932"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={pad.left - 8}
                    y={y + 4}
                    textAnchor="end"
                    fill="#71717a"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {formatAxisNumber(t)}
                  </text>
                </g>
              );
            })}

            {/* Zero baseline */}
            <line
              x1={pad.left}
              y1={zeroY}
              x2={svgWidth - pad.right}
              y2={zeroY}
              stroke="#3f3f46"
              strokeWidth={1}
            />

            {chartType === 'bar' && series.map((item, idx) => {
              const slotW = plotW / Math.max(1, series.length);
              const barW = Math.max(3, Math.min(44, slotW * 0.7));
              const x = pad.left + idx * slotW + (slotW - barW) / 2;
              const yVal = yToPx(item.value);
              const barY = Math.min(yVal, zeroY);
              const barH = Math.max(1.5, Math.abs(zeroY - yVal));
              const isHovered = hoveredIdx === idx;

              return (
                <g
                  key={idx}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className="cursor-pointer"
                >
                  <rect
                    x={x}
                    y={barY}
                    width={barW}
                    height={barH}
                    rx={2}
                    fill={isHovered ? '#60a5fa' : '#3b82f6'}
                    opacity={hoveredIdx === null || isHovered ? 0.9 : 0.45}
                  />
                </g>
              );
            })}

            {(chartType === 'line' || chartType === 'area') && series.length > 0 && (() => {
              const pts = series.map((item, idx) => {
                const x =
                  series.length === 1
                    ? pad.left + plotW / 2
                    : pad.left + (idx / (series.length - 1)) * plotW;
                const y = yToPx(item.value);
                return { x, y, item, idx };
              });
              const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
              const areaPath = `${linePath} L ${pts[pts.length - 1].x} ${zeroY} L ${pts[0].x} ${zeroY} Z`;

              return (
                <>
                  {chartType === 'area' && (
                    <path d={areaPath} fill="#3b82f6" opacity={0.18} />
                  )}
                  <path
                    d={linePath}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                  {pts.map((p) => (
                    <circle
                      key={p.idx}
                      cx={p.x}
                      cy={p.y}
                      r={hoveredIdx === p.idx ? 5 : 3}
                      fill={hoveredIdx === p.idx ? '#60a5fa' : '#3b82f6'}
                      stroke="#14151a"
                      strokeWidth={1.5}
                      onMouseEnter={() => setHoveredIdx(p.idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      className="cursor-pointer"
                    />
                  ))}
                </>
              );
            })()}

            {/* X-Axis Labels (sampled to prevent overlap) */}
            {series.map((item, idx) => {
              const step = Math.max(1, Math.ceil(series.length / 12));
              if (idx % step !== 0) return null;
              const slotW = plotW / Math.max(1, series.length);
              const x =
                chartType === 'bar'
                  ? pad.left + idx * slotW + slotW / 2
                  : series.length === 1
                  ? pad.left + plotW / 2
                  : pad.left + (idx / (series.length - 1)) * plotW;
              const shortLabel =
                item.label.length > 14 ? item.label.slice(0, 12) + '…' : item.label;

              return (
                <text
                  key={idx}
                  x={x}
                  y={svgHeight - pad.bottom + 16}
                  textAnchor="middle"
                  fill="#a1a1aa"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {shortLabel}
                </text>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
};
