import { Fragment, useMemo, useState } from "react";
import type { ObservedValues } from "../../api/testRecords";
import type { TestResult } from "../../types/domain";
import { ObservedValuesEditor } from "./ObservedValuesEditor";
import { ObservedValuesTable } from "./ObservedValuesTable";
import { AutoGrowTextarea } from "../common/AutoGrowTextarea";
import { nonEmptySets, TEST_RESULTS } from "./testFormat";
import { matchesWords, searchWords } from "../../utils/wordSearch";

export interface InterceptModeOption {
  id: string;
  name: string;
  last_test_result: TestResult | null;
}

export interface InterceptModeEntry {
  included: boolean;
  result: TestResult;
  observedValues: ObservedValues[];
  notes: string;
}

export function blankInterceptModeEntry(): InterceptModeEntry {
  return { included: false, result: "pass", observedValues: [], notes: "" };
}

/** One row per Mode for an intercept test: tick the Modes that were
 * intercepted, then record how each did and what was measured. */
export function InterceptModeResultsTable({
  modes,
  entries,
  onChange,
}: {
  modes: InterceptModeOption[];
  entries: Record<string, InterceptModeEntry>;
  onChange: (modeId: string, entry: InterceptModeEntry) => void;
}) {
  const [filter, setFilter] = useState("");
  const [onlyIntercepted, setOnlyIntercepted] = useState(false);
  const [paramsOpen, setParamsOpen] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const words = searchWords(filter);
    return modes.filter((m) => matchesWords(m.name, words) && (!onlyIntercepted || entries[m.id]?.included));
  }, [modes, filter, onlyIntercepted, entries]);

  const includedCount = modes.filter((m) => entries[m.id]?.included).length;

  function patch(modeId: string, change: Partial<InterceptModeEntry>) {
    onChange(modeId, { ...(entries[modeId] ?? blankInterceptModeEntry()), ...change });
  }

  function toggleParams(modeId: string) {
    setParamsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(modeId)) next.delete(modeId);
      else next.add(modeId);
      return next;
    });
  }

  return (
    <div className="test-results-table-wrap">
      <div className="form-row test-results-toolbar">
        <input type="text" placeholder="Filter Modes…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="checkbox-label">
          <input type="checkbox" checked={onlyIntercepted} onChange={(e) => setOnlyIntercepted(e.target.checked)} />
          Only intercepted
        </label>
        <span className="hint-text">{includedCount} intercepted</span>
      </div>

      <table className="data-table test-results-table" data-resize-key="test-run-intercept-modes">
        <thead>
          <tr>
            <th>Intercepted</th>
            <th>Mode</th>
            <th>Result</th>
            <th>Intercepted parameters</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((m) => {
            const entry = entries[m.id] ?? blankInterceptModeEntry();
            const off = !entry.included;
            const logged = nonEmptySets(entry.observedValues).length > 0;
            return (
              <Fragment key={m.id}>
                <tr className={off ? "row-excluded" : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={entry.included}
                      aria-label={`${m.name} was intercepted`}
                      onChange={(e) => patch(m.id, { included: e.target.checked })}
                    />
                  </td>
                  <td>
                    {m.name}
                    {m.last_test_result && (
                      <span className="jitter-subline">
                        last: <span className={`test-result-badge test-result-${m.last_test_result}`}>{m.last_test_result}</span>
                      </span>
                    )}
                  </td>
                  <td>
                    <select
                      value={entry.result}
                      disabled={off}
                      aria-label={`Result for ${m.name}`}
                      className={`outcome-select test-result-${entry.result}`}
                      onChange={(e) => patch(m.id, { result: e.target.value as TestResult })}
                    >
                      {TEST_RESULTS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <ObservedValuesTable sets={entry.observedValues} empty="" />
                    <button type="button" className="link-button" disabled={off} onClick={() => toggleParams(m.id)}>
                      {paramsOpen.has(m.id) ? "Done" : logged ? "Edit" : "+ Log"}
                    </button>
                  </td>
                  <td>
<AutoGrowTextarea
                      className="notes-field"
                      value={entry.notes}
                      disabled={off}
                      placeholder="What happened"
                      aria-label={`Notes for ${m.name}`}
                      onChange={(e) => patch(m.id, { notes: e.target.value })}
                    />
                  </td>
                </tr>
                {paramsOpen.has(m.id) && !off && (
                  <tr className="params-editor-row">
                    <td></td>
                    <td colSpan={4}>
                      <ObservedValuesEditor
                        sets={entry.observedValues}
                        onChange={(sets) => patch(m.id, { observedValues: sets })}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={5} className="hint-text">
                {modes.length === 0 ? "This Emitter has no Modes yet." : "No Modes match the filter."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
