/** Dates the Norwegian / European way, the same everywhere in the app:
 * day.month.year (07.10.2026) and a 24-hour clock (14:05). What's stored and
 * sent to the server stays ISO (2026-10-07). */

const pad = (n: number) => String(n).padStart(2, "0");
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A Date from an ISO day ("2026-10-07", read as that calendar day — no time
 * zone shift), an ISO timestamp, or a Date. */
export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const m = ISO_DAY.exec(value);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 07.10.2026 — or "—" with no date. */
export function formatDate(value: string | number | Date | null | undefined, empty = "—"): string {
  const d = toDate(value);
  return d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}` : empty;
}

/** 14:05 from a Date, a timestamp, or a time of day ("14:05:00"). */
export function formatTime(value: string | number | Date | null | undefined, empty = "—"): string {
  if (typeof value === "string" && /^\d{1,2}:\d{2}/.test(value)) {
    const [h, m] = value.split(":");
    return `${pad(Number(h))}:${m}`;
  }
  const d = toDate(value);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : empty;
}

/** 07.10.2026 14:05 — or "—" with no date. */
export function formatDateTime(value: string | number | Date | null | undefined, empty = "—"): string {
  const d = toDate(value);
  return d ? `${formatDate(d)} ${formatTime(d)}` : empty;
}

/** 07.10 — for tight spaces such as chart axes. */
export function formatDayMonth(value: string | number | Date | null | undefined, empty = "—"): string {
  const d = toDate(value);
  return d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}` : empty;
}

/** An ISO day as typed in a date field: "2026-10-07" → "07.10.2026". */
export function isoDayToText(iso: string): string {
  const m = ISO_DAY.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

/** What someone typed in a date field, as an ISO day — or null when it isn't
 * a real date. Takes 7.10.2026, 07.10.26, 7/10/2026, 7-10-2026, 07102026 and
 * 2026-10-07. A two-digit year means 20xx. */
export function parseDayText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  let day: number, month: number, year: number;
  let m = ISO_DAY.exec(t);
  if (m) {
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})[./\-\s](\d{1,2})[./\-\s](\d{2}|\d{4})$/.exec(t))) {
    [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(t))) {
    [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    return null;
  }
  if (year < 100) year += 2000;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** What someone typed in a time field, as "HH:MM" (24-hour) — or null. Takes
 * 14:05, 14.05, 1405 and 9:5. */
export function parseTimeText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const m = /^(\d{1,2})[:.](\d{1,2})$/.exec(t) ?? /^(\d{2})(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}
