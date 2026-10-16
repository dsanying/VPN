export type ThemeMode = 'light' | 'dark';

/** Public design settings preserve the established client geometry across every host. */
export const designTokens = {
  breakpoint: { compact: 480, narrow: 640, mobile: 768 },
  control: { height: 32, heightLg: 40, heightSm: 28 },
  font: {
    family:
      '"IBM Plex Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
    mono: '"IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    sizeBody: 14,
    sizeLg: 16,
    sizeMetric: 28,
    sizePageTitle: 24,
    sizeTitle: 20,
    sizeXs: 12,
  },
  layout: {
    contentMaxWidth: 1600,
    controlWidth: 320,
    detailAsideWidth: 200,
    drawerWidth: 520,
    headerHeight: 60,
    longColumnWidth: 420,
    queryControlWidth: 240,
    scrollRegionMaxHeight: 300,
    siderWidth: 240,
    wideControlWidth: 420,
  },
  motion: { fast: '120ms', normal: '200ms' },
  radius: { xs: 4, md: 8, lg: 12 },
  space: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40 },
  color: {
    data: ['#1677ff', '#13c2c2', '#52c41a', '#eb2f96', '#722ed1', '#fa8c16', '#f5222d', '#faad14'],
  },
} as const;

const clamp = (value: number, limit: number) => Math.max(0, Math.min(limit, value));
/** Convert browser-resolved sRGB to literals accepted by canvas and editor libraries. */
export function normalizeComputedColor(value: string): string | undefined {
  const match = /^(rgb|rgba|color)\((.*)\)$/.exec(value.trim());
  if (!match) return undefined;
  const normalized = match[1] === 'color';
  let content = match[2];
  if (normalized) {
    if (!content.startsWith('srgb ')) return undefined;
    content = content.slice(5);
  }
  const parts = content.split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return undefined;
  const amount = (part: string, limit: number): number => {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i.test(part)) return NaN;
    return part.endsWith('%') ? (Number(part.slice(0, -1)) * limit) / 100 : Number(part);
  };
  const scale = normalized ? 1 : 255;
  const rgb = parts
    .slice(0, 3)
    .map((part) => Math.round((clamp(amount(part, scale), scale) * 255) / scale));
  const alpha = parts.length === 4 ? clamp(amount(parts[3], 1), 1) : 1;
  if (![...rgb, alpha].every(Number.isFinite)) return undefined;
  return alpha === 1
    ? '#' + rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')
    : `rgba(${rgb.join(', ')}, ${alpha})`;
}

let probe: HTMLElement | undefined;
/** Resolve color-mix and variables in the actual document theme, rather than guessing CSS expressions. */
export function readCssColorToken(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value || /^#[\da-f]{3,8}$/i.test(value)) return value;
  if (!probe?.isConnected) {
    probe = document.createElement('span');
    probe.hidden = true;
    document.documentElement.appendChild(probe);
  }
  probe.style.setProperty('color', `var(${name})`);
  return normalizeComputedColor(getComputedStyle(probe).color) ?? value;
}
