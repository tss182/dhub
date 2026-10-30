import React, { useRef, useCallback } from 'react';
import Editor, { OnMount, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

loader.config({ monaco });
import { Play, Square, Database, Terminal, ChevronDown } from 'lucide-react';
import { ConnectionConfig } from '../../types/domain';

interface SqlWorksheetProps {
  sql: string;
  connectionId?: string;
  connections?: ConnectionConfig[];
  database: string;
  schema: string;
  availableDatabases?: string[];
  isRunning: boolean;
  schemaMetadata?: Array<{ table: string; columns: Array<{ name: string; dataType: string }> }>;
  onChange: (value: string) => void;
  onExecute: (statementSql: string) => void;
  onCancel: () => void;
  onDatabaseChange?: (newDatabase: string) => void;
  onConnectionChange?: (newConnectionId: string) => void;
}

export const SqlWorksheet: React.FC<SqlWorksheetProps> = ({
  sql,
  connectionId,
  connections = [],
  database,
  schema,
  availableDatabases = [],
  isRunning,
  schemaMetadata = [],
  onChange,
  onExecute,
  onCancel,
  onDatabaseChange,
  onConnectionChange,
}) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const extractActiveStatement = useCallback((): string => {
    const editor = editorRef.current;
    if (!editor) return sql;

    const selection = editor.getSelection();
    if (selection && !selection.isEmpty()) {
      return editor.getModel()?.getValueInRange(selection) || sql;
    }

    const model = editor.getModel();
    const pos = editor.getPosition();
    if (!model || !pos) return sql;

    const fullText = model.getValue();
    const offset = model.getOffsetAt(pos);

    const before = fullText.lastIndexOf(';', Math.max(0, offset - 1));
    const after = fullText.indexOf(';', offset);

    const startIdx = before === -1 ? 0 : before + 1;
    const endIdx = after === -1 ? fullText.length : after;

    const candidate = fullText.slice(startIdx, endIdx).trim();
    return candidate || fullText.trim();
  }, [sql]);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Shortcut Ctrl+Enter to execute statement at cursor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      const stmt = extractActiveStatement();
      if (stmt) onExecute(stmt);
    });

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

  const currentConn = connections.find((c) => c.id === connectionId);

  return (
    <div className="flex h-full flex-col bg-[#191a20]">
      {/* Worksheet Toolbar */}
      <div className="flex h-10 items-center justify-between border-b border-[#272932] px-3 text-xs bg-[#14151a]">
        <div className="flex items-center gap-2">
          {!isRunning ? (
            <button
              onClick={() => onExecute(extractActiveStatement())}
              className="flex items-center gap-1.5 rounded bg-emerald-600/90 px-2.5 py-1 font-medium text-white hover:bg-emerald-500 transition-colors shadow-sm cursor-pointer"
              title="Execute Statement at Cursor (Ctrl+Enter)"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>Run</span>
            </button>
          ) : (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 rounded bg-rose-600/90 px-2.5 py-1 font-medium text-white hover:bg-rose-500 transition-colors shadow-sm cursor-pointer"
              title="Stop Execution (Ctrl+F2)"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>Stop</span>
            </button>
          )}

          <div className="h-4 w-[1px] bg-[#272932] mx-1" />

          {/* Independent Connection & Database Selector for this Console */}
          <div className="flex items-center gap-1.5 rounded bg-[#1e2027] px-2 py-0.5 border border-[#272932]">
            {/* Connection Selector */}
            {connections && connections.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: currentConn?.colorTag || '#71717a' }}
                />
                <select
                  value={connectionId || ''}
                  onChange={(e) => onConnectionChange?.(e.target.value)}
                  className="bg-transparent text-[11px] text-zinc-300 font-medium focus:outline-none cursor-pointer max-w-[120px] truncate"
                  title="Switch Connection for this Console"
                >
                  <option value="" disabled className="bg-[#191a20] text-zinc-400">
                    Select Connection
                  </option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id} className="bg-[#191a20] text-zinc-200">
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-zinc-500" />
                <span className="text-[11px] text-zinc-400">No Connection</span>
              </div>
            )}

            <span className="text-zinc-600 font-mono">/</span>

            {/* Database Dropdown Selector */}
            <div className="flex items-center gap-1">
              <Database className="h-3 w-3 text-blue-400 shrink-0" />
              <select
                value={database || ''}
                onChange={(e) => onDatabaseChange?.(e.target.value)}
                className="bg-transparent text-[11px] font-mono text-amber-300 font-semibold focus:outline-none cursor-pointer"
                title="Target Database for this Console (Independent)"
              >
                {availableDatabases && availableDatabases.length > 0 ? (
                  availableDatabases.map((db) => (
                    <option key={db} value={db} className="bg-[#191a20] text-zinc-200 font-mono">
                      {db}
                    </option>
                  ))
                ) : (
                  <option value={database || 'main'} className="bg-[#191a20] text-zinc-200 font-mono">
                    {database || 'main'}
                  </option>
                )}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-zinc-400">
          <Terminal className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-[11px] text-zinc-400">Ctrl+Enter to Execute</span>
        </div>
      </div>

      {/* Monaco Editor Container */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage="sql"
          theme="vs-dark"
          value={sql}
          onChange={(v) => onChange(v ?? '')}
          onMount={handleEditorDidMount}
          options={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            lineHeight: 20,
            minimap: { enabled: false },
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
