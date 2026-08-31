import { useMemo, useState } from "react";
import type { EwGroup, Mode, Source } from "../../types/domain";
import { HoverInfo } from "../common/InfoPopover";
import { RequireRole } from "../../auth/RequireAuth";
import { EwGroupHoverDetail, ModeHoverDetail, SourceHoverDetail, StaggerSequenceBox } from "./ModeHoverDetails";
import { TestDerivedBadge } from "./TestDerivedBadge";
import { LastTestedCell } from "./LastTestedCell";
import { ModeDraftForm } from "./ModeDraftForm";
import { useApproveModeDraft, useRejectModeDraft } from "../../state/hooks/useModes";

const STATUS_LABEL: Record<string, string> = { draft: "Pending Review", superseded: "Superseded", rejected: "Rejected" };

export function ModesCardGrid({
  emitterId,
  modes,
  ewGroupsById,
  sourcesById,
  onDelete,
}: {
  emitterId: string;
  modes: Mode[];
  ewGroupsById: Record<string, EwGroup>;
  sourcesById: Record<string, Source>;
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

  return (
    <div className="mode-card-grid">
      {modes.map((m) => {
        const ewGroup = ewGroupsById[m.ew_group_id];
        const source = sourcesById[m.source_id];
        const pendingDraft = pendingDraftBySupersedesId.get(m.id);
        if (editingModeId === m.id) {
          return (
            <div key={m.id} className="mode-card mode-card-editing">
              <ModeDraftForm emitterId={emitterId} mode={m} onDone={() => setEditingModeId(null)} />
            </div>
          );
        }
        return (
          <div key={m.id} className={m.status === "draft" ? "mode-card mode-draft-row" : "mode-card"}>
            <div className="mode-card-header">
              <strong>
                <HoverInfo label={m.name}>
                  <ModeHoverDetail mode={m} source={source} />
                </HoverInfo>
                {m.status !== "approved" && (
                  <span className={`mode-status-badge mode-status-${m.status}`}>{STATUS_LABEL[m.status]}</span>
                )}
                <TestDerivedBadge emitterId={emitterId} records={m.derived_from_test_records} />
              </strong>
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
                    </button>{" "}
                  </>
                ) : m.status === "approved" ? (
                  <>
                    <button
                      className="link-button"
                      disabled={!!pendingDraft}
                      title={pendingDraft ? "Already has a pending draft edit" : undefined}
                      onClick={() => setEditingModeId(m.id)}
                    >
                      Propose edit
                    </button>{" "}
                  </>
                ) : null}
                <button className="link-button" onClick={() => onDelete(m.id, m.ew_group_id, m.name)}>
                  Delete
                </button>
              </RequireRole>
            </div>
            {pendingDraft && <p className="mode-draft-notice">A draft edit is pending review.</p>}
            <div className="mode-card-badges">
              <span className="status-badge">
                {ewGroup ? (
                  <HoverInfo label={ewGroup.name}>
                    <EwGroupHoverDetail ewGroup={ewGroup} />
                  </HoverInfo>
                ) : (
                  "—"
                )}
              </span>
              <span className="status-badge">
                {source ? (
                  <HoverInfo label={source.name}>
                    <SourceHoverDetail emitterId={emitterId} source={source} />
                  </HoverInfo>
                ) : (
                  "—"
                )}
              </span>
            </div>
            <dl className="mode-card-fields">
              <div>
                <dt>RF Min (MHz)</dt>
                <dd>{m.line?.rf_min_mhz ?? "—"}</dd>
              </div>
              <div>
                <dt>RF Max (MHz)</dt>
                <dd>{m.line?.rf_max_mhz ?? "—"}</dd>
              </div>
              <div>
                <dt>PW Min (µs)</dt>
                <dd>{m.line?.pw_min_us ?? "—"}</dd>
              </div>
              <div>
                <dt>PW Max (µs)</dt>
                <dd>{m.line?.pw_max_us ?? "—"}</dd>
              </div>
              <div>
                <dt>PRI Type</dt>
                <dd>{m.pri_type.toUpperCase()}</dd>
              </div>
              {m.pri_type === "stagger" ? (
                <div>
                  <dt>PRI</dt>
                  <dd>
                    <StaggerSequenceBox mode={m} />
                  </dd>
                </div>
              ) : m.pri_type === "fixed" ? (
                <>
                  <div>
                    <dt>PRI Min (µs)</dt>
                    <dd>{m.line?.pri_min_us ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>PRI Max (µs)</dt>
                    <dd>
                      {m.line?.pri_max_us ?? "—"}
                      {m.line?.jitter_min_us != null && (
                        <span className="jitter-subline">
                          jitter {m.line.jitter_min_us}–{m.line.jitter_max_us}
                        </span>
                      )}
                    </dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt>PRI</dt>
                  <dd>{m.pri_type === "cw" ? "CW (constant)" : "—"}</dd>
                </div>
              )}
              <div>
                <dt>Last Tested</dt>
                <dd>
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
                </dd>
              </div>
            </dl>
          </div>
        );
      })}
    </div>
  );
}
