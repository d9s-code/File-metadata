import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { InfoTip } from "../common/PageHeader";
import { describeMiss, matchEntry, TEST_CHECKS, type EntryMatch, type MatchableEntry } from "../intercepts/interceptMatch";
import { asEntry } from "./signalCoverage";
import { RecheckChart, type RecheckPoint } from "./RecheckChart";
import { formatObservedValueSet, nonEmptySets, compareLineLabels } from "./testFormat";
import { useEmitterTestLines } from "../../state/hooks/useTestLines";
import { AddValueToModesDialog, type ValueSeed } from "../modes/AddValueToModesDialog";
import { useHasRole } from "../../auth/RequireAuth";
import type { ObservedValues, TestRecord } from "../../api/testRecords";
import type { Mode } from "../../types/domain";
import { ModeEditDialog } from "../modes/ModeDialogs";
import type { LineValues } from "../modes/modeLine";
import { widened } from "./nearMiss";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { useSources } from "../../state/hooks/useSources";

type Now = "match" | "near" | "none" | "unknown";

/** Beyond RF, PRI and PW: a fixed PRI's jitter, and a stagger's steps in order. */

/** Each outcome's colour (status palette), mark and words — never colour alone. */
const NOW: Record<Now, { cls: string; icon: string; label: string }> = {
  match: { cls: "status-good", icon: "✓", label: "Would match" },
  near: { cls: "status-warning", icon: "≈", label: "Near — one value off" },
  none: { cls: "status-critical", icon: "✕", label: "No Mode" },
  unknown: { cls: "status-neutral", icon: "?", label: "Can't compare" },
};

const CHART_KEY = "recheckChartShown";

interface Row {
  key: string;
  /** What's matched — null when there's no RF or PRI to go on. */
  entry: MatchableEntry | null;
  /** Where in the run it was logged. */
  where: string;
  set: ObservedValues;
  /** What the system reported for it during the test. */
  reported: string;
  reportedIds: string[];
  /** A SIM line's expected Mode (as the line has it now). */
  expected: { id: string; name: string } | null;
  match: EntryMatch | null;
  now: Now;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

const mid = (mean?: number, lo?: number, hi?: number) => mean ?? (lo != null && hi != null ? (lo + hi) / 2 : (lo ?? hi ?? null));

/** The value to add from a logged set: the parameter it was one off on (a
 * near miss), else its PRI — the usual stray — with the logged numbers. */
function seedFrom(r: Row): ValueSeed {
  const s = r.set;
  const off = r.match?.near[0]?.misses[0]?.param;
  if (off === "RF") {
    const v = mid(s.rf_mean_mhz, s.rf_min_mhz, s.rf_max_mhz);
    return { parameter: "rf", from: s.rf_min_mhz ?? v, to: s.rf_max_mhz ?? v };
  }
  if (off === "PW") {
    const v = mid(s.pw_mean_us, s.pw_min_us, s.pw_max_us);
    return { parameter: "pw", from: s.pw_min_us ?? v, to: s.pw_max_us ?? v };
  }
  if (s.pri_stagger_values_us?.length) return { parameter: "pri", priType: "stagger", steps: s.pri_stagger_values_us };
  const pri = mid(s.pri_mean_us, s.pri_min_us, s.pri_max_us);
  const jitter = s.jitter_mean_us ?? s.jitter_max_us ?? 0;
  return { parameter: "pri", priType: "fixed", from: s.pri_min_us ?? pri, to: s.pri_max_us ?? pri, jitterFrom: 0, jitterTo: jitter };
}

/** Every set of parameters logged in a run — on SIM lines, Mode results and
 * signals — matched against the Emitter's Modes as they are now, beside what
 * the system reported during the test: would they be matched now? */
export function RecheckIntercepts({
  emitterId,
  record,
  modes,
  versionTested,
  onMakeElements,
}: {
  emitterId: string;
  record: TestRecord;
  modes: Mode[];
  versionTested: number | null;
  /** Elements (or a sequence) from one logged intercept. */
  onMakeElements?: (set: ObservedValues) => void;
}) {
  const { data: testLines } = useEmitterTestLines(emitterId);
  const [changedOnly, setChangedOnly] = useState(false);
  const [showChart, setShowChartState] = useState(() => {
    try {
      return localStorage.getItem(CHART_KEY) !== "false";
    } catch {
      return true;
    }
  });
  function setShowChart(on: boolean) {
    setShowChartState(on);
    try {
      localStorage.setItem(CHART_KEY, String(on));
    } catch {
      // Not remembered — fine.
    }
  }
  // The row picked on the chart: shown in the table and scrolled to.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (picked) document.getElementById(`recheck-row-${picked}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [picked]);
  const [adding, setAdding] = useState<Row | null>(null);
  const [editing, setEditing] = useState<{ mode: Mode; change: Partial<LineValues> } | null>(null);
  const canWrite = useHasRole("editor");
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit: editingEmitter } = useEmitterCheckoutState(emitter);
  const { data: sources } = useSources(emitterId);
  const expectedOf = new Map((testLines ?? []).map((t) => [t.id, t]));

