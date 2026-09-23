import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEmitter } from "../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../state/hooks/useEmitterCheckout";
import { useEwGroups } from "../state/hooks/useEwGroups";
import { useSources } from "../state/hooks/useSources";
import { useFunctionGroups } from "../state/hooks/useFunctionGroups";
import { useDeleteEmitterTestRecord, useEmitterTestRecords } from "../state/hooks/useTestRecords";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { ModeForm } from "../components/modes/ModeForm";
import { formatObservedValueLines, lineOutcomeLabel, testTypeLabel } from "../components/testing/testFormat";

function ParamLines({ lines }: { lines: string[] }) {
  if (lines.length === 0) return <>—</>;
  return (
    <>
      {lines.map((p, i) => (
        <div key={i} className="param-summary">
          {p}
        </div>
      ))}
    </>
  );
}

export function TestRunDetailPage() {
  const { emitterId = "", testRecordId = "" } = useParams<{ emitterId: string; testRecordId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const stagedModeFailures = (location.state as { stagedModeFailures?: string[] } | null)?.stagedModeFailures;
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const { data: records, isLoading } = useEmitterTestRecords(emitterId);
  const { data: ewGroups } = useEwGroups(emitterId);
  const { data: sources } = useSources(emitterId);
  const { data: functionGroups } = useFunctionGroups(emitterId);
  const del = useDeleteEmitterTestRecord(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [addingMode, setAddingMode] = useState(false);

  if (!emitter || isLoading || !records) return <LoadingState label="Loading test run…" />;
  const record = records.find((r) => r.id === testRecordId);
  const backLink = <Link to={`/emitters/${emitterId}?tab=tests`}>← Back to {emitter.name} test history</Link>;
  if (!record) {
    return (
      <div className="page">
        {backLink}
        <p className="hint-text">This test run doesn&rsquo;t exist (it may have been deleted).</p>
      </div>
    );
  }

  const retested = record.retests_test_record_id ? records.find((r) => r.id === record.retests_test_record_id) : null;
  const exercised = record.modes.filter((m) => m.link_type === "exercised");
  const derivedModes = record.modes.filter((m) => m.link_type === "derived");
  const canAddMode = canEdit && (ewGroups?.length ?? 0) > 0 && (sources?.length ?? 0) > 0;

  async function handleDelete() {
    if (!record || !(await confirmDelete(`Delete the test record "${record.title}"?`))) return;
    await del.mutateAsync(record.id);
    navigate(`/emitters/${emitterId}?tab=tests`);
  }

  return (
    <div className="page">
      {backLink}
      <h1>{record.title}</h1>
      <div className="status-row">
        <span className={`test-result-badge test-result-${record.result}`}>{record.result}</span>
        <span>{testTypeLabel(record.test_type)} test</span>
        <span>tested {record.test_date}</span>
        {record.simulation_created_date && (
          <span>
            {record.test_type === "intercept" ? "intercepted" : "simulation created"} {record.simulation_created_date}
          </span>
        )}
        {retested && (
          <span>
            retest of <Link to={`/emitters/${emitterId}/tests/${retested.id}`}>{retested.title}</Link>{" "}
            <span className={`test-result-badge test-result-${retested.result}`}>{retested.result}</span>
          </span>
        )}
      </div>
      {record.notes && <p className="muted">{record.notes}</p>}
      {stagedModeFailures && stagedModeFailures.length > 0 && (
        <div className="error-text">
          Run logged, but {stagedModeFailures.length} staged Mode(s) failed to create: {stagedModeFailures.join(", ")}.
          Use &ldquo;+ Add Mode from this test&rdquo; below to retry.
        </div>
      )}

      <RequireRole minimum="editor">
        <div className="form-row">
          {(record.result === "fail" || record.result === "partial") && (
            <Link className="link-as-button" to={`/emitters/${emitterId}/tests/new?retest=${record.id}`}>
              Redo test
            </Link>
          )}
          {canAddMode && (
            <button type="button" className="button secondary small" onClick={() => setAddingMode((v) => !v)}>
              {addingMode ? "Cancel new Mode" : "+ Add Mode from this test"}
            </button>
          )}
          <button type="button" className="link-button link-button-danger" onClick={() => void handleDelete()}>
            Delete this run
          </button>
        </div>
        {addingMode && canAddMode && (
          <div className="card">
            <p className="hint-text">New Mode, linked as derived from &ldquo;{record.title}&rdquo;.</p>
            <ModeForm
              emitterId={emitterId}
              ewGroups={ewGroups ?? []}
              sources={sources ?? []}
              functionGroups={functionGroups}
              fixedDerivedFromTestRecordId={record.id}
              onClose={() => setAddingMode(false)}
            />
          </div>
        )}
      </RequireRole>

      {record.lines.length > 0 && (
        <div className="card">
          <h4>SIM Test Line results ({record.lines.length})</h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>SIM Test Line</th>
                <th>Outcome</th>
                <th>Intercepted as</th>
                <th>Intercepted parameters</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {record.lines.map((l) => (
                <tr key={l.test_line_id}>
                  <td>{l.test_line_label}</td>
                  <td>
                    <span className={`test-result-badge test-result-${l.outcome}`}>{lineOutcomeLabel(l.outcome)}</span>
                  </td>
                  <td>{l.intercepted_modes.length ? l.intercepted_modes.map((m) => m.mode_name).join(", ") : "—"}</td>
                  <td>
                    <ParamLines lines={formatObservedValueLines(l.observed_values)} />
                  </td>
                  <td>{l.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {exercised.length > 0 && (
        <div className="card">
          <h4>Mode results ({exercised.length})</h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>Mode</th>
                <th>Result</th>
                <th>Intercepted parameters</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {exercised.map((m) => (
                <tr key={m.mode_id}>
                  <td>{m.mode_name}</td>
                  <td>{m.result && <span className={`test-result-badge test-result-${m.result}`}>{m.result}</span>}</td>
                  <td>
                    <ParamLines lines={formatObservedValueLines(m.observed_values)} />
                  </td>
                  <td>{m.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {record.function_groups.length > 0 && (
        <div className="card">
          <h4>Function Group ratings</h4>
          <div className="test-record-function-group-badges">
            {record.function_groups.map((fg) => (
              <span
                key={fg.function_group_id}
                className={`status-badge test-result-${fg.override_result ?? fg.computed_result}`}
                title={
                  fg.override_result
                    ? `Computed: ${fg.computed_result} — overridden to ${fg.override_result}`
                    : `Computed: ${fg.computed_result}`
                }
              >
                {fg.function_group_name}: {fg.override_result ?? fg.computed_result}
              </span>
            ))}
          </div>
        </div>
      )}

      {derivedModes.length > 0 && (
        <div className="card">
          <h4>Modes derived from this run</h4>
          <p>{derivedModes.map((m) => m.mode_name).join(", ")}</p>
        </div>
      )}

      {record.lines.length === 0 && exercised.length === 0 && (
        <p className="hint-text">No per-line or per-Mode results were logged — only the overall result above.</p>
      )}
      {dialog}
    </div>
  );
}
