import React, { useEffect, useState, useRef } from 'react';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { SchemaService } from '../../../bindings/dhub/internal/services';
import { Search, Table, Database, Terminal, FileCode, Settings as SettingsIcon } from 'lucide-react';
import { DbDriverIcon } from '../common/DbDriverIcon';

interface SearchResultItem {
  id: string;
  kind: 'table' | 'view' | 'console' | 'connection';
  title: string;
  subtitle: string;
  badge: string;
  connectionId?: string;
  database?: string;
  schema?: string;
  table?: string;
  consoleData?: any;
}

const computeMatchScore = (titleRaw: string, rawQuery: string): number => {
  const q = rawQuery.trim().toLowerCase();
  const t = (titleRaw || '').trim().toLowerCase();
  if (!q || !t) return 0;

  // 1. Exact match (highest priority)
  if (t === q) {
    return titleRaw.trim() === rawQuery.trim() ? 10010 : 10000;
  }

  const lenDiff = Math.max(0, t.length - q.length);

  // 2. Prefix match (starts with query, e.g. "rnd_worksheet_share" for "rnd_worksheet")
  if (t.startsWith(q)) {
    const nextChar = t[q.length];
    const isWordBoundary = nextChar === '_' || nextChar === '-' || nextChar === '.' || nextChar === ' ';
    return 8000 + (isWordBoundary ? 200 : 0) - Math.min(500, lenDiff);
  }

  // 3. Contiguous substring match
  const idx = t.indexOf(q);
  if (idx !== -1) {
    const prevChar = idx > 0 ? t[idx - 1] : '';
    const isBoundaryStart = prevChar === '_' || prevChar === '-' || prevChar === '.' || prevChar === ' ';
    const isSuffix = idx + q.length === t.length;

    if (isBoundaryStart) {
      return 6000 + (isSuffix ? 200 : 0) - Math.min(300, idx * 5) - Math.min(500, lenDiff);
    }
    return 4000 + (isSuffix ? 100 : 0) - Math.min(300, idx * 5) - Math.min(500, lenDiff);
  }

  // 4. Token / segment match (e.g. when only some words match or matched via column metadata)
  const qTokens = q.split(/[_.\-\s]+/).filter(Boolean);
  const tTokens = t.split(/[_.\-\s]+/).filter(Boolean);

  if (qTokens.length > 0 && tTokens.length > 0) {
    let exactTokenMatches = 0;
    let partialTokenMatches = 0;
    for (const qt of qTokens) {
      if (tTokens.includes(qt)) {
        exactTokenMatches++;
      } else if (t.includes(qt)) {
        partialTokenMatches++;
      }
    }

    if (exactTokenMatches + partialTokenMatches === qTokens.length) {
      return 3000 + exactTokenMatches * 50 - Math.min(500, Math.abs(t.length - q.length));
    }

    if (exactTokenMatches > 0 || partialTokenMatches > 0) {
      const ratio = (exactTokenMatches + partialTokenMatches * 0.5) / qTokens.length;
      return 1000 + Math.round(ratio * 500) - Math.min(300, Math.abs(t.length - q.length) * 2);
    }
  }

  // 5. Fallback (matched only via column metadata in backend cache)
  return 100 - Math.min(90, Math.abs(t.length - q.length));
};

