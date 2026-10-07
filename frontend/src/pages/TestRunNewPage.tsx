import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { testDraftsApi, type TestRecord } from "../api/testRecords";
import { modesApi, type ModeCreateInput } from "../api/modes";
import { ApiRequestError } from "../api/client";
import { LOGGABLE_TEST_TYPES, type LoggableTestType, type TestResult } from "../types/domain";
import { useEmitter } from "../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../state/hooks/useEmitterCheckout";
import { useEwGroups } from "../state/hooks/useEwGroups";
import { useSources } from "../state/hooks/useSources";
import { useFunctionGroups } from "../state/hooks/useFunctionGroups";
import { emitterModesKey, useEmitterModes } from "../state/hooks/useModes";
import { useEmitterTestLines } from "../state/hooks/useTestLines";
import {
  testDraftsKey,
  useCreateEmitterTestRecord,
  useDiscardTestDraft,
  useEmitterTestRecords,
} from "../state/hooks/useTestRecords";
import { useHasRole } from "../auth/RequireAuth";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { DEFAULT_UNKNOWN } from "../components/testing/ModeMultiSelect";
import { LoadingState } from "../components/common/LoadingState";
import { ModeForm } from "../components/modes/ModeForm";
import { computeOverallResult } from "../components/testing/modeResultAggregate";
import { blankSimLineEntry, SimLineResultsTable, type SimLineEntry } from "../components/testing/SimLineResultsTable";
import {
  blankInterceptModeEntry,
  InterceptModeResultsTable,
  type InterceptModeEntry,
} from "../components/testing/InterceptModeResultsTable";
import { nonEmptySets, observedValueOptions, TEST_RESULTS, testTypeLabel } from "../components/testing/testFormat";
import { DwellInput, MANUAL_DWELL } from "../components/testing/DwellInput";

/** Everything on the page that's saved as the run is filled in — the
 * draft's `state`. (A new Mode being typed in isn't, until it's staged.) */
interface RunState {
  testType: LoggableTestType;
  title: string;
  testDate: string;
  simCreatedDate: string;
  interceptDate: string;
  dwell: string;
  retestsId: string;
  copyFromId: string;
  notes: string;
  manualResult: TestResult;
  lineEntries: Record<string, SimLineEntry>;
  modeEntries: Record<string, InterceptModeEntry>;
  functionGroupOverrides: Record<string, TestResult | "">;
  stagedModes: { key: string; ewGroupId: string; input: ModeCreateInput }[];
}

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "error"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "gone" };

// How long typing pauses before the run is saved.
const SAVE_DELAY_MS = 800;

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Outcomes and intercepted Modes carry over from an earlier run; parameters
 * and notes describe that specific run, so they don't. */
function lineEntriesFrom(previous: TestRecord | undefined, lineIds: string[]): Record<string, SimLineEntry> {
  const prior = new Map((previous?.lines ?? []).map((l) => [l.test_line_id, l]));
  return Object.fromEntries(
    lineIds.map((id) => {
      const p = prior.get(id);
      return [
        id,
        p
          ? {
              ...blankSimLineEntry(),
              outcome: p.outcome,
              interceptedModeIds: [
                ...(p.intercepted_as_unknown ? [DEFAULT_UNKNOWN.id] : []),
                ...p.intercepted_modes.map((m) => m.mode_id),
              ],
            }
          : blankSimLineEntry(),
      ];
    }),
  );
}

function modeEntriesFrom(previous: TestRecord | undefined): Record<string, InterceptModeEntry> {
  return Object.fromEntries(
    (previous?.modes ?? [])
      .filter((m) => m.link_type === "exercised" && m.result)
      .map((m) => [m.mode_id, { ...blankInterceptModeEntry(), included: true, result: m.result as TestResult }]),
  );
}