  const rows: Row[] = [];
  const add = (where: string, sets: ObservedValues[] | null, reported: string, reportedIds: string[], expected: Row["expected"], key: string) => {
    const shown = nonEmptySets(sets);
    shown.forEach((set, i) => {
      const entry = asEntry(set);
      const match = entry ? matchEntry(entry, modes, TEST_CHECKS) : null;
      rows.push({
        key: `${key}-${i}`,
        where: shown.length > 1 ? `${where} · set ${i + 1}` : where,
        set,
        entry,
        reported,
        reportedIds,
        expected,
        match,
        now: match ? match.status : "unknown",
      });
    });
  };
  for (const l of [...record.lines].sort((a, b) => compareLineLabels(a.test_line_label, b.test_line_label))) {
    const line = expectedOf.get(l.test_line_id);
    const reported = [
      ...(l.intercepted_as_unknown ? ["Default Unknown"] : []),
      ...l.intercepted_modes.map((m) => (m.mode_exists ? m.mode_name : `${m.mode_name} (deleted)`)),
    ];
    add(
      `SIM line ${l.test_line_label}`,
      l.observed_values,
      reported.join(", ") || "Nothing",
      l.intercepted_modes.map((m) => m.mode_id),
      line?.expected_mode_id ? { id: line.expected_mode_id, name: line.expected_mode_name ?? "?" } : null,
      `line-${l.test_line_id}`,
    );
  }
  for (const m of record.modes.filter((m) => m.link_type === "exercised"))
    add(`Mode ${m.mode_name}`, m.observed_values, `Tested as ${m.mode_name}`, [m.mode_id], null, `mode-${m.mode_id}`);
  (record.signals ?? []).forEach((s, i) =>
    add(`Signal ${i + 1}`, s.observed_values, s.reported_as_unknown ? "Default Unknown" : "Not reported", [], null, `signal-${i}`),
  );

  if (rows.length === 0) return null;

  const changed = (r: Row) => r.now !== "unknown" && !sameIds(r.reportedIds, (r.match?.matches ?? []).map((m) => m.id));
  const counts = (Object.keys(NOW) as Now[]).map((k) => [k, rows.filter((r) => r.now === k).length] as const);
  const withExpected = rows.filter((r) => r.expected && r.now !== "unknown");
  const expectedNow = withExpected.filter((r) => r.match?.matches.some((m) => m.id === r.expected!.id)).length;
  // A row picked on the chart stays in view whatever the filter.
  const shown = changedOnly ? rows.filter((r) => changed(r) || r.key === picked) : rows;
  const points: RecheckPoint[] = rows.flatMap((r) =>
    r.entry
      ? [{ key: r.key, where: r.where, text: formatObservedValueSet(r.set) ?? "", entry: r.entry, match: r.match, now: r.now, changed: changed(r) }]
      : [],
  );

