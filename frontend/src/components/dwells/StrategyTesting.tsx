import { Link } from "react-router-dom";
import type { StrategyTestingEmitter, TestingState } from "../../api/dwells";
import { useStrategyTesting } from "../../state/hooks/useDwells";
import { formatDate } from "../common/dates";
import { testResultLabel } from "../testing/testFormat";

export const TESTING_LABEL: Record<TestingState, string> = {
  tested: "Tested",
  stale: "Stale",
  untested: "Untested",
  not_covered: "Not covered",
};

const BADGE: Record<TestingState, string> = {
  tested: "status-validated",
  stale: "status-pending_review",
  untested: "status-draft",
  not_covered: "status-deprecated",
};

export function TestingBadge({ state }: { state: TestingState }) {
  return <span className={`status-badge ${BADGE[state]}`}>{TESTING_LABEL[state]}</span>;
}

/** "2 untested · 1 stale": what's open in a Strategy's testing, or "All tested". */
export function testingSummary(counts: Record<TestingState, number> | null): { text: string; open: number } | null {
  if (!counts) return null;
  const open = counts.untested + counts.stale + counts.not_covered;
  const total = open + counts.tested;
  if (total === 0) return { text: "No Emitters pinned", open: 0 };
  if (open === 0) return { text: "All tested", open: 0 };
  const parts = (["untested", "stale", "not_covered"] as const)
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${TESTING_LABEL[k].toLowerCase()}`);
  return { text: parts.join(" · "), open };
}

function runCell(e: StrategyTestingEmitter) {
  const r = e.run;
  if (!r) return <span className="hint-text">—</span>;
  return (
    <>
      <Link to={`/emitters/${e.emitter_id}/tests/${r.test_record_id}`}>{r.title}</Link>{" "}
      <span className={`test-result-badge test-result-${r.result}`}>{testResultLabel(r.result)}</span>
      <div className="hint-text">
        {formatDate(r.test_date)} · Strategy v{r.strategy_version_number}
        {r.emitter_version_number != null && ` · Emitter v${r.emitter_version_number}`}
        {r.platform_test_id && " · Platform test"}
      </div>
    </>
  );
}

/** For each Platform the Strategy covers, each pinned Emitter: whether a
 * simulation run with this Strategy still holds for it. */
export function StrategyTesting({ strategyId, isDefault }: { strategyId: string; isDefault: boolean }) {
  const { data, isLoading } = useStrategyTesting(strategyId);
  if (isDefault)
    return <p className="hint-text">Default dwells aren&apos;t tied to a Platform, so there are no pinned Emitters to track.</p>;
  if (isLoading || !data) return <p className="hint-text">Loading the testing…</p>;
  if (data.version_number == null) return <p className="hint-text">Save a version first — testing is tracked against saved versions.</p>;

  return (
    <div className="strategy-testing">
      <p className="hint-text">
        As of v{data.version_number}. An Emitter is <strong>tested</strong> when a simulation run with this Strategy still
        holds: the dwells covering it have the same frequencies, dwell and collect times as then, and it hasn&apos;t moved
        outside the RF it was tested at or grown a longer PRI / frame time. Otherwise it&apos;s <strong>stale</strong>.{" "}
        <strong>Not covered</strong>: no dwell reaches its RF. A Platform test counts only for its own Platform. To count a
        run logged without a Strategy, set its Strategy on the run&apos;s page.
      </p>
      {data.platforms.map((p) => (
        <div key={p.platform_id} className="card">
          <h4>
            <Link to={`/platforms/${p.platform_id}`}>{p.platform_name}</Link>{" "}
            <span className="section-count">{p.emitters.length}</span>
          </h4>
          {p.emitters.length === 0 ? (
            <p className="hint-text">No Emitters pinned.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Emitter</th>
                    <th>Pinned</th>
                    <th>Testing</th>
                    <th className="num">Covering dwells</th>
                    <th>Run</th>
                  </tr>
                </thead>
                <tbody>
                  {p.emitters.map((e) => (
                    <tr key={e.emitter_id}>
                      <td>
                        <Link to={`/emitters/${e.emitter_id}?tab=tests`}>{e.emitter_name}</Link>
                        {e.designation && <span className="hint-text"> {e.designation}</span>}
                      </td>
                      <td>v{e.pinned_version_number}</td>
                      <td>
                        <TestingBadge state={e.state} />
                        {e.reason && <div className="hint-text">{e.reason}</div>}
                      </td>
                      <td className="num">{e.covering_dwells}</td>
                      <td>{runCell(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** A Strategy's testing in a list: what's open, linking to its Testing tab. */
export function TestingCell({ strategyId, counts }: { strategyId: string; counts: Record<TestingState, number> | null }) {
  const summary = testingSummary(counts);
  if (!summary) return <span className="hint-text">—</span>;
  return (
    <Link
      to={`/dwells/strategies/${strategyId}?tab=testing`}
      className={summary.open > 0 ? "testing-open" : "testing-done"}
      title="Pinned Emitters on its Platforms: tested with this Strategy, or not"
    >
      {summary.text}
    </Link>
  );
}
