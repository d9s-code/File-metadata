import { Link } from "react-router-dom";
import type { TestRecordBrief } from "../../types/domain";
import { HoverInfo } from "../common/InfoPopover";

export function testLink(emitterId: string, recordId: string) {
  return `/emitters/${emitterId}?tab=tests&testRecord=${recordId}`;
}

export function mdfTestLink(mdfId: string, recordId: string) {
  return `/mdfs/${mdfId}?tab=tests&testRecord=${recordId}`;
}

export function TestDerivedBadge({ emitterId, records }: { emitterId: string; records: TestRecordBrief[] }) {
  if (records.length === 0) return null;

  // A single derivation: the badge itself is a direct one-click link to that
  // test. Multiple: which one to jump to is ambiguous from a single click,
  // so keep the hover popover and make each listed test its own link.
  if (records.length === 1) {
    const r = records[0];
    return (
      <Link
        to={testLink(emitterId, r.id)}
        className="test-derived-badge"
        title={`${r.title} — ${r.test_type.replace("_", " ")}, ${r.test_date} (${r.result})`}
      >
        Test-Derived
      </Link>
    );
  }

  return (
    <HoverInfo label={<span className="test-derived-badge">Test-Derived</span>}>
      <dl>
        <dt>Explained by</dt>
        {records.map((r) => (
          <dd key={r.id}>
            <Link to={testLink(emitterId, r.id)}>
              {r.title} — {r.test_type.replace("_", " ")}, {r.test_date} ({r.result})
            </Link>
          </dd>
        ))}
      </dl>
    </HoverInfo>
  );
}
