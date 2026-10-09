import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { testDraftsApi } from "../api/testRecords";
import { isOutdatedPin, type PlatformLink } from "../api/platforms";
import { platformTestsApi, type PlatformTestEmitterInput } from "../api/platformTests";
import { ApiRequestError } from "../api/client";
import { LOGGABLE_TEST_TYPES, type Emitter, type LoggableTestType, type TestResult } from "../types/domain";
import { usePlatform, usePlatformLinks } from "../state/hooks/usePlatforms";
import { useEmitters } from "../state/hooks/useEmitters";
import { useEmitterModes } from "../state/hooks/useModes";
import { useEmitterTestLines } from "../state/hooks/useTestLines";
import {
  platformTestDraftsKey,
  useDiscardPlatformTestDraft,
  useLogPlatformTest,
} from "../state/hooks/usePlatformTests";
import { useHasRole } from "../auth/RequireAuth";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { LoadingState } from "../components/common/LoadingState";
import { DEFAULT_UNKNOWN } from "../components/testing/ModeMultiSelect";
import { computeOverallResult } from "../components/testing/modeResultAggregate";
import { SimLineResultsTable, type SimLineEntry } from "../components/testing/SimLineResultsTable";
import { InterceptModeResultsTable, type InterceptModeEntry } from "../components/testing/InterceptModeResultsTable";
import { InterceptSignalsEditor, loggedSignals, type SignalEntry } from "../components/testing/InterceptSignals";
import { nonEmptySets, TEST_RESULTS, testTypeLabel } from "../components/testing/testFormat";
import { DwellInput, MANUAL_DWELL } from "../components/testing/DwellInput";

/** One pinned Emitter's part of the run. */
interface EmitterRun {
  included: boolean;
  lineEntries: Record<string, SimLineEntry>;
  modeEntries: Record<string, InterceptModeEntry>;
  signals: SignalEntry[];
  manualResult: TestResult;
  resultOverride: TestResult | "";
  resultOverrideNote: string;
  notes: string;
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
  notes: string;
  emitters: Record<string, EmitterRun>;
}

/** The SIM Test Lines and Modes an Emitter has now — what its entries may refer to. */
interface Catalog {
  lineIds: string[];
  modeIds: string[];
}

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "error"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "gone" };

const SAVE_DELAY_MS = 800;

