import { Link } from "react-router-dom";
import type { NeedsRedoTestItem } from "../../api/dashboard";
import { testLink, mdfTestLink } from "../modes/TestDerivedBadge";
import { EmptyState } from "../common/EmptyState";

function redoLink(item: NeedsRedoTestItem): string {
  return item.entity_type === "emitter"
    ? testLink(item.entity_id, item.test_record_id)
    : mdfTestLink(item.entity_id, item.test_record_id);
}

export function NeedsRedoList({ items }: { items: NeedsRedoTestItem[] }) {
  if (items.length === 0) {
    return <EmptyState icon="✓" title="Nothing to redo" message="Every failed or partial test has a retest on file." />;
  }
  return (
    <div className="dashboard-table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>{items.some((i) => i.entity_type === "mdf") ? "Emitter / MDF" : "Emitter"}</th>
            <th>Test</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.test_record_id}>
              <td>{item.test_date}</td>
              <td>{item.entity_name}</td>
              <td>
                <Link to={redoLink(item)}>{item.title}</Link>
              </td>
              <td>
                <span className={`test-result-badge test-result-${item.result}`}>{item.result}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
