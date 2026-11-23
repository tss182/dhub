import React, { useState, useEffect } from 'react';
import { X, Save, Braces, Sparkles, Loader2 } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess } from '../../stores/useAlertStore';

interface MongoDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  collectionName: string;
  mode: 'insert' | 'edit' | 'clone';
  initialDocument?: Record<string, any> | null;
  onSaved?: () => void;
}

export const MongoDocumentModal: React.FC<MongoDocumentModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  collectionName,
  mode,
  initialDocument,
  onSaved,
}) => {
  const [docText, setDocText] = useState('{\n  \n}');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    if (mode === 'insert') {
      setDocText('{\n  "name": "",\n  "createdAt": ISODate("2026-01-01T00:00:00Z")\n}');
    } else if (initialDocument) {
      const copy = { ...initialDocument };
      if (mode === 'clone') {
        delete copy._id;
      }
      setDocText(JSON.stringify(copy, null, 2));
    } else {
      setDocText('{\n  \n}');
    }
  }, [isOpen, mode, initialDocument]);

  if (!isOpen) return null;

  const insertSnippet = (snippet: string) => {
    setDocText((prev) => prev.trimEnd() + '\n' + snippet);
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(docText);
      setDocText(JSON.stringify(parsed, null, 2));
      setErrorMsg(null);
    } catch (e: any) {
      setErrorMsg('Cannot format strict JSON (if using ObjectId/ISODate helpers, MQL parser will still execute it): ' + (e?.message || ''));
    }
  };

  const handleSave = async () => {
    const trimmed = docText.trim();
    if (!trimmed) {
      setErrorMsg('Document body cannot be empty.');
      return;
    }
    setIsSaving(true);
    setErrorMsg(null);
    try {
      const collRef = `db.getCollection(${JSON.stringify(collectionName)})`;
      let mql = '';

      if (mode === 'insert' || mode === 'clone') {
        if (trimmed.startsWith('[')) {
          mql = `${collRef}.insertMany(${trimmed});`;
        } else {
          mql = `${collRef}.insertOne(${trimmed});`;
        }
      } else {
        const rawId = initialDocument?._id;
        if (rawId === undefined || rawId === null) {
          throw new Error('Cannot replace document without _id');
        }
        const idStr = String(rawId);
        const filterExpr = /^[a-fA-F0-9]{24}$/.test(idStr)
          ? `{ "_id": ObjectId("${idStr}") }`
          : JSON.stringify({ _id: rawId });
        mql = `${collRef}.replaceOne(${filterExpr}, ${trimmed});`;
      }

      await QueryService.ExecuteQuery({
        executionId: 'mongo-doc-' + Date.now(),
        connectionId,
        database,
        schema: database,
        sql: mql,
        limit: 10,
        offset: 0,
      } as any);

      alertSuccess(
        mode === 'edit'
          ? `Document updated in "${collectionName}".`
          : `Document inserted into "${collectionName}".`,
        'MongoDB Document Saved'
      );
      onSaved?.();
      onClose();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setErrorMsg(msg);
      alertError(msg, 'Failed to Save Document');
    } finally {
      setIsSaving(false);
    }
  };

  const title =
    mode === 'edit'
      ? `Edit Document — ${collectionName}`
      : mode === 'clone'
      ? `Clone Document — ${collectionName}`
      : `Insert Document(s) — ${collectionName}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl rounded-xl border border-[#282b36] bg-[#14161d] shadow-2xl flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#222530]">
          <div className="flex items-center gap-2">
            <Braces className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-[#20232d] bg-[#111319] flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-zinc-500 mr-1">BSON Helpers:</span>
          {[
            { label: 'ObjectId()', snippet: 'ObjectId("000000000000000000000000")' },
            { label: 'ISODate()', snippet: `ISODate("${new Date().toISOString()}")` },
            { label: 'NumberDecimal()', snippet: 'NumberDecimal("0.00")' },
            { label: 'NumberLong()', snippet: 'NumberLong("0")' },
            { label: 'UUID()', snippet: 'UUID("00000000-0000-4000-8000-000000000000")' },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={() => insertSnippet(b.snippet)}
              className="px-2 py-0.5 rounded bg-[#1d202b] hover:bg-[#272b3a] border border-[#2c3040] text-emerald-300 font-mono cursor-pointer"
            >
              {b.label}
            </button>
          ))}
          <button
            type="button"
            onClick={handleFormat}
            className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#1d202b] hover:bg-[#272b3a] border border-[#2c3040] text-zinc-300 cursor-pointer"
          >
            <Sparkles className="w-3 h-3" /> Format JSON
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-2">
          <p className="text-[11px] text-zinc-400">
            {mode === 'insert'
              ? 'Enter a single JSON/MQL document {...} or an array of documents [{...}, {...}] for insertMany.'
              : mode === 'clone'
              ? 'Review or modify the cloned document before inserting.'
              : 'Modify the document JSON/MQL. Saving executes replaceOne on the matching _id.'}
          </p>
          <textarea
            value={docText}
            onChange={(e) => setDocText(e.target.value)}
            spellCheck={false}
            rows={16}
            className="w-full rounded-lg border border-[#282b36] bg-[#0b0c10] p-3 text-xs font-mono text-zinc-100 focus:border-emerald-500/60 outline-none resize-y"
          />
          {errorMsg && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 font-mono">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#222530]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs bg-[#1e212b] hover:bg-[#282c3a] text-zinc-300 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white cursor-pointer"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {mode === 'edit' ? 'Replace Document' : 'Insert Document'}
          </button>
        </div>
      </div>
    </div>
  );
};
