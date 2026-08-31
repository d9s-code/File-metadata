import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EwGroup, Mode, Source } from "../../types/domain";
import { useElements } from "../../state/hooks/useElements";
import { useFloatingPosition } from "../common/useFloatingPosition";

export function ModeHoverDetail({ mode, source }: { mode: Mode; source?: Source }) {
  return (
    <dl>
      <dt>Notes</dt>
      <dd>{mode.notes ?? "—"}</dd>
      <dt>Created</dt>
      <dd>{new Date(mode.created_at).toLocaleString()}</dd>
      <dt>Last updated</dt>
      <dd>{new Date(mode.updated_at).toLocaleString()}</dd>
      {source && (
        <>
          <dt>Source last updated</dt>
          <dd>
            {new Date(source.updated_at).toLocaleString()}
            {new Date(source.updated_at) > new Date(mode.updated_at) && (
              <span className="jitter-subline">Source changed after this Mode was last touched — worth a look.</span>
            )}
          </dd>
        </>
      )}
    </dl>
  );
}

export function EwGroupHoverDetail({ ewGroup }: { ewGroup: EwGroup }) {
  return (
    <dl>
      <dt>Scan range</dt>
      <dd>
        {ewGroup.scan_min ?? "—"}–{ewGroup.scan_max ?? "—"}
        {ewGroup.scan_delta != null &&
          ` (engineered: ${ewGroup.engineered_scan_min}–${ewGroup.engineered_scan_max})`}
      </dd>
      <dt>Threat priority</dt>
      <dd>{ewGroup.threat_priority ?? "—"}</dd>
      <dt>Ageout</dt>
      <dd>{ewGroup.ageout != null ? `${ewGroup.ageout} s` : "—"}</dd>
      {ewGroup.scan_delta != null && (
        <>
          <dt>Scan delta</dt>
          <dd>±{ewGroup.scan_delta}</dd>
        </>
      )}
    </dl>
  );
}

export function SourceHoverDetail({ emitterId, source }: { emitterId: string; source: Source }) {
  const { data: elements } = useElements(emitterId, source.id);
  const counts = { rf: 0, pw: 0, pri: 0, scan: 0 };
  for (const el of elements ?? []) counts[el.element_type]++;
  return (
    <dl>
      <dt>Description</dt>
      <dd>{source.description ?? "—"}</dd>
      <dt>Source date</dt>
      <dd>{source.source_date}</dd>
      <dt>Last updated</dt>
      <dd>{new Date(source.updated_at).toLocaleString()}</dd>
      <dt>Elements</dt>
      <dd>
        {counts.rf} RF · {counts.pw} PW · {counts.pri} PRI · {counts.scan} Scan
      </dd>
    </dl>
  );
}

export function StaggerSequenceBox({ mode }: { mode: Mode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pos = useFloatingPosition(triggerRef, contentRef, open);
  const values = mode.line?.pri_stagger_values_us ?? [];
  const frametime = values.reduce((sum, v) => sum + v, 0);
  const frameTimeDelta = mode.line?.frame_time_delta_us;
  return (
    <div className="stagger-box">
      <button
        ref={triggerRef}
        type="button"
        className="stagger-box-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        View sequence ({values.length})
      </button>
      {pos &&
        createPortal(
          <div ref={contentRef} className="stagger-box-content" style={{ top: pos.top, left: pos.left }}>
            [{values.join(", ")}] µs
            <br />
            Frametime: {frametime} µs
            {frameTimeDelta != null &&
              ` (engineered: ${mode.line?.engineered_frame_time_min_us}–${mode.line?.engineered_frame_time_max_us}, ±${frameTimeDelta})`}
          </div>,
          document.body,
        )}
    </div>
  );
}
