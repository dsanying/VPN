import { designTokens } from '@/design/tokens';
import { measureTextWidth } from '@/components/client';

/** Approved viewport roles; a complete graph may scroll beyond the visible viewport. */
export const CHART_HEIGHT = 336;
export const REALTIME_CHART_HEIGHT = 224;
export function valueLabelGridRight(labels: readonly string[]): number {
  const font = `${designTokens.font.sizeXs}px ${designTokens.font.family}`;
  let required = 0;
  for (const label of labels) required = Math.max(required, measureTextWidth(label,font));
  return Math.ceil(required) + designTokens.space.md;
}
