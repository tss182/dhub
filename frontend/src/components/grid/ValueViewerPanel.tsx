import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  WrapText,
  Sun,
  Moon,
  Eye,
  Code2,
  FileText,
  Braces,
  FileCode,
  Globe,
  Sparkles,
  Info,
} from 'lucide-react';

export type ValueFormat = 'auto' | 'html' | 'json' | 'xml' | 'text';

interface ValueViewerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  width: number;
  onWidthChange: (newWidth: number) => void;
  columnName?: string;
  columnType?: string;
  rowIndex?: number;
  columnIndex?: number;
  rawValue: any;
}

export function detectFormat(val: string): 'html' | 'json' | 'xml' | 'text' {
  if (!val || typeof val !== 'string') return 'text';
  const trimmed = val.trim();
  if (!trimmed) return 'text';

  // Check JSON
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {}
  }

  // Check HTML
  if (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<!doctype') ||
    /<(html|body|div|p|span|table|tr|td|th|h[1-6]|ul|ol|li|a|b|i|em|strong|br|style|header|footer|section|article)\b/i.test(trimmed)
  ) {
    return 'html';
  }

  // Check XML
  if (
    trimmed.startsWith('<?xml') ||
    (trimmed.startsWith('<') && trimmed.endsWith('>') && !/<(div|span|p|b|i|table|h[1-6]|a|img)\b/i.test(trimmed))
  ) {
    return 'xml';
  }

  return 'text';
}