function blankRun(): EmitterRun {
  return {
    included: true,
    lineEntries: {},
    modeEntries: {},
    signals: [],
    manualResult: "pass",
    resultOverride: "",
    resultOverrideNote: "",
    notes: "",
  };
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** What an Emitter's included rows work out to, or null when none are included. */
function derivedResult(run: EmitterRun, testType: LoggableTestType, catalog: Catalog | undefined): TestResult | null {
  if (!catalog) return null;
  if (testType === "simulation")
    return computeOverallResult(
      Object.entries(run.lineEntries)
        .filter(([id, e]) => e.included && catalog.lineIds.includes(id))
        .map(([, e]) => e.outcome),
    );
  return computeOverallResult(
    Object.entries(run.modeEntries)
      .filter(([id, e]) => e.included && catalog.modeIds.includes(id))
      .map(([, e]) => e.result),
  );
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
  const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({});
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
  const onCatalog = useCallback(
    (emitterId: string, catalog: Catalog) => setCatalogs((c) => ({ ...c, [emitterId]: catalog })),
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
  const included = pins.filter((l) => runFor(l.emitter_id).included);

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
    if (seeded.current) return;
    seeded.current = true;
    if (!draftParam) {
      setReady(true);
      return;
    }
    testDraftsApi
      .get<PlatformRunState>(draftParam)
      .then((draft) => {
        draftVersion.current = draft.version;
        setState((s) => ({ ...s, ...draft.state }));
        adoptNext.current = true;
        setReady(true);
      })
      .catch((err) => setLoadError(err instanceof ApiRequestError ? err.message : "Couldn't open this Platform test"));
  }, [draftParam]);

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

  const back = `/platforms/${platformId}?tab=tests`;
  if (loadError)
    return (
      <div className="page">
        <Link to={back}>← Back to the Platform&apos;s tests</Link>
        <p className="error-text">{loadError}</p>
      </div>
    );
  if (!platform || !links || !allEmitters || !ready) return <LoadingState label="Loading Platform test…" />;

  const results = included.map((l) => {
    const run = runFor(l.emitter_id);
    const derived = derivedResult(run, state.testType, catalogs[l.emitter_id]);
    const overridden = derived && run.resultOverride && run.resultOverride !== derived ? run.resultOverride : null;
    return overridden ?? derived ?? run.manualResult;
  });
  const overall = computeOverallResult(results);

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
    const emitters: PlatformTestEmitterInput[] = [];
    for (const link of included) {
      const run = runFor(link.emitter_id);
      const catalog = catalogs[link.emitter_id];
      const name = emitterLabel(emittersById.get(link.emitter_id), link.emitter_id);
      if (!catalog) {
        setError(`${name} is still loading — try again in a moment.`);
        return;
      }
      const derived = derivedResult(run, state.testType, catalog);
      const override = derived && run.resultOverride && run.resultOverride !== derived ? run.resultOverride : undefined;
      if (override && !run.resultOverrideNote.trim()) {
        setError(`${name}: say why the result is overridden.`);
        return;
      }
      const lines = isSimulation
        ? Object.entries(run.lineEntries).filter(([id, entry]) => entry.included && catalog.lineIds.includes(id))
        : [];
      const modes = isSimulation
        ? []
        : Object.entries(run.modeEntries).filter(([id, entry]) => entry.included && catalog.modeIds.includes(id));
      emitters.push({
        emitter_id: link.emitter_id,
        line_results: lines.map(([test_line_id, entry]) => ({
          test_line_id,
          outcome: entry.outcome,
          intercepted_mode_ids: entry.interceptedModeIds.some((id) => id !== DEFAULT_UNKNOWN.id)
            ? entry.interceptedModeIds.filter((id) => id !== DEFAULT_UNKNOWN.id)
            : undefined,
          intercepted_as_unknown: entry.interceptedModeIds.includes(DEFAULT_UNKNOWN.id) || undefined,
          observed_values: nonEmptySets(entry.observedValues).length ? nonEmptySets(entry.observedValues) : undefined,
          notes: entry.notes.trim() || undefined,
        })),
        mode_results: modes.map(([mode_id, entry]) => ({
          mode_id,
          result: entry.result,
          observed_values: nonEmptySets(entry.observedValues).length ? nonEmptySets(entry.observedValues) : undefined,
          notes: entry.notes.trim() || undefined,
        })),
        signals: isSimulation ? undefined : loggedSignals(run.signals),
        result: lines.length || modes.length ? undefined : run.manualResult,
        result_override: override,
        result_override_note: override ? run.resultOverrideNote.trim() : undefined,
        notes: run.notes.trim() || undefined,
      });
    }
    logging.current = true;
    try {
      await logTest.mutateAsync({
        test_type: state.testType,
        title: state.title,
        test_date: state.testDate,
        test_time: state.testTime || undefined,
        simulation_created_date: (isSimulation ? state.simCreatedDate : state.interceptDate) || undefined,
        dwell: state.dwell.trim() || undefined,
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
      <Link to={back}>← Back to {platform.name}</Link>
      <h1>
        {draftId.current ? "Platform test in progress" : "New Platform test"} — {platform.name}
      </h1>
      <p className="hint-text">
        Every Emitter pinned on the Platform, tested in one run. Logging it writes a test record for each included Emitter
        — against the version the Platform pins — so each also shows in that Emitter&apos;s Test History.
      </p>
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
              <input type="date" value={state.testDate} onChange={(e) => patch({ testDate: e.target.value })} required />
            </label>
            <label>
              Time
              <input type="time" value={state.testTime} onChange={(e) => patch({ testTime: e.target.value })} />
            </label>
            <label>
              {isSimulation ? "Simulation created" : "Intercept date (optional)"}
              <input
                type="date"
                value={isSimulation ? state.simCreatedDate : state.interceptDate}
                onChange={(e) => patch(isSimulation ? { simCreatedDate: e.target.value } : { interceptDate: e.target.value })}
                required={isSimulation}
              />
            </label>
            <DwellInput value={state.dwell} onChange={(dwell) => patch({ dwell })} />
          </div>
          <label className="test-notes-field">
            Session notes (optional) — equipment, environment, anything about the run as a whole; an Emitter&apos;s
            record gets these unless it has notes of its own
            <textarea value={state.notes} onChange={(e) => patch({ notes: e.target.value })} rows={2} />
          </label>
          <p className="test-run-overall">
            {included.length} of {pins.length} pinned Emitter{pins.length === 1 ? "" : "s"} in the run
            {overall && (
              <>
                {" "}
                · overall <span className={`test-result-badge test-result-${overall}`}>{overall}</span>{" "}
                <span className="hint-text">(the worst of the Emitters&apos;)</span>
              </>
            )}
          </p>
        </div>

        {pins.length === 0 ? (
          <p className="hint-text">This Platform has no pinned Emitters — pin some first.</p>
        ) : (
          pins.map((link) => (
            <EmitterSection
              key={link.emitter_id}
              link={link}
              emitter={emittersById.get(link.emitter_id)}
              testType={state.testType}
              run={runFor(link.emitter_id)}
              onChange={(change) => patchEmitter(link.emitter_id, change)}
              onCatalog={onCatalog}
            />
          ))
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

/** One pinned Emitter's part of the run: its SIM Test Lines (or Modes and
 * signals for an Intercept Test), its result, and its own notes. */
function EmitterSection({
  link,
  emitter,
  testType,
  run,
  onChange,
  onCatalog,
}: {
  link: PlatformLink;
  emitter: Emitter | undefined;
  testType: LoggableTestType;
  run: EmitterRun;
  onChange: (change: Partial<EmitterRun>) => void;
  onCatalog: (emitterId: string, catalog: Catalog) => void;
}) {
  const [open, setOpen] = useState(true);
  const { data: testLines } = useEmitterTestLines(link.emitter_id);
  const { data: modes } = useEmitterModes(link.emitter_id);
  const catalog = useMemo(
    () => (testLines && modes ? { lineIds: testLines.map((l) => l.id), modeIds: modes.map((m) => m.id) } : undefined),
    [testLines, modes],
  );
  useEffect(() => {
    if (catalog) onCatalog(link.emitter_id, catalog);
  }, [catalog, link.emitter_id, onCatalog]);
  const modeNames = useMemo(() => [DEFAULT_UNKNOWN, ...(modes ?? []).map((m) => ({ id: m.id, name: m.name }))], [modes]);
  const isSimulation = testType === "simulation";
  const derived = derivedResult(run, testType, catalog);
  const label = emitterLabel(emitter, link.emitter_id);

  return (
    <section className={run.included ? "card platform-test-emitter" : "card platform-test-emitter excluded"}>
      <div className="platform-test-emitter-head">
        <label className="inline-label">
          <input type="checkbox" checked={run.included} onChange={(e) => onChange({ included: e.target.checked })} /> In
          this run
        </label>
        <button type="button" className="link-button platform-test-emitter-title" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "▾" : "▸"} <strong>{label}</strong>
        </button>
        <span className="hint-text">
          pinned v{link.pinned_version_number ?? "?"}
          {isOutdatedPin(link) && ` — v${link.latest_version_number} saved since`}
        </span>
        {run.included && (
          <span className="platform-test-emitter-result">
            {derived ? (
              <span className={`test-result-badge test-result-${run.resultOverride && run.resultOverride !== derived ? run.resultOverride : derived}`}>
                {run.resultOverride && run.resultOverride !== derived ? run.resultOverride : derived}
              </span>
            ) : (
              <>
                <span className={`test-result-badge test-result-${run.manualResult}`}>{run.manualResult}</span>{" "}
                <span className="hint-text">set by hand</span>
              </>
            )}
          </span>
        )}
      </div>
      {open && run.included && (
        <div className="platform-test-emitter-body">
          {!testLines || !modes ? (
            <p className="hint-text">Loading…</p>
          ) : isSimulation ? (
            testLines.length === 0 ? (
              <p className="hint-text">No SIM Test Lines on this Emitter — set its result below.</p>
            ) : (
              <SimLineResultsTable
                lines={testLines}
                entries={run.lineEntries}
                onChange={(id, entry) => onChange({ lineEntries: { ...run.lineEntries, [id]: entry } })}
                modes={modeNames}
              />
            )
          ) : (
            <>
              <InterceptModeResultsTable
                modes={modes}
                entries={run.modeEntries}
                onChange={(id, entry) => onChange({ modeEntries: { ...run.modeEntries, [id]: entry } })}
              />
              <InterceptSignalsEditor signals={run.signals} onChange={(signals) => onChange({ signals })} modes={modes} />
            </>
          )}
          <p className="test-run-overall">
            Result:{" "}
            {derived ? (
              <>
                <span className={`test-result-badge test-result-${derived}`}>{derived}</span>{" "}
                <span className="hint-text">worked out (worst of the included rows)</span>
                <label className="inline-date-label result-override">
                  Override
                  <select
                    value={run.resultOverride}
                    onChange={(e) => onChange({ resultOverride: e.target.value as TestResult | "" })}
                  >
                    <option value="">— keep {derived}</option>
                    {TEST_RESULTS.filter((r) => r !== derived).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                {run.resultOverride && run.resultOverride !== derived && (
                  <input
                    className="result-override-note"
                    value={run.resultOverrideNote}
                    onChange={(e) => onChange({ resultOverrideNote: e.target.value })}
                    placeholder={`Why it's ${run.resultOverride}, not ${derived} (required)`}
                    aria-label={`Why ${label}'s result is overridden`}
                  />
                )}
              </>
            ) : (
              <label className="inline-date-label">
                nothing included — set it manually
                <select value={run.manualResult} onChange={(e) => onChange({ manualResult: e.target.value as TestResult })}>
                  {TEST_RESULTS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </p>
          <label className="test-notes-field">
            Notes on {label} (optional)
            <textarea value={run.notes} onChange={(e) => onChange({ notes: e.target.value })} rows={1} />
          </label>
        </div>
      )}
    </section>
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
          ? `Saved ${status.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. `
          : hasDraft
            ? "Picked up where it was left. "
            : "Saved as you fill it in. "}
      {status.kind !== "saving" &&
        "You can leave and continue it from the Platform's Tests tab; nothing counts until it's logged."}
    </p>
  );
}
