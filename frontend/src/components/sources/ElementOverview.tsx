import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ElementType } from "../../types/domain";
import { useElementOverview } from "../../state/hooks/useElements";
import { elementValues, VariantTag } from "./elementDisplay";

const TYPES: [ElementType | "", string][] = [
  ["", "All"],
  ["rf", "RF"],
  ["pri", "PRI"],
  ["pw", "PW"],
  ["scan", "Scan"],
];

/** Every distinct Element across the Emitter's Sources — the same values in
 * several Sources are one row, listing each Source (and its variant). */
export function ElementOverview({ emitterId }: { emitterId: string }) {
  const { data: rows, isLoading } = useElementOverview(emitterId);
  const [type, setType] = useState<ElementType | "">("");
  const [variant, setVariant] = useState("");
  const [sharedOnly, setSharedOnly] = useState(false);
  const [open, setOpen] = useState(true);

  const variants = useMemo(
    () => [...new Set((rows ?? []).flatMap((r) => r.occurrences.map((o) => o.variant ?? "")))].filter(Boolean).sort(),
    [rows],
  );
  const shown = (rows ?? []).filter(
    (r) =>
      (!type || r.element_type === type) &&
      (!variant || r.occurrences.some((o) => o.variant === variant)) &&
      (!sharedOnly || new Set(r.occurrences.map((o) => o.source_id)).size > 1),
  );
  const counts = Object.fromEntries(TYPES.map(([t]) => [t, (rows ?? []).filter((r) => !t || r.element_type === t).length]));

  return (
    <div className="card element-overview">
      <div className="card-header-row">
        <h3>
          Element overview <span className="hint-text">{rows ? `${rows.length} distinct` : ""}</span>
        </h3>
        <button type="button" className="link-button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <>
          <p className="hint-text">
            Every distinct Element across this Emitter&apos;s Sources. The same values in several Sources are one row,
            listing each Source with its variant and margin.
          </p>
          <div className="element-overview-filters">
            <div className="theme-toggle" role="group" aria-label="Element type">
              {TYPES.map(([t, label]) => (
                <button key={t} type="button" className={type === t ? "active" : undefined} onClick={() => setType(t)}>
                  {label} ({counts[t] ?? 0})
                </button>
              ))}
            </div>
            <select value={variant} onChange={(e) => setVariant(e.target.value)} aria-label="Variant">
              <option value="">All variants</option>
              {variants.map((v) => (
                <option key={v} value={v}>
                  {v.replace("_", " ")}
                </option>
              ))}
            </select>
            <label className="inline-label">
              <input type="checkbox" checked={sharedOnly} onChange={(e) => setSharedOnly(e.target.checked)} /> In more than
              one Source
            </label>
          </div>
          {isLoading ? (
            <p className="hint-text">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="hint-text">{rows?.length ? "No Elements match the filters." : "No Elements in any Source yet."}</p>
          ) : (
            <div className="table-scroll element-overview-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Values</th>
                    <th>Found in</th>
                    <th>Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={i}>
                      <td>{r.element_type.toUpperCase()}</td>
                      <td className="nowrap">{elementValues(r)}</td>
                      <td>
                        <ul className="element-overview-found">
                          {r.occurrences.map((o) => (
                            <li key={o.element_id}>
                              <Link to={`/emitters/${emitterId}?tab=setup&source=${o.source_id}`}>{o.source_name}</Link>{" "}
                              <VariantTag variant={o.variant} />
                              {o.label && <span className="hint-text"> · {o.label}</span>}
                              {o.delta != null && <span className="hint-text"> · ± {o.delta}</span>}
                              {o.source_status === "rejected" && <span className="hint-text"> · rejected</span>}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>{new Set(r.occurrences.map((o) => o.source_id)).size}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
