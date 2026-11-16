import React, { useState, useMemo } from 'react';
import { Copy, Check, Activity, GitBranch, FileText, ChevronRight, ChevronDown, AlertTriangle } from 'lucide-react';

export interface ExplainPlanPanelProps {
  planText?: string;
  planRows?: any[][];
  elapsedMs?: number;
}

interface PlanNode {
  id: string;
  title: string;
  detail?: string;
  cost?: string;
  rows?: string;
  actualTime?: string;
  isWarning?: boolean;
  children: PlanNode[];
}

function parseJsonPlan(raw: string): PlanNode | null {
  try {
    const parsed = JSON.parse(raw);
    const rootObj = Array.isArray(parsed) ? parsed[0]?.Plan : parsed?.Plan || parsed?.query_block;
    if (!rootObj) return null;

    let counter = 0;
    const convertPg = (node: any): PlanNode => {
      const nodeType = node['Node Type'] || 'Operation';
      const rel = node['Relation Name'] ? ` on ${node['Relation Name']}` : '';
      const alias = node['Alias'] && node['Alias'] !== node['Relation Name'] ? ` (${node['Alias']})` : '';
      const cost =
        node['Total Cost'] !== undefined
          ? `${node['Startup Cost'] ?? 0}..${node['Total Cost']}`
          : undefined;
      const rows = node['Plan Rows'] !== undefined ? String(node['Plan Rows']) : undefined;
      const actualTime =
        node['Actual Total Time'] !== undefined ? `${node['Actual Total Time']} ms` : undefined;
      const isWarning = nodeType.includes('Seq Scan') || nodeType.includes('Table Scan');
      const children = Array.isArray(node['Plans']) ? node['Plans'].map(convertPg) : [];

      return {
        id: `pg-${counter++}`,
        title: `${nodeType}${rel}${alias}`,
        detail: node['Filter'] || node['Index Cond'] || node['Hash Cond'] || undefined,
        cost,
        rows,
        actualTime,
        isWarning,
        children,
      };
    };

    if (rootObj['Node Type']) {
      return convertPg(rootObj);
    }
    return null;
  } catch {
    return null;
  }
}

function parseTextPlan(content: string): PlanNode[] {
  const lines = content.split('\n').filter((l) => l.trim() !== '');
  const roots: PlanNode[] = [];
  const stack: { indent: number; node: PlanNode }[] = [];

  lines.forEach((line, idx) => {
    const leadingSpaces = line.search(/\S|$/);
    const clean = line.trim().replace(/^->\s*/, '');
    if (clean === 'QUERY PLAN' || /^-+$/.test(clean) || clean.startsWith('(') && clean.endsWith('row)')) {
      return;
    }

    const costMatch = clean.match(/\(cost=([^\s)]+)/);
    const rowsMatch = clean.match(/rows=(\d+)/);
    const timeMatch = clean.match(/actual time=([^\s)]+)/);
    const isWarning = /Seq Scan|SCAN TABLE|TABLE SCAN|ALL\s+\|/i.test(clean);

    const node: PlanNode = {
      id: `txt-${idx}`,
      title: clean.split(/\s+\(cost=/)[0],
      detail: clean.includes('(cost=') ? clean.slice(clean.indexOf('(cost=')) : undefined,
      cost: costMatch?.[1],
      rows: rowsMatch?.[1],
      actualTime: timeMatch?.[1] ? `${timeMatch[1]} ms` : undefined,
      isWarning,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].indent >= leadingSpaces) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ indent: leadingSpaces, node });
  });

  return roots;
}

const PlanTreeNode: React.FC<{ node: PlanNode; depth?: number }> = ({ node, depth = 0 }) => {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div className="select-text">
      <div
        className={`flex items-start gap-2 rounded-lg border px-3 py-2 mb-1.5 transition-colors ${
          node.isWarning
            ? 'bg-amber-500/5 border-amber-500/30 hover:border-amber-500/50'
            : 'bg-[#181920] border-[#272932] hover:border-zinc-600'
        }`}
        style={{ marginLeft: `${depth * 20}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-0.5 text-zinc-400 hover:text-white cursor-pointer shrink-0"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {node.isWarning && (
              <span title="Full table/sequential scan detected">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              </span>
            )}
            <span className="font-mono font-semibold text-zinc-100 text-[12px] break-all">
              {node.title}
            </span>
            {node.cost && (
              <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/25 font-mono text-[10px]">
                cost: {node.cost}
              </span>
            )}
            {node.rows && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 font-mono text-[10px]">
                rows: {node.rows}
              </span>
            )}
            {node.actualTime && (
              <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/25 font-mono text-[10px]">
                time: {node.actualTime}
              </span>
            )}
          </div>
          {node.detail && (
            <div className="mt-1 font-mono text-[11px] text-zinc-400 break-all">
              {node.detail}
            </div>
          )}
        </div>
      </div>

      {expanded &&
        hasChildren &&
        node.children.map((child) => <PlanTreeNode key={child.id} node={child} depth={depth + 1} />)}
    </div>
  );
};

export const ExplainPlanPanel: React.FC<ExplainPlanPanelProps> = ({
  planText,
  planRows,
  elapsedMs,
}) => {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'visual' | 'raw'>('visual');

  let content = planText || '';
  if (!content && planRows && planRows.length > 0) {
    content = planRows
      .map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))).join(' | '))
      .join('\n');
  }

  const parsedNodes = useMemo(() => {
    if (!content.trim()) return [];
    const jsonRoot = parseJsonPlan(content);
    if (jsonRoot) return [jsonRoot];
    return parseTextPlan(content);
  }, [content]);

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

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded bg-[#14151a] border border-[#272932] p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('visual')}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                viewMode === 'visual' ? 'bg-blue-600/25 text-blue-300' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <GitBranch className="h-3 w-3" />
              <span>Visual Tree</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('raw')}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                viewMode === 'raw' ? 'bg-blue-600/25 text-blue-300' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileText className="h-3 w-3" />
              <span>Raw Text</span>
            </button>
          </div>

          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors cursor-pointer"
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'visual' && parsedNodes.length > 0 ? (
          <div className="space-y-1">
            {parsedNodes.map((n) => (
              <PlanTreeNode key={n.id} node={n} />
            ))}
          </div>
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-zinc-300 select-text">
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
        )}
      </div>
    </div>
  );
};
