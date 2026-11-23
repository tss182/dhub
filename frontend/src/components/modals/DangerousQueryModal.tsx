import React from 'react';
import { AlertTriangle, ShieldAlert, X } from 'lucide-react';

export interface DangerousQueryModalProps {
  isOpen: boolean;
  sql: string;
  driver?: string;
  isProduction?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const DangerousQueryModal: React.FC<DangerousQueryModalProps> = ({
  isOpen,
  sql,
  driver,
  isProduction = false,
  onClose,
  onConfirm,
}) => {
  if (!isOpen) return null;

  const isRestCommand = /^(?:DELETE|POST|PUT|PATCH)\s+\//i.test(sql.trim());
  const isMongoDestructive =
    driver?.toLowerCase() === 'mongodb' ||
    /\bdb\s*\.\s*(?:dropDatabase\s*\(|(?:[a-zA-Z0-9_$-]+|getCollection\([^)]+\))\s*\.\s*(?:drop\s*\(|deleteMany\s*\(\s*\{\s*\}\s*\)|updateMany\s*\(\s*\{\s*\}\s*,))/i.test(
      sql.trim()
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-xl border border-rose-600/40 bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-rose-900/40 px-5 py-4 bg-rose-950/30">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-600/20 text-rose-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-rose-200">
                Dangerous Query Warning
              </h2>
              <p className="text-[11px] text-rose-300/70">
                {isRestCommand
                  ? 'Destructive REST API operation detected'
                  : isMongoDestructive
                  ? 'Destructive MongoDB operation detected'
                  : 'Statement without WHERE clause detected'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          {isProduction && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-950/60 border border-rose-600/50 p-2.5 text-rose-200 font-semibold text-xs">
              <ShieldAlert className="h-4 w-4 text-rose-400 shrink-0" />
              <span>CAUTION: You are connected to a PRODUCTION database!</span>
            </div>
          )}

          {isRestCommand ? (
            <p className="text-zinc-300 leading-relaxed">
              The REST command you are about to execute will permanently <strong className="text-rose-400">delete an entire index/collection</strong> or <strong className="text-rose-400">wipe all documents/points</strong> without a filter. This operation executes immediately and cannot be undone.
            </p>
          ) : isMongoDestructive ? (
            <p className="text-zinc-300 leading-relaxed">
              The MongoDB operation you are about to execute will permanently <strong className="text-rose-400">drop a database/collection</strong> or <strong className="text-rose-400">modify/delete all documents</strong> with an empty filter <code className="bg-[#272932] text-amber-300 px-1 py-0.5 rounded">{'{}'}</code>. This operation executes immediately and cannot be undone.
            </p>
          ) : (
            <p className="text-zinc-300 leading-relaxed">
              The SQL statement you are about to execute is an <strong className="text-rose-400">UPDATE</strong> or <strong className="text-rose-400">DELETE</strong> without a <code className="bg-[#272932] text-amber-300 px-1 py-0.5 rounded">WHERE</code> clause.
              This operation will affect <strong>ALL rows</strong> in the target table and{' '}
              {driver?.toLowerCase() === 'clickhouse'
                ? 'cannot be rolled back in ClickHouse.'
                : 'cannot be undone unless in an active transaction.'}
            </p>
          )}

          <div>
            <label className="block text-[11px] font-medium text-zinc-400 mb-1">
              Statement to be executed:
            </label>
            <pre className="rounded-lg border border-[#272932] bg-[#14151a] p-3 text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-36 whitespace-pre-wrap">
              {sql}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-[#272932] bg-[#1e2029] px-5 py-3">
          <button
            autoFocus
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 font-medium text-zinc-300 bg-[#272932] hover:bg-[#323541] transition-colors"
          >
            Cancel Execution
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onConfirm();
            }}
            className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-1.5 font-medium text-white hover:bg-rose-500 transition-colors shadow-sm"
          >
            <span>Execute Anyway</span>
          </button>
        </div>
      </div>
    </div>
  );
};

