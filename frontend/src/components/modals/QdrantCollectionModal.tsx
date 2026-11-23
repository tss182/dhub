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
} from 'lucide-react';
import { ConnectionConfig } from '../../types/domain';
import { QueryService, SchemaService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';
import { useConnectionStore } from '../../stores/useConnectionStore';

type PayloadFieldType = 'keyword' | 'integer' | 'float' | 'bool' | 'datetime' | 'text' | 'geo';

const PAYLOAD_FIELD_TYPES: PayloadFieldType[] = [
  'keyword',
  'integer',
  'float',
  'bool',
  'datetime',
  'text',
  'geo',
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
  const [activeTab, setActiveTab] = useState<'indexes' | 'snapshots' | 'info'>('indexes');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collectionInfo, setCollectionInfo] = useState<any>(null);
  const [indexes, setIndexes] = useState<PayloadIndexEntry[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);

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
      const [infoRes, snapRes] = await Promise.all([
        runQdrantRest(`GET /collections/${encodeURIComponent(collectionName)}`),
        runQdrantRest(`GET /collections/${encodeURIComponent(collectionName)}/snapshots`).catch(() => null),
      ]);

      const info = infoRes?.result ?? infoRes ?? {};
      setCollectionInfo(info);

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
      const body = JSON.stringify({ field_name: field, field_schema: newFieldType });
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
                    type="submit"
                    disabled={isBusyAction || !newFieldName.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium cursor-pointer"
                  >
                    {isBusyAction ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    <span>Add Index</span>
                  </button>
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

          {activeTab === 'snapshots' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-400">
                  Manage point-in-time Qdrant collection snapshots
                </span>
                {!connection?.isReadOnly && (
                  <button
                    type="button"
                    disabled={isBusyAction}
                    onClick={handleCreateSnapshot}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium cursor-pointer"
                  >
                    {isBusyAction ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                    <span>Create Snapshot</span>
                  </button>
                )}
              </div>

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
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
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
