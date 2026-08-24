import { useState } from "react";
import type { EwGroup, Mode, Source } from "../../types/domain";
import { useElements } from "../../state/hooks/useElements";

export function ModeHoverDetail({ mode }: { mode: Mode }) {
  return (
    <dl>
      <dt>Notes</dt>
      <dd>{mode.notes ?? "—"}</dd>
      {mode.line?.dsl_text && (
        <>
          <dt>DSL</dt>
          <dd>
            <code>{mode.line.dsl_text}</code>
          </dd>
        </>
      )}
      <dt>Created</dt>
      <dd>{new Date(mode.created_at).toLocaleString()}</dd>
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
  const counts = { rf: 0, pw: 0, pri: 0 };
  for (const el of elements ?? []) counts[el.element_type]++;
  return (
    <dl>
      <dt>Description</dt>
      <dd>{source.description ?? "—"}</dd>
      <dt>Date last updated</dt>
      <dd>{source.source_date}</dd>
      <dt>Elements</dt>
      <dd>
        {counts.rf} RF · {counts.pw} PW · {counts.pri} PRI
      </dd>
    </dl>
  );
}

export function StaggerSequenceBox({ mode }: { mode: Mode }) {
  const [open, setOpen] = useState(false);
  const values = mode.line?.pri_stagger_values_us ?? [];
  const frametime = values.reduce((sum, v) => sum + v, 0);
  return (
    <div className="stagger-box">
      <button type="button" className="stagger-box-trigger" onClick={() => setOpen((v) => !v)}>
        View sequence ({values.length})
      </button>
      {open && (
        <div className="stagger-box-content">
          [{values.join(", ")}] µs
          <br />
          Frametime: {frametime} µs
        </div>
      )}
    </div>
  );
}
