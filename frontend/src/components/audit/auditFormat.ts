import { EMITTER_STATUS_LABEL } from "../common/emitterStatusLabel";
import { formatDate, formatDateTime } from "../common/dates";
import type { AuditAction } from "../../types/domain";

/** Each kind of thing the Audit Log records: as a category (plural) and as
 * one row's (singular), in the app's own words. */
const ENTITY_TYPES: Record<string, [plural: string, singular: string]> = {
  emitter: ["Emitters", "Emitter"],
  ew_group: ["EW Groups", "EW Group"],
  source: ["Sources", "Source"],
  mode_element: ["Elements", "Element"],
  mode: ["Modes", "Mode"],
  mode_generation_batch: ["Generation batches", "Generation batch"],
  platform: ["Platforms", "Platform"],
  platform_link: ["Platform pins", "Platform pin"],
  mdf: ["MDFs", "MDF"],
  mdf_link: ["MDF pins", "MDF pin"],
  dwell_strategy: ["Strategies", "Strategy"],
  dwell_file: ["Dwell files", "Dwell file"],
  setting: ["Settings", "Setting"],
  test_record: ["Test runs", "Test run"],
  test_line: ["SIM Test Lines", "SIM Test Line"],
  prs_import: ["PRS imports", "PRS import"],
  user: ["Users", "User"],
  auth: ["Sign-ins", "Sign-in"],
  backup: ["Backups", "Backup"],
  task: ["Tasks", "Task"],
  emitter_note: ["Emitter notes", "Emitter note"],
  platform_note: ["Platform notes", "Platform note"],
  mdf_note: ["MDF notes", "MDF note"],
  source_note: ["Source notes", "Source note"],
  dwell_strategy_note: ["Strategy notes", "Strategy note"],
  source_group: ["Source Groups", "Source Group"],
  parameter_sequence: ["Sequences", "Sequence"],
  import_batch: ["Imports", "Import"],
  customer: ["Customers", "Customer"],
  intercept: ["Intercepts", "Intercept"],
  intercept_entry: ["Intercept entries", "Intercept entry"],
  intercept_note: ["Intercept notes", "Intercept note"],
  status_definition: ["Statuses", "Status"],
  milestone: ["Milestones", "Milestone"],
  ambiguity_finding: ["Ambiguity findings", "Ambiguity finding"],
  ambiguity_run: ["Ambiguity checks", "Ambiguity check"],
  test_draft: ["Test runs in progress", "Test run in progress"],
  documentation: ["AI documentation", "AI documentation"],
  function_group: ["Function groups", "Function group"],
};

/** A category of the log ("Modes"). */
export function entityTypeLabel(entityType: string): string {
  return ENTITY_TYPES[entityType]?.[0] ?? entityType;
}

/** What one entry is about ("Mode"). */
export function entityTypeSingular(entityType: string): string {
  return ENTITY_TYPES[entityType]?.[1] ?? entityType;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  restore: "Restored",
  status_change: "Status change",
  commit: "Saved version",
  login: "Logged in",
  login_failed: "Login failed",
  logout: "Logged out",
  checkout: "Started editing",
  checkin: "Stopped editing",
  discard: "Discarded changes",
  revert: "Reverted",
  fork: "Forked",
  download: "Downloaded",
};

export function actionLabel(action: AuditAction): string {
  return ACTION_LABELS[action] ?? action;
}

// Domain abbreviations rendered with their conventional casing in humanized
// field labels, checked word-by-word against the underscore-split field name.
const WORD_LABELS: Record<string, string> = {
  rf: "RF", pw: "PW", pri: "PRI", ew: "EW", id: "ID",
  mhz: "MHz", us: "µs", cw: "CW", dsl: "DSL", mdf: "MDF", xml: "XML",
};

/** "rf_min_mhz" -> "RF Min MHz", "scan_delta" -> "Scan Delta", "is_active" -> "Is Active". */
export function humanizeField(field: string): string {
  return field
    .split("_")
    .map((word) => WORD_LABELS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Renders a single old/new (or create-time-only) value for display. */
export function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ");
  if (typeof value === "object") {
    // UUID-shaped strings inside nested objects (e.g. type_data) aren't worth
    // resolving to names here — fall back to compact JSON for the rare case
    // a field's value is itself a structured object.
    return JSON.stringify(value);
  }
  // ISO date/datetime strings render as dd.mm.yyyy (with the time when there is one).
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) {
    const shown = value.includes("T") ? formatDateTime(value, "") : formatDate(value, "");
    if (shown) return shown;
  }
  return String(value);
}

export interface ChangeRow {
  field: string;
  label: string;
  hasOld: boolean;
  oldDisplay: string;
  newDisplay: string;
}

function isOldNewShape(value: unknown): value is { old: unknown; new: unknown } {
  return typeof value === "object" && value !== null && "old" in value && "new" in value;
}

/**
 * Turns a raw `changes` dict (from `AuditLog.changes`) into rows ready for
 * red/green rendering. Two shapes come from the backend: `{old, new}` for
 * updates/status-changes (rendered as a from/to diff), or a bare value for
 * creates (rendered as new-only, since there's no "before").
 */
