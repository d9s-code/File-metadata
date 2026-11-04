import { Fragment, useMemo, useState } from "react";
import type { ObservedValues } from "../../api/testRecords";
import type { TestResult } from "../../types/domain";
import { ModeMultiSelect, type ModeNameOption } from "./ModeMultiSelect";
import { ObservedValuesEditor } from "./ObservedValuesEditor";
import { ObservedValuesTable } from "./ObservedValuesTable";
import { AutoGrowTextarea } from "../common/AutoGrowTextarea";
import { MenuButton } from "../common/MenuButton";
import { lineOutcomeLabel, nonEmptySets, TEST_RESULTS } from "./testFormat";
import { matchesWords, searchWords } from "../../utils/wordSearch";

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
  const [paramsOpen, setParamsOpen] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const words = searchWords(filter);
    return words.length ? lines.filter((l) => matchesWords(l.label, words)) : lines;
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
        <MenuButton
          label="Bulk ▾"
          className="button secondary small"
          title="Change every SIM line the filter shows at once"
          items={[
            { label: "Include all shown", onSelect: () => visible.forEach((l) => patch(l.id, { included: true })) },
            { label: "Exclude all shown", onSelect: () => visible.forEach((l) => patch(l.id, { included: false })) },
            ...TEST_RESULTS.map((o) => ({
              label: `Set included to ${lineOutcomeLabel(o)}`,
              onSelect: () => visible.forEach((l) => entries[l.id]?.included && patch(l.id, { outcome: o })),
            })),
          ]}
        />
      </div>

      <table className="data-table test-results-table" data-resize-key="test-run-sim-lines">
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
            const logged = nonEmptySets(entry.observedValues).length > 0;
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
                    {/* While it's open, the editor below is the table. */}
                    {!paramsOpen.has(l.id) && <ObservedValuesTable sets={entry.observedValues} empty="" />}
                    <button type="button" className="link-button" disabled={off} onClick={() => toggleParams(l.id)}>
                      {paramsOpen.has(l.id) ? "Done" : logged ? "Edit" : "+ Log"}
                    </button>
                  </td>
                  <td>
<AutoGrowTextarea
                      className="notes-field"
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
                        autoFocus
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
