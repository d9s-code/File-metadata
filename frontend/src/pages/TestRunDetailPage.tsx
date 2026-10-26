import { useState, type ReactNode } from "react";
import { EmitterNotesDrawer } from "../components/common/EntityNotesDrawer";
import { formatDate } from "../components/common/dates";
import { ObservedValuesTable } from "../components/testing/ObservedValuesTable";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useEmitter } from "../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../state/hooks/useEmitterCheckout";
import { useEwGroups } from "../state/hooks/useEwGroups";
import { useSources } from "../state/hooks/useSources";
import { useChangeTestResult, useDeleteEmitterTestRecord, useEmitterTestRecords } from "../state/hooks/useTestRecords";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { MenuButton } from "../components/common/MenuButton";
import { PageHeader } from "../components/common/PageHeader";
import { ModeForm } from "../components/modes/ModeForm";
import { useEmitterVersions } from "../state/hooks/useEmitterVersions";
import { useEmitterModes } from "../state/hooks/useModes";
import { InterceptSignalsList } from "../components/testing/InterceptSignals";
import { RecheckIntercepts } from "../components/testing/RecheckIntercepts";
import { ElementsFromTestModal } from "../components/testing/ElementsFromTestModal";
import { DerivedModesTable } from "../components/testing/DerivedModesTable";
import type { ObservedValues, TestRecord } from "../api/testRecords";
import type { TestResult } from "../types/domain";
import {
  compareLineLabels,
  nonEmptySets,
  lineOutcomeLabel,
  TEST_RESULTS,
  testResultLabel,
  observedValueOptions,
  testTypeLabel,
} from "../components/testing/testFormat";


function countOf<T>(items: T[], key: (item: T) => TestResult | null): [TestResult, number][] {
  return TEST_RESULTS.map((r) => [r, items.filter((i) => key(i) === r).length] as [TestResult, number]).filter(([, n]) => n > 0);
}

