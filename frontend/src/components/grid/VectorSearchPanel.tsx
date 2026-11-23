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
  ScatterChart,
  Terminal,
  Check,
} from 'lucide-react';
import { ColumnMeta } from '../../types/domain';
import { isVectorColumn } from './gridFormatters';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';

export type VectorDistanceMetric = 'cosine' | 'l2' | 'ip';

export interface VectorSearchStats {
  elapsedMs: number;
  count: number;
  maxScore?: number;
  minScore?: number;
  querySql: string;
}

interface EmbeddingConfig {
  provider: 'openai' | 'gemini';
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
      const provider: EmbeddingConfig['provider'] =
        parsed.provider === 'gemini' ? 'gemini' : 'openai';
      let endpoint = parsed.endpoint || 'https://api.openai.com/v1/embeddings';
      if (parsed.provider === 'ollama' && typeof endpoint === 'string' && endpoint.endsWith('/api/embeddings')) {
        endpoint = endpoint.replace(/\/api\/embeddings$/, '/v1/embeddings');
      }
      return {
        provider,
        endpoint,
        model: parsed.model || (parsed.provider === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small'),
        apiKey: parsed.apiKey || '',
      };
    }
  } catch {}
  return {
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1/embeddings',
    model: 'text-embedding-3-small',
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
  showVisualization?: boolean;
  onToggleVisualization?: () => void;
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

function splitTopLevelKw(input: string, kw: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  const upperKw = kw.toUpperCase();
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      buf += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      buf += ch;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '(') depth++;
      else if (ch === ')' && depth > 0) depth--;
      else if (depth === 0 && i + upperKw.length <= input.length) {
        const prevSpace = i > 0 && /[\s)]/.test(input[i - 1]);
        const nextIdx = i + upperKw.length;
        const nextSpace = nextIdx < input.length && /[\s(]/.test(input[nextIdx]);
        if (prevSpace && nextSpace && input.slice(i, nextIdx).toUpperCase() === upperKw) {
          if (buf.trim()) parts.push(buf.trim());
          buf = '';
          i = nextIdx - 1;
          continue;
        }
      }
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function parseQdrantScalar(rawVal: string): any {
  const t = rawVal.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
  return t;
}

function parseSimpleQdrantFilter(raw: string): Record<string, any> | null {
  let trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner) trimmed = inner;
  }

  const orBranches = splitTopLevelKw(trimmed, 'OR');
  if (orBranches.length > 1) {
    const should = orBranches
      .map((br) => parseSimpleQdrantFilter(br))
      .filter((f): f is Record<string, any> => f !== null);
    return should.length > 0 ? { should } : null;
  }

  const protectedBetween = trimmed.replace(
    /(\b(?:NOT\s+)?BETWEEN\s+(?:'[^']*'|"[^"]*"|\S+))\s+AND\s+('[^']*'|"[^"]*"|\S+)/gi,
    '$1 \x00 $2'
  );
  const parts = splitTopLevelKw(protectedBetween, 'AND');
  const must: any[] = [];
  const mustNot: any[] = [];

  for (let part of parts) {
    part = part.trim();
    if (!part) continue;
    if (part.startsWith('(') && part.endsWith(')')) {
      const inner = part.slice(1, -1).trim();
      if (inner && (splitTopLevelKw(inner, 'OR').length > 1 || splitTopLevelKw(inner, 'AND').length > 1)) {
        const sub = parseSimpleQdrantFilter(inner.replace(/\x00/g, 'AND'));
        if (sub) must.push(sub);
        continue;
      }
      if (inner) part = inner;
    }

    const nullMatch = part.match(/^([a-zA-Z0-9_."`]+)\s+IS\s+(NOT\s+)?NULL$/i);
    if (nullMatch) {
      const key = nullMatch[1].replace(/^["`]|["`]$/g, '');
      const cond = { is_null: { key } };
      if (nullMatch[2]) mustNot.push(cond);
      else must.push(cond);
      continue;
    }

    const btwMatch = part.match(/^([a-zA-Z0-9_."`]+)\s+(NOT\s+)?BETWEEN\s+(.+?)\s*\x00\s*(.+)$/i);
    if (btwMatch) {
      const key = btwMatch[1].replace(/^["`]|["`]$/g, '');
      const cond = { key, range: { gte: parseQdrantScalar(btwMatch[3]), lte: parseQdrantScalar(btwMatch[4]) } };
      if (btwMatch[2]) mustNot.push(cond);
      else must.push(cond);
      continue;
    }

    const likeMatch = part.match(/^([a-zA-Z0-9_."`]+)\s+(NOT\s+)?(I?LIKE|CONTAINS)\s+(.+)$/i);
    if (likeMatch) {
      const key = likeMatch[1].replace(/^["`]|["`]$/g, '');
      const text = String(parseQdrantScalar(likeMatch[4])).replace(/^[%*]+|[%*]+$/g, '');
      const cond = { key, match: { text } };
      if (likeMatch[2]) mustNot.push(cond);
      else must.push(cond);
      continue;
    }

    const inMatch = part.match(/^([a-zA-Z0-9_."`]+)\s+(NOT\s+)?IN\s*\((.+)\)$/i);
    if (inMatch) {
      const key = inMatch[1].replace(/^["`]|["`]$/g, '');
      const vals = inMatch[3]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const v = parseQdrantScalar(s);
          return key.toLowerCase() === 'id' && typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
        });
      if (vals.length === 0) return null;
      const cond = key.toLowerCase() === 'id' ? { has_id: vals } : { key, match: { any: vals } };
      if (inMatch[2]) mustNot.push(cond);
      else must.push(cond);
      continue;
    }

    const m = part.match(/^([a-zA-Z0-9_."`]+)\s*(!=|<>|>=|<=|=|>|<)\s*(.+)$/);
    if (!m) return null;
    const key = m[1].replace(/^["`]|["`]$/g, '');
    const op = m[2];
    const val = parseQdrantScalar(m[3]);

    if (key.toLowerCase() === 'id') {
      const idVal = typeof val === 'string' && /^\d+$/.test(val) ? Number(val) : val;
      if (op === '=') must.push({ has_id: [idVal] });
      else if (op === '!=' || op === '<>') mustNot.push({ has_id: [idVal] });
      continue;
    }

    if (op === '=') {
      must.push({ key, match: { value: val } });
    } else if (op === '!=' || op === '<>') {
      mustNot.push({ key, match: { value: val } });
    } else {
      const rangeKey = op === '>' ? 'gt' : op === '>=' ? 'gte' : op === '<' ? 'lt' : 'lte';
      must.push({ key, range: { [rangeKey]: val } });
    }
  }
  if (must.length === 0 && mustNot.length === 0) return null;
  const out: Record<string, any> = {};
  if (must.length > 0) out.must = must;
  if (mustNot.length > 0) out.must_not = mustNot;
  return out;
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
  showVisualization = false,
  onToggleVisualization,
}) => {
  const vectorColumns = useMemo(
    () => columns.filter((c) => isVectorColumn(c.dataType, c.rawType)),
    [columns]
  );

  const [isExpanded, setIsExpanded] = useState(false);
  const [qdrantMode, setQdrantMode] = useState<'similarity' | 'hybrid' | 'recommend' | 'groupby' | 'discover' | 'sparse'>('similarity');
  const [discoverTarget, setDiscoverTarget] = useState('');
  const [discoverContext, setDiscoverContext] = useState('');
  const [inputMode, setInputMode] = useState<'vector' | 'text'>('vector');
  const [selectedCol, setSelectedCol] = useState<string>('');
  const [vectorText, setVectorText] = useState<string>('');
  const [textQuery, setTextQuery] = useState<string>('');
  const [topK, setTopK] = useState<number>(10);
  const [searchOffset, setSearchOffset] = useState<number>(0);
  const [scoreThreshold, setScoreThreshold] = useState<string>('');
  const [metric, setMetric] = useState<VectorDistanceMetric>('cosine');
  const [filterInput, setFilterInput] = useState<string>('');
  const [showQdrantAdvanced, setShowQdrantAdvanced] = useState(false);
  const [hnswEf, setHnswEf] = useState<string>('');
  const [exactSearch, setExactSearch] = useState<boolean>(false);
  const [quantRescore, setQuantRescore] = useState<boolean>(true);
  const [withVectorResult, setWithVectorResult] = useState<boolean>(true);
  // Hybrid fields
  const [sparseCol, setSparseCol] = useState<string>('');
  const [sparseIndices, setSparseIndices] = useState<string>('');
  const [sparseValues, setSparseValues] = useState<string>('');
  const [fusionType, setFusionType] = useState<'rrf' | 'dbsf'>('rrf');
  // Recommend fields
  const [positiveIds, setPositiveIds] = useState<string>('');
  const [negativeIds, setNegativeIds] = useState<string>('');
  // GroupBy fields
  const [groupByField, setGroupByField] = useState<string>('');
  const [groupSize, setGroupSize] = useState<number>(3);
  // Visual filter builder
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  const [fbField, setFbField] = useState('');
  const [fbOp, setFbOp] = useState<'=' | '!=' | '>' | '>=' | '<' | '<=' | 'text'>('=');
  const [fbVal, setFbVal] = useState('');
  const [showEmbedSettings, setShowEmbedSettings] = useState(false);
  const [embedCfg, setEmbedCfg] = useState<EmbeddingConfig>(loadEmbeddingConfig);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [embedTestMsg, setEmbedTestMsg] = useState<string | null>(null);
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [copiedRest, setCopiedRest] = useState(false);

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
      if (typeof val === 'object' && !Array.isArray(val) && Array.isArray((val as any).indices)) {
        setSparseCol(activeVectorCol.replace(/^vector\./, ''));
        setSparseIndices(((val as any).indices || []).join(', '));
        setSparseValues(((val as any).values || []).join(', '));
        if (driver === 'qdrant') setQdrantMode('hybrid');
        setEmbedError(null);
        return;
      }
      if (typeof val === 'string' && val.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(val);
          if (parsed && Array.isArray(parsed.indices) && Array.isArray(parsed.values)) {
            setSparseCol(activeVectorCol.replace(/^vector\./, ''));
            setSparseIndices(parsed.indices.join(', '));
            setSparseValues(parsed.values.join(', '));
            if (driver === 'qdrant') setQdrantMode('hybrid');
            setEmbedError(null);
            return;
          }
        } catch {}
      }
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

    if (embedCfg.provider === 'gemini') {
      const modelName = embedCfg.model.trim() || 'gemini-embedding-001';
      const base = endpoint.replace(/\/+$/, '');
      const url = base.includes(':embedContent')
        ? base
        : `${base}/models/${encodeURIComponent(modelName)}:embedContent`;
      const finalUrl = embedCfg.apiKey.trim()
        ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(embedCfg.apiKey.trim())}`
        : url;
      const res = await fetch(finalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${modelName}`,
          content: { parts: [{ text }] },
        }),
      });
      if (!res.ok) {
        throw new Error(`Gemini embedding failed (${res.status}): ${await res.text()}`);
      }
      const data = await res.json();
      const vec = data?.embedding?.values;
      if (!Array.isArray(vec)) {
        throw new Error('Unexpected Gemini embedding response format.');
      }
      return vec;
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

  const resolveQdrantFilter = (raw: string): Record<string, any> | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      const fallback = parseSimpleQdrantFilter(trimmed);
      return fallback || undefined;
    }
  };

  const buildSearchQuery = (vec: number[] | null): string => {
    const k = Math.max(1, Math.min(1000, Number(topK) || 10));
    const threshold = scoreThreshold.trim() !== '' && !Number.isNaN(Number(scoreThreshold))
      ? Number(scoreThreshold)
      : null;
    const vecJson = vec ? JSON.stringify(vec) : '[]';
    const filter = filterInput.trim();

    if (driver === 'qdrant') {
      const collEsc = encodeURIComponent(tableName);
      const parsedFilter = resolveQdrantFilter(filter);
      const usingName = activeVectorCol.startsWith('vector.')
        ? activeVectorCol.slice('vector.'.length)
        : undefined;

      const paramsObj: Record<string, any> = {};
      if (hnswEf.trim() && Number.isFinite(Number(hnswEf))) paramsObj.hnsw_ef = Math.floor(Number(hnswEf));
      if (exactSearch) paramsObj.exact = true;
      if (!quantRescore) paramsObj.quantization = { rescore: false };

      if (qdrantMode === 'recommend') {
        const parseIdList = (rawIds: string) =>
          rawIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => (/^-?\d+$/.test(s) ? Number(s) : s));
        const body: Record<string, any> = {
          query: {
            recommend: {
              positive: parseIdList(positiveIds),
              negative: parseIdList(negativeIds),
            },
          },
          limit: k,
          offset: searchOffset > 0 ? searchOffset : undefined,
          with_payload: true,
          with_vector: withVectorResult,
        };
        if (usingName) body.using = usingName;
        if (threshold !== null) body.score_threshold = threshold;
        if (parsedFilter) body.filter = parsedFilter;
        if (Object.keys(paramsObj).length > 0) body.params = paramsObj;
        return `POST /collections/${collEsc}/points/query\n${JSON.stringify(body, null, 2)}`;
      }

      if (qdrantMode === 'discover') {
        const parseIdOrVec = (raw: string): any => {
          const t = raw.trim();
          if (t.startsWith('[')) {
            try {
              const arr = JSON.parse(t);
              if (Array.isArray(arr)) return arr;
            } catch {}
          }
          return /^-?\d+$/.test(t) ? Number(t) : t;
        };
        const contextPairs = discoverContext
          .split(',')
          .map((pair) => pair.trim())
          .filter(Boolean)
          .map((pair) => {
            const [pos, neg] = pair.split(':').map((s) => s.trim());
            return {
              positive: parseIdOrVec(pos || ''),
              negative: parseIdOrVec(neg || ''),
            };
          })
          .filter((p) => p.positive !== '' && p.negative !== '');

        const body: Record<string, any> = {
          query: {
            discover: {
              target: parseIdOrVec(discoverTarget),
              context: contextPairs,
            },
          },
          limit: k,
          offset: searchOffset > 0 ? searchOffset : undefined,
          with_payload: true,
          with_vector: withVectorResult,
        };
        if (usingName) body.using = usingName;
        if (threshold !== null) body.score_threshold = threshold;
        if (parsedFilter) body.filter = parsedFilter;
        if (Object.keys(paramsObj).length > 0) body.params = paramsObj;
        return `POST /collections/${collEsc}/points/query\n${JSON.stringify(body, null, 2)}`;
      }

      if (qdrantMode === 'sparse') {
        const idxArr = sparseIndices.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
        const valArr = sparseValues.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
        const sparseUsing = (sparseCol || 'bm25').replace(/^vector\./, '');
        const body: Record<string, any> = {
          query: { indices: idxArr, values: valArr },
          using: sparseUsing,
          limit: k,
          offset: searchOffset > 0 ? searchOffset : undefined,
          with_payload: true,
          with_vector: withVectorResult,
        };
        if (threshold !== null) body.score_threshold = threshold;
        if (parsedFilter) body.filter = parsedFilter;
        if (Object.keys(paramsObj).length > 0) body.params = paramsObj;
        return `POST /collections/${collEsc}/points/query\n${JSON.stringify(body, null, 2)}`;
      }

      if (qdrantMode === 'hybrid') {
        const idxArr = sparseIndices.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
        const valArr = sparseValues.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
        const sparseUsing = (sparseCol || 'bm25').replace(/^vector\./, '');
        const prefetch: any[] = [];
        if (vec && vec.length > 0) {
          const pDense: Record<string, any> = { query: vec, limit: k * 2 };
          if (usingName) pDense.using = usingName;
          if (parsedFilter) pDense.filter = parsedFilter;
          prefetch.push(pDense);
        }
        if (idxArr.length > 0 && idxArr.length === valArr.length) {
          const pSparse: Record<string, any> = {
            query: { indices: idxArr, values: valArr },
            using: sparseUsing,
            limit: k * 2,
          };
          if (parsedFilter) pSparse.filter = parsedFilter;
          prefetch.push(pSparse);
        }
        const body: Record<string, any> = {
          prefetch,
          query: { fusion: fusionType },
          limit: k,
          offset: searchOffset > 0 ? searchOffset : undefined,
          with_payload: true,
          with_vector: withVectorResult,
        };
        if (threshold !== null) body.score_threshold = threshold;
        if (Object.keys(paramsObj).length > 0) body.params = paramsObj;
        return `POST /collections/${collEsc}/points/query\n${JSON.stringify(body, null, 2)}`;
      }

      if (qdrantMode === 'groupby') {
        const body: Record<string, any> = {
          query: vec,
          group_by: groupByField.trim() || 'category',
          group_size: Math.max(1, Number(groupSize) || 3),
          limit: k,
          with_payload: true,
          with_vector: withVectorResult,
        };
        if (usingName) body.using = usingName;
        if (threshold !== null) body.score_threshold = threshold;
        if (parsedFilter) body.filter = parsedFilter;
        if (Object.keys(paramsObj).length > 0) body.params = paramsObj;
        return `POST /collections/${collEsc}/points/query/groups\n${JSON.stringify(body, null, 2)}`;
      }

      // Default: Universal Query API for similarity
      const body: Record<string, any> = {
        query: vec,
        limit: k,
        with_payload: true,
        with_vector: withVectorResult,
      };
      if (searchOffset > 0) body.offset = searchOffset;
      if (usingName) body.using = usingName;
      if (threshold !== null) body.score_threshold = threshold;
      if (parsedFilter) body.filter = parsedFilter;
      if (Object.keys(paramsObj).length > 0) body.params = paramsObj;
      return `POST /collections/${collEsc}/points/query\n${JSON.stringify(body, null, 2)}`;
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

    if (driver === 'redis') {
      const prefix = filter ? `(${filter})` : '*';
      if (threshold !== null) {
        const rangeQuery =
          prefix === '*'
            ? `@${activeVectorCol}:[VECTOR_RANGE $r $vec]=>{$YIELD_DISTANCE_AS: score}`
            : `${prefix} @${activeVectorCol}:[VECTOR_RANGE $r $vec]=>{$YIELD_DISTANCE_AS: score}`;
        return `FT.SEARCH ${tableName} "${rangeQuery}" PARAMS 4 r ${threshold} vec '${vecJson}' SORTBY score ASC LIMIT 0 ${k} DIALECT 2`;
      }
      return `FT.SEARCH ${tableName} "${prefix}=>[KNN $K @${activeVectorCol} $vec AS score]" PARAMS 4 K ${k} vec '${vecJson}' SORTBY score ASC LIMIT 0 ${k} DIALECT 2`;
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

    if (driver === 'qdrant' && filterInput.trim()) {
      const trimmedFilter = filterInput.trim();
      let validFilter = false;
      if (trimmedFilter.startsWith('{')) {
        try {
          JSON.parse(trimmedFilter);
          validFilter = true;
        } catch {}
      } else if (parseSimpleQdrantFilter(trimmedFilter)) {
        validFilter = true;
      }
      if (!validFilter) {
        setEmbedError("Invalid Qdrant filter: use JSON (e.g. {\"must\":[...]}) or key = 'value'.");
        return;
      }
    }

    let vec: number[] | null = null;
    if (driver === 'qdrant' && qdrantMode === 'recommend') {
      if (!positiveIds.trim()) {
        setEmbedError('Enter at least one positive Point ID for Recommend.');
        return;
      }
    } else if (driver === 'qdrant' && qdrantMode === 'discover') {
      if (!discoverTarget.trim()) {
        setEmbedError('Enter a target Point ID or vector array for Discover.');
        return;
      }
    } else if (driver === 'qdrant' && qdrantMode === 'sparse') {
      const idxArr = sparseIndices.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
      const valArr = sparseValues.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
      if (idxArr.length === 0 || idxArr.length !== valArr.length) {
        setEmbedError('Enter matching comma-separated sparse indices and values.');
        return;
      }
    } else if (inputMode === 'vector') {
      vec = parseVectorText(vectorText);
      if (!vec && !(driver === 'qdrant' && qdrantMode === 'hybrid' && sparseIndices.trim())) {
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
          {isVectorSearchActive && searchStats?.querySql && (
            <>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(searchStats.querySql);
                  setCopiedRest(true);
                  setTimeout(() => setCopiedRest(false), 1800);
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#1e2028] hover:bg-[#272a35] text-zinc-300 border border-[#2d303c] text-[11px] cursor-pointer"
                title="Copy generated search query"
              >
                {copiedRest ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span>{copiedRest ? 'Copied!' : driver === 'qdrant' ? 'Copy REST' : 'Copy SQL'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const wb = useWorkbenchStore.getState();
                  const activeTab = wb.tabs.find((t) => t.id === wb.activeTabId);
                  wb.createConsole(
                    activeTab?.connectionId || '',
                    activeTab?.database || '',
                    activeTab?.schema || '',
                    `search_${tableName || 'vector'}.${driver === 'qdrant' ? 'qdrant' : 'sql'}`,
                    searchStats.querySql
                  );
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#1e2028] hover:bg-[#272a35] text-zinc-300 border border-[#2d303c] text-[11px] cursor-pointer"
                title="Open generated query in Console tab"
              >
                <Terminal className="h-3 w-3 text-blue-400" />
                <span>Open in Console</span>
              </button>
            </>
          )}
          {onToggleVisualization && (
            <button
              type="button"
              onClick={onToggleVisualization}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] cursor-pointer transition-colors ${
                showVisualization
                  ? 'bg-violet-600 text-white border-violet-500 font-medium'
                  : 'bg-[#1e2028] hover:bg-[#272a35] text-zinc-300 border-[#2d303c]'
              }`}
              title="Toggle 2D PCA Embedding Visualization"
            >
              <ScatterChart className="h-3 w-3" />
              <span>{showVisualization ? 'Table Grid' : '2D PCA'}</span>
            </button>
          )}
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
            {/* Qdrant Query Mode Selector */}
            {driver === 'qdrant' && (
              <div className="inline-flex flex-wrap rounded bg-[#101115] border border-[#272932] p-0.5">
                {(
                  [
                    { id: 'similarity', label: 'Similarity' },
                    { id: 'hybrid', label: 'Hybrid (RRF)' },
                    { id: 'sparse', label: 'Sparse Only' },
                    { id: 'recommend', label: 'Recommend' },
                    { id: 'discover', label: 'Discover' },
                    { id: 'groupby', label: 'Group By' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setQdrantMode(m.id)}
                    className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${
                      qdrantMode === m.id
                        ? 'bg-emerald-600 text-white font-medium'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            {/* Input mode toggle */}
            {!(driver === 'qdrant' && (qdrantMode === 'recommend' || qdrantMode === 'discover' || qdrantMode === 'sparse')) && (
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
            )}

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

            {driver === 'qdrant' && (
              <>
                <button
                  type="button"
                  onClick={() => setShowQdrantAdvanced((v) => !v)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] cursor-pointer ${
                    showQdrantAdvanced
                      ? 'bg-blue-600/20 border-blue-500/40 text-blue-200'
                      : 'bg-[#1b1d25] hover:bg-[#252833] text-zinc-300 border-[#2d303c]'
                  }`}
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  <span>Search Params</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowFilterBuilder((v) => !v)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] cursor-pointer ${
                    showFilterBuilder
                      ? 'bg-amber-600/20 border-amber-500/40 text-amber-200'
                      : 'bg-[#1b1d25] hover:bg-[#252833] text-zinc-300 border-[#2d303c]'
                  }`}
                >
                  <span>+ Filter Builder</span>
                </button>
              </>
            )}
          </div>

          {/* Qdrant Search Params */}
          {driver === 'qdrant' && showQdrantAdvanced && (
            <div className="flex flex-wrap items-center gap-3 p-2 rounded bg-[#101115] border border-[#272932] text-[11px]">
              <label className="flex items-center gap-1.5 text-zinc-400">
                <span>hnsw_ef:</span>
                <input
                  type="number"
                  min={1}
                  placeholder="auto"
                  value={hnswEf}
                  onChange={(e) => setHnswEf(e.target.value)}
                  className="w-16 rounded bg-[#161820] border border-[#272932] px-1.5 py-0.5 text-zinc-200 font-mono"
                />
              </label>
              <label className="flex items-center gap-1.5 text-zinc-400">
                <span>Offset:</span>
                <input
                  type="number"
                  min={0}
                  value={searchOffset}
                  onChange={(e) => setSearchOffset(Math.max(0, Number(e.target.value) || 0))}
                  className="w-16 rounded bg-[#161820] border border-[#272932] px-1.5 py-0.5 text-zinc-200 font-mono"
                />
              </label>
              <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={exactSearch} onChange={(e) => setExactSearch(e.target.checked)} />
                <span>Exact Search</span>
              </label>
              <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={quantRescore} onChange={(e) => setQuantRescore(e.target.checked)} />
                <span>Quantization Rescore</span>
              </label>
              <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={withVectorResult} onChange={(e) => setWithVectorResult(e.target.checked)} />
                <span>Return Vectors</span>
              </label>
            </div>
          )}

          {/* Qdrant Visual Filter Builder */}
          {driver === 'qdrant' && showFilterBuilder && (
            <div className="flex flex-wrap items-center gap-2 p-2 rounded bg-[#101115] border border-[#272932] text-[11px]">
              <input
                type="text"
                placeholder="Payload field (e.g. category)"
                value={fbField}
                onChange={(e) => setFbField(e.target.value)}
                className="w-40 rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
              />
              <select
                value={fbOp}
                onChange={(e) => setFbOp(e.target.value as any)}
                className="rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
              >
                <option value="=">=</option>
                <option value="!=">!=</option>
                <option value=">">&gt;</option>
                <option value=">=">&gt;=</option>
                <option value="<">&lt;</option>
                <option value="<=">&lt;=</option>
                <option value="text">text match</option>
              </select>
              <input
                type="text"
                placeholder="Value"
                value={fbVal}
                onChange={(e) => setFbVal(e.target.value)}
                className="w-40 rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  const key = fbField.trim();
                  const raw = fbVal.trim();
                  if (!key || !raw) return;
                  let typedVal: any = raw;
                  if (/^true$/i.test(raw)) typedVal = true;
                  else if (/^false$/i.test(raw)) typedVal = false;
                  else if (!Number.isNaN(Number(raw))) typedVal = Number(raw);

                  let clause: any;
                  if (fbOp === 'text') clause = { key, match: { text: String(typedVal) } };
                  else if (fbOp === '=' || fbOp === '!=') clause = { key, match: { value: typedVal } };
                  else {
                    const rk = fbOp === '>' ? 'gt' : fbOp === '>=' ? 'gte' : fbOp === '<' ? 'lt' : 'lte';
                    clause = { key, range: { [rk]: typedVal } };
                  }
                  let current: Record<string, any> = {};
                  if (filterInput.trim()) {
                    current = resolveQdrantFilter(filterInput) || {};
                  }
                  const bucket = fbOp === '!=' ? 'must_not' : 'must';
                  current[bucket] = [...(Array.isArray(current[bucket]) ? current[bucket] : []), clause];
                  setFilterInput(JSON.stringify(current));
                  setFbField('');
                  setFbVal('');
                }}
                className="px-2.5 py-1 rounded bg-amber-600/25 hover:bg-amber-600/40 border border-amber-500/40 text-amber-200 cursor-pointer"
              >
                Add Condition
              </button>
            </div>
          )}

          {/* Qdrant Hybrid / Sparse / Recommend / GroupBy extra inputs */}
          {driver === 'qdrant' && (qdrantMode === 'hybrid' || qdrantMode === 'sparse') && (
            <div className={`grid grid-cols-1 ${qdrantMode === 'hybrid' ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-2 p-2 rounded bg-[#101115] border border-[#272932] text-[11px]`}>
              <input
                type="text"
                placeholder="Sparse field (e.g. bm25)"
                value={sparseCol}
                onChange={(e) => setSparseCol(e.target.value)}
                className="rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
              />
              <input
                type="text"
                placeholder="Sparse indices: 12, 45, 99"
                value={sparseIndices}
                onChange={(e) => setSparseIndices(e.target.value)}
                className="rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
              />
              <input
                type="text"
                placeholder="Sparse values: 0.5, 0.8, 0.2"
                value={sparseValues}
                onChange={(e) => setSparseValues(e.target.value)}
                className="rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
              />
              {qdrantMode === 'hybrid' && (
                <select
                  value={fusionType}
                  onChange={(e) => setFusionType(e.target.value as 'rrf' | 'dbsf')}
                  className="rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
                >
                  <option value="rrf">Fusion: RRF</option>
                  <option value="dbsf">Fusion: DBSF</option>
                </select>
              )}
            </div>
          )}

          {driver === 'qdrant' && qdrantMode === 'groupby' && (
            <div className="flex items-center gap-2 p-2 rounded bg-[#101115] border border-[#272932] text-[11px]">
              <span className="text-zinc-400">Group By Field:</span>
              <input
                type="text"
                placeholder="e.g. category"
                value={groupByField}
                onChange={(e) => setGroupByField(e.target.value)}
                className="w-48 rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
              />
              <span className="text-zinc-400 ml-2">Group Size:</span>
              <input
                type="number"
                min={1}
                max={100}
                value={groupSize}
                onChange={(e) => setGroupSize(Math.max(1, Number(e.target.value) || 3))}
                className="w-16 rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
              />
            </div>
          )}

          {/* Embedding Provider Settings (when Text mode & toggled) */}
          {inputMode === 'text' && showEmbedSettings && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 p-2 rounded bg-[#101115] border border-[#272932]">
              <div>
                <label className="block text-[10px] text-zinc-500 mb-0.5">Provider</label>
                <select
                  value={embedCfg.provider}
                  onChange={(e) => {
                    const p: EmbeddingConfig['provider'] =
                      e.target.value === 'gemini' ? 'gemini' : 'openai';
                    setEmbedTestMsg(null);
                    saveEmbedCfg({
                      ...embedCfg,
                      provider: p,
                      endpoint:
                        p === 'gemini'
                          ? 'https://generativelanguage.googleapis.com/v1beta'
                          : 'https://api.openai.com/v1/embeddings',
                      model:
                        p === 'gemini'
                          ? 'gemini-embedding-001'
                          : 'text-embedding-3-small',
                    });
                  }}
                  className="w-full rounded bg-[#161820] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200"
                >
                  <option value="openai">OpenAI / Compatible (Ollama, etc.)</option>
                  <option value="gemini">Google Gemini</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 mb-0.5">Endpoint URL</label>
                <input
                  type="text"
                  value={embedCfg.endpoint}
                  placeholder={
                    embedCfg.provider === 'gemini'
                      ? 'https://generativelanguage.googleapis.com/v1beta'
                      : 'https://api.openai.com/v1/embeddings atau http://localhost:11434/v1/embeddings'
                  }
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
                <div className="flex items-center gap-1.5">
                  <input
                    type="password"
                    placeholder="sk-... / AIza..."
                    value={embedCfg.apiKey}
                    onChange={(e) => saveEmbedCfg({ ...embedCfg, apiKey: e.target.value })}
                    className="flex-1 min-w-0 rounded bg-[#161820] border border-[#272932] px-2 py-1 text-[11px] text-zinc-200 font-mono"
                  />
                  <button
                    type="button"
                    disabled={isEmbedding}
                    onClick={async () => {
                      setEmbedError(null);
                      setEmbedTestMsg(null);
                      setIsEmbedding(true);
                      try {
                        const vec = await generateEmbedding('hello');
                        setEmbedTestMsg(`OK (${vec.length}d)`);
                      } catch (err: any) {
                        setEmbedError(err?.message || String(err));
                      } finally {
                        setIsEmbedding(false);
                      }
                    }}
                    className="px-2 py-1 rounded bg-[#1e2028] hover:bg-[#272a35] text-zinc-300 border border-[#2d303c] text-[10px] cursor-pointer shrink-0"
                    title="Test embedding endpoint"
                  >
                    Test
                  </button>
                </div>
                {embedTestMsg && (
                  <div className="text-[10px] text-emerald-400 mt-0.5">{embedTestMsg}</div>
                )}
              </div>
            </div>
          )}

          {/* Main Query Input + Filter */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="md:col-span-2">
              {driver === 'qdrant' && qdrantMode === 'recommend' ? (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Positive Point IDs (comma-separated, e.g. 1, 2)"
                    value={positiveIds}
                    onChange={(e) => setPositiveIds(e.target.value)}
                    className="w-full rounded bg-[#101115] border border-[#272932] px-2.5 py-1.5 text-[11px] text-zinc-200 font-mono focus:border-violet-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Negative Point IDs (optional)"
                    value={negativeIds}
                    onChange={(e) => setNegativeIds(e.target.value)}
                    className="w-full rounded bg-[#101115] border border-[#272932] px-2.5 py-1.5 text-[11px] text-zinc-200 font-mono focus:border-violet-500 focus:outline-none"
                  />
                </div>
              ) : driver === 'qdrant' && qdrantMode === 'discover' ? (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Target Point ID or [vector] (e.g. 10)"
                    value={discoverTarget}
                    onChange={(e) => setDiscoverTarget(e.target.value)}
                    className="w-full rounded bg-[#101115] border border-[#272932] px-2.5 py-1.5 text-[11px] text-zinc-200 font-mono focus:border-violet-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Context pos:neg pairs (e.g. 1:2, 3:4)"
                    value={discoverContext}
                    onChange={(e) => setDiscoverContext(e.target.value)}
                    className="w-full rounded bg-[#101115] border border-[#272932] px-2.5 py-1.5 text-[11px] text-zinc-200 font-mono focus:border-violet-500 focus:outline-none"
                  />
                </div>
              ) : driver === 'qdrant' && qdrantMode === 'sparse' ? (
                <div className="w-full rounded bg-[#101115] border border-[#272932] px-2.5 py-1.5 text-[11px] text-zinc-400">
                  Sparse-only query using <span className="font-mono text-zinc-200">{sparseCol || 'bm25'}</span> indices &amp; values above.
                </div>
              ) : inputMode === 'vector' ? (
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
