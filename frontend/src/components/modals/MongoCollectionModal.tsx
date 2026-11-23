import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Database,
  KeyRound,
  BarChart2,
  ShieldCheck,
  Eye,
  Plus,
  Trash2,
  EyeOff,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { QueryService, SchemaService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';

interface MongoCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  collectionName: string;
  onSuccess?: () => void;
}

type TabKey = 'overview' | 'indexes' | 'schema' | 'validation' | 'ddl';

interface SchemaFieldStat {
  field: string;
  presencePct: number;
  types: Record<string, number>;
}

export const MongoCollectionModal: React.FC<MongoCollectionModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  collectionName,
  onSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(false);

  // Overview
  const [statsDoc, setStatsDoc] = useState<Record<string, any> | null>(null);
  const [ddlText, setDdlText] = useState('');

  // Indexes
  const [indexes, setIndexes] = useState<any[]>([]);
  const [newIdxKeys, setNewIdxKeys] = useState('{ "fieldName": 1 }');
  const [newIdxName, setNewIdxName] = useState('');
  const [newIdxUnique, setNewIdxUnique] = useState(false);
  const [newIdxSparse, setNewIdxSparse] = useState(false);
  const [newIdxTTL, setNewIdxTTL] = useState('');

  // Schema Analyzer
  const [sampleSize, setSampleSize] = useState(100);
  const [schemaStats, setSchemaStats] = useState<SchemaFieldStat[]>([]);

  // Validation
  const [validatorText, setValidatorText] = useState('{\n  "$jsonSchema": {\n    "bsonType": "object"\n  }\n}');
  const [validationLevel, setValidationLevel] = useState<'strict' | 'moderate' | 'off'>('strict');
  const [validationAction, setValidationAction] = useState<'error' | 'warn'>('error');

  const execMql = useCallback(
    async (sql: string) => {
      return QueryService.ExecuteQuery({
        executionId: 'mongo-coll-mgr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        connectionId,
        database,
        schema: database,
        sql,
        limit: 500,
        offset: 0,
      } as any);
    },
    [connectionId, database]
  );

  const loadAll = useCallback(async () => {
    if (!isOpen || !connectionId || !collectionName) return;
    setLoading(true);
    try {
      const collRef = `db.getCollection(${JSON.stringify(collectionName)})`;
      const [statsRes, idxRes, structRes] = await Promise.all([
        execMql(`${collRef}.stats();`).catch(() => null),
        execMql(`${collRef}.getIndexes();`).catch(() => null),
        SchemaService.GetTableStructure(connectionId, database, database, collectionName).catch(() => null),
      ]);

      if (statsRes?.rows?.length && statsRes.columns?.length) {
        const firstRow = statsRes.rows[0] || [];
        const obj: Record<string, any> = {};
        statsRes.columns.forEach((c: any, i: number) => {
          obj[c.name] = firstRow[i];
        });
        setStatsDoc(obj);
      }

      if (idxRes?.rows && idxRes.columns) {
        const idxCols = idxRes.columns;
        const list = idxRes.rows.map((r: any[] | null) => {
          const item: Record<string, any> = {};
          const rowArr = r || [];
          idxCols.forEach((c: any, i: number) => {
            item[c.name] = rowArr[i];
          });
          return item;
        });
        setIndexes(list);
      }

      if (structRes?.ddl) {
        setDdlText(structRes.ddl);
      }
    } finally {
      setLoading(false);
    }
  }, [isOpen, connectionId, database, collectionName, execMql]);

  useEffect(() => {
    if (isOpen) {
      loadAll();
    }
  }, [isOpen, loadAll]);

  const runSchemaAnalyzer = async () => {
    setLoading(true);
    try {
      const collRef = `db.getCollection(${JSON.stringify(collectionName)})`;
      const res = await execMql(`${collRef}.aggregate([{ "$sample": { "size": ${sampleSize} } }]);`);
      const rows = res?.rows || [];
      const cols = res?.columns || [];
      const total = Math.max(1, rows.length);

      const stats: SchemaFieldStat[] = cols.map((c: any, cIdx: number) => {
        let nonNullCount = 0;
        const types: Record<string, number> = {};
        rows.forEach((r: any[] | null) => {
          const v = r?.[cIdx];
          if (v === null || v === undefined) {
            types.null = (types.null || 0) + 1;
            return;
          }
          nonNullCount++;
          const t =
            typeof v === 'number'
              ? 'number'
              : typeof v === 'boolean'
              ? 'boolean'
              : typeof v === 'string' && v.trim().startsWith('[')
              ? 'array'
              : typeof v === 'string' && v.trim().startsWith('{')
              ? 'object'
              : c.dataType || 'string';
          types[t] = (types[t] || 0) + 1;
        });
        return {
          field: c.name,
          presencePct: Math.round((nonNullCount / total) * 100),
          types,
        };
      });
      setSchemaStats(stats);
    } catch (err: any) {
      alertError(err?.message || String(err), 'Schema Analysis Failed');
    } finally {
      setLoading(false);
    }
  };

  const generateJsonSchemaFromSample = () => {
    const props: Record<string, any> = {};
    const required: string[] = [];
    schemaStats.forEach((s) => {
      if (s.presencePct === 100) required.push(s.field);
      const nonNullTypes = Object.keys(s.types).filter((t) => t !== 'null');
      const primary = nonNullTypes[0] || 'string';
      const bsonMap: Record<string, string> = {
        objectId: 'objectId',
        number: 'number',
        int: 'int',
        long: 'long',
        double: 'double',
        decimal: 'decimal',
        boolean: 'bool',
        bool: 'bool',
        array: 'array',
        object: 'object',
        date: 'date',
      };
      props[s.field] = { bsonType: bsonMap[primary] || 'string' };
    });
    const schema = {
      $jsonSchema: {
        bsonType: 'object',
        required,
        properties: props,
      },
    };
    setValidatorText(JSON.stringify(schema, null, 2));
    setActiveTab('validation');
  };

  const handleCreateIndex = async () => {
    try {
      const collRef = `db.getCollection(${JSON.stringify(collectionName)})`;
      const opts: Record<string, any> = {};
      if (newIdxName.trim()) opts.name = newIdxName.trim();
      if (newIdxUnique) opts.unique = true;
      if (newIdxSparse) opts.sparse = true;
      if (newIdxTTL.trim()) opts.expireAfterSeconds = Number(newIdxTTL.trim());
      const mql =
        Object.keys(opts).length > 0
          ? `${collRef}.createIndex(${newIdxKeys.trim()}, ${JSON.stringify(opts)});`
          : `${collRef}.createIndex(${newIdxKeys.trim()});`;
      await execMql(mql);
      alertSuccess('Index created successfully.', 'Index Created');
      await loadAll();
      onSuccess?.();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Create Index Failed');
    }
  };

  const handleDropIndex = async (idxName: string) => {
    const ok = await confirmDialog({
      title: 'Drop Index',
      message: `Drop index "${idxName}" from "${collectionName}"?`,
      confirmLabel: 'Drop Index',
      isDanger: true,
    });
    if (!ok) return;
    try {
      await execMql(`db.getCollection(${JSON.stringify(collectionName)}).dropIndex(${JSON.stringify(idxName)});`);
      alertSuccess(`Index "${idxName}" dropped.`, 'Index Dropped');
      await loadAll();
      onSuccess?.();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Drop Index Failed');
    }
  };

  const handleToggleHideIndex = async (idxName: string, currentlyHidden: boolean) => {
    try {
      const fn = currentlyHidden ? 'unhideIndex' : 'hideIndex';
      await execMql(`db.getCollection(${JSON.stringify(collectionName)}).${fn}(${JSON.stringify(idxName)});`);
      await loadAll();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Toggle Index Visibility Failed');
    }
  };

  const handleApplyValidation = async () => {
    try {
      const parsed = JSON.parse(validatorText);
      const cmd = {
        collMod: collectionName,
        validator: parsed,
        validationLevel,
        validationAction,
      };
      await execMql(`db.runCommand(${JSON.stringify(cmd)});`);
      alertSuccess('Validation rules updated via collMod.', 'Validation Updated');
      await loadAll();
      onSuccess?.();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Update Validation');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-4xl rounded-xl border border-[#282b36] bg-[#14161d] shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#222530]">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-100">
              Collection Manager — {database}.{collectionName}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadAll}
              className="p-1.5 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[#232633] text-zinc-400 hover:text-white cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex border-b border-[#222530] bg-[#101218] px-3 gap-1 text-xs">
          {[
            { id: 'overview', label: 'Overview & Stats', icon: Database },
            { id: 'indexes', label: `Indexes (${indexes.length})`, icon: KeyRound },
            { id: 'schema', label: 'Schema Analyzer', icon: BarChart2 },
            { id: 'validation', label: 'Validation Rules', icon: ShieldCheck },
            { id: 'ddl', label: 'MQL Script', icon: Eye },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id as TabKey)}
                className={`inline-flex items-center gap-1.5 px-3 py-2.5 border-b-2 transition-colors cursor-pointer ${
                  activeTab === t.id
                    ? 'border-emerald-400 text-emerald-300 font-medium'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="p-4 flex-1 overflow-y-auto text-xs space-y-4">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {statsDoc ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Documents (count)', val: statsDoc.count ?? '—' },
                    { label: 'Storage Size', val: statsDoc.storageSize ? `${Math.round(Number(statsDoc.storageSize) / 1024)} KB` : '—' },
                    { label: 'Data Size', val: statsDoc.size ? `${Math.round(Number(statsDoc.size) / 1024)} KB` : '—' },
                    { label: 'Total Index Size', val: statsDoc.totalIndexSize ? `${Math.round(Number(statsDoc.totalIndexSize) / 1024)} KB` : '—' },
                    { label: 'Avg Obj Size', val: statsDoc.avgObjSize ? `${statsDoc.avgObjSize} B` : '—' },
                    { label: 'Indexes Count', val: statsDoc.nindexes ?? indexes.length },
                    { label: 'Capped', val: String(statsDoc.capped ?? false) },
                    { label: 'Namespace', val: statsDoc.ns || `${database}.${collectionName}` },
                  ].map((kpi) => (
                    <div key={kpi.label} className="rounded-lg border border-[#242733] bg-[#0e1015] p-3">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{kpi.label}</div>
                      <div className="text-sm font-mono font-semibold text-zinc-100 mt-1 truncate">{String(kpi.val)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-zinc-500 py-6 text-center">
                  {loading ? 'Loading collection stats...' : 'Collection stats unavailable (or view).'}
                </div>
              )}
            </div>
          )}

          {activeTab === 'indexes' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#242733] bg-[#101218] p-3 space-y-2.5">
                <div className="text-xs font-semibold text-zinc-200">Create New Index</div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Keys (JSON)</label>
                    <input
                      type="text"
                      value={newIdxKeys}
                      onChange={(e) => setNewIdxKeys(e.target.value)}
                      className="w-full rounded border border-[#2a2d3a] bg-[#0b0c10] px-2.5 py-1.5 font-mono text-zinc-100 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Index Name (Optional)</label>
                    <input
                      type="text"
                      value={newIdxName}
                      onChange={(e) => setNewIdxName(e.target.value)}
                      placeholder="auto-generated"
                      className="w-full rounded border border-[#2a2d3a] bg-[#0b0c10] px-2.5 py-1.5 font-mono text-zinc-100 outline-none"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                    <input type="checkbox" checked={newIdxUnique} onChange={(e) => setNewIdxUnique(e.target.checked)} />
                    Unique
                  </label>
                  <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                    <input type="checkbox" checked={newIdxSparse} onChange={(e) => setNewIdxSparse(e.target.checked)} />
                    Sparse
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-400">TTL (sec):</span>
                    <input
                      type="number"
                      value={newIdxTTL}
                      onChange={(e) => setNewIdxTTL(e.target.value)}
                      placeholder="none"
                      className="w-24 rounded border border-[#2a2d3a] bg-[#0b0c10] px-2 py-1 font-mono text-zinc-100 outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateIndex}
                    className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Create Index
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-[#242733] overflow-hidden">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead className="bg-[#181a22] text-zinc-400 border-b border-[#242733]">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Keys</th>
                      <th className="px-3 py-2">Flags</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1f222c]">
                    {indexes.map((idx, i) => {
                      const idxName = String(idx.name || '');
                      const isId = idxName === '_id_';
                      const isHidden = Boolean(idx.hidden);
                      return (
                        <tr key={i} className="hover:bg-[#181b24]">
                          <td className="px-3 py-2 text-zinc-200">{idxName}</td>
                          <td className="px-3 py-2 text-emerald-300">
                            {typeof idx.key === 'string' ? idx.key : JSON.stringify(idx.key)}
                          </td>
                          <td className="px-3 py-2 space-x-1">
                            {idx.unique && <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">UNIQUE</span>}
                            {idx.sparse && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">SPARSE</span>}
                            {isHidden && <span className="px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">HIDDEN</span>}
                            {idx.expireAfterSeconds !== undefined && (
                              <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                                TTL:{idx.expireAfterSeconds}s
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right space-x-1">
                            {!isId && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleToggleHideIndex(idxName, isHidden)}
                                  className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                                  title={isHidden ? 'Unhide Index' : 'Hide Index'}
                                >
                                  <EyeOff className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDropIndex(idxName)}
                                  className="p-1 rounded hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 cursor-pointer"
                                  title="Drop Index"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'schema' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">Sample Size:</span>
                  <select
                    value={sampleSize}
                    onChange={(e) => setSampleSize(Number(e.target.value))}
                    className="rounded border border-[#2a2d3a] bg-[#0d0e13] px-2 py-1 text-zinc-200"
                  >
                    <option value={50}>50 docs</option>
                    <option value={100}>100 docs</option>
                    <option value={500}>500 docs</option>
                  </select>
                  <button
                    type="button"
                    onClick={runSchemaAnalyzer}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium cursor-pointer"
                  >
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart2 className="w-3.5 h-3.5" />}
                    Analyze Schema ($sample)
                  </button>
                </div>
                {schemaStats.length > 0 && (
                  <button
                    type="button"
                    onClick={generateJsonSchemaFromSample}
                    className="px-3 py-1 rounded bg-[#202430] hover:bg-[#2b3040] border border-[#303546] text-emerald-300 cursor-pointer"
                  >
                    Generate $jsonSchema Validator →
                  </button>
                )}
              </div>

              {schemaStats.length === 0 ? (
                <div className="text-center text-zinc-500 py-8 border border-dashed border-[#262934] rounded-lg">
                  Click "Analyze Schema ($sample)" to inspect field presence and BSON type distribution.
                </div>
              ) : (
                <div className="space-y-2">
                  {schemaStats.map((s) => (
                    <div key={s.field} className="rounded-lg border border-[#242733] bg-[#0e1015] p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-semibold text-indigo-300">{s.field}</span>
                        <span className="text-[11px] font-mono text-zinc-400">{s.presencePct}% present</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(s.types).map(([t, cnt]) => (
                          <span key={t} className="px-2 py-0.5 rounded bg-zinc-800/80 text-[10px] font-mono text-zinc-300 border border-zinc-700/60">
                            {t}: {cnt}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'validation' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 mb-1">Validation Level</label>
                  <select
                    value={validationLevel}
                    onChange={(e) => setValidationLevel(e.target.value as any)}
                    className="w-full rounded border border-[#2a2d3a] bg-[#0d0e13] px-2.5 py-1.5 text-zinc-100"
                  >
                    <option value="strict">strict (all inserts & updates)</option>
                    <option value="moderate">moderate (valid docs only)</option>
                    <option value="off">off</option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">Validation Action</label>
                  <select
                    value={validationAction}
                    onChange={(e) => setValidationAction(e.target.value as any)}
                    className="w-full rounded border border-[#2a2d3a] bg-[#0d0e13] px-2.5 py-1.5 text-zinc-100"
                  >
                    <option value="error">error (reject invalid writes)</option>
                    <option value="warn">warn (log warning only)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Validator Document ($jsonSchema / Query)</label>
                <textarea
                  rows={11}
                  value={validatorText}
                  onChange={(e) => setValidatorText(e.target.value)}
                  className="w-full rounded-lg border border-[#2a2d3a] bg-[#0b0c10] p-3 font-mono text-zinc-100 outline-none"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleApplyValidation}
                  className="px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium cursor-pointer"
                >
                  Apply Validation Rules (collMod)
                </button>
              </div>
            </div>
          )}

          {activeTab === 'ddl' && (
            <pre className="rounded-lg border border-[#242733] bg-[#0b0c10] p-3 font-mono text-[11px] text-emerald-300 overflow-x-auto whitespace-pre-wrap">
              {ddlText || '// No MQL script available'}
            </pre>
          )}
        </div>

        <div className="flex items-center justify-end px-4 py-3 border-t border-[#222530]">
          <button type="button" onClick={onClose} className="px-3.5 py-1.5 rounded-md text-xs bg-[#1e212b] hover:bg-[#282c3a] text-zinc-200 cursor-pointer">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
