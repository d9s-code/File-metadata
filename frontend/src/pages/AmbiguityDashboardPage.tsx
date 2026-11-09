import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { BackLink } from "../components/common/BackLink";
import { formatDateTime } from "../components/common/dates";
import { useParams } from "react-router-dom";
import type {
  AmbiguityFinding,
  AmbiguityRun,
  AmbiguityScopeType,
  AmbiguitySeverity,
  FindingModeSide,
  OverlapParam,
  ToleranceConfig,
} from "../api/ambiguity";
import { modesApi } from "../api/modes";
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
import { useCheckouts } from "../state/hooks/useEmitterCheckout";
import { emitterModesKey } from "../state/hooks/useModes";
import { useAuth } from "../auth/AuthContext";
import { HowItDecides, RunControls } from "../components/ambiguity/CriteriaPanel";
import { AmbiguityMatrix } from "../components/ambiguity/AmbiguityMatrix";
import { FindingList } from "../components/ambiguity/FindingList";
import { FindingDetail } from "../components/ambiguity/FindingDetail";
import { GroupList, SeverityBar } from "../components/ambiguity/GroupList";
import { GroupChart } from "../components/ambiguity/GroupChart";
import { SeverityBadge } from "../components/ambiguity/SeverityBadge";
import { AiRunSummary } from "../components/ambiguity/AiDrafts";
import { EditModeControls } from "../components/versioning/EditModeControls";
import { comparedParams, emitterPairGroups, modeChange, modeGroups, type FindingGroup } from "../components/ambiguity/ambiguityAnalysis";
import {
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  SEVERITY_RANK,
  findingStatus,
  marginsApplied,
  DEFAULT_THRESHOLDS,
  rulesCurrent,
  scopeName,
} from "../components/ambiguity/ambiguityText";
import { ApiRequestError } from "../api/client";
import { useSessionState } from "../components/common/useSessionState";

const RUN_VERSION_FIELD: Record<AmbiguityScopeType, keyof AmbiguityRun> = {
  emitter: "emitter_version_id",
  platform: "platform_version_id",
  mdf: "mdf_version_id",
};
const SCOPE_PATH: Record<AmbiguityScopeType, string> = { emitter: "/emitters", platform: "/platforms", mdf: "/mdfs" };
const STATUS_ORDER = { open: 0, acknowledged: 1, merged: 2 } as const;

type Show = "open" | "all" | "handled";
type GroupBy = "modes" | "emitters";

function sideSourceIds(side: FindingModeSide): string[] {
  return side.source_ids?.length ? side.source_ids : [side.source_id];
}

function sideMatches(f: AmbiguityFinding, ewGroupId: string, sourceId: string, text: string): boolean {
  const { mode_a: a, mode_b: b } = f.details;
  if (ewGroupId && a.ew_group_id !== ewGroupId && b.ew_group_id !== ewGroupId) return false;
  if (sourceId && !sideSourceIds(a).includes(sourceId) && !sideSourceIds(b).includes(sourceId)) return false;
  if (text) {
    const t = text.toLowerCase();
    if (!a.mode_name.toLowerCase().includes(t) && !b.mode_name.toLowerCase().includes(t)) return false;
  }
  return true;
}

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/** Your edit controls for one Emitter: Start editing, or Save version /
 * checkpoint / Discard while you hold it — so a fix is saved from here. */
function EditStripRow({ emitterId }: { emitterId: string }) {
  const { data: emitter } = useEmitter(emitterId);
  if (!emitter) return null;
  return (
    <div className="amb-edit-row">
      <span className="amb-edit-name">{emitter.name}</span>
      <EditModeControls emitter={emitter} />
    </div>
  );
}

/** An ambiguity check of an Emitter, Platform or MDF, on one screen: the
 * totals, the groups of Modes that overlap each other, the selected group's
 * Modes drawn on the parameter that decides it with its pairs below, and the
 * selected pair — what tells them apart and what to change — beside it. */
