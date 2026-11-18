import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { BackLink } from "../components/common/BackLink";
import { useQueries } from "@tanstack/react-query";
import { testLinesApi } from "../api/testLines";
import { testLinesKey } from "../state/hooks/useTestLines";
import { PlatformNotesDrawer } from "../components/common/EntityNotesDrawer";
import { formatTime } from "../components/common/dates";
import { DateInput, TimeInput } from "../components/common/DateInput";
import { PageHeader } from "../components/common/PageHeader";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { testDraftsApi } from "../api/testRecords";
import { isOutdatedPin } from "../api/platforms";
import { platformTestsApi, type PlatformTestEmitterInput } from "../api/platformTests";
import { ApiRequestError } from "../api/client";
import { LOGGABLE_TEST_TYPES, type Emitter, type LoggableTestType, type TestResult } from "../types/domain";
import { usePlatform, usePlatformLinks } from "../state/hooks/usePlatforms";
import { useEmitters } from "../state/hooks/useEmitters";
import {
  platformTestDraftsKey,
  useDiscardPlatformTestDraft,
  useLogPlatformTest,
} from "../state/hooks/usePlatformTests";
import { useHasRole } from "../auth/RequireAuth";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { LoadingState } from "../components/common/LoadingState";
import { AutoGrowTextarea } from "../components/common/AutoGrowTextarea";
import { computeOverallResult } from "../components/testing/modeResultAggregate";
import { mhz, TEST_RESULTS, testResultLabel, testTypeLabel } from "../components/testing/testFormat";
import { DwellInput, MANUAL_DWELL } from "../components/testing/DwellInput";
import { ReceivedPowerInput, receivedPowerError } from "../components/testing/ReceivedPowerInput";
import {
  blankObserved,
  DetectionCell,
  observedInput,
  previewVerdicts,
  ReportedAsCell,
  timeError,
  useStrategyDwells,
  VerdictsLine,
  workedOut,
  type ObservedRun,
} from "../components/testing/ObservedEmitter";

/** One pinned Emitter's part of the run: whether it's in it, its result and
 * notes. (Per-line and per-Mode detail stays on each Emitter's own runs.) */
interface EmitterRun {
  included: boolean;
  /** Empty until someone picks one — logging needs a result for every Emitter in the run. */
  result: TestResult | "";
  notes: string;
  /** When its simulation was built, as typed — otherwise the newest of its
   * SIM Test Lines' created dates. */
  simCreatedDate?: string;
  /** When redoing an earlier Platform test: the Emitter's record in it, and its result then. */
  retestsRecordId?: string;
  previousResult?: TestResult;
  /** What was observed with the others on the air: detected, how soon, by
   * which dwell, and what it was reported as. */
  observed?: ObservedRun;
}

/** Everything saved as the run is filled in — the draft's `state`. */
interface PlatformRunState {
  testType: LoggableTestType;
  title: string;
  testDate: string;
  testTime: string;
  simCreatedDate: string;
  interceptDate: string;
  dwell: string;
  /** The Platform's Dwell Strategy version picked under Dwell, if one was. */
  dwellStrategyVersionId?: string;
  /** dBFS, as typed. */
  receivedPower?: string;
  notes: string;
  emitters: Record<string, EmitterRun>;
}

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "error"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "gone" };

const SAVE_DELAY_MS = 800;

/** Whether the run has anything typed in worth coming back to — until it
 * does, nothing is saved, so opening the page and leaving doesn't leave an
 * empty run behind on the Platform's Tests tab. */
function worthKeeping(s: PlatformRunState): boolean {
  return (
    !!s.title.trim() ||
    !!s.notes.trim() ||
    Object.values(s.emitters).some((e) => !!e.result || !!e.notes.trim() || !!e.observed?.detected)
  );
}

function blankRun(): EmitterRun {
  return { included: true, result: "", notes: "" };
}

/** A saved draft's Emitter part — drafts from before the page was simplified
 * kept the result as manualResult. */
