import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ObservedValues,
  TestRecord,
  TestRecordInput,
  TestRecordLineResult,
  TestRecordModeLink,
} from "../../api/testRecords";
import { modesApi, type ModeCreateInput } from "../../api/modes";
import type { EwGroup, FunctionGroup, Source, TestResult, TestType } from "../../types/domain";
import { RequireRole } from "../../auth/RequireAuth";
import { ApiRequestError } from "../../api/client";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ModeForm } from "../modes/ModeForm";
import { HoverInfo } from "../common/InfoPopover";
import { ModeResultsPicker, type ModeOption, type ModeResultEntry } from "./ModeResultsPicker";
import { LineResultsPicker, type LineResultEntry, type TestLineOption } from "./LineResultsPicker";
import { computeOverallResult } from "./modeResultAggregate";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareStrings } from "../common/sortUtils";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";

const TEST_RESULTS: TestResult[] = ["pass", "fail", "partial", "inconclusive"];
const TEST_TYPES: TestType[] = ["simulation", "lab_bench", "live_range", "field_exercise", "intercept"];

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

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

function initialLineEntries(lines: TestLineOption[]): Record<string, LineResultEntry> {
  // Mirrors initialModeEntries: a run is assumed to intercept every current
  // Test Line correctly unless told otherwise.
  return Object.fromEntries(
    lines.map((l) => [l.id, { included: true, outcome: "pass" as TestResult, detectedAsModeId: "", notes: "" }]),
  );
}

function lineEntriesFromPreviousTest(previous: TestRecord, lines: TestLineOption[]): Record<string, LineResultEntry> {
  const byLineId = new Map(previous.lines.map((l) => [l.test_line_id, l]));
  return Object.fromEntries(
    lines.map((l) => {
      const prior = byLineId.get(l.id);
      return [
        l.id,
        {
          included: true,
          outcome: prior?.outcome ?? "pass",
          detectedAsModeId: prior?.detected_as_mode_id ?? "",
          notes: "",
        } as LineResultEntry,
      ];
    }),
  );
}

/** Rolled-up counts for a record's Test Line list — mirrors summarizeModeLinks. */
function summarizeLineLinks(lines: TestRecordLineResult[]) {
  const counts: Partial<Record<TestResult, number>> = {};
  for (const l of lines) counts[l.outcome] = (counts[l.outcome] ?? 0) + 1;
  return counts;
}

