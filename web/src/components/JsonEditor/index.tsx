import { lazy, Suspense, type CSSProperties, type ReactNode } from 'react';
import type { EditorProps } from '@monaco-editor/react';
import { Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '@/stores/useThemeStore';
import './style.css';

const NativeEditor = lazy(() => import('./MonacoEditor'));
export interface JsonEditorProps {
  value?: string;
  onChange?: (value: string | undefined) => void;
  onValidate?: EditorProps['onValidate'];
  height?: CSSProperties['height'];
  error?: ReactNode;
  readOnly?: boolean;
  ariaLabel?: string;
}
/** Local editor assets load on demand; controlled content stays with the editing form. */
export function JsonEditor({ value, onChange, onValidate, height = 200, error, readOnly = false, ariaLabel }: JsonEditorProps) {
  const mode = useThemeStore(state => state.mode);
  const { t } = useTranslation();
  return <div className="client-json-editor" data-invalid={error ? 'true' : undefined}>
    <Suspense fallback={<div className="client-json-loading" style={{ height }}><Spin aria-label={t('components.jsonEditor.loading')} /></div>}>
      <NativeEditor value={value ?? ''} onChange={onChange} onValidate={onValidate} language="json" height={height} colorMode={mode} options={{
        ariaLabel, readOnly, automaticLayout: true, wordWrap: 'on', minimap: { enabled: false }, folding: false,
        lineNumbers: 'off', lineNumbersMinChars: 0, lineDecorationsWidth: 0, glyphMargin: false,
        scrollBeyondLastLine: false, tabSize: 2, insertSpaces: true, formatOnPaste: true,
        overviewRulerLanes: 0, hideCursorInOverviewRuler: true,
        scrollbar: { useShadows: false, vertical: 'auto', horizontal: 'auto' },
      }} />
    </Suspense>
    {error ? <div className="client-json-error" role="alert">{error}</div> : null}
  </div>;
}
