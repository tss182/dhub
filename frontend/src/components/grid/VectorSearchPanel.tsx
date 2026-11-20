import React, { useMemo, useState } from 'react';
import {
  Search,
  Sparkles,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Copy,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { ColumnMeta } from '../../types/domain';
import { isVectorColumn } from './gridFormatters';

export type VectorDistanceMetric = 'cosine' | 'l2' | 'ip';

export interface VectorSearchStats {
  elapsedMs: number;
  count: number;
  maxScore?: number;
  minScore?: number;
  querySql: string;
}

interface EmbeddingConfig {
  provider: 'ollama' | 'openai';
  endpoint: string;
  model: string;
  apiKey: string;
}

const EMBEDDING_CFG_KEY = 'dhub_vector_embedding_cfg';

function loadEmbeddingConfig(): EmbeddingConfig {
  try {
    const raw = localStorage.getItem(EMBEDDING_CFG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        provider: parsed.provider === 'openai' ? 'openai' : 'ollama',
        endpoint: parsed.endpoint || 'http://localhost:11434/api/embeddings',
        model: parsed.model || 'nomic-embed-text',
        apiKey: parsed.apiKey || '',
      };
    }
  } catch {}
  return {
    provider: 'ollama',
    endpoint: 'http://localhost:11434/api/embeddings',
    model: 'nomic-embed-text',
    apiKey: '',
  };
}

export interface VectorSearchPanelProps {
  driver: string;
  database: string;
  schema: string;
  tableName: string;
  columns: ColumnMeta[];
  rows: any[][];
  isSearching: boolean;
  isVectorSearchActive: boolean;
  searchStats: VectorSearchStats | null;
  error: string | null;
  onExecuteVectorSearch: (sql: string) => void;
  onResetSearch: () => void;
}

function quotePgIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function parseVectorText(raw: string): number[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('[') ? trimmed : `[${trimmed}]`;
  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      return parsed;
    }
  } catch {}
  return null;
}

