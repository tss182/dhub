import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, ChevronDown, ChevronRight, Layers, Loader2 } from 'lucide-react';
import { ConnectionConfig } from '../../types/domain';
import { QueryService, SchemaService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, alertWarning } from '../../stores/useAlertStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';

type DistanceMetric = 'Cosine' | 'Euclid' | 'Dot' | 'Manhattan';
type VectorConfigType = 'single' | 'named';
type QuantizationType = 'none' | 'scalar' | 'binary' | 'product';
type VectorDatatype = 'float32' | 'float16' | 'uint8';
type PayloadSchemaType = 'keyword' | 'integer' | 'float' | 'bool' | 'datetime' | 'text' | 'geo';

interface NamedVectorItem {
  id: string;
  name: string;
  size: string;
  distance: DistanceMetric;
  datatype: VectorDatatype;
  onDisk: boolean;
  isMultiVector: boolean;
}

interface SparseVectorItem {
  id: string;
  name: string;
  onDisk: boolean;
}

interface InitialPayloadIndex {
  id: string;
  field: string;
  schema: PayloadSchemaType;
}

interface QdrantCreateCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  connection: ConnectionConfig | null;
  database: string;
  onCollectionCreated?: (collectionName: string) => void;
}

const DISTANCE_METRICS: DistanceMetric[] = ['Cosine', 'Euclid', 'Dot', 'Manhattan'];
const PAYLOAD_SCHEMA_TYPES: PayloadSchemaType[] = ['keyword', 'integer', 'float', 'bool', 'datetime', 'text', 'geo'];

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
  const [singleDatatype, setSingleDatatype] = useState<VectorDatatype>('float32');
  const [singleOnDisk, setSingleOnDisk] = useState(false);
  const [singleMultiVector, setSingleMultiVector] = useState(false);
  const [namedVectors, setNamedVectors] = useState<NamedVectorItem[]>([
    { id: 'vec-1', name: 'default', size: '1536', distance: 'Cosine', datatype: 'float32', onDisk: false, isMultiVector: false },
  ]);
  const [sparseVectors, setSparseVectors] = useState<SparseVectorItem[]>([]);

  const [showHnsw, setShowHnsw] = useState(false);
  const [hnswM, setHnswM] = useState('');
  const [hnswEfConstruct, setHnswEfConstruct] = useState('');
  const [hnswFullScanThreshold, setHnswFullScanThreshold] = useState('');
  const [hnswOnDisk, setHnswOnDisk] = useState(false);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [onDiskPayload, setOnDiskPayload] = useState(false);
  const [shardNumber, setShardNumber] = useState('');
  const [replicationFactor, setReplicationFactor] = useState('');
  const [quantType, setQuantType] = useState<QuantizationType>('none');
  const [quantAlwaysRam, setQuantAlwaysRam] = useState(true);
  const [productCompression, setProductCompression] = useState<'x4' | 'x8' | 'x16' | 'x32' | 'x64'>('x16');
  const [initialIndexes, setInitialIndexes] = useState<InitialPayloadIndex[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCollectionName('');
    setVectorType('single');
    setDimensions('1536');
    setDistance('Cosine');
    setSingleDatatype('float32');
    setSingleOnDisk(false);
    setSingleMultiVector(false);
    setNamedVectors([{ id: 'vec-1', name: 'default', size: '1536', distance: 'Cosine', datatype: 'float32', onDisk: false, isMultiVector: false }]);
    setSparseVectors([]);
    setShowHnsw(false);
    setHnswM('');
    setHnswEfConstruct('');
    setHnswFullScanThreshold('');
    setHnswOnDisk(false);
    setShowAdvanced(false);
    setOnDiskPayload(false);
    setShardNumber('');
    setReplicationFactor('');
    setQuantType('none');
    setQuantAlwaysRam(true);
    setProductCompression('x16');
    setInitialIndexes([]);
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
      const vObj: Record<string, any> = {
        size: Number.isFinite(parsedSize) && parsedSize > 0 ? Math.floor(parsedSize) : 1536,
        distance,
      };
      if (singleDatatype !== 'float32') vObj.datatype = singleDatatype;
      if (singleOnDisk) vObj.on_disk = true;
      if (singleMultiVector) vObj.multivector_config = { comparator: 'max_sim' };
      body.vectors = vObj;
    } else {
      const vectorsMap: Record<string, any> = {};
      namedVectors.forEach((v) => {
        const key = v.name.trim();
        if (!key) return;
        const parsedSize = Number(v.size);
        const vObj: Record<string, any> = {
          size: Number.isFinite(parsedSize) && parsedSize > 0 ? Math.floor(parsedSize) : 1536,
          distance: v.distance,
        };
        if (v.datatype !== 'float32') vObj.datatype = v.datatype;
        if (v.onDisk) vObj.on_disk = true;
        if (v.isMultiVector) vObj.multivector_config = { comparator: 'max_sim' };
        vectorsMap[key] = vObj;
      });
      body.vectors = vectorsMap;
    }

    if (sparseVectors.length > 0) {
      const sparseMap: Record<string, any> = {};
      sparseVectors.forEach((sv) => {
        const k = sv.name.trim();
        if (!k) return;
        sparseMap[k] = sv.onDisk ? { index: { on_disk: true } } : {};
      });
      if (Object.keys(sparseMap).length > 0) {
        body.sparse_vectors = sparseMap;
      }
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

    if (onDiskPayload) {
      body.on_disk_payload = true;
    }
    if (shardNumber.trim() !== '' && Number.isFinite(Number(shardNumber)) && Number(shardNumber) > 0) {
      body.shard_number = Math.floor(Number(shardNumber));
    }
    if (replicationFactor.trim() !== '' && Number.isFinite(Number(replicationFactor)) && Number(replicationFactor) > 0) {
      body.replication_factor = Math.floor(Number(replicationFactor));
    }
    if (quantType === 'scalar') {
      body.quantization_config = { scalar: { type: 'int8', always_ram: quantAlwaysRam } };
    } else if (quantType === 'binary') {
      body.quantization_config = { binary: { always_ram: quantAlwaysRam } };
    } else if (quantType === 'product') {
      body.quantization_config = { product: { compression: productCompression, always_ram: quantAlwaysRam } };
    }

    return `PUT /collections/${encodeURIComponent(cleanName)}\n${JSON.stringify(body, null, 2)}`;
  }, [
    collectionName,
    vectorType,
    dimensions,
    distance,
    singleDatatype,
    singleOnDisk,
    singleMultiVector,
    namedVectors,
    sparseVectors,
    hnswM,
    hnswEfConstruct,
    hnswFullScanThreshold,
    hnswOnDisk,
    onDiskPayload,
    shardNumber,
    replicationFactor,
    quantType,
    quantAlwaysRam,
    productCompression,
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

      for (const idx of initialIndexes) {
        const field = idx.field.trim();
        if (!field) continue;
        const idxCmd = `PUT /collections/${encodeURIComponent(cleanName)}/index?wait=true\n${JSON.stringify({
          field_name: field,
          field_schema: idx.schema,
        })}`;
        await QueryService.ExecuteQuery({
          executionId: `qdrant-init-idx-${Date.now()}`,
          connectionId: connection.id,
          database: database || connection.databaseName || 'default',
          schema: database || connection.databaseName || 'default',
          sql: idxCmd,
          limit: 10,
          offset: 0,
        } as any);
      }

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
              <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-300 mb-1">Datatype</label>
                  <select
                    value={singleDatatype}
                    onChange={(e) => setSingleDatatype(e.target.value as VectorDatatype)}
                    className="w-full rounded-lg border border-[#2f3240] bg-[#121318] px-3 py-2 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="float32">float32 (default)</option>
                    <option value="float16">float16 (half RAM)</option>
                    <option value="uint8">uint8 (byte)</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-300">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={singleOnDisk} onChange={(e) => setSingleOnDisk(e.target.checked)} />
                  <span>Store vectors on disk (mmap)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={singleMultiVector} onChange={(e) => setSingleMultiVector(e.target.checked)} />
                  <span>Multi-Vector (ColBERT max_sim)</span>
                </label>
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
                          datatype: 'float32',
                          onDisk: false,
                          isMultiVector: false,
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
                      className="space-y-2 p-2 rounded-lg bg-[#14151b] border border-[#282b36]"
                    >
                      <div className="grid grid-cols-12 gap-2 items-center">
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
                          className="col-span-4 rounded border border-[#2f3240] bg-[#101116] px-2 py-1.5 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
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
                          className="col-span-2 rounded border border-[#2f3240] bg-[#101116] px-2 py-1.5 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
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
                        <select
                          value={vec.datatype}
                          onChange={(e) =>
                            setNamedVectors((prev) =>
                              prev.map((item) =>
                                item.id === vec.id
                                  ? { ...item, datatype: e.target.value as VectorDatatype }
                                  : item
                              )
                            )
                          }
                          className="col-span-2 rounded border border-[#2f3240] bg-[#101116] px-1.5 py-1.5 text-[11px] text-zinc-100 focus:border-blue-500 focus:outline-none"
                        >
                          <option value="float32">f32</option>
                          <option value="float16">f16</option>
                          <option value="uint8">u8</option>
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
                      <div className="flex items-center gap-4 text-[10px] text-zinc-400">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={vec.onDisk}
                            onChange={(e) =>
                              setNamedVectors((prev) =>
                                prev.map((item) => (item.id === vec.id ? { ...item, onDisk: e.target.checked } : item))
                              )
                            }
                          />
                          <span>On disk</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={vec.isMultiVector}
                            onChange={(e) =>
                              setNamedVectors((prev) =>
                                prev.map((item) =>
                                  item.id === vec.id ? { ...item, isMultiVector: e.target.checked } : item
                                )
                              )
                            }
                          />
                          <span>Multi-Vector (max_sim)</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sparse Vectors (BM25 / SPLADE) */}
            <div className="pt-2 border-t border-[#222530] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-zinc-300">
                  Sparse Vectors <span className="text-zinc-500 font-normal">(optional, e.g. BM25 / SPLADE for hybrid search)</span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setSparseVectors((prev) => [
                      ...prev,
                      { id: `sparse-${Date.now()}`, name: prev.length === 0 ? 'bm25' : `sparse_${prev.length + 1}`, onDisk: false },
                    ])
                  }
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#232632] hover:bg-[#2d3140] text-zinc-200 border border-[#343848] text-[11px] cursor-pointer"
                >
                  <Plus className="h-3 w-3" />
                  <span>Add Sparse</span>
                </button>
              </div>
              {sparseVectors.map((sv) => (
                <div key={sv.id} className="flex items-center gap-2 p-2 rounded-lg bg-[#14151b] border border-[#282b36]">
                  <input
                    type="text"
                    value={sv.name}
                    onChange={(e) =>
                      setSparseVectors((prev) =>
                        prev.map((item) => (item.id === sv.id ? { ...item, name: e.target.value } : item))
                      )
                    }
                    placeholder="Sparse vector name (e.g. bm25)"
                    className="flex-1 rounded border border-[#2f3240] bg-[#101116] px-2 py-1 text-xs text-zinc-100 font-mono"
                  />
                  <label className="flex items-center gap-1 text-[11px] text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sv.onDisk}
                      onChange={(e) =>
                        setSparseVectors((prev) =>
                          prev.map((item) => (item.id === sv.id ? { ...item, onDisk: e.target.checked } : item))
                        )
                      }
                    />
                    <span>Index on disk</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setSparseVectors((prev) => prev.filter((item) => item.id !== sv.id))}
                    className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
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

          {/* Quantization, Sharding & Initial Payload Indexes */}
          <section className="border-t border-[#272934] pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200 hover:text-white cursor-pointer"
            >
              {showAdvanced ? (
                <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
              )}
              <span>Quantization, Sharding &amp; Payload Indexes</span>
            </button>
            <p className="text-[11px] text-zinc-500 ml-5 mt-0.5">
              Optional vector quantization, shard topology, and initial payload indexes
            </p>

            {showAdvanced && (
              <div className="mt-3 ml-5 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">Quantization</label>
                    <select
                      value={quantType}
                      onChange={(e) => setQuantType(e.target.value as QuantizationType)}
                      className="w-full rounded border border-[#2f3240] bg-[#121318] px-2.5 py-1.5 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="none">None</option>
                      <option value="scalar">Scalar (int8)</option>
                      <option value="binary">Binary (1-bit)</option>
                      <option value="product">Product (PQ)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">Shard Number</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="1"
                      value={shardNumber}
                      onChange={(e) => setShardNumber(e.target.value)}
                      className="w-full rounded border border-[#2f3240] bg-[#121318] px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-1">Replication Factor</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="1"
                      value={replicationFactor}
                      onChange={(e) => setReplicationFactor(e.target.value)}
                      className="w-full rounded border border-[#2f3240] bg-[#121318] px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                {quantType !== 'none' && (
                  <div className="flex flex-wrap items-center gap-4">
                    {quantType === 'product' && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-zinc-400">Compression:</span>
                        <select
                          value={productCompression}
                          onChange={(e) => setProductCompression(e.target.value as any)}
                          className="rounded border border-[#2f3240] bg-[#121318] px-2 py-1 text-xs text-zinc-100"
                        >
                          {(['x4', 'x8', 'x16', 'x32', 'x64'] as const).map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <label className="inline-flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={quantAlwaysRam}
                        onChange={(e) => setQuantAlwaysRam(e.target.checked)}
                        className="rounded border-zinc-600 bg-[#121318]"
                      />
                      <span>Keep quantized vectors in RAM (always_ram)</span>
                    </label>
                  </div>
                )}

                <label className="inline-flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onDiskPayload}
                    onChange={(e) => setOnDiskPayload(e.target.checked)}
                    className="rounded border-zinc-600 bg-[#121318]"
                  />
                  <span>Store payload on disk (on_disk_payload)</span>
                </label>

                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-zinc-300">Initial Payload Indexes</span>
                    <button
                      type="button"
                      onClick={() =>
                        setInitialIndexes((prev) => [
                          ...prev,
                          { id: `idx-${Date.now()}`, field: '', schema: 'keyword' },
                        ])
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#232632] hover:bg-[#2d3140] text-zinc-200 border border-[#343848] text-[11px] cursor-pointer"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Add Index</span>
                    </button>
                  </div>
                  {initialIndexes.map((idx) => (
                    <div key={idx.id} className="grid grid-cols-12 gap-2 items-center">
                      <input
                        type="text"
                        value={idx.field}
                        onChange={(e) =>
                          setInitialIndexes((prev) =>
                            prev.map((item) => (item.id === idx.id ? { ...item, field: e.target.value } : item))
                          )
                        }
                        placeholder="Field name (e.g. category)"
                        className="col-span-7 rounded border border-[#2f3240] bg-[#101116] px-2 py-1 text-xs text-zinc-100 font-mono focus:border-blue-500 focus:outline-none"
                      />
                      <select
                        value={idx.schema}
                        onChange={(e) =>
                          setInitialIndexes((prev) =>
                            prev.map((item) =>
                              item.id === idx.id ? { ...item, schema: e.target.value as PayloadSchemaType } : item
                            )
                          )
                        }
                        className="col-span-4 rounded border border-[#2f3240] bg-[#101116] px-2 py-1 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
                      >
                        {PAYLOAD_SCHEMA_TYPES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setInitialIndexes((prev) => prev.filter((item) => item.id !== idx.id))}
                        className="col-span-1 flex items-center justify-center p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
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
