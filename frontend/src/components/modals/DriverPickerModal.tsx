import React, { useState, useEffect, useRef } from 'react';
import { X, Search, Check, Database } from 'lucide-react';
import { DbDriverIcon } from '../common/DbDriverIcon';

export type DriverType = 'sqlite' | 'postgres' | 'mysql' | 'mariadb' | 'redis' | 'mssql' | 'mongodb' | 'clickhouse' | 'oracle' | 'qdrant' | 'elasticsearch';

export type DriverCategory =
  | 'Relational'
  | 'Document'
  | 'Key-Value'
  | 'Column-Oriented'
  | 'Vector'
  | 'Search';

export type DriverTag =
  | 'SQL'
  | 'OLAP'
  | 'Document'
  | 'Key-Value'
  | 'Vector'
  | 'Search';

export interface DriverOption {
  id: DriverType;
  name: string;
  category: DriverCategory;
  tag: DriverTag;
  group: 'Relational (SQL)' | 'Analytical & Columnar (OLAP)' | 'NoSQL & Search Engines';
  description: string;
}

export const DRIVER_OPTIONS: DriverOption[] = [
  {
    id: 'sqlite',
    name: 'SQLite',
    category: 'Relational',
    tag: 'SQL',
    group: 'Relational (SQL)',
    description: 'Lightweight local file-based database',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'Relational',
    tag: 'SQL',
    group: 'Relational (SQL)',
    description: 'Advanced open-source relational database',
  },
  {
    id: 'mysql',
    name: 'MySQL',
    category: 'Relational',
    tag: 'SQL',
    group: 'Relational (SQL)',
    description: 'Fast, reliable and widely used relational database',
  },
  {
    id: 'mariadb',
    name: 'MariaDB',
    category: 'Relational',
    tag: 'SQL',
    group: 'Relational (SQL)',
    description: 'Community-developed fork of MySQL',
  },
  {
    id: 'mssql',
    name: 'SQL Server',
    category: 'Relational',
    tag: 'SQL',
    group: 'Relational (SQL)',
    description: 'Microsoft enterprise relational database',
  },
  {
    id: 'oracle',
    name: 'Oracle',
    category: 'Relational',
    tag: 'SQL',
    group: 'Relational (SQL)',
    description: 'Enterprise multi-model relational database',
  },
  {
    id: 'clickhouse',
    name: 'ClickHouse',
    category: 'Column-Oriented',
    tag: 'OLAP',
    group: 'Analytical & Columnar (OLAP)',
    description: 'Blazing-fast column-oriented analytical database',
  },
  {
    id: 'mongodb',
    name: 'MongoDB',
    category: 'Document',
    tag: 'Document',
    group: 'NoSQL & Search Engines',
    description: 'High-performance document-oriented NoSQL database',
  },
  {
    id: 'redis',
    name: 'Redis',
    category: 'Key-Value',
    tag: 'Key-Value',
    group: 'NoSQL & Search Engines',
    description: 'Ultra-fast in-memory data store and cache',
  },
  {
    id: 'qdrant',
    name: 'Qdrant',
    category: 'Vector',
    tag: 'Vector',
    group: 'NoSQL & Search Engines',
    description: 'High-performance vector similarity search engine',
  },
  {
    id: 'elasticsearch',
    name: 'Elasticsearch',
    category: 'Search',
    tag: 'Search',
    group: 'NoSQL & Search Engines',
    description: 'Distributed full-text search, analytics, and kNN vector engine',
  },
];

export const getDriverTagStyle = (tag: DriverTag): string => {
  switch (tag) {
    case 'SQL':
      return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
    case 'OLAP':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'Document':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'Key-Value':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    case 'Vector':
      return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
    case 'Search':
      return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    default:
      return 'bg-zinc-800/80 text-zinc-400 border-zinc-700/50';
  }
};

export const getDriverOption = (id: string): DriverOption => {
  return (
    DRIVER_OPTIONS.find((d) => d.id === id) || {
      id: (id as DriverType) || 'sqlite',
      name: id.toUpperCase(),
      category: 'Relational',
      tag: 'SQL',
      group: 'Relational (SQL)',
      description: 'Database driver',
    }
  );
};

interface DriverPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDriver: DriverType;
  onSelectDriver: (driver: DriverType) => void;
}

