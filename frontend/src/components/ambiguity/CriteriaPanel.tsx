import { useState } from "react";
import type { ToleranceConfig } from "../../api/ambiguity";
import { useAuth } from "../../auth/AuthContext";
import { SeverityBadge } from "./SeverityBadge";
import { DEFAULT_THRESHOLDS, severityRule } from "./ambiguityText";

export function thresholdsValid(t: ToleranceConfig): boolean {
  return t.low_threshold >= 0 && t.low_threshold < t.high_threshold && t.high_threshold <= t.exact_threshold && t.exact_threshold <= 100;
}

function ThresholdInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <label className="criteria-threshold">
      {label}
      <span>
        <input type="number" min={0} max={100} value={value} aria-label={`${label} (%)`} onChange={(e) => onChange(Number(e.target.value))} />%
      </span>
    </label>
  );
}

/** The run bar's controls: Run, and the severity thresholds as one line —
 * which an Editor can change before running. */
export function RunControls({
  thresholds,
  onThresholds,
  onRun,
  running,
  hasRun,
}: {
  thresholds: ToleranceConfig;
  onThresholds: (t: ToleranceConfig) => void;
  onRun: (t: ToleranceConfig) => void;
  running: boolean;
  hasRun: boolean;
}) {
  const { user } = useAuth();
  const editable = user?.role === "editor" || user?.role === "admin";
  const [editing, setEditing] = useState(false);
  const t = thresholds;
  const valid = thresholdsValid(t);
  const set = (k: keyof ToleranceConfig) => (v: number) => onThresholds({ ...t, [k]: v });

  return (
    <div className="run-controls">
      <button type="button" onClick={() => onRun(t)} disabled={running || !valid}>
        {running ? "Checking…" : hasRun ? "Run again" : "Run the check"}
      </button>
      {editing ? (
        <span className="run-thresholds editing">
          <ThresholdInput label="Low under" value={t.low_threshold} onChange={set("low_threshold")} />
          <ThresholdInput label="High from" value={t.high_threshold} onChange={set("high_threshold")} />
          <ThresholdInput label="Exact from" value={t.exact_threshold} onChange={set("exact_threshold")} />
          <button type="button" className="link-button" onClick={() => setEditing(false)} disabled={!valid}>
            Done
          </button>
          <button type="button" className="link-button" onClick={() => onThresholds(DEFAULT_THRESHOLDS)}>
            Reset
          </button>
          {!valid && <span className="error-text">They must rise: low &lt; high ≤ exact ≤ 100.</span>}
        </span>
      ) : (
        <button
          type="button"
          className="run-thresholds-chip"
          disabled={!editable}
          onClick={() => setEditing(true)}
          title={`Severity: low under ${t.low_threshold}%, high from ${t.high_threshold}%, exact from ${t.exact_threshold}%${editable ? " — click to change" : ""}`}
        >
          Thresholds {t.low_threshold} / {t.high_threshold} / {t.exact_threshold} %{editable ? " ✎" : ""}
        </button>
      )}
    </div>
  );
}

/** How the check decides, in words — behind "How it decides". */
export function HowItDecides({ thresholds: t }: { thresholds: ToleranceConfig }) {
  return (
    <div className="criteria-panel">
      <ol className="criteria-steps">
        <li>
          Only Modes of the <strong>same PRI type</strong> are compared — a different type tells them apart.
        </li>
        <li>
          Each pair is compared on <strong>RF, PRI and PW</strong>, each range <strong>widened by its ± margin</strong> —
          the ranges the sensor matches with — and on <strong>jitter</strong> when both are Fixed:
          <ul className="criteria-levels">
            <li>
              <strong>Fixed:</strong> PRI and jitter, each as a range (a jitter of 0–0 is a steady PRI).
            </li>
            <li>
              <strong>Stagger with range matching on:</strong> PRI is the frame time (± frame margin). If only one of the
              two has range matching on, they&apos;re told apart.
            </li>
            <li>
              <strong>Stagger without range matching:</strong> PRI is the share of steps that are identical.
            </li>
            <li>
              <strong>CW and X-let:</strong> no PRI — RF and PW only.
            </li>
          </ul>
        </li>
        <li>
          For each parameter, the <strong>overlap</strong> is how much of the <em>narrower</em> of the two ranges the
          other covers — so a narrow Mode inside a wide one is 100%. A pair is a <strong>finding</strong> only if it
          overlaps on <em>every</em> parameter compared — one clear gap is enough to tell them apart.
        </li>
        <li>
          Its <strong>severity</strong> is set by the parameter that overlaps <em>least</em>:
          <ul className="criteria-levels">
            {severityRule(t).map(({ severity }) => (
              <li key={severity}>
                <SeverityBadge severity={severity} />{" "}
                {severity === "exact_overlap" && <>every parameter overlaps at least {t.exact_threshold}%</>}
                {severity === "high" && <>the least-overlapping parameter is at {t.high_threshold}% or more</>}
                {severity === "medium" && (
                  <>
                    it&apos;s between {t.low_threshold}% and {t.high_threshold}%
                  </>
                )}
                {severity === "low" && <>it&apos;s under {t.low_threshold}%</>}
              </li>
            ))}
          </ul>
        </li>
      </ol>
      <p className="hint-text">It reads the latest saved version, never unsaved edits.</p>
    </div>
  );
}
