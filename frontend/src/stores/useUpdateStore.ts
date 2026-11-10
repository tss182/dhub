import { create } from 'zustand';
import { checkForUpdate, openUpdateURL, UpdateInfo } from '../services/updateService';

interface UpdateStore {
  isChecking: boolean;
  updateInfo: UpdateInfo | null;
  isUpdateModalOpen: boolean;
  hasDismissed: boolean;
  error: string | null;

  checkUpdate: (silent?: boolean) => Promise<UpdateInfo | null>;
  openUpdateModal: () => void;
  closeUpdateModal: () => void;
  dismissUpdate: () => void;
  downloadUpdate: () => Promise<void>;
  openReleasePage: () => Promise<void>;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  isChecking: false,
  updateInfo: null,
  isUpdateModalOpen: false,
  hasDismissed: false,
  error: null,

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
  closeUpdateModal: () => set({ isUpdateModalOpen: false }),
  dismissUpdate: () => set({ isUpdateModalOpen: false, hasDismissed: true }),

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

