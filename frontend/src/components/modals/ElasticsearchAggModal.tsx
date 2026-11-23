import React, { useEffect, useState } from 'react';
import { X, BarChart3, Loader2, Filter } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';

interface ElasticsearchAggModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  indexName: string;
  fieldName: string;
  fieldDataType?: string;
  onFilterByValue?: (whereExpr: string) => void;
}

type AggCategory = 'terms' | 'numeric' | 'date';

interface BucketItem {
  label: string;
  rawKey: any;
  count: number;
}

function detectAggCategory(dataType?: string): AggCategory {
  const dt = (dataType || '').toLowerCase();
  if (dt.includes('date')) return 'date';
  if (
    dt.includes('long') ||
    dt.includes('int') ||
    dt.includes('short') ||
    dt.includes('byte') ||
    dt.includes('double') ||
    dt.includes('float') ||
    dt.includes('scaled_float') ||
    dt === 'number'
  ) {
    return 'numeric';
  }
  return 'terms';
}

export const ElasticsearchAggModal: React.FC<ElasticsearchAggModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  indexName,
  fieldName,
  fieldDataType = '',
  onFilterByValue,
}) => {
  const category = detectAggCategory(fieldDataType);
  const isTextType = (fieldDataType || '').toLowerCase().startsWith('text');

  const [useKeywordSubfield, setUseKeywordSubfield] = useState(isTextType);
  const [dateInterval, setDateInterval] = useState<'hour' | 'day' | 'week' | 'month' | 'year'>('day');
  const [histInterval, setHistInterval] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<BucketItem[]>([]);
  const [cardinality, setCardinality] = useState<number | null>(null);
  const [stats, setStats] = useState<Record<string, any> | null>(null);
  const [percentiles, setPercentiles] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    setUseKeywordSubfield((fieldDataType || '').toLowerCase().startsWith('text'));
  }, [fieldName, fieldDataType, isOpen]);

  const targetAggField = useKeywordSubfield && !fieldName.endsWith('.keyword') ? `${fieldName}.keyword` : fieldName;

  const loadAggregations = async () => {
    if (!isOpen || !connectionId || !indexName || !fieldName) return;
    setLoading(true);
    setError(null);
    setBuckets([]);
    setCardinality(null);
    setStats(null);
    setPercentiles(null);

    try {
      const aggs: Record<string, any> = {};
      if (category === 'terms') {
        aggs.top_values = {
          terms: { field: targetAggField, size: 25 },
        };
        aggs.unique_count = {
          cardinality: { field: targetAggField },
        };
      } else if (category === 'date') {
        aggs.timeline = {
          date_histogram: {
            field: fieldName,
            calendar_interval: dateInterval,
            min_doc_count: 1,
          },
        };
        aggs.date_stats = {
          stats: { field: fieldName },
        };
      } else {
        // Numeric: first fetch extended_stats + percentiles; if histInterval not set, compute auto interval
        aggs.ext_stats = { extended_stats: { field: fieldName } };
        aggs.pcts = { percentiles: { field: fieldName, percents: [50, 95, 99] } };
        if (histInterval.trim() && Number(histInterval) > 0) {
          aggs.hist = {
            histogram: {
              field: fieldName,
              interval: Number(histInterval),
              min_doc_count: 1,
            },
          };
        }
      }

      const cmd = `POST /${encodeURIComponent(indexName)}/_search\n${JSON.stringify({
        size: 0,
        track_total_hits: true,
        aggs,
      })}`;

      const res = await QueryService.ExecuteQuery({
        executionId: `es-agg-${Date.now()}`,
        connectionId,
        database: 'default',
        schema: 'default',
        sql: cmd,
        limit: 1,
        offset: 0,
      } as any);
      if (res?.error) throw new Error(res.error);

      // Driver may return tabular agg rows or raw JSON depending on response; fetch raw JSON if needed
      const rawCell = res?.rows?.[0]?.[0];
      let parsed: any = null;
      if (typeof rawCell === 'string' && rawCell.trim().startsWith('{')) {
        try {
          parsed = JSON.parse(rawCell);
        } catch {}
      }

      if (parsed?.aggregations) {
        const a = parsed.aggregations;
        if (a.unique_count?.value !== undefined) setCardinality(Number(a.unique_count.value));
        if (a.top_values?.buckets) {
          setBuckets(
            a.top_values.buckets.map((b: any) => ({
              label: b.key_as_string ?? String(b.key ?? 'NULL'),
              rawKey: b.key,
              count: Number(b.doc_count || 0),
            }))
          );
        }
        if (a.timeline?.buckets) {
          setBuckets(
            a.timeline.buckets.map((b: any) => ({
              label: b.key_as_string ?? String(b.key),
              rawKey: b.key_as_string ?? b.key,
              count: Number(b.doc_count || 0),
            }))
          );
        }
        if (a.date_stats) setStats(a.date_stats);
        if (a.ext_stats) setStats(a.ext_stats);
        if (a.pcts?.values) setPercentiles(a.pcts.values);
        if (a.hist?.buckets) {
          setBuckets(
            a.hist.buckets.map((b: any) => ({
              label: String(b.key),
              rawKey: b.key,
              count: Number(b.doc_count || 0),
            }))
          );
        }
      } else if (res?.columns && res.columns.some((c: any) => c.name === 'aggregation')) {
        // Parse flattened agg table returned by parseESAggregationsToQueryResult
        const cols = res.columns.map((c: any) => c.name);
        const aggIdx = cols.indexOf('aggregation');
        const keyIdx = cols.indexOf('key');
        const keyStrIdx = cols.indexOf('key_as_string');
        const docCntIdx = cols.indexOf('doc_count');
        const valIdx = cols.indexOf('value');

        const parsedBuckets: BucketItem[] = [];
        for (const r of (res.rows || []) as any[][]) {
          if (!r) continue;
          const aggName = String(r[aggIdx] ?? '');
          if (aggName === 'unique_count' && valIdx !== -1) {
            setCardinality(Number(r[valIdx] ?? 0));
          } else if (aggName === 'ext_stats' || aggName === 'date_stats') {
            const stObj: Record<string, any> = {};
            cols.forEach((cname: string, ci: number) => {
              if (cname !== 'aggregation') stObj[cname] = r[ci];
            });
            setStats(stObj);
          } else if (aggName === 'pcts') {
            const valCol = cols.indexOf('values');
            if (valCol !== -1) {
              try {
                setPercentiles(typeof r[valCol] === 'string' ? JSON.parse(r[valCol]) : r[valCol]);
              } catch {}
            }
          } else if (docCntIdx !== -1 && (keyIdx !== -1 || keyStrIdx !== -1)) {
            const rawKey = keyIdx !== -1 ? r[keyIdx] : r[keyStrIdx];
            const label = keyStrIdx !== -1 && r[keyStrIdx] ? String(r[keyStrIdx]) : String(rawKey ?? '');
            parsedBuckets.push({
              label,
              rawKey,
              count: Number(r[docCntIdx] ?? 0),
            });
          }
        }
        setBuckets(parsedBuckets);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAggregations();
  }, [isOpen, connectionId, indexName, fieldName, useKeywordSubfield, dateInterval]);

  if (!isOpen) return null;

  const maxCount = buckets.reduce((m, b) => Math.max(m, b.count), 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden text-xs">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d] shrink-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-cyan-400" />
            <span className="font-semibold text-sm text-zinc-100">
              Aggregations: <code className="text-cyan-300 font-mono">{fieldName}</code>
              {fieldDataType && <span className="ml-2 text-[11px] font-mono text-zinc-500">({fieldDataType})</span>}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded text-zinc-400 hover:text-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#272932]">
            {category === 'terms' && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useKeywordSubfield}
                    onChange={(e) => setUseKeywordSubfield(e.target.checked)}
                  />
                  <span>Use <code>.keyword</code> sub-field</span>
                </label>
                {cardinality !== null && (
                  <span className="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono text-[11px]">
                    Unique values: ~{cardinality.toLocaleString()}
                  </span>
                )}
              </div>
            )}

            {category === 'date' && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-400">Calendar Interval:</span>
                {(['hour', 'day', 'week', 'month', 'year'] as const).map((iv) => (
                  <button
                    key={iv}
                    type="button"
                    onClick={() => setDateInterval(iv)}
                    className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                      dateInterval === iv
                        ? 'bg-cyan-600 text-white font-medium'
                        : 'bg-[#121317] text-zinc-400 hover:text-zinc-200 border border-[#272932]'
                    }`}
                  >
                    {iv}
                  </button>
                ))}
              </div>
            )}

            {category === 'numeric' && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-400">Histogram Interval:</span>
                <input
                  type="number"
                  min={0.01}
                  step="any"
                  placeholder="e.g. 10"
                  value={histInterval}
                  onChange={(e) => setHistInterval(e.target.value)}
                  className="w-24 rounded bg-[#121317] border border-[#272932] px-2 py-0.5 text-[11px] font-mono text-zinc-100"
                />
                <button
                  type="button"
                  onClick={loadAggregations}
                  className="px-2.5 py-0.5 rounded bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-200 text-[11px] cursor-pointer"
                >
                  Apply Histogram
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Computing Elasticsearch aggregations...</span>
            </div>
          ) : error ? (
            <div className="rounded-lg bg-rose-950/30 border border-rose-500/40 p-3 text-[11px] text-rose-300">
              {error}
              {category === 'terms' && !useKeywordSubfield && (
                <div className="text-zinc-400 mt-1">
                  Tip: Analyzed <code>text</code> fields require <code>.keyword</code> sub-field or <code>fielddata: true</code> for aggregations.
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Numeric / Date Extended Stats */}
              {stats && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { k: 'count', label: 'Count' },
                    { k: 'min_as_string', alt: 'min', label: 'Min' },
                    { k: 'max_as_string', alt: 'max', label: 'Max' },
                    { k: 'avg', label: 'Avg' },
                    { k: 'sum', label: 'Sum' },
                    { k: 'std_deviation', label: 'Std Dev' },
                  ].map((item) => {
                    const val = stats[item.k] ?? (item.alt ? stats[item.alt] : undefined);
                    if (val === undefined || val === null) return null;
                    const formatted =
                      typeof val === 'number'
                        ? Number.isInteger(val)
                          ? val.toLocaleString()
                          : val.toFixed(3)
                        : String(val);
                    return (
                      <div key={item.label} className="rounded-lg border border-[#272934] bg-[#14151b] p-2">
                        <div className="text-[10px] text-zinc-500 uppercase">{item.label}</div>
                        <div className="font-mono text-zinc-100 font-semibold mt-0.5 truncate" title={formatted}>
                          {formatted}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {percentiles && Object.keys(percentiles).length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#272934] bg-[#14151b] px-3 py-2">
                  <span className="text-[10px] uppercase text-zinc-500 mr-1">Percentiles:</span>
                  {Object.entries(percentiles).map(([p, v]) => (
                    <span key={p} className="px-2 py-0.5 rounded bg-[#1b1d26] border border-[#2d303d] font-mono text-[11px]">
                      p{p}: <strong className="text-emerald-300">{typeof v === 'number' ? v.toFixed(2) : String(v)}</strong>
                    </span>
                  ))}
                </div>
              )}

              {/* Buckets Chart */}
              {buckets.length > 0 ? (
                <div className="space-y-2">
                  {buckets.map((b, idx) => {
                    const pct = Math.max(4, Math.round((b.count / maxCount) * 100));
                    return (
                      <div
                        key={idx}
                        className="group flex items-center justify-between gap-3 rounded-lg border border-[#272934] bg-[#14151b] px-3 py-2"
                      >
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-zinc-100 truncate" title={b.label}>
                              {b.label}
                            </span>
                            <span className="font-mono text-emerald-300 font-semibold shrink-0">
                              {b.count.toLocaleString()}
                            </span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-[#1e2029] overflow-hidden">
                            <div className="h-full bg-cyan-500/75 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>

                        {onFilterByValue && category === 'terms' && (
                          <button
                            type="button"
                            onClick={() => {
                              const escaped = String(b.rawKey ?? b.label).replace(/'/g, "''");
                              const expr =
                                typeof b.rawKey === 'number' || typeof b.rawKey === 'boolean'
                                  ? `${targetAggField} = ${b.rawKey}`
                                  : `${targetAggField} = '${escaped}'`;
                              onFilterByValue(expr);
                              onClose();
                            }}
                            className="opacity-70 group-hover:opacity-100 inline-flex items-center gap-1 px-2 py-1 rounded bg-[#222530] hover:bg-blue-600 text-zinc-300 hover:text-white text-[10px] cursor-pointer shrink-0 transition-colors"
                            title="Filter grid by this value"
                          >
                            <Filter className="h-3 w-3" />
                            <span>Filter</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                !stats && <div className="py-8 text-center text-zinc-500">No buckets returned for "{fieldName}".</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
