import React, { useState, useEffect } from 'react';
import { X, Bookmark, Plus, Trash2, Play, Search, Copy, Check } from 'lucide-react';
import { WorkspaceService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';

interface Snippet {
  id: string;
  title: string;
  description: string;
  sqlText: string;
  driver: string;
  tags: string;
  updatedAt: string;
}

interface SnippetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertSql: (sql: string) => void;
  initialSql?: string;
}

const PG_DBA_SNIPPETS: Snippet[] = [
  {
    id: 'pg-dba-locks',
    title: 'PG: Blocking Locks & Waiting Queries',
    description: 'Find queries blocked by locks and their blocking PIDs',
    sqlText: `SELECT pid, usename, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocked_by, now() - query_start AS duration, query\nFROM pg_stat_activity\nWHERE cardinality(pg_blocking_pids(pid)) > 0\nORDER BY duration DESC;`,
    driver: 'postgres',
    tags: 'locks,dba,blocking',
    updatedAt: '',
  },
  {
    id: 'pg-dba-bloat',
    title: 'PG: Table Dead Tuples & Vacuum Status',
    description: 'Inspect dead tuples, live tuples, and last autovacuum per table',
    sqlText: `SELECT schemaname, relname, n_live_tup, n_dead_tup, round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct, last_autovacuum, last_autoanalyze\nFROM pg_stat_user_tables\nORDER BY n_dead_tup DESC\nLIMIT 50;`,
    driver: 'postgres',
    tags: 'vacuum,bloat,dba',
    updatedAt: '',
  },
  {
    id: 'pg-dba-unused-idx',
    title: 'PG: Unused Indexes (idx_scan = 0)',
    description: 'Identify non-primary, non-unique indexes that have never been scanned',
    sqlText: `SELECT s.schemaname, s.relname AS table_name, s.indexrelname AS index_name, pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size, s.idx_scan\nFROM pg_stat_user_indexes s\nJOIN pg_index i ON i.indexrelid = s.indexrelid\nWHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary\nORDER BY pg_relation_size(s.indexrelid) DESC;`,
    driver: 'postgres',
    tags: 'indexes,dba,performance',
    updatedAt: '',
  },
  {
    id: 'pg-dba-listen-notify',
    title: 'PG: LISTEN / NOTIFY Channel Test',
    description: 'Send a JSON notification payload on a PostgreSQL channel',
    sqlText: `SELECT pg_notify('events', json_build_object('event', 'ping', 'ts', now())::text);`,
    driver: 'postgres',
    tags: 'listen,notify,pubsub',
    updatedAt: '',
  },
];

const MARIADB_SNIPPETS: Snippet[] = [
  {
    id: 'mariadb-sequence-ops',
    title: 'MariaDB: Sequence Operations (NEXTVAL / SETVAL)',
    description: 'Read next value, last value, or reset a MariaDB sequence',
    sqlText: `SELECT NEXT VALUE FOR my_seq;\nSELECT LASTVAL(my_seq);\nSELECT SETVAL(my_seq, 100, 0);`,
    driver: 'mariadb',
    tags: 'sequence,nextval,setval',
    updatedAt: '',
  },
  {
    id: 'mariadb-insert-returning',
    title: 'MariaDB: INSERT / DELETE ... RETURNING',
    description: 'Return inserted or deleted rows directly in MariaDB 10.5+',
    sqlText: `INSERT INTO my_table (name) VALUES ('alice') RETURNING id, name, created_at;`,
    driver: 'mariadb',
    tags: 'returning,dml',
    updatedAt: '',
  },
  {
    id: 'mariadb-system-time',
    title: 'MariaDB: Temporal Query (FOR SYSTEM_TIME)',
    description: 'Query historical rows from a system-versioned table',
    sqlText: `SELECT * FROM my_versioned_table FOR SYSTEM_TIME AS OF TIMESTAMP '2026-01-01 00:00:00';`,
    driver: 'mariadb',
    tags: 'temporal,system_time,versioning',
    updatedAt: '',
  },
];

