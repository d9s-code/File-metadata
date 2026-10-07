import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { AmbiguityFinding, AmbiguityRun, AmbiguityScopeType, AmbiguitySeverity, ToleranceConfig } from "../api/ambiguity";
import {
  useAiStatus,
  useAmbiguityFindings,
  useAmbiguityRun,
  useAmbiguityRuns,
  useCreateAmbiguityRun,
} from "../state/hooks/useAmbiguity";
import { useEmitterVersions } from "../state/hooks/useEmitterVersions";
import { usePlatformVersions } from "../state/hooks/usePlatformVersions";
import { useMdfVersions } from "../state/hooks/useMdfVersions";
import { useEmitter } from "../state/hooks/useEmitters";
import { usePlatform } from "../state/hooks/usePlatforms";
import { useMdf } from "../state/hooks/useMdfs";
import { useAuth } from "../auth/AuthContext";
import { HowItDecides, RunControls } from "../components/ambiguity/CriteriaPanel";
import { AmbiguityMatrix } from "../components/ambiguity/AmbiguityMatrix";
import { FindingList } from "../components/ambiguity/FindingList";
import { FindingDetail } from "../components/ambiguity/FindingDetail";
import { ModesInvolved } from "../components/ambiguity/ModesInvolved";
import { SeverityBadge } from "../components/ambiguity/SeverityBadge";
import { AiRunSummary } from "../components/ambiguity/AiDrafts";
import {
  SEVERITY_ORDER,
  SEVERITY_RANK,
  findingStatus,
  marginsApplied,
  DEFAULT_THRESHOLDS,
  rulesCurrent,
  scopeName,
  type FindingStatus,
} from "../components/ambiguity/ambiguityText";
import { ApiRequestError } from "../api/client";

const RUN_VERSION_FIELD: Record<AmbiguityScopeType, keyof AmbiguityRun> = {
  emitter: "emitter_version_id",
  platform: "platform_version_id",
  mdf: "mdf_version_id",
};
const SCOPE_PATH: Record<AmbiguityScopeType, string> = { emitter: "/emitters", platform: "/platforms", mdf: "/mdfs" };
const STATUS_ORDER: Record<FindingStatus, number> = { open: 0, acknowledged: 1, merged: 2 };
const STATUS_LABEL: Record<FindingStatus, string> = { open: "Open", acknowledged: "Acknowledged", merged: "Merged" };

type View = "findings" | "modes" | "matrix";

function sideMatches(f: AmbiguityFinding, ewGroupId: string, sourceId: string, text: string): boolean {
  const { mode_a: a, mode_b: b } = f.details;
  if (ewGroupId && a.ew_group_id !== ewGroupId && b.ew_group_id !== ewGroupId) return false;
  if (sourceId && a.source_id !== sourceId && b.source_id !== sourceId) return false;
  if (text) {
    const t = text.toLowerCase();
    if (!a.mode_name.toLowerCase().includes(t) && !b.mode_name.toLowerCase().includes(t)) return false;
  }
  return true;
}

/** An ambiguity check of an Emitter, Platform or MDF: how it decides, the
 * findings as a list beside the selected one's detail, and what can be done
 * about each — open, merge or acknowledge. */
