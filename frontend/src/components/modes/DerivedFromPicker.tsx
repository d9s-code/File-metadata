import { useEmitterTestRecords } from "../../state/hooks/useTestRecords";

export function DerivedFromPicker({
  emitterId,
  selected,
  onChange,
}: {
  emitterId: string;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const { data: testRecords } = useEmitterTestRecords(emitterId);

  if (!testRecords || testRecords.length === 0) {
    return <p className="hint-text">No test records logged for this Emitter yet.</p>;
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <ul className="derived-from-picker checkbox-list">
      {testRecords.map((r) => (
        <li key={r.id}>
          <label className="checkbox-label">
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
            {r.title} — {r.test_type.replace("_", " ")}, {r.test_date} ({r.result})
          </label>
        </li>
      ))}
    </ul>
  );
}
