import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ObservedValues, TestRecord, TestRecordInput } from "../../api/testRecords";
import { modesApi, type ModeCreateInput } from "../../api/modes";
import type { EwGroup, Source, TestResult } from "../../types/domain";
import { RequireRole } from "../../auth/RequireAuth";
import { ApiRequestError } from "../../api/client";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ModeForm } from "../modes/ModeForm";
import { HoverInfo } from "../common/InfoPopover";
import { ModeResultsPicker, type ModeOption, type ModeResultEntry } from "./ModeResultsPicker";
import { computeOverallResult } from "./modeResultAggregate";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareStrings } from "../common/sortUtils";

const TEST_RESULTS: TestResult[] = ["pass", "fail", "partial", "inconclusive"];

type RecordSortKey = "date" | "sim_created" | "type" | "result" | "title";

function compareRecords(a: TestRecord, b: TestRecord, key: RecordSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "date":
      return compareStrings(a.test_date, b.test_date, dir);
    case "sim_created":
      return compareStrings(a.simulation_created_date, b.simulation_created_date, dir);
    case "type":
      return compareStrings(a.test_type, b.test_type, dir);
    case "result":
      return compareStrings(a.result, b.result, dir);
    case "title":
      return compareStrings(a.title, b.title, dir);
  }
}

function entriesFromPreviousTest(previous: TestRecord, modes: ModeOption[]): Record<string, ModeResultEntry> {
  // Only "exercised" links carry a result to copy forward — "derived" links
  // are Modes the test produced, not ones it tested. Notes/observed values
  // deliberately aren't copied: they describe what happened in that specific
  // run, not a template for the next one.
  const byModeId = new Map(previous.modes.filter((m) => m.link_type === "exercised" && m.result).map((m) => [m.mode_id, m]));
  return Object.fromEntries(
    modes.map((m) => {
      const prior = byModeId.get(m.id);
      return [m.id, { included: true, result: prior?.result ?? "pass", notes: "", observedValues: [{}] } as ModeResultEntry];
    }),
  );
}

function initialModeEntries(modes: ModeOption[]): Record<string, ModeResultEntry> {
  // A test run is assumed to exercise every current Mode, all passing, unless
  // told otherwise — with 70+ Modes on some Emitters, requiring an editor to
  // individually check/fill each one would make logging a test painful.
  // Default to "all included, all pass" and let them flip the few that
  // weren't covered or didn't pass. observedValues starts with one blank set
  // — the picker's "+ Add another observed value" appends more as needed.
  return Object.fromEntries(
    modes.map((m) => [m.id, { included: true, result: "pass" as TestResult, notes: "", observedValues: [{}] }]),
  );
}

function formatObservedValueSet(v: ObservedValues): string | null {
  const parts: string[] = [];
  if (v.rf_min_mhz != null || v.rf_max_mhz != null) parts.push(`RF ${v.rf_min_mhz ?? "?"}–${v.rf_max_mhz ?? "?"} MHz`);
  if (v.pw_min_us != null || v.pw_max_us != null) parts.push(`PW ${v.pw_min_us ?? "?"}–${v.pw_max_us ?? "?"} µs`);
  if (v.pri_type === "fixed" && (v.pri_min_us != null || v.pri_max_us != null)) {
    let pri = `PRI ${v.pri_min_us ?? "?"}–${v.pri_max_us ?? "?"} µs`;
    if (v.jitter_min_us != null || v.jitter_max_us != null) pri += ` (jitter ${v.jitter_min_us ?? "?"}–${v.jitter_max_us ?? "?"})`;
    parts.push(pri);
  } else if (v.pri_type === "stagger" && v.pri_stagger_values_us?.length) {
    parts.push(`PRI [${v.pri_stagger_values_us.join(", ")}] µs`);
  } else if (v.pri_type === "cw" || v.pri_type === "xlet") {
    parts.push(`PRI ${v.pri_type.toUpperCase()}`);
  }
  return parts.length ? parts.join(", ") : null;
}

