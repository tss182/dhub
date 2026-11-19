import React from 'react';
import { Download, Upload, RefreshCw, Search, Table, X } from 'lucide-react';
import { ConnectionConfig, resolveConnectionEnv } from '../../types/domain';
import { useSettingsStore } from '../../stores/useSettingsStore';

export interface BackupRestoreModalState {
  isOpen: boolean;
  mode: 'backup' | 'restore';
  connection: ConnectionConfig | null;
  database: string;
  filePath: string;
  isProcessing: boolean;
  dumpMode: 'full' | 'schema_only' | 'data_only';
  includeRoutines: boolean;
  includeTriggers: boolean;
  includeEvents: boolean;
  singleTransaction: boolean;
  tableSelection: 'all' | 'include' | 'exclude';
  selectedTables: string[];
  availableTables: string[];
  tableSearch: string;
  isLoadingTables: boolean;
  toolPath: string;
  backupProgress: {
    percent: number;
    currentTable?: string;
    tablesDone: number;
    totalTables: number;
    bytesWritten: number;
    totalBytes?: number;
    message?: string;
  } | null;
}

export interface BackupRestoreModalProps {
  state: BackupRestoreModalState;
  setState: React.Dispatch<React.SetStateAction<BackupRestoreModalState>>;
  getBackupCliTool: (drv?: string) => string;
  getRestoreCliTool: (drv?: string, filePath?: string) => string;
  onSubmit: (e: React.FormEvent) => void;
  onBrowseBackupFile: () => void;
  onBrowseRestoreFile: () => void;
  onBrowseBackupToolPath: () => void;
}

