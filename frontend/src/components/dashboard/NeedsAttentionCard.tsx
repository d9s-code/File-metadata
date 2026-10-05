import { useState } from "react";
import { Link } from "react-router-dom";
import type { NeedsAttentionItem, PendingApprovalItem } from "../../api/dashboard";
import { EmptyState } from "../common/EmptyState";

/** Items listed per group before "Show all". */
const GROUP_LIMIT = 4;

interface Group {
  key: string;
  title: string;
  /** What to do about this kind of item, shown as the group's tooltip. */
  hint: string;
  items: { message: string; to: string }[];
}

const PATHS: Record<NeedsAttentionItem["entity_type"], string> = {
  emitter: "/emitters",
  platform: "/platforms",
  mdf: "/mdfs",
  intercept: "/intercepts",
};

function attentionLink(item: NeedsAttentionItem): string {
  if (item.category === "ambiguity") return `/ambiguity/${item.entity_type}/${item.entity_id}`;
  const base = `${PATHS[item.entity_type]}/${item.entity_id}`;
  return item.category === "sim" ? `${base}?tab=tests` : base;
}

function AttentionGroup({ group, open, onToggle }: { group: Group; open: boolean; onToggle: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? group.items : group.items.slice(0, GROUP_LIMIT);
  return (
    <section className="attention-group">
      <button type="button" className="attention-group-head" aria-expanded={open} onClick={onToggle} title={group.hint}>
        <span>{open ? "▾" : "▸"}</span>
        <span className="attention-group-title">{group.title}</span>
        <span className="section-count">{group.items.length}</span>
      </button>
      {open && (
        <>
          <ul className="attention-lines">
            {visible.map((item, i) => (
              <li key={i}>
                <Link to={item.to} title={item.message}>
                  {item.message}
                </Link>
              </li>
            ))}
          </ul>
          {group.items.length > GROUP_LIMIT && (
            <button type="button" className="link-button attention-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${group.items.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** Everything waiting on someone, one line each, grouped by kind. Groups fold
 * away; the first two start open. */
export function NeedsAttentionCard({
  items,
  pendingApprovals,
  wide,
}: {
  items: NeedsAttentionItem[];
  pendingApprovals: PendingApprovalItem[];
  wide: boolean;
}) {
  const byCategory = (category: NeedsAttentionItem["category"]) =>
    items.filter((i) => i.category === category).map((i) => ({ message: i.message, to: attentionLink(i) }));
  const groups: Group[] = [
    { key: "sim", title: "Simulation", hint: "SIM Test Lines that went wrong, or tests that are out of date", items: byCategory("sim") },
    { key: "rework", title: "Needs rework", hint: "Emitters moved to Needs rework", items: byCategory("rework") },
    {
      key: "sources",
      title: "Sources awaiting review",
      hint: "Approve or reject them on the Emitter's Groups & Sources tab",
      items: pendingApprovals.map((p) => ({ message: p.message, to: `/emitters/${p.emitter_id}` })),
    },
    {
      key: "intercepts",
      title: "Intercepts not covered",
      hint: "Entries no Mode matches, not even nearly — Plan Modes on the Intercept's page",
      items: byCategory("intercepts"),
    },
    {
      key: "ambiguity",
      title: "Ambiguity",
      hint: "Serious overlaps in the latest ambiguity check that nobody has reviewed yet",
      items: byCategory("ambiguity"),
    },
    { key: "locks", title: "Held for editing", hint: "Held over 8 hours — nobody else can edit them", items: byCategory("locks") },
    { key: "stale", title: "Stalled", hint: "In progress with no commit for over a week", items: byCategory("stale") },
    { key: "mdf", title: "MDF readiness", hint: "Open readiness warnings on MDFs in progress", items: byCategory("mdf") },
  ].filter((g) => g.items.length > 0);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (key: string, index: number) => open[key] ?? index < 2;
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className={wide ? "card dashboard-wide attention-card" : "card attention-card"}>
      <div className="dashboard-card-header">
        <h4>
          Needs Attention {total > 0 && <span className="section-count">{total}</span>}
        </h4>
        {groups.length > 1 && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              const anyClosed = groups.some((g, i) => !isOpen(g.key, i));
              setOpen(Object.fromEntries(groups.map((g) => [g.key, anyClosed])));
            }}
          >
            {groups.some((g, i) => !isOpen(g.key, i)) ? "Open all" : "Fold all"}
          </button>
        )}
      </div>
      {groups.length === 0 ? (
        <EmptyState icon="✓" title="All clear" message="Nothing needs attention right now." />
      ) : (
        <div className="dashboard-scroll-body">
          {groups.map((g, i) => (
            <AttentionGroup
              key={g.key}
              group={g}
              open={isOpen(g.key, i)}
              onToggle={() => setOpen((o) => ({ ...o, [g.key]: !isOpen(g.key, i) }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
