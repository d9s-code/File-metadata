import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../common/Icon";
import { formatDate } from "../common/dates";
import { MenuButton } from "../common/MenuButton";
import { Link } from "react-router-dom";
import type { TestRecord } from "../../api/testRecords";
import type { TestResult } from "../../types/domain";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareNullable, compareStrings } from "../common/sortUtils";
import { lineOutcomeLabel, TEST_RESULTS, testResultLabel, testTypeLabel } from "./testFormat";

type SortKey = "date" | "version" | "sim_created" | "dwell" | "power" | "type" | "result" | "title";

function compareRecords(a: TestRecord, b: TestRecord, key: SortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "date":
      return compareStrings(a.test_date, b.test_date, dir);
    case "version":
      return compareNullable(a.emitter_version_number, b.emitter_version_number, dir);
    case "sim_created":
      return compareStrings(a.simulation_created_date, b.simulation_created_date, dir);
    case "dwell":
      return compareStrings(a.dwell, b.dwell, dir);
    case "power":
      return compareNullable(a.received_power_dbfs, b.received_power_dbfs, dir);
    case "type":
      return compareStrings(testTypeLabel(a.test_type), testTypeLabel(b.test_type), dir);
    case "result":
      return compareStrings(a.result ? testResultLabel(a.result) : null, b.result ? testResultLabel(b.result) : null, dir);
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
  renderDetail,
  renderDwell,
}: {
  records: TestRecord[];
  emitterId?: string;
  onDelete: (id: string) => Promise<unknown>;
  onRedo?: (record: TestRecord) => void;
  highlightId?: string;
  /** More about a run, shown under its row when opened (e.g. an MDF test's scenario); null — nothing more. */
  renderDetail?: (record: TestRecord) => ReactNode;
  /** The Dwell cell, in place of the run's dwell text (e.g. with its Strategy, and changing it). */
  renderDwell?: (record: TestRecord) => ReactNode;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(highlightId ? [highlightId] : []));
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const { confirmDelete, dialog } = useConfirmDialog();
  const highlightedRowRef = useRef<HTMLTableRowElement>(null);
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(records, compareRecords, "testRecords");

  useEffect(() => {
    if (highlightId) highlightedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId]);

  async function handleDelete(r: TestRecord) {
    if (await confirmDelete(`Delete the test record "${r.title}"?`)) await onDelete(r.id);
  }

  if (records.length === 0) return <p className="hint-text">No tests logged yet.</p>;

  const header = (label: string, key: SortKey, columnType?: "date" | "number") => (
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
            {emitterId && header("Version", "version", "number")}
            {header("Sim created", "sim_created", "date")}
            {header("Dwell", "dwell")}
            {header("Power (dBFS)", "power", "number")}
            {header("Type", "type")}
            {header("Result", "result")}
            {header("Title", "title")}
            <th>SIM Test Lines</th>
            <th>Modes</th>
            <th className="row-actions" aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const retested = r.retests_test_record_id ? records.find((x) => x.id === r.retests_test_record_id) : null;
            const exercised = r.modes.filter((m) => m.link_type === "exercised");
            const derived = r.modes.length - exercised.length;
            const detail = renderDetail?.(r) ?? null;
            const isOpen = !!detail && open.has(r.id);
            return (
              <Fragment key={r.id}>
              <tr
                ref={r.id === highlightId ? highlightedRowRef : undefined}
                className={r.id === highlightId ? "highlighted-row" : undefined}
              >
                <td>{formatDate(r.test_date)}</td>
                {emitterId && (
                  <td title={r.emitter_version_number == null ? "Logged before the Emitter had a saved version" : undefined}>
                    {r.emitter_version_number != null ? (
                      <Link to={`/emitters/${emitterId}/versions?version=${r.emitter_version_number}`}>
                        v{r.emitter_version_number}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                )}
                <td>{formatDate(r.simulation_created_date)}</td>
                <td>{renderDwell ? renderDwell(r) : (r.dwell ?? "—")}</td>
                <td>{r.received_power_dbfs ?? "—"}</td>
                <td>{testTypeLabel(r.test_type)}</td>
                <td>
                  <span
                    className={`test-result-badge test-result-${r.result}`}
                    title={r.computed_result ? `Set by hand (worked out: ${testResultLabel(r.computed_result)}) — ${r.result_note ?? ""}` : undefined}
                  >
                    {testResultLabel(r.result)}
                    {r.computed_result && (
                      <>
                        {" "}
                        <Icon name="edit" />
                      </>
                    )}
                  </span>
                </td>
                <td>
                  {emitterId ? (
                    <Link to={`/emitters/${emitterId}/tests/${r.id}`}>{r.title}</Link>
                  ) : detail ? (
                    <button
                      type="button"
                      className="link-button record-expand"
                      aria-expanded={isOpen}
                      title={isOpen ? "Hide what was observed" : "Show what was observed"}
                      onClick={() => toggle(r.id)}
                    >
                      {isOpen ? "▾" : "▸"} {r.title}
                    </button>
                  ) : (
                    r.title
                  )}
                  {r.scenario_verdicts && (
                    <span className="jitter-subline">
                      {r.scenario_verdicts.detected}/{r.scenario_verdicts.observed} detected · {r.scenario_verdicts.identified} identified ·{" "}
                      {r.scenario_verdicts.mixup_count} mix-up{r.scenario_verdicts.mixup_count === 1 ? "" : "s"}
                    </span>
                  )}
                  {retested && <span className="jitter-subline">Retest of: {retested.title}</span>}
                  {r.platform_test_id && (
                    <span className="jitter-subline">
                      Part of the Platform test{" "}
                      {r.platform_test_platform_id ? (
                        <Link to={`/platforms/${r.platform_test_platform_id}/tests/${r.platform_test_id}`}>
                          {r.platform_test_title}
                        </Link>
                      ) : (
                        r.platform_test_title
                      )}
                    </span>
                  )}
                  {r.notes && <span className="jitter-subline">{r.notes}</span>}
                </td>
                <td>
                  {r.lines.length > 0 ? <CountBadges counts={countBy(r.lines, (l) => l.outcome)} label={lineOutcomeLabel} /> : "—"}
                </td>
                <td>
                  {exercised.length > 0 && <CountBadges counts={countBy(exercised, (m) => m.result)} label={testResultLabel} />}
                  {derived > 0 && <span className="test-result-badge test-result-derived">{derived} Derived</span>}
                  {r.modes.length === 0 && "—"}
                </td>
                <td className="row-actions nowrap">
                  <RequireRole minimum="editor">
                    <MenuButton
                      label="⋯"
                      className="row-menu-button"
                      ariaLabel={`Actions for ${r.title}`}
                      items={[
                        ...(onRedo && (r.result === "fail" || r.result === "partial")
                          ? [{ label: "Redo test", onSelect: () => onRedo(r), title: "Start a new run pre-filled as a retest of this one" }]
                          : []),
                        { label: "Delete…", danger: true, onSelect: () => void handleDelete(r) },
                      ]}
                    />
                  </RequireRole>
                </td>
              </tr>
              {isOpen && (
                <tr className="record-detail-row">
                  <td colSpan={emitterId ? 11 : 10}>{detail}</td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {dialog}
    </>
  );
}
