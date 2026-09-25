import { useState } from "react";
import { Link } from "react-router-dom";
import type { NeedsAttentionItem, PendingApprovalItem } from "../../api/dashboard";
import { EmptyState } from "../common/EmptyState";

const GROUP_LIMIT = 4;

interface Group {
  key: string;
  title: string;
  items: { message: string; to: string }[];
}

function attentionLink(item: NeedsAttentionItem): string {
  return item.entity_type === "emitter"
    ? `/emitters/${item.entity_id}${item.category === "sim" ? "?tab=tests" : ""}`
    : `/mdfs/${item.entity_id}`;
}

function AttentionGroup({ group }: { group: Group }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? group.items : group.items.slice(0, GROUP_LIMIT);
  return (
    <div className="attention-group">
      <h5>
        {group.title} <span className="hint-text">({group.items.length})</span>
      </h5>
      <ul className="attention-list">
        {visible.map((item, i) => (
          <li key={i}>
            <Link className="attention-item" to={item.to}>
              {item.message}
            </Link>
          </li>
        ))}
      </ul>
      {group.items.length > GROUP_LIMIT && (
        <button type="button" className="link-button" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show fewer" : `Show all ${group.items.length}`}
        </button>
      )}
    </div>
  );
}

/** Everything waiting on someone, grouped by kind — including Sources
 * awaiting review, which used to have a card of their own. */
export function NeedsAttentionCard({
  items,
  pendingApprovals,
}: {
  items: NeedsAttentionItem[];
  pendingApprovals: PendingApprovalItem[];
}) {
  const byCategory = (category: NeedsAttentionItem["category"]) =>
    items.filter((i) => i.category === category).map((i) => ({ message: i.message, to: attentionLink(i) }));
  const groups: Group[] = [
    { key: "sim", title: "Simulation", items: byCategory("sim") },
    { key: "rework", title: "Needs rework", items: byCategory("rework") },
    {
      key: "sources",
      title: "Sources awaiting review",
      items: pendingApprovals.map((p) => ({ message: p.message, to: `/emitters/${p.emitter_id}` })),
    },
    { key: "stale", title: "Stalled", items: byCategory("stale") },
    { key: "mdf", title: "MDFs", items: byCategory("mdf") },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="card">
      <h4>Needs Attention</h4>
      {groups.length === 0 ? (
        <EmptyState icon="✓" title="All clear" message="Nothing needs attention right now." />
      ) : (
        <div className="dashboard-scroll-body">
          {groups.map((g) => (
            <AttentionGroup key={g.key} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}
