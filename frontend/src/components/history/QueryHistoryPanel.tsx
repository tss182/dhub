import React, { useState, useEffect, useCallback } from 'react';
import { WorkspaceService } from '../../../bindings/dhub/internal/services';
import * as store$0 from '../../../bindings/dhub/internal/store/models';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { alertSuccess, alertInfo, alertError } from '../../stores/useAlertStore';
import {
  Clock,
  Play,
  Copy,
  Check,
  Search,
  Filter,
  RefreshCw,
  Database,
  ArrowDownCircle,
  FileCode,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { DbDriverIcon } from '../common/DbDriverIcon';

interface QueryHistoryPanelProps {
  onInsertToEditor?: (sql: string) => void;
  onExecuteQuery?: (sql: string, explicitDb?: string) => void;
}

export const QueryHistoryPanel: React.FC<QueryHistoryPanelProps> = ({
  onInsertToEditor,
  onExecuteQuery,
}) => {
  const { connections, activeConnectionId } = useConnectionStore();
  const { tabs, activeTabId } = useWorkbenchStore();

  const [history, setHistory] = useState<store$0.QueryHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filterConnId, setFilterConnId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'success' | 'error' | 'cancelled'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const currentTabConnId = activeTab?.connectionId || activeConnectionId || '';

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      // If a specific connection is selected or current active connection
      const targetConnId = filterConnId !== 'all' ? filterConnId : (currentTabConnId || connections[0]?.id || '');
      if (!targetConnId) {
        setHistory([]);
        setIsLoading(false);
        return;
      }
      const entries = await WorkspaceService.GetQueryHistory(targetConnId, 100);
      setHistory(entries || []);
    } catch (e: any) {
      console.error('Failed to load query history:', e);
    } finally {
      setIsLoading(false);
    }
  }, [filterConnId, currentTabConnId, connections]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleCopySql = (id: number, sql: string) => {
    navigator.clipboard.writeText(sql).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }).catch(() => {
      alertError('Failed to copy SQL to clipboard');
    });
  };

  const filteredHistory = history.filter((entry) => {
    if (filterStatus !== 'all' && entry.status !== filterStatus) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchSql = entry.sqlText.toLowerCase().includes(q);
      const matchDb = entry.databaseName.toLowerCase().includes(q);
      const matchErr = (entry.errorMessage || '').toLowerCase().includes(q);
      return matchSql || matchDb || matchErr;
    }
    return true;
  });

  const formatTimestamp = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#14151a] text-zinc-300 font-sans text-xs">
      {/* Top Filter Bar */}
      <div className="flex h-9 items-center justify-between border-b border-[#272932] px-3 bg-[#181920] shrink-0 gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Connection Filter */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Database className="h-3.5 w-3.5 text-zinc-500" />
            <select
              value={filterConnId}
              onChange={(e) => setFilterConnId(e.target.value)}
              className="bg-[#22242c] text-zinc-200 border border-[#3b3e4f] rounded px-2 py-0.5 text-xs outline-none focus:border-blue-500 font-mono"
            >
              <option value="all">Active Connection</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.driver.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                filterStatus === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#22242c] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterStatus('success')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                filterStatus === 'success'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#22242c] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Success
            </button>
            <button
              onClick={() => setFilterStatus('error')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                filterStatus === 'error'
                  ? 'bg-rose-600 text-white'
                  : 'bg-[#22242c] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Error
            </button>
          </div>

          {/* Search Box */}
          <div className="relative flex-1 max-w-xs min-w-[140px]">
            <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search history SQL..."
              className="w-full bg-[#22242c] border border-[#2e313d] rounded pl-7 pr-2 py-0.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Refresh & Count */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-zinc-500 font-mono">
            {filteredHistory.length} {filteredHistory.length === 1 ? 'entry' : 'entries'}
          </span>
          <button
            onClick={loadHistory}
            disabled={isLoading}
            className="flex h-6 w-6 items-center justify-center rounded bg-[#22242c] hover:bg-[#2b2d37] text-zinc-400 hover:text-white transition-colors cursor-pointer"
            title="Refresh History"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* History List */}
      <div className="flex-1 overflow-auto p-2 space-y-1.5">
        {filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-zinc-500 gap-2">
            <Clock className="h-6 w-6 stroke-[1.5] text-zinc-600" />
            <p className="text-xs">No query history found</p>
          </div>
        ) : (
          filteredHistory.map((item) => {
            const isSuccess = item.status === 'success';
            const isError = item.status === 'error';
            return (
              <div
                key={item.id}
                className="group flex flex-col rounded border border-[#242732] bg-[#191b22] hover:border-[#383d4e] transition-colors p-2 text-xs"
              >
                {/* Meta Header */}
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Status Badge */}
                    {isSuccess ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-1.5 py-0.2 rounded font-mono">
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        SUCCESS
                      </span>
                    ) : isError ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-rose-400 bg-rose-950/40 border border-rose-800/50 px-1.5 py-0.2 rounded font-mono">
                        <XCircle className="h-3 w-3 text-rose-400" />
                        ERROR
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-950/40 border border-amber-800/50 px-1.5 py-0.2 rounded font-mono">
                        CANCELLED
                      </span>
                    )}

                    {/* Time */}
                    <span className="text-[11px] text-zinc-500 font-mono">
                      {formatTimestamp(item.executedAt)}
                    </span>

                    {/* Database & Schema */}
                    {item.databaseName && (
                      <span className="text-[11px] text-zinc-400 font-mono bg-[#121317] px-1.5 py-0.2 rounded border border-[#272932]">
                        db: {item.databaseName}
                      </span>
                    )}

                    {/* Stats */}
                    <span className="text-[11px] text-zinc-500 font-mono">
                      {item.durationMs}ms
                    </span>
                    {item.rowsAffected !== undefined && (
                      <span className="text-[11px] text-zinc-500 font-mono">
                        • {item.rowsAffected} {item.rowsAffected === 1 ? 'row' : 'rows'}
                      </span>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleCopySql(item.id, item.sqlText)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#22242c] hover:bg-[#2e313d] text-zinc-300 hover:text-white transition-colors cursor-pointer text-[10px]"
                      title="Copy SQL to Clipboard"
                    >
                      {copiedId === item.id ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3 text-zinc-400" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>

                    {onInsertToEditor && (
                      <button
                        onClick={() => {
                          onInsertToEditor(item.sqlText);
                          alertSuccess('Inserted query into active worksheet');
                        }}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#22242c] hover:bg-[#2e313d] text-zinc-300 hover:text-white transition-colors cursor-pointer text-[10px]"
                        title="Insert into active worksheet"
                      >
                        <FileCode className="h-3 w-3 text-blue-400" />
                        <span>Insert</span>
                      </button>
                    )}

                    {onExecuteQuery && (
                      <button
                        onClick={() => onExecuteQuery(item.sqlText, item.databaseName)}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-600/80 hover:bg-blue-600 text-white transition-colors cursor-pointer text-[10px]"
                        title="Run query again"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        <span>Run</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* SQL Code Block */}
                <pre className="font-mono text-[11px] text-zinc-200 bg-[#121317] border border-[#20222a] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed max-h-32">
                  {item.sqlText}
                </pre>

                {/* Error Message banner if error */}
                {isError && item.errorMessage && (
                  <div className="mt-1 flex items-start gap-1 text-[11px] text-rose-300 bg-rose-950/20 border border-rose-900/40 rounded px-2 py-1 font-mono">
                    <AlertCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <span>{item.errorMessage}</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
