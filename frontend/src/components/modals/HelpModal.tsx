import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  HelpCircle,
  BookOpen,
  Rocket,
  Database,
  Terminal,
  Table,
  Wrench,
  Command,
  MessageCircleQuestion,
  Search,
  Copy,
  Check,
  Plus,
  Shield,
  KeyRound,
  GitCompare,
  Layers,
  Sparkles,
  ArrowRight,
  ArrowDownUp,
  Settings as SettingsIcon,
  Play,
  AlertTriangle,
  Eye,
  Filter,
  Users,
  Lock,
} from 'lucide-react';
import { useWorkbenchStore, HelpTab } from '../../stores/useWorkbenchStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { alertSuccess } from '../../stores/useAlertStore';
import { DbDriverIcon } from '../common/DbDriverIcon';
import { APP_VERSION } from '../../version';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || '');

interface SnippetItem {
  label: string;
  code: string;
  description?: string;
}

interface SearchableTopic {
  id: string;
  tab: HelpTab;
  tabLabel: string;
  title: string;
  keywords: string[];
  summary: string;
  bullets?: string[];
  snippets?: SnippetItem[];
}

const HELP_TABS: Array<{ id: HelpTab; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'quickstart', label: 'Quick Start', icon: Rocket },
  { id: 'databases', label: 'Database Engines', icon: Database },
  { id: 'editor', label: 'Query Console', icon: Terminal },
  { id: 'datagrid', label: 'Data Grid & Editing', icon: Table },
  { id: 'tools', label: 'Tools & Security', icon: Wrench },
  { id: 'shortcuts', label: 'Shortcuts', icon: Command },
  { id: 'faq', label: 'FAQ & Troubleshooting', icon: MessageCircleQuestion },
];

const MONGODB_SNIPPETS: SnippetItem[] = [
  {
    label: 'Find Documents (Mongo Shell)',
    code: 'db.users.find({ "status": "active" });',
    description: 'Query documents using standard JSON filter syntax (returns up to 100 docs).',
  },
  {
    label: 'Count Documents',
    code: 'db.users.countDocuments({ "role": "admin" });',
    description: 'Count matching documents inside a collection.',
  },
  {
    label: 'Insert One Document',
    code: 'db.users.insertOne({ "name": "Alice", "role": "editor", "active": true });',
    description: 'Insert a new JSON/BSON document into the collection.',
  },
  {
    label: 'Delete One / Many Documents',
    code: 'db.users.deleteOne({ "_id": "65f1a2b3c4d5e6f7a8b9c0d1" });\n-- Or delete multiple:\ndb.users.deleteMany({ "archived": true });',
    description: 'Remove documents matching a filter (ObjectId hex strings are parsed automatically).',
  },
  {
    label: 'SQL-Like Collection Query',
    code: "SELECT name, email FROM users WHERE status = 'active' LIMIT 50 OFFSET 0;",
    description: 'Run familiar SELECT / COUNT(*) queries against MongoDB collections.',
  },
  {
    label: 'Discovery & Raw JSON Commands',
    code: 'SHOW DBS;\nSHOW COLLECTIONS;\n{ "ping": 1 }',
    description: 'List databases/collections or run raw MongoDB database commands.',
  },
];

const REDIS_SNIPPETS: SnippetItem[] = [
  {
    label: 'Browse Keys via Pseudo-SQL',
    code: 'SELECT * FROM keys;\nSELECT COUNT(*) FROM keys;',
    description: 'Inspect scanned keys with type, TTL, size, and value columns.',
  },
  {
    label: 'Inspect a Specific Key as Table',
    code: 'SELECT * FROM "user:1001";',
    description: 'Automatically formats hash, list, set, zset, or string keys as grid rows.',
  },
  {
    label: 'String Operations (CLI)',
    code: 'GET user:1001\nSET session:xyz "active" EX 3600\nTTL session:xyz',
    description: 'Execute native Redis CLI commands directly (one command per line or semicolon).',
  },
  {
    label: 'Hash, List & Sorted Set Commands',
    code: 'HGETALL user:profile:1001\nLPUSH jobs:queue "payload"\nZRANGE leaderboard 0 9 WITHSCORES',
    description: 'Run structured collection commands and inspect formatted results.',
  },
  {
    label: 'Server Diagnostics',
    code: 'INFO server\nDBSIZE',
    description: 'Inspect Redis server status and database key count.',
  },
];

const SQL_SNIPPETS: SnippetItem[] = [
  {
    label: 'Dynamic Named Parameters',
    code: 'SELECT * FROM orders\nWHERE customer_id = :customer_id\n  AND status = :status\nLIMIT 100;',
    description: 'DHub prompts you to enter parameter values interactively before running.',
  },
  {
    label: 'Positional Parameters ($1 / ?)',
    code: 'SELECT id, email FROM users WHERE id = $1;',
    description: 'Supports PostgreSQL-style ($1, $2) and standard (?) parameter placeholders.',
  },
  {
    label: 'Explain Execution Plan',
    code: 'SELECT * FROM orders WHERE created_at >= CURRENT_DATE - INTERVAL \'7 days\';',
    description: 'Use the Explain button in the toolbar to visualize query execution costs.',
  },
];

