import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, ChevronDown, ChevronRight, Layers, Loader2 } from 'lucide-react';
import { ConnectionConfig } from '../../types/domain';
import { QueryService, SchemaService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, alertWarning } from '../../stores/useAlertStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';

type DistanceMetric = 'Cosine' | 'Euclid' | 'Dot' | 'Manhattan';
type VectorConfigType = 'single' | 'named';

interface NamedVectorItem {
  id: string;
  name: string;
  size: string;
  distance: DistanceMetric;
}

interface QdrantCreateCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  connection: ConnectionConfig | null;
  database: string;
  onCollectionCreated?: (collectionName: string) => void;
}

const DISTANCE_METRICS: DistanceMetric[] = ['Cosine', 'Euclid', 'Dot', 'Manhattan'];

export const QdrantCreateCollectionModal: React.FC<QdrantCreateCollectionModalProps> = ({
  isOpen,
  onClose,
  connection,
  database,
  onCollectionCreated,
}) => {
  const [collectionName, setCollectionName] = useState('');
  const [vectorType, setVectorType] = useState<VectorConfigType>('single');
  const [dimensions, setDimensions] = useState('1536');
  const [distance, setDistance] = useState<DistanceMetric>('Cosine');
  const [namedVectors, setNamedVectors] = useState<NamedVectorItem[]>([
    { id: 'vec-1', name: 'default', size: '1536', distance: 'Cosine' },
  ]);

  const [showHnsw, setShowHnsw] = useState(false);
  const [hnswM, setHnswM] = useState('');
  const [hnswEfConstruct, setHnswEfConstruct] = useState('');
  const [hnswFullScanThreshold, setHnswFullScanThreshold] = useState('');
  const [hnswOnDisk, setHnswOnDisk] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCollectionName('');
    setVectorType('single');
    setDimensions('1536');
    setDistance('Cosine');
    setNamedVectors([{ id: 'vec-1', name: 'default', size: '1536', distance: 'Cosine' }]);
    setShowHnsw(false);
    setHnswM('');
    setHnswEfConstruct('');
    setHnswFullScanThreshold('');
    setHnswOnDisk(false);
    setIsSubmitting(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  const commandPreview = useMemo(() => {
    const cleanName = collectionName.trim() || '<collection_name>';
    const body: Record<string, any> = {};

    if (vectorType === 'single') {
      const parsedSize = Number(dimensions);
      body.vectors = {
        size: Number.isFinite(parsedSize) && parsedSize > 0 ? Math.floor(parsedSize) : 1536,
        distance,
      };
    } else {
      const vectorsMap: Record<string, { size: number; distance: DistanceMetric }> = {};
      namedVectors.forEach((v) => {
        const key = v.name.trim();
        if (!key) return;
        const parsedSize = Number(v.size);
        vectorsMap[key] = {
          size: Number.isFinite(parsedSize) && parsedSize > 0 ? Math.floor(parsedSize) : 1536,
          distance: v.distance,
        };
      });
      body.vectors = vectorsMap;
    }

    const hnswConfig: Record<string, any> = {};
    if (hnswM.trim() !== '' && Number.isFinite(Number(hnswM))) {
      hnswConfig.m = Math.max(0, Math.floor(Number(hnswM)));
    }
    if (hnswEfConstruct.trim() !== '' && Number.isFinite(Number(hnswEfConstruct))) {
      hnswConfig.ef_construct = Math.max(4, Math.floor(Number(hnswEfConstruct)));
    }
    if (hnswFullScanThreshold.trim() !== '' && Number.isFinite(Number(hnswFullScanThreshold))) {
      hnswConfig.full_scan_threshold = Math.max(0, Math.floor(Number(hnswFullScanThreshold)));
    }
    if (hnswOnDisk) {
      hnswConfig.on_disk = true;
    }
    if (Object.keys(hnswConfig).length > 0) {
      body.hnsw_config = hnswConfig;
    }

    return `PUT /collections/${encodeURIComponent(cleanName)}\n${JSON.stringify(body, null, 2)}`;
  }, [
    collectionName,
    vectorType,
    dimensions,
    distance,
    namedVectors,
    hnswM,
    hnswEfConstruct,
    hnswFullScanThreshold,
    hnswOnDisk,
  ]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connection) return;

    const cleanName = collectionName.trim();
    if (!cleanName) {
      alertWarning('Please enter a collection name.', 'Missing Collection Name');
      return;
    }

    if (vectorType === 'single') {
      const dimNum = Number(dimensions);
      if (!Number.isFinite(dimNum) || dimNum <= 0) {
        alertWarning('Vector Dimensions must be a positive integer.', 'Invalid Dimensions');
        return;
      }
    } else {
      const validVecs = namedVectors.filter((v) => v.name.trim() !== '');
      if (validVecs.length === 0) {
        alertWarning('Please define at least one named vector.', 'Missing Named Vector');
        return;
      }
      const seen = new Set<string>();
      for (const v of validVecs) {
        const key = v.name.trim();
        if (seen.has(key)) {
          alertWarning(`Duplicate named vector "${key}".`, 'Duplicate Vector Name');
          return;
        }
        seen.add(key);
        const dimNum = Number(v.size);
        if (!Number.isFinite(dimNum) || dimNum <= 0) {
          alertWarning(`Dimensions for vector "${key}" must be a positive integer.`, 'Invalid Dimensions');
          return;
        }
      }
    }

    setIsSubmitting(true);
    try {
      await QueryService.ExecuteQuery({
        executionId: 'qdrant-create-collection-' + Date.now(),
        connectionId: connection.id,
        database: database || connection.databaseName || 'default',
        schema: database || connection.databaseName || 'default',
        sql: commandPreview,
        limit: 10,
        offset: 0,
      } as any);

      const dbName = database || connection.databaseName || 'default';
      const schemaKey = `${connection.id}:${dbName}:${dbName}`;
      try {
        const objects = await SchemaService.GetObjects(connection.id, dbName, dbName);
        if (objects) {
          useConnectionStore.getState().setTreeObjects(schemaKey, objects as any);
        }
      } catch {}

      useWorkbenchStore.getState().openTab({
        id: `table-${connection.id}-${dbName}-${cleanName}`,
        title: cleanName,
        type: 'table_data',
        connectionId: connection.id,
        database: dbName,
        schema: dbName,
        table: cleanName,
        driver: connection.driver,
      });

      alertSuccess(`Collection "${cleanName}" has been created successfully.`, 'Collection Created');
      onCollectionCreated?.(cleanName);
      onClose();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Create Collection', commandPreview);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d] shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500/15 text-rose-400 border border-rose-500/30">
              <Layers className="h-3.5 w-3.5" />
            </span>
            <span className="text-zinc-400 font-mono">{connection?.name || 'Qdrant'}</span>
            <span className="text-zinc-600">→</span>
            <span className="font-semibold text-zinc-100 text-sm">New Collection</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleCreate} className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
          {/* General */}
          <section className="space-y-2.5">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">General</h3>
              <p className="text-[11px] text-zinc-400">Basic collection settings</p>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                <span className="text-rose-400 mr-1">*</span>Collection Name
              </label>
              <input
                type="text"
                autoFocus
                value={collectionName}
                onChange={(e) => setCollectionName(e.target.value)}
                placeholder="e.g. documents"
                className="w-full rounded-lg border border-[#2f3240] bg-[#121318] px-3 py-2 text-xs text-zinc-100 font-mono placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
              />
              <p className="mt-1 text-[10px] text-zinc-500">Unique name for your collection</p>
            </div>
          </section>

          {/* Vector Configuration */}
          <section className="space-y-3 border-t border-[#272934] pt-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Vector Configuration</h3>
              <p className="text-[11px] text-zinc-400">Configure vector storage and indexing</p>
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-medium text-zinc-300">
                Vector Configuration Type
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setVectorType('single')}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    vectorType === 'single'
                      ? 'bg-blue-600/15 border-blue-500 text-zinc-100'
                      : 'bg-[#14151b] border-[#2b2e3a] text-zinc-300 hover:border-zinc-500'
                  }`}
                >
                  <span
                    className={`mt-0.5 h-3.5 w-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                      vectorType === 'single' ? 'border-blue-400' : 'border-zinc-500'
                    }`}
                  >
                    {vectorType === 'single' && <span className="h-2 w-2 rounded-full bg-blue-400" />}
                  </span>
                  <div>
                    <div className="font-medium text-xs">Single Vector</div>
                    <div className="text-[10px] text-zinc-400">One vector per point (most common)</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setVectorType('named')}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    vectorType === 'named'
                      ? 'bg-blue-600/15 border-blue-500 text-zinc-100'
                      : 'bg-[#14151b] border-[#2b2e3a] text-zinc-300 hover:border-zinc-500'
                  }`}
                >
                  <span
                    className={`mt-0.5 h-3.5 w-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                      vectorType === 'named' ? 'border-blue-400' : 'border-zinc-500'
                    }`}
                  >
                    {vectorType === 'named' && <span className="h-2 w-2 rounded-full bg-blue-400" />}
                  </span>
                  <div>
                    <div className="font-medium text-xs">Named Vectors</div>
                    <div className="text-[10px] text-zinc-400">Multiple named vectors per point</div>
                  </div>
                </button>
              </div>
            </div>

            {vectorType === 'single' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                    <span className="text-rose-400 mr-1">*</span>Vector Dimensions
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={dimensions}
                    onChange={(e) => setDimensions(e.target.value)}
                    className="w-full rounded-lg border border-[#2f3240] bg-[#121318] px-3 py-2 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
                  />
                  <p className="mt-1 text-[10px] text-zinc-500">
                    e.g., 1536 for OpenAI, 768 for many models
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                    <span className="text-rose-400 mr-1">*</span>Distance Metric
                  </label>
                  <select
                    value={distance}
                    onChange={(e) => setDistance(e.target.value as DistanceMetric)}
                    className="w-full rounded-lg border border-[#2f3240] bg-[#121318] px-3 py-2 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
                  >
                    {DISTANCE_METRICS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-zinc-500">Distance function for similarity search</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-zinc-300">Named Vectors</span>
                  <button
                    type="button"
                    onClick={() =>
                      setNamedVectors((prev) => [
                        ...prev,
                        {
                          id: `vec-${Date.now()}`,
                          name: `vector_${prev.length + 1}`,
                          size: '1536',
                          distance: 'Cosine',
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#232632] hover:bg-[#2d3140] text-zinc-200 border border-[#343848] text-[11px] cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Add Vector</span>
                  </button>
                </div>
                <div className="space-y-2">
                  {namedVectors.map((vec) => (
                    <div
                      key={vec.id}
                      className="grid grid-cols-12 gap-2 items-center p-2 rounded-lg bg-[#14151b] border border-[#282b36]"
                    >
                      <input
                        type="text"
                        value={vec.name}
                        onChange={(e) =>
                          setNamedVectors((prev) =>
                            prev.map((item) =>
                              item.id === vec.id ? { ...item, name: e.target.value } : item
                            )
                          )
                        }
                        placeholder="Vector name"
                        className="col-span-5 rounded border border-[#2f3240] bg-[#101116] px-2 py-1.5 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
                      />
                      <input
                        type="number"
                        min={1}
                        value={vec.size}
                        onChange={(e) =>
                          setNamedVectors((prev) =>
                            prev.map((item) =>
                              item.id === vec.id ? { ...item, size: e.target.value } : item
                            )
                          )
                        }
                        placeholder="Dims"
                        className="col-span-3 rounded border border-[#2f3240] bg-[#101116] px-2 py-1.5 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
                      />
                      <select
                        value={vec.distance}
                        onChange={(e) =>
                          setNamedVectors((prev) =>
                            prev.map((item) =>
                              item.id === vec.id
                                ? { ...item, distance: e.target.value as DistanceMetric }
                                : item
                            )
                          )
                        }
                        className="col-span-3 rounded border border-[#2f3240] bg-[#101116] px-2 py-1.5 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
                      >
                        {DISTANCE_METRICS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={namedVectors.length <= 1}
                        onClick={() =>
                          setNamedVectors((prev) => prev.filter((item) => item.id !== vec.id))
                        }
                        className="col-span-1 flex items-center justify-center p-1 text-zinc-500 hover:text-rose-400 disabled:opacity-30 cursor-pointer"
                        title="Remove vector"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* HNSW Index Configuration */}
          <section className="border-t border-[#272934] pt-3">
            <button
              type="button"
              onClick={() => setShowHnsw((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200 hover:text-white cursor-pointer"
            >
              {showHnsw ? (
                <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
              )}
              <span>HNSW Index Configuration</span>
            </button>
            <p className="text-[11px] text-zinc-500 ml-5 mt-0.5">
              Optional HNSW index tuning parameters
            </p>

            {showHnsw && (
              <div className="mt-3 ml-5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">M (Max Connections)</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="16"
                    value={hnswM}
                    onChange={(e) => setHnswM(e.target.value)}
                    className="w-full rounded border border-[#2f3240] bg-[#121318] px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">ef_construct</label>
                  <input
                    type="number"
                    min={4}
                    placeholder="100"
                    value={hnswEfConstruct}
                    onChange={(e) => setHnswEfConstruct(e.target.value)}
                    className="w-full rounded border border-[#2f3240] bg-[#121318] px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">full_scan_threshold</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="10000"
                    value={hnswFullScanThreshold}
                    onChange={(e) => setHnswFullScanThreshold(e.target.value)}
                    className="w-full rounded border border-[#2f3240] bg-[#121318] px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <label className="sm:col-span-3 inline-flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={hnswOnDisk}
                    onChange={(e) => setHnswOnDisk(e.target.checked)}
                    className="rounded border-zinc-600 bg-[#121318]"
                  />
                  <span>Store HNSW index on disk (on_disk)</span>
                </label>
              </div>
            )}
          </section>

          {/* Request Preview */}
          <section className="border-t border-[#272934] pt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              REST Request Preview
            </div>
            <pre className="rounded-lg border border-[#282b36] bg-[#111217] p-2.5 text-[11px] font-mono text-emerald-300 overflow-x-auto">
              {commandPreview}
            </pre>
          </section>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#272934]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 rounded-lg border border-[#323542] bg-[#22242d] hover:bg-[#2a2d38] text-zinc-300 text-xs transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors cursor-pointer"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Create Collection</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