/** One labelled detail of the run, in the row under its title. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="run-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** One line under the title: how the run came out, counted. */
function RunSummary({ record, exercised }: { record: TestRecord; exercised: TestRecord["modes"] }) {
  const lineCounts = countOf(record.lines, (l) => l.outcome);
  const modeCounts = countOf(exercised, (m) => m.result);
  return (
    <p className="run-summary">
      {lineCounts.length > 0 && (
        <span>
          <strong>{record.lines.length}</strong> SIM Test Line{record.lines.length === 1 ? "" : "s"}:{" "}
          {lineCounts.map(([r, n]) => (
            <span key={r} className={`test-result-badge test-result-${r}`}>
              {n} {lineOutcomeLabel(r)}
            </span>
          ))}
        </span>
      )}
      {modeCounts.length > 0 && (
        <span>
          <strong>{exercised.length}</strong> Mode{exercised.length === 1 ? "" : "s"}:{" "}
          {modeCounts.map(([r, n]) => (
            <span key={r} className={`test-result-badge test-result-${r}`}>
              {n} {testResultLabel(r)}
            </span>
          ))}
        </span>
      )}
    </p>
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
  const { data: modes } = useEmitterModes(emitterId);
  const del = useDeleteEmitterTestRecord(emitterId);
  const { data: versions } = useEmitterVersions(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [addingMode, setAddingMode] = useState(false);
  const [changingResult, setChangingResult] = useState(false);
  // Elements (and sequences) from the run: all its values, or one logged intercept's.
  const [makingElements, setMakingElements] = useState<{ only?: ObservedValues } | null>(null);
  const [doneNote, setDoneNote] = useState<string | null>(null);
  // Which panel: the run's results, or its logged intercepts against the Modes now — kept in the URL.
  const [params, setParams] = useSearchParams();

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
  const hasValues = [...record.lines, ...record.modes, ...(record.signals ?? [])].some((o) => nonEmptySets(o.observed_values).length > 0);
  const versionNumber =
    record.emitter_version_number ?? versions?.find((v) => v.id === record.emitter_version_id)?.version_number ?? null;
  const loggedSets = [...record.lines, ...exercised, ...(record.signals ?? [])].reduce((n, o) => n + nonEmptySets(o.observed_values).length, 0);
  const view = params.get("view") === "recheck" && loggedSets > 0 ? "recheck" : "results";
  const showView = (v: "results" | "recheck") =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (v === "results") next.delete("view");
        else next.set("view", v);
        return next;
      },
      { replace: true },
    );

  async function handleDelete() {
    if (!record || !(await confirmDelete(`Delete the test record "${record.title}"?`))) return;
    await del.mutateAsync(record.id);
    navigate(`/emitters/${emitterId}?tab=tests`);
  }

  return (
    <div className="page">
      <EmitterNotesDrawer emitterId={emitterId} name={emitter.name} />
      {backLink}
      <PageHeader title={record.title}>
        <RequireRole minimum="editor">
          {(record.result === "fail" || record.result === "partial") && (
            <Link className="button primary" to={`/emitters/${emitterId}/tests/new?retest=${record.id}`}>
              Redo test
            </Link>
          )}
          {canEdit && (
            <MenuButton
              label="+ From this test ▾"
              items={[
                {
                  label: addingMode ? "Cancel the new Mode" : "New Mode…",
                  disabled: !canAddMode,
                  title: canAddMode ? undefined : "Needs an EW Group and a Source first",
                  onSelect: () => setAddingMode((v) => !v),
                },
                {
                  label: "Elements to a Source…",
                  disabled: !hasValues,
                  title: hasValues ? "Its logged RF, PRI and PW as Elements, on a Source or a new one" : "No values were logged in this run",
                  onSelect: () => setMakingElements({}),
                },
              ]}
            />
          )}
          <MenuButton
            label="More ▾"
            items={[
              { label: "Change the result…", onSelect: () => setChangingResult(true) },
              { label: "Delete this run…", danger: true, onSelect: () => void handleDelete() },
            ]}
          />
        </RequireRole>
      </PageHeader>
      <dl className="run-facts">
        <Fact label="Result">
          <span className={`test-result-badge test-result-${record.result}`}>{testResultLabel(record.result)}</span>
          {record.computed_result && (
            <span className="run-fact-sub" title={record.result_note ?? undefined}>
              Set by hand · worked out: {testResultLabel(record.computed_result)}
            </span>
          )}
        </Fact>
        <Fact label="Type">{testTypeLabel(record.test_type)}</Fact>
        <Fact label="Version tested">
          {versionNumber != null ? (
            <Link to={`/emitters/${emitterId}/versions?version=${versionNumber}`}>v{versionNumber}</Link>
          ) : (
            <span className="hint-text" title="Logged before the Emitter had a saved version">
              None saved
            </span>
          )}
        </Fact>
        <Fact label="Tested">
          {formatDate(record.test_date)}
          {record.test_time ? ` ${record.test_time.slice(0, 5)}` : ""}
        </Fact>
        {record.dwell_strategy_id ? (
          <Fact label="Dwell">
            <Link to={`/dwells/strategies/${record.dwell_strategy_id}`}>{record.dwell_strategy_name}</Link> v
            {record.dwell_strategy_version_number}
          </Fact>
        ) : (
          record.dwell && <Fact label="Dwell">{record.dwell}</Fact>
        )}
        {record.received_power_dbfs != null && <Fact label="Received power">{record.received_power_dbfs} dBFS</Fact>}
        {record.simulation_created_date && (
          <Fact label={record.test_type === "intercept" ? "Intercepted" : "Simulation created"}>
            {formatDate(record.simulation_created_date)}
          </Fact>
        )}
        {retested && (
          <Fact label="Retest of">
            <Link to={`/emitters/${emitterId}/tests/${retested.id}`}>{retested.title}</Link>{" "}
            <span className={`test-result-badge test-result-${retested.result}`}>{testResultLabel(retested.result)}</span>
          </Fact>
        )}
        {record.platform_test_id && record.platform_test_platform_id && (
          <Fact label="Part of the Platform test">
            <Link to={`/platforms/${record.platform_test_platform_id}/tests/${record.platform_test_id}`}>
              {record.platform_test_title}
            </Link>
          </Fact>
        )}
      </dl>
      {record.computed_result && record.result_note && (
        <p className="result-note">
          <strong>Why the result was changed:</strong> {record.result_note}
        </p>
      )}
      {doneNote && (
        <p className="success-text" role="status">
          {doneNote}{" "}
          <Link to={`/emitters/${emitterId}?tab=setup`}>See the Sources</Link>
        </p>
      )}
      {makingElements && (
        <ElementsFromTestModal
          emitterId={emitterId}
          record={record}
          sources={(sources ?? []).map((s) => ({ id: s.id, name: s.name }))}
          only={makingElements.only}
          onClose={() => setMakingElements(null)}
          onDone={(message) => {
            setMakingElements(null);
            setDoneNote(message);
          }}
        />
      )}
      {changingResult && <ResultOverride emitterId={emitterId} record={record} onClose={() => setChangingResult(false)} />}
      <RunSummary record={record} exercised={exercised} />
      {record.notes && (
        <div className="run-notes">
          <h4>Session notes</h4>
          <p className="pre-wrap">{record.notes}</p>
        </div>
      )}
      {stagedModeFailures && stagedModeFailures.length > 0 && (
        <div className="error-text">
          Run logged, but {stagedModeFailures.length} staged Mode(s) failed to create: {stagedModeFailures.join(", ")}.
          Use + From this test → New Mode… to retry.
        </div>
      )}

      <RequireRole minimum="editor">
        {addingMode && canAddMode && (
          <div className="card">
            <p className="hint-text">New Mode, linked as derived from &ldquo;{record.title}&rdquo;.</p>
            <ModeForm
              emitterId={emitterId}
              ewGroups={ewGroups ?? []}
              sources={sources ?? []}
              fixedDerivedFromTestRecordId={record.id}
              observedValueOptions={observedValueOptions([
                ...record.lines.map((l) => ({ id: l.test_line_id, name: l.test_line_label, sets: l.observed_values })),
                ...record.modes.map((m) => ({ id: m.mode_id, name: m.mode_name, sets: m.observed_values })),
                ...(record.signals ?? []).map((sig, i) => ({ id: `signal-${i}`, name: `Signal ${i + 1}`, sets: sig.observed_values })),
              ])}
              onClose={() => setAddingMode(false)}
            />
          </div>
        )}
      </RequireRole>

      {loggedSets > 0 && (
        <div className="tab-bar" role="tablist" aria-label="Test run">
          <button type="button" role="tab" aria-selected={view === "results"} className={view === "results" ? "tab active" : "tab"} onClick={() => showView("results")}>
            Results
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "recheck"}
            className={view === "recheck" ? "tab active" : "tab"}
            onClick={() => showView("recheck")}
            title="Every set of parameters logged in this run, matched against the Emitter's Modes as they are now"
          >
            Against the Modes now <span className="tab-count">{loggedSets}</span>
          </button>
        </div>
      )}

      {view === "recheck" ? (
        <RecheckIntercepts
          emitterId={emitterId}
          record={record}
          modes={modes ?? []}
          versionTested={versionNumber}
          onMakeElements={(set) => setMakingElements({ only: set })}
        />
      ) : (
        <>
      {record.signals?.length > 0 && (
        <div className="card">
          <h4>Signals not tied to a Mode ({record.signals.length})</h4>
          <InterceptSignalsList
            signals={record.signals}
            modes={modes ?? []}
            emitterId={emitterId}
            sources={sources ?? []}
            runTitle={record.title}
            runDate={record.simulation_created_date ?? record.test_date}
            canEdit={canEdit}
          />
        </div>
      )}

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
              {[...record.lines].sort((a, b) => compareLineLabels(a.test_line_label, b.test_line_label)).map((l) => (
                <tr key={l.test_line_id}>
                  <td>{l.test_line_label}</td>
                  <td>
                    <span className={`test-result-badge test-result-${l.outcome}`}>{lineOutcomeLabel(l.outcome)}</span>
                  </td>
                  <td>
                    {l.intercepted_as_unknown || l.intercepted_modes.length
                      ? [...(l.intercepted_as_unknown ? ["Default Unknown"] : []), ...l.intercepted_modes.map((m) => (m.mode_exists ? m.mode_name : `${m.mode_name} (deleted)`))].join(", ")
                      : "—"}
                  </td>
                  <td>
                    <ObservedValuesTable sets={l.observed_values} />
                  </td>
                  <td className="pre-wrap">{l.notes ?? "—"}</td>
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
                  <td>
                    {m.mode_name}
                    {!m.mode_exists && (
                      <span className="hint-text" title="No longer in the Emitter — the result is kept">
                        {" "}
                        (deleted)
                      </span>
                    )}
                  </td>
                  <td>{m.result && <span className={`test-result-badge test-result-${m.result}`}>{testResultLabel(m.result)}</span>}</td>
                  <td>
                    <ObservedValuesTable sets={m.observed_values} />
                  </td>
                  <td className="pre-wrap">{m.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {derivedModes.length > 0 && (
        <div className="card">
          <h4>
            Modes derived from this run <span className="hint-text">{derivedModes.length}</span>
          </h4>
          <DerivedModesTable emitterId={emitterId} derived={derivedModes} modes={modes ?? []} ewGroups={ewGroups ?? []} />
        </div>
      )}

      {record.lines.length === 0 && exercised.length === 0 && (
        <p className="hint-text">No per-line or per-Mode results were logged — only the overall result above.</p>
      )}
        </>
      )}
      {dialog}
    </div>
  );
}

/** Change a logged run's overall result by hand (with why), or put back the
 * one it worked out to — opened from the page's More menu. */
function ResultOverride({ emitterId, record, onClose }: { emitterId: string; record: TestRecord; onClose: () => void }) {
  const change = useChangeTestResult(emitterId);
  const worked = record.computed_result ?? record.result;
  const [result, setResult] = useState<TestResult>(record.result);
  const [note, setNote] = useState("");
  const needsNote = result !== worked;
  return (
    <div className="result-override-form">
      <label className="inline-date-label">
        Result
        <select autoFocus value={result} onChange={(e) => setResult(e.target.value as TestResult)}>
          {TEST_RESULTS.map((r) => (
            <option key={r} value={r}>
              {testResultLabel(r)}
              {r === worked ? " (worked out)" : ""}
            </option>
          ))}
        </select>
      </label>
      {needsNote && (
        <input
          className="result-override-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={`Why it's ${testResultLabel(result)}, not ${testResultLabel(worked)} (required)`}
          aria-label="Why the result is changed"
        />
      )}
      <button
        type="button"
        disabled={change.isPending || (needsNote && !note.trim()) || result === record.result}
        onClick={() =>
          change.mutate({ id: record.id, result, note: needsNote ? note.trim() : undefined }, { onSuccess: onClose })
        }
      >
        Save
      </button>
      <button type="button" className="link-button" onClick={onClose}>
        Cancel
      </button>
      {change.isError && <span className="error-text">{(change.error as Error).message}</span>}
    </div>
  );
}
