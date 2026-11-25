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
import { Call } from '@wailsio/runtime';
import {
  detectPgVectorColumnKind,
  floatArrayToBitString,
  getOpclassFor,
  parsePgBitVec,
  parsePgSparseVec,
} from '../../utils/pgvector';
import { QueryService } from '../../../bindings/dhub/internal/services';

export type VectorDistanceMetric = 'cosine' | 'l2' | 'ip' | 'l1' | 'hamming' | 'jaccard';

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
  connectionId?: string;
  driver: string;
  database: string;
  schema: string;
  tableName: string;
  columns: ColumnMeta[];
  rows: any[][];
  primaryKeys?: string[];
  isSearching: boolean;
  isVectorSearchActive: boolean;
  searchStats: VectorSearchStats | null;
  error: string | null;
  onExecuteVectorSearch: (sql: string, sessionParams?: Record<string, string>) => void;
  onResetSearch: () => void;
  onOpenVectorIndexModal?: () => void;
  showVisualization?: boolean;
  onToggleVisualization?: () => void;
  excludeVectors?: boolean;
  onToggleExcludeVectors?: () => void;
}

function quotePgIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function parseVectorText(raw: string): number[] | number[][] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('[') ? trimmed : `[${trimmed}]`;
  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed) && parsed.length > 0) {
      if (parsed.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        return parsed;
      }
      if (
        Array.isArray(parsed[0]) &&
        parsed.every(
          (sub) =>
            Array.isArray(sub) &&
            sub.length > 0 &&
            sub.every((x) => typeof x === 'number' && Number.isFinite(x))
        )
      ) {
        return parsed;
      }
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

function hasBalancedOuterParens(s: string): boolean {
  if (s.length < 2 || !s.startsWith('(') || !s.endsWith(')')) return false;
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0 && i < s.length - 1) return false;
      }
    }
  }
  return depth === 0;
}

