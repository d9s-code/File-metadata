import type { CartesianRun, CartesianRunElement } from "../../api/elements";
import { useCartesianRuns } from "../../state/hooks/useElements";
import { relativeTime } from "../common/backupFormat";
import { elementValues, VariantTag } from "./elementDisplay";

const TYPE_LABEL: Record<string, string> = { rf: "RF", pri: "PRI", pw: "PW", scan: "Scan" };

function UsedElement({ e }: { e: CartesianRunElement }) {
  return (
    <li>
      <strong>{TYPE_LABEL[e.element_type] ?? e.element_type}</strong> {elementValues(e)}
      {e.label && <span className="hint-text"> · {e.label}</span>} <VariantTag variant={e.variant} />
      {e.delta != null && (
        <span className="hint-text">
          {" "}
          ± {e.delta}
          {e.delta_overridden && " (this run)"}
        </span>
      )}
    </li>
  );
}

const STEP_LABELS: [string, string][] = [
  ["rf_mhz", "RF"],
  ["pri_us", "PRI"],
  ["pw_us", "PW"],
];

function stepText(values: Record<string, number>): string {
  return STEP_LABELS.map(([key, label]) => {
    const point = values[key];
    const unit = key === "rf_mhz" ? "MHz" : "µs";
    const [lo, hi] = [values[key.replace(/_(mhz|us)$/, "_min_$1")], values[key.replace(/_(mhz|us)$/, "_max_$1")]];
    if (point != null) return `${label} ${point} ${unit}`;
    if (lo != null && hi != null) return `${label} ${lo}–${hi} ${unit}`;
    return null;
  })
    .filter(Boolean)
    .join(" · ");
}

function RunEntry({ run }: { run: CartesianRun }) {
  const { elements, sequence_steps: steps, range_matching: rm } = run.inputs;
  const matching = (["rf", "pri", "pw"] as const).filter((k) => rm?.[k]).map((k) => TYPE_LABEL[k]);
  const made = run.mode_names.length;
  return (
    <li className="generation-log-entry">
      <div className="generation-log-head">
        <strong>{run.name_prefix}</strong>
        <span className="hint-text">
          into {run.ew_group_name} · {new Date(run.created_at).toLocaleString()} ({relativeTime(run.created_at)})
          {run.created_by_username && ` · by ${run.created_by_username}`}
        </span>
        <span className="status-badge" title={run.mode_names.join(", ")}>
          {made} Mode{made === 1 ? "" : "s"} made
          {run.modes_remaining !== made && ` · ${run.modes_remaining} still there`}
        </span>
      </div>
      {run.note && <p className="generation-log-note">{run.note}</p>}
      <ul className="generation-log-inputs">
        {elements.map((e, i) => (
          <UsedElement key={i} e={e} />
        ))}
        {steps.map((s, i) => (
          <li key={`s${i}`}>
            <strong>Step {s.order}</strong> of {s.sequence_label ?? "a sequence"}: {stepText(s.values)}{" "}
            <VariantTag variant={s.variant} />
          </li>
        ))}
      </ul>
      <p className="hint-text">Range matching: {matching.length ? matching.join(", ") : "none"}</p>
      <details>
        <summary className="hint-text">Modes made ({made})</summary>
        <p className="generation-log-modes">{run.mode_names.join(", ") || "—"}</p>
      </details>
    </li>
  );
}

/** Every cartesian run on this Source, newest first: what was combined, how,
 * and what it made — kept after its Modes are deleted. */
export function GenerationLog({ emitterId, sourceId }: { emitterId: string; sourceId: string }) {
  const { data: runs, isLoading } = useCartesianRuns(emitterId, sourceId);
  if (isLoading) return <p className="hint-text">Loading the log…</p>;
  if (!runs?.length)
    return (
      <p className="hint-text">
        No Modes generated here yet. Each run of <em>Generate Modes</em> is logged here: the Elements or Sequence steps
        combined, the margins and range matching used, and the Modes it made.
      </p>
    );
  return (
    <ul className="generation-log">
      {runs.map((r) => (
        <RunEntry key={r.id} run={r} />
      ))}
    </ul>
  );
}
