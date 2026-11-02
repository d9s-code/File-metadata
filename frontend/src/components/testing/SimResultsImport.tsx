import { useMemo, useState } from "react";
import type { ModeNameOption } from "./ModeMultiSelect";
import { blankSimLineEntry, type SimLineEntry, type SimLineOption } from "./SimLineResultsTable";
import { parseResultsTable, RESULT_COLUMNS, type SequenceUnit } from "./simResultsTable";
import { formatObservedValueSet } from "./testFormat";

const UNIT_KEY = "simResultsImport.sequenceUnit";

function readUnit(): SequenceUnit {
  try {
    return localStorage.getItem(UNIT_KEY) === "us" ? "us" : "ns";
  } catch {
    return "ns";
  }
}

/** Fills the run's SIM line rows from a pasted results table: which Modes
 * each line was intercepted as, its measured values and notes. Outcomes are
 * left for you to set; lines with no row are taken out of the run. */
export function SimResultsImport({
  lines,
  modes,
  entries,
  onApply,
}: {
  lines: SimLineOption[];
  modes: ModeNameOption[];
  entries: Record<string, SimLineEntry>;
  onApply: (entries: Record<string, SimLineEntry>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [unit, setUnit] = useState<SequenceUnit>(readUnit);
  const [applied, setApplied] = useState<string | null>(null);

  const rows = useMemo(() => (text.trim() ? parseResultsTable(text, lines, modes, unit) : []), [text, lines, modes, unit]);
  const matched = rows.filter((r) => r.lineId);
  const unmatched = rows.filter((r) => !r.lineId);
  const matchedLines = new Set(matched.map((r) => r.lineId));
  const labelOf = (id: string) => lines.find((l) => l.id === id)?.label ?? "";
  const modeName = (id: string) => modes.find((m) => m.id === id)?.name ?? "?";

  function chooseUnit(next: SequenceUnit) {
    setUnit(next);
    try {
      localStorage.setItem(UNIT_KEY, next);
    } catch {
      // Remembering it is only a convenience.
    }
  }

  function apply() {
    const next: Record<string, SimLineEntry> = {};
    for (const line of lines) {
      const prev = entries[line.id] ?? blankSimLineEntry();
      const own = matched.filter((r) => r.lineId === line.id);
      if (!own.length) {
        next[line.id] = { ...prev, included: false };
        continue;
      }
      // Several rows for one line: each is one logged set; the Modes and notes add up.
      const ids = [...new Set(own.flatMap((r) => r.interceptedModeIds))];
      const notes = own.map((r) => r.notes).filter(Boolean).join("\n");
      next[line.id] = {
        ...prev,
        included: true,
        interceptedModeIds: ids,
        observedValues: own.map((r) => r.values).filter((v) => Object.keys(v).length > 0),
        notes: notes || prev.notes,
      };
    }
    onApply(next);
    setApplied(
      `Filled ${matchedLines.size} SIM line${matchedLines.size === 1 ? "" : "s"} from ${matched.length} row${matched.length === 1 ? "" : "s"}` +
        (lines.length - matchedLines.size ? `; ${lines.length - matchedLines.size} with no row taken out of the run` : "") +
        (unmatched.length ? `; ${unmatched.length} row${unmatched.length === 1 ? "" : "s"} matched no SIM line` : "") +
        ". Set each line's outcome below.",
    );
    setText("");
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="sim-results-import-bar">
        <button type="button" className="icon-button" onClick={() => setOpen(true)}>
          Import results from a table
        </button>
        {applied && <span className="hint-text">{applied}</span>}
      </div>
    );
  }

  return (
    <div className="sim-results-import">
      <p className="hint-text">
        Paste the result rows (no header) — select the cells in Excel or Sheets and paste. Columns, in order:{" "}
        {RESULT_COLUMNS.join(" · ")}. Rows are matched to SIM Test Lines by the first column (ignoring case and extra
        spaces); several rows for one line log several sets. Lines with no row are taken out of the run. Outcomes are
        left as they are, for you to set.
      </p>
      <div className="form-row">
        <label className="inline-date-label">
          Stagger sequence / jitter column in
          <select value={unit} onChange={(e) => chooseUnit(e.target.value as SequenceUnit)}>
            <option value="ns">ns</option>
            <option value="us">µs</option>
          </select>
        </label>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={"SIM 1\tSearch 1\t-40\t9350\tSimple\t1000\t990\t1010\t1\t10000\t1.2\t\tSeen twice"}
        aria-label="Pasted results"
      />
      {rows.length > 0 && (
        <>
          <p className="hint-text">
            {rows.length} row{rows.length === 1 ? "" : "s"} · {matchedLines.size} of {lines.length} SIM lines matched
            {unmatched.length > 0 && <strong> · {unmatched.length} matching no SIM line (left out)</strong>}
          </p>
          <div className="table-scroll">
            <table className="data-table sim-results-preview">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>SIM line</th>
                  <th>Intercepted as</th>
                  <th>Intercepted parameters</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row} className={r.lineId ? undefined : "row-excluded"}>
                    <td>{r.row}</td>
                    <td>
                      {r.lineId ? labelOf(r.lineId) : r.label}
                      {!r.lineId && <div className="error-text">No SIM Test Line by this name — left out</div>}
                    </td>
                    <td>{r.interceptedModeIds.map(modeName).join(", ") || "—"}</td>
                    <td>{formatObservedValueSet(r.values) ?? "—"}</td>
                    <td className="sim-results-notes">
                      {r.notes || "—"}
                      {r.warnings.map((w) => (
                        <div key={w} className="hint-text sim-results-warning">
                          ! {w}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="form-row">
        <button type="button" className="button primary" disabled={!matched.length} onClick={apply}>
          Fill the run from {matched.length} row{matched.length === 1 ? "" : "s"}
        </button>
        <button type="button" className="button secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
