import { Link } from "react-router-dom";
import { formatDate } from "../common/dates";
import type { TestRunDraft } from "../../api/testRecords";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { EmptyState } from "../common/EmptyState";
import { relativeTime } from "../common/backupFormat";
import { testResultLabel, testTypeLabel } from "../testing/testFormat";
import type { PlatformTest } from "../../api/platformTests";
import { useDiscardPlatformTestDraft, usePlatformTestDrafts, usePlatformTests } from "../../state/hooks/usePlatformTests";

/** A Platform's tests: runs in progress, and the logged ones — each with
 * every Emitter's result, linking to that Emitter's record. */
export function PlatformTests({ platformId, pinnedCount }: { platformId: string; pinnedCount: number }) {
  const { data: tests, isLoading } = usePlatformTests(platformId);
  const { data: drafts } = usePlatformTestDrafts(platformId);
  const discard = useDiscardPlatformTestDraft(platformId);
  const { confirmDelete, dialog } = useConfirmDialog();

  async function handleDiscard(d: TestRunDraft) {
    if (
      await confirmDelete(`Discard "${d.title || "Untitled Platform test"}"? What's been filled in is lost.`, {
        confirmLabel: "Discard",
        danger: true,
      })
    )
      discard.mutate(d.id);
  }

  return (
    <section className="card">
      <div className="page-header-row">
        <h4>Platform tests</h4>
        <RequireRole minimum="editor">
          {pinnedCount > 0 ? (
            <Link className="link-as-button" to={`/platforms/${platformId}/tests/new`}>
              + New Platform test
            </Link>
          ) : (
            <span className="hint-text">Pin Emitters to test them together.</span>
          )}
        </RequireRole>
      </div>
      <p className="hint-text">
        Every pinned Emitter tested in one run. Each Emitter&apos;s results are logged as its own test record —
        against the version the Platform pins — and show in its Test History too.
      </p>

      {!!drafts?.length && (
        <div className="test-drafts">
          <h5>In progress</h5>
          <ul>
            {drafts.map((d) => (
              <li key={d.id}>
                <span className="test-draft-badge">In progress</span>
                <strong>{d.title || "Untitled Platform test"}</strong>
                <span className="hint-text">
                  {testTypeLabel(d.test_type)}
                  {d.summary ? ` · ${d.summary}` : ""} · last saved {relativeTime(d.updated_at)}
                  {d.updated_by_username ? ` by ${d.updated_by_username}` : ""}
                </span>
                <RequireRole minimum="editor">
                  <Link className="link-as-button" to={`/platforms/${platformId}/tests/new?draft=${d.id}`}>
                    Continue
                  </Link>
                  <button type="button" className="link-button link-button-danger" onClick={() => void handleDiscard(d)}>
                    Discard
                  </button>
                </RequireRole>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tests && tests.length > 1 && <PlatformTestTrend platformId={platformId} tests={tests} />}

      {isLoading ? (
        <p className="hint-text">Loading…</p>
      ) : !tests?.length ? (
        <EmptyState icon="☐" title="No Platform tests yet" message="Start one to test every pinned Emitter in one run." />
      ) : (
        <table className="data-table platform-tests-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Title</th>
              <th>Type</th>
              <th>Result</th>
              <th>Emitters</th>
              <th>Platform version</th>
              <th>Tested by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tests.map((t) => (
              <tr key={t.id}>
                <td>{formatDate(t.test_date)}</td>
                <td title={t.notes ?? undefined}>
                  <Link to={`/platforms/${platformId}/tests/${t.id}`}>{t.title}</Link>
                </td>
                <td>{testTypeLabel(t.test_type)}</td>
                <td>
                  <span className={`test-result-badge test-result-${t.result}`}>{testResultLabel(t.result)}</span>
                </td>
                <td>
                  <ul className="platform-test-results">
                    {t.emitters.map((e) => (
                      <li key={e.test_record_id}>
                        <span className={`test-result-badge test-result-${e.result}`}>{testResultLabel(e.result)}</span>{" "}
                        <Link to={`/emitters/${e.emitter_id}/tests/${e.test_record_id}`}>
                          {e.designation ? `${e.designation} — ${e.emitter_name}` : e.emitter_name}
                        </Link>
                        <span className="hint-text">
                          {e.version_number != null ? ` · v${e.version_number}` : ""}
                          {e.computed_result ? ` · worked out ${testResultLabel(e.computed_result)}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td>{t.platform_version_number != null ? `v${t.platform_version_number}` : "—"}</td>
                <td>{t.tested_by_username ?? "—"}</td>
                <td>
                  <RequireRole minimum="editor">
                    <Link to={`/platforms/${platformId}/tests/new?redo=${t.id}`}>Redo</Link>
                  </RequireRole>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {dialog}
    </section>
  );
}

const TREND_RUNS = 12;

/** Each Emitter's result across the latest Platform tests, oldest to newest:
 * a row per Emitter, a column per test. */
function PlatformTestTrend({ platformId, tests }: { platformId: string; tests: PlatformTest[] }) {
  const runs = [...tests].slice(0, TREND_RUNS).reverse();
  const emitters = new Map<string, string>();
  for (const t of runs)
    for (const e of t.emitters) emitters.set(e.emitter_id, e.designation ? `${e.designation} — ${e.emitter_name}` : e.emitter_name);
  const rows = [...emitters.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <div className="platform-test-trend">
      <h5>
        Trend <span className="hint-text">— each Emitter&apos;s result in the latest {runs.length} Platform tests, oldest first</span>
      </h5>
      <div className="matrix-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Emitter</th>
              {runs.map((t) => (
                <th key={t.id} className="trend-col" title={t.title}>
                  <Link to={`/platforms/${platformId}/tests/${t.id}`}>{formatDate(t.test_date)}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([id, name]) => (
              <tr key={id}>
                <td>{name}</td>
                {runs.map((t) => {
                  const e = t.emitters.find((x) => x.emitter_id === id);
                  return (
                    <td key={t.id} className="trend-col">
                      {e ? (
                        <Link to={`/emitters/${id}/tests/${e.test_record_id}`} title={`${t.title} — open the record`}>
                          <span className={`test-result-badge test-result-${e.result}`}>{testResultLabel(e.result)}</span>
                        </Link>
                      ) : (
                        <span className="hint-text" title="Not in this run">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
