import type { ReactNode } from "react";
import { PageHeader } from "../components/common/PageHeader";
import { LoadingState } from "../components/common/LoadingState";
import { BackupCard } from "../components/dashboard/BackupCard";
import { CurrentMdfCard } from "../components/dashboard/CurrentMdfCard";
import { CustomerChangesCard } from "../components/dashboard/CustomerChangesCard";
import { HealthCard } from "../components/dashboard/HealthCard";
import { LatestRunsCard, NeedsRedoCard } from "../components/dashboard/TestRunCards";
import { YourWorkRow } from "../components/dashboard/YourWorkRow";
import { useDashboardHealth, useDashboardRelease, useDashboardTestRuns } from "../state/hooks/useDashboard";

/** One row per subject; in a row, the cards are the same height. */
function Row({ title, wide = false, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className="dashboard-row" aria-label={title}>
      <h2 className="dashboard-row-title">{title}</h2>
      <div className={wide ? "dashboard-row-cards one" : "dashboard-row-cards"}>{children}</div>
    </section>
  );
}

function Loading({ title }: { title: string }) {
  return (
    <div className="card">
      <h2 className="as-h4">{title}</h2>
      <LoadingState label={`Loading ${title.toLowerCase()}…`} />
    </div>
  );
}

/** Your work; the current release (the MDF being worked towards and its
 * changelog); testing; health and backups. Each card loads on its own. */
export function DashboardPage() {
  const release = useDashboardRelease();
  const testRuns = useDashboardTestRuns();
  const health = useDashboardHealth();

  return (
    <div className="page dashboard-page">
      <PageHeader title="Dashboard" />
      <Row title="Your work" wide>
        <YourWorkRow />
      </Row>
      <Row title="Current release">
        {release.data ? <CurrentMdfCard release={release.data} /> : <Loading title="Current MDF" />}
        {release.data ? <CustomerChangesCard release={release.data} /> : <Loading title="MDF Changelog" />}
      </Row>
      <Row title="Testing">
        {testRuns.data ? <LatestRunsCard runs={testRuns.data.recent_test_runs} /> : <Loading title="Latest test runs" />}
        {testRuns.data ? <NeedsRedoCard items={testRuns.data.needs_redo} /> : <Loading title="Needs a redo" />}
      </Row>
      <Row title="Health & backups">
        <HealthCard health={health.data} />
        <BackupCard compact />
      </Row>
    </div>
  );
}
