import { Link } from "react-router-dom";
import type { EwGroup, Mode } from "../../types/domain";
import { naturalCompare } from "../common/sortUtils";

/** "9000–9100", or one value when both ends are the same. */
function span(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null && max == null) return "—";
  if (min == null || max == null || min === max) return String(min ?? max);
  return `${min}–${max}`;
}

/** The Modes made from a test run, one per row with their values as they are
 * now — each linked to it on the Modes tab. One deleted since is still listed. */
export function DerivedModesTable({
  emitterId,
  derived,
  modes,
  ewGroups,
}: {
  emitterId: string;
  derived: { mode_id: string; mode_name: string }[];
  modes: Mode[];
  ewGroups: EwGroup[];
}) {
  const byId = new Map(modes.map((m) => [m.id, m]));
  const groupName = new Map(ewGroups.map((g) => [g.id, g.name]));
  const rows = [...derived].sort((a, b) => naturalCompare(a.mode_name, b.mode_name, "asc"));
  return (
    <div className="table-scroll">
      <table className="data-table compact">
        <thead>
          <tr>
            <th>Mode</th>
            <th>EW Group</th>
            <th>PRI type</th>
            <th className="num">RF (MHz)</th>
            <th className="num">PRI (µs)</th>
            <th className="num">Jitter / frame time (µs)</th>
            <th className="num">PW (µs)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const m = byId.get(d.mode_id);
            if (!m) {
              return (
                <tr key={d.mode_id}>
                  <td>{d.mode_name}</td>
                  <td colSpan={6} className="hint-text">
                    Deleted since
                  </td>
                </tr>
              );
            }
            const line = m.line;
            const pri =
              m.pri_type === "fixed"
                ? span(line?.pri_min_us, line?.pri_max_us)
                : m.pri_type === "stagger"
                  ? (line?.pri_stagger_values_us ?? []).join(", ")
                  : "—";
            const extra =
              m.pri_type === "fixed"
                ? span(line?.jitter_min_us, line?.jitter_max_us)
                : m.pri_type === "stagger"
                  ? span(line?.frame_time_us, line?.frame_time_us)
                  : "—";
            return (
              <tr key={d.mode_id}>
                <td>
                  <Link to={`/emitters/${emitterId}?tab=modes&mode=${encodeURIComponent(m.name)}`}>{m.name}</Link>
                </td>
                <td>{groupName.get(m.ew_group_id) ?? "—"}</td>
                <td>{m.pri_type.toUpperCase()}</td>
                <td className="num">{span(line?.rf_min_mhz, line?.rf_max_mhz)}</td>
                <td className="num">{pri}</td>
                <td className="num">{extra}</td>
                <td className="num">{span(line?.pw_min_us, line?.pw_max_us)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
