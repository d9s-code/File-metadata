import { useState } from "react";
import type { EwGroup, FunctionGroup, Mode, Source } from "../../types/domain";
import { HoverInfo } from "../common/InfoPopover";
import { RequireRole } from "../../auth/RequireAuth";
import { EwGroupHoverDetail, ModeHoverDetail, SourceHoverDetail, StaggerSequenceBox } from "./ModeHoverDetails";
import { TestDerivedBadge } from "./TestDerivedBadge";
import { LastTestedCell } from "./LastTestedCell";
import { ModeEditForm } from "./ModeEditForm";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import {
  jitterOrFrameTimeDisplay,
  priDisplay,
  pwDisplay,
  rangeMatchingTags,
  rfDisplay,
} from "./modeFormat";

export function ModesCardGrid({
  emitterId,
  modes,
  ewGroupsById,
  sourcesById,
  functionGroupsById,
  onDelete,
  selected,
  onToggleSelect,
  showEngineered,
}: {
  emitterId: string;
  modes: Mode[];
  ewGroupsById: Record<string, EwGroup>;
  sourcesById: Record<string, Source>;
  functionGroupsById: Record<string, FunctionGroup>;
  onDelete: (modeId: string, ewGroupId: string, name: string) => void;
  selected: Set<string>;
  onToggleSelect: (modeId: string) => void;
  showEngineered: boolean;
}) {
  const [editingModeId, setEditingModeId] = useState<string | null>(null);
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const editTitle = canEdit ? undefined : "Start editing this Emitter first";

  return (
    <div className="mode-card-grid">
      {modes.map((m) => {
        const ewGroup = ewGroupsById[m.ew_group_id];
        const source = sourcesById[m.source_id];
        const rf = rfDisplay(m, showEngineered);
        const pw = pwDisplay(m, showEngineered);
        const pri = priDisplay(m, showEngineered);
        const jft = jitterOrFrameTimeDisplay(m, showEngineered);
        if (editingModeId === m.id && canEdit) {
          return (
            <div key={m.id} className="mode-card mode-card-editing">
              <ModeEditForm
                emitterId={emitterId}
                mode={m}
                functionGroups={Object.values(functionGroupsById)}
                onDone={() => setEditingModeId(null)}
              />
            </div>
          );
        }
        return (
          <div key={m.id} className="mode-card">
            <div className="mode-card-header">
              <input
                type="checkbox"
                checked={selected.has(m.id)}
                onChange={() => onToggleSelect(m.id)}
                aria-label={`Select ${m.name}`}
              />
              <strong>
                <HoverInfo label={m.name}>
                  <ModeHoverDetail mode={m} source={source} />
                </HoverInfo>
                <TestDerivedBadge emitterId={emitterId} records={m.derived_from_test_records} />
              </strong>
              <RequireRole minimum="editor">
                <button
                  className="link-button"
                  disabled={!canEdit}
                  title={editTitle}
                  onClick={() => setEditingModeId(m.id)}
                >
                  Edit
                </button>{" "}
                <button
                  className="link-button"
                  disabled={!canEdit}
                  title={editTitle}
                  onClick={() => onDelete(m.id, m.ew_group_id, m.name)}
                >
                  Delete
                </button>
              </RequireRole>
            </div>
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
              {m.function_group_id && (
                <span className="status-badge">{functionGroupsById[m.function_group_id]?.name ?? "—"}</span>
              )}
            </div>
            <dl className="mode-card-fields">
              <div>
                <dt>RF Min (MHz)</dt>
                <dd>{rf.min ?? "—"}</dd>
              </div>
              <div>
                <dt>RF Max (MHz)</dt>
                <dd>
                  {rf.max ?? "—"}
                  {!!rf.delta && <span className="jitter-subline">±{rf.delta} MHz delta</span>}
                </dd>
              </div>
              <div>
                <dt>PW Min (µs)</dt>
                <dd>{pw.min ?? "—"}</dd>
              </div>
              <div>
                <dt>PW Max (µs)</dt>
                <dd>
                  {pw.max ?? "—"}
                  {!!pw.delta && <span className="jitter-subline">±{pw.delta} µs delta</span>}
                </dd>
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
                    <dd>{pri.min ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>PRI Max (µs)</dt>
                    <dd>
                      {pri.max ?? "—"}
                      {!!pri.delta && <span className="jitter-subline">±{pri.delta} µs delta</span>}
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
                <dt>Jitter/Frametime Min (µs)</dt>
                <dd>
                  {jft.label ? (
                    <>
                      {jft.label} {jft.min ?? "—"} µs
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>Jitter/Frametime Max (µs)</dt>
                <dd>
                  {jft.label && jft.max != null && (
                    <>
                      {jft.label} {jft.max} µs
                    </>
                  )}
                  {!!jft.delta && <span className="jitter-subline">±{jft.delta} µs delta</span>}
                  {!jft.label || (jft.max == null && !jft.delta) ? "—" : null}
                </dd>
              </div>
              <div>
                <dt>Range Matching</dt>
                <dd>
                  {rangeMatchingTags(m).length > 0 ? (
                    rangeMatchingTags(m).map((tag) => (
                      <span key={tag} className="status-badge range-matching-tag">
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="hint-text">—</span>
                  )}
                </dd>
              </div>
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