function parseSimpleQdrantFilter(raw: string): Record<string, any> | null {
  let trimmed = raw.trim();
  if (!trimmed) return null;
  while (hasBalancedOuterParens(trimmed)) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) break;
    trimmed = inner;
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
  connectionId,
  driver,
  database,
  schema,
  tableName,
  columns,
  rows,
  primaryKeys = [],
  isSearching,
  isVectorSearchActive,
  searchStats,
  error,
  onExecuteVectorSearch,
  onResetSearch,
  onOpenVectorIndexModal,
  showVisualization = false,
  onToggleVisualization,
  excludeVectors = false,
  onToggleExcludeVectors,
}) => {
  const vectorColumns = useMemo(
    () => columns.filter((c) => isVectorColumn(c.dataType, c.rawType)),
    [columns]
  );

  const [isExpanded, setIsExpanded] = useState(false);
  const [qdrantMode, setQdrantMode] = useState<
    'similarity' | 'hybrid' | 'sparse' | 'recommend' | 'discover' | 'groupby' | 'formula' | 'matrix'
  >('similarity');
  // Elasticsearch Search Studio state
  const [esMode, setEsMode] = useState<'fulltext' | 'knn' | 'hybrid' | 'mlt'>(() =>
    vectorColumns.length > 0 ? 'knn' : 'fulltext'
  );
  const [esBm25Query, setEsBm25Query] = useState('');
  const [esTargetFields, setEsTargetFields] = useState('');
  const [esFuzziness, setEsFuzziness] = useState<'AUTO' | '0' | '1' | '2'>('AUTO');
  const [esOperator, setEsOperator] = useState<'OR' | 'AND'>('OR');
  const [esHighlight, setEsHighlight] = useState(true);
  const [esNumCandidates, setEsNumCandidates] = useState<string>('50');
  const [esSimilarity, setEsSimilarity] = useState<string>('');
  const [mongoVectorIndex, setMongoVectorIndex] = useState<string>('vector_index');
  const [mongoVectorIndexes, setMongoVectorIndexes] = useState<{ name: string; path?: string }[]>([]);

  React.useEffect(() => {
    if (driver !== 'mongodb' || !tableName) return;
    const wb = useWorkbenchStore.getState();
    const activeTab = wb.tabs.find((t) => t.id === wb.activeTabId);
    const connId = activeTab?.connectionId;
    const dbName = activeTab?.database || schema || 'admin';
    if (!connId) return;

    let cancelled = false;
    QueryService.ExecuteQuery({
      executionId: 'mongo-list-search-idx-' + Date.now(),
      connectionId: connId,
      database: dbName,
      schema: dbName,
      sql: `db.getCollection(${JSON.stringify(tableName)}).aggregate([{ "$listSearchIndexes": {} }]);`,
      limit: 50,
      offset: 0,
    } as any)
      .then((res: any) => {
        if (cancelled || !res?.rows?.length || !res?.columns?.length) return;
        const cols: any[] = res.columns;
        const nameIdx = cols.findIndex((c) => c.name === 'name');
        const typeIdx = cols.findIndex((c) => c.name === 'type');
        const defIdx = cols.findIndex((c) => c.name === 'latestDefinition');
        const found: { name: string; path?: string }[] = [];
        for (const r of res.rows) {
          if (!r) continue;
          const idxType = typeIdx >= 0 ? String(r[typeIdx] || '') : '';
          if (idxType && idxType !== 'vectorSearch') continue;
          const idxName = nameIdx >= 0 ? String(r[nameIdx] || '') : '';
          let vecPath: string | undefined;
          if (defIdx >= 0 && r[defIdx]) {
            try {
              const defObj = typeof r[defIdx] === 'string' ? JSON.parse(r[defIdx]) : r[defIdx];
              const vecField = Array.isArray(defObj?.fields)
                ? defObj.fields.find((f: any) => f?.type === 'vector')
                : undefined;
              if (vecField?.path) vecPath = String(vecField.path);
            } catch {}
          }
          if (idxName) found.push({ name: idxName, path: vecPath });
        }
        if (found.length > 0) {
          setMongoVectorIndexes(found);
          setMongoVectorIndex(found[0].name);
        }
      })
      .catch(() => {
        // Non-Atlas / older MongoDB versions do not support $listSearchIndexes; silently keep default.
      });

    return () => {
      cancelled = true;
    };
  }, [driver, schema, tableName]);
  const [esOpenSearchKnn, setEsOpenSearchKnn] = useState(false);
  const [esQueryBoost, setEsQueryBoost] = useState<string>('1.0');
  const [esKnnBoost, setEsKnnBoost] = useState<string>('1.0');
  const [esMltLike, setEsMltLike] = useState('');
  const [esMltById, setEsMltById] = useState(false);
  const [discoverTarget, setDiscoverTarget] = useState('');
  const [discoverContext, setDiscoverContext] = useState('');
  const [formulaExpr, setFormulaExpr] = useState(
    '{"sum": ["$score", {"mult": [0.25, {"key": "priority"}]}]}'
  );
  const [matrixSample, setMatrixSample] = useState<number>(20);
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
  const [fbOp, setFbOp] = useState<
    '=' | '!=' | '>' | '>=' | '<' | '<=' | 'text' | 'geo_radius' | 'geo_bbox' | 'dt_gte' | 'dt_lte' | 'is_null' | 'is_empty'
  >('=');
  const [fbVal, setFbVal] = useState('');
  const [showEmbedSettings, setShowEmbedSettings] = useState(false);
  const [embedCfg, setEmbedCfg] = useState<EmbeddingConfig>(loadEmbeddingConfig);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [embedTestMsg, setEmbedTestMsg] = useState<string | null>(null);
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [copiedRest, setCopiedRest] = useState(false);

  // PostgreSQL pgvector Studio state
  const [pgMode, setPgMode] = useState<'similarity' | 'sparse' | 'two_stage' | 'hybrid' | 'by_row'>('similarity');
  const [showPgAdvanced, setShowPgAdvanced] = useState(false);
  const [pgEfSearch, setPgEfSearch] = useState<string>('');
  const [pgProbes, setPgProbes] = useState<string>('');
  const [pgIterativeScan, setPgIterativeScan] = useState<'off' | 'relaxed_order' | 'strict_order'>('off');
  const [pgExactSearch, setPgExactSearch] = useState<boolean>(false);
  const [pgOversample, setPgOversample] = useState<number>(5);
  const [pgHybridTextCol, setPgHybridTextCol] = useState<string>('');
  const [pgHybridLang, setPgHybridLang] = useState<'english' | 'indonesian' | 'simple'>('english');
  const [pgHybridQuery, setPgHybridQuery] = useState<string>('');
  const [pgRrfK, setPgRrfK] = useState<number>(60);
  const [pgRowId, setPgRowId] = useState<string>('');
  const [pgSparseLiteral, setPgSparseLiteral] = useState<string>('');
  const [pgBitLiteral, setPgBitLiteral] = useState<string>('');
  const [pgOverview, setPgOverview] = useState<any>(null);
  const [pgVecStatus, setPgVecStatus] = useState<any>(null);

  const activeVectorCol = useMemo(() => {
    if (selectedCol && vectorColumns.some((c) => c.name === selectedCol)) {
      return selectedCol;
    }
    return vectorColumns[0]?.name || (driver === 'qdrant' ? 'vector' : 'embedding');
  }, [selectedCol, vectorColumns, driver]);

  const activeVectorMeta = useMemo(
    () => vectorColumns.find((c) => c.name === activeVectorCol),
    [vectorColumns, activeVectorCol]
  );

  const activePgVecInfo = useMemo(
    () => detectPgVectorColumnKind(activeVectorMeta?.dataType, activeVectorMeta?.rawType),
    [activeVectorMeta]
  );

  const textColumns = useMemo(
    () =>
      columns.filter((c) => {
        const dt = (c.dataType || c.rawType || '').toLowerCase();
        return dt.includes('text') || dt.includes('char') || dt.includes('tsvector');
      }),
    [columns]
  );

  React.useEffect(() => {
    if (!pgHybridTextCol && textColumns.length > 0) {
      setPgHybridTextCol(textColumns[0].name);
    }
  }, [textColumns, pgHybridTextCol]);

  React.useEffect(() => {
    if (driver !== 'postgres' || !isExpanded || !connectionId || !tableName) return;
    let cancelled = false;
    Promise.all([
      Call.ByName('dhub/internal/services.SchemaService.GetPgVectorStatus', connectionId, database || 'postgres').catch(() => null),
      Call.ByName('dhub/internal/services.SchemaService.GetTableVectorOverview', connectionId, database || 'postgres', schema || 'public', tableName).catch(() => null),
    ]).then(([st, ov]) => {
      if (cancelled) return;
      if (st) setPgVecStatus(st);
      if (ov) setPgOverview(ov);
    });
    return () => {
      cancelled = true;
    };
  }, [driver, isExpanded, connectionId, database, schema, tableName]);

  if (vectorColumns.length === 0 && driver !== 'qdrant' && driver !== 'elasticsearch') {
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
      if (typeof val === 'string' && val.trim().startsWith('{') && val.includes('}/')) {
        setPgSparseLiteral(val.trim());
        if (driver === 'postgres') setPgMode('sparse');
        setEmbedError(null);
        return;
      }
      if (typeof val === 'string' && activePgVecInfo.kind === 'bit' && parsePgBitVec(val)) {
        setPgBitLiteral(val.trim());
        if (driver === 'postgres') setPgMode('sparse');
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
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}
    const fallback = parseSimpleQdrantFilter(trimmed);
    return fallback || undefined;
  };

  const buildSearchQuery = (vec: number[] | number[][] | null): string => {
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
        const splitContextPairs = (raw: string): string[] => {
          const pairs: string[] = [];
          let cur = '';
          let bracketDepth = 0;
          for (let i = 0; i < raw.length; i++) {
            const ch = raw[i];
            if (ch === '[') bracketDepth++;
            else if (ch === ']' && bracketDepth > 0) bracketDepth--;
            else if (ch === ',' && bracketDepth === 0) {
              if (cur.trim()) pairs.push(cur.trim());
              cur = '';
              continue;
            }
            cur += ch;
          }
          if (cur.trim()) pairs.push(cur.trim());
          return pairs;
        };
        const contextPairs = splitContextPairs(discoverContext)
          .map((pair) => {
            const colonIdx = pair.indexOf(':');
            if (colonIdx === -1) return { positive: '', negative: '' };
            const pos = pair.slice(0, colonIdx).trim();
            const neg = pair.slice(colonIdx + 1).trim();
            return {
              positive: parseIdOrVec(pos),
              negative: parseIdOrVec(neg),
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

      if (qdrantMode === 'matrix') {
        const body: Record<string, any> = {
          sample: Math.max(2, Math.min(200, Number(matrixSample) || 20)),
          limit: k,
        };
        if (usingName) body.using = usingName;
        if (parsedFilter) body.filter = parsedFilter;
        return `POST /collections/${collEsc}/points/search/matrix/pairs\n${JSON.stringify(body, null, 2)}`;
      }

      if (qdrantMode === 'formula') {
        let parsedFormula: any = { sum: ['$score'] };
        try {
          parsedFormula = JSON.parse(formulaExpr.trim() || '{"sum":["$score"]}');
        } catch {}
        const prefetch: Record<string, any> = { query: vec, limit: k * 2 };
        if (usingName) prefetch.using = usingName;
        if (parsedFilter) prefetch.filter = parsedFilter;
        const body: Record<string, any> = {
          prefetch,
          query: { formula: parsedFormula },
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

    if (driver === 'mongodb') {
      let parsedMongoFilter: any = undefined;
      if (filter.trim().startsWith('{')) {
        try {
          parsedMongoFilter = JSON.parse(filter.trim());
        } catch {}
      }
      const matchedMeta = mongoVectorIndexes.find((m) => m.name === mongoVectorIndex);
      const vectorStage: Record<string, any> = {
        $vectorSearch: {
          index: mongoVectorIndex || 'vector_index',
          path: selectedCol || matchedMeta?.path || 'embedding',
          queryVector: vec,
          numCandidates: Math.max(k * 10, 100),
          limit: k,
          ...(parsedMongoFilter ? { filter: parsedMongoFilter } : {}),
        },
      };
      const addFieldsStage = {
        $addFields: {
          _score: { $meta: 'vectorSearchScore' },
        },
      };
      return `db.getCollection(${JSON.stringify(tableName)}).aggregate(${JSON.stringify([vectorStage, addFieldsStage], null, 2)});`;
    }

    if (driver === 'elasticsearch') {
      const idxEsc = encodeURIComponent(tableName);
      const numCand = Math.max(k, Number(esNumCandidates) || Math.max(k * 5, 50));
      const simVal =
        esSimilarity.trim() !== '' && !Number.isNaN(Number(esSimilarity)) ? Number(esSimilarity) : null;
      const targetFieldsArr = esTargetFields
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const parseEsFilter = (rawF: string): any => {
        if (!rawF) return undefined;
        if (rawF.startsWith('{')) {
          try {
            return JSON.parse(rawF);
          } catch {}
        }
        return { query_string: { query: rawF } };
      };
      const parsedEsFilter = parseEsFilter(filter);

      const body: Record<string, any> = {
        size: k,
      };
      if (threshold !== null) {
        body.min_score = threshold;
      }

      if (esMode === 'fulltext') {
        const qText = esBm25Query.trim() || '*';
        const matchObj: Record<string, any> =
          targetFieldsArr.length > 0
            ? {
                multi_match: {
                  query: qText,
                  fields: targetFieldsArr,
                  operator: esOperator,
                  ...(esFuzziness !== '0' ? { fuzziness: esFuzziness } : {}),
                },
              }
            : {
                query_string: {
                  query: qText,
                  default_operator: esOperator,
                },
              };
        body.query = parsedEsFilter
          ? { bool: { must: [matchObj], filter: [parsedEsFilter] } }
          : matchObj;
        if (esHighlight) {
          body.highlight = {
            pre_tags: ['**'],
            post_tags: ['**'],
            fields: { '*': {} },
          };
        }
        return `POST /${idxEsc}/_search\n${JSON.stringify(body, null, 2)}`;
      }

      if (esMode === 'mlt') {
        const mltLikeRaw = esMltLike.trim();
        const mltLikeVal = esMltById
          ? [{ _index: tableName, _id: mltLikeRaw }]
          : mltLikeRaw;
        const mltQuery: Record<string, any> = {
          more_like_this: {
            like: mltLikeVal,
            min_term_freq: 1,
            min_doc_freq: 1,
            ...(targetFieldsArr.length > 0 ? { fields: targetFieldsArr } : {}),
          },
        };
        body.query = parsedEsFilter
          ? { bool: { must: [mltQuery], filter: [parsedEsFilter] } }
          : mltQuery;
        return `POST /${idxEsc}/_search\n${JSON.stringify(body, null, 2)}`;
      }

      if (esMode === 'hybrid') {
        const qText = esBm25Query.trim();
        const qBoost = Number(esQueryBoost) || 1.0;
        const kBoost = Number(esKnnBoost) || 1.0;
        if (qText) {
          const textQ: Record<string, any> =
            targetFieldsArr.length > 0
              ? {
                  multi_match: {
                    query: qText,
                    fields: targetFieldsArr,
                    operator: esOperator,
                    boost: qBoost,
                  },
                }
              : {
                  query_string: {
                    query: qText,
                    default_operator: esOperator,
                    boost: qBoost,
                  },
                };
          body.query = textQ;
        }
        if (vec && vec.length > 0) {
          if (esOpenSearchKnn) {
            body.query = {
              bool: {
                should: [
                  ...(body.query ? [body.query] : []),
                  { knn: { [activeVectorCol]: { vector: vec, k, boost: kBoost } } },
                ],
                ...(parsedEsFilter ? { filter: [parsedEsFilter] } : {}),
              },
            };
          } else {
            const knnClause: Record<string, any> = {
              field: activeVectorCol,
              query_vector: vec,
              k,
              num_candidates: numCand,
              boost: kBoost,
            };
            if (parsedEsFilter) knnClause.filter = parsedEsFilter;
            if (simVal !== null) knnClause.similarity = simVal;
            body.knn = knnClause;
          }
        }
        if (esHighlight && qText) {
          body.highlight = { pre_tags: ['**'], post_tags: ['**'], fields: { '*': {} } };
        }
        return `POST /${idxEsc}/_search\n${JSON.stringify(body, null, 2)}`;
      }

      // Default: kNN Vector
      if (esOpenSearchKnn) {
        const osKnn: Record<string, any> = {
          knn: {
            [activeVectorCol]: {
              vector: vec,
              k,
              ...(parsedEsFilter ? { filter: parsedEsFilter } : {}),
            },
          },
        };
        body.query = osKnn;
      } else {
        const knnClause: Record<string, any> = {
          field: activeVectorCol,
          query_vector: vec,
          k,
          num_candidates: numCand,
        };
        if (parsedEsFilter) knnClause.filter = parsedEsFilter;
        if (simVal !== null) knnClause.similarity = simVal;
        body.knn = knnClause;
      }
      return `POST /${idxEsc}/_search\n${JSON.stringify(body, null, 2)}`;
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

    // PostgreSQL (pgvector 0.7 / 0.8+: vector, halfvec, sparsevec, bit, 2-stage, hybrid RRF, by_row)
    const qualifiedTbl =
      schema && schema !== 'main'
        ? `${quotePgIdent(schema)}.${quotePgIdent(tableName)}`
        : quotePgIdent(tableName);
    const colQ = quotePgIdent(activeVectorCol);
    const pgKind = activePgVecInfo.kind || 'vector';
    const pgDims = activePgVecInfo.dims;
    const castType =
      pgKind === 'halfvec'
        ? pgDims ? `halfvec(${pgDims})` : 'halfvec'
        : pgKind === 'sparsevec'
        ? pgDims ? `sparsevec(${pgDims})` : 'sparsevec'
        : pgKind === 'bit'
        ? pgDims ? `bit(${pgDims})` : 'bit'
        : pgDims ? `vector(${pgDims})` : 'vector';

    const op =
      metric === 'l2'
        ? '<->'
        : metric === 'ip'
        ? '<#>'
        : metric === 'l1'
        ? '<+>'
        : metric === 'hamming'
        ? '<~>'
        : metric === 'jaccard'
        ? '<%>'
        : '<=>';

    let literalExpr = `'${vecJson}'::${castType}`;
    if (pgMode === 'sparse') {
      if (pgKind === 'sparsevec') {
        literalExpr = `'${pgSparseLiteral.trim().replace(/'/g, "''")}'::${castType}`;
      } else if (pgKind === 'bit') {
        const bitVal = pgBitLiteral.trim() || (Array.isArray(vec) && typeof vec[0] === 'number' ? floatArrayToBitString(vec as number[]) : '');
        literalExpr = `'${bitVal.replace(/'/g, "''")}'::${castType}`;
      }
    }

    if (pgMode === 'two_stage') {
      const bitDims = pgDims || (Array.isArray(vec) && typeof vec[0] === 'number' ? (vec as number[]).length : 1536);
      const oversampleLimit = Math.min(5000, k * Math.max(2, pgOversample));
      const whereSql = filter ? `\n  WHERE (${filter.replace(/^where\s+/i, '')})` : '';
      return `WITH candidates AS (\n  SELECT *\n  FROM ${qualifiedTbl}${whereSql}\n  ORDER BY binary_quantize(${colQ})::bit(${bitDims}) <~> binary_quantize('${vecJson}'::vector)::bit(${bitDims})\n  LIMIT ${oversampleLimit}\n)\nSELECT *, 1 - (${colQ} <=> '${vecJson}'::vector) AS score\nFROM candidates\nORDER BY ${colQ} <=> '${vecJson}'::vector\nLIMIT ${k};`;
    }

    if (pgMode === 'hybrid') {
      const textColName = pgHybridTextCol || textColumns[0]?.name || 'content';
      const textColQ = quotePgIdent(textColName);
      const textColMeta = columns.find((c) => c.name === textColName);
      const isTsv = (textColMeta?.dataType || '').toLowerCase().includes('tsvector');
      const tsvExpr = isTsv ? textColQ : `to_tsvector('${pgHybridLang}', COALESCE(${textColQ}, ''))`;
      const pkName = primaryKeys[0] || columns[0]?.name || 'id';
      const pkQ = quotePgIdent(pkName);
      const qEsc = (pgHybridQuery.trim() || textQuery.trim()).replace(/'/g, "''");
      const rrfK = Math.max(1, Number(pgRrfK) || 60);
      const candidateLimit = Math.min(1000, Math.max(k * 4, 40));
      const whereExtra = filter ? ` AND (${filter.replace(/^where\s+/i, '')})` : '';
      return `WITH dense_hits AS (\n  SELECT ${pkQ} AS doc_id, ROW_NUMBER() OVER (ORDER BY ${colQ} ${op} ${literalExpr}) AS rnk\n  FROM ${qualifiedTbl}\n  WHERE ${colQ} IS NOT NULL${whereExtra}\n  ORDER BY ${colQ} ${op} ${literalExpr}\n  LIMIT ${candidateLimit}\n),\nfts_hits AS (\n  SELECT ${pkQ} AS doc_id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(${tsvExpr}, websearch_to_tsquery('${pgHybridLang}', '${qEsc}')) DESC) AS rnk\n  FROM ${qualifiedTbl}\n  WHERE ${tsvExpr} @@ websearch_to_tsquery('${pgHybridLang}', '${qEsc}')${whereExtra}\n  LIMIT ${candidateLimit}\n),\nrrf AS (\n  SELECT COALESCE(d.doc_id, f.doc_id) AS doc_id,\n         COALESCE(1.0 / (${rrfK} + d.rnk), 0) + COALESCE(1.0 / (${rrfK} + f.rnk), 0) AS score\n  FROM dense_hits d\n  FULL OUTER JOIN fts_hits f ON d.doc_id = f.doc_id\n)\nSELECT t.*, rrf.score\nFROM rrf\nJOIN ${qualifiedTbl} t ON t.${pkQ} = rrf.doc_id\nORDER BY rrf.score DESC\nLIMIT ${k};`;
    }

    if (pgMode === 'by_row') {
      const pkName = primaryKeys[0] || columns[0]?.name || 'id';
      const pkQ = quotePgIdent(pkName);
      const pkLit = /^\d+$/.test(pgRowId.trim()) ? pgRowId.trim() : `'${pgRowId.trim().replace(/'/g, "''")}'`;
      const scoreTarget =
        metric === 'l2' || metric === 'l1' || metric === 'hamming' || metric === 'jaccard'
          ? `(t.${colQ} ${op} target.vec) AS distance`
          : metric === 'ip'
          ? `-(t.${colQ} <#> target.vec) AS score`
          : `1 - (t.${colQ} <=> target.vec) AS score`;
      const whereExtra = filter ? ` AND (${filter.replace(/^where\s+/i, '')})` : '';
      return `WITH target AS (\n  SELECT ${colQ} AS vec FROM ${qualifiedTbl} WHERE ${pkQ} = ${pkLit} LIMIT 1\n)\nSELECT t.*, ${scoreTarget}\nFROM ${qualifiedTbl} t, target\nWHERE t.${pkQ} <> ${pkLit} AND t.${colQ} IS NOT NULL${whereExtra}\nORDER BY t.${colQ} ${op} target.vec\nLIMIT ${k};`;
    }

    const scoreExpr =
      metric === 'l2' || metric === 'l1' || metric === 'hamming' || metric === 'jaccard'
        ? `(${colQ} ${op} ${literalExpr}) AS distance`
        : metric === 'ip'
        ? `-(${colQ} <#> ${literalExpr}) AS score`
        : `1 - (${colQ} <=> ${literalExpr}) AS score`;

    const whereParts: string[] = [];
    if (filter) {
      whereParts.push(`(${filter.replace(/^where\s+/i, '')})`);
    }
    if (threshold !== null) {
      if (metric === 'l2' || metric === 'l1' || metric === 'hamming' || metric === 'jaccard') {
        whereParts.push(`(${colQ} ${op} ${literalExpr}) <= ${threshold}`);
      } else if (metric === 'ip') {
        whereParts.push(`(${colQ} <#> ${literalExpr}) <= ${-threshold}`);
      } else {
        whereParts.push(`(${colQ} <=> ${literalExpr}) <= ${Number((1 - threshold).toFixed(6))}`);
      }
    }
    const whereSql = whereParts.length > 0 ? `\nWHERE ${whereParts.join(' AND ')}` : '';
    return `SELECT *, ${scoreExpr}\nFROM ${qualifiedTbl}${whereSql}\nORDER BY ${colQ} ${op} ${literalExpr}\nLIMIT ${k};`;
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

    let vec: number[] | number[][] | null = null;
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
    } else if (driver === 'qdrant' && qdrantMode === 'matrix') {
      // Distance matrix samples points directly without needing a query vector
    } else if (driver === 'qdrant' && qdrantMode === 'sparse') {
      const idxArr = sparseIndices.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
      const valArr = sparseValues.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
      if (idxArr.length === 0 || idxArr.length !== valArr.length) {
        setEmbedError('Enter matching comma-separated sparse indices and values.');
        return;
      }
    } else if (driver === 'elasticsearch' && esMode === 'fulltext') {
      if (!esBm25Query.trim() && !filterInput.trim()) {
        setEmbedError('Enter a search query or filter for Full-Text (BM25) search.');
        return;
      }
    } else if (driver === 'elasticsearch' && esMode === 'mlt') {
      if (!esMltLike.trim()) {
        setEmbedError('Enter sample text or Document _id for More Like This search.');
        return;
      }
    } else if (driver === 'postgres' && pgMode === 'by_row') {
      if (!pgRowId.trim()) {
        setEmbedError('Enter a Primary Key value for By Row similarity search.');
        return;
      }
    } else if (driver === 'postgres' && pgMode === 'sparse') {
      if (activePgVecInfo.kind === 'sparsevec') {
        const sp = parsePgSparseVec(pgSparseLiteral);
        if (!sp) {
          setEmbedError('Enter a valid sparsevec literal, e.g. {1:0.5,3:0.8}/1000');
          return;
        }
        if (activePgVecInfo.dims && sp.dims !== activePgVecInfo.dims) {
          setEmbedError(`Dimension mismatch: sparsevec has ${sp.dims} dims, column "${activeVectorCol}" expects ${activePgVecInfo.dims}.`);
          return;
        }
      } else if (activePgVecInfo.kind === 'bit') {
        const bv = parsePgBitVec(pgBitLiteral);
        if (!bv) {
          setEmbedError('Enter a valid binary bitstring (only 0 and 1), e.g. 10110010');
          return;
        }
        if (activePgVecInfo.dims && bv.dims !== activePgVecInfo.dims) {
          setEmbedError(`Dimension mismatch: bitstring has ${bv.dims} bits, column "${activeVectorCol}" expects ${activePgVecInfo.dims}.`);
          return;
        }
      }
    } else if (inputMode === 'vector') {
      vec = parseVectorText(vectorText);
      if (!vec && !(driver === 'qdrant' && qdrantMode === 'hybrid' && sparseIndices.trim())) {
        setEmbedError('Enter a valid numeric vector array, e.g. [0.12, -0.04, 0.88]');
        return;
      }
      if (driver === 'postgres' && Array.isArray(vec) && typeof vec[0] === 'number' && activePgVecInfo.dims && vec.length !== activePgVecInfo.dims) {
        setEmbedError(`Dimension mismatch: input vector has ${vec.length} dims, column "${activeVectorCol}" expects ${activePgVecInfo.dims}.`);
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

    if (driver === 'postgres' && pgMode === 'hybrid' && !pgHybridQuery.trim() && !textQuery.trim()) {
      setEmbedError('Enter a full-text search phrase for Hybrid RRF.');
      return;
    }

    const sql = buildSearchQuery(vec);
    if (driver === 'postgres') {
      const sessionParams: Record<string, string> = {};
      if (pgEfSearch.trim() && Number.isFinite(Number(pgEfSearch))) {
        sessionParams['hnsw.ef_search'] = String(Math.max(1, Math.floor(Number(pgEfSearch))));
      }
      if (pgProbes.trim() && Number.isFinite(Number(pgProbes))) {
        sessionParams['ivfflat.probes'] = String(Math.max(1, Math.floor(Number(pgProbes))));
      }
      if (pgIterativeScan !== 'off') {
        sessionParams['hnsw.iterative_scan'] = pgIterativeScan;
        sessionParams['ivfflat.iterative_scan'] = pgIterativeScan;
      }
      if (pgExactSearch) {
        sessionParams['enable_indexscan'] = 'off';
        sessionParams['enable_bitmapscan'] = 'off';
      }
      onExecuteVectorSearch(sql, sessionParams);
      return;
    }
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
            <span>{driver === 'elasticsearch' ? 'Search Studio' : 'Vector Search'}</span>
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {(driver === 'elasticsearch' || driver === 'postgres') && onToggleExcludeVectors && vectorColumns.length > 0 && (
            <button
              type="button"
              onClick={onToggleExcludeVectors}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] cursor-pointer transition-colors ${
                excludeVectors
                  ? 'bg-amber-600/20 border-amber-500/40 text-amber-200 font-medium'
                  : 'bg-[#1e2028] hover:bg-[#272a35] text-zinc-400 border-[#2d303c]'
              }`}
              title={
                driver === 'postgres'
                  ? 'Exclude vector / halfvec / sparsevec / bit columns when browsing for faster table loads'
                  : 'Exclude dense_vector / knn_vector fields from _source when browsing for faster loads'
              }
            >
              <span>
                {excludeVectors
                  ? driver === 'postgres'
                    ? 'Vectors Hidden (Fast Browse)'
                    : 'Vectors Hidden (_source.excludes)'
                  : 'Hide Vector Fields'}
              </span>
            </button>
          )}

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
                <span>
                  {copiedRest
                    ? 'Copied!'
                    : driver === 'qdrant' || driver === 'elasticsearch'
                    ? 'Copy REST'
                    : 'Copy SQL'}
                </span>
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
                    `search_${tableName || 'vector'}.${
                      driver === 'qdrant' ? 'qdrant' : driver === 'elasticsearch' ? 'es' : 'sql'
                    }`,
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
                    { id: 'formula', label: 'Score Boost' },
                    { id: 'matrix', label: 'Distance Matrix' },
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

            {/* Elasticsearch Search Mode Selector */}
            {driver === 'elasticsearch' && (
              <div className="inline-flex flex-wrap rounded bg-[#101115] border border-[#272932] p-0.5">
                {(
                  [
                    { id: 'fulltext', label: 'Full-Text (BM25)' },
                    { id: 'knn', label: 'kNN Vector' },
                    { id: 'hybrid', label: 'Hybrid (BM25 + kNN)' },
                    { id: 'mlt', label: 'More Like This' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setEsMode(m.id)}
                    className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${
                      esMode === m.id
                        ? 'bg-emerald-600 text-white font-medium'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            {/* PostgreSQL pgvector Mode Selector */}
            {driver === 'postgres' && (
              <div className="inline-flex flex-wrap rounded bg-[#101115] border border-[#272932] p-0.5">
                {(
                  [
                    { id: 'similarity', label: 'Similarity' },
                    { id: 'hybrid', label: 'Hybrid (RRF)' },
                    { id: 'two_stage', label: '2-Stage Quantized' },
                    { id: 'sparse', label: 'Sparse / Bit' },
                    { id: 'by_row', label: 'By Row ID' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPgMode(m.id)}
                    className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${
                      pgMode === m.id
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
            {!(
              driver === 'qdrant' &&
              (qdrantMode === 'recommend' || qdrantMode === 'discover' || qdrantMode === 'sparse' || qdrantMode === 'matrix')
            ) && !(
              driver === 'elasticsearch' &&
              (esMode === 'fulltext' || esMode === 'mlt')
            ) && !(
              driver === 'postgres' &&
              (pgMode === 'by_row' || pgMode === 'sparse')
            ) && (
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
              <>
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
                    <option value="l1">L1 / Manhattan (&lt;+&gt;)</option>
                    <option value="hamming">Hamming (&lt;~&gt; bit)</option>
                    <option value="jaccard">Jaccard (&lt;%&gt; bit)</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPgAdvanced((v) => !v)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] cursor-pointer ${
                    showPgAdvanced
                      ? 'bg-blue-600/20 border-blue-500/40 text-blue-200'
                      : 'bg-[#1b1d25] hover:bg-[#252833] text-zinc-300 border-[#2d303c]'
                  }`}
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  <span>PG Search Params</span>
                </button>
                {onOpenVectorIndexModal && (
                  <button
                    type="button"
                    onClick={onOpenVectorIndexModal}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#1b1d25] hover:bg-[#252833] text-cyan-300 border border-[#2d303c] text-[11px] cursor-pointer"
                    title="Inspect, create, or advise pgvector HNSW / IVFFlat indexes"
                  >
                    <span>Manage Indexes</span>
                  </button>
                )}
              </>
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

          {/* Elasticsearch Advanced Options */}
          {driver === 'elasticsearch' && (
            <div className="flex flex-wrap items-center gap-3 p-2 rounded bg-[#101115] border border-[#272932] text-[11px]">
              {(esMode === 'fulltext' || esMode === 'hybrid' || esMode === 'mlt') && (
                <label className="flex items-center gap-1.5 text-zinc-400">
                  <span>Target Fields:</span>
                  <input
                    type="text"
                    placeholder="all fields (or title, body)"
                    value={esTargetFields}
                    onChange={(e) => setEsTargetFields(e.target.value)}
                    className="w-44 rounded bg-[#161820] border border-[#272932] px-2 py-0.5 text-zinc-200 font-mono"
                  />
                </label>
              )}
              {(esMode === 'fulltext' || esMode === 'hybrid') && (
                <>
                  <label className="flex items-center gap-1.5 text-zinc-400">
                    <span>Operator:</span>
                    <select
                      value={esOperator}
                      onChange={(e) => setEsOperator(e.target.value as 'OR' | 'AND')}
                      className="rounded bg-[#161820] border border-[#272932] px-1.5 py-0.5 text-zinc-200"
                    >
                      <option value="OR">OR</option>
                      <option value="AND">AND</option>
                    </select>
                  </label>
                  {esMode === 'fulltext' && (
                    <label className="flex items-center gap-1.5 text-zinc-400">
                      <span>Fuzziness:</span>
                      <select
                        value={esFuzziness}
                        onChange={(e) => setEsFuzziness(e.target.value as any)}
                        className="rounded bg-[#161820] border border-[#272932] px-1.5 py-0.5 text-zinc-200"
                      >
                        <option value="AUTO">AUTO</option>
                        <option value="0">0 (Exact)</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                      </select>
                    </label>
                  )}
                  <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                    <input type="checkbox" checked={esHighlight} onChange={(e) => setEsHighlight(e.target.checked)} />
                    <span>Highlight</span>
                  </label>
                </>
              )}
              {(esMode === 'knn' || esMode === 'hybrid') && (
                <>
                  <label className="flex items-center gap-1.5 text-zinc-400">
                    <span>num_candidates:</span>
                    <input
                      type="number"
                      min={1}
                      value={esNumCandidates}
                      onChange={(e) => setEsNumCandidates(e.target.value)}
                      className="w-16 rounded bg-[#161820] border border-[#272932] px-1.5 py-0.5 text-zinc-200 font-mono"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-zinc-400">
                    <span>similarity:</span>
                    <input
                      type="text"
                      placeholder="optional"
                      value={esSimilarity}
                      onChange={(e) => setEsSimilarity(e.target.value)}
                      className="w-16 rounded bg-[#161820] border border-[#272932] px-1.5 py-0.5 text-zinc-200 font-mono"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={esOpenSearchKnn}
                      onChange={(e) => setEsOpenSearchKnn(e.target.checked)}
                    />
                    <span>OpenSearch kNN</span>
                  </label>
                </>
              )}
              {esMode === 'hybrid' && (
                <>
                  <label className="flex items-center gap-1.5 text-zinc-400">
                    <span>BM25 boost:</span>
                    <input
                      type="text"
                      value={esQueryBoost}
                      onChange={(e) => setEsQueryBoost(e.target.value)}
                      className="w-12 rounded bg-[#161820] border border-[#272932] px-1.5 py-0.5 text-zinc-200 font-mono"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-zinc-400">
                    <span>kNN boost:</span>
                    <input
                      type="text"
                      value={esKnnBoost}
                      onChange={(e) => setEsKnnBoost(e.target.value)}
                      className="w-12 rounded bg-[#161820] border border-[#272932] px-1.5 py-0.5 text-zinc-200 font-mono"
                    />
                  </label>
                </>
              )}
              {esMode === 'mlt' && (
                <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked={esMltById} onChange={(e) => setEsMltById(e.target.checked)} />
                  <span>Like Document _id (instead of raw text)</span>
                </label>
              )}
            </div>
          )}

          {/* PostgreSQL Search Params & Opclass Guard */}
          {driver === 'postgres' && showPgAdvanced && (
            <div className="flex flex-wrap items-center gap-3 p-2 rounded bg-[#101115] border border-[#272932] text-[11px]">
              <label className="flex items-center gap-1.5 text-zinc-400">
                <span>hnsw.ef_search:</span>
                <input
                  type="number"
                  min={1}
                  placeholder="40"
                  value={pgEfSearch}
                  onChange={(e) => setPgEfSearch(e.target.value)}
                  className="w-16 rounded bg-[#161820] border border-[#272932] px-1.5 py-0.5 text-zinc-200 font-mono"
                />
              </label>
              <label className="flex items-center gap-1.5 text-zinc-400">
                <span>ivfflat.probes:</span>
                <input
                  type="number"
                  min={1}
                  placeholder="1"
                  value={pgProbes}
                  onChange={(e) => setPgProbes(e.target.value)}
                  className="w-16 rounded bg-[#161820] border border-[#272932] px-1.5 py-0.5 text-zinc-200 font-mono"
                />
              </label>
              <label className="flex items-center gap-1.5 text-zinc-400">
                <span>iterative_scan:</span>
                <select
                  value={pgIterativeScan}
                  onChange={(e) => setPgIterativeScan(e.target.value as any)}
                  className="rounded bg-[#161820] border border-[#272932] px-1.5 py-0.5 text-zinc-200"
                >
                  <option value="off">off</option>
                  <option value="relaxed_order">relaxed_order (0.8+)</option>
                  <option value="strict_order">strict_order (0.8+)</option>
                </select>
              </label>
              {pgMode === 'two_stage' && (
                <label className="flex items-center gap-1.5 text-zinc-400">
                  <span>Oversample:</span>
                  <input
                    type="number"
                    min={2}
                    max={20}
                    value={pgOversample}
                    onChange={(e) => setPgOversample(Math.max(2, Math.min(20, Number(e.target.value) || 5)))}
                    className="w-14 rounded bg-[#161820] border border-[#272932] px-1.5 py-0.5 text-zinc-200 font-mono"
                  />
                  <span>×</span>
                </label>
              )}
              <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={pgExactSearch} onChange={(e) => setPgExactSearch(e.target.checked)} />
                <span>Exact Search (Seq Scan)</span>
              </label>
            </div>
          )}

          {driver === 'postgres' && pgOverview && (() => {
            const expectedOp = getOpclassFor(activePgVecInfo.kind || 'vector', metric as any);
            const matchingIdx = (pgOverview.indexes || []).find(
              (ix: any) =>
                ix.columnOrExpr?.toLowerCase().includes(activeVectorCol.toLowerCase()) &&
                (!expectedOp || ix.opclass === expectedOp)
            );
            const colIdxs = (pgOverview.indexes || []).filter((ix: any) =>
              ix.columnOrExpr?.toLowerCase().includes(activeVectorCol.toLowerCase())
            );
            const hasMismatch = !matchingIdx && colIdxs.length > 0;
            const filterActive = Boolean(filterInput.trim());
            const showIterWarning = filterActive && pgIterativeScan === 'off' && pgVecStatus?.supportsIterative;
            return (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                {matchingIdx ? (
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-mono">
                    Indexed: {matchingIdx.indexName} ({matchingIdx.method?.toUpperCase()} • {matchingIdx.opclass} • {matchingIdx.sizePretty})
                  </span>
                ) : hasMismatch ? (
                  <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 flex items-center gap-1.5">
                    <span>
                      ⚠ Opclass mismatch: index uses {colIdxs[0].opclass || 'different ops'}, query uses {expectedOp || metric} (will Seq Scan)
                    </span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-zinc-800/70 border border-zinc-700 text-zinc-400">
                    No vector index on "{activeVectorCol}" (Exact Seq Scan)
                  </span>
                )}
                {showIterWarning && (
                  <button
                    type="button"
                    onClick={() => setPgIterativeScan('relaxed_order')}
                    className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 cursor-pointer"
                  >
                    Filter active: Enable iterative_scan (relaxed_order)
                  </button>
                )}
              </div>
            );
          })()}

          {driver === 'postgres' && pgMode === 'hybrid' && (
            <div className="flex flex-wrap items-center gap-2 p-2 rounded bg-[#101115] border border-[#272932] text-[11px]">
              <select
                value={pgHybridTextCol}
                onChange={(e) => setPgHybridTextCol(e.target.value)}
                className="rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
                title="Text / tsvector column for Full-Text Search"
              >
                {textColumns.map((tc) => (
                  <option key={tc.name} value={tc.name}>{tc.name}</option>
                ))}
              </select>
              <select
                value={pgHybridLang}
                onChange={(e) => setPgHybridLang(e.target.value as any)}
                className="rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200"
              >
                <option value="english">english</option>
                <option value="indonesian">indonesian</option>
                <option value="simple">simple</option>
              </select>
              <input
                type="text"
                placeholder="Full-text query phrase (websearch_to_tsquery)..."
                value={pgHybridQuery}
                onChange={(e) => setPgHybridQuery(e.target.value)}
                className="flex-1 min-w-[200px] rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200"
              />
              <label className="flex items-center gap-1 text-zinc-400">
                <span>RRF k:</span>
                <input
                  type="number"
                  min={1}
                  value={pgRrfK}
                  onChange={(e) => setPgRrfK(Math.max(1, Number(e.target.value) || 60))}
                  className="w-14 rounded bg-[#161820] border border-[#272932] px-1.5 py-0.5 text-zinc-200 font-mono"
                />
              </label>
            </div>
          )}

          {driver === 'postgres' && pgMode === 'sparse' && (
            <div className="flex flex-wrap items-center gap-2 p-2 rounded bg-[#101115] border border-[#272932] text-[11px]">
              {activePgVecInfo.kind === 'bit' ? (
                <input
                  type="text"
                  placeholder="Binary bitstring e.g. 10110010... (or use Sample Row)"
                  value={pgBitLiteral}
                  onChange={(e) => setPgBitLiteral(e.target.value)}
                  className="flex-1 rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
                />
              ) : (
                <input
                  type="text"
                  placeholder="pgvector sparsevec literal e.g. {1:0.5,3:0.8}/1000"
                  value={pgSparseLiteral}
                  onChange={(e) => setPgSparseLiteral(e.target.value)}
                  className="flex-1 rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
                />
              )}
            </div>
          )}

          {driver === 'postgres' && pgMode === 'by_row' && (
            <div className="flex items-center gap-2 p-2 rounded bg-[#101115] border border-[#272932] text-[11px]">
              <span className="text-zinc-400">Source Primary Key ({primaryKeys[0] || columns[0]?.name || 'id'}):</span>
              <input
                type="text"
                placeholder="Enter row ID to find similar rows..."
                value={pgRowId}
                onChange={(e) => setPgRowId(e.target.value)}
                className="flex-1 rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
              />
            </div>
          )}

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
                <option value="geo_radius">geo radius (lat,lon,m)</option>
                <option value="geo_bbox">geo bbox (t,l,b,r)</option>
                <option value="dt_gte">datetime &gt;=</option>
                <option value="dt_lte">datetime &lt;=</option>
                <option value="is_null">is_null</option>
                <option value="is_empty">is_empty</option>
              </select>
              <input
                type="text"
                placeholder={
                  fbOp === 'geo_radius'
                    ? '-6.2, 106.8, 5000'
                    : fbOp === 'geo_bbox'
                    ? '-6.1, 106.7, -6.3, 106.9'
                    : fbOp === 'dt_gte' || fbOp === 'dt_lte'
                    ? '2026-01-01T00:00:00Z'
                    : fbOp === 'is_null' || fbOp === 'is_empty'
                    ? '(no value needed)'
                    : 'Value'
                }
                disabled={fbOp === 'is_null' || fbOp === 'is_empty'}
                value={fbVal}
                onChange={(e) => setFbVal(e.target.value)}
                className="w-44 rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono disabled:opacity-40"
              />
              <button
                type="button"
                onClick={() => {
                  const key = fbField.trim();
                  const raw = fbVal.trim();
                  if (!key) return;
                  if (fbOp !== 'is_null' && fbOp !== 'is_empty' && !raw) return;
                  let typedVal: any = raw;
                  if (/^true$/i.test(raw)) typedVal = true;
                  else if (/^false$/i.test(raw)) typedVal = false;
                  else if (!Number.isNaN(Number(raw)) && raw !== '') typedVal = Number(raw);

                  let clause: any;
                  if (fbOp === 'is_null') {
                    clause = { is_null: { key } };
                  } else if (fbOp === 'is_empty') {
                    clause = { is_empty: { key } };
                  } else if (fbOp === 'geo_radius') {
                    const [lat, lon, rad] = raw.split(',').map((s) => Number(s.trim()));
                    if (![lat, lon, rad].every(Number.isFinite)) return;
                    clause = { key, geo_radius: { center: { lat, lon }, radius: rad } };
                  } else if (fbOp === 'geo_bbox') {
                    const [tLat, lLon, bLat, rLon] = raw.split(',').map((s) => Number(s.trim()));
                    if (![tLat, lLon, bLat, rLon].every(Number.isFinite)) return;
                    clause = {
                      key,
                      geo_bounding_box: { top_left: { lat: tLat, lon: lLon }, bottom_right: { lat: bLat, lon: rLon } },
                    };
                  } else if (fbOp === 'dt_gte' || fbOp === 'dt_lte') {
                    clause = { key, range: { [fbOp === 'dt_gte' ? 'gte' : 'lte']: raw } };
                  } else if (key.toLowerCase() === 'id') {
                    const idVal =
                      /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : raw;
                    clause = { has_id: [idVal] };
                  } else if (fbOp === 'text') clause = { key, match: { text: String(typedVal) } };
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

          {driver === 'qdrant' && qdrantMode === 'formula' && (
            <div className="flex items-center gap-2 p-2 rounded bg-[#101115] border border-[#272932] text-[11px]">
              <span className="text-zinc-400 shrink-0">Score Formula JSON:</span>
              <input
                type="text"
                value={formulaExpr}
                onChange={(e) => setFormulaExpr(e.target.value)}
                placeholder='{"sum": ["$score", {"mult": [0.25, {"key": "priority"}]}]}'
                className="flex-1 rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
              />
            </div>
          )}

          {driver === 'qdrant' && qdrantMode === 'matrix' && (
            <div className="flex items-center gap-2 p-2 rounded bg-[#101115] border border-[#272932] text-[11px]">
              <span className="text-zinc-400">Sample Points:</span>
              <input
                type="number"
                min={2}
                max={200}
                value={matrixSample}
                onChange={(e) => setMatrixSample(Math.max(2, Number(e.target.value) || 20))}
                className="w-20 rounded bg-[#161820] border border-[#272932] px-2 py-1 text-zinc-200 font-mono"
              />
              <span className="text-zinc-500">Computes pairwise similarity scores across sampled points.</span>
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
                      : 'https://api.openai.com/v1/embeddings or http://localhost:11434/v1/embeddings'
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
              ) : driver === 'elasticsearch' && esMode === 'fulltext' ? (
                <input
                  type="text"
                  placeholder="Full-Text BM25 query (e.g. elasticsearch vector search)..."
                  value={esBm25Query}
                  onChange={(e) => setEsBm25Query(e.target.value)}
                  className="w-full rounded bg-[#101115] border border-[#272932] px-2.5 py-1.5 text-[11px] text-zinc-200 focus:border-emerald-500 focus:outline-none"
                />
              ) : driver === 'elasticsearch' && esMode === 'mlt' ? (
                <input
                  type="text"
                  placeholder={esMltById ? 'Enter source Document _id...' : 'Enter sample text to find similar documents...'}
                  value={esMltLike}
                  onChange={(e) => setEsMltLike(e.target.value)}
                  className="w-full rounded bg-[#101115] border border-[#272932] px-2.5 py-1.5 text-[11px] text-zinc-200 font-mono focus:border-emerald-500 focus:outline-none"
                />
              ) : driver === 'elasticsearch' && esMode === 'hybrid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="BM25 text query (e.g. wireless headphones)..."
                    value={esBm25Query}
                    onChange={(e) => setEsBm25Query(e.target.value)}
                    className="w-full rounded bg-[#101115] border border-[#272932] px-2.5 py-1.5 text-[11px] text-zinc-200 focus:border-emerald-500 focus:outline-none"
                  />
                  {inputMode === 'vector' ? (
                    <input
                      type="text"
                      placeholder="kNN vector array [0.01, -0.04, ...]"
                      value={vectorText}
                      onChange={(e) => setVectorText(e.target.value)}
                      className="w-full rounded bg-[#101115] border border-[#272932] px-2.5 py-1.5 text-[11px] text-zinc-200 font-mono focus:border-violet-500 focus:outline-none"
                    />
                  ) : (
                    <input
                      type="text"
                      placeholder={`Embed text via ${embedCfg.model}...`}
                      value={textQuery}
                      onChange={(e) => setTextQuery(e.target.value)}
                      className="w-full rounded bg-[#101115] border border-[#272932] px-2.5 py-1.5 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                    />
                  )}
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
