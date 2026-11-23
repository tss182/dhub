import React, { useState, useMemo } from 'react';
import {
  X,
  Plus,
  Play,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
  Layers,
  Loader2,
  Terminal,
} from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError } from '../../stores/useAlertStore';

interface MongoAggregationModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  collectionName: string;
  onOpenInConsole?: (mql: string) => void;
}

interface PipelineStage {
  id: string;
  operator: string;
  body: string;
  enabled: boolean;
}

const STAGE_TEMPLATES: Record<string, string> = {
  $match: '{\n  "status": "active"\n}',
  $project: '{\n  "_id": 1,\n  "name": 1\n}',
  $group: '{\n  "_id": "$category",\n  "count": { "$sum": 1 }\n}',
  $sort: '{\n  "count": -1\n}',
  $limit: '20',
  $skip: '0',
  $unwind: '"$tags"',
  $lookup: '{\n  "from": "other_collection",\n  "localField": "refId",\n  "foreignField": "_id",\n  "as": "joined"\n}',
  $addFields: '{\n  "computed": true\n}',
  $count: '"totalCount"',
};

export const MongoAggregationModal: React.FC<MongoAggregationModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  collectionName,
  onOpenInConsole,
}) => {
  const [stages, setStages] = useState<PipelineStage[]>([
    { id: '1', operator: '$match', body: STAGE_TEMPLATES.$match, enabled: true },
    { id: '2', operator: '$limit', body: '20', enabled: true },
  ]);
  const [previewRows, setPreviewRows] = useState<any[][]>([]);
  const [previewCols, setPreviewCols] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const generatedMql = useMemo(() => {
    const active = stages.filter((s) => s.enabled);
    const stageStrs = active.map((s) => `  { ${JSON.stringify(s.operator)}: ${s.body.trim()} }`);
    return `db.getCollection(${JSON.stringify(collectionName)}).aggregate([\n${stageStrs.join(',\n')}\n]);`;
  }, [stages, collectionName]);

  if (!isOpen) return null;

  const addStage = (op: string) => {
    setStages((prev) => [
      ...prev,
      {
        id: String(Date.now() + Math.random()),
        operator: op,
        body: STAGE_TEMPLATES[op] || '{}',
        enabled: true,
      },
    ]);
  };

  const moveStage = (idx: number, dir: -1 | 1) => {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= stages.length) return;
    setStages((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  const runPreview = async (upToIndex?: number) => {
    setIsRunning(true);
    try {
      const slice = upToIndex !== undefined ? stages.slice(0, upToIndex + 1) : stages;
      const active = slice.filter((s) => s.enabled);
      const hasLimit = active.some((s) => s.operator === '$limit');
      const stageStrs = active.map((s) => `{ ${JSON.stringify(s.operator)}: ${s.body.trim()} }`);
      if (!hasLimit) {
        stageStrs.push('{ "$limit": 20 }');
      }
      const mql = `db.getCollection(${JSON.stringify(collectionName)}).aggregate([\n${stageStrs.join(',\n')}\n]);`;
      const res = await QueryService.ExecuteQuery({
        executionId: 'mongo-agg-' + Date.now(),
        connectionId,
        database,
        schema: database,
        sql: mql,
        limit: 50,
        offset: 0,
      } as any);
      setPreviewCols((res?.columns || []).map((c: any) => c.name));
      setPreviewRows((res?.rows || []).filter((r): r is any[] => Array.isArray(r)));
    } catch (err: any) {
      alertError(err?.message || String(err), 'Aggregation Preview Failed');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-5xl rounded-xl border border-[#282b36] bg-[#14161d] shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#222530]">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-100">
              Aggregation Pipeline Builder — {database}.{collectionName}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-[#20232d] bg-[#101218] flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-zinc-500 mr-1">Add Stage:</span>
          {Object.keys(STAGE_TEMPLATES).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => addStage(op)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#1d202b] hover:bg-[#272b3a] border border-[#2c3040] text-emerald-300 font-mono cursor-pointer"
            >
              <Plus className="w-2.5 h-2.5" />
              {op}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#222530] overflow-hidden">
          <div className="p-4 overflow-y-auto space-y-3">
            {stages.map((st, idx) => (
              <div
                key={st.id}
                className={`rounded-lg border p-3 space-y-2 ${
                  st.enabled ? 'border-[#292d3b] bg-[#101218]' : 'border-[#20222c] bg-[#0d0e13] opacity-60'
                }`}
              >
                <div className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={st.enabled}
                    onChange={(e) =>
                      setStages((prev) =>
                        prev.map((x) => (x.id === st.id ? { ...x, enabled: e.target.checked } : x))
                      )
                    }
                  />
                  <span className="font-mono font-semibold text-emerald-400">
                    Stage {idx + 1}: {st.operator}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => runPreview(idx)}
                      className="px-2 py-0.5 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-[10px] cursor-pointer"
                      title="Preview output up to this stage"
                    >
                      Preview
                    </button>
                    <button type="button" onClick={() => moveStage(idx, -1)} className="p-1 text-zinc-400 hover:text-white cursor-pointer">
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button type="button" onClick={() => moveStage(idx, 1)} className="p-1 text-zinc-400 hover:text-white cursor-pointer">
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setStages((prev) => [
                          ...prev.slice(0, idx + 1),
                          { ...st, id: String(Date.now() + Math.random()) },
                          ...prev.slice(idx + 1),
                        ])
                      }
                      className="p-1 text-zinc-400 hover:text-white cursor-pointer"
                      title="Duplicate stage"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setStages((prev) => prev.filter((x) => x.id !== st.id))}
                      className="p-1 text-zinc-400 hover:text-rose-400 cursor-pointer"
                      title="Remove stage"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <textarea
                  rows={4}
                  value={st.body}
                  onChange={(e) =>
                    setStages((prev) =>
                      prev.map((x) => (x.id === st.id ? { ...x, body: e.target.value } : x))
                    )
                  }
                  spellCheck={false}
                  className="w-full rounded border border-[#262936] bg-[#0a0b0f] p-2 font-mono text-[11px] text-zinc-100 outline-none focus:border-emerald-500/60"
                />
              </div>
            ))}
          </div>

          <div className="p-4 overflow-y-auto flex flex-col gap-3 bg-[#0e1015]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-300">
                Pipeline Preview ({previewRows.length} rows)
              </span>
              <button
                type="button"
                onClick={() => runPreview()}
                disabled={isRunning}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer"
              >
                {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Run Pipeline
              </button>
            </div>

            {previewCols.length > 0 ? (
              <div className="flex-1 overflow-auto rounded-lg border border-[#242733]">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead className="bg-[#161820] text-zinc-400 border-b border-[#242733]">
                    <tr>
                      {previewCols.map((c) => (
                        <th key={c} className="px-2.5 py-1.5 whitespace-nowrap">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e212b]">
                    {previewRows.map((r, rIdx) => (
                      <tr key={rIdx} className="hover:bg-[#181b24]">
                        {previewCols.map((_, cIdx) => (
                          <td key={cIdx} className="px-2.5 py-1.5 max-w-[240px] truncate text-zinc-200">
                            {r[cIdx] === null || r[cIdx] === undefined ? 'null' : String(r[cIdx])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-zinc-500 border border-dashed border-[#242733] rounded-lg min-h-[180px]">
                Click "Run Pipeline" or "Preview" on any stage to inspect output documents.
              </div>
            )}

            <div>
              <div className="text-[11px] text-zinc-400 mb-1">Generated MQL</div>
              <pre className="rounded-lg border border-[#232633] bg-[#0a0b0f] p-2.5 font-mono text-[11px] text-emerald-300 overflow-x-auto max-h-36">
                {generatedMql}
              </pre>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#222530]">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md text-xs bg-[#1e212b] hover:bg-[#282c3a] text-zinc-300 cursor-pointer">
            Close
          </button>
          {onOpenInConsole && (
            <button
              type="button"
              onClick={() => {
                onOpenInConsole(generatedMql);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
            >
              <Terminal className="w-3.5 h-3.5" />
              Open in Query Console
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
