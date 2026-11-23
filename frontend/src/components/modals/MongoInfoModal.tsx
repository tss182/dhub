import React, { useState, useEffect, useCallback } from 'react';
import { X, Server, RefreshCw, Database, GitFork, Cpu, Loader2 } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';

interface MongoInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  connectionName: string;
}

type InfoTab = 'server' | 'databases' | 'replica' | 'shards';

export const MongoInfoModal: React.FC<MongoInfoModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  connectionName,
}) => {
  const [activeTab, setActiveTab] = useState<InfoTab>('server');
  const [loading, setLoading] = useState(false);
  const [serverStatus, setServerStatus] = useState<Record<string, any> | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [databases, setDatabases] = useState<any[]>([]);
  const [replicaStatus, setReplicaStatus] = useState<Record<string, any> | null>(null);
  const [replicaError, setReplicaError] = useState<string | null>(null);
  const [shardsData, setShardsData] = useState<any>(null);

  const execMql = useCallback(
    async (db: string, sql: string) => {
      return QueryService.ExecuteQuery({
        executionId: 'mongo-info-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        connectionId,
        database: db,
        schema: db,
        sql,
        limit: 200,
        offset: 0,
      } as any);
    },
    [connectionId]
  );

  const rowToObj = (res: any): Record<string, any> | null => {
    if (!res?.rows?.length || !res?.columns?.length) return null;
    const obj: Record<string, any> = {};
    const row = res.rows[0] || [];
    res.columns.forEach((c: any, i: number) => {
      const val = row[i];
      if (typeof val === 'string' && (val.trim().startsWith('{') || val.trim().startsWith('['))) {
        try {
          obj[c.name] = JSON.parse(val);
          return;
        } catch {}
      }
      obj[c.name] = val;
    });
    return obj;
  };

  const loadAll = useCallback(async () => {
    if (!isOpen || !connectionId) return;
    setLoading(true);
    setServerError(null);
    setReplicaError(null);

    try {
      const [statusRes, dbsRes, rsRes, shRes] = await Promise.allSettled([
        execMql('admin', 'db.serverStatus();'),
        execMql('admin', 'show dbs;'),
        execMql('admin', 'rs.status();'),
        execMql('config', 'sh.status();'),
      ]);

      if (statusRes.status === 'fulfilled') {
        setServerStatus(rowToObj(statusRes.value));
      } else {
        setServerError(statusRes.reason?.message || 'Unable to read serverStatus (may require admin privileges).');
      }

      if (dbsRes.status === 'fulfilled' && dbsRes.value?.rows && dbsRes.value?.columns) {
        const cols = dbsRes.value.columns;
        setDatabases(
          dbsRes.value.rows.map((r: any[] | null) => {
            const item: Record<string, any> = {};
            cols.forEach((c: any, i: number) => {
              item[c.name] = r?.[i];
            });
            return item;
          })
        );
      }

      if (rsRes.status === 'fulfilled') {
        setReplicaStatus(rowToObj(rsRes.value));
      } else {
        setReplicaError(rsRes.reason?.message || 'Not running with --replSet or insufficient permissions.');
      }

      if (shRes.status === 'fulfilled') {
        setShardsData(rowToObj(shRes.value));
      }
    } finally {
      setLoading(false);
    }
  }, [isOpen, connectionId, execMql]);

  useEffect(() => {
    if (isOpen) {
      loadAll();
    }
  }, [isOpen, loadAll]);

  if (!isOpen) return null;

  const conns = serverStatus?.connections || {};
  const ops = serverStatus?.opcounters || {};
  const mem = serverStatus?.mem || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-4xl rounded-xl border border-[#282b36] bg-[#14161d] shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#222530]">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-100">
              MongoDB Cluster &amp; Server Info — {connectionName}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadAll}
              className="p-1.5 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex border-b border-[#222530] bg-[#101218] px-3 gap-1 text-xs">
          {[
            { id: 'server', label: 'Server Status', icon: Cpu },
            { id: 'databases', label: `Databases (${databases.length})`, icon: Database },
            { id: 'replica', label: 'Replica Set', icon: GitFork },
            { id: 'shards', label: 'Sharding', icon: Server },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id as InfoTab)}
                className={`inline-flex items-center gap-1.5 px-3 py-2.5 border-b-2 transition-colors cursor-pointer ${
                  activeTab === t.id
                    ? 'border-emerald-400 text-emerald-300 font-medium'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="p-4 flex-1 overflow-y-auto text-xs space-y-4">
          {loading && !serverStatus && (
            <div className="flex items-center justify-center py-10 text-zinc-400 gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading MongoDB diagnostics...
            </div>
          )}

          {activeTab === 'server' && (
            <div className="space-y-4">
              {serverError && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300">
                  {serverError}
                </div>
              )}
              {serverStatus && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Version', val: serverStatus.version || '—' },
                      { label: 'Host', val: serverStatus.host || '—' },
                      { label: 'Uptime', val: serverStatus.uptime ? `${Math.round(Number(serverStatus.uptime) / 60)} min` : '—' },
                      { label: 'Storage Engine', val: serverStatus.storageEngine?.name || 'wiredTiger' },
                      { label: 'Connections (Current)', val: conns.current ?? '—' },
                      { label: 'Connections (Available)', val: conns.available ?? '—' },
                      { label: 'Resident Memory', val: mem.resident !== undefined ? `${mem.resident} MB` : '—' },
                      { label: 'Virtual Memory', val: mem.virtual !== undefined ? `${mem.virtual} MB` : '—' },
                    ].map((k) => (
                      <div key={k.label} className="rounded-lg border border-[#242733] bg-[#0e1015] p-3">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">{k.label}</div>
                        <div className="text-sm font-mono font-semibold text-zinc-100 mt-1 truncate">{String(k.val)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-[#242733] bg-[#0e1015] p-3">
                    <div className="text-xs font-semibold text-zinc-300 mb-2">Opcounters</div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 font-mono">
                      {['insert', 'query', 'update', 'delete', 'getmore', 'command'].map((op) => (
                        <div key={op} className="rounded bg-[#151821] px-2.5 py-2 border border-[#222532]">
                          <div className="text-[10px] text-zinc-500 uppercase">{op}</div>
                          <div className="text-emerald-300 font-semibold mt-0.5">{ops[op] ?? 0}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'databases' && (
            <div className="rounded-lg border border-[#242733] overflow-hidden">
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="bg-[#181a22] text-zinc-400 border-b border-[#242733]">
                  <tr>
                    <th className="px-3 py-2">Database</th>
                    <th className="px-3 py-2">Size on Disk</th>
                    <th className="px-3 py-2">Empty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1f222c]">
                  {databases.map((db, i) => (
                    <tr key={i} className="hover:bg-[#181b24]">
                      <td className="px-3 py-2 text-emerald-300 font-semibold">{db.name}</td>
                      <td className="px-3 py-2 text-zinc-200">
                        {db.sizeOnDisk !== undefined ? `${(Number(db.sizeOnDisk) / (1024 * 1024)).toFixed(2)} MB` : '—'}
                      </td>
                      <td className="px-3 py-2 text-zinc-400">{String(db.empty ?? false)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'replica' && (
            <div className="space-y-3">
              {replicaError && (
                <div className="rounded-lg border border-zinc-700 bg-[#101218] p-3 text-zinc-400">
                  {replicaError}
                </div>
              )}
              {replicaStatus && (
                <pre className="rounded-lg border border-[#242733] bg-[#0b0c10] p-3 font-mono text-[11px] text-emerald-300 overflow-x-auto">
                  {JSON.stringify(replicaStatus, null, 2)}
                </pre>
              )}
            </div>
          )}

          {activeTab === 'shards' && (
            <div>
              {shardsData ? (
                <pre className="rounded-lg border border-[#242733] bg-[#0b0c10] p-3 font-mono text-[11px] text-zinc-200 overflow-x-auto">
                  {JSON.stringify(shardsData, null, 2)}
                </pre>
              ) : (
                <div className="text-zinc-500 py-6 text-center">
                  No shards detected (standalone or unsharded deployment).
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end px-4 py-3 border-t border-[#222530]">
          <button type="button" onClick={onClose} className="px-3.5 py-1.5 rounded-md text-xs bg-[#1e212b] hover:bg-[#282c3a] text-zinc-200 cursor-pointer">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
