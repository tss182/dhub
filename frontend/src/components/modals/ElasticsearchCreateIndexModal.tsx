import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, ChevronDown, ChevronRight, Layers, Loader2, Terminal } from 'lucide-react';
import { ConnectionConfig } from '../../types/domain';
import { QueryService, SchemaService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, alertWarning } from '../../stores/useAlertStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';

export type ESFieldType =
  | 'text'
  | 'keyword'
  | 'long'
  | 'integer'
  | 'short'
  | 'byte'
  | 'double'
  | 'float'
  | 'half_float'
  | 'boolean'
  | 'date'
  | 'date_nanos'
  | 'dense_vector'
  | 'knn_vector'
  | 'sparse_vector'
  | 'rank_features'
  | 'object'
  | 'nested'
  | 'flattened'
  | 'geo_point'
  | 'ip'
  | 'completion'
  | 'wildcard';

export const ES_FIELD_TYPES: ESFieldType[] = [
  'text',
  'keyword',
  'long',
  'integer',
  'short',
  'byte',
  'double',
  'float',
  'half_float',
  'boolean',
  'date',
  'date_nanos',
  'dense_vector',
  'knn_vector',
  'sparse_vector',
  'rank_features',
  'object',
  'nested',
  'flattened',
  'geo_point',
  'ip',
  'completion',
  'wildcard',
];

export type VectorSimilarity = 'cosine' | 'dot_product' | 'l2_norm' | 'max_inner_product';
export type VectorIndexType = 'hnsw' | 'int8_hnsw' | 'int4_hnsw' | 'bbq_hnsw' | 'flat';

interface FieldDraft {
  id: string;
  name: string;
  type: ESFieldType;
  addKeywordSubfield: boolean;
  analyzer: string;
  dims: string;
  similarity: VectorSimilarity;
  vecIndex: boolean;
  vecIndexType: VectorIndexType;
  hnswM: string;
  hnswEfConstruction: string;
}

interface ElasticsearchCreateIndexModalProps {
  isOpen: boolean;
  onClose: () => void;
  connection: ConnectionConfig | null;
  database: string;
  onIndexCreated?: (indexName: string) => void;
}

