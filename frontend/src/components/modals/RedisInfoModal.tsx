import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  RefreshCw,
  Activity,
  HardDrive,
  Users,
  Zap,
  Server,
  Database,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError } from '../../stores/useAlertStore';

interface RedisInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  connectionName: string;
}

export const RedisInfoModal: React.FC<RedisInfoModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  connectionName,
}) => {
  const [loading, setLoading] = useState(false);
  const [infoMap, setInfoMap] = useState<Record<string, Record<string, string>>>({});
  const [selectedSection, setSelectedSection] = useState<string>('Overview');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchInfo = async () => {
    if (!connectionId) return;
    setLoading(true);
    try {
      const res = await QueryService.ExecuteQuery({
        executionId: 'info-' + Date.now(),
        connectionId,
        database: 'db0',
        sql: 'INFO',
        limit: 1000,
        offset: 0,
      } as any);

      if (res?.error) {
        alertError(`Failed to fetch Redis info: ${res.error}`);
        return;
      }

      // Parse structured or raw info
      const sections: Record<string, Record<string, string>> = {};
      if (res?.rows && res.rows.length > 0) {
        // If driver returned Section, Property, Value
        if (res.columns && res.columns.length === 3) {
          res.rows.forEach(([section, prop, val]: any) => {
            const sec = String(section || 'General');
            if (!sections[sec]) sections[sec] = {};
            sections[sec][String(prop)] = String(val);
          });
        } else {
          // Parse from single raw string result
          const raw = String(res.rows[0]?.[0] || '');
          let curSec = 'General';
          raw.split('\n').forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            if (trimmed.startsWith('#')) {
              curSec = trimmed.replace('#', '').trim();
              return;
            }
            const idx = trimmed.indexOf(':');
            if (idx !== -1) {
              const k = trimmed.slice(0, idx).trim();
              const v = trimmed.slice(idx + 1).trim();
              if (!sections[curSec]) sections[curSec] = {};
              sections[curSec][k] = v;
            }
          });
        }
      }
      setInfoMap(sections);
    } catch (e: any) {
      alertError(e?.message || 'Error fetching Redis INFO');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchInfo();
    }
  }, [isOpen, connectionId]);

  // Key stats extraction
  const stats = useMemo(() => {
    const server = infoMap['Server'] || {};
    const memory = infoMap['Memory'] || {};
    const clients = infoMap['Clients'] || {};
    const stat = infoMap['Stats'] || {};
    const keyspace = infoMap['Keyspace'] || {};

    let totalKeys = 0;
    const dbKeysList: { db: string; keys: string; expires: string }[] = [];
    Object.entries(keyspace).forEach(([db, val]) => {
      const kMatch = val.match(/keys=(\d+)/);
      const eMatch = val.match(/expires=(\d+)/);
      const kCount = kMatch ? parseInt(kMatch[1], 10) : 0;
      totalKeys += kCount;
      dbKeysList.push({
        db,
        keys: kMatch ? kMatch[1] : '0',
        expires: eMatch ? eMatch[1] : '0',
      });
    });

    const uptimeSec = parseInt(server['uptime_in_seconds'] || '0', 10);
    const uptimeStr =
      uptimeSec > 86400
        ? `${Math.floor(uptimeSec / 86400)}d ${Math.floor((uptimeSec % 86400) / 3600)}h`
        : `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;

    return {
      version: server['redis_version'] || 'Unknown',
      mode: server['redis_mode'] || 'standalone',
      os: server['os'] || 'Linux',
      uptime: uptimeStr,
      port: server['tcp_port'] || '6379',
      usedMemory: memory['used_memory_human'] || '0B',
      peakMemory: memory['used_memory_peak_human'] || '0B',
      connectedClients: clients['connected_clients'] || '0',
      blockedClients: clients['blocked_clients'] || '0',
      opsPerSec: stat['instantaneous_ops_per_sec'] || '0',
      totalCommands: stat['total_commands_processed'] || '0',
      totalKeys,
      dbKeysList,
    };
  }, [infoMap]);

  if (!isOpen) return null;

  const sectionList = ['Overview', ...Object.keys(infoMap)];

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-4xl h-[85vh] rounded-xl border border-[#2b2e3a] bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#272932] px-5 py-3.5 bg-[#1e2029]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/15 text-red-400">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <span>Redis Server Info & Stats</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-500/15 text-red-300 font-semibold border border-red-500/30">
                  v{stats.version}
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400 font-mono">
                Connection: {connectionName} ({stats.mode}, port {stats.port})
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchInfo}
              disabled={loading}
              className="p-1.5 rounded-lg border border-[#2b2e3a] bg-[#14151b] hover:bg-[#20222a] text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
              title="Refresh Info"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content with Sidebar Tabs */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Navigation */}
          <div className="w-48 border-r border-[#272932] bg-[#14151b] p-2 space-y-0.5 overflow-y-auto">
            {sectionList.map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => setSelectedSection(sec)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer text-left ${
                  selectedSection === sec
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1e2029]'
                }`}
              >
                <span>{sec}</span>
                {sec !== 'Overview' && infoMap[sec] && (
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {Object.keys(infoMap[sec]).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Right Main Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {selectedSection === 'Overview' ? (
              <>
                {/* Metric Cards Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg border border-[#272932] bg-[#121318] p-3 space-y-1">
                    <span className="text-[11px] text-zinc-400 uppercase font-semibold flex items-center gap-1.5">
                      <HardDrive className="h-3.5 w-3.5 text-blue-400" />
                      <span>Used Memory</span>
                    </span>
                    <div className="text-lg font-bold text-white font-mono">{stats.usedMemory}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">Peak: {stats.peakMemory}</div>
                  </div>

                  <div className="rounded-lg border border-[#272932] bg-[#121318] p-3 space-y-1">
                    <span className="text-[11px] text-zinc-400 uppercase font-semibold flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Clients</span>
                    </span>
                    <div className="text-lg font-bold text-white font-mono">{stats.connectedClients}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">Blocked: {stats.blockedClients}</div>
                  </div>

                  <div className="rounded-lg border border-[#272932] bg-[#121318] p-3 space-y-1">
                    <span className="text-[11px] text-zinc-400 uppercase font-semibold flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5 text-amber-400" />
                      <span>Throughput</span>
                    </span>
                    <div className="text-lg font-bold text-white font-mono">{stats.opsPerSec} ops/s</div>
                    <div className="text-[10px] text-zinc-500 font-mono">Total: {Number(stats.totalCommands).toLocaleString()}</div>
                  </div>

                  <div className="rounded-lg border border-[#272932] bg-[#121318] p-3 space-y-1">
                    <span className="text-[11px] text-zinc-400 uppercase font-semibold flex items-center gap-1.5">
                      <Database className="h-3.5 w-3.5 text-purple-400" />
                      <span>Total Keys</span>
                    </span>
                    <div className="text-lg font-bold text-white font-mono">{stats.totalKeys}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">Uptime: {stats.uptime}</div>
                  </div>
                </div>

                {/* Databases Keyspace Table */}
                <div className="rounded-lg border border-[#272932] bg-[#121318] overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[#272932] bg-[#16171f] flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-200">Active Databases Keyspace</span>
                    <span className="text-[11px] text-zinc-400 font-mono">{stats.dbKeysList.length} db(s) populated</span>
                  </div>
                  <div className="p-3">
                    {stats.dbKeysList.length === 0 ? (
                      <p className="text-xs text-zinc-500 italic py-2 text-center">No keys currently in database.</p>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {stats.dbKeysList.map((dbInfo) => (
                          <div key={dbInfo.db} className="rounded border border-[#242630] bg-[#0f1015] p-2.5">
                            <span className="font-mono text-xs font-bold text-amber-300">{dbInfo.db}</span>
                            <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
                              <span>Keys:</span>
                              <span className="font-mono font-medium text-white">{dbInfo.keys}</span>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-zinc-500">
                              <span>Expires:</span>
                              <span className="font-mono">{dbInfo.expires}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Server Info Grid */}
                <div className="rounded-lg border border-[#272932] bg-[#121318] p-4 space-y-3">
                  <span className="text-xs font-semibold text-zinc-200">Server Environment</span>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-zinc-500 block text-[10px] uppercase">Redis Version</span>
                      <span className="font-mono font-medium text-zinc-200">{stats.version}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[10px] uppercase">OS Platform</span>
                      <span className="font-mono font-medium text-zinc-200">{stats.os}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[10px] uppercase">Process Uptime</span>
                      <span className="font-mono font-medium text-zinc-200">{stats.uptime}</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* Specific Section Key-Value Table */
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                    {selectedSection} Properties
                  </h4>
                  <div className="relative w-64">
                    <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-2.5 top-2" />
                    <input
                      type="text"
                      placeholder="Filter properties..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-[#101115] border border-[#272932] focus:border-blue-500 pl-8 pr-2.5 py-1 text-xs text-white rounded-lg outline-none font-mono"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-[#272932] bg-[#121318] overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[#16171f] border-b border-[#272932] text-zinc-400 font-semibold">
                      <tr>
                        <th className="px-4 py-2 w-1/3">Property</th>
                        <th className="px-4 py-2">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2029] font-mono">
                      {Object.entries(infoMap[selectedSection] || {})
                        .filter(([k, v]) =>
                          searchQuery ? k.toLowerCase().includes(searchQuery.toLowerCase()) || v.toLowerCase().includes(searchQuery.toLowerCase()) : true
                        )
                        .map(([k, v]) => (
                          <tr key={k} className="hover:bg-[#181922] transition-colors">
                            <td className="px-4 py-2 text-zinc-400 select-all">{k}</td>
                            <td className="px-4 py-2 text-zinc-200 font-semibold select-all break-all">{v}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

