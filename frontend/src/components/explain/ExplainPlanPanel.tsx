import React, { useState } from 'react';
import { Copy, Check, FileText, Activity } from 'lucide-react';

export interface ExplainPlanPanelProps {
  planText?: string;
  planRows?: any[][];
  elapsedMs?: number;
}

export const ExplainPlanPanel: React.FC<ExplainPlanPanelProps> = ({
  planText,
  planRows,
  elapsedMs,
}) => {
  const [copied, setCopied] = useState(false);

  // Derive plain text from planRows or planText
  let content = planText || '';
  if (!content && planRows && planRows.length > 0) {
    content = planRows
      .map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))).join(' | '))
      .join('\n');
  }

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Copy error:', e);
    }
  };

  if (!content.trim()) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-zinc-500 text-xs">
        <Activity className="h-8 w-8 mb-2 opacity-40 text-blue-400" />
        <p className="font-medium text-zinc-400">No Query Plan Available</p>
        <p className="text-[11px] text-zinc-500 mt-1 max-w-xs">
          Click <strong>Explain</strong> or <strong>Explain Analyze</strong> in the SQL Console toolbar to inspect query execution plan and optimization costs.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#14151a] text-xs">
      {/* Toolbar */}
      <div className="flex h-8 items-center justify-between border-b border-[#272932] px-3 bg-[#191a20]">
        <div className="flex items-center gap-2 text-zinc-400">
          <Activity className="h-3.5 w-3.5 text-blue-400" />
          <span className="font-semibold text-zinc-300">Execution Plan</span>
          {typeof elapsedMs === 'number' && elapsedMs > 0 && (
            <span className="text-[11px] text-zinc-500 font-mono">({elapsedMs}ms)</span>
          )}
        </div>

        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors"
          title="Copy Execution Plan"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-[11px] text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span className="text-[11px]">Copy Plan</span>
            </>
          )}
        </button>
      </div>

      {/* Plan text viewer with syntax highlighting */}
      <div className="flex-1 overflow-auto p-4 font-mono text-[12px] leading-relaxed text-zinc-300 select-text">
        <pre className="whitespace-pre-wrap font-mono">
          {content.split('\n').map((line, idx) => {
            const isHeader = line.includes('QUERY PLAN') || line.startsWith('Execution Plan');
            const isCost = line.includes('cost=') || line.includes('rows=') || line.includes('loops=');
            const isScan = line.includes('Scan') || line.includes('Index') || line.includes('SEARCH');
            const isJoin = line.includes('Join') || line.includes('Nested Loop') || line.includes('Hash');

            let lineClass = 'text-zinc-300';
            if (isHeader) lineClass = 'font-bold text-blue-400 border-b border-[#272932] pb-0.5 inline-block';
            else if (isCost) lineClass = 'text-amber-300/90';
            else if (isScan) lineClass = 'text-emerald-400';
            else if (isJoin) lineClass = 'text-indigo-400';

            return (
              <div key={idx} className={`hover:bg-white/[0.03] py-0.5 ${lineClass}`}>
                {line}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
};

