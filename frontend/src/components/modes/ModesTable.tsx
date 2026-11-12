import { Fragment, useRef, useState, type ReactNode } from "react";
import type { EwGroup, Mode, ModeGenerationBatch, Source } from "../../types/domain";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { HoverInfo } from "../common/InfoPopover";
import { RequireRole, useHasRole } from "../../auth/RequireAuth";
import { useFitToViewport } from "../common/useFitToViewport";
import { SortableColumnHeader, type ColumnType } from "../common/SortableColumnHeader";
import { useColumnVisibility, useColumnVisibilityMenu, type ToggleableColumn } from "../common/ColumnVisibilityMenu";
import {
  batchSpan,
  groupModesForDisplay,
  jitterOrFrameTimeDisplay,
  priDisplay,
  priTypeLabel,
  pwDisplay,
  rangeMatchingTags,
  rfDisplay,
  spanText,
  type ModeSortKey,
  type SortDir,
} from "./modeFormat";
import {
  EwGroupHoverDetail,
  latestSource,
  ModeHoverDetail,
  ModeSourcesList,
  StaggerSequenceBox,
} from "./ModeHoverDetails";
import { TestDerivedBadge } from "./TestDerivedBadge";
import { InterceptDerivedBadge } from "./InterceptDerivedBadge";
import { LastTestedCell } from "./LastTestedCell";
import { ModeDuplicateDialog, ModeEditDialog } from "./ModeDialogs";
import { InlineEditCell, type InlineMove } from "./InlineEditCell";
import { inlineFieldFor, type InlineField } from "./inlineModeEdit";
import { MenuButton } from "../common/MenuButton";

type ModeColumnId =
  | "name"
  | "rf_min"
  | "rf_max"
  | "pri_type"
  | "pri_min"
  | "pri_max"
  | "pw_min"
  | "pw_max"
  | "rf_delta"
  | "pri_delta"
  | "pw_delta"
  | "jitter"
  | "frame_time"
  | "range_matching"
  | "confirmation_quality"
  | "confirmation_quantity"
  | "ew_group"
  | "source"
  | "last_tested";

/** Every data column, in display order. The selection checkbox and the
 * actions column are always shown and aren't listed. */
const MODE_COLUMNS: (ToggleableColumn<ModeColumnId> & { sortKey?: ModeSortKey; type?: ColumnType })[] = [
  { id: "name", label: "Name", sortKey: "name", hideable: false },
  { id: "rf_min", label: "RF min (MHz)", sortKey: "rf_min", type: "number" },
  { id: "rf_max", label: "RF max (MHz)", sortKey: "rf_max", type: "number" },
  { id: "rf_delta", label: "RF Δ (MHz)", defaultHidden: true },
  { id: "pri_type", label: "PRI type", sortKey: "pri_type" },
  { id: "pri_min", label: "PRI min (µs)", sortKey: "pri_min", type: "number" },
  { id: "pri_max", label: "PRI max (µs)", sortKey: "pri_max", type: "number" },
  { id: "pri_delta", label: "PRI Δ (µs)", defaultHidden: true },
  { id: "jitter", label: "Jitter (µs)" },
  { id: "frame_time", label: "Frame time (µs)" },
  { id: "pw_min", label: "PW min (µs)", sortKey: "pw_min", type: "number" },
  { id: "pw_max", label: "PW max (µs)", sortKey: "pw_max", type: "number" },
  { id: "pw_delta", label: "PW Δ (µs)", defaultHidden: true },
  { id: "range_matching", label: "Range matching", sortKey: "range_matching" },
  { id: "confirmation_quality", label: "Confirmation quality", sortKey: "confirmation_quality", type: "number" },
  { id: "confirmation_quantity", label: "Confirmation quantity", sortKey: "confirmation_quantity", type: "number" },
  { id: "ew_group", label: "EW Group", sortKey: "ew_group" },
  { id: "source", label: "Sources", sortKey: "source" },
  { id: "last_tested", label: "Last seen", sortKey: "last_tested", type: "date" },
];

