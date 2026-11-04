import React, { useState, useEffect, useMemo, useRef } from 'react';
import Editor, { OnMount, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
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
  Minimize2,
  Maximize2,
  CheckCircle2,
  AlertTriangle,
  Edit3,
} from 'lucide-react';

loader.config({ monaco });

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
  onSave?: (newValue: any) => void;
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

  // Check XML (starts with <?xml or starts and ends with <tag> without typical HTML tags)
  if (
    trimmed.startsWith('<?xml') ||
    (trimmed.startsWith('<') && trimmed.endsWith('>') && !/<(html|body|div|p|span|table|tr|td|th|h[1-6]|ul|ol|li|a|b|i|em|strong|br|style)\b/i.test(trimmed))
  ) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(trimmed, 'application/xml');
      if (!doc.querySelector('parsererror')) {
        return 'xml';
      }
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

  // Fallback check for XML
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return 'xml';
  }

  return 'text';
}

function formatXmlBeauty(xml: string): { formatted: string; isValid: boolean; error?: string } {
  if (!xml || typeof xml !== 'string') return { formatted: '', isValid: true };
  const trimmed = xml.trim();

  // Validate XML with DOMParser
  let isValid = true;
  let errorMsg: string | undefined;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(trimmed, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      isValid = false;
      errorMsg = parserError.textContent?.slice(0, 100) || 'Invalid XML syntax';
    }
  } catch (err: any) {
    isValid = false;
    errorMsg = err?.message || 'Invalid XML syntax';
  }

  // Pretty format XML
  try {
    const PADDING = '  ';
    const reg = /(>)(<)(\/*)/g;
    let formatted = '';
    let pad = 0;

    const normalized = trimmed.replace(reg, '$1\r\n$2$3');
    const lines = normalized.split('\r\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      let indent = 0;
      if (line.match(/.+<\/\w[^>]*>$/)) {
        // Tag with content and closing tag on same line: <tag>content</tag>
        indent = 0;
      } else if (line.match(/^<\/\w/)) {
        // Closing tag: </tag>
        if (pad !== 0) {
          pad -= 1;
        }
      } else if (line.match(/^<\w[^>]*[^\/]>.*$/) && !line.startsWith('<?') && !line.startsWith('<!')) {
        // Opening tag: <tag> (not self-closing and not declaration)
        indent = 1;
      } else {
        indent = 0;
      }

      formatted += PADDING.repeat(pad) + line + '\n';
      pad += indent;
    }

    return { formatted: formatted.trim(), isValid, error: errorMsg };
  } catch {
    return { formatted: xml, isValid, error: errorMsg };
  }
}

function minifyXml(xml: string): string {
  try {
    return xml
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/>\s+</g, '><')
      .trim();
  } catch {
    return xml;
  }
}

function formatJsonBeauty(str: string): { formatted: string; isValid: boolean; error?: string } {
  if (!str || typeof str !== 'string') return { formatted: '', isValid: true };
  try {
    let parsed = JSON.parse(str);
    // Handle double-escaped JSON string (e.g. "\"{\\\"a\\\":1}\"")
    if (typeof parsed === 'string') {
      const inner = parsed.trim();
      if ((inner.startsWith('{') && inner.endsWith('}')) || (inner.startsWith('[') && inner.endsWith(']'))) {
        try {
          parsed = JSON.parse(inner);
        } catch {}
      }
    }
    return {
      formatted: JSON.stringify(parsed, null, 2),
      isValid: true,
    };
  } catch (err: any) {
    return {
      formatted: str,
      isValid: false,
      error: err?.message || 'Invalid JSON syntax',
    };
  }
}

function minifyJson(str: string): string {
  try {
    let parsed = JSON.parse(str);
    if (typeof parsed === 'string') {
      const inner = parsed.trim();
      if ((inner.startsWith('{') && inner.endsWith('}')) || (inner.startsWith('[') && inner.endsWith(']'))) {
        try {
          parsed = JSON.parse(inner);
        } catch {}
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return str;
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
  onSave,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<ValueFormat>('auto');
  const [htmlViewMode, setHtmlViewMode] = useState<'preview' | 'source'>('preview');
  const [htmlTheme, setHtmlTheme] = useState<'light' | 'dark'>('light');
  const [wordWrap, setWordWrap] = useState<boolean>(true);
  const [isPretty, setIsPretty] = useState<boolean>(true); // Pretty (beauty) vs Minified
  const [copied, setCopied] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active editable text buffer
  const [editorText, setEditorText] = useState<string>('');
  const lastLoadedTextRef = useRef<string>('');

  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(width);
  const prevWidthRef = useRef<number>(width);

  const handleToggleExpand = () => {
    if (isExpanded) {
      onWidthChange(prevWidthRef.current || 450);
      setIsExpanded(false);
    } else {
      prevWidthRef.current = width;
      const maxAvailable = typeof window !== 'undefined' ? Math.max(500, window.innerWidth - 200) : 1000;
      const targetWidth = typeof window !== 'undefined' ? Math.min(maxAvailable, Math.round(window.innerWidth * 0.6)) : 750;
      onWidthChange(targetWidth);
      setIsExpanded(true);
    }
  };

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

  // Base formatted content from cell's current raw value
  const { formattedText, isValid, validationError } = useMemo(() => {
    if (stringValue === null) return { formattedText: '', isValid: true, validationError: undefined };

    if (activeFormat === 'json') {
      if (!isPretty) {
        return { formattedText: minifyJson(stringValue), isValid: true, validationError: undefined };
      }
      const res = formatJsonBeauty(stringValue);
      return { formattedText: res.formatted, isValid: res.isValid, validationError: res.error };
    }

    if (activeFormat === 'xml') {
      if (!isPretty) {
        return { formattedText: minifyXml(stringValue), isValid: true, validationError: undefined };
      }
      const res = formatXmlBeauty(stringValue);
      return { formattedText: res.formatted, isValid: res.isValid, validationError: res.error };
    }

    if (activeFormat === 'html') {
      if (!isPretty && htmlViewMode === 'source') {
        return { formattedText: minifyXml(stringValue), isValid: true, validationError: undefined };
      }
      const res = formatXmlBeauty(stringValue);
      return { formattedText: res.formatted, isValid: true, validationError: undefined };
    }

    return { formattedText: stringValue, isValid: true, validationError: undefined };
  }, [stringValue, activeFormat, isPretty, htmlViewMode]);

  // Sync editor buffer whenever the active cell or its base formatted text changes
  const cellKey = `${rowIndex}_${columnIndex}_${columnName}_${rawValue}_${activeFormat}_${isPretty}`;
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setEditorText(formattedText);
    lastLoadedTextRef.current = formattedText;
  }, [cellKey, formattedText]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Directly update datagridview as user types, with debounce
  const handleEditorChange = (newVal: string | undefined) => {
    const val = newVal ?? '';
    setEditorText(val);

    if (onSave) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        onSave(val);
      }, 250);
    }
  };

  // Keyboard shortcuts inside Monaco Editor (Ctrl+S / Cmd+S, Ctrl+Enter / Cmd+Enter: flush immediately)
  const handleEditorDidMount: OnMount = (editor, monacoInstance) => {
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (onSave) onSave(editor.getValue());
    });
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (onSave) onSave(editor.getValue());
    });
  };

  // Copy handler
  const handleCopy = async () => {
    const textToCopy = editorText || formattedText || stringValue || '';
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
    const content = editorText || formattedText || stringValue || '';
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
      const maxAvailable = typeof window !== 'undefined' ? Math.max(400, window.innerWidth - 200) : 1200;
      const newWidth = Math.max(240, Math.min(maxAvailable, startWidthRef.current + delta));
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', handleMouseMove, { capture: true });
    window.addEventListener('mouseup', handleMouseUp, { capture: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove, { capture: true });
      window.removeEventListener('mouseup', handleMouseUp, { capture: true });
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, onWidthChange]);

  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    setIsResizing(true);
  };

  if (!isOpen) return null;

  // HTML document for preview iframe (uses editorText so user edits reflect in live preview)
  const currentHtmlContent = editorText || stringValue || '';
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
  ${currentHtmlContent}
</body>
</html>
`;

  // Determine Monaco language
  const monacoLanguage =
    activeFormat === 'json'
      ? 'json'
      : activeFormat === 'xml'
      ? 'xml'
      : activeFormat === 'html'
      ? 'html'
      : 'plaintext';

  return (
    <div
      className="relative flex flex-col h-full bg-[#14151a] border-l border-[#272932] shadow-2xl z-20 shrink-0 select-none"
      style={{ width }}
    >
      {/* Full-screen mouse capture backdrop while dragging to prevent iframes/Monaco from stealing events */}
      {isResizing && (
        <div
          className="fixed inset-0 z-[99999] cursor-col-resize select-none bg-transparent"
          style={{ cursor: 'col-resize' }}
        />
      )}

      {/* Resizer Splitter Handle */}
      <div
        onMouseDown={handleStartResize}
        onDoubleClick={() => {
          onWidthChange(450);
          setIsExpanded(false);
        }}
        className="absolute left-0 top-0 bottom-0 w-3 -ml-1.5 cursor-col-resize hover:bg-blue-500/20 active:bg-blue-500/30 transition-colors z-40 group flex items-center justify-center select-none"
        title="Drag to resize panel (Double-click to reset width to 450px)"
      >
        <div className={`w-[2px] h-full transition-colors ${isResizing ? 'bg-blue-400' : 'bg-transparent group-hover:bg-blue-400/80'}`} />
      </div>

      {/* Panel Header */}
      <div className="flex h-9 items-center justify-between border-b border-[#272932] px-2.5 bg-[#181920] shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#20222b] text-zinc-200 text-xs font-medium border border-[#2b2e3a]">
            <Globe className="h-3.5 w-3.5 text-blue-400" />
            <span className="font-semibold">View As</span>
          </div>

          {columnName && (
            <span
              className="text-[11px] font-mono text-zinc-400 truncate max-w-[120px] px-1.5 py-0.5 rounded bg-[#101114] border border-[#23252e]"
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
            title="Copy formatted value to clipboard"
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

          {/* Maximize / Restore width button */}
          <button
            type="button"
            onClick={handleToggleExpand}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#23252e] transition-colors cursor-pointer"
            title={isExpanded ? 'Restore width' : 'Expand / Maximize width'}
          >
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5 text-blue-400" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>

          <div className="h-3.5 w-[1px] bg-[#272932] mx-0.5" />

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-rose-950/40 hover:text-rose-300 transition-colors cursor-pointer"
            title="Close View As Panel (F7)"
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
          {/* Beauty vs Minified toggle for JSON, XML and HTML source */}
          {(activeFormat === 'json' || activeFormat === 'xml' || (activeFormat === 'html' && htmlViewMode === 'source')) && (
            <div className="flex items-center bg-[#1a1b22] p-0.5 rounded border border-[#272932]">
              <button
                type="button"
                onClick={() => setIsPretty(true)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                  isPretty
                    ? 'bg-blue-600/30 text-blue-300 font-semibold border border-blue-500/40'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Beauty Format (Indented with syntax highlighting)"
              >
                <Sparkles className="h-3 w-3 text-amber-400" />
                <span>Beauty</span>
              </button>
              <button
                type="button"
                onClick={() => setIsPretty(false)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                  !isPretty
                    ? 'bg-blue-600/30 text-blue-300 font-semibold border border-blue-500/40'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Minify / Compact into one line"
              >
                <Minimize2 className="h-3 w-3 text-cyan-400" />
                <span>Compact</span>
              </button>
            </div>
          )}

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
                  title="View & Edit HTML Source Code"
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

      {/* Validation status notification bar for JSON & XML */}
      {(activeFormat === 'json' || activeFormat === 'xml') && stringValue !== null && (
        <div className={`px-2.5 py-1 border-b text-[10px] font-mono flex items-center justify-between ${
          isValid
            ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-400'
            : 'bg-amber-950/30 border-amber-900/40 text-amber-300'
        }`}>
          <div className="flex items-center gap-1.5 truncate">
            {isValid ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                <span>Valid {activeFormat.toUpperCase()} • Beauty Formatted</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                <span className="truncate">Syntax Warning: {validationError || `Invalid ${activeFormat.toUpperCase()}`}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-zinc-400 flex items-center gap-1">
              <Edit3 className="h-2.5 w-2.5 text-zinc-500" />
              <span>Editable</span>
            </span>
            <span className="text-[9px] text-zinc-500 uppercase">{isPretty ? 'Beauty' : 'Compact'}</span>
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 min-h-0 relative overflow-hidden bg-[#101114]">
        {stringValue === null && !editorText ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 select-none p-4 text-center">
            <Info className="h-8 w-8 text-zinc-600 mb-2" />
            <span className="font-mono text-sm text-zinc-400 italic">NULL</span>
            <span className="text-xs text-zinc-600 mt-1">This cell has no value</span>
            {onSave && (
              <button
                type="button"
                onClick={() => setEditorText('')}
                className="mt-3 px-2.5 py-1 rounded bg-[#20222b] hover:bg-[#2b2e3a] text-zinc-300 text-xs transition-colors cursor-pointer border border-[#2b2e3a]"
              >
                Set Value
              </button>
            )}
          </div>
        ) : activeFormat === 'html' && htmlViewMode === 'preview' ? (
          <div className="w-full h-full relative">
            <iframe
              title="HTML Value Preview"
              srcDoc={htmlDoc}
              sandbox="allow-same-origin allow-popups"
              className="w-full h-full border-0 select-text"
            />
            {/* Quick button to edit HTML source */}
            <button
              type="button"
              onClick={() => setHtmlViewMode('source')}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#181920]/90 backdrop-blur-md border border-[#2e313d] text-zinc-300 hover:text-white hover:bg-[#242630] text-xs font-sans shadow-lg transition-all cursor-pointer"
              title="Switch to HTML Source code to edit"
            >
              <Code2 className="h-3.5 w-3.5 text-amber-400" />
              <span>Edit HTML Source</span>
            </button>
          </div>
        ) : (
          <div className="w-full h-full relative">
            <Editor
              height="100%"
              language={monacoLanguage}
              value={editorText}
              onChange={handleEditorChange}
              onMount={handleEditorDidMount}
              theme="vs-dark"
              options={{
                readOnly: false,
                domReadOnly: false,
                minimap: { enabled: false },
                wordWrap: wordWrap ? 'on' : 'off',
                scrollBeyondLastLine: false,
                fontSize: 12,
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                lineNumbers: 'on',
                folding: true,
                glyphMargin: false,
                lineDecorationsWidth: 6,
                lineNumbersMinChars: 3,
                automaticLayout: true,
                contextmenu: true,
                renderWhitespace: 'none',
                scrollbar: {
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8,
                },
                padding: { top: 8, bottom: 8 },
              }}
            />
          </div>
        )}
      </div>

      {/* Footer Info Status Bar */}
      <div className="flex h-7 items-center justify-between border-t border-[#22242c] px-3 bg-[#14151a] text-[10px] text-zinc-500 shrink-0 font-mono">
        <div className="flex items-center gap-2 truncate">
          <span>Format: <span className="text-zinc-300 font-medium uppercase">{activeFormat}</span></span>
          {selectedFormat === 'auto' && <span className="text-zinc-500">(detected)</span>}
          {editorText !== null && (
            <>
              <span>•</span>
              <span>{editorText.length.toLocaleString()} chars</span>
              <span>•</span>
              <span>{new Blob([editorText]).size.toLocaleString()} bytes</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 text-zinc-400">
          <span className="text-zinc-500">Live sync with grid</span>
          {rowIndex !== undefined && columnIndex !== undefined && (
            <>
              <span>•</span>
              <span>Row {rowIndex + 1}, Col {columnIndex + 1}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