function formatXml(xml: string): string {
  try {
    let formatted = '';
    let indent = 0;
    const tab = '  ';
    const reg = /(>)(<)(\/*)/g;
    const cleanXml = xml.replace(reg, '$1\r\n$2$3');
    cleanXml.split('\r\n').forEach((node) => {
      let pad = 0;
      if (node.match(/.+<\/\w[^>]*>$/)) {
        pad = 0;
      } else if (node.match(/^<\/\w/)) {
        if (indent !== 0) indent -= 1;
      } else if (node.match(/^<\w[^>]*[^\/]>.*$/)) {
        pad = 1;
      } else {
        pad = 0;
      }
      formatted += tab.repeat(indent) + node + '\r\n';
      indent += pad;
    });
    return formatted.trim();
  } catch {
    return xml;
  }
}

export const ValueViewerPanel: React.FC<ValueViewerPanelProps> = ({
  isOpen,
  onClose,
  width,
  onWidthChange,
  columnName,
  columnType,
  rowIndex,
  columnIndex,
  rawValue,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<ValueFormat>('auto');
  const [htmlViewMode, setHtmlViewMode] = useState<'preview' | 'source'>('preview');
  const [htmlTheme, setHtmlTheme] = useState<'light' | 'dark'>('light');
  const [wordWrap, setWordWrap] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(width);

  // Stringify or determine string representation
  const stringValue = useMemo(() => {
    if (rawValue === null || rawValue === undefined) return null;
    if (typeof rawValue === 'object') {
      try {
        return JSON.stringify(rawValue, null, 2);
      } catch {
        return String(rawValue);
      }
    }
    return String(rawValue);
  }, [rawValue]);

  // Detected format
  const autoDetectedFormat = useMemo<'html' | 'json' | 'xml' | 'text'>(() => {
    if (stringValue === null) return 'text';
    return detectFormat(stringValue);
  }, [stringValue]);

  // Active format: either manually selected or detected
  const activeFormat = selectedFormat === 'auto' ? autoDetectedFormat : selectedFormat;

  // Formatted content for display
  const { formattedText, isValid } = useMemo(() => {
    if (stringValue === null) return { formattedText: '', isValid: true };

    if (activeFormat === 'json') {
      try {
        const parsed = JSON.parse(stringValue);
        return { formattedText: JSON.stringify(parsed, null, 2), isValid: true };
      } catch {
        return { formattedText: stringValue, isValid: false };
      }
    }

    if (activeFormat === 'xml') {
      try {
        return { formattedText: formatXml(stringValue), isValid: true };
      } catch {
        return { formattedText: stringValue, isValid: false };
      }
    }

    return { formattedText: stringValue, isValid: true };
  }, [stringValue, activeFormat]);

  // Copy handler
  const handleCopy = async () => {
    const textToCopy = formattedText || stringValue || '';
    if (!textToCopy) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  // Download handler
  const handleDownload = () => {
    const content = formattedText || stringValue || '';
    if (!content) return;
    const extensions: Record<string, string> = {
      html: 'html',
      json: 'json',
      xml: 'xml',
      text: 'txt',
    };
    const ext = extensions[activeFormat] || 'txt';
    const filename = `${columnName || 'value'}_row${(rowIndex ?? 0) + 1}.${ext}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Resizing handlers
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startXRef.current - e.clientX;
      const newWidth = Math.max(280, Math.min(850, startWidthRef.current + delta));
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, onWidthChange]);

  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    setIsResizing(true);
  };

  if (!isOpen) return null;

  // HTML document for preview iframe
  const htmlDoc = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base target="_blank">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.6;
      margin: 16px;
      color: ${htmlTheme === 'dark' ? '#e4e4e7' : '#18181b'};
      background-color: ${htmlTheme === 'dark' ? '#14151a' : '#ffffff'};
      word-break: break-word;
    }
    a { color: #3b82f6; text-decoration: underline; }
    a:hover { color: #60a5fa; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 12px; }
    th, td { border: 1px solid ${htmlTheme === 'dark' ? '#27272a' : '#e4e4e7'}; padding: 6px 10px; text-align: left; }
    th { background: ${htmlTheme === 'dark' ? '#1f2028' : '#f4f4f5'}; font-weight: 600; }
    pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
    pre { background: ${htmlTheme === 'dark' ? '#1f2028' : '#f4f4f5'}; padding: 10px; border-radius: 4px; overflow-x: auto; }
    img { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  ${stringValue || ''}
</body>
</html>
`;

  return (
    <div
      className="relative flex flex-col h-full bg-[#14151a] border-l border-[#272932] shadow-2xl z-20 shrink-0 select-none"
      style={{ width }}
    >
      {/* Resizer Handle */}
      <div
        onMouseDown={handleStartResize}
        className="absolute left-0 top-0 bottom-0 w-1.5 -ml-1 cursor-col-resize hover:bg-blue-500/80 transition-colors z-30 group"
        title="Drag to resize panel"
      >
        <div className="w-0.5 h-full mx-auto group-hover:bg-blue-400/80" />
      </div>

      {/* Panel Header */}
      <div className="flex h-9 items-center justify-between border-b border-[#272932] px-2.5 bg-[#181920] shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#20222b] text-zinc-200 text-xs font-medium border border-[#2b2e3a]">
            <Globe className="h-3.5 w-3.5 text-blue-400" />
            <span className="font-semibold">Value</span>
          </div>

          {columnName && (
            <span
              className="text-[11px] font-mono text-zinc-400 truncate max-w-[140px] px-1.5 py-0.5 rounded bg-[#101114] border border-[#23252e]"
              title={`Column: ${columnName} (${columnType || 'unknown'})`}
            >
              {columnName}
            </span>
          )}
        </div>

        {/* Action Controls & Close */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            disabled={stringValue === null}
            className={`flex items-center gap-1 px-1.5 py-1 rounded text-xs transition-colors cursor-pointer ${
              copied
                ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                : 'text-zinc-400 hover:text-white hover:bg-[#23252e]'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            title="Copy value to clipboard"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="text-[10px] font-medium">{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={stringValue === null}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#23252e] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Download value as file"
          >
            <Download className="h-3.5 w-3.5" />
          </button>

          <div className="h-3.5 w-[1px] bg-[#272932] mx-0.5" />

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-rose-950/40 hover:text-rose-300 transition-colors cursor-pointer"
            title="Close Value Panel (F7)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Format Selector Toolbar */}
      <div className="flex items-center justify-between border-b border-[#22242c] px-2.5 py-1.5 bg-[#121317] shrink-0 text-xs">
        {/* Left: Format switcher tabs */}
        <div className="flex items-center gap-1 bg-[#1a1b22] p-0.5 rounded-md border border-[#272932]">
          {(['auto', 'html', 'json', 'xml', 'text'] as const).map((fmt) => {
            const isSelected = selectedFormat === fmt;
            const labels: Record<ValueFormat, { label: string; icon: any }> = {
              auto: { label: 'Auto', icon: Sparkles },
              html: { label: 'HTML', icon: Globe },
              json: { label: 'JSON', icon: Braces },
              xml: { label: 'XML', icon: FileCode },
              text: { label: 'Text', icon: FileText },
            };
            const ItemIcon = labels[fmt].icon;

            return (
              <button
                key={fmt}
                type="button"
                onClick={() => setSelectedFormat(fmt)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-xs font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#242630]'
                }`}
                title={
                  fmt === 'auto'
                    ? `Auto-detect format (Currently detected: ${autoDetectedFormat.toUpperCase()})`
                    : `View as ${fmt.toUpperCase()}`
                }
              >
                <ItemIcon className="h-3 w-3" />
                <span>{labels[fmt].label}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Format-specific toggles */}
        <div className="flex items-center gap-1 text-zinc-400">
          {activeFormat === 'html' && (
            <>
              {/* Preview vs Source */}
              <div className="flex items-center bg-[#1a1b22] p-0.5 rounded border border-[#272932]">
                <button
                  type="button"
                  onClick={() => setHtmlViewMode('preview')}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                    htmlViewMode === 'preview'
                      ? 'bg-[#2b2e3b] text-white font-medium'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="Render HTML Preview"
                >
                  <Eye className="h-3 w-3 text-sky-400" />
                  <span>Preview</span>
                </button>
                <button
                  type="button"
                  onClick={() => setHtmlViewMode('source')}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                    htmlViewMode === 'source'
                      ? 'bg-[#2b2e3b] text-white font-medium'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="View HTML Source Code"
                >
                  <Code2 className="h-3 w-3 text-amber-400" />
                  <span>Source</span>
                </button>
              </div>

              {/* Light/Dark iframe theme toggle */}
              {htmlViewMode === 'preview' && (
                <button
                  type="button"
                  onClick={() => setHtmlTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
                  className="p-1 rounded hover:bg-[#20222b] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                  title={`Switch to ${htmlTheme === 'light' ? 'Dark' : 'Light'} background`}
                >
                  {htmlTheme === 'light' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                </button>
              )}
            </>
          )}

          {activeFormat !== 'html' || htmlViewMode === 'source' ? (
            <button
              type="button"
              onClick={() => setWordWrap((prev) => !prev)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors cursor-pointer ${
                wordWrap
                  ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                  : 'bg-[#1a1b22] text-zinc-400 hover:text-white border-[#272932]'
              }`}
              title="Toggle Word Wrap"
            >
              <WrapText className="h-3 w-3" />
              <span>Wrap</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 relative overflow-hidden bg-[#101114]">
        {stringValue === null ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 select-none p-4 text-center">
            <Info className="h-8 w-8 text-zinc-600 mb-2" />
            <span className="font-mono text-sm text-zinc-400 italic">NULL</span>
            <span className="text-xs text-zinc-600 mt-1">This cell has no value</span>
          </div>
        ) : activeFormat === 'html' && htmlViewMode === 'preview' ? (
          <div className="w-full h-full relative">
            <iframe
              title="HTML Value Preview"
              srcDoc={htmlDoc}
              sandbox="allow-same-origin allow-popups"
              className="w-full h-full border-0 select-text"
            />
          </div>
        ) : (
          <div className="w-full h-full overflow-auto p-3 font-mono text-xs select-text">
            {!isValid && (
              <div className="mb-2 px-2.5 py-1 rounded bg-amber-950/40 border border-amber-800/40 text-amber-300 text-[11px] flex items-center gap-1.5">
                <Info className="h-3 w-3 shrink-0" />
                <span>Notice: Content could not be parsed strictly as {activeFormat.toUpperCase()}. Displaying raw value.</span>
              </div>
            )}
            <pre
              className={`text-zinc-200 font-mono text-[11px] leading-relaxed ${
                wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
              }`}
            >
              {formattedText}
            </pre>
          </div>
        )}
      </div>

      {/* Footer Info Status Bar */}
      <div className="flex h-7 items-center justify-between border-t border-[#22242c] px-3 bg-[#14151a] text-[10px] text-zinc-500 shrink-0 font-mono">
        <div className="flex items-center gap-2 truncate">
          <span>Format: <span className="text-zinc-300 font-medium uppercase">{activeFormat}</span></span>
          {selectedFormat === 'auto' && <span className="text-zinc-500">(detected)</span>}
          {stringValue !== null && (
            <>
              <span>•</span>
              <span>{stringValue.length.toLocaleString()} chars</span>
              <span>•</span>
              <span>{new Blob([stringValue]).size.toLocaleString()} bytes</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 text-zinc-400">
          {rowIndex !== undefined && columnIndex !== undefined && (
            <span>Row {rowIndex + 1}, Col {columnIndex + 1}</span>
          )}
        </div>
      </div>
    </div>
  );
};