function formatObservedValues(sets: ObservedValues[] | null): string | null {
  if (!sets || sets.length === 0) return null;
  const formatted = sets.map(formatObservedValueSet).filter((s): s is string => s != null);
  if (formatted.length === 0) return null;
  if (formatted.length === 1) return `Observed: ${formatted[0]}`;
  return `Observed: ${formatted.map((s, i) => `(${i + 1}) ${s}`).join("; ")}`;
}

export function TestHistoryView({
  records,
  onCreate,
  onDelete,
  creating,
  availableModes,
  emitterId,
  ewGroups,
  sources,
  highlightId,
}: {
  records: TestRecord[];
  onCreate: (input: TestRecordInput) => Promise<TestRecord>;
  onDelete: (id: string) => Promise<unknown>;
  creating: boolean;
  /** Modes the "log test" form can link this record to. Omitted where there's no
   * direct Emitter scope to draw a Mode list from (e.g. MDF-scoped tests). */
  availableModes?: ModeOption[];
  /** Emitter scope needed to offer "+ Add Mode from this test" — omitted for
   * MDF-scoped test records, which have no single Emitter to attach a new
   * Mode to. */
  emitterId?: string;
  ewGroups?: EwGroup[];
  sources?: Source[];
  /** A test record id to scroll to and highlight — e.g. reached via the
   * Test-Derived badge on a Mode. */
  highlightId?: string;
}) {
  const [showForm, setShowForm] = useState(false);
  const [manualResult, setManualResult] = useState<TestResult>("pass");
  const [title, setTitle] = useState("");
  const [testDate, setTestDate] = useState("");
  const [simulationCreatedDate, setSimulationCreatedDate] = useState("");
  const [retestsId, setRetestsId] = useState("");
  const [copyFromId, setCopyFromId] = useState("");
  const [notes, setNotes] = useState("");
  const [modeEntries, setModeEntries] = useState<Record<string, ModeResultEntry>>({});
  const [error, setError] = useState<string | null>(null);
  const [addingModeForRecordId, setAddingModeForRecordId] = useState<string | null>(null);
  // New Modes found while filling out this test — staged client-side only,
  // since a Mode can't be linked derived_from_test_record_ids to a Test
  // Record that doesn't exist in the DB yet. Created for real right after
  // the Test Record itself saves (see handleSubmit).
  const [stagingKeys, setStagingKeys] = useState<string[]>([]);
  const [stagedModes, setStagedModes] = useState<{ key: string; ewGroupId: string; input: ModeCreateInput }[]>([]);
  const [stageWarnings, setStageWarnings] = useState<string[]>([]);
  const { confirmDelete, dialog } = useConfirmDialog();
  const highlightedRowRef = useRef<HTMLTableRowElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (highlightId) highlightedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId]);

  const canAddModeFromTest = !!(emitterId && ewGroups && sources);
  const hasModes = !!(availableModes && availableModes.length > 0);
  const {
    sorted: sortedRecords,
    sortKey: recordSortKey,
    sortDir: recordSortDir,
    onSort: onSortRecords,
    onClear: onClearRecordSort,
  } = useSortableTable(records, compareRecords);

  useEffect(() => {
    setModeEntries(initialModeEntries(availableModes ?? []));
  }, [availableModes]);

  const includedResults = Object.values(modeEntries)
    .filter((e) => e.included)
    .map((e) => e.result);
  const derivedResult = hasModes ? computeOverallResult(includedResults) : null;

  // Observed-value sets with something to pre-fill a staged Mode's line from
  // — offered to every staged ModeForm below. A Mode with multiple sets (e.g.
  // measured twice with different results) contributes one option per set.
  const observedValueOptions = (availableModes ?? []).flatMap((m) => {
    const nonEmptySets = (modeEntries[m.id]?.observedValues ?? []).filter((set) => Object.keys(set).length > 0);
    return nonEmptySets.map((values, i) => ({
      modeName: nonEmptySets.length > 1 ? `${m.name} (set ${i + 1})` : m.name,
      values,
    }));
  });

  async function handleDelete(id: string, title: string) {
    if (await confirmDelete(`Delete the test record "${title}"?`)) {
      await onDelete(id);
    }
  }

  function resetForm() {
    setTitle("");
    setTestDate("");
    setSimulationCreatedDate("");
    setRetestsId("");
    setCopyFromId("");
    setNotes("");
    setModeEntries(initialModeEntries(availableModes ?? []));
    setStagingKeys([]);
    setStagedModes([]);
  }

  function handleCopyFromChange(id: string) {
    setCopyFromId(id);
    const previous = records.find((r) => r.id === id);
    if (previous) setModeEntries(entriesFromPreviousTest(previous, availableModes ?? []));
  }

  // One-click shortcut for a failed/partial test: opens the New Test form
  // already wired up as a retest of `r` (both the "retest of" link and the
  // Mode-selection copy — the two things you'd otherwise set by hand via the
  // two dropdowns below).
  function handleRedoTest(r: TestRecord) {
    setShowForm(true);
    setTitle(`Retest: ${r.title}`);
    setRetestsId(r.id);
    setCopyFromId(r.id);
    setModeEntries(entriesFromPreviousTest(r, availableModes ?? []));
  }

  function addStaged(key: string, ewGroupId: string, input: ModeCreateInput) {
    setStagedModes((prev) => [...prev, { key, ewGroupId, input }]);
    setStagingKeys((keys) => keys.filter((k) => k !== key));
  }

  function removeStaged(key: string) {
    setStagedModes((prev) => prev.filter((s) => s.key !== key));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStageWarnings([]);
    const modeResults = Object.entries(modeEntries)
      .filter(([, entry]) => entry.included)
      .map(([mode_id, entry]) => {
        const nonEmptySets = entry.observedValues.filter((set) => Object.keys(set).length > 0);
        return {
          mode_id,
          result: entry.result,
          notes: entry.notes || undefined,
          observed_values: nonEmptySets.length ? nonEmptySets : undefined,
        };
      });
    if (hasModes && modeResults.length === 0) {
      setError("Include at least one Mode, or this can't derive an overall result.");
      return;
    }
    let record: TestRecord;
    try {
      record = await onCreate({
        test_type: "lab_bench",
        title,
        test_date: testDate,
        simulation_created_date: simulationCreatedDate || undefined,
        notes: notes || undefined,
        mode_results: hasModes ? modeResults : undefined,
        result: hasModes ? undefined : manualResult,
        retests_test_record_id: retestsId || undefined,
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to log test");
      return;
    }
    // The Test Record is saved at this point — a staged Mode failing to
    // attach below must not look like the whole submit failed.
    const failedNames: string[] = [];
    for (const staged of stagedModes) {
      try {
        await modesApi.create(staged.ewGroupId, { ...staged.input, derived_from_test_record_ids: [record.id] });
      } catch {
        failedNames.push(staged.input.name);
      }
    }
    if (emitterId) qc.invalidateQueries({ queryKey: ["modes", "emitter", emitterId] });
    if (failedNames.length) setStageWarnings(failedNames);
    resetForm();
    setShowForm(false);
  }

  return (
    <div>
      {stageWarnings.length > 0 && (
        <div className="error-text">
          Test logged. {stageWarnings.length} staged Mode(s) failed to attach: {stageWarnings.join(", ")}. Use "+
          Add Mode from this test" on the row above to retry.
        </div>
      )}
      {records.length === 0 ? (
        <p className="hint-text">No tests logged yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <SortableColumnHeader
                label="Date"
                columnKey="date"
                columnType="date"
                activeKey={recordSortKey}
                activeDir={recordSortDir}
                onSort={onSortRecords}
                onClear={onClearRecordSort}
              />
              <SortableColumnHeader
                label="Sim created"
                columnKey="sim_created"
                columnType="date"
                activeKey={recordSortKey}
                activeDir={recordSortDir}
                onSort={onSortRecords}
                onClear={onClearRecordSort}
              />
              <SortableColumnHeader
                label="Type"
                columnKey="type"
                activeKey={recordSortKey}
                activeDir={recordSortDir}
                onSort={onSortRecords}
                onClear={onClearRecordSort}
              />
              <SortableColumnHeader
                label="Result"
                columnKey="result"
                activeKey={recordSortKey}
                activeDir={recordSortDir}
                onSort={onSortRecords}
                onClear={onClearRecordSort}
              />
              <SortableColumnHeader
                label="Title"
                columnKey="title"
                activeKey={recordSortKey}
                activeDir={recordSortDir}
                onSort={onSortRecords}
                onClear={onClearRecordSort}
              />
              <th>Modes</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedRecords.map((r) => (
              <Fragment key={r.id}>
              <tr
                ref={r.id === highlightId ? highlightedRowRef : undefined}
                className={r.id === highlightId ? "highlighted-row" : undefined}
              >
                <td>{r.test_date}</td>
                <td>{r.simulation_created_date ?? "—"}</td>
                <td>{r.test_type.replace("_", " ")}</td>
                <td>
                  <span className={`test-result-badge test-result-${r.result}`}>{r.result}</span>
                  {r.modes.length > 0 && <span className="jitter-subline">derived from {r.modes.length} Mode(s)</span>}
                </td>
                <td>
                  {r.title}
                  {r.retests_test_record_id &&
                    (() => {
                      const ref = records.find((x) => x.id === r.retests_test_record_id);
                      return ref ? (
                        <span className="jitter-subline">
                          Retest of: {ref.title}{" "}
                          <span className={`test-result-badge test-result-${ref.result}`}>{ref.result}</span>{" "}
                          {"→"}{" "}
                          <span className={`test-result-badge test-result-${r.result}`}>{r.result}</span>
                        </span>
                      ) : null;
                    })()}
                </td>
                <td>
                  {r.modes.length > 0 ? (
                    <ul className="test-record-mode-list">
                      {r.modes.map((m) => {
                        const observed = formatObservedValues(m.observed_values);
                        return (
                          <li key={m.mode_id}>
                            {m.notes || observed ? (
                              <HoverInfo label={m.mode_name}>
                                {m.notes}
                                {m.notes && observed && <br />}
                                {observed}
                              </HoverInfo>
                            ) : (
                              m.mode_name
                            )}
                            {m.result && (
                              <span className={`test-result-badge test-result-${m.result}`}>{m.result}</span>
                            )}
                            {m.link_type === "derived" && (
                              <span className="test-result-badge test-result-derived">derived</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{r.notes ?? "—"}</td>
                <td>
                  <RequireRole minimum="editor">
                    {canAddModeFromTest && (
                      <>
                        <button
                          className="link-button"
                          onClick={() => setAddingModeForRecordId(addingModeForRecordId === r.id ? null : r.id)}
                        >
                          {addingModeForRecordId === r.id ? "Cancel" : "+ Add Mode from this test"}
                        </button>{" "}
                      </>
                    )}
                    {(r.result === "fail" || r.result === "partial") && (
                      <>
                        <button
                          className="link-button"
                          onClick={() => handleRedoTest(r)}
                          title="Open a new test pre-filled as a retest of this one — same Mode selection, linked back to this result."
                        >
                          Redo test
                        </button>{" "}
                      </>
                    )}
                    <button className="link-button" onClick={() => void handleDelete(r.id, r.title)}>
                      Delete
                    </button>
                  </RequireRole>
                </td>
              </tr>
              {addingModeForRecordId === r.id && canAddModeFromTest && (
                <tr>
                  <td colSpan={8}>
                    <p className="hint-text">
                      New Mode, same tools as usual — automatically linked as derived from "{r.title}".
                    </p>
                    <ModeForm
                      emitterId={emitterId as string}
                      ewGroups={ewGroups ?? []}
                      sources={sources ?? []}
                      fixedDerivedFromTestRecordId={r.id}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      <RequireRole minimum="editor">
        {!showForm ? (
          <button className="icon-button" onClick={() => setShowForm(true)}>
            + New Test
          </button>
        ) : (
          <>
          <form className="card test-workbench-form" onSubmit={handleSubmit}>
            <div className="form-row">
              <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              <label className="inline-date-label">
                Test date
                <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} required />
              </label>
              <label className="inline-date-label">
                Simulation created (optional)
                <input
                  type="date"
                  value={simulationCreatedDate}
                  onChange={(e) => setSimulationCreatedDate(e.target.value)}
                  title="When the lab simulation/setup itself was built, as distinct from the test date — optional, for traceability"
                />
              </label>
              {!hasModes && (
                <select value={manualResult} onChange={(e) => setManualResult(e.target.value as TestResult)}>
                  {TEST_RESULTS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-row">
              <label className="inline-date-label">
                This is a retest of… (optional)
                <select value={retestsId} onChange={(e) => setRetestsId(e.target.value)}>
                  <option value="">—</option>
                  {records.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} — {r.test_date}
                    </option>
                  ))}
                </select>
              </label>
              {hasModes && (
                <label className="inline-date-label">
                  Start from a previous test's Mode selection (optional)
                  <select value={copyFromId} onChange={(e) => handleCopyFromChange(e.target.value)}>
                    <option value="">—</option>
                    {records
                      .filter((r) => r.modes.length > 0)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title} — {r.test_date}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>

            <label className="test-notes-field">
              Session notes (optional) — equipment, environment, anything about the run as a whole
              <textarea
                placeholder="e.g. anechoic chamber, ambient 22°C, spectrum analyzer cal'd this morning…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </label>

            {hasModes && (
              <>
                <ModeResultsPicker
                  modes={availableModes ?? []}
                  entries={modeEntries}
                  onChange={(modeId, entry) => setModeEntries((prev) => ({ ...prev, [modeId]: entry }))}
                />
                <p className="hint-text">
                  Derived overall result:{" "}
                  {derivedResult ? (
                    <span className={`test-result-badge test-result-${derivedResult}`}>{derivedResult}</span>
                  ) : (
                    "— include at least one Mode"
                  )}
                </p>
              </>
            )}

            {canAddModeFromTest && stagedModes.length > 0 && (
              <div className="hint-text">
                {stagedModes.map((s) => (
                  <p key={s.key}>
                    Staged: {s.input.name}{" "}
                    <button type="button" className="link-button" onClick={() => removeStaged(s.key)}>
                      Remove
                    </button>
                  </p>
                ))}
              </div>
            )}

            <div className="form-row">
              <button type="submit" disabled={creating}>
                Log Test
              </button>
              <button type="button" className="icon-button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
            {error && <div className="error-text">{error}</div>}
          </form>

          {/* Outside the <form> above deliberately — ModeForm renders its own
              <form>, and nested <form> elements are invalid HTML (the browser
              hoists/mangles them, which made "Stage this Mode" submit the
              outer Test Record form instead). */}
          {canAddModeFromTest && (
            <div className="card staged-modes-section">
              <h5>New Modes found during this test (optional)</h5>
              {stagingKeys.map((k) => (
                <ModeForm
                  key={k}
                  emitterId={emitterId as string}
                  ewGroups={ewGroups ?? []}
                  sources={sources ?? []}
                  onStage={(ewGroupId, input) => addStaged(k, ewGroupId, input)}
                  observedValueOptions={observedValueOptions}
                />
              ))}
              <button
                type="button"
                className="icon-button"
                onClick={() => setStagingKeys((keys) => [...keys, crypto.randomUUID()])}
              >
                + Stage a new Mode
              </button>
            </div>
          )}
          </>
        )}
      </RequireRole>
      {dialog}
    </div>
  );
}
