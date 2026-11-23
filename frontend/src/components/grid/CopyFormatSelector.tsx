import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useSettingsStore, CopyFormat } from '../../stores/useSettingsStore';

export interface CopyFormatOption {
  id: CopyFormat;
  label: string;
  description: string;
}

export const COPY_FORMAT_OPTIONS: CopyFormatOption[] = [
  {
    id: 'csv',
    label: 'CSV',
    description: 'Comma-separated values (RFC 4180). Ideal for pasting into Excel, Google Sheets, or text editors.',
  },
  {
    id: 'json',
    label: 'JSON',
    description: 'Array of JSON objects with column names as keys. Ideal for API payloads, scripts, or NoSQL tools.',
  },
  {
    id: 'markdown',
    label: 'Markdown Table',
    description: 'GitHub-flavored Markdown table (| col | ... |). Ideal for docs, PRs, and issue trackers.',
  },
  {
    id: 'sql_insert',
    label: 'SQL INSERT',
    description: 'Generates INSERT INTO ... VALUES (...) statements to insert selected rows into a SQL table.',
  },
  {
    id: 'sql_update',
    label: 'SQL UPDATE',
    description: 'Generates UPDATE ... SET ... WHERE ... statements based on primary keys or column values.',
  },
  {
    id: 'sql_upsert',
    label: 'SQL UPSERT',
    description: 'Generates INSERT statements with ON CONFLICT / ON DUPLICATE KEY UPDATE for insert-or-update.',
  },
  {
    id: 'qdrant_upsert',
    label: 'Qdrant Upsert REST',
    description: 'Generates PUT /collections/<name>/points?wait=true REST payload for Qdrant.',
  },
];

export const COPY_FORMAT_LABELS: Record<CopyFormat, string> = COPY_FORMAT_OPTIONS.reduce(
  (acc, opt) => {
    acc[opt.id] = opt.label;
    return acc;
  },
  {} as Record<CopyFormat, string>
);

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
        className={`flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-sans font-medium transition-colors cursor-pointer select-none ${
          isOpen
            ? 'bg-[#2b2d38] text-white'
            : 'bg-transparent hover:bg-[#2b2d38] text-zinc-300 hover:text-white'
        }`}
        title="Format yang disalin saat melakukan Copy (Ctrl+C)"
      >
        <span>{COPY_FORMAT_LABELS[copyFormat] || 'CSV'}</span>
        <ChevronDown className="h-3 w-3 text-zinc-400" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 min-w-[140px] rounded-lg border border-[#2e313d] bg-[#181920]/95 backdrop-blur-md p-1 shadow-2xl z-50 text-[11px] text-zinc-300 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-[#272932] mb-1">
            Copy Format
          </div>
          {COPY_FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setCopyFormat(opt.id);
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                copyFormat === opt.id
                  ? 'bg-blue-600 text-white font-medium'
                  : 'hover:bg-zinc-800 text-zinc-300'
              }`}
            >
              <span>{opt.label}</span>
              {copyFormat === opt.id && <Check className="h-3 w-3 text-white ml-2" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

