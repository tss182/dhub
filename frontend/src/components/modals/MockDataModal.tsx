import React, { useState, useEffect, useRef } from 'react';
import { X, Wand2, Play, Square } from 'lucide-react';
import { SchemaService, QueryService } from '../../../bindings/dhub/internal/services';
import { ColumnMeta, resolveConnectionEnv } from '../../types/domain';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { alertError, alertSuccess } from '../../stores/useAlertStore';
import { createIdentityGenerator, generateMockValue } from '../../utils/mockData';
import { APP_DEFAULTS } from '../../config/defaults';

const MAX_MOCK_ROWS = APP_DEFAULTS.mockMaxRows;
const MOCK_INSERT_BATCH_SIZE = APP_DEFAULTS.mockInsertBatchSize;

interface MockProgress {
  inserted: number;
  total: number;
  batchCurrent: number;
  batchTotal: number;
}

interface MockDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  schema: string;
  tableName: string;
  onSuccess?: () => void;
}

export const MockDataModal: React.FC<MockDataModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  schema,
  tableName,
  onSuccess,
}) => {
  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [selectedCols, setSelectedCols] = useState<Record<string, boolean>>({});
  const [rowCount, setRowCount] = useState<number>(APP_DEFAULTS.mockDefaultRows);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<MockProgress | null>(null);
  const cancelRef = useRef(false);

  const connections = useConnectionStore((s) => s.connections);
  const activeConn = connections.find((c) => c.id === connectionId);
  const isProd = resolveConnectionEnv(activeConn) === 'prod';

  useEffect(() => {
    if (!isOpen || !connectionId || !tableName) return;
    setProgress(null);
    cancelRef.current = false;
    SchemaService.GetTableStructure(connectionId, database, schema, tableName)
      .then((res) => {
        const cols = (res?.columns || []) as ColumnMeta[];
        setColumns(cols);
        const init: Record<string, boolean> = {};
        cols.forEach((c) => {
          init[c.name] = !c.isAutoIncrement;
        });
        setSelectedCols(init);
      })
      .catch((err) => alertError(err?.message || 'Failed to load table structure'));
  }, [isOpen, connectionId, database, schema, tableName]);

  if (!isOpen || isProd) return null;

  const handleStop = () => {
    cancelRef.current = true;
  };

  const handleGenerate = async () => {
    if (isProd) {
      alertError('Generate Mock Data is disabled on PROD connections.');
      return;
    }
    const activeCols = columns.filter((c) => selectedCols[c.name]);
    if (activeCols.length === 0) {
      alertError('Select at least one column to populate.');
      return;
    }
    const count = Math.max(1, Math.min(MAX_MOCK_ROWS, rowCount));
    const batchTotal = Math.ceil(count / MOCK_INSERT_BATCH_SIZE);
    cancelRef.current = false;
    setIsGenerating(true);
    setProgress({
      inserted: 0,
      total: count,
      batchCurrent: 0,
      batchTotal,
    });

    try {
      const nextIdentity = createIdentityGenerator();
      let totalAffected = 0;

      for (let offset = 0; offset < count; offset += MOCK_INSERT_BATCH_SIZE) {
        if (cancelRef.current) break;

        const batchCurrent = Math.floor(offset / MOCK_INSERT_BATCH_SIZE) + 1;
        const batchLen = Math.min(MOCK_INSERT_BATCH_SIZE, count - offset);
        const batch = Array.from({ length: batchLen }, (_, bIdx) => {
          const idx = offset + bIdx;
          const identity = nextIdentity();
          const row: Record<string, any> = {};
          activeCols.forEach((c) => {
            row[c.name] = generateMockValue(c, idx, identity);
          });
          return {
            type: 'insert',
            primaryKey: {},
            changes: row,
          };
        });

        const affected = await QueryService.SubmitChanges(
          connectionId,
          database,
          schema,
          tableName,
          batch as any
        );
        totalAffected += Number(affected) || batch.length;

        setProgress({
          inserted: Math.min(count, offset + batchLen),
          total: count,
          batchCurrent,
          batchTotal,
        });
      }

      if (cancelRef.current) {
        alertSuccess(
          `Stopped after inserting ${totalAffected.toLocaleString()} of ${count.toLocaleString()} mock rows into "${tableName}".`
        );
      } else {
        alertSuccess(
          `Inserted ${(totalAffected || count).toLocaleString()} mock rows into "${tableName}".`
        );
      }
      onSuccess?.();
      onClose();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Mock Data Generation Failed');
    } finally {
      setIsGenerating(false);
      setProgress(null);
      cancelRef.current = false;
    }
  };

  const percent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.inserted / progress.total) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4">
      <div className="w-[520px] max-w-full rounded-xl bg-[#191a20] border border-[#272932] flex flex-col overflow-hidden text-xs text-zinc-200 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#272932] bg-[#14151a]">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-purple-400" />
            <span className="font-semibold text-sm text-white">Generate Mock Data — {tableName}</span>
          </div>
          <button
            onClick={isGenerating ? handleStop : onClose}
            className="text-zinc-400 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">
              Number of Rows (1–{MAX_MOCK_ROWS.toLocaleString()})
            </label>
            <input
              type="number"
              min={1}
              max={MAX_MOCK_ROWS}
              disabled={isGenerating}
              value={rowCount}
              onChange={(e) => setRowCount(Math.min(MAX_MOCK_ROWS, Math.max(0, Number(e.target.value))))}
              className="w-40 rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-100 font-mono focus:border-blue-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-[11px] text-zinc-400 mb-1.5">Columns to Populate</label>
            <div className="max-h-56 overflow-y-auto rounded border border-[#272932] bg-[#121317] divide-y divide-[#22242e]">
              {columns.map((c) => (
                <label
                  key={c.name}
                  className="flex items-center justify-between px-3 py-1.5 hover:bg-[#1a1c24] cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={isGenerating}
                      checked={Boolean(selectedCols[c.name])}
                      onChange={(e) =>
                        setSelectedCols((prev) => ({ ...prev, [c.name]: e.target.checked }))
                      }
                      className="rounded border-[#3b3e4f] bg-[#22242c] disabled:opacity-50"
                    />
                    <span className="font-mono text-zinc-200">{c.name}</span>
                    {c.isAutoIncrement && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        auto
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-zinc-500">{c.dataType}</span>
                </label>
              ))}
            </div>
          </div>

          {isGenerating && progress && (
            <div className="rounded-lg border border-purple-500/25 bg-[#121317] p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-300 font-medium">
                  Inserting rows...{' '}
                  <span className="font-mono text-purple-300">
                    {progress.inserted.toLocaleString()} / {progress.total.toLocaleString()}
                  </span>
                </span>
                <span className="font-mono text-purple-400 font-semibold">{percent}%</span>
              </div>

              <div className="w-full h-2 rounded-full bg-[#22242e] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all duration-150"
                  style={{ width: `${percent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                <span>
                  Batch {progress.batchCurrent.toLocaleString()} of {progress.batchTotal.toLocaleString()}
                </span>
                <span>{MOCK_INSERT_BATCH_SIZE} rows / batch</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#272932] bg-[#14151a]">
          {isGenerating ? (
            <button
              type="button"
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-300 cursor-pointer"
            >
              <Square className="h-3 w-3 fill-current" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-[#272932] hover:bg-[#22242c] cursor-pointer"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white font-medium cursor-pointer disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            <span>
              {isGenerating
                ? `Generating (${percent}%)...`
                : `Insert ${rowCount.toLocaleString()} Rows`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
