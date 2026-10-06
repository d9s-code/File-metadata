import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEmitter } from "../state/hooks/useEmitters";
import { useApplyInterceptModePlan, useEmitterModes } from "../state/hooks/useModes";
import { useIntercept, useInterceptEntries } from "../state/hooks/useIntercepts";
import { useEwGroups } from "../state/hooks/useEwGroups";
import { useSources } from "../state/hooks/useSources";
import { useFunctionGroups } from "../state/hooks/useFunctionGroups";
import { useEmitterCheckoutState } from "../state/hooks/useEmitterCheckout";
import { useHasRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { interceptsApi, type AllReports } from "../api/intercepts";
import type { InterceptModePlanInput, InterceptModePlanResult } from "../api/modes";
import { LoadingState } from "../components/common/LoadingState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { EntryMatchCell } from "../components/intercepts/EntryMatchCell";
import { matchEntry, type EntryMatch, type MatchParam } from "../components/intercepts/interceptMatch";
import {
  applyChange,
  coveredShare,
  describeRange,
  entryRanges,
  lineCoverage,
  mergeChanges,
  newModeLine,
  widenChange,
  widenOptions,
  type Coverage,
  type EntryReports,
  type PlanSettings,
  type Range,
  type RangeBasis,
  type WidenChange,
  type WidenOption,
} from "../components/intercepts/modePlan";
import type { InterceptEntry, ModeLineFields } from "../types/domain";

const TYPE_LABEL: Record<string, string> = { fixed: "Fixed", stagger: "Stagger", cw: "CW" };
const TYPE_ORDER: Record<string, number> = { fixed: 0, stagger: 1, cw: 2 };
// New Modes per plan — matches the backend's MAX_MODES_FROM_INTERCEPT.
const MAX_NEW_MODES = 1000;
const PARAM_KEY: Record<MatchParam, "rf" | "pri" | "pw"> = { RF: "rf", PRI: "pri", PW: "pw" };

type Action = { kind: "new" } | { kind: "widen"; modeId: string } | { kind: "skip" };

/** One entry's own ± margins for its new Mode, as typed; empty uses the page's. */
type RowDeltas = Partial<Record<"rf" | "pri" | "frame" | "pw", string>>;

/** Each entry's reports, from the all-reports listing: sorted values for
 * percentiles, and each report's values for coverage. */
function reportsByEntry(all: AllReports): Map<string, EntryReports> {
  const at = (name: string) => all.fields.indexOf(name) + 2;
  const f = { rf: at("rf_mhz"), pri: at("pri_us"), pw: at("pw_us"), jitter: at("jitter_us"), stagger: at("stagger_us") };
  const out = new Map<string, EntryReports>();
  for (const row of all.reports) {
    const index = row[1] as number | null;
    if (index == null) continue;
    const id = all.entries[index];
    let e = out.get(id);
    if (!e) {
      e = { rf: [], pri: [], pw: [], jitter: [], points: [] };
      out.set(id, e);
    }
    const rf = row[f.rf] as number;
    const pri = row[f.pri] as number | null;
    const pw = row[f.pw] as number | null;
    const jitter = row[f.jitter] as number | null;
    const stagger = row[f.stagger] as number[] | null;
    e.rf.push(rf);
    if (pri != null) e.pri.push(pri);
    if (pw != null) e.pw.push(pw);
    if (jitter != null) e.jitter.push(jitter);
    e.points.push({ rf, pri, pw, positions: stagger?.length ?? 0 });
  }
  for (const e of out.values()) for (const k of ["rf", "pri", "pw", "jitter"] as const) e[k].sort((a, b) => a - b);
  return out;
}

const num = (v: string, fallback = 0) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : fallback;
};
const pct = (share: number) =>
  share >= 0.9995 ? "100%" : share < 0.0005 ? "0%" : `${(share * 100).toFixed(share > 0.99 ? 1 : 0)}%`;

function Covers({ share, count }: { share: number | null; count: number | null }) {
  if (share == null) return <span className="hint-text" title="No reports kept for this entry — typed in by hand, or imported before reports were kept">—</span>;
  return (
    <span className={share < 0.9 ? "plan-covers low" : "plan-covers"} title={`${Math.round(share * (count ?? 0)).toLocaleString()} of ${(count ?? 0).toLocaleString()} reports`}>
      {pct(share)}
    </span>
  );
}

