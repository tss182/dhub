import React, { useEffect, useState, useRef } from 'react';
import { APP_DEFAULTS } from '../../config/defaults';
import {
  X,
  Settings as SettingsIcon,
  Table,
  FileCode,
  Info,
  Layers,
  ArrowDownCircle,
  Check,
  RotateCcw,
  Sparkles,
  Hash,
  Palette,
  Moon,
  Sun,
  RefreshCw,
  ArrowDownUp,
  Download,
  Upload,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  FolderArchive,
  Database,
  KeyRound,
  ShieldAlert,
  Loader2,
  BookOpen,
  ExternalLink,
  FileCode2,
  ShieldCheck,
  AlertCircle,
  Clock,
  Bot,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useSettingsStore, type AiProvider } from '../../stores/useSettingsStore';
import { AI_PROVIDER_DEFAULTS, sendAiChatMessage } from '../../utils/aiClient';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useUpdateStore } from '../../stores/useUpdateStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { alertSuccess, alertError, alertWarning } from '../../stores/useAlertStore';
import { COPY_FORMAT_LABELS, COPY_FORMAT_OPTIONS } from '../grid/CopyFormatSelector';
import { DHubLogo } from '../common/DHubLogo';
import { APP_VERSION } from '../../version';
import { Dialogs } from '@wailsio/runtime';
import { WorkspaceService } from '../../../bindings/dhub/internal/services';
import type { ConfigImportSummary } from '../../../bindings/dhub/internal/services/models';

