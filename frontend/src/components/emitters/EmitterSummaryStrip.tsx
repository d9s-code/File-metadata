import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Emitter, EmitterNote } from "../../types/domain";
import { useEmitterTestLines } from "../../state/hooks/useTestLines";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";

function Range({ label, min, max, engMin, engMax, unit }: {
  label: string;
  min: number | null;
  max: number | null;
  engMin: number | null;
  engMax: number | null;
  unit: string;
}) {
  if (min == null) return null;
  const engineered = engMin !== min || engMax !== max ? `Engineered: ${engMin}–${engMax} ${unit}` : undefined;
  return (
    <SummaryItem label={label} title={engineered}>
      <strong>
        {min === max ? min : `${min}–${max}`}
      </strong>{" "}
      <span className="hint-text">{unit}</span>
    </SummaryItem>
  );
}

function SummaryItem({
  label,
  title,
  className,
  children,
}: {
  label: string;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className ? `summary-item ${className}` : "summary-item"} title={title}>
      <span className="summary-label">{label}</span>
      <span className="summary-value">{children}</span>
    </div>
  );
}

/** One row with what matters about an Emitter at a glance: how it did
 * against simulation, how many Modes it has, its RF/PRI/PW/Scan ranges and
 * its analyst notes. */
export function EmitterSummaryStrip({
  emitter,
  notes,
  notesOpen,
  onToggleNotes,
  onOpenTests,
}: {
  emitter: Emitter;
  notes: EmitterNote[];
  notesOpen: boolean;
  onToggleNotes: () => void;
  onOpenTests: () => void;
}) {
  const { data: lines } = useEmitterTestLines(emitter.id);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const s = emitter.summary;
  const latestNote = notes.reduce<EmitterNote | null>((a, n) => (!a || n.created_at > a.created_at ? n : a), null);

  const total = lines?.length ?? 0;
  const correct = (lines ?? []).filter((l) => l.last_test_result === "pass").length;
  const wrong = (lines ?? []).filter((l) => l.last_test_result === "fail" || l.last_test_result === "partial").length;
  const untested = (lines ?? []).filter((l) => l.last_test_result == null).length;

  let validation: ReactNode;
  if (lines === undefined) {
    validation = <span className="hint-text">…</span>;
  } else if (total === 0) {
    validation = canEdit ? (
      <button type="button" className="link-button" onClick={onOpenTests}>
        Import SIM Test Lines
      </button>
    ) : (
      <span className="hint-text">No SIM Test Lines — start editing to import them</span>
    );
  } else if (untested === total) {
    validation = (
      <>
        <span className="hint-text">{total} SIM Test Lines, none tested · </span>
        <Link to={`/emitters/${emitter.id}/tests/new`}>Log a test run</Link>
      </>
    );
  } else {
    validation = (
      <button type="button" className="summary-link" onClick={onOpenTests} title="Open Test History">
        <strong className={wrong ? "summary-bad" : correct === total ? "summary-good" : undefined}>
          {correct} / {total}
        </strong>{" "}
        correct
        {wrong > 0 && <span className="summary-bad"> · {wrong} missed/misclassified</span>}
        {untested > 0 && <span className="hint-text"> · {untested} untested</span>}
        {emitter.last_validated_at && <span className="hint-text"> · last run {emitter.last_validated_at}</span>}
      </button>
    );
  }

  return (
    <div className="emitter-summary-strip">
      <SummaryItem label="Simulation">{validation}</SummaryItem>
      <SummaryItem label="Modes">
        <strong>{s.mode_count}</strong>
      </SummaryItem>
      <Range label="RF" min={s.rf_min_mhz} max={s.rf_max_mhz} engMin={s.engineered_rf_min_mhz} engMax={s.engineered_rf_max_mhz} unit="MHz" />
      <Range label="PRI" min={s.pri_min_us} max={s.pri_max_us} engMin={s.engineered_pri_min_us} engMax={s.engineered_pri_max_us} unit="µs" />
      <Range label="PW" min={s.pw_min_us} max={s.pw_max_us} engMin={s.engineered_pw_min_us} engMax={s.engineered_pw_max_us} unit="µs" />
      {s.scan_min != null && (
        <SummaryItem label="Scan">
          <strong>
            {s.scan_min}–{s.scan_max}
          </strong>
        </SummaryItem>
      )}
      <SummaryItem label="Analyst notes" className="summary-notes">
        <button type="button" className="summary-link" onClick={onToggleNotes} aria-expanded={notesOpen}>
          {notesOpen ? (
            <span className="hint-text">
              {notes.length === 0 ? "None yet" : `${notes.length} note${notes.length === 1 ? "" : "s"}`} · hide
            </span>
          ) : latestNote ? (
            <>
              <span className="summary-note-preview">“{latestNote.body}”</span>{" "}
              <span className="hint-text">
                — {latestNote.author_username ?? "unknown"}, {new Date(latestNote.created_at).toLocaleDateString()}
                {notes.length > 1 ? ` · ${notes.length} notes` : ""}
              </span>
            </>
          ) : (
            <span className="hint-text">None yet — add one</span>
          )}{" "}
          {notesOpen ? "▴" : "▾"}
        </button>
      </SummaryItem>
    </div>
  );
}
