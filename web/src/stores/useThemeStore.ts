import { create } from 'zustand';
import { readCssColorToken, type ThemeMode } from '@/design/tokens';

export type ThemePreference = ThemeMode | 'system';
export const THEME_STORAGE_KEY = 'shadowvpn-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
export function resolveThemeMode(preference: ThemePreference, systemDark: boolean): ThemeMode {
  if (preference !== 'system') return preference;
  return systemDark ? 'dark' : 'light';
}
export function readPersistedThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch { /* Private storage may be unavailable. */ }
  return 'system';
}
export function applyThemeMode(mode: ThemeMode): void {
  const element = document.documentElement;
  element.setAttribute('data-theme', mode);
  element.style.setProperty('color-scheme', mode);
  element.style.setProperty('background-color', 'var(--ds-color-canvas)');
  element.style.setProperty('color', 'var(--ds-color-text)');
  for (const name of ['dark', 'light']) element.classList.toggle(name, name === mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', readCssColorToken('--ds-color-canvas'));
}
export function bootstrapPersistedTheme(): void {
  applyThemeMode(resolveThemeMode(readPersistedThemePreference(), media.matches));
}
interface ThemeState {
  preference: ThemePreference;
  mode: ThemeMode;
  setPreference(preference: ThemePreference): void;
  toggle(): void;
}
const initialPreference = readPersistedThemePreference();
export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: initialPreference,
  mode: resolveThemeMode(initialPreference, media.matches),
  setPreference(preference) {
    try { localStorage.setItem(THEME_STORAGE_KEY, preference); } catch { /* Keep the session preference. */ }
    const mode = resolveThemeMode(preference, media.matches);
    applyThemeMode(mode);
    set({ preference, mode });
  },
  toggle() { get().setPreference(get().mode === 'dark' ? 'light' : 'dark'); },
}));
media.addEventListener('change', event => {
  if (useThemeStore.getState().preference !== 'system') return;
  const mode = resolveThemeMode('system', event.matches);
  applyThemeMode(mode); useThemeStore.setState({ mode });
});
window.addEventListener('storage', event => {
  if (event.key !== THEME_STORAGE_KEY) return;
  const preference = readPersistedThemePreference();
  const mode = resolveThemeMode(preference, media.matches);
  applyThemeMode(mode); useThemeStore.setState({ preference, mode });
});
