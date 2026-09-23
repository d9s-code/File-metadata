import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { TestRecord } from "../api/testRecords";
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
import { useCreateEmitterTestRecord, useEmitterTestRecords } from "../state/hooks/useTestRecords";
import { LoadingState } from "../components/common/LoadingState";
import { ModeForm } from "../components/modes/ModeForm";
import { computeOverallResult } from "../components/testing/modeResultAggregate";
import { blankSimLineEntry, SimLineResultsTable, type SimLineEntry } from "../components/testing/SimLineResultsTable";
import {
  blankInterceptModeEntry,
  InterceptModeResultsTable,
  type InterceptModeEntry,
} from "../components/testing/InterceptModeResultsTable";
import { nonEmptySets, TEST_RESULTS, testTypeLabel } from "../components/testing/testFormat";

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
          ? { ...blankSimLineEntry(), outcome: p.outcome, interceptedModeIds: p.intercepted_modes.map((m) => m.mode_id) }
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
  const [searchParams] = useSearchParams();
  const retestParam = searchParams.get("retest");
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

  const [testType, setTestType] = useState<LoggableTestType>("simulation");
  const [title, setTitle] = useState("");
  const [testDate, setTestDate] = useState(todayDate());
  const [simCreatedDate, setSimCreatedDate] = useState("");
  const [interceptDate, setInterceptDate] = useState("");
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
  const modeNames = useMemo(() => (modes ?? []).map((m) => ({ id: m.id, name: m.name })), [modes]);

  // Seed the form once the data it depends on has loaded — including a
  // retest's settings when opened via "Redo test".
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !testLines || !records) return;
    seeded.current = true;
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
  }, [testLines, records, retestParam, lineIds]);

  if (!emitter || !testLines || !modes || !records) return <LoadingState label="Loading test run…" />;

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

  const observedValueOptions = [
    ...includedLines.flatMap(([id, e]) =>
      nonEmptySets(e.observedValues).map((values, i, all) => ({
        modeName: `${testLines.find((l) => l.id === id)?.label ?? "SIM line"}${all.length > 1 ? ` (set ${i + 1})` : ""}`,
        values,
      })),
    ),
    ...includedModes.flatMap(([id, e]) =>
      nonEmptySets(e.observedValues).map((values, i, all) => ({
        modeName: `${modes.find((m) => m.id === id)?.name ?? "Mode"}${all.length > 1 ? ` (set ${i + 1})` : ""}`,
        values,
      })),
    ),
  ];

  function handleCopyFrom(id: string) {
    setCopyFromId(id);
    const previous = records?.find((r) => r.id === id);
    if (!previous) return;
    setLineEntries(lineEntriesFrom(previous, lineIds));
    setModeEntries(modeEntriesFrom(previous));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const lineResults = isSimulation
      ? includedLines.map(([test_line_id, entry]) => ({
          test_line_id,
          outcome: entry.outcome,
          intercepted_mode_ids: entry.interceptedModeIds.length ? entry.interceptedModeIds : undefined,
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
    try {
      record = await create.mutateAsync({
        test_type: testType,
        title,
        test_date: testDate,
        // One column holds both: when the simulation was built, or when the intercept happened.
        simulation_created_date: (isSimulation ? simCreatedDate : interceptDate) || undefined,
        notes: notes.trim() || undefined,
        line_results: lineResults.length ? lineResults : undefined,
        mode_results: modeResults.length ? modeResults : undefined,
        result: lineResults.length || modeResults.length ? undefined : manualResult,
        retests_test_record_id: retestsId || undefined,
        function_group_overrides: Object.keys(overrides).length ? overrides : undefined,
      });
    } catch (err) {
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
      <h1>New test run — {emitter.name}</h1>

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
          <button type="submit" className="accent-button" disabled={create.isPending}>
            {create.isPending ? "Logging…" : "Log test run"}
          </button>
          <Link to={`/emitters/${emitterId}?tab=tests`}>Cancel</Link>
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
              observedValueOptions={observedValueOptions}
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
