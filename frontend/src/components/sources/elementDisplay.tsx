import type { ElementOverviewRow } from "../../api/elements";
import type { ElementVariant } from "../../types/domain";
import { VARIANT_STYLES } from "./ElementsPanel";

export function VariantTag({ variant }: { variant: ElementVariant | null }) {
  if (!variant) return null;
  const style = VARIANT_STYLES[variant];
  return (
    <span
      className="variant-tag"
      style={{ background: style?.bg, color: style?.fg, borderColor: style?.border }}
    >
      {style?.label ?? variant}
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
