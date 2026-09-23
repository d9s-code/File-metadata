import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { AmbiguityFinding, AmbiguityRun, AmbiguityScopeType, ToleranceConfig } from "../api/ambiguity";
import {
  useAmbiguityFindings,
  useAmbiguityRun,
  useAmbiguityRuns,
  useCreateAmbiguityRun,
} from "../state/hooks/useAmbiguity";
import { useEmitterVersions } from "../state/hooks/useEmitterVersions";
import { usePlatformVersions } from "../state/hooks/usePlatformVersions";
import { useMdfVersions } from "../state/hooks/useMdfVersions";
import { useAuth } from "../auth/AuthContext";
import { ToleranceConfigForm } from "../components/ambiguity/ToleranceConfigForm";
import { AmbiguityMatrix } from "../components/ambiguity/AmbiguityMatrix";
import { AmbiguitySummary } from "../components/ambiguity/AmbiguitySummary";
import { FindingsTable } from "../components/ambiguity/FindingsTable";
import { RfPriScatterPlot } from "../components/ambiguity/RfPriScatterPlot";
import { ApiRequestError } from "../api/client";

const RUN_VERSION_FIELD: Record<AmbiguityScopeType, keyof AmbiguityRun> = {
  emitter: "emitter_version_id",
  platform: "platform_version_id",
  mdf: "mdf_version_id",
};

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
  const { user } = useAuth();

  // Persist across a page refresh instead of forcing a brand-new analysis
  // every time: load the most recent complete run for this scope on mount,
  // if one exists. Never overrides a run the user explicitly just triggered.
  const { data: priorRuns } = useAmbiguityRuns(scopeType as AmbiguityScopeType, scopeId as string);
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current || runId !== null || !priorRuns) return;
    autoSelectedRef.current = true;
    const mostRecentComplete = priorRuns.find((r) => r.status === "complete");
    if (mostRecentComplete) setRunId(mostRecentComplete.id);
  }, [priorRuns, runId]);

  // Is the loaded run still current, or has this scope changed since it ran?
  const { data: emitterVersions } = useEmitterVersions(scopeType === "emitter" ? (scopeId as string) : "");
  const { data: platformVersions } = usePlatformVersions(scopeType === "platform" ? (scopeId as string) : "");
  const { data: mdfVersions } = useMdfVersions(scopeType === "mdf" ? (scopeId as string) : "");
  const scopeVersions = emitterVersions ?? platformVersions ?? mdfVersions;
  const latestVersion = useMemo(() => {
    if (!scopeVersions || scopeVersions.length === 0) return null;
    return scopeVersions.reduce((max, v) => (v.version_number > max.version_number ? v : max), scopeVersions[0]);
  }, [scopeVersions]);
  const runVersionId = run && scopeType ? (run[RUN_VERSION_FIELD[scopeType as AmbiguityScopeType]] as string | null) : null;
  const runVersion = scopeVersions?.find((v) => v.id === runVersionId) ?? null;
  const isStale = run?.status === "complete" && !!latestVersion && runVersionId !== latestVersion.id;

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

      {run?.status === "complete" && (
        <div className={isStale ? "checkout-banner checkout-banner-stale" : "checkout-banner"}>
          <span>
            Last check run {new Date(run.created_at).toLocaleString()}
            {runVersion ? ` against version v${runVersion.version_number}` : ""}
            {run.created_by && run.created_by === user?.id ? " by you" : ""}.
          </span>
          {isStale && (
            <span>
              Stale — this {scopeType} has changed since this check
              {latestVersion ? ` (now v${latestVersion.version_number})` : ""}. Run a new check for current
              results.
            </span>
          )}
        </div>
      )}

      {run?.status === "complete" && findings && (
        <>
          <AmbiguitySummary findings={findings} />

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
            <p className="hint-text">Click a cell to see the pair's RF/PRI/PW comparison and review it below.</p>
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