const KEYBOARD_SHORTCUT_GROUPS: Array<{
  title: string;
  items: Array<{ action: string; win: string; mac: string }>;
}> = [
  {
    title: 'Global & Navigation',
    items: [
      { action: 'Open Help & User Guide', win: 'F1', mac: 'F1' },
      { action: 'Search Everywhere', win: 'Ctrl+P / Double Shift', mac: '⌘P / Double Shift' },
      { action: 'Toggle Left Sidebar (Explorer / Workspaces)', win: 'Ctrl+B', mac: '⌘B' },
      { action: 'Toggle Right Sidebar (Consoles / Views)', win: 'Ctrl+R', mac: '⌘R' },
      { action: 'Open Settings & Preferences', win: 'Ctrl+,', mac: '⌘,' },
      { action: 'Close Active Tab', win: 'Ctrl+W', mac: '⌘W' },
    ],
  },
  {
    title: 'Query Console & SQL Editor',
    items: [
      { action: 'Execute Query at Cursor / Selection', win: 'Ctrl+Enter', mac: '⌘Enter' },
      { action: 'Stop Running Query', win: 'Ctrl+F2', mac: '⌘F2' },
      { action: 'Format SQL Code', win: 'Shift+Alt+F', mac: 'Shift+Alt+F' },
      { action: 'Revert / Close Popovers & Modals', win: 'Esc', mac: 'Esc' },
    ],
  },
  {
    title: 'Data Grid & Cell Editing',
    items: [
      { action: 'Apply Staged Grid Changes', win: 'Ctrl+S', mac: '⌘S' },
      { action: 'Duplicate Active Row', win: 'Ctrl+D', mac: '⌘D' },
      { action: 'Delete Active Row', win: 'Delete', mac: '⌘⌫' },
      { action: 'Toggle Cell Value Viewer (Views)', win: 'F7', mac: 'F7' },
      { action: 'Revert Unsaved Cell / Grid Edits', win: 'Esc', mac: 'Esc' },
    ],
  },
];

const FAQ_ITEMS: Array<{ q: string; a: string; tags: string[] }> = [
  {
    q: "Why can't I edit cells in a table or query result?",
    a: 'Inline editing is enabled only when: (1) the connection is NOT set to Read-Only in Connection Settings, and (2) the result comes from a single table/collection with an identified Primary Key (or `_id` in MongoDB). Joined or aggregated query outputs are read-only by design.',
    tags: ['edit', 'read only', 'primary key', 'grid'],
  },
  {
    q: 'Why are some databases missing from Explorer or Search Everywhere?',
    a: 'Check whether a Database Visibility Filter is active on that connection. Click the `X of Y` badge next to the connection name in Database Explorer to show or hide specific databases.',
    tags: ['database', 'filter', 'hidden', 'missing', 'explorer'],
  },
  {
    q: 'How does SSH Host Key Verification (TOFU) work?',
    a: 'DHub uses Trust-On-First-Use (TOFU) against its own isolated `known_hosts` store. On the first SSH tunnel connection, the host key fingerprint is saved. If a server key changes unexpectedly later, DHub rejects the connection to guard against man-in-the-middle attacks.',
    tags: ['ssh', 'tunnel', 'known_hosts', 'fingerprint', 'security'],
  },
  {
    q: 'How do MongoDB and Redis work inside the SQL Console?',
    a: 'Both NoSQL drivers support native syntax and SQL-like convenience queries. In MongoDB, you can run `db.<collection>.find(...)`, `countDocuments(...)`, `insertOne(...)`, `deleteOne(...)`, raw JSON commands, or `SELECT * FROM <collection>`. In Redis, you can run native CLI commands (`GET`, `SET`, `HGETALL`, `ZRANGE`, `INFO`) or `SELECT * FROM keys;`.',
    tags: ['mongodb', 'redis', 'nosql', 'syntax', 'console'],
  },
  {
    q: 'Where are my connections, passwords, and worksheets stored?',
    a: 'Connections, folders, worksheets, snippets, workspaces, and query history are persisted locally in DHub’s SQLite database. Passwords and SSH credentials are stored in your OS Keyring whenever available, with encrypted AES-GCM fallback.',
    tags: ['storage', 'sqlite', 'keyring', 'password', 'backup'],
  },
  {
    q: 'What happens if I close a tab with an uncommitted manual transaction?',
    a: 'DHub automatically issues a rollback on the open transaction when the worksheet tab is closed, ensuring uncommitted locks are not left dangling on your database server.',
    tags: ['transaction', 'rollback', 'manual', 'commit'],
  },
];

