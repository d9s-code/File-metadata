import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { AmbiguityFinding, AmbiguityScopeType, ToleranceConfig } from "../api/ambiguity";
import { useAmbiguityFindings, useAmbiguityRun, useCreateAmbiguityRun } from "../state/hooks/useAmbiguity";
import { ToleranceConfigForm } from "../components/ambiguity/ToleranceConfigForm";
import { AmbiguityMatrix } from "../components/ambiguity/AmbiguityMatrix";
import { FindingsTable } from "../components/ambiguity/FindingsTable";
import { RfPriScatterPlot } from "../components/ambiguity/RfPriScatterPlot";
import { ApiRequestError } from "../api/client";

function matchesScope(finding: AmbiguityFinding, ewGroupId: string, sourceId: string): boolean {
  const ewOk =
    !ewGroupId ||
    (finding.details.mode_a.ew_group_id === ewGroupId && finding.details.mode_b.ew_group_id === ewGroupId);
  const sourceOk =
    !sourceId ||
    (finding.details.mode_a.source_id === sourceId && finding.details.mode_b.source_id === sourceId);
  return ewOk && sourceOk;
}

export function AmbiguityDashboardPage() {
  const { scopeType, scopeId } = useParams<{ scopeType: AmbiguityScopeType; scopeId: string }>();
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createRun = useCreateAmbiguityRun();
  const { data: run } = useAmbiguityRun(runId);
  const { data: findings } = useAmbiguityFindings(run?.status === "complete" ? runId : null);

  const [ewGroupScope, setEwGroupScope] = useState("");
  const [sourceScope, setSourceScope] = useState("");

  const ewGroupOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of findings ?? []) {
      map.set(f.details.mode_a.ew_group_id, f.details.mode_a.ew_group_name);
      map.set(f.details.mode_b.ew_group_id, f.details.mode_b.ew_group_name);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [findings]);

  const sourceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of findings ?? []) {
      map.set(f.details.mode_a.source_id, f.details.mode_a.source_name);
      map.set(f.details.mode_b.source_id, f.details.mode_b.source_name);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [findings]);

  const scopedFindings = useMemo(
    () => (findings ?? []).filter((f) => matchesScope(f, ewGroupScope, sourceScope)),
    [findings, ewGroupScope, sourceScope],
  );

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

  const selectedFinding = scopedFindings.find((f) => f.id === selectedFindingId) ?? null;

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
            <h4>Scope</h4>
            <p className="hint-text">
              Narrows both the matrix and the findings below to pairs where both modes share the chosen EW
              Group and/or Source — useful once a scope has enough modes that the full matrix gets unwieldy.
            </p>
            <div className="form-row">
              <select value={ewGroupScope} onChange={(e) => setEwGroupScope(e.target.value)}>
                <option value="">All EW Groups</option>
                {ewGroupOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              <select value={sourceScope} onChange={(e) => setSourceScope(e.target.value)}>
                <option value="">All Sources</option>
                {sourceOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="card">
            <h4>Ambiguity Matrix</h4>
            <p className="hint-text">Click a cell to see the pair's RF/PW/PRI comparison and review it below.</p>
            {scopedFindings.length === 0 ? (
              <p className="hint-text">No findings in this scope.</p>
            ) : (
              <AmbiguityMatrix
                findings={scopedFindings}
                selectedId={selectedFindingId}
                onSelectFinding={setSelectedFindingId}
              />
            )}
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
              findings={scopedFindings}
              selectedId={selectedFindingId}
              onSelect={setSelectedFindingId}
            />
          </div>
        </>
      )}
    </div>
  );
}