  return (
    <div className="card recheck-intercepts">
      <h4>
        Logged intercepts against the Modes now{" "}
        <InfoTip label="About this check">
          Each set of parameters logged in this run — on SIM lines, Mode results and signals — matched against the
          Emitter&apos;s Modes as they are now, Modes of the same PRI type only: its RF and PW inside a Mode&apos;s
          range with its delta; a fixed PRI inside its PRI range, and the jitter logged inside its jitter range; a
          stagger by the Mode&apos;s PRI range matching — on: its frame time (as logged, or the sum of its steps)
          inside the Mode&apos;s frame time ± its delta; off: its steps, the Mode&apos;s in the same order — starting
          at any of them, as a train repeats — each within the Mode&apos;s frame-time delta (at least 0.1% of the
          step). <strong>Near</strong> is one parameter off (a
          stagger&apos;s frame time and steps are both its PRI). Beside it, what the system reported during the test,
          so you can see what the Modes changed since.
        </InfoTip>
      </h4>
      <p className="hint-text">
        {versionTested != null ? `v${versionTested} was tested; ` : ""}these are the Emitter&apos;s current Modes
        {modes.length === 0 ? " — it has none, so nothing would match." : "."}
      </p>

      <div className="recheck-bar" role="img" aria-label={counts.map(([k, n]) => `${NOW[k].label}: ${n}`).join(", ")}>
        {counts
          .filter(([, n]) => n > 0)
          .map(([k, n]) => (
            <span key={k} className={`recheck-bar-part ${NOW[k].cls}`} style={{ flexGrow: n }} title={`${NOW[k].label}: ${n}`} />
          ))}
      </div>
      <div className="viz-legend recheck-legend">
        {counts.map(([k, n]) => (
          <span key={k}>
            <span className={`viz-swatch ${NOW[k].cls}`} /> {NOW[k].icon} {NOW[k].label} <strong>{n}</strong>
          </span>
        ))}
        {withExpected.length > 0 && (
          <span>
            SIM lines matching their expected Mode now:{" "}
            <strong>
              {expectedNow} of {withExpected.length}
            </strong>
          </span>
        )}
      </div>

      <div className="recheck-filter-row">
        <label className="checkbox-label recheck-filter">
          <input type="checkbox" checked={showChart} onChange={(e) => setShowChart(e.target.checked)} />
          Chart
        </label>
        <label className="checkbox-label recheck-filter">
          <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />
          Only where the match differs from what was reported ({rows.filter(changed).length})
        </label>
      </div>
      {showChart && <RecheckChart points={points} modes={modes} picked={picked} onPick={setPicked} />}

      {editing && (
        <ModeEditDialog
          emitterId={emitterId}
          mode={editing.mode}
          sources={sources ?? []}
          lineChange={editing.change}
          derivedFromTestRecord={{ id: record.id, title: record.title }}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && (
        <AddValueToModesDialog
          emitterId={emitterId}
          seed={seedFrom(adding)}
          context={`From ${adding.where} in "${record.title}" — the new Modes are marked as derived from this run.`}
          derivedFromTestRecordId={record.id}
          onClose={() => setAdding(null)}
        />
      )}
      <div className="table-scroll">
        <table className="data-table recheck-table">
          <thead>
            <tr>
              <th>Logged on</th>
              <th>Parameters</th>
              <th>Reported in the test</th>
              <th>Now</th>
              <th>Would match</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const st = NOW[r.now];
              const matches = r.match?.matches ?? [];
              const expectedHit = r.expected && matches.some((m) => m.id === r.expected!.id);
              return (
                <tr
                  key={r.key}
                  id={`recheck-row-${r.key}`}
                  className={[changed(r) && "recheck-changed", picked === r.key && "recheck-picked"].filter(Boolean).join(" ") || undefined}
                  onClick={() => setPicked(r.key === picked ? null : r.key)}
                >
                  <td>{r.where}</td>
                  <td>{formatObservedValueSet(r.set) ?? "—"}</td>
                  <td>{r.reported}</td>
                  <td className="recheck-state">
                    <span className={`viz-swatch ${st.cls}`} /> {st.icon} {st.label}
                    {changed(r) && <span className="status-badge recheck-changed-badge">Changed</span>}
                  </td>
                  <td>
                    {matches.length > 0 && (
                      <span>
                        {matches.map((m, i) => (
                          <span key={m.id}>
                            {i > 0 && ", "}
                            <Link to={`/emitters/${emitterId}?tab=modes&mode=${encodeURIComponent(m.name)}`}>{m.name}</Link>
                          </span>
                        ))}
                      </span>
                    )}
                    {r.match?.status === "near" &&
                      r.match.near.map((n) => (
                        <div key={n.mode.id} className="hint-text">
                          {n.mode.name}: {n.misses.map(describeMiss).join("; ")}
                          {canWrite && (
                            <>
                              {" · "}
                              <button
                                type="button"
                                className="link-button"
                                disabled={!editingEmitter}
                                title={
                                  editingEmitter
                                    ? "Opens the Mode widened to cover what was logged; saved as derived from this test"
                                    : "Start editing this Emitter first"
                                }
                                onClick={() => setEditing({ mode: n.mode, change: widened(n.mode, n.misses) })}
                              >
                                Edit {n.mode.name}…
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    {r.now === "none" && <span className="hint-text">Outside every Mode of its PRI type</span>}
                    {r.now === "unknown" && <span className="hint-text">Needs an RF and a PRI to compare</span>}
                    {canWrite && (r.now === "near" || r.now === "none") && (
                      <div>
                        <button type="button" className="link-button" onClick={() => setAdding(r)}>
                          Add to the Modes…
                        </button>
                        {onMakeElements && (
                          <>
                            {" · "}
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => onMakeElements(r.set)}
                              title="Its RF, PRI and PW as Elements on a Source, to build Modes from"
                            >
                              Make Elements…
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {r.expected && r.now !== "unknown" && (
                      <div className={expectedHit ? "recheck-expected ok" : "recheck-expected"}>
                        Expected {r.expected.name}: {expectedHit ? "✓ matched" : "✕ not matched"}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