const SEARCHABLE_TOPICS: SearchableTopic[] = [
  {
    id: 'qs-workflow',
    tab: 'quickstart',
    tabLabel: 'Quick Start',
    title: '5-Step Getting Started Workflow',
    keywords: ['start', 'onboarding', 'connect', 'create connection', 'begin'],
    summary:
      'Create a connection in Explorer, test connectivity, browse databases & schemas, inspect table rows in the Data Grid, and run queries in the SQL/NoSQL Console.',
    bullets: [
      'Click + in Database Explorer or New Connection on the empty workbench.',
      'Choose one of the 8 supported drivers (SQLite, PostgreSQL, MySQL, MariaDB, SQL Server, ClickHouse, MongoDB, Redis).',
      'Tag your environment as Local, Development (DEV), or Production (PROD) for color-coded safety cues.',
      'Double-click a table or collection to view and edit rows, or right-click to open a Query Console.',
    ],
  },
  {
    id: 'qs-layout',
    tab: 'quickstart',
    tabLabel: 'Quick Start',
    title: 'Workspace Layout & Panels',
    keywords: ['sidebar', 'explorer', 'workspaces', 'bottom panel', 'consoles', 'views', 'layout'],
    summary:
      'DHub organizes your workspace into a collapsible Left Sidebar (Explorer & Workspaces), Center Workbench (Tabs & Editor/Grid), Bottom Services Panel (Results, Output, History, Explain), and Right Sidebar (Consoles & Value Viewer).',
  },
  {
    id: 'db-sql',
    tab: 'databases',
    tabLabel: 'Database Engines',
    title: 'Relational SQL Engines (PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, ClickHouse)',
    keywords: ['postgres', 'mysql', 'mariadb', 'sqlite', 'mssql', 'sql server', 'clickhouse', 'sql'],
    summary:
      'Full schema introspection, multi-database browsing, dialect-aware formatting, and explain plans across all 6 SQL drivers.',
    snippets: SQL_SNIPPETS,
  },
  {
    id: 'db-mongodb',
    tab: 'databases',
    tabLabel: 'Database Engines',
    title: 'MongoDB Document Query Guide',
    keywords: ['mongodb', 'mongo', 'nosql', 'bson', 'find', 'insertone', 'deleteone', 'collection'],
    summary:
      'Browse collections with inferred BSON schemas and indexes. Run Mongo Shell methods, SQL-like SELECT queries, SHOW commands, or raw JSON commands.',
    snippets: MONGODB_SNIPPETS,
  },
  {
    id: 'db-redis',
    tab: 'databases',
    tabLabel: 'Database Engines',
    title: 'Redis Key-Value Query Guide',
    keywords: ['redis', 'keys', 'hash', 'list', 'set', 'zset', 'ttl', 'cli', 'flush'],
    summary:
      'Switch between logical databases db0–db15, inspect keys by type & TTL, manage keys via modals, and run Redis CLI commands or pseudo-SQL.',
    snippets: REDIS_SNIPPETS,
  },
  {
    id: 'ed-features',
    tab: 'editor',
    tabLabel: 'Query Console',
    title: 'Smart Autocomplete, Parameters & Transactions',
    keywords: ['autocomplete', 'parameter', 'transaction', 'commit', 'rollback', 'explain', 'history', 'snippets', 'dangerous'],
    summary:
      'Write queries faster with alias/FK-aware autocomplete, interactive :param / $1 / ? prompts, manual Commit/Rollback transactions, dangerous query guards, and visual Explain Plans.',
    bullets: [
      'Execute statement at cursor or selected text with Ctrl+Enter / ⌘Enter.',
      'Toggle Tx: AUTO / Tx: MANUAL in the worksheet toolbar to control transactions.',
      'Dangerous Query Protection warns before UPDATE or DELETE without WHERE.',
      'Click Format (Shift+Alt+F) to format SQL in the active dialect.',
    ],
  },
  {
    id: 'grid-editing',
    tab: 'datagrid',
    tabLabel: 'Data Grid & Editing',
    title: 'Pagination, Lazy Load, Inline Editing & Smart Copy',
    keywords: ['grid', 'pagination', 'lazy load', 'where', 'sort', 'freeze', 'dml', 'preview', 'copy', 'csv', 'json', 'upsert', 'import', 'export', 'mock', 'f7'],
    summary:
      'Inspect millions of rows smoothly with virtual scrolling, filter with WHERE clauses, edit cells inline with DML preview, and copy or export in CSV, JSON, or SQL formats.',
    bullets: [
      'Double-click a cell to edit, Ctrl+D to duplicate a row, Delete to stage deletion.',
      'Click Preview SQL to inspect generated statements before pressing Ctrl+S / ⌘S to apply.',
      'Press F7 on any cell to view/edit long text or JSON in the Value Viewer panel.',
      'Choose Copy Format (CSV, JSON, SQL INSERT, SQL UPDATE, SQL UPSERT) from the toolbar.',
    ],
  },
  {
    id: 'tools-security',
    tab: 'tools',
    tabLabel: 'Tools & Security',
    title: 'ER Diagrams, Schema Diff, User Manager, SSH/SSL & Backup',
    keywords: ['er diagram', 'schema diff', 'users', 'privileges', 'ssh', 'ssl', 'tls', 'keyring', 'backup', 'export', 'import', 'workspaces', 'prod', 'dev'],
    summary:
      'Visualize entity relationships, compare schemas to generate migration SQL, manage DB users, secure connections with SSH/SSL/Read-Only/PROD guards, and export JSON backups.',
  },
  {
    id: 'shortcuts-all',
    tab: 'shortcuts',
    tabLabel: 'Shortcuts',
    title: 'Global, Editor & Data Grid Keyboard Shortcuts',
    keywords: ['shortcut', 'hotkey', 'keybinding', 'f1', 'f7', 'ctrl', 'cmd'],
    summary: 'Complete keyboard shortcut reference for Windows, Linux, and macOS.',
  },
  ...FAQ_ITEMS.map((item, idx) => ({
    id: `faq-${idx}`,
    tab: 'faq' as HelpTab,
    tabLabel: 'FAQ & Troubleshooting',
    title: item.q,
    keywords: item.tags,
    summary: item.a,
  })),
];

