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
  confirmVariant?: 'emerald' | 'rose' | 'blue';
  onConfirm?: () => void;
  onCancel?: () => void;
}

export interface ToastNotification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  duration?: number;
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
  confirmVariant?: 'emerald' | 'rose' | 'blue';
  onConfirm?: () => void;
  onCancel?: () => void;

  toasts: ToastNotification[];

  showAlert: (options: AlertModalOptions) => void;
  showConfirm: (options: Omit<AlertModalOptions, 'type'> & { onConfirm: () => void }) => void;
  showToast: (options: Omit<ToastNotification, 'id'>) => string;
  removeToast: (id: string) => void;
  closeAlert: () => void;
}

export const useAlertStore = create<AlertStoreState>((set) => ({
  isOpen: false,
  type: 'info',
  title: '',
  message: '',
  details: undefined,
  confirmLabel: 'OK',
  cancelLabel: 'Cancel',
  isDanger: false,
  confirmVariant: undefined,
  onConfirm: undefined,
  onCancel: undefined,
  toasts: [],

  showAlert: (options) => {
    const type = options.type || 'info';

    // If it requires user choice (confirm) or has detailed text to inspect, show central modal
    const requiresModal =
      type === 'confirm' ||
      Boolean(options.onConfirm && options.onCancel) ||
      Boolean(options.details && options.details.trim().length > 0);

    if (requiresModal) {
      let defaultTitle = 'Information';
      if (type === 'success') defaultTitle = 'Success';
      if (type === 'error') defaultTitle = 'Error';
      if (type === 'warning') defaultTitle = 'Warning';

      set({
        isOpen: true,
        type,
        title: options.title || defaultTitle,
        message: options.message,
        details: options.details,
        confirmLabel: options.confirmLabel || (type === 'error' ? 'Close' : 'OK'),
        cancelLabel: options.cancelLabel || 'Cancel',
        isDanger: options.isDanger || false,
        confirmVariant: options.confirmVariant,
        onConfirm: options.onConfirm,
        onCancel: options.onCancel,
      });
    } else {
      // Just informational: show top-right toast notification (max 3 stacked)
      const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
      const toastType: 'success' | 'error' | 'warning' | 'info' = type;

      set((state) => {
        const nextToasts = [
          ...state.toasts,
          {
            id,
            type: toastType,
            title: options.title,
            message: options.message,
            duration: 3500,
          },
        ];
        return { toasts: nextToasts.slice(-3) };
      });
    }
  },

  showConfirm: (options) => {
    set({
      isOpen: true,
      type: 'confirm',
      title: options.title || 'Confirmation',
      message: options.message,
      details: options.details,
      confirmLabel: options.confirmLabel || 'Proceed',
      cancelLabel: options.cancelLabel || 'Cancel',
      isDanger: options.isDanger ?? false,
      confirmVariant: options.confirmVariant || (options.isDanger ? 'rose' : 'blue'),
      onConfirm: options.onConfirm,
      onCancel: options.onCancel,
    });
  },

  showToast: (options) => {
    const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    set((state) => {
      const nextToasts = [
        ...state.toasts,
        {
          id,
          ...options,
        },
      ];
      return { toasts: nextToasts.slice(-3) };
    });
    return id;
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
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
export const alertSuccess = (message: string, title?: string) =>
  useAlertStore.getState().showToast({ type: 'success', message, title });

export const alertError = (message: string, title?: string, details?: string) => {
  if (details && details.trim().length > 0) {
    useAlertStore.getState().showAlert({ type: 'error', message, title, details });
  } else {
    useAlertStore.getState().showToast({ type: 'error', message, title });
  }
};

export const alertWarning = (message: string, title?: string) =>
  useAlertStore.getState().showToast({ type: 'warning', message, title });

export const alertInfo = (message: string, title?: string) =>
  useAlertStore.getState().showToast({ type: 'info', message, title });

// Promise-based confirmation using the app's styled AlertModal (replaces native window.confirm)
export const confirmDialog = (
  options: Omit<AlertModalOptions, 'type' | 'onConfirm' | 'onCancel'>
): Promise<boolean> =>
  new Promise((resolve) => {
    useAlertStore.getState().showConfirm({
      ...options,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
