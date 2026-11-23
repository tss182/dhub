import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Activity,
  RefreshCw,
  Search,
  Square,
  AlertCircle,
  Play,
  Pause,
} from 'lucide-react';
import { ConnectionConfig, WorkbenchTab, resolveConnectionEnv } from '../../types/domain';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertSuccess, alertError, confirmDialog } from '../../stores/useAlertStore';

interface ActivityMonitorProps {
  tab: WorkbenchTab;
  connection: ConnectionConfig | null;
}

interface ProcessRow {
  id: string;
  user: string;
  host: string;
  database: string;
  command: string;
  time: string;
  state: string;
  info: string;
}

export const ActivityMonitor: React.FC<ActivityMonitorProps> = ({ connection }) => {
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadProcesses = useCallback(async () => {
    if (!connection || connection.driver === 'sqlite') {
      setProcesses([]);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    const execId = `activity-${Date.now()}`;
    const drv = connection.driver;
    const targetDb =
      connection.databaseName ||
      (drv === 'postgres'
        ? 'postgres'
        : drv === 'mssql'
        ? 'master'
        : drv === 'clickhouse'
        ? 'default'
        : drv === 'oracle'
        ? 'ORCL'
        : drv === 'redis'
        ? 'db0'
        : drv === 'mongodb'
        ? 'admin'
        : 'mysql');
    const targetSchema = drv === 'postgres' ? 'public' : drv === 'mssql' ? 'dbo' : '';

    let sql = '';
    if (drv === 'mysql' || drv === 'mariadb') {
      sql = 'SHOW FULL PROCESSLIST;';
    } else if (drv === 'postgres') {
      sql = `SELECT pid, COALESCE(usename, ''), COALESCE(client_addr::text, 'local'), COALESCE(datname, ''), COALESCE(wait_event_type, ''), COALESCE(EXTRACT(EPOCH FROM (now() - query_start))::int, 0), COALESCE(state, ''), COALESCE(query, '') FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY query_start DESC NULLS LAST;`;
    } else if (drv === 'mssql') {
      sql = `SELECT r.session_id, COALESCE(s.login_name, ''), COALESCE(s.host_name, ''), COALESCE(DB_NAME(r.database_id), ''), COALESCE(r.command, ''), r.total_elapsed_time / 1000, COALESCE(r.status, ''), COALESCE(t.text, '') FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t WHERE r.session_id <> @@SPID ORDER BY r.total_elapsed_time DESC;`;
    } else if (drv === 'clickhouse') {
      sql = `SELECT query_id, user, toString(address), current_database, 'Query', round(elapsed, 2), concat('rows:', toString(read_rows), ' mem:', formatReadableSize(memory_usage)), query FROM system.processes WHERE query_id != currentQueryID() ORDER BY elapsed DESC;`;
    } else if (drv === 'oracle') {
      sql = `SELECT SID || ',' || SERIAL#, USERNAME, MACHINE, SCHEMANAME, COMMAND, LAST_CALL_ET, STATUS, SQL_ID FROM V$SESSION WHERE TYPE = 'USER' ORDER BY LAST_CALL_ET DESC`;
    } else if (drv === 'redis') {
      sql = 'CLIENT LIST';
    } else if (drv === 'mongodb') {
      sql = '{"currentOp": true, "active": true}';
    }

    try {
      const res: any = await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: connection.id,
        database: targetDb,
        schema: targetSchema,
        sql,
        limit: 500,
        offset: 0,
      } as any);

      if (res?.error) {
        throw new Error(res.error);
      }

      const rows: any[] = res?.rows || [];
      if (drv === 'redis') {
        const rawText = String(rows[0]?.[0] ?? '');
        const lines = rawText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const parsed: ProcessRow[] = lines.map((line, i) => {
          const kv: Record<string, string> = {};
          line.split(/\s+/).forEach((part) => {
            const idx = part.indexOf('=');
            if (idx !== -1) kv[part.slice(0, idx)] = part.slice(idx + 1);
          });
          return {
            id: kv.id || String(i + 1),
            user: kv.user || 'default',
            host: kv.addr || '',
            database: `db${kv.db || '0'}`,
            command: kv.cmd || '',
            time: kv.age ? `${kv.age}s` : '0s',
            state: kv.flags || '',
            info: kv.name || line,
          };
        });
        setProcesses(parsed);
      } else if (drv === 'mysql' || drv === 'mariadb') {
        const cols: string[] = (res?.columns || []).map((c: any) => String(c.name || '').toLowerCase());
        const idxOf = (name: string, fallback: number) => {
          const found = cols.indexOf(name);
          return found !== -1 ? found : fallback;
        };
        const parsed: ProcessRow[] = rows.map((r) => ({
          id: String(r[idxOf('id', 0)] ?? ''),
          user: String(r[idxOf('user', 1)] ?? ''),
          host: String(r[idxOf('host', 2)] ?? ''),
          database: String(r[idxOf('db', 3)] ?? ''),
          command: String(r[idxOf('command', 4)] ?? ''),
          time: `${String(r[idxOf('time', 5)] ?? 0)}s`,
          state: String(r[idxOf('state', 6)] ?? ''),
          info: String(r[idxOf('info', 7)] ?? ''),
        }));
        setProcesses(parsed);
      } else if (drv === 'mongodb') {
        const cols: string[] = (res?.columns || []).map((c: any) => String(c.name || ''));
        const inprogIdx = cols.indexOf('inprog');
        let ops: any[] = [];
        if (inprogIdx !== -1 && rows[0]?.[inprogIdx]) {
          const rawInprog = rows[0][inprogIdx];
          if (typeof rawInprog === 'string') {
            try {
              const parsedArr = JSON.parse(rawInprog);
              if (Array.isArray(parsedArr)) ops = parsedArr;
            } catch {}
          } else if (Array.isArray(rawInprog)) {
            ops = rawInprog;
          }
        }
        const parsed: ProcessRow[] = ops.map((op: any) => ({
          id: String(op.opid ?? ''),
          user: String(op.effectiveUsers?.[0]?.user || op.desc || ''),
          host: String(op.client || ''),
          database: String(op.ns || 'admin'),
          command: String(op.op || ''),
          time: `${String(op.secs_running ?? 0)}s`,
          state: op.waitingForLock ? 'waitingLock' : op.active ? 'active' : 'idle',
          info: op.command ? JSON.stringify(op.command) : String(op.msg || ''),
        }));
        setProcesses(parsed);
      } else {
        const parsed: ProcessRow[] = rows.map((r) => ({
          id: String(r[0] ?? ''),
          user: String(r[1] ?? ''),
          host: String(r[2] ?? ''),
          database: String(r[3] ?? ''),
          command: String(r[4] ?? ''),
          time: `${String(r[5] ?? 0)}s`,
          state: String(r[6] ?? ''),
          info: String(r[7] ?? ''),
        }));
        setProcesses(parsed);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || String(err));
    } finally {
      setIsLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    loadProcesses();
  }, [loadProcesses]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      loadProcesses();
    }, 3000);
    return () => clearInterval(timer);
  }, [autoRefresh, loadProcesses]);

  const handleKillProcess = async (proc: ProcessRow) => {
    if (!connection || connection.isReadOnly) return;
    const ok = await confirmDialog({
      title: 'Terminate Process / Query',
      message: `Are you sure you want to kill session/query "${proc.id}" (${proc.user || 'unknown'})?`,
      confirmLabel: 'Kill Process',
      isDanger: true,
    });
    if (!ok) return;

    const drv = connection.driver;
    let killSql = '';
    if (drv === 'mysql' || drv === 'mariadb') {
      killSql = `KILL ${proc.id};`;
    } else if (drv === 'postgres') {
      killSql = `SELECT pg_terminate_backend(${proc.id});`;
    } else if (drv === 'mssql') {
      killSql = `KILL ${proc.id};`;
    } else if (drv === 'clickhouse') {
      killSql = `KILL QUERY WHERE query_id = '${proc.id.replace(/'/g, "''")}';`;
    } else if (drv === 'oracle') {
      killSql = `ALTER SYSTEM KILL SESSION '${proc.id.replace(/'/g, "''")}' IMMEDIATE`;
    } else if (drv === 'redis') {
      killSql = `CLIENT KILL ID ${proc.id}`;
    } else if (drv === 'mongodb') {
      killSql = `db.killOp(${proc.id});`;
    } else {
      alertError(`Kill process is not supported for ${drv}.`);
      return;
    }

    try {
      await QueryService.ExecuteQuery({
        executionId: `kill-${Date.now()}`,
        connectionId: connection.id,
        database: connection.databaseName || (drv === 'postgres' ? 'postgres' : drv === 'clickhouse' ? 'default' : 'mysql'),
        schema: drv === 'postgres' ? 'public' : '',
        sql: killSql,
        limit: 10,
        offset: 0,
      } as any);
      alertSuccess(`Terminated process ${proc.id}.`);
      await loadProcesses();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Terminate Process');
    }
  };

  const filteredProcesses = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return processes;
    return processes.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.user.toLowerCase().includes(q) ||
        p.database.toLowerCase().includes(q) ||
        p.state.toLowerCase().includes(q) ||
        p.info.toLowerCase().includes(q)
    );
  }, [processes, searchQuery]);

  if (!connection) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#191a20] text-zinc-500 text-sm">
        Connection not found.
      </div>
    );
  }

  if (connection.driver === 'sqlite') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#191a20] text-zinc-400 text-xs p-6 text-center">
        <Activity className="h-8 w-8 text-zinc-500 mb-2" />
        <p className="font-semibold text-zinc-200">SQLite Activity Monitor</p>
        <p className="text-zinc-500 mt-1">SQLite is an embedded file database and does not run a server process list.</p>
      </div>
    );
  }

  const connEnv = resolveConnectionEnv(connection);

  return (
    <div className="flex-1 flex flex-col bg-[#191a20] text-zinc-200 min-h-0 select-none">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-[#272932] bg-[#14151a]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
            <Activity className="h-4 w-4" />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-xs font-semibold text-white truncate">
              {connection.name} — Activity Monitor
            </h2>
            <span className="text-[10px] font-mono uppercase bg-[#22242c] text-zinc-400 px-1.5 py-0.5 rounded border border-[#2e313d]">
              {connection.driver}
            </span>
            {connEnv !== 'local' && (
              <span
                className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
                  connEnv === 'prod'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                }`}
              >
                {connEnv}
              </span>
            )}
            <span className="text-[11px] text-zinc-400 font-mono">
              • {processes.length} active
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter PID, user, query..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#191a20] pl-8 pr-3 py-1 rounded text-xs text-zinc-200 placeholder-zinc-500 border border-[#272932] focus:border-blue-500 focus:outline-none w-52"
            />
          </div>

          <button
            type="button"
            onClick={() => setAutoRefresh((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors cursor-pointer ${
              autoRefresh
                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                : 'bg-[#22242c] hover:bg-[#2c303c] border-[#272932] text-zinc-300'
            }`}
            title="Toggle 3s Auto-Refresh"
          >
            {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{autoRefresh ? 'Live (3s)' : 'Auto'}</span>
          </button>

          <button
            type="button"
            onClick={loadProcesses}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-[#22242c] hover:bg-[#2c303c] text-zinc-300 border border-[#272932] transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-rose-950/40 border border-rose-800/50 text-rose-200 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          <span className="truncate">{errorMessage}</span>
        </div>
      )}

      {/* Process Table */}
      <div className="flex-1 overflow-auto p-4 min-h-0">
        <div className="rounded-lg border border-[#272932] bg-[#14151a] overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs border-collapse font-mono">
            <thead>
              <tr className="border-b border-[#272932] bg-[#191a20] text-zinc-400 font-sans font-medium">
                <th className="py-2 px-3">PID / ID</th>
                <th className="py-2 px-3">User</th>
                <th className="py-2 px-3">Database</th>
                <th className="py-2 px-3">Time</th>
                <th className="py-2 px-3">State</th>
                <th className="py-2 px-3">Query / Info</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#23252f]">
              {filteredProcesses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-zinc-500 font-sans">
                    {isLoading ? 'Loading server processes...' : 'No active processes found'}
                  </td>
                </tr>
              ) : (
                filteredProcesses.map((p, i) => (
                  <tr key={`${p.id}-${i}`} className="hover:bg-[#1d1f27] transition-colors">
                    <td className="py-2 px-3 text-cyan-300 font-semibold whitespace-nowrap">{p.id}</td>
                    <td className="py-2 px-3 text-zinc-200 whitespace-nowrap">{p.user || '-'}</td>
                    <td className="py-2 px-3 text-zinc-300 whitespace-nowrap">{p.database || '-'}</td>
                    <td className="py-2 px-3 text-amber-300 whitespace-nowrap">{p.time}</td>
                    <td className="py-2 px-3 text-zinc-400 whitespace-nowrap">{p.state || p.command || '-'}</td>
                    <td className="py-2 px-3 text-zinc-300 max-w-md truncate select-text" title={p.info}>
                      {p.info || '-'}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {!connection.isReadOnly && (
                        <button
                          type="button"
                          onClick={() => handleKillProcess(p)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-[11px] font-sans transition-colors cursor-pointer"
                          title="Terminate this session/query"
                        >
                          <Square className="h-2.5 w-2.5" />
                          <span>Kill</span>
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
    </div>
  );
};
