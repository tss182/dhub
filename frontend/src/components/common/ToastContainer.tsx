import React, { useEffect } from 'react';
import { useAlertStore, ToastNotification } from '../../stores/useAlertStore';
import {
  CheckCircle2,
  Info,
  AlertTriangle,
  XCircle,
  X,
} from 'lucide-react';

const ToastItem: React.FC<{
  toast: ToastNotification;
  onDismiss: (id: string) => void;
}> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const duration = toast.duration ?? (toast.type === 'error' ? 4500 : 3500);
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, toast.type, onDismiss]);

  const getStyle = () => {
    switch (toast.type) {
      case 'success':
        return {
          border: 'border-emerald-500/40',
          iconBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
          icon: <CheckCircle2 className="h-4 w-4 stroke-[2.2]" />,
          glow: 'shadow-[0_4px_20px_rgba(16,185,129,0.15)]',
        };
      case 'warning':
        return {
          border: 'border-amber-500/40',
          iconBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
          icon: <AlertTriangle className="h-4 w-4 stroke-[2.2]" />,
          glow: 'shadow-[0_4px_20px_rgba(245,158,11,0.15)]',
        };
      case 'error':
        return {
          border: 'border-rose-500/40',
          iconBg: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
          icon: <XCircle className="h-4 w-4 stroke-[2.2]" />,
          glow: 'shadow-[0_4px_20px_rgba(244,63,94,0.15)]',
        };
      case 'info':
      default:
        return {
          border: 'border-blue-500/40',
          iconBg: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
          icon: <Info className="h-4 w-4 stroke-[2.2]" />,
          glow: 'shadow-[0_4px_20px_rgba(59,130,246,0.15)]',
        };
    }
  };

  const s = getStyle();

  return (
    <div
      role="alert"
      className={`pointer-events-auto flex w-full items-start gap-3 rounded-xl border bg-[#16171e]/95 p-3 backdrop-blur-md transition-all animate-in slide-in-from-right-8 fade-in duration-200 select-text ${s.border} ${s.glow}`}
    >
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${s.iconBg}`}>
        {s.icon}
      </div>

      <div className="flex-1 min-w-0 pt-0.5">
        {toast.title && (
          <h4 className="text-xs font-semibold text-zinc-100 tracking-tight mb-0.5 truncate">
            {toast.title}
          </h4>
        )}
        <p className="text-xs text-zinc-300 leading-snug break-words">
          {toast.message}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-[#20222a] transition-colors cursor-pointer"
        title="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const toasts = useAlertStore((state) => state.toasts);
  const removeToast = useAlertStore((state) => state.removeToast);

  const visibleToasts = toasts.slice(-3);
  if (visibleToasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed top-3 right-3 z-[150] flex flex-col gap-2 max-w-sm w-full pointer-events-none select-none"
    >
      {visibleToasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
};