export function AmbiguityDashboardPage() {
  const { scopeType: scopeParam, scopeId = "" } = useParams<{ scopeType: AmbiguityScopeType; scopeId: string }>();
  const scopeType = (scopeParam ?? "emitter") as AmbiguityScopeType;
  const showEmitter = scopeType !== "emitter";
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"criteria" | "ai" | null>(null);
  const [thresholds, setThresholds] = useState<ToleranceConfig>(DEFAULT_THRESHOLDS);
  const [show, setShow] = useState<Show>("open");
  const [severity, setSeverity] = useState<AmbiguitySeverity | "">("");
  const [search, setSearch] = useSessionState("ambiguity.search", "");
  const [ewGroup, setEwGroup] = useState("");
  const [source, setSource] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>(showEmitter ? "emitters" : "modes");
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [focusModeId, setFocusModeId] = useState<string | null>(null);
  const [chartParam, setChartParam] = useState<OverlapParam | null>(null);
  const [middle, setMiddle] = useState<"pairs" | "matrix">("pairs");

  const { user } = useAuth();
  const aiEnabled = (useAiStatus().data?.enabled ?? false) && (user?.preferences.ai_drafts ?? true);
  const createRun = useCreateAmbiguityRun();
  const { data: run } = useAmbiguityRun(runId);
  const { data: findings } = useAmbiguityFindings(run?.status === "complete" ? runId : null);

  const { data: emitter } = useEmitter(scopeType === "emitter" ? scopeId : undefined);
  const { data: platform } = usePlatform(scopeType === "platform" ? scopeId : undefined);
  const { data: mdf } = useMdf(scopeType === "mdf" ? scopeId : undefined);
  const name = (emitter ?? platform ?? mdf)?.name;

  // Open on the latest finished check for this scope, if there is one.
  const { data: priorRuns, isLoading: runsLoading } = useAmbiguityRuns(scopeType, scopeId);
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
  const { data: emitterVersions } = useEmitterVersions(scopeType === "emitter" ? scopeId : "");
  const { data: platformVersions } = usePlatformVersions(scopeType === "platform" ? scopeId : "");
  const { data: mdfVersions } = useMdfVersions(scopeType === "mdf" ? scopeId : "");
  const versions = emitterVersions ?? platformVersions ?? mdfVersions;
  const latestVersion = useMemo(
    () => (versions?.length ? versions.reduce((m, v) => (v.version_number > m.version_number ? v : m), versions[0]) : null),
    [versions],
  );
  const runVersionId = run ? (run[RUN_VERSION_FIELD[scopeType]] as string | null) : null;
  const runVersion = versions?.find((v) => v.id === runVersionId) ?? null;
  const isStale = run?.status === "complete" && !!latestVersion && runVersionId !== latestVersion.id;

  // A Platform or MDF check is about telling Emitters apart: overlaps inside
  // one Emitter (which checks from before that change still hold) are left out.
  const all = useMemo(
    () => (findings ?? []).filter((f) => !showEmitter || f.details.mode_a.emitter_id !== f.details.mode_b.emitter_id),
    [findings, showEmitter],
  );
  const goneModeIds = useMemo(() => new Set(all.flatMap((f) => (f.resolution ? [f.resolution.removed_mode_id] : []))), [all]);

  // The Modes as they are now, to mark the ones changed since the check.
  const emitterIds = useMemo(
    () => [...new Set(all.flatMap((f) => [f.details.mode_a.emitter_id, f.details.mode_b.emitter_id]))],
    [all],
  );
  const liveQueries = useQueries({
    queries: emitterIds.map((id) => ({ queryKey: emitterModesKey(id), queryFn: () => modesApi.listByEmitter(id) })),
  });
  const liveByEmitter = new Map(emitterIds.map((id, i) => [id, liveQueries[i]?.data]));
  const liveKey = liveQueries.map((q) => q.dataUpdatedAt).join(",");
  const changed = useMemo(() => {
    const out = new Map<string, "changed" | "gone">();
    for (const f of all) {
      for (const [id, side] of [
        [f.mode_id_a, f.details.mode_a],
        [f.mode_id_b, f.details.mode_b],
      ] as const) {
        if (out.has(id)) continue;
        const live = liveByEmitter.get(side.emitter_id) as { id: string; pri_type: string; line: Record<string, unknown> | null }[] | undefined;
        const c = modeChange(side, live, id);
        if (c) out.set(id, c);
      }
    }
    return out;
    // liveKey stands for the live Modes' contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, liveKey]);

  const options = useMemo(() => {
    const groups = new Map<string, string>();
    const sources = new Map<string, string>();
    for (const f of all) {
      for (const s of [f.details.mode_a, f.details.mode_b]) {
        groups.set(s.ew_group_id, s.ew_group_name);
        sideSourceIds(s).forEach((id, i) => sources.set(id, s.source_names?.[i] ?? s.source_name));
      }
    }
    const sorted = (m: Map<string, string>) => [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    return { groups: sorted(groups), sources: sorted(sources) };
  }, [all]);

  const totals = useMemo(() => {
    const bySeverity: Record<AmbiguitySeverity, number> = { exact_overlap: 0, high: 0, medium: 0, low: 0, none: 0 };
    const modes = new Set<string>();
    let open = 0;
    for (const f of all) {
      if (findingStatus(f) !== "open") continue;
      open += 1;
      bySeverity[f.combined_severity] += 1;
      modes.add(f.mode_id_a).add(f.mode_id_b);
    }
    return { open, bySeverity, modes: modes.size, handled: all.length - open };
  }, [all]);

  // If nothing is open, show everything rather than an empty page.
  const effectiveShow: Show = show === "open" && totals.open === 0 && all.length > 0 ? "all" : show;
  const filtered = useMemo(
    () =>
      all.filter(
        (f) =>
          (effectiveShow === "all" || (effectiveShow === "open") === (findingStatus(f) === "open")) &&
          (!severity || f.combined_severity === severity) &&
          sideMatches(f, ewGroup, source, search.trim()),
      ),
    [all, effectiveShow, severity, ewGroup, source, search],
  );
  const groups: FindingGroup[] = useMemo(
    () => (groupBy === "emitters" ? emitterPairGroups(filtered) : modeGroups(filtered)),
    [filtered, groupBy],
  );
  const group = groups.find((g) => g.key === groupKey) ?? null;
  useEffect(() => {
    if (groupKey && !group) setGroupKey(null);
  }, [groupKey, group]);

  const inGroup = group ? group.findings : filtered;
  const shown = useMemo(
    () =>
      inGroup
        .filter((f) => !focusModeId || f.mode_id_a === focusModeId || f.mode_id_b === focusModeId)
        .sort(
          (a, b) =>
            STATUS_ORDER[findingStatus(a)] - STATUS_ORDER[findingStatus(b)] ||
            SEVERITY_RANK[a.combined_severity] - SEVERITY_RANK[b.combined_severity] ||
            a.details.mode_a.mode_name.localeCompare(b.details.mode_a.mode_name, undefined, { numeric: true }) ||
            a.details.mode_b.mode_name.localeCompare(b.details.mode_b.mode_name, undefined, { numeric: true }),
        ),
    [inGroup, focusModeId],
  );

  // Keep a pair selected: the first shown, unless the selected one still is.
  useEffect(() => {
    if (!shown.some((f) => f.id === selectedId)) setSelectedId(shown[0]?.id ?? null);
  }, [shown, selectedId]);
  const selected = all.find((f) => f.id === selectedId) ?? null;

  // The chart: the group's Modes (or every Mode) on the parameter that decides most.
  const chartGroup = group ?? modeGroups(filtered)[0] ?? null;
  const chartModes = useMemo(() => {
    if (group) return group.modes;
    // Every pair: every Mode in one.
    return modeGroups(filtered).flatMap((g) => g.modes);
  }, [group, filtered]);
  const chartParams = useMemo(() => {
    const ps = new Set<OverlapParam>();
    for (const f of inGroup) comparedParams(f).forEach((p) => ps.add(p));
    return (["rf", "pri", "pw", "jitter"] as OverlapParam[]).filter((p) => ps.has(p));
  }, [inGroup]);
  const param: OverlapParam =
    chartParam && chartParams.includes(chartParam) ? chartParam : (group?.deciding ?? chartGroup?.deciding ?? chartParams[0] ?? "rf");

  function openFinding(id: string) {
    setShow("all");
    setSeverity("");
    setSearch("");
    setEwGroup("");
    setSource("");
    setGroupKey(null);
    setFocusModeId(null);
    setSelectedId(id);
  }

  // ↑↓ through the pairs, ←→ through the groups.
  const keys = useRef({ shown, groups, selectedId, groupKey });
  keys.current = { shown, groups, selectedId, groupKey };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (typing(e.target) || e.altKey || e.ctrlKey || e.metaKey || document.querySelector(".modal-overlay")) return;
      const k = keys.current;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const i = k.shown.findIndex((f) => f.id === k.selectedId);
        const next = e.key === "ArrowDown" ? Math.min(k.shown.length - 1, i + 1) : Math.max(0, i - 1);
        if (k.shown[next]) {
          e.preventDefault();
          setSelectedId(k.shown[next].id);
        }
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const order = [null, ...k.groups.map((g) => g.key)];
        const i = order.indexOf(k.groupKey);
        const next = order[e.key === "ArrowRight" ? Math.min(order.length - 1, i + 1) : Math.max(0, i - 1)];
        e.preventDefault();
        setGroupKey(next);
        setFocusModeId(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function handleRun(tolerance: ToleranceConfig) {
    setError(null);
    setSelectedId(null);
    try {
      const created = await createRun.mutateAsync({ scope_type: scopeType, scope_id: scopeId, tolerance_config: tolerance });
      setRunId(created.id);
      setPanel(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't start the check");
    }
  }

  // The Emitters you're editing among these (and this one, on an Emitter's check).
  const { data: checkouts } = useCheckouts(!!user);
  const editing = useMemo(() => {
    const mine = new Set((checkouts ?? []).filter((c) => c.checked_out_by_id === user?.id).map((c) => c.emitter_id));
    const ids = scopeType === "emitter" ? [scopeId] : emitterIds.filter((id) => mine.has(id));
    return ids;
  }, [checkouts, user?.id, scopeType, scopeId, emitterIds]);
  const isEditor = user?.role === "editor" || user?.role === "admin";

  const running = createRun.isPending || run?.status === "pending";
  const filtering = !!(search || ewGroup || source || severity);
  const changedCount = changed.size;

  return (
    <div className="page ambiguity-page">
      <div className="amb-header">
        <BackLink to={`${SCOPE_PATH[scopeType]}/${scopeId}`}>{name || scopeName(scopeType)}</BackLink>
        <h1>Ambiguity check{name ? ` — ${name}` : ""}</h1>
      </div>

      <div className="card amb-summary">
        <div className="amb-summary-top">
          <div className="amb-runbar-text">
            {running ? (
              <span>Checking…</span>
            ) : run?.status === "complete" ? (
              <span>
                Checked {runVersion ? `version ${runVersion.version_number}` : "the saved version"} · {formatDateTime(run.created_at)}
                {run.created_by && run.created_by === user?.id ? " by you" : ""}
                <span className="hint-text"> · {marginsApplied(run) ? "with deltas" : "ranges as typed"}</span>
              </span>
            ) : run?.status === "failed" ? (
              <span className="error-text">The check failed: {run.error_message}</span>
            ) : runsLoading ? (
              <span className="hint-text">Loading…</span>
            ) : (
              <span>
                Not checked yet{" "}
                <span className="hint-text">
                  {showEmitter
                    ? "— finds which Emitters the sensor could take for each other, comparing each Emitter's Modes with the other Emitters'."
                    : "— finds pairs of Modes the sensor could confuse."}
                </span>
              </span>
            )}
          </div>
          <div className="amb-runbar-actions">
            <RunControls thresholds={thresholds} onThresholds={setThresholds} onRun={handleRun} running={!!running} hasRun={!!run} />
            <button type="button" className="link-button" aria-expanded={panel === "criteria"} onClick={() => setPanel(panel === "criteria" ? null : "criteria")}>
              How it decides
            </button>
            {aiEnabled && run?.status === "complete" && all.length > 0 && (
              <button type="button" className="link-button" aria-expanded={panel === "ai"} onClick={() => setPanel(panel === "ai" ? null : "ai")}>
                ✦ AI overview{run.ai_summary ? "" : "…"}
              </button>
            )}
          </div>
        </div>

        {(isStale || (run?.status === "complete" && !rulesCurrent(run)) || changedCount > 0) && (
          <div className="amb-notices">
            {isStale && (
              <span className="amb-stale">
                {scopeName(scopeType)} saved again since (now version {latestVersion?.version_number}) — run the check again for
                current results.
              </span>
            )}
            {run?.status === "complete" && !rulesCurrent(run) && (
              <span className="amb-stale">This check used older rules — run it again for the current ones.</span>
            )}
            {changedCount > 0 && !isStale && (
              <span className="amb-stale">
                {changedCount} Mode{changedCount === 1 ? "" : "s"} changed since this check (marked ●) — save a version
                {showEmitter ? ", pin it," : ""} then run the check again to see the effect.
              </span>
            )}
          </div>
        )}

        {run?.status === "complete" && all.length > 0 && (
          <div className="amb-figures">
            <div className="amb-figure">
              <span className="readout-label">Open pairs</span>
              <b className="readout-value">{totals.open}</b>
              <span className="hint-text">{totals.handled ? `${totals.handled} handled` : "none handled yet"}</span>
            </div>
            <div className="amb-figure">
              <span className="readout-label">Modes involved</span>
              <b className="readout-value">{totals.modes}</b>
              <span className="hint-text">in open pairs</span>
            </div>
            <div className="amb-figure">
              <span className="readout-label">{groupBy === "emitters" ? "Emitter pairs" : "Groups"}</span>
              <b className="readout-value">{groups.length}</b>
              <span className="hint-text">{groupBy === "emitters" ? "that could be confused" : "of Modes overlapping each other"}</span>
            </div>
            <div className="amb-figure amb-figure-wide">
              <span className="readout-label">Open by severity</span>
              <SeverityBar counts={totals.bySeverity} total={totals.open} />
              <span className="amb-sev-legend">
                {SEVERITY_ORDER.map((s) => (
                  <button
                    type="button"
                    key={s}
                    className={severity === s ? "amb-chip on" : "amb-chip"}
                    disabled={!totals.bySeverity[s] && severity !== s}
                    onClick={() => setSeverity(severity === s ? "" : s)}
                    title={`Only ${SEVERITY_LABEL[s]}`}
                  >
                    <i className={`sev-dot sev-${s}`} />
                    {SEVERITY_LABEL[s]} <strong>{totals.bySeverity[s]}</strong>
                  </button>
                ))}
              </span>
            </div>
          </div>
        )}

        {isEditor && editing.length > 0 && (
          <div className="amb-edit-strip">
            {editing.map((id) => (
              <EditStripRow key={id} emitterId={id} />
            ))}
          </div>
        )}
        {panel === "criteria" && <HowItDecides thresholds={thresholds} />}
        {error && <div className="error-text">{error}</div>}
      </div>

      {panel === "ai" && run && <AiRunSummary run={run} onSelectFinding={openFinding} />}

      {run?.status === "complete" && findings && all.length === 0 && (
        <div className="card">
          <p>
            {showEmitter
              ? "No two Emitters have Modes that overlap on every parameter — none could be taken for another. Overlaps inside a single Emitter aren't part of this check; run the Emitter's own check for those."
              : "No pair of Modes overlaps on every parameter — nothing could be confused."}
          </p>
        </div>
      )}

      {run?.status === "complete" && all.length > 0 && (
        <>
          <div className="amb-toolbar" role="group" aria-label="Filter pairs">
            <span className="seg-toggle" role="group" aria-label="Show">
              {(
                [
                  ["open", `Open ${totals.open}`],
                  ["handled", `Handled ${totals.handled}`],
                  ["all", `All ${all.length}`],
                ] as const
              ).map(([v, label]) => (
                <button type="button" key={v} className={effectiveShow === v ? "on" : undefined} onClick={() => setShow(v)}>
                  {label}
                </button>
              ))}
            </span>
            <input type="search" placeholder="Find a Mode…" aria-label="Find a Mode" value={search} onChange={(e) => setSearch(e.target.value)} />
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
            {filtering && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setSearch("");
                  setEwGroup("");
                  setSource("");
                  setSeverity("");
                }}
              >
                Clear filters
              </button>
            )}
            {showEmitter && (
              <label className="amb-groupby">
                <span className="hint-text">Group by</span>
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                  <option value="emitters">Pair of Emitters</option>
                  <option value="modes">Modes overlapping each other</option>
                </select>
              </label>
            )}
            <span className="hint-text amb-keys">↑↓ pairs · ←→ groups</span>
          </div>

          <div className="amb-workspace">
            <aside className="card amb-groups">
              <GroupList
                groups={groups}
                total={filtered.length}
                totalOpen={filtered.filter((f) => findingStatus(f) === "open").length}
                selectedKey={group?.key ?? null}
                onSelect={(k) => {
                  setGroupKey(k);
                  setFocusModeId(null);
                }}
              />
            </aside>

            <section className="card amb-middle">
              <div className="amb-middle-head">
                <h2 className="as-h4">
                  {group ? group.label : "Every pair"}
                  {group && <SeverityBadge severity={group.worst} />}
                </h2>
                <span className="seg-toggle" role="group" aria-label="View">
                  <button type="button" className={middle === "pairs" ? "on" : undefined} onClick={() => setMiddle("pairs")}>
                    Chart &amp; pairs
                  </button>
                  <button type="button" className={middle === "matrix" ? "on" : undefined} onClick={() => setMiddle("matrix")}>
                    Matrix
                  </button>
                </span>
              </div>
              {middle === "pairs" ? (
                <>
                  {chartModes.length > 0 && chartModes.length <= 60 ? (
                    <GroupChart
                      modes={chartModes}
                      param={param}
                      params={chartParams}
                      onParam={setChartParam}
                      selected={selected}
                      focusModeId={focusModeId}
                      onFocusMode={setFocusModeId}
                      showEmitter={showEmitter}
                      changed={changed}
                    />
                  ) : (
                    chartModes.length > 60 && <p className="hint-text">Pick a group to draw its Modes.</p>
                  )}
                  <div className="amb-pairs-head">
                    <span className="readout-label">
                      {shown.length} pair{shown.length === 1 ? "" : "s"}
                      {focusModeId && ` with ${chartModes.find((m) => m.id === focusModeId)?.name ?? "this Mode"}`}
                    </span>
                    {focusModeId && (
                      <button type="button" className="link-button" onClick={() => setFocusModeId(null)}>
                        Every Mode
                      </button>
                    )}
                  </div>
                  <FindingList
                    findings={shown}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    showEmitter={showEmitter}
                    goneModeIds={goneModeIds}
                    changed={changed}
                  />
                </>
              ) : (
                <AmbiguityMatrix findings={shown} selectedId={selectedId} onSelectFinding={setSelectedId} showEmitter={showEmitter} />
              )}
            </section>

            <aside className="card amb-detail">
              {selected ? (
                <FindingDetail
                  key={selected.id}
                  finding={selected}
                  runId={runId as string}
                  aiEnabled={aiEnabled}
                  marginsApplied={marginsApplied(run)}
                  goneModeIds={goneModeIds}
                  change={{ a: changed.get(selected.mode_id_a) ?? null, b: changed.get(selected.mode_id_b) ?? null }}
                  liveLines={{
                    a: liveByEmitter.get(selected.details.mode_a.emitter_id)?.find((m) => m.id === selected.mode_id_a)?.line as
                      | Record<string, unknown>
                      | undefined,
                    b: liveByEmitter.get(selected.details.mode_b.emitter_id)?.find((m) => m.id === selected.mode_id_b)?.line as
                      | Record<string, unknown>
                      | undefined,
                  }}
                />
              ) : (
                <p className="hint-text">No pair matches these filters.</p>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
