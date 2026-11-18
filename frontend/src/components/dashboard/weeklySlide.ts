import type { WeeklyUpdate } from "../../api/reports";

/** The weekly progress update as one 16:9 slide (1920 × 1080), drawn as SVG:
 * shown as the preview, and turned into the PNG that goes into the morning
 * brief. Light, like a slide, whatever the app's theme. Pure — text is
 * measured by the `measure` passed in, so it can be tested without a browser. */

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

export type SectionKey = "mdf" | "emitters" | "testing" | "outlook";

export const SECTIONS: { key: SectionKey; label: string; hint: string; on: boolean }[] = [
  { key: "mdf", label: "Current MDF progress", hint: "Operational vs total and the change this week, Emitters by status, SIM Test Lines, the progress log", on: true },
  { key: "emitters", label: "Emitter work this week", hint: "Status moves, Modes added / changed / removed, versions saved", on: true },
  { key: "testing", label: "Testing this week", hint: "Test runs and their results, Platform and MDF tests, mix-ups", on: false },
  { key: "outlook", label: "Next up and blockers", hint: "The Emitters furthest from done, open and overdue tasks, Needs rework", on: false },
];

export interface SlideOptions {
  sections: SectionKey[];
  title: string;
  /** A line of your own under the title — the week's headline. */
  note: string;
}

/** Width of `text` in px at `size` and `weight`. */
export type Measure = (text: string, size: number, weight: number) => number;

const C = {
  bg: "#ffffff",
  text: "#0f172a",
  muted: "#64748b",
  card: "#f8fafc",
  border: "#e2e8f0",
  accent: "#2563eb",
  good: "#15803d",
  bad: "#b91c1c",
};
/** The status colours by name (api/statuses STATUS_COLORS), in print-safe shades. */
export const STATUS_HEX: Record<string, string> = {
  grey: "#94a3b8",
  blue: "#3b82f6",
  green: "#16a34a",
  yellow: "#eab308",
  amber: "#f59e0b",
  orange: "#f97316",
  red: "#dc2626",
  purple: "#9333ea",
};
const RESULT_HEX = { pass: STATUS_HEX.green, partial: STATUS_HEX.amber, fail: STATUS_HEX.red, other: STATUS_HEX.grey };

const FONT = "Inter Variable, Inter, Segoe UI, Arial, sans-serif";
const M = 72; // slide margin
const PAD = 32; // card padding
const GAP = 28; // between cards

