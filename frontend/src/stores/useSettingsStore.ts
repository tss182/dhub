import { create } from 'zustand';
import { WorkspaceService } from '../../bindings/dhub/internal/services';
import { APP_DEFAULTS } from '../config/defaults';

export type ThemeMode = 'dark' | 'light';
export type CopyFormat = 'csv' | 'json' | 'markdown' | 'sql_insert' | 'sql_update' | 'sql_upsert';
export type SettingsTab = 'appearance' | 'datagrid' | 'editor' | 'backup' | 'version';

interface SettingsValues {
  theme: ThemeMode;
  defaultPageSize: number;
  editorFontSize: number;
  wordWrap: boolean;
  showMinimap: boolean;
  copyFormat: CopyFormat;
  checkUpdatesOnStartup: boolean;
  checkUpdatesPeriodically: boolean;
  backupToolPaths: Record<string, string>;
}

interface SettingsState extends SettingsValues {
  isSettingsOpen: boolean;
  activeSettingsTab: SettingsTab;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  setActiveSettingsTab: (tab: SettingsTab) => void;
  setTheme: (theme: ThemeMode) => void;
  setDefaultPageSize: (size: number) => void;
  setEditorFontSize: (size: number) => void;
  setWordWrap: (wrap: boolean) => void;
  setShowMinimap: (show: boolean) => void;
  setCopyFormat: (format: CopyFormat) => void;
  setCheckUpdatesOnStartup: (enabled: boolean) => void;
  setCheckUpdatesPeriodically: (enabled: boolean) => void;
  setBackupToolPath: (tool: string, path: string) => void;
  resetToDefaults: () => void;
  reloadSettings: () => Promise<void>;
}

const SETTINGS_STORAGE_KEY = 'dhub_settings_v1';

const DEFAULT_SETTINGS: SettingsValues = {
  theme: APP_DEFAULTS.theme,
  defaultPageSize: APP_DEFAULTS.pageSize,
  editorFontSize: APP_DEFAULTS.editorFontSize,
  wordWrap: APP_DEFAULTS.wordWrap,
  showMinimap: APP_DEFAULTS.showMinimap,
  copyFormat: APP_DEFAULTS.copyFormat,
  checkUpdatesOnStartup: APP_DEFAULTS.checkUpdatesOnStartup,
  checkUpdatesPeriodically: APP_DEFAULTS.checkUpdatesPeriodically,
  backupToolPaths: {},
};

function applyThemeToDocument(theme: ThemeMode) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
  }
}

function parseSettingsObject(parsed: any): SettingsValues {
  const backupToolPaths: Record<string, string> = {};
  if (parsed?.backupToolPaths && typeof parsed.backupToolPaths === 'object') {
    for (const [k, v] of Object.entries(parsed.backupToolPaths)) {
      if (typeof v === 'string' && v.trim()) {
        backupToolPaths[k] = v.trim();
      }
    }
  }
  return {
    theme: parsed?.theme === 'light' ? 'light' : 'dark',
    defaultPageSize:
      typeof parsed?.defaultPageSize === 'number' && parsed.defaultPageSize > 0
        ? parsed.defaultPageSize
        : DEFAULT_SETTINGS.defaultPageSize,
    editorFontSize:
      typeof parsed?.editorFontSize === 'number'
        ? parsed.editorFontSize
        : DEFAULT_SETTINGS.editorFontSize,
    wordWrap: typeof parsed?.wordWrap === 'boolean' ? parsed.wordWrap : DEFAULT_SETTINGS.wordWrap,
    showMinimap:
      typeof parsed?.showMinimap === 'boolean' ? parsed.showMinimap : DEFAULT_SETTINGS.showMinimap,
    copyFormat: ['csv', 'json', 'markdown', 'sql_insert', 'sql_update', 'sql_upsert'].includes(parsed?.copyFormat)
      ? parsed.copyFormat
      : DEFAULT_SETTINGS.copyFormat,
    checkUpdatesOnStartup:
      typeof parsed?.checkUpdatesOnStartup === 'boolean'
        ? parsed.checkUpdatesOnStartup
        : DEFAULT_SETTINGS.checkUpdatesOnStartup,
    checkUpdatesPeriodically:
      typeof parsed?.checkUpdatesPeriodically === 'boolean'
        ? parsed.checkUpdatesPeriodically
        : DEFAULT_SETTINGS.checkUpdatesPeriodically,
    backupToolPaths,
  };
}

