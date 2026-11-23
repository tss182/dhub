import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Edit3, Check } from 'lucide-react';
import { ColumnMeta } from '../../types/domain';

interface MongoTreeViewProps {
  columns: ColumnMeta[];
  rows: any[][];
  onEditDocument: (rowIndex: number, doc: Record<string, any>) => void;
  isReadOnly?: boolean;
}

function parseDocFromRow(columns: ColumnMeta[], row: any[]): Record<string, any> {
  const doc: Record<string, any> = {};
  columns.forEach((col, idx) => {
    const val = row[idx];
    if (val === undefined) return;
    if (typeof val === 'string') {
      const t = val.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        try {
          doc[col.name] = JSON.parse(t);
          return;
        } catch {}
      }
    }
    doc[col.name] = val;
  });
  return doc;
}

function detectDisplayBsonType(val: any, hint?: string): string {
  if (val === null || val === undefined) return 'Null';
  if (Array.isArray(val)) return `Array (${val.length})`;
  if (typeof val === 'object') return `Object (${Object.keys(val).length})`;
  if (typeof val === 'boolean') return 'Boolean';
  if (typeof val === 'number') return Number.isInteger(val) ? 'Int64' : 'Double';
  if (hint) {
    const h = hint.toLowerCase();
    if (h === 'objectid') return 'ObjectId';
    if (h === 'date') return 'Date';
    if (h === 'decimal') return 'Decimal128';
  }
  const s = String(val);
  if (/^[a-fA-F0-9]{24}$/.test(s)) return 'ObjectId';
  return 'String';
}

const TreeNodeRow: React.FC<{
  label: string;
  value: any;
  depth: number;
  typeHint?: string;
  defaultExpanded?: boolean;
}> = ({ label, value, depth, typeHint, defaultExpanded = false }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  const isContainer = value !== null && typeof value === 'object';
  const entries = isContainer
    ? Array.isArray(value)
      ? value.map((v, i) => [`[${i}]`, v] as [string, any])
      : Object.entries(value)
    : [];

  const typeLabel = detectDisplayBsonType(value, typeHint);
  const valuePreview = isContainer
    ? Array.isArray(value)
      ? `[ ${value.length} elements ]`
      : `{ ${Object.keys(value).length} fields }`
    : value === null || value === undefined
    ? 'null'
    : String(value);

  return (
    <>
      <div
        className="grid grid-cols-[minmax(220px,36%)_1fr_110px_48px] items-center border-b border-[#1c1f28] hover:bg-[#191c25] text-[12px] font-mono group"
        style={{ paddingLeft: `${depth * 18 + 10}px` }}
      >
        <div className="flex items-center gap-1.5 py-1.5 pr-2 truncate">
          {isContainer ? (
            <button
              type="button"
              onClick={() => setExpanded((p) => !p)}
              className="text-zinc-500 hover:text-zinc-200 cursor-pointer shrink-0"
            >
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <span className="w-3.5 inline-block shrink-0" />
          )}
          <span className="text-indigo-300 truncate">{label}</span>
        </div>

        <div className="py-1.5 pr-3 truncate text-zinc-200">
          {value === null || value === undefined ? (
            <span className="text-zinc-500 italic">null</span>
          ) : isContainer ? (
            <span className="text-zinc-500">{valuePreview}</span>
          ) : (
            <span className={typeof value === 'number' ? 'text-sky-400' : typeof value === 'boolean' ? 'text-amber-400' : 'text-zinc-200'}>
              {valuePreview}
            </span>
          )}
        </div>

        <div className="py-1.5 px-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400 border border-zinc-700/60">
            {typeLabel}
          </span>
        </div>

        <div className="py-1.5 px-2 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => {
              const raw = isContainer ? JSON.stringify(value, null, 2) : String(value ?? '');
              navigator.clipboard.writeText(raw);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="p-1 rounded hover:bg-zinc-700/60 text-zinc-400 hover:text-white cursor-pointer"
            title="Copy value"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {isContainer &&
        expanded &&
        entries.map(([k, v]) => (
          <TreeNodeRow key={`${label}.${k}`} label={k} value={v} depth={depth + 1} />
        ))}
    </>
  );
};

export const MongoTreeView: React.FC<MongoTreeViewProps> = ({
  columns,
  rows,
  onEditDocument,
  isReadOnly,
}) => {
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-zinc-500 py-12">
        No documents matched the current query.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-[#0f1014]">
      <div className="sticky top-0 z-10 grid grid-cols-[minmax(220px,36%)_1fr_110px_48px] bg-[#161820] border-b border-[#262934] text-[10px] font-semibold uppercase tracking-wider text-zinc-400 px-3 py-1.5">
        <div>Key</div>
        <div>Value</div>
        <div>BSON Type</div>
        <div className="text-right">Act</div>
      </div>
      {rows.map((row, rIdx) => {
        const doc = parseDocFromRow(columns, row);
        const idStr = doc._id !== undefined ? String(doc._id) : `#${rIdx + 1}`;
        return (
          <div key={rIdx} className="border-b border-[#252834]">
            <div className="flex items-center justify-between px-3 py-1 bg-[#14161d] text-[11px] font-mono text-zinc-400">
              <span>
                Document <span className="text-emerald-400">#{rIdx + 1}</span> — _id:{' '}
                <span className="text-zinc-200">{idStr}</span>
              </span>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => onEditDocument(rIdx, doc)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-[#20232e] hover:bg-[#2a2e3c] text-zinc-300 cursor-pointer"
                >
                  <Edit3 className="w-3 h-3" /> Edit JSON
                </button>
              )}
            </div>
            {Object.entries(doc).map(([k, v]) => {
              const colMeta = columns.find((c) => c.name === k);
              return (
                <TreeNodeRow
                  key={k}
                  label={k}
                  value={v}
                  depth={0}
                  typeHint={colMeta?.dataType}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
