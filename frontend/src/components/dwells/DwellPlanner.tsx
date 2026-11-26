import { useDeferredValue, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { platformCoverageApi } from "../../api/platforms";
import { num } from "./DwellChart";
import {
  DEFAULT_SETTINGS,
  addForUncovered,
  breakSynchronism,
  isWholeCollects,
  lengthenShort,
  plan,
  roundToCollects,
  uncoveredParts,
  type Issue,
  type ModePlan,
  type PlannerDwell,
  type PlannerMode,
  type PlannerSettings,
} from "./dwellPlanner";

const SETTINGS_KEY = "dwell-planner-settings";

function readSettings(): PlannerSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<PlannerSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** The Platforms' pinned Modes, as the planner reads them — every Mode once. */
function usePlannerModes(platformIds: string[]): PlannerMode[] | undefined {
  const results = useQueries({
    queries: platformIds.map((id) => ({ queryKey: ["platform-coverage", id], queryFn: () => platformCoverageApi.get(id) })),
  });
  return useMemo(() => {
    if (platformIds.length === 0 || results.some((r) => !r.data)) return undefined;
    const seen = new Map<string, PlannerMode>();
    for (const r of results)
      for (const e of r.data ?? [])
        for (const m of e.modes) {
          const key = `${e.emitter_id}:${m.id ?? m.name}`;
          if (seen.has(key) || !m.rf) continue;
          seen.set(key, {
            key,
            emitterId: e.emitter_id,
            emitterName: e.designation ? `${e.designation} — ${e.emitter_name}` : e.emitter_name,
            modeName: m.name,
            priType: m.pri_type,
            rf: m.rf,
            longestIntervalUs: m.planner?.longest_interval_us ?? null,
            frameUs: m.planner?.frame_us ?? null,
            scanS: m.planner?.scan_s ?? null,
            scanFrom: m.planner?.scan_from ?? null,
            groupScanS: m.planner?.group_scan_s ?? null,
            illuminationTimeMs: e.illumination_time_ms ?? null,
            priority: m.planner?.priority ?? null,
            confirmationQuantity: m.planner?.confirmation_quantity ?? null,
          });
        }
    return [...seen.values()];
    // results' data is what matters; the array itself is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformIds.join(), ...results.map((r) => r.dataUpdatedAt)]);
}

const secs = (r: [number, number]) => (r[1] - r[0] < 1e-9 ? `${num(r[0])} s` : `${num(r[0])}–${num(r[1])} s`);

/** Which scan period it was played at: the Mode's own box, or its EW Group's range. */
function ScanNote({ mode }: { mode: PlannerMode }) {
  if (!mode.scanS) return null;
  const outside =
    mode.scanFrom === "mode" && mode.groupScanS && (mode.scanS[0] < mode.groupScanS[0] - 1e-9 || mode.scanS[1] > mode.groupScanS[1] + 1e-9);
  return (
    <span
      className={outside ? "jitter-subline planner-scan-outside" : "jitter-subline"}
      title={
        mode.scanFrom === "mode"
          ? `The Mode's own scan period${mode.groupScanS ? `, inside its EW Group's ${secs(mode.groupScanS)}` : ""}${outside ? " — but it reaches outside it" : ""}`
          : "Its EW Group's scan period — give the Mode its own box under More options to narrow it"
      }
    >
      {mode.scanFrom === "mode" ? "Mode's" : "EW Group's"} {secs(mode.scanS)}
      {outside && " ⚠"}
    </span>
  );
}

/** "16.7 ms", "1.05 s", "11.2 s", "42 s". */
const ms = (v: number | null) => {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v < 1000) return `${num(Math.round(v * 10) / 10)} ms`;
  const sec = v / 1000;
  return `${num(sec >= 10 ? Math.round(sec * 10) / 10 : Math.round(sec * 100) / 100)} s`;
};
const pct = (v: number) => `${Math.round(v * 100)}%`;
const mhz = (r: [number, number]) => (r[1] - r[0] < 1e-9 ? `${num(r[0])} MHz` : `${num(r[0])}–${num(r[1])} MHz`);

const ISSUE: Record<Issue, { label: string; tone: string }> = {
  not_covered: { label: "Not reached", tone: "bad" },
  too_short: { label: "Dwell too short", tone: "bad" },
  illumination_too_short: { label: "Illumination too short", tone: "bad" },
  synchronism: { label: "Synchronism", tone: "bad" },
  partly_covered: { label: "Partly reached", tone: "warn" },
  slow: { label: "Slow", tone: "warn" },
  ok: { label: "OK", tone: "good" },
};

/** What to do about one Mode, in a sentence. */
function advice(p: ModePlan, dwells: PlannerDwell[], s: PlannerSettings, cycle: number, bw: number): string {
  const covering = p.covering.map((i) => dwells[i]);
  switch (p.issue) {
    case "not_covered":
      return `No dwell reaches ${mhz(p.mode.rf)} — add one there.`;
    case "too_short": {
      const longest = Math.max(...covering.map((d) => (s.within === "collect" ? d.collect_time_ms : d.dwell_time_ms)));
      return `The ${s.within === "collect" ? "collects" : "dwells"} reaching it are at most ${ms(longest)}; ${s.pulses} pulses take ${ms(p.needMs)} — make ${p.covering.length === 1 ? "it" : "them"} ${ms(p.recommendedMs)}.`;
    }
    case "illumination_too_short":
      return `Its illumination time is ~${ms(p.illuminationMs)} a scan, but ${s.pulses} pulses take ${ms(p.needMs)} — no dwell can fix that: fewer pulses to detect, or it's caught only when it stops scanning.`;
    case "synchronism":
      return `The ${ms(cycle)} cycle keeps missing its scan: ${pct(p.lockedOut)} of starting moments are never caught. Change the cycle by a collect or so.`;
    case "partly_covered": {
      const gaps = uncoveredParts(p.mode.rf, dwells, bw);
      return `The dwells reach ${pct(p.coverage)} of its RF${gaps.length ? ` — not ${gaps.slice(0, 2).map((g) => mhz([g.lo, g.hi])).join(", ")}${gaps.length > 2 ? "…" : ""}` : ""}.`;
    }
    case "slow":
      return `Caught within ${num(s.horizonS)} s from ${pct(p.pWithin)} of starts — come back to its band more often than every ${ms(p.revisitMs)}, or dwell longer there.`;
    default:
      return "";
  }
}

/** The dwell planner: how likely each of the Platforms' Modes is to be
 * intercepted with the dwells as they stand (as they're typed), what each
 * needs, and changes to make — applied to the unsaved dwells, to check and save. */
export function DwellPlanner({
  dwells,
  bandwidth,
  platformIds,
  title,
  canEdit,
  onApply,
}: {
  dwells: PlannerDwell[];
  bandwidth: number;
  platformIds: string[];
  title: string;
  canEdit: boolean;
  onApply: (dwells: PlannerDwell[], what: string) => void;
}) {
  const modes = usePlannerModes(platformIds);
  const [settings, setSettingsState] = useState(readSettings);
  const [message, setMessage] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const deferredDwells = useDeferredValue(dwells);
  const deferredSettings = useDeferredValue(settings);
  const usable = useMemo(() => deferredDwells.filter((d) => d.freq_mhz > 0 && d.dwell_time_ms > 0), [deferredDwells]);
  const plans = useMemo(
    () => (modes ? plan(modes, usable, bandwidth, deferredSettings) : undefined),
    [modes, usable, bandwidth, deferredSettings],
  );

  function setSettings(patch: Partial<PlannerSettings>) {
    const next = { ...settings, ...patch };
    setSettingsState(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Not kept: the defaults next time.
    }
  }
  const numberSetting = (key: "pulses" | "beamwidthDeg" | "horizonS", label: string, unit: string, min: number, title: string) => (
    <label className="planner-setting" title={title}>
      {label}
      <input
        type="number"
        step="any"
        min={min}
        value={settings[key]}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (v > 0) setSettings({ [key]: key === "pulses" ? Math.max(1, Math.round(v)) : v });
        }}
      />
      {unit}
    </label>
  );

  if (platformIds.length === 0) return null;
  const cycle = usable.reduce((n, d) => n + d.dwell_time_ms, 0);
  const counts = new Map<Issue, number>();
  for (const p of plans ?? []) counts.set(p.issue, (counts.get(p.issue) ?? 0) + 1);
  const notWhole = usable.filter((d) => !isWholeCollects(d)).length;
  const lengthened = plans ? lengthenShort(usable, plans, settings) : usable;
  const toLengthen = lengthened.filter((d, i) => d !== usable[i]).length;
  const withAdded = plans ? addForUncovered(usable, plans, bandwidth, settings) : usable;
  const toAdd = withAdded.length - usable.length;
  const shown = (plans ?? []).filter((p) => !onlyProblems || p.issue !== "ok");

  function apply(next: PlannerDwell[], what: string) {
    onApply(next, what);
    setMessage(`${what} — check the dwells above, then save.`);
  }
  function tryBreak() {
    if (!modes) return;
    setTrying(true);
    setMessage("Trying one collect more on each dwell…");
    // Let the message draw before the work.
    setTimeout(() => {
      const fix = breakSynchronism(modes, usable, bandwidth, settings);
      setTrying(false);
      if (!fix) return setMessage("No single dwell one collect longer helps — try another order, or other dwell times.");
      const d = fix.dwells[fix.changed];
      apply(fix.dwells, `Dwell ${fix.changed + 1} (${num(d.freq_mhz)} MHz) made ${ms(d.dwell_time_ms)}: the cycle out of step with the scans`);
    }, 30);
  }

  return (
    <section className="card dwell-planner" aria-label="Planner">
      <div className="planner-head">
        <div>
          <h2 className="as-h4">Planner</h2>
          <p className="hint-text">
            How likely each of {title} is to be intercepted with these dwells — worked out as you edit them.
          </p>
        </div>
        <div className="planner-settings">
          {numberSetting("pulses", "Pulses to detect", "", 1, "How many of a Mode's pulses the receiver needs to detect it")}
          <label className="planner-setting" title="Where those pulses must fall">
            in one
            <select value={settings.within} onChange={(e) => setSettings({ within: e.target.value as PlannerSettings["within"] })}>
              <option value="dwell">dwell</option>
              <option value="collect">collect</option>
            </select>
          </label>
          {numberSetting("beamwidthDeg", "Beamwidth", "°", 0.1, "The scanning radars' antenna beamwidth: how long each scan lights the Platform")}
          {numberSetting("horizonS", "Within", "s", 0.1, "The time allowed to intercept")}
        </div>
      </div>

      {!plans ? (
        <p className="hint-text">Reading the Platforms&apos; Emitters…</p>
      ) : plans.length === 0 ? (
        <p className="hint-text">The Platforms pin no Emitters with Modes yet.</p>
      ) : (
        <>
          <div className="planner-summary">
            <span className="dwell-cycle" title="One pass through all the dwells: how often each band comes round">
              Cycle {ms(cycle)}
            </span>
            <span>
              {plans.length} Mode{plans.length === 1 ? "" : "s"}:
            </span>
            {(Object.keys(ISSUE) as Issue[])
              .filter((k) => counts.get(k))
              .map((k) => (
                <span key={k} className={`planner-issue ${ISSUE[k].tone}`}>
                  {counts.get(k)} {ISSUE[k].label.toLowerCase()}
                </span>
              ))}
            <label className="inline-check">
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
              Only problems
            </label>
          </div>

          {canEdit && (notWhole > 0 || toLengthen > 0 || toAdd > 0 || counts.get("synchronism")) && (
            <div className="planner-actions">
              {notWhole > 0 && (
                <button type="button" className="button secondary small" onClick={() => apply(roundToCollects(usable), `${notWhole} dwell time${notWhole === 1 ? "" : "s"} rounded up to whole collects`)}>
                  Round {notWhole} dwell time{notWhole === 1 ? "" : "s"} up to whole collects
                </button>
              )}
              {toLengthen > 0 && (
                <button type="button" className="button secondary small" onClick={() => apply(roundToCollects(lengthened), `${toLengthen} dwell${toLengthen === 1 ? "" : "s"} lengthened`)}>
                  Lengthen {toLengthen} short dwell{toLengthen === 1 ? "" : "s"}
                </button>
              )}
              {toAdd > 0 && (
                <button type="button" className="button secondary small" onClick={() => apply(withAdded, `${toAdd} dwell${toAdd === 1 ? "" : "s"} added for the RF nothing reached`)}>
                  Add {toAdd} dwell{toAdd === 1 ? "" : "s"} for RF nothing reaches
                </button>
              )}
              {!!counts.get("synchronism") && (
                <button type="button" className="button secondary small" disabled={trying} onClick={tryBreak}>
                  {trying ? "Trying…" : "Break the synchronism"}
                </button>
              )}
            </div>
          )}
          {message && (
            <p className="hint-text planner-message" role="status">
              {message}
            </p>
          )}

          <div className="table-scroll">
            <table className="data-table planner-table">
              <thead>
                <tr>
                  <th>Emitter · Mode</th>
                  <th className="num" title="Its EW Group's priority">
                    Priority
                  </th>
                  <th className="num" title="How much of its RF (with its delta) the dwell bands reach">
                    RF reached
                  </th>
                  <th className="num" title={`Time on frequency to see ${settings.pulses} pulses (a stagger: two frames at least)`}>
                    Needs
                  </th>
                  <th title="The dwells whose band reaches it">Dwells</th>
                  <th className="num" title="The longest wait between looks at it long enough to see it">
                    Every
                  </th>
                  <th
                    className="num"
                    title={`Illumination time: how long its main beam is on the Platform each scan — its Emitter's own where set, else scan period × ${num(settings.beamwidthDeg)}° ÷ 360°; — : not scanning, illuminated all the time`}
                  >
                    Illumination time
                  </th>
                  <th className="num" title={`Share of starting moments it's intercepted within ${num(settings.horizonS)} s — and confirmed (its confirmation quantity of intercepts)`}>
                    In {num(settings.horizonS)} s
                  </th>
                  <th className="num" title="Median time to the first intercept">
                    Median
                  </th>
                  <th>What to do</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.mode.key} className={`planner-row ${ISSUE[p.issue].tone}`}>
                    <td>
                      <Link to={`/emitters/${p.mode.emitterId}`}>{p.mode.emitterName}</Link>
                      <span className="jitter-subline">
                        {p.mode.modeName} · {mhz(p.mode.rf)}
                      </span>
                    </td>
                    <td className="num">{p.mode.priority ?? "—"}</td>
                    <td className="num">{pct(p.coverage)}</td>
                    <td className="num" title={p.recommendedMs != null ? `A dwell of ${ms(p.recommendedMs)} (whole collects) is enough` : undefined}>
                      {ms(p.needMs)}
                    </td>
                    <td>{p.covering.length ? p.covering.map((i) => i + 1).join(", ") : "—"}</td>
                    <td className="num">{ms(p.revisitMs)}</td>
                    <td className="num">
                      {p.illuminationMs == null ? "—" : ms(p.illuminationMs)}
                      {p.illuminationFrom && (
                        <span className="jitter-subline" title={p.illuminationFrom === "emitter" ? "Its Emitter's illumination time" : `Scan period × ${num(settings.beamwidthDeg)}° ÷ 360°`}>
                          {p.illuminationFrom === "emitter" ? "Emitter's" : `${num(settings.beamwidthDeg)}° beam`}
                        </span>
                      )}
                      {p.mode.scanS && <ScanNote mode={p.mode} />}
                    </td>
                    <td className="num">
                      <span className={`planner-p ${p.pWithin >= 0.9 ? "good" : p.pWithin >= 0.5 ? "warn" : "bad"}`}>{pct(p.pWithin)}</span>
                      {(p.mode.confirmationQuantity ?? 1) > 1 && (
                        <span className="jitter-subline" title={`Intercepted ${p.mode.confirmationQuantity} times (its confirmation quantity)`}>
                          ×{p.mode.confirmationQuantity}: {pct(p.pConfirm)}
                        </span>
                      )}
                    </td>
                    <td className="num">{ms(p.medianMs)}</td>
                    <td>
                      <span className={`planner-issue ${ISSUE[p.issue].tone}`}>{ISSUE[p.issue].label}</span>
                      <span className="planner-advice">{advice(p, usable, settings, cycle, bandwidth)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="planner-model">
            <summary>How it works it out</summary>
            <ul>
              <li>
                A Mode is seen when the receiver sits on its frequency long enough for {settings.pulses} pulses in one {settings.within}: pulses
                × its longest gap between pulses (a Fixed PRI&apos;s longest with its jitter; a stagger&apos;s longest step, and two whole frames
                at least). A CW Mode needs one collect.
              </li>
              <li>A dwell reaches the frequencies in its band (its frequency ± half the bandwidth); a Mode&apos;s RF counts with its delta, each part by its width.</li>
              <li>
                A Mode&apos;s scan period is its own box — its function&apos;s, set under the Mode&apos;s More options — where it has one, else its
                EW Group&apos;s overall range. Scanning, it illuminates the Platform once each scan for its illumination time: its Emitter&apos;s own
                where that&apos;s set (Edit details on the Emitter), else {num(settings.beamwidthDeg)}° ÷ 360° of the scan. One without a scan
                period is illuminating the Platform all the time. Scan periods given as a range are tried at both ends and the middle; the
                worst counts.
              </li>
              <li>
                The cycle repeats; the scan may start at any moment. Each Mode is played from {72} starting moments: the share intercepted within{" "}
                {num(settings.horizonS)} s, the median time, and — when some moments are never caught while others are — synchronism.
              </li>
              <li>Confirmation is taken as its confirmation quantity of intercepts, one per look. Changes keep dwell times whole numbers of their collects.</li>
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
