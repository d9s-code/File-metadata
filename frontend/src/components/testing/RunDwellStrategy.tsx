import { useState } from "react";
import { Link } from "react-router-dom";
import type { TestRecord } from "../../api/testRecords";
import { ApiRequestError } from "../../api/client";
import { useHasRole } from "../../auth/RequireAuth";
import { useDwellStrategies, useDwellVersions } from "../../state/hooks/useDwells";
import { useChangeTestDwellStrategy } from "../../state/hooks/useTestRecords";

/** A run's dwell, and — for an editor, on a run of its own (not a Platform
 * test's) — setting which saved Strategy version it used afterwards, so it
 * counts towards that Strategy's testing. */
export function RunDwellStrategy({ emitterId, record }: { emitterId: string; record: TestRecord }) {
  const canEdit = useHasRole("editor") && !record.platform_test_id;
  const [open, setOpen] = useState(false);
  const [strategyId, setStrategyId] = useState(record.dwell_strategy_id ?? "");
  const [versionId, setVersionId] = useState(record.dwell_strategy_version_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const { data: strategies } = useDwellStrategies(undefined, true);
  const { data: versions } = useDwellVersions("strategies", strategyId);
  const change = useChangeTestDwellStrategy(emitterId);

  const shown = record.dwell_strategy_id ? (
    <>
      <Link to={`/dwells/strategies/${record.dwell_strategy_id}`}>{record.dwell_strategy_name}</Link> v
      {record.dwell_strategy_version_number}
    </>
  ) : (
    (record.dwell ?? <span className="hint-text">—</span>)
  );

  async function save(next: string | null) {
    setError(null);
    try {
      await change.mutateAsync({ id: record.id, versionId: next });
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't change it");
    }
  }

  if (!open)
    return (
      <>
        {shown}
        {canEdit && (
          <button type="button" className="link-button run-dwell-edit" onClick={() => setOpen(true)}>
            {record.dwell_strategy_id ? "Change" : "Set Strategy…"}
          </button>
        )}
      </>
    );

  const saved = (strategies ?? []).filter((s) => s.latest_version_id);
  const ordered = [...(versions ?? [])].sort((a, b) => b.version_number - a.version_number);
  return (
    <span className="run-dwell-picker">
      <select
        aria-label="Dwell Strategy"
        value={strategyId}
        onChange={(e) => {
          setStrategyId(e.target.value);
          setVersionId(saved.find((s) => s.id === e.target.value)?.latest_version_id ?? "");
        }}
      >
        <option value="">— None —</option>
        {saved.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.is_default ? "default dwells" : s.platform_names.join(", ")})
          </option>
        ))}
      </select>
      {strategyId && (
        <select aria-label="Strategy version" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
          {ordered.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.version_number}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="button primary small"
        disabled={change.isPending || (!!strategyId && !versionId)}
        onClick={() => void save(strategyId ? versionId : null)}
      >
        {change.isPending ? "Saving…" : "Save"}
      </button>
      <button type="button" className="button secondary small" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <span className="error-text">{error}</span>}
    </span>
  );
}