export const SettingsModal: React.FC = () => {
  const {
    isSettingsOpen,
    activeSettingsTab,
    theme,
    defaultPageSize,
    editorFontSize,
    wordWrap,
    showMinimap,
    showAiChat,
    aiProvider,
    aiApiKey,
    aiBaseUrl,
    aiModel,
    copyFormat,
    checkUpdatesOnStartup,
    checkUpdatesPeriodically,
    setCopyFormat,
    closeSettings,
    setActiveSettingsTab,
    setTheme,
    setDefaultPageSize,
    setEditorFontSize,
    setWordWrap,
    setShowMinimap,
    setShowAiChat,
    setAiProvider,
    setAiApiKey,
    setAiBaseUrl,
    setAiModel,
    setCheckUpdatesOnStartup,
    setCheckUpdatesPeriodically,
    resetToDefaults,
    reloadSettings,
  } = useSettingsStore();

  const connections = useConnectionStore((s) => s.connections);
  const folders = useConnectionStore((s) => s.folders);

  const {
    isChecking: isCheckingUpdate,
    updateInfo,
    lastCheckedAt,
    error: updateError,
    isDownloading,
    isReadyToInstall,
    isInstalling,
    downloadProgress,
    checkUpdate,
    openUpdateModal,
    startInAppUpdate,
    applyUpdate,
    downloadUpdate,
    openReleasePage,
  } = useUpdateStore();

  const [customSizeInput, setCustomSizeInput] = useState<string>(String(defaultPageSize));
  const [showAiKey, setShowAiKey] = useState<boolean>(false);
  const [isTestingAi, setIsTestingAi] = useState<boolean>(false);
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Export State
  const [exportSettings, setExportSettings] = useState<boolean>(true);
  const [exportConnections, setExportConnections] = useState<boolean>(true);
  const [exportPasswords, setExportPasswords] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Import State
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    content: string;
    path?: string;
  } | null>(null);
  const [summary, setSummary] = useState<ConfigImportSummary | null>(null);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [importSettingsOption, setImportSettingsOption] = useState<boolean>(true);
  const [importConnectionsOption, setImportConnectionsOption] = useState<boolean>(true);
  const [conflictStrategy, setConflictStrategy] = useState<'skip' | 'overwrite' | 'duplicate'>('overwrite');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<{
    settings: number;
    connections: number;
    folders: number;
    errors: string[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasAutoCheckedThisOpenRef = useRef<boolean>(false);

  // Sync custom input with active defaultPageSize
  useEffect(() => {
    setCustomSizeInput(String(defaultPageSize));
  }, [defaultPageSize]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSettingsOpen) {
        closeSettings();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen, closeSettings]);

  // Populate update status once when Settings opens if not checked yet
  useEffect(() => {
    if (!isSettingsOpen) {
      hasAutoCheckedThisOpenRef.current = false;
      return;
    }
    if (!hasAutoCheckedThisOpenRef.current && !updateInfo && !isCheckingUpdate) {
      hasAutoCheckedThisOpenRef.current = true;
      checkUpdate(true, false);
    }
  }, [isSettingsOpen, updateInfo, isCheckingUpdate, checkUpdate]);

  if (!isSettingsOpen) return null;

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const formatPublishedDate = (iso: string): string => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  const handleApplyCustomSize = () => {
    const parsed = parseInt(customSizeInput, 10);
    if (!isNaN(parsed) && parsed >= 10 && parsed <= 5000) {
      setDefaultPageSize(parsed);
    } else {
      setCustomSizeInput(String(defaultPageSize));
    }
  };

  const presetSizes = APP_DEFAULTS.pageSizeOptions;

  const handleBrowseSaveConfig = async () => {
    if (!exportSettings && !exportConnections) {
      alertWarning('Please select at least Settings or Connections to export.');
      return;
    }
    setIsExporting(true);
    try {
      const jsonStr = await WorkspaceService.ExportConfig(exportConnections, exportPasswords);
      if (!jsonStr) {
        throw new Error('Export generated empty content.');
      }
      const dateStr = new Date().toISOString().split('T')[0];
      const defaultFilename = `dhub-config-${dateStr}.json`;

      let savedPath: string | null = null;
      try {
        const chosen = await Dialogs.SaveFile({
          Title: 'Save DHub Configuration',
          Filename: defaultFilename,
          CanCreateDirectories: true,
          Filters: [
            { DisplayName: 'JSON Files (*.json)', Pattern: '*.json' },
            { DisplayName: 'All Files (*.*)', Pattern: '*.*' },
          ],
        });
        if (chosen && typeof chosen === 'string' && chosen.trim()) {
          savedPath = chosen.trim();
          await WorkspaceService.SaveConfigFile(savedPath, jsonStr);
        }
      } catch (e) {
        console.warn('Dialogs.SaveFile error or cancelled:', e);
      }

      if (!savedPath) {
        // Fallback to browser blob download
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      alertSuccess(
        savedPath
          ? `Config exported successfully to ${savedPath}`
          : `Config exported successfully as ${defaultFilename}`
      );
    } catch (err: any) {
      console.error('Export config failed:', err);
      alertError(err?.message || 'Failed to export configuration');
    } finally {
      setIsExporting(false);
    }
  };

  const processSelectedFile = async (fileName: string, content: string, path?: string) => {
    setIsValidating(true);
    setValidationError(null);
    setImportResult(null);
    try {
      const res = await WorkspaceService.ValidateConfigFile(content);
      if (!res) {
        throw new Error('Could not validate configuration file.');
      }
      setSelectedFile({ name: fileName, content, path });
      setSummary(res);
      setImportSettingsOption(res.settingsCount > 0);
      setImportConnectionsOption(res.connectionsCount > 0);
    } catch (err: any) {
      setSelectedFile(null);
      setSummary(null);
      setValidationError(err?.message || 'Invalid configuration file format');
      alertError('Invalid config file: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsValidating(false);
    }
  };

  const handleBrowseImportFile = async () => {
    try {
      const chosen: any = await Dialogs.OpenFile({
        Title: 'Select DHub Configuration File',
        CanChooseFiles: true,
        AllowsMultipleSelection: false,
        Filters: [
          { DisplayName: 'JSON Files (*.json)', Pattern: '*.json' },
          { DisplayName: 'All Files (*.*)', Pattern: '*.*' },
        ],
      });
      const picked = Array.isArray(chosen) ? chosen[0] : chosen;
      if (picked && typeof picked === 'string' && picked.trim()) {
        const filePath = picked.trim();
        const content = await WorkspaceService.ReadConfigFile(filePath);
        const fileName = filePath.split(/[\\/]/).pop() || 'config.json';
        await processSelectedFile(fileName, content, filePath);
        return;
      }
    } catch (dialogErr) {
      console.warn('Native OpenFile error or cancelled:', dialogErr);
    }
    // Fallback to hidden file input
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await processSelectedFile(file.name, text);
    } catch (err: any) {
      alertError('Failed to read file: ' + err.message);
    } finally {
      e.target.value = '';
    }
  };

  const handleExecuteImport = async () => {
    if (!selectedFile) return;
    if (!importSettingsOption && !importConnectionsOption) {
      alertWarning('Please select at least Settings or Connections to import.');
      return;
    }
    setIsImporting(true);
    try {
      const res = await WorkspaceService.ImportConfig(selectedFile.content, {
        importSettings: importSettingsOption,
        importConnections: importConnectionsOption,
        conflictStrategy,
      });

      if (!res || !res.success) {
        throw new Error(res?.errors?.join(', ') || 'Failed to import configuration.');
      }

      setImportResult({
        settings: res.settingsImported,
        connections: res.connectionsImported,
        folders: res.foldersImported,
        errors: res.errors || [],
      });

      if (importSettingsOption) {
        await reloadSettings();
      }
      if (importConnectionsOption) {
        await useConnectionStore.getState().loadConnectionsAndFolders();
      }

      alertSuccess(
        `Import completed! (${res.settingsImported} settings, ${res.connectionsImported} connections, ${res.foldersImported} folders)`
      );
    } catch (err: any) {
      console.error('Import config failed:', err);
      alertError('Failed to import configuration: ' + (err?.message || String(err)));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs select-none p-4 animate-in fade-in duration-150"
      onClick={closeSettings}
    >
      <div
        className="w-[90vw] max-w-[90vw] h-[80vh] max-h-[80vh] rounded-xl bg-[#181920] border border-[#2b2e3a] shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex h-13 items-center justify-between border-b border-[#272932] px-5 bg-[#14151a]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400">
              <SettingsIcon className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                Settings & Preferences
              </h2>
              <p className="text-[11px] text-zinc-400">
                Configure theme appearance, data grid display, SQL editor, and preferences
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="hidden sm:inline-block rounded bg-[#22242c] px-1.5 py-0.5 text-[10px] text-zinc-400 font-mono border border-[#2d303d]">
              ESC
            </kbd>
            <button
              onClick={closeSettings}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[#252834] transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Body: Tabs Sidebar + Content */}
        <div className="flex flex-1 min-h-0">
          {/* Settings Left Navigation */}
          <div className="w-48 border-r border-[#272932] bg-[#14151a]/60 p-2.5 flex flex-col gap-1 shrink-0">
            <button
              onClick={() => setActiveSettingsTab('appearance')}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                activeSettingsTab === 'appearance'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#20222b]'
              }`}
            >
              <Palette className="h-4 w-4" />
              <span>Appearance</span>
            </button>

            <button
              onClick={() => setActiveSettingsTab('datagrid')}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                activeSettingsTab === 'datagrid'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#20222b]'
              }`}
            >
              <Table className="h-4 w-4" />
              <span>Data Grid & Query</span>
            </button>

            <button
              onClick={() => setActiveSettingsTab('editor')}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                activeSettingsTab === 'editor'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#20222b]'
              }`}
            >
              <FileCode className="h-4 w-4" />
              <span>SQL Worksheet</span>
            </button>

            <button
              onClick={() => setActiveSettingsTab('ai')}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                activeSettingsTab === 'ai'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#20222b]'
              }`}
            >
              <Bot className="h-4 w-4" />
              <span>AI Assistant</span>
            </button>

            <button
              onClick={() => setActiveSettingsTab('backup')}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                activeSettingsTab === 'backup'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#20222b]'
              }`}
            >
              <ArrowDownUp className="h-4 w-4" />
              <span>Import & Export</span>
            </button>

            <button
              onClick={() => setActiveSettingsTab('version')}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                activeSettingsTab === 'version'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#20222b]'
              }`}
              title={
                updateInfo?.hasUpdate
                  ? `New version ${updateInfo.latestVersion} available!`
                  : undefined
              }
            >
              <span className="flex items-center gap-2.5">
                <Info className="h-4 w-4 shrink-0" />
                <span>Version</span>
              </span>
              {updateInfo?.hasUpdate && (
                <span
                  className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold border ${
                    activeSettingsTab === 'version'
                      ? 'bg-white/20 border-white/35 text-white'
                      : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full animate-pulse ${
                      activeSettingsTab === 'version' ? 'bg-emerald-300' : 'bg-emerald-400'
                    }`}
                  />
                  <span>New</span>
                </span>
              )}
            </button>
          </div>

          {/* Settings Main Panel */}
          <div className="flex-1 p-5 overflow-y-auto min-h-0 text-xs">
            {activeSettingsTab !== 'version' && updateInfo?.hasUpdate && (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-950/30 border border-emerald-700/40 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-emerald-200 truncate">
                      Update Available: {updateInfo.latestVersion}
                    </p>
                    <p className="text-[10px] text-zinc-400 truncate">
                      Current version v{APP_VERSION.replace(/^v/i, '')} • New release is ready to download and install
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveSettingsTab('version')}
                    className="px-2.5 py-1 rounded-md border border-emerald-600/40 bg-[#1a2220] hover:bg-[#212d2a] text-emerald-200 text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    View Details
                  </button>
                  <button
                    type="button"
                    onClick={openUpdateModal}
                    className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                  >
                    Update Now
                  </button>
                </div>
              </div>
            )}

            {/* Appearance Tab */}
            {activeSettingsTab === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                      Theme Mode
                    </label>
                  </div>
                  <p className="text-[11px] text-zinc-400 mb-3">
                    Choose between dark mode and light mode interface styles.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Option: Dark Mode */}
                    <div
                      onClick={() => setTheme('dark')}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                        theme === 'dark'
                          ? 'bg-blue-600/10 border-blue-500 text-white shadow-sm ring-1 ring-blue-500/50'
                          : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div
                              className={`p-1.5 rounded-lg ${
                                theme === 'dark'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-[#282a35] text-zinc-400'
                              }`}
                            >
                              <Moon className="h-4 w-4" />
                            </div>
                            <span className="font-semibold text-xs text-zinc-100">Dark Mode</span>
                          </div>
                          {theme === 'dark' && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                              <Check className="h-3 w-3 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] leading-relaxed text-zinc-400">
                          Obsidian dark interface optimized for low-light environments and reduced eye strain.
                        </p>
                      </div>
                      <div className="mt-3 pt-2.5 border-t border-[#2d303e] text-[10px] font-mono text-zinc-400">
                        Default • VS Dark Editor
                      </div>
                    </div>

                    {/* Option: Light Mode */}
                    <div
                      onClick={() => setTheme('light')}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                        theme === 'light'
                          ? 'bg-blue-600/10 border-blue-500 text-white shadow-sm ring-1 ring-blue-500/50'
                          : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div
                              className={`p-1.5 rounded-lg ${
                                theme === 'light'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-[#282a35] text-zinc-400'
                              }`}
                            >
                              <Sun className="h-4 w-4" />
                            </div>
                            <span className="font-semibold text-xs text-zinc-100">Light Mode</span>
                          </div>
                          {theme === 'light' && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                              <Check className="h-3 w-3 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] leading-relaxed text-zinc-400">
                          Crisp, clean high-contrast light interface designed for bright workspaces.
                        </p>
                      </div>
                      <div className="mt-3 pt-2.5 border-t border-[#2d303e] text-[10px] font-mono text-zinc-400">
                        Daylight • Clean High-Contrast
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-blue-950/20 border border-blue-900/30 p-3 text-[11px] text-blue-300/90 leading-relaxed flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                  <span>
                    Your theme preference is saved automatically and persists across sessions.
                  </span>
                </div>
              </div>
            )}

            {/* Data Grid Tab */}
            {activeSettingsTab === 'datagrid' && (
              <div className="space-y-6">

                <div className="h-[1px] bg-[#272932]" />

                {/* 2. Default Page Size / Batch Limit */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                      Default Batch / Page Size
                    </label>
                    <span className="font-mono text-blue-400 font-semibold bg-blue-950/40 border border-blue-800/40 px-2 py-0.5 rounded text-[11px]">
                      {defaultPageSize} rows / batch
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mb-3">
                    Define the default number of rows fetched per query batch or page (e.g., 50 or 100 rows).
                  </p>

                  {/* Preset Pills */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    {presetSizes.map((size) => {
                      const isSelected = size === defaultPageSize;
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() => setDefaultPageSize(size)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-blue-600 border-blue-500 text-white shadow-xs'
                              : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-300 hover:border-zinc-500 hover:text-white'
                          }`}
                        >
                          {size} rows
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom Number Input */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[11px] text-zinc-400">Custom size:</span>
                    <div className="relative flex items-center">
                      <Hash className="h-3 w-3 text-zinc-500 absolute left-2 pointer-events-none" />
                      <input
                        type="number"
                        min="10"
                        max="5000"
                        step="10"
                        value={customSizeInput}
                        onChange={(e) => setCustomSizeInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleApplyCustomSize();
                        }}
                        className="h-7 w-24 rounded-md bg-[#121317] border border-[#2b2e3a] pl-6 pr-2 text-xs font-mono text-zinc-100 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleApplyCustomSize}
                      className="h-7 px-2.5 rounded-md bg-[#252834] hover:bg-[#303342] border border-[#3b3e4f] text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
                    >
                      Set Size
                    </button>
                  </div>
                </div>

                <div className="h-[1px] bg-[#272932]" />

                {/* 3. Default Copy Format */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                      Default Copy Format
                    </label>
                    <span className="font-mono text-sky-400 font-semibold bg-sky-950/40 border border-sky-800/40 px-2 py-0.5 rounded text-[11px]">
                      {COPY_FORMAT_LABELS[copyFormat]}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mb-3">
                    Format used when copying cells or selected rows from the data grid (Ctrl+C / Cmd+C).
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {COPY_FORMAT_OPTIONS.map((opt) => {
                      const isSelected = opt.id === copyFormat;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setCopyFormat(opt.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-blue-600 border-blue-500 text-white shadow-xs'
                              : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-300 hover:border-zinc-500 hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-lg bg-blue-950/20 border border-blue-900/30 p-3 text-[11px] text-blue-300/90 leading-relaxed flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                  <span>
                    These settings apply automatically to new tabs and subsequent queries.
                  </span>
                </div>
              </div>
            )}

            {/* SQL Worksheet Tab */}
            {activeSettingsTab === 'editor' && (
              <div className="space-y-6">
                <div>
                  <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider block mb-1.5">
                    Editor Font Size
                  </label>
                  <p className="text-[11px] text-zinc-400 mb-3">
                    Font size for the Monaco SQL Worksheet editor.
                  </p>
                  <div className="flex gap-2">
                    {[12, 13, 14, 16].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setEditorFontSize(size)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-colors cursor-pointer ${
                          editorFontSize === size
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-300 hover:border-zinc-500'
                        }`}
                      >
                        {size}px {size === 13 && '(Default)'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-[1px] bg-[#272932]" />

                <div>
                  <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider block mb-1.5">
                    Word Wrap
                  </label>
                  <p className="text-[11px] text-zinc-400 mb-3">
                    Wrap long code lines automatically to prevent horizontal scrolling in the editor.
                  </p>
                  <button
                    type="button"
                    onClick={() => setWordWrap(!wordWrap)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      wordWrap
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                        : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {wordWrap ? 'Word Wrap: ON' : 'Word Wrap: OFF'}
                  </button>
                </div>

                <div className="h-[1px] bg-[#272932]" />

                <div>
                  <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider block mb-1.5">
                    Editor Minimap
                  </label>
                  <p className="text-[11px] text-zinc-400 mb-3">
                    Show code minimap outline on the right side of the SQL Worksheet editor.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowMinimap(!showMinimap)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      showMinimap
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                        : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {showMinimap ? 'Minimap: ON' : 'Minimap: OFF'}
                  </button>
                </div>
              </div>
            )}

            {/* AI Assistant Tab */}
            {activeSettingsTab === 'ai' && (
              <div className="space-y-6">
                <div>
                  <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider block mb-1.5">
                    AI Chat Bubble
                  </label>
                  <p className="text-[11px] text-zinc-400 mb-3">
                    Show or hide the floating AI chat bubble in the bottom-right corner of the workspace.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowAiChat(!showAiChat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      showAiChat
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                        : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {showAiChat ? 'AI Chat Bubble: ON' : 'AI Chat Bubble: OFF'}
                  </button>
                </div>

                <div className="h-[1px] bg-[#272932]" />

                {/* Provider Selection */}
                <div>
                  <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider block mb-1.5">
                    AI Provider
                  </label>
                  <p className="text-[11px] text-zinc-400 mb-3">
                    Connect to OpenAI, any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter, Groq), or Google Gemini.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(['openai', 'gemini'] as AiProvider[]).map((prov) => {
                      const info = AI_PROVIDER_DEFAULTS[prov];
                      const isSelected = aiProvider === prov;
                      return (
                        <button
                          key={prov}
                          type="button"
                          onClick={() => {
                            setAiProvider(prov);
                            setAiModel(info.defaultModel);
                            setAiTestResult(null);
                          }}
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-blue-600/15 border-blue-500 text-white ring-1 ring-blue-500/40'
                              : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-300 hover:border-zinc-500'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold">{info.label}</span>
                            {isSelected && (
                              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-white">
                                <Check className="h-2.5 w-2.5 stroke-[3]" />
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-zinc-400 font-mono truncate">
                            {info.defaultModel}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Base URL (for OpenAI & OpenAI-compatible endpoints) */}
                {aiProvider !== 'gemini' && (
                  <div>
                    <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider block mb-1.5">
                      Base URL (Optional)
                    </label>
                    <p className="text-[11px] text-zinc-400 mb-2">
                      Leave blank for https://api.openai.com/v1, or enter any OpenAI-compatible endpoint (e.g. http://localhost:11434/v1 for Ollama, http://localhost:1234/v1 for LM Studio, OpenRouter, Groq).
                    </p>
                    <input
                      type="text"
                      value={aiBaseUrl}
                      onChange={(e) => {
                        setAiBaseUrl(e.target.value);
                        setAiTestResult(null);
                      }}
                      placeholder={AI_PROVIDER_DEFAULTS[aiProvider].defaultBaseUrl}
                      className="w-full rounded-lg border border-[#2b2e3a] bg-[#14151a] px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 font-mono focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                )}

                {/* API Key */}
                <div>
                  <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider block mb-1.5">
                    API Key {aiProvider === 'openai' && aiBaseUrl.trim() ? '(Optional for local servers)' : ''}
                  </label>
                  <div className="relative">
                    <input
                      type={showAiKey ? 'text' : 'password'}
                      value={aiApiKey}
                      onChange={(e) => {
                        setAiApiKey(e.target.value);
                        setAiTestResult(null);
                      }}
                      placeholder={
                        aiProvider === 'gemini'
                          ? 'AIza...'
                          : aiBaseUrl.trim()
                          ? 'sk-... (optional for Ollama/LM Studio)'
                          : 'sk-...'
                      }
                      className="w-full rounded-lg border border-[#2b2e3a] bg-[#14151a] pl-3 pr-9 py-2 text-xs text-zinc-100 placeholder-zinc-500 font-mono focus:border-blue-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAiKey((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                      title={showAiKey ? 'Hide API key' : 'Show API key'}
                    >
                      {showAiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Model Name + Presets */}
                <div>
                  <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider block mb-1.5">
                    Model
                  </label>
                  <input
                    type="text"
                    value={aiModel}
                    onChange={(e) => {
                      setAiModel(e.target.value);
                      setAiTestResult(null);
                    }}
                    placeholder={AI_PROVIDER_DEFAULTS[aiProvider].defaultModel}
                    className="w-full rounded-lg border border-[#2b2e3a] bg-[#14151a] px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 font-mono focus:border-blue-500 focus:outline-none mb-2"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {AI_PROVIDER_DEFAULTS[aiProvider].models.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setAiModel(preset);
                          setAiTestResult(null);
                        }}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors cursor-pointer ${
                          aiModel === preset
                            ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                            : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Test Connection */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    disabled={isTestingAi}
                    onClick={async () => {
                      setIsTestingAi(true);
                      setAiTestResult(null);
                      try {
                        const reply = await sendAiChatMessage({
                          provider: aiProvider,
                          apiKey: aiApiKey,
                          baseUrl: aiBaseUrl,
                          model: aiModel,
                          systemPrompt: 'Reply with OK in one word.',
                          messages: [{ role: 'user', content: 'Say OK' }],
                        });
                        setAiTestResult({
                          ok: true,
                          message: `Connected! Model replied: "${reply.slice(0, 80)}"`,
                        });
                      } catch (err: any) {
                        setAiTestResult({
                          ok: false,
                          message: err?.message || 'Connection failed',
                        });
                      } finally {
                        setIsTestingAi(false);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors cursor-pointer"
                  >
                    {isTestingAi ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    <span>{isTestingAi ? 'Testing...' : 'Test Connection'}</span>
                  </button>

                  {aiTestResult && (
                    <span
                      className={`text-[11px] flex items-center gap-1.5 ${
                        aiTestResult.ok ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {aiTestResult.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span>{aiTestResult.message}</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Version Tab */}
            {activeSettingsTab === 'version' && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3.5">
                    <DHubLogo variant="badge" size={44} className="mt-0.5 shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-100">DHub Desktop</h3>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Modern high-performance Database Client &amp; SQL/NoSQL IDE.
                      </p>
                      <div className="mt-2 inline-flex items-center gap-2 rounded bg-[#20222b] px-2.5 py-1 text-[11px] font-mono text-zinc-300 border border-[#2d303e]">
                        <span>Version {APP_VERSION}</span>
                        <span className="text-zinc-500">•</span>
                        <span className="text-emerald-400">Stable</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      closeSettings();
                      useWorkbenchStore.getState().openHelpModal('quickstart');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 border border-blue-500/35 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    <span>Open Help &amp; User Guide (Ctrl+H / ⌘H)</span>
                  </button>
                </div>

                <div className="h-[1px] bg-[#272932]" />

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                      Software Updates &amp; Release Info
                    </label>
                    {lastCheckedAt && (
                      <span className="flex items-center gap-1 text-[10px] text-zinc-400 font-mono">
                        <Clock className="h-3 w-3 text-zinc-500" />
                        <span>Last checked: {lastCheckedAt}</span>
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Check for new DHub releases, inspect changelogs, and install updates directly inside the app.
                  </p>
                </div>

                {/* Version Status Card */}
                <div className="rounded-xl bg-[#14151a] border border-[#272932] p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`p-2 rounded-xl border ${
                          updateInfo?.hasUpdate
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                            : 'bg-blue-600/15 border-blue-500/30 text-blue-400'
                        }`}
                      >
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-semibold text-zinc-100">Update Status</h3>
                          {isCheckingUpdate ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                              Checking...
                            </span>
                          ) : updateInfo?.hasUpdate ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              New Update Available
                            </span>
                          ) : updateInfo ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-700/40 text-emerald-300 border border-emerald-500/25">
                              Up to Date
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#22242e] text-zinc-400 border border-[#2f3240]">
                              Not Checked
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-0.5">
                          GitHub Releases channel (`tss182/dhub`) • User Scope
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isCheckingUpdate || isDownloading || isInstalling}
                      onClick={() => checkUpdate(false)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#20222b] hover:bg-[#282a36] text-zinc-200 border border-[#2f3240] text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isCheckingUpdate ? 'animate-spin text-blue-400' : ''}`} />
                      <span>{isCheckingUpdate ? 'Checking...' : 'Check for Updates'}</span>
                    </button>
                  </div>

                  {/* Current vs Latest Version Comparison */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-[#191b22] border border-[#252834]">
                      <span className="text-[10px] text-zinc-400 uppercase font-medium tracking-wider">
                        Current Version
                      </span>
                      <p className="text-sm font-semibold text-zinc-200 font-mono mt-0.5">
                        v{APP_VERSION.replace(/^v/i, '')}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-[#191b22] border border-[#252834]">
                      <span
                        className={`text-[10px] uppercase font-medium tracking-wider ${
                          updateInfo?.hasUpdate ? 'text-emerald-400' : 'text-zinc-400'
                        }`}
                      >
                        Latest Version
                      </span>
                      <p
                        className={`text-sm font-bold font-mono mt-0.5 flex items-center gap-1.5 ${
                          updateInfo?.hasUpdate ? 'text-emerald-400' : 'text-zinc-200'
                        }`}
                      >
                        <span>
                          {updateInfo?.latestVersion
                            ? updateInfo.latestVersion
                            : `v${APP_VERSION.replace(/^v/i, '')}`}
                        </span>
                        {updateInfo && (
                          <CheckCircle2
                            className={`h-4 w-4 ${updateInfo.hasUpdate ? 'text-emerald-400' : 'text-zinc-500'}`}
                          />
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                {/* New Version Details & In-App Updater */}
                {updateInfo?.hasUpdate && (
                  <div className="rounded-xl bg-emerald-950/15 border border-emerald-800/40 p-4 space-y-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-semibold text-emerald-200 flex items-center gap-1.5">
                          <ShieldCheck className="h-4 w-4 text-emerald-400" />
                          <span>{updateInfo.releaseTitle || `DHub ${updateInfo.latestVersion}`}</span>
                        </h4>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400 mt-1 font-mono">
                          {updateInfo.publishedAt && (
                            <span>Published {formatPublishedDate(updateInfo.publishedAt)}</span>
                          )}
                          {updateInfo.assetFileName && (
                            <>
                              <span>•</span>
                              <span>{updateInfo.assetFileName}</span>
                            </>
                          )}
                          {updateInfo.assetSize > 0 && (
                            <>
                              <span>•</span>
                              <span>{formatFileSize(updateInfo.assetSize)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* In-App Download & Install Progress */}
                    {(isDownloading || isReadyToInstall || isInstalling) && (
                      <div className="p-3 rounded-lg bg-blue-950/25 border border-blue-800/40 space-y-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-blue-200 flex items-center gap-1.5">
                            {isInstalling ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                                <span>Launching installer &amp; restarting...</span>
                              </>
                            ) : isReadyToInstall ? (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                <span>Download complete! Ready to install.</span>
                              </>
                            ) : (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                                <span>Downloading update in app...</span>
                              </>
                            )}
                          </span>
                          <span className="font-mono text-zinc-300 font-semibold">
                            {Math.round(downloadProgress.percent)}%
                          </span>
                        </div>
                        <div className="h-2 w-full bg-[#1b1e28] rounded-full overflow-hidden p-0.5 border border-blue-950">
                          <div
                            className="h-full bg-linear-to-r from-blue-500 to-emerald-400 rounded-full transition-all duration-200"
                            style={{ width: `${Math.max(5, Math.min(100, downloadProgress.percent))}%` }}
                          />
                        </div>
                        {downloadProgress.downloaded > 0 && (
                          <div className="text-[10px] text-zinc-400 font-mono">
                            {formatFileSize(downloadProgress.downloaded)} of{' '}
                            {formatFileSize(downloadProgress.total || updateInfo.assetSize)}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Release Notes */}
                    {updateInfo.releaseNotes && (
                      <div className="space-y-1.5">
                        <span className="flex items-center gap-1.5 text-[11px] text-zinc-300 font-medium">
                          <FileCode2 className="h-3.5 w-3.5 text-zinc-400" />
                          <span>What&apos;s New in {updateInfo.latestVersion}</span>
                        </span>
                        <div className="max-h-40 overflow-y-auto rounded-lg bg-[#121318] border border-[#22242c] p-3 text-[11px] text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed select-text">
                          {updateInfo.releaseNotes}
                        </div>
                      </div>
                    )}

                    {/* Error Notice */}
                    {updateError && (
                      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-950/25 border border-rose-800/40 text-rose-300 text-[11px]">
                        <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <p>{updateError}</p>
                          <button
                            type="button"
                            onClick={downloadUpdate}
                            className="text-blue-400 hover:text-blue-300 text-[10px] underline underline-offset-2 cursor-pointer flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span>Try downloading in browser instead</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={openReleasePage}
                        className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 text-[11px] transition-colors cursor-pointer"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>GitHub Releases</span>
                      </button>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={openUpdateModal}
                          className="px-3 py-1.5 rounded-lg border border-[#313543] bg-[#1c1e26] hover:bg-[#242731] text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
                        >
                          Open Update Dialog
                        </button>

                        {isReadyToInstall ? (
                          <button
                            type="button"
                            onClick={applyUpdate}
                            disabled={isInstalling}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
                          >
                            {isInstalling ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Applying...</span>
                              </>
                            ) : (
                              <>
                                <RefreshCw className="h-3.5 w-3.5" />
                                <span>Install &amp; Restart</span>
                              </>
                            )}
                          </button>
                        ) : isDownloading ? (
                          <button
                            type="button"
                            disabled
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600/60 text-white/80 text-xs font-semibold cursor-not-allowed"
                          >
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Downloading... ({Math.round(downloadProgress.percent)}%)</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={startInAppUpdate}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>Update Now (In-App)</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {updateInfo && !updateInfo.hasUpdate && (
                  <div className="p-3 rounded-xl bg-[#191b22] border border-[#232530] text-zinc-300 text-[11px] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>You are running the latest version of DHub ({updateInfo.latestVersion || `v${APP_VERSION}`}).</span>
                    </div>
                    <button
                      type="button"
                      onClick={openReleasePage}
                      className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-[11px] shrink-0 cursor-pointer"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>Releases</span>
                    </button>
                  </div>
                )}

                {!updateInfo?.hasUpdate && updateError && (
                  <div className="p-3 rounded-xl bg-red-950/20 border border-red-900/30 text-red-400 text-[11px] flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{updateError}</span>
                  </div>
                )}

                <div className="h-[1px] bg-[#272932]" />

                {/* Startup Update Check Preference */}
                <div className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-[#14151a] border border-[#272932]">
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-200">
                      Check for updates automatically on startup
                    </h4>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      When enabled, DHub automatically checks for a newer version when opened and displays an update prompt modal if one is found.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCheckUpdatesOnStartup(!checkUpdatesOnStartup)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer shrink-0 ${
                      checkUpdatesOnStartup
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                        : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {checkUpdatesOnStartup ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                {/* Periodic Update Check Preference */}
                <div className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-[#14151a] border border-[#272932]">
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-200">
                      Check for updates periodically (every 10 minutes)
                    </h4>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      When enabled, DHub checks for a newer version every 10 minutes while the app is open.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCheckUpdatesPeriodically(!checkUpdatesPeriodically)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer shrink-0 ${
                      checkUpdatesPeriodically
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                        : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {checkUpdatesPeriodically ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </div>
            )}

            {/* Import & Export Tab */}
            {activeSettingsTab === 'backup' && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                      Backup & Migration
                    </label>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Export your preferences and database connection profiles to a JSON file, or restore from an existing backup.
                  </p>
                </div>

                {/* Section 1: Export */}
                <div className="rounded-xl border border-[#2b2e3a] bg-[#1a1b22] p-4 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400">
                        <Download className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold text-zinc-100">Export Configuration</h3>
                        <p className="text-[11px] text-zinc-400">
                          Package application settings and connection profiles into a portable JSON backup.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2.5 pt-1">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={exportSettings}
                        onChange={(e) => setExportSettings(e.target.checked)}
                        className="rounded border-[#3a3d4d] bg-[#121317] text-blue-600 focus:ring-blue-500/40"
                      />
                      <span className="text-xs text-zinc-200">
                        Application Settings & Preferences (Theme, Grid view, SQL editor)
                      </span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={exportConnections}
                        onChange={(e) => setExportConnections(e.target.checked)}
                        className="rounded border-[#3a3d4d] bg-[#121317] text-blue-600 focus:ring-blue-500/40"
                      />
                      <span className="text-xs text-zinc-200 flex items-center gap-2">
                        <span>Database Connections & Folders</span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#282a35] text-zinc-400 border border-[#373a4a]">
                          {connections.length} {connections.length === 1 ? 'connection' : 'connections'}, {folders.length} {folders.length === 1 ? 'folder' : 'folders'}
                        </span>
                      </span>
                    </label>

                    {exportConnections && (
                      <div className="ml-6 pt-1">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={exportPasswords}
                            onChange={(e) => setExportPasswords(e.target.checked)}
                            className="rounded border-amber-600/40 bg-[#121317] text-amber-500 focus:ring-amber-500/40 mt-0.5"
                          />
                          <div className="space-y-1">
                            <span className="text-xs text-amber-300 font-medium flex items-center gap-1.5">
                              <KeyRound className="h-3 w-3" />
                              Include passwords & SSH credentials
                            </span>
                            <p className="text-[10px] text-amber-400/80 leading-relaxed">
                              ⚠️ Warning: Credentials will be stored in plain text inside the JSON file. Only enable if backing up to a secure, private location.
                            </p>
                          </div>
                        </label>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleBrowseSaveConfig}
                      disabled={isExporting || (!exportSettings && !exportConnections)}
                      className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                    >
                      {isExporting ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Exporting...</span>
                        </>
                      ) : (
                        <>
                          <Download className="h-3.5 w-3.5" />
                          <span>Export to JSON File</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Section 2: Import */}
                <div className="rounded-xl border border-[#2b2e3a] bg-[#1a1b22] p-4 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-emerald-600/15 border border-emerald-500/30 text-emerald-400">
                        <Upload className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold text-zinc-100">Import Configuration</h3>
                        <p className="text-[11px] text-zinc-400">
                          Restore settings and connection profiles from a previously exported `.json` file.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Hidden native input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileInputChange}
                    className="hidden"
                  />

                  {/* Drop / Browse Area */}
                  {!selectedFile ? (
                    <div
                      onClick={handleBrowseImportFile}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const file = e.dataTransfer.files?.[0];
                        if (file) {
                          try {
                            const text = await file.text();
                            await processSelectedFile(file.name, text);
                          } catch (err: any) {
                            alertError('Failed to read dropped file: ' + err.message);
                          }
                        }
                      }}
                      className="border-2 border-dashed border-[#2f3242] hover:border-blue-500/70 hover:bg-blue-500/5 rounded-xl p-5 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2"
                    >
                      <div className="p-2.5 rounded-full bg-[#20222c] text-zinc-400">
                        {isValidating ? (
                          <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                        ) : (
                          <FileJson className="h-5 w-5" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-zinc-200">
                          {isValidating ? 'Validating config file...' : 'Click to select or drag & drop a DHub config (.json) file'}
                        </p>
                        <p className="text-[10px] text-zinc-500 mt-0.5">
                          Supports full DHub backup or standalone preferences JSON
                        </p>
                      </div>
                      {validationError && (
                        <p className="text-[11px] text-rose-400 flex items-center gap-1 mt-1">
                          <AlertTriangle className="h-3 w-3" />
                          {validationError}
                        </p>
                      )}
                    </div>
                  ) : (
                    /* File Selected & Validated Preview */
                    <div className="space-y-3.5">
                      <div className="flex items-center justify-between p-3 rounded-lg bg-[#20222c] border border-[#2d303f]">
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <FileJson className="h-4 w-4 text-emerald-400 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-zinc-100 truncate">
                              {selectedFile.name}
                            </p>
                            <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Valid configuration file
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFile(null);
                            setSummary(null);
                            setImportResult(null);
                          }}
                          className="text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-[#282a36] hover:bg-[#323544] transition-colors cursor-pointer"
                        >
                          Change File
                        </button>
                      </div>

                      {/* Summary Badges */}
                      {summary && (
                        <div className="grid grid-cols-3 gap-2">
                          <div className="p-2.5 rounded-lg bg-[#14151a] border border-[#272934] text-center">
                            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
                              Settings
                            </span>
                            <p className="text-sm font-semibold text-zinc-200 mt-0.5">
                              {summary.settingsCount}
                            </p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[#14151a] border border-[#272934] text-center">
                            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
                              Connections
                            </span>
                            <p className="text-sm font-semibold text-zinc-200 mt-0.5">
                              {summary.connectionsCount}
                            </p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[#14151a] border border-[#272934] text-center">
                            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
                              Folders
                            </span>
                            <p className="text-sm font-semibold text-zinc-200 mt-0.5">
                              {summary.foldersCount}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Connection Names Preview */}
                      {summary && summary.connectionNames && summary.connectionNames.length > 0 && (
                        <div>
                          <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold block mb-1.5">
                            Connections in File:
                          </span>
                          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1.5 rounded bg-[#14151a] border border-[#272934]">
                            {summary.connectionNames.map((name, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-0.5 rounded text-[11px] bg-[#22242e] text-zinc-300 border border-[#2d303f]"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Import Choices */}
                      <div className="space-y-2 pt-1 border-t border-[#272934]">
                        <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold block">
                          Select What to Import:
                        </span>
                        <div className="space-y-1.5">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={importSettingsOption}
                              disabled={!summary || summary.settingsCount === 0}
                              onChange={(e) => setImportSettingsOption(e.target.checked)}
                              className="rounded border-[#3a3d4d] bg-[#121317] text-blue-600 focus:ring-blue-500/40"
                            />
                            <span className={`text-xs ${summary && summary.settingsCount > 0 ? 'text-zinc-200' : 'text-zinc-500'}`}>
                              Import Settings & Preferences ({summary?.settingsCount || 0} items)
                            </span>
                          </label>

                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={importConnectionsOption}
                              disabled={!summary || (summary.connectionsCount === 0 && summary.foldersCount === 0)}
                              onChange={(e) => setImportConnectionsOption(e.target.checked)}
                              className="rounded border-[#3a3d4d] bg-[#121317] text-blue-600 focus:ring-blue-500/40"
                            />
                            <span className={`text-xs ${summary && (summary.connectionsCount > 0 || summary.foldersCount > 0) ? 'text-zinc-200' : 'text-zinc-500'}`}>
                              Import Connections & Folders ({summary?.connectionsCount || 0} connections, {summary?.foldersCount || 0} folders)
                            </span>
                          </label>
                        </div>
                      </div>

                      {/* Conflict Strategy */}
                      {importConnectionsOption && summary && summary.connectionsCount > 0 && (
                        <div className="space-y-2 pt-1 border-t border-[#272934]">
                          <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold block">
                            If Connection with Same Name Exists:
                          </span>
                          <div className="grid grid-cols-3 gap-2">
                            <label
                              onClick={() => setConflictStrategy('overwrite')}
                              className={`p-2 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between ${
                                conflictStrategy === 'overwrite'
                                  ? 'bg-blue-600/15 border-blue-500 text-white'
                                  : 'bg-[#14151a] border-[#272934] text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-semibold text-[11px]">Overwrite</span>
                                {conflictStrategy === 'overwrite' && <Check className="h-3 w-3 text-blue-400" />}
                              </div>
                              <span className="text-[10px] text-zinc-400 leading-tight">
                                Replace existing connection config
                              </span>
                            </label>

                            <label
                              onClick={() => setConflictStrategy('skip')}
                              className={`p-2 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between ${
                                conflictStrategy === 'skip'
                                  ? 'bg-blue-600/15 border-blue-500 text-white'
                                  : 'bg-[#14151a] border-[#272934] text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-semibold text-[11px]">Skip</span>
                                {conflictStrategy === 'skip' && <Check className="h-3 w-3 text-blue-400" />}
                              </div>
                              <span className="text-[10px] text-zinc-400 leading-tight">
                                Keep existing, only add new ones
                              </span>
                            </label>

                            <label
                              onClick={() => setConflictStrategy('duplicate')}
                              className={`p-2 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between ${
                                conflictStrategy === 'duplicate'
                                  ? 'bg-blue-600/15 border-blue-500 text-white'
                                  : 'bg-[#14151a] border-[#272934] text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-semibold text-[11px]">Duplicate</span>
                                {conflictStrategy === 'duplicate' && <Check className="h-3 w-3 text-blue-400" />}
                              </div>
                              <span className="text-[10px] text-zinc-400 leading-tight">
                                Create new copy with (imported) suffix
                              </span>
                            </label>
                          </div>
                        </div>
                      )}

                      {/* Import Action */}
                      <div className="pt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFile(null);
                            setSummary(null);
                            setImportResult(null);
                          }}
                          className="px-3 py-1.5 rounded-lg border border-[#2f3242] text-zinc-400 hover:text-zinc-200 hover:bg-[#20222b] text-xs transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>

                        <button
                          type="button"
                          onClick={handleExecuteImport}
                          disabled={isImporting || (!importSettingsOption && !importConnectionsOption)}
                          className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                        >
                          {isImporting ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              <span>Importing...</span>
                            </>
                          ) : (
                            <>
                              <Upload className="h-3.5 w-3.5" />
                              <span>Apply & Import Config</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Import Result Notification */}
                      {importResult && (
                        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            <span>Import completed successfully!</span>
                          </div>
                          <p className="text-[11px] text-zinc-300">
                            Loaded: {importResult.settings} settings, {importResult.connections} connections, and {importResult.folders} folders.
                          </p>
                          {importResult.errors.length > 0 && (
                            <div className="text-[10px] text-amber-300 mt-1">
                              Warnings: {importResult.errors.join('; ')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex h-12 items-center justify-between border-t border-[#272932] px-5 bg-[#14151a]">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={resetToDefaults}
              className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 text-xs transition-colors cursor-pointer"
              title="Reset settings to factory defaults"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset Defaults</span>
            </button>

            {activeSettingsTab !== 'backup' && (
              <button
                type="button"
                onClick={() => setActiveSettingsTab('backup')}
                className="flex items-center gap-1.5 text-zinc-400 hover:text-blue-400 text-xs transition-colors cursor-pointer"
                title="Open Import & Export tab"
              >
                <ArrowDownUp className="h-3 w-3" />
                <span>Import / Export</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={closeSettings}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