export const DriverPickerModal: React.FC<DriverPickerModalProps> = ({
  isOpen,
  onClose,
  selectedDriver,
  onSelectDriver,
}) => {
  const [search, setSearch] = useState('');
  const [activeGroup, setActiveGroup] = useState<'All' | DriverOption['group']>('All');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setActiveGroup('All');
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filtered = DRIVER_OPTIONS.filter((d) => {
    if (activeGroup !== 'All' && d.group !== activeGroup) return false;
    const q = search.toLowerCase().trim();
    if (!q) return true;
    const isNoSqlMatch =
      (q === 'nosql' || q === 'non sql' || q === 'non-sql') && d.tag !== 'SQL';
    return (
      isNoSqlMatch ||
      d.name.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q) ||
      d.tag.toLowerCase().includes(q) ||
      d.category.toLowerCase().includes(q) ||
      d.group.toLowerCase().includes(q) ||
      d.id.toLowerCase().includes(q)
    );
  });

  const GROUPS: DriverOption['group'][] = [
    'Relational (SQL)',
    'Analytical & Columnar (OLAP)',
    'NoSQL & Search Engines',
  ];

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl flex-col rounded-xl bg-[#191a20] border border-[#2e313d] shadow-2xl overflow-hidden text-xs text-zinc-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#272932] px-5 py-3.5 bg-[#14151a]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-zinc-100">Select Database Driver</h3>
              <p className="text-[11px] text-zinc-400">
                Choose the database engine you want to connect with
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search Bar & Category Filter Pills */}
        <div className="px-5 pt-4 pb-2 space-y-2.5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter drivers (e.g. postgres, olap, vector, document, key-value)..."
              className="w-full pl-9 pr-8 py-2 rounded-lg bg-[#14151a] border border-[#2e313d] text-zinc-200 placeholder-zinc-500 text-xs focus:outline-none focus:border-blue-500 transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-0.5 rounded cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(['All', ...GROUPS] as const).map((grp) => {
              const isActive = activeGroup === grp;
              const count =
                grp === 'All'
                  ? DRIVER_OPTIONS.length
                  : DRIVER_OPTIONS.filter((d) => d.group === grp).length;
              return (
                <button
                  key={grp}
                  type="button"
                  onClick={() => setActiveGroup(grp)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-blue-500/15 border-blue-500/50 text-blue-300'
                      : 'bg-[#14151a] border-[#272932] text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
                  }`}
                >
                  <span>{grp}</span>
                  <span
                    className={`text-[9px] font-mono px-1 rounded ${
                      isActive ? 'bg-blue-500/25 text-blue-200' : 'bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Driver Grid Grouped by Category */}
        <div className="p-5 pt-2 max-h-[62vh] overflow-y-auto space-y-4">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-zinc-500">
              <Database className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No drivers match &quot;{search}&quot;</p>
            </div>
          ) : (
            GROUPS.map((grp) => {
              const groupDrivers = filtered.filter((d) => d.group === grp);
              if (groupDrivers.length === 0) return null;
              return (
                <div key={grp} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      {grp}
                    </span>
                    <span className="text-[10px] text-zinc-600 font-mono">
                      {groupDrivers.length} {groupDrivers.length === 1 ? 'engine' : 'engines'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                    {groupDrivers.map((d) => {
                      const isSelected = selectedDriver === d.id;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            onSelectDriver(d.id);
                            onClose();
                          }}
                          className={`group relative flex flex-col items-center justify-between p-3 rounded-xl border text-center transition-all cursor-pointer min-h-[104px] ${
                            isSelected
                              ? 'border-blue-500 bg-blue-500/15 shadow-sm shadow-blue-500/20 ring-1 ring-blue-500/60'
                              : 'border-[#272932] bg-[#14151a] hover:bg-[#1f212a] hover:border-zinc-500 hover:shadow-md'
                          }`}
                        >
                          {/* Selected Badge */}
                          {isSelected && (
                            <div className="absolute top-2 right-2 flex items-center justify-center h-4 w-4 rounded-full bg-blue-500 text-white">
                              <Check className="h-2.5 w-2.5 stroke-[3]" />
                            </div>
                          )}

                          {/* Logo */}
                          <div className="h-9 w-9 flex items-center justify-center my-0.5 group-hover:scale-110 transition-transform">
                            <DbDriverIcon driver={d.id} className="h-7 w-7" />
                          </div>

                          {/* Name & Specific Tag */}
                          <div className="w-full mt-1">
                            <div className="font-semibold text-xs text-zinc-200 group-hover:text-white truncate">
                              {d.name}
                            </div>
                            <div className="flex items-center justify-center gap-1 mt-1">
                              <span
                                className={`text-[9px] font-mono font-medium px-1.5 py-0.2 rounded border ${getDriverTagStyle(
                                  d.tag
                                )}`}
                              >
                                {d.tag}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#272932] px-5 py-3 bg-[#14151a] text-zinc-500 text-[11px]">
          <span>{DRIVER_OPTIONS.length} database engines supported</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-[#272932] hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

