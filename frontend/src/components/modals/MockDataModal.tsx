import React, { useState, useEffect } from 'react';
import { X, Wand2, Play } from 'lucide-react';
import { SchemaService, QueryService } from '../../../bindings/dhub/internal/services';
import { ColumnMeta, resolveConnectionEnv } from '../../types/domain';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { alertError, alertSuccess } from '../../stores/useAlertStore';
import { createIdentityGenerator, generateMockValue } from '../../utils/mockData';

const MAX_MOCK_ROWS = 10000;
const MOCK_INSERT_BATCH_SIZE = 500;

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
  const [rowCount, setRowCount] = useState(25);
  const [isGenerating, setIsGenerating] = useState(false);

  const connections = useConnectionStore((s) => s.connections);
  const activeConn = connections.find((c) => c.id === connectionId);
  const isProd = resolveConnectionEnv(activeConn) === 'prod';

  useEffect(() => {
    if (!isOpen || !connectionId || !tableName) return;
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
    setIsGenerating(true);
    try {
      const nextIdentity = createIdentityGenerator();
      const changes = Array.from({ length: count }, (_, idx) => {
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

      let totalAffected = 0;
      for (let offset = 0; offset < changes.length; offset += MOCK_INSERT_BATCH_SIZE) {
        const batch = changes.slice(offset, offset + MOCK_INSERT_BATCH_SIZE);
        const affected = await QueryService.SubmitChanges(
          connectionId,
          database,
          schema,
          tableName,
          batch as any
        );
        totalAffected += Number(affected) || batch.length;
      }

      alertSuccess(`Inserted ${totalAffected || count} mock rows into "${tableName}".`);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Mock Data Generation Failed');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4">
      <div className="w-[520px] max-w-full rounded-xl bg-[#191a20] border border-[#272932] flex flex-col overflow-hidden text-xs text-zinc-200 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#272932] bg-[#14151a]">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-purple-400" />
            <span className="font-semibold text-sm text-white">Generate Mock Data — {tableName}</span>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">
              Number of Rows (1–{MAX_MOCK_ROWS})
            </label>
            <input
              type="number"
              min={1}
              max={MAX_MOCK_ROWS}
              value={rowCount}
              onChange={(e) => setRowCount(Math.min(MAX_MOCK_ROWS, Math.max(0, Number(e.target.value))))}
              className="w-36 rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
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
                      checked={Boolean(selectedCols[c.name])}
                      onChange={(e) =>
                        setSelectedCols((prev) => ({ ...prev, [c.name]: e.target.checked }))
                      }
                      className="rounded border-[#3b3e4f] bg-[#22242c]"
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
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#272932] bg-[#14151a]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded border border-[#272932] hover:bg-[#22242c] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white font-medium cursor-pointer disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            <span>{isGenerating ? 'Generating...' : `Insert ${rowCount} Rows`}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

