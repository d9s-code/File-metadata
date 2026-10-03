/** "3 Oct 2026, 08:41" — or "—" when there's no time. */
export function backupWhen(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

/** "3 hours ago", "in 9 hours", "2 days ago". */
export function relativeTime(iso: string, now = Date.now()) {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  const abs = Math.abs(minutes);
  const [n, unit] = abs < 60 ? [abs, "minute"] : abs < 48 * 60 ? [Math.round(abs / 60), "hour"] : [Math.round(abs / 1440), "day"];
  if (n === 0) return "just now";
  const text = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return minutes < 0 ? `${text} ago` : `in ${text}`;
}

/** A length of time in hours as people say it: "40 minutes", "5 hours", "3 days". */
export function duration(hours: number) {
  if (hours < 1) {
    const m = Math.max(1, Math.round(hours * 60));
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  if (hours < 36) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(hours / 24);
  return `${d} days`; // 36 hours and up: at least 2
}
