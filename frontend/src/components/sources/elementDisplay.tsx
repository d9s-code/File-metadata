import type { ElementOverviewRow } from "../../api/elements";
import type { ElementVariant } from "../../types/domain";

export const VARIANT_STYLES: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  typical: { label: "typical", bg: "var(--badge-blue-bg)", fg: "var(--badge-blue-fg)", border: "var(--badge-blue-fg)" },
  discrete: { label: "discrete", bg: "var(--badge-green-bg)", fg: "var(--badge-green-fg)", border: "var(--badge-green-fg)" },
  most_probable: { label: "most-probable", bg: "#7c2d12", fg: "#fed7aa", border: "#ea580c" },
  extreme: { label: "extreme", bg: "var(--badge-red-bg)", fg: "var(--badge-red-fg)", border: "var(--badge-red-fg)" },
  intercept: { label: "intercept", bg: "#0f766e", fg: "#ccfbf1", border: "#14b8a6" },
  analysis: { label: "analysis", bg: "#4c1d95", fg: "#ddd6fe", border: "#7c3aed" },
  other: { label: "other", bg: "#4b5563", fg: "#f3f4f6", border: "#374151" },
};

/** The order variants list in: typical first, the rest after. */
export const VARIANT_ORDER: Record<string, number> = { typical: 0, discrete: 1, most_probable: 2, extreme: 3 };

export function VariantTag({ variant, title }: { variant: ElementVariant | string | null | undefined; title?: string }) {
  if (!variant) return null;
  const key = variant.trim().toLowerCase().replace(/-/g, "_");
  const style = VARIANT_STYLES[key];
  return (
    <span
      className="variant-tag"
      style={style ? { background: style.bg, color: style.fg, borderColor: style.border } : undefined}
      title={title}
    >
      {style?.label ?? key.replace(/_/g, " ")}
    </span>
  );
}

type Values = Pick<ElementOverviewRow, "element_type" | "value_min" | "value_max" | "stagger_values" | "jitter_min" | "jitter_max">;

const UNIT: Record<string, string> = { rf: "MHz", pri: "µs", pw: "µs", scan: "s" };

function range(lo: number | null, hi: number | null): string {
  if (lo == null && hi == null) return "";
  return lo === hi || hi == null ? `${lo}` : `${lo}–${hi}`;
}

/** An Element's values in words: "2900–3100 MHz", "stagger 800, 850 µs", "jitter 5–15". */
export function elementValues(e: Values): string {
  const unit = UNIT[e.element_type] ?? "";
  const main = e.stagger_values?.length
    ? `stagger ${e.stagger_values.join(", ")} ${unit}`
    : `${range(e.value_min, e.value_max)} ${unit}`;
  const jitter = range(e.jitter_min, e.jitter_max);
  return jitter ? `${main} · jitter ${jitter}` : main;
}
