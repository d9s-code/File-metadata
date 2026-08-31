import { Fragment, useMemo, useState } from "react";
import type { EwGroup, Mode, Source } from "../../types/domain";
import { useApproveModeDraft, useRejectModeDraft } from "../../state/hooks/useModes";
import { HoverInfo } from "../common/InfoPopover";
import { RequireRole } from "../../auth/RequireAuth";
import { SortableColumnHeader, type ColumnType } from "../common/SortableColumnHeader";
import type { ModeSortKey, SortDir } from "./modeFormat";
import { EwGroupHoverDetail, ModeHoverDetail, SourceHoverDetail, StaggerSequenceBox } from "./ModeHoverDetails";
import { TestDerivedBadge } from "./TestDerivedBadge";
import { LastTestedCell } from "./LastTestedCell";
import { ModeDraftForm } from "./ModeDraftForm";

const STATUS_LABEL: Record<string, string> = { draft: "Pending Review", superseded: "Superseded", rejected: "Rejected" };

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
  const approveDraft = useApproveModeDraft(emitterId);
  const rejectDraft = useRejectModeDraft(emitterId);

  const pendingDraftBySupersedesId = useMemo(() => {
    const map = new Map<string, Mode>();
    for (const m of modes) if (m.status === "draft" && m.supersedes_id) map.set(m.supersedes_id, m);
    return map;
  }, [modes]);

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
            {header("Last Tested", "last_tested", "date")}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {modes.map((m) => {
            const ewGroup = ewGroupsById[m.ew_group_id];
            const source = sourcesById[m.source_id];
            const pendingDraft = pendingDraftBySupersedesId.get(m.id);
            return (
              <Fragment key={m.id}>
              <tr className={m.status === "draft" ? "mode-draft-row" : undefined}>
                <td>
                  <HoverInfo label={m.name}>
                    <ModeHoverDetail mode={m} source={sourcesById[m.source_id]} />
                  </HoverInfo>
                  {m.status !== "approved" && (
                    <span className={`mode-status-badge mode-status-${m.status}`}>{STATUS_LABEL[m.status]}</span>
                  )}
                  <TestDerivedBadge emitterId={emitterId} records={m.derived_from_test_records} />
                  {pendingDraft && (
                    <span className="mode-draft-notice">A draft edit is pending review below.</span>
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
                    {m.status === "draft" ? (
                      <>
                        <button
                          className="link-button"
                          disabled={approveDraft.isPending}
                          onClick={() => void approveDraft.mutateAsync({ ewGroupId: m.ew_group_id, modeId: m.id })}
                        >
                          Approve
                        </button>{" "}
                        <button
                          className="link-button"
                          disabled={rejectDraft.isPending}
                          onClick={() => void rejectDraft.mutateAsync({ ewGroupId: m.ew_group_id, modeId: m.id })}
                        >
                          Reject
                        </button>
                      </>
                    ) : m.status === "approved" ? (
                      <button
                        className="link-button"
                        disabled={!!pendingDraft}
                        title={pendingDraft ? "Already has a pending draft edit" : undefined}
                        onClick={() => setEditingModeId(editingModeId === m.id ? null : m.id)}
                      >
                        {editingModeId === m.id ? "Cancel edit" : "Propose edit"}
                      </button>
                    ) : null}{" "}
                    <button className="link-button" onClick={() => onDelete(m.id, m.ew_group_id, m.name)}>
                      Delete
                    </button>
                  </RequireRole>
                </td>
              </tr>
              {editingModeId === m.id && (
                <tr>
                  <td colSpan={12}>
                    <ModeDraftForm emitterId={emitterId} mode={m} onDone={() => setEditingModeId(null)} />
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
