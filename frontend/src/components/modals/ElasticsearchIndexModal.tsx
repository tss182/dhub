import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  Layers,
  Plus,
  Trash2,
  RefreshCw,
  Tag,
  Sliders,
  Server,
  Wrench,
  Loader2,
  AlertCircle,
  Lock,
  Unlock,
  Sparkles,
} from 'lucide-react';
import { ConnectionConfig } from '../../types/domain';
import { QueryService, SchemaService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { ES_FIELD_TYPES, ESFieldType, VectorSimilarity } from './ElasticsearchCreateIndexModal';

interface ElasticsearchIndexModalProps {
  isOpen: boolean;
  onClose: () => void;
  connection: ConnectionConfig | null;
  database: string;
  indexName: string;
  onUpdated?: () => void;
}

interface FlattenedField {
  field: string;
  type: string;
  details: string;
}

function flattenESProperties(props: Record<string, any>, prefix = ''): FlattenedField[] {
  const out: FlattenedField[] = [];
  if (!props || typeof props !== 'object') return out;
  for (const [k, rawVal] of Object.entries(props)) {
    const val = rawVal as Record<string, any>;
    if (!val || typeof val !== 'object') continue;
    const fullPath = prefix ? `${prefix}.${k}` : k;
    const subProps = val.properties as Record<string, any> | undefined;
    if (subProps && val.type !== 'nested') {
      out.push(...flattenESProperties(subProps, fullPath));
      continue;
    }
    const fType = String(val.type || 'object');
    const detailParts: string[] = [];
    if (val.dims) detailParts.push(`dims=${val.dims}`);
    if (val.dimension) detailParts.push(`dimension=${val.dimension}`);
    if (val.similarity) detailParts.push(`similarity=${val.similarity}`);
    if (val.analyzer) detailParts.push(`analyzer=${val.analyzer}`);
    if (val.fields && typeof val.fields === 'object') {
      detailParts.push(`subfields: ${Object.keys(val.fields).map((s) => `.${s}`).join(', ')}`);
    }
    out.push({
      field: fullPath,
      type: fType,
      details: detailParts.join(' • '),
    });
    if (subProps && val.type === 'nested') {
      out.push(...flattenESProperties(subProps, fullPath));
    }
  }
  out.sort((a, b) => a.field.localeCompare(b.field));
  return out;
}

export const ElasticsearchIndexModal: React.FC<ElasticsearchIndexModalProps> = ({
  isOpen,
  onClose,
  connection,
  indexName,
  onUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'mappings' | 'settings' | 'aliases' | 'shards' | 'maintenance' | 'analyze'>('mappings');
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fields, setFields] = useState<FlattenedField[]>([]);
  const [rawMappingJson, setRawMappingJson] = useState('');
  const [rawSettingsJson, setRawSettingsJson] = useState('');
  const [aliases, setAliases] = useState<Array<{ name: string; isWriteIndex?: boolean; filter?: any; routing?: string }>>([]);
  const [shards, setShards] = useState<any[]>([]);
  const [statsSummary, setStatsSummary] = useState<{
    docsCount: number;
    deletedDocs: number;
    storeSize: string;
    segmentsCount: number;
  } | null>(null);

  // Text Analyzer Playground state
  const [analyzeTargetMode, setAnalyzeTargetMode] = useState<'analyzer' | 'field'>('analyzer');
  const [analyzeAnalyzer, setAnalyzeAnalyzer] = useState('standard');
  const [analyzeField, setAnalyzeField] = useState('');
  const [analyzeText, setAnalyzeText] = useState('Quick brown fox jumps over 2 lazy dogs!');
  const [analyzeTokens, setAnalyzeTokens] = useState<Array<{
    token: string;
    position: number;
    start_offset: number;
    end_offset: number;
    type: string;
  }>>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Add Field form
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<ESFieldType>('keyword');
  const [newFieldKeywordSub, setNewFieldKeywordSub] = useState(true);
  const [newFieldDims, setNewFieldDims] = useState('1536');
  const [newFieldSim, setNewFieldSim] = useState<VectorSimilarity>('cosine');

  // Dynamic Settings form
  const [replicas, setReplicas] = useState('1');
  const [refreshInterval, setRefreshInterval] = useState('1s');
  const [maxResultWindow, setMaxResultWindow] = useState('10000');
  const [readOnlyBlock, setReadOnlyBlock] = useState(false);

  // Add Alias form
  const [newAliasName, setNewAliasName] = useState('');
  const [newAliasWriteIdx, setNewAliasWriteIdx] = useState(false);
  const [newAliasRouting, setNewAliasRouting] = useState('');

  const runESRest = useCallback(
    async (sql: string) => {
      if (!connection) throw new Error('No active connection');
      const res = await QueryService.ExecuteQuery({
        executionId: `es-idx-mgr-${Date.now()}`,
        connectionId: connection.id,
        database: 'default',
        schema: 'default',
        sql,
        limit: 200,
        offset: 0,
      } as any);
      if (res?.error) throw new Error(res.error);
      if (res?.columns && res.columns.length > 1) {
        const cols = res.columns;
        const rowsList = res.rows || [];
        return rowsList.map((r: any[] | null) => {
          const obj: Record<string, any> = {};
          cols.forEach((c: any, i: number) => {
            obj[c.name] = r ? r[i] : null;
          });
          return obj;
        });
      }
      const raw = res?.rows?.[0]?.[0];
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }
      return raw;
    },
    [connection]
  );

  const loadAll = useCallback(async () => {
    if (!isOpen || !connection || !indexName) return;
    setIsLoading(true);
    setError(null);
    const esc = encodeURIComponent(indexName);
    try {
      const [mapRes, setRes, aliasRes, shardRes, statsRes] = await Promise.all([
        runESRest(`GET /${esc}/_mapping`).catch(() => null),
        runESRest(`GET /${esc}/_settings`).catch(() => null),
        runESRest(`GET /${esc}/_alias`).catch(() => null),
        runESRest(`GET /_cat/shards/${esc}?format=json`).catch(() => []),
        runESRest(`GET /${esc}/_stats`).catch(() => null),
      ]);

      const idxMapObj = mapRes?.[indexName] || (mapRes ? Object.values(mapRes)[0] : null);
      const props = (idxMapObj as any)?.mappings?.properties || {};
      setFields(flattenESProperties(props));
      setRawMappingJson(JSON.stringify(idxMapObj?.mappings || {}, null, 2));

      const idxSetObj = setRes?.[indexName] || (setRes ? Object.values(setRes)[0] : null);
      const idxSettings = (idxSetObj as any)?.settings?.index || {};
      setRawSettingsJson(JSON.stringify((idxSetObj as any)?.settings || {}, null, 2));
      setReplicas(idxSettings.number_of_replicas != null ? String(idxSettings.number_of_replicas) : '1');
      setRefreshInterval(idxSettings.refresh_interval != null ? String(idxSettings.refresh_interval) : '1s');
      setMaxResultWindow(idxSettings.max_result_window != null ? String(idxSettings.max_result_window) : '10000');
      setReadOnlyBlock(
        idxSettings?.blocks?.read_only_allow_delete === 'true' ||
          idxSettings?.blocks?.read_only_allow_delete === true
      );

      const idxAliasObj = aliasRes?.[indexName] || (aliasRes ? Object.values(aliasRes)[0] : null);
      const aliasMap = (idxAliasObj as any)?.aliases || {};
      setAliases(
        Object.entries(aliasMap).map(([name, cfg]: [string, any]) => ({
          name,
          isWriteIndex: Boolean(cfg?.is_write_index),
          routing: cfg?.index_routing || cfg?.routing || '',
          filter: cfg?.filter,
        }))
      );

      setShards(Array.isArray(shardRes) ? shardRes : []);

      const primaries = statsRes?.indices?.[indexName]?.primaries || statsRes?._all?.primaries;
      if (primaries) {
        const bytes = Number(primaries?.store?.size_in_bytes || 0);
        const sizeStr =
          bytes > 1024 * 1024
            ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
            : `${(bytes / 1024).toFixed(1)} KB`;
        setStatsSummary({
          docsCount: Number(primaries?.docs?.count || 0),
          deletedDocs: Number(primaries?.docs?.deleted || 0),
          storeSize: sizeStr,
          segmentsCount: Number(primaries?.segments?.count || 0),
        });
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, connection, indexName, runESRest]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('mappings');
      loadAll();
    }
  }, [isOpen, loadAll]);

  if (!isOpen) return null;

  const refreshSidebar = async () => {
    if (!connection) return;
    try {
      const objs = await SchemaService.GetObjects(connection.id, 'default', 'default');
      if (objs) {
        useConnectionStore.getState().setTreeObjects(`${connection.id}:default:default`, objs as any);
      }
    } catch {}
    onUpdated?.();
  };

  const handleAddField = async (e: React.FormEvent) => {
    e.preventDefault();
    const fName = newFieldName.trim();
    if (!fName) return;
    setIsBusy(true);
    try {
      const prop: Record<string, any> = { type: newFieldType };
      if (newFieldType === 'text' && newFieldKeywordSub) {
        prop.fields = { keyword: { type: 'keyword', ignore_above: 256 } };
      } else if (newFieldType === 'dense_vector') {
        prop.dims = Math.max(1, Number(newFieldDims) || 1536);
        prop.index = true;
        prop.similarity = newFieldSim;
      } else if (newFieldType === 'knn_vector') {
        prop.dimension = Math.max(1, Number(newFieldDims) || 1536);
      }
      const body = JSON.stringify({ properties: { [fName]: prop } });
      await runESRest(`PUT /${encodeURIComponent(indexName)}/_mapping\n${body}`);
      alertSuccess(`Added field "${fName}" (${newFieldType}) to ${indexName}.`, 'Mapping Updated');
      setNewFieldName('');
      await loadAll();
      await refreshSidebar();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Add Field Mapping');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveDynamicSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    try {
      const body = {
        index: {
          number_of_replicas: Math.max(0, Number(replicas) || 0),
          refresh_interval: refreshInterval.trim() || '1s',
          max_result_window: Math.max(100, Number(maxResultWindow) || 10000),
          'blocks.read_only_allow_delete': readOnlyBlock ? true : null,
        },
      };
      await runESRest(`PUT /${encodeURIComponent(indexName)}/_settings\n${JSON.stringify(body)}`);
      alertSuccess(`Updated dynamic settings for "${indexName}".`, 'Settings Updated');
      await loadAll();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Update Index Settings');
    } finally {
      setIsBusy(false);
    }
  };

  const handleAddAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    const aName = newAliasName.trim();
    if (!aName) return;
    setIsBusy(true);
    try {
      const addAction: Record<string, any> = { index: indexName, alias: aName };
      if (newAliasWriteIdx) addAction.is_write_index = true;
      if (newAliasRouting.trim()) addAction.routing = newAliasRouting.trim();
      await runESRest(`POST /_aliases\n${JSON.stringify({ actions: [{ add: addAction }] })}`);
      alertSuccess(`Alias "${aName}" added to ${indexName}.`, 'Alias Added');
      setNewAliasName('');
      setNewAliasWriteIdx(false);
      setNewAliasRouting('');
      await loadAll();
      await refreshSidebar();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Add Alias');
    } finally {
      setIsBusy(false);
    }
  };

  const handleRemoveAlias = async (aName: string) => {
    const ok = await confirmDialog({
      title: 'Remove Alias',
      message: `Remove alias "${aName}" from index "${indexName}"?`,
      confirmLabel: 'Remove Alias',
      isDanger: true,
    });
    if (!ok) return;
    setIsBusy(true);
    try {
      await runESRest(
        `POST /_aliases\n${JSON.stringify({ actions: [{ remove: { index: indexName, alias: aName } }] })}`
      );
      alertSuccess(`Removed alias "${aName}".`, 'Alias Removed');
      await loadAll();
      await refreshSidebar();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Remove Alias');
    } finally {
      setIsBusy(false);
    }
  };

  const handleMaintenanceOp = async (label: string, endpoint: string, confirmMsg?: string) => {
    if (confirmMsg) {
      const ok = await confirmDialog({
        title: label,
        message: confirmMsg,
        confirmLabel: label,
        isDanger: true,
      });
      if (!ok) return;
    }
    setIsBusy(true);
    try {
      await runESRest(`POST /${encodeURIComponent(indexName)}/${endpoint}`);
      alertSuccess(`${label} completed on "${indexName}".`, label);
      await loadAll();
      await refreshSidebar();
    } catch (err: any) {
      alertError(err?.message || String(err), `${label} Failed`);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d] shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-emerald-400" />
            <span className="font-semibold text-zinc-100 text-sm">Manage Index — {indexName}</span>
            {statsSummary && (
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[10px]">
                {statsSummary.docsCount.toLocaleString()} docs • {statsSummary.storeSize}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={loadAll}
              disabled={isLoading}
              className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-[#252834] cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 pt-2 border-b border-[#272934] bg-[#16171d]">
          {(
            [
              { id: 'mappings', label: `Mappings (${fields.length})`, icon: Layers },
              { id: 'settings', label: 'Dynamic Settings', icon: Sliders },
              { id: 'aliases', label: `Aliases (${aliases.length})`, icon: Tag },
              { id: 'shards', label: `Shards (${shards.length})`, icon: Server },
              { id: 'maintenance', label: 'Stats & Maintenance', icon: Wrench },
              { id: 'analyze', label: 'Text Analyzer', icon: Sparkles },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-b-2 transition-colors cursor-pointer ${
                  activeTab === t.id
                    ? 'border-blue-500 text-blue-300'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'mappings' && (
            <div className="space-y-4">
              {!connection?.isReadOnly && (
                <form
                  onSubmit={handleAddField}
                  className="rounded-lg border border-[#282b36] bg-[#14151b] p-3 space-y-2.5"
                >
                  <div className="text-[11px] font-semibold text-zinc-300">
                    Add New Field to Mapping (<code className="text-blue-300">PUT /{indexName}/_mapping</code>)
                  </div>
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-4">
                      <input
                        type="text"
                        placeholder="Field name (e.g. tags, embedding)"
                        value={newFieldName}
                        onChange={(e) => setNewFieldName(e.target.value)}
                        className="w-full rounded bg-[#1b1c22] border border-[#2d303d] px-2.5 py-1.5 text-zinc-100 font-mono"
                      />
                    </div>
                    <div className="col-span-3">
                      <select
                        value={newFieldType}
                        onChange={(e) => setNewFieldType(e.target.value as ESFieldType)}
                        className="w-full rounded bg-[#1b1c22] border border-[#2d303d] px-2 py-1.5 text-amber-300 font-mono"
                      >
                        {ES_FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3 flex items-center gap-2">
                      {newFieldType === 'text' && (
                        <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newFieldKeywordSub}
                            onChange={(e) => setNewFieldKeywordSub(e.target.checked)}
                          />
                          <span>+.keyword</span>
                        </label>
                      )}
                      {(newFieldType === 'dense_vector' || newFieldType === 'knn_vector') && (
                        <div className="flex items-center gap-1.5 w-full">
                          <input
                            type="number"
                            min={1}
                            max={4096}
                            value={newFieldDims}
                            onChange={(e) => setNewFieldDims(e.target.value)}
                            className="w-20 rounded bg-[#1b1c22] border border-[#2d303d] px-2 py-1 text-zinc-100 font-mono"
                            title="Dimensions"
                          />
                          {newFieldType === 'dense_vector' && (
                            <select
                              value={newFieldSim}
                              onChange={(e) => setNewFieldSim(e.target.value as VectorSimilarity)}
                              className="w-full rounded bg-[#1b1c22] border border-[#2d303d] px-1.5 py-1 text-zinc-200 font-mono text-[11px]"
                            >
                              <option value="cosine">cosine</option>
                              <option value="dot_product">dot_product</option>
                              <option value="l2_norm">l2_norm</option>
                            </select>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <button
                        type="submit"
                        disabled={isBusy || !newFieldName.trim()}
                        className="flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        <span>Add</span>
                      </button>
                    </div>
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Note: Existing field types in Elasticsearch cannot be mutated in-place; use Reindex to change an existing field type.
                  </div>
                </form>
              )}

              <div className="rounded-lg border border-[#282b36] overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[#14151b] text-zinc-400 border-b border-[#282b36] text-[11px]">
                    <tr>
                      <th className="py-2 px-3">Field Path</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3">Parameters &amp; Multi-Fields</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#232630] font-mono text-[11px]">
                    {fields.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-zinc-500 font-sans">
                          No explicit field mappings defined yet
                        </td>
                      </tr>
                    ) : (
                      fields.map((f) => (
                        <tr key={f.field} className="hover:bg-[#222530]/60">
                          <td className="py-2 px-3 text-zinc-100 font-medium">{f.field}</td>
                          <td className="py-2 px-3 text-amber-300">{f.type}</td>
                          <td className="py-2 px-3 text-zinc-400">{f.details || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <details className="rounded-lg border border-[#282b36] bg-[#14151b] p-2.5">
                <summary className="cursor-pointer text-[11px] font-medium text-zinc-400 hover:text-zinc-200">
                  View Raw Mapping JSON
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto font-mono text-[11px] text-emerald-300 whitespace-pre-wrap">
                  {rawMappingJson}
                </pre>
              </details>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-4">
              <form
                onSubmit={handleSaveDynamicSettings}
                className="rounded-lg border border-[#282b36] bg-[#14151b] p-3.5 space-y-3"
              >
                <div className="text-[11px] font-semibold text-zinc-200">
                  Dynamic Index Settings (<code className="text-blue-300">PUT /{indexName}/_settings</code>)
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Number of Replicas</label>
                    <input
                      type="number"
                      min={0}
                      value={replicas}
                      onChange={(e) => setReplicas(e.target.value)}
                      className="w-full rounded bg-[#1b1c22] border border-[#2d303d] px-2.5 py-1.5 text-zinc-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Refresh Interval</label>
                    <input
                      type="text"
                      placeholder="1s, 30s, -1"
                      value={refreshInterval}
                      onChange={(e) => setRefreshInterval(e.target.value)}
                      className="w-full rounded bg-[#1b1c22] border border-[#2d303d] px-2.5 py-1.5 text-zinc-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Max Result Window</label>
                    <input
                      type="number"
                      min={100}
                      value={maxResultWindow}
                      onChange={(e) => setMaxResultWindow(e.target.value)}
                      className="w-full rounded bg-[#1b1c22] border border-[#2d303d] px-2.5 py-1.5 text-zinc-100 font-mono"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={readOnlyBlock}
                      onChange={(e) => setReadOnlyBlock(e.target.checked)}
                    />
                    <span>Read-Only Allow Delete Block (<code className="text-amber-300">blocks.read_only_allow_delete</code>)</span>
                  </label>
                  {!connection?.isReadOnly && (
                    <button
                      type="submit"
                      disabled={isBusy}
                      className="px-3.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer disabled:opacity-50"
                    >
                      Save Dynamic Settings
                    </button>
                  )}
                </div>
              </form>

              <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                <div className="text-[11px] font-semibold text-zinc-400 mb-1.5">Full Index Settings JSON</div>
                <pre className="max-h-56 overflow-auto font-mono text-[11px] text-zinc-300 whitespace-pre-wrap">
                  {rawSettingsJson}
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'aliases' && (
            <div className="space-y-4">
              {!connection?.isReadOnly && (
                <form
                  onSubmit={handleAddAlias}
                  className="rounded-lg border border-[#282b36] bg-[#14151b] p-3 flex items-center gap-2"
                >
                  <input
                    type="text"
                    placeholder="Alias name (e.g. logs_current)"
                    value={newAliasName}
                    onChange={(e) => setNewAliasName(e.target.value)}
                    className="flex-1 rounded bg-[#1b1c22] border border-[#2d303d] px-2.5 py-1.5 text-zinc-100 font-mono"
                  />
                  <input
                    type="text"
                    placeholder="Optional routing"
                    value={newAliasRouting}
                    onChange={(e) => setNewAliasRouting(e.target.value)}
                    className="w-36 rounded bg-[#1b1c22] border border-[#2d303d] px-2.5 py-1.5 text-zinc-100 font-mono"
                  />
                  <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={newAliasWriteIdx}
                      onChange={(e) => setNewAliasWriteIdx(e.target.checked)}
                    />
                    <span>is_write_index</span>
                  </label>
                  <button
                    type="submit"
                    disabled={isBusy || !newAliasName.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Alias</span>
                  </button>
                </form>
              )}

              <div className="rounded-lg border border-[#282b36] overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[#14151b] text-zinc-400 border-b border-[#282b36] text-[11px]">
                    <tr>
                      <th className="py-2 px-3">Alias Name</th>
                      <th className="py-2 px-3">Write Index</th>
                      <th className="py-2 px-3">Routing</th>
                      <th className="py-2 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#232630] font-mono text-[11px]">
                    {aliases.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-zinc-500 font-sans">
                          No aliases pointing to {indexName}
                        </td>
                      </tr>
                    ) : (
                      aliases.map((a) => (
                        <tr key={a.name} className="hover:bg-[#222530]/60">
                          <td className="py-2 px-3 text-cyan-300 font-medium">{a.name}</td>
                          <td className="py-2 px-3">{a.isWriteIndex ? 'true' : 'false'}</td>
                          <td className="py-2 px-3 text-zinc-400">{a.routing || '-'}</td>
                          <td className="py-2 px-3 text-right">
                            {!connection?.isReadOnly && (
                              <button
                                type="button"
                                onClick={() => handleRemoveAlias(a.name)}
                                className="p-1 rounded text-zinc-400 hover:text-rose-400 cursor-pointer"
                                title="Remove Alias"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'shards' && (
            <div className="rounded-lg border border-[#282b36] overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#14151b] text-zinc-400 border-b border-[#282b36] text-[11px]">
                  <tr>
                    <th className="py-2 px-3">Shard</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">State</th>
                    <th className="py-2 px-3">Docs</th>
                    <th className="py-2 px-3">Store</th>
                    <th className="py-2 px-3">Node</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#232630] font-mono text-[11px]">
                  {shards.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-zinc-500 font-sans">
                        No shard details returned
                      </td>
                    </tr>
                  ) : (
                    shards.map((s, idx) => (
                      <tr key={idx} className="hover:bg-[#222530]/60">
                        <td className="py-2 px-3 text-zinc-100">#{s.shard}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              s.prirep === 'p'
                                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                : 'bg-zinc-700/40 text-zinc-300 border border-zinc-600/40'
                            }`}
                          >
                            {s.prirep === 'p' ? 'PRIMARY' : 'REPLICA'}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={
                              s.state === 'STARTED'
                                ? 'text-emerald-400 font-semibold'
                                : 'text-amber-400 font-semibold'
                            }
                          >
                            {s.state}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-zinc-300">{s.docs || '0'}</td>
                        <td className="py-2 px-3 text-zinc-400">{s.store || '-'}</td>
                        <td className="py-2 px-3 text-zinc-300">{s.node || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'maintenance' && (
            <div className="space-y-4">
              {statsSummary && (
                <div className="grid grid-cols-4 gap-2.5">
                  <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                    <div className="text-[10px] text-zinc-500">Live Documents</div>
                    <div className="font-mono text-sm font-semibold text-zinc-100 mt-0.5">
                      {statsSummary.docsCount.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                    <div className="text-[10px] text-zinc-500">Deleted Documents</div>
                    <div className="font-mono text-sm font-semibold text-amber-300 mt-0.5">
                      {statsSummary.deletedDocs.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                    <div className="text-[10px] text-zinc-500">Primary Store Size</div>
                    <div className="font-mono text-sm font-semibold text-emerald-300 mt-0.5">
                      {statsSummary.storeSize}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                    <div className="text-[10px] text-zinc-500">Lucene Segments</div>
                    <div className="font-mono text-sm font-semibold text-blue-300 mt-0.5">
                      {statsSummary.segmentsCount}
                    </div>
                  </div>
                </div>
              )}

              {!connection?.isReadOnly && (
                <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3.5 space-y-3">
                  <div className="text-[11px] font-semibold text-zinc-200">Index Maintenance Operations</div>
                  <div className="grid grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleMaintenanceOp('Refresh Index', '_refresh')}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#222530] hover:bg-[#2b2f3d] border border-[#323646] text-zinc-200 font-medium cursor-pointer"
                    >
                      <RefreshCw className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Refresh (_refresh)</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleMaintenanceOp('Flush Translog', '_flush')}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#222530] hover:bg-[#2b2f3d] border border-[#323646] text-zinc-200 font-medium cursor-pointer"
                    >
                      <Layers className="h-3.5 w-3.5 text-blue-400" />
                      <span>Flush (_flush)</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleMaintenanceOp('Clear Cache', '_cache/clear')}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#222530] hover:bg-[#2b2f3d] border border-[#323646] text-zinc-200 font-medium cursor-pointer"
                    >
                      <Wrench className="h-3.5 w-3.5 text-cyan-400" />
                      <span>Clear Cache</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        handleMaintenanceOp(
                          'Force Merge Deleted Docs',
                          '_forcemerge?only_expunge_deletes=true',
                          `Expunge deleted documents and merge segments in "${indexName}"?`
                        )
                      }
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#222530] hover:bg-[#2b2f3d] border border-[#323646] text-zinc-200 font-medium cursor-pointer"
                    >
                      <Wrench className="h-3.5 w-3.5 text-amber-400" />
                      <span>Force Merge Deletes</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleMaintenanceOp('Open Index', '_open')}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-700/40 text-emerald-200 font-medium cursor-pointer"
                    >
                      <Unlock className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Open Index (_open)</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        handleMaintenanceOp(
                          'Close Index',
                          '_close',
                          `Closing index "${indexName}" will block all read/write operations until reopened. Continue?`
                        )
                      }
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 border border-rose-700/40 text-rose-200 font-medium cursor-pointer"
                    >
                      <Lock className="h-3.5 w-3.5 text-rose-400" />
                      <span>Close Index (_close)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

              {activeTab === 'analyze' && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-[#272934] bg-[#14151b] p-3 space-y-3">
                    <div className="text-[11px] font-semibold text-zinc-200">
                      Text Analyzer Playground (<code>POST /{indexName}/_analyze</code>)
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">Mode</label>
                        <select
                          value={analyzeTargetMode}
                          onChange={(e) => setAnalyzeTargetMode(e.target.value as 'analyzer' | 'field')}
                          className="w-full rounded bg-[#101116] border border-[#272932] px-2 py-1.5 text-zinc-200"
                        >
                          <option value="analyzer">By Analyzer Name</option>
                          <option value="field">By Index Field</option>
                        </select>
                      </div>
                      {analyzeTargetMode === 'analyzer' ? (
                        <div className="md:col-span-2">
                          <label className="block text-[10px] text-zinc-400 mb-1">Analyzer</label>
                          <div className="flex gap-2">
                            <select
                              value={['standard', 'simple', 'whitespace', 'stop', 'keyword', 'english', 'fingerprint'].includes(analyzeAnalyzer) ? analyzeAnalyzer : '__custom__'}
                              onChange={(e) => {
                                if (e.target.value !== '__custom__') setAnalyzeAnalyzer(e.target.value);
                              }}
                              className="rounded bg-[#101116] border border-[#272932] px-2 py-1.5 text-zinc-200"
                            >
                              <option value="standard">standard</option>
                              <option value="simple">simple</option>
                              <option value="whitespace">whitespace</option>
                              <option value="stop">stop</option>
                              <option value="keyword">keyword</option>
                              <option value="english">english</option>
                              <option value="fingerprint">fingerprint</option>
                              <option value="__custom__">custom...</option>
                            </select>
                            <input
                              type="text"
                              value={analyzeAnalyzer}
                              onChange={(e) => setAnalyzeAnalyzer(e.target.value)}
                              placeholder="custom_analyzer_name"
                              className="flex-1 rounded bg-[#101116] border border-[#272932] px-2 py-1.5 font-mono text-zinc-200"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="md:col-span-2">
                          <label className="block text-[10px] text-zinc-400 mb-1">Index Field</label>
                          <select
                            value={analyzeField || fields.find((f) => f.type === 'text')?.field || fields[0]?.field || ''}
                            onChange={(e) => setAnalyzeField(e.target.value)}
                            className="w-full rounded bg-[#101116] border border-[#272932] px-2 py-1.5 font-mono text-zinc-200"
                          >
                            {fields.map((f) => (
                              <option key={f.field} value={f.field}>
                                {f.field} ({f.type})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Sample Text</label>
                      <textarea
                        rows={3}
                        value={analyzeText}
                        onChange={(e) => setAnalyzeText(e.target.value)}
                        className="w-full rounded bg-[#101116] border border-[#272932] p-2 font-mono text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={isAnalyzing || !analyzeText.trim()}
                        onClick={async () => {
                          setError(null);
                          setIsAnalyzing(true);
                          try {
                            const body: Record<string, any> = { text: analyzeText };
                            if (analyzeTargetMode === 'field') {
                              const chosenField =
                                analyzeField || fields.find((f) => f.type === 'text')?.field || fields[0]?.field;
                              if (!chosenField) throw new Error('Select a field to analyze.');
                              body.field = chosenField;
                            } else {
                              body.analyzer = analyzeAnalyzer.trim() || 'standard';
                            }
                            const resp = await runESRest(
                              `POST /${encodeURIComponent(indexName)}/_analyze\n${JSON.stringify(body)}`
                            );
                            const toks = Array.isArray(resp?.tokens) ? resp.tokens : [];
                            setAnalyzeTokens(toks);
                          } catch (err: any) {
                            setError(err?.message || String(err));
                          } finally {
                            setIsAnalyzing(false);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium cursor-pointer"
                      >
                        {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        <span>Analyze Tokens</span>
                      </button>
                    </div>
                  </div>

                  {analyzeTokens.length > 0 && (
                    <div className="rounded-lg border border-[#272934] bg-[#14151b] p-3 space-y-2">
                      <div className="text-[11px] text-zinc-400">
                        Generated Tokens: <strong className="text-emerald-300">{analyzeTokens.length}</strong>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {analyzeTokens.map((tk, i) => (
                          <div
                            key={i}
                            className="rounded-lg border border-[#2f3342] bg-[#1a1c24] px-2.5 py-1.5 space-y-0.5"
                          >
                            <div className="font-mono text-xs font-semibold text-cyan-300">{tk.token}</div>
                            <div className="text-[9px] font-mono text-zinc-500">
                              pos:{tk.position} [{tk.start_offset}..{tk.end_offset}] {tk.type}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
        </div>
      </div>
    </div>
  );
};
