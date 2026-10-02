/** Time axes for the import charts. Times are mission times read as UTC (see
 * missionTimeMs), so they're shown with UTC getters — as written in the file. */

const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;
const DAY = 24 * H;
const STEPS = [
  S, 2 * S, 5 * S, 10 * S, 15 * S, 30 * S,
  MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN,
  H, 2 * H, 3 * H, 6 * H, 12 * H,
  DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY,
];

/** About `count` ticks on round times — whole seconds, minutes, hours or days. */
export function timeTicks(lo: number, hi: number, count = 6): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const step = STEPS.find((s) => span / s <= count) ?? Math.ceil(span / count / DAY) * DAY;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  return ticks;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A tick label: as much as the step needs — seconds only when ticks are
 * seconds apart, the date only when they're a day or more apart. With no step
 * (the hover read-out), the full date and time. */
export function formatTime(ms: number, step?: number): string {
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const sec = `${hm}:${pad(d.getUTCSeconds())}`;
  if (step == null) return `${date} ${sec}`;
  if (step >= DAY) return date.slice(5);
  return step < MIN ? sec : hm;
}
