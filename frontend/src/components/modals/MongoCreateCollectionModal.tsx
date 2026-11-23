import React, { useState, useMemo } from 'react';
import { X, Plus, Loader2, Database, Eye } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess } from '../../stores/useAlertStore';

interface MongoCreateCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  onSuccess?: (createdName: string) => void;
}

type CollectionKind = 'standard' | 'capped' | 'timeseries' | 'view';

export const MongoCreateCollectionModal: React.FC<MongoCreateCollectionModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  onSuccess,
}) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CollectionKind>('standard');
  const [cappedSizeMB, setCappedSizeMB] = useState('10');
  const [cappedMaxDocs, setCappedMaxDocs] = useState('');
  const [tsTimeField, setTsTimeField] = useState('timestamp');
  const [tsMetaField, setTsMetaField] = useState('metadata');
  const [tsGranularity, setTsGranularity] = useState<'seconds' | 'minutes' | 'hours'>('seconds');
  const [clusteredIndex, setClusteredIndex] = useState(false);
  const [collationLocale, setCollationLocale] = useState('');
  const [validatorJson, setValidatorJson] = useState('');
  const [viewOn, setViewOn] = useState('');
  const [viewPipeline, setViewPipeline] = useState('[\n  { "$match": {} }\n]');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const generatedMql = useMemo(() => {
    const cleanName = name.trim() || 'my_collection';
    if (kind === 'view') {
      return `db.createView(${JSON.stringify(cleanName)}, ${JSON.stringify(viewOn.trim() || 'source_collection')}, ${viewPipeline.trim() || '[]'});`;
    }
    const opts: Record<string, any> = {};
    if (kind === 'capped') {
      opts.capped = true;
      opts.size = Math.max(1, Number(cappedSizeMB) || 10) * 1024 * 1024;
      if (cappedMaxDocs.trim()) {
        opts.max = Number(cappedMaxDocs);
      }
    } else if (kind === 'timeseries') {
      opts.timeseries = {
        timeField: tsTimeField.trim() || 'timestamp',
        ...(tsMetaField.trim() ? { metaField: tsMetaField.trim() } : {}),
        granularity: tsGranularity,
      };
    }
    if (clusteredIndex) {
      opts.clusteredIndex = { key: { _id: 1 }, unique: true };
    }
    if (collationLocale.trim()) {
      opts.collation = { locale: collationLocale.trim() };
    }
    if (validatorJson.trim()) {
      try {
        opts.validator = JSON.parse(validatorJson);
      } catch {
        // leave raw in preview if invalid
      }
    }
    if (Object.keys(opts).length === 0) {
      return `db.createCollection(${JSON.stringify(cleanName)});`;
    }
    return `db.createCollection(${JSON.stringify(cleanName)}, ${JSON.stringify(opts, null, 2)});`;
  }, [name, kind, cappedSizeMB, cappedMaxDocs, tsTimeField, tsMetaField, tsGranularity, clusteredIndex, collationLocale, validatorJson, viewOn, viewPipeline]);

  if (!isOpen) return null;

  const handleCreate = async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      alertError('Collection name is required.', 'Validation Error');
      return;
    }
    if (kind === 'view' && !viewOn.trim()) {
      alertError('Source collection (viewOn) is required for a MongoDB View.', 'Validation Error');
      return;
    }
    setIsSubmitting(true);
    try {
      await QueryService.ExecuteQuery({
        executionId: 'mongo-create-coll-' + Date.now(),
        connectionId,
        database,
        schema: database,
        sql: generatedMql,
        limit: 10,
        offset: 0,
      } as any);
      alertSuccess(
        `${kind === 'view' ? 'View' : 'Collection'} "${cleanName}" created in "${database}".`,
        'Created Successfully'
      );
      onSuccess?.(cleanName);
      onClose();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Create Collection');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl rounded-xl border border-[#282b36] bg-[#14161d] shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#222530]">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-100">
              Create MongoDB Collection / View ({database})
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-400 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. orders, sensor_events"
                className="w-full rounded-md border border-[#2a2d3a] bg-[#0d0e13] px-3 py-1.5 text-zinc-100 focus:border-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-zinc-400 mb-1">Type</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as CollectionKind)}
                className="w-full rounded-md border border-[#2a2d3a] bg-[#0d0e13] px-3 py-1.5 text-zinc-100 focus:border-emerald-500 outline-none"
              >
                <option value="standard">Standard Collection</option>
                <option value="capped">Capped Collection (Fixed Size)</option>
                <option value="timeseries">Time-Series Collection</option>
                <option value="view">Read-Only View</option>
              </select>
            </div>
          </div>

          {kind === 'capped' && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#252834] bg-[#101218] p-3">
              <div>
                <label className="block text-zinc-400 mb-1">Max Size (MB)</label>
                <input
                  type="number"
                  min={1}
                  value={cappedSizeMB}
                  onChange={(e) => setCappedSizeMB(e.target.value)}
                  className="w-full rounded-md border border-[#2a2d3a] bg-[#0d0e13] px-2.5 py-1.5 text-zinc-100 outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Max Documents (Optional)</label>
                <input
                  type="number"
                  min={1}
                  value={cappedMaxDocs}
                  onChange={(e) => setCappedMaxDocs(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full rounded-md border border-[#2a2d3a] bg-[#0d0e13] px-2.5 py-1.5 text-zinc-100 outline-none"
                />
              </div>
            </div>
          )}

          {kind === 'timeseries' && (
            <div className="grid grid-cols-3 gap-3 rounded-lg border border-[#252834] bg-[#101218] p-3">
              <div>
                <label className="block text-zinc-400 mb-1">timeField *</label>
                <input
                  type="text"
                  value={tsTimeField}
                  onChange={(e) => setTsTimeField(e.target.value)}
                  className="w-full rounded-md border border-[#2a2d3a] bg-[#0d0e13] px-2.5 py-1.5 text-zinc-100 outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">metaField</label>
                <input
                  type="text"
                  value={tsMetaField}
                  onChange={(e) => setTsMetaField(e.target.value)}
                  className="w-full rounded-md border border-[#2a2d3a] bg-[#0d0e13] px-2.5 py-1.5 text-zinc-100 outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Granularity</label>
                <select
                  value={tsGranularity}
                  onChange={(e) => setTsGranularity(e.target.value as any)}
                  className="w-full rounded-md border border-[#2a2d3a] bg-[#0d0e13] px-2.5 py-1.5 text-zinc-100 outline-none"
                >
                  <option value="seconds">seconds</option>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                </select>
              </div>
            </div>
          )}

          {kind === 'view' ? (
            <div className="space-y-3 rounded-lg border border-[#252834] bg-[#101218] p-3">
              <div>
                <label className="block text-zinc-400 mb-1">Source Collection (viewOn) *</label>
                <input
                  type="text"
                  value={viewOn}
                  onChange={(e) => setViewOn(e.target.value)}
                  placeholder="e.g. users"
                  className="w-full rounded-md border border-[#2a2d3a] bg-[#0d0e13] px-2.5 py-1.5 text-zinc-100 outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Aggregation Pipeline (JSON Array)</label>
                <textarea
                  rows={5}
                  value={viewPipeline}
                  onChange={(e) => setViewPipeline(e.target.value)}
                  className="w-full rounded-md border border-[#2a2d3a] bg-[#0b0c10] p-2.5 font-mono text-zinc-200 outline-none"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 mb-1">Collation Locale (Optional)</label>
                  <input
                    type="text"
                    value={collationLocale}
                    onChange={(e) => setCollationLocale(e.target.value)}
                    placeholder="e.g. en, id, fr"
                    className="w-full rounded-md border border-[#2a2d3a] bg-[#0d0e13] px-2.5 py-1.5 text-zinc-100 outline-none"
                  />
                </div>
                <div className="flex items-end pb-1.5">
                  <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={clusteredIndex}
                      onChange={(e) => setClusteredIndex(e.target.checked)}
                      className="rounded border-zinc-600 bg-zinc-900 text-emerald-500"
                    />
                    <span>Use Clustered Index (_id)</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">JSON Schema Validator (Optional)</label>
                <textarea
                  rows={4}
                  value={validatorJson}
                  onChange={(e) => setValidatorJson(e.target.value)}
                  placeholder='{ "$jsonSchema": { "bsonType": "object", "required": ["email"] } }'
                  className="w-full rounded-md border border-[#2a2d3a] bg-[#0b0c10] p-2.5 font-mono text-zinc-200 outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-1.5 text-zinc-400 mb-1">
              <Eye className="w-3.5 h-3.5 text-emerald-400" />
              <span>Live MQL Preview</span>
            </div>
            <pre className="rounded-lg border border-[#232633] bg-[#0b0c10] p-3 font-mono text-[11px] text-emerald-300 overflow-x-auto">
              {generatedMql}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#222530]">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md text-xs bg-[#1e212b] hover:bg-[#282c3a] text-zinc-300 cursor-pointer">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white cursor-pointer"
          >
            {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
};
