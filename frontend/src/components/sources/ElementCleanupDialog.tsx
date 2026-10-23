import { useMemo, useState } from "react";
import type { ElementOverviewRow } from "../../api/elements";
import { ApiRequestError } from "../../api/client";
import type { ElementType } from "../../types/domain";
import { useDeleteElements } from "../../state/hooks/useElements";
import { Modal } from "../common/Modal";
import { elementValues } from "./elementDisplay";

const TYPES: [ElementType | "", string][] = [
  ["", "All"],
  ["rf", "RF"],
  ["pri", "PRI"],
  ["pw", "PW"],
  ["scan", "Scan"],
];
/** Values listed for a name before the rest are counted. */
const VALUES_SHOWN = 3;

/** One Element in one Source. */
interface Item {
  id: string;
  sourceId: string;
  label: string;
  row: ElementOverviewRow;
}

/** Elements sharing a type and a name, across every Source. */
interface Group {
  key: string;
  type: ElementType;
  label: string;
  items: Item[];
}

/** Whether every number of the Element is this value (a PRI of 0, say). */
function valueIs(row: ElementOverviewRow, value: number): boolean {
  const numbers = row.stagger_values?.length
    ? row.stagger_values
    : [row.value_min, row.value_max].filter((v): v is number => v != null);
  return numbers.length > 0 && numbers.every((v) => Math.abs(v - value) < 1e-9);
}

/** Clearing out what an import brought in that shouldn't be there: find
 * Elements by name (their label) and/or an exact value, see each name with
 * how many Elements and Sources it covers, tick the names, and every Element
 * under them goes — from every Source at once. */
export function ElementCleanupDialog({
  emitterId,
  rows,
  onClose,
  onDone,
}: {
  emitterId: string;
  rows: ElementOverviewRow[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [type, setType] = useState<ElementType | "">("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useDeleteElements(emitterId);

  const exact = value.trim() === "" ? null : Number(value);
  const valueBad = exact != null && !Number.isFinite(exact);

  const groups = useMemo(() => {
    const words = name.toLowerCase().split(/\s+/).filter(Boolean);
    const byKey = new Map<string, Group>();
    for (const row of rows) {
      if (type && row.element_type !== type) continue;
      if (exact != null && Number.isFinite(exact) && !valueIs(row, exact)) continue;
      for (const o of row.occurrences) {
        const label = (o.label ?? "").trim();
        if (words.length && !words.every((w) => label.toLowerCase().includes(w))) continue;
        const key = `${row.element_type}|${label.toLowerCase()}`;
        const group = byKey.get(key) ?? { key, type: row.element_type, label, items: [] };
        group.items.push({ id: o.element_id, sourceId: o.source_id, label, row });
        byKey.set(key, group);
      }
    }
    return [...byKey.values()].sort(
      (a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
  }, [rows, type, exact, name]);

  const chosen = groups.filter((g) => picked.has(g.key));
  const ids = chosen.flatMap((g) => g.items.map((i) => i.id));
  const sourceCount = new Set(chosen.flatMap((g) => g.items.map((i) => i.sourceId))).size;
  const allPicked = groups.length > 0 && groups.every((g) => picked.has(g.key));

  function toggle(key: string) {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
    setConfirming(false);
  }

  async function confirmDelete() {
    setError(null);
    try {
      const result = await remove.mutateAsync(ids);
      onDone(
        `Deleted ${result.deleted} Element${result.deleted === 1 ? "" : "s"} from ${result.sources} Source${result.sources === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't delete the Elements");
      setConfirming(false);
    }
  }

  return (
    <Modal title="Clean up Elements" onClose={onClose} className="form-dialog element-cleanup">
      <p className="hint-text">
        Find what an import brought in by name or by value, tick the names, and every Element under them is deleted from
        every Source. Each Source&apos;s Audit Log says what went.
      </p>
      <div className="element-cleanup-filters">
        <div className="theme-toggle" role="group" aria-label="Element type">
          {TYPES.map(([t, label]) => (
            <button
              key={t}
              type="button"
              className={type === t ? "active" : undefined}
              onClick={() => {
                setType(t);
                setConfirming(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="inline-label">
          Name
          <input
            type="search"
            value={name}
            placeholder="e.g. scan rate"
            onChange={(e) => {
              setName(e.target.value);
              setConfirming(false);
            }}
            autoFocus
          />
        </label>
        <label className="inline-label" title="Every value of the Element is this one — a PRI of 0, say">
          Value is exactly
          <input
            type="number"
            step="any"
            value={value}
            placeholder="e.g. 0"
            aria-invalid={valueBad || undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setConfirming(false);
            }}
          />
        </label>
      </div>

      {groups.length === 0 ? (
        <p className="hint-text">No Elements match.</p>
      ) : (
        <div className="table-scroll element-cleanup-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Tick every name shown"
                    checked={allPicked}
                    onChange={() => {
                      setPicked(allPicked ? new Set() : new Set(groups.map((g) => g.key)));
                      setConfirming(false);
                    }}
                  />
                </th>
                <th>Type</th>
                <th>Name</th>
                <th>Values</th>
                <th className="num">Elements</th>
                <th className="num">Sources</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const values = [...new Set(g.items.map((i) => elementValues(i.row)))];
                return (
                  <tr key={g.key} className={picked.has(g.key) ? "selected-row" : undefined} onClick={() => toggle(g.key)}>
                    <td>
                      <input
                        type="checkbox"
                        checked={picked.has(g.key)}
                        onChange={() => toggle(g.key)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Tick ${g.label || "unnamed"} ${g.type.toUpperCase()} Elements`}
                      />
                    </td>
                    <td>{g.type.toUpperCase()}</td>
                    <td>{g.label || <span className="hint-text">no name</span>}</td>
                    <td title={values.join("\n")}>
                      {values.slice(0, VALUES_SHOWN).join("; ")}
                      {values.length > VALUES_SHOWN && <span className="hint-text"> +{values.length - VALUES_SHOWN} more</span>}
                    </td>
                    <td className="num">{g.items.length}</td>
                    <td className="num">{new Set(g.items.map((i) => i.sourceId)).size}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="mode-form-actions">
        {confirming ? (
          <>
            <span>
              Delete {ids.length} Element{ids.length === 1 ? "" : "s"} from {sourceCount} Source{sourceCount === 1 ? "" : "s"}?
            </span>
            <button type="button" className="danger-button" onClick={confirmDelete} disabled={remove.isPending}>
              {remove.isPending ? "Deleting…" : "Delete them"}
            </button>
            <button type="button" className="button secondary" onClick={() => setConfirming(false)}>
              Back
            </button>
          </>
        ) : (
          <>
            <button type="button" className="danger-button" disabled={ids.length === 0} onClick={() => setConfirming(true)}>
              Delete {ids.length} Element{ids.length === 1 ? "" : "s"}…
            </button>
            <button type="button" className="button secondary" onClick={onClose}>
              Close
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
