import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  Activity,
  RefreshCw,
  Server,
  Tag,
  Camera,
  AlertTriangle,
  Plus,
  Loader2,
  Download,
} from 'lucide-react';
import { Dialogs } from '@wailsio/runtime';
import { QueryService, SchemaService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess } from '../../stores/useAlertStore';

interface QdrantInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  connectionName: string;
}

export const QdrantInfoModal: React.FC<QdrantInfoModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  connectionName,
}) => {
  const [activeTab, setActiveTab] = useState<'cluster' | 'aliases' | 'snapshots' | 'telemetry'>('cluster');
  const [loading, setLoading] = useState(false);
  const [rootInfo, setRootInfo] = useState<any>(null);
  const [clusterInfo, setClusterInfo] = useState<any>(null);
  const [aliases, setAliases] = useState<Array<{ alias_name: string; collection_name: string }>>([]);
  const [snapshots, setSnapshots] = useState<Array<{ name: string; creation_time?: string; size?: number }>>([]);
  const [telemetry, setTelemetry] = useState<any>(null);
  const [issues, setIssues] = useState<any>(null);
  const [locks, setLocks] = useState<any>(null);
  const [creatingSnap, setCreatingSnap] = useState(false);
  const [downloadingSnap, setDownloadingSnap] = useState<string | null>(null);
  const [swapAlias, setSwapAlias] = useState<{ alias: string; target: string } | null>(null);

  const runRest = useCallback(
    async (sql: string) => {
      const res = await QueryService.ExecuteQuery({
        executionId: `qdrant-info-${Date.now()}`,
        connectionId,
        database: 'default',
        schema: 'default',
        sql,
        limit: 100,
        offset: 0,
      } as any);
      if (res?.error) throw new Error(res.error);
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
    [connectionId]
  );

  const fetchAll = useCallback(async () => {
    if (!isOpen || !connectionId) return;
    setLoading(true);
    try {
      const [rootR, clusterR, aliasR, snapR, telR, issR, lockR] = await Promise.all([
        runRest('GET /').catch(() => null),
        runRest('GET /cluster').catch(() => null),
        runRest('GET /aliases').catch(() => null),
        runRest('GET /snapshots').catch(() => null),
        runRest('GET /telemetry').catch(() => null),
        runRest('GET /issues').catch(() => null),
        runRest('GET /locks').catch(() => null),
      ]);
      setRootInfo(rootR);
      setClusterInfo(clusterR?.result ?? clusterR);
      setAliases(Array.isArray(aliasR?.result?.aliases) ? aliasR.result.aliases : []);
      setSnapshots(Array.isArray(snapR?.result) ? snapR.result : []);
      setTelemetry(telR?.result ?? telR);
      setIssues(issR?.result ?? issR);
      setLocks(lockR?.result ?? lockR);
    } finally {
      setLoading(false);
    }
  }, [isOpen, connectionId, runRest]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('cluster');
      fetchAll();
    }
  }, [isOpen, fetchAll]);

  if (!isOpen) return null;

  const handleCreateFullSnapshot = async () => {
    setCreatingSnap(true);
    try {
      await runRest('POST /snapshots?wait=true');
      alertSuccess('Full storage snapshot created.', 'Snapshot Created');
      await fetchAll();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Snapshot Failed');
    } finally {
      setCreatingSnap(false);
    }
  };

  const handleDownloadFullSnapshot = async (snapName: string) => {
    try {
      const savePath = await Dialogs.SaveFile({
        Title: 'Save Full Qdrant Snapshot',
        Filename: snapName,
        CanCreateDirectories: true,
        Filters: [{ DisplayName: 'Snapshot Files (*.snapshot)', Pattern: '*.snapshot' }],
      });
      if (!savePath || typeof savePath !== 'string') return;
      setDownloadingSnap(snapName);
      const bytes = await SchemaService.DownloadQdrantSnapshot(connectionId, '', snapName, savePath);
      alertSuccess(`Saved snapshot (${(bytes / (1024 * 1024)).toFixed(2)} MB) to ${savePath}`, 'Download Complete');
    } catch (err: any) {
      alertError(err?.message || String(err), 'Download Failed');
    } finally {
      setDownloadingSnap(null);
    }
  };

  const handleSwapAliasTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!swapAlias || !swapAlias.target.trim()) return;
    try {
      const body = JSON.stringify({
        actions: [{ create_alias: { alias_name: swapAlias.alias, collection_name: swapAlias.target.trim() } }],
      });
      await runRest(`POST /collections/aliases\n${body}`);
      alertSuccess(`Alias "${swapAlias.alias}" switched to "${swapAlias.target.trim()}".`, 'Alias Swapped');
      setSwapAlias(null);
      await fetchAll();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Alias Swap Failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden text-xs">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d] shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-rose-400" />
            <span className="font-semibold text-zinc-100 text-sm">Qdrant Server &amp; Cluster</span>
            <span className="text-zinc-500 font-mono">— {connectionName}</span>
            {rootInfo?.version && (
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[10px]">
                v{rootInfo.version}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={fetchAll}
              disabled={loading}
              className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-[#252834] cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
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
              { id: 'cluster', label: 'Cluster & Version', icon: Server },
              { id: 'aliases', label: `Aliases (${aliases.length})`, icon: Tag },
              { id: 'snapshots', label: `Full Snapshots (${snapshots.length})`, icon: Camera },
              { id: 'telemetry', label: 'Telemetry & Issues', icon: AlertTriangle },
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

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {activeTab === 'cluster' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                  <div className="text-[10px] text-zinc-500">Version</div>
                  <div className="font-mono text-sm font-semibold text-zinc-100 mt-0.5">
                    {rootInfo?.version || '-'}
                  </div>
                </div>
                <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                  <div className="text-[10px] text-zinc-500">Cluster Status</div>
                  <div className="font-mono text-sm font-semibold text-emerald-300 mt-0.5">
                    {clusterInfo?.status || 'disabled (single node)'}
                  </div>
                </div>
                <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                  <div className="text-[10px] text-zinc-500">Peer ID</div>
                  <div className="font-mono text-xs text-zinc-200 mt-0.5 truncate">
                    {clusterInfo?.peer_id ?? '-'}
                  </div>
                </div>
              </div>
              <pre className="rounded-lg border border-[#282b36] bg-[#111217] p-3 text-[11px] font-mono text-zinc-300 overflow-auto max-h-80 select-text">
                {JSON.stringify({ server: rootInfo, cluster: clusterInfo, locks }, null, 2)}
              </pre>
            </div>
          )}

          {activeTab === 'aliases' && (
            <div className="space-y-3">
              {swapAlias && (
                <form
                  onSubmit={handleSwapAliasTarget}
                  className="flex items-center gap-2 p-2.5 rounded-lg border border-cyan-500/40 bg-cyan-950/20"
                >
                  <span className="font-mono text-cyan-300 shrink-0">{swapAlias.alias} →</span>
                  <input
                    type="text"
                    value={swapAlias.target}
                    onChange={(e) => setSwapAlias({ ...swapAlias, target: e.target.value })}
                    placeholder="New target collection name"
                    className="flex-1 rounded border border-[#2f3240] bg-[#101116] px-2.5 py-1 font-mono text-zinc-100"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-medium cursor-pointer"
                  >
                    Atomic Swap
                  </button>
                  <button
                    type="button"
                    onClick={() => setSwapAlias(null)}
                    className="px-2 py-1 rounded bg-[#23252f] text-zinc-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                </form>
              )}
              <div className="rounded-lg border border-[#282b36] bg-[#14151b] overflow-hidden">
                {aliases.length === 0 ? (
                  <div className="p-6 text-center text-zinc-500">No collection aliases configured.</div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#252834] bg-[#181a22] text-[10px] uppercase text-zinc-400">
                        <th className="py-2 px-3">Alias Name</th>
                        <th className="py-2 px-3">Target Collection</th>
                        <th className="py-2 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#222530]">
                      {aliases.map((a) => (
                        <tr key={a.alias_name}>
                          <td className="py-2 px-3 font-mono text-cyan-300">{a.alias_name}</td>
                          <td className="py-2 px-3 font-mono text-zinc-200">{a.collection_name}</td>
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => setSwapAlias({ alias: a.alias_name, target: a.collection_name })}
                              className="px-2 py-0.5 rounded bg-cyan-600/20 hover:bg-cyan-600/35 text-cyan-300 border border-cyan-500/30 text-[10px] cursor-pointer"
                            >
                              Switch Target
                            </button>
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
                <span className="text-zinc-400">Full instance storage snapshots</span>
                <button
                  type="button"
                  disabled={creatingSnap}
                  onClick={handleCreateFullSnapshot}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium cursor-pointer"
                >
                  {creatingSnap ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  <span>Create Full Snapshot</span>
                </button>
              </div>
              <div className="rounded-lg border border-[#282b36] bg-[#14151b] overflow-hidden">
                {snapshots.length === 0 ? (
                  <div className="p-6 text-center text-zinc-500">No full storage snapshots found.</div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#252834] bg-[#181a22] text-[10px] uppercase text-zinc-400">
                        <th className="py-2 px-3">Snapshot Name</th>
                        <th className="py-2 px-3">Created</th>
                        <th className="py-2 px-3">Size</th>
                        <th className="py-2 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#222530]">
                      {snapshots.map((s) => (
                        <tr key={s.name}>
                          <td className="py-2 px-3 font-mono text-zinc-100">{s.name}</td>
                          <td className="py-2 px-3 font-mono text-zinc-400">{s.creation_time || '-'}</td>
                          <td className="py-2 px-3 font-mono text-zinc-300">
                            {s.size ? `${(s.size / (1024 * 1024)).toFixed(2)} MB` : '-'}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              disabled={downloadingSnap === s.name}
                              onClick={() => handleDownloadFullSnapshot(s.name)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-600/20 hover:bg-blue-600/35 text-blue-300 border border-blue-500/30 text-[10px] cursor-pointer disabled:opacity-50"
                            >
                              {downloadingSnap === s.name ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                              <span>Download</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {activeTab === 'telemetry' && (
            <div className="space-y-3">
              {issues && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3">
                  <div className="text-[11px] font-semibold text-amber-300 mb-1">Issues</div>
                  <pre className="text-[11px] font-mono text-zinc-300 overflow-auto max-h-32 select-text">
                    {JSON.stringify(issues, null, 2)}
                  </pre>
                </div>
              )}
              <pre className="rounded-lg border border-[#282b36] bg-[#111217] p-3 text-[11px] font-mono text-emerald-300 overflow-auto max-h-96 select-text">
                {JSON.stringify(telemetry, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
