import { Fragment, useState } from "react";
import type { EwGroup, Mode, Source } from "../../types/domain";
import { HoverInfo } from "../common/InfoPopover";
import { RequireRole } from "../../auth/RequireAuth";
import { SortableColumnHeader, type ColumnType } from "../common/SortableColumnHeader";
import { rangeMatchingTags, type ModeSortKey, type SortDir } from "./modeFormat";
import { EwGroupHoverDetail, ModeHoverDetail, SourceHoverDetail, StaggerSequenceBox } from "./ModeHoverDetails";
import { TestDerivedBadge } from "./TestDerivedBadge";
import { LastTestedCell } from "./LastTestedCell";
import { ModeEditForm } from "./ModeEditForm";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";

export function ModesTable({
  emitterId,
  modes,
  ewGroupsById,
  sourcesById,
  sortKey,
  sortDir,
  onSort,
  onClear,
  onDelete,
}: {
  emitterId: string;
  modes: Mode[];
  ewGroupsById: Record<string, EwGroup>;
  sourcesById: Record<string, Source>;
  sortKey: ModeSortKey;
  sortDir: SortDir;
  onSort: (key: ModeSortKey, dir: SortDir) => void;
  onClear: () => void;
  onDelete: (modeId: string, ewGroupId: string, name: string) => void;
}) {
  const [editingModeId, setEditingModeId] = useState<string | null>(null);
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const editTitle = canEdit ? undefined : "Start editing this Emitter first";

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

  return (
    <div className="matrix-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {header("Name", "name")}
            {header("EW Group", "ew_group")}
            {header("Source", "source")}
            {header("RF Min", "rf_min", "number")}
            {header("RF Max", "rf_max", "number")}
            {header("PW Min", "pw_min", "number")}
            {header("PW Max", "pw_max", "number")}
            {header("PRI Type", "pri_type")}
            {header("PRI Min", "pri_min", "number")}
            {header("PRI Max", "pri_max", "number")}
            {header("Range Matching", "range_matching")}
            {header("Last Tested", "last_tested", "date")}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {modes.map((m) => {
            const ewGroup = ewGroupsById[m.ew_group_id];
            const source = sourcesById[m.source_id];
            return (
              <Fragment key={m.id}>
              <tr>
                <td>
                  <HoverInfo label={m.name}>
                    <ModeHoverDetail mode={m} source={sourcesById[m.source_id]} />
                  </HoverInfo>
                  <TestDerivedBadge emitterId={emitterId} records={m.derived_from_test_records} />
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
                  {source ? (
                    <HoverInfo label={source.name}>
                      <SourceHoverDetail emitterId={emitterId} source={source} />
                    </HoverInfo>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{m.line?.rf_min_mhz ?? "—"}</td>
                <td>{m.line?.rf_max_mhz ?? "—"}</td>
                <td>{m.line?.pw_min_us ?? "—"}</td>
                <td>{m.line?.pw_max_us ?? "—"}</td>
                <td>{m.pri_type.toUpperCase()}</td>
                {m.pri_type === "stagger" ? (
                  <td colSpan={2}>
                    <StaggerSequenceBox mode={m} />
                  </td>
                ) : m.pri_type === "fixed" ? (
                  <>
                    <td>{m.line?.pri_min_us ?? "—"}</td>
                    <td>
                      {m.line?.pri_max_us ?? "—"}
                      {m.line?.jitter_min_us != null && (
                        <span className="jitter-subline">
                          jitter {m.line.jitter_min_us}–{m.line.jitter_max_us}
                        </span>
                      )}
                    </td>
                  </>
                ) : (
                  <td colSpan={2}>{m.pri_type === "cw" ? "CW (constant)" : "—"}</td>
                )}
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
                    <button
                      className="link-button"
                      disabled={!canEdit}
                      title={editTitle}
                      onClick={() => setEditingModeId(editingModeId === m.id ? null : m.id)}
                    >
                      {editingModeId === m.id ? "Cancel edit" : "Edit"}
                    </button>{" "}
                    <button className="link-button" disabled={!canEdit} title={editTitle} onClick={() => onDelete(m.id, m.ew_group_id, m.name)}>
                      Delete
                    </button>
                  </RequireRole>
                </td>
              </tr>
              {editingModeId === m.id && canEdit && (
                <tr>
                  <td colSpan={13}>
                    <ModeEditForm emitterId={emitterId} mode={m} onDone={() => setEditingModeId(null)} />
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
