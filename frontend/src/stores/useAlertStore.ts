import { create } from 'zustand';

export type AlertType = 'success' | 'error' | 'warning' | 'info' | 'confirm';

export interface AlertModalOptions {
  type?: AlertType;
  title?: string;
  message: string;
  details?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface AlertStoreState {
  isOpen: boolean;
  type: AlertType;
  title: string;
  message: string;
  details?: string;
  confirmLabel: string;
  cancelLabel: string;
  isDanger: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;

  showAlert: (options: AlertModalOptions) => void;
  showConfirm: (options: Omit<AlertModalOptions, 'type'> & { onConfirm: () => void }) => void;
  closeAlert: () => void;
}

export const useAlertStore = create<AlertStoreState>((set) => ({
  isOpen: false,
  type: 'info',
  title: '',
  message: '',
  details: undefined,
  confirmLabel: 'OK',
  cancelLabel: 'Batal',
  isDanger: false,
  onConfirm: undefined,
  onCancel: undefined,

  showAlert: (options) => {
    const type = options.type || 'info';
    let defaultTitle = 'Informasi';
    if (type === 'success') defaultTitle = 'Berhasil';
    if (type === 'error') defaultTitle = 'Terjadi Kesalahan';
    if (type === 'warning') defaultTitle = 'Peringatan';

    set({
      isOpen: true,
      type,
      title: options.title || defaultTitle,
      message: options.message,
      details: options.details,
      confirmLabel: options.confirmLabel || (type === 'error' ? 'Tutup' : 'OK'),
      cancelLabel: options.cancelLabel || 'Batal',
      isDanger: options.isDanger || false,
      onConfirm: options.onConfirm,
      onCancel: options.onCancel,
    });
  },

  showConfirm: (options) => {
    set({
      isOpen: true,
      type: 'confirm',
      title: options.title || 'Konfirmasi',
      message: options.message,
      details: options.details,
      confirmLabel: options.confirmLabel || 'Ya, Lanjutkan',
      cancelLabel: options.cancelLabel || 'Batal',
      isDanger: options.isDanger ?? true,
      onConfirm: options.onConfirm,
      onCancel: options.onCancel,
    });
  },

  closeAlert: () =>
    set({
      isOpen: false,
      onConfirm: undefined,
      onCancel: undefined,
      details: undefined,
    }),
}));

// Convenience helpers
export const alertSuccess = (message: string, title?: string, details?: string) =>
  useAlertStore.getState().showAlert({ type: 'success', message, title, details });

export const alertError = (message: string, title?: string, details?: string) =>
  useAlertStore.getState().showAlert({ type: 'error', message, title, details });

export const alertWarning = (message: string, title?: string, details?: string) =>
  useAlertStore.getState().showAlert({ type: 'warning', message, title, details });

export const alertInfo = (message: string, title?: string, details?: string) =>
  useAlertStore.getState().showAlert({ type: 'info', message, title, details });