function CoverageLines({ priType, c }: { priType: string; c: Coverage }) {
  return (
    <>
      <div>RF {describeRange(c.rf, "MHz")}</div>
      {priType !== "cw" && (
        <>
          <div>
            {priType === "stagger" ? "Frame" : "PRI"} {describeRange(c.pri, "µs")}
            {priType === "stagger" && c.positions > 0 && <span className="hint-text"> · {c.positions} positions</span>}
          </div>
          <div>PW {describeRange(c.pw, "µs")}</div>
        </>
      )}
    </>
  );
}

/** An entry's own ± margins for its new Mode — a link that opens three small
 * fields; left empty, each uses the page's margin (shown greyed in it). */
function RowMargins({
  priType,
  open,
  values,
  page,
  onToggle,
  onChange,
}: {
  priType: string;
  open: boolean;
  values: RowDeltas;
  page: PlanSettings;
  onToggle: () => void;
  onChange: (values: RowDeltas) => void;
}) {
  const fields: { key: keyof RowDeltas; label: string; fallback: number }[] = [
    { key: "rf", label: "RF ±", fallback: page.rfDelta },
    ...(priType === "fixed" ? [{ key: "pri" as const, label: "PRI ±", fallback: page.priDelta }] : []),
    ...(priType === "stagger" ? [{ key: "frame" as const, label: "Frame ±", fallback: page.frameDelta }] : []),
    ...(priType !== "cw" ? [{ key: "pw" as const, label: "PW ±", fallback: page.pwDelta }] : []),
  ];
  const own = fields.filter((f) => values[f.key] != null && values[f.key]!.trim() !== "");
  return (
    <div className="plan-margins">
      <button type="button" className="link-button" aria-expanded={open} onClick={onToggle}>
        {own.length > 0 ? `± own: ${own.map((f) => `${f.label} ${values[f.key]}`).join(", ")}` : "± for this entry"}
      </button>
      {open && (
        <div className="plan-margins-fields">
          {fields.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type="number"
                step="any"
                min="0"
                placeholder={String(f.fallback)}
                value={values[f.key] ?? ""}
                onChange={(ev) => onChange({ ...values, [f.key]: ev.target.value })}
              />
            </label>
          ))}
          {own.length > 0 && (
            <button type="button" className="link-button" onClick={() => onChange({})}>
              Use the page&apos;s
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface Row {
  entry: InterceptEntry;
  match: EntryMatch;
  options: WidenOption[];
  action: Action;
  isDefault: boolean;
  share: number | null;
  /** A new Mode's line, or why there's none. */
  line: ModeLineFields | null;
  problem: string | null;
  coverage: Coverage | null;
  widen: { option: WidenOption; before: Range | null; after: Range | null; others: number } | null;
}

/** The step between an Intercept and its Modes: for each entry the Modes
 * don't cover yet, choose to make a new Mode, widen one it nearly fits, or
 * skip it — seeing what each would cover first. Nothing is written until
 * Apply, and then only into the Emitter's unsaved changes. */
export function InterceptModePlanPage() {
  const { interceptId = "" } = useParams<{ interceptId: string }>();
  const location = useLocation();
  const picked = (location.state as { entryIds?: string[] } | null)?.entryIds ?? null;
  const canWrite = useHasRole("editor");
  const { data: intercept } = useIntercept(interceptId);
  const emitterId = intercept?.emitter_id ?? "";
  const { data: emitter } = useEmitter(intercept?.emitter_id);
  const { isMine } = useEmitterCheckoutState(emitter);
  const { data: modes } = useEmitterModes(emitterId);
  const { data: entries } = useInterceptEntries(interceptId);
  const { data: ewGroups } = useEwGroups(emitterId);
  const { data: sources } = useSources(emitterId);
  const { data: functionGroups } = useFunctionGroups(emitterId);
  const all = useQuery({
    queryKey: ["intercept-entries", "all-reports", interceptId],
    queryFn: () => interceptsApi.allReports(interceptId),
    enabled: !!interceptId,
    refetchOnWindowFocus: false,
  });
  const apply = useApplyInterceptModePlan(emitterId);
  const { confirmDelete: confirm, dialog } = useConfirmDialog();

  const [onlyPicked, setOnlyPicked] = useState(picked != null);
  const [showMatched, setShowMatched] = useState(false);
  const [overrides, setOverrides] = useState<Map<string, Action>>(new Map());
  const [rowDeltas, setRowDeltas] = useState<Map<string, RowDeltas>>(new Map());
  const [openDeltas, setOpenDeltas] = useState<Set<string>>(new Set());
  const [ewGroupId, setEwGroupId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [functionGroupId, setFunctionGroupId] = useState("");
  const [prefix, setPrefix] = useState<string | null>(null);
  const [quality, setQuality] = useState("100");
  const [quantity, setQuantity] = useState("2");
  const [basis, setBasis] = useState<RangeBasis>("minmax");
  const [rfDelta, setRfDelta] = useState("0");
  const [priDelta, setPriDelta] = useState("0");
  const [frameDelta, setFrameDelta] = useState("0");
  const [pwDelta, setPwDelta] = useState("0");
  const [cwPwMin, setCwPwMin] = useState("");
  const [cwPwMax, setCwPwMax] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<InterceptModePlanResult | null>(null);

  const byEntry = useMemo(() => (all.data ? reportsByEntry(all.data) : new Map<string, EntryReports>()), [all.data]);
  const settings: PlanSettings = {
    basis,
    rfDelta: num(rfDelta),
    priDelta: num(priDelta),
    frameDelta: num(frameDelta),
    pwDelta: num(pwDelta),
    cwPw: cwPwMin.trim() !== "" && cwPwMax.trim() !== "" && num(cwPwMin) <= num(cwPwMax) ? [num(cwPwMin), num(cwPwMax)] : null,
  };
  const settingsKey = JSON.stringify(settings);

  const rows: Row[] = useMemo(() => {
    if (!entries || !modes) return [];
    const pickedSet = onlyPicked && picked ? new Set(picked) : null;
    const base = entries
      .filter((e) => !pickedSet || pickedSet.has(e.id))
      .map((entry) => {
        const ranges = entryRanges(entry, byEntry.get(entry.id), settings.basis);
        const match = matchEntry(entry, modes);
        const options = widenOptions(entry, modes, ranges);
        const fallback: Action =
          match.status === "match" ? { kind: "skip" } : options[0] ? { kind: "widen", modeId: options[0].mode.id } : { kind: "new" };
        const chosen = overrides.get(entry.id);
        // An override pointing at a Mode that's no longer an option falls back.
        const valid = chosen && (chosen.kind !== "widen" || options.some((o) => o.mode.id === chosen.modeId));
        return { entry, ranges, match, options, action: valid ? chosen! : fallback, isDefault: !valid };
      })
      .sort(
        (a, b) =>
          (TYPE_ORDER[a.entry.pri_type] ?? 9) - (TYPE_ORDER[b.entry.pri_type] ?? 9) || a.entry.rf_mean_mhz - b.entry.rf_mean_mhz,
      );

    // Every entry widening the same Mode widens it once, to take them all in.
    const changes = new Map<string, { change: WidenChange; entryIds: string[] }>();
    for (const r of base) {
      if (r.action.kind !== "widen") continue;
      const modeId = r.action.modeId;
      const option = r.options.find((o) => o.mode.id === modeId)!;
      const change = widenChange(option.mode, option.param, r.ranges);
      if (!change) continue;
      const cur = changes.get(modeId);
      changes.set(modeId, cur ? { change: mergeChanges([cur.change, change]), entryIds: [...cur.entryIds, r.entry.id] } : { change, entryIds: [r.entry.id] });
    }

    return base.map((r): Row => {
      const reports = byEntry.get(r.entry.id);
      if (r.action.kind === "new") {
        // The page's margins, with any this entry has of its own.
        const own = rowDeltas.get(r.entry.id) ?? {};
        const mine = (v: string | undefined, page: number) => (v != null && v.trim() !== "" ? num(v, page) : page);
        const line = newModeLine(r.entry, r.ranges, {
          ...settings,
          rfDelta: mine(own.rf, settings.rfDelta),
          priDelta: mine(own.pri, settings.priDelta),
          frameDelta: mine(own.frame, settings.frameDelta),
          pwDelta: mine(own.pw, settings.pwDelta),
        });
        const problem = line
          ? null
          : r.entry.pri_type === "cw"
            ? "Give the CW PW range above"
            : "This entry is missing values a Mode needs";
        const coverage = line ? lineCoverage(r.entry.pri_type, line) : null;
        return { ...r, line, problem, coverage, share: coverage ? coveredShare(reports, r.entry.pri_type, coverage) : null, widen: null };
      }
      if (r.action.kind === "widen") {
        const modeId = r.action.modeId;
        const option = r.options.find((o) => o.mode.id === modeId)!;
        const merged = changes.get(modeId);
        const line = option.mode.line!;
        const afterLine = merged ? applyChange(line, merged.change) : line;
        const coverage = lineCoverage(option.mode.pri_type, afterLine);
        const key = PARAM_KEY[option.param];
        return {
          ...r,
          line: null,
          problem: null,
          coverage,
          share: coveredShare(reports, r.entry.pri_type, coverage),
          widen: {
            option,
            before: lineCoverage(option.mode.pri_type, line)[key],
            after: coverage[key],
            others: (merged?.entryIds.length ?? 1) - 1,
          },
        };
      }
      return { ...r, line: null, problem: null, coverage: null, share: null, widen: null };
    });
    // settingsKey stands in for settings, rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, modes, byEntry, overrides, rowDeltas, onlyPicked, picked, settingsKey]);

  if (!canWrite) {
    return (
      <div className="page">
        <h1>Plan Modes</h1>
        <p className="hint-text">Planning Modes needs editor access.</p>
      </div>
    );
  }
  if (!intercept || !entries || !modes || all.isLoading) return <LoadingState label="Loading the entries and Modes…" />;

  const listed = rows.filter((r) => showMatched || r.match.status !== "match");
  const matchedCount = rows.filter((r) => r.match.status === "match").length;
  const toCreate = listed.filter((r) => r.action.kind === "new" && r.match.status !== "match");
  const toWiden = [...new Set(listed.filter((r) => r.action.kind === "widen").map((r) => (r.action as { modeId: string }).modeId))];
  const skipped = listed.filter((r) => r.action.kind === "skip" && r.match.status !== "match").length;
  const problems = toCreate.filter((r) => r.problem);
  const needsCw = toCreate.some((r) => r.entry.pri_type === "cw");
  const types = new Set(toCreate.map((r) => r.entry.pri_type));
  const group = ewGroupId || ewGroups?.[0]?.id || "";
  // Its own Source when it has one, else the first.
  const ownSource = intercept.source_id && sources?.some((s) => s.id === intercept.source_id) ? intercept.source_id : null;
  const source = sourceId || ownSource || sources?.[0]?.id || "";
  const namePrefix = (prefix ?? intercept.name.slice(0, 150)).trim();
  const nothing = toCreate.length === 0 && toWiden.length === 0;
  const tooMany = toCreate.length > MAX_NEW_MODES;
  const blocked =
    !isMine || nothing || tooMany || problems.length > 0 || (toCreate.length > 0 && (!group || !source || !namePrefix));

  function choose(entryId: string, value: string) {
    const next = new Map(overrides);
    next.set(entryId, value === "new" ? { kind: "new" } : value === "skip" ? { kind: "skip" } : { kind: "widen", modeId: value.slice(6) });
    setOverrides(next);
    setDone(null);
  }

  async function submit() {
    setError(null);
    const widenRows = listed.filter((r) => r.action.kind === "widen" && r.widen);
    const byMode = new Map<string, { change: WidenChange; entryIds: string[] }>();
    for (const r of widenRows) {
      const option = r.widen!.option;
      const change = widenChange(option.mode, option.param, entryRanges(r.entry, byEntry.get(r.entry.id), basis))!;
      const cur = byMode.get(option.mode.id);
      byMode.set(option.mode.id, cur ? { change: mergeChanges([cur.change, change]), entryIds: [...cur.entryIds, r.entry.id] } : { change, entryIds: [r.entry.id] });
    }
    const widenSummary = [...byMode.keys()]
      .map((id) => {
        const r = widenRows.find((w) => w.widen!.option.mode.id === id)!;
        return `${r.widen!.option.mode.name} (${r.widen!.option.param} ${describeRange(r.widen!.before)} → ${describeRange(r.widen!.after)})`;
      })
      .join(", ");
    const groupName = ewGroups?.find((g) => g.id === group)?.name ?? "the EW Group";
    const parts = [
      toCreate.length > 0 && `create ${toCreate.length} Mode${toCreate.length === 1 ? "" : "s"} in ${groupName}, named "${namePrefix} 1"…`,
      byMode.size > 0 && `widen ${byMode.size} Mode${byMode.size === 1 ? "" : "s"}: ${widenSummary}`,
    ].filter(Boolean);
    const ok = await confirm(
      `This will ${parts.join(", and ")}. It joins your unsaved changes to ${emitter?.name ?? "the Emitter"} — Discard still undoes it.`,
      { confirmLabel: "Apply" },
    );
    if (!ok) return;
    const input: InterceptModePlanInput = {
      intercept_id: intercept!.id,
      source_id: toCreate.length ? source : null,
      function_group_id: toCreate.length ? functionGroupId || null : null,
      name_prefix: toCreate.length ? namePrefix : null,
      confirmation_quality: Math.round(num(quality, 100)),
      confirmation_quantity: Math.max(1, Math.round(num(quantity, 2))),
      new_modes: toCreate.map((r) => ({ entry_ids: [r.entry.id], pri_type: r.entry.pri_type, line: r.line! })),
      widen: [...byMode].map(([modeId, { change, entryIds }]) => ({ mode_id: modeId, entry_ids: entryIds, ...change })),
    };
    try {
      const result = await apply.mutateAsync({ ewGroupId: group, input });
      setDone(result);
      setOverrides(new Map());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't apply the plan — nothing was changed.");
    }
  }

  const deltaInput = (label: string, value: string, set: (v: string) => void) => (
    <label>
      {label}
      <input className="edit-input" type="number" step="any" min="0" value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );

  return (
    <div className="page plan-page">
      <Link to={`/intercepts/${interceptId}`}>← {intercept.name}</Link>
      <h1>Plan Modes</h1>
      <p className="hint-text">
        For each entry {emitter ? `${emitter.name}'s` : "the"} Modes don&apos;t cover yet, choose what to do: make a{" "}
        <strong>new Mode</strong>, <strong>widen</strong> a Mode it nearly fits (a partial match — only the one parameter
        that&apos;s off grows), or <strong>skip</strong> it. Each row shows what the result would cover and how many of
        the entry&apos;s reports fall inside. Nothing changes until you apply — and then it joins your unsaved changes
        to the Emitter, which Discard still undoes.
      </p>
      {!isMine && (
        <p className="plan-notice">
          You can plan, but to apply, start editing{" "}
          <Link to={`/emitters/${emitterId}`}>{emitter?.name ?? "the Emitter"}</Link> first.
        </p>
      )}
      {done && (
        <p className="import-message">
          Applied:{" "}
          {done.created.length > 0 && `${done.created.length} new Mode${done.created.length === 1 ? "" : "s"} (${done.created[0].name}${done.created.length > 1 ? ` – ${done.created[done.created.length - 1].name}` : ""})`}
          {done.created.length > 0 && done.widened.length > 0 && " and "}
          {done.widened.length > 0 && `${done.widened.length} widened (${done.widened.map((m) => m.name).join(", ")})`}. Each is linked to
          its entries. <Link to={`/intercepts/${interceptId}`}>Back to the Intercept</Link> ·{" "}
          <Link to={`/emitters/${emitterId}`}>Open the Modes</Link>
        </p>
      )}

      <section className="card plan-settings">
        <h3>New Modes</h3>
        <div className="form-row">
          <label className="grow">
            EW Group
            <select className="edit-input" value={group} onChange={(e) => setEwGroupId(e.target.value)}>
              {(ewGroups ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grow">
            Source
            <select className="edit-input" value={source} onChange={(e) => setSourceId(e.target.value)}>
              {(sources ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {(functionGroups ?? []).length > 0 && (
            <label className="grow">
              Function group
              <select className="edit-input" value={functionGroupId} onChange={(e) => setFunctionGroupId(e.target.value)}>
                <option value="">None</option>
                {(functionGroups ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="grow">
            Names
            <input
              className="edit-input"
              value={prefix ?? intercept.name.slice(0, 150)}
              maxLength={150}
              onChange={(e) => setPrefix(e.target.value)}
              title={`"${namePrefix} 1", "${namePrefix} 2", … in the order below — numbers already used are skipped`}
            />
          </label>
          <label>
            Confirmation quality
            <input className="edit-input" type="number" min="0" max="100" value={quality} onChange={(e) => setQuality(e.target.value)} />
          </label>
          <label>
            quantity
            <input className="edit-input" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
        </div>
        <div className="form-row">
          <label>
            Range from
            <select className="edit-input plan-basis" value={basis} onChange={(e) => setBasis(e.target.value as RangeBasis)}>
              <option value="minmax">Every report (lowest to highest)</option>
              <option value="p98">Middle 98% of reports (leaves out the extreme 1% each side)</option>
            </select>
          </label>
          {deltaInput("RF ± (MHz)", rfDelta, setRfDelta)}
          {(types.has("fixed") || types.size === 0) && deltaInput("PRI ± (µs)", priDelta, setPriDelta)}
          {types.has("stagger") && deltaInput("Frame time ± (µs)", frameDelta, setFrameDelta)}
          {(types.has("fixed") || types.has("stagger") || types.size === 0) && deltaInput("PW ± (µs)", pwDelta, setPwDelta)}
          {needsCw && (
            <>
              <label>
                CW PW min (µs)
                <input className="edit-input" type="number" step="any" min="0" value={cwPwMin} onChange={(e) => setCwPwMin(e.target.value)} />
              </label>
              <label>
                CW PW max (µs)
                <input className="edit-input" type="number" step="any" min="0" value={cwPwMax} onChange={(e) => setCwPwMax(e.target.value)} />
              </label>
            </>
          )}
        </div>
        <p className="hint-text">
          A new Mode takes the entry&apos;s range with these ± margins on top (or its own — &ldquo;± for this
          entry&rdquo; in its row); a stagger&apos;s frame time is one value,
          so its measured spread goes into its ± too. A widened Mode keeps its own name, margins and everything else.
        </p>
      </section>

      <section className="card">
        <div className="plan-table-bar">
          <span>
            {listed.length === 0 ? (
              <strong>Every entry here already matches a Mode.</strong>
            ) : (
              <>
                <strong>{listed.length.toLocaleString()}</strong> entr{listed.length === 1 ? "y" : "ies"}
              </>
            )}
            {picked && (
              <>
                {" · "}
                <button type="button" className="link-button" onClick={() => setOnlyPicked(!onlyPicked)}>
                  {onlyPicked ? `Only the ${picked.length} selected — show all entries` : `Only the ${picked.length} selected`}
                </button>
              </>
            )}
          </span>
          {matchedCount > 0 && (
            <label className="inline-label">
              <input type="checkbox" checked={showMatched} onChange={(e) => setShowMatched(e.target.checked)} />
              Show the {matchedCount} that already match
            </label>
          )}
        </div>
        {listed.length > 0 && (
          <div className="matrix-scroll">
            <table className="data-table compact-table plan-table">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>Now</th>
                  <th>Do</th>
                  <th>Will cover</th>
                  <th title="How many of the entry's reports fall inside what it will be covered by">Reports inside</th>
                </tr>
              </thead>
              <tbody>
                {listed.map((r) => {
                  const e = r.entry;
                  const value = r.action.kind === "widen" ? `widen:${r.action.modeId}` : r.action.kind;
                  return (
                    <tr key={e.id} className={r.action.kind === "skip" ? "plan-skipped" : undefined}>
                      <td className="cell-nowrap">
                        {TYPE_LABEL[e.pri_type]} <strong>{e.rf_mean_mhz}</strong> MHz
                        <div className="hint-text cell-subline">
                          {e.report_count != null ? `${e.report_count.toLocaleString()} reports` : "typed in"}
                          {e.pri_mean_us != null && ` · ${e.pri_type === "stagger" ? "frame" : "PRI"} ${e.pri_mean_us}`}
                          {e.pw_mean_us != null && ` · PW ${e.pw_mean_us}`}
                        </div>
                      </td>
                      <td>
                        <EntryMatchCell match={r.match} emitterId={emitterId} compact />
                      </td>
                      <td>
                        {r.match.status === "match" ? (
                          <span className="hint-text">Already covered</span>
                        ) : (
                          <select aria-label="What to do with this entry" value={value} onChange={(ev) => choose(e.id, ev.target.value)}>
                            {r.options.map((o, i) => (
                              <option key={o.mode.id} value={`widen:${o.mode.id}`}>
                                Widen {o.mode.name} ({o.param === "PRI" && e.pri_type === "stagger" ? "frame time" : o.param})
                                {i === 0 && r.options.length > 1 ? " — least change" : ""}
                              </option>
                            ))}
                            <option value="new">New Mode</option>
                            <option value="skip">Skip</option>
                          </select>
                        )}
                        {r.action.kind === "new" && r.match.status !== "match" && (
                          <RowMargins
                            priType={e.pri_type}
                            open={openDeltas.has(e.id)}
                            values={rowDeltas.get(e.id) ?? {}}
                            page={settings}
                            onToggle={() => {
                              const next = new Set(openDeltas);
                              if (next.has(e.id)) next.delete(e.id);
                              else next.add(e.id);
                              setOpenDeltas(next);
                            }}
                            onChange={(values) => {
                              const next = new Map(rowDeltas);
                              if (Object.values(values).every((v) => !v || v.trim() === "")) next.delete(e.id);
                              else next.set(e.id, values);
                              setRowDeltas(next);
                              setDone(null);
                            }}
                          />
                        )}
                      </td>
                      <td className="plan-result">
                        {r.action.kind === "new" &&
                          (r.problem ? (
                            <span className="error-text">{r.problem}</span>
                          ) : (
                            <CoverageLines priType={e.pri_type} c={r.coverage!} />
                          ))}
                        {r.widen && (
                          <>
                            <strong>{r.widen.option.mode.name}</strong>{" "}
                            {r.widen.option.param === "PRI" && e.pri_type === "stagger" ? "frame" : r.widen.option.param}{" "}
                            <span className="plan-before">{describeRange(r.widen.before)}</span> →{" "}
                            <span className="plan-after">{describeRange(r.widen.after)}</span>{" "}
                            {r.widen.option.param === "RF" ? "MHz" : "µs"}
                            {r.widen.others > 0 && (
                              <div className="hint-text cell-subline">
                                with {r.widen.others} more entr{r.widen.others === 1 ? "y" : "ies"} widening it
                              </div>
                            )}
                          </>
                        )}
                        {r.action.kind === "skip" && r.match.status !== "match" && <span className="hint-text">Nothing — stays uncovered</span>}
                      </td>
                      <td>{r.action.kind !== "skip" ? <Covers share={r.share} count={e.report_count ?? null} /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card import-footer">
        <p>
          {nothing ? (
            <span className="hint-text">Nothing to apply.</span>
          ) : (
            <>
              <strong>{toCreate.length}</strong> new Mode{toCreate.length === 1 ? "" : "s"} ·{" "}
              <strong>{toWiden.length}</strong> widened
              {skipped > 0 && <span className="hint-text"> · {skipped} skipped</span>}
            </>
          )}
        </p>
        {problems.length > 0 && <p className="error-text">{problems.length} new Mode{problems.length === 1 ? " needs" : "s need"} more — see the table.</p>}
        {tooMany && (
          <p className="error-text">
            At most {MAX_NEW_MODES.toLocaleString()} new Modes in one go — skip some, or select fewer entries on the
            Intercept page.
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        <button
          type="button"
          className="button primary"
          disabled={blocked || apply.isPending}
          title={!isMine ? `Start editing ${emitter?.name ?? "the Emitter"} first` : undefined}
          onClick={() => void submit()}
        >
          {apply.isPending ? "Applying…" : "Apply…"}
        </button>
      </section>
      {dialog}
    </div>
  );
}
