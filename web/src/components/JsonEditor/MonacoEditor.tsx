import Editor, { loader, type EditorProps } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import 'monaco-editor/language/json/monaco.contribution.js';
import { useLayoutEffect } from 'react';
import { defineMonacoThemes, MONACO_THEME_NAMES } from './monacoTheme';
import { readCssColorToken } from '@/design/tokens';

(globalThis as typeof globalThis & { MonacoEnvironment: { getWorker(moduleId: string, label: string): Worker } }).MonacoEnvironment = {
  getWorker: (_moduleId, label) => label === 'json' ? new JsonWorker() : new EditorWorker(),
};
loader.config({ monaco });
export default function LocalJsonEditor({ colorMode, ...props }: EditorProps & { colorMode: 'light' | 'dark' }) {
  useLayoutEffect(() => { defineMonacoThemes(readCssColorToken); }, [colorMode]);
  return <Editor {...props} theme={MONACO_THEME_NAMES[colorMode]} beforeMount={() => defineMonacoThemes(readCssColorToken)} />;
}
