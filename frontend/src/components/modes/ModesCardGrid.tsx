import { useState } from "react";
import { MenuButton } from "../common/MenuButton";
import type { EwGroup, FunctionGroup, Mode, ModeGenerationBatch, Source } from "../../types/domain";
import { HoverInfo } from "../common/InfoPopover";
import { RequireRole } from "../../auth/RequireAuth";
import { EwGroupHoverDetail, ModeHoverDetail, SourceHoverDetail, StaggerSequenceBox } from "./ModeHoverDetails";
import { TestDerivedBadge } from "./TestDerivedBadge";
import { InterceptDerivedBadge } from "./InterceptDerivedBadge";
import { LastTestedCell } from "./LastTestedCell";
import { ModeEditForm } from "./ModeEditForm";
import { ModeForm } from "./ModeForm";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import {
  groupModesForDisplay,
  jitterOrFrameTimeDisplay,
  priDisplay,
  pwDisplay,
  rangeMatchingTags,
  rfDisplay,
} from "./modeFormat";

function span(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  if (max == null || min === max) return String(min ?? max);
  return `${min}–${max}`;
}

export function ModesCardGrid({
  emitterId,
  modes,
  batches,
  collapseBatches,
  ewGroupsById,
  sourcesById,
  functionGroupsById,
  onDelete,
  selected,
  onToggleSelect,
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
  onDelete: (modeId: string, ewGroupId: string, name: string) => void;
  selected: Set<string>;
  onToggleSelect: (modeId: string) => void;
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

  function toggleExpandBatch(batchId: string) {
    setExpandedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }

  function renderModeCard(m: Mode) {
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
                sources={Object.values(sourcesById)}
                onDone={() => setEditingModeId(null)}
              />
            </div>
          );
        }
        if (duplicatingModeId === m.id && canEdit) {
          return (
            <div key={m.id} className="mode-card mode-card-editing">
              <ModeForm
                emitterId={emitterId}
                ewGroups={Object.values(ewGroupsById)}
                sources={Object.values(sourcesById)}
                functionGroups={Object.values(functionGroupsById)}
                duplicateFrom={m}
                onClose={() => setDuplicatingModeId(null)}
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
                <InterceptDerivedBadge intercepts={m.derived_from_intercepts} />
              </strong>
              <RequireRole minimum="editor">
                <MenuButton
                  label="⋯"
                  className="row-menu-button"
                  ariaLabel={`Actions for ${m.name}`}
                  items={[
                    { label: "Edit", onSelect: () => setEditingModeId(m.id), disabled: !canEdit, title: editTitle },
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
            <dl className="mode-card-params">
              <dt>RF</dt>
              <dd>
                {span(rf.min, rf.max)} <span className="hint-text">MHz</span>
                {!!rf.delta && <span className="hint-text"> ±{rf.delta}</span>}
              </dd>
              <dt>PRI</dt>
              <dd>
                <span className="mode-card-pri-type">{m.pri_type.toUpperCase()}</span>{" "}
                {m.pri_type === "fixed" ? (
                  <>
                    {span(pri.min, pri.max)} <span className="hint-text">µs</span>
                    {!!pri.delta && <span className="hint-text"> ±{pri.delta}</span>}
                    {jft.label === "jitter" && <span className="hint-text"> · jitter {span(jft.min, jft.max)}</span>}
                  </>
                ) : m.pri_type === "stagger" ? (
                  <>
                    <StaggerSequenceBox mode={m} />
                    {jft.label === "frametime" && (
                      <span className="hint-text">
                        {" "}
                        · frame time {span(jft.min, jft.max)} µs{jft.delta ? ` ±${jft.delta}` : ""}
                      </span>
                    )}
                  </>
                ) : m.pri_type === "cw" ? (
                  <span className="hint-text">constant</span>
                ) : null}
              </dd>
              <dt>PW</dt>
              <dd>
                {span(pw.min, pw.max)} <span className="hint-text">µs</span>
                {!!pw.delta && <span className="hint-text"> ±{pw.delta}</span>}
              </dd>
            </dl>
            <div className="mode-card-footer">
              {rangeMatchingTags(m).map((tag) => (
                <span key={tag} className="status-badge range-matching-tag" title="Range matching">
                  {tag}
                </span>
              ))}
              <span className="mode-card-tested">
                {m.last_tested_at ? (
                  <LastTestedCell
                    emitterId={emitterId}
                    date={m.last_tested_at}
                    result={m.last_test_result}
                    testRecordId={m.last_test_record_id}
                    counts={m.seen_counts}
                  />
                ) : (
                  <span className="hint-text">never seen in a test</span>
                )}
              </span>
            </div>
          </div>
        );
  }

  const displayRows = groupModesForDisplay(modes, collapseBatches);

  return (
    <div className="mode-card-grid">
      {displayRows.map((row) => {
        if (row.type === "mode") return renderModeCard(row.mode);

        const isExpanded = expandedBatchIds.has(row.batchId);
        const batchIds = row.modes.map((m) => m.id);
        const allSelected = batchIds.every((id) => selected.has(id));
        const someSelected = batchIds.some((id) => selected.has(id));
        return (
          <div key={row.batchId} className="mode-card-grid-batch">
            <div className="mode-card batch-summary-row">
              <div className="mode-card-header">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSelected && someSelected;
                  }}
                  onChange={() => onToggleSelectBatch(batchIds)}
                  aria-label={`Select all Modes in batch ${batchNameById[row.batchId] ?? row.batchId}`}
                />
                <button type="button" className="link-button" onClick={() => toggleExpandBatch(row.batchId)}>
                  {isExpanded ? "▼" : "▶"} {batchNameById[row.batchId] ?? "Generation batch"} — {row.modes.length} Modes
                </button>
              </div>
            </div>
            {isExpanded && row.modes.map((m) => renderModeCard(m))}
          </div>
        );
      })}
    </div>
  );
}
