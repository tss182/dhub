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
  numericCost?: number;
  exclusiveCost?: number;
  exclusiveTimeMs?: number;
  rows?: string;
  actualRows?: string;
  actualTime?: string;
  buffers?: string;
  loops?: number;
  sortInfo?: string;
  isWarning?: boolean;
  isHotspot?: boolean;
  isRowEstimateSkew?: boolean;
  children: PlanNode[];
}

function parseJsonPlan(raw: string): PlanNode | null {
  try {
    const parsed = JSON.parse(raw);
    const pgRoot = Array.isArray(parsed) ? parsed[0]?.Plan : parsed?.Plan;
    const mysqlRoot = parsed?.query_block;

    let counter = 0;

    if (pgRoot && pgRoot['Node Type']) {
      const convertPg = (node: any): PlanNode => {
        const nodeType = node['Node Type'] || 'Operation';
        const rel = node['Relation Name'] ? ` on ${node['Relation Name']}` : '';
        const alias = node['Alias'] && node['Alias'] !== node['Relation Name'] ? ` (${node['Alias']})` : '';
        const totalCost = typeof node['Total Cost'] === 'number' ? node['Total Cost'] : undefined;
        const cost =
          totalCost !== undefined
            ? `${node['Startup Cost'] ?? 0}..${totalCost}`
            : undefined;
        const planRows = typeof node['Plan Rows'] === 'number' ? node['Plan Rows'] : undefined;
        const actualRowsNum = typeof node['Actual Rows'] === 'number' ? node['Actual Rows'] : undefined;
        const rows = planRows !== undefined ? String(planRows) : undefined;
        const actualRows = actualRowsNum !== undefined ? String(actualRowsNum) : undefined;
        const actualTimeNum = typeof node['Actual Total Time'] === 'number' ? node['Actual Total Time'] : undefined;
        const actualTime =
          actualTimeNum !== undefined ? `${actualTimeNum} ms` : undefined;
        const hit = node['Shared Hit Blocks'];
        const read = node['Shared Read Blocks'];
        const buffers =
          hit !== undefined || read !== undefined
            ? `hit=${hit ?? 0}, read=${read ?? 0}`
            : undefined;
        const loops = typeof node['Actual Loops'] === 'number' && node['Actual Loops'] > 1 ? node['Actual Loops'] : undefined;
        const sortInfo = node['Sort Method']
          ? `${node['Sort Method']}${node['Sort Space Used'] ? ` (${node['Sort Space Used']}kB ${node['Sort Space Type'] || ''})` : ''}`
          : undefined;
        const isWarning = nodeType.includes('Seq Scan') || nodeType.includes('Table Scan');
        const isRowEstimateSkew =
          planRows !== undefined &&
          actualRowsNum !== undefined &&
          Math.max(planRows, actualRowsNum) > 10 &&
          (actualRowsNum > planRows * 5 || planRows > actualRowsNum * 5);
        const children: PlanNode[] = Array.isArray(node['Plans']) ? node['Plans'].map(convertPg) : [];
        const childCostSum = children.reduce((sum, ch) => sum + (ch.numericCost || 0), 0);
        const childTimeSum = children.reduce((sum, ch) => sum + (ch.actualTime ? parseFloat(ch.actualTime) || 0 : 0), 0);
        const exclusiveCost = totalCost !== undefined ? Math.max(0, totalCost - childCostSum) : undefined;
        const exclusiveTimeMs = actualTimeNum !== undefined ? Math.max(0, actualTimeNum - childTimeSum) : undefined;

        return {
          id: `pg-${counter++}`,
          title: `${nodeType}${rel}${alias}`,
          detail: node['Filter'] || node['Index Cond'] || node['Hash Cond'] || node['Sort Key']?.join(', ') || undefined,
          cost,
          numericCost: totalCost,
          exclusiveCost,
          exclusiveTimeMs,
          rows,
          actualRows,
          actualTime,
          buffers,
          loops,
          sortInfo,
          isWarning,
          isRowEstimateSkew,
          children,
        };
      };

      const root = convertPg(pgRoot);
      markHotspot(root);
      return root;
    }

    if (mysqlRoot) {
      const convertMysql = (obj: any, fallbackTitle = 'Query Block'): PlanNode => {
        const children: PlanNode[] = [];
        let title = fallbackTitle;
        let detail: string | undefined;
        let cost: string | undefined;
        let numericCost: number | undefined;
        let rows: string | undefined;
        let isWarning = false;

        if (obj.table) {
          const t = obj.table;
          const access = t.access_type ? ` [${t.access_type}]` : '';
          title = `Table: ${t.table_name || 'unknown'}${access}`;
          detail = t.attached_condition || (t.key ? `key: ${t.key}` : undefined);
          if (t.cost_info?.read_cost !== undefined) {
            numericCost = Number(t.cost_info.read_cost) + Number(t.cost_info.eval_cost || 0);
            cost = numericCost.toFixed(2);
          }
          if (t.rows_examined_per_scan !== undefined) {
            rows = String(t.rows_examined_per_scan);
          }
          isWarning = t.access_type === 'ALL';
        } else if (obj.cost_info?.query_cost !== undefined) {
          numericCost = Number(obj.cost_info.query_cost);
          cost = numericCost.toFixed(2);
        }

        if (Array.isArray(obj.nested_loop)) {
          obj.nested_loop.forEach((nl: any) => children.push(convertMysql(nl, 'Nested Loop')));
        }
        if (obj.ordering_operation) {
          children.push(convertMysql(obj.ordering_operation, 'Sort / Ordering'));
        }
        if (obj.grouping_operation) {
          children.push(convertMysql(obj.grouping_operation, 'Group By'));
        }
        if (obj.duplicates_removal) {
          children.push(convertMysql(obj.duplicates_removal, 'Distinct'));
        }
        if (obj.table && obj !== mysqlRoot) {
          // already handled above
        }

        return {
          id: `my-${counter++}`,
          title,
          detail,
          cost,
          numericCost,
          rows,
          isWarning,
          children,
        };
      };

      const root = convertMysql(mysqlRoot, `Query Block #${mysqlRoot.select_id ?? 1}`);
      markHotspot(root);
      return root;
    }

    // MongoDB .explain() JSON format
    if (parsed?.queryPlanner || parsed?.executionStats || Array.isArray(parsed?.stages)) {
      const convertMongoStage = (stage: any): PlanNode => {
        const name = stage.stage || (stage.$cursor ? 'CURSOR' : 'STAGE');
        const idxName = stage.indexName ? ` [index: ${stage.indexName}]` : '';
        const isWarn = name === 'COLLSCAN' || (name === 'SORT' && stage.memLimit !== undefined);
        const detailParts: string[] = [];
        if (stage.direction) detailParts.push(`dir=${stage.direction}`);
        if (stage.indexBounds) detailParts.push(`bounds=${JSON.stringify(stage.indexBounds)}`);
        if (stage.filter) detailParts.push(`filter=${JSON.stringify(stage.filter)}`);
        if (stage.sortPattern) detailParts.push(`sort=${JSON.stringify(stage.sortPattern)}`);

        const children: PlanNode[] = [];
        if (stage.inputStage) children.push(convertMongoStage(stage.inputStage));
        if (Array.isArray(stage.inputStages)) {
          stage.inputStages.forEach((s: any) => children.push(convertMongoStage(s)));
        }
        if (stage.$cursor?.executionStats?.executionStages) {
          children.push(convertMongoStage(stage.$cursor.executionStats.executionStages));
        } else if (stage.$cursor?.queryPlanner?.winningPlan) {
          children.push(convertMongoStage(stage.$cursor.queryPlanner.winningPlan));
        }

        return {
          id: `mongo-${counter++}`,
          title: `${name}${idxName}`,
          detail: detailParts.join(' | ') || undefined,
          actualRows: stage.nReturned !== undefined ? String(stage.nReturned) : undefined,
          actualTime:
            stage.executionTimeMillisEstimate !== undefined
              ? `${stage.executionTimeMillisEstimate} ms`
              : undefined,
          numericCost: typeof stage.executionTimeMillisEstimate === 'number' ? stage.executionTimeMillisEstimate : undefined,
          isWarning: isWarn,
          children,
        };
      };

      const execStats = parsed.executionStats;
      const winningPlan = parsed.queryPlanner?.winningPlan;
      const rootStage = execStats?.executionStages || winningPlan;

      const rootChildren: PlanNode[] = [];
      if (rootStage) {
        rootChildren.push(convertMongoStage(rootStage));
      } else if (Array.isArray(parsed.stages)) {
        parsed.stages.forEach((st: any) => rootChildren.push(convertMongoStage(st)));
      }

      const rejected = parsed.queryPlanner?.rejectedPlans;
      if (Array.isArray(rejected) && rejected.length > 0) {
        rootChildren.push({
          id: `mongo-${counter++}`,
          title: `Rejected Plans (${rejected.length})`,
          children: rejected.map((rp: any) => convertMongoStage(rp)),
        });
      }

      const kpiParts: string[] = [];
      if (execStats) {
        if (execStats.nReturned !== undefined) kpiParts.push(`nReturned=${execStats.nReturned}`);
        if (execStats.totalDocsExamined !== undefined) kpiParts.push(`docsExamined=${execStats.totalDocsExamined}`);
        if (execStats.totalKeysExamined !== undefined) kpiParts.push(`keysExamined=${execStats.totalKeysExamined}`);
        if (execStats.executionTimeMillis !== undefined) kpiParts.push(`time=${execStats.executionTimeMillis}ms`);
        if (execStats.totalDocsExamined === 0 && (execStats.totalKeysExamined ?? 0) > 0) {
          kpiParts.push('COVERED');
        }
      }

      const ns = parsed.queryPlanner?.namespace ? ` (${parsed.queryPlanner.namespace})` : '';
      const root: PlanNode = {
        id: `mongo-${counter++}`,
        title: `MongoDB Explain${ns}`,
        detail: kpiParts.join(' • ') || undefined,
        actualRows: execStats?.nReturned !== undefined ? String(execStats.nReturned) : undefined,
        actualTime: execStats?.executionTimeMillis !== undefined ? `${execStats.executionTimeMillis} ms` : undefined,
        children: rootChildren,
      };
      markHotspot(root);
      return root;
    }

    return null;
  } catch {
    return null;
  }
}

