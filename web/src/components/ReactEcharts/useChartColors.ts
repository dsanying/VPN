import { useMemo } from 'react';
import { readCssColorToken } from '@/design/tokens';
import { useThemeStore } from '@/store/useThemeStore';
import { buildDataPalette } from './dataPalette';

// Canvas libraries need resolved colors rather than CSS variable expressions.
const roles = {
  canvas: 'canvas',
  surface: 'surface',
  surfaceMuted: 'surface-muted',
  surfaceElevated: 'surface-elevated',
  text: 'text',
  textSecondary: 'text-secondary',
  textTertiary: 'text-tertiary',
  textDisabled: 'text-disabled',
  border: 'border',
  borderStrong: 'border-strong',
  primary: 'primary',
  link: 'link',
  info: 'info',
  infoSurface: 'info-surface',
  success: 'success',
  warning: 'warning',
  error: 'error',
} as const;
export type ChartColors = Record<keyof typeof roles, string> & {
  data: string[];
  dataExtended: string[];
};

function resolveColors(mode: 'light' | 'dark'): ChartColors {
  const resolved = {} as Record<keyof typeof roles, string>;
  for (const role of Object.keys(roles) as Array<keyof typeof roles>) {
    resolved[role] = readCssColorToken(`--ds-color-${roles[role]}`);
  }
  const data = Array.from({ length: 8 }, (_, index) =>
    readCssColorToken(`--ds-color-data-${index + 1}`)
  );
  return { ...resolved, data, dataExtended: buildDataPalette(data, mode) };
}

export function useChartColors(): ChartColors {
  const mode = useThemeStore((state) => state.mode);
  return useMemo(() => resolveColors(mode), [mode]);
}
