import React, { useState } from 'react';
import { X, CopyPlus, Loader2 } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess } from '../../stores/useAlertStore';

interface MongoCloneCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  collectionName: string;
  onSuccess?: () => void;
}

export const MongoCloneCollectionModal: React.FC<MongoCloneCollectionModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  collectionName,
  onSuccess,
}) => {
  const [mode, setMode] = useState<'clone' | 'rename'>('clone');
  const [targetName, setTargetName] = useState(`${collectionName}_copy`);
  const [filterText, setFilterText] = useState('{}');
  const [isRunning, setIsRunning] = useState(false);

  if (!isOpen) return null;

  const handleRun = async () => {
    const target = targetName.trim();
    if (!target) {
      alertError('Target collection name is required.', 'Validation Error');
      return;
    }
    setIsRunning(true);
    try {
      const collRef = `db.getCollection(${JSON.stringify(collectionName)})`;
      let mql = '';
      if (mode === 'rename') {
        mql = `${collRef}.renameCollection(${JSON.stringify(target)});`;
      } else {
        const filterObj = filterText.trim() || '{}';
        mql = `${collRef}.aggregate([{ "$match": ${filterObj} }, { "$out": ${JSON.stringify(target)} }]);`;
      }
      await QueryService.ExecuteQuery({
        executionId: 'mongo-clone-' + Date.now(),
        connectionId,
        database,
        schema: database,
        sql: mql,
        limit: 10,
        offset: 0,
      } as any);
      alertSuccess(
        mode === 'rename'
          ? `Renamed "${collectionName}" to "${target}".`
          : `Cloned "${collectionName}" into "${target}".`,
        'Operation Complete'
      );
      onSuccess?.();
      onClose();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Operation Failed');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-xl border border-[#282b36] bg-[#14161d] shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#222530]">
          <div className="flex items-center gap-2">
            <CopyPlus className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-100">
              Clone / Rename Collection — {collectionName}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setMode('clone');
                setTargetName(`${collectionName}_copy`);
              }}
              className={`px-3 py-1.5 rounded-md font-medium border cursor-pointer ${
                mode === 'clone'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-[#1a1d26] border-[#292c38] text-zinc-400'
              }`}
            >
              Clone ($out)
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('rename');
                setTargetName(`${collectionName}_renamed`);
              }}
              className={`px-3 py-1.5 rounded-md font-medium border cursor-pointer ${
                mode === 'rename'
                  ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                  : 'bg-[#1a1d26] border-[#292c38] text-zinc-400'
              }`}
            >
              Rename Collection
            </button>
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">
              {mode === 'rename' ? 'New Collection Name' : 'Target Collection Name'}
            </label>
            <input
              type="text"
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
              className="w-full rounded-md border border-[#282b36] bg-[#0b0c10] px-3 py-1.5 font-mono text-zinc-100 outline-none"
            />
          </div>

          {mode === 'clone' && (
            <div>
              <label className="block text-zinc-400 mb-1">Optional $match Filter</label>
              <textarea
                rows={3}
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="w-full rounded-md border border-[#282b36] bg-[#0b0c10] p-2.5 font-mono text-zinc-100 outline-none"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#222530]">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md text-xs bg-[#1e212b] hover:bg-[#282c3a] text-zinc-300 cursor-pointer">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
          >
            {isRunning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {mode === 'rename' ? 'Rename' : 'Clone Collection'}
          </button>
        </div>
      </div>
    </div>
  );
};