function loadStoredSettings(): SettingsValues {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return parseSettingsObject(JSON.parse(raw));
    }
  } catch (err) {
    console.warn('Failed to load settings from localStorage:', err);
  }
  return DEFAULT_SETTINGS;
}

function persistSettings(values: Partial<SettingsValues>) {
  try {
    const current = loadStoredSettings();
    const updated = { ...current, ...values };
    const serialized = JSON.stringify(updated);
    localStorage.setItem(SETTINGS_STORAGE_KEY, serialized);
    WorkspaceService.SaveSetting(SETTINGS_STORAGE_KEY, serialized).catch(() => {});
  } catch (err) {
    console.warn('Failed to persist settings:', err);
  }
}

const initialValues = loadStoredSettings();
applyThemeToDocument(initialValues.theme);

export const useSettingsStore = create<SettingsState>((set) => ({
  ...initialValues,
  isSettingsOpen: false,
  activeSettingsTab: 'appearance',

  openSettings: (tab = 'appearance') => set({ isSettingsOpen: true, activeSettingsTab: tab }),
  closeSettings: () => set({ isSettingsOpen: false }),
  toggleSettings: () => set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),
  setActiveSettingsTab: (activeSettingsTab) => set({ activeSettingsTab }),

  setTheme: (theme) => {
    applyThemeToDocument(theme);
    persistSettings({ theme });
    set({ theme });
  },

  setDefaultPageSize: (size) => {
    const validSize = Math.max(10, Math.min(5000, Number(size) || 100));
    persistSettings({ defaultPageSize: validSize });
    set({ defaultPageSize: validSize });
  },

  setEditorFontSize: (size) => {
    const validSize = Math.max(10, Math.min(24, Number(size) || 13));
    persistSettings({ editorFontSize: validSize });
    set({ editorFontSize: validSize });
  },

  setWordWrap: (wrap) => {
    persistSettings({ wordWrap: wrap });
    set({ wordWrap: wrap });
  },

  setShowMinimap: (show) => {
    persistSettings({ showMinimap: show });
    set({ showMinimap: show });
  },

  setCopyFormat: (copyFormat) => {
    persistSettings({ copyFormat });
    set({ copyFormat });
  },

  setCheckUpdatesOnStartup: (checkUpdatesOnStartup) => {
    persistSettings({ checkUpdatesOnStartup });
    set({ checkUpdatesOnStartup });
  },

  setCheckUpdatesPeriodically: (checkUpdatesPeriodically) => {
    persistSettings({ checkUpdatesPeriodically });
    set({ checkUpdatesPeriodically });
  },

  setBackupToolPath: (tool, path) => {
    set((state) => {
      const next = { ...state.backupToolPaths };
      const trimmed = path.trim();
      if (trimmed) {
        next[tool] = trimmed;
      } else {
        delete next[tool];
      }
      persistSettings({ backupToolPaths: next });
      return { backupToolPaths: next };
    });
  },

  resetToDefaults: () => {
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
      WorkspaceService.SaveSetting(SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS)).catch(() => {});
    } catch {
      // ignore
    }
    applyThemeToDocument(DEFAULT_SETTINGS.theme);
    set({ ...DEFAULT_SETTINGS });
  },

  reloadSettings: async () => {
    try {
      const settings = await WorkspaceService.GetSettings();
      if (settings && settings[SETTINGS_STORAGE_KEY]) {
        const raw = settings[SETTINGS_STORAGE_KEY];
        localStorage.setItem(SETTINGS_STORAGE_KEY, raw);
        const parsed = parseSettingsObject(JSON.parse(raw));
        applyThemeToDocument(parsed.theme);
        set(parsed);
      }
    } catch (err) {
      console.warn('Failed to reload settings from backend:', err);
    }
  },
}));

if (typeof window !== 'undefined') {
  WorkspaceService.GetSettings()
    .then((settings) => {
      if (settings && settings[SETTINGS_STORAGE_KEY]) {
        try {
          const parsed = parseSettingsObject(JSON.parse(settings[SETTINGS_STORAGE_KEY]));
          localStorage.setItem(SETTINGS_STORAGE_KEY, settings[SETTINGS_STORAGE_KEY]);
          applyThemeToDocument(parsed.theme);
          useSettingsStore.setState(parsed);
        } catch {
          // ignore
        }
      }
    })
    .catch(() => {});
}

