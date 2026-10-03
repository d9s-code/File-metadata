import { Link } from "react-router-dom";
import type { InterceptEntryBrief } from "../../types/domain";
import { HoverInfo } from "../common/InfoPopover";

/** "Intercept 'Baltic sortie' — a Fixed entry at 9300.012 MHz". */
function describe(e: InterceptEntryBrief) {
  const type = e.pri_type === "cw" ? "CW" : e.pri_type === "stagger" ? "Stagger" : "Fixed";
  return `${e.intercept_name ? `Intercept '${e.intercept_name}'` : "an Intercept"} — a ${type} entry at ${e.rf_mean_mhz} MHz`;
}

export function InterceptDerivedBadge({ intercepts }: { intercepts: InterceptEntryBrief[] }) {
  if (intercepts.length === 0) return null;

  if (intercepts.length === 1) {
    const e = intercepts[0];
    return (
      <Link
        to={`/intercepts/${e.intercept_id}`}
        className="test-derived-badge"
        title={`Made or widened for ${describe(e)}`}
      >
        Intercept-Derived
      </Link>
    );
  }

  return (
    <HoverInfo label={<span className="test-derived-badge">Intercept-Derived</span>}>
      <dl>
        <dt>Explained by</dt>
        {intercepts.map((e) => (
          <dd key={e.id}>
            <Link to={`/intercepts/${e.intercept_id}`}>
              {describe(e)}
            </Link>
          </dd>
        ))}
      </dl>
    </HoverInfo>
  );
}
