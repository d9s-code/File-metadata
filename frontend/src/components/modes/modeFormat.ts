import type { Mode } from "../../types/domain";

export function formatPri(mode: Mode): string {
  const line = mode.line;
  if (!line) return "—";
  switch (mode.pri_type) {
    case "fixed":
      return `${line.pri_min_us}–${line.pri_max_us} µs (jitter ${line.jitter_min_us}–${line.jitter_max_us})`;
    case "stagger":
      return `[${(line.pri_stagger_values_us ?? []).join(", ")}] µs`;
    case "cw":
      return "CW (constant)";
    case "xlet":
      return "—";
  }
}
