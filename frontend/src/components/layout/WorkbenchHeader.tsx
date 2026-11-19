import React from 'react';
import {
  Sparkles,
  Settings as SettingsIcon,
  Bookmark,
  GitCompare,
  HelpCircle,
} from 'lucide-react';
import { DHubLogo } from '../common/DHubLogo';
import { WorkspaceSelector } from './WorkspaceSelector';
import { HelpTab } from '../../stores/useWorkbenchStore';
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
  return (
    <header className="flex h-11 items-center justify-between border-b border-[#272932] px-4 bg-[#14151a]">
      <div className="flex items-center gap-2">
        <DHubLogo variant="full" size={26} />
      </div>

      <div className="flex items-center gap-2">
        {/* Workspace Combobox Selector */}
        <WorkspaceSelector />

        {/* Update Shortcut Button (shown when update is detected & modal is dismissed/closed) */}
        {updateInfo?.hasUpdate && !isUpdateModalOpen && (
          <button
            type="button"
            onClick={onOpenUpdateModal}
            className="flex items-center gap-1.5 rounded bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:text-emerald-200 transition-colors cursor-pointer shadow-xs"
            title={`Update ${updateInfo.latestVersion} available — Click to open update menu`}
            aria-label={`Update ${updateInfo.latestVersion} available`}
          >
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            <span>Update</span>
            <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200 font-mono leading-none">
              {updateInfo.latestVersion}
            </span>
          </button>
        )}

        {/* Settings & Tools Dropdown */}
        <div className="relative" ref={settingsMenuRef}>
          <button
            type="button"
            onClick={onToggleSettingsMenu}
            className={`relative flex items-center justify-center rounded bg-[#1e2027] p-1.5 text-xs border cursor-pointer shadow-xs transition-colors ${
              updateInfo?.hasUpdate
                ? 'text-emerald-300 border-emerald-500/40 hover:border-emerald-400 hover:text-emerald-200'
                : isSettingsMenuOpen
                ? 'text-zinc-100 border-zinc-500 bg-[#252834]'
                : 'text-zinc-400 border-[#272932] hover:border-zinc-500 hover:text-zinc-200'
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
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
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
      </div>
    </header>
  );
};