export function AmbiguityDashboardPage() {
  const { scopeType: scopeParam, scopeId } = useParams<{ scopeType: AmbiguityScopeType; scopeId: string }>();
  const scopeType = (scopeParam ?? "emitter") as AmbiguityScopeType;
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  // The thresholds the next check runs with: the shown check's, or the defaults.
  const [thresholds, setThresholds] = useState<ToleranceConfig>(DEFAULT_THRESHOLDS);
  const [view, setView] = useState<View>("findings");
  const [status, setStatus] = useState<FindingStatus | "">("");
  const [severity, setSeverity] = useState<AmbiguitySeverity | "">("");
  const [search, setSearch] = useState("");
  const [ewGroup, setEwGroup] = useState("");
  const [source, setSource] = useState("");

  const { user } = useAuth();
  // Set up on the server, and not switched off in the person's settings.
  const aiEnabled = (useAiStatus().data?.enabled ?? false) && (user?.preferences.ai_drafts ?? true);
  const createRun = useCreateAmbiguityRun();
  const { data: run } = useAmbiguityRun(runId);
  const { data: findings } = useAmbiguityFindings(run?.status === "complete" ? runId : null);

  // The scope's name, for the title and the way back.
  const { data: emitter } = useEmitter(scopeType === "emitter" ? scopeId : undefined);
  const { data: platform } = usePlatform(scopeType === "platform" ? scopeId : undefined);
  const { data: mdf } = useMdf(scopeType === "mdf" ? scopeId : undefined);
  const name = (emitter ?? platform ?? mdf)?.name;

  // Open on the latest finished check for this scope, if there is one.
  const { data: priorRuns, isLoading: runsLoading } = useAmbiguityRuns(scopeType, scopeId as string);
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current || runId !== null || !priorRuns) return;
    autoSelected.current = true;
    const latest = priorRuns.find((r) => r.status === "complete");
    if (latest) {
      setRunId(latest.id);
      const t = latest.tolerance_config;
      setThresholds({ low_threshold: t.low_threshold, high_threshold: t.high_threshold, exact_threshold: t.exact_threshold });
    }
  }, [priorRuns, runId]);

  // Is the check still current, or has the scope been saved again since?
  const { data: emitterVersions } = useEmitterVersions(scopeType === "emitter" ? (scopeId as string) : "");
  const { data: platformVersions } = usePlatformVersions(scopeType === "platform" ? (scopeId as string) : "");
  const { data: mdfVersions } = useMdfVersions(scopeType === "mdf" ? (scopeId as string) : "");
  const versions = emitterVersions ?? platformVersions ?? mdfVersions;
  const latestVersion = useMemo(
    () => (versions?.length ? versions.reduce((m, v) => (v.version_number > m.version_number ? v : m), versions[0]) : null),
    [versions],
  );
  const runVersionId = run ? (run[RUN_VERSION_FIELD[scopeType]] as string | null) : null;
  const runVersion = versions?.find((v) => v.id === runVersionId) ?? null;
  const isStale = run?.status === "complete" && !!latestVersion && runVersionId !== latestVersion.id;

  const all = useMemo(() => findings ?? [], [findings]);
  const goneModeIds = useMemo(
    () => new Set(all.flatMap((f) => (f.resolution ? [f.resolution.removed_mode_id] : []))),
    [all],
  );
  const options = useMemo(() => {
    const groups = new Map<string, string>();
    const sources = new Map<string, string>();
    for (const f of all) {
      for (const s of [f.details.mode_a, f.details.mode_b]) {
        groups.set(s.ew_group_id, s.ew_group_name);
        sources.set(s.source_id, s.source_name);
      }
    }
    const sorted = (m: Map<string, string>) => [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    return { groups: sorted(groups), sources: sorted(sources) };
  }, [all]);

  // Filters other than status and severity — the counts on those chips follow them.
  const scoped = useMemo(() => all.filter((f) => sideMatches(f, ewGroup, source, search.trim())), [all, ewGroup, source, search]);
  const counts = useMemo(() => {
    const byStatus: Record<FindingStatus, number> = { open: 0, acknowledged: 0, merged: 0 };
    const bySeverity: Record<AmbiguitySeverity, number> = { exact_overlap: 0, high: 0, medium: 0, low: 0, none: 0 };
    for (const f of scoped) {
      byStatus[findingStatus(f)] += 1;
      if (!status || findingStatus(f) === status) bySeverity[f.combined_severity] += 1;
    }
    return { byStatus, bySeverity };
  }, [scoped, status]);
  const shown = useMemo(
    () =>
      scoped
        .filter((f) => (!status || findingStatus(f) === status) && (!severity || f.combined_severity === severity))
        .sort(
          (a, b) =>
            STATUS_ORDER[findingStatus(a)] - STATUS_ORDER[findingStatus(b)] ||
            SEVERITY_RANK[a.combined_severity] - SEVERITY_RANK[b.combined_severity] ||
            a.details.mode_a.mode_name.localeCompare(b.details.mode_a.mode_name) ||
            a.details.mode_b.mode_name.localeCompare(b.details.mode_b.mode_name),
        ),
    [scoped, status, severity],
  );

  // Keep a finding selected: the first shown, unless the selected one still is.
  useEffect(() => {
    if (view !== "findings") return;
    if (!shown.some((f) => f.id === selectedId)) setSelectedId(shown[0]?.id ?? null);
  }, [shown, selectedId, view]);
  const selected = all.find((f) => f.id === selectedId) ?? null;

  // From the AI overview's table: open that finding, clearing any filter
  // that would hide it.
  function openFinding(id: string) {
    if (!shown.some((f) => f.id === id)) {
      setStatus("");
      setSeverity("");
      setSearch("");
      setEwGroup("");
      setSource("");
    }
    setView("findings");
    setSelectedId(id);
    requestAnimationFrame(() => document.querySelector(".finding-detail")?.scrollIntoView({ block: "nearest" }));
  }

  async function handleRun(tolerance: ToleranceConfig) {
    setError(null);
    setSelectedId(null);
    try {
      const created = await createRun.mutateAsync({ scope_type: scopeType, scope_id: scopeId as string, tolerance_config: tolerance });
      setRunId(created.id);
      setCriteriaOpen(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't start the check");
    }
  }

  const running = createRun.isPending || run?.status === "pending";
  const showEmitter = scopeType !== "emitter";
  const filtered = !!(search || ewGroup || source);

  return (
    <div className="page ambiguity-page">
      <div className="amb-header">
        <Link to={`${SCOPE_PATH[scopeType]}/${scopeId}`} className="amb-back">
          ← {scopeName(scopeType)}
          {name ? `: ${name}` : ""}
        </Link>
        <h1>Ambiguity check{name ? ` — ${name}` : ""}</h1>
      </div>

      <div className="card amb-runbar">
        <div className="amb-runbar-row">
          <div className="amb-runbar-text">
            {running ? (
              <span>Checking…</span>
            ) : run?.status === "complete" ? (
              <>
                <span>
                  Checked {runVersion ? `version ${runVersion.version_number}` : "the saved version"} ·{" "}
                  {new Date(run.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  {run.created_by && run.created_by === user?.id ? " by you" : ""}
                  <span
                    className="hint-text"
                    title={`Thresholds ${run.tolerance_config.low_threshold} / ${run.tolerance_config.high_threshold} / ${run.tolerance_config.exact_threshold}%`}
                  >
                    {" "}
                    · {marginsApplied(run) ? "with margins" : "ranges as typed"}
                  </span>
                </span>
                {isStale && (
                  <span className="amb-stale">
                    {scopeName(scopeType)} saved again since (now version {latestVersion?.version_number}) — run the check again for current results.
                  </span>
                )}
                {!rulesCurrent(run) && (
                  <span className="amb-stale">
                    This check used older rules
                    {marginsApplied(run) ? "" : " (without margins)"} — before PRI type, jitter and frame-time matching counted.
                    Run it again for the current rules.
                  </span>
                )}
              </>
            ) : run?.status === "failed" ? (
              <span className="error-text">The check failed: {run.error_message}</span>
            ) : runsLoading ? (
              <span className="hint-text">Loading…</span>
            ) : (
              <span>Not checked yet. The check compares every pair of Modes and flags the ones the sensor could confuse.</span>
            )}
          </div>
          <div className="amb-runbar-actions">
            <RunControls
              thresholds={thresholds}
              onThresholds={setThresholds}
              onRun={handleRun}
              running={!!running}
              hasRun={!!run}
            />
            <button type="button" className="link-button" aria-expanded={criteriaOpen} onClick={() => setCriteriaOpen((o) => !o)}>
              {criteriaOpen ? "Hide how it decides" : "How it decides"}
            </button>
          </div>
        </div>
        {criteriaOpen && <HowItDecides thresholds={thresholds} />}
        {error && <div className="error-text">{error}</div>}
      </div>

      {run?.status === "complete" && findings && (
        <>
          {all.length === 0 ? (
            <div className="card">
              <p>No pair of Modes overlaps on every parameter — nothing could be confused.</p>
            </div>
          ) : (
            <>
              <div className="amb-chips" role="group" aria-label="Filter findings">
                <span className="amb-chip-group">
                  <button type="button" className={!status ? "amb-chip on" : "amb-chip"} onClick={() => setStatus("")}>
                    All <strong>{scoped.length}</strong>
                  </button>
                  {(["open", "acknowledged", "merged"] as const).map((s) => (
                    <button
                      type="button"
                      key={s}
                      className={status === s ? "amb-chip on" : "amb-chip"}
                      onClick={() => setStatus(status === s ? "" : s)}
                      disabled={!counts.byStatus[s] && status !== s}
                    >
                      {STATUS_LABEL[s]} <strong>{counts.byStatus[s]}</strong>
                    </button>
                  ))}
                </span>
                <span className="amb-chip-group">
                  {SEVERITY_ORDER.map((s) => (
                    <button
                      type="button"
                      key={s}
                      className={severity === s ? "amb-chip on" : "amb-chip"}
                      onClick={() => setSeverity(severity === s ? "" : s)}
                      disabled={!counts.bySeverity[s] && severity !== s}
                    >
                      <SeverityBadge severity={s} /> <strong>{counts.bySeverity[s]}</strong>
                    </button>
                  ))}
                </span>
              </div>

              {aiEnabled && <AiRunSummary run={run} onSelectFinding={openFinding} />}

              <div className="amb-toolbar">
                <span className="amb-views" role="tablist">
                  {(
                    [
                      ["findings", "Findings"],
                      ["modes", "Modes involved"],
                      ["matrix", "Matrix"],
                    ] as const
                  ).map(([v, label]) => (
                    <button type="button" role="tab" aria-selected={view === v} key={v} className={view === v ? "on" : undefined} onClick={() => setView(v)}>
                      {label}
                    </button>
                  ))}
                </span>
                <input
                  type="search"
                  placeholder="Find a Mode…"
                  aria-label="Find a Mode"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {options.groups.length > 1 && (
                  <select value={ewGroup} onChange={(e) => setEwGroup(e.target.value)} aria-label="EW Group">
                    <option value="">All EW Groups</option>
                    {options.groups.map(([id, n]) => (
                      <option key={id} value={id}>
                        {n}
                      </option>
                    ))}
                  </select>
                )}
                {options.sources.length > 1 && (
                  <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
                    <option value="">All Sources</option>
                    {options.sources.map(([id, n]) => (
                      <option key={id} value={id}>
                        {n}
                      </option>
                    ))}
                  </select>
                )}
                {filtered && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setSearch("");
                      setEwGroup("");
                      setSource("");
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>

              {view === "findings" && (
                <div className="amb-split">
                  <div className="card amb-list-card">
                    <div className="amb-list-head hint-text">
                      {shown.length} finding{shown.length === 1 ? "" : "s"} · open first, worst first · ↑↓ to move
                    </div>
                    <FindingList
                      findings={shown}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      showEmitter={showEmitter}
                      goneModeIds={goneModeIds}
                    />
                  </div>
                  <aside className="card amb-detail">
                    {selected ? (
                      <FindingDetail
                        finding={selected}
                        runId={runId as string}
                        aiEnabled={aiEnabled}
                        marginsApplied={marginsApplied(run)}
                        goneModeIds={goneModeIds}
                      />
                    ) : (
                      <p className="hint-text">Select a finding to see how the two Modes overlap and what can be done.</p>
                    )}
                  </aside>
                </div>
              )}

              {view === "modes" && (
                <div className="card">
                  <p className="hint-text">
                    Modes in the most findings, worst first — changing one of these can clear many findings at once. Click
                    one to see its findings.
                  </p>
                  <ModesInvolved
                    findings={shown}
                    showEmitter={showEmitter}
                    onPick={(modeName) => {
                      setSearch(modeName);
                      setView("findings");
                    }}
                  />
                </div>
              )}

              {view === "matrix" && (
                <div className="card">
                  <p className="hint-text">
                    Every Mode in a finding against every other, coloured by severity. Click a cell to open that finding.
                  </p>
                  <AmbiguityMatrix
                    findings={shown}
                    selectedId={selectedId}
                    onSelectFinding={(id) => {
                      setSelectedId(id);
                      setView("findings");
                    }}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
