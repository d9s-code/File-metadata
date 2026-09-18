import { Link } from "react-router-dom";
import type { InterceptEntryBrief } from "../../types/domain";
import { HoverInfo } from "../common/InfoPopover";

export function InterceptDerivedBadge({ intercepts }: { intercepts: InterceptEntryBrief[] }) {
  if (intercepts.length === 0) return null;

  if (intercepts.length === 1) {
    const e = intercepts[0];
    return (
      <Link
        to={`/intercepts/${e.intercept_id}`}
        className="test-derived-badge"
        title={`Intercept entry (${e.pri_type}), logged ${new Date(e.created_at).toLocaleDateString()}`}
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
              Intercept entry ({e.pri_type}), {new Date(e.created_at).toLocaleDateString()}
            </Link>
          </dd>
        ))}
      </dl>
    </HoverInfo>
  );
}
