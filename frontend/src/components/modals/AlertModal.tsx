import React, { useEffect, useState } from 'react';
import { useAlertStore } from '../../stores/useAlertStore';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  HelpCircle,
  X,
  Copy,
  Check,
  Server,
  Database,
  Table2,
  MapPin,
} from 'lucide-react';

export const AlertModal: React.FC = () => {
  const {
    isOpen,
    type,
    title,
    message,
    details,
    connectionContext,
    confirmLabel,
    cancelLabel,
    isDanger,
    confirmVariant,
    onConfirm,
    onCancel,
    closeAlert,
  } = useAlertStore();

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [isOpen, details]);

  // Keyboard navigation: Enter confirms, Escape closes
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (onCancel) onCancel();
        closeAlert();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (onConfirm) onConfirm();
        closeAlert();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, onConfirm, onCancel, closeAlert]);

  if (!isOpen) return null;

  const handleCopy = () => {
    const textToCopy = details || message;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const renderIcon = () => {
    switch (type) {
      case 'success':
        return (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.15)]">
            <CheckCircle2 className="h-6 w-6 stroke-[2.2]" />
          </div>
        );
      case 'error':
        return (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.15)]">
            <XCircle className="h-6 w-6 stroke-[2.2]" />
          </div>
        );
      case 'warning':
        return (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.15)]">
            <AlertTriangle className="h-6 w-6 stroke-[2.2]" />
          </div>
        );
      case 'confirm':
        return (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.15)]">
            <HelpCircle className="h-6 w-6 stroke-[2.2]" />
          </div>
        );
      case 'info':
      default:
        return (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.15)]">
            <Info className="h-6 w-6 stroke-[2.2]" />
          </div>
        );
    }
  };

  const getConfirmBtnStyle = () => {
    if (confirmVariant === 'emerald' || type === 'success') {
      return 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/40 shadow-sm';
    }
    if (confirmVariant === 'rose' || (type === 'confirm' && isDanger)) {
      return 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/40 shadow-sm';
    }
    if (confirmVariant === 'blue') {
      return 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-950/40 shadow-sm';
    }
    if (type === 'error') {
      return 'bg-[#252834] hover:bg-[#2e3242] border border-[#3b3f52] text-zinc-200';
    }
    if (type === 'warning') {
      return 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-950/40 shadow-sm';
    }
    return 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-950/40 shadow-sm';
  };

  const env = connectionContext?.envType;
  const modalBorderClass =
    env === 'prod'
      ? 'border-rose-500/50'
      : env === 'dev'
      ? 'border-emerald-500/45'
      : 'border-[#2b2e3a]';

  const renderConnectionContext = () => {
    if (!connectionContext) return null;

    const isProd = connectionContext.envType === 'prod';
    const isDev = connectionContext.envType === 'dev';
    const envLabel = isProd ? 'PROD' : isDev ? 'DEV' : 'NORMAL';
    const dotColor =
      connectionContext.colorTag ||
      (isProd ? '#ef4444' : isDev ? '#10b981' : '#71717a');

    const cardClass = isProd
      ? 'border-rose-500/40 bg-rose-950/30'
      : isDev
      ? 'border-emerald-500/35 bg-emerald-950/25'
      : 'border-[#2b2e3a] bg-[#1a1c24]';

    const badgeClass = isProd
      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
      : isDev
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      : 'bg-zinc-500/15 text-zinc-300 border-zinc-600/40';

    const dbDisplay =
      connectionContext.database &&
      connectionContext.schema &&
      connectionContext.schema !== connectionContext.database &&
      connectionContext.schema !== connectionContext.targetName
        ? `${connectionContext.database} (${connectionContext.schema})`
        : connectionContext.database || connectionContext.schema || '';

    return (
      <div className={`rounded-xl border p-3 space-y-2 text-xs ${cardClass}`}>
        <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0 ring-2 ring-white/10"
              style={{ backgroundColor: dotColor }}
            />
            <Server className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
            <span className="font-semibold text-zinc-100 truncate">
              {connectionContext.connectionName}
            </span>
            {connectionContext.driver && (
              <span className="text-[10px] font-mono uppercase text-zinc-400 shrink-0">
                ({connectionContext.driver})
              </span>
            )}
          </div>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase font-mono border shrink-0 ${badgeClass}`}
          >
            {envLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-1.5 text-[11px]">
          {connectionContext.location && (
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
              <span className="text-zinc-400 shrink-0 w-16">Location</span>
              <span className="font-mono text-zinc-200 truncate" title={connectionContext.location}>
                {connectionContext.location}
              </span>
            </div>
          )}

          {dbDisplay && (
            <div className="flex items-center gap-2 min-w-0">
              <Database className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
              <span className="text-zinc-400 shrink-0 w-16">Database</span>
              <span className="font-mono text-zinc-200 truncate" title={dbDisplay}>
                {dbDisplay}
              </span>
            </div>
          )}

          {connectionContext.targetName && (
            <div className="flex items-center gap-2 min-w-0">
              <Table2 className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
              <span className="text-zinc-400 shrink-0 w-16">
                {connectionContext.targetLabel || 'Table'}
              </span>
              <span
                className="font-mono font-semibold text-zinc-100 truncate"
                title={connectionContext.targetName}
              >
                {connectionContext.targetName}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => {
        if (onCancel) onCancel();
        closeAlert();
      }}
    >
      <div
        className={`w-full max-w-md rounded-2xl border ${modalBorderClass} bg-[#14151a] p-6 shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col gap-4 text-zinc-200`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Icon + Title + Close button */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5">
            {renderIcon()}
            <div>
              <h3 className="text-base font-semibold text-zinc-100 tracking-tight">
                {title}
              </h3>
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                {type === 'confirm' ? 'ACTION REQUIRED' : `${type.toUpperCase()} NOTIFICATION`}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (onCancel) onCancel();
              closeAlert();
            }}
            className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-[#20222a] transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Connection & Target Context */}
        {renderConnectionContext()}

        {/* Message Body */}
        <div className="text-xs text-zinc-300 leading-relaxed pl-0.5">
          {message}
        </div>

        {/* Optional Error/Detail Box */}
        {details && (
          <div className="relative rounded-xl border border-rose-900/40 bg-[#0e0f14] p-3 text-xs font-mono text-rose-300/90 max-h-48 overflow-y-auto space-y-1.5 shadow-inner">
            <div className="flex items-center justify-between text-[10px] text-zinc-500 uppercase tracking-wider font-sans border-b border-rose-950/60 pb-1.5">
              <span>Error Details</span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="Copy error details"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed select-text font-mono">
              {details}
            </pre>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#232530]">
          {type === 'confirm' && (
            <button
              type="button"
              onClick={() => {
                if (onCancel) onCancel();
                closeAlert();
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1f2129] hover:bg-[#2a2d38] border border-[#2d303f] text-zinc-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
            >
              <span>{cancelLabel}</span>
              <kbd className="text-[10px] text-zinc-500 font-mono bg-[#14151a] px-1 rounded border border-[#2d303f]">Esc</kbd>
            </button>
          )}

          <button
            type="button"
            autoFocus
            onClick={() => {
              if (onConfirm) onConfirm();
              closeAlert();
            }}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${getConfirmBtnStyle()}`}
          >
            <span>{confirmLabel}</span>
            <kbd className="text-[10px] opacity-75 font-mono px-1 rounded bg-black/20">↵ Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  );
};

