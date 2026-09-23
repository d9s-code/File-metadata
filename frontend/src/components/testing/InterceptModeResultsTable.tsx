import { Fragment, useMemo, useState } from "react";
import type { ObservedValues } from "../../api/testRecords";
import type { FunctionGroup, TestResult } from "../../types/domain";
import { ObservedValuesEditor } from "./ObservedValuesEditor";
import { formatObservedValueLines, TEST_RESULTS } from "./testFormat";

export interface InterceptModeOption {
  id: string;
  name: string;
  function_group_id: string | null;
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
  functionGroups,
}: {
  modes: InterceptModeOption[];
  entries: Record<string, InterceptModeEntry>;
  onChange: (modeId: string, entry: InterceptModeEntry) => void;
  functionGroups?: FunctionGroup[];
}) {
  const [filter, setFilter] = useState("");
  const [onlyIntercepted, setOnlyIntercepted] = useState(false);
  const [paramsOpen, setParamsOpen] = useState<Set<string>>(new Set());
  const groupName = new Map((functionGroups ?? []).map((g) => [g.id, g.name]));

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return modes.filter(
      (m) => (!q || m.name.toLowerCase().includes(q)) && (!onlyIntercepted || entries[m.id]?.included),
    );
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

      <table className="data-table test-results-table">
        <thead>
          <tr>
            <th>Intercepted</th>
            <th>Mode</th>
            <th>Function Group</th>
            <th>Result</th>
            <th>Intercepted parameters</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((m) => {
            const entry = entries[m.id] ?? blankInterceptModeEntry();
            const off = !entry.included;
            const paramLines = formatObservedValueLines(entry.observedValues);
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
                  <td>{m.function_group_id ? groupName.get(m.function_group_id) ?? "—" : "—"}</td>
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
                    {paramLines.map((p, i) => (
                      <div key={i} className="param-summary">
                        {p}
                      </div>
                    ))}
                    <button type="button" className="link-button" disabled={off} onClick={() => toggleParams(m.id)}>
                      {paramsOpen.has(m.id) ? "Done" : paramLines.length ? "Edit" : "+ Log"}
                    </button>
                  </td>
                  <td>
                    <input
                      type="text"
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
                    <td colSpan={5}>
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
              <td colSpan={6} className="hint-text">
                {modes.length === 0 ? "This Emitter has no Modes yet." : "No Modes match the filter."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
