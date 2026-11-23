import React, { useState, useEffect, useCallback } from 'react';
import { X, BarChart3, Loader2, Filter } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError } from '../../stores/useAlertStore';

interface MongoFieldAggModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  collectionName: string;
  fieldName: string;
  onFilterByValue?: (filterJson: string) => void;
}

export const MongoFieldAggModal: React.FC<MongoFieldAggModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  collectionName,
  fieldName,
  onFilterByValue,
}) => {
  const [unwindArray, setUnwindArray] = useState(false);
  const [loading, setLoading] = useState(false);
  const [buckets, setBuckets] = useState<{ value: any; count: number }[]>([]);

  const loadDistribution = useCallback(async () => {
    if (!isOpen || !connectionId || !collectionName || !fieldName) return;
    setLoading(true);
    try {
      const stages: any[] = [];
      if (unwindArray) {
        stages.push({ $unwind: `$${fieldName}` });
      }
      stages.push({ $group: { _id: `$${fieldName}`, count: { $sum: 1 } } });
      stages.push({ $sort: { count: -1 } });
      stages.push({ $limit: 25 });

      const mql = `db.getCollection(${JSON.stringify(collectionName)}).aggregate(${JSON.stringify(stages)});`;
      const res = await QueryService.ExecuteQuery({
        executionId: 'mongo-field-agg-' + Date.now(),
        connectionId,
        database,
        schema: database,
        sql: mql,
        limit: 50,
        offset: 0,
      } as any);

      const cols = res?.columns || [];
      const idIdx = cols.findIndex((c: any) => c.name === '_id');
      const cntIdx = cols.findIndex((c: any) => c.name === 'count');
      const list = (res?.rows || []).map((r: any[] | null) => ({
        value: idIdx >= 0 ? r?.[idIdx] : r?.[0],
        count: Number(cntIdx >= 0 ? r?.[cntIdx] : r?.[1]) || 0,
      }));
      setBuckets(list);
    } catch (err: any) {
      alertError(err?.message || String(err), 'Field Distribution Failed');
    } finally {
      setLoading(false);
    }
  }, [isOpen, connectionId, database, collectionName, fieldName, unwindArray]);

  useEffect(() => {
    if (isOpen) {
      loadDistribution();
    }
  }, [isOpen, loadDistribution]);

  if (!isOpen) return null;

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#282b36] bg-[#14161d] shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#222530]">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-100">
              Field Distribution — {fieldName}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-[#20232d] bg-[#101218] flex items-center justify-between text-xs">
          <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={unwindArray}
              onChange={(e) => setUnwindArray(e.target.checked)}
            />
            <span>Unwind array elements ($unwind)</span>
          </label>
          <span className="text-zinc-500 font-mono">Top {buckets.length} values</span>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-zinc-400 gap-2 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" />
              Aggregating values...
            </div>
          ) : buckets.length === 0 ? (
            <div className="text-center text-xs text-zinc-500 py-8">No values found.</div>
          ) : (
            buckets.map((b, i) => {
              const pct = Math.max(4, Math.round((b.count / maxCount) * 100));
              const label = b.value === null || b.value === undefined ? 'null' : String(b.value);
              return (
                <div key={i} className="rounded-lg border border-[#222530] bg-[#0e1015] p-2 space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono gap-2">
                    <span className="text-zinc-200 truncate">{label}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-emerald-400 font-semibold">{b.count}</span>
                      {onFilterByValue && (
                        <button
                          type="button"
                          onClick={() => {
                            onFilterByValue(JSON.stringify({ [fieldName]: b.value }));
                            onClose();
                          }}
                          className="p-1 rounded hover:bg-[#232633] text-zinc-400 hover:text-emerald-300 cursor-pointer"
                          title="Filter collection by this value"
                        >
                          <Filter className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded bg-[#1b1e27] overflow-hidden">
                    <div className="h-full bg-emerald-500/70 rounded" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-end px-4 py-3 border-t border-[#222530]">
          <button type="button" onClick={onClose} className="px-3.5 py-1.5 rounded-md text-xs bg-[#1e212b] hover:bg-[#282c3a] text-zinc-200 cursor-pointer">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
