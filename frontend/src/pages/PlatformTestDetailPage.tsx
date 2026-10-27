import { type ReactNode } from "react";
import { BackLink } from "../components/common/BackLink";
import { PlatformNotesDrawer } from "../components/common/EntityNotesDrawer";
import { formatDate } from "../components/common/dates";
import { Link, useParams } from "react-router-dom";
import { usePlatform } from "../state/hooks/usePlatforms";
import { usePlatformTest } from "../state/hooks/usePlatformTests";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { PageHeader } from "../components/common/PageHeader";
import { lineOutcomeLabel, TEST_RESULTS, testResultLabel, testTypeLabel } from "../components/testing/testFormat";
import type { TestResult } from "../types/domain";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="run-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Counts({ counts, label }: { counts: Partial<Record<TestResult, number>>; label: (r: TestResult) => string }) {
  return (
    <>
      {TEST_RESULTS.filter((r) => counts[r]).map((r) => (
        <span key={r} className={`test-result-badge test-result-${r}`}>
          {counts[r]} {label(r)}
        </span>
      ))}
    </>
  );
}

/** One Platform test: how it came out overall and for each Emitter, with each
 * Emitter's notes — its name opens that Emitter's own test record. */
export function PlatformTestDetailPage() {
  const { platformId = "", testId = "" } = useParams<{ platformId: string; testId: string }>();
  const { data: platform } = usePlatform(platformId);
  const { data: test, isLoading, error } = usePlatformTest(testId);
  const back = <BackLink to={`/platforms/${platformId}?tab=tests`}>{platform?.name ?? "Platform"} · Tests</BackLink>;
  if (isLoading) return <LoadingState label="Loading Platform test…" />;
  if (!test || error)
    return (
      <div className="page">
        {back}
        <p className="hint-text">This Platform test doesn&rsquo;t exist (its records may have been deleted).</p>
      </div>
    );
  const detailed = test.emitters.some((e) => e.lines || e.modes || e.signals);

  return (
    <div className="page">
      {platform && <PlatformNotesDrawer platformId={platformId} name={platform.name} />}
      {back}
      <PageHeader title={test.title}>
        <RequireRole minimum="editor">
          <Link className="button primary" to={`/platforms/${platformId}/tests/new?redo=${test.id}`}>
            Redo test
          </Link>
        </RequireRole>
      </PageHeader>
      <dl className="run-facts">
        <Fact label="Result">
          <span className={`test-result-badge test-result-${test.result}`}>{testResultLabel(test.result)}</span>
          <span className="run-fact-sub">worst of the Emitters&apos;</span>
        </Fact>
        <Fact label="Type">{testTypeLabel(test.test_type)}</Fact>
        <Fact label="Tested">{formatDate(test.test_date)}</Fact>
        <Fact label="Emitters">{test.emitters.length}</Fact>
        {test.dwell_strategy_id && (
          <Fact label="Dwell">
            <Link to={`/dwells/strategies/${test.dwell_strategy_id}`}>{test.dwell_strategy_name}</Link> v
            {test.dwell_strategy_version_number}
          </Fact>
        )}
        {test.received_power_dbfs != null && <Fact label="Received power">{test.received_power_dbfs} dBFS</Fact>}
        {test.platform_version_number != null && (
          <Fact label="Platform version">
            <Link to={`/platforms/${platformId}/versions?version=${test.platform_version_number}`}>
              v{test.platform_version_number}
            </Link>
          </Fact>
        )}
        {test.tested_by_username && <Fact label="Tested by">{test.tested_by_username}</Fact>}
      </dl>
      {test.notes && (
        <div className="run-notes">
          <h4>Session notes</h4>
          <p className="pre-wrap">{test.notes}</p>
        </div>
      )}

      <div className="card">
        <h4>Emitters ({test.emitters.length})</h4>
        <table className="data-table">
          <thead>
            <tr>
              <th>Emitter</th>
              <th>Version tested</th>
              {test.test_type !== "intercept" && <th>Simulation created</th>}
              <th>Result</th>
              {detailed && <th>Detail</th>}
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {test.emitters.map((e) => (
              <tr key={e.test_record_id}>
                <td>
                  <Link to={`/emitters/${e.emitter_id}/tests/${e.test_record_id}`} title="Open this Emitter's test record">
                    {e.designation ? `${e.designation} — ${e.emitter_name}` : e.emitter_name}
                  </Link>
                </td>
                <td>
                  {e.version_number != null ? (
                    <Link to={`/emitters/${e.emitter_id}/versions?version=${e.version_number}`}>v{e.version_number}</Link>
                  ) : (
                    "—"
                  )}
                </td>
                {test.test_type !== "intercept" && <td className="nowrap">{formatDate(e.simulation_created_date)}</td>}
                <td className="nowrap">
                  <span className={`test-result-badge test-result-${e.result}`}>{testResultLabel(e.result)}</span>
                  {e.computed_result && (
                    <span className="hint-text"> set by hand · worked out {testResultLabel(e.computed_result)}</span>
                  )}
                </td>
                {detailed && (
                  <td>
                    <Counts counts={e.line_counts} label={lineOutcomeLabel} />
                    <Counts counts={e.mode_counts} label={testResultLabel} />
                    {e.signals > 0 && <span className="hint-text"> {e.signals} signal{e.signals === 1 ? "" : "s"}</span>}
                  </td>
                )}
                <td className="pre-wrap">{e.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