function rangeText(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  if (max == null || min === max) return String(min ?? max);
  return `${min}–${max}`;
}

function deltaText(delta: number | null | undefined): string {
  return delta == null ? "—" : `±${delta}`;
}

/** Columns holding numbers: set in figures and aligned for comparing down
 * the column (each style decides how). */
const NUMBER_COLUMNS = new Set<ModeColumnId>([
  "rf_min", "rf_max", "rf_delta", "pri_min", "pri_max", "pri_delta", "pw_min", "pw_max", "pw_delta",
  "jitter", "frame_time", "confirmation_quality", "confirmation_quantity",
]);

export function ModesTable({
  emitterId,
  modes,
  batches,
  collapseBatches,
  ewGroupsById,
  sourcesById,
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
  // A value being changed in its cell (double-click to start).
  const [cellEdit, setCellEdit] = useState<{ modeId: string; field: InlineField } | null>(null);
  const isEditor = useHasRole("editor");
  const inlineEditable = canEdit && isEditor;
  const scrollRef = useRef<HTMLDivElement>(null);
  useFitToViewport(scrollRef);
  const batchNameById = Object.fromEntries(batches.map((b) => [b.id, b.name_prefix]));
  const columns = useColumnVisibility("modesTable.hiddenColumns", MODE_COLUMNS);
  const columnMenu = useColumnVisibilityMenu(columns);
  const visibleColumns = MODE_COLUMNS.filter((c) => columns.isVisible(c.id));

  function toggleExpandBatch(batchId: string) {
    setExpandedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }

  const header = (label: string, key: ModeSortKey, columnType?: ColumnType, className?: string) => (
    <SortableColumnHeader
      className={className}
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
    const isSelected = selected.has(m.id);
    const rf = rfDisplay(m, showEngineered);
    const pw = pwDisplay(m, showEngineered);
    const pri = priDisplay(m, showEngineered);
    const jft = jitterOrFrameTimeDisplay(m, showEngineered);

    const isFixed = m.pri_type === "fixed";
    const priMinShown = columns.isVisible("pri_min");

    // The row's values that can be changed in place, in column order (Tab moves along them).
    const fieldOf = (column: ModeColumnId) => (inlineEditable ? inlineFieldFor(column, m, priMinShown) : null);
    const rowFields = [...new Set(visibleColumns.map((c) => fieldOf(c.id)).filter((f): f is InlineField => f != null))];
    function finishCellEdit(field: InlineField, move: InlineMove) {
      const next = rowFields[rowFields.indexOf(field) + (move === "next" ? 1 : -1)];
      setCellEdit(move !== "close" && next ? { modeId: m.id, field: next } : null);
    }
    /** A cell, editable in place when its column holds one of the Mode's values. */
    function td(column: ModeColumnId, content: ReactNode, colSpan?: number, notNumber = false) {
      const field = fieldOf(column);
      const num = !notNumber && NUMBER_COLUMNS.has(column) ? "num" : undefined;
      if (!field) return <td colSpan={colSpan} className={num}>{content}</td>;
      if (cellEdit?.modeId === m.id && cellEdit.field === field) {
        return (
          <InlineEditCell
            emitterId={emitterId}
            mode={m}
            field={field}
            colSpan={colSpan}
            programmedHint={showEngineered && /(Min|Max)$/.test(field)}
            onDone={(move) => finishCellEdit(field, move)}
          />
        );
      }
      return (
        <td
          colSpan={colSpan}
          className={num ? "inline-editable num" : "inline-editable"}
          title="Double-click to change"
          onDoubleClick={() => setCellEdit({ modeId: m.id, field })}
        >
          {content}
        </td>
      );
    }

    // Stagger and CW Modes have no PRI min/max; one cell spans whichever of
    // the two PRI columns are shown (a stagger's steps, editable there).
    const priSpan = (priMinShown ? 1 : 0) + (columns.isVisible("pri_max") ? 1 : 0);
    const priSpanning = (column: ModeColumnId) =>
      td(column, m.pri_type === "stagger" ? <StaggerSequenceBox mode={m} /> : m.pri_type === "cw" ? "CW (constant)" : "—", priSpan, true);

    const cells: Record<ModeColumnId, () => ReactNode | null> = {
      name: () =>
        td(
          "name",
          <>
            <HoverInfo label={<>{m.name}{m.notes && " 📝"}</>}>
              <ModeHoverDetail mode={m} source={latestSource(m, sourcesById)} />
            </HoverInfo>
            <TestDerivedBadge emitterId={emitterId} records={m.derived_from_test_records} />
            <InterceptDerivedBadge intercepts={m.derived_from_intercepts} />
          </>,
        ),
      rf_min: () => td("rf_min", rf.min ?? "—"),
      rf_max: () => td("rf_max", rf.max ?? "—"),
      rf_delta: () => td("rf_delta", deltaText(m.line?.rf_delta)),
      pri_type: () => <td>{priTypeLabel(m.pri_type)}</td>,
      pri_min: () => (isFixed ? td("pri_min", pri.min ?? "—") : priSpanning("pri_min")),
      pri_max: () => (isFixed ? td("pri_max", pri.max ?? "—") : priMinShown ? null : priSpanning("pri_max")),
      pri_delta: () => td("pri_delta", deltaText(m.pri_type === "stagger" ? m.line?.frame_time_delta_us : m.line?.pri_delta)),
      pw_min: () => td("pw_min", pw.min ?? "—"),
      pw_max: () => td("pw_max", pw.max ?? "—"),
      pw_delta: () => td("pw_delta", deltaText(m.line?.pw_delta)),
      jitter: () => td("jitter", jft.label === "jitter" ? rangeText(jft.min, jft.max) : <span className="hint-text">—</span>),
      frame_time: () => (
        <td className="num">{jft.label === "frametime" ? rangeText(jft.min, jft.max) : <span className="hint-text">—</span>}</td>
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
      confirmation_quality: () => td("confirmation_quality", `${m.confirmation_quality}%`),
      confirmation_quantity: () => td("confirmation_quantity", m.confirmation_quantity),
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
      source: () => (
        <td>
          <ModeSourcesList emitterId={emitterId} mode={m} sourcesById={sourcesById} />
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
              counts={m.seen_counts}
            />
          ) : (
            <span className="hint-text" title="Not seen in any test run yet">never</span>
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
                <td className="sticky-end row-actions">
                  <RequireRole minimum="editor">
                    <MenuButton
                      label="⋯"
                      className="row-menu-button"
                      ariaLabel={`Actions for ${m.name}`}
                      items={[
                        {
                          label: "Edit",
                          onSelect: () => setEditingModeId(m.id),
                          disabled: !canEdit,
                          title: editTitle,
                        },
                        {
                          label: "Duplicate",
                          onSelect: () => setDuplicatingModeId(m.id),
                          disabled: !canEdit,
                          title: editTitle ?? "Start a new Mode pre-filled with this one's line",
                        },
                        {
                          label: "Delete",
                          onSelect: () => onDelete(m.id, m.ew_group_id, m.name),
                          disabled: !canEdit,
                          title: editTitle,
                          danger: true,
                        },
                      ]}
                    />
                  </RequireRole>
                </td>
              </tr>
      </Fragment>
    );
  }

  /** A collapsed batch's row: its name in the Name column, and in each
   * value column the lowest and highest across its Modes. */
  function renderBatchCells(batchId: string, batchModes: Mode[], isExpanded: boolean) {
    const s = batchSpan(batchModes, showEngineered);
    const n = batchModes.length;
    const value = (column: ModeColumnId, text: string, title: string) => (
      <td key={column} className={NUMBER_COLUMNS.has(column) ? "batch-span num" : "batch-span"} title={`${title} — across the batch's ${n} Modes`}>
        {text === "—" ? <span className="hint-text">—</span> : text}
      </td>
    );
    const groupNames = s.ewGroupIds.map((id) => ewGroupsById[id]?.name).filter(Boolean);
    const cells: Record<ModeColumnId, () => ReactNode> = {
      name: () => (
        <td key="name">
          <button
            type="button"
            className="link-button"
            aria-expanded={isExpanded}
            onClick={() => toggleExpandBatch(batchId)}
          >
            {isExpanded ? "▼" : "▶"} {batchNameById[batchId] ?? "Generation batch"} — {n} Modes
          </button>
        </td>
      ),
      rf_min: () => value("rf_min", spanText([s.rf[0], s.rf[0]]), "Lowest RF"),
      rf_max: () => value("rf_max", spanText([s.rf[1], s.rf[1]]), "Highest RF"),
      rf_delta: () => value("rf_delta", spanText(s.rfDelta), "RF Δ, lowest to highest"),
      pri_type: () => value("pri_type", s.priTypes.join(", "), "PRI types"),
      pri_min: () => value("pri_min", spanText([s.pri[0], s.pri[0]]), "Lowest PRI (stagger steps included)"),
      pri_max: () => value("pri_max", spanText([s.pri[1], s.pri[1]]), "Highest PRI (stagger steps included)"),
      pri_delta: () => value("pri_delta", spanText(s.priDelta), "PRI Δ, lowest to highest"),
      jitter: () => value("jitter", spanText(s.jitter), "Jitter, lowest to highest"),
      frame_time: () => value("frame_time", spanText(s.frameTime), "Frame time, lowest to highest"),
      pw_min: () => value("pw_min", spanText([s.pw[0], s.pw[0]]), "Lowest PW"),
      pw_max: () => value("pw_max", spanText([s.pw[1], s.pw[1]]), "Highest PW"),
      pw_delta: () => value("pw_delta", spanText(s.pwDelta), "PW Δ, lowest to highest"),
      range_matching: () => <td key="range_matching" className="batch-span" />,
      confirmation_quality: () =>
        value("confirmation_quality", s.quality[0] == null ? "—" : `${spanText(s.quality)}%`, "Confirmation quality, lowest to highest"),
      confirmation_quantity: () => value("confirmation_quantity", spanText(s.quantity), "Confirmation quantity, lowest to highest"),
      ew_group: () =>
        value("ew_group", groupNames.length === 1 ? groupNames[0]! : `${s.ewGroupIds.length} EW Groups`, "EW Group"),
      source: () => <td key="source" className="batch-span" />,
      last_tested: () => <td key="last_tested" className="batch-span" />,
    };
    return visibleColumns.map((c) => cells[c.id]());
  }

  const displayRows = groupModesForDisplay(modes, collapseBatches);
  const editingMode = modes.find((m) => m.id === editingModeId);
  const duplicatingMode = modes.find((m) => m.id === duplicatingModeId);
  const allVisibleSelected = modes.length > 0 && modes.every((m) => selected.has(m.id));
  const someVisibleSelected = modes.some((m) => selected.has(m.id));

  return (
    <div className="matrix-scroll modes-scroll" ref={scrollRef}>
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
                <Fragment key={c.id}>{header(c.label, c.sortKey, c.type, NUMBER_COLUMNS.has(c.id) ? "num" : undefined)}</Fragment>
              ) : (
                <th key={c.id} className={NUMBER_COLUMNS.has(c.id) ? "num" : undefined}>
                  {c.label}
                </th>
              ),
            )}
            <th className="sticky-end row-actions" aria-label="Actions"></th>
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
                  {renderBatchCells(row.batchId, row.modes, isExpanded)}
                  <td className="sticky-end row-actions"></td>
                </tr>
                {isExpanded && row.modes.map((m) => renderModeRow(m))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {columnMenu.menu}
      {editingMode && canEdit && (
        <ModeEditDialog
          emitterId={emitterId}
          mode={editingMode}
          sources={Object.values(sourcesById)}
          onClose={() => setEditingModeId(null)}
        />
      )}
      {duplicatingMode && canEdit && (
        <ModeDuplicateDialog
          emitterId={emitterId}
          mode={duplicatingMode}
          ewGroups={Object.values(ewGroupsById)}
          sources={Object.values(sourcesById)}
          onClose={() => setDuplicatingModeId(null)}
        />
      )}
    </div>
  );
}
