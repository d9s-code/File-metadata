/** Frame time (µs) of a stagger sequence: the sum of one full cycle, cut to
 * 3 decimals. A plain float sum picks up binary rounding noise
 * (100.1 + 200.2 → 300.29999999999995); the backend rounds the same way. */
export const FRAME_TIME_DECIMALS = 3;

export function frameTimeUs(values: number[]): number {
  const sum = values.reduce((acc, v) => (Number.isFinite(v) ? acc + v : acc), 0);
  const factor = 10 ** FRAME_TIME_DECIMALS;
  return Math.round(sum * factor) / factor;
}

/** Same, for a comma-separated sequence typed into a form field. */
export function frameTimeFromText(text: string): number {
  return frameTimeUs(
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number),
  );
}
