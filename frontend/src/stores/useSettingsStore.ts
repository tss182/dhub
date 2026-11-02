import { create } from 'zustand';

export type DataViewMode = 'infinite' | 'paged';
export type ThemeMode = 'dark' | 'light';

interface SettingsValues {
  theme: ThemeMode;
  dataViewMode: DataViewMode;
  defaultPageSize: number;
  editorFontSize: number;
  wordWrap: boolean;
  showMinimap: boolean;
}

interface SettingsState extends SettingsValues {
  isSettingsOpen: boolean;
  activeSettingsTab: 'appearance' | 'datagrid' | 'editor' | 'about';
  openSettings: (tab?: 'appearance' | 'datagrid' | 'editor' | 'about') => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  setActiveSettingsTab: (tab: 'appearance' | 'datagrid' | 'editor' | 'about') => void;
  setTheme: (theme: ThemeMode) => void;
  setDataViewMode: (mode: DataViewMode) => void;
  setDefaultPageSize: (size: number) => void;
  setEditorFontSize: (size: number) => void;
  setWordWrap: (wrap: boolean) => void;
  setShowMinimap: (show: boolean) => void;
  resetToDefaults: () => void;
}

const SETTINGS_STORAGE_KEY = 'dhub_settings_v1';

const DEFAULT_SETTINGS: SettingsValues = {
  theme: 'dark',
  dataViewMode: 'infinite', // Default to infinite (Lazy Load)
  defaultPageSize: 100,     // Default batch size 100
  editorFontSize: 13,
  wordWrap: false,
  showMinimap: false,
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

function loadStoredSettings(): SettingsValues {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        theme: parsed.theme === 'light' ? 'light' : 'dark',
        dataViewMode: parsed.dataViewMode === 'infinite' ? 'infinite' : 'paged',
        defaultPageSize: typeof parsed.defaultPageSize === 'number' && parsed.defaultPageSize > 0 ? parsed.defaultPageSize : DEFAULT_SETTINGS.defaultPageSize,
        editorFontSize: typeof parsed.editorFontSize === 'number' ? parsed.editorFontSize : DEFAULT_SETTINGS.editorFontSize,
        wordWrap: typeof parsed.wordWrap === 'boolean' ? parsed.wordWrap : DEFAULT_SETTINGS.wordWrap,
        showMinimap: typeof parsed.showMinimap === 'boolean' ? parsed.showMinimap : DEFAULT_SETTINGS.showMinimap,
      };
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
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Failed to persist settings to localStorage:', err);
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

  setDataViewMode: (mode) => {
    persistSettings({ dataViewMode: mode });
    set({ dataViewMode: mode });
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

  resetToDefaults: () => {
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } catch {
      // ignore
    }
    applyThemeToDocument(DEFAULT_SETTINGS.theme);
    set({ ...DEFAULT_SETTINGS });
  },
}));

