import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Settings as SettingsIcon,
  Bookmark,
  GitCompare,
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
  isSettingsMenuOpen: boolean;
  settingsMenuRef: React.RefObject<HTMLDivElement>;
  onToggleSettingsMenu: () => void;
  onCloseSettingsMenu: () => void;
  onOpenUpdateModal: () => void;
  onOpenSnippets: () => void;
  onOpenSchemaDiff: () => void;
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
  isSettingsMenuOpen,
  settingsMenuRef,
  onToggleSettingsMenu,
  onCloseSettingsMenu,
  onOpenUpdateModal,
  onOpenSnippets,
  onOpenSchemaDiff,
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
      <div className="flex items-center gap-3" style={noDragStyle}>
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

      {/* Center draggable spacer */}
      <div
        style={dragStyle}
        onDoubleClick={handleToggleMaximize}
        className="flex-1 h-full"
      />

      {/* Right: Search, Settings, Update Pill, and (Windows) Window Controls */}
      <div className="flex items-center h-full" style={noDragStyle}>
        <div className={`flex items-center gap-1.5 ${controlsOnLeft ? '' : 'pr-2'}`}>
          {/* Search Everywhere Icon Button */}
          <button
            type="button"
            onClick={() => useWorkbenchStore.getState().setSearchEverywhereOpen(true)}
            className="flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 transition-colors cursor-pointer"
            title={`Search Everywhere (${isMac ? '⌘K' : 'Ctrl+K'} / Double Shift)`}
            aria-label="Search Everywhere"
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          {/* Settings & Tools Dropdown */}
          <div className="relative" ref={settingsMenuRef}>
            <button
              type="button"
              onClick={onToggleSettingsMenu}
              className={`relative flex items-center justify-center rounded-md p-1.5 text-xs cursor-pointer transition-colors ${
                isSettingsMenuOpen
                  ? 'text-zinc-100 bg-white/[0.08]'
                  : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
              }`}
              title={
                updateInfo?.hasUpdate
                  ? `Settings & Tools — Update ${updateInfo.latestVersion} available`
                  : 'Settings & Tools'
              }
              aria-label="Settings & Tools"
              aria-expanded={isSettingsMenuOpen}
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              {updateInfo?.hasUpdate && (
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>

            {isSettingsMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-md border border-[#373946] bg-[#1a1b22] py-1 shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    onCloseSettingsMenu();
                    useSettingsStore.getState().openSettings();
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#232530] hover:text-white transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <SettingsIcon className="h-3.5 w-3.5 text-zinc-400" />
                    <span>Setting</span>
                  </span>
                  {updateInfo?.hasUpdate ? (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {updateInfo.latestVersion}
                    </span>
                  ) : (
                    <kbd className="text-[10px] text-zinc-500 font-mono">
                      {isMac ? '⌘I' : 'Ctrl+I'}
                    </kbd>
                  )}
                </button>

                <div className="my-1 border-t border-[#292b36]" />

                <button
                  type="button"
                  onClick={() => {
                    onCloseSettingsMenu();
                    onOpenSnippets();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#232530] hover:text-white transition-colors cursor-pointer"
                >
                  <Bookmark className="h-3.5 w-3.5 text-amber-400" />
                  <span>Snippets</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onCloseSettingsMenu();
                    onOpenSchemaDiff();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#232530] hover:text-white transition-colors cursor-pointer"
                >
                  <GitCompare className="h-3.5 w-3.5 text-blue-400" />
                  <span>Schema Diff</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onCloseSettingsMenu();
                    onOpenHelp('quickstart');
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#232530] hover:text-white transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <HelpCircle className="h-3.5 w-3.5 text-blue-400" />
                    <span>Help</span>
                  </span>
                  <kbd className="text-[10px] text-zinc-500 font-mono">
                    {isMac ? '⌘H' : 'Ctrl+H'}
                  </kbd>
                </button>
              </div>
            )}
          </div>

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
    </header>
  );
};