export const BackupRestoreModal: React.FC<BackupRestoreModalProps> = ({
  state: backupRestoreModal,
  setState: setBackupRestoreModal,
  getBackupCliTool,
  getRestoreCliTool,
  onSubmit: handleConfirmBackupRestore,
  onBrowseBackupFile: handleBrowseBackupFile,
  onBrowseRestoreFile: handleBrowseRestoreFile,
  onBrowseBackupToolPath: handleBrowseBackupToolPath,
}) => {
  if (!backupRestoreModal.isOpen) return null;

  const brEnv = resolveConnectionEnv(backupRestoreModal.connection);
  const isBackup = backupRestoreModal.mode === 'backup';
  const drv = backupRestoreModal.connection?.driver || 'mysql';
  const cliTool = isBackup
    ? drv === 'postgres'
      ? 'pg_dump'
      : drv === 'sqlite'
      ? 'sqlite3 .dump'
      : drv === 'mariadb'
      ? 'mariadb-dump'
      : 'mysqldump'
    : drv === 'postgres'
    ? 'psql'
    : drv === 'sqlite'
    ? 'sqlite3'
    : drv === 'mariadb'
    ? 'mariadb'
    : 'mysql';

  const filteredTables = backupRestoreModal.availableTables.filter((tbl) =>
    tbl.toLowerCase().includes(backupRestoreModal.tableSearch.toLowerCase().trim())
  );

  const toggleTable = (tbl: string) => {
    setBackupRestoreModal((prev) => {
      const has = prev.selectedTables.includes(tbl);
      return {
        ...prev,
        selectedTables: has
          ? prev.selectedTables.filter((t) => t !== tbl)
          : [...prev.selectedTables, tbl],
      };
    });
  };

  const selectAllTables = () => {
    setBackupRestoreModal((prev) => ({
      ...prev,
      selectedTables: Array.from(new Set([...prev.selectedTables, ...filteredTables])),
    }));
  };

  const deselectAllTables = () => {
    setBackupRestoreModal((prev) => {
      const fSet = new Set(filteredTables);
      return {
        ...prev,
        selectedTables: prev.selectedTables.filter((t) => !fSet.has(t)),
      };
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => {
        if (!backupRestoreModal.isProcessing) {
          setBackupRestoreModal((prev) => ({ ...prev, isOpen: false }));
        }
      }}
    >
      <div
        className={`w-full ${
          isBackup ? 'max-w-2xl' : 'max-w-lg'
        } max-h-[90vh] rounded-2xl border bg-[#14151a] shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col overflow-hidden text-zinc-200 ${
          brEnv === 'dev'
            ? 'border-emerald-700/60'
            : brEnv === 'prod'
            ? 'border-rose-700/60'
            : 'border-[#2b2e3a]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          className={`flex items-start justify-between gap-3 px-6 py-4 border-b ${
            brEnv === 'dev'
              ? 'bg-emerald-950/60 border-emerald-800/60'
              : brEnv === 'prod'
              ? 'bg-rose-950/60 border-rose-800/60'
              : 'bg-[#16171f] border-[#272932]'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                isBackup
                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-400'
                  : 'bg-amber-500/15 border-amber-500/35 text-amber-400'
              }`}
            >
              {isBackup ? (
                <Download className="h-5 w-5" />
              ) : (
                <Upload className="h-5 w-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-zinc-100">
                  {isBackup ? 'Backup Database' : 'Restore Database'}
                </h3>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#22242c] border border-[#323544] text-zinc-300">
                  {cliTool}
                </span>
                {brEnv !== 'local' && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase font-mono border ${
                      brEnv === 'dev'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    }`}
                  >
                    {brEnv === 'dev' ? 'DEV' : 'PROD'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                Database: <span className="text-zinc-200 font-semibold">{backupRestoreModal.database}</span> •{' '}
                {backupRestoreModal.connection?.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={backupRestoreModal.isProcessing}
            onClick={() =>
              setBackupRestoreModal((prev) => ({ ...prev, isOpen: false }))
            }
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleConfirmBackupRestore} className="p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
              {isBackup ? 'Backup File Location (.sql)' : 'SQL File to Restore (.sql)'}{' '}
              <span className="text-rose-400">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                required
                disabled={backupRestoreModal.isProcessing}
                placeholder={
                  isBackup
                    ? '/path/to/backup.sql'
                    : 'Select a .sql file to restore...'
                }
                value={backupRestoreModal.filePath}
                onChange={(e) =>
                  setBackupRestoreModal((prev) => ({
                    ...prev,
                    filePath: e.target.value,
                  }))
                }
                className="flex-1 rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none transition-colors"
              />
              <button
                type="button"
                disabled={backupRestoreModal.isProcessing}
                onClick={
                  isBackup ? handleBrowseBackupFile : handleBrowseRestoreFile
                }
                className="px-3 py-2 rounded-lg bg-[#22242c] hover:bg-[#2c303c] border border-[#363948] text-xs font-medium text-zinc-200 hover:text-white transition-colors cursor-pointer shrink-0"
              >
                {isBackup ? 'Browse...' : 'Choose File...'}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 mt-1.5">
              {isBackup
                ? `Exports database "${backupRestoreModal.database}" using ${cliTool}.`
                : `Executes the .sql file into database "${backupRestoreModal.database}" using ${cliTool}.`}
            </p>
          </div>

          {drv !== 'clickhouse' && drv !== 'oracle' && (isBackup || drv !== 'sqlite') && (() => {
            const activeTool = isBackup
              ? getBackupCliTool(drv)
              : getRestoreCliTool(drv, backupRestoreModal.filePath);
            if (!activeTool) return null;
            return (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    Path to {activeTool}
                  </label>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    Optional (auto-detect in PATH)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    disabled={backupRestoreModal.isProcessing}
                    placeholder={`Auto-detect (${activeTool} in PATH)`}
                    value={backupRestoreModal.toolPath}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBackupRestoreModal((prev) => ({
                        ...prev,
                        toolPath: val,
                      }));
                    }}
                    className="flex-1 rounded-lg bg-[#101115] border border-[#2b2e3a] px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none transition-colors"
                  />
                  {backupRestoreModal.toolPath && (
                    <button
                      type="button"
                      disabled={backupRestoreModal.isProcessing}
                      title="Reset to auto-detect"
                      onClick={() => {
                        setBackupRestoreModal((prev) => ({ ...prev, toolPath: '' }));
                        useSettingsStore.getState().setBackupToolPath(activeTool, '');
                      }}
                      className="p-2 rounded-lg bg-[#22242c] hover:bg-[#2c303c] border border-[#363948] text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer shrink-0 disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={backupRestoreModal.isProcessing}
                    onClick={handleBrowseBackupToolPath}
                    className="px-3 py-2 rounded-lg bg-[#22242c] hover:bg-[#2c303c] border border-[#363948] text-xs font-medium text-zinc-200 hover:text-white transition-colors cursor-pointer shrink-0 disabled:opacity-40"
                  >
                    Browse...
                  </button>
                </div>
              </div>
            );
          })()}

          {isBackup && (
            <>
              {/* Dump Content Mode */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Backup Content
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'full', label: 'Full', desc: 'Schema + Data' },
                    { id: 'schema_only', label: 'Schema Only', desc: 'Structure (DDL) only' },
                    { id: 'data_only', label: 'Data Only', desc: 'Data (INSERTs) only' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      disabled={backupRestoreModal.isProcessing}
                      onClick={() =>
                        setBackupRestoreModal((prev) => ({
                          ...prev,
                          dumpMode: item.id as any,
                        }))
                      }
                      className={`px-3 py-2.5 rounded-xl border text-left cursor-pointer transition-colors ${
                        backupRestoreModal.dumpMode === item.id
                          ? 'bg-blue-600/20 border-blue-500 text-blue-200 shadow-xs'
                          : 'bg-[#181920] border-[#2b2e3a] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                      }`}
                    >
                      <div className="text-xs font-semibold">{item.label}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Stored Programs & Options */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Stored Programs & Options
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs text-zinc-300 bg-[#101115] p-3 rounded-xl border border-[#2b2e3a]">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={backupRestoreModal.includeTriggers}
                      disabled={backupRestoreModal.isProcessing}
                      onChange={(e) =>
                        setBackupRestoreModal((prev) => ({
                          ...prev,
                          includeTriggers: e.target.checked,
                        }))
                      }
                      className="rounded border-[#3a3d4d] bg-[#1a1b22] text-blue-500 focus:ring-0"
                    />
                    <span>Include Triggers</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={backupRestoreModal.includeRoutines}
                      disabled={backupRestoreModal.isProcessing}
                      onChange={(e) =>
                        setBackupRestoreModal((prev) => ({
                          ...prev,
                          includeRoutines: e.target.checked,
                        }))
                      }
                      className="rounded border-[#3a3d4d] bg-[#1a1b22] text-blue-500 focus:ring-0"
                    />
                    <span>Include Routines (Procedures/Functions)</span>
                  </label>
                  {(drv === 'mysql' || drv === 'mariadb') && (
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={backupRestoreModal.includeEvents}
                        disabled={backupRestoreModal.isProcessing}
                        onChange={(e) =>
                          setBackupRestoreModal((prev) => ({
                            ...prev,
                            includeEvents: e.target.checked,
                          }))
                        }
                        className="rounded border-[#3a3d4d] bg-[#1a1b22] text-blue-500 focus:ring-0"
                      />
                      <span>Include Events</span>
                    </label>
                  )}
                  {(drv === 'mysql' || drv === 'mariadb') && (
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={backupRestoreModal.singleTransaction}
                        disabled={backupRestoreModal.isProcessing}
                        onChange={(e) =>
                          setBackupRestoreModal((prev) => ({
                            ...prev,
                            singleTransaction: e.target.checked,
                          }))
                        }
                        className="rounded border-[#3a3d4d] bg-[#1a1b22] text-blue-500 focus:ring-0"
                      />
                      <span>Single Transaction</span>
                    </label>
                  )}
                </div>
              </div>

              {/* Table Selection */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    Tables Selection
                  </label>
                  {backupRestoreModal.tableSelection !== 'all' && (
                    <span className="text-[11px] text-zinc-400 font-mono">
                      {backupRestoreModal.selectedTables.length} of{' '}
                      {backupRestoreModal.availableTables.length} tables selected
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {[
                    { id: 'all', label: 'All Tables', desc: 'Dump entire database' },
                    { id: 'include', label: 'Include Selected', desc: 'Only dump chosen tables' },
                    { id: 'exclude', label: 'Exclude / Skip', desc: 'Skip chosen tables' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      disabled={backupRestoreModal.isProcessing}
                      onClick={() =>
                        setBackupRestoreModal((prev) => ({
                          ...prev,
                          tableSelection: item.id as any,
                        }))
                      }
                      className={`px-3 py-2 rounded-xl border text-left cursor-pointer transition-colors ${
                        backupRestoreModal.tableSelection === item.id
                          ? 'bg-blue-600/20 border-blue-500 text-blue-200 shadow-xs'
                          : 'bg-[#181920] border-[#2b2e3a] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                      }`}
                    >
                      <div className="text-xs font-semibold">{item.label}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{item.desc}</div>
                    </button>
                  ))}
                </div>

                {backupRestoreModal.tableSelection !== 'all' && (
                  <div className="rounded-xl border border-[#2b2e3a] bg-[#101115] p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                        <input
                          type="text"
                          placeholder="Filter tables..."
                          value={backupRestoreModal.tableSearch}
                          onChange={(e) =>
                            setBackupRestoreModal((prev) => ({
                              ...prev,
                              tableSearch: e.target.value,
                            }))
                          }
                          className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#181920] border border-[#2d303f] text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={selectAllTables}
                        className="px-2.5 py-1.5 rounded-lg bg-[#1f212a] hover:bg-[#2a2d3b] border border-[#323646] text-[11px] text-zinc-300 transition-colors cursor-pointer"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={deselectAllTables}
                        className="px-2.5 py-1.5 rounded-lg bg-[#1f212a] hover:bg-[#2a2d3b] border border-[#323646] text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>

                    <div className="max-h-44 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                      {backupRestoreModal.isLoadingTables ? (
                        <div className="py-4 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          Loading tables...
                        </div>
                      ) : filteredTables.length === 0 ? (
                        <div className="py-4 text-center text-xs text-zinc-500">
                          {backupRestoreModal.availableTables.length === 0
                            ? 'No tables found in this database.'
                            : 'No matching tables found.'}
                        </div>
                      ) : (
                        filteredTables.map((tbl) => {
                          const isSelected = backupRestoreModal.selectedTables.includes(tbl);
                          return (
                            <div
                              key={tbl}
                              onClick={() => toggleTable(tbl)}
                              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors text-xs select-none ${
                                isSelected
                                  ? 'bg-blue-600/15 text-blue-200'
                                  : 'hover:bg-white/5 text-zinc-300'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {}}
                                className="rounded border-[#3a3d4d] bg-[#1a1b22] text-blue-500 focus:ring-0"
                              />
                              <Table className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                              <span className="font-mono truncate">{tbl}</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {!isBackup && brEnv === 'prod' && (
            <div className="rounded-lg bg-rose-950/40 border border-rose-800/60 px-3 py-2 text-[11px] text-rose-200">
              Warning: You are performing a <strong>Restore</strong> on a{' '}
              <strong>PRODUCTION</strong> connection. Please make sure the selected SQL file is correct.
            </div>
          )}

          {backupRestoreModal.isProcessing && (() => {
            const prog = backupRestoreModal.backupProgress;
            const pct = Math.min(100, Math.max(0, Math.round(prog?.percent ?? 0)));
            const formatBytes = (b: number) =>
              b >= 1024 * 1024
                ? `${(b / (1024 * 1024)).toFixed(1)} MB`
                : b > 0
                ? `${Math.max(1, Math.round(b / 1024))} KB`
                : '';
            const bytes = prog?.bytesWritten ?? 0;
            const totalBytes = prog?.totalBytes ?? 0;
            const sizeLabel =
              bytes > 0 && totalBytes > 0
                ? `${formatBytes(bytes)} / ${formatBytes(totalBytes)}`
                : formatBytes(bytes);
            return (
              <div
                className={`rounded-xl bg-[#101115] border p-3.5 space-y-2 ${
                  isBackup ? 'border-emerald-500/30' : 'border-amber-500/30'
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-200 font-medium truncate pr-2">
                    {prog?.message || (isBackup ? 'Backing up database...' : 'Restoring database...')}
                  </span>
                  <div className="flex items-center gap-2 shrink-0 font-mono">
                    {sizeLabel && (
                      <span className="text-[11px] text-zinc-400">{sizeLabel}</span>
                    )}
                    <span
                      className={`font-bold tabular-nums ${
                        isBackup ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {pct}%
                    </span>
                  </div>
                </div>
                <div className="h-2 w-full rounded-full bg-[#1d1f28] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-150 ${
                      isBackup ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })()}

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530] shrink-0">
            <button
              type="button"
              disabled={backupRestoreModal.isProcessing}
              onClick={() =>
                setBackupRestoreModal((prev) => ({ ...prev, isOpen: false }))
              }
              className="px-3.5 py-1.5 rounded-lg bg-[#20222a] hover:bg-[#2b2d38] border border-[#2d303f] text-zinc-300 text-xs font-medium cursor-pointer transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                backupRestoreModal.isProcessing ||
                !backupRestoreModal.filePath.trim()
              }
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm disabled:opacity-50 ${
                isBackup
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-amber-600 hover:bg-amber-500'
              }`}
            >
              {backupRestoreModal.isProcessing ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>
                    {isBackup
                      ? `Backing up (${Math.round(backupRestoreModal.backupProgress?.percent ?? 0)}%)...`
                      : `Restoring (${Math.round(backupRestoreModal.backupProgress?.percent ?? 0)}%)...`}
                  </span>
                </>
              ) : (
                <>
                  {isBackup ? (
                    <Download className="h-3.5 w-3.5" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  <span>{isBackup ? 'Start Backup' : 'Restore Database'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
