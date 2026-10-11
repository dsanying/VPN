import i18n, { type TFunction } from 'i18next';
import { initReactI18next } from 'react-i18next';
import dayjs from 'dayjs';
import 'dayjs/locale/en.js';
import 'dayjs/locale/zh-cn.js';
import chinese from './locales/zh-CN.json';
import english from './locales/en-US.json';

export const LANGUAGE_STORAGE_KEY = 'shadowvpn-lang';
export type SupportedLanguage = 'zh-CN' | 'en-US';
const languageFor = (input?: string | null): SupportedLanguage | undefined => {
  const base = input?.toLowerCase().split('-')[0];
  return base === 'zh' ? 'zh-CN' : base === 'en' ? 'en-US' : undefined;
};
export function detectLanguage(): SupportedLanguage {
  if (typeof window === 'undefined') return 'zh-CN';
  let preference: string | null = null;
  try {
    preference = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    /* Storage may be unavailable. */
  }
  return (
    languageFor(preference) ??
    languageFor(window.navigator.languages?.[0] ?? window.navigator.language) ??
    languageFor(document.documentElement.lang) ??
    'zh-CN'
  );
}
export function syncDocumentLanguage(language?: string): void {
  if (typeof document !== 'undefined')
    document.documentElement.lang = languageFor(language) ?? 'zh-CN';
}
// The shared dictionary uses single-brace interpolation. Brand names retain their spelling.
i18n
  .use(initReactI18next)
  .use({
    type: 'postProcessor',
    name: 'clientTypography',
    process(text: string, keys: string[]) {
      if (keys.includes('common.brand') || !text) return text;
      const spaced = text
        .replace(/(\p{Script=Han})([A-Za-z0-9])/gu, '$1 $2')
        .replace(/([A-Za-z0-9%])(\p{Script=Han})/gu, '$1 $2');
      return spaced.substring(0, 1).toUpperCase() + spaced.substring(1);
    },
  })
  .init({
    resources: { 'zh-CN': { translation: chinese }, 'en-US': { translation: english } },
    lng: detectLanguage(),
    fallbackLng: 'zh-CN',
    supportedLngs: ['zh-CN', 'en-US'],
    interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
    postProcess: ['clientTypography'],
  });
function applyLanguage(language?: string) {
  const selected = languageFor(language) ?? 'zh-CN';
  dayjs.locale(selected === 'zh-CN' ? 'zh-cn' : 'en');
  syncDocumentLanguage(selected);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, selected);
    } catch {
      /* Keep the in-memory choice. */
    }
  }
}
applyLanguage(i18n.resolvedLanguage ?? i18n.language);
i18n.on('languageChanged', applyLanguage);
export function tFragment(
  key: string,
  options: Record<string, unknown> = {},
  translator: TFunction = i18n.t
): string {
  return translator(key, { ...options, applyPostProcessor: false });
}
export function formatList(
  items: readonly string[],
  type: 'conjunction' | 'disjunction' = 'conjunction'
): string {
  return new Intl.ListFormat(i18n.resolvedLanguage ?? i18n.language, {
    style: 'narrow',
    type,
  }).format(items);
}
export default i18n;
