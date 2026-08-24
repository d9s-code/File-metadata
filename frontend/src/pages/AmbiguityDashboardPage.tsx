import { useState } from "react";
import { useParams } from "react-router-dom";
import type { AmbiguityScopeType, ToleranceConfig } from "../api/ambiguity";
import { useAmbiguityFindings, useAmbiguityRun, useCreateAmbiguityRun } from "../state/hooks/useAmbiguity";
import { ToleranceConfigForm } from "../components/ambiguity/ToleranceConfigForm";
import { AmbiguityMatrix } from "../components/ambiguity/AmbiguityMatrix";
import { FindingsTable } from "../components/ambiguity/FindingsTable";
import { RfPriScatterPlot } from "../components/ambiguity/RfPriScatterPlot";
import { ApiRequestError } from "../api/client";

export function AmbiguityDashboardPage() {
  const { scopeType, scopeId } = useParams<{ scopeType: AmbiguityScopeType; scopeId: string }>();
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createRun = useCreateAmbiguityRun();
  const { data: run } = useAmbiguityRun(runId);
  const { data: findings } = useAmbiguityFindings(run?.status === "complete" ? runId : null);

  async function handleRun(tolerance: ToleranceConfig) {
    setError(null);
    setSelectedFindingId(null);
    try {
      const created = await createRun.mutateAsync({
        scope_type: scopeType as AmbiguityScopeType,
        scope_id: scopeId as string,
        tolerance_config: tolerance,
      });
      setRunId(created.id);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to start ambiguity check");
    }
  }

  const selectedFinding = findings?.find((f) => f.id === selectedFindingId) ?? null;

  return (
    <div className="page">
      <h1>Ambiguity Check — {scopeType}</h1>

      <ToleranceConfigForm onRun={handleRun} running={createRun.isPending || run?.status === "pending"} />
      {error && <div className="error-text">{error}</div>}

      {run?.status === "pending" && <p className="hint-text">Running…</p>}
      {run?.status === "failed" && <div className="error-text">Run failed: {run.error_message}</div>}

      {run?.status === "complete" && findings && (
        <>
          <div className="card">
            <h4>Ambiguity Matrix</h4>
            <p className="hint-text">Click a cell to see the pair's RF/PW/PRI comparison and review it below.</p>
            <AmbiguityMatrix findings={findings} selectedId={selectedFindingId} onSelectFinding={setSelectedFindingId} />
          </div>

          {selectedFinding && (
            <div className="card">
              <h4>
                {selectedFinding.details.mode_a.mode_name} vs {selectedFinding.details.mode_b.mode_name}
              </h4>
              <RfPriScatterPlot finding={selectedFinding} />
            </div>
          )}

          <div className="card">
            <h4>Findings</h4>
            <FindingsTable
              runId={runId as string}
              findings={findings}
              selectedId={selectedFindingId}
              onSelect={setSelectedFindingId}
            />
          </div>
        </>
      )}
    </div>
  );
}