type Part = { label: string; count: number; color: string };
type Stat = { value: string; label: string; sub?: string; tone?: "good" | "bad" | "muted" };
type Item =
  | { kind: "stats"; items: Stat[] }
  | { kind: "bar"; label: string; parts: Part[] }
  | { kind: "sub"; text: string }
  | { kind: "line"; text: string; strong?: string; muted?: boolean; dot?: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12 Nov 2026". */
export function dayText(iso: string): string {
  const d = day(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** "11 – 17 Nov 2026", "28 Oct – 3 Nov 2026", "29 Dec 2025 – 4 Jan 2026". */
export function periodText(start: string, end: string): string {
  const a = day(start);
  const b = day(end);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${dayText(start)} – ${dayText(end)}`;
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${dayText(end)}`;
  return `${a.getUTCDate()} – ${dayText(end)}`;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function dueText(days: number | null, due: string | null): string {
  if (!due || days == null) return "no due date";
  if (days < 0) return `due ${dayText(due)} — ${plural(-days, "day")} late`;
  if (days === 0) return `due ${dayText(due)} — today`;
  return `due ${dayText(due)} — in ${plural(days, "day")}`;
}

function results(r: Record<string, number>): Part[] {
  return [
    { label: "pass", count: r.pass ?? 0, color: RESULT_HEX.pass },
    { label: "partial", count: r.partial ?? 0, color: RESULT_HEX.partial },
    { label: "fail", count: r.fail ?? 0, color: RESULT_HEX.fail },
    { label: "inconclusive", count: r.inconclusive ?? 0, color: RESULT_HEX.other },
  ];
}

/** What each section says, as items to lay out in its card. */
export function sectionItems(key: SectionKey, w: WeeklyUpdate): { title: string; items: Item[] } {
  if (key === "mdf") {
    const m = w.mdf;
    if (!m) return { title: "Current MDF", items: [{ kind: "line", text: "No MDF in progress.", muted: true }] };
    const change = m.operational - m.operational_week_ago;
    const sim = m.sim;
    const simTotal = (sim.pass ?? 0) + (sim.partial ?? 0) + (sim.fail ?? 0) + (sim.untested ?? 0);
    const items: Item[] = [
      { kind: "line", strong: `${m.name}  `, text: [m.status, dueText(m.days_left, m.due_date), m.customer].filter(Boolean).join(" · "), muted: true },
      {
        kind: "stats",
        items: [
          {
            value: `${m.operational}/${m.emitters}`,
            label: "Emitters Operational",
            sub: change ? `${signed(change)} this week` : "no change this week",
            tone: change > 0 ? "good" : change < 0 ? "bad" : "muted",
          },
          { value: String(m.not_done), label: "not done yet", tone: m.not_done ? undefined : "good" },
          { value: simTotal ? `${sim.pass ?? 0}/${simTotal}` : "—", label: "SIM Test Lines correct" },
        ],
      },
      { kind: "bar", label: "Emitters by status", parts: m.by_status.map((s) => ({ label: s.label, count: s.count, color: STATUS_HEX[s.color] ?? STATUS_HEX.grey })) },
    ];
    if (simTotal) {
      items.push({
        kind: "bar",
        label: "SIM Test Lines, latest outcome",
        parts: [
          { label: "correct", count: sim.pass ?? 0, color: RESULT_HEX.pass },
          { label: "partial", count: sim.partial ?? 0, color: RESULT_HEX.partial },
          { label: "missed", count: sim.fail ?? 0, color: RESULT_HEX.fail },
          { label: "untested", count: sim.untested ?? 0, color: RESULT_HEX.other },
        ],
      });
    }
    if (m.log.length) {
      items.push({ kind: "sub", text: "Progress log" });
      for (const x of m.log) items.push({ kind: "line", strong: `${dayText(x.date).replace(/ \d{4}$/, "")}  `, text: x.body, dot: x.kind === "release" ? C.good : C.accent });
    }
    return { title: "Current MDF", items };
  }
  if (key === "emitters") {
    const e = w.emitters;
    const items: Item[] = [
      {
        kind: "stats",
        items: [
          { value: String(e.status_moves.length), label: "status moves", sub: e.to_operational ? `${e.to_operational} to Operational` : undefined, tone: e.to_operational ? "good" : undefined },
          { value: String(e.modes.added), label: "Modes added", sub: `${e.modes.changed} changed · ${e.modes.removed} removed` },
          { value: String(e.versions.length), label: "versions saved", sub: e.emitters_touched ? `${plural(e.emitters_touched, "Emitter")} worked on` : undefined },
        ],
      },
    ];
    if (!e.status_moves.length && !e.busiest.length && !e.versions.length) {
      items.push({ kind: "line", text: "No Emitter changes this week.", muted: true });
    }
    if (e.status_moves.length) {
      items.push({ kind: "sub", text: "Status moves" });
      for (const s of [...e.status_moves].reverse()) {
        items.push({ kind: "line", strong: `${s.emitter}: `, text: `${s.from} → ${s.to}`, dot: s.to_key === "validated" ? C.good : s.to_key === "deprecated" ? C.bad : C.muted });
      }
    }
    if (e.busiest.length) {
      items.push({ kind: "sub", text: "Most Mode changes" });
      for (const b of e.busiest) {
        const parts = [b.added && `${b.added} added`, b.changed && `${b.changed} changed`, b.removed && `${b.removed} removed`].filter(Boolean);
        items.push({ kind: "line", strong: `${b.emitter}: `, text: parts.join(", "), dot: C.accent });
      }
    }
    if (e.versions.length) {
      items.push({ kind: "sub", text: "Versions saved" });
      items.push({ kind: "line", text: e.versions.map((v) => `${v.emitter} v${v.version}`).join(", ") });
    }
    return { title: "Emitter work this week", items };
  }
  if (key === "testing") {
    const t = w.testing;
    const runs = t.emitter_runs;
    const all: Record<string, number> = {};
    for (const r of [t.emitter_results, t.platform_results, t.mdf_results]) for (const [k, v] of Object.entries(r)) all[k] = (all[k] ?? 0) + v;
    const items: Item[] = [
      {
        kind: "stats",
        items: [
          { value: String(runs), label: "Emitter test runs", sub: runs ? `${t.emitter_results.pass} pass · ${t.emitter_results.fail} fail` : undefined },
          { value: String(t.platform_tests), label: "Platform tests" },
          { value: String(t.mdf_tests), label: "MDF tests" },
          { value: String(t.mixups), label: "mix-ups found", tone: t.mixups ? "bad" : undefined },
        ],
      },
    ];
    if (runs + t.platform_tests + t.mdf_tests) items.push({ kind: "bar", label: "Results, all tests", parts: results(all) });
    else items.push({ kind: "line", text: "No tests logged this week.", muted: true });
    return { title: "Testing this week", items };
  }
  const o = w.outlook;
  const items: Item[] = [
    {
      kind: "stats",
      items: [
        { value: String(o.open_tasks), label: "open tasks", sub: o.overdue_tasks ? `${o.overdue_tasks} overdue` : undefined, tone: o.overdue_tasks ? "bad" : undefined },
        { value: String(w.emitters.needs_rework), label: "Emitters need rework", tone: w.emitters.needs_rework ? "bad" : undefined },
        { value: String(o.unassigned_tasks), label: "tasks unassigned" },
      ],
    },
  ];
  if (w.mdf?.next_up.length) {
    items.push({ kind: "sub", text: `Next up in ${w.mdf.name}` });
    for (const n of w.mdf.next_up) {
      items.push({ kind: "line", strong: `${n.name}: `, text: `${n.reason}${n.more ? ` (+${n.more} more)` : ""}${n.assignee ? ` · ${n.assignee}` : ""}`, dot: C.muted });
    }
  }
  return { title: "Next up and blockers", items };
}

/** Lines of at most `width` px, breaking at spaces (a word too long is cut). */
export function wrap(text: string, width: number, size: number, weight: number, measure: Measure, first = 0): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    const room = width - (lines.length === 0 ? first : 0);
    if (measure(next, size, weight) <= room || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

/** Shortens `text` with "…" to fit `width`. */
function fit(text: string, width: number, size: number, weight: number, measure: Measure): string {
  if (measure(text, size, weight) <= width) return text;
  let t = text;
  while (t.length > 1 && measure(`${t}…`, size, weight) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

const t = (x: number, y: number, s: string, size: number, opts: { weight?: number; fill?: string; anchor?: string } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${opts.fill ?? C.text}"${opts.anchor ? ` text-anchor="${opts.anchor}"` : ""}>${esc(s)}</text>`;

/** One card: its title and as many items as fit, then "+N more". */
function card(x: number, y: number, w: number, h: number, title: string, items: Item[], measure: Measure): string {
  const out = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${C.card}" stroke="${C.border}" stroke-width="2"/>`];
  const compact = h < 480;
  out.push(t(x + PAD, y + PAD + 30, title, compact ? 30 : 32, { weight: 700 }));
  const inner = w - 2 * PAD;
  const bottom = y + h - PAD;
  let cy = y + PAD + 30 + (compact ? 24 : 34);
  let hidden = 0;
  let lastSub: { at: number } | null = null;
  const LINE = 24;
  const LH = 34;
  const VS = compact ? 46 : 60; // the big numbers: smaller in a short card
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const piece: string[] = [];
    let height = 0;
    if (it.kind === "stats") {
      const cw = inner / it.items.length;
      it.items.forEach((s, k) => {
        const sx = x + PAD + k * cw;
        const tone = s.tone === "good" ? C.good : s.tone === "bad" ? C.bad : C.text;
        piece.push(t(sx, cy + VS, fit(s.value, cw - 16, VS, 700, measure), VS, { weight: 700, fill: tone }));
        piece.push(t(sx, cy + VS + 32, fit(s.label, cw - 16, 21, 500, measure), 21, { weight: 500, fill: C.muted }));
        if (s.sub) piece.push(t(sx, cy + VS + 59, fit(s.sub, cw - 16, 21, 600, measure), 21, { weight: 600, fill: s.tone === "good" ? C.good : s.tone === "bad" ? C.bad : C.muted }));
      });
      height = VS + (it.items.some((s) => s.sub) ? 76 : 48);
    } else if (it.kind === "bar") {
      const total = it.parts.reduce((n, p) => n + p.count, 0);
      piece.push(t(x + PAD, cy + 22, it.label, 21, { weight: 600, fill: C.muted }));
      let bx = x + PAD;
      const by = cy + 34;
      piece.push(`<rect x="${bx}" y="${by}" width="${inner}" height="26" rx="6" fill="${C.border}"/>`);
      for (const p of it.parts.filter((p) => p.count > 0)) {
        const pw = total ? (p.count / total) * inner : 0;
        piece.push(`<rect x="${bx}" y="${by}" width="${Math.max(pw - 3, 2)}" height="26" fill="${p.color}"/>`);
        bx += pw;
      }
      // The legend: a swatch, its count and name each, wrapping as needed.
      let lx = x + PAD;
      let ly = by + 26 + 30;
      for (const p of it.parts.filter((p) => p.count > 0)) {
        const label = `${p.count} ${p.label}`;
        const lw = 26 + measure(label, 21, 500) + 28;
        if (lx + lw > x + PAD + inner && lx > x + PAD) {
          lx = x + PAD;
          ly += 32;
        }
        piece.push(`<rect x="${lx}" y="${ly - 16}" width="16" height="16" rx="3" fill="${p.color}"/>`);
        piece.push(t(lx + 24, ly, label, 21, { weight: 500 }));
        lx += lw;
      }
      height = ly - cy + 18;
    } else if (it.kind === "sub") {
      piece.push(t(x + PAD, cy + 30, it.text.toUpperCase(), 19, { weight: 700, fill: C.muted }));
      height = 44;
    } else {
      const indent = it.dot ? 22 : 0;
      const strongW = it.strong ? measure(it.strong, LINE, 700) : 0;
      let lines = it.text ? wrap(it.text, inner - indent, LINE, 400, measure, strongW) : [""];
      // A long line that doesn't all fit: as many of its lines as do, the last ending in "…".
      const after = items.slice(i + 1).some((x) => x.kind === "line") ? 16 : 0;
      const room = Math.floor((bottom - after - cy - 6) / LH);
      if (room >= 1 && lines.length > room) {
        lines = lines.slice(0, room);
        lines[room - 1] = fit(`${lines[room - 1]}…`, inner - indent - (room === 1 ? strongW : 0), LINE, 400, measure);
      }
      if (it.dot) piece.push(`<circle cx="${x + PAD + 6}" cy="${cy + LINE - 8}" r="6" fill="${it.dot}"/>`);
      lines.forEach((ln, k) => {
        const lx = x + PAD + indent;
        const ly = cy + LINE + k * LH;
        if (k === 0 && it.strong) {
          piece.push(
            `<text x="${lx}" y="${ly}" font-size="${LINE}"><tspan font-weight="700" fill="${C.text}">${esc(it.strong)}</tspan><tspan fill="${it.muted ? C.muted : C.text}">${esc(ln)}</tspan></text>`,
          );
        } else piece.push(t(lx, ly, ln, LINE, { fill: it.muted ? C.muted : C.text }));
      });
      height = lines.length * LH + 6;
    }
    const linesAfter = items.slice(i + 1).some((x) => x.kind === "line");
    // Room for this item (a heading, with its first line under it) and, if lines follow, the "+N more" line.
    const needed = height + (it.kind === "sub" ? LH : 0);
    if (cy + needed > bottom - (linesAfter ? 16 : 0)) {
      hidden = items.slice(i).filter((x) => x.kind === "line").length;
      // A heading with nothing under it goes too.
      if (lastSub) out.length = lastSub.at;
      break;
    }
    lastSub = it.kind === "sub" ? { at: out.length } : null;
    out.push(...piece);
    cy += height + 10;
  }
  // "+N more" sits low, in the card's padding, so it costs the list little room.
  if (hidden) out.push(t(x + PAD, bottom + 12, `+${hidden} more`, 21, { weight: 600, fill: C.muted }));
  return out.join("");
}

/** Where each card goes: one across, two or three side by side, four 2 × 2. */
export function grid(n: number, top: number): { x: number; y: number; w: number; h: number }[] {
  const bottom = SLIDE_H - M - 36;
  const cols = n <= 3 ? n : 2;
  const rows = Math.ceil(n / cols);
  const w = (SLIDE_W - 2 * M - (cols - 1) * GAP) / cols;
  const h = (bottom - top - (rows - 1) * GAP) / rows;
  return Array.from({ length: n }, (_, i) => ({ x: M + (i % cols) * (w + GAP), y: top + Math.floor(i / cols) * (h + GAP), w, h }));
}

/** The whole slide as an SVG document. `fontCss` (an @font-face rule) is
 * embedded so the image draws in Inter outside the page too. */
export function slideSvg(w: WeeklyUpdate, opts: SlideOptions, measure: Measure, fontCss = ""): string {
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_W}" height="${SLIDE_H}" viewBox="0 0 ${SLIDE_W} ${SLIDE_H}" font-family="${FONT}">`,
    fontCss ? `<style>${fontCss}</style>` : "",
    `<rect width="${SLIDE_W}" height="${SLIDE_H}" fill="${C.bg}"/>`,
    `<rect x="0" y="0" width="${SLIDE_W}" height="12" fill="${C.accent}"/>`,
  ];
  const period = periodText(w.start, w.end);
  out.push(t(M, M + 46, fit(opts.title || "Weekly progress update", SLIDE_W - 2 * M - 560, 52, 700, measure), 52, { weight: 700 }));
  out.push(t(SLIDE_W - M, M + 44, period, 32, { weight: 600, fill: C.muted, anchor: "end" }));
  let top = M + 46 + 28;
  const note = opts.note.trim();
  if (note) {
    const lines = wrap(note, SLIDE_W - 2 * M - 28, 28, 500, measure).slice(0, 2);
    out.push(`<rect x="${M}" y="${top}" width="6" height="${lines.length * 38 + 4}" fill="${C.accent}"/>`);
    lines.forEach((ln, i) => out.push(t(M + 24, top + 30 + i * 38, ln, 28, { weight: 500 })));
    top += lines.length * 38 + 28;
  }
  top += 8;
  const keys = SECTIONS.map((s) => s.key).filter((k) => opts.sections.includes(k));
  if (!keys.length) out.push(t(SLIDE_W / 2, SLIDE_H / 2, "Pick at least one section", 32, { fill: C.muted, anchor: "middle" }));
  grid(keys.length, top).forEach((g, i) => {
    const s = sectionItems(keys[i], w);
    out.push(card(g.x, g.y, g.w, g.h, s.title, s.items, measure));
  });
  out.push(t(M, SLIDE_H - M + 20, `Weekly progress update · ${period} · from the PRS Emitter Repo`, 19, { fill: C.muted }));
  out.push("</svg>");
  return out.join("");
}
