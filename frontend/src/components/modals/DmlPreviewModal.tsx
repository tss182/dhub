import React, { useState, useEffect, useRef } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { ConnectionConfig, resolveConnectionEnv } from '../../types/domain';

interface DmlPreviewModalProps {
  statements: string[] | null;
  connection?: ConnectionConfig;
  onClose: () => void;
  onApply: () => void;
}

export const DmlPreviewModal: React.FC<DmlPreviewModalProps> = ({
  statements,
  connection,
  onClose,
  onApply,
}) => {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setCopied(false);
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, [statements]);

  if (!statements) return null;

  const sqlText = statements.join('\n\n');

  const handleCopy = async () => {
    if (!sqlText) return;
    try {
      await navigator.clipboard.writeText(sqlText);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const env = resolveConnectionEnv(connection);
  const headerClass =
    env === 'prod'
      ? 'bg-rose-950/75 border-rose-800/70'
      : env === 'dev'
      ? 'bg-emerald-950/75 border-emerald-800/70'
      : 'bg-[#14151a] border-[#272932]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="w-[600px] rounded-lg bg-[#191a20] border border-[#272932] overflow-hidden text-xs text-zinc-300 shadow-2xl">
        <div className={`flex items-center justify-between border-b px-4 py-3 ${headerClass}`}>
          <span className="font-semibold text-sm text-zinc-100">
            {connection?.driver === 'qdrant'
              ? 'Pending Qdrant REST Operations'
              : connection?.driver === 'elasticsearch'
              ? 'Pending Elasticsearch REST Operations'
              : 'Pending DML Statements'}
          </span>
          <button onClick={onClose} className="text-zinc-400 hover:text-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">
          {connection?.driver?.toLowerCase() === 'clickhouse' &&
            statements.some((s) => /^\s*ALTER\s+TABLE\s+[\s\S]*\b(?:UPDATE|DELETE)\b/i.test(s)) && (
              <div className="mb-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                <strong>ClickHouse Mutation:</strong> UPDATE/DELETE executes an asynchronous{' '}
                <code className="font-mono">ALTER TABLE ... SETTINGS mutations_sync = 1</code> mutation.
                In ClickHouse, primary/sorting keys are not guaranteed to be unique — verify the{' '}
                <code className="font-mono">WHERE</code> clause before applying.
              </div>
            )}
          <pre className="p-3 bg-[#121317] rounded border border-[#272932] font-mono text-xs text-emerald-400 max-h-60 overflow-auto">
            {sqlText}
          </pre>
          <div className="flex items-center justify-between gap-2 mt-4">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!sqlText}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#272932] hover:bg-[#22242c] text-zinc-200 cursor-pointer disabled:opacity-40"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>
                    {connection?.driver === 'qdrant' || connection?.driver === 'elasticsearch'
                      ? 'Copy REST'
                      : 'Copy Query'}
                  </span>
                </>
              )}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded border border-[#272932] hover:bg-[#22242c] cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onApply();
                }}
                className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm cursor-pointer"
              >
                Apply Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

