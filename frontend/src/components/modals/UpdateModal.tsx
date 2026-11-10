import React from 'react';
import {
  X,
  Sparkles,
  Download,
  ExternalLink,
  CheckCircle2,
  ShieldCheck,
  FileCode2,
} from 'lucide-react';
import { useUpdateStore } from '../../stores/useUpdateStore';

export const UpdateModal: React.FC = () => {
  const {
    isUpdateModalOpen,
    updateInfo,
    closeUpdateModal,
    dismissUpdate,
    downloadUpdate,
    openReleasePage,
  } = useUpdateStore();

  if (!isUpdateModalOpen || !updateInfo || !updateInfo.hasUpdate) {
    return null;
  }

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const getPlatformLabel = (os: string): string => {
    switch (os) {
      case 'windows':
        return 'Windows Installer (User Scope • No Admin/Root Required)';
      case 'darwin':
        return 'macOS Application Package';
      case 'linux':
        return 'Linux Package (.deb / .rpm / AppImage)';
      default:
        return 'Desktop Installer';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs select-none p-4 animate-in fade-in duration-150"
      onClick={closeUpdateModal}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-[#181920] border border-[#2b2e3a] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#272932] px-6 py-4 bg-[#14151a]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-600/15 border border-blue-500/30 text-blue-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-100">Update Available</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  {updateInfo.latestVersion}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                A new version of DHub is ready for download
              </p>
            </div>
          </div>
          <button
            onClick={closeUpdateModal}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[#252834] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs">
          {/* Version comparison card */}
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#14151a] border border-[#272932]">
            <div>
              <span className="text-[10px] text-zinc-400 uppercase font-medium tracking-wider">
                Current Version
              </span>
              <p className="text-sm font-semibold text-zinc-300 font-mono mt-0.5">
                v{updateInfo.currentVersion.replace(/^v/i, '')}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-emerald-400 uppercase font-medium tracking-wider">
                Latest Release
              </span>
              <p className="text-sm font-bold text-emerald-400 font-mono mt-0.5 flex items-center gap-1.5">
                {updateInfo.latestVersion}
                <CheckCircle2 className="h-4 w-4" />
              </p>
            </div>
          </div>

          {/* User scope security note */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-950/20 border border-blue-800/30 text-blue-300">
            <ShieldCheck className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed">
              <span className="font-semibold text-blue-200">
                {getPlatformLabel(updateInfo.platformOS)}
              </span>
              <p className="text-zinc-400 text-[10px] mt-0.5">
                {updateInfo.platformOS === 'windows'
                  ? 'Installs directly to your user profile directory without requiring administrator/root credentials.'
                  : 'Download and install directly from official GitHub releases.'}
              </p>
            </div>
          </div>

          {/* Release Notes */}
          {updateInfo.releaseNotes ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-zinc-400 font-medium">
                <span className="flex items-center gap-1.5">
                  <FileCode2 className="h-3.5 w-3.5 text-zinc-400" />
                  What's New in {updateInfo.latestVersion}
                </span>
                {updateInfo.assetSize > 0 && (
                  <span className="text-[10px] text-zinc-400 font-mono">
                    Size: {formatFileSize(updateInfo.assetSize)}
                  </span>
                )}
              </div>
              <div className="max-h-48 overflow-y-auto rounded-xl bg-[#121318] border border-[#22242c] p-3 text-[11px] text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed select-text scrollbar-thin">
                {updateInfo.releaseNotes}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex h-14 items-center justify-between border-t border-[#272932] px-6 bg-[#14151a]">
          <button
            type="button"
            onClick={openReleasePage}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 text-xs transition-colors cursor-pointer"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>GitHub Releases</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={dismissUpdate}
              className="px-3.5 py-1.5 rounded-lg border border-[#313543] text-zinc-300 hover:bg-[#20222b] text-xs font-medium transition-colors cursor-pointer"
            >
              Later
            </button>
            <button
              type="button"
              onClick={downloadUpdate}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/20 transition-all cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download Update</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

