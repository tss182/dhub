import React, { useRef, useCallback, useState, useEffect } from 'react';
import Editor, { OnMount, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

loader.config({ monaco });
import { Play, Square, Database, Terminal, ChevronDown, Check } from 'lucide-react';
import { ConnectionConfig } from '../../types/domain';
import { useSettingsStore } from '../../stores/useSettingsStore';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);
const modKey = isMac ? 'Cmd' : 'Ctrl';

interface SqlWorksheetProps {
  sql: string;
  connection?: ConnectionConfig;
  database: string;
  schema: string;
  availableDatabases?: string[];
  isRunning: boolean;
  schemaMetadata?: Array<{ table: string; columns: Array<{ name: string; dataType: string }> }>;
  onChange: (value: string) => void;
  onExecute: (statementSql: string, explicitDatabase?: string) => void;
  onCancel: () => void;
  onDatabaseChange?: (newDatabase: string) => void;
}

export const SqlWorksheet: React.FC<SqlWorksheetProps> = ({
  sql,
  connection,
  database,
  schema,
  availableDatabases = [],
  isRunning,
  schemaMetadata = [],
  onChange,
  onExecute,
  onCancel,
  onDatabaseChange,
}) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [isDbOpen, setIsDbOpen] = useState(false);
  const dbDropdownRef = useRef<HTMLDivElement>(null);

  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const showMinimap = useSettingsStore((s) => s.showMinimap);
  const theme = useSettingsStore((s) => s.theme);

  // Keep fresh references to avoid stale closure issues inside Monaco addCommand callback
  const onExecuteRef = useRef(onExecute);
  useEffect(() => {
    onExecuteRef.current = onExecute;
  }, [onExecute]);

  const databaseRef = useRef(database);
  useEffect(() => {
    databaseRef.current = database;
  }, [database]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dbDropdownRef.current && !dbDropdownRef.current.contains(e.target as Node)) {
        setIsDbOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDbOpen(false);
    };

    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const extractActiveStatement = useCallback((): string => {
    const editor = editorRef.current;
    if (!editor) return '';

    const selection = editor.getSelection();
    if (selection && !selection.isEmpty()) {
      return editor.getModel()?.getValueInRange(selection) || '';
    }

    const model = editor.getModel();
    const pos = editor.getPosition();
    if (!model || !pos) return '';

    const fullText = model.getValue();
    const offset = model.getOffsetAt(pos);

    const before = fullText.lastIndexOf(';', Math.max(0, offset - 1));
    const after = fullText.indexOf(';', offset);

    const startIdx = before === -1 ? 0 : before + 1;
    const endIdx = after === -1 ? fullText.length : after;

    const candidate = fullText.slice(startIdx, endIdx).trim();
    return candidate || fullText.trim();
  }, []);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Shortcut Ctrl+Enter / Cmd+Enter to execute statement at cursor with fresh database ref
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      const stmt = extractActiveStatement();
      if (stmt) onExecuteRef.current(stmt, databaseRef.current);
    });

    // Intercept Ctrl+S / Cmd+S in editor to prevent browser save dialog
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {});

    // Auto-complete provider
    monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', ' '],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions: monaco.languages.CompletionItem[] = [];

        for (const item of schemaMetadata) {
          suggestions.push({
            label: item.table,
            kind: monaco.languages.CompletionItemKind.Struct,
            detail: `Table (${schema || 'default'})`,
            insertText: item.table,
            range,
          });

          for (const col of item.columns) {
            suggestions.push({
              label: `${col.name}`,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `${item.table}.${col.name} : ${col.dataType}`,
              insertText: col.name,
              range,
            });
          }
        }

        return { suggestions };
      },
    });
  };

  return (
    <div className="flex h-full flex-col bg-[#191a20]">
      {/* Worksheet Toolbar */}
      <div className="flex h-10 items-center justify-between border-b border-[#272932] px-3 text-xs bg-[#14151a]">
        <div className="flex items-center gap-2">
          {!isRunning ? (
            <button
              onClick={() => onExecute(extractActiveStatement(), database)}
              className="flex items-center gap-1.5 rounded bg-emerald-600/90 px-2.5 py-1 font-medium text-white hover:bg-emerald-500 transition-colors shadow-sm cursor-pointer"
              title={`Execute Statement at Cursor (${modKey}+Enter)`}
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>Run</span>
            </button>
          ) : (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 rounded bg-rose-600/90 px-2.5 py-1 font-medium text-white hover:bg-rose-500 transition-colors shadow-sm cursor-pointer"
              title={`Stop Execution (${modKey}+F2)`}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>Stop</span>
            </button>
          )}

          <div className="h-4 w-[1px] bg-[#272932] mx-1" />

          {/* Fixed Connection Display - No connection switching */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#1e2027] border border-[#2e313d] text-zinc-200"
            title={connection ? `${connection.name} (${connection.driver.toUpperCase()})` : 'Console'}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: connection?.colorTag || '#3b82f6' }}
            />
            <span className="font-semibold text-xs truncate max-w-[150px]">
              {connection ? connection.name : 'Console'}
            </span>
            {connection?.driver && (
              <span className="text-[9px] text-zinc-400 font-mono uppercase bg-[#14151a] px-1 py-0.2 rounded border border-[#272932]">
                {connection.driver}
              </span>
            )}
          </div>

          <span className="text-zinc-600 font-mono">/</span>

          {/* High-Contrast Custom Database Dropdown */}
          <div className="relative" ref={dbDropdownRef}>
            <button
              type="button"
              onClick={() => setIsDbOpen(!isDbOpen)}
              className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#22242c] hover:bg-[#2b2e3b] border border-[#3b3e4f] text-amber-300 font-mono text-xs font-semibold transition-colors cursor-pointer shadow-xs"
              title={database ? `${database} (Click to switch database)` : 'Click to select database'}
            >
              <Database className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <span className="truncate max-w-[160px]">{database || 'Select Database'}</span>
              <ChevronDown
                className={`h-3 w-3 text-zinc-400 shrink-0 transition-transform duration-150 ${
                  isDbOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isDbOpen && (
              <div className="absolute top-full left-0 mt-1 min-w-[210px] max-w-[320px] max-h-64 overflow-auto rounded-md border border-[#3b3e4f] bg-[#191a20] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 border-b border-[#272932] mb-1 flex items-center justify-between">
                  <span>Databases</span>
                  <span className="font-mono text-zinc-500">{availableDatabases.length}</span>
                </div>

                {availableDatabases.length === 0 ? (
                  <div className="px-2.5 py-2 text-[11px] text-zinc-500 italic">No databases found</div>
                ) : (
                  availableDatabases.map((db) => {
                    const isSelected = db === database;
                    return (
                      <div
                        key={db}
                        onClick={() => {
                          databaseRef.current = db;
                          onDatabaseChange?.(db);
                          setIsDbOpen(false);
                        }}
                        title={db}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer font-mono text-xs transition-colors ${
                          isSelected
                            ? 'bg-blue-600 text-white font-bold'
                            : 'text-zinc-200 hover:bg-[#2c303c] hover:text-white'
                        }`}
                      >
                        <span className="truncate">{db}</span>
                        {isSelected && <Check className="h-3.5 w-3.5 text-white shrink-0 ml-2" />}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-zinc-400">
          <Terminal className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-[11px] text-zinc-400">{modKey}+Enter to Execute</span>
        </div>
      </div>

      {/* Monaco Editor Container */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage="sql"
          theme={theme === 'light' ? 'vs' : 'vs-dark'}
          value={sql}
          onChange={(v) => onChange(v ?? '')}
          onMount={handleEditorDidMount}
          options={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: editorFontSize,
            lineHeight: Math.round(editorFontSize * 1.5),
            minimap: { enabled: showMinimap },
            wordWrap: wordWrap ? 'on' : 'off',
            padding: { top: 8, bottom: 8 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            renderLineHighlight: 'all',
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
};
