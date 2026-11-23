import React, { useState, useEffect, useCallback } from 'react';
import { X, FileText, Trash2, RefreshCw, Loader2, Download } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';

interface MongoGridFSModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  bucketPrefix: string; // e.g. "fs" from "fs.files"
  isReadOnly?: boolean;
}

export const MongoGridFSModal: React.FC<MongoGridFSModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  bucketPrefix,
  isReadOnly,
}) => {
  const [files, setFiles] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(false);

  const filesColl = `${bucketPrefix}.files`;
  const chunksColl = `${bucketPrefix}.chunks`;

  const loadFiles = useCallback(async () => {
    if (!isOpen || !connectionId) return;
    setLoading(true);
    try {
      const res = await QueryService.ExecuteQuery({
        executionId: 'mongo-gridfs-' + Date.now(),
        connectionId,
        database,
        schema: database,
        sql: `db.getCollection(${JSON.stringify(filesColl)}).find({}).sort({ uploadDate: -1 }).limit(100);`,
        limit: 100,
        offset: 0,
      } as any);
      const cols = res?.columns || [];
      const list = (res?.rows || []).map((r: any[] | null) => {
        const obj: Record<string, any> = {};
        cols.forEach((c: any, i: number) => {
          obj[c.name] = r?.[i];
        });
        return obj;
      });
      setFiles(list);
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Load GridFS Files');
    } finally {
      setLoading(false);
    }
  }, [isOpen, connectionId, database, filesColl]);

  useEffect(() => {
    if (isOpen) loadFiles();
  }, [isOpen, loadFiles]);

  const handleDeleteFile = async (fileDoc: Record<string, any>) => {
    const ok = await confirmDialog({
      title: 'Delete GridFS File',
      message: `Delete "${fileDoc.filename || fileDoc._id}" and all associated chunks in "${chunksColl}"?`,
      confirmLabel: 'Delete File',
      isDanger: true,
    });
    if (!ok) return;
    try {
      const idStr = String(fileDoc._id ?? '');
      const idExpr = /^[a-fA-F0-9]{24}$/.test(idStr)
        ? `ObjectId("${idStr}")`
        : JSON.stringify(fileDoc._id);
      const mql = `
db.getCollection(${JSON.stringify(chunksColl)}).deleteMany({ files_id: ${idExpr} });
db.getCollection(${JSON.stringify(filesColl)}).deleteOne({ _id: ${idExpr} });
`;
      await QueryService.ExecuteQuery({
        executionId: 'mongo-gridfs-del-' + Date.now(),
        connectionId,
        database,
        schema: database,
        sql: mql,
        limit: 10,
        offset: 0,
      } as any);
      alertSuccess('GridFS file and chunks deleted.', 'Deleted');
      loadFiles();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Delete GridFS File Failed');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-4xl rounded-xl border border-[#282b36] bg-[#14161d] shadow-2xl flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#222530]">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-100">
              GridFS Browser — {database}.{bucketPrefix} ({files.length} files)
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={loadFiles} className="p-1.5 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 flex-1 overflow-y-auto text-xs">
          {loading && files.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-zinc-400 gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading GridFS metadata...
            </div>
          ) : files.length === 0 ? (
            <div className="text-center text-zinc-500 py-12 border border-dashed border-[#242733] rounded-lg">
              No files found in {filesColl}.
            </div>
          ) : (
            <div className="rounded-lg border border-[#242733] overflow-hidden">
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="bg-[#181a22] text-zinc-400 border-b border-[#242733]">
                  <tr>
                    <th className="px-3 py-2">Filename</th>
                    <th className="px-3 py-2">Length</th>
                    <th className="px-3 py-2">Chunk Size</th>
                    <th className="px-3 py-2">Upload Date</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1f222c]">
                  {files.map((f, i) => (
                    <tr key={i} className="hover:bg-[#181b24]">
                      <td className="px-3 py-2 text-emerald-300 font-semibold">{f.filename || String(f._id)}</td>
                      <td className="px-3 py-2 text-zinc-200">
                        {f.length !== undefined ? `${(Number(f.length) / 1024).toFixed(1)} KB` : '—'}
                      </td>
                      <td className="px-3 py-2 text-zinc-400">{f.chunkSize ?? '—'}</td>
                      <td className="px-3 py-2 text-zinc-400">{f.uploadDate ?? '—'}</td>
                      <td className="px-3 py-2 text-right space-x-1">
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(JSON.stringify(f, null, 2))}
                          className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                          title="Copy File Metadata JSON"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={() => handleDeleteFile(f)}
                            className="p-1 rounded hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 cursor-pointer"
                            title="Delete File & Chunks"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex justify-end px-4 py-3 border-t border-[#222530]">
          <button type="button" onClick={onClose} className="px-3.5 py-1.5 rounded-md text-xs bg-[#1e212b] hover:bg-[#282c3a] text-zinc-200 cursor-pointer">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
