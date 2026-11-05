import React, { useState, useEffect } from 'react';
import { Dialogs } from '@wailsio/runtime';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, X, ArrowRight, Table } from 'lucide-react';
import * as ExportService from '../../../bindings/dhub/internal/services/exportservice';
import * as SchemaService from '../../../bindings/dhub/internal/services/schemaservice';
import { ImportRequest, ColumnMapping } from '../../../bindings/dhub/internal/services/models';

export interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  onImportComplete?: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  schema,
  table,
  onImportComplete,
}) => {
  const [filePath, setFilePath] = useState<string>('');
  const [delimiter, setDelimiter] = useState<string>(',');
  const [hasHeader, setHasHeader] = useState<boolean>(true);

  const [step, setStep] = useState<'select' | 'mapping' | 'done'>('select');
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [tableColumns, setTableColumns] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({}); // fileCol -> tableCol

  const [loading, setLoading] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [result, setResult] = useState<{ rows: number; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && connectionId && table) {
      SchemaService.GetTableStructure(connectionId, database, schema, table)
        .then((struct) => {
          if (struct && struct.columns) {
            setTableColumns(struct.columns.map((c) => c.name));
          }
        })
        .catch((err) => console.warn('Failed to fetch table structure:', err));
    }
  }, [isOpen, connectionId, database, schema, table]);

  if (!isOpen) return null;

  const handleBrowseFile = async () => {
    try {
      const chosen = await Dialogs.OpenFile({
        Title: `Select File to Import into ${table}`,
        CanChooseFiles: true,
        AllowsMultipleSelection: false,
        Filters: [
          { DisplayName: 'Delimited Files (*.csv, *.tsv, *.txt)', Pattern: '*.csv;*.tsv;*.txt' },
          { DisplayName: 'All Files (*.*)', Pattern: '*.*' },
        ],
      });
      if (chosen && typeof chosen === 'string' && chosen.trim()) {
        setFilePath(chosen.trim());
      }
    } catch (e: any) {
      console.warn('OpenFile dialog error:', e);
    }
  };

  const handlePreviewFile = async () => {
    if (!filePath.trim()) {
      setError('Please choose a file to import.');
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const preview = await ExportService.PreviewImportFile(filePath.trim(), delimiter, hasHeader);
      if (preview) {
        setPreviewColumns(preview.columns);
        setPreviewRows(preview.rows);

        // Auto map matching column names (case-insensitive)
        const initialMap: Record<string, string> = {};
        preview.columns.forEach((fCol) => {
          const matched = tableColumns.find(
            (tCol) => tCol.toLowerCase() === fCol.toLowerCase()
          );
          if (matched) {
            initialMap[fCol] = matched;
          } else {
            initialMap[fCol] = '';
          }
        });
        setMappings(initialMap);
        setStep('mapping');
      }
    } catch (e: any) {
      setError(e?.message || String(e) || 'Failed to preview file');
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteImport = async () => {
    setError(null);
    setImporting(true);

    try {
      const mappingList: ColumnMapping[] = Object.entries(mappings)
        .filter(([_, tCol]) => tCol !== '')
        .map(([fCol, tCol]) => new ColumnMapping({
          fileColumn: fCol,
          tableColumn: tCol,
        }));

      if (mappingList.length === 0) {
        throw new Error('Please map at least one file column to a table column.');
      }

      const req = new ImportRequest({
        connectionId,
        database,
        schema,
        table,
        filePath: filePath.trim(),
        format: 'csv',
        delimiter,
        hasHeader,
        mappings: mappingList,
      });

      const res = await ExportService.ImportFileToTable(req);
      if (res) {
        setResult({
          rows: res.rowsImported,
          ms: res.elapsedMs,
        });
        setStep('done');
        if (onImportComplete) {
          onImportComplete();
        }
      }
    } catch (e: any) {
      setError(e?.message || String(e) || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl rounded-xl border border-[#272932] bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100 max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#272932] px-5 py-4 bg-[#1e2029]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <Upload className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                Import Data Wizard — {table}
              </h2>
              <p className="text-xs text-zinc-400">
                Target: <span className="text-blue-400">{database}</span> / <span className="text-amber-300">{schema || 'public'}</span>
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
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {step === 'select' && (
            <div className="space-y-4">
              <div>
                <label className="block font-medium text-zinc-300 mb-1.5">Source File</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="/path/to/data.csv"
                    value={filePath}
                    onChange={(e) => setFilePath(e.target.value)}
                    className="flex-1 rounded-lg border border-[#272932] bg-[#22242c] px-3 py-2 text-zinc-200 outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={handleBrowseFile}
                    className="rounded-lg border border-[#272932] bg-[#22242c] px-3 py-2 text-zinc-300 hover:bg-[#2c2f3a] transition-colors"
                  >
                    Browse...
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 rounded-lg border border-[#272932] bg-[#22242c]/50 p-3">
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
                      checked={hasHeader}
                      onChange={(e) => setHasHeader(e.target.checked)}
                      className="rounded border-[#272932] bg-[#191a20] text-blue-500 focus:ring-0"
                    />
                    <span>First row is header</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {step === 'mapping' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-300">Map File Columns to Table Columns</span>
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  className="text-blue-400 hover:underline text-[11px]"
                >
                  &larr; Choose different file
                </button>
              </div>

              {/* Mapping table */}
              <div className="rounded-lg border border-[#272932] overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#22242c] text-zinc-400 border-b border-[#272932]">
                    <tr>
                      <th className="py-2 px-3">File Column</th>
                      <th className="py-2 px-3 w-8 text-center">&rarr;</th>
                      <th className="py-2 px-3">Destination Column ({table})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#272932]">
                    {previewColumns.map((fCol) => (
                      <tr key={fCol} className="hover:bg-[#22242c]/50">
                        <td className="py-2 px-3 font-mono text-zinc-200">{fCol}</td>
                        <td className="py-2 px-3 text-center text-zinc-500">
                          <ArrowRight className="h-3.5 w-3.5 mx-auto" />
                        </td>
                        <td className="py-2 px-3">
                          <select
                            value={mappings[fCol] || ''}
                            onChange={(e) =>
                              setMappings((prev) => ({ ...prev, [fCol]: e.target.value }))
                            }
                            className="w-full rounded border border-[#272932] bg-[#191a20] px-2 py-1 text-zinc-200 outline-none focus:border-blue-500"
                          >
                            <option value="">[ Do not import / Skip ]</option>
                            {tableColumns.map((tCol) => (
                              <option key={tCol} value={tCol}>
                                {tCol}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Data Preview */}
              {previewRows.length > 0 && (
                <div>
                  <label className="block font-medium text-zinc-400 mb-1.5">
                    Data Preview (First {previewRows.length} rows)
                  </label>
                  <div className="rounded-lg border border-[#272932] overflow-x-auto max-h-36">
                    <table className="w-full text-left text-[11px] border-collapse font-mono">
                      <thead className="bg-[#22242c] text-zinc-400 border-b border-[#272932]">
                        <tr>
                          {previewColumns.map((col, idx) => (
                            <th key={idx} className="py-1.5 px-2.5 whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#272932]">
                        {previewRows.map((r, rIdx) => (
                          <tr key={rIdx} className="hover:bg-[#22242c]/30">
                            {r.map((c, cIdx) => (
                              <td key={cIdx} className="py-1 px-2.5 whitespace-nowrap text-zinc-300">
                                {c}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'done' && result && (
            <div className="flex flex-col items-center justify-center py-6 text-center space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-100">Import Completed Successfully!</h3>
              <p className="text-xs text-zinc-400 max-w-sm">
                Successfully inserted <span className="font-semibold text-emerald-400">{result.rows.toLocaleString()}</span> rows into <code className="text-zinc-200 bg-[#22242c] px-1.5 py-0.5 rounded">{table}</code> in {result.ms}ms.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="break-all">
                <p className="font-medium">Error</p>
                <p className="text-[11px] opacity-80 mt-0.5">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-[#272932] bg-[#1e2029] px-5 py-3">
          {step === 'select' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-1.5 font-medium text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loading || !filePath.trim()}
                onClick={handlePreviewFile}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors shadow-sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Inspecting...</span>
                  </>
                ) : (
                  <>
                    <span>Next: Map Columns</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </>
          )}

          {step === 'mapping' && (
            <>
              <button
                type="button"
                disabled={importing}
                onClick={() => setStep('select')}
                className="rounded-lg px-4 py-1.5 font-medium text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                disabled={importing}
                onClick={handleExecuteImport}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors shadow-sm"
              >
                {importing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Importing Rows...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5" />
                    <span>Start Batch Import</span>
                  </>
                )}
              </button>
            </>
          )}

          {step === 'done' && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-500 transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

