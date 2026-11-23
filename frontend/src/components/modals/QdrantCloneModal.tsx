import React, { useEffect, useRef, useState } from 'react';
import { X, Copy, Loader2 } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess } from '../../stores/useAlertStore';

interface QdrantCloneModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  sourceCollection: string;
  onCloned?: () => void;
}

export const QdrantCloneModal: React.FC<QdrantCloneModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  sourceCollection,
  onCloned,
}) => {
  const [targetName, setTargetName] = useState('');
  const [quantization, setQuantization] = useState<'preserve' | 'none' | 'scalar' | 'binary'>('preserve');
  const [swapAlias, setSwapAlias] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [copiedPoints, setCopiedPoints] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setTargetName(`${sourceCollection}_v2`);
      setQuantization('preserve');
      setSwapAlias('');
      setProgressMsg('');
      setCopiedPoints(0);
      setError(null);
      cancelRef.current = false;
    }
  }, [isOpen, sourceCollection]);

  if (!isOpen) return null;

  const runRest = async (sql: string) => {
    const res = await QueryService.ExecuteQuery({
      executionId: `qdrant-clone-${Date.now()}`,
      connectionId,
      database: 'default',
      schema: 'default',
      sql,
      limit: 500,
      offset: 0,
    } as any);
    if (res?.error) throw new Error(res.error);
    const raw = res?.rows?.[0]?.[0];
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  };

  const handleStartClone = async (e: React.FormEvent) => {
    e.preventDefault();
    const dst = targetName.trim();
    if (!dst || dst === sourceCollection) {
      setError('Enter a distinct target collection name.');
      return;
    }

    setError(null);
    setIsRunning(true);
    setCopiedPoints(0);
    cancelRef.current = false;

    try {
      setProgressMsg('Reading source collection configuration...');
      const infoEnv = await runRest(`GET /collections/${encodeURIComponent(sourceCollection)}`);
      const info = infoEnv?.result ?? infoEnv;
      const params = info?.config?.params ?? {};

      const createBody: Record<string, any> = {
        vectors: params.vectors,
      };
      if (params.sparse_vectors) createBody.sparse_vectors = params.sparse_vectors;
      if (params.shard_number) createBody.shard_number = params.shard_number;
      if (params.replication_factor) createBody.replication_factor = params.replication_factor;
      if (params.on_disk_payload !== undefined) createBody.on_disk_payload = params.on_disk_payload;
      if (info?.config?.hnsw_config) createBody.hnsw_config = info.config.hnsw_config;

      if (quantization === 'preserve' && info?.config?.quantization_config) {
        createBody.quantization_config = info.config.quantization_config;
      } else if (quantization === 'scalar') {
        createBody.quantization_config = { scalar: { type: 'int8', always_ram: true } };
      } else if (quantization === 'binary') {
        createBody.quantization_config = { binary: { always_ram: true } };
      }

      setProgressMsg(`Creating target collection "${dst}"...`);
      const dstEsc = encodeURIComponent(dst);
      await runRest(`PUT /collections/${dstEsc}\n${JSON.stringify(createBody)}`);

      // Recreate payload indexes
      const schemaMap = info?.payload_schema || {};
      for (const [field, meta] of Object.entries<any>(schemaMap)) {
        if (cancelRef.current) break;
        const idxBody = { field_name: field, field_schema: meta?.params || meta?.data_type || 'keyword' };
        setProgressMsg(`Creating payload index "${field}"...`);
        await runRest(`PUT /collections/${dstEsc}/index?wait=true\n${JSON.stringify(idxBody)}`);
      }

      // Stream points via paginated SELECT * (uses QdrantDriver's cached scroll cursor)
      let offset = 0;
      const batchSize = 200;
      let totalCopied = 0;
      const safeSrc = sourceCollection.replace(/"/g, '');

      while (!cancelRef.current) {
        setProgressMsg(`Copying points (${totalCopied.toLocaleString()} copied)...`);
        const pageRes = await QueryService.ExecuteQuery({
          executionId: `qdrant-clone-page-${Date.now()}-${offset}`,
          connectionId,
          database: 'default',
          schema: 'default',
          sql: `SELECT * FROM "${safeSrc}" LIMIT ${batchSize} OFFSET ${offset}`,
          limit: batchSize,
          offset,
        } as any);
        if (pageRes?.error) throw new Error(pageRes.error);

        const cols = pageRes?.columns || [];
        const rows = pageRes?.rows || [];
        if (rows.length === 0) break;

        const points = rows.map((row: any[]) => {
          let id: any = null;
          let defaultVec: any = undefined;
          const namedVecs: Record<string, any> = {};
          const payload: Record<string, any> = {};

          cols.forEach((col: any, idx: number) => {
            const name = col?.name || '';
            const rawVal = row[idx];
            if (name === 'id') {
              id = typeof rawVal === 'string' && /^-?\d+$/.test(rawVal) ? Number(rawVal) : rawVal;
            } else if (name === 'vector') {
              if (rawVal !== null && rawVal !== undefined && rawVal !== '') {
                defaultVec = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
              }
            } else if (name.startsWith('vector.')) {
              const vName = name.slice('vector.'.length);
              if (rawVal !== null && rawVal !== undefined && rawVal !== '') {
                namedVecs[vName] = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
              }
            } else if (name !== 'score' && rawVal !== null && rawVal !== undefined) {
              if (typeof rawVal === 'string' && (rawVal.startsWith('{') || rawVal.startsWith('['))) {
                try {
                  payload[name] = JSON.parse(rawVal);
                } catch {
                  payload[name] = rawVal;
                }
              } else {
                payload[name] = rawVal;
              }
            }
          });

          const vector = Object.keys(namedVecs).length > 0 ? namedVecs : defaultVec;
          const pt: Record<string, any> = { id, payload };
          if (vector !== undefined) pt.vector = vector;
          return pt;
        });

        await runRest(`PUT /collections/${dstEsc}/points?wait=true\n${JSON.stringify({ points })}`);
        totalCopied += points.length;
        setCopiedPoints(totalCopied);

        if (!pageRes?.hasMore || rows.length < batchSize) break;
        offset += rows.length;
      }

      if (cancelRef.current) {
        setProgressMsg(`Cancelled after copying ${totalCopied.toLocaleString()} points.`);
        onCloned?.();
        return;
      }

      const aliasTarget = swapAlias.trim();
      if (aliasTarget) {
        setProgressMsg(`Swapping alias "${aliasTarget}" -> "${dst}"...`);
        await runRest(
          `POST /collections/aliases\n${JSON.stringify({
            actions: [{ create_alias: { collection_name: dst, alias_name: aliasTarget } }],
          })}`
        );
      }

      alertSuccess(
        `Cloned ${totalCopied.toLocaleString()} points from "${sourceCollection}" to "${dst}".`,
        'Collection Cloned'
      );
      onCloned?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
      alertError(err?.message || String(err), 'Clone Failed');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-lg rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden text-xs">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d]">
          <div className="flex items-center gap-2">
            <Copy className="h-4 w-4 text-blue-400" />
            <span className="font-semibold text-sm text-zinc-100">Clone / Reindex — {sourceCollection}</span>
          </div>
          <button type="button" onClick={onClose} disabled={isRunning} className="p-1 rounded text-zinc-400 hover:text-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleStartClone} className="p-4 space-y-4">
          <div>
            <label className="block font-medium text-zinc-300 mb-1">Target Collection Name</label>
            <input
              type="text"
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
              className="w-full rounded-lg border border-[#2f3240] bg-[#121318] px-3 py-1.5 font-mono text-zinc-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-medium text-zinc-300 mb-1">Quantization on Target</label>
            <select
              value={quantization}
              onChange={(e) => setQuantization(e.target.value as any)}
              className="w-full rounded-lg border border-[#2f3240] bg-[#121318] px-3 py-1.5 text-zinc-100"
            >
              <option value="preserve">Preserve source quantization</option>
              <option value="none">None (uncompressed)</option>
              <option value="scalar">Scalar int8 (4x RAM savings)</option>
              <option value="binary">Binary 1-bit (32x RAM savings)</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-zinc-300 mb-1">
              Atomic Alias Swap After Clone <span className="text-zinc-500 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. docs_live"
              value={swapAlias}
              onChange={(e) => setSwapAlias(e.target.value)}
              className="w-full rounded-lg border border-[#2f3240] bg-[#121318] px-3 py-1.5 font-mono text-zinc-100"
            />
          </div>

          {progressMsg && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-950/20 p-2.5 text-[11px] text-blue-300 font-mono">
              {progressMsg} ({copiedPoints.toLocaleString()} points)
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-rose-950/30 border border-rose-500/40 px-3 py-2 text-[11px] text-rose-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-[#272934]">
            {isRunning && (
              <button
                type="button"
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-600/20 border border-rose-500/40 text-rose-300 cursor-pointer"
              >
                Cancel
              </button>
            )}
            <button type="button" onClick={onClose} disabled={isRunning} className="px-3 py-1.5 rounded-lg bg-[#23252f] text-zinc-300 cursor-pointer">
              Close
            </button>
            <button
              type="submit"
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium cursor-pointer"
            >
              {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Start Clone &amp; Reindex</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
