import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Sparkles,
  X,
  Send,
  Trash2,
  Settings as SettingsIcon,
  Copy,
  Check,
  Database,
  CornerDownLeft,
  MessageSquare,
  Table2,
  ChevronDown,
  Terminal,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { SchemaService, WorkspaceService } from '../../../bindings/dhub/internal/services';
import {
  AI_PROVIDER_DEFAULTS,
  logAiToTerminal,
  parseAiResponse,
  sendAiChatMessage,
  type DhubAiAction,
} from '../../utils/aiClient';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sqlSnippet?: string;
  actions?: DhubAiAction[];
  isError?: boolean;
  needsConfig?: boolean;
  timestamp: string;
}

interface AttachedTable {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}

interface TableStructureSummary {
  columns: { name: string; dataType?: string; type?: string; isPrimaryKey?: boolean; nullable?: boolean }[];
  primaryKeys: string[];
  foreignKeys: { column: string; refTable: string; refColumn: string }[];
}

const AI_CHAT_HISTORY_KEY = 'dhub_ai_chat_history_v1';
const MAX_CHAT_HISTORY = 100;

function formatTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function createWelcomeMessage(): ChatMessage {
  return {
    id: 'welcome',
    role: 'assistant',
    content:
      'Halo! Saya DHub AI Assistant. Saya bisa langsung menempel ke tabel aktif, membuatkan SQL, atau membuka tabel langsung dengan filter WHERE.',
    timestamp: formatTime(),
  };
}

function loadSavedChatHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(AI_CHAT_HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(-MAX_CHAT_HISTORY);
      }
    }
  } catch {}
  return [createWelcomeMessage()];
}

function persistChatHistory(messages: ChatMessage[]) {
  try {
    const trimmed = messages.slice(-MAX_CHAT_HISTORY);
    const serialized = JSON.stringify(trimmed);
    localStorage.setItem(AI_CHAT_HISTORY_KEY, serialized);
    WorkspaceService.SaveSetting(AI_CHAT_HISTORY_KEY, serialized).catch(() => {});
  } catch {}
}

