import type { EwGroup, Mode, Source } from "../../types/domain";
import { HoverInfo } from "../common/InfoPopover";
import { RequireRole } from "../../auth/RequireAuth";
import { EwGroupHoverDetail, ModeHoverDetail, SourceHoverDetail, StaggerSequenceBox } from "./ModeHoverDetails";

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
  return (
    <div className="mode-card-grid">
      {modes.map((m) => {
        const ewGroup = ewGroupsById[m.ew_group_id];
        const source = sourcesById[m.source_id];
        return (
          <div key={m.id} className="mode-card">
            <div className="mode-card-header">
              <strong>
                <HoverInfo label={m.name}>
                  <ModeHoverDetail mode={m} />
                </HoverInfo>
              </strong>
              <RequireRole minimum="editor">
                <button className="link-button" onClick={() => onDelete(m.id, m.ew_group_id, m.name)}>
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
            </div>
            <dl className="mode-card-fields">
              <div>
                <dt>RF Min (MHz)</dt>
                <dd>{m.line?.rf_min_mhz ?? "—"}</dd>
              </div>
              <div>
                <dt>RF Max (MHz)</dt>
                <dd>
                  {m.line?.rf_max_mhz ?? "—"}
                  {m.line?.rf_delta != null && (
                    <span className="jitter-subline">
                      eng {m.line.engineered_rf_min_mhz}–{m.line.engineered_rf_max_mhz} (±{m.line.rf_delta})
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>PW Min (µs)</dt>
                <dd>{m.line?.pw_min_us ?? "—"}</dd>
              </div>
              <div>
                <dt>PW Max (µs)</dt>
                <dd>
                  {m.line?.pw_max_us ?? "—"}
                  {m.line?.pw_delta != null && (
                    <span className="jitter-subline">
                      eng {m.line.engineered_pw_min_us}–{m.line.engineered_pw_max_us} (±{m.line.pw_delta})
                    </span>
                  )}
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
                      {m.line?.pri_delta != null && (
                        <span className="jitter-subline">
                          eng {m.line.engineered_pri_min_us}–{m.line.engineered_pri_max_us} (±{m.line.pri_delta})
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
            </dl>
          </div>
        );
      })}
    </div>
  );
}
