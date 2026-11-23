import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  CopyPlus,
  Trash2,
  Check,
  Braces,
} from 'lucide-react';
import { ColumnMeta } from '../../types/domain';

interface MongoDocumentListViewProps {
  columns: ColumnMeta[];
  rows: any[][];
  onEditDocument: (rowIndex: number, doc: Record<string, any>) => void;
  onCloneDocument: (rowIndex: number, doc: Record<string, any>) => void;
  onDeleteDocument: (rowIndex: number, doc: Record<string, any>) => void;
  isReadOnly?: boolean;
}

function rowToDoc(columns: ColumnMeta[], row: any[]): Record<string, any> {
  const doc: Record<string, any> = {};
  columns.forEach((col, idx) => {
    const val = row[idx];
    if (val === undefined) return;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          doc[col.name] = JSON.parse(trimmed);
          return;
        } catch {}
      }
    }
    doc[col.name] = val;
  });
  return doc;
}

const JsonNode: React.FC<{
  keyName?: string;
  value: any;
  depth?: number;
  bsonTypeHint?: string;
}> = ({ keyName, value, depth = 0, bsonTypeHint }) => {
  const [expanded, setExpanded] = useState(depth < 2);

  const isObj = value !== null && typeof value === 'object' && !Array.isArray(value);
  const isArr = Array.isArray(value);

  const renderPrimitive = (v: any) => {
    if (v === null || v === undefined) {
      return <span className="text-zinc-500 italic">null</span>;
    }
    if (typeof v === 'boolean') {
      return <span className="text-amber-400">{String(v)}</span>;
    }
    if (typeof v === 'number') {
      return <span className="text-sky-400">{String(v)}</span>;
    }
    const str = String(v);
    if (bsonTypeHint === 'objectId' || (keyName === '_id' && /^[a-fA-F0-9]{24}$/.test(str))) {
      return (
        <span className="text-emerald-400">
          ObjectId(<span className="text-emerald-300">"{str}"</span>)
        </span>
      );
    }
    if (bsonTypeHint === 'date') {
      return (
        <span className="text-purple-400">
          ISODate(<span className="text-purple-300">"{str}"</span>)
        </span>
      );
    }
    if (bsonTypeHint === 'decimal') {
      return (
        <span className="text-cyan-400">
          NumberDecimal(<span className="text-cyan-300">"{str}"</span>)
        </span>
      );
    }
    return <span className="text-amber-200">"{str}"</span>;
  };

  if (!isObj && !isArr) {
    return (
      <div className="flex items-start gap-1.5 leading-5 font-mono text-[12px]">
        {keyName !== undefined && (
          <span className="text-zinc-400 shrink-0">
            <span className="text-indigo-300">"{keyName}"</span>:
          </span>
        )}
        <span className="break-all">{renderPrimitive(value)}</span>
      </div>
    );
  }

  const entries: [string, any][] = isArr
    ? value.map((v: any, i: number) => [String(i), v] as [string, any])
    : Object.entries(value);
  const openChar = isArr ? '[' : '{';
  const closeChar = isArr ? ']' : '}';

  return (
    <div className="font-mono text-[12px] leading-5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="text-zinc-500 hover:text-zinc-200 cursor-pointer p-0.5 -ml-1 rounded"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        {keyName !== undefined && (
          <span className="text-indigo-300">
            "{keyName}"<span className="text-zinc-400">:</span>
          </span>
        )}
        <span className="text-zinc-400">{openChar}</span>
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-zinc-500 hover:text-zinc-300 text-[11px] px-1 rounded bg-zinc-800/60 cursor-pointer"
          >
            {isArr ? `${entries.length} items` : `${entries.length} fields`}
          </button>
        )}
        {!expanded && <span className="text-zinc-400">{closeChar}</span>}
      </div>
      {expanded && (
        <div className="pl-4 border-l border-zinc-800/80 ml-1.5 space-y-0.5">
          {entries.map(([k, v]: [string, any]) => (
            <JsonNode key={k} keyName={isArr ? undefined : k} value={v} depth={depth + 1} />
          ))}
          <div className="text-zinc-400 -ml-3">{closeChar}</div>
        </div>
      )}
    </div>
  );
};

export const MongoDocumentListView: React.FC<MongoDocumentListViewProps> = ({
  columns,
  rows,
  onEditDocument,
  onCloneDocument,
  onDeleteDocument,
  isReadOnly,
}) => {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 py-12 gap-2">
        <Braces className="w-8 h-8 opacity-40" />
        <p className="text-xs">No documents matched the current query.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-2.5 bg-[#0f1014]">
      {rows.map((row, rIdx) => {
        const doc = rowToDoc(columns, row);
        const idDisplay = doc._id !== undefined ? String(doc._id) : `Row #${rIdx + 1}`;
        return (
          <div
            key={rIdx}
            className="rounded-lg border border-[#242731] bg-[#15171e] hover:border-emerald-500/40 transition-colors group"
          >
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#20232d] bg-[#181a22] rounded-t-lg">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  #{rIdx + 1}
                </span>
                <span className="text-[11px] font-mono text-zinc-300 truncate">
                  _id: <span className="text-emerald-300">{idDisplay}</span>
                </span>
              </div>
              <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
                    setCopiedIdx(rIdx);
                    setTimeout(() => setCopiedIdx(null), 1500);
                  }}
                  className="p-1 rounded hover:bg-[#262936] text-zinc-400 hover:text-zinc-100 cursor-pointer"
                  title="Copy JSON"
                >
                  {copiedIdx === rIdx ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                {!isReadOnly && (
                  <>
                    <button
                      type="button"
                      onClick={() => onEditDocument(rIdx, doc)}
                      className="p-1 rounded hover:bg-[#262936] text-zinc-400 hover:text-blue-400 cursor-pointer"
                      title="Edit Document JSON"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onCloneDocument(rIdx, doc)}
                      className="p-1 rounded hover:bg-[#262936] text-zinc-400 hover:text-emerald-400 cursor-pointer"
                      title="Clone Document"
                    >
                      <CopyPlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteDocument(rIdx, doc)}
                      className="p-1 rounded hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 cursor-pointer"
                      title="Delete Document"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="p-3 overflow-x-auto space-y-0.5">
              {Object.entries(doc).map(([k, v]) => {
                const colMeta = columns.find((c) => c.name === k);
                return (
                  <JsonNode
                    key={k}
                    keyName={k}
                    value={v}
                    depth={0}
                    bsonTypeHint={colMeta?.dataType}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