function outcomeShortLabel(o: TestResult): string {
  switch (o) {
    case "pass":
      return "correct";
    case "partial":
      return "misclassified";
    case "fail":
      return "missed";
    case "inconclusive":
      return "inconclusive";
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

function initialModeEntries(modes: ModeOption[], defaultIncluded: boolean): Record<string, ModeResultEntry> {
  // A test run is assumed to exercise every current Mode, all passing, unless
  // told otherwise — with 70+ Modes on some Emitters, requiring an editor to
  // individually check/fill each one would make logging a test painful.
  // Default to "all included, all pass" and let them flip the few that
  // weren't covered or didn't pass. observedValues starts with one blank set
  // — the picker's "+ Add another observed value" appends more as needed.
  // defaultIncluded is false whenever this Emitter has Test Lines: per-Mode
  // logging is then a secondary, opt-in section (see the collapsed
  // mode-legacy-section below), and submitting an "all Modes pass" result
  // nobody actually reviewed just because the section exists would be wrong.
  return Object.fromEntries(
    modes.map((m) => [
      m.id,
      { included: defaultIncluded, result: "pass" as TestResult, notes: "", observedValues: [{}] },
    ]),
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

const RESULT_ORDER: TestResult[] = ["pass", "fail", "partial", "inconclusive"];

/** Rolled-up counts for a record's Mode list, so the table can show "68
 * pass, 2 fail" instead of a 70-line list by default — with 70+ Modes on
 * some Emitters, most tests exercise nearly all of them, which used to make
 * every row balloon to match the tallest one. */
function summarizeModeLinks(modes: TestRecordModeLink[]) {
  const counts: Partial<Record<TestResult, number>> = {};
  let derived = 0;
  for (const m of modes) {
    if (m.link_type === "derived") {
      derived += 1;
      continue;
    }
    if (m.result) counts[m.result] = (counts[m.result] ?? 0) + 1;
  }
  return { counts, derived };
}

export function TestHistoryView({
  records,
  onCreate,
  onDelete,
  creating,
  availableModes,
  availableLines,
  emitterId,
  ewGroups,
  sources,
  functionGroups,
  highlightId,
}: {
  records: TestRecord[];
  onCreate: (input: TestRecordInput) => Promise<TestRecord>;
  onDelete: (id: string) => Promise<unknown>;
  creating: boolean;
  /** Modes the "log test" form can link this record to. Omitted where there's no
   * direct Emitter scope to draw a Mode list from (e.g. MDF-scoped tests). */
  availableModes?: ModeOption[];
  /** Test Lines (simulated-signal reference rows) the "log test" form can be
   * checked against — omitted for MDF-scoped tests, which have no Test Lines.
   * When present and non-empty, this is the primary, simulation-centric way
   * to log a test; per-Mode results become an optional secondary section. */
  availableLines?: TestLineOption[];
  /** Emitter scope needed to offer "+ Add Mode from this test" — omitted for
   * MDF-scoped test records, which have no single Emitter to attach a new
   * Mode to. */
  emitterId?: string;
  ewGroups?: EwGroup[];
  sources?: Source[];
  functionGroups?: FunctionGroup[];
  /** A test record id to scroll to and highlight — e.g. reached via the
   * Test-Derived badge on a Mode. */
  highlightId?: string;
}) {
  const [showForm, setShowForm] = useState(false);
  const [manualResult, setManualResult] = useState<TestResult>("pass");
  const [testType, setTestType] = useState<TestType>("lab_bench");
  const [title, setTitle] = useState("");
  const [testDate, setTestDate] = useState(todayDate());
  const [simulationCreatedDate, setSimulationCreatedDate] = useState("");
  const [retestsId, setRetestsId] = useState("");
  const [copyFromId, setCopyFromId] = useState("");
  const [notes, setNotes] = useState("");
  const [modeEntries, setModeEntries] = useState<Record<string, ModeResultEntry>>({});
  const [lineEntries, setLineEntries] = useState<Record<string, LineResultEntry>>({});
  const [functionGroupOverrides, setFunctionGroupOverrides] = useState<Record<string, TestResult | "">>({});
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
  // Per-record Mode-list expansion — collapsed by default (see
  // summarizeModeLinks); ids present here show the full per-Mode breakdown.
  const [expandedModeRows, setExpandedModeRows] = useState<Set<string>>(new Set());
  function toggleModeRow(id: string) {
    setExpandedModeRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  useEffect(() => {
    if (highlightId) highlightedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId]);

  // Both "+ Add Mode from this test" and "+ Stage a new Mode" end up
  // POSTing a new Mode, which (like any Mode create) requires holding the
  // Emitter's checkout — gate on canEdit too, not just "is there anywhere
  // to put it", so this doesn't offer a form that 409s on submit.
  const { data: emitterForCheckout } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitterForCheckout);
  const canAddModeFromTest = !!(emitterId && ewGroups && sources && canEdit);
  const hasModes = !!(availableModes && availableModes.length > 0);
  const hasLines = !!(availableLines && availableLines.length > 0);
  const {
    sorted: sortedRecords,
    sortKey: recordSortKey,
    sortDir: recordSortDir,
    onSort: onSortRecords,
    onClear: onClearRecordSort,
  } = useSortableTable(records, compareRecords);

  useEffect(() => {
    setModeEntries(initialModeEntries(availableModes ?? [], !hasLines));
  }, [availableModes, hasLines]);

  useEffect(() => {
    setLineEntries(initialLineEntries(availableLines ?? []));
  }, [availableLines]);

  const includedResults = Object.values(modeEntries)
    .filter((e) => e.included)
    .map((e) => e.result);
  const derivedModeResult = hasModes ? computeOverallResult(includedResults) : null;

  const includedLineOutcomes = Object.values(lineEntries)
    .filter((e) => e.included)
    .map((e) => e.outcome);
  const derivedLineResult = hasLines ? computeOverallResult(includedLineOutcomes) : null;

  // Backend precedence: an Emitter's overall result comes from Test-Line
  // outcomes whenever any are logged, falling back to per-Mode results —
  // mirror that here so the "derived overall result" hint never disagrees
  // with what actually gets saved.
  const derivedResult = derivedLineResult ?? derivedModeResult;

  // Live-computed worst-of-N per represented Function Group, from the exact
  // same in-progress modeEntries the overall result derives from — the
  // number the "override" dropdown below is judged against.
  const functionGroupComputed: Record<string, TestResult> = {};
  if (functionGroups && functionGroups.length > 0) {
    const resultsByGroup = new Map<string, TestResult[]>();
    for (const m of availableModes ?? []) {
      if (!m.function_group_id) continue;
      const entry = modeEntries[m.id];
      if (!entry?.included) continue;
      const list = resultsByGroup.get(m.function_group_id) ?? [];
      list.push(entry.result);
      resultsByGroup.set(m.function_group_id, list);
    }
    for (const [groupId, results] of resultsByGroup) {
      const computed = computeOverallResult(results);
      if (computed) functionGroupComputed[groupId] = computed;
    }
  }
  const representedFunctionGroups = (functionGroups ?? []).filter((g) => functionGroupComputed[g.id] != null);

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
    setTestType("lab_bench");
    setTestDate(todayDate());
    setSimulationCreatedDate("");
    setRetestsId("");
    setCopyFromId("");
    setNotes("");
    setModeEntries(initialModeEntries(availableModes ?? [], !hasLines));
    setLineEntries(initialLineEntries(availableLines ?? []));
    setFunctionGroupOverrides({});
    setStagingKeys([]);
    setStagedModes([]);
  }

  function handleCopyFromChange(id: string) {
    setCopyFromId(id);
    const previous = records.find((r) => r.id === id);
    if (previous) {
      setModeEntries(entriesFromPreviousTest(previous, availableModes ?? []));
      setLineEntries(lineEntriesFromPreviousTest(previous, availableLines ?? []));
    }
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
    setLineEntries(lineEntriesFromPreviousTest(r, availableLines ?? []));
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
    const lineResults = Object.entries(lineEntries)
      .filter(([, entry]) => entry.included)
      .map(([test_line_id, entry]) => ({
        test_line_id,
        outcome: entry.outcome,
        detected_as_mode_id: entry.outcome === "partial" && entry.detectedAsModeId ? entry.detectedAsModeId : undefined,
        notes: entry.notes || undefined,
      }));
    // A Test-Line or Mode result set is required to derive an overall result
    // UNLESS there's a manual result to fall back on — which the form always
    // offers once nothing is included (see the manual-result selector below),
    // whether that's because this Emitter has no Lines/Modes yet, or because
    // this test is purely about a newly staged Mode with nothing existing
    // being (re)tested right now.
    const nothingToSubmit =
      (!hasLines || lineResults.length === 0) && (!hasModes || (modeResults.length === 0 && stagedModes.length === 0));
    if ((hasLines || hasModes) && nothingToSubmit) {
      setError("Include at least one Test Line or Mode, stage a new Mode, or pick a manual result below.");
      return;
    }
    const overrides = Object.fromEntries(
      Object.entries(functionGroupOverrides).filter(([, v]) => v !== ""),
    ) as Record<string, TestResult>;
    const hasDerivableResult = lineResults.length > 0 || modeResults.length > 0;
    let record: TestRecord;
    try {
      record = await onCreate({
        test_type: testType,
        title,
        test_date: testDate,
        simulation_created_date: simulationCreatedDate || undefined,
        notes: notes || undefined,
        line_results: lineResults.length > 0 ? lineResults : undefined,
        mode_results: modeResults.length > 0 ? modeResults : undefined,
        result: hasDerivableResult ? undefined : manualResult,
        retests_test_record_id: retestsId || undefined,
        function_group_overrides: Object.keys(overrides).length ? overrides : undefined,
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
        <>
        <div className="form-row test-history-toolbar">
          <button
            type="button"
            className="link-button"
            onClick={() => setExpandedModeRows(new Set(sortedRecords.map((r) => r.id)))}
          >
            Expand all
          </button>
          <button type="button" className="link-button" onClick={() => setExpandedModeRows(new Set())}>
            Collapse all
          </button>
        </div>
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
              <th>Test Lines</th>
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
                  {r.lines.length > 0 ? (
                    (() => {
                      const isExpanded = r.lines.length <= 3 || expandedModeRows.has(r.id);
                      const summary = summarizeLineLinks(r.lines);
                      return (
                        <>
                          {r.lines.length > 3 && (
                            <button
                              type="button"
                              className="link-button mode-summary-toggle"
                              onClick={() => toggleModeRow(r.id)}
                            >
                              {isExpanded ? "▾" : "▸"} {r.lines.length} Line{r.lines.length === 1 ? "" : "s"}
                            </button>
                          )}
                          <span className="test-record-mode-summary">
                            {RESULT_ORDER.filter((res) => summary[res]).map((res) => (
                              <span key={res} className={`test-result-badge test-result-${res}`}>
                                {summary[res]}
                              </span>
                            ))}
                          </span>
                          {isExpanded && (
                            <ul className="test-record-mode-list">
                              {r.lines.map((l) => (
                                <li key={l.test_line_id}>
                                  {l.notes ? (
                                    <HoverInfo label={l.test_line_label}>{l.notes}</HoverInfo>
                                  ) : (
                                    l.test_line_label
                                  )}
                                  <span className={`test-result-badge test-result-${l.outcome}`}>
                                    {outcomeShortLabel(l.outcome)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      );
                    })()
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {r.modes.length > 0 ? (
                    (() => {
                      // Nothing to compact below a handful of Modes — skip
                      // straight to the full list rather than adding a
                      // pointless extra click.
                      const isExpanded = r.modes.length <= 3 || expandedModeRows.has(r.id);
                      const summary = summarizeModeLinks(r.modes);
                      return (
                        <>
                          {r.modes.length > 3 && (
                            <button
                              type="button"
                              className="link-button mode-summary-toggle"
                              onClick={() => toggleModeRow(r.id)}
                            >
                              {isExpanded ? "▾" : "▸"} {r.modes.length} Mode{r.modes.length === 1 ? "" : "s"}
                            </button>
                          )}
                          <span className="test-record-mode-summary">
                            {RESULT_ORDER.filter((res) => summary.counts[res]).map((res) => (
                              <span key={res} className={`test-result-badge test-result-${res}`}>
                                {summary.counts[res]} {res}
                              </span>
                            ))}
                            {summary.derived > 0 && (
                              <span className="test-result-badge test-result-derived">{summary.derived} derived</span>
                            )}
                          </span>
                          {isExpanded && (
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
                          )}
                        </>
                      );
                    })()
                  ) : (
                    "—"
                  )}
                  {r.function_groups.length > 0 && (
                    <div className="test-record-function-group-badges">
                      {r.function_groups.map((fg) => (
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
                    <button className="link-button link-button-danger" onClick={() => void handleDelete(r.id, r.title)}>
                      Delete
                    </button>
                  </RequireRole>
                </td>
              </tr>
              {addingModeForRecordId === r.id && canAddModeFromTest && (
                <tr>
                  <td colSpan={9}>
                    <p className="hint-text">
                      New Mode, same tools as usual — automatically linked as derived from "{r.title}".
                    </p>
                    <ModeForm
                      emitterId={emitterId as string}
                      ewGroups={ewGroups ?? []}
                      sources={sources ?? []}
                      functionGroups={functionGroups}
                      fixedDerivedFromTestRecordId={r.id}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
        </>
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
                Type
                <select value={testType} onChange={(e) => setTestType(e.target.value as TestType)}>
                  {TEST_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-date-label">
                Test date
                <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} required />
              </label>
              <label className="inline-date-label">
                {testType === "intercept" ? "Intercept date (optional)" : "Simulation created (optional)"}
                <input
                  type="date"
                  value={simulationCreatedDate}
                  onChange={(e) => setSimulationCreatedDate(e.target.value)}
                  title={
                    testType === "intercept"
                      ? "When the intercept itself occurred, as distinct from the test date — optional, for traceability"
                      : "When the lab simulation/setup itself was built, as distinct from the test date — optional, for traceability"
                  }
                />
              </label>
              {(!hasLines || includedLineOutcomes.length === 0) && (!hasModes || includedResults.length === 0) && (
                <select
                  value={manualResult}
                  onChange={(e) => setManualResult(e.target.value as TestResult)}
                  title={
                    hasLines || hasModes
                      ? "Nothing is included above — used as this test's overall result instead"
                      : undefined
                  }
                >
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
              {(hasLines || hasModes) && (
                <label className="inline-date-label">
                  Start from a previous test's selection (optional)
                  <select value={copyFromId} onChange={(e) => handleCopyFromChange(e.target.value)}>
                    <option value="">—</option>
                    {records
                      .filter((r) => r.lines.length > 0 || r.modes.length > 0)
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

            {hasLines && (
              <>
                <p className="param-row-label">Simulated Signal Results</p>
                <LineResultsPicker
                  lines={availableLines ?? []}
                  entries={lineEntries}
                  onChange={(lineId, entry) => setLineEntries((prev) => ({ ...prev, [lineId]: entry }))}
                  modes={availableModes}
                />
                <p className="hint-text">
                  Derived overall result:{" "}
                  {derivedResult ? (
                    <span className={`test-result-badge test-result-${derivedResult}`}>{derivedResult}</span>
                  ) : (
                    "— include at least one Test Line, or use the manual result above"
                  )}
                </p>
              </>
            )}

            {hasModes && (
              <details className="mode-legacy-section" open={!hasLines}>
                <summary>Per-Mode results {hasLines ? "(optional)" : ""}</summary>
                <ModeResultsPicker
                  modes={availableModes ?? []}
                  entries={modeEntries}
                  onChange={(modeId, entry) => setModeEntries((prev) => ({ ...prev, [modeId]: entry }))}
                  functionGroups={functionGroups}
                />
                {!hasLines && (
                  <p className="hint-text">
                    Derived overall result:{" "}
                    {derivedResult ? (
                      <span className={`test-result-badge test-result-${derivedResult}`}>{derivedResult}</span>
                    ) : (
                      "— include at least one Mode, or use the manual result above"
                    )}
                  </p>
                )}
              </details>
            )}

            {representedFunctionGroups.length > 0 && (
              <div className="function-group-ratings">
                <span className="param-row-label">Function Group ratings</span>
                {representedFunctionGroups.map((g) => (
                  <div key={g.id} className="function-group-rating-row">
                    <span>{g.name}</span>
                    <span className={`test-result-badge test-result-${functionGroupComputed[g.id]}`}>
                      {functionGroupComputed[g.id]}
                    </span>
                    <label className="inline-date-label">
                      Override
                      <select
                        value={functionGroupOverrides[g.id] ?? ""}
                        onChange={(e) =>
                          setFunctionGroupOverrides((prev) => ({
                            ...prev,
                            [g.id]: e.target.value as TestResult | "",
                          }))
                        }
                      >
                        <option value="">use computed</option>
                        {TEST_RESULTS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            )}

            {canAddModeFromTest && stagedModes.length > 0 && (
              <div className="hint-text">
                {stagedModes.map((s) => (
                  <p key={s.key}>
                    Staged: {s.input.name}{" "}
                    <button type="button" className="link-button link-button-danger" onClick={() => removeStaged(s.key)}>
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
                  functionGroups={functionGroups}
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
