import { useState } from "react";
import type { ToleranceConfig } from "../../api/ambiguity";
import { RequireRole } from "../../auth/RequireAuth";

const DEFAULT_TOLERANCE: ToleranceConfig = { low_threshold: 30, high_threshold: 70, exact_threshold: 99 };

export function ToleranceConfigForm({
  onRun,
  running,
}: {
  onRun: (tolerance: ToleranceConfig) => void;
  running: boolean;
}) {
  const [tolerance, setTolerance] = useState<ToleranceConfig>(DEFAULT_TOLERANCE);

  return (
    <div className="card tolerance-form">
      <h5>Ambiguity Check</h5>
      <RequireRole minimum="editor">
        <div className="form-row">
          <label>
            Low threshold (%)
            <input
              type="number"
              value={tolerance.low_threshold}
              onChange={(e) => setTolerance((t) => ({ ...t, low_threshold: Number(e.target.value) }))}
            />
          </label>
          <label>
            High threshold (%)
            <input
              type="number"
              value={tolerance.high_threshold}
              onChange={(e) => setTolerance((t) => ({ ...t, high_threshold: Number(e.target.value) }))}
            />
          </label>
          <label>
            Exact threshold (%)
            <input
              type="number"
              value={tolerance.exact_threshold}
              onChange={(e) => setTolerance((t) => ({ ...t, exact_threshold: Number(e.target.value) }))}
            />
          </label>
        </div>
      </RequireRole>
      <button onClick={() => onRun(tolerance)} disabled={running}>
        {running ? "Running…" : "Run Ambiguity Check"}
      </button>
    </div>
  );
}