export const VectorSearchPanel: React.FC<VectorSearchPanelProps> = ({
  driver,
  schema,
  tableName,
  columns,
  rows,
  isSearching,
  isVectorSearchActive,
  searchStats,
  error,
  onExecuteVectorSearch,
  onResetSearch,
}) => {
  const vectorColumns = useMemo(
    () => columns.filter((c) => isVectorColumn(c.dataType, c.rawType)),
    [columns]
  );

  const [isExpanded, setIsExpanded] = useState(false);
  const [inputMode, setInputMode] = useState<'vector' | 'text'>('vector');
  const [selectedCol, setSelectedCol] = useState<string>('');
  const [vectorText, setVectorText] = useState<string>('');
  const [textQuery, setTextQuery] = useState<string>('');
  const [topK, setTopK] = useState<number>(10);
  const [scoreThreshold, setScoreThreshold] = useState<string>('');
  const [metric, setMetric] = useState<VectorDistanceMetric>('cosine');
  const [filterInput, setFilterInput] = useState<string>('');
  const [showEmbedSettings, setShowEmbedSettings] = useState(false);
  const [embedCfg, setEmbedCfg] = useState<EmbeddingConfig>(loadEmbeddingConfig);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [isEmbedding, setIsEmbedding] = useState(false);

  const activeVectorCol = useMemo(() => {
    if (selectedCol && vectorColumns.some((c) => c.name === selectedCol)) {
      return selectedCol;
    }
    return vectorColumns[0]?.name || (driver === 'qdrant' ? 'vector' : 'embedding');
  }, [selectedCol, vectorColumns, driver]);

  if (vectorColumns.length === 0 && driver !== 'qdrant') {
    return null;
  }

  const saveEmbedCfg = (next: EmbeddingConfig) => {
    setEmbedCfg(next);
    try {
      localStorage.setItem(EMBEDDING_CFG_KEY, JSON.stringify(next));
    } catch {}
  };

  const handleUseSampleRowVector = () => {
    const colIdx = columns.findIndex((c) => c.name === activeVectorCol);
    if (colIdx < 0) return;
    for (const row of rows) {
      const val = row?.[colIdx];
      if (val === null || val === undefined) continue;
      if (Array.isArray(val)) {
        setVectorText(JSON.stringify(val));
        setInputMode('vector');
        setEmbedError(null);
        return;
      }
      if (typeof val === 'string' && val.trim().startsWith('[')) {
        setVectorText(val.trim());
        setInputMode('vector');
        setEmbedError(null);
        return;
      }
    }
    setEmbedError('No non-null vector found in currently loaded rows.');
  };

  const generateEmbedding = async (text: string): Promise<number[]> => {
    const endpoint = embedCfg.endpoint.trim();
    if (!endpoint) throw new Error('Embedding endpoint URL is required.');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (embedCfg.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${embedCfg.apiKey.trim()}`;
    }

    if (embedCfg.provider === 'ollama') {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: embedCfg.model.trim() || 'nomic-embed-text', prompt: text }),
      });
      if (!res.ok) {
        throw new Error(`Ollama embedding failed (${res.status}): ${await res.text()}`);
      }
      const data = await res.json();
      if (Array.isArray(data?.embedding)) return data.embedding;
      if (Array.isArray(data?.embeddings?.[0])) return data.embeddings[0];
      throw new Error('Unexpected Ollama embedding response format.');
    }

    // OpenAI-compatible /v1/embeddings
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: embedCfg.model.trim() || 'text-embedding-3-small', input: text }),
    });
    if (!res.ok) {
      throw new Error(`Embedding API failed (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    const vec = data?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) {
      throw new Error('Unexpected OpenAI embedding response format.');
    }
    return vec;
  };

  const buildSearchQuery = (vec: number[]): string => {
    const k = Math.max(1, Math.min(1000, Number(topK) || 10));
    const threshold = scoreThreshold.trim() !== '' && !Number.isNaN(Number(scoreThreshold))
      ? Number(scoreThreshold)
      : null;
    const vecJson = JSON.stringify(vec);
    const filter = filterInput.trim();

    if (driver === 'qdrant') {
      const body: Record<string, any> = {
        limit: k,
        with_payload: true,
        with_vector: true,
      };
      if (activeVectorCol.startsWith('vector.')) {
        body.vector = { name: activeVectorCol.slice('vector.'.length), vector: vec };
      } else {
        body.vector = vec;
      }
      if (threshold !== null) {
        body.score_threshold = threshold;
      }
      if (filter) {
        try {
          body.filter = JSON.parse(filter);
        } catch {
          // Allow simple key=val fallback if not JSON
        }
      }
      return `POST /collections/${encodeURIComponent(tableName)}/points/search\n${JSON.stringify(body, null, 2)}`;
    }

    if (driver === 'elasticsearch') {
      const body: Record<string, any> = {
        knn: {
          field: activeVectorCol,
          query_vector: vec,
          k,
          num_candidates: Math.max(k * 5, 50),
        },
        size: k,
      };
      if (threshold !== null) {
        body.min_score = threshold;
      }
      if (filter) {
        if (filter.startsWith('{')) {
          try {
            body.query = JSON.parse(filter);
          } catch {}
        } else {
          body.query = { query_string: { query: filter } };
        }
      }
      return `POST /${encodeURIComponent(tableName)}/_search\n${JSON.stringify(body, null, 2)}`;
    }

    // PostgreSQL (pgvector)
    const qualifiedTbl =
      schema && schema !== 'main'
        ? `${quotePgIdent(schema)}.${quotePgIdent(tableName)}`
        : quotePgIdent(tableName);
    const colQ = quotePgIdent(activeVectorCol);
    const op = metric === 'l2' ? '<->' : metric === 'ip' ? '<#>' : '<=>';
    const scoreExpr =
      metric === 'l2'
        ? `(${colQ} <-> '${vecJson}') AS distance`
        : metric === 'ip'
        ? `-(${colQ} <#> '${vecJson}') AS score`
        : `1 - (${colQ} <=> '${vecJson}') AS score`;

    const whereParts: string[] = [];
    if (filter) {
      whereParts.push(`(${filter.replace(/^where\s+/i, '')})`);
    }
    if (threshold !== null) {
      if (metric === 'l2') {
        whereParts.push(`(${colQ} <-> '${vecJson}') <= ${threshold}`);
      } else if (metric === 'ip') {
        whereParts.push(`-(${colQ} <#> '${vecJson}') >= ${threshold}`);
      } else {
        whereParts.push(`1 - (${colQ} <=> '${vecJson}') >= ${threshold}`);
      }
    }
    const whereSql = whereParts.length > 0 ? `\nWHERE ${whereParts.join(' AND ')}` : '';
    return `SELECT *, ${scoreExpr}\nFROM ${qualifiedTbl}${whereSql}\nORDER BY ${colQ} ${op} '${vecJson}'\nLIMIT ${k};`;
  };

  const handleRunSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setEmbedError(null);

    let vec: number[] | null = null;
    if (inputMode === 'vector') {
      vec = parseVectorText(vectorText);
      if (!vec) {
        setEmbedError('Enter a valid numeric vector array, e.g. [0.12, -0.04, 0.88]');
        return;
      }
    } else {
      if (!textQuery.trim()) {
        setEmbedError('Enter a text query to generate an embedding.');
        return;
      }
      setIsEmbedding(true);
      try {
        vec = await generateEmbedding(textQuery.trim());
        setVectorText(JSON.stringify(vec));
      } catch (err: any) {
        setEmbedError(err?.message || String(err));
        setIsEmbedding(false);
        return;
      } finally {
        setIsEmbedding(false);
      }
    }

    const sql = buildSearchQuery(vec);
    onExecuteVectorSearch(sql);
  };

  const busy = isSearching || isEmbedding;

  return (
    <div className="border-b border-[#272932] bg-[#14161c] text-xs">
      {/* Compact Header Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 border border-violet-500/30 font-medium transition-colors cursor-pointer"
          >
            <Sparkles className="h-3 w-3" />
            <span>Vector Search</span>
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {isVectorSearchActive && searchStats && (
            <div className="flex items-center gap-2 text-[11px] text-zinc-400 truncate">
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                {searchStats.count} hits • {searchStats.elapsedMs}ms
              </span>
              {searchStats.maxScore !== undefined && (
                <span>
                  score: {searchStats.minScore?.toFixed(4)} – {searchStats.maxScore.toFixed(4)}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isVectorSearchActive && (
            <button
              type="button"
              onClick={onResetSearch}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#1e2028] hover:bg-[#272a35] text-zinc-300 border border-[#2d303c] text-[11px] cursor-pointer"
              title="Reset to normal table browse"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Expanded Vector & Hybrid Search Form */}
      {isExpanded && (
        <form onSubmit={handleRunSearch} className="px-3 pb-3 pt-1 space-y-2.5 border-t border-[#22242c]">
          <div className="flex flex-wrap items-center gap-2">
            {/* Input mode toggle */}
            <div className="inline-flex rounded bg-[#101115] border border-[#272932] p-0.5">
              <button
                type="button"
                onClick={() => setInputMode('vector')}
                className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${
                  inputMode === 'vector' ? 'bg-violet-600 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Raw Vector
              </button>
              <button
                type="button"
                onClick={() => setInputMode('text')}
                className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${
                  inputMode === 'text' ? 'bg-violet-600 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Text (Embed)
              </button>
            </div>

            {/* Vector Column */}
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-zinc-500">Field:</span>
              <select
                value={activeVectorCol}
                onChange={(e) => setSelectedCol(e.target.value)}
                className="rounded bg-[#101115] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none font-mono"
              >
                {vectorColumns.length > 0 ? (
                  vectorColumns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.dataType})
                    </option>
                  ))
                ) : (
                  <option value="vector">vector</option>
                )}
              </select>
            </div>

            {/* Top-K */}
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-zinc-500">Top-K:</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="w-16 rounded bg-[#101115] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none tabular-nums"
              />
            </div>

            {/* Score Threshold */}
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-zinc-500">Min Score:</span>
              <input
                type="text"
                placeholder="optional"
                value={scoreThreshold}
                onChange={(e) => setScoreThreshold(e.target.value)}
                className="w-20 rounded bg-[#101115] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none tabular-nums"
              />
            </div>

            {/* Distance Metric (for pgvector) */}
            {driver === 'postgres' && (
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-zinc-500">Metric:</span>
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as VectorDistanceMetric)}
                  className="rounded bg-[#101115] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                >
                  <option value="cosine">Cosine (&lt;=&gt;)</option>
                  <option value="l2">L2 (&lt;-&gt;)</option>
                  <option value="ip">Inner Product (&lt;#&gt;)</option>
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={handleUseSampleRowVector}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#1b1d25] hover:bg-[#252833] text-zinc-300 border border-[#2d303c] text-[11px] cursor-pointer"
              title="Copy vector from first loaded row to test similarity"
            >
              <Copy className="h-3 w-3" />
              <span>Use sample row vector</span>
            </button>

            {inputMode === 'text' && (
              <button
                type="button"
                onClick={() => setShowEmbedSettings((v) => !v)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#1b1d25] hover:bg-[#252833] text-zinc-300 border border-[#2d303c] text-[11px] cursor-pointer"
              >
                <SlidersHorizontal className="h-3 w-3" />
                <span>Embedding API</span>
              </button>
            )}
          </div>

          {/* Embedding Provider Settings (when Text mode & toggled) */}
          {inputMode === 'text' && showEmbedSettings && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 p-2 rounded bg-[#101115] border border-[#272932]">
              <div>
                <label className="block text-[10px] text-zinc-500 mb-0.5">Provider</label>
                <select
                  value={embedCfg.provider}
                  onChange={(e) => {
                    const p = e.target.value === 'openai' ? 'openai' : 'ollama';
                    saveEmbedCfg({
                      ...embedCfg,
                      provider: p,
                      endpoint:
                        p === 'ollama'
                          ? 'http://localhost:11434/api/embeddings'
                          : 'https://api.openai.com/v1/embeddings',
                      model: p === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small',
                    });
                  }}
                  className="w-full rounded bg-[#161820] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200"
                >
                  <option value="ollama">Ollama (Local)</option>
                  <option value="openai">OpenAI / Compatible</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 mb-0.5">Endpoint URL</label>
                <input
                  type="text"
                  value={embedCfg.endpoint}
                  onChange={(e) => saveEmbedCfg({ ...embedCfg, endpoint: e.target.value })}
                  className="w-full rounded bg-[#161820] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 mb-0.5">Model</label>
                <input
                  type="text"
                  value={embedCfg.model}
                  onChange={(e) => saveEmbedCfg({ ...embedCfg, model: e.target.value })}
                  className="w-full rounded bg-[#161820] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 mb-0.5">API Key (if required)</label>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={embedCfg.apiKey}
                  onChange={(e) => saveEmbedCfg({ ...embedCfg, apiKey: e.target.value })}
                  className="w-full rounded bg-[#161820] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200 font-mono"
                />
              </div>
            </div>
          )}

          {/* Main Query Input + Filter */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="md:col-span-2">
              {inputMode === 'vector' ? (
                <input
                  type="text"
                  placeholder="Paste query vector array, e.g. [0.012, -0.043, 0.089, ...]"
                  value={vectorText}
                  onChange={(e) => setVectorText(e.target.value)}
                  className="w-full rounded bg-[#101115] border border-[#272932] px-2.5 py-1.5 text-[11px] text-zinc-200 font-mono focus:border-violet-500 focus:outline-none"
                />
              ) : (
                <input
                  type="text"
                  placeholder={`Search text via ${embedCfg.model} (${embedCfg.provider})...`}
                  value={textQuery}
                  onChange={(e) => setTextQuery(e.target.value)}
                  className="w-full rounded bg-[#101115] border border-[#272932] px-2.5 py-1.5 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                />
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder={
                  driver === 'qdrant'
                    ? 'Filter JSON (optional)'
                    : driver === 'elasticsearch'
                    ? 'Hybrid query / JSON (optional)'
                    : 'SQL WHERE filter (optional)'
                }
                value={filterInput}
                onChange={(e) => setFilterInput(e.target.value)}
                className="flex-1 rounded bg-[#101115] border border-[#272932] px-2.5 py-1.5 text-[11px] text-zinc-200 font-mono focus:border-violet-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium transition-colors cursor-pointer shrink-0"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                <span>{isEmbedding ? 'Embedding...' : 'Search'}</span>
              </button>
            </div>
          </div>

          {(embedError || error) && (
            <div className="flex items-center gap-1.5 text-[11px] text-rose-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{embedError || error}</span>
            </div>
          )}
        </form>
      )}
    </div>
  );
};
