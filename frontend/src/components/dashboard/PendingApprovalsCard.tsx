import { Link } from "react-router-dom";
import type { PendingApprovalItem } from "../../api/dashboard";
import { EmptyState } from "../common/EmptyState";

export function PendingApprovalsCard({ items }: { items: PendingApprovalItem[] }) {
  return (
    <div className="card">
      <h4>Pending Approvals</h4>
      {items.length === 0 ? (
        <EmptyState icon="✓" title="Nothing waiting" message="No Sources or Mode drafts are awaiting review." />
      ) : (
        <ul className="attention-list">
          {items.map((item, i) => (
            <li key={i}>
              <Link className="attention-item" to={`/emitters/${item.emitter_id}`}>
                {item.message}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
