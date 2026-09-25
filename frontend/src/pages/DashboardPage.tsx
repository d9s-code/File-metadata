import { useDashboard } from "../state/hooks/useDashboard";
import { LoadingState } from "../components/common/LoadingState";
import type { EmitterStatus } from "../types/domain";
import { emitterStatusLabel } from "../components/common/emitterStatusLabel";
import { StatusSummaryCard } from "../components/dashboard/StatusSummaryCard";
import { NeedsAttentionCard } from "../components/dashboard/NeedsAttentionCard";
import { SimValidationCard } from "../components/dashboard/SimValidationCard";
import { EmitterSimTable } from "../components/dashboard/EmitterSimTable";
import { TestRunsCard } from "../components/dashboard/TestRunsCard";
import { RecentActivityCard } from "../components/dashboard/RecentActivityCard";

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
        <SimValidationCard counts={data.sim_line_counts} rows={data.emitter_sim_status} />

        <NeedsAttentionCard items={data.needs_attention} pendingApprovals={data.pending_approvals} />
        <EmitterSimTable rows={data.emitter_sim_status} />

        <TestRunsCard runs={data.recent_test_runs} needsRedo={data.needs_redo} />
        <RecentActivityCard entries={data.recent_activity} />
      </div>
    </div>
  );
}
