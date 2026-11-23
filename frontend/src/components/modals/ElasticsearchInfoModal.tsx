import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  Activity,
  RefreshCw,
  Server,
  Tag,
  Camera,
  FileCode,
  Clock,
  AlertTriangle,
  ArrowLeftRight,
  Ban,
} from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';

interface ElasticsearchInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  connectionName: string;
  isReadOnly?: boolean;
  onAliasesChanged?: () => void;
}

export const ElasticsearchInfoModal: React.FC<ElasticsearchInfoModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  connectionName,
  isReadOnly = false,
  onAliasesChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'nodes' | 'aliases' | 'templates' | 'snapshots' | 'tasks'>('overview');
  const [loading, setLoading] = useState(false);

  const [rootInfo, setRootInfo] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [allocExplain, setAllocExplain] = useState<string | null>(null);
  const [nodes, setNodes] = useState<any[]>([]);
  const [aliases, setAliases] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<string[]>([]);
  const [repos, setRepos] = useState<Array<{ name: string; type: string }>>([]);
  const [tasks, setTasks] = useState<Array<{ taskId: string; action: string; runningTime: string; description: string; cancellable: boolean }>>([]);

  // Atomic Alias Swap form
  const [swapAliasName, setSwapAliasName] = useState('');
  const [swapOldIndex, setSwapOldIndex] = useState('');
  const [swapNewIndex, setSwapNewIndex] = useState('');

  const runRest = useCallback(
    async (sql: string) => {
      const res = await QueryService.ExecuteQuery({
        executionId: `es-info-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        connectionId,
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
          const o: Record<string, any> = {};
          cols.forEach((c: any, idx: number) => {
            o[c.name] = r ? r[idx] : null;
          });
          return o;
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
    [connectionId]
  );

  const fetchAll = useCallback(async () => {
    if (!isOpen || !connectionId) return;
    setLoading(true);
    setAllocExplain(null);
    try {
      const [rootR, healthR, nodesR, aliasR, tmplR, pipeR, repoR, taskR] = await Promise.all([
        runRest('GET /').catch(() => null),
        runRest('GET /_cluster/health').catch(() => null),
        runRest('GET /_cat/nodes?format=json&h=name,ip,master,node.role,heap.percent,ram.percent,cpu,load_1m,disk.used_percent').catch(() => []),
        runRest('GET /_cat/aliases?format=json').catch(() => []),
        runRest('GET /_index_template').catch(() => null),
        runRest('GET /_ingest/pipeline').catch(() => null),
        runRest('GET /_snapshot').catch(() => null),
        runRest('GET /_tasks?detailed=true').catch(() => null),
      ]);

      setRootInfo(rootR);
      setHealth(healthR);
      setNodes(Array.isArray(nodesR) ? nodesR : []);
      setAliases(Array.isArray(aliasR) ? aliasR : []);

      const tmplList = Array.isArray(tmplR?.index_templates)
        ? tmplR.index_templates.map((t: any) => ({
            name: t.name,
            patterns: Array.isArray(t.index_template?.index_patterns)
              ? t.index_template.index_patterns.join(', ')
              : '',
            priority: t.index_template?.priority ?? '-',
          }))
        : [];
      setTemplates(tmplList);

      setPipelines(pipeR && typeof pipeR === 'object' ? Object.keys(pipeR) : []);

      const repoList =
        repoR && typeof repoR === 'object' && !Array.isArray(repoR)
          ? Object.entries(repoR).map(([name, cfg]: [string, any]) => ({
              name,
              type: String(cfg?.type || 'fs'),
            }))
          : [];
      setRepos(repoList);

      const parsedTasks: Array<{ taskId: string; action: string; runningTime: string; description: string; cancellable: boolean }> = [];
      if (taskR?.nodes && typeof taskR.nodes === 'object') {
        for (const nodeObj of Object.values(taskR.nodes) as any[]) {
          if (nodeObj?.tasks && typeof nodeObj.tasks === 'object') {
            for (const [tId, tMeta] of Object.entries(nodeObj.tasks) as [string, any][]) {
              const act = String(tMeta?.action || '');
              if (act.includes('monitor') || act.includes('cluster:monitor')) continue;
              const nanos = Number(tMeta?.running_time_in_nanos || 0);
              parsedTasks.push({
                taskId: tId,
                action: act,
                runningTime: nanos > 1e9 ? `${(nanos / 1e9).toFixed(1)}s` : `${Math.round(nanos / 1e6)}ms`,
                description: String(tMeta?.description || ''),
                cancellable: Boolean(tMeta?.cancellable),
              });
            }
          }
        }
      }
      setTasks(parsedTasks);
    } finally {
      setLoading(false);
    }
  }, [isOpen, connectionId, runRest]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('overview');
      fetchAll();
    }
  }, [isOpen, fetchAll]);

  if (!isOpen) return null;

  const handleExplainUnassigned = async () => {
    try {
      const res = await runRest('GET /_cluster/allocation/explain');
      setAllocExplain(typeof res === 'string' ? res : JSON.stringify(res, null, 2));
    } catch (err: any) {
      setAllocExplain(err?.message || String(err));
    }
  };

  const handleSwapAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!swapAliasName.trim() || !swapOldIndex.trim() || !swapNewIndex.trim()) return;
    try {
      const body = JSON.stringify({
        actions: [
          { remove: { index: swapOldIndex.trim(), alias: swapAliasName.trim() } },
          { add: { index: swapNewIndex.trim(), alias: swapAliasName.trim() } },
        ],
      });
      await runRest(`POST /_aliases\n${body}`);
      alertSuccess(
        `Atomically swapped alias "${swapAliasName}" from "${swapOldIndex}" to "${swapNewIndex}".`,
        'Alias Swapped'
      );
      setSwapAliasName('');
      setSwapOldIndex('');
      setSwapNewIndex('');
      await fetchAll();
      onAliasesChanged?.();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Alias Swap Failed');
    }
  };

  const handleCancelTask = async (taskId: string) => {
    const ok = await confirmDialog({
      title: 'Cancel Cluster Task',
      message: `Send cancellation request to running task "${taskId}"?`,
      confirmLabel: 'Cancel Task',
      isDanger: true,
    });
    if (!ok) return;
    try {
      await runRest(`POST /_tasks/${encodeURIComponent(taskId)}/_cancel`);
      alertSuccess(`Cancellation sent for task ${taskId}.`, 'Task Cancelled');
      await fetchAll();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Cancel Task');
    }
  };

  const statusColor =
    health?.status === 'green'
      ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30'
      : health?.status === 'yellow'
      ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
      : health?.status === 'red'
      ? 'text-rose-400 bg-rose-500/15 border-rose-500/30'
      : 'text-zinc-300 bg-zinc-700/30 border-zinc-600/30';

  const distroLabel =
    rootInfo?.version?.distribution === 'opensearch' ? 'OpenSearch' : 'Elasticsearch';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d] shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <span className="font-semibold text-zinc-100 text-sm">{distroLabel} Cluster &amp; Info</span>
            <span className="text-zinc-500 font-mono">— {connectionName}</span>
            {rootInfo?.version?.number && (
              <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 font-mono text-[10px]">
                v{rootInfo.version.number}
              </span>
            )}
            {health?.status && (
              <span className={`px-2 py-0.5 rounded border font-mono text-[10px] uppercase font-bold ${statusColor}`}>
                {health.status}
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
        <div className="flex items-center gap-1 px-4 pt-2 border-b border-[#272934] bg-[#16171d] overflow-x-auto">
          {(
            [
              { id: 'overview', label: 'Cluster Health', icon: Activity },
              { id: 'nodes', label: `Nodes (${nodes.length})`, icon: Server },
              { id: 'aliases', label: `Aliases (${aliases.length})`, icon: Tag },
              { id: 'templates', label: `Templates & Pipelines`, icon: FileCode },
              { id: 'snapshots', label: `Snapshots (${repos.length})`, icon: Camera },
              { id: 'tasks', label: `Running Tasks (${tasks.length})`, icon: Clock },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'overview' && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2.5">
                <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                  <div className="text-[10px] text-zinc-500">Cluster Name</div>
                  <div className="font-mono text-sm font-semibold text-zinc-100 mt-0.5 truncate">
                    {health?.cluster_name || rootInfo?.cluster_name || '-'}
                  </div>
                </div>
                <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                  <div className="text-[10px] text-zinc-500">Engine &amp; Lucene</div>
                  <div className="font-mono text-xs font-semibold text-zinc-200 mt-0.5">
                    {distroLabel} {rootInfo?.version?.number || ''} (Lucene {rootInfo?.version?.lucene_version || '-'})
                  </div>
                </div>
                <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                  <div className="text-[10px] text-zinc-500">Nodes / Data Nodes</div>
                  <div className="font-mono text-sm font-semibold text-emerald-300 mt-0.5">
                    {health?.number_of_nodes ?? '-'} / {health?.number_of_data_nodes ?? '-'}
                  </div>
                </div>
                <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                  <div className="text-[10px] text-zinc-500">Active Shards %</div>
                  <div className="font-mono text-sm font-semibold text-blue-300 mt-0.5">
                    {health?.active_shards_percent_as_number != null
                      ? `${Number(health.active_shards_percent_as_number).toFixed(1)}%`
                      : '-'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2.5">
                <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                  <div className="text-[10px] text-zinc-500">Active Primary Shards</div>
                  <div className="font-mono text-sm font-semibold text-zinc-100 mt-0.5">
                    {health?.active_primary_shards ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                  <div className="text-[10px] text-zinc-500">Total Active Shards</div>
                  <div className="font-mono text-sm font-semibold text-zinc-100 mt-0.5">
                    {health?.active_shards ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                  <div className="text-[10px] text-zinc-500">Relocating / Initializing</div>
                  <div className="font-mono text-sm font-semibold text-zinc-100 mt-0.5">
                    {health?.relocating_shards ?? 0} / {health?.initializing_shards ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-[#282b36] bg-[#14151b] p-3">
                  <div className="text-[10px] text-zinc-500">Unassigned Shards</div>
                  <div
                    className={`font-mono text-sm font-semibold mt-0.5 ${
                      (health?.unassigned_shards ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {health?.unassigned_shards ?? 0}
                  </div>
                </div>
              </div>

              {(health?.unassigned_shards ?? 0) > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-300 font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      <span>{health.unassigned_shards} unassigned shard(s) detected in cluster</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleExplainUnassigned}
                      className="px-2.5 py-1 rounded bg-amber-600/30 hover:bg-amber-600/40 text-amber-200 border border-amber-500/40 text-[11px] font-medium cursor-pointer"
                    >
                      Explain Unassigned Shards
                    </button>
                  </div>
                  {allocExplain && (
                    <pre className="max-h-48 overflow-auto rounded bg-[#101116] p-2.5 font-mono text-[11px] text-amber-200 whitespace-pre-wrap">
                      {allocExplain}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'nodes' && (
            <div className="rounded-lg border border-[#282b36] overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#14151b] text-zinc-400 border-b border-[#282b36] text-[11px]">
                  <tr>
                    <th className="py-2 px-3">Node Name</th>
                    <th className="py-2 px-3">IP</th>
                    <th className="py-2 px-3">Roles</th>
                    <th className="py-2 px-3">Heap %</th>
                    <th className="py-2 px-3">RAM %</th>
                    <th className="py-2 px-3">CPU %</th>
                    <th className="py-2 px-3">Disk %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#232630] font-mono text-[11px]">
                  {nodes.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-zinc-500 font-sans">
                        No node telemetry available
                      </td>
                    </tr>
                  ) : (
                    nodes.map((n, i) => (
                      <tr key={i} className="hover:bg-[#222530]/60">
                        <td className="py-2 px-3 text-zinc-100 font-semibold">
                          {n.name} {n.master === '*' && <span className="text-amber-400">★</span>}
                        </td>
                        <td className="py-2 px-3 text-zinc-400">{n.ip}</td>
                        <td className="py-2 px-3 text-blue-300">{n['node.role'] || '-'}</td>
                        <td className="py-2 px-3">{n['heap.percent'] ? `${n['heap.percent']}%` : '-'}</td>
                        <td className="py-2 px-3">{n['ram.percent'] ? `${n['ram.percent']}%` : '-'}</td>
                        <td className="py-2 px-3">{n.cpu ? `${n.cpu}%` : '-'}</td>
                        <td className="py-2 px-3">{n['disk.used_percent'] ? `${n['disk.used_percent']}%` : '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'aliases' && (
            <div className="space-y-4">
              {!isReadOnly && (
                <form
                  onSubmit={handleSwapAlias}
                  className="rounded-lg border border-[#282b36] bg-[#14151b] p-3 space-y-2"
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-200">
                    <ArrowLeftRight className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Zero-Downtime Atomic Alias Swap (POST /_aliases)</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <input
                      type="text"
                      placeholder="Alias name"
                      value={swapAliasName}
                      onChange={(e) => setSwapAliasName(e.target.value)}
                      className="rounded bg-[#1b1c22] border border-[#2d303d] px-2.5 py-1.5 text-zinc-100 font-mono"
                    />
                    <input
                      type="text"
                      placeholder="From old index"
                      value={swapOldIndex}
                      onChange={(e) => setSwapOldIndex(e.target.value)}
                      className="rounded bg-[#1b1c22] border border-[#2d303d] px-2.5 py-1.5 text-zinc-100 font-mono"
                    />
                    <input
                      type="text"
                      placeholder="To new index"
                      value={swapNewIndex}
                      onChange={(e) => setSwapNewIndex(e.target.value)}
                      className="rounded bg-[#1b1c22] border border-[#2d303d] px-2.5 py-1.5 text-zinc-100 font-mono"
                    />
                    <button
                      type="submit"
                      disabled={!swapAliasName.trim() || !swapOldIndex.trim() || !swapNewIndex.trim()}
                      className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer disabled:opacity-50"
                    >
                      Swap Alias Target
                    </button>
                  </div>
                </form>
              )}

              <div className="rounded-lg border border-[#282b36] overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[#14151b] text-zinc-400 border-b border-[#282b36] text-[11px]">
                    <tr>
                      <th className="py-2 px-3">Alias</th>
                      <th className="py-2 px-3">Target Index</th>
                      <th className="py-2 px-3">Write Index</th>
                      <th className="py-2 px-3">Routing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#232630] font-mono text-[11px]">
                    {aliases.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-zinc-500 font-sans">
                          No cluster aliases found
                        </td>
                      </tr>
                    ) : (
                      aliases.map((a, idx) => (
                        <tr key={idx} className="hover:bg-[#222530]/60">
                          <td className="py-2 px-3 text-cyan-300 font-semibold">{a.alias}</td>
                          <td className="py-2 px-3 text-zinc-200">{a.index}</td>
                          <td className="py-2 px-3">{a['is_write_index'] || '-'}</td>
                          <td className="py-2 px-3 text-zinc-400">{a['routing.index'] || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="space-y-4">
              <div>
                <div className="text-[11px] font-semibold text-zinc-300 mb-2">
                  Index Templates ({templates.length})
                </div>
                <div className="rounded-lg border border-[#282b36] overflow-hidden max-h-52 overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[#14151b] text-zinc-400 border-b border-[#282b36] text-[11px]">
                      <tr>
                        <th className="py-2 px-3">Template Name</th>
                        <th className="py-2 px-3">Index Patterns</th>
                        <th className="py-2 px-3">Priority</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#232630] font-mono text-[11px]">
                      {templates.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-4 text-center text-zinc-500 font-sans">
                            No index templates found
                          </td>
                        </tr>
                      ) : (
                        templates.map((t) => (
                          <tr key={t.name} className="hover:bg-[#222530]/60">
                            <td className="py-1.5 px-3 text-zinc-100">{t.name}</td>
                            <td className="py-1.5 px-3 text-amber-300">{t.patterns}</td>
                            <td className="py-1.5 px-3 text-zinc-400">{t.priority}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-zinc-300 mb-2">
                  Ingest Pipelines ({pipelines.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pipelines.length === 0 ? (
                    <span className="text-zinc-500 italic">No ingest pipelines registered</span>
                  ) : (
                    pipelines.map((p) => (
                      <span
                        key={p}
                        className="px-2 py-1 rounded bg-[#14151b] border border-[#282b36] font-mono text-[11px] text-zinc-300"
                      >
                        {p}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'snapshots' && (
            <div className="space-y-3">
              <div className="text-[11px] text-zinc-400">
                Registered Snapshot Repositories (<code className="text-blue-300">GET /_snapshot</code>)
              </div>
              <div className="rounded-lg border border-[#282b36] overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[#14151b] text-zinc-400 border-b border-[#282b36] text-[11px]">
                    <tr>
                      <th className="py-2 px-3">Repository Name</th>
                      <th className="py-2 px-3">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#232630] font-mono text-[11px]">
                    {repos.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="py-6 text-center text-zinc-500 font-sans">
                          No snapshot repositories registered on this cluster
                        </td>
                      </tr>
                    ) : (
                      repos.map((r) => (
                        <tr key={r.name} className="hover:bg-[#222530]/60">
                          <td className="py-2 px-3 text-zinc-100 font-medium">{r.name}</td>
                          <td className="py-2 px-3 text-amber-300">{r.type}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="rounded-lg border border-[#282b36] overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#14151b] text-zinc-400 border-b border-[#282b36] text-[11px]">
                  <tr>
                    <th className="py-2 px-3">Task ID</th>
                    <th className="py-2 px-3">Action</th>
                    <th className="py-2 px-3">Duration</th>
                    <th className="py-2 px-3">Description</th>
                    <th className="py-2 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#232630] font-mono text-[11px]">
                  {tasks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-zinc-500 font-sans">
                        No active long-running tasks
                      </td>
                    </tr>
                  ) : (
                    tasks.map((t) => (
                      <tr key={t.taskId} className="hover:bg-[#222530]/60">
                        <td className="py-2 px-3 text-zinc-300">{t.taskId}</td>
                        <td className="py-2 px-3 text-blue-300">{t.action}</td>
                        <td className="py-2 px-3 text-amber-300">{t.runningTime}</td>
                        <td className="py-2 px-3 text-zinc-400 truncate max-w-xs" title={t.description}>
                          {t.description || '-'}
                        </td>
                        <td className="py-2 px-3 text-right">
                          {t.cancellable && !isReadOnly && (
                            <button
                              type="button"
                              onClick={() => handleCancelTask(t.taskId)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-[10px] cursor-pointer"
                            >
                              <Ban className="h-3 w-3" />
                              <span>Cancel</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
