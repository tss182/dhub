import React, { useEffect, useState } from 'react';
import { X, BarChart3, Loader2, Filter } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';

interface QdrantFacetModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  collectionName: string;
  fieldName: string;
  onFilterByValue?: (whereExpr: string) => void;
}

interface FacetHit {
  value: any;
  count: number;
}

export const QdrantFacetModal: React.FC<QdrantFacetModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  collectionName,
  fieldName,
  onFilterByValue,
}) => {
  const [hits, setHits] = useState<FacetHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !connectionId || !collectionName || !fieldName) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHits([]);

    const cmd = `POST /collections/${encodeURIComponent(collectionName)}/facet\n${JSON.stringify({
      key: fieldName,
      limit: 25,
      exact: true,
    })}`;

    QueryService.ExecuteQuery({
      executionId: `qdrant-facet-${Date.now()}`,
      connectionId,
      database: 'default',
      schema: 'default',
      sql: cmd,
      limit: 50,
      offset: 0,
    } as any)
      .then((res) => {
        if (cancelled) return;
        if (res?.error) throw new Error(res.error);
        const rows = (res?.rows as any[][]) || [];
        setHits(rows.map((r) => ({ value: r[0], count: Number(r[1] || 0) })));
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, connectionId, collectionName, fieldName]);

  if (!isOpen) return null;

  const maxCount = hits.reduce((m, h) => Math.max(m, h.count), 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-lg max-h-[82vh] flex flex-col rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden text-xs">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d] shrink-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-cyan-400" />
            <span className="font-semibold text-sm text-zinc-100">
              Facet Distribution: <code className="text-cyan-300 font-mono">{fieldName}</code>
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded text-zinc-400 hover:text-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Computing facet counts...</span>
            </div>
          ) : error ? (
            <div className="rounded-lg bg-rose-950/30 border border-rose-500/40 p-3 text-[11px] text-rose-300">
              {error}
              <div className="text-zinc-400 mt-1">
                Tip: Qdrant Facet API requires a payload index (keyword/integer/uuid/bool) on "{fieldName}".
              </div>
            </div>
          ) : hits.length === 0 ? (
            <div className="py-8 text-center text-zinc-500">No values found for "{fieldName}".</div>
          ) : (
            <div className="space-y-2">
              {hits.map((h, idx) => {
                const pct = Math.max(4, Math.round((h.count / maxCount) * 100));
                const displayVal = h.value === null || h.value === undefined ? 'NULL' : String(h.value);
                return (
                  <div
                    key={idx}
                    className="group flex items-center justify-between gap-3 rounded-lg border border-[#272934] bg-[#14151b] px-3 py-2"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-zinc-100 truncate" title={displayVal}>
                          {displayVal}
                        </span>
                        <span className="font-mono text-emerald-300 font-semibold shrink-0">
                          {h.count.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded bg-[#1f222c] overflow-hidden">
                        <div className="h-full bg-cyan-500/70 rounded" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    {onFilterByValue && (
                      <button
                        type="button"
                        onClick={() => {
                          const lit =
                            typeof h.value === 'number' || typeof h.value === 'boolean'
                              ? String(h.value)
                              : `'${String(h.value).replace(/'/g, "''")}'`;
                          onFilterByValue(`${fieldName} = ${lit}`);
                          onClose();
                        }}
                        className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600/25 hover:bg-blue-600 text-blue-300 hover:text-white text-[10px] cursor-pointer transition-all shrink-0"
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
          )}
        </div>
      </div>
    </div>
  );
};
