import React, { useEffect, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { CopyFormat } from '../../stores/useSettingsStore';
import { COPY_FORMAT_OPTIONS } from '../grid/CopyFormatSelector';

interface CopyAsModalProps {
  isOpen: boolean;
  defaultFormat: CopyFormat;
  selectionSummary?: string;
  onClose: () => void;
  onCopy: (format: CopyFormat) => void;
}

export const CopyAsModal: React.FC<CopyAsModalProps> = ({
  isOpen,
  defaultFormat,
  selectionSummary,
  onClose,
  onCopy,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<CopyFormat>(defaultFormat);

  useEffect(() => {
    if (isOpen) {
      setSelectedFormat(defaultFormat);
    }
  }, [isOpen, defaultFormat]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onCopy(selectedFormat);
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const currentIndex = COPY_FORMAT_OPTIONS.findIndex((o) => o.id === selectedFormat);
        const idx = currentIndex === -1 ? 0 : currentIndex;
        const nextIndex =
          e.key === 'ArrowDown'
            ? (idx + 1) % COPY_FORMAT_OPTIONS.length
            : (idx - 1 + COPY_FORMAT_OPTIONS.length) % COPY_FORMAT_OPTIONS.length;
        setSelectedFormat(COPY_FORMAT_OPTIONS[nextIndex].id);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, selectedFormat, onClose, onCopy]);

  if (!isOpen) return null;

  const selectedOption = COPY_FORMAT_OPTIONS.find((o) => o.id === selectedFormat) || COPY_FORMAT_OPTIONS[0];

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-2xl rounded-xl border border-[#2b2e3a] bg-[#191a20] shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#272932] px-4 py-3 bg-[#1e2029]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              <Copy className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-zinc-100 flex items-center gap-2">
                <span>Copy As</span>
                {selectionSummary && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400 text-[10px] font-mono font-bold">
                    {selectionSummary}
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-zinc-400">Select a format to copy the selected data</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-[#272932] hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 3-Column Format Table */}
        <div className="p-3">
          <div className="rounded-lg border border-[#272932] overflow-hidden bg-[#14151a]">
            {/* Table Header */}
            <div className="grid grid-cols-[40px_140px_1fr] items-center px-3 py-2 border-b border-[#272932] bg-[#1a1c23] text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <div className="text-center"></div>
              <div>Format</div>
              <div>Description</div>
            </div>

            {/* Rows */}
            <div className="max-h-80 overflow-y-auto divide-y divide-[#22242e]">
              {COPY_FORMAT_OPTIONS.map((opt) => {
                const isSelected = opt.id === selectedFormat;
                const isDefault = opt.id === defaultFormat;
                return (
                  <label
                    key={opt.id}
                    onClick={() => setSelectedFormat(opt.id)}
                    onDoubleClick={() => onCopy(opt.id)}
                    className={`grid grid-cols-[40px_140px_1fr] items-center px-3 py-2.5 text-xs transition-colors cursor-pointer select-none ${
                      isSelected
                        ? 'bg-blue-600/15 text-zinc-100'
                        : 'hover:bg-[#1e2028] text-zinc-300'
                    }`}
                  >
                    {/* Col 1: Radio button */}
                    <div className="flex items-center justify-center">
                      <input
                        type="radio"
                        name="copy-as-format"
                        value={opt.id}
                        checked={isSelected}
                        onChange={() => setSelectedFormat(opt.id)}
                        className="h-3.5 w-3.5 accent-blue-500 cursor-pointer"
                      />
                    </div>

                    {/* Col 2: Format Name */}
                    <div className="flex items-center gap-1.5 pr-2 font-mono font-semibold text-xs">
                      <span className={isSelected ? 'text-sky-400' : 'text-zinc-200'}>
                        {opt.label}
                      </span>
                      {isDefault && (
                        <span className="px-1 py-0.2 rounded bg-zinc-800 border border-zinc-700 text-[9px] font-sans font-normal text-zinc-400">
                          default
                        </span>
                      )}
                    </div>

                    {/* Col 3: Description (wider) */}
                    <div className="text-[11px] leading-relaxed text-zinc-400">
                      {opt.description}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#272932] px-4 py-3 bg-[#1e2029]">
          <span className="text-[10px] text-zinc-500">
            ↑↓ to navigate · Enter or double-click to copy · Esc to cancel
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-[#2b2e3a] bg-[#14151b] hover:bg-[#20222a] text-zinc-300 text-xs font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onCopy(selectedFormat)}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors cursor-pointer shadow-xs flex items-center gap-1.5"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Copy as {selectedOption?.label}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
