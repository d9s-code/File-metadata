import { Fragment, useMemo, useState } from "react";
import type { ObservedValues } from "../../api/testRecords";
import type { TestResult } from "../../types/domain";
import { ModeMultiSelect, type ModeNameOption } from "./ModeMultiSelect";
import { ObservedValuesEditor } from "./ObservedValuesEditor";
import { formatObservedValueLines, lineOutcomeLabel, TEST_RESULTS } from "./testFormat";

export interface SimLineOption {
  id: string;
  label: string;
}

export interface SimLineEntry {
  included: boolean;
  outcome: TestResult;
  interceptedModeIds: string[];
  observedValues: ObservedValues[];
  notes: string;
}

export function blankSimLineEntry(): SimLineEntry {
  return { included: true, outcome: "pass", interceptedModeIds: [], observedValues: [], notes: "" };
}

/** One row per SIM Test Line: whether it was part of this run, how it was
 * recognized, which Modes were reported for it, and what was measured. */
export function SimLineResultsTable({
  lines,
  entries,
  onChange,
  modes,
}: {
  lines: SimLineOption[];
  entries: Record<string, SimLineEntry>;
  onChange: (lineId: string, entry: SimLineEntry) => void;
  modes: ModeNameOption[];
}) {
  const [filter, setFilter] = useState("");
  const [bulkOutcome, setBulkOutcome] = useState<TestResult>("pass");
  const [paramsOpen, setParamsOpen] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? lines.filter((l) => l.label.toLowerCase().includes(q)) : lines;
  }, [lines, filter]);

  const includedCount = lines.filter((l) => entries[l.id]?.included).length;

  function patch(lineId: string, change: Partial<SimLineEntry>) {
    onChange(lineId, { ...(entries[lineId] ?? blankSimLineEntry()), ...change });
  }

  function toggleParams(lineId: string) {
    setParamsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  return (
    <div className="test-results-table-wrap">
      <div className="form-row test-results-toolbar">
        <input type="text" placeholder="Filter SIM lines…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="hint-text">
          {includedCount} of {lines.length} included
        </span>
        <button type="button" className="link-button" onClick={() => visible.forEach((l) => patch(l.id, { included: true }))}>
          Include all shown
        </button>
        <button type="button" className="link-button" onClick={() => visible.forEach((l) => patch(l.id, { included: false }))}>
          Exclude all shown
        </button>
        <label className="inline-date-label">
          Set included to
          <select value={bulkOutcome} onChange={(e) => setBulkOutcome(e.target.value as TestResult)}>
            {TEST_RESULTS.map((o) => (
              <option key={o} value={o}>
                {lineOutcomeLabel(o)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="icon-button"
          onClick={() => visible.forEach((l) => entries[l.id]?.included && patch(l.id, { outcome: bulkOutcome }))}
        >
          Apply
        </button>
      </div>

      <table className="data-table test-results-table">
        <thead>
          <tr>
            <th>In run</th>
            <th>SIM Test Line</th>
            <th>Outcome</th>
            <th>Intercepted as</th>
            <th>Intercepted parameters</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((l) => {
            const entry = entries[l.id] ?? blankSimLineEntry();
            const off = !entry.included;
            const paramLines = formatObservedValueLines(entry.observedValues);
            return (
              <Fragment key={l.id}>
                <tr className={off ? "row-excluded" : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={entry.included}
                      aria-label={`Include ${l.label}`}
                      onChange={(e) => patch(l.id, { included: e.target.checked })}
                    />
                  </td>
                  <td>{l.label}</td>
                  <td>
                    <select
                      value={entry.outcome}
                      disabled={off}
                      aria-label={`Outcome for ${l.label}`}
                      className={`outcome-select test-result-${entry.outcome}`}
                      onChange={(e) => patch(l.id, { outcome: e.target.value as TestResult })}
                    >
                      {TEST_RESULTS.map((o) => (
                        <option key={o} value={o}>
                          {lineOutcomeLabel(o)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <ModeMultiSelect
                      modes={modes}
                      selected={entry.interceptedModeIds}
                      disabled={off}
                      onChange={(ids) => patch(l.id, { interceptedModeIds: ids })}
                    />
                  </td>
                  <td>
                    {paramLines.map((p, i) => (
                      <div key={i} className="param-summary">
                        {p}
                      </div>
                    ))}
                    <button type="button" className="link-button" disabled={off} onClick={() => toggleParams(l.id)}>
                      {paramsOpen.has(l.id) ? "Done" : paramLines.length ? "Edit" : "+ Log"}
                    </button>
                  </td>
                  <td>
                    <input
                      type="text"
                      value={entry.notes}
                      disabled={off}
                      placeholder="What happened"
                      aria-label={`Notes for ${l.label}`}
                      onChange={(e) => patch(l.id, { notes: e.target.value })}
                    />
                  </td>
                </tr>
                {paramsOpen.has(l.id) && !off && (
                  <tr className="params-editor-row">
                    <td></td>
                    <td colSpan={5}>
                      <ObservedValuesEditor
                        sets={entry.observedValues}
                        onChange={(sets) => patch(l.id, { observedValues: sets })}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={6} className="hint-text">
                No SIM Test Lines match the filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