function markHotspot(root: PlanNode) {
  let maxScore = -1;
  let maxNode: PlanNode | null = null;
  const walk = (n: PlanNode) => {
    const score =
      typeof n.exclusiveTimeMs === 'number' && n.exclusiveTimeMs > 0
        ? n.exclusiveTimeMs
        : typeof n.exclusiveCost === 'number'
        ? n.exclusiveCost
        : typeof n.numericCost === 'number'
        ? n.numericCost
        : -1;
    if (score > maxScore) {
      maxScore = score;
      maxNode = n;
    }
    n.children.forEach(walk);
  };
  walk(root);
  if (maxNode && maxScore > 0 && root.children.length > 0) {
    (maxNode as PlanNode).isHotspot = true;
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
                rows: {node.rows}{node.actualRows !== undefined ? ` (actual: ${node.actualRows})` : ''}
              </span>
            )}
            {node.actualTime && (
              <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/25 font-mono text-[10px]">
                time: {node.actualTime}
              </span>
            )}
            {node.loops && (
              <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 font-mono text-[10px]">
                loops: {node.loops}
              </span>
            )}
            {node.buffers && (
              <span className="px-1.5 py-0.5 rounded bg-zinc-700/40 text-zinc-300 border border-zinc-600/40 font-mono text-[10px]">
                buffers: {node.buffers}
              </span>
            )}
            {node.sortInfo && (
              <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 font-mono text-[10px]">
                sort: {node.sortInfo}
              </span>
            )}
            {node.isHotspot && (
              <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono text-[10px] font-bold">
                HOTSPOT
              </span>
            )}
            {node.isRowEstimateSkew && (
              <span
                className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-[10px]"
                title="Estimated rows differ significantly from actual rows (>5x). Consider running ANALYZE."
              >
                ESTIMATE SKEW
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
