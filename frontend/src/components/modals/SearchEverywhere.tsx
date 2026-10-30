import React, { useEffect, useState } from 'react';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { SchemaService } from '../../../bindings/dhub/internal/services';
import { Search, Table, Database, Terminal, FileCode } from 'lucide-react';

export const SearchEverywhere: React.FC = () => {
  const { isSearchEverywhereOpen, setSearchEverywhereOpen, openTab } = useWorkbenchStore();
  const { activeConnectionId } = useConnectionStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Double Shift detection or Ctrl+Shift+N
      if (e.key === 'Shift') {
        // Handled via custom hook or global listener
      }
      if (e.key === 'Escape' && isSearchEverywhereOpen) {
        setSearchEverywhereOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchEverywhereOpen]);

  useEffect(() => {
    if (!query.trim() || !activeConnectionId) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const matches = await SchemaService.SearchEverywhere(activeConnectionId, query);
        setResults(matches || []);
      } catch (e) {
        console.error(e);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [query, activeConnectionId]);

  if (!isSearchEverywhereOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-xs">
      <div className="w-[620px] rounded-lg bg-[#191a20] border border-[#272932] shadow-2xl overflow-hidden text-xs">
        {/* Search Input Bar */}
        <div className="flex items-center gap-2 border-b border-[#272932] px-3 py-2.5 bg-[#14151a]">
          <Search className="h-4 w-4 text-blue-400 shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder="Search tables, columns, symbols everywhere..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <kbd className="rounded bg-[#22242c] px-1.5 py-0.5 text-[10px] text-zinc-400 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-auto p-2">
          {results.length === 0 ? (
            <div className="py-6 text-center text-zinc-500 text-xs">
              {query ? 'No matching database symbols found' : 'Type to search tables, views, and schemas'}
            </div>
          ) : (
            results.map((item, idx) => (
              <div
                key={idx}
                onClick={() => {
                  openTab({
                    id: `table-${item.connectionId}-${item.objectName}`,
                    type: 'table_data',
                    title: item.objectName,
                    connectionId: item.connectionId,
                    database: item.databaseName,
                    schema: item.schemaName,
                    table: item.objectName,
                  });
                  setSearchEverywhereOpen(false);
                }}
                className="flex items-center justify-between rounded px-3 py-2 hover:bg-[#22242c] cursor-pointer text-zinc-300 hover:text-white"
              >
                <div className="flex items-center gap-2">
                  <Table className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="font-semibold text-zinc-200">{item.objectName}</span>
                  <span className="text-zinc-500 text-[11px] font-mono">
                    {item.databaseName}.{item.schemaName}
                  </span>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 bg-[#121317] px-1.5 py-0.5 rounded border border-[#272932]">
                  {item.objectType}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