export function validateESIndexName(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Index name is required.';
  if (n !== n.toLowerCase()) return 'Elasticsearch index names must be lowercase.';
  if (n.startsWith('-') || n.startsWith('_') || n.startsWith('+')) {
    return 'Index name cannot start with -, _, or +.';
  }
  if (n === '.' || n === '..') return 'Index name cannot be . or ..';
  if (/[\\/*?"<>| ,#:]/.test(n)) {
    return 'Index name cannot contain spaces or any of: \\ / * ? " < > | , # :';
  }
  return null;
}

export const ElasticsearchCreateIndexModal: React.FC<ElasticsearchCreateIndexModalProps> = ({
  isOpen,
  onClose,
  connection,
  onIndexCreated,
}) => {
  const [indexName, setIndexName] = useState('');
  const [shards, setShards] = useState('1');
  const [replicas, setReplicas] = useState('1');
  const [refreshInterval, setRefreshInterval] = useState('1s');
  const [maxResultWindow, setMaxResultWindow] = useState('10000');
  const [dynamicMode, setDynamicMode] = useState<'true' | 'false' | 'strict' | 'runtime'>('true');
  const [initialAlias, setInitialAlias] = useState('');

  const [fields, setFields] = useState<FieldDraft[]>([
    {
      id: 'fld-1',
      name: 'title',
      type: 'text',
      addKeywordSubfield: true,
      analyzer: '',
      dims: '1536',
      similarity: 'cosine',
      vecIndex: true,
      vecIndexType: 'hnsw',
      hnswM: '16',
      hnswEfConstruction: '100',
    },
    {
      id: 'fld-2',
      name: 'status',
      type: 'keyword',
      addKeywordSubfield: false,
      analyzer: '',
      dims: '1536',
      similarity: 'cosine',
      vecIndex: true,
      vecIndexType: 'hnsw',
      hnswM: '16',
      hnswEfConstruction: '100',
    },
  ]);

  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysisJson, setAnalysisJson] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setIndexName('');
    setShards('1');
    setReplicas('1');
    setRefreshInterval('1s');
    setMaxResultWindow('10000');
    setDynamicMode('true');
    setInitialAlias('');
    setShowAnalysis(false);
    setAnalysisJson('');
    setIsSubmitting(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, isSubmitting, onClose]);

  const commandPreview = useMemo(() => {
    const cleanName = indexName.trim() || '<index_name>';
    const settings: Record<string, any> = {};
    if (shards.trim() && Number.isFinite(Number(shards)) && Number(shards) > 0) {
      settings.number_of_shards = Math.floor(Number(shards));
    }
    if (replicas.trim() && Number.isFinite(Number(replicas)) && Number(replicas) >= 0) {
      settings.number_of_replicas = Math.floor(Number(replicas));
    }
    if (refreshInterval.trim() && refreshInterval.trim() !== '1s') {
      settings.refresh_interval = refreshInterval.trim();
    }
    if (
      maxResultWindow.trim() &&
      Number.isFinite(Number(maxResultWindow)) &&
      Number(maxResultWindow) !== 10000
    ) {
      settings.max_result_window = Math.floor(Number(maxResultWindow));
    }
    if (analysisJson.trim()) {
      try {
        settings.analysis = JSON.parse(analysisJson.trim());
      } catch {}
    }

    const properties: Record<string, any> = {};
    fields.forEach((f) => {
      const fName = f.name.trim();
      if (!fName) return;
      const prop: Record<string, any> = { type: f.type };
      if (f.type === 'text') {
        if (f.analyzer.trim()) prop.analyzer = f.analyzer.trim();
        if (f.addKeywordSubfield) {
          prop.fields = {
            keyword: { type: 'keyword', ignore_above: 256 },
          };
        }
      } else if (f.type === 'dense_vector') {
        const d = Number(f.dims);
        prop.dims = Number.isFinite(d) && d > 0 ? Math.floor(d) : 1536;
        prop.index = f.vecIndex;
        if (f.vecIndex) {
          prop.similarity = f.similarity;
          if (f.vecIndexType !== 'hnsw' || f.hnswM.trim() !== '16' || f.hnswEfConstruction.trim() !== '100') {
            const idxOpts: Record<string, any> = { type: f.vecIndexType };
            if (f.vecIndexType !== 'flat') {
              if (f.hnswM.trim() && Number.isFinite(Number(f.hnswM))) {
                idxOpts.m = Math.floor(Number(f.hnswM));
              }
              if (f.hnswEfConstruction.trim() && Number.isFinite(Number(f.hnswEfConstruction))) {
                idxOpts.ef_construction = Math.floor(Number(f.hnswEfConstruction));
              }
            }
            prop.index_options = idxOpts;
          }
        }
      } else if (f.type === 'knn_vector') {
        const d = Number(f.dims);
        prop.dimension = Number.isFinite(d) && d > 0 ? Math.floor(d) : 1536;
      }
      properties[fName] = prop;
    });

    const mappings: Record<string, any> = {};
    if (dynamicMode !== 'true') {
      mappings.dynamic = dynamicMode === 'false' ? false : dynamicMode;
    }
    if (Object.keys(properties).length > 0) {
      mappings.properties = properties;
    }

    const body: Record<string, any> = {};
    if (Object.keys(settings).length > 0) body.settings = settings;
    if (Object.keys(mappings).length > 0) body.mappings = mappings;
    if (initialAlias.trim()) {
      body.aliases = { [initialAlias.trim()]: {} };
    }

    return `PUT /${encodeURIComponent(cleanName)}\n${JSON.stringify(body, null, 2)}`;
  }, [
    indexName,
    shards,
    replicas,
    refreshInterval,
    maxResultWindow,
    dynamicMode,
    initialAlias,
    fields,
    analysisJson,
  ]);

  if (!isOpen) return null;

  const handleAddField = () => {
    setFields((prev) => [
      ...prev,
      {
        id: `fld-${Date.now()}-${prev.length}`,
        name: '',
        type: 'keyword',
        addKeywordSubfield: false,
        analyzer: '',
        dims: '1536',
        similarity: 'cosine',
        vecIndex: true,
        vecIndexType: 'hnsw',
        hnswM: '16',
        hnswEfConstruction: '100',
      },
    ]);
  };

  const handleUpdateField = (id: string, patch: Partial<FieldDraft>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const handleRemoveField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connection) return;

    const cleanName = indexName.trim();
    const nameErr = validateESIndexName(cleanName);
    if (nameErr) {
      alertWarning(nameErr, 'Invalid Index Name');
      return;
    }

    if (analysisJson.trim()) {
      try {
        JSON.parse(analysisJson.trim());
      } catch (err: any) {
        alertWarning(`Invalid Custom Analysis JSON: ${err?.message || err}`, 'Invalid JSON');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await QueryService.ExecuteQuery({
        executionId: `es-create-idx-${Date.now()}`,
        connectionId: connection.id,
        database: 'default',
        schema: 'default',
        sql: commandPreview,
        limit: 10,
        offset: 0,
      } as any);
      if (res?.error) throw new Error(res.error);

      const schemaKey = `${connection.id}:default:default`;
      try {
        const objs = await SchemaService.GetObjects(connection.id, 'default', 'default');
        if (objs) {
          useConnectionStore.getState().setTreeObjects(schemaKey, objs as any);
        }
      } catch {}

      useWorkbenchStore.getState().openTab({
        id: `table-${connection.id}-default-${cleanName}`,
        title: cleanName,
        type: 'table_data',
        connectionId: connection.id,
        database: 'default',
        schema: 'default',
        table: cleanName,
        driver: connection.driver,
      });

      alertSuccess(`Index "${cleanName}" created successfully.`, 'Index Created');
      onIndexCreated?.(cleanName);
      onClose();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Create Index', commandPreview);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d] shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <Layers className="h-3.5 w-3.5" />
            </span>
            <span className="font-semibold text-zinc-100 text-sm">New Elasticsearch Index</span>
            {connection?.name && <span className="text-zinc-500 font-mono">— {connection.name}</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleCreate} className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                Index Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                autoFocus
                required
                placeholder="e.g. products, logs-2026.11, articles_v1"
                value={indexName}
                onChange={(e) => setIndexName(e.target.value)}
                className="w-full rounded-lg bg-[#121318] border border-[#2d303d] px-3 py-1.5 text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                Initial Alias <span className="text-zinc-500 text-[10px]">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. articles_current"
                value={initialAlias}
                onChange={(e) => setInitialAlias(e.target.value)}
                className="w-full rounded-lg bg-[#121318] border border-[#2d303d] px-3 py-1.5 text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Index Settings */}
          <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3 space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Index Settings &amp; Dynamic Mapping Policy
            </div>
            <div className="grid grid-cols-5 gap-2.5">
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">Primary Shards</label>
                <input
                  type="number"
                  min={1}
                  value={shards}
                  onChange={(e) => setShards(e.target.value)}
                  className="w-full rounded bg-[#1b1c22] border border-[#2d303d] px-2.5 py-1 text-zinc-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">Replicas</label>
                <input
                  type="number"
                  min={0}
                  value={replicas}
                  onChange={(e) => setReplicas(e.target.value)}
                  className="w-full rounded bg-[#1b1c22] border border-[#2d303d] px-2.5 py-1 text-zinc-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">Refresh Interval</label>
                <input
                  type="text"
                  placeholder="1s, 30s, -1"
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(e.target.value)}
                  className="w-full rounded bg-[#1b1c22] border border-[#2d303d] px-2.5 py-1 text-zinc-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">Max Result Window</label>
                <input
                  type="number"
                  min={100}
                  value={maxResultWindow}
                  onChange={(e) => setMaxResultWindow(e.target.value)}
                  className="w-full rounded bg-[#1b1c22] border border-[#2d303d] px-2.5 py-1 text-zinc-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">Dynamic Mapping</label>
                <select
                  value={dynamicMode}
                  onChange={(e) => setDynamicMode(e.target.value as any)}
                  className="w-full rounded bg-[#1b1c22] border border-[#2d303d] px-2 py-1 text-zinc-100 font-mono"
                >
                  <option value="true">true (auto-map)</option>
                  <option value="runtime">runtime</option>
                  <option value="false">false (ignore new)</option>
                  <option value="strict">strict (reject new)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Field Mappings Builder */}
          <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Field Mappings ({fields.length})
              </div>
              <button
                type="button"
                onClick={handleAddField}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-[11px] font-medium cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                <span>Add Field</span>
              </button>
            </div>

            <div className="space-y-2">
              {fields.map((f) => (
                <div
                  key={f.id}
                  className="rounded-lg border border-[#272934] bg-[#191b22] p-2.5 space-y-2"
                >
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <input
                        type="text"
                        placeholder="Field name (e.g. title, user.email, embedding)"
                        value={f.name}
                        onChange={(e) => handleUpdateField(f.id, { name: e.target.value })}
                        className="w-full rounded bg-[#121318] border border-[#2d303d] px-2.5 py-1 text-zinc-100 font-mono"
                      />
                    </div>
                    <div className="col-span-3">
                      <select
                        value={f.type}
                        onChange={(e) => handleUpdateField(f.id, { type: e.target.value as ESFieldType })}
                        className="w-full rounded bg-[#121318] border border-[#2d303d] px-2 py-1 text-amber-300 font-mono"
                      >
                        {ES_FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3 flex items-center gap-2">
                      {f.type === 'text' && (
                        <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={f.addKeywordSubfield}
                            onChange={(e) =>
                              handleUpdateField(f.id, { addKeywordSubfield: e.target.checked })
                            }
                            className="rounded border-[#3b3e4f] bg-[#121318]"
                          />
                          <span>+.keyword</span>
                        </label>
                      )}
                      {(f.type === 'dense_vector' || f.type === 'knn_vector') && (
                        <div className="flex items-center gap-1 w-full">
                          <span className="text-[10px] text-zinc-400">dims:</span>
                          <input
                            type="number"
                            min={1}
                            max={4096}
                            value={f.dims}
                            onChange={(e) => handleUpdateField(f.id, { dims: e.target.value })}
                            className="w-full rounded bg-[#121318] border border-[#2d303d] px-2 py-1 text-zinc-100 font-mono"
                          />
                        </div>
                      )}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleRemoveField(f.id)}
                        className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-[#252834] cursor-pointer"
                        title="Remove Field"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {f.type === 'text' && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-400 shrink-0">Analyzer:</span>
                        <input
                          type="text"
                          placeholder="standard, english, whitespace, keyword..."
                          value={f.analyzer}
                          onChange={(e) => handleUpdateField(f.id, { analyzer: e.target.value })}
                          className="w-full rounded bg-[#121318] border border-[#2d303d] px-2 py-1 text-zinc-200 font-mono text-[11px]"
                        />
                      </div>
                    </div>
                  )}

                  {f.type === 'dense_vector' && (
                    <div className="grid grid-cols-4 gap-2 pt-1 border-t border-[#262936]">
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-0.5">Similarity</label>
                        <select
                          value={f.similarity}
                          onChange={(e) =>
                            handleUpdateField(f.id, { similarity: e.target.value as VectorSimilarity })
                          }
                          className="w-full rounded bg-[#121318] border border-[#2d303d] px-2 py-1 text-zinc-200 font-mono text-[11px]"
                        >
                          <option value="cosine">cosine</option>
                          <option value="dot_product">dot_product</option>
                          <option value="l2_norm">l2_norm</option>
                          <option value="max_inner_product">max_inner_product</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-0.5">Index Type</label>
                        <select
                          value={f.vecIndexType}
                          onChange={(e) =>
                            handleUpdateField(f.id, { vecIndexType: e.target.value as VectorIndexType })
                          }
                          className="w-full rounded bg-[#121318] border border-[#2d303d] px-2 py-1 text-zinc-200 font-mono text-[11px]"
                        >
                          <option value="hnsw">hnsw (float32)</option>
                          <option value="int8_hnsw">int8_hnsw (quantized)</option>
                          <option value="int4_hnsw">int4_hnsw (quantized)</option>
                          <option value="bbq_hnsw">bbq_hnsw (binary)</option>
                          <option value="flat">flat (exact)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-0.5">HNSW m</label>
                        <input
                          type="number"
                          value={f.hnswM}
                          onChange={(e) => handleUpdateField(f.id, { hnswM: e.target.value })}
                          className="w-full rounded bg-[#121318] border border-[#2d303d] px-2 py-1 text-zinc-200 font-mono text-[11px]"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-0.5">ef_construction</label>
                        <input
                          type="number"
                          value={f.hnswEfConstruction}
                          onChange={(e) =>
                            handleUpdateField(f.id, { hnswEfConstruction: e.target.value })
                          }
                          className="w-full rounded bg-[#121318] border border-[#2d303d] px-2 py-1 text-zinc-200 font-mono text-[11px]"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Custom Analysis Collapsible */}
          <div className="rounded-lg border border-[#282b36] bg-[#14151b] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAnalysis((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-left text-[11px] font-semibold text-zinc-300 hover:bg-[#1d1f29] cursor-pointer"
            >
              <span>Custom Analyzers / Tokenizers JSON (settings.analysis)</span>
              {showAnalysis ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {showAnalysis && (
              <div className="p-3 border-t border-[#282b36]">
                <textarea
                  rows={4}
                  placeholder={`{\n  "analyzer": {\n    "my_custom_analyzer": { "type": "custom", "tokenizer": "standard", "filter": ["lowercase"] }\n  }\n}`}
                  value={analysisJson}
                  onChange={(e) => setAnalysisJson(e.target.value)}
                  className="w-full rounded bg-[#101116] border border-[#2d303d] p-2.5 font-mono text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Live REST Preview */}
          <div className="rounded-lg border border-[#282b36] bg-[#121318] p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                REST Command Preview
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!connection) return;
                  useWorkbenchStore.getState().createConsole(
                    connection.id,
                    'default',
                    'default',
                    `create_${indexName.trim() || 'index'}.es`,
                    commandPreview
                  );
                  onClose();
                }}
                className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer"
              >
                <Terminal className="h-3 w-3" />
                <span>Open in Console</span>
              </button>
            </div>
            <pre className="max-h-40 overflow-auto font-mono text-[11px] text-emerald-400 whitespace-pre-wrap">
              {commandPreview}
            </pre>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2b2e3a]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-1.5 rounded-lg bg-[#252834] hover:bg-[#2f3342] text-zinc-300 font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Create Index</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
