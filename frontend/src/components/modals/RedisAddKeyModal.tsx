import React, { useState, useMemo } from 'react';
import {
  X,
  Plus,
  Trash2,
  Clock,
  Sparkles,
  Key,
  Layers,
  List,
  CheckCircle2,
  Code,
} from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertSuccess, alertError } from '../../stores/useAlertStore';

interface RedisAddKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  database: string;
  onSuccess?: () => void;
}

type RedisKeyType = 'string' | 'hash' | 'list' | 'set' | 'zset';

export const RedisAddKeyModal: React.FC<RedisAddKeyModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  database,
  onSuccess,
}) => {
  const [keyName, setKeyName] = useState('');
  const [keyType, setKeyType] = useState<RedisKeyType>('string');
  const [stringValue, setStringValue] = useState('');
  const [hashEntries, setHashEntries] = useState<{ field: string; value: string }[]>([
    { field: '', value: '' },
  ]);
  const [listEntries, setListEntries] = useState<string[]>(['']);
  const [listPushSide, setListPushSide] = useState<'RPUSH' | 'LPUSH'>('RPUSH');
  const [setMembers, setSetMembers] = useState<string[]>(['']);
  const [zsetMembers, setZsetMembers] = useState<{ member: string; score: number }[]>([
    { member: '', score: 1 },
  ]);

  // TTL settings
  const [ttlMode, setTtlMode] = useState<'persist' | 'custom'>('persist');
  const [ttlAmount, setTtlAmount] = useState('3600');
  const [ttlUnit, setTtlUnit] = useState<'s' | 'm' | 'h' | 'd'>('s');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-detect JSON formatting for String value
  const isJson = useMemo(() => {
    if (!stringValue.trim() || !stringValue.startsWith('{') && !stringValue.startsWith('[')) {
      return false;
    }
    try {
      JSON.parse(stringValue);
      return true;
    } catch {
      return false;
    }
  }, [stringValue]);

  const handlePrettifyJson = () => {
    try {
      const parsed = JSON.parse(stringValue);
      setStringValue(JSON.stringify(parsed, null, 2));
    } catch {}
  };

  const generatedCommands = useMemo(() => {
    const k = keyName.trim() || 'my_key';
    const cmds: string[] = [];

    switch (keyType) {
      case 'string':
        cmds.push(`SET ${JSON.stringify(k)} ${JSON.stringify(stringValue)}`);
        break;
      case 'hash': {
        const valid = hashEntries.filter((h) => h.field.trim() !== '');
        if (valid.length > 0) {
          const parts = valid.map((h) => `${JSON.stringify(h.field.trim())} ${JSON.stringify(h.value)}`).join(' ');
          cmds.push(`HSET ${JSON.stringify(k)} ${parts}`);
        } else {
          cmds.push(`HSET ${JSON.stringify(k)} "field" "value"`);
        }
        break;
      }
      case 'list': {
        const valid = listEntries.filter((item) => item !== '');
        if (valid.length > 0) {
          const parts = valid.map((item) => JSON.stringify(item)).join(' ');
          cmds.push(`${listPushSide} ${JSON.stringify(k)} ${parts}`);
        } else {
          cmds.push(`${listPushSide} ${JSON.stringify(k)} "item1"`);
        }
        break;
      }
      case 'set': {
        const valid = setMembers.filter((m) => m.trim() !== '');
        if (valid.length > 0) {
          const parts = valid.map((m) => JSON.stringify(m.trim())).join(' ');
          cmds.push(`SADD ${JSON.stringify(k)} ${parts}`);
        } else {
          cmds.push(`SADD ${JSON.stringify(k)} "member1"`);
        }
        break;
      }
      case 'zset': {
        const valid = zsetMembers.filter((z) => z.member.trim() !== '');
        if (valid.length > 0) {
          const parts = valid.map((z) => `${z.score} ${JSON.stringify(z.member.trim())}`).join(' ');
          cmds.push(`ZADD ${JSON.stringify(k)} ${parts}`);
        } else {
          cmds.push(`ZADD ${JSON.stringify(k)} 1 "member1"`);
        }
        break;
      }
    }

    if (ttlMode === 'custom') {
      const multiplier = ttlUnit === 'd' ? 86400 : ttlUnit === 'h' ? 3600 : ttlUnit === 'm' ? 60 : 1;
      const secs = Math.max(1, (parseInt(ttlAmount, 10) || 1) * multiplier);
      cmds.push(`EXPIRE ${JSON.stringify(k)} ${secs}`);
    }

    return cmds;
  }, [keyName, keyType, stringValue, hashEntries, listEntries, listPushSide, setMembers, zsetMembers, ttlMode, ttlAmount, ttlUnit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalKey = keyName.trim();
    if (!finalKey) {
      alertError('Key name cannot be empty');
      return;
    }

    setIsSubmitting(true);
    try {
      const fullCmd = generatedCommands.join('\n');
      const res = await QueryService.ExecuteQuery({
        executionId: 'add-key-' + Date.now(),
        connectionId,
        database,
        sql: fullCmd,
        limit: 10,
        offset: 0,
      } as any);

      if (res?.error) {
        alertError(`Failed to create key: ${res.error}`);
        return;
      }

      alertSuccess(`Key "${finalKey}" created successfully!`);
      onClose();
      onSuccess?.();
    } catch (err: any) {
      alertError(err?.message || 'Error executing Redis commands');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-xl rounded-xl border border-[#2b2e3a] bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100 max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#272932] px-5 py-3.5 bg-[#1e2029]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Add New Key to Redis</h3>
              <p className="text-[11px] text-zinc-400 font-mono">Database: {database}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Key Name & Type Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 space-y-1">
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                Key Name <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. user:1001 or session:token"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  className="w-full bg-[#101115] border border-[#2b2e3a] focus:border-blue-500 px-3 py-1.5 text-xs text-white outline-none rounded-lg font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">Data Type</label>
              <select
                value={keyType}
                onChange={(e) => setKeyType(e.target.value as RedisKeyType)}
                className="w-full bg-[#101115] border border-[#2b2e3a] focus:border-blue-500 px-2.5 py-1.5 text-xs text-white outline-none rounded-lg font-semibold uppercase cursor-pointer"
              >
                <option value="string">String</option>
                <option value="hash">Hash</option>
                <option value="list">List</option>
                <option value="set">Set</option>
                <option value="zset">ZSet (Sorted)</option>
              </select>
            </div>
          </div>

          {/* Value Inputs Based on Type */}
          <div className="rounded-lg border border-[#272932] bg-[#121318] p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-blue-400" />
                <span>Value Payload ({keyType.toUpperCase()})</span>
              </span>
              {keyType === 'string' && isJson && (
                <button
                  type="button"
                  onClick={handlePrettifyJson}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:bg-blue-500/20 cursor-pointer"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Prettify JSON</span>
                </button>
              )}
            </div>

            {/* String Type */}
            {keyType === 'string' && (
              <div>
                <textarea
                  rows={4}
                  placeholder="Enter text or JSON string..."
                  value={stringValue}
                  onChange={(e) => setStringValue(e.target.value)}
                  className="w-full bg-[#0d0e12] border border-[#22242c] focus:border-blue-500 p-2.5 text-xs text-zinc-200 outline-none rounded-lg font-mono resize-y"
                />
              </div>
            )}

            {/* Hash Type */}
            {keyType === 'hash' && (
              <div className="space-y-2">
                {hashEntries.map((entry, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Field name"
                      value={entry.field}
                      onChange={(e) => {
                        const next = [...hashEntries];
                        next[idx].field = e.target.value;
                        setHashEntries(next);
                      }}
                      className="w-1/3 bg-[#0d0e12] border border-[#22242c] px-2.5 py-1 text-xs text-white rounded font-mono"
                    />
                    <input
                      type="text"
                      placeholder="Field value"
                      value={entry.value}
                      onChange={(e) => {
                        const next = [...hashEntries];
                        next[idx].value = e.target.value;
                        setHashEntries(next);
                      }}
                      className="flex-1 bg-[#0d0e12] border border-[#22242c] px-2.5 py-1 text-xs text-white rounded font-mono"
                    />
                    {hashEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setHashEntries(hashEntries.filter((_, i) => i !== idx))}
                        className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setHashEntries([...hashEntries, { field: '', value: '' }])}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
                >
                  <Plus className="h-3 w-3" />
                  <span>Add Another Field</span>
                </button>
              </div>
            )}

            {/* List Type */}
            {keyType === 'list' && (
              <div className="space-y-2">
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-zinc-400">Push Side:</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="listSide"
                      checked={listPushSide === 'RPUSH'}
                      onChange={() => setListPushSide('RPUSH')}
                      className="accent-blue-500"
                    />
                    <span>Append (RPUSH)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="listSide"
                      checked={listPushSide === 'LPUSH'}
                      onChange={() => setListPushSide('LPUSH')}
                      className="accent-blue-500"
                    />
                    <span>Prepend (LPUSH)</span>
                  </label>
                </div>
                {listEntries.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-500 font-mono w-6">#{idx + 1}</span>
                    <input
                      type="text"
                      placeholder="Item value"
                      value={item}
                      onChange={(e) => {
                        const next = [...listEntries];
                        next[idx] = e.target.value;
                        setListEntries(next);
                      }}
                      className="flex-1 bg-[#0d0e12] border border-[#22242c] px-2.5 py-1 text-xs text-white rounded font-mono"
                    />
                    {listEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setListEntries(listEntries.filter((_, i) => i !== idx))}
                        className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setListEntries([...listEntries, ''])}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
                >
                  <Plus className="h-3 w-3" />
                  <span>Add Another Item</span>
                </button>
              </div>
            )}

            {/* Set Type */}
            {keyType === 'set' && (
              <div className="space-y-2">
                {setMembers.map((member, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Unique member"
                      value={member}
                      onChange={(e) => {
                        const next = [...setMembers];
                        next[idx] = e.target.value;
                        setSetMembers(next);
                      }}
                      className="flex-1 bg-[#0d0e12] border border-[#22242c] px-2.5 py-1 text-xs text-white rounded font-mono"
                    />
                    {setMembers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setSetMembers(setMembers.filter((_, i) => i !== idx))}
                        className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setSetMembers([...setMembers, ''])}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
                >
                  <Plus className="h-3 w-3" />
                  <span>Add Another Member</span>
                </button>
              </div>
            )}

            {/* ZSet Type */}
            {keyType === 'zset' && (
              <div className="space-y-2">
                {zsetMembers.map((entry, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="Score"
                      value={entry.score}
                      onChange={(e) => {
                        const next = [...zsetMembers];
                        next[idx].score = parseFloat(e.target.value) || 0;
                        setZsetMembers(next);
                      }}
                      className="w-24 bg-[#0d0e12] border border-[#22242c] px-2.5 py-1 text-xs text-white rounded font-mono"
                    />
                    <input
                      type="text"
                      placeholder="Member"
                      value={entry.member}
                      onChange={(e) => {
                        const next = [...zsetMembers];
                        next[idx].member = e.target.value;
                        setZsetMembers(next);
                      }}
                      className="flex-1 bg-[#0d0e12] border border-[#22242c] px-2.5 py-1 text-xs text-white rounded font-mono"
                    />
                    {zsetMembers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setZsetMembers(zsetMembers.filter((_, i) => i !== idx))}
                        className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setZsetMembers([...zsetMembers, { member: '', score: (zsetMembers.length + 1) }])}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
                >
                  <Plus className="h-3 w-3" />
                  <span>Add Another Member & Score</span>
                </button>
              </div>
            )}
          </div>

          {/* TTL Configuration */}
          <div className="space-y-2 rounded-lg border border-[#272932] bg-[#121318] p-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-amber-400" />
                <span>Expiration / TTL</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTtlMode('persist')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    ttlMode === 'persist'
                      ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Persist (No TTL)
                </button>
                <button
                  type="button"
                  onClick={() => setTtlMode('custom')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    ttlMode === 'custom'
                      ? 'bg-amber-600/20 text-amber-300 border border-amber-500/30'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Set TTL
                </button>
              </div>
            </div>

            {ttlMode === 'custom' && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="number"
                  min="1"
                  value={ttlAmount}
                  onChange={(e) => setTtlAmount(e.target.value)}
                  className="flex-1 bg-[#0d0e12] border border-[#22242c] px-3 py-1 text-xs text-white rounded font-mono"
                />
                <select
                  value={ttlUnit}
                  onChange={(e) => setTtlUnit(e.target.value as any)}
                  className="bg-[#0d0e12] border border-[#22242c] px-2 py-1 text-xs text-white rounded font-medium cursor-pointer"
                >
                  <option value="s">Seconds (s)</option>
                  <option value="m">Minutes (m)</option>
                  <option value="h">Hours (h)</option>
                  <option value="d">Days (d)</option>
                </select>
              </div>
            )}
          </div>

          {/* Command Preview */}
          <div className="bg-[#0d0e12] border border-[#22242c] rounded-lg p-2.5 space-y-1">
            <span className="text-[10px] uppercase font-semibold text-zinc-500 flex items-center gap-1">
              <Code className="h-3 w-3" />
              <span>Redis Command Preview</span>
            </span>
            <pre className="font-mono text-[11px] text-amber-400 whitespace-pre-wrap break-all">
              {generatedCommands.join('\n')}
            </pre>
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#272932]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 rounded-lg border border-[#2b2e3a] bg-[#14151b] hover:bg-[#20222a] text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !keyName.trim()}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer transition-colors shadow-xs"
            >
              {isSubmitting ? 'Creating Key...' : 'Create Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

