import { Fragment, useState } from "react";
import type { EwGroup, FunctionGroup, Mode, ModeGenerationBatch, Source } from "../../types/domain";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { HoverInfo } from "../common/InfoPopover";
import { RequireRole } from "../../auth/RequireAuth";
import { SortableColumnHeader, type ColumnType } from "../common/SortableColumnHeader";
import {
  groupModesForDisplay,
  jitterOrFrameTimeDisplay,
  priDisplay,
  pwDisplay,
  rangeMatchingTags,
  rfDisplay,
  type ModeSortKey,
  type SortDir,
} from "./modeFormat";
import { EwGroupHoverDetail, ModeHoverDetail, SourceHoverDetail, StaggerSequenceBox } from "./ModeHoverDetails";
import { TestDerivedBadge } from "./TestDerivedBadge";
import { InterceptDerivedBadge } from "./InterceptDerivedBadge";
import { LastTestedCell } from "./LastTestedCell";
import { ModeEditForm } from "./ModeEditForm";

export function ModesTable({
  emitterId,
  modes,
  batches,
  collapseBatches,
  ewGroupsById,
  sourcesById,
  functionGroupsById,
  sortKey,
  sortDir,
  onSort,
  onClear,
  onDelete,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  onToggleSelectBatch,
  showEngineered,
}: {
  emitterId: string;
  modes: Mode[];
  batches: ModeGenerationBatch[];
  collapseBatches: boolean;
  ewGroupsById: Record<string, EwGroup>;
  sourcesById: Record<string, Source>;
  functionGroupsById: Record<string, FunctionGroup>;
  sortKey: ModeSortKey;
  sortDir: SortDir;
  onSort: (key: ModeSortKey, dir: SortDir) => void;
  onClear: () => void;
  onDelete: (modeId: string, ewGroupId: string, name: string) => void;
  selected: Set<string>;
  onToggleSelect: (modeId: string) => void;
  onToggleSelectAll: () => void;
  onToggleSelectBatch: (modeIds: string[]) => void;
  showEngineered: boolean;
}) {
  const [editingModeId, setEditingModeId] = useState<string | null>(null);
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(new Set());
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const editTitle = canEdit ? undefined : "Start editing this Emitter first";
  const batchNameById = Object.fromEntries(batches.map((b) => [b.id, b.name_prefix]));

  function toggleExpandBatch(batchId: string) {
    setExpandedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }

  const header = (label: string, key: ModeSortKey, columnType?: ColumnType) => (
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

  function renderModeRow(m: Mode) {
    const ewGroup = ewGroupsById[m.ew_group_id];
    const source = sourcesById[m.source_id];
    const isSelected = selected.has(m.id);
    const rf = rfDisplay(m, showEngineered);
    const pw = pwDisplay(m, showEngineered);
    const pri = priDisplay(m, showEngineered);
    const jft = jitterOrFrameTimeDisplay(m, showEngineered);

    return (
      <Fragment key={m.id}>
              <tr className={isSelected ? "selected-row" : ""}>
                <td>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelect(m.id)}
                    aria-label={`Select ${m.name}`}
                  />
                </td>
                <td>
                  <HoverInfo label={<>{m.name}{m.notes && " 📝"}</>}>
                    <ModeHoverDetail mode={m} source={sourcesById[m.source_id]} />
                  </HoverInfo>
                  <TestDerivedBadge emitterId={emitterId} records={m.derived_from_test_records} />
                  <InterceptDerivedBadge intercepts={m.derived_from_intercepts} />
                </td>
                <td>{rf.min ?? "—"}</td>
                <td>
                  {rf.max ?? "—"}
                  {!!rf.delta && <span className="jitter-subline">±{rf.delta} MHz delta</span>}
                </td>
                <td>{m.pri_type.toUpperCase()}</td>
                {m.pri_type === "stagger" ? (
                  <td colSpan={2}>
                    <StaggerSequenceBox mode={m} />
                  </td>
                ) : m.pri_type === "fixed" ? (
                  <>
                    <td>{pri.min ?? "—"}</td>
                    <td>
                      {pri.max ?? "—"}
                      {!!pri.delta && <span className="jitter-subline">±{pri.delta} µs delta</span>}
                    </td>
                  </>
                ) : (
                  <td colSpan={2}>{m.pri_type === "cw" ? "CW (constant)" : "—"}</td>
                )}
                <td>{pw.min ?? "—"}</td>
                <td>
                  {pw.max ?? "—"}
                  {!!pw.delta && <span className="jitter-subline">±{pw.delta} µs delta</span>}
                </td>
                <td>
                  {jft.label ? (
                    <>
                      {jft.label} {jft.min ?? "—"} µs
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {jft.label ? (
                    <>
                      {jft.max != null && (
                        <>
                          {jft.label} {jft.max} µs
                        </>
                      )}
                      {!!jft.delta && <span className="jitter-subline">±{jft.delta} µs delta</span>}
                      {jft.max == null && !jft.delta && "—"}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {rangeMatchingTags(m).length > 0 ? (
                    rangeMatchingTags(m).map((tag) => (
                      <span key={tag} className="status-badge range-matching-tag">
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="hint-text">—</span>
                  )}
                </td>
                <td>
                  {ewGroup ? (
                    <HoverInfo label={ewGroup.name}>
                      <EwGroupHoverDetail ewGroup={ewGroup} />
                    </HoverInfo>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {m.function_group_id ? functionGroupsById[m.function_group_id]?.name ?? "—" : "—"}
                </td>
                <td>
                  {source ? (
                    <HoverInfo label={source.name}>
                      <SourceHoverDetail emitterId={emitterId} source={source} />
                    </HoverInfo>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {m.last_tested_at ? (
                    <LastTestedCell
                      emitterId={emitterId}
                      date={m.last_tested_at}
                      result={m.last_test_result}
                      testRecordId={m.last_test_record_id}
                    />
                  ) : (
                    <span className="hint-text">never</span>
                  )}
                </td>
                <td>
                  <RequireRole minimum="editor">
                    <div className="flex gap-1">
                      <button
                        className="link-button"
                        disabled={!canEdit}
                        title={editTitle}
                        onClick={() => setEditingModeId(editingModeId === m.id ? null : m.id)}
                      >
                        {editingModeId === m.id ? "Cancel edit" : "Edit"}
                      </button>{" "}
                      <button
                        className="link-button"
                        disabled={!canEdit}
                        title={editTitle}
                        onClick={() => onDelete(m.id, m.ew_group_id, m.name)}
                      >
                        Delete
                      </button>
                    </div>
                  </RequireRole>
                </td>
              </tr>
              {editingModeId === m.id && canEdit && (
                <tr>
                  <td colSpan={17}>
                    <ModeEditForm
                      emitterId={emitterId}
                      mode={m}
                      functionGroups={Object.values(functionGroupsById)}
                      onDone={() => setEditingModeId(null)}
                    />
                  </td>
                </tr>
              )}
      </Fragment>
    );
  }

  const displayRows = groupModesForDisplay(modes, collapseBatches);
  const allVisibleSelected = modes.length > 0 && modes.every((m) => selected.has(m.id));
  const someVisibleSelected = modes.some((m) => selected.has(m.id));

  return (
    <div className="matrix-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                }}
                onChange={onToggleSelectAll}
                aria-label="Select all"
              />
            </th>
            {header("Name", "name")}
            {header("RF Min", "rf_min", "number")}
            {header("RF Max", "rf_max", "number")}
            {header("PRI Type", "pri_type")}
            {header("PRI Min", "pri_min", "number")}
            {header("PRI Max", "pri_max", "number")}
            {header("PW Min", "pw_min", "number")}
            {header("PW Max", "pw_max", "number")}
            <th>Jitter/Frametime Min</th>
            <th>Jitter/Frametime Max</th>
            {header("Range Matching", "range_matching")}
            {header("EW Group", "ew_group")}
            {header("Function Group", "function_group")}
            {header("Source", "source")}
            {header("Last Tested", "last_tested", "date")}
            <th className="w-32"></th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row) => {
            if (row.type === "mode") return renderModeRow(row.mode);

            const isExpanded = expandedBatchIds.has(row.batchId);
            const batchIds = row.modes.map((m) => m.id);
            const allSelected = batchIds.every((id) => selected.has(id));
            const someSelected = batchIds.some((id) => selected.has(id));
            return (
              <Fragment key={row.batchId}>
                <tr className="batch-summary-row">
                  <td>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allSelected && someSelected;
                      }}
                      onChange={() => onToggleSelectBatch(batchIds)}
                      aria-label={`Select all Modes in batch ${batchNameById[row.batchId] ?? row.batchId}`}
                    />
                  </td>
                  <td colSpan={16}>
                    <button type="button" className="link-button" onClick={() => toggleExpandBatch(row.batchId)}>
                      {isExpanded ? "▼" : "▶"} {batchNameById[row.batchId] ?? "Generation batch"} — {row.modes.length} Modes
                    </button>
                  </td>
                </tr>
                {isExpanded && row.modes.map((m) => renderModeRow(m))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
