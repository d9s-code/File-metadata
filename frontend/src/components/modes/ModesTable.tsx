import { Fragment, useState, type ReactNode } from "react";
import type { EwGroup, FunctionGroup, Mode, ModeGenerationBatch, Source } from "../../types/domain";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { HoverInfo } from "../common/InfoPopover";
import { RequireRole } from "../../auth/RequireAuth";
import { SortableColumnHeader, type ColumnType } from "../common/SortableColumnHeader";
import { useColumnVisibility, useColumnVisibilityMenu, type ToggleableColumn } from "../common/ColumnVisibilityMenu";
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
import { ModeForm } from "./ModeForm";

type ModeColumnId =
  | "name"
  | "rf_min"
  | "rf_max"
  | "pri_type"
  | "pri_min"
  | "pri_max"
  | "pw_min"
  | "pw_max"
  | "jft_min"
  | "jft_max"
  | "range_matching"
  | "confirmation_quality"
  | "confirmation_quantity"
  | "ew_group"
  | "function_group"
  | "source"
  | "last_tested";

/** Every data column, in display order. The selection checkbox and the
 * actions column are always shown and aren't listed. */
const MODE_COLUMNS: (ToggleableColumn<ModeColumnId> & { sortKey?: ModeSortKey; type?: ColumnType })[] = [
  { id: "name", label: "Name", sortKey: "name", hideable: false },
  { id: "rf_min", label: "RF Min", sortKey: "rf_min", type: "number" },
  { id: "rf_max", label: "RF Max", sortKey: "rf_max", type: "number" },
  { id: "pri_type", label: "PRI Type", sortKey: "pri_type" },
  { id: "pri_min", label: "PRI Min", sortKey: "pri_min", type: "number" },
  { id: "pri_max", label: "PRI Max", sortKey: "pri_max", type: "number" },
  { id: "pw_min", label: "PW Min", sortKey: "pw_min", type: "number" },
  { id: "pw_max", label: "PW Max", sortKey: "pw_max", type: "number" },
  { id: "jft_min", label: "Jitter/Frametime Min" },
  { id: "jft_max", label: "Jitter/Frametime Max" },
  { id: "range_matching", label: "Range Matching", sortKey: "range_matching" },
  { id: "confirmation_quality", label: "Confirmation Quality", sortKey: "confirmation_quality", type: "number" },
  { id: "confirmation_quantity", label: "Confirmation Quantity", sortKey: "confirmation_quantity", type: "number" },
  { id: "ew_group", label: "EW Group", sortKey: "ew_group" },
  { id: "function_group", label: "Function Group", sortKey: "function_group" },
  { id: "source", label: "Source", sortKey: "source" },
  { id: "last_tested", label: "Last Tested", sortKey: "last_tested", type: "date" },
];

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
  const [duplicatingModeId, setDuplicatingModeId] = useState<string | null>(null);
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(new Set());
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const editTitle = canEdit ? undefined : "Start editing this Emitter first";
  const batchNameById = Object.fromEntries(batches.map((b) => [b.id, b.name_prefix]));
  const columns = useColumnVisibility("modesTable.hiddenColumns", MODE_COLUMNS);
  const columnMenu = useColumnVisibilityMenu(columns);
  const visibleColumns = MODE_COLUMNS.filter((c) => columns.isVisible(c.id));
  // Checkbox + visible data columns + actions.
  const fullSpan = columns.visibleCount + 2;

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

    // Stagger and CW Modes have no PRI min/max; one cell spans whichever of
    // the two PRI columns are shown.
    const priSpan = (columns.isVisible("pri_min") ? 1 : 0) + (columns.isVisible("pri_max") ? 1 : 0);
    const priSpanning =
      m.pri_type === "stagger" ? (
        <td colSpan={priSpan}>
          <StaggerSequenceBox mode={m} />
        </td>
      ) : (
        <td colSpan={priSpan}>{m.pri_type === "cw" ? "CW (constant)" : "—"}</td>
      );
    const isFixed = m.pri_type === "fixed";

    const cells: Record<ModeColumnId, () => ReactNode | null> = {
      name: () => (
        <td>
          <HoverInfo label={<>{m.name}{m.notes && " 📝"}</>}>
            <ModeHoverDetail mode={m} source={sourcesById[m.source_id]} />
          </HoverInfo>
          <TestDerivedBadge emitterId={emitterId} records={m.derived_from_test_records} />
          <InterceptDerivedBadge intercepts={m.derived_from_intercepts} />
        </td>
      ),
      rf_min: () => <td>{rf.min ?? "—"}</td>,
      rf_max: () => (
        <td>
          {rf.max ?? "—"}
          {!!rf.delta && <span className="jitter-subline">±{rf.delta} MHz delta</span>}
        </td>
      ),
      pri_type: () => <td>{m.pri_type.toUpperCase()}</td>,
      pri_min: () => (isFixed ? <td>{pri.min ?? "—"}</td> : priSpanning),
      pri_max: () =>
        isFixed ? (
          <td>
            {pri.max ?? "—"}
            {!!pri.delta && <span className="jitter-subline">±{pri.delta} µs delta</span>}
          </td>
        ) : columns.isVisible("pri_min") ? null : (
          priSpanning
        ),
      pw_min: () => <td>{pw.min ?? "—"}</td>,
      pw_max: () => (
        <td>
          {pw.max ?? "—"}
          {!!pw.delta && <span className="jitter-subline">±{pw.delta} µs delta</span>}
        </td>
      ),
      jft_min: () => (
        <td>
          {jft.label ? (
            <>
              {jft.label} {jft.min ?? "—"} µs
            </>
          ) : (
            "—"
          )}
        </td>
      ),
      jft_max: () => (
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
      ),
      range_matching: () => (
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
      ),
      confirmation_quality: () => <td>{m.confirmation_quality}%</td>,
      confirmation_quantity: () => <td>{m.confirmation_quantity}</td>,
      ew_group: () => (
        <td>
          {ewGroup ? (
            <HoverInfo label={ewGroup.name}>
              <EwGroupHoverDetail ewGroup={ewGroup} />
            </HoverInfo>
          ) : (
            "—"
          )}
        </td>
      ),
      function_group: () => (
        <td>{m.function_group_id ? functionGroupsById[m.function_group_id]?.name ?? "—" : "—"}</td>
      ),
      source: () => (
        <td>
          {source ? (
            <HoverInfo label={source.name}>
              <SourceHoverDetail emitterId={emitterId} source={source} />
            </HoverInfo>
          ) : (
            "—"
          )}
        </td>
      ),
      last_tested: () => (
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
      ),
    };

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
                {visibleColumns.map((c) => {
                  const content = cells[c.id]();
                  return content === null ? null : <Fragment key={c.id}>{content}</Fragment>;
                })}
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
                        className="link-button link-button-accent"
                        disabled={!canEdit}
                        title={editTitle ?? "Start a new Mode pre-filled with this one's line — pick a name and adjust what's different"}
                        onClick={() => setDuplicatingModeId(duplicatingModeId === m.id ? null : m.id)}
                      >
                        {duplicatingModeId === m.id ? "Cancel duplicate" : "Duplicate"}
                      </button>{" "}
                      <button
                        className="link-button link-button-danger"
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
                  <td colSpan={fullSpan}>
                    <ModeEditForm
                      emitterId={emitterId}
                      mode={m}
                      functionGroups={Object.values(functionGroupsById)}
                      sources={Object.values(sourcesById)}
                      onDone={() => setEditingModeId(null)}
                    />
                  </td>
                </tr>
              )}
              {duplicatingModeId === m.id && canEdit && (
                <tr>
                  <td colSpan={fullSpan}>
                    <ModeForm
                      emitterId={emitterId}
                      ewGroups={Object.values(ewGroupsById)}
                      sources={Object.values(sourcesById)}
                      functionGroups={Object.values(functionGroupsById)}
                      duplicateFrom={m}
                      onClose={() => setDuplicatingModeId(null)}
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
          <tr {...columnMenu.openProps}>
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
            {visibleColumns.map((c) =>
              c.sortKey ? (
                <Fragment key={c.id}>{header(c.label, c.sortKey, c.type)}</Fragment>
              ) : (
                <th key={c.id}>{c.label}</th>
              ),
            )}
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
                  <td colSpan={fullSpan - 1}>
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
      {columnMenu.menu}
    </div>
  );
}