function fromDraft(saved: Partial<EmitterRun> & { manualResult?: TestResult }): EmitterRun {
  return {
    ...blankRun(),
    included: saved.included ?? true,
    result: saved.result ?? saved.manualResult ?? "",
    notes: saved.notes ?? "",
    simCreatedDate: saved.simCreatedDate,
    retestsRecordId: saved.retestsRecordId,
    previousResult: saved.previousResult,
    observed: saved.observed ? { ...blankObserved(), ...saved.observed } : undefined,
  };
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function emitterLabel(emitter: Emitter | undefined, fallback: string) {
  if (!emitter) return fallback;
  return emitter.designation ? `${emitter.designation} — ${emitter.name}` : emitter.name;
}

/** A Platform test: every Emitter pinned on the Platform tested in one run.
 * Saved as it's filled in; logging it writes a test record per included
 * Emitter, against the version the Platform pins. */
export function PlatformTestRunPage() {
  const { platformId = "" } = useParams<{ platformId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const draftParam = searchParams.get("draft");
  // Redoing an earlier Platform test: its Emitters, title and type to start from.
  const redoParam = searchParams.get("redo");
  const canWrite = useHasRole("editor");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { confirmDelete, dialog } = useConfirmDialog();

  const { data: platform } = usePlatform(platformId);
  const { data: links } = usePlatformLinks(platformId);
  const { data: allEmitters } = useEmitters();
  const logTest = useLogPlatformTest(platformId);
  const discardDraft = useDiscardPlatformTestDraft(platformId);

  const [state, setState] = useState<PlatformRunState>(() => ({
    testType: "simulation",
    title: "",
    testDate: new Date().toISOString().slice(0, 10),
    testTime: nowTime(),
    simCreatedDate: "",
    interceptDate: "",
    dwell: MANUAL_DWELL,
    notes: "",
    emitters: {},
  }));
  const [error, setError] = useState<string | null>(null);
  const patch = (change: Partial<PlatformRunState>) => setState((s) => ({ ...s, ...change }));
  const patchEmitter = useCallback(
    (emitterId: string, change: Partial<EmitterRun>) =>
      setState((s) => ({
        ...s,
        emitters: { ...s.emitters, [emitterId]: { ...(s.emitters[emitterId] ?? blankRun()), ...change } },
      })),
    [],
  );

  const emittersById = useMemo(() => new Map((allEmitters ?? []).map((e) => [e.id, e])), [allEmitters]);
  const pins = useMemo(
    () =>
      [...(links ?? [])].sort((a, b) =>
        emitterLabel(emittersById.get(a.emitter_id), a.emitter_id).localeCompare(
          emitterLabel(emittersById.get(b.emitter_id), b.emitter_id),
        ),
      ),
    [links, emittersById],
  );
  const runFor = (emitterId: string) => state.emitters[emitterId] ?? blankRun();
  const isSimulation = state.testType === "simulation";
  // Each Emitter's simulation date, from its own SIM Test Lines (the newest
  // created date), as a single Emitter's run defaults to.
  const lineQueries = useQueries({
    queries: pins.map((l) => ({
      queryKey: testLinesKey(l.emitter_id),
      queryFn: () => testLinesApi.listForEmitter(l.emitter_id),
    })),
  });
  const derivedSimDate = new Map<string, string>();
  pins.forEach((l, i) => {
    const newest = (lineQueries[i]?.data ?? [])
      .map((t) => t.created_date)
      .filter((d): d is string => !!d)
      .sort()
      .pop();
    if (newest) derivedSimDate.set(l.emitter_id, newest);
  });
  /** The simulation date an Emitter's record gets: typed, derived, or (an older draft) the run's. */
  const simDateFor = (emitterId: string) =>
    runFor(emitterId).simCreatedDate ?? derivedSimDate.get(emitterId) ?? state.simCreatedDate ?? "";
  const included = pins.filter((l) => runFor(l.emitter_id).included);
  const dwells = useStrategyDwells(platformId, state.dwellStrategyVersionId);
  /** An Emitter's result: the one picked, else what was observed gives. */
  const resultFor = (emitterId: string): TestResult | null => {
    const run = runFor(emitterId);
    return run.result || workedOut(run.observed);
  };

  // --- Saved as it's filled in (as an Emitter's test run is) -------------
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const draftId = useRef<string | null>(draftParam);
  const draftVersion = useRef<number | undefined>(undefined);
  const saved = useRef<string | null>(null);
  const adoptNext = useRef(true);
  const saving = useRef(false);
  const savePending = useRef(false);
  const logging = useRef(false);
  const latest = useRef<{ json: string; body: { title: string; test_type: LoggableTestType; summary: string; state: PlatformRunState } } | null>(null);

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !links) return;
    seeded.current = true;
    if (draftParam) {
      testDraftsApi
        .get<PlatformRunState>(draftParam)
        .then((draft) => {
          draftVersion.current = draft.version;
          const emitters = Object.fromEntries(
            Object.entries(draft.state.emitters ?? {}).map(([id, run]) => [id, fromDraft(run)]),
          );
          setState((s) => ({ ...s, ...draft.state, emitters }));
          adoptNext.current = true;
          setReady(true);
        })
        .catch((err) => setLoadError(err instanceof ApiRequestError ? err.message : "Couldn't open this Platform test"));
      return;
    }
    if (redoParam) {
      platformTestsApi
        .get(redoParam)
        .then((test) => {
          const byEmitter = new Map(test.emitters.map((e) => [e.emitter_id, e]));
          setState((s) => ({
            ...s,
            title: `Retest: ${test.title}`,
            testType: test.test_type,
            // The same dwell Strategy version, so "caught by dwell" reads the same dwells.
            ...(test.dwell_strategy_version_id
              ? {
                  dwellStrategyVersionId: test.dwell_strategy_version_id,
                  dwell: `${test.dwell_strategy_name ?? "Strategy"} v${test.dwell_strategy_version_number ?? ""}`,
                }
              : {}),
            // Every Emitter the earlier test had, linked to its record there; the rest left out.
            emitters: Object.fromEntries(
              (links ?? []).map((l) => {
                const prev = byEmitter.get(l.emitter_id);
                return [
                  l.emitter_id,
                  prev
                    ? { ...blankRun(), retestsRecordId: prev.test_record_id, previousResult: prev.result }
                    : { ...blankRun(), included: false },
                ];
              }),
            ),
          }));
          // A redo starts a new run straight away.
          adoptNext.current = false;
          setReady(true);
        })
        .catch((err) => setLoadError(err instanceof ApiRequestError ? err.message : "Couldn't open the test to redo"));
      return;
    }
    setReady(true);
    // Seeded once, when the Platform's pins are known.
  }, [draftParam, redoParam, links]);

  const saveNow = useCallback(async () => {
    const current = latest.current;
    if (!current || logging.current || current.json === saved.current) return;
    // Nothing worth keeping yet: no run in progress is made for it.
    if (!draftId.current && !worthKeeping(current.body.state)) return;
    if (saving.current) {
      savePending.current = true;
      return;
    }
    saving.current = true;
    setSaveStatus({ kind: "saving" });
    try {
      if (!draftId.current) {
        const draft = await platformTestsApi.createDraft(platformId, current.body);
        draftId.current = draft.id;
        draftVersion.current = draft.version;
        setSearchParams({ draft: draft.id }, { replace: true });
      } else {
        const res = await testDraftsApi.save(draftId.current, { ...current.body, version: draftVersion.current });
        draftVersion.current = res.version;
      }
      saved.current = current.json;
      setSaveStatus({ kind: "saved", at: new Date() });
      qc.invalidateQueries({ queryKey: platformTestDraftsKey(platformId) });
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
  }, [platformId, qc, setSearchParams]);

  const json = JSON.stringify(state);
  latest.current = {
    json,
    body: {
      title: state.title,
      test_type: state.testType,
      summary: `${included.length} of ${pins.length} Emitter${pins.length === 1 ? "" : "s"} in the run`,
      state,
    },
  };
  useEffect(() => {
    if (!ready || !canWrite) return;
    if (adoptNext.current) {
      adoptNext.current = false;
      saved.current = json;
      return;
    }
    if (json === saved.current) return;
    const timer = window.setTimeout(() => void saveNow(), draftId.current ? SAVE_DELAY_MS : 0);
    return () => window.clearTimeout(timer);
  }, [json, ready, canWrite, saveNow]);

  useEffect(() => {
    function onHide() {
      if (document.visibilityState === "hidden" && canWrite && ready) void saveNow();
    }
    function onUnload(e: BeforeUnloadEvent) {
      if (
        canWrite &&
        ready &&
        !logging.current &&
        latest.current &&
        latest.current.json !== saved.current &&
        (draftId.current || worthKeeping(latest.current.body.state))
      ) {
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

  const back = `/platforms/${platformId}?tab=tests`;
  if (loadError)
    return (
      <div className="page">
        <BackLink to={back}>Tests</BackLink>
        <p className="error-text">{loadError}</p>
      </div>
    );
  if (!platform || !links || !allEmitters || !ready) return <LoadingState label="Loading Platform test…" />;

  const unset = included.filter((l) => !resultFor(l.emitter_id));
  const verdicts = previewVerdicts(included.map((l) => runFor(l.emitter_id).observed));
  const overall = unset.length
    ? null
    : computeOverallResult([
        ...included.map((l) => resultFor(l.emitter_id) as TestResult),
        ...(verdicts ? [verdicts.detection, verdicts.identification, verdicts.mixups].filter((v): v is TestResult => !!v) : []),
      ]);
  /** Only this Emitter on the air — the rest left out of the run. */
  const onlyThis = (emitterId: string) =>
    setState((s) => ({
      ...s,
      emitters: Object.fromEntries(
        pins.map((l) => [l.emitter_id, { ...(s.emitters[l.emitter_id] ?? blankRun()), included: l.emitter_id === emitterId }]),
      ),
    }));

  async function handleDiscard() {
    if (!(await confirmDelete("Discard this Platform test? What's been filled in is lost.", { confirmLabel: "Discard", danger: true })))
      return;
    logging.current = true;
    if (draftId.current) await discardDraft.mutateAsync(draftId.current).catch(() => undefined);
    navigate(back);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (included.length === 0) {
      setError("Include at least one Emitter.");
      return;
    }
    if (unset.length) {
      const names = unset.map((l) => emitterLabel(emittersById.get(l.emitter_id), l.emitter_id));
      setError(`Say whether ${names.join(", ")} ${names.length === 1 ? "was" : "were"} detected, or pick a result.`);
      return;
    }
    const badTime = included.find((l) => timeError(runFor(l.emitter_id).observed));
    if (badTime) {
      setError(`${emitterLabel(emittersById.get(badTime.emitter_id), badTime.emitter_id)}: ${timeError(runFor(badTime.emitter_id).observed)}.`);
      return;
    }
    const undated = isSimulation ? included.filter((l) => !simDateFor(l.emitter_id)) : [];
    if (undated.length) {
      const names = undated.map((l) => emitterLabel(emittersById.get(l.emitter_id), l.emitter_id));
      setError(`Give the simulation date for ${names.join(", ")} — it has no SIM Test Lines to take it from.`);
      return;
    }
    const powerProblem = receivedPowerError(state.receivedPower ?? "");
    if (powerProblem) {
      setError(powerProblem);
      return;
    }
    const emitters: PlatformTestEmitterInput[] = included.map((link) => {
      const run = runFor(link.emitter_id);
      return {
        emitter_id: link.emitter_id,
        // Left out, the server works it out from what was observed.
        result: run.result || undefined,
        ...observedInput(run.observed),
        notes: run.notes.trim() || undefined,
        simulation_created_date: isSimulation ? simDateFor(link.emitter_id) : undefined,
        retests_test_record_id: run.retestsRecordId,
      };
    });
    logging.current = true;
    try {
      await logTest.mutateAsync({
        test_type: state.testType,
        title: state.title,
        test_date: state.testDate,
        test_time: state.testTime || undefined,
        simulation_created_date: isSimulation ? undefined : state.interceptDate || undefined,
        received_power_dbfs: Number(state.receivedPower),
        dwell: state.dwell.trim() || undefined,
        dwell_strategy_version_id: state.dwellStrategyVersionId || undefined,
        notes: state.notes.trim() || undefined,
        draft_id: draftId.current ?? undefined,
        emitters,
      });
    } catch (err) {
      logging.current = false;
      setError(err instanceof ApiRequestError ? err.message : "Failed to log the Platform test");
      return;
    }
    navigate(back);
  }

  return (
    <div className="page">
      <PlatformNotesDrawer platformId={platformId} name={platform.name} />
      <BackLink to={back}>{platform.name} · Tests</BackLink>
      <PageHeader
        title={`${draftId.current ? "Platform test in progress" : "New Platform test"} — ${platform.name}`}
        info="The Platform's Emitters on the air together — all of them, some, or one: tick which were transmitting. For each, whether it was detected (how soon, by which dwell) and what it was reported as — itself, Default Unknown, or another of the Platform's Emitters (a mix-up). Its result is worked out from that unless you pick one, and the run gets three verdicts: Detection, Identification and Mix-ups. Logging it writes a test record for each Emitter in the run — against the version the Platform pins — so each also shows in that Emitter's Test History."
      />
      {canWrite && <SaveLine status={saveStatus} hasDraft={!!draftId.current} onRetry={() => void saveNow()} />}
      {dialog}

      <form onSubmit={handleSubmit}>
        <div className="card test-run-header">
          <div className="form-row">
            <label className="wide-label">
              Title
              <input value={state.title} onChange={(e) => patch({ title: e.target.value })} required />
            </label>
            <label>
              Type
              <select value={state.testType} onChange={(e) => patch({ testType: e.target.value as LoggableTestType })}>
                {LOGGABLE_TEST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {testTypeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Test date
              <DateInput value={state.testDate} onChange={(e) => patch({ testDate: e.target.value })} required />
            </label>
            <label>
              Time
              <TimeInput value={state.testTime} onChange={(e) => patch({ testTime: e.target.value })} />
            </label>
            {!isSimulation && (
              <label>
                Intercept date (optional)
                <DateInput value={state.interceptDate} onChange={(e) => patch({ interceptDate: e.target.value })} />
              </label>
            )}
            <DwellInput
              value={state.dwell}
              onChange={(dwell) => patch({ dwell })}
              strategyVersionId={state.dwellStrategyVersionId ?? ""}
              onStrategy={(id, label) => patch(id ? { dwellStrategyVersionId: id, dwell: label } : { dwellStrategyVersionId: "" })}
              platformId={platformId}
            />
            <ReceivedPowerInput value={state.receivedPower ?? ""} onChange={(receivedPower) => patch({ receivedPower })} />
          </div>
          <label className="test-notes-field">
            Session notes (optional) — equipment, environment, anything about the run as a whole; an Emitter&apos;s
            record gets these unless it has notes of its own
            <textarea value={state.notes} onChange={(e) => patch({ notes: e.target.value })} rows={2} />
          </label>
          <p className="test-run-overall">
            {included.length} of {pins.length} pinned Emitter{pins.length === 1 ? "" : "s"} transmitting
            {unset.length > 0 && (
              <span className="hint-text">
                {" "}
                · {unset.length} still need{unset.length === 1 ? "s" : ""} detection or a result
              </span>
            )}
            {verdicts && (
              <>
                {" "}
                · <VerdictsLine v={verdicts} />
              </>
            )}
            {overall && (
              <>
                {" "}
                · overall <span className={`test-result-badge test-result-${overall}`}>{testResultLabel(overall)}</span>{" "}
                <span className="hint-text">(the worst of the Emitters&apos; and the verdicts)</span>
              </>
            )}
          </p>
        </div>

        {pins.length === 0 ? (
          <p className="hint-text">This Platform has no pinned Emitters — pin some first.</p>
        ) : (
          <div className="card">
            <table className="data-table platform-test-table">
              <thead>
                <tr>
                  <th title="Which of the Platform's Emitters were on the air in this run">Transmitting</th>
                  <th>Emitter</th>
                  {isSimulation && (
                    <th title="Each Emitter's simulation date — the newest of its SIM Test Lines' created dates, unless changed here">
                      Simulation created
                    </th>
                  )}
                  <th title="Detected or missed; how soon (seconds) and by which dwell of the Strategy picked above">Detected</th>
                  <th title="What the system reported it as: itself, Default Unknown, and/or another Emitter (a mix-up)">Reported as</th>
                  <th>Result</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {pins.map((link) => {
                  const run = runFor(link.emitter_id);
                  const label = emitterLabel(emittersById.get(link.emitter_id), link.emitter_id);
                  return (
                    <tr key={link.emitter_id} className={run.included ? undefined : "excluded-row"}>
                      <td className="select-col">
                        <input
                          type="checkbox"
                          checked={run.included}
                          onChange={(e) => patchEmitter(link.emitter_id, { included: e.target.checked })}
                          aria-label={`${label} in this run`}
                        />
                      </td>
                      <td>
                        <Link to={`/emitters/${link.emitter_id}`} className="run-item-name">
                          {label}
                        </Link>
                        <div className="hint-text platform-test-pin">
                          v{link.pinned_version_number ?? "?"}
                          {isOutdatedPin(link) && <> (v{link.latest_version_number} saved since)</>} · {mhz(link.rf_min_mhz)}–
                          {mhz(link.rf_max_mhz)} MHz
                          {pins.length > 1 && (
                            <>
                              {" · "}
                              <button
                                type="button"
                                className="link-button"
                                title="Only this Emitter transmitting — the others left out of the run"
                                onClick={() => onlyThis(link.emitter_id)}
                              >
                                Only this one
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      {isSimulation && (
                        <td className="nowrap">
                          <DateInput
                            value={simDateFor(link.emitter_id)}
                            disabled={!run.included}
                            onChange={(e) => patchEmitter(link.emitter_id, { simCreatedDate: e.target.value })}
                            aria-label={`${label} simulation created`}
                            title={
                              run.simCreatedDate === undefined && derivedSimDate.has(link.emitter_id)
                                ? "From its SIM Test Lines (the newest created date)"
                                : undefined
                            }
                          />
                        </td>
                      )}
                      <td>
                        <DetectionCell
                          value={run.observed ?? blankObserved()}
                          onChange={(observed) => patchEmitter(link.emitter_id, { observed })}
                          dwells={dwells}
                          disabled={!run.included}
                          label={label}
                        />
                      </td>
                      <td>
                        <ReportedAsCell
                          value={run.observed ?? blankObserved()}
                          onChange={(observed) => patchEmitter(link.emitter_id, { observed })}
                          ownModes={link.pinned_mode_names ?? []}
                          options={pins
                            .filter((l) => l.emitter_id !== link.emitter_id)
                            .map((l) => ({
                              emitterId: l.emitter_id,
                              label: emitterLabel(emittersById.get(l.emitter_id), l.emitter_id),
                              modes: l.pinned_mode_names ?? [],
                            }))}
                          disabled={!run.included}
                          label={label}
                        />
                      </td>
                      <td className="nowrap">
                        <select
                          className={`outcome-select${resultFor(link.emitter_id) ? ` test-result-${resultFor(link.emitter_id)}` : ""}`}
                          value={run.result}
                          disabled={!run.included}
                          onChange={(e) => patchEmitter(link.emitter_id, { result: e.target.value as TestResult | "" })}
                          aria-label={`${label} result`}
                          title={workedOut(run.observed) ? "Worked out from what was observed, unless you pick one" : undefined}
                        >
                          <option value="" disabled={!workedOut(run.observed)}>
                            {workedOut(run.observed) ? `Worked out: ${testResultLabel(workedOut(run.observed)!)}` : "Choose…"}
                          </option>
                          {TEST_RESULTS.map((r) => (
                            <option key={r} value={r}>
                              {testResultLabel(r)}
                            </option>
                          ))}
                        </select>
                        {run.previousResult && (
                          <span className="hint-text platform-test-last">last time: {testResultLabel(run.previousResult)}</span>
                        )}
                      </td>
                      <td className="platform-test-notes">
                        <AutoGrowTextarea
                          value={run.notes}
                          disabled={!run.included}
                          onChange={(e) => patchEmitter(link.emitter_id, { notes: e.target.value })}
                          placeholder="Notes on this Emitter (optional)"
                          aria-label={`Notes on ${label}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="form-row">
          <button
            type="submit"
            disabled={logTest.isPending || saveStatus.kind === "conflict" || saveStatus.kind === "gone" || !pins.length}
          >
            {logTest.isPending ? "Logging…" : `Log Platform test (${included.length} Emitter${included.length === 1 ? "" : "s"})`}
          </button>
          <Link to={back}>{draftId.current ? "Leave — continue later" : "Cancel"}</Link>
          {draftId.current && canWrite && (
            <button type="button" className="link-button link-button-danger" onClick={() => void handleDiscard()}>
              Discard this run
            </button>
          )}
        </div>
        {error && <div className="error-text">{error}</div>}
      </form>
    </div>
  );
}

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
        This Platform test was logged or discarded elsewhere — nothing more is saved here.
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
          ? `Saved ${formatTime(status.at)}. `
          : hasDraft
            ? "Picked up where it was left. "
            : "Saved as you fill it in. "}
      {status.kind !== "saving" &&
        "You can leave and continue it from the Platform's Tests tab; nothing counts until it's logged."}
    </p>
  );
}
