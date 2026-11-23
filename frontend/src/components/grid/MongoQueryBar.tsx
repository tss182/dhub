import React, { useState } from 'react';
import { Play, Sparkles, SlidersHorizontal, X } from 'lucide-react';

interface MongoQueryBarProps {
  collectionName: string;
  filter: string;
  onFilterChange: (next: string) => void;
  onApplyFilter: (filterStr: string, sortStr?: string, projectStr?: string) => void;
  onOpenExplain?: (mql: string) => void;
}

export const MongoQueryBar: React.FC<MongoQueryBarProps> = ({
  collectionName,
  filter,
  onFilterChange,
  onApplyFilter,
  onOpenExplain,
}) => {
  const [showOptions, setShowOptions] = useState(false);
  const [sortStr, setSortStr] = useState('');
  const [projectStr, setProjectStr] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const validateDoc = (raw: string, label: string): boolean => {
    const t = raw.trim();
    if (!t) return true;
    if (!t.startsWith('{') || !t.endsWith('}')) {
      setJsonError(`${label} must be a JSON object { ... }`);
      return false;
    }
    return true;
  };

  const handleFind = () => {
    setJsonError(null);
    if (!validateDoc(filter, 'Filter')) return;
    if (showOptions) {
      if (!validateDoc(sortStr, 'Sort')) return;
      if (!validateDoc(projectStr, 'Project')) return;
    }
    onApplyFilter(filter, sortStr, projectStr);
  };

  const handleExplain = () => {
    if (!onOpenExplain) return;
    const f = filter.trim() || '{}';
    const p = projectStr.trim() ? `, ${projectStr.trim()}` : '';
    const s = sortStr.trim() ? `.sort(${sortStr.trim()})` : '';
    onOpenExplain(`db.getCollection(${JSON.stringify(collectionName)}).find(${f}${p})${s}.explain("executionStats");`);
  };

  return (
    <div className="border-b border-[#22242c] bg-[#13151b] px-3 py-1.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
          FILTER
        </span>
        <input
          type="text"
          value={filter}
          onChange={(e) => {
            onFilterChange(e.target.value);
            if (jsonError) setJsonError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleFind();
            }
          }}
          placeholder='{ "status": "active", "age": { "$gte": 18 } }'
          className="flex-1 bg-[#0c0d11] border border-[#282b36] focus:border-emerald-500/60 rounded px-2.5 py-1 text-xs font-mono text-zinc-200 placeholder-zinc-600 outline-none"
        />
        {filter.trim() && (
          <button
            type="button"
            onClick={() => {
              onFilterChange('');
              onApplyFilter('', sortStr, projectStr);
            }}
            className="p-1 rounded hover:bg-[#252834] text-zinc-500 hover:text-zinc-200 cursor-pointer"
            title="Clear Filter"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowOptions((p) => !p)}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition-colors cursor-pointer ${
            showOptions
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
              : 'bg-[#1b1e27] border-[#2b2e3b] text-zinc-400 hover:text-zinc-200'
          }`}
          title="Toggle Project & Sort options"
        >
          <SlidersHorizontal className="w-3 h-3" />
          Options
        </button>
        {onOpenExplain && (
          <button
            type="button"
            onClick={handleExplain}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[#1b1e27] hover:bg-[#262a36] border border-[#2b2e3b] text-amber-300 cursor-pointer"
            title="Run .explain('executionStats') in Query Console"
          >
            <Sparkles className="w-3 h-3" />
            Explain
          </button>
        )}
        <button
          type="button"
          onClick={handleFind}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
        >
          <Play className="w-3 h-3" />
          Find
        </button>
      </div>

      {showOptions && (
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-zinc-400 w-14 shrink-0">PROJECT</span>
            <input
              type="text"
              value={projectStr}
              onChange={(e) => setProjectStr(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFind()}
              placeholder='{ "name": 1, "email": 1 }'
              className="flex-1 bg-[#0c0d11] border border-[#282b36] focus:border-emerald-500/60 rounded px-2 py-1 text-xs font-mono text-zinc-200 placeholder-zinc-600 outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-zinc-400 w-10 shrink-0">SORT</span>
            <input
              type="text"
              value={sortStr}
              onChange={(e) => setSortStr(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFind()}
              placeholder='{ "createdAt": -1 }'
              className="flex-1 bg-[#0c0d11] border border-[#282b36] focus:border-emerald-500/60 rounded px-2 py-1 text-xs font-mono text-zinc-200 placeholder-zinc-600 outline-none"
            />
          </div>
        </div>
      )}

      {jsonError && <div className="text-[11px] text-rose-400 font-mono">{jsonError}</div>}
    </div>
  );
};
