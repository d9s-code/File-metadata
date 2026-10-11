import { type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { usePlatform } from "../state/hooks/usePlatforms";
import { usePlatformTest } from "../state/hooks/usePlatformTests";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
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
 * Emitter's notes and a link to its own test record. */
export function PlatformTestDetailPage() {
  const { platformId = "", testId = "" } = useParams<{ platformId: string; testId: string }>();
  const { data: platform } = usePlatform(platformId);
  const { data: test, isLoading, error } = usePlatformTest(testId);
  const back = <Link to={`/platforms/${platformId}?tab=tests`}>← Back to {platform?.name ?? "the Platform"}&apos;s tests</Link>;
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
      {back}
      <h1>{test.title}</h1>
      <dl className="run-facts">
        <Fact label="Result">
          <span className={`test-result-badge test-result-${test.result}`}>{testResultLabel(test.result)}</span>
          <span className="run-fact-sub">worst of the Emitters&apos;</span>
        </Fact>
        <Fact label="Type">{testTypeLabel(test.test_type)}</Fact>
        <Fact label="Tested">{test.test_date}</Fact>
        <Fact label="Emitters">{test.emitters.length}</Fact>
        {test.platform_version_number != null && (
          <Fact label="Platform version">
            <Link to={`/platforms/${platformId}/versions?version=${test.platform_version_number}`}>
              v{test.platform_version_number}
            </Link>
          </Fact>
        )}
        {test.tested_by_username && <Fact label="Tested by">{test.tested_by_username}</Fact>}
      </dl>
      {test.notes && <p className="muted pre-wrap">{test.notes}</p>}
      <RequireRole minimum="editor">
        <div className="form-row">
          <Link className="link-as-button" to={`/platforms/${platformId}/tests/new?redo=${test.id}`}>
            Redo test
          </Link>
        </div>
      </RequireRole>

      <div className="card">
        <h4>Emitters ({test.emitters.length})</h4>
        <table className="data-table">
          <thead>
            <tr>
              <th>Emitter</th>
              <th>Version tested</th>
              <th>Result</th>
              {detailed && <th>Detail</th>}
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {test.emitters.map((e) => (
              <tr key={e.test_record_id}>
                <td>
                  <Link to={`/emitters/${e.emitter_id}`}>
                    {e.designation ? `${e.designation} — ${e.emitter_name}` : e.emitter_name}
                  </Link>
                </td>
                <td>{e.version_number != null ? `v${e.version_number}` : "—"}</td>
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
                <td>
                  <Link to={`/emitters/${e.emitter_id}/tests/${e.test_record_id}`}>Open record</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
