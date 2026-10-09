import { Link } from "react-router-dom";
import type { TestRunDraft } from "../../api/testRecords";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { EmptyState } from "../common/EmptyState";
import { relativeTime } from "../common/backupFormat";
import { testTypeLabel } from "../testing/testFormat";
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
            </tr>
          </thead>
          <tbody>
            {tests.map((t) => (
              <tr key={t.id}>
                <td>{t.test_date}</td>
                <td title={t.notes ?? undefined}>{t.title}</td>
                <td>{testTypeLabel(t.test_type)}</td>
                <td>
                  <span className={`test-result-badge test-result-${t.result}`}>{t.result}</span>
                </td>
                <td>
                  <ul className="platform-test-results">
                    {t.emitters.map((e) => (
                      <li key={e.test_record_id}>
                        <span className={`test-result-badge test-result-${e.result}`}>{e.result}</span>{" "}
                        <Link to={`/emitters/${e.emitter_id}/tests/${e.test_record_id}`}>
                          {e.designation ? `${e.designation} — ${e.emitter_name}` : e.emitter_name}
                        </Link>
                        <span className="hint-text">
                          {e.version_number != null ? ` · v${e.version_number}` : ""}
                          {e.lines ? ` · ${e.lines} SIM line${e.lines === 1 ? "" : "s"}` : ""}
                          {e.modes ? ` · ${e.modes} Mode${e.modes === 1 ? "" : "s"}` : ""}
                          {e.signals ? ` · ${e.signals} signal${e.signals === 1 ? "" : "s"}` : ""}
                          {e.computed_result ? ` · worked out ${e.computed_result}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td>{t.platform_version_number != null ? `v${t.platform_version_number}` : "—"}</td>
                <td>{t.tested_by_username ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {dialog}
    </section>
  );
}
