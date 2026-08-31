import type { AuditAction } from "../../types/domain";

const ENTITY_TYPE_LABELS: Record<string, string> = {
  emitter: "Emitters",
  ew_group: "EW Groups",
  source: "Sources",
  mode_element: "Elements",
  mode: "Modes",
  mode_generation_batch: "Generation Batches",
  platform: "Platforms",
  platform_link: "Platform Links",
  mdf: "MDFs",
  mdf_link: "MDF Links",
  test_record: "Test Records",
  user: "Users",
  auth: "Auth",
};

export function entityTypeLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  status_change: "Status change",
  commit: "Committed",
  login: "Logged in",
  login_failed: "Login failed",
  logout: "Logged out",
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
  // ISO date/datetime strings render as a localized date for readability.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return value.includes("T") ? d.toLocaleString() : d.toLocaleDateString();
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
export function formatChanges(changes: Record<string, unknown> | null): ChangeRow[] {
  if (!changes) return [];
  return Object.entries(changes).map(([field, value]) => {
    if (isOldNewShape(value)) {
      return {
        field,
        label: humanizeField(field),
        hasOld: true,
        oldDisplay: formatChangeValue(value.old),
        newDisplay: formatChangeValue(value.new),
      };
    }
    return { field, label: humanizeField(field), hasOld: false, oldDisplay: "", newDisplay: formatChangeValue(value) };
  });
}
