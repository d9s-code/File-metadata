import { Link, useNavigate } from "react-router-dom";
import {
  useDeleteEmitterTestRecord,
  useDiscardTestDraft,
  useEmitterTestDrafts,
  useEmitterTestRecords,
} from "../../state/hooks/useTestRecords";
import type { TestRunDraft } from "../../api/testRecords";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { relativeTime } from "../common/backupFormat";
import { testTypeLabel } from "./testFormat";
import { useEmitterTestLines } from "../../state/hooks/useTestLines";
import { RequireRole } from "../../auth/RequireAuth";
import { SimTestLinesPanel } from "./SimTestLinesPanel";
import { TestRecordsTable } from "./TestRecordsTable";
import { SimulationTrend } from "./SimulationTrend";

export function EmitterTestHistory({
  emitterId,
  highlightTestRecordId,
}: {
  emitterId: string;
  highlightTestRecordId?: string;
}) {
  const { data: records } = useEmitterTestRecords(emitterId);
  const { data: testLines } = useEmitterTestLines(emitterId);
  const del = useDeleteEmitterTestRecord(emitterId);
  const navigate = useNavigate();

  return (
    <div>
      <SimTestLinesPanel emitterId={emitterId} lines={testLines ?? []} />
      <SimulationTrend emitterId={emitterId} records={records ?? []} />
      <div className="card">
        <div className="card-header">
          <h4>
            Test runs <span className="hint-text section-count">{records?.length ?? ""}</span>
          </h4>
          <RequireRole minimum="editor">
            <Link className="link-as-button" to={`/emitters/${emitterId}/tests/new`}>
              + New Test Run
            </Link>
          </RequireRole>
        </div>
        <DraftsInProgress emitterId={emitterId} />
        <TestRecordsTable
          records={records ?? []}
          emitterId={emitterId}
          onDelete={(id) => del.mutateAsync(id)}
          onRedo={(r) => navigate(`/emitters/${emitterId}/tests/new?retest=${r.id}`)}
          highlightId={highlightTestRecordId}
        />
      </div>
    </div>
  );
}

/** Test runs started but not yet logged — saved as they were filled in, to be
 * continued by anyone who can log tests. */
function DraftsInProgress({ emitterId }: { emitterId: string }) {
  const { data: drafts } = useEmitterTestDrafts(emitterId);
  const discard = useDiscardTestDraft(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  if (!drafts?.length) return null;

  async function handleDiscard(d: TestRunDraft) {
    if (await confirmDelete(`Discard "${d.title || "Untitled test run"}"? What's been filled in is lost.`, { confirmLabel: "Discard", danger: true }))
      discard.mutate(d.id);
  }

  return (
    <div className="test-drafts">
      <h5>In progress</h5>
      <ul>
        {drafts.map((d) => (
          <li key={d.id}>
            <span className="test-draft-badge">In progress</span>
            <strong>{d.title || "Untitled test run"}</strong>
            <span className="hint-text">
              {testTypeLabel(d.test_type)}
              {d.summary ? ` · ${d.summary}` : ""} · last saved {relativeTime(d.updated_at)}
              {d.updated_by_username ? ` by ${d.updated_by_username}` : ""}
            </span>
            <RequireRole minimum="editor">
              <Link className="link-as-button" to={`/emitters/${emitterId}/tests/new?draft=${d.id}`}>
                Continue
              </Link>
              <button type="button" className="link-button link-button-danger" onClick={() => void handleDiscard(d)}>
                Discard
              </button>
            </RequireRole>
          </li>
        ))}
      </ul>
      {dialog}
    </div>
  );
}
