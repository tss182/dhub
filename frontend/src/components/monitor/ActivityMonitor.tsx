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
  const [pgTab, setPgTab] = useState<'sessions' | 'locks' | 'stats' | 'bloat' | 'replication'>('sessions');
  const [mysqlTab, setMysqlTab] = useState<'processes' | 'trx' | 'locks'>('processes');
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
        : '');
    const targetSchema = drv === 'postgres' ? 'public' : drv === 'mssql' ? 'dbo' : '';

    let sql = '';
    if (drv === 'mysql' || drv === 'mariadb') {
      if (mysqlTab === 'trx') {
        sql = `SELECT trx_mysql_thread_id AS id, COALESCE(trx_state, '') AS user, COALESCE(trx_operation_state, '') AS host, '' AS db, 'TRX' AS command, TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS time, CONCAT('locks:', trx_rows_locked, ' mod:', trx_rows_modified) AS state, COALESCE(trx_query, '') AS info FROM information_schema.innodb_trx ORDER BY trx_started ASC;`;
      } else if (mysqlTab === 'locks') {
        sql =
          drv === 'mariadb'
            ? `SELECT r.trx_mysql_thread_id AS id, CONCAT('blocked_by:', b.trx_mysql_thread_id) AS user, '' AS host, '' AS db, 'LOCK_WAIT' AS command, TIMESTAMPDIFF(SECOND, r.trx_started, NOW()) AS time, COALESCE(r.trx_state, '') AS state, COALESCE(r.trx_query, '') AS info FROM information_schema.innodb_lock_waits w JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_trx_id JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_trx_id;`
            : `SELECT r.trx_mysql_thread_id AS id, CONCAT('blocked_by:', b.trx_mysql_thread_id) AS user, '' AS host, '' AS db, 'LOCK_WAIT' AS command, TIMESTAMPDIFF(SECOND, r.trx_started, NOW()) AS time, COALESCE(r.trx_state, '') AS state, COALESCE(r.trx_query, '') AS info FROM performance_schema.data_lock_waits w JOIN information_schema.innodb_trx r ON r.trx_id = w.REQUESTING_ENGINE_TRANSACTION_ID JOIN information_schema.innodb_trx b ON b.trx_id = w.BLOCKING_ENGINE_TRANSACTION_ID;`;
      } else {
        sql = `SELECT ID AS id, USER AS user, HOST AS host, COALESCE(DB, '') AS db, COMMAND AS command, TIME AS time, COALESCE(STATE, '') AS state, COALESCE(INFO, '') AS info FROM information_schema.processlist WHERE ID <> CONNECTION_ID() ORDER BY TIME DESC;`;
      }
    } else if (drv === 'postgres') {
      if (pgTab === 'locks') {
        sql = `SELECT l.pid, COALESCE(a.usename, ''), COALESCE(a.datname, ''), l.locktype || ' (' || l.mode || ')', 0, CASE WHEN l.granted THEN 'granted' ELSE 'WAITING' END, COALESCE(c.relname::text, l.relation::text, '') || ' | ' || COALESCE(a.query, '') FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid = l.pid LEFT JOIN pg_class c ON c.oid = l.relation WHERE l.pid <> pg_backend_pid() ORDER BY l.granted ASC, l.pid LIMIT 300;`;
      } else if (pgTab === 'stats') {
        sql = `SELECT datid, datname, 'backends:' || numbackends, 'commits:' || xact_commit, 0, 'rollbacks:' || xact_rollback || ' deadlocks:' || deadlocks, 'hit:' || blks_hit || ' read:' || blks_read FROM pg_stat_database WHERE datname IS NOT NULL ORDER BY numbackends DESC, datname;`;
      } else if (pgTab === 'bloat') {
        sql = `SELECT s.relid, s.schemaname, s.relname, 'dead:' || s.n_dead_tup, s.n_live_tup, 'seq:' || s.seq_scan || ' idx:' || s.idx_scan, pg_size_pretty(pg_total_relation_size(s.relid)) || COALESCE(' | unused_idx: ' || (SELECT string_agg(indexrelname, ', ') FROM pg_stat_user_indexes i WHERE i.relid = s.relid AND i.idx_scan = 0), '') FROM pg_stat_user_tables s ORDER BY s.n_dead_tup DESC, pg_total_relation_size(s.relid) DESC LIMIT 200;`;
      } else if (pgTab === 'replication') {
        sql = `SELECT COALESCE(slot_name, 'slot'), COALESCE(plugin, 'physical'), COALESCE(database, '-'), slot_type, 0, CASE WHEN active THEN 'active' ELSE 'inactive' END, 'restart_lsn:' || COALESCE(restart_lsn::text, '-') || ' retained:' || pg_size_pretty(COALESCE(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn), 0)) FROM pg_replication_slots ORDER BY slot_name;`;
      } else {
        sql = `SELECT pid, COALESCE(usename, '') || CASE WHEN COALESCE(application_name, '') <> '' THEN ' [' || application_name || ']' ELSE '' END, COALESCE(client_addr::text, 'local'), COALESCE(datname, ''), COALESCE(NULLIF(COALESCE(wait_event_type, '') || CASE WHEN wait_event IS NOT NULL THEN ':' || wait_event ELSE '' END, ''), COALESCE(backend_type, '')), COALESCE(EXTRACT(EPOCH FROM (now() - query_start))::int, 0), COALESCE(state, '') || CASE WHEN cardinality(pg_blocking_pids(pid)) > 0 THEN ' [BLOCKED BY ' || array_to_string(pg_blocking_pids(pid), ',') || ']' ELSE '' END, COALESCE(query, '') FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY query_start DESC NULLS LAST;`;
      }
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
        skipHistory: true,
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
  }, [connection, pgTab, mysqlTab]);

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

  const handleKillProcess = async (proc: ProcessRow, queryOnly = false) => {
    if (!connection || connection.isReadOnly) return;
    const drv = connection.driver;
    if ((drv === 'mysql' || drv === 'mariadb') && !/^\d+$/.test(String(proc.id).trim())) {
      alertError(`Invalid process ID "${proc.id}".`);
      return;
    }
    const actionLabel = queryOnly ? 'Cancel Query' : 'Kill Process';
    const ok = await confirmDialog({
      title: queryOnly ? 'Cancel Running Query' : 'Terminate Process / Query',
      message: queryOnly
        ? `Are you sure you want to cancel the running query on session "${proc.id}" (${proc.user || 'unknown'})? The connection will remain open.`
        : `Are you sure you want to kill session "${proc.id}" (${proc.user || 'unknown'})?`,
      confirmLabel: actionLabel,
      isDanger: true,
    });
    if (!ok) return;

    let killSql = '';
    if (drv === 'mysql' || drv === 'mariadb') {
      killSql = queryOnly ? `KILL QUERY ${String(proc.id).trim()};` : `KILL ${String(proc.id).trim()};`;
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
      const res: any = await QueryService.ExecuteQuery({
        executionId: `kill-${Date.now()}`,
        skipHistory: true,
        connectionId: connection.id,
        database: connection.databaseName || (drv === 'postgres' ? 'postgres' : drv === 'clickhouse' ? 'default' : ''),
        schema: drv === 'postgres' ? 'public' : '',
        sql: killSql,
        limit: 10,
        offset: 0,
      } as any);
      if (drv === 'postgres' && res?.rows?.[0]?.[0] === false) {
        alertError(`pg_terminate_backend(${proc.id}) returned false (insufficient privileges or process already exited).`, 'Terminate Unsuccessful');
      } else {
        alertSuccess(`Terminated process ${proc.id}.`);
      }
      await loadProcesses();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Terminate Process');
    }
  };

  const handleCancelPgQuery = async (proc: ProcessRow) => {
    if (!connection || connection.isReadOnly || connection.driver !== 'postgres') return;
    try {
      const res: any = await QueryService.ExecuteQuery({
        executionId: `cancel-${Date.now()}`,
        skipHistory: true,
        connectionId: connection.id,
        database: connection.databaseName || 'postgres',
        schema: 'public',
        sql: `SELECT pg_cancel_backend(${proc.id});`,
        limit: 10,
        offset: 0,
      } as any);
      if (res?.rows?.[0]?.[0] === false) {
        alertError(`pg_cancel_backend(${proc.id}) returned false (insufficient privileges or query already finished).`, 'Cancel Unsuccessful');
      } else {
        alertSuccess(`Sent cancel signal to query PID ${proc.id}.`);
      }
      await loadProcesses();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Cancel Query');
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
          {(connection.driver === 'mysql' || connection.driver === 'mariadb') && (
            <div className="flex items-center rounded bg-[#191a20] border border-[#272932] p-0.5 text-[11px]">
              {(
                [
                  { id: 'processes', label: 'Processes' },
                  { id: 'trx', label: 'Transactions' },
                  { id: 'locks', label: 'Lock Waits' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMysqlTab(t.id)}
                  className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                    mysqlTab === t.id ? 'bg-blue-600 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {connection.driver === 'postgres' && (
            <div className="flex items-center rounded bg-[#191a20] border border-[#272932] p-0.5 text-[11px]">
              {(
                [
                  { id: 'sessions', label: 'Sessions' },
                  { id: 'locks', label: 'Locks' },
                  { id: 'stats', label: 'DB Stats' },
                  { id: 'bloat', label: 'Bloat & Indexes' },
                  { id: 'replication', label: 'Replication' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPgTab(t.id)}
                  className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                    pgTab === t.id
                      ? 'bg-blue-600 text-white font-medium'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
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
                      {!connection.isReadOnly && (connection.driver !== 'postgres' || pgTab === 'sessions' || pgTab === 'locks') && (
                        <div className="inline-flex items-center gap-1">
                          {(connection.driver === 'mysql' || connection.driver === 'mariadb') && (
            <div className="flex items-center rounded bg-[#191a20] border border-[#272932] p-0.5 text-[11px]">
              {(
                [
                  { id: 'processes', label: 'Processes' },
                  { id: 'trx', label: 'Transactions' },
                  { id: 'locks', label: 'Lock Waits' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMysqlTab(t.id)}
                  className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                    mysqlTab === t.id ? 'bg-blue-600 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {connection.driver === 'postgres' && (
                            <button
                              type="button"
                              onClick={() => handleCancelPgQuery(p)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/30 text-[11px] font-sans transition-colors cursor-pointer"
                              title="Cancel active query (pg_cancel_backend)"
                            >
                              <span>Cancel</span>
                            </button>
                          )}
                          {(connection.driver === 'mysql' || connection.driver === 'mariadb') && (
                            <button
                              type="button"
                              onClick={() => handleKillProcess(p, true)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/30 text-[11px] font-sans transition-colors cursor-pointer"
                              title="Cancel active query without closing the connection (KILL QUERY)"
                            >
                              <span>Kill Query</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleKillProcess(p)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-[11px] font-sans transition-colors cursor-pointer"
                            title={connection.driver === 'postgres' ? 'Terminate backend (pg_terminate_backend)' : 'Terminate this session/query'}
                          >
                            <Square className="h-2.5 w-2.5" />
                            <span>Kill</span>
                          </button>
                        </div>
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
