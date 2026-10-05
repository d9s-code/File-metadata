import { useAuth } from "../auth/AuthContext";
import { useDashboardAttention, useDashboardOverview, useDashboardTestRuns } from "../state/hooks/useDashboard";
import { LoadingState } from "../components/common/LoadingState";
import { LifecycleCard } from "../components/dashboard/LifecycleCard";
import { NeedsAttentionCard } from "../components/dashboard/NeedsAttentionCard";
import { EmitterSimTable } from "../components/dashboard/EmitterSimTable";
import { TestRunsCard } from "../components/dashboard/TestRunsCard";
import { RecentActivityCard } from "../components/dashboard/RecentActivityCard";
import { BackupCard } from "../components/dashboard/BackupCard";
import { MyWorkCard } from "../components/dashboard/MyWorkCard";
import { AdminCard } from "../components/dashboard/AdminCard";

/** A card still loading — the rest of the dashboard doesn't wait for it. */
function Loading({ title, className = "card" }: { title: string; className?: string }) {
  return (
    <div className={className}>
      <h4>{title}</h4>
      <LoadingState label={`Loading ${title.toLowerCase()}…`} />
    </div>
  );
}

/** Each card loads on its own. Three columns: My work across the top; Needs
 * Attention beside the status counts (and, for admins, the Admin card);
 * Simulation validation beside Test Runs; Recent Activity beside Backup. */
export function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const overview = useDashboardOverview();
  const attention = useDashboardAttention();
  const testRuns = useDashboardTestRuns();

  return (
    <div className="page">
      <h1>Dashboard</h1>

      <div className="dashboard-grid">
        <MyWorkCard />

        {attention.data ? (
          <NeedsAttentionCard
            items={attention.data.needs_attention}
            pendingApprovals={attention.data.pending_approvals}
            wide={!isAdmin}
          />
        ) : (
          <Loading title="Needs Attention" className={isAdmin ? "card" : "card dashboard-wide"} />
        )}
        {overview.data ? (
          <LifecycleCard emitterCounts={overview.data.emitter_status_counts} mdfCounts={overview.data.mdf_status_counts} />
        ) : (
          <Loading title="Emitters" />
        )}
        {isAdmin && <AdminCard />}

        {overview.data ? (
          <EmitterSimTable rows={overview.data.emitter_sim_status} counts={overview.data.sim_line_counts} />
        ) : (
          <Loading title="Simulation validation" className="card dashboard-wide" />
        )}
        {testRuns.data ? (
          <TestRunsCard runs={testRuns.data.recent_test_runs} needsRedo={testRuns.data.needs_redo} />
        ) : (
          <Loading title="Test Runs" />
        )}

        <RecentActivityCard wide />
        <BackupCard />
      </div>
    </div>
  );
}
