import { editor } from 'monaco-editor/editor/editor.api.js';
export const MONACO_THEME_NAMES = { light: 'shadowvpn-light', dark: 'shadowvpn-dark' } as const;
/** Map the application's semantic palette through Monaco's public theme API. */
export function defineMonacoThemes(read: (name: string) => string): void {
  const color = (name: string): string => {
    const value = read(`--ds-color-${name}`).trim();
    return /^#[\da-f]{3}$/i.test(value) ? `#${[...value.slice(1)].map(c => c + c).join('')}` : value;
  };
  for (const mode of ['light', 'dark'] as const) editor.defineTheme(MONACO_THEME_NAMES[mode], {
    base: mode === 'light' ? 'vs' : 'vs-dark', inherit: true, rules: [],
    colors: {
      'editor.background': color('surface'), 'editor.foreground': color('text'),
      'editorCursor.foreground': color('text'), 'editor.lineHighlightBackground': color('surface-subtle'),
      'editor.selectionBackground': color('info-surface'), 'editor.inactiveSelectionBackground': color('surface-muted'),
      'editorWidget.background': color('surface'), 'editorWidget.border': color('border'),
    },
  });
}
