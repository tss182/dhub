import type { AiProvider, CopyFormat, ThemeMode } from '../stores/useSettingsStore';

/**
 * Global application default configuration.
 * Centralizes default values so changing them in one place updates the entire app.
 */
export const APP_DEFAULTS = {
  // Data Grid & Pagination
  pageSize: 500,
  pageSizeOptions: [25, 50, 100, 250, 500, 1000] as readonly number[],

  // Editor & Appearance
  theme: 'dark' as ThemeMode,
  editorFontSize: 13,
  wordWrap: false,
  showMinimap: false,
  showAiChat: true,
  aiProvider: 'openai' as AiProvider,
  aiApiKey: '',
  aiBaseUrl: '',
  aiModel: 'gpt-4o-mini',
  copyFormat: 'csv' as CopyFormat,

  // Updates
  checkUpdatesOnStartup: true,
  checkUpdatesPeriodically: true,

  // Layout Dimensions (px)
  leftSidebarWidth: 256,
  rightSidebarWidth: 280,
  bottomPanelHeight: 280,

  // Mock Data Generator
  mockDefaultRows: 25,
  mockMaxRows: 1_000_000,
  mockInsertBatchSize: 500,
} as const;
