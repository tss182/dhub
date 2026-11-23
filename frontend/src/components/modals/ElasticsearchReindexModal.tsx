import React, { useEffect, useRef, useState } from 'react';
import { X, Copy, Loader2, Play, Square, ArrowRightLeft } from 'lucide-react';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';

interface ElasticsearchReindexModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  sourceIndex: string;
  onCompleted?: () => void;
}

export const ElasticsearchReindexModal: React.FC<ElasticsearchReindexModalProps> = ({
  isOpen,
  onClose,
  connectionId,
  sourceIndex,
  onCompleted,
}) => {
  const [mode, setMode] = useState<'reindex' | 'clone'>('reindex');
  const [targetIndex, setTargetIndex] = useState('');
  const [createTargetFirst, setCreateTargetFirst] = useState(true);
  const [targetConfigJson, setTargetConfigJson] = useState('');
  const [loadingConfig, setLoadingConfig] = useState(false);

  const [filterQueryJson, setFilterQueryJson] = useState('');
  const [painlessScript, setPainlessScript] = useState('');
  const [slicesAuto, setSlicesAuto] = useState(true);
  const [conflictsProceed, setConflictsProceed] = useState(true);
  const [runAsync, setRunAsync] = useState(true);
  const [swapAlias, setSwapAlias] = useState('');

  // Clone options
  const [autoToggleWriteBlock, setAutoToggleWriteBlock] = useState(true);

  const [isRunning, setIsRunning] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState('');
  const [taskStats, setTaskStats] = useState<{
    total: number;
    created: number;
    updated: number;
    deleted: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelPollRef = useRef(false);

  const runRest = async (sql: string) => {
    const res = await QueryService.ExecuteQuery({
      executionId: `es-reindex-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      connectionId,
      database: 'default',
      schema: 'default',
      sql,
      limit: 200,
      offset: 0,
    } as any);
    if (res?.error) throw new Error(res.error);
    const raw = res?.rows?.[0]?.[0];
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  };

  useEffect(() => {
    if (!isOpen || !sourceIndex) return;
    setMode('reindex');
    setTargetIndex(`${sourceIndex}_v2`);
    setCreateTargetFirst(true);
    setFilterQueryJson('');
    setPainlessScript('');
    setSlicesAuto(true);
    setConflictsProceed(true);
    setRunAsync(true);
    setSwapAlias('');
    setAutoToggleWriteBlock(true);
    setIsRunning(false);
    setActiveTaskId(null);
    setProgressMsg('');
    setTaskStats(null);
    setError(null);
    cancelPollRef.current = false;

    setLoadingConfig(true);
    Promise.all([
      runRest(`GET /${encodeURIComponent(sourceIndex)}/_mapping`).catch(() => ({})),
      runRest(`GET /${encodeURIComponent(sourceIndex)}/_settings`).catch(() => ({})),
    ])
      .then(([mapResp, setResp]) => {
        const srcMappings = mapResp?.[sourceIndex]?.mappings || {};
        const rawSettings = setResp?.[sourceIndex]?.settings?.index || {};
        const cleanSettings: Record<string, any> = {};
        if (rawSettings.number_of_shards) cleanSettings.number_of_shards = rawSettings.number_of_shards;
        if (rawSettings.number_of_replicas !== undefined) {
          cleanSettings.number_of_replicas = rawSettings.number_of_replicas;
        }
        if (rawSettings.refresh_interval) cleanSettings.refresh_interval = rawSettings.refresh_interval;
        if (rawSettings.max_result_window) cleanSettings.max_result_window = rawSettings.max_result_window;
        if (rawSettings.analysis) cleanSettings.analysis = rawSettings.analysis;

        setTargetConfigJson(
          JSON.stringify(
            {
              settings: cleanSettings,
              mappings: srcMappings,
            },
            null,
            2
          )
        );
      })
      .finally(() => setLoadingConfig(false));

    return () => {
      cancelPollRef.current = true;
    };
  }, [isOpen, sourceIndex, connectionId]);

  if (!isOpen) return null;

  const handleCancelTask = async () => {
    cancelPollRef.current = true;
    if (activeTaskId) {
      try {
        await runRest(`POST /_tasks/${encodeURIComponent(activeTaskId)}/_cancel`);
        setProgressMsg('Cancellation requested for background task.');
      } catch (err: any) {
        setError(err?.message || String(err));
      }
    }
    setIsRunning(false);
  };

  const performAliasSwap = async (dst: string) => {
    const alias = swapAlias.trim();
    if (!alias) return;
    setProgressMsg(`Atomically switching alias "${alias}" to "${dst}"...`);
    await runRest(
      `POST /_aliases\n${JSON.stringify({
        actions: [
          { remove: { index: sourceIndex, alias } },
          { add: { index: dst, alias } },
        ],
      })}`
    );
  };

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    const dst = targetIndex.trim();
    if (!dst || dst === sourceIndex) {
      setError('Target index name must be non-empty and different from source index.');
      return;
    }

    setError(null);
    setIsRunning(true);
    setTaskStats(null);
    setActiveTaskId(null);
    cancelPollRef.current = false;

    try {
      if (mode === 'clone') {
        const ok = await confirmDialog({
          title: 'Clone Elasticsearch Index',
          message: autoToggleWriteBlock
            ? `Clone "${sourceIndex}" -> "${dst}"? This will temporarily set index.blocks.write=true on "${sourceIndex}" during cloning and restore it afterwards.`
            : `Clone "${sourceIndex}" -> "${dst}"? Note: "${sourceIndex}" must already have index.blocks.write=true.`,
          confirmLabel: 'Clone Index',
        });
        if (!ok) {
          setIsRunning(false);
          return;
        }

        if (autoToggleWriteBlock) {
          setProgressMsg(`Setting index.blocks.write=true on "${sourceIndex}"...`);
          await runRest(
            `PUT /${encodeURIComponent(sourceIndex)}/_settings\n${JSON.stringify({
              'index.blocks.write': true,
            })}`
          );
        }

        try {
          setProgressMsg(`Cloning "${sourceIndex}" to "${dst}"...`);
          await runRest(`POST /${encodeURIComponent(sourceIndex)}/_clone/${encodeURIComponent(dst)}`);
        } finally {
          if (autoToggleWriteBlock) {
            setProgressMsg(`Restoring write access on "${sourceIndex}"...`);
            await runRest(
              `PUT /${encodeURIComponent(sourceIndex)}/_settings\n${JSON.stringify({
                'index.blocks.write': false,
              })}`
            ).catch(() => {});
          }
        }

        if (swapAlias.trim()) {
          await performAliasSwap(dst);
        }

        alertSuccess(`Cloned "${sourceIndex}" to "${dst}".`, 'Index Cloned');
        onCompleted?.();
        onClose();
        return;
      }

      // Mode: Reindex
      if (createTargetFirst && targetConfigJson.trim()) {
        let parsedCfg: any;
        try {
          parsedCfg = JSON.parse(targetConfigJson);
        } catch (err: any) {
          throw new Error(`Invalid Target Index Config JSON: ${err?.message || err}`);
        }
        setProgressMsg(`Creating target index "${dst}"...`);
        await runRest(`PUT /${encodeURIComponent(dst)}\n${JSON.stringify(parsedCfg)}`);
      }

      const sourceObj: Record<string, any> = { index: sourceIndex };
      if (filterQueryJson.trim()) {
        try {
          sourceObj.query = JSON.parse(filterQueryJson);
        } catch (err: any) {
          throw new Error(`Invalid Filter Query JSON: ${err?.message || err}`);
        }
      }

      const reindexBody: Record<string, any> = {
        source: sourceObj,
        dest: { index: dst },
      };
      if (conflictsProceed) {
        reindexBody.conflicts = 'proceed';
      }
      if (painlessScript.trim()) {
        reindexBody.script = {
          source: painlessScript.trim(),
          lang: 'painless',
        };
      }

      const params: string[] = [];
      if (slicesAuto) params.push('slices=auto');
      if (runAsync) params.push('wait_for_completion=false');
      else params.push('refresh=true');
      const qs = params.length > 0 ? `?${params.join('&')}` : '';

      setProgressMsg(runAsync ? 'Starting async reindex task...' : 'Reindexing documents (synchronous)...');
      const resp = await runRest(`POST /_reindex${qs}\n${JSON.stringify(reindexBody)}`);

      if (runAsync && resp?.task) {
        const taskId = String(resp.task);
        setActiveTaskId(taskId);
        setProgressMsg(`Running task ${taskId}...`);

        while (!cancelPollRef.current) {
          await new Promise((r) => setTimeout(r, 900));
          if (cancelPollRef.current) break;

          const taskInfo = await runRest(`GET /_tasks/${encodeURIComponent(taskId)}`);
          const st = taskInfo?.task?.status;
          if (st) {
            setTaskStats({
              total: Number(st.total || 0),
              created: Number(st.created || 0),
              updated: Number(st.updated || 0),
              deleted: Number(st.deleted || 0),
            });
          }
          if (taskInfo?.completed) {
            if (taskInfo?.error) {
              throw new Error(taskInfo.error.reason || JSON.stringify(taskInfo.error));
            }
            const failures = taskInfo?.response?.failures;
            if (Array.isArray(failures) && failures.length > 0) {
              throw new Error(`Reindex completed with ${failures.length} failure(s): ${JSON.stringify(failures[0])}`);
            }
            break;
          }
        }

        if (cancelPollRef.current) {
          setIsRunning(false);
          return;
        }
      }

      if (swapAlias.trim()) {
        await performAliasSwap(dst);
      }

      alertSuccess(`Reindexed "${sourceIndex}" -> "${dst}".`, 'Reindex Completed');
      onCompleted?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const processedCount = taskStats ? taskStats.created + taskStats.updated + taskStats.deleted : 0;
  const pct =
    taskStats && taskStats.total > 0
      ? Math.min(100, Math.round((processedCount / taskStats.total) * 100))
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4 select-none">
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-xl border border-[#323542] bg-[#1b1c22] text-zinc-200 shadow-2xl overflow-hidden text-xs">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2e3a] bg-[#16171d] shrink-0">
          <div className="flex items-center gap-2">
            <Copy className="h-4 w-4 text-blue-400" />
            <span className="font-semibold text-sm text-zinc-100">
              Reindex / Clone Index: <code className="text-blue-300 font-mono">{sourceIndex}</code>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isRunning}
            className="p-1 rounded text-zinc-400 hover:text-white cursor-pointer disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleStart} className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Mode Tabs */}
          <div className="inline-flex rounded-lg bg-[#121318] border border-[#272934] p-0.5">
            <button
              type="button"
              disabled={isRunning}
              onClick={() => setMode('reindex')}
              className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                mode === 'reindex' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Reindex (_reindex)
            </button>
            <button
              type="button"
              disabled={isRunning}
              onClick={() => setMode('clone')}
              className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                mode === 'clone' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Instant Clone (_clone)
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Target Index Name</label>
              <input
                type="text"
                required
                disabled={isRunning}
                value={targetIndex}
                onChange={(e) => setTargetIndex(e.target.value.toLowerCase())}
                placeholder={`${sourceIndex}_v2`}
                className="w-full rounded bg-[#121317] border border-[#272932] px-2.5 py-1.5 font-mono text-zinc-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">
                Post-Completion Atomic Alias Cutover (optional)
              </label>
              <div className="flex items-center gap-1.5">
                <ArrowRightLeft className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <input
                  type="text"
                  disabled={isRunning}
                  value={swapAlias}
                  onChange={(e) => setSwapAlias(e.target.value)}
                  placeholder="e.g. products_live"
                  className="w-full rounded bg-[#121317] border border-[#272932] px-2.5 py-1.5 font-mono text-zinc-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {mode === 'clone' ? (
            <div className="rounded-lg border border-[#272934] bg-[#14151b] p-3 space-y-2">
              <div className="text-[11px] text-zinc-300">
                <code>POST /{sourceIndex}/_clone/{targetIndex || '<target>'}</code> clones segments directly inside the cluster without re-parsing documents.
              </div>
              <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoToggleWriteBlock}
                  onChange={(e) => setAutoToggleWriteBlock(e.target.checked)}
                />
                <span>Temporarily set <code>index.blocks.write=true</code> on source during clone and restore afterwards</span>
              </label>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-[#272934] bg-[#14151b] p-3 space-y-2">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2 text-zinc-200 font-medium">
                    <input
                      type="checkbox"
                      disabled={isRunning}
                      checked={createTargetFirst}
                      onChange={(e) => setCreateTargetFirst(e.target.checked)}
                    />
                    <span>Create target index first with editable settings &amp; mappings</span>
                  </div>
                  {loadingConfig && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
                </label>
                {createTargetFirst && (
                  <textarea
                    rows={7}
                    disabled={isRunning}
                    value={targetConfigJson}
                    onChange={(e) => setTargetConfigJson(e.target.value)}
                    spellCheck={false}
                    className="w-full rounded bg-[#101116] border border-[#272932] p-2 font-mono text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
                  />
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Source Filter Query JSON (optional)
                  </label>
                  <textarea
                    rows={4}
                    disabled={isRunning}
                    value={filterQueryJson}
                    onChange={(e) => setFilterQueryJson(e.target.value)}
                    placeholder={'{\n  "range": { "created_at": { "gte": "2026-01-01" } }\n}'}
                    spellCheck={false}
                    className="w-full rounded bg-[#121317] border border-[#272932] p-2 font-mono text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Painless Transform Script (optional)
                  </label>
                  <textarea
                    rows={4}
                    disabled={isRunning}
                    value={painlessScript}
                    onChange={(e) => setPainlessScript(e.target.value)}
                    placeholder={'ctx._source.migrated = true;'}
                    spellCheck={false}
                    className="w-full rounded bg-[#121317] border border-[#272932] p-2 font-mono text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-300 pt-1">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={isRunning}
                    checked={runAsync}
                    onChange={(e) => setRunAsync(e.target.checked)}
                  />
                  <span>Async with Live Task Progress (<code>wait_for_completion=false</code>)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={isRunning}
                    checked={slicesAuto}
                    onChange={(e) => setSlicesAuto(e.target.checked)}
                  />
                  <span><code>slices=auto</code></span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={isRunning}
                    checked={conflictsProceed}
                    onChange={(e) => setConflictsProceed(e.target.checked)}
                  />
                  <span><code>conflicts=proceed</code></span>
                </label>
              </div>
            </>
          )}

          {(isRunning || progressMsg) && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-950/20 p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-blue-200 font-medium flex items-center gap-1.5">
                  {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />}
                  {progressMsg}
                </span>
                {taskStats && (
                  <span className="font-mono text-zinc-300">
                    {processedCount.toLocaleString()} / {taskStats.total.toLocaleString()} ({pct}%)
                  </span>
                )}
              </div>
              {taskStats && (
                <div className="w-full h-1.5 rounded-full bg-[#121317] overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${Math.max(4, pct)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-rose-950/30 border border-rose-500/40 px-3 py-2 text-[11px] text-rose-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2b2e3a]">
            {isRunning && activeTaskId ? (
              <button
                type="button"
                onClick={handleCancelTask}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-medium cursor-pointer"
              >
                <Square className="h-3 w-3" />
                <span>Cancel Task</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={onClose}
                  className="px-3 py-1.5 rounded bg-[#242733] hover:bg-[#2d3140] text-zinc-300 cursor-pointer disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRunning}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium cursor-pointer"
                >
                  {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  <span>{mode === 'clone' ? 'Clone Index' : 'Start Reindex'}</span>
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

