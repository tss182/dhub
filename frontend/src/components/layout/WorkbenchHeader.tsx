import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Settings as SettingsIcon,
  Bookmark,
  GitCompare,
  ArrowLeftRight,
  HelpCircle,
  Search,
  Minus,
  Square,
  Copy,
  X,
  Maximize2,
} from 'lucide-react';
import { Window, System } from '@wailsio/runtime';
import { DHubLogo } from '../common/DHubLogo';
import { WorkspaceSelector } from './WorkspaceSelector';
import { HelpTab, useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useSettingsStore } from '../../stores/useSettingsStore';

export interface WorkbenchHeaderProps {
  isMac: boolean;
  updateInfo: { hasUpdate?: boolean; latestVersion?: string } | null;
  isUpdateModalOpen: boolean;
  onOpenUpdateModal: () => void;
  onOpenSnippets: () => void;
  onOpenSchemaDiff: () => void;
  onOpenDataDiff: () => void;
  onOpenHelp: (tab: HelpTab) => void;
}

const dragStyle = { '--wails-draggable': 'drag' } as React.CSSProperties;
const noDragStyle = { '--wails-draggable': 'no-drag' } as React.CSSProperties;

function detectControlsOnLeft(isMacProp: boolean): boolean {
  try {
    if (System.IsMac() || System.IsLinux()) return true;
    if (System.IsWindows()) return false;
  } catch {}
  if (isMacProp) return true;
  if (typeof navigator !== 'undefined') {
    const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`;
    if (/Mac|Linux|X11/i.test(ua) && !/Win/i.test(ua)) return true;
  }
  return false;
}

export const WorkbenchHeader: React.FC<WorkbenchHeaderProps> = ({
  isMac,
  updateInfo,
  isUpdateModalOpen,
  onOpenUpdateModal,
  onOpenSnippets,
  onOpenSchemaDiff,
  onOpenDataDiff,
  onOpenHelp,
}) => {
  const [isMaximised, setIsMaximised] = useState(false);
  const [controlsOnLeft, setControlsOnLeft] = useState(() => detectControlsOnLeft(isMac));

  useEffect(() => {
    setControlsOnLeft(detectControlsOnLeft(isMac));
  }, [isMac]);

  useEffect(() => {
    let mounted = true;
    const syncMaximised = () => {
      Window.IsMaximised()
        .then((val) => {
          if (mounted) setIsMaximised(Boolean(val));
        })
        .catch(() => {});
    };

    syncMaximised();
    window.addEventListener('resize', syncMaximised);
    return () => {
      mounted = false;
      window.removeEventListener('resize', syncMaximised);
    };
  }, []);

  const handleMinimize = async () => {
    try {
      await Window.Minimise();
    } catch {}
  };

  const handleToggleMaximize = async () => {
    try {
      await Window.ToggleMaximise();
      const max = await Window.IsMaximised();
      setIsMaximised(Boolean(max));
    } catch {}
  };

  const handleCloseWindow = async () => {
    try {
      await Window.Close();
    } catch {}
  };

  return (
    <header
      style={dragStyle}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) {
          handleToggleMaximize();
        }
      }}
      className={`flex h-10 items-center justify-between border-b border-[#272932] bg-[#14151a] select-none ${
        controlsOnLeft ? 'px-3' : 'pl-3 pr-0'
      }`}
    >
      {/* Left: (macOS/Linux Traffic Lights) + App Logo + Workspace Selector */}
      <div
        className="flex flex-1 min-w-0 h-full items-center"
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) {
            handleToggleMaximize();
          }
        }}
      >
        <div className="flex items-center gap-3 shrink-0" style={noDragStyle}>
          {controlsOnLeft && (
            <>
              <div className="group/traffic flex items-center gap-2 pr-0.5">
                <button
                  type="button"
                  onClick={handleCloseWindow}
                  className="flex h-3 w-3 items-center justify-center rounded-full bg-[#ff5f57] hover:bg-[#ff5f57]/90 text-black/80 transition-opacity cursor-pointer"
                  title="Close"
                  aria-label="Close window"
                >
                  <X className="h-2 w-2 stroke-[3] opacity-0 group-hover/traffic:opacity-100 transition-opacity" />
                </button>
                <button
                  type="button"
                  onClick={handleMinimize}
                  className="flex h-3 w-3 items-center justify-center rounded-full bg-[#febc2e] hover:bg-[#febc2e]/90 text-black/80 transition-opacity cursor-pointer"
                  title="Minimize"
                  aria-label="Minimize window"
                >
                  <Minus className="h-2 w-2 stroke-[3] opacity-0 group-hover/traffic:opacity-100 transition-opacity" />
                </button>
                <button
                  type="button"
                  onClick={handleToggleMaximize}
                  className="flex h-3 w-3 items-center justify-center rounded-full bg-[#28c840] hover:bg-[#28c840]/90 text-black/80 transition-opacity cursor-pointer"
                  title={isMaximised ? 'Restore' : 'Zoom / Maximize'}
                  aria-label={isMaximised ? 'Restore window' : 'Maximize window'}
                >
                  <Maximize2 className="h-1.5 w-1.5 stroke-[3] opacity-0 group-hover/traffic:opacity-100 transition-opacity" />
                </button>
              </div>
              <div className="h-4 w-px bg-[#272932]" />
            </>
          )}

          <DHubLogo variant="full" size={24} />
          <div className="h-4 w-px bg-[#272932]" />
          <WorkspaceSelector />
        </div>
      </div>

      {/* Center: Centered Quick Actions (Search, Snippets, Schema Diff) */}
      <div className="flex items-center gap-1.5 shrink-0 px-2" style={noDragStyle}>
        {/* Search Everywhere Icon Button */}
        <button
          type="button"
          onClick={() => useWorkbenchStore.getState().setSearchEverywhereOpen(true)}
          className="flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 transition-colors cursor-pointer"
          title={`Search Everywhere (${isMac ? '⌘P' : 'Ctrl+P'})`}
          aria-label="Search Everywhere"
        >
          <Search className="h-3.5 w-3.5" />
        </button>

        {/* Snippets Icon Button */}
        <button
          type="button"
          onClick={onOpenSnippets}
          className="flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 transition-colors cursor-pointer"
          title="Snippets"
          aria-label="Snippets"
        >
          <Bookmark className="h-3.5 w-3.5" />
        </button>

        {/* Schema Diff Icon Button */}
        <button
          type="button"
          onClick={onOpenSchemaDiff}
          className="flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 transition-colors cursor-pointer"
          title="Schema Diff"
          aria-label="Schema Diff"
        >
          <GitCompare className="h-3.5 w-3.5" />
        </button>

        {/* Data Diff & Sync Icon Button */}
        <button
          type="button"
          onClick={onOpenDataDiff}
          className="flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 transition-colors cursor-pointer"
          title="Data Compare & Sync"
          aria-label="Data Compare & Sync"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Right: Help, Settings, Update Pill, and (Windows) Window Controls */}
      <div
        className="flex flex-1 min-w-0 h-full items-center justify-end"
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) {
            handleToggleMaximize();
          }
        }}
      >
        <div className="flex items-center h-full shrink-0" style={noDragStyle}>
        <div className={`flex items-center gap-1.5 ${controlsOnLeft ? '' : 'pr-2'}`}>

          {/* Help Icon Button */}
          <button
            type="button"
            onClick={() => onOpenHelp('quickstart')}
            className="flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 transition-colors cursor-pointer"
            title={`Help (${isMac ? '⌘H' : 'Ctrl+H'})`}
            aria-label="Help"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>

          {/* Settings Icon Button */}
          <button
            type="button"
            onClick={() => useSettingsStore.getState().openSettings()}
            className="relative flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 transition-colors cursor-pointer"
            title={
              updateInfo?.hasUpdate
                ? `Settings (${isMac ? '⌘I' : 'Ctrl+I'}) — Update ${updateInfo.latestVersion} available`
                : `Settings (${isMac ? '⌘I' : 'Ctrl+I'})`
            }
            aria-label="Settings"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            {updateInfo?.hasUpdate && (
              <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          {/* Update Shortcut Pill (shown when update is detected & modal is dismissed/closed) */}
          {updateInfo?.hasUpdate && !isUpdateModalOpen && (
            <button
              type="button"
              onClick={onOpenUpdateModal}
              className="flex items-center gap-1.5 rounded-full bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 px-2.5 py-0.5 text-[11px] font-medium text-blue-300 hover:text-blue-200 transition-colors cursor-pointer shadow-xs ml-0.5"
              title={`Update ${updateInfo.latestVersion} available — Click to open update menu`}
              aria-label={`Update ${updateInfo.latestVersion} available`}
            >
              <Sparkles className="h-3 w-3 text-blue-400" />
              <span>Update DHub</span>
            </button>
          )}
        </div>

        {/* Windows Window Controls (Minimize, Maximize/Restore, Close) */}
        {!controlsOnLeft && (
          <div className="flex items-center h-full border-l border-[#22242e]">
            <button
              type="button"
              onClick={handleMinimize}
              className="flex h-full w-11 items-center justify-center text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100 transition-colors cursor-pointer"
              title="Minimize"
              aria-label="Minimize window"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={handleToggleMaximize}
              className="flex h-full w-11 items-center justify-center text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100 transition-colors cursor-pointer"
              title={isMaximised ? 'Restore' : 'Maximize'}
              aria-label={isMaximised ? 'Restore window' : 'Maximize window'}
            >
              {isMaximised ? (
                <Copy className="h-3 w-3 rotate-90" />
              ) : (
                <Square className="h-3 w-3" />
              )}
            </button>

            <button
              type="button"
              onClick={handleCloseWindow}
              className="flex h-full w-11 items-center justify-center text-zinc-400 hover:bg-rose-600 hover:text-white transition-colors cursor-pointer"
              title="Close"
              aria-label="Close window"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        </div>
      </div>
    </header>
  );
};
