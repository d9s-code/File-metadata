import { useAuditParameters } from "../../state/hooks/useAuditLog";

/** Narrows an audit trail to entries that change one parameter — with the
 * kind and action filters, e.g. Modes → Updated → RF. */
export function ParameterSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { data: parameters } = useAuditParameters();
  return (
    <select aria-label="Parameter" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Any parameter</option>
      {(parameters ?? []).map((p) => (
        <option key={p.key} value={p.key}>
          {p.label}
        </option>
      ))}
    </select>
  );
}
