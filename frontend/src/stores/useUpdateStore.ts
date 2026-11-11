import { create } from 'zustand';
import {
  checkForUpdate,
  openUpdateURL,
  downloadAndStageUpdate,
  applyDownloadedUpdate,
  cancelUpdateDownload,
  onUpdateProgress,
  UpdateInfo,
  UpdateProgress,
} from '../services/updateService';

interface UpdateStore {
  isChecking: boolean;
  updateInfo: UpdateInfo | null;
  isUpdateModalOpen: boolean;
  hasDismissed: boolean;
  error: string | null;

  // In-app download state
  isDownloading: boolean;
  isReadyToInstall: boolean;
  isInstalling: boolean;
  downloadProgress: UpdateProgress;
  downloadedFilePath: string | null;

  checkUpdate: (silent?: boolean) => Promise<UpdateInfo | null>;
  openUpdateModal: () => void;
  closeUpdateModal: () => void;
  dismissUpdate: () => void;
  startInAppUpdate: () => Promise<void>;
  applyUpdate: () => Promise<void>;
  cancelUpdate: () => Promise<void>;
  downloadUpdate: () => Promise<void>; // Fallback to browser
  openReleasePage: () => Promise<void>;
}

let progressUnsubscribe: (() => void) | null = null;

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  isChecking: false,
  updateInfo: null,
  isUpdateModalOpen: false,
  hasDismissed: false,
  error: null,

  isDownloading: false,
  isReadyToInstall: false,
  isInstalling: false,
  downloadProgress: {
    status: 'idle',
    downloaded: 0,
    total: 0,
    percent: 0,
  },
  downloadedFilePath: null,

  checkUpdate: async (silent = false) => {
    set({ isChecking: true, error: null });
    try {
      const info = await checkForUpdate();
      set({ updateInfo: info, isChecking: false });
      if (info.hasUpdate && !silent && !get().hasDismissed) {
        set({ isUpdateModalOpen: true });
      }
      return info;
    } catch (err: any) {
      const message = err?.message || 'Failed to check for updates';
      set({ isChecking: false, error: message });
      if (!silent) {
        console.error('Update check failed:', err);
      }
      return null;
    }
  },

  openUpdateModal: () => set({ isUpdateModalOpen: true }),
  closeUpdateModal: () => {
    // If downloading, don't kill the download silently; user can re-open or cancel
    set({ isUpdateModalOpen: false });
  },
  dismissUpdate: () => set({ isUpdateModalOpen: false, hasDismissed: true }),

  startInAppUpdate: async () => {
    const { updateInfo, isDownloading } = get();
    if (!updateInfo || isDownloading) return;

    const url = updateInfo.downloadUrl;
    if (!url) {
      // Fallback if no direct asset URL
      await get().downloadUpdate();
      return;
    }

    set({
      isDownloading: true,
      isReadyToInstall: false,
      isInstalling: false,
      error: null,
      downloadProgress: {
        status: 'downloading',
        downloaded: 0,
        total: updateInfo.assetSize || 0,
        percent: 0,
      },
    });

    // Ensure single event listener is registered
    if (!progressUnsubscribe) {
      progressUnsubscribe = onUpdateProgress((progress) => {
        set({ downloadProgress: progress });
        if (progress.status === 'completed') {
          set({ isDownloading: false, isReadyToInstall: true });
        } else if (progress.status === 'error') {
          set({
            isDownloading: false,
            isReadyToInstall: false,
            error: progress.error || 'Failed to download update',
          });
        }
      });
    }

    try {
      const savedPath = await downloadAndStageUpdate(url, updateInfo.assetFileName || 'dhub-update');
      set({
        downloadedFilePath: savedPath,
        isDownloading: false,
        isReadyToInstall: true,
      });
    } catch (err: any) {
      const errMsg = err?.message || String(err) || 'Download failed';
      set({
        isDownloading: false,
        error: errMsg,
        downloadProgress: {
          ...get().downloadProgress,
          status: 'error',
          error: errMsg,
        },
      });
    }
  },

  applyUpdate: async () => {
    const { downloadedFilePath } = get();
    set({ isInstalling: true });
    try {
      await applyDownloadedUpdate(downloadedFilePath || undefined);
    } catch (err: any) {
      set({
        isInstalling: false,
        error: err?.message || 'Failed to execute update installer',
      });
    }
  },

  cancelUpdate: async () => {
    try {
      await cancelUpdateDownload();
    } catch (err) {
      console.warn('Failed to cancel download:', err);
    }
    set({
      isDownloading: false,
      isReadyToInstall: false,
      isInstalling: false,
      downloadProgress: {
        status: 'idle',
        downloaded: 0,
        total: 0,
        percent: 0,
      },
    });
  },

  downloadUpdate: async () => {
    const { updateInfo } = get();
    if (!updateInfo) return;
    const url = updateInfo.downloadUrl || updateInfo.releaseUrl;
    if (url) {
      await openUpdateURL(url);
    }
  },

  openReleasePage: async () => {
    const { updateInfo } = get();
    const url = updateInfo?.releaseUrl || 'https://github.com/tss182/dhub/releases';
    await openUpdateURL(url);
  },
}));


