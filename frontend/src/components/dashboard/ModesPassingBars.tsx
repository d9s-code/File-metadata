import { Link } from "react-router-dom";
import { useEmitters } from "../../state/hooks/useEmitters";
import { EmptyState } from "../common/EmptyState";

export function ModesPassingBars() {
  const { data: emitters } = useEmitters();

  const withModes = (emitters ?? [])
    .filter((e) => e.summary.mode_count > 0)
    .map((e) => ({ emitter: e, ratio: e.summary.modes_passing / e.summary.mode_count }))
    .sort((a, b) => a.ratio - b.ratio);

  return (
    <div className="card">
      <h4>Modes Passing by Emitter</h4>
      {withModes.length === 0 ? (
        <EmptyState
          icon="—"
          title="No tested Emitters yet"
          message="Once Modes have test results, their pass rate shows up here."
        />
      ) : (
        <ul className="modes-passing-bars">
          {withModes.map(({ emitter, ratio }) => (
            <li key={emitter.id}>
              <Link to={`/emitters/${emitter.id}`} className="modes-passing-bar-name">
                {emitter.name}
              </Link>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
              </div>
              <span className="progress-bar-label">
                {emitter.summary.modes_passing} / {emitter.summary.mode_count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
