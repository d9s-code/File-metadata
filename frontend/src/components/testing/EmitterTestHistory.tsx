import { Link, useNavigate } from "react-router-dom";
import { useDeleteEmitterTestRecord, useEmitterTestRecords } from "../../state/hooks/useTestRecords";
import { useEmitterTestLines } from "../../state/hooks/useTestLines";
import { RequireRole } from "../../auth/RequireAuth";
import { SimTestLinesPanel } from "./SimTestLinesPanel";
import { TestRecordsTable } from "./TestRecordsTable";

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
      <div className="card">
        <div className="section-header-row">
          <h5>Test runs</h5>
          <RequireRole minimum="editor">
            <Link className="link-as-button accent-button" to={`/emitters/${emitterId}/tests/new`}>
              + New Test Run
            </Link>
          </RequireRole>
        </div>
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
