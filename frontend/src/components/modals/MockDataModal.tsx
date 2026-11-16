import React, { useState, useEffect } from 'react';
import { X, Wand2, Play } from 'lucide-react';
import { SchemaService, QueryService } from '../../../bindings/dhub/internal/services';
import { ColumnMeta } from '../../types/domain';
import { alertError, alertSuccess } from '../../stores/useAlertStore';

interface MockDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  schema: string;
  tableName: string;
  onSuccess?: () => void;
}

function generateMockValue(col: ColumnMeta, rowIdx: number): any {
  const name = col.name.toLowerCase();
  const t = (col.dataType || col.rawType || '').toLowerCase();

  if (t.includes('bool')) {
    return rowIdx % 2 === 0;
  }
  if (t.includes('uuid')) {
    return crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-4000-8000-${String(rowIdx).padStart(12, '0')}`;
  }
  if (t.includes('int') || t.includes('serial') || t.includes('number') || t.includes('numeric') || t.includes('decimal') || t.includes('float') || t.includes('double')) {
    if (name.includes('age')) return 18 + (rowIdx % 50);
    if (name.includes('price') || name.includes('amount')) return Number(((rowIdx + 1) * 12.5).toFixed(2));
    return Math.floor(Math.random() * 10000) + rowIdx;
  }
  if (t.includes('timestamp') || t.includes('datetime')) {
    return new Date(Date.now() - rowIdx * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  }
  if (t.includes('date')) {
    return new Date(Date.now() - rowIdx * 86400 * 1000).toISOString().slice(0, 10);
  }
  if (t.includes('json')) {
    return JSON.stringify({ sample: true, index: rowIdx + 1 });
  }
  if (name.includes('email')) return `user${rowIdx + 1}_${Math.floor(Math.random() * 900 + 100)}@example.com`;
  if (name.includes('name')) return `Sample Name ${rowIdx + 1}`;
  if (name.includes('phone')) return `+62812${String(10000000 + rowIdx).slice(0, 8)}`;
  if (name.includes('status')) return ['active', 'pending', 'completed'][rowIdx % 3];
  return `sample_${col.name}_${rowIdx + 1}`;
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

  if (!isOpen) return null;

  const handleGenerate = async () => {
    const activeCols = columns.filter((c) => selectedCols[c.name]);
    if (activeCols.length === 0) {
      alertError('Select at least one column to populate.');
      return;
    }
    const count = Math.max(1, Math.min(1000, rowCount));
    setIsGenerating(true);
    try {
      const changes = Array.from({ length: count }, (_, idx) => {
        const row: Record<string, any> = {};
        activeCols.forEach((c) => {
          row[c.name] = generateMockValue(c, idx);
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
        changes as any
      );
      alertSuccess(`Inserted ${affected || count} mock rows into "${tableName}".`);
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
            <label className="block text-[11px] text-zinc-400 mb-1">Number of Rows (1–1000)</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={rowCount}
              onChange={(e) => setRowCount(Number(e.target.value))}
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