const SnippetBlock: React.FC<{
  item: SnippetItem;
  canInsert: boolean;
  onInsert: (code: string) => void;
}> = ({ item, canInsert, onInsert }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(item.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="rounded-lg border border-[#272932] bg-[#14151a] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1a1b22] border-b border-[#272932]">
        <span className="text-[11px] font-semibold text-zinc-200">{item.label}</span>
        <div className="flex items-center gap-1.5">
          {canInsert && (
            <button
              type="button"
              onClick={() => onInsert(item.code)}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-600/20 hover:bg-blue-600/35 border border-blue-500/40 text-blue-300 text-[10px] font-medium transition-colors cursor-pointer"
              title="Insert snippet into active Query Console"
            >
              <Play className="h-2.5 w-2.5" />
              <span>Insert</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
              copied
                ? 'bg-emerald-600/25 border-emerald-500/40 text-emerald-300'
                : 'bg-[#22242c] hover:bg-[#2a2d37] border-[#2e313d] text-zinc-300'
            }`}
            title="Copy snippet to clipboard"
          >
            {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <pre className="p-2.5 text-[11px] font-mono text-sky-300 overflow-x-auto leading-relaxed whitespace-pre-wrap">
        {item.code}
      </pre>
      {item.description && (
        <div className="px-3 py-1.5 text-[11px] text-zinc-400 border-t border-[#20222a] bg-[#16171d]">
          {item.description}
        </div>
      )}
    </div>
  );
};

export const HelpModal: React.FC = () => {
  const {
    isHelpModalOpen,
    activeHelpTab,
    openHelpModal,
    closeHelpModal,
    tabs,
    activeTabId,
    updateTabContent,
    setSearchEverywhereOpen,
    setConnectionDialogOpen,
  } = useWorkbenchStore();

  const { openSettings } = useSettingsStore();
  const { connections, activeConnectionId } = useConnectionStore();

  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const canInsertToConsole = activeTab?.type === 'worksheet';

  const handleInsertToConsole = (code: string) => {
    if (!activeTab || activeTab.type !== 'worksheet') return;
    const current = activeTab.content || '';
    const next = current.trim() ? `${current.trimEnd()}\n\n${code}\n` : `${code}\n`;
    updateTabContent(activeTab.id, next);
    alertSuccess(`Inserted example into "${activeTab.title}"`);
    closeHelpModal();
  };

  useEffect(() => {
    if (isHelpModalOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 60);
    } else {
      setSearchQuery('');
    }
  }, [isHelpModalOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isHelpModalOpen) {
        e.preventDefault();
        closeHelpModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHelpModalOpen, closeHelpModal]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return SEARCHABLE_TOPICS.filter((topic) => {
      return (
        topic.title.toLowerCase().includes(q) ||
        topic.summary.toLowerCase().includes(q) ||
        topic.tabLabel.toLowerCase().includes(q) ||
        topic.keywords.some((k) => k.toLowerCase().includes(q)) ||
        (topic.bullets && topic.bullets.some((b) => b.toLowerCase().includes(q))) ||
        (topic.snippets &&
          topic.snippets.some(
            (s) =>
              s.label.toLowerCase().includes(q) ||
              s.code.toLowerCase().includes(q) ||
              (s.description || '').toLowerCase().includes(q)
          ))
      );
    });
  }, [searchQuery]);

  if (!isHelpModalOpen) return null;

  const activeConn = connections.find((c) => c.id === (activeTab?.connectionId || activeConnectionId));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs select-none p-4 animate-in fade-in duration-150"
      onClick={closeHelpModal}
    >
      <div
        className="w-full max-w-4xl rounded-xl bg-[#181920] border border-[#2b2e3a] shadow-2xl overflow-hidden flex flex-col max-h-[88vh] h-[680px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-col gap-2.5 border-b border-[#272932] px-5 py-3.5 bg-[#14151a] shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400">
                <BookOpen className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  <span>DHub Help &amp; User Guide</span>
                  {activeConn && (
                    <span className="inline-flex items-center gap-1 rounded bg-[#1e2027] border border-[#2e313d] px-1.5 py-0.5 text-[10px] font-mono text-zinc-300 font-normal">
                      <DbDriverIcon driver={activeConn.driver} className="h-3 w-3" />
                      <span>Active: {activeConn.name}</span>
                    </span>
                  )}
                </h2>
                <p className="text-[11px] text-zinc-400">
                  Interactive documentation, engine query syntax, keyboard shortcuts, and troubleshooting
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <kbd className="hidden sm:inline-block rounded bg-[#22242c] px-1.5 py-0.5 text-[10px] text-zinc-400 font-mono border border-[#2d303d]">
                F1
              </kbd>
              <kbd className="hidden sm:inline-block rounded bg-[#22242c] px-1.5 py-0.5 text-[10px] text-zinc-400 font-mono border border-[#2d303d]">
                ESC
              </kbd>
              <button
                type="button"
                onClick={closeHelpModal}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[#252834] transition-colors cursor-pointer"
                title="Close Help"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search guide topics, MongoDB/Redis commands, shortcuts, or FAQ..."
              className="w-full rounded-lg bg-[#121317] border border-[#2b2e3a] pl-9 pr-8 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left Navigation */}
          <div className="w-52 border-r border-[#272932] bg-[#14151a]/60 p-2.5 flex flex-col gap-1 shrink-0 overflow-y-auto">
            {HELP_TABS.map((tab) => {
              const Icon = tab.icon;
              const isSelected = !searchQuery.trim() && activeHelpTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    openHelpModal(tab.id);
                  }}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#20222b]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Content Pane */}
          <div className="flex-1 p-5 overflow-y-auto min-h-0 text-xs select-text space-y-5">
            {searchQuery.trim() ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Search Results ({searchResults.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer"
                  >
                    Clear Filter
                  </button>
                </div>

                {searchResults.length === 0 ? (
                  <div className="rounded-xl border border-[#272932] bg-[#14151a] p-8 text-center text-zinc-500">
                    No help topics matched &quot;{searchQuery}&quot;. Try keywords like{' '}
                    <span className="text-zinc-300">mongodb</span>,{' '}
                    <span className="text-zinc-300">redis</span>,{' '}
                    <span className="text-zinc-300">ssh</span>, or{' '}
                    <span className="text-zinc-300">shortcut</span>.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {searchResults.map((topic) => (
                      <div
                        key={topic.id}
                        className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-xs font-semibold text-zinc-100">{topic.title}</h4>
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery('');
                              openHelpModal(topic.tab);
                            }}
                            className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded bg-[#14151a] border border-[#2e313d] text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer"
                          >
                            <span>{topic.tabLabel}</span>
                            <ArrowRight className="h-2.5 w-2.5" />
                          </button>
                        </div>
                        <p className="text-[11px] text-zinc-300 leading-relaxed">{topic.summary}</p>
                        {topic.bullets && (
                          <ul className="list-disc pl-4 space-y-1 text-[11px] text-zinc-400">
                            {topic.bullets.map((b, i) => (
                              <li key={i}>{b}</li>
                            ))}
                          </ul>
                        )}
                        {topic.snippets && topic.snippets.length > 0 && (
                          <div className="space-y-2 pt-1">
                            {topic.snippets.slice(0, 2).map((s, i) => (
                              <SnippetBlock
                                key={i}
                                item={s}
                                canInsert={canInsertToConsole}
                                onInsert={handleInsertToConsole}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* 1. QUICK START */}
                {activeHelpTab === 'quickstart' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-100">
                        Welcome to DHub Desktop
                      </h3>
                      <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                        DHub is a keyboard-first multi-database IDE supporting 8 SQL &amp; NoSQL
                        engines with high-speed virtualized grids, safe inline editing, SSH/SSL
                        tunneling, schema tools, and workspace sessions.
                      </p>
                    </div>

                    {/* Quick Actions */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          closeHelpModal();
                          setConnectionDialogOpen(true);
                        }}
                        className="flex flex-col items-start gap-1.5 p-3 rounded-xl bg-[#1e2027] hover:bg-[#252834] border border-[#2b2e3a] hover:border-blue-500/50 transition-colors text-left cursor-pointer"
                      >
                        <Plus className="h-4 w-4 text-blue-400" />
                        <span className="font-semibold text-zinc-100">New Connection</span>
                        <span className="text-[10px] text-zinc-400">Add SQL or NoSQL DB</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          closeHelpModal();
                          setSearchEverywhereOpen(true);
                        }}
                        className="flex flex-col items-start gap-1.5 p-3 rounded-xl bg-[#1e2027] hover:bg-[#252834] border border-[#2b2e3a] hover:border-blue-500/50 transition-colors text-left cursor-pointer"
                      >
                        <Search className="h-4 w-4 text-emerald-400" />
                        <span className="font-semibold text-zinc-100">Search Everywhere</span>
                        <span className="text-[10px] text-zinc-400">
                          {isMac ? '⌘P' : 'Ctrl+P'} / Double Shift
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          closeHelpModal();
                          openSettings('appearance');
                        }}
                        className="flex flex-col items-start gap-1.5 p-3 rounded-xl bg-[#1e2027] hover:bg-[#252834] border border-[#2b2e3a] hover:border-blue-500/50 transition-colors text-left cursor-pointer"
                      >
                        <SettingsIcon className="h-4 w-4 text-amber-400" />
                        <span className="font-semibold text-zinc-100">Preferences</span>
                        <span className="text-[10px] text-zinc-400">
                          Theme, Grid &amp; Editor
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          closeHelpModal();
                          openSettings('backup');
                        }}
                        className="flex flex-col items-start gap-1.5 p-3 rounded-xl bg-[#1e2027] hover:bg-[#252834] border border-[#2b2e3a] hover:border-blue-500/50 transition-colors text-left cursor-pointer"
                      >
                        <ArrowDownUp className="h-4 w-4 text-purple-400" />
                        <span className="font-semibold text-zinc-100">Import / Export</span>
                        <span className="text-[10px] text-zinc-400">Backup JSON config</span>
                      </button>
                    </div>

                    {/* 5-Step Guide */}
                    <div className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-3">
                      <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                        5-Step Quick Start
                      </h4>
                      <ol className="space-y-2.5 text-[11px] text-zinc-300">
                        <li className="flex items-start gap-2.5">
                          <span className="h-5 w-5 rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-300 font-mono text-[10px] flex items-center justify-center shrink-0">
                            1
                          </span>
                          <div>
                            <strong className="text-zinc-100">Connect to a Database:</strong> Click{' '}
                            <span className="text-zinc-100 font-medium">+</span> in the Left
                            Explorer, select an engine (e.g., PostgreSQL, MySQL, SQLite, MongoDB,
                            Redis), and run <span className="text-zinc-100 font-medium">Test Connection</span>.
                          </div>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <span className="h-5 w-5 rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-300 font-mono text-[10px] flex items-center justify-center shrink-0">
                            2
                          </span>
                          <div>
                            <strong className="text-zinc-100">Tag Your Environment:</strong> Choose{' '}
                            <span className="text-zinc-200">Local</span>,{' '}
                            <span className="text-emerald-300">DEV</span>, or{' '}
                            <span className="text-rose-300">PROD</span>. Production tabs display
                            a red safety accent and extra warnings for destructive operations.
                          </div>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <span className="h-5 w-5 rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-300 font-mono text-[10px] flex items-center justify-center shrink-0">
                            3
                          </span>
                          <div>
                            <strong className="text-zinc-100">Explore Objects:</strong> Expand
                            databases, schemas, tables, views, routines, or collections in the
                            Explorer tree. Click the <span className="font-mono text-zinc-200">X of Y</span>{' '}
                            badge to filter visible databases.
                          </div>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <span className="h-5 w-5 rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-300 font-mono text-[10px] flex items-center justify-center shrink-0">
                            4
                          </span>
                          <div>
                            <strong className="text-zinc-100">Browse &amp; Edit Data:</strong>{' '}
                            Double-click any table to open its Data Grid. Edit cells inline, preview
                            generated DML statements, and press{' '}
                            <kbd className="font-mono bg-[#14151a] px-1 rounded border border-[#2d303d]">
                              {isMac ? '⌘S' : 'Ctrl+S'}
                            </kbd>{' '}
                            to apply changes.
                          </div>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <span className="h-5 w-5 rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-300 font-mono text-[10px] flex items-center justify-center shrink-0">
                            5
                          </span>
                          <div>
                            <strong className="text-zinc-100">Run Queries:</strong> Right-click a
                            connection or database to open a Query Console, write SQL/Mongo/Redis
                            commands, and execute with{' '}
                            <kbd className="font-mono bg-[#14151a] px-1 rounded border border-[#2d303d]">
                              {isMac ? '⌘Enter' : 'Ctrl+Enter'}
                            </kbd>.
                          </div>
                        </li>
                      </ol>
                    </div>

                    {/* UI Layout Map */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-xl border border-[#272932] bg-[#14151a] p-3.5 space-y-1.5">
                        <div className="font-semibold text-zinc-200">
                          Left Sidebar ({isMac ? '⌘B' : 'Ctrl+B'})
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Switch between <strong>Explorer</strong> (connections, folders, schema
                          objects) and <strong>Workspaces</strong> (saved multi-tab sessions).
                        </p>
                      </div>
                      <div className="rounded-xl border border-[#272932] bg-[#14151a] p-3.5 space-y-1.5">
                        <div className="font-semibold text-zinc-200">
                          Right Sidebar ({isMac ? '⌘R' : 'Ctrl+R'})
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Switch between <strong>Console</strong> (saved worksheets) and{' '}
                          <strong>Views</strong> (<code>F7</code> full-cell text/JSON editor).
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. DATABASE ENGINES */}
                {activeHelpTab === 'databases' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-100">
                        Supported Database Engines &amp; Query Guides
                      </h3>
                      <p className="text-[11px] text-zinc-400 mt-1">
                        DHub ships with 8 built-in drivers. Select any example below to copy it or
                        insert it directly into your active Query Console.
                      </p>
                    </div>

                    {/* Driver Badges */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: 'postgres', name: 'PostgreSQL', port: '5432', tag: 'SQL' },
                        { id: 'mysql', name: 'MySQL', port: '3306', tag: 'SQL' },
                        { id: 'mariadb', name: 'MariaDB', port: '3306', tag: 'SQL' },
                        { id: 'sqlite', name: 'SQLite', port: 'File', tag: 'SQL' },
                        { id: 'mssql', name: 'SQL Server', port: '1433', tag: 'SQL' },
                        { id: 'clickhouse', name: 'ClickHouse', port: '9000', tag: 'OLAP' },
                        { id: 'mongodb', name: 'MongoDB', port: '27017', tag: 'NoSQL' },
                        { id: 'redis', name: 'Redis', port: '6379', tag: 'Key-Value' },
                      ].map((drv) => (
                        <div
                          key={drv.id}
                          className="flex items-center gap-2 rounded-lg border border-[#272932] bg-[#1e2027] p-2.5"
                        >
                          <DbDriverIcon driver={drv.id} className="h-4 w-4 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold text-zinc-100 text-[11px] truncate">
                              {drv.name}
                            </div>
                            <div className="text-[10px] text-zinc-500 font-mono">
                              {drv.tag} • {drv.port}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* MongoDB Guide */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <DbDriverIcon driver="mongodb" className="h-4 w-4" />
                        <h4 className="text-xs font-semibold text-zinc-100 uppercase tracking-wider">
                          MongoDB Query Guide
                        </h4>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        DHub automatically samples up to 50 documents to infer collection fields and
                        indexes. In the Query Console, you can mix <strong>Mongo Shell methods</strong>,{' '}
                        <strong>SQL-like SELECT queries</strong>, or <strong>raw JSON commands</strong>.
                      </p>
                      <div className="grid grid-cols-1 gap-2.5">
                        {MONGODB_SNIPPETS.map((s, idx) => (
                          <SnippetBlock
                            key={idx}
                            item={s}
                            canInsert={canInsertToConsole}
                            onInsert={handleInsertToConsole}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Redis Guide */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <DbDriverIcon driver="redis" className="h-4 w-4" />
                        <h4 className="text-xs font-semibold text-zinc-100 uppercase tracking-wider">
                          Redis Query &amp; Command Guide
                        </h4>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        Browse logical databases <code>db0</code>–<code>db15</code>, inspect key types
                        (<code>string</code>, <code>hash</code>, <code>list</code>, <code>set</code>,{' '}
                        <code>zset</code>) and TTLs, use context-menu tools (Add Key, Flush DB,
                        Server Info), or run CLI commands directly.
                      </p>
                      <div className="grid grid-cols-1 gap-2.5">
                        {REDIS_SNIPPETS.map((s, idx) => (
                          <SnippetBlock
                            key={idx}
                            item={s}
                            canInsert={canInsertToConsole}
                            onInsert={handleInsertToConsole}
                          />
                        ))}
                      </div>
                    </div>

                    {/* SQL Engines Guide */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <DbDriverIcon driver="postgres" className="h-4 w-4" />
                        <h4 className="text-xs font-semibold text-zinc-100 uppercase tracking-wider">
                          Relational SQL Tips
                        </h4>
                      </div>
                      <div className="grid grid-cols-1 gap-2.5">
                        {SQL_SNIPPETS.map((s, idx) => (
                          <SnippetBlock
                            key={idx}
                            item={s}
                            canInsert={canInsertToConsole}
                            onInsert={handleInsertToConsole}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. QUERY CONSOLE */}
                {activeHelpTab === 'editor' && (
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-100">
                        Query Console &amp; SQL Editor
                      </h3>
                      <p className="text-[11px] text-zinc-400 mt-1">
                        Powered by Monaco Editor with schema-aware intelligence, transaction control,
                        and safety guards.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-2">
                        <div className="flex items-center gap-2 font-semibold text-zinc-100">
                          <Sparkles className="h-4 w-4 text-blue-400" />
                          <span>Context-Aware Autocomplete</span>
                        </div>
                        <ul className="list-disc pl-4 space-y-1 text-[11px] text-zinc-400">
                          <li>Suggests tables, views, columns, and primary keys.</li>
                          <li>Resolves table aliases automatically (e.g., <code>u.email</code>).</li>
                          <li>Offers foreign-key <code>JOIN ... ON</code> conditions when joining related tables.</li>
                          <li>Includes SQL functions, snippets, and dialect-aware formatting (<code>Shift+Alt+F</code>).</li>
                        </ul>
                      </div>

                      <div className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-2">
                        <div className="flex items-center gap-2 font-semibold text-zinc-100">
                          <Terminal className="h-4 w-4 text-emerald-400" />
                          <span>Execution &amp; Parameter Prompts</span>
                        </div>
                        <ul className="list-disc pl-4 space-y-1 text-[11px] text-zinc-400">
                          <li>Runs highlighted SQL selection, or the statement at your cursor (<code>{isMac ? '⌘Enter' : 'Ctrl+Enter'}</code>).</li>
                          <li>Supports multi-statement execution with separate Result tabs in the bottom panel.</li>
                          <li>Use <code>:name</code>, <code>$1</code>, or <code>?</code> to trigger an interactive parameter input dialog.</li>
                          <li>Cancel long-running queries anytime with <code>{isMac ? '⌘F2' : 'Ctrl+F2'}</code> or the Stop button.</li>
                        </ul>
                      </div>

                      <div className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-2">
                        <div className="flex items-center gap-2 font-semibold text-zinc-100">
                          <Layers className="h-4 w-4 text-amber-400" />
                          <span>Manual vs. Auto Transactions</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Click <strong>Tx: AUTO</strong> / <strong>Tx: MANUAL</strong> in the
                          console toolbar to switch modes. In Manual mode, executing your first
                          query starts a transaction and enables <strong>Commit</strong> and{' '}
                          <strong>Rollback</strong> buttons. Closing a tab with an active
                          transaction automatically rolls it back safely.
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-2">
                        <div className="flex items-center gap-2 font-semibold text-zinc-100">
                          <AlertTriangle className="h-4 w-4 text-rose-400" />
                          <span>Dangerous Query Guard &amp; Explain</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Executing an <code>UPDATE</code> or <code>DELETE</code> without a{' '}
                          <code>WHERE</code> clause pauses and prompts for confirmation—with an
                          extra warning banner on <strong>PROD</strong> connections. Use{' '}
                          <strong>Explain / Explain Analyze</strong> in the toolbar to inspect query
                          plans.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. DATA GRID */}
                {activeHelpTab === 'datagrid' && (
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-100">
                        Data Grid, Filtering &amp; Safe Inline Editing
                      </h3>
                      <p className="text-[11px] text-zinc-400 mt-1">
                        Designed for speed and safety when inspecting and modifying table rows or
                        MongoDB documents.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-1.5">
                        <div className="font-semibold text-zinc-100 flex items-center gap-2">
                          <Layers className="h-4 w-4 text-blue-400" />
                          <span>Pagination &amp; Lazy Load</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Switch between numbered pages and continuous infinite scrolling in
                          Settings or the grid footer. Customize batch sizes from 10 up to 5000 rows.
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-1.5">
                        <div className="font-semibold text-zinc-100 flex items-center gap-2">
                          <Filter className="h-4 w-4 text-emerald-400" />
                          <span>WHERE Filter, Sorting &amp; Freeze</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Type SQL conditions in the <code>WHERE</code> bar above a table (e.g.,{' '}
                          <code>status = &apos;active&apos;</code>), click headers for multi-column
                          sorting, and freeze key columns while scrolling horizontally.
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-1.5">
                        <div className="font-semibold text-zinc-100 flex items-center gap-2">
                          <Check className="h-4 w-4 text-amber-400" />
                          <span>Staged Edits &amp; DML Preview</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Double-click a cell to edit, press{' '}
                          <code>{isMac ? '⌘D' : 'Ctrl+D'}</code> to duplicate a row, or{' '}
                          <code>{isMac ? '⌘⌫' : 'Delete'}</code> to mark a row for deletion. Click{' '}
                          <strong>Preview SQL</strong> to inspect generated statements before
                          applying (<code>{isMac ? '⌘S' : 'Ctrl+S'}</code>) or reverting (<code>Esc</code>).
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-1.5">
                        <div className="font-semibold text-zinc-100 flex items-center gap-2">
                          <Eye className="h-4 w-4 text-purple-400" />
                          <span>Value Viewer (F7) &amp; Copy Formats</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Press <code>F7</code> on any cell to inspect or edit formatted JSON and
                          long text in the side panel. Choose your preferred copy format (
                          <strong>CSV</strong>, <strong>JSON</strong>, <strong>SQL INSERT</strong>,{' '}
                          <strong>SQL UPDATE</strong>, or <strong>SQL UPSERT</strong>) in the table
                          toolbar.
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#272932] bg-[#14151a] p-4 text-[11px] text-zinc-300 leading-relaxed">
                      <strong className="text-zinc-100">Export, Import &amp; Mock Data:</strong>{' '}
                      Use the table toolbar icons to export table rows to CSV/JSON/SQL, import CSV
                      files with interactive column mapping, or generate up to 1000 realistic mock
                      rows based on column names and data types.
                    </div>
                  </div>
                )}

                {/* 5. TOOLS & SECURITY */}
                {activeHelpTab === 'tools' && (
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-100">
                        Schema Tools, Workspaces &amp; Security
                      </h3>
                      <p className="text-[11px] text-zinc-400 mt-1">
                        Built-in utilities for database design, migration diffs, access management,
                        and secure connectivity.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-1.5">
                        <div className="font-semibold text-zinc-100 flex items-center gap-2">
                          <GitCompare className="h-4 w-4 text-blue-400" />
                          <span>Schema Diff &amp; ER Diagrams</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Open <strong>Schema Diff</strong> from the header to compare two
                          databases or schemas and generate migration DDL directly into a console.
                          Right-click any database/schema in Explorer to launch an interactive{' '}
                          <strong>ER Diagram</strong>.
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-1.5">
                        <div className="font-semibold text-zinc-100 flex items-center gap-2">
                          <Users className="h-4 w-4 text-amber-400" />
                          <span>User &amp; Privilege Manager</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Right-click PostgreSQL, MySQL, or MariaDB connections to manage database
                          users, passwords, login locks, and object/admin privileges.
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-1.5">
                        <div className="font-semibold text-zinc-100 flex items-center gap-2">
                          <Shield className="h-4 w-4 text-emerald-400" />
                          <span>SSH Tunneling (TOFU) &amp; SSL/TLS</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Configure SSH bastion tunnels (Private Key, Password, or SSH Agent) with
                          automatic Trust-On-First-Use host key verification, plus custom SSL/TLS
                          CA, client certificates, and keys.
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-1.5">
                        <div className="font-semibold text-zinc-100 flex items-center gap-2">
                          <Lock className="h-4 w-4 text-rose-400" />
                          <span>Environment Guards &amp; Keyring</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Passwords and SSH secrets are stored in your OS Keyring. Enable{' '}
                          <strong>Read-Only</strong> on sensitive connections to block writes, and
                          use <strong>DEV</strong> / <strong>PROD</strong> tags for visual alerts.
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#272932] bg-[#14151a] p-4 flex items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                          <KeyRound className="h-3.5 w-3.5 text-blue-400" />
                          <span>Portable Configuration Backup</span>
                        </div>
                        <p className="text-[11px] text-zinc-400">
                          Export or import settings, folders, and connections as JSON from Settings.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          closeHelpModal();
                          openSettings('backup');
                        }}
                        className="shrink-0 px-3 py-1.5 rounded-lg bg-[#22242c] hover:bg-[#2c2f3b] border border-[#353847] text-zinc-200 text-xs font-medium cursor-pointer"
                      >
                        Open Backup
                      </button>
                    </div>
                  </div>
                )}

                {/* 6. SHORTCUTS */}
                {activeHelpTab === 'shortcuts' && (
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-100">
                        Keyboard Shortcuts Reference
                      </h3>
                      <p className="text-[11px] text-zinc-400 mt-1">
                        DHub is built for keyboard-first navigation across Windows, Linux, and macOS.
                      </p>
                    </div>

                    {KEYBOARD_SHORTCUT_GROUPS.map((group) => (
                      <div key={group.title} className="space-y-2">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                          {group.title}
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {group.items.map((item) => (
                            <div
                              key={item.action}
                              className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#1e2027] border border-[#272932]"
                            >
                              <span className="text-[11px] text-zinc-300">{item.action}</span>
                              <kbd className="shrink-0 font-mono text-[10px] bg-[#14151a] border border-[#2e313f] px-1.5 py-0.5 rounded text-zinc-200">
                                {isMac ? item.mac : item.win}
                              </kbd>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 7. FAQ & TROUBLESHOOTING */}
                {activeHelpTab === 'faq' && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-100">
                        Frequently Asked Questions &amp; Troubleshooting
                      </h3>
                      <p className="text-[11px] text-zinc-400 mt-1">
                        Answers to common questions about editing, database filters, SSH security,
                        and NoSQL support.
                      </p>
                    </div>

                    <div className="space-y-3">
                      {FAQ_ITEMS.map((item, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl border border-[#272932] bg-[#1e2027] p-4 space-y-1.5"
                        >
                          <h4 className="text-xs font-semibold text-zinc-100 flex items-start gap-2">
                            <HelpCircle className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                            <span>{item.q}</span>
                          </h4>
                          <p className="text-[11px] text-zinc-400 leading-relaxed pl-5">
                            {item.a}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex h-12 items-center justify-between border-t border-[#272932] px-5 bg-[#14151a] shrink-0">
          <div className="flex items-center gap-3 text-[11px] text-zinc-400">
            <span className="font-mono">DHub Desktop v{APP_VERSION}</span>
            <span className="text-zinc-600">•</span>
            <span>Full offline guide also available in docs/USER_GUIDE.md</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                closeHelpModal();
                openSettings('version');
              }}
              className="px-3 py-1.5 rounded-lg border border-[#2f3242] text-zinc-300 hover:text-white hover:bg-[#20222b] text-xs transition-colors cursor-pointer"
            >
              Settings &amp; Updates
            </button>
            <button
              type="button"
              onClick={closeHelpModal}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
