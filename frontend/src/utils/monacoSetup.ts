/// <reference types="vite/client" />
import { loader } from '@monaco-editor/react';
import * as monacoApi from 'monaco-editor/editor/editor.api.js';

// Workers (editor + json only; excludes ts.worker 6.9MB, css.worker 1.1MB, html.worker 743KB)
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';

// Languages used by DHub (SQL dialects, Redis, HTML, XML, JSON)
import 'monaco-editor/languages/definitions/sql/register.js';
import 'monaco-editor/languages/definitions/pgsql/register.js';
import 'monaco-editor/languages/definitions/mysql/register.js';
import 'monaco-editor/languages/definitions/redis/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/features/json/register.js';

// Essential editor widget & contributions for SQL/JSON editing
import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/features/find/register.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/fontZoom/browser/fontZoom.js';
import 'monaco-editor/editor/contrib/format/browser/formatActions.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/editor/contrib/lineSelection/browser/lineSelection.js';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/editor/contrib/links/browser/links.js';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/editor/contrib/smartSelect/browser/smartSelect.js';
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js';

const monaco = monacoApi as unknown as typeof import('monaco-editor');

if (typeof self !== 'undefined' && !(self as unknown as Record<string, unknown>).MonacoEnvironment) {
  (self as unknown as Record<string, unknown>).MonacoEnvironment = {
    getWorker(_: unknown, label: string) {
      if (label === 'json') {
        return new jsonWorker();
      }
      return new editorWorker();
    },
  };
}

loader.config({ monaco });

// Register custom 'mongodb' Monarch language & MQL completions
if (monaco?.languages && !monaco.languages.getLanguages().some((l) => l.id === 'mongodb')) {
  monaco.languages.register({ id: 'mongodb' });
  monaco.languages.setMonarchTokensProvider('mongodb', {
    keywords: [
      'use', 'show', 'dbs', 'databases', 'collections', 'tables', 'users', 'roles', 'profile',
      'db', 'rs', 'sh', 'true', 'false', 'null', 'new',
      'ObjectId', 'ISODate', 'Date', 'NumberInt', 'NumberLong', 'NumberDecimal', 'UUID', 'RegExp',
    ],
    operators: [
      '$match', '$group', '$project', '$sort', '$limit', '$skip', '$unwind', '$lookup',
      '$addFields', '$set', '$unset', '$count', '$out', '$merge', '$facet', '$sample',
      '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$and', '$or', '$not', '$nor',
      '$exists', '$type', '$regex', '$options', '$elemMatch', '$size', '$all',
      '$inc', '$push', '$pull', '$addToSet', '$rename', '$sum', '$avg', '$min', '$max',
    ],
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/\$(?:[a-zA-Z0-9_]+)/, 'keyword'],
        [/[a-zA-Z_][\w]*/, {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        }],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/\/([^/\\\n]|\\.)+\/[gimsuy]*/, 'regexp'],
        [/\d+(\.\d+)?/, 'number'],
        [/[{}()\[\]]/, '@brackets'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  });

  monaco.languages.registerCompletionItemProvider('mongodb', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const suggestions = [
        'find', 'findOne', 'aggregate', 'countDocuments', 'estimatedDocumentCount', 'distinct',
        'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne',
        'findOneAndUpdate', 'findOneAndDelete', 'deleteOne', 'deleteMany',
        'createIndex', 'getIndexes', 'dropIndex', 'hideIndex', 'unhideIndex',
        'stats', 'validate', 'explain', 'sort', 'skip', 'limit', 'projection', 'hint',
        'ObjectId', 'ISODate', 'NumberDecimal', 'NumberLong', 'UUID',
        '$match', '$group', '$project', '$sort', '$limit', '$skip', '$unwind', '$lookup',
        '$set', '$unset', '$inc', '$push', '$pull', '$in', '$nin', '$gt', '$gte', '$lt', '$lte', '$regex', '$exists',
      ].map((label) => ({
        label,
        kind: label.startsWith('$')
          ? monaco.languages.CompletionItemKind.Operator
          : monaco.languages.CompletionItemKind.Method,
        insertText: label,
        range,
      }));
      return { suggestions };
    },
  });
}

export { monaco };
