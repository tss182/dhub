import React, { useState } from 'react';
import { Dialogs } from '@wailsio/runtime';
import { Download, FileText, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import * as ExportService from '../../../bindings/dhub/internal/services/exportservice';
import { ExportRequest } from '../../../bindings/dhub/internal/services/models';

export interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database?: string;
  schema?: string;
  table?: string;
  sql?: string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database = '',
  schema = '',
  table = '',
  sql = '',
}) => {
  const [format, setFormat] = useState<'csv' | 'json' | 'sql_insert'>('csv');
  const [delimiter, setDelimiter] = useState<string>(',');
  const [includeHeader, setIncludeHeader] = useState<boolean>(true);
  const [filePath, setFilePath] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<{ rows: number; size: number; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const defaultFileName = table ? `${table}_export.${format === 'sql_insert' ? 'sql' : format}` : `export_${Date.now()}.${format === 'sql_insert' ? 'sql' : format}`;

  const handleBrowseSaveFile = async () => {
    try {
      const ext = format === 'sql_insert' ? 'sql' : format;
      const pattern = `*.${ext}`;
      const chosen = await Dialogs.SaveFile({
        Title: 'Choose Export Destination',
        Filename: defaultFileName,
        CanCreateDirectories: true,
        Filters: [
          {
            DisplayName: `${format.toUpperCase()} Files (${pattern})`,
            Pattern: pattern,
          },
          {
            DisplayName: 'All Files (*.*)',
            Pattern: '*.*',
          },
        ],
      });
      if (chosen && typeof chosen === 'string') {
        setFilePath(chosen.trim());
      }
    } catch (e: any) {
      console.warn('SaveFile dialog error:', e);
    }
  };

  const handleExport = async () => {
    if (!filePath.trim()) {
      setError('Please choose a destination file path.');
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const req = new ExportRequest({
        connectionId,
        database,
        schema,
        table,
        sql,
        format,
        filePath: filePath.trim(),
        delimiter,
        includeHeader,
      });

      const res = await ExportService.ExportToFile(req);
      if (res) {
        setResult({
          rows: res.rowsExported,
          size: res.fileSize,
          ms: res.elapsedMs,
        });
      }
    } catch (e: any) {
      setError(e?.message || String(e) || 'Export failed');
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#272932] bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#272932] px-5 py-4 bg-[#1e2029]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              <Download className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                Export Data {table ? `— ${table}` : sql ? '— Query Result' : ''}
              </h2>
              <p className="text-xs text-zinc-400">Export table or query results to local disk</p>
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
          {/* Format selection */}
          <div>
            <label className="block font-medium text-zinc-300 mb-1.5">Export Format</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'csv', label: 'CSV', desc: 'Delimited text' },
                { id: 'json', label: 'JSON', desc: 'Array of records' },
                { id: 'sql_insert', label: 'SQL INSERT', desc: 'DML batch script' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setFormat(f.id as any);
                    if (filePath) {
                      const base = filePath.replace(/\.[^/.]+$/, '');
                      setFilePath(`${base}.${f.id === 'sql_insert' ? 'sql' : f.id}`);
                    }
                  }}
                  className={`flex flex-col items-center justify-center rounded-lg border p-3 text-center transition-colors ${
                    format === f.id
                      ? 'border-blue-500 bg-blue-500/10 text-blue-400 font-medium'
                      : 'border-[#272932] bg-[#22242c] text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  <span className="text-sm font-semibold">{f.label}</span>
                  <span className="text-[10px] opacity-75">{f.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Format-specific options */}
          {format === 'csv' && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#272932] bg-[#22242c]/50 p-3">
              <div>
                <label className="block text-zinc-400 mb-1">Delimiter</label>
                <select
                  value={delimiter}
                  onChange={(e) => setDelimiter(e.target.value)}
                  className="w-full rounded border border-[#272932] bg-[#191a20] px-2 py-1.5 text-zinc-200 outline-none focus:border-blue-500"
                >
                  <option value=",">Comma (,)</option>
                  <option value=";">Semicolon (;)</option>
                  <option value="&#9;">Tab (\t)</option>
                </select>
              </div>
              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                  <input
                    type="checkbox"
                    checked={includeHeader}
                    onChange={(e) => setIncludeHeader(e.target.checked)}
                    className="rounded border-[#272932] bg-[#191a20] text-blue-500 focus:ring-0"
                  />
                  <span>Include Header Row</span>
                </label>
              </div>
            </div>
          )}

          {/* Destination file path */}
          <div>
            <label className="block font-medium text-zinc-300 mb-1.5">Destination File</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="/path/to/destination/file"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                className="flex-1 rounded-lg border border-[#272932] bg-[#22242c] px-3 py-2 text-zinc-200 outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleBrowseSaveFile}
                className="rounded-lg border border-[#272932] bg-[#22242c] px-3 py-2 text-zinc-300 hover:bg-[#2c2f3a] transition-colors"
              >
                Browse...
              </button>
            </div>
          </div>

          {/* Result or Error */}
          {result && (
            <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Export completed successfully!</p>
                <p className="text-[11px] opacity-80 mt-0.5">
                  Exported {result.rows.toLocaleString()} rows ({formatFileSize(result.size)}) in {result.ms}ms.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="break-all">
                <p className="font-medium">Export failed</p>
                <p className="text-[11px] opacity-80 mt-0.5">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-[#272932] bg-[#1e2029] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 font-medium text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            disabled={loading || !filePath.trim()}
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors shadow-sm"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                <span>Export Now</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

