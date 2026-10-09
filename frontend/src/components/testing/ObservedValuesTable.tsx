import type { ObservedValues } from "../../api/testRecords";
import { jitterNs, nonEmptySets } from "./testFormat";

function range(min: number | undefined, max: number | undefined): string | null {
  return min != null || max != null ? `${min ?? "?"}–${max ?? "?"}` : null;
}

interface Row {
  rf: string | null;
  pri: string | null;
  jitter: string | null;
  frame: string | null;
  pw: string | null;
}

function row(v: ObservedValues): Row {
  const rf = v.rf_mean_mhz ?? range(v.rf_min_mhz, v.rf_max_mhz);
  const pw = v.pw_mean_us ?? range(v.pw_min_us, v.pw_max_us);
  let pri: string | null = null;
  let jitter: string | null = null;
  let frame: string | null = null;
  if (v.pri_type === "fixed") {
    const p = v.pri_mean_us ?? range(v.pri_min_us, v.pri_max_us);
    pri = p != null ? String(p) : null;
    jitter = jitterNs(v);
  } else if (v.pri_type === "stagger") {
    pri = v.pri_stagger_values_us?.length ? v.pri_stagger_values_us.join(", ") : null;
    frame = v.frame_time_us != null ? String(v.frame_time_us) : null;
  } else if (v.pri_type === "cw" || v.pri_type === "xlet") {
    pri = v.pri_type === "cw" ? "CW" : "X-let";
  }
  return { rf: rf != null ? String(rf) : null, pri, jitter, frame, pw: pw != null ? String(pw) : null };
}

const COLUMNS: { key: keyof Row; label: string }[] = [
  { key: "rf", label: "RF MHz" },
  { key: "pri", label: "PRI µs" },
  { key: "frame", label: "Frame µs" },
  { key: "pw", label: "PW µs" },
  { key: "jitter", label: "Jitter ns" },
];

/** Intercepted parameters as a small table inside a cell: one row per set,
 * the units in the small headings and the values plain to read. Only the
 * columns some set has are shown. */
export function ObservedValuesTable({ sets, empty = "—" }: { sets: ObservedValues[] | null | undefined; empty?: string }) {
  const rows = nonEmptySets(sets).map(row);
  const shown = COLUMNS.filter((c) => rows.some((r) => r[c.key] != null));
  if (rows.length === 0 || shown.length === 0) return <>{empty}</>;
  return (
    <table className="observed-values">
      <thead>
        <tr>
          {shown.map((c) => (
            <th key={c.key}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {shown.map((c) => (
              <td key={c.key}>{r[c.key] ?? "—"}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
