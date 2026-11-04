import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useSettingsStore, CopyFormat } from '../../stores/useSettingsStore';

export const COPY_FORMAT_LABELS: Record<CopyFormat, string> = {
  csv: 'CSV',
  json: 'JSON',
  sql_insert: 'SQL INSERT',
  sql_update: 'SQL UPDATE',
  sql_upsert: 'SQL UPSERT',
};

export const CopyFormatSelector: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const copyFormat = useSettingsStore((state) => state.copyFormat);
  const setCopyFormat = useSettingsStore((state) => state.setCopyFormat);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, []);

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 h-6 px-2 rounded bg-[#1e2029] hover:bg-[#282a36] text-[11px] font-mono text-zinc-300 hover:text-white border border-[#2d303e] transition-colors cursor-pointer"
        title="Format yang disalin saat melakukan Copy (Ctrl+C)"
      >
        <span className="text-[10px] text-zinc-500 uppercase font-sans">Copy:</span>
        <span className="font-semibold text-sky-400">{COPY_FORMAT_LABELS[copyFormat] || 'CSV'}</span>
        <ChevronDown className="h-3 w-3 text-zinc-400" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 min-w-[140px] rounded-lg border border-[#2e313d] bg-[#181920]/95 backdrop-blur-md p-1 shadow-2xl z-50 text-[11px] text-zinc-300 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-[#272932] mb-1">
            Copy Format
          </div>
          {(['csv', 'json', 'sql_insert', 'sql_update', 'sql_upsert'] as CopyFormat[]).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => {
                setCopyFormat(fmt);
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                copyFormat === fmt
                  ? 'bg-blue-600 text-white font-medium'
                  : 'hover:bg-zinc-800 text-zinc-300'
              }`}
            >
              <span>{COPY_FORMAT_LABELS[fmt]}</span>
              {copyFormat === fmt && <Check className="h-3 w-3 text-white ml-2" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