export const AiChatBubble: React.FC = () => {
  const showAiChat = useSettingsStore((s) => s.showAiChat);
  const aiProvider = useSettingsStore((s) => s.aiProvider);
  const aiApiKey = useSettingsStore((s) => s.aiApiKey);
  const aiBaseUrl = useSettingsStore((s) => s.aiBaseUrl);
  const aiModel = useSettingsStore((s) => s.aiModel);
  const openSettings = useSettingsStore((s) => s.openSettings);

  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeDatabase = useConnectionStore((s) => s.activeDatabase);
  const activeSchema = useConnectionStore((s) => s.activeSchema);
  const connections = useConnectionStore((s) => s.connections);
  const treeDatabases = useConnectionStore((s) => s.treeDatabases);
  const visibleDatabases = useConnectionStore((s) => s.visibleDatabases);
  const setTreeDatabases = useConnectionStore((s) => s.setTreeDatabases);
  const treeObjects = useConnectionStore((s) => s.treeObjects);
  const setTreeObjects = useConnectionStore((s) => s.setTreeObjects);

  const tabs = useWorkbenchStore((s) => s.tabs);
  const activeTabId = useWorkbenchStore((s) => s.activeTabId);
  const updateTabContent = useWorkbenchStore((s) => s.updateTabContent);
  const createConsole = useWorkbenchStore((s) => s.createConsole);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const [manualConnId, setManualConnId] = useState<string | undefined>(undefined);
  const [manualDb, setManualDb] = useState<string | undefined>(undefined);
  const [isConnPickerOpen, setIsConnPickerOpen] = useState(false);
  const [isDbPickerOpen, setIsDbPickerOpen] = useState(false);

  const autoConnId = activeTab?.connectionId || activeConnectionId || '';
  const effectiveConnId = manualConnId !== undefined ? manualConnId : autoConnId;
  const activeConn = connections.find((c) => c.id === effectiveConnId);
  const effectiveDriver = activeConn?.driver || '';
  const defaultDbForDriver =
    effectiveDriver === 'sqlite' ? 'main' : effectiveDriver === 'qdrant' ? 'default' : '';
  const autoDb =
    activeTab?.database ||
    activeDatabase ||
    activeConn?.databaseName ||
    defaultDbForDriver;
  const effectiveDb =
    manualDb !== undefined
      ? manualDb
      : manualConnId !== undefined
      ? activeConn?.databaseName || defaultDbForDriver
      : autoDb;
  const effectiveSchema =
    (manualConnId === undefined && manualDb === undefined ? activeTab?.schema || activeSchema : '') ||
    (effectiveDriver === 'postgres'
      ? 'public'
      : effectiveDriver === 'mssql'
      ? 'dbo'
      : effectiveDriver === 'oracle'
      ? ''
      : effectiveDb);

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [manualTable, setManualTable] = useState<AttachedTable | null | undefined>(undefined);
  const [isTablePickerOpen, setIsTablePickerOpen] = useState(false);
  const [tableSchemaCache, setTableSchemaCache] = useState<Record<string, TableStructureSummary>>({});
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadSavedChatHistory());

  const hasCustomBaseUrl = Boolean(aiBaseUrl.trim());
  const needsConfig =
    (aiProvider === 'gemini' || (aiProvider === 'openai' && !hasCustomBaseUrl)) &&
    !aiApiKey.trim();

  // Load persisted chat history from backend SQLite on mount if available
  useEffect(() => {
    WorkspaceService.GetSettings()
      .then((settings) => {
        const raw = settings?.[AI_CHAT_HISTORY_KEY];
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          localStorage.setItem(AI_CHAT_HISTORY_KEY, raw);
          setMessages(parsed.slice(-MAX_CHAT_HISTORY));
        }
      })
      .catch(() => {});
  }, []);

  // Persist chat history whenever messages change
  useEffect(() => {
    persistChatHistory(messages);
  }, [messages]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Determine attached table: manual override if set, otherwise auto-follow active table_data tab
  const attachedTable: AttachedTable | null = useMemo(() => {
    if (manualTable !== undefined) return manualTable;
    if (activeTab?.type === 'table_data' && activeTab.table && activeTab.connectionId) {
      return {
        connectionId: activeTab.connectionId,
        database: activeTab.database || effectiveDb,
        schema: activeTab.schema || effectiveSchema,
        table: activeTab.table,
      };
    }
    return null;
  }, [manualTable, activeTab, effectiveDb, effectiveSchema]);

  // Reset manual override when switching to a different table tab
  useEffect(() => {
    if (activeTab?.type === 'table_data' && activeTab.table) {
      setManualTable(undefined);
    }
  }, [activeTab?.id, activeTab?.table]);

  // Available databases for the selected connection
  const availableDatabases = useMemo(() => {
    if (!effectiveConnId) return [];
    const allDbs = treeDatabases[effectiveConnId] || [];
    const visibleList = visibleDatabases[effectiveConnId];
    if (visibleList && visibleList.length > 0) {
      return allDbs.filter((d) => visibleList.includes(d));
    }
    return allDbs;
  }, [effectiveConnId, treeDatabases, visibleDatabases]);

  // Load databases if missing for selected connection
  useEffect(() => {
    if (!isOpen || !effectiveConnId) return;
    if (treeDatabases[effectiveConnId]?.length) return;
    if (effectiveDriver === 'redis') {
      setTreeDatabases(
        effectiveConnId,
        Array.from({ length: 16 }, (_, i) => `db${i}`)
      );
      return;
    }
    SchemaService.GetDatabases(effectiveConnId)
      .then((dbs) => {
        if (dbs && dbs.length > 0) setTreeDatabases(effectiveConnId, dbs);
      })
      .catch(() => {});
  }, [isOpen, effectiveConnId, effectiveDriver, treeDatabases, setTreeDatabases]);

  // Load objects if missing for selected connection + database
  useEffect(() => {
    if (!isOpen || !effectiveConnId || !effectiveDb) return;
    const schemaKey = `${effectiveConnId}:${effectiveDb}:${effectiveSchema}`;
    if (treeObjects[schemaKey]?.length) return;
    SchemaService.GetObjects(effectiveConnId, effectiveDb, effectiveSchema)
      .then((objs) => {
        if (objs && objs.length > 0) setTreeObjects(schemaKey, objs as any);
      })
      .catch(() => {});
  }, [isOpen, effectiveConnId, effectiveDb, effectiveSchema, treeObjects, setTreeObjects]);

  // Available tables in active schema/db for manual table picker & AI context
  const availableTables = useMemo(() => {
    if (!effectiveConnId) return [];
    const schemaKey = `${effectiveConnId}:${effectiveDb}:${effectiveSchema}`;
    const direct = treeObjects[schemaKey] || [];
    if (direct.length > 0) {
      return direct.filter((o) => o.type === 'table' || o.type === 'view' || o.type === 'collection');
    }
    // Fallback: collect objects under the same connectionId
    const prefix = `${effectiveConnId}:`;
    const merged: typeof direct = [];
    for (const [k, list] of Object.entries(treeObjects)) {
      if (k.startsWith(prefix) && Array.isArray(list)) {
        for (const item of list) {
          if (item.type === 'table' || item.type === 'view' || item.type === 'collection') {
            merged.push(item);
          }
        }
      }
    }
    return merged;
  }, [effectiveConnId, effectiveDb, effectiveSchema, treeObjects]);

  const attachedSchemaKey = attachedTable
    ? `${attachedTable.connectionId}:${attachedTable.database}:${attachedTable.schema}:${attachedTable.table}`
    : '';
  const attachedSchema = attachedSchemaKey ? tableSchemaCache[attachedSchemaKey] : undefined;

  // Fetch attached table structure when attachedTable changes
  useEffect(() => {
    if (!attachedTable || !attachedSchemaKey || tableSchemaCache[attachedSchemaKey]) return;
    let cancelled = false;
    SchemaService.GetTableStructure(
      attachedTable.connectionId,
      attachedTable.database,
      attachedTable.schema,
      attachedTable.table
    )
      .then((res: any) => {
        if (cancelled || !res) return;
        const summary: TableStructureSummary = {
          columns: Array.isArray(res.columns) ? res.columns : [],
          primaryKeys: Array.isArray(res.primaryKeys) ? res.primaryKeys : [],
          foreignKeys: Array.isArray(res.foreignKeys) ? res.foreignKeys : [],
        };
        setTableSchemaCache((prev) => ({ ...prev, [attachedSchemaKey]: summary }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [attachedTable, attachedSchemaKey, tableSchemaCache]);

  // Listen for "Ask AI about this table" event from table toolbar
  useEffect(() => {
    const handleOpenAiChat = (e: Event) => {
      const detail = (e as CustomEvent<Partial<AttachedTable>>).detail;
      if (detail?.table && detail?.connectionId) {
        setManualConnId(detail.connectionId);
        setManualDb(detail.database || '');
        setManualTable({
          connectionId: detail.connectionId,
          database: detail.database || effectiveDb,
          schema: detail.schema || effectiveSchema,
          table: detail.table,
        });
      }
      setIsOpen(true);
      setIsConnPickerOpen(false);
      setIsDbPickerOpen(false);
      setIsTablePickerOpen(false);
    };
    window.addEventListener('dhub:open-ai-chat', handleOpenAiChat);
    return () => window.removeEventListener('dhub:open-ai-chat', handleOpenAiChat);
  }, [effectiveDb, effectiveSchema]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isThinking, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 60);
    }
  }, [isOpen]);

  if (!showAiChat) return null;

  const providerLabel = AI_PROVIDER_DEFAULTS[aiProvider].label;
  const activeModelName = aiModel.trim() || AI_PROVIDER_DEFAULTS[aiProvider].defaultModel;

  const contextLabel = activeConn
    ? `${activeConn.name}${effectiveDb ? ` • ${effectiveDb}` : ''}`
    : `${providerLabel} • ${activeModelName}`;

  const quickPrompts =
    effectiveDriver === 'qdrant'
      ? attachedTable
        ? [
            `Cari point di ${attachedTable.table} dengan filter payload`,
            `Jelaskan struktur vector & payload index ${attachedTable.table}`,
            `Buatkan query Hybrid / Similarity search untuk ${attachedTable.table}`,
          ]
        : [
            'Buatkan Qdrant REST vector search query',
            'Buatkan query SELECT dengan filter payload',
            'Jelaskan cara membuat payload index di Qdrant',
          ]
      : attachedTable
      ? [
          `Buka tabel ${attachedTable.table} dengan filter terbaru`,
          `Jelaskan struktur kolom tabel ${attachedTable.table}`,
          `Buatkan query agregasi untuk ${attachedTable.table}`,
        ]
      : [
          'Buka tabel dengan filter WHERE',
          'Buatkan query SELECT dengan filter & pagination',
          'Jelaskan cara optimasi query yang lambat',
        ];

  const handleCopySql = async (id: string, sql: string) => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {}
  };

  const handleInsertSql = (sql: string) => {
    if (activeTab?.type === 'worksheet') {
      const current = activeTab.content || '';
      const next = current.trim() ? `${current.trimEnd()}\n\n${sql}` : sql;
      updateTabContent(activeTab.id, next);
      return;
    }
    createConsole(
      effectiveConnId,
      effectiveDb,
      effectiveSchema,
      `ai_query_${Date.now()}.sql`,
      sql
    );
  };

  const handleOpenInNewConsole = (sql: string) => {
    createConsole(
      effectiveConnId,
      effectiveDb,
      effectiveSchema,
      `ai_query_${Date.now()}.sql`,
      sql
    );
  };

  const handleSendMessageToConsole = (msg: ChatMessage) => {
    const payload = msg.sqlSnippet
      ? msg.sqlSnippet
      : msg.content
          .split('\n')
          .map((line) => `-- ${line}`)
          .join('\n');
    handleInsertSql(payload);
  };

  const executeAiAction = (act: DhubAiAction) => {
    if (act.action === 'open_table') {
      const targetConnId =
        attachedTable?.connectionId || effectiveConnId || connections[0]?.id || '';
      const targetDb = attachedTable?.database || effectiveDb;
      const targetSchema = attachedTable?.schema || effectiveSchema;
      window.dispatchEvent(
        new CustomEvent('dhub:open-table', {
          detail: {
            connectionId: targetConnId,
            database: targetDb,
            schema: targetSchema,
            table: act.table,
            whereClause: act.where || '',
            sortConfigs: act.sort || [],
          },
        })
      );
    } else if (act.action === 'open_console') {
      createConsole(
        effectiveConnId,
        effectiveDb,
        effectiveSchema,
        act.title || `ai_query_${Date.now()}.sql`,
        act.sql
      );
    }
  };

  const buildSystemPrompt = (): string => {
    const parts = [
      'You are DHub AI Assistant, an expert database & SQL/NoSQL assistant embedded in the DHub desktop IDE.',
      'Reply concisely in the same language the user uses (Indonesian or English).',
      'When providing SQL or database queries, put the query inside a single fenced ```sql code block.',
      `CRITICAL UI ACTION RULE: You CANNOT open or filter a table by only writing text. Whenever the user asks to open, show, filter, search, or sort a table, or open a query in console, you MUST include a \`\`\`dhub-action fenced JSON block in your response — otherwise the UI will NOT perform the action.

Format 1 — Open or filter a table in DHub's Data Grid (omit the "WHERE" keyword in "where"):
\`\`\`dhub-action
{"action":"open_table","table":"users","where":"name LIKE '%agus%'","sort":[{"column":"created_at","direction":"desc"}]}
\`\`\`
Format 2 — Open a new SQL Console tab with a query:
\`\`\`dhub-action
{"action":"open_console","title":"active_users.sql","sql":"SELECT * FROM users WHERE status = 'active';"}
\`\`\`
Always include the \`\`\`dhub-action block when the user asks to open, show, filter, or sort a table.`,
    ];

    if (activeConn) {
      parts.push(
        `Active connection: engine=${activeConn.driver}, name=${activeConn.name}${
          effectiveDb ? `, database=${effectiveDb}` : ''
        }${effectiveSchema ? `, schema=${effectiveSchema}` : ''}.`
      );
      if (activeConn.driver === 'qdrant') {
        parts.push(
          'QDRANT DIALECT RULES: Qdrant is a vector database, NOT a relational SQL engine. Do NOT generate JOINs, GROUP BY, or CREATE TABLE SQL. For vector similarity, hybrid, recommend, or facet queries, generate Qdrant REST commands (e.g. `POST /collections/<name>/points/query`, `POST /collections/<name>/points/search`, `POST /collections/<name>/points/scroll`, `POST /collections/<name>/facet`) inside the ```sql block. For simple browsing or `open_table` "where", use Qdrant-compatible filters like `category = \'news\' AND views >= 10`, `title LIKE \'%keyword%\'`, or raw Qdrant JSON filter `{"must":[...]}`.'
        );
      } else if (activeConn.driver === 'clickhouse') {
        parts.push(
          'CLICKHOUSE DIALECT RULES: ClickHouse is a columnar OLAP engine with case-sensitive types (e.g. `UInt64`, `String`, `DateTime64(3)`, `Nullable(String)`, `LowCardinality(String)`). Always use `ENGINE = MergeTree() ORDER BY (...)` for `CREATE TABLE`. Use `ALTER TABLE ... UPDATE ... WHERE ... SETTINGS mutations_sync = 1` or `ALTER TABLE ... DELETE WHERE ...` instead of standard `UPDATE tbl SET`. Prefer ClickHouse functions (`toStartOfDay`, `uniqExact`, `countIf`, `argMax`, `arrayJoin`, `JSONExtractString`, `cosineDistance`). Do NOT use `AUTO_INCREMENT`, `FOREIGN KEY`, `ON DUPLICATE KEY UPDATE`, or `BEGIN`/`COMMIT`/`ROLLBACK`.'
        );
      } else if (activeConn.driver === 'elasticsearch') {
        parts.push(
          'ELASTICSEARCH DIALECT RULES: Elasticsearch/OpenSearch is a distributed search & analytics engine, NOT a relational SQL database. Do NOT generate SQL JOINs, CREATE TABLE, ALTER TABLE, or transactions. Use Kibana DevTools REST syntax (`GET /_cat/indices?format=json`, `POST /<index>/_search\\n{...}`, `POST /<index>/_count\\n{...}`, `POST /<index>/_bulk\\n...`) or ES|QL (`FROM <index> | WHERE ... | STATS ... | SORT ... | LIMIT ...`) inside the ```sql block. For `open_table` "where" filters, use simple expressions (`status = \'active\' AND views >= 10`, `title LIKE \'%search%\'`, `_id IN (\'1\', \'2\')`) or raw Query DSL JSON (`{"bool":{"must":[...]}}`).'
        );
      }
    }

    if (attachedTable) {
      let tableInfo = `Currently attached table: "${attachedTable.table}" (database="${attachedTable.database}", schema="${attachedTable.schema}").`;
      if (attachedSchema && attachedSchema.columns.length > 0) {
        const colList = attachedSchema.columns
          .map((c) => {
            const dtype = c.dataType || c.type || 'unknown';
            const pk = attachedSchema.primaryKeys.includes(c.name) || c.isPrimaryKey ? ' PK' : '';
            return `- ${c.name} (${dtype}${pk})`;
          })
          .join('\n');
        tableInfo += `\nColumns:\n${colList}`;
        if (attachedSchema.foreignKeys.length > 0) {
          const fkList = attachedSchema.foreignKeys
            .map((fk) => `- ${fk.column} -> ${fk.refTable}.${fk.refColumn}`)
            .join('\n');
          tableInfo += `\nForeign Keys:\n${fkList}`;
        }
      }
      parts.push(tableInfo);
    }

    if (availableTables.length > 0) {
      const tableNames = availableTables
        .slice(0, 60)
        .map((t) => t.name)
        .join(', ');
      parts.push(`Available tables in active database: ${tableNames}`);
    }

    if (activeTab?.type === 'worksheet' && activeTab.content?.trim()) {
      const snippet = activeTab.content.trim().slice(0, 1500);
      parts.push(`Current SQL worksheet content:\n\`\`\`sql\n${snippet}\n\`\`\``);
    }

    return parts.join('\n\n');
  };

  const handleSend = async (textOverride?: string) => {
    const trimmed = (textOverride ?? input).trim();
    if (!trimmed || isThinking) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: formatTime(),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    if (!textOverride) setInput('');

    if (needsConfig) {
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-cfg-${Date.now()}`,
          role: 'assistant',
          content: `${providerLabel} API Key belum diatur. Buka Settings → AI Assistant untuk memasukkan API key kamu.`,
          needsConfig: true,
          timestamp: formatTime(),
        },
      ]);
      return;
    }

    setIsThinking(true);
    try {
      const history = nextMessages
        .filter((m) => m.id !== 'welcome' && !m.isError && !m.needsConfig)
        .slice(-12)
        .map((m) => {
          const parts = [m.content];
          if (m.sqlSnippet) {
            parts.push(`\`\`\`sql\n${m.sqlSnippet}\n\`\`\``);
          }
          if (m.actions && m.actions.length > 0) {
            m.actions.forEach((act) => {
              parts.push(`\`\`\`dhub-action\n${JSON.stringify(act)}\n\`\`\``);
            });
          }
          return {
            role: m.role,
            content: parts.join('\n\n'),
          };
        });

      const rawReply = await sendAiChatMessage({
        provider: aiProvider,
        apiKey: aiApiKey,
        baseUrl: aiBaseUrl,
        model: activeModelName,
        systemPrompt: buildSystemPrompt(),
        messages: history,
      });

      const { displayText, sqlSnippet, actions } = parseAiResponse(rawReply);

      // Fallback: if AI returned a single-table SELECT with WHERE/ORDER BY without a dhub-action block
      // when the user asked to open/show/filter a table, infer the open_table action.
      if (
        actions.length === 0 &&
        sqlSnippet &&
        /\b(buka|open|tampil|tampilkan|lihat|show|filter|cari)\b/i.test(trimmed)
      ) {
        const cleanedSql = sqlSnippet
          .trim()
          .replace(/;+\s*$/, '')
          .replace(/\s+OFFSET\s+\d+\s*$/i, '')
          .replace(/\s+LIMIT\s+\d+(?:\s*,\s*\d+)?\s*$/i, '')
          .trim();
        const selectMatch = cleanedSql.match(
          /^\s*SELECT\s+[\s\S]+?\s+FROM\s+[`"\[]?(?:([a-zA-Z0-9_-]+)\.)?([a-zA-Z0-9_-]+)[`"\]]?(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+[`"\[]?([a-zA-Z0-9_.-]+)[`"\]]?(?:\s+(ASC|DESC))?)?\s*$/i
        );
        if (selectMatch) {
          const tableName = selectMatch[2];
          const wherePart = selectMatch[3]?.trim();
          const orderCol = selectMatch[4]?.trim();
          const orderDir =
            selectMatch[5]?.toLowerCase() === 'desc' ? ('desc' as const) : ('asc' as const);
          actions.push({
            action: 'open_table',
            table: tableName,
            where: wherePart || undefined,
            sort: orderCol ? [{ column: orderCol, direction: orderDir }] : undefined,
          });
        }
      }

      logAiToTerminal('[DHub AI] Parsed Response:', { displayText, sqlSnippet, actions });

      // Automatically execute DHub UI actions (open_table / open_console)
      actions.forEach(executeAiAction);

      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: displayText,
          sqlSnippet,
          actions: actions.length > 0 ? actions : undefined,
          timestamp: formatTime(),
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-err-${Date.now()}`,
          role: 'assistant',
          content: err?.message || 'Gagal menghubungi AI provider.',
          isError: true,
          timestamp: formatTime(),
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'assistant',
        content:
          'Percakapan dibersihkan. Ada yang bisa saya bantu untuk query atau tabel kamu?',
        timestamp: formatTime(),
      },
    ]);
  };

  return (
    <div className="fixed bottom-5 right-12 z-40 select-none">
      {isOpen ? (
        <div className="w-[360px] sm:w-[400px] h-[500px] max-h-[78vh] rounded-2xl border border-[#2b2e3a] bg-[#181920] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#272932] bg-[#14151a]">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600/20 border border-blue-500/35 text-blue-400 shrink-0">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-zinc-100 leading-tight">
                    AI Assistant
                  </span>
                  <span className="rounded bg-[#22242e] border border-[#2f3240] px-1.5 py-0.2 text-[9px] font-mono text-zinc-400 truncate max-w-[110px]">
                    {activeModelName}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-zinc-400 truncate mt-0.5">
                  <Database className="h-2.5 w-2.5 text-zinc-500 shrink-0" />
                  <span className="truncate">{contextLabel}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleClearChat}
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors cursor-pointer"
                title="Clear chat"
                aria-label="Clear chat"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => openSettings('ai')}
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors cursor-pointer"
                title="AI Assistant Settings"
                aria-label="AI Assistant Settings"
              >
                <SettingsIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors cursor-pointer"
                title="Close chat"
                aria-label="Close chat"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Context Bar: Connection + Optional Database + Attached Table */}
          <div className="relative flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-[#22242d] bg-[#16171d] text-[11px]">
            {/* Connection Picker */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsConnPickerOpen((v) => !v);
                  setIsDbPickerOpen(false);
                  setIsTablePickerOpen(false);
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                  activeConn
                    ? 'bg-blue-950/35 border-blue-700/45 text-blue-200 hover:bg-blue-950/55'
                    : 'bg-[#1e2028] border-[#2d303d] text-zinc-400 hover:text-zinc-200'
                }`}
                title="Select connection for AI context"
              >
                <Database className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[100px] font-medium">
                  {activeConn ? activeConn.name : 'Connection'}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
              </button>

              {isConnPickerOpen && (
                <div className="absolute left-0 top-full mt-1 z-50 w-56 max-h-52 overflow-y-auto rounded-lg border border-[#323544] bg-[#1a1b22] p-1 shadow-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setManualConnId(undefined);
                      setManualDb(undefined);
                      setManualTable(undefined);
                      setIsConnPickerOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left text-xs transition-colors cursor-pointer ${
                      manualConnId === undefined
                        ? 'bg-blue-600 text-white'
                        : 'text-zinc-300 hover:bg-[#252734] hover:text-white'
                    }`}
                  >
                    <span>Auto (follow active)</span>
                  </button>
                  {connections.length > 0 && <div className="my-1 border-t border-[#292b36]" />}
                  {connections.map((conn) => {
                    const isSelected = manualConnId === conn.id;
                    return (
                      <button
                        key={conn.id}
                        type="button"
                        onClick={() => {
                          setManualConnId(conn.id);
                          setManualDb(undefined);
                          setManualTable(null);
                          setIsConnPickerOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-left text-xs transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-blue-600 text-white'
                            : 'text-zinc-300 hover:bg-[#252734] hover:text-white'
                        }`}
                      >
                        <span className="truncate">{conn.name}</span>
                        <span className="text-[10px] font-mono opacity-75 shrink-0">{conn.driver}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Optional Database Picker */}
            {effectiveConnId && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsDbPickerOpen((v) => !v);
                    setIsConnPickerOpen(false);
                    setIsTablePickerOpen(false);
                  }}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                    effectiveDb
                      ? 'bg-[#1f222d] border-[#323646] text-zinc-200 hover:border-zinc-500'
                      : 'bg-[#1e2028] border-[#2d303d] text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="Optional: choose database"
                >
                  <span className="truncate max-w-[90px] font-mono">
                    {effectiveDb || 'DB (optional)'}
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
                </button>

                {isDbPickerOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-52 max-h-52 overflow-y-auto rounded-lg border border-[#323544] bg-[#1a1b22] p-1 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        setManualDb('');
                        setManualTable(null);
                        setIsDbPickerOpen(false);
                      }}
                      className={`w-full flex items-center px-2.5 py-1.5 rounded-md text-left text-xs transition-colors cursor-pointer ${
                        manualDb === ''
                          ? 'bg-blue-600 text-white'
                          : 'text-zinc-400 hover:bg-[#252734] hover:text-white'
                      }`}
                    >
                      <span>None / Optional</span>
                    </button>
                    {availableDatabases.length > 0 && <div className="my-1 border-t border-[#292b36]" />}
                    {availableDatabases.map((dbName) => {
                      const isSelected = effectiveDb === dbName && manualDb !== '';
                      return (
                        <button
                          key={dbName}
                          type="button"
                          onClick={() => {
                            setManualDb(dbName);
                            setManualTable(null);
                            setIsDbPickerOpen(false);
                          }}
                          className={`w-full flex items-center px-2.5 py-1.5 rounded-md text-left text-xs font-mono transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : 'text-zinc-300 hover:bg-[#252734] hover:text-white'
                          }`}
                        >
                          <span className="truncate">{dbName}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Table Picker */}
            <div className="flex items-center gap-1 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setIsTablePickerOpen((v) => !v);
                  setIsConnPickerOpen(false);
                  setIsDbPickerOpen(false);
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-md border transition-colors cursor-pointer min-w-0 ${
                  attachedTable
                    ? 'bg-emerald-950/35 border-emerald-700/45 text-emerald-300 hover:bg-emerald-950/55'
                    : 'bg-[#1e2028] border-[#2d303d] text-zinc-400 hover:text-zinc-200'
                }`}
                title="Attach AI context to a table"
              >
                <Table2 className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[110px] font-mono">
                  {attachedTable ? attachedTable.table : 'Table'}
                </span>
                {attachedTable && attachedSchema && (
                  <span className="text-[10px] text-emerald-400/80 shrink-0">
                    ({attachedSchema.columns.length})
                  </span>
                )}
                <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
              </button>

              {attachedTable && (
                <button
                  type="button"
                  onClick={() => setManualTable(null)}
                  className="p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] cursor-pointer"
                  title="Detach table"
                  aria-label="Detach table"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Table Picker Dropdown */}
            {isTablePickerOpen && (
              <div className="absolute left-3 top-full mt-1 z-50 w-64 max-h-52 overflow-y-auto rounded-lg border border-[#323544] bg-[#1a1b22] p-1 shadow-2xl">
                {availableTables.length === 0 ? (
                  <div className="px-2.5 py-2 text-[11px] text-zinc-500">
                    No tables loaded in active database.
                  </div>
                ) : (
                  availableTables.map((tbl) => {
                    const isCurrent = attachedTable?.table === tbl.name;
                    return (
                      <button
                        key={tbl.name}
                        type="button"
                        onClick={() => {
                          setManualTable({
                            connectionId: effectiveConnId,
                            database: effectiveDb,
                            schema: effectiveSchema,
                            table: tbl.name,
                          });
                          setIsTablePickerOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs transition-colors cursor-pointer ${
                          isCurrent
                            ? 'bg-blue-600 text-white'
                            : 'text-zinc-300 hover:bg-[#252734] hover:text-white'
                        }`}
                      >
                        <Table2 className="h-3.5 w-3.5 shrink-0 opacity-80" />
                        <span className="truncate font-mono">{tbl.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 select-text">
            {needsConfig && (
              <div className="rounded-xl border border-amber-500/35 bg-amber-950/30 p-3 text-xs text-amber-100 space-y-2">
                <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                  <SettingsIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>Konfigurasi AI belum lengkap</span>
                </div>
                <p className="text-[11px] leading-relaxed text-amber-100/90">
                  {`${providerLabel} API Key belum diatur. Silakan masukkan API key di Settings → AI Assistant sebelum mulai chat.`}
                </p>
                <button
                  type="button"
                  onClick={() => openSettings('ai')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium transition-colors cursor-pointer"
                >
                  <SettingsIcon className="h-3 w-3" />
                  <span>Buka AI Settings</span>
                </button>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-xs'
                      : msg.isError
                      ? 'bg-rose-950/40 border border-rose-800/50 text-rose-200 rounded-bl-xs'
                      : 'bg-[#20222b] border border-[#2c2f3b] text-zinc-200 rounded-bl-xs'
                  }`}
                >
                  {msg.content}

                  {msg.needsConfig && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => openSettings('ai')}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium transition-colors cursor-pointer"
                      >
                        <SettingsIcon className="h-3 w-3" />
                        <span>Buka AI Settings</span>
                      </button>
                    </div>
                  )}

                  {msg.actions && msg.actions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {msg.actions.map((act, idx) => (
                        <button
                          key={`${msg.id}-act-${idx}`}
                          type="button"
                          onClick={() => executeAiAction(act)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-300 text-[11px] font-mono transition-colors cursor-pointer"
                          title="Click to re-run action"
                        >
                          {act.action === 'open_table' ? (
                            <>
                              <Table2 className="h-3 w-3 shrink-0" />
                              <span>
                                {act.table}
                                {act.where ? ` WHERE ${act.where}` : ''}
                              </span>
                            </>
                          ) : (
                            <>
                              <Terminal className="h-3 w-3 shrink-0" />
                              <span>Open Console: {act.title || 'SQL'}</span>
                            </>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {msg.sqlSnippet && (
                    <div className="mt-2 rounded-lg border border-[#2e313e] bg-[#13141a] overflow-hidden">
                      <pre className="p-2.5 text-[11px] font-mono text-emerald-300 overflow-x-auto">
                        {msg.sqlSnippet}
                      </pre>
                      <div className="flex items-center justify-end gap-1.5 px-2 py-1 border-t border-[#242632] bg-[#171820]">
                        <button
                          type="button"
                          onClick={() => handleCopySql(msg.id, msg.sqlSnippet!)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="h-2.5 w-2.5 text-emerald-400" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-2.5 w-2.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                        {activeTab?.type === 'worksheet' && (
                          <button
                            type="button"
                            onClick={() => handleInsertSql(msg.sqlSnippet!)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-blue-600/20 text-blue-300 hover:bg-blue-600/35 border border-blue-500/30 transition-colors cursor-pointer"
                            title="Insert into active SQL Console"
                          >
                            <CornerDownLeft className="h-2.5 w-2.5" />
                            <span>Insert</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenInNewConsole(msg.sqlSnippet!)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30 transition-colors cursor-pointer"
                          title="Open in a new SQL Console"
                        >
                          <Terminal className="h-2.5 w-2.5" />
                          <span>New Console</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-1 px-1 flex items-center gap-2 text-[10px] text-zinc-500">
                  <span>{msg.timestamp}</span>
                  {msg.role === 'assistant' &&
                    !msg.isError &&
                    !msg.needsConfig &&
                    !msg.id.startsWith('welcome') &&
                    !msg.sqlSnippet && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleCopySql(msg.id, msg.content)}
                          className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                          title="Copy response"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="h-2.5 w-2.5 text-emerald-400" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-2.5 w-2.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSendMessageToConsole(msg)}
                          className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                          title={
                            activeTab?.type === 'worksheet'
                              ? 'Insert response into active SQL Console'
                              : 'Open response in new SQL Console'
                          }
                        >
                          <Terminal className="h-2.5 w-2.5" />
                          <span>Masukan Console</span>
                        </button>
                      </>
                    )}
                </div>
              </div>
            ))}

            {messages.length <= 1 && !needsConfig && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => handleSend(prompt)}
                    className="text-left text-[11px] px-2.5 py-1 rounded-lg border border-[#2d303d] bg-[#1b1d25] hover:bg-[#232631] hover:border-blue-500/40 text-zinc-300 transition-colors cursor-pointer"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {isThinking && (
              <div className="flex items-start">
                <div className="rounded-xl rounded-bl-xs bg-[#20222b] border border-[#2c2f3b] px-3 py-2 text-xs text-zinc-400 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce" />
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:240ms]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-2.5 border-t border-[#272932] bg-[#14151a]">
            <div className="flex items-end gap-2 rounded-xl border border-[#2c2f3b] bg-[#1b1d25] px-2.5 py-1.5 focus-within:border-blue-500/60 transition-colors">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                disabled={needsConfig}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  needsConfig
                    ? 'Atur AI Settings terlebih dahulu sebelum mulai chat...'
                    : attachedTable
                    ? `Tanya atau filter tabel ${attachedTable.table}...`
                    : 'Tanya AI, atau minta buka tabel dengan WHERE...'
                }
                className="flex-1 resize-none bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none max-h-24 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={needsConfig || !input.trim() || isThinking}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white transition-colors cursor-pointer"
                title={needsConfig ? 'Configure AI Settings first' : 'Send message'}
                aria-label="Send message"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="group flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-950/50 border border-blue-400/40 transition-all hover:scale-105 active:scale-95 cursor-pointer"
          title={`Chat with AI (${providerLabel})`}
          aria-label="Chat with AI"
        >
          <MessageSquare className="h-5 w-5" />
          <Sparkles className="h-2.5 w-2.5 absolute top-2 right-2 text-blue-100 opacity-90" />
        </button>
      )}
    </div>
  );
};