export function formatChanges(changes: Record<string, unknown> | null, entityType?: string): ChangeRow[] {
  if (!changes) return [];
  const names = (entityType && VALUE_LABELS[entityType]) || {};
  const show = (field: string, v: unknown) =>
    typeof v === "string" && names[field]?.[v] ? names[field][v] : formatChangeValue(v);
  return Object.entries(changes).map(([field, value]) => {
    if (isOldNewShape(value)) {
      return {
        field,
        label: humanizeField(field),
        hasOld: true,
        oldDisplay: show(field, value.old),
        newDisplay: show(field, value.new),
      };
    }
    return { field, label: humanizeField(field), hasOld: false, oldDisplay: "", newDisplay: show(field, value) };
  });
}

// Stored values shown by the name a person knows them by, per entity type
// and field.
const VALUE_LABELS: Record<string, Record<string, Record<string, string>>> = {
  emitter: { status: EMITTER_STATUS_LABEL },
};

/** An entry's summary as shown. Entries written before the edit-lock wording
 * changed said "Checked in Emitter …" — shown in today's words. */
export function auditSummary(summary: string): string {
  return summary.replace(/^Checked in Emitter /, "Stopped editing Emitter ");
}

const UNITS: [suffix: string, unit: string][] = [
  ["_mhz", " MHz"],
  ["_us", " µs"],
];
const PLAIN_NAMES: Record<string, string> = { ew_group: "EW Group", source_ids: "Sources", sources: "Sources" };

/** "jitter_max_us" → ["Jitter max", " µs"]: a field's name as a phrase, and its unit. */
function phraseAndUnit(field: string): [string, string] {
  const [suffix, unit] = UNITS.find(([s]) => field.endsWith(s)) ?? ["", ""];
  const base = suffix ? field.slice(0, -suffix.length) : field;
  const phrase =
    PLAIN_NAMES[base] ??
    base
      .split("_")
      .map((w, i) => WORD_LABELS[w.toLowerCase()] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(" ");
  return [phrase, unit];
}

/** An update's changes in one line — "RF 9400–9500 → 9380–9520 MHz, jitter
 * max 1 → 3 µs" — so the trail reads without opening Details. A min and max
 * that both changed read as one range. Null for anything but old → new
 * changes (a creation's values are in Details). */
export function changeDigest(changes: Record<string, unknown> | null, most = 4): string | null {
  if (!changes) return null;
  const entries = Object.entries(changes).filter(([, v]) => isOldNewShape(v)) as [string, { old: unknown; new: unknown }][];
  if (entries.length === 0 || entries.length !== Object.keys(changes).length) return null;
  const byField = new Map(entries);
  const done = new Set<string>();
  const parts: string[] = [];
  const value = (v: unknown) => formatChangeValue(v);
  for (const [field, change] of entries) {
    if (done.has(field)) continue;
    done.add(field);
    const pair = field.match(/^(.*)_(min|max)(_mhz|_us)?$/);
    const otherField = pair ? `${pair[1]}_${pair[2] === "min" ? "max" : "min"}${pair[3] ?? ""}` : null;
    const other = otherField ? byField.get(otherField) : undefined;
    if (pair && other && otherField) {
      done.add(otherField);
      const [min, max] = pair[2] === "min" ? [change, other] : [other, change];
      const [phrase, unit] = phraseAndUnit(`${pair[1]}${pair[3] ?? ""}`);
      parts.push(`${phrase} ${value(min.old)}–${value(max.old)} → ${value(min.new)}–${value(max.new)}${unit}`);
    } else if (field === "notes" || field === "description") {
      parts.push(`${phraseAndUnit(field)[0]} changed`);
    } else {
      const [phrase, unit] = phraseAndUnit(field);
      parts.push(`${phrase} ${value(change.old)} → ${value(change.new)}${unit}`);
    }
  }
  const shown = parts.slice(0, most).map((p, i) => (i === 0 ? p : lowerFirst(p)));
  return shown.join(", ") + (parts.length > most ? ` and ${parts.length - most} more` : "");
}

/** "Jitter max …" → "jitter max …" after a comma; "RF …", "PRI …" stay. */
function lowerFirst(text: string): string {
  const first = text.split(" ")[0];
  return Object.values(WORD_LABELS).includes(first) || first === "EW" ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

/** An Emitter's version save, revert or discard: where its changes landed. */
export function versionMarker(entry: { entity_type: string; action: string; summary: string; changes: Record<string, unknown> | null }): string | null {
  if (entry.entity_type !== "emitter" || !["commit", "revert", "discard"].includes(entry.action)) return null;
  const n = entry.changes?.version_number;
  const note = entry.summary.includes(" — ") ? entry.summary.split(" — ").slice(1).join(" — ") : "";
  if (entry.action === "commit") return typeof n === "number" ? `Saved v${n}${note ? ` — ${note}` : ""}` : entry.summary;
  if (entry.action === "revert") {
    const to = entry.changes?.reverted_to;
    return typeof n === "number" && typeof to === "number" ? `Reverted to v${to} (saved as v${n})` : entry.summary;
  }
  return typeof n === "number" ? `Discarded unsaved changes — back to v${n}` : entry.summary;
}
