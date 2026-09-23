import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type { TestRecord } from "../../api/testRecords";
import type { TestResult } from "../../types/domain";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareStrings } from "../common/sortUtils";
import { lineOutcomeLabel, TEST_RESULTS, testTypeLabel } from "./testFormat";

type SortKey = "date" | "sim_created" | "type" | "result" | "title";

function compareRecords(a: TestRecord, b: TestRecord, key: SortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "date":
      return compareStrings(a.test_date, b.test_date, dir);
    case "sim_created":
      return compareStrings(a.simulation_created_date, b.simulation_created_date, dir);
    case "type":
      return compareStrings(a.test_type, b.test_type, dir);
    case "result":
      return compareStrings(a.result, b.result, dir);
    case "title":
      return compareStrings(a.title, b.title, dir);
  }
}

function countBy<T>(items: T[], key: (item: T) => TestResult | null): Partial<Record<TestResult, number>> {
  const counts: Partial<Record<TestResult, number>> = {};
  for (const item of items) {
    const k = key(item);
    if (k) counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function CountBadges({ counts, label }: { counts: Partial<Record<TestResult, number>>; label: (r: TestResult) => string }) {
  return (
    <span className="test-record-mode-summary">
      {TEST_RESULTS.filter((r) => counts[r]).map((r) => (
        <span key={r} className={`test-result-badge test-result-${r}`}>
          {counts[r]} {label(r)}
        </span>
      ))}
    </span>
  );
}

/** Test history as one summary row per run. For Emitter-scoped runs
 * (`emitterId` given) each row opens the run's own page. */
export function TestRecordsTable({
  records,
  emitterId,
  onDelete,
  onRedo,
  highlightId,
}: {
  records: TestRecord[];
  emitterId?: string;
  onDelete: (id: string) => Promise<unknown>;
  onRedo?: (record: TestRecord) => void;
  highlightId?: string;
}) {
  const { confirmDelete, dialog } = useConfirmDialog();
  const highlightedRowRef = useRef<HTMLTableRowElement>(null);
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(records, compareRecords);

  useEffect(() => {
    if (highlightId) highlightedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId]);

  async function handleDelete(r: TestRecord) {
    if (await confirmDelete(`Delete the test record "${r.title}"?`)) await onDelete(r.id);
  }

  if (records.length === 0) return <p className="hint-text">No tests logged yet.</p>;

  const header = (label: string, key: SortKey, columnType?: "date") => (
    <SortableColumnHeader
      label={label}
      columnKey={key}
      columnType={columnType}
      activeKey={sortKey}
      activeDir={sortDir}
      onSort={onSort}
      onClear={onClear}
    />
  );

  return (
    <>
      <table className="data-table">
        <thead>
          <tr>
            {header("Date", "date", "date")}
            {header("Sim created", "sim_created", "date")}
            {header("Type", "type")}
            {header("Result", "result")}
            {header("Title", "title")}
            <th>SIM Test Lines</th>
            <th>Modes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const retested = r.retests_test_record_id ? records.find((x) => x.id === r.retests_test_record_id) : null;
            const exercised = r.modes.filter((m) => m.link_type === "exercised");
            const derived = r.modes.length - exercised.length;
            return (
              <tr
                key={r.id}
                ref={r.id === highlightId ? highlightedRowRef : undefined}
                className={r.id === highlightId ? "highlighted-row" : undefined}
              >
                <td>{r.test_date}</td>
                <td>{r.simulation_created_date ?? "—"}</td>
                <td>{testTypeLabel(r.test_type)}</td>
                <td>
                  <span className={`test-result-badge test-result-${r.result}`}>{r.result}</span>
                </td>
                <td>
                  {emitterId ? <Link to={`/emitters/${emitterId}/tests/${r.id}`}>{r.title}</Link> : r.title}
                  {retested && <span className="jitter-subline">Retest of: {retested.title}</span>}
                  {r.notes && <span className="jitter-subline">{r.notes}</span>}
                </td>
                <td>
                  {r.lines.length > 0 ? <CountBadges counts={countBy(r.lines, (l) => l.outcome)} label={lineOutcomeLabel} /> : "—"}
                </td>
                <td>
                  {exercised.length > 0 && <CountBadges counts={countBy(exercised, (m) => m.result)} label={(res) => res} />}
                  {derived > 0 && <span className="test-result-badge test-result-derived">{derived} derived</span>}
                  {r.modes.length === 0 && "—"}
                </td>
                <td>
                  {emitterId && (
                    <>
                      <Link to={`/emitters/${emitterId}/tests/${r.id}`}>Open</Link>{" "}
                    </>
                  )}
                  <RequireRole minimum="editor">
                    {onRedo && (r.result === "fail" || r.result === "partial") && (
                      <>
                        <button
                          className="link-button"
                          onClick={() => onRedo(r)}
                          title="Start a new run pre-filled as a retest of this one"
                        >
                          Redo test
                        </button>{" "}
                      </>
                    )}
                    <button className="link-button link-button-danger" onClick={() => void handleDelete(r)}>
                      Delete
                    </button>
                  </RequireRole>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {dialog}
    </>
  );
}
