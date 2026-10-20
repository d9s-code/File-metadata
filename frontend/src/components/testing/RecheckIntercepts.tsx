import { useState } from "react";
import { Link } from "react-router-dom";
import { InfoTip } from "../common/PageHeader";
import { describeMiss, matchEntry, type EntryMatch } from "../intercepts/interceptMatch";
import { asEntry } from "./signalCoverage";
import { formatObservedValueSet, nonEmptySets, compareLineLabels } from "./testFormat";
import { useEmitterTestLines } from "../../state/hooks/useTestLines";
import type { ObservedValues, TestRecord } from "../../api/testRecords";
import type { Mode } from "../../types/domain";

type Now = "match" | "near" | "none" | "unknown";

/** Each outcome's colour (status palette), mark and words — never colour alone. */
const NOW: Record<Now, { cls: string; icon: string; label: string }> = {
  match: { cls: "status-good", icon: "✓", label: "Would match" },
  near: { cls: "status-warning", icon: "≈", label: "Near — one value off" },
  none: { cls: "status-critical", icon: "✕", label: "No Mode" },
  unknown: { cls: "status-neutral", icon: "?", label: "Can't compare" },
};

interface Row {
  key: string;
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

/** Every set of parameters logged in a run — on SIM lines, Mode results and
 * signals — matched against the Emitter's Modes as they are now, beside what
 * the system reported during the test: would they be matched now? */
export function RecheckIntercepts({
  emitterId,
  record,
  modes,
  versionTested,
}: {
  emitterId: string;
  record: TestRecord;
  modes: Mode[];
  versionTested: number | null;
}) {
  const { data: testLines } = useEmitterTestLines(emitterId);
  const [changedOnly, setChangedOnly] = useState(false);
  const expectedOf = new Map((testLines ?? []).map((t) => [t.id, t]));

  const rows: Row[] = [];
  const add = (where: string, sets: ObservedValues[] | null, reported: string, reportedIds: string[], expected: Row["expected"], key: string) => {
    const shown = nonEmptySets(sets);
    shown.forEach((set, i) => {
      const entry = asEntry(set);
      const match = entry ? matchEntry(entry, modes) : null;
      rows.push({
        key: `${key}-${i}`,
        where: shown.length > 1 ? `${where} · set ${i + 1}` : where,
        set,
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
  const shown = changedOnly ? rows.filter(changed) : rows;

  return (
    <div className="card recheck-intercepts">
      <h4>
        Logged intercepts against the Modes now{" "}
        <InfoTip label="About this check">
          Each set of parameters logged in this run — on SIM lines, Mode results and signals — matched against the
          Emitter&apos;s Modes as they are now, the same way as an Intercept&apos;s entries: its mean RF, PRI (a
          stagger&apos;s frame time and number of steps) and PW inside a Mode&apos;s range with its margin, Modes of
          the same PRI type only. <strong>Near</strong> is one value off. Beside it, what the system reported during
          the test, so you can see what the Modes changed since.
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

      <label className="checkbox-label recheck-filter">
        <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />
        Only where the match differs from what was reported ({rows.filter(changed).length})
      </label>

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
                <tr key={r.key} className={changed(r) ? "recheck-changed" : undefined}>
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
                        </div>
                      ))}
                    {r.now === "none" && <span className="hint-text">Outside every Mode of its PRI type</span>}
                    {r.now === "unknown" && <span className="hint-text">Needs an RF and a PRI to compare</span>}
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