export const SnippetsModal: React.FC<SnippetsModalProps> = ({
  isOpen,
  onClose,
  onInsertSql,
  initialSql = '',
}) => {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [search, setSearch] = useState('');
  const [driverFilter, setDriverFilter] = useState<string>('all');
  const [editing, setEditing] = useState<Partial<Snippet> | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadSnippets = async () => {
    try {
      const list = await (WorkspaceService as any).ListSnippets();
      const custom = list || [];
      const existingTitles = new Set(custom.map((s: Snippet) => s.title));
      setSnippets([
        ...custom,
        ...PG_DBA_SNIPPETS.filter((s) => !existingTitles.has(s.title)),
        ...MARIADB_SNIPPETS.filter((s) => !existingTitles.has(s.title)),
      ]);
    } catch (err: any) {
      alertError(err?.message || 'Failed to load snippets');
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSnippets();
      if (initialSql) {
        setEditing({ title: '', description: '', sqlText: initialSql, tags: '' });
      } else {
        setEditing(null);
      }
    }
  }, [isOpen, initialSql]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing?.title?.trim() || !editing?.sqlText?.trim()) {
      alertError('Title and SQL text are required.');
      return;
    }
    try {
      await (WorkspaceService as any).SaveSnippet({
        id: editing.id || '',
        title: editing.title.trim(),
        description: editing.description?.trim() || '',
        sqlText: editing.sqlText,
        driver: editing.driver || '',
        tags: editing.tags?.trim() || '',
      });
      alertSuccess('Snippet saved!');
      setEditing(null);
      await loadSnippets();
    } catch (err: any) {
      alertError(err?.message || 'Failed to save snippet');
    }
  };

  const handleDelete = async (sn: Snippet) => {
    const ok = await confirmDialog({
      title: 'Delete Snippet',
      message: `Delete snippet "${sn.title}"?`,
      confirmLabel: 'Delete',
      isDanger: true,
    });
    if (!ok) return;
    try {
      await (WorkspaceService as any).DeleteSnippet(sn.id);
      await loadSnippets();
    } catch (err: any) {
      alertError(err?.message || 'Failed to delete snippet');
    }
  };

  const filtered = snippets.filter((s) => {
    const matchesDriver =
      driverFilter === 'all' ||
      (driverFilter === '' ? !s.driver : (s.driver || '').toLowerCase() === driverFilter.toLowerCase());
    if (!matchesDriver) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.sqlText.toLowerCase().includes(q) ||
      s.tags.toLowerCase().includes(q) ||
      (s.driver || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4">
      <div className="w-[760px] max-w-full max-h-[85vh] rounded-xl bg-[#191a20] border border-[#272932] flex flex-col overflow-hidden text-xs text-zinc-200 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#272932] bg-[#14151a]">
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-amber-400" />
            <span className="font-semibold text-sm text-white">Query Snippets & Bookmarks</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing({ title: '', description: '', sqlText: '', tags: '' })}
              className="flex items-center gap-1 rounded bg-blue-600 hover:bg-blue-500 px-2.5 py-1 text-white font-medium cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Snippet</span>
            </button>
            <button onClick={onClose} className="text-zinc-400 hover:text-white cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {editing ? (
          <form onSubmit={handleSave} className="p-4 space-y-3 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Title</label>
                <input
                  type="text"
                  value={editing.title || ''}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  placeholder="e.g. Active Postgres Connections"
                  className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-100 focus:border-blue-500 focus:outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Tags (comma separated)</label>
                <input
                  type="text"
                  value={editing.tags || ''}
                  onChange={(e) => setEditing({ ...editing, tags: e.target.value })}
                  placeholder="monitoring, admin"
                  className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Description</label>
                <input
                  type="text"
                  value={editing.description || ''}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Optional note..."
                  className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Engine / Driver</label>
                <select
                  value={editing.driver || ''}
                  onChange={(e) => setEditing({ ...editing, driver: e.target.value })}
                  className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Any / Generic SQL</option>
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="mariadb">MariaDB</option>
                  <option value="sqlite">SQLite</option>
                  <option value="mssql">SQL Server</option>
                  <option value="oracle">Oracle</option>
                  <option value="clickhouse">ClickHouse</option>
                  <option value="mongodb">MongoDB</option>
                  <option value="redis">Redis</option>
                  <option value="qdrant">Qdrant</option>
                  <option value="elasticsearch">Elasticsearch</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">SQL</label>
              <textarea
                rows={7}
                value={editing.sqlText || ''}
                onChange={(e) => setEditing({ ...editing, sqlText: e.target.value })}
                className="w-full rounded bg-[#121317] border border-[#272932] p-3 font-mono text-zinc-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-3 py-1.5 rounded border border-[#272932] hover:bg-[#22242c] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer"
              >
                Save Snippet
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="p-3 border-b border-[#272932] bg-[#16171d] flex items-center gap-2">
              <div className="relative flex items-center flex-1">
                <Search className="absolute left-2.5 h-3.5 w-3.5 text-zinc-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search snippets by title, SQL, or tag..."
                  className="w-full rounded bg-[#121317] border border-[#272932] pl-8 pr-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <select
                value={driverFilter}
                onChange={(e) => setDriverFilter(e.target.value)}
                className="rounded bg-[#121317] border border-[#272932] px-2.5 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">All Engines</option>
                <option value="">Generic</option>
                <option value="elasticsearch">Elasticsearch</option>
                <option value="qdrant">Qdrant</option>
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
                <option value="sqlite">SQLite</option>
                <option value="redis">Redis</option>
                <option value="mongodb">MongoDB</option>
              </select>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filtered.length === 0 ? (
                <div className="py-12 text-center text-zinc-500">
                  No saved snippets yet. Click <strong>New Snippet</strong> to save reusable SQL queries.
                </div>
              ) : (
                filtered.map((sn) => (
                  <div
                    key={sn.id}
                    className="rounded-lg border border-[#272932] bg-[#14151a] p-3 space-y-2 hover:border-zinc-600 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-zinc-100">{sn.title}</div>
                        {sn.description && (
                          <div className="text-[11px] text-zinc-400 mt-0.5">{sn.description}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            onInsertSql(sn.sqlText);
                            onClose();
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 cursor-pointer"
                        >
                          <Play className="h-3 w-3" />
                          <span>Insert</span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(sn.sqlText);
                            setCopiedId(sn.id);
                            setTimeout(() => setCopiedId(null), 1500);
                          }}
                          className="p-1.5 rounded hover:bg-[#22242c] text-zinc-400 hover:text-white cursor-pointer"
                          title="Copy SQL"
                        >
                          {copiedId === sn.id ? (
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(sn)}
                          className="p-1.5 rounded hover:bg-rose-950/40 text-zinc-400 hover:text-rose-400 cursor-pointer"
                          title="Delete Snippet"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <pre className="p-2 rounded bg-[#101115] border border-[#23252f] font-mono text-[11px] text-zinc-300 max-h-24 overflow-auto">
                      {sn.sqlText}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