export function TestRunNewPage() {
  const { emitterId = "" } = useParams<{ emitterId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const retestParam = searchParams.get("retest");
  // A run in progress being picked up again (or reloaded).
  const draftParam = searchParams.get("draft");
  const canWrite = useHasRole("editor");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const { data: ewGroups } = useEwGroups(emitterId);
  const { data: sources } = useSources(emitterId);
  const { data: functionGroups } = useFunctionGroups(emitterId);
  const { data: modes } = useEmitterModes(emitterId);
  const { data: testLines } = useEmitterTestLines(emitterId);
  const { data: records } = useEmitterTestRecords(emitterId);
  const create = useCreateEmitterTestRecord(emitterId);
  const discardDraft = useDiscardTestDraft(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();

  const [testType, setTestType] = useState<LoggableTestType>("simulation");
  const [title, setTitle] = useState("");
  const [testDate, setTestDate] = useState(todayDate());
  const [simCreatedDate, setSimCreatedDate] = useState("");
  const [interceptDate, setInterceptDate] = useState("");
  const [dwell, setDwell] = useState(MANUAL_DWELL);
  const [retestsId, setRetestsId] = useState("");
  const [copyFromId, setCopyFromId] = useState("");
  const [notes, setNotes] = useState("");
  const [manualResult, setManualResult] = useState<TestResult>("pass");
  const [lineEntries, setLineEntries] = useState<Record<string, SimLineEntry>>({});
  const [modeEntries, setModeEntries] = useState<Record<string, InterceptModeEntry>>({});
  const [functionGroupOverrides, setFunctionGroupOverrides] = useState<Record<string, TestResult | "">>({});
  const [stagingKeys, setStagingKeys] = useState<string[]>([]);
  const [stagedModes, setStagedModes] = useState<{ key: string; ewGroupId: string; input: ModeCreateInput }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const lineIds = useMemo(() => (testLines ?? []).map((l) => l.id), [testLines]);
  // "Intercepted as" offers Default Unknown first, then the Emitter's Modes.
  const modeNames = useMemo(() => [DEFAULT_UNKNOWN, ...(modes ?? []).map((m) => ({ id: m.id, name: m.name }))], [modes]);

  const state: RunState = useMemo(
    () => ({
      testType,
      title,
      testDate,
      simCreatedDate,
      interceptDate,
      dwell,
      retestsId,
      copyFromId,
      notes,
      manualResult,
      lineEntries,
      modeEntries,
      functionGroupOverrides,
      stagedModes,
    }),
    [testType, title, testDate, simCreatedDate, interceptDate, dwell, retestsId, copyFromId, notes, manualResult, lineEntries, modeEntries, functionGroupOverrides, stagedModes],
  );

  function applyState(s: Partial<RunState>) {
    if (s.testType) setTestType(s.testType);
    if (s.title !== undefined) setTitle(s.title);
    if (s.testDate) setTestDate(s.testDate);
    if (s.simCreatedDate !== undefined) setSimCreatedDate(s.simCreatedDate);
    if (s.interceptDate !== undefined) setInterceptDate(s.interceptDate);
    if (s.dwell !== undefined) setDwell(s.dwell);
    if (s.retestsId !== undefined) setRetestsId(s.retestsId);
    if (s.copyFromId !== undefined) setCopyFromId(s.copyFromId);
    if (s.notes !== undefined) setNotes(s.notes);
    if (s.manualResult) setManualResult(s.manualResult);
    if (s.lineEntries) setLineEntries(s.lineEntries);
    if (s.modeEntries) setModeEntries(s.modeEntries);
    if (s.functionGroupOverrides) setFunctionGroupOverrides(s.functionGroupOverrides);
    if (s.stagedModes) setStagedModes(s.stagedModes);
  }

  // --- Saved as it's filled in -------------------------------------------
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const draftId = useRef<string | null>(draftParam);
  const draftVersion = useRef<number | undefined>(undefined);
  // What's on the server: the run as last saved (or as first opened).
  const saved = useRef<string | null>(null);
  // Take the next state as saved without saving it (just loaded or seeded).
  const adoptNext = useRef(true);
  const saving = useRef(false);
  const savePending = useRef(false);
  const logging = useRef(false);
  const latest = useRef<{ json: string; body: { title: string; test_type: LoggableTestType; summary: string; state: RunState } } | null>(null);


  // Seed the form once the data it depends on has loaded — including a
  // retest's settings when opened via "Redo test".
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !testLines || !records) return;
    seeded.current = true;
    if (draftParam) {
      testDraftsApi
        .get<RunState>(draftParam)
        .then((draft) => {
          draftVersion.current = draft.version;
          applyState(draft.state);
          adoptNext.current = true;
          setReady(true);
        })
        .catch((err) => setLoadError(err instanceof ApiRequestError ? err.message : "Couldn't open this test run"));
      return;
    }
    const retested = retestParam ? records.find((r) => r.id === retestParam) : undefined;
    const latestLineDate = testLines
      .map((l) => l.created_date)
      .filter((d): d is string => !!d)
      .sort()
      .at(-1);
    setSimCreatedDate(latestLineDate ?? "");
    setLineEntries(lineEntriesFrom(retested, lineIds));
    setModeEntries(modeEntriesFrom(retested));
    if (retested) {
      setTitle(`Retest: ${retested.title}`);
      setRetestsId(retested.id);
      setCopyFromId(retested.id);
      if (retested.test_type === "intercept") setTestType("intercept");
    }
    adoptNext.current = true;
    setReady(true);
    // applyState only calls state setters, which never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testLines, records, retestParam, draftParam, lineIds]);

  const saveNow = useCallback(async () => {
    const current = latest.current;
    if (!current || logging.current || current.json === saved.current) return;
    if (saving.current) {
      savePending.current = true;
      return;
    }
    saving.current = true;
    setSaveStatus({ kind: "saving" });
    try {
      if (!draftId.current) {
        const draft = await testDraftsApi.create(emitterId, current.body);
        draftId.current = draft.id;
        draftVersion.current = draft.version;
        // So a reload opens this run, not a blank one.
        setSearchParams({ draft: draft.id }, { replace: true });
      } else {
        const res = await testDraftsApi.save(draftId.current, { ...current.body, version: draftVersion.current });
        draftVersion.current = res.version;
      }
      saved.current = current.json;
      setSaveStatus({ kind: "saved", at: new Date() });
      qc.invalidateQueries({ queryKey: testDraftsKey(emitterId) });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) setSaveStatus({ kind: "conflict", message: err.message });
      else if (err instanceof ApiRequestError && err.status === 404) setSaveStatus({ kind: "gone" });
      else setSaveStatus({ kind: "error", message: err instanceof ApiRequestError ? err.message : "Couldn't save" });
      savePending.current = false;
      return;
    } finally {
      saving.current = false;
    }
    if (savePending.current) {
      savePending.current = false;
      void saveNow();
    }
  }, [emitterId, qc, setSearchParams]);

  const json = JSON.stringify(state);
  useEffect(() => {
    if (!ready || !canWrite) return;
    if (adoptNext.current) {
      adoptNext.current = false;
      saved.current = json;
      return;
    }
    if (json === saved.current) return;
    // The first change saves at once, so a reload straight after it finds the run.
    const timer = window.setTimeout(() => void saveNow(), draftId.current ? SAVE_DELAY_MS : 0);
    return () => window.clearTimeout(timer);
  }, [json, ready, canWrite, saveNow]);

  // Leaving the tab: save straight away; closing it with a change not yet
  // saved: the browser asks first.
  useEffect(() => {
    function onHide() {
      if (document.visibilityState === "hidden" && canWrite && ready) void saveNow();
    }
    function onUnload(e: BeforeUnloadEvent) {
      if (canWrite && ready && !logging.current && latest.current && latest.current.json !== saved.current) {
        void saveNow();
        e.preventDefault();
      }
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [saveNow, canWrite, ready]);

  if (loadError)
    return (
      <div className="page">
        <Link to={`/emitters/${emitterId}?tab=tests`}>← Back to test history</Link>
        <p className="error-text">{loadError}</p>
      </div>
    );
  if (!emitter || !testLines || !modes || !records || !ready) return <LoadingState label="Loading test run…" />;

  const isSimulation = testType === "simulation";
  const includedLines = Object.entries(lineEntries).filter(([id, e]) => e.included && lineIds.includes(id));
  const includedModes = Object.entries(modeEntries).filter(([, e]) => e.included);
  const derived = isSimulation
    ? computeOverallResult(includedLines.map(([, e]) => e.outcome))
    : computeOverallResult(includedModes.map(([, e]) => e.result));
  const canAddModes = canEdit && (ewGroups?.length ?? 0) > 0 && (sources?.length ?? 0) > 0;

  // Worst-of per Function Group across the intercepted Modes — what the
  // override dropdowns are judged against. Intercept tests only.
  const groupComputed: Record<string, TestResult> = {};
  if (!isSimulation) {
    const byGroup = new Map<string, TestResult[]>();
    for (const m of modes) {
      const e = modeEntries[m.id];
      if (!m.function_group_id || !e?.included) continue;
      byGroup.set(m.function_group_id, [...(byGroup.get(m.function_group_id) ?? []), e.result]);
    }
    for (const [id, results] of byGroup) groupComputed[id] = computeOverallResult(results) as TestResult;
  }
  const ratedGroups = (functionGroups ?? []).filter((g) => groupComputed[g.id]);

  latest.current = {
    json,
    body: {
      title,
      test_type: testType,
      summary: isSimulation
        ? `${includedLines.length} of ${testLines.length} SIM line${testLines.length === 1 ? "" : "s"} in the run`
        : `${includedModes.length} Mode${includedModes.length === 1 ? "" : "s"} rated`,
      state,
    },
  };

  async function handleDiscard() {
    if (!(await confirmDelete("Discard this test run? What's been filled in is lost.", { confirmLabel: "Discard", danger: true })))
      return;
    logging.current = true;
    if (draftId.current) await discardDraft.mutateAsync(draftId.current).catch(() => undefined);
    navigate(`/emitters/${emitterId}?tab=tests`);
  }

  const preFillOptions = observedValueOptions([
    ...includedLines.map(([id, e]) => ({
      id,
      name: testLines.find((l) => l.id === id)?.label ?? "SIM line",
      sets: e.observedValues,
    })),
    ...includedModes.map(([id, e]) => ({ id, name: modes.find((m) => m.id === id)?.name ?? "Mode", sets: e.observedValues })),
  ]);

  function handleCopyFrom(id: string) {
    setCopyFromId(id);
    const previous = records?.find((r) => r.id === id);
    if (!previous) return;
    setLineEntries(lineEntriesFrom(previous, lineIds));
    setModeEntries(modeEntriesFrom(previous));
    if (previous.dwell) setDwell(previous.dwell);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const lineResults = isSimulation
      ? includedLines.map(([test_line_id, entry]) => ({
          test_line_id,
          outcome: entry.outcome,
          intercepted_mode_ids: entry.interceptedModeIds.some((id) => id !== DEFAULT_UNKNOWN.id)
            ? entry.interceptedModeIds.filter((id) => id !== DEFAULT_UNKNOWN.id)
            : undefined,
          intercepted_as_unknown: entry.interceptedModeIds.includes(DEFAULT_UNKNOWN.id) || undefined,
          observed_values: nonEmptySets(entry.observedValues).length ? nonEmptySets(entry.observedValues) : undefined,
          notes: entry.notes.trim() || undefined,
        }))
      : [];
    const modeResults = isSimulation
      ? []
      : includedModes.map(([mode_id, entry]) => ({
          mode_id,
          result: entry.result,
          observed_values: nonEmptySets(entry.observedValues).length ? nonEmptySets(entry.observedValues) : undefined,
          notes: entry.notes.trim() || undefined,
        }));
    const overrides = Object.fromEntries(Object.entries(functionGroupOverrides).filter(([, v]) => v !== "")) as Record<
      string,
      TestResult
    >;
    let record: TestRecord;
    // From here the run is being logged: no more saving it as a draft.
    logging.current = true;
    try {
      record = await create.mutateAsync({
        test_type: testType,
        title,
        test_date: testDate,
        // One column holds both: when the simulation was built, or when the intercept happened.
        simulation_created_date: (isSimulation ? simCreatedDate : interceptDate) || undefined,
        dwell: dwell.trim() || undefined,
        notes: notes.trim() || undefined,
        line_results: lineResults.length ? lineResults : undefined,
        mode_results: modeResults.length ? modeResults : undefined,
        result: lineResults.length || modeResults.length ? undefined : manualResult,
        retests_test_record_id: retestsId || undefined,
        function_group_overrides: Object.keys(overrides).length ? overrides : undefined,
        draft_id: draftId.current ?? undefined,
      });
    } catch (err) {
      logging.current = false;
      setError(err instanceof ApiRequestError ? err.message : "Failed to log the test run");
      return;
    }
    // The run is saved; a staged Mode failing to attach is reported on the
    // run's page rather than blocking the navigation.
    const failed: string[] = [];
    for (const staged of stagedModes) {
      try {
        await modesApi.create(staged.ewGroupId, { ...staged.input, derived_from_test_record_ids: [record.id] });
      } catch {
        failed.push(staged.input.name);
      }
    }
    if (stagedModes.length) qc.invalidateQueries({ queryKey: emitterModesKey(emitterId) });
    navigate(`/emitters/${emitterId}/tests/${record.id}`, {
      state: failed.length ? { stagedModeFailures: failed } : undefined,
    });
  }

  return (
    <div className="page">
      <Link to={`/emitters/${emitterId}?tab=tests`}>← Back to {emitter.name} test history</Link>
      <h1>{draftId.current ? "Test run in progress" : "New test run"} — {emitter.name}</h1>
      {canWrite && <SaveLine status={saveStatus} hasDraft={!!draftId.current} onRetry={() => void saveNow()} />}
      {dialog}

      <form onSubmit={handleSubmit}>
        <div className="card test-run-header">
          <div className="form-row">
            <label className="wide-label">
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label>
              Type
              <select value={testType} onChange={(e) => setTestType(e.target.value as LoggableTestType)}>
                {LOGGABLE_TEST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {testTypeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Test date
              <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} required />
            </label>
            <label>
              {isSimulation ? "Simulation created" : "Intercept date (optional)"}
              <input
                type="date"
                value={isSimulation ? simCreatedDate : interceptDate}
                onChange={(e) => (isSimulation ? setSimCreatedDate : setInterceptDate)(e.target.value)}
                required={isSimulation}
                title={isSimulation ? "Defaults to the newest SIM Test Line's created date" : undefined}
              />
            </label>
            <DwellInput value={dwell} onChange={setDwell} />
          </div>
          <div className="form-row">
            <label>
              Retest of (optional)
              <select value={retestsId} onChange={(e) => setRetestsId(e.target.value)}>
                <option value="">—</option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} — {r.test_date}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start from a previous run (optional)
              <select value={copyFromId} onChange={(e) => handleCopyFrom(e.target.value)}>
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
          </div>
          <label className="test-notes-field">
            Session notes (optional) — equipment, environment, anything about the run as a whole
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
        </div>

        <div className="card">
          <h4>{isSimulation ? "SIM Test Line results" : "Intercepted Modes"}</h4>
          {isSimulation ? (
            testLines.length === 0 ? (
              <p className="hint-text">
                This Emitter has no SIM Test Lines yet — import them on the Test History tab, or log an overall result
                below.
              </p>
            ) : (
              <SimLineResultsTable
                lines={testLines}
                entries={lineEntries}
                onChange={(id, entry) => setLineEntries((prev) => ({ ...prev, [id]: entry }))}
                modes={modeNames}
              />
            )
          ) : (
            <InterceptModeResultsTable
              modes={modes}
              entries={modeEntries}
              onChange={(id, entry) => setModeEntries((prev) => ({ ...prev, [id]: entry }))}
              functionGroups={functionGroups}
            />
          )}

          <p className="test-run-overall">
            Overall result:{" "}
            {derived ? (
              <span className={`test-result-badge test-result-${derived}`}>{derived}</span>
            ) : (
              <label className="inline-date-label">
                nothing included — set it manually
                <select value={manualResult} onChange={(e) => setManualResult(e.target.value as TestResult)}>
                  {TEST_RESULTS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </p>

          {ratedGroups.length > 0 && (
            <div className="function-group-ratings">
              <span className="param-row-label">Function Group ratings</span>
              {ratedGroups.map((g) => (
                <div key={g.id} className="function-group-rating-row">
                  <span>{g.name}</span>
                  <span className={`test-result-badge test-result-${groupComputed[g.id]}`}>{groupComputed[g.id]}</span>
                  <label className="inline-date-label">
                    Override
                    <select
                      value={functionGroupOverrides[g.id] ?? ""}
                      onChange={(e) =>
                        setFunctionGroupOverrides((prev) => ({ ...prev, [g.id]: e.target.value as TestResult | "" }))
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
        </div>

        {stagedModes.length > 0 && (
          <div className="card hint-text">
            {stagedModes.map((s) => (
              <p key={s.key}>
                New Mode to create with this run: <strong>{s.input.name}</strong>{" "}
                <button
                  type="button"
                  className="link-button link-button-danger"
                  onClick={() => setStagedModes((prev) => prev.filter((x) => x.key !== s.key))}
                >
                  Remove
                </button>
              </p>
            ))}
          </div>
        )}

        <div className="form-row">
          <button type="submit" disabled={create.isPending || saveStatus.kind === "conflict" || saveStatus.kind === "gone"}>
            {create.isPending ? "Logging…" : "Log test run"}
          </button>
          <Link to={`/emitters/${emitterId}?tab=tests`}>{draftId.current ? "Leave — continue later" : "Cancel"}</Link>
          {draftId.current && canWrite && (
            <button type="button" className="link-button link-button-danger" onClick={() => void handleDiscard()}>
              Discard this run
            </button>
          )}
        </div>
        {error && <div className="error-text">{error}</div>}
      </form>

      {/* Outside the form above: ModeForm renders its own <form>, and nested
          forms are invalid HTML. */}
      {canAddModes && (
        <div className="card staged-modes-section">
          <h5>New Modes found during this run (optional)</h5>
          {stagingKeys.map((k) => (
            <ModeForm
              key={k}
              emitterId={emitterId}
              ewGroups={ewGroups ?? []}
              sources={sources ?? []}
              functionGroups={functionGroups}
              onStage={(ewGroupId, input) => {
                setStagedModes((prev) => [...prev, { key: k, ewGroupId, input }]);
                setStagingKeys((keys) => keys.filter((x) => x !== k));
              }}
              observedValueOptions={preFillOptions}
            />
          ))}
          <button type="button" className="icon-button" onClick={() => setStagingKeys((keys) => [...keys, crypto.randomUUID()])}>
            + Stage a new Mode
          </button>
        </div>
      )}
    </div>
  );
}

/** Under the title: that the run is saved as it's filled in, and when it
 * last was — or why it couldn't be. */
function SaveLine({ status, hasDraft, onRetry }: { status: SaveStatus; hasDraft: boolean; onRetry: () => void }) {
  if (status.kind === "conflict")
    return (
      <p className="save-line error-text" role="alert">
        {status.message}{" "}
        <button type="button" className="link-button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </p>
    );
  if (status.kind === "gone")
    return (
      <p className="save-line error-text" role="alert">
        This test run was logged or discarded elsewhere — nothing more is saved here.
      </p>
    );
  if (status.kind === "error")
    return (
      <p className="save-line error-text" role="alert">
        Not saved: {status.message}{" "}
        <button type="button" className="link-button" onClick={onRetry}>
          Try again
        </button>
      </p>
    );
  return (
    <p className="save-line hint-text">
      {status.kind === "saving"
        ? "Saving…"
        : status.kind === "saved"
          ? `Saved ${status.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. `
          : hasDraft
            ? "Picked up where it was left. "
            : "Saved as you fill it in. "}
      {status.kind !== "saving" && "You can leave and continue it from Test History; nothing counts until it's logged."}
    </p>
  );
}
