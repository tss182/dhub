import React, { useState, useEffect } from 'react';
import { HelpCircle, Play, X } from 'lucide-react';

export interface ParameterPromptModalProps {
  isOpen: boolean;
  parameters: string[]; // e.g. [":user_id", ":status"] or ["$1", "$2"] or ["?1", "?2"]
  sql: string;
  onClose: () => void;
  onSubmit: (substitutedSql: string) => void;
}

export const ParameterPromptModal: React.FC<ParameterPromptModalProps> = ({
  isOpen,
  parameters,
  sql,
  onClose,
  onSubmit,
}) => {
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      const initial: Record<string, string> = {};
      parameters.forEach((p) => {
        initial[p] = '';
      });
      setParamValues(initial);
    }
  }, [isOpen, parameters]);

  if (!isOpen) return null;

  const handleRun = () => {
    let resultSql = sql;

    // Substitute parameters
    parameters.forEach((p) => {
      const rawVal = paramValues[p] ?? '';
      let formattedVal = 'NULL';
      if (rawVal.trim() !== '') {
        // If numeric, keep as is; if boolean, keep; else quote and escape
        if (/^-?\d+(\.\d+)?$/.test(rawVal.trim())) {
          formattedVal = rawVal.trim();
        } else if (/^(true|false)$/i.test(rawVal.trim())) {
          formattedVal = rawVal.trim().toUpperCase();
        } else {
          formattedVal = `'${rawVal.replace(/'/g, "''")}'`;
        }
      }

      // Escape special regex characters in param name
      const escapedParam = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // If starts with ':', match word boundary at end
      if (p.startsWith(':')) {
        const regex = new RegExp(`${escapedParam}\\b`, 'g');
        resultSql = resultSql.replace(regex, formattedVal);
      } else {
        const regex = new RegExp(escapedParam, 'g');
        resultSql = resultSql.replace(regex, formattedVal);
      }
    });

    onSubmit(resultSql);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-xl border border-[#272932] bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#272932] px-5 py-3.5 bg-[#1e2029]">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
              <HelpCircle className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Query Parameters</h2>
              <p className="text-[11px] text-zinc-400">Specify parameter values before executing</p>
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
        <div className="p-5 space-y-3.5 text-xs max-h-[60vh] overflow-y-auto">
          {parameters.map((p, idx) => (
            <div key={p}>
              <label className="block font-mono text-zinc-300 mb-1 font-semibold text-amber-300">
                {p}
              </label>
              <input
                autoFocus={idx === 0}
                type="text"
                placeholder={`Value for ${p} (leave blank for NULL)`}
                value={paramValues[p] ?? ''}
                onChange={(e) =>
                  setParamValues((prev) => ({ ...prev, [p]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleRun();
                  }
                }}
                className="w-full rounded-lg border border-[#272932] bg-[#22242c] px-3 py-2 text-zinc-200 outline-none focus:border-blue-500 font-mono"
              />
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-[#272932] bg-[#1e2029] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 font-medium text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRun}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 font-medium text-white hover:bg-emerald-500 transition-colors shadow-sm"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>Execute Query</span>
          </button>
        </div>
      </div>
    </div>
  );
};

