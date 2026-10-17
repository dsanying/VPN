/** One application clock for updates and background measurements. */
export const BACKGROUND_REFRESH_MS = 6 * 60 * 60_000;
/** A just-initialized result already satisfies a simultaneous global refresh. */
export const MEASUREMENT_COALESCE_MS = 60_000;

/** Shared lifetime for saved observations, independent of outcome and host. */
export function observationIsFresh(
  observedAt: number | string | null | undefined,
  now = Date.now()
): boolean {
  const time = typeof observedAt === 'string' ? Date.parse(observedAt) : observedAt;
  return (
    typeof time === 'number' &&
    Number.isFinite(time) &&
    time >= 0 &&
    time <= now &&
    now - time < BACKGROUND_REFRESH_MS
  );
}
