import { Link } from "react-router-dom";
import { useDashboard } from "../state/hooks/useDashboard";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import type { NeedsAttentionItem } from "../api/dashboard";
import type { EmitterStatus } from "../types/domain";
import { emitterStatusLabel } from "../components/common/emitterStatusLabel";
import { StatusSummaryCard } from "../components/dashboard/StatusSummaryCard";
import { PendingApprovalsCard } from "../components/dashboard/PendingApprovalsCard";
import { TestVerificationCard } from "../components/dashboard/TestVerificationCard";
import { ModesPassingBars } from "../components/dashboard/ModesPassingBars";
import { RecentActivityCard } from "../components/dashboard/RecentActivityCard";
import { ActivityTrendChart } from "../components/dashboard/ActivityTrendChart";

function attentionLink(item: NeedsAttentionItem): string {
  return item.entity_type === "emitter" ? `/emitters/${item.entity_id}` : `/mdfs/${item.entity_id}`;
}

export function DashboardPage() {
  const { data, isLoading } = useDashboard();

  if (isLoading || !data) return <LoadingState label="Loading dashboard…" />;

  return (
    <div className="page">
      <h1>Dashboard</h1>

      <div className="dashboard-grid">
        <StatusSummaryCard
          title="Emitters"
          counts={data.emitter_status_counts}
          labelFor={(status) => emitterStatusLabel(status as EmitterStatus)}
        />
        <StatusSummaryCard title="MDFs" counts={data.mdf_status_counts} />

        <div className="card">
          <h4>Needs Attention</h4>
          {data.needs_attention.length === 0 ? (
            <EmptyState icon="✓" title="All clear" message="Nothing needs attention right now." />
          ) : (
            <ul className="attention-list">
              {data.needs_attention.map((item, i) => (
                <li key={i}>
                  <Link className="attention-item" to={attentionLink(item)}>
                    {item.message}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <PendingApprovalsCard items={data.pending_approvals} />

        <TestVerificationCard
          modesPassing={data.modes_passing_total}
          modesTotal={data.modes_total}
          resultCounts={data.test_result_counts}
          needsRedo={data.needs_redo}
        />

        <ModesPassingBars />

        <RecentActivityCard entries={data.recent_activity} />

        <ActivityTrendChart points={data.activity_trend} />
      </div>
    </div>
  );
}