export const SearchEverywhere: React.FC = () => {
  const { isSearchEverywhereOpen, setSearchEverywhereOpen, openTab, consoles } = useWorkbenchStore();
  const {
    connections,
    activeConnectionId,
    activeDatabase,
    treeObjects,
    treeDatabases,
    visibleDatabases,
    setActiveConnection,
  } = useConnectionStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isDatabaseVisible = (connId?: string, databaseName?: string): boolean => {
    if (!connId) return false;
    const conn = connections.find((c) => c.id === connId);
    if (!conn) return false;

    const targetDb = databaseName || conn.databaseName || (conn.driver === 'sqlite' ? 'main' : '');

    // 1. If explicit visibleDatabases configuration exists for this connection:
    const visibleList = visibleDatabases[connId];
    if (visibleList !== undefined) {
      if (!targetDb) return false;
      return (
        visibleList.includes(targetDb) ||
        visibleList.some((d) => d.toLowerCase() === targetDb.toLowerCase())
      );
    }

    // 2. If no filter has been set yet, check known loaded databases:
    const knownDbs = treeDatabases[connId];
    if (knownDbs && knownDbs.length > 0) {
      if (!targetDb) return false;
      return (
        knownDbs.includes(targetDb) ||
        knownDbs.some((d) => d.toLowerCase() === targetDb.toLowerCase())
      );
    }

    // 3. Fallback: if database list hasn't been fetched yet, allow the connection's default database
    if (conn.databaseName) {
      return !targetDb || targetDb.toLowerCase() === conn.databaseName.toLowerCase();
    }

    return true;
  };

  useEffect(() => {
    if (isSearchEverywhereOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isSearchEverywhereOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isSearchEverywhereOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setSearchEverywhereOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelectItem(results[selectedIndex]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchEverywhereOpen, results, selectedIndex]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      activeEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  useEffect(() => {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const qLower = cleanQuery.toLowerCase();
        const items: SearchResultItem[] = [];

        // 1. Search cached schema objects across ALL connections from backend
        // Passing "" as connectionID instructs backend to query across all connections
        let backendMatches: any[] = [];
        try {
          const resp = await SchemaService.SearchEverywhere('', cleanQuery);
          backendMatches = resp || [];
        } catch (err) {
          console.error('Backend search everywhere error:', err);
        }

        // 2. Search matching tables / views from in-memory treeObjects
        const memoryMatches: any[] = [];
        Object.entries(treeObjects).forEach(([key, objs]) => {
          // Key format: "connId:db:schema"
          const parts = key.split(':');
          const connId = parts[0] || '';
          const dbName = parts[1] || '';
          const schemaName = parts[2] || '';

          if (!isDatabaseVisible(connId, dbName)) {
            return;
          }

          (objs || []).forEach((o: any) => {
            if (o.name && o.name.toLowerCase().includes(qLower)) {
              memoryMatches.push({
                connectionId: connId,
                databaseName: dbName,
                schemaName: schemaName,
                objectType: o.type || 'table',
                objectName: o.name,
              });
            }
          });
        });

        // Deduplicate database objects & filter visible databases
        const seenObjMap = new Map<string, SearchResultItem>();
        for (const item of [...backendMatches, ...memoryMatches]) {
          if (!isDatabaseVisible(item.connectionId, item.databaseName)) {
            continue;
          }

          const conn = connections.find((c) => c.id === item.connectionId);
          const driver = conn?.driver;
          const isMultiSchema = driver === 'postgres' || driver === 'mssql';

          let effectiveSchema = item.schemaName || '';
          if (!isMultiSchema) {
            effectiveSchema = driver === 'sqlite' ? 'main' : (item.databaseName || '');
          } else {
            if (!effectiveSchema || effectiveSchema === 'main' || effectiveSchema === item.databaseName) {
              effectiveSchema = driver === 'mssql' ? 'dbo' : 'public';
            }
          }

          // Dedup key:
          // Single-schema engines: connectionId:databaseName:objectName (unique per table)
          // Multi-schema engines: connectionId:databaseName:effectiveSchema:objectName
          const dedupKey = isMultiSchema
            ? `${item.connectionId}:${item.databaseName}:${effectiveSchema}:${item.objectName}`
            : `${item.connectionId}:${item.databaseName}:${item.objectName}`;

          if (seenObjMap.has(dedupKey)) {
            continue;
          }

          let dbPath = item.databaseName || '';
          if (isMultiSchema) {
            dbPath = item.databaseName
              ? `${item.databaseName}${effectiveSchema ? '.' + effectiveSchema : ''}`
              : effectiveSchema;
          }

          const isView = item.objectType?.toLowerCase() === 'view';

          const resItem: SearchResultItem = {
            id: `obj-${dedupKey}`,
            kind: isView ? 'view' : 'table',
            title: item.objectName,
            subtitle: `› ${dbPath}`,
            badge: isView ? 'VIEW' : 'TABLE',
            connectionId: item.connectionId,
            database: item.databaseName,
            schema: effectiveSchema,
            table: item.objectName,
          };

          seenObjMap.set(dedupKey, resItem);
          items.push(resItem);
        }

        // 3. Search query consoles
        const matchingConsoles = consoles.filter((c) => c.title.toLowerCase().includes(qLower));
        for (const c of matchingConsoles) {
          if (c.database && !isDatabaseVisible(c.connectionId, c.database)) {
            continue;
          }
          const conn = connections.find((cn) => cn.id === c.connectionId);
          if (c.connectionId && !conn) {
            continue;
          }
          items.push({
            id: `console-${c.id}`,
            kind: 'console',
            title: c.title,
            subtitle: `› Worksheet`,
            badge: 'CONSOLE',
            connectionId: c.connectionId,
            database: c.database,
            schema: c.schema,
            consoleData: c,
          });
        }

        // 4. Search connections themselves
        const matchingConns = connections.filter((c) => c.name.toLowerCase().includes(qLower));
        for (const c of matchingConns) {
          items.push({
            id: `conn-${c.id}`,
            kind: 'connection',
            title: c.name,
            subtitle: `${c.driver} (${c.host || c.databaseName || 'local'})`,
            badge: 'CONNECTION',
            connectionId: c.id,
            database: c.databaseName,
          });
        }

        // 5. Sort results by closest match relevance
        items.sort((a, b) => {
          const scoreA = computeMatchScore(a.title, cleanQuery);
          const scoreB = computeMatchScore(b.title, cleanQuery);
          if (scoreA !== scoreB) {
            return scoreB - scoreA;
          }

          // Tie-breaker 1: Active connection + active database
          const aActiveDb =
            a.connectionId === activeConnectionId && a.database && a.database === activeDatabase ? 1 : 0;
          const bActiveDb =
            b.connectionId === activeConnectionId && b.database && b.database === activeDatabase ? 1 : 0;
          if (aActiveDb !== bActiveDb) {
            return bActiveDb - aActiveDb;
          }

          // Tie-breaker 2: Active connection
          const aActiveConn = a.connectionId === activeConnectionId ? 1 : 0;
          const bActiveConn = b.connectionId === activeConnectionId ? 1 : 0;
          if (aActiveConn !== bActiveConn) {
            return bActiveConn - aActiveConn;
          }

          // Tie-breaker 3: Shorter title length
          if (a.title.length !== b.title.length) {
            return a.title.length - b.title.length;
          }

          // Tie-breaker 4: Alphabetical by title, then subtitle
          const titleCmp = a.title.localeCompare(b.title);
          if (titleCmp !== 0) {
            return titleCmp;
          }
          return a.subtitle.localeCompare(b.subtitle);
        });

        setResults(items);
        setSelectedIndex(0);
      } catch (e) {
        console.error('Search everywhere failed:', e);
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [
    query,
    treeObjects,
    consoles,
    connections,
    activeConnectionId,
    activeDatabase,
    visibleDatabases,
    treeDatabases,
  ]);

  const handleSelectItem = (item: SearchResultItem) => {
    setSearchEverywhereOpen(false);

    if (item.kind === 'console' && item.consoleData) {
      openTab({
        id: item.consoleData.id,
        type: 'worksheet',
        title: item.consoleData.title,
        content: item.consoleData.content,
        connectionId: item.consoleData.connectionId,
        database: item.consoleData.database,
        schema: item.consoleData.schema,
      });
      return;
    }

    if (item.kind === 'table' || item.kind === 'view') {
      openTab({
        id: `table-${item.connectionId}-${item.database}-${item.table}`,
        type: 'table_data',
        title: item.title,
        connectionId: item.connectionId || '',
        database: item.database || '',
        schema: item.schema || '',
        table: item.table || '',
      });
      return;
    }

    if (item.kind === 'connection' && item.connectionId) {
      const conn = connections.find((c) => c.id === item.connectionId);
      if (conn) {
        setActiveConnection(conn.id, conn.databaseName || 'main', conn.driver === 'postgres' ? 'public' : 'main');
      }
    }
  };

  if (!isSearchEverywhereOpen) return null;

  const isSettingsMatch =
    query.trim() &&
    ('settings'.includes(query.toLowerCase()) ||
      'preferences'.includes(query.toLowerCase()) ||
      'config'.includes(query.toLowerCase()) ||
      'pagination'.includes(query.toLowerCase()) ||
      'lazy'.includes(query.toLowerCase()));

  return (
    <div
      onClick={() => setSearchEverywhereOpen(false)}
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[640px] rounded-lg bg-[#191a20] border border-[#272932] shadow-2xl overflow-hidden text-xs"
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-2 border-b border-[#272932] px-3.5 py-2.5 bg-[#14151a]">
          <Search className="h-4 w-4 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search all connections, tables, views, consoles everywhere..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <span className="text-[10px] text-zinc-500 font-mono">
            {connections.length} {connections.length === 1 ? 'connection' : 'connections'}
          </span>
          <kbd className="rounded bg-[#22242c] px-1.5 py-0.5 text-[10px] text-zinc-400 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div ref={listRef} className="max-h-96 overflow-auto p-1.5">
          {isSettingsMatch && (
            <div
              onClick={() => {
                setSearchEverywhereOpen(false);
                useSettingsStore.getState().openSettings();
              }}
              className="flex items-center justify-between rounded px-3 py-2 hover:bg-[#22242c] cursor-pointer text-zinc-300 hover:text-white border-b border-[#272932] mb-1"
            >
              <div className="flex items-center gap-2">
                <SettingsIcon className="h-3.5 w-3.5 text-zinc-400" />
                <span className="font-semibold text-zinc-200">Open Settings & Preferences</span>
                <span className="text-zinc-500 text-[11px]">Configure Lazy Load, Pagination & Batch size</span>
              </div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-300 bg-[#22242c] px-1.5 py-0.5 rounded border border-[#272932]">
                Action
              </span>
            </div>
          )}

          {results.length === 0 ? (
            <div className="py-8 text-center text-zinc-500 text-xs">
              {query ? 'No matching symbols found across all connections' : 'Type to search tables, views, consoles, and connections...'}
            </div>
          ) : (
            results.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const conn = item.connectionId ? connections.find((c) => c.id === item.connectionId) : null;

              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectItem(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between rounded px-3 py-2 cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#22242c] text-white ring-1 ring-zinc-700/60' : 'text-zinc-300 hover:bg-[#1f2026]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                    {item.kind === 'table' && <Table className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                    {item.kind === 'view' && <Table className="h-3.5 w-3.5 text-teal-400 shrink-0" />}
                    {item.kind === 'console' && <FileCode className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                    {item.kind === 'connection' && <DbDriverIcon driver={conn?.driver} className="h-3.5 w-3.5 shrink-0" />}

                    <span className="font-medium text-zinc-100 truncate">{item.title}</span>

                    {conn && item.kind !== 'connection' && (
                      <span className="flex items-center gap-1 text-[11px] text-zinc-400 font-mono shrink-0">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: conn.colorTag || '#71717a' }}
                        />
                        <span className="text-zinc-400">{conn.name}</span>
                      </span>
                    )}

                    <span className="text-zinc-500 text-[11px] font-mono truncate">
                      {item.subtitle}
                    </span>
                  </div>

                  <span className="text-[9px] uppercase tracking-wider text-zinc-400 bg-[#121317] px-1.5 py-0.5 rounded border border-[#272932] shrink-0 font-mono">
                    {item.badge}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts hint */}
        <div className="flex items-center justify-between border-t border-[#272932] px-3 py-1.5 bg-[#14151a] text-[10px] text-zinc-500 font-mono">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <span>Search Everywhere (All Connections)</span>
        </div>
      </div>
    </div>
  );
};
