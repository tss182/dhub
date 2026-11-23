import React, { useEffect, useState } from 'react';
import { X, FileCode, Copy, Check, Play } from 'lucide-react';
import { ConnectionConfig, resolveConnectionEnv } from '../../types/domain';
import { alertSuccess } from '../../stores/useAlertStore';

export interface TableSqlModalProps {
  isOpen: boolean;
  connection: ConnectionConfig | null;
  database: string;
  tableName: string;
  sql: string;
  onClose: () => void;
  onOpenInConsole?: (sql: string) => void;
}

export const TableSqlModal: React.FC<TableSqlModalProps> = ({
  isOpen,
  connection,
  database,
  tableName,
  sql,
  onClose,
  onOpenInConsole,
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCopied(false);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const env = resolveConnectionEnv(connection);
  const headerClass =
    env === 'prod'
      ? 'bg-[#351d20] border-rose-800/50'
      : env === 'dev'
      ? 'bg-[#193327] border-emerald-800/50'
      : 'bg-[#14151a] border-[#272932]';

  const handleCopy = async () => {
    if (!sql) return;
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      alertSuccess('SQL query copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const lineCount = sql ? sql.split('\n').length : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-3xl max-h-[85vh] rounded-2xl border bg-[#191a20] shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col overflow-hidden text-xs text-zinc-300 ${
          env === 'prod'
            ? 'border-rose-700/60'
            : env === 'dev'
            ? 'border-emerald-700/60'
            : 'border-[#2b2e3a]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between border-b px-5 py-3.5 shrink-0 ${headerClass}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400">
              <FileCode className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm text-zinc-100 truncate">Table Query SQL</h3>
                {env !== 'local' && (
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase font-mono border ${
                      env === 'prod'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    }`}
                  >
                    {env}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-400 font-mono truncate">
                {tableName} ({database || (connection?.driver === 'postgres' ? 'postgres' : 'main')})
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 p-4 flex flex-col gap-3 overflow-hidden">
          <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-[#272932] bg-[#121317] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#232530] bg-[#16171d] text-[11px] text-zinc-400 shrink-0">
              <div className="flex items-center gap-1.5 font-mono">
                <FileCode className="h-3.5 w-3.5 text-blue-400" />
                <span>{tableName ? `${tableName}_query.sql` : 'query.sql'}</span>
              </div>
              <span className="font-mono text-zinc-500">{lineCount} lines</span>
            </div>
            <pre className="flex-1 min-h-0 p-4 font-mono text-xs text-emerald-300/95 overflow-auto select-text whitespace-pre-wrap break-words leading-relaxed">
              {sql}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-[#272932] px-5 py-3 bg-[#14151a] shrink-0">
          <div>
            {onOpenInConsole && (
              <button
                type="button"
                onClick={() => {
                  onOpenInConsole(sql);
                  onClose();
                }}
                disabled={!sql}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#272932] bg-[#1c1d24] hover:bg-[#252730] text-zinc-300 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5 text-emerald-400" />
                <span>Open in Console</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!sql}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-sm transition-colors cursor-pointer disabled:opacity-40"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy SQL</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-[#272932] hover:bg-[#22242c] text-zinc-300 transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
