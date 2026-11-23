import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  Layers,
  Plus,
  Trash2,
  RefreshCw,
  Database,
  Camera,
  Tag,
  AlertCircle,
  Loader2,
  Sliders,
  RotateCcw,
  Download,
  Upload,
  Server,
} from 'lucide-react';
import { Dialogs } from '@wailsio/runtime';
import { ConnectionConfig } from '../../types/domain';
import { QueryService, SchemaService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';
import { useConnectionStore } from '../../stores/useConnectionStore';

type PayloadFieldType = 'keyword' | 'integer' | 'float' | 'bool' | 'datetime' | 'text' | 'geo' | 'uuid';

const PAYLOAD_FIELD_TYPES: PayloadFieldType[] = [
  'keyword',
  'integer',
  'float',
  'bool',
  'datetime',
  'text',
  'geo',
  'uuid',
];

interface PayloadIndexEntry {
  field: string;
  dataType: string;
  points?: number;
}

interface SnapshotEntry {
  name: string;
  creation_time?: string;
  size?: number;
  checksum?: string;
}

interface QdrantCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  connection: ConnectionConfig | null;
  database: string;
  collectionName: string;
  onUpdated?: () => void;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const QdrantCollectionModal: React.FC<QdrantCollectionModalProps> = ({
  isOpen,
  onClose,
  connection,
  database,
  collectionName,
  onUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'indexes' | 'aliases' | 'snapshots' | 'shards' | 'settings' | 'info'>('indexes');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collectionInfo, setCollectionInfo] = useState<any>(null);
  const [clusterInfo, setClusterInfo] = useState<any>(null);
  const [indexes, setIndexes] = useState<PayloadIndexEntry[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [aliases, setAliases] = useState<string[]>([]);
  const [newAliasName, setNewAliasName] = useState('');
  const [renamingAlias, setRenamingAlias] = useState<{ oldName: string; newName: string } | null>(null);
  const [recoverUrl, setRecoverUrl] = useState('');
  const [newShardKey, setNewShardKey] = useState('');

  // Rich payload index options
  const [showIndexOpts, setShowIndexOpts] = useState(false);
  const [idxOnDisk, setIdxOnDisk] = useState(false);
  const [idxIsTenant, setIdxIsTenant] = useState(false);
  const [idxTokenizer, setIdxTokenizer] = useState<'word' | 'whitespace' | 'prefix' | 'multilingual'>('word');
  const [idxMinTokenLen, setIdxMinTokenLen] = useState('');
  const [idxMaxTokenLen, setIdxMaxTokenLen] = useState('');
  const [idxLowercase, setIdxLowercase] = useState(true);
  const [idxPhraseMatching, setIdxPhraseMatching] = useState(false);
  const [idxLookup, setIdxLookup] = useState(true);
  const [idxRange, setIdxRange] = useState(true);

  // Runtime PATCH settings
  const [indexingThreshold, setIndexingThreshold] = useState('');
  const [memmapThreshold, setMemmapThreshold] = useState('');
  const [vacuumMinVectors, setVacuumMinVectors] = useState('');
  const [hnswM, setHnswM] = useState('');
  const [hnswEfConstruct, setHnswEfConstruct] = useState('');
  const [hnswOnDisk, setHnswOnDisk] = useState(false);
  // Strict mode settings
  const [strictEnabled, setStrictEnabled] = useState(false);
  const [strictMaxLimit, setStrictMaxLimit] = useState('');
  const [strictMaxTimeout, setStrictMaxTimeout] = useState('');
  const [strictMaxEf, setStrictMaxEf] = useState('');
  const [strictAllowUnindexed, setStrictAllowUnindexed] = useState(true);

  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<PayloadFieldType>('keyword');
  const [isBusyAction, setIsBusyAction] = useState(false);

  const runQdrantRest = useCallback(
    async (sql: string) => {
      if (!connection) throw new Error('No active connection');
      const res = await QueryService.ExecuteQuery({
        executionId: `qdrant-mgr-${Date.now()}`,
        connectionId: connection.id,
        database: database || connection.databaseName || 'default',
        schema: 'default',
        sql,
        limit: 100,
        offset: 0,
      } as any);
      if (res?.error) {
        throw new Error(res.error);
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
    [connection, database]
  );

  const loadAll = useCallback(async () => {
    if (!isOpen || !connection || !collectionName) return;
    setIsLoading(true);
    setError(null);
    try {
      const [infoRes, snapRes, aliasRes, clusterRes] = await Promise.all([
        runQdrantRest(`GET /collections/${encodeURIComponent(collectionName)}`),
        runQdrantRest(`GET /collections/${encodeURIComponent(collectionName)}/snapshots`).catch(() => null),
        runQdrantRest(`GET /collections/${encodeURIComponent(collectionName)}/aliases`).catch(() => null),
        runQdrantRest(`GET /collections/${encodeURIComponent(collectionName)}/cluster`).catch(() => null),
      ]);

      const info = infoRes?.result ?? infoRes ?? {};
      setCollectionInfo(info);
      setClusterInfo(clusterRes?.result ?? clusterRes ?? null);

      const strict = info?.config?.strict_mode_config ?? {};
      setStrictEnabled(Boolean(strict.enabled));
      setStrictMaxLimit(strict.max_query_limit != null ? String(strict.max_query_limit) : '');
      setStrictMaxTimeout(strict.max_timeout != null ? String(strict.max_timeout) : '');
      setStrictMaxEf(strict.search_max_hnsw_ef != null ? String(strict.search_max_hnsw_ef) : '');
      setStrictAllowUnindexed(strict.unindexed_filtering_retrieve !== false);

      const opt = info?.config?.optimizer_config ?? {};
      setIndexingThreshold(opt.indexing_threshold != null ? String(opt.indexing_threshold) : '');
      setMemmapThreshold(opt.memmap_threshold != null ? String(opt.memmap_threshold) : '');
      setVacuumMinVectors(opt.vacuum_min_vector_number != null ? String(opt.vacuum_min_vector_number) : '');

      const hnsw = info?.config?.hnsw_config ?? {};
      setHnswM(hnsw.m != null ? String(hnsw.m) : '');
      setHnswEfConstruct(hnsw.ef_construct != null ? String(hnsw.ef_construct) : '');
      setHnswOnDisk(Boolean(hnsw.on_disk));

      const aliasList = Array.isArray(aliasRes?.result?.aliases)
        ? aliasRes.result.aliases.map((a: any) => String(a.alias_name || '')).filter(Boolean)
        : [];
      setAliases(aliasList);

      const schemaMap = info?.payload_schema || {};
      const parsedIndexes: PayloadIndexEntry[] = Object.entries(schemaMap).map(([field, meta]: [string, any]) => ({
        field,
        dataType: String(meta?.data_type || 'unknown'),
        points: typeof meta?.points === 'number' ? meta.points : undefined,
      }));
      parsedIndexes.sort((a, b) => a.field.localeCompare(b.field));
      setIndexes(parsedIndexes);

      const snapList = Array.isArray(snapRes?.result) ? snapRes.result : [];
      setSnapshots(snapList);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, connection, collectionName, runQdrantRest]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('indexes');
      setNewFieldName('');
      setNewFieldType('keyword');
      loadAll();
    }
  }, [isOpen, loadAll]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusyAction) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isBusyAction, onClose]);

  if (!isOpen) return null;

  const refreshExplorerObjects = async () => {
    if (!connection) return;
    const dbName = database || connection.databaseName || 'default';
    try {
      const objects = await SchemaService.GetObjects(connection.id, dbName, dbName);
      if (objects) {
        useConnectionStore.getState().setTreeObjects(`${connection.id}:${dbName}:${dbName}`, objects as any);
      }
    } catch {}
    onUpdated?.();
  };

  const handleCreateIndex = async (e: React.FormEvent) => {
    e.preventDefault();
    const field = newFieldName.trim();
    if (!field) return;
    setIsBusyAction(true);
    try {
      let fieldSchema: any = newFieldType;
      if (showIndexOpts) {
        const schemaObj: Record<string, any> = { type: newFieldType };
        if (idxOnDisk) schemaObj.on_disk = true;
        if ((newFieldType === 'keyword' || newFieldType === 'integer' || newFieldType === 'uuid') && idxIsTenant) {
          schemaObj.is_tenant = true;
        }
        if (newFieldType === 'integer') {
          schemaObj.lookup = idxLookup;
          schemaObj.range = idxRange;
        }
        if (newFieldType === 'text') {
          schemaObj.tokenizer = idxTokenizer;
          schemaObj.lowercase = idxLowercase;
          if (idxPhraseMatching) schemaObj.phrase_matching = true;
          if (idxMinTokenLen.trim() && Number.isFinite(Number(idxMinTokenLen))) {
            schemaObj.min_token_len = Math.max(1, Math.floor(Number(idxMinTokenLen)));
          }
          if (idxMaxTokenLen.trim() && Number.isFinite(Number(idxMaxTokenLen))) {
            schemaObj.max_token_len = Math.max(1, Math.floor(Number(idxMaxTokenLen)));
          }
        }
        fieldSchema = schemaObj;
      }
      const body = JSON.stringify({ field_name: field, field_schema: fieldSchema });
      await runQdrantRest(`PUT /collections/${encodeURIComponent(collectionName)}/index?wait=true\n${body}`);
      alertSuccess(`Created ${newFieldType} payload index on "${field}".`, 'Payload Index Created');
      setNewFieldName('');
      await loadAll();
      await refreshExplorerObjects();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Create Payload Index');
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleDeleteIndex = async (field: string) => {
    const ok = await confirmDialog({
      title: 'Delete Payload Index',
      message: `Remove payload index on "${field}" in collection "${collectionName}"?`,
      confirmLabel: 'Delete Index',
      isDanger: true,
    });
    if (!ok) return;
    setIsBusyAction(true);
    try {
      await runQdrantRest(
        `DELETE /collections/${encodeURIComponent(collectionName)}/index/${encodeURIComponent(field)}?wait=true`
      );
      alertSuccess(`Deleted payload index "${field}".`, 'Index Deleted');
      await loadAll();
      await refreshExplorerObjects();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Delete Payload Index');
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleCreateSnapshot = async () => {
    setIsBusyAction(true);
    try {
      await runQdrantRest(`POST /collections/${encodeURIComponent(collectionName)}/snapshots?wait=true`);
      alertSuccess(`Snapshot created for "${collectionName}".`, 'Snapshot Created');
      await loadAll();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Create Snapshot');
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleDeleteSnapshot = async (snapName: string) => {
    const ok = await confirmDialog({
      title: 'Delete Snapshot',
      message: `Delete snapshot "${snapName}" from collection "${collectionName}"?`,
      confirmLabel: 'Delete Snapshot',
      isDanger: true,
    });
    if (!ok) return;
    setIsBusyAction(true);
    try {
      await runQdrantRest(
        `DELETE /collections/${encodeURIComponent(collectionName)}/snapshots/${encodeURIComponent(snapName)}?wait=true`
      );
      alertSuccess(`Deleted snapshot "${snapName}".`, 'Snapshot Deleted');
      await loadAll();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Delete Snapshot');
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleCreateAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    const alias = newAliasName.trim();
    if (!alias) return;
    setIsBusyAction(true);
    try {
      const body = JSON.stringify({
        actions: [{ create_alias: { collection_name: collectionName, alias_name: alias } }],
      });
      await runQdrantRest(`POST /collections/aliases\n${body}`);
      alertSuccess(`Alias "${alias}" -> "${collectionName}" created.`, 'Alias Created');
      setNewAliasName('');
      await loadAll();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Create Alias');
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleDeleteAlias = async (alias: string) => {
    setIsBusyAction(true);
    try {
      const body = JSON.stringify({
        actions: [{ delete_alias: { alias_name: alias } }],
      });
      await runQdrantRest(`POST /collections/aliases\n${body}`);
      alertSuccess(`Deleted alias "${alias}".`, 'Alias Deleted');
      await loadAll();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Delete Alias');
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleRecoverSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    const loc = recoverUrl.trim();
    if (!loc) return;
    const ok = await confirmDialog({
      title: 'Recover Snapshot from URL',
      message: `Recover collection "${collectionName}" from "${loc}"? Existing points in this collection may be replaced.`,
      confirmLabel: 'Recover',
      isDanger: true,
    });
    if (!ok) return;
    setIsBusyAction(true);
    try {
      const body = JSON.stringify({ location: loc });
      await runQdrantRest(`PUT /collections/${encodeURIComponent(collectionName)}/snapshots/recover?wait=true\n${body}`);
      alertSuccess(`Collection "${collectionName}" recovered from snapshot.`, 'Recovery Complete');
      setRecoverUrl('');
      await loadAll();
      await refreshExplorerObjects();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Snapshot Recovery Failed');
    } finally {
      setIsBusyAction(false);
    }
  };

  const handlePatchSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusyAction(true);
    try {
      const patchBody: Record<string, any> = {};
      const opt: Record<string, any> = {};
      if (indexingThreshold.trim() !== '' && Number.isFinite(Number(indexingThreshold))) {
        opt.indexing_threshold = Math.max(0, Math.floor(Number(indexingThreshold)));
      }
      if (memmapThreshold.trim() !== '' && Number.isFinite(Number(memmapThreshold))) {
        opt.memmap_threshold = Math.max(0, Math.floor(Number(memmapThreshold)));
      }
      if (vacuumMinVectors.trim() !== '' && Number.isFinite(Number(vacuumMinVectors))) {
        opt.vacuum_min_vector_number = Math.max(0, Math.floor(Number(vacuumMinVectors)));
      }
      if (Object.keys(opt).length > 0) patchBody.optimizers_config = opt;

      const hnsw: Record<string, any> = { on_disk: hnswOnDisk };
      if (hnswM.trim() !== '' && Number.isFinite(Number(hnswM))) {
        hnsw.m = Math.max(0, Math.floor(Number(hnswM)));
      }
      if (hnswEfConstruct.trim() !== '' && Number.isFinite(Number(hnswEfConstruct))) {
        hnsw.ef_construct = Math.max(4, Math.floor(Number(hnswEfConstruct)));
      }
      patchBody.hnsw_config = hnsw;

      const strictCfg: Record<string, any> = {
        enabled: strictEnabled,
        unindexed_filtering_retrieve: strictAllowUnindexed,
      };
      if (strictMaxLimit.trim() !== '' && Number.isFinite(Number(strictMaxLimit))) {
        strictCfg.max_query_limit = Math.max(1, Math.floor(Number(strictMaxLimit)));
      }
      if (strictMaxTimeout.trim() !== '' && Number.isFinite(Number(strictMaxTimeout))) {
        strictCfg.max_timeout = Math.max(1, Math.floor(Number(strictMaxTimeout)));
      }
      if (strictMaxEf.trim() !== '' && Number.isFinite(Number(strictMaxEf))) {
        strictCfg.search_max_hnsw_ef = Math.max(1, Math.floor(Number(strictMaxEf)));
      }
      patchBody.strict_mode_config = strictCfg;

      await runQdrantRest(`PATCH /collections/${encodeURIComponent(collectionName)}\n${JSON.stringify(patchBody)}`);
      alertSuccess(`Updated runtime settings for "${collectionName}".`, 'Collection Updated');
      await loadAll();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Update Collection');
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleDownloadSnapshot = async (snapName: string) => {
    if (!connection) return;
    try {
      const savePath = await Dialogs.SaveFile({
        Title: `Save Snapshot — ${collectionName}`,
        Filename: snapName,
        CanCreateDirectories: true,
        Filters: [{ DisplayName: 'Snapshot Files (*.snapshot)', Pattern: '*.snapshot' }],
      });
      if (!savePath || typeof savePath !== 'string') return;
      setIsBusyAction(true);
      const bytes = await SchemaService.DownloadQdrantSnapshot(connection.id, collectionName, snapName, savePath);
      alertSuccess(`Downloaded snapshot (${formatBytes(bytes)}) to ${savePath}`, 'Snapshot Downloaded');
    } catch (err: any) {
      alertError(err?.message || String(err), 'Snapshot Download Failed');
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleUploadSnapshot = async () => {
    if (!connection) return;
    try {
      const chosen = await Dialogs.OpenFile({
        Title: `Upload Local Snapshot to ${collectionName}`,
        CanChooseFiles: true,
        AllowsMultipleSelection: false,
        Filters: [{ DisplayName: 'Snapshot Files (*.snapshot)', Pattern: '*.snapshot' }, { DisplayName: 'All Files (*.*)', Pattern: '*.*' }],
      });
      if (!chosen || typeof chosen !== 'string') return;
      const ok = await confirmDialog({
        title: 'Upload & Recover Snapshot',
        message: `Upload "${chosen}" to overwrite/recover collection "${collectionName}"?`,
        confirmLabel: 'Upload & Recover',
        isDanger: true,
      });
      if (!ok) return;
      setIsBusyAction(true);
      await SchemaService.UploadQdrantSnapshot(connection.id, collectionName, chosen);
      alertSuccess(`Uploaded and recovered snapshot for "${collectionName}".`, 'Snapshot Restored');
      await loadAll();
      await refreshExplorerObjects();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Snapshot Upload Failed');
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleRenameAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingAlias || !renamingAlias.newName.trim()) return;
    setIsBusyAction(true);
    try {
      const body = JSON.stringify({
        actions: [{ rename_alias: { old_alias_name: renamingAlias.oldName, new_alias_name: renamingAlias.newName.trim() } }],
      });
      await runQdrantRest(`POST /collections/aliases\n${body}`);
      alertSuccess(`Renamed alias "${renamingAlias.oldName}" -> "${renamingAlias.newName.trim()}".`, 'Alias Renamed');
      setRenamingAlias(null);
      await loadAll();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Rename Alias');
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleCreateShardKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const sk = newShardKey.trim();
    if (!sk) return;
    setIsBusyAction(true);
    try {
      const body = JSON.stringify({ create_sharding_key: { shard_key: sk } });
      await runQdrantRest(`PUT /collections/${encodeURIComponent(collectionName)}/cluster\n${body}`);
      alertSuccess(`Created shard key "${sk}".`, 'Shard Key Created');
      setNewShardKey('');
      await loadAll();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Create Shard Key');
    } finally {
      setIsBusyAction(false);
    }
  };

  const statusColor =
    collectionInfo?.status === 'green'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : collectionInfo?.status === 'yellow'
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : 'bg-zinc-800 text-zinc-300 border-zinc-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
              <Layers className="h-3.5 w-3.5" />
            </span>
            <span className="text-zinc-400 font-mono truncate">{connection?.name || 'Qdrant'}</span>
            <span className="text-zinc-600">→</span>
            <span className="font-semibold text-zinc-100 text-sm font-mono truncate">{collectionName}</span>
            {collectionInfo?.status && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase border ${statusColor}`}>
                {collectionInfo.status}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={loadAll}
              disabled={isLoading || isBusyAction}
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isBusyAction}
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] cursor-pointer"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Summary Stats Bar */}
        {collectionInfo && (
          <div className="grid grid-cols-4 gap-2 px-4 py-2.5 bg-[#14151b] border-b border-[#262934] text-[11px]">
            <div>
              <div className="text-zinc-500 text-[10px]">Points</div>
              <div className="font-mono font-semibold text-zinc-100">
                {collectionInfo.points_count ?? 0}
              </div>
            </div>
            <div>
              <div className="text-zinc-500 text-[10px]">Indexed Vectors</div>
              <div className="font-mono font-semibold text-zinc-100">
                {collectionInfo.indexed_vectors_count ?? collectionInfo.vectors_count ?? 0}
              </div>
            </div>
            <div>
              <div className="text-zinc-500 text-[10px]">Segments</div>
              <div className="font-mono font-semibold text-zinc-100">
                {collectionInfo.segments_count ?? '-'}
              </div>
            </div>
            <div>
              <div className="text-zinc-500 text-[10px]">Payload Indexes</div>
              <div className="font-mono font-semibold text-zinc-100">{indexes.length}</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 border-b border-[#272934] bg-[#16171d] shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('indexes')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium cursor-pointer transition-colors ${
              activeTab === 'indexes'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Tag className="h-3.5 w-3.5" />
            <span>Payload Indexes ({indexes.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('aliases')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium cursor-pointer transition-colors ${
              activeTab === 'aliases'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Tag className="h-3.5 w-3.5" />
            <span>Aliases ({aliases.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('snapshots')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium cursor-pointer transition-colors ${
              activeTab === 'snapshots'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Camera className="h-3.5 w-3.5" />
            <span>Snapshots ({snapshots.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('shards')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium cursor-pointer transition-colors ${
              activeTab === 'shards'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Server className="h-3.5 w-3.5" />
            <span>Shards</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium cursor-pointer transition-colors ${
              activeTab === 'settings'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>Settings</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('info')}
            className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium cursor-pointer transition-colors ${
              activeTab === 'info'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            <span>Collection Config</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/50 text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'indexes' && (
            <div className="space-y-4">
              {!connection?.isReadOnly && (
                <form
                  onSubmit={handleCreateIndex}
                  className="flex flex-wrap items-end gap-2 p-3 rounded-lg bg-[#14151b] border border-[#282b36]"
                >
                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-[10px] text-zinc-400 mb-1">Payload Field Name</label>
                    <input
                      type="text"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      placeholder="e.g. category or user.id"
                      className="w-full rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="w-36">
                    <label className="block text-[10px] text-zinc-400 mb-1">Index Schema</label>
                    <select
                      value={newFieldType}
                      onChange={(e) => setNewFieldType(e.target.value as PayloadFieldType)}
                      className="w-full rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1.5 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
                    >
                      {PAYLOAD_FIELD_TYPES.map((ft) => (
                        <option key={ft} value={ft}>
                          {ft}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowIndexOpts((v) => !v)}
                    className={`px-2.5 py-1.5 rounded border text-[11px] cursor-pointer ${
                      showIndexOpts
                        ? 'bg-violet-600/20 border-violet-500/40 text-violet-200'
                        : 'bg-[#1a1c24] border-[#2f3240] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Options
                  </button>
                  <button
                    type="submit"
                    disabled={isBusyAction || !newFieldName.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium cursor-pointer"
                  >
                    {isBusyAction ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    <span>Add Index</span>
                  </button>
                  {showIndexOpts && (
                    <div className="w-full pt-2 mt-1 border-t border-[#242732] flex flex-wrap items-center gap-3 text-[11px] text-zinc-300">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={idxOnDisk} onChange={(e) => setIdxOnDisk(e.target.checked)} />
                        <span>on_disk</span>
                      </label>
                      {(newFieldType === 'keyword' || newFieldType === 'integer' || newFieldType === 'uuid') && (
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={idxIsTenant} onChange={(e) => setIdxIsTenant(e.target.checked)} />
                          <span>is_tenant</span>
                        </label>
                      )}
                      {newFieldType === 'integer' && (
                        <>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={idxLookup} onChange={(e) => setIdxLookup(e.target.checked)} />
                            <span>lookup</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={idxRange} onChange={(e) => setIdxRange(e.target.checked)} />
                            <span>range</span>
                          </label>
                        </>
                      )}
                      {newFieldType === 'text' && (
                        <>
                          <select
                            value={idxTokenizer}
                            onChange={(e) => setIdxTokenizer(e.target.value as any)}
                            className="rounded border border-[#2f3240] bg-[#101116] px-2 py-1 text-[11px] font-mono"
                          >
                            <option value="word">tokenizer: word</option>
                            <option value="whitespace">tokenizer: whitespace</option>
                            <option value="prefix">tokenizer: prefix</option>
                            <option value="multilingual">tokenizer: multilingual</option>
                          </select>
                          <input
                            type="number"
                            min={1}
                            placeholder="min_len"
                            value={idxMinTokenLen}
                            onChange={(e) => setIdxMinTokenLen(e.target.value)}
                            className="w-20 rounded border border-[#2f3240] bg-[#101116] px-2 py-1 text-[11px] font-mono"
                          />
                          <input
                            type="number"
                            min={1}
                            placeholder="max_len"
                            value={idxMaxTokenLen}
                            onChange={(e) => setIdxMaxTokenLen(e.target.value)}
                            className="w-20 rounded border border-[#2f3240] bg-[#101116] px-2 py-1 text-[11px] font-mono"
                          />
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={idxLowercase} onChange={(e) => setIdxLowercase(e.target.checked)} />
                            <span>lowercase</span>
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={idxPhraseMatching} onChange={(e) => setIdxPhraseMatching(e.target.checked)} />
                            <span>phrase_matching</span>
                          </label>
                        </>
                      )}
                    </div>
                  )}
                </form>
              )}

              <div className="rounded-lg border border-[#282b36] bg-[#14151b] overflow-hidden">
                {indexes.length === 0 ? (
                  <div className="p-6 text-center text-zinc-500">
                    No payload indexes defined yet. Add an index to enable fast filtering &amp; sorting.
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#252834] bg-[#181a22] text-[10px] uppercase tracking-wider text-zinc-400">
                        <th className="py-2 px-3">Field</th>
                        <th className="py-2 px-3">Type</th>
                        <th className="py-2 px-3">Indexed Points</th>
                        <th className="py-2 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#222530]">
                      {indexes.map((idx) => (
                        <tr key={idx.field} className="hover:bg-white/[0.02]">
                          <td className="py-2 px-3 font-mono text-zinc-100">{idx.field}</td>
                          <td className="py-2 px-3">
                            <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30 font-mono text-[10px]">
                              {idx.dataType}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono text-zinc-400">{idx.points ?? '-'}</td>
                          <td className="py-2 px-3 text-right">
                            {!connection?.isReadOnly && (
                              <button
                                type="button"
                                disabled={isBusyAction}
                                onClick={() => handleDeleteIndex(idx.field)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-rose-400 hover:bg-rose-500/15 cursor-pointer disabled:opacity-40"
                                title="Delete index"
                              >
                                <Trash2 className="h-3 w-3" />
                                <span>Drop</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {activeTab === 'aliases' && (
            <div className="space-y-3">
              {!connection?.isReadOnly && (
                <form
                  onSubmit={handleCreateAlias}
                  className="flex items-end gap-2 p-3 rounded-lg border border-[#282b36] bg-[#14151b]"
                >
                  <div className="flex-1">
                    <label className="block text-[10px] text-zinc-400 mb-1">
                      Alias Name (e.g. prod_docs for zero-downtime swap)
                    </label>
                    <input
                      type="text"
                      value={newAliasName}
                      onChange={(e) => setNewAliasName(e.target.value)}
                      placeholder="e.g. documents_live"
                      className="w-full rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isBusyAction || !newAliasName.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Assign Alias</span>
                  </button>
                </form>
              )}

              {renamingAlias && (
                <form
                  onSubmit={handleRenameAlias}
                  className="flex items-center gap-2 p-2.5 rounded-lg border border-cyan-500/40 bg-cyan-950/20"
                >
                  <span className="font-mono text-zinc-300 text-[11px]">{renamingAlias.oldName} →</span>
                  <input
                    type="text"
                    value={renamingAlias.newName}
                    onChange={(e) => setRenamingAlias({ ...renamingAlias, newName: e.target.value })}
                    className="flex-1 rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1 font-mono text-zinc-100"
                  />
                  <button type="submit" className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-medium cursor-pointer">
                    Rename
                  </button>
                  <button type="button" onClick={() => setRenamingAlias(null)} className="px-2 py-1 rounded bg-[#23252f] text-zinc-300 cursor-pointer">
                    Cancel
                  </button>
                </form>
              )}

              <div className="rounded-lg border border-[#282b36] bg-[#14151b] overflow-hidden">
                {aliases.length === 0 ? (
                  <div className="p-6 text-center text-zinc-500">
                    No aliases point to this collection yet.
                  </div>
                ) : (
                  <div className="divide-y divide-[#222530]">
                    {aliases.map((a) => (
                      <div key={a} className="flex items-center justify-between px-3 py-2">
                        <span className="font-mono text-cyan-300">{a}</span>
                        {!connection?.isReadOnly && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={isBusyAction}
                              onClick={() => setRenamingAlias({ oldName: a, newName: a })}
                              className="px-2 py-0.5 rounded text-cyan-300 hover:bg-cyan-500/15 cursor-pointer"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              disabled={isBusyAction}
                              onClick={() => handleDeleteAlias(a)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-rose-400 hover:bg-rose-500/15 cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>Remove</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'snapshots' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-400">
                  Manage point-in-time Qdrant collection snapshots
                </span>
                {!connection?.isReadOnly && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusyAction}
                      onClick={handleUploadSnapshot}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600/25 hover:bg-blue-600/40 border border-blue-500/40 disabled:opacity-50 text-blue-200 font-medium cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>Upload .snapshot</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusyAction}
                      onClick={handleCreateSnapshot}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium cursor-pointer"
                    >
                      {isBusyAction ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                      <span>Create Snapshot</span>
                    </button>
                  </div>
                )}
              </div>

              {!connection?.isReadOnly && (
                <form
                  onSubmit={handleRecoverSnapshot}
                  className="flex items-center gap-2 p-2.5 rounded-lg border border-[#282b36] bg-[#14151b]"
                >
                  <input
                    type="text"
                    value={recoverUrl}
                    onChange={(e) => setRecoverUrl(e.target.value)}
                    placeholder="Recover from URL or file:///... snapshot path"
                    className="flex-1 rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isBusyAction || !recoverUrl.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-600/80 hover:bg-amber-600 disabled:opacity-50 text-white font-medium cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Recover</span>
                  </button>
                </form>
              )}

              <div className="rounded-lg border border-[#282b36] bg-[#14151b] overflow-hidden">
                {snapshots.length === 0 ? (
                  <div className="p-6 text-center text-zinc-500">
                    No snapshots found for this collection.
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#252834] bg-[#181a22] text-[10px] uppercase tracking-wider text-zinc-400">
                        <th className="py-2 px-3">Snapshot Name</th>
                        <th className="py-2 px-3">Created</th>
                        <th className="py-2 px-3">Size</th>
                        <th className="py-2 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#222530]">
                      {snapshots.map((s) => (
                        <tr key={s.name} className="hover:bg-white/[0.02]">
                          <td className="py-2 px-3 font-mono text-zinc-100 truncate max-w-[240px]" title={s.name}>
                            {s.name}
                          </td>
                          <td className="py-2 px-3 font-mono text-zinc-400 text-[11px]">
                            {s.creation_time ? s.creation_time.replace('T', ' ').slice(0, 19) : '-'}
                          </td>
                          <td className="py-2 px-3 font-mono text-zinc-300">{formatBytes(s.size)}</td>
                          <td className="py-2 px-3 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={isBusyAction}
                                onClick={() => handleDownloadSnapshot(s.name)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-blue-300 hover:bg-blue-500/15 cursor-pointer disabled:opacity-40"
                              >
                                <Download className="h-3 w-3" />
                                <span>Download</span>
                              </button>
                              {!connection?.isReadOnly && (
                                <button
                                  type="button"
                                  disabled={isBusyAction}
                                  onClick={() => handleDeleteSnapshot(s.name)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-rose-400 hover:bg-rose-500/15 cursor-pointer disabled:opacity-40"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  <span>Delete</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {activeTab === 'shards' && (
            <div className="space-y-3">
              {!connection?.isReadOnly && (
                <form
                  onSubmit={handleCreateShardKey}
                  className="flex items-end gap-2 p-3 rounded-lg border border-[#282b36] bg-[#14151b]"
                >
                  <div className="flex-1">
                    <label className="block text-[10px] text-zinc-400 mb-1">
                      Create Shard Key (requires custom sharding_method collection)
                    </label>
                    <input
                      type="text"
                      value={newShardKey}
                      onChange={(e) => setNewShardKey(e.target.value)}
                      placeholder="e.g. tenant_acme"
                      className="w-full rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1.5 text-xs text-zinc-100 font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isBusyAction || !newShardKey.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Shard Key</span>
                  </button>
                </form>
              )}
              <pre className="rounded-lg border border-[#282b36] bg-[#111217] p-3 text-[11px] font-mono text-zinc-300 overflow-auto max-h-80 select-text">
                {clusterInfo ? JSON.stringify(clusterInfo, null, 2) : 'No cluster / shard info available.'}
              </pre>
            </div>
          )}

          {activeTab === 'settings' && (
            <form onSubmit={handlePatchSettings} className="space-y-4">
              <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3 space-y-3">
                <div className="font-semibold text-zinc-200">Optimizers Config</div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">indexing_threshold (KB)</label>
                    <input
                      type="number"
                      min={0}
                      value={indexingThreshold}
                      onChange={(e) => setIndexingThreshold(e.target.value)}
                      className="w-full rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1.5 font-mono text-zinc-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">memmap_threshold (KB)</label>
                    <input
                      type="number"
                      min={0}
                      value={memmapThreshold}
                      onChange={(e) => setMemmapThreshold(e.target.value)}
                      className="w-full rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1.5 font-mono text-zinc-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">vacuum_min_vector_number</label>
                    <input
                      type="number"
                      min={0}
                      value={vacuumMinVectors}
                      onChange={(e) => setVacuumMinVectors(e.target.value)}
                      className="w-full rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1.5 font-mono text-zinc-100"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3 space-y-3">
                <div className="font-semibold text-zinc-200">HNSW Config</div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">m (Max Edges)</label>
                    <input
                      type="number"
                      min={0}
                      value={hnswM}
                      onChange={(e) => setHnswM(e.target.value)}
                      className="w-full rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1.5 font-mono text-zinc-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">ef_construct</label>
                    <input
                      type="number"
                      min={4}
                      value={hnswEfConstruct}
                      onChange={(e) => setHnswEfConstruct(e.target.value)}
                      className="w-full rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1.5 font-mono text-zinc-100"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked={hnswOnDisk} onChange={(e) => setHnswOnDisk(e.target.checked)} />
                  <span>Store HNSW graph on disk</span>
                </label>
              </div>

              <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-zinc-200">Strict Mode Config</div>
                  <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                    <input type="checkbox" checked={strictEnabled} onChange={(e) => setStrictEnabled(e.target.checked)} />
                    <span>Enable Strict Mode</span>
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">max_query_limit</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="unlimited"
                      value={strictMaxLimit}
                      onChange={(e) => setStrictMaxLimit(e.target.value)}
                      className="w-full rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1.5 font-mono text-zinc-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">max_timeout (sec)</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="unlimited"
                      value={strictMaxTimeout}
                      onChange={(e) => setStrictMaxTimeout(e.target.value)}
                      className="w-full rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1.5 font-mono text-zinc-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">search_max_hnsw_ef</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="unlimited"
                      value={strictMaxEf}
                      onChange={(e) => setStrictMaxEf(e.target.value)}
                      className="w-full rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1.5 font-mono text-zinc-100"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={strictAllowUnindexed}
                    onChange={(e) => setStrictAllowUnindexed(e.target.checked)}
                  />
                  <span>Allow unindexed filtering on retrieve</span>
                </label>
              </div>

              {!connection?.isReadOnly && (
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isBusyAction}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium cursor-pointer"
                  >
                    {isBusyAction && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>Apply PATCH Settings</span>
                  </button>
                </div>
              )}
            </form>
          )}

          {activeTab === 'info' && (
            <pre className="rounded-lg border border-[#282b36] bg-[#111217] p-3 text-[11px] font-mono text-emerald-300 overflow-auto max-h-96 select-text">
              {collectionInfo ? JSON.stringify(collectionInfo, null, 2) : 'Loading...'}
            </pre>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-2.5 border-t border-[#272934] bg-[#16171d]">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg border border-[#323542] bg-[#22242d] hover:bg-[#2a2d38] text-zinc-300 text-xs cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
