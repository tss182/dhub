import React, { useEffect, useState } from 'react';
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
  Command,
  Hash,
} from 'lucide-react';
import { useSettingsStore, DataViewMode } from '../../stores/useSettingsStore';

export const SettingsModal: React.FC = () => {
  const {
    isSettingsOpen,
    activeSettingsTab,
    dataViewMode,
    defaultPageSize,
    editorFontSize,
    wordWrap,
    showMinimap,
    closeSettings,
    setActiveSettingsTab,
    setDataViewMode,
    setDefaultPageSize,
    setEditorFontSize,
    setWordWrap,
    setShowMinimap,
    resetToDefaults,
  } = useSettingsStore();

  const [customSizeInput, setCustomSizeInput] = useState<string>(String(defaultPageSize));

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

  if (!isSettingsOpen) return null;

  const handleApplyCustomSize = () => {
    const parsed = parseInt(customSizeInput, 10);
    if (!isNaN(parsed) && parsed >= 10 && parsed <= 5000) {
      setDefaultPageSize(parsed);
    } else {
      setCustomSizeInput(String(defaultPageSize));
    }
  };

  const presetSizes = [25, 50, 100, 250, 500, 1000];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs select-none p-4 animate-in fade-in duration-150"
      onClick={closeSettings}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-[#181920] border border-[#2b2e3a] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
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
                Konfigurasi tampilan data, editor SQL, dan preferensi aplikasi
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
              onClick={() => setActiveSettingsTab('about')}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                activeSettingsTab === 'about'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#20222b]'
              }`}
            >
              <Info className="h-4 w-4" />
              <span>Shortcuts & About</span>
            </button>
          </div>

          {/* Settings Main Panel */}
          <div className="flex-1 p-5 overflow-y-auto min-h-0 text-xs">
            {activeSettingsTab === 'datagrid' && (
              <div className="space-y-6">
                {/* 1. Data Display Mode: Lazy Load vs Pagination */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                      Mode Penampilan Data (Data View Mode)
                    </label>
                  </div>
                  <p className="text-[11px] text-zinc-400 mb-3">
                    Pilih apakah tabel data dan query result dimuat menggunakan halaman (Pagination) atau continuous scrolling (Lazy Load).
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Option: Pagination */}
                    <div
                      onClick={() => setDataViewMode('paged')}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                        dataViewMode === 'paged'
                          ? 'bg-blue-600/10 border-blue-500 text-white shadow-sm ring-1 ring-blue-500/50'
                          : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div
                              className={`p-1.5 rounded-lg ${
                                dataViewMode === 'paged'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-[#282a35] text-zinc-400'
                              }`}
                            >
                              <Layers className="h-4 w-4" />
                            </div>
                            <span className="font-semibold text-xs text-zinc-100">Pagination (Pages)</span>
                          </div>
                          {dataViewMode === 'paged' && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                              <Check className="h-3 w-3 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] leading-relaxed text-zinc-400">
                          Data dibagi ke dalam halaman bernomor (Page 1, 2, 3...) dengan tombol navigasi First, Prev, Next, Last.
                        </p>
                      </div>
                      <div className="mt-3 pt-2.5 border-t border-[#2d303e] text-[10px] font-mono text-zinc-400">
                        Rekomendasi untuk dataset besar
                      </div>
                    </div>

                    {/* Option: Lazy Load */}
                    <div
                      onClick={() => setDataViewMode('infinite')}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                        dataViewMode === 'infinite'
                          ? 'bg-blue-600/10 border-blue-500 text-white shadow-sm ring-1 ring-blue-500/50'
                          : 'bg-[#1e2027] border-[#2b2e3a] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div
                              className={`p-1.5 rounded-lg ${
                                dataViewMode === 'infinite'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-[#282a35] text-zinc-400'
                              }`}
                            >
                              <ArrowDownCircle className="h-4 w-4" />
                            </div>
                            <span className="font-semibold text-xs text-zinc-100">Lazy Load (Scroll)</span>
                          </div>
                          {dataViewMode === 'infinite' && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                              <Check className="h-3 w-3 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] leading-relaxed text-zinc-400">
                          Scroll ke bawah secara continuous. Baris data tambahan otomatis diambil dari server saat kursor mendekati bawah.
                        </p>
                      </div>
                      <div className="mt-3 pt-2.5 border-t border-[#2d303e] text-[10px] font-mono text-zinc-400">
                        Cocok untuk eksplorasi cepat & audit
                      </div>
                    </div>
                  </div>
                </div>

                <div className="h-[1px] bg-[#272932]" />

                {/* 2. Default Page Size / Batch Limit */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                      Default Batch / Page Size (Ukuran Data per Halaman)
                    </label>
                    <span className="font-mono text-blue-400 font-semibold bg-blue-950/40 border border-blue-800/40 px-2 py-0.5 rounded text-[11px]">
                      {defaultPageSize} rows / batch
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mb-3">
                    Tentukan jumlah baris data default yang akan diambil per query atau per halaman (misal 50 atau 100 baris).
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

                <div className="rounded-lg bg-blue-950/20 border border-blue-900/30 p-3 text-[11px] text-blue-300/90 leading-relaxed flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                  <span>
                    Pengaturan ini berlaku otomatis untuk tab baru dan query berikutnya. Mode lazy load & pagination tidak lagi perlu diatur manual pada setiap tabel.
                  </span>
                </div>
              </div>
            )}

            {activeSettingsTab === 'editor' && (
              <div className="space-y-6">
                <div>
                  <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider block mb-1.5">
                    Editor Font Size
                  </label>
                  <p className="text-[11px] text-zinc-400 mb-3">
                    Ukuran teks pada editor SQL Monaco Worksheet.
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
                    Bungkus baris teks panjang secara otomatis agar tidak perlu scroll horizontal pada editor SQL.
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
              </div>
            )}

            {activeSettingsTab === 'about' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">DHub Desktop</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Modern high-performance Database Client & SQL IDE powered by Go + React.
                  </p>
                  <div className="mt-2 inline-flex items-center gap-2 rounded bg-[#20222b] px-2.5 py-1 text-[11px] font-mono text-zinc-300 border border-[#2d303e]">
                    <span>Version 0.1.0</span>
                    <span className="text-zinc-500">•</span>
                    <span className="text-emerald-400">Stable</span>
                  </div>
                </div>

                <div className="h-[1px] bg-[#272932]" />

                <div>
                  <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <Command className="h-3.5 w-3.5 text-blue-400" />
                    <span>Keyboard Shortcuts</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <div className="flex items-center justify-between p-2 rounded bg-[#1e2027] border border-[#272932]">
                      <span className="text-zinc-400">Search Everywhere</span>
                      <kbd className="font-mono bg-[#14151a] border border-[#2e313f] px-1.5 py-0.5 rounded text-zinc-200">
                        Ctrl+P / ⌘P
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded bg-[#1e2027] border border-[#272932]">
                      <span className="text-zinc-400">Execute Query</span>
                      <kbd className="font-mono bg-[#14151a] border border-[#2e313f] px-1.5 py-0.5 rounded text-zinc-200">
                        Ctrl+Enter / ⌘Enter
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded bg-[#1e2027] border border-[#272932]">
                      <span className="text-zinc-400">Apply Grid Changes</span>
                      <kbd className="font-mono bg-[#14151a] border border-[#2e313f] px-1.5 py-0.5 rounded text-zinc-200">
                        Ctrl+S / ⌘S
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded bg-[#1e2027] border border-[#272932]">
                      <span className="text-zinc-400">Duplicate Row</span>
                      <kbd className="font-mono bg-[#14151a] border border-[#2e313f] px-1.5 py-0.5 rounded text-zinc-200">
                        Ctrl+D / ⌘D
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded bg-[#1e2027] border border-[#272932]">
                      <span className="text-zinc-400">Settings & Preferences</span>
                      <kbd className="font-mono bg-[#14151a] border border-[#2e313f] px-1.5 py-0.5 rounded text-zinc-200">
                        Ctrl+, / ⌘,
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded bg-[#1e2027] border border-[#272932]">
                      <span className="text-zinc-400">Close Active Tab</span>
                      <kbd className="font-mono bg-[#14151a] border border-[#2e313f] px-1.5 py-0.5 rounded text-zinc-200">
                        Ctrl+W / ⌘W
                      </kbd>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex h-12 items-center justify-between border-t border-[#272932] px-5 bg-[#14151a]">
          <button
            type="button"
            onClick={resetToDefaults}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 text-xs transition-colors cursor-pointer"
            title="Reset settings to factory defaults"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset Defaults</span>
          </button>

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

