/// <reference types="vite/client" />
import { loader } from '@monaco-editor/react';
import * as monacoApi from 'monaco-editor/editor/editor.api.js';

// Workers (only editor, json, html — excludes 6.9MB ts.worker & 1MB css.worker)
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker';

// Only register languages used by DHub (SQL dialects, Redis, JSON, HTML, XML)
import 'monaco-editor/languages/definitions/sql/register.js';
import 'monaco-editor/languages/definitions/pgsql/register.js';
import 'monaco-editor/languages/definitions/mysql/register.js';
import 'monaco-editor/languages/definitions/redis/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/features/html/register.js';
import 'monaco-editor/languages/features/json/register.js';

// Core editor contributions (find, folding, suggest, snippets, bracket matching, hover, etc.)
import 'monaco-editor/editor/contrib/anchorSelect/browser/anchorSelect.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/caretOperations/browser/transpose.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/codeAction/browser/codeActionContributions.js';
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget.js';
import 'monaco-editor/editor/contrib/codelens/browser/codelensController.js';
import 'monaco-editor/editor/contrib/colorPicker/browser/colorPickerContribution.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js';
import 'monaco-editor/editor/contrib/dnd/browser/dnd.js';
import 'monaco-editor/editor/contrib/documentSymbols/browser/documentSymbols.js';
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/dropIntoEditorContribution.js';
import 'monaco-editor/features/find/register.js';
import 'monaco-editor/editor/contrib/floatingMenu/browser/floatingMenu.contribution.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/fontZoom/browser/fontZoom.js';
import 'monaco-editor/editor/contrib/format/browser/formatActions.js';
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError.js';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/editor/contrib/inPlaceReplace/browser/inPlaceReplace.js';
import 'monaco-editor/editor/contrib/insertFinalNewLine/browser/insertFinalNewLine.js';
import 'monaco-editor/editor/contrib/lineSelection/browser/lineSelection.js';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/editor/contrib/linkedEditing/browser/linkedEditing.js';
import 'monaco-editor/editor/contrib/links/browser/links.js';
import 'monaco-editor/editor/contrib/longLinesHelper/browser/longLinesHelper.js';
import 'monaco-editor/editor/contrib/middleScroll/browser/middleScroll.contribution.js';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints.js';
import 'monaco-editor/editor/contrib/placeholderText/browser/placeholderText.contribution.js';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneHelpQuickAccess.js';
import 'monaco-editor/editor/contrib/readOnlyMessage/browser/contribution.js';
import 'monaco-editor/editor/contrib/rename/browser/rename.js';
import 'monaco-editor/editor/contrib/smartSelect/browser/smartSelect.js';
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2.js';
import 'monaco-editor/editor/contrib/stickyScroll/browser/stickyScrollContribution.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestInlineCompletions.js';
import 'monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode.js';
import 'monaco-editor/editor/contrib/tokenization/browser/tokenization.js';
import 'monaco-editor/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter.js';
import 'monaco-editor/editor/contrib/unusualLineTerminators/browser/unusualLineTerminators.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js';
import 'monaco-editor/editor/contrib/wordPartOperations/browser/wordPartOperations.js';
import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js';
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/common/standaloneStrings.js';

const monaco = monacoApi as unknown as typeof import('monaco-editor');

if (typeof self !== 'undefined' && !(self as unknown as Record<string, unknown>).MonacoEnvironment) {
  (self as unknown as Record<string, unknown>).MonacoEnvironment = {
    getWorker(_: unknown, label: string) {
      if (label === 'json') {
        return new jsonWorker();
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker();
      }
      return new editorWorker();
    },
  };
}

loader.config({ monaco });

export { monaco };
