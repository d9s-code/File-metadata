import type { ObservedValues, TestRecordSignal } from "../../api/testRecords";
import type { Mode, Source } from "../../types/domain";
import { AddSignalToSource } from "./AddSignalToSource";
import { AutoGrowTextarea } from "../common/AutoGrowTextarea";
import { ObservedValuesEditor } from "./ObservedValuesEditor";
import { ObservedValuesTable } from "./ObservedValuesTable";
import { signalCoverage } from "./signalCoverage";
import { nonEmptySets } from "./testFormat";

export interface SignalEntry {
  reportedAsUnknown: boolean;
  observedValues: ObservedValues[];
  notes: string;
}

export function blankSignal(): SignalEntry {
  return { reportedAsUnknown: true, observedValues: [{}], notes: "" };
}

/** The signals to log: those with at least one measured value. */
export function loggedSignals(signals: SignalEntry[]) {
  return signals
    .filter((s) => nonEmptySets(s.observedValues).length > 0)
    .map((s) => ({
      observed_values: nonEmptySets(s.observedValues),
      reported_as_unknown: s.reportedAsUnknown,
      notes: s.notes.trim() || undefined,
    }));
}

/** Whether the Modes already cover a signal's values — "new" when none do. */
function Coverage({ sets, modes }: { sets: ObservedValues[]; modes: Mode[] }) {
  const c = signalCoverage(sets, modes);
  if (c.status === "unknown") return <span className="hint-text">give RF and a PRI type to compare</span>;
  if (c.status === "new") return <span className="status-badge signal-new">New — no Mode covers it</span>;
  return (
    <span className="hint-text" title="These Modes' ranges (with margins) already cover the values">
      Covered by {c.modes.map((m) => m.name).join(", ")}
    </span>
  );
}

function ReportedAs({ unknown }: { unknown: boolean }) {
  return unknown ? <span className="status-badge">Default Unknown</span> : <span className="hint-text">Not reported</span>;
}

/** Signals intercepted during an Intercept Test that aren't tied to a Mode:
 * what was measured, and whether the system reported it as Default Unknown. */
export function InterceptSignalsEditor({
  signals,
  onChange,
  modes,
}: {
  signals: SignalEntry[];
  onChange: (signals: SignalEntry[]) => void;
  modes: Mode[];
}) {
  function patch(index: number, change: Partial<SignalEntry>) {
    onChange(signals.map((s, i) => (i === index ? { ...s, ...change } : s)));
  }
  return (
    <div className="intercept-signals">
      <div className="intercept-signals-head">
        <h4>Signals not tied to a Mode ({signals.length})</h4>
        <button type="button" className="secondary" onClick={() => onChange([...signals, blankSignal()])}>
          + Add signal
        </button>
      </div>
      <p className="hint-text">
        Parameters intercepted that don&apos;t belong to one of the Modes above — reported as Default Unknown, or not at
        all. They don&apos;t count towards the result.
      </p>
      {signals.length > 0 && (
        <div className="table-scroll">
          <table className="data-table intercept-signals-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Reported as</th>
                <th>Intercepted parameters</th>
                <th>Already in the library?</th>
                <th>Notes</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {signals.map((s, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <select
                      aria-label={`Signal ${i + 1} reported as`}
                      value={s.reportedAsUnknown ? "unknown" : "none"}
                      onChange={(e) => patch(i, { reportedAsUnknown: e.target.value === "unknown" })}
                    >
                      <option value="unknown">Default Unknown</option>
                      <option value="none">Not reported</option>
                    </select>
                  </td>
                  <td className="intercept-signal-params">
                    <ObservedValuesEditor sets={s.observedValues} onChange={(sets) => patch(i, { observedValues: sets })} />
                  </td>
                  <td>
                    <Coverage sets={s.observedValues} modes={modes} />
                  </td>
                  <td>
                    <AutoGrowTextarea
                      aria-label={`Signal ${i + 1} notes`}
                      value={s.notes}
                      onChange={(e) => patch(i, { notes: e.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link-button link-button-danger"
                      aria-label={`Remove signal ${i + 1}`}
                      onClick={() => onChange(signals.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A logged run's signals not tied to a Mode, each of which can be added to
 * a Source as a Sequence or as Elements. */
export function InterceptSignalsList({
  signals,
  modes,
  emitterId,
  sources,
  runTitle,
  runDate,
  canEdit,
}: {
  signals: TestRecordSignal[];
  modes: Mode[];
  emitterId: string;
  sources: Source[];
  runTitle: string;
  /** When the intercept happened — a new Source's suggested date. */
  runDate: string;
  canEdit: boolean;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table intercept-signals-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Reported as</th>
            <th>Intercepted parameters</th>
            <th>Already in the library?</th>
            <th>Notes</th>
            <th>Into the library</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((s, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <ReportedAs unknown={s.reported_as_unknown} />
              </td>
              <td>
                <ObservedValuesTable sets={s.observed_values} />
              </td>
              <td>
                <Coverage sets={s.observed_values} modes={modes} />
              </td>
              <td className="wrap-text">{s.notes ?? "—"}</td>
              <td>
                <AddSignalToSource
                  emitterId={emitterId}
                  sources={sources}
                  signal={s}
                  label={`${runTitle} — signal ${i + 1}`}
                  canEdit={canEdit}
                  newSourceName={runTitle}
                  newSourceDate={runDate}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
