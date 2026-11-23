import React, { useState, useEffect, useRef } from 'react';
import { X, Radio, Pause, Play, Trash2 } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';

interface MongoChangeStreamModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  collectionName: string;
}

export const MongoChangeStreamModal: React.FC<MongoChangeStreamModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  collectionName,
}) => {
  const [isTailing, setIsTailing] = useState(true);
  const [events, setEvents] = useState<{ ts: string; op: string; summary: string }[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastSeenIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen || !isTailing) return;

    const poll = async () => {
      try {
        const res = await QueryService.ExecuteQuery({
          executionId: 'mongo-tail-' + Date.now(),
          connectionId,
          database,
          schema: database,
          sql: `db.getCollection(${JSON.stringify(collectionName)}).find({}).sort({ _id: -1 }).limit(10);`,
          limit: 10,
          offset: 0,
        } as any);
        setErrorMsg(null);
        const rows = res?.rows || [];
        const cols = res?.columns || [];
        const idIdx = cols.findIndex((c: any) => c.name === '_id');
        if (rows.length > 0 && idIdx >= 0) {
          const newestId = String(rows[0]?.[idIdx] ?? '');
          if (lastSeenIdRef.current && newestId && newestId !== lastSeenIdRef.current) {
            const doc: Record<string, any> = {};
            cols.forEach((c: any, i: number) => {
              doc[c.name] = rows[0]?.[i];
            });
            setEvents((prev) => [
              {
                ts: new Date().toLocaleTimeString(),
                op: 'insert / latest',
                summary: JSON.stringify(doc),
              },
              ...prev.slice(0, 99),
            ]);
          }
          lastSeenIdRef.current = newestId;
        }
      } catch (err: any) {
        setErrorMsg(err?.message || String(err));
      }
    };

    poll();
    const timer = setInterval(poll, 2500);
    return () => clearInterval(timer);
  }, [isOpen, isTailing, connectionId, database, collectionName]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-3xl rounded-xl border border-[#282b36] bg-[#14161d] shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#222530]">
          <div className="flex items-center gap-2">
            <Radio className={`w-4 h-4 ${isTailing ? 'text-emerald-400 animate-pulse' : 'text-zinc-500'}`} />
            <h3 className="text-sm font-semibold text-zinc-100">
              Live Tail — {database}.{collectionName}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsTailing((p) => !p)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#1d202b] hover:bg-[#272b3a] text-xs text-zinc-200 cursor-pointer"
            >
              {isTailing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              {isTailing ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              onClick={() => setEvents([])}
              className="p-1.5 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer"
              title="Clear Events"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-2 text-xs font-mono">
          {errorMsg && (
            <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2 text-rose-300">{errorMsg}</div>
          )}
          {events.length === 0 ? (
            <div className="text-center text-zinc-500 py-12 border border-dashed border-[#242733] rounded-lg">
              Watching {database}.{collectionName} for new documents (polling every 2.5s)...
            </div>
          ) : (
            events.map((ev, i) => (
              <div key={i} className="rounded border border-[#232633] bg-[#0d0e13] p-2.5 space-y-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-zinc-500">{ev.ts}</span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">{ev.op}</span>
                </div>
                <div className="text-zinc-200 break-all">{ev.summary}</div>
              </div>
            ))
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
