import { useState } from "react";
import type { ToleranceConfig } from "../../api/ambiguity";
import { useAuth } from "../../auth/AuthContext";
import { SeverityBadge } from "./SeverityBadge";
import { DEFAULT_THRESHOLDS, severityRule } from "./ambiguityText";

function Threshold({
  value,
  onChange,
  editable,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  editable: boolean;
  label: string;
}) {
  if (!editable) return <strong>{value}%</strong>;
  return (
    <span className="criteria-threshold">
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      %
    </span>
  );
}

/** How the check decides, in words — with the thresholds in the sentences
 * (editable by Editors) — and the button to run it. */
export function CriteriaPanel({
  onRun,
  running,
  initial,
}: {
  onRun: (tolerance: ToleranceConfig) => void;
  running: boolean;
  initial?: ToleranceConfig;
}) {
  const { user } = useAuth();
  const editable = user?.role === "editor" || user?.role === "admin";
  const [t, setT] = useState<ToleranceConfig>({
    low_threshold: initial?.low_threshold ?? DEFAULT_THRESHOLDS.low_threshold,
    high_threshold: initial?.high_threshold ?? DEFAULT_THRESHOLDS.high_threshold,
    exact_threshold: initial?.exact_threshold ?? DEFAULT_THRESHOLDS.exact_threshold,
  });
  const set = (k: keyof ToleranceConfig) => (v: number) => setT((prev) => ({ ...prev, [k]: v }));
  const invalid =
    !(t.low_threshold >= 0 && t.low_threshold < t.high_threshold && t.high_threshold <= t.exact_threshold && t.exact_threshold <= 100);

  return (
    <div className="criteria-panel">
      <ol className="criteria-steps">
        <li>
          <strong>Every pair of Modes</strong> is compared on RF, PRI and PW, each range <strong>widened by its ± margin</strong>{" "}
          — the ranges the sensor matches with.
        </li>
        <li>
          For each parameter, the <strong>overlap</strong> is how much of the <em>narrower</em> of the two ranges the
          other covers — so a narrow Mode inside a wide one is 100%. Two staggers overlap on the share of their steps
          that are identical. CW and X-let have no PRI, so they're compared on RF and PW only.
        </li>
        <li>
          A pair is a <strong>finding</strong> only if it overlaps on <em>every</em> parameter compared — one clear gap
          is enough to tell them apart.
        </li>
        <li>
          Its <strong>severity</strong> is set by the parameter that overlaps <em>least</em>:
          <ul className="criteria-levels">
            {severityRule(t).map(({ severity }) => (
              <li key={severity}>
                <SeverityBadge severity={severity} />{" "}
                {severity === "exact_overlap" && (
                  <>
                    every parameter overlaps at least{" "}
                    <Threshold value={t.exact_threshold} onChange={set("exact_threshold")} editable={editable} label="Exact from (%)" />
                  </>
                )}
                {severity === "high" && (
                  <>
                    the least-overlapping parameter is at{" "}
                    <Threshold value={t.high_threshold} onChange={set("high_threshold")} editable={editable} label="High from (%)" /> or more
                  </>
                )}
                {severity === "medium" && (
                  <>
                    it's between {t.low_threshold}% and {t.high_threshold}%
                  </>
                )}
                {severity === "low" && (
                  <>
                    it's under{" "}
                    <Threshold value={t.low_threshold} onChange={set("low_threshold")} editable={editable} label="Low under (%)" />
                  </>
                )}
              </li>
            ))}
          </ul>
        </li>
      </ol>
      <div className="criteria-actions">
        <button type="button" onClick={() => onRun(t)} disabled={running || invalid}>
          {running ? "Checking…" : "Run the check"}
        </button>
        {invalid && <span className="error-text">The thresholds must rise: low &lt; high ≤ exact ≤ 100.</span>}
        {editable && !invalid && (
          <button type="button" className="link-button" onClick={() => setT(DEFAULT_THRESHOLDS)}>
            Reset to 30 / 70 / 99
          </button>
        )}
        <span className="hint-text">It reads the latest saved version, never unsaved edits.</span>
      </div>
    </div>
  );
}
