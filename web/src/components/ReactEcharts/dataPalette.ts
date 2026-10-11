/** Deterministic sRGB variants retain the base sequence, without cycling series colors. */
export function buildDataPalette(base: readonly string[], mode: 'light' | 'dark'): string[] {
  const mixes = [0, 0.18, -0.18, 0.34, -0.34];
  return mixes.flatMap((mix) =>
    base.map((color) => {
      if (mix === 0 || !/^#[a-f\d]{6}$/i.test(color)) return color;
      const fraction = mode === 'dark' ? mix : -mix;
      const target = fraction > 0 ? 255 : 0;
      const channels = [1, 3, 5].map((offset) =>
        Number.parseInt(color.slice(offset, offset + 2), 16)
      );
      return (
        '#' +
        channels
          .map((channel) =>
            Math.round(channel + (target - channel) * Math.abs(fraction))
              .toString(16)
              .padStart(2, '0')
          )
          .join('')
      );
    })
  );
}
