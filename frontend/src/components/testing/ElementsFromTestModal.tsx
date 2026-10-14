import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "../common/Modal";
import { DateInput } from "../common/DateInput";
import { formatDate } from "../common/dates";
import { ApiRequestError } from "../../api/client";
import { elementsApi, type ModeElementInput } from "../../api/elements";
import type { ObservedValues, TestRecord } from "../../api/testRecords";
import type { ElementType, ElementVariant } from "../../types/domain";
import { elementOverviewKey, elementsKey } from "../../state/hooks/useElements";
import { sourcesKey } from "../../state/hooks/useSources";
import { nonEmptySets, nsOf } from "./testFormat";

const UNITS: Record<ElementType, string> = { rf: "MHz", pri: "µs", pw: "µs", scan: "s" };
const TYPE_ORDER: ElementType[] = ["rf", "pri", "pw"];

/** One Element the logged values would make, and where they were logged. */
interface Candidate {
  key: string;
  type: ElementType;
  min?: number;
  max?: number;
  stagger?: number[];
  jitter?: [number, number];
  from: string[];
}

function rangeOf(mean: number | undefined, min: number | undefined, max: number | undefined): [number, number] | null {
  if (mean != null) return [mean, mean];
  if (min != null && max != null) return [Math.min(min, max), Math.max(min, max)];
  return null;
}

/** The Elements a logged set holds: its RF, its PRI (a range with any jitter,
 * or a stagger's steps) and its PW. Times stay in µs, as Elements keep them. */
function fromSet(v: ObservedValues): Omit<Candidate, "key" | "from">[] {
  const out: Omit<Candidate, "key" | "from">[] = [];
  const rf = rangeOf(v.rf_mean_mhz, v.rf_min_mhz, v.rf_max_mhz);
  if (rf) out.push({ type: "rf", min: rf[0], max: rf[1] });
  if (v.pri_type === "fixed") {
    const pri = rangeOf(v.pri_mean_us, v.pri_min_us, v.pri_max_us);
    const jitter = rangeOf(v.jitter_mean_us, v.jitter_min_us, v.jitter_max_us);
    if (pri) out.push({ type: "pri", min: pri[0], max: pri[1], jitter: jitter ?? undefined });
  } else if (v.pri_type === "stagger" && v.pri_stagger_values_us?.length) {
    out.push({ type: "pri", stagger: v.pri_stagger_values_us });
  }
  const pw = rangeOf(v.pw_mean_us, v.pw_min_us, v.pw_max_us);
  if (pw) out.push({ type: "pw", min: pw[0], max: pw[1] });
  return out;
}

function describe(c: Candidate): string {
  if (c.stagger) return `stagger ${c.stagger.map(nsOf).join(", ")} ns (${c.stagger.join(", ")} µs)`;
  const value = c.min === c.max ? `${c.min}` : `${c.min}–${c.max}`;
  const jitter = c.jitter ? ` · jitter ${nsOf(c.jitter[0])}${c.jitter[1] !== c.jitter[0] ? `–${nsOf(c.jitter[1])}` : ""} ns` : "";
  return `${value} ${UNITS[c.type]}${jitter}`;
}

/** Turn what a test run logged into Elements on a Source — one of the
 * Emitter's, or a new one made for them (named after the run). Each logged
 * RF, PRI and PW becomes its own Element; the same value logged twice is one. */
export function ElementsFromTestModal({
  emitterId,
  record,
  sources,
  onClose,
  onDone,
}: {
  emitterId: string;
  record: TestRecord;
  sources: { id: string; name: string }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const qc = useQueryClient();
  const candidates = useMemo(() => {
    const owners = [
      ...record.lines.map((l) => ({ name: l.test_line_label, sets: l.observed_values })),
      ...record.modes.map((m) => ({ name: m.mode_name, sets: m.observed_values })),
      ...(record.signals ?? []).map((s, i) => ({ name: `Signal ${i + 1}`, sets: s.observed_values })),
    ];
    const byKey = new Map<string, Candidate>();
    for (const owner of owners) {
      for (const set of nonEmptySets(owner.sets)) {
        for (const c of fromSet(set)) {
          const key = `${c.type}|${c.min}|${c.max}|${c.stagger?.join(",") ?? ""}|${c.jitter?.join(",") ?? ""}`;
          const known = byKey.get(key);
          if (known) {
            if (!known.from.includes(owner.name)) known.from.push(owner.name);
          } else byKey.set(key, { ...c, key, from: [owner.name] });
        }
      }
    }
    return [...byKey.values()].sort(
      (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || (a.min ?? 0) - (b.min ?? 0),
    );
  }, [record]);

  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.map((c) => c.key)));
  const [variant, setVariant] = useState<ElementVariant>("intercept");
  const [deltas, setDeltas] = useState<Partial<Record<ElementType, string>>>({});
  const [target, setTarget] = useState<"new" | "existing">(sources.length ? "existing" : "new");
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [newName, setNewName] = useState(record.title);
  const [newDate, setNewDate] = useState(record.simulation_created_date ?? record.test_date);
  const [notes, setNotes] = useState(`From test run "${record.title}" (${formatDate(record.test_date)})`);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const chosen = candidates.filter((c) => picked.has(c.key));
  const typesChosen = TYPE_ORDER.filter((t) => chosen.some((c) => c.type === t));
  const needsStaggerDelta = chosen.some((c) => c.stagger);

  function toggle(key: string) {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (chosen.length === 0) return setError("Tick at least one value.");
    if (target === "existing" && !sourceId) return setError("Pick a Source.");
    if (target === "new" && (!newName.trim() || !newDate)) return setError("Give the new Source a name and a date.");
    if (variant === "analysis" && !notes.trim()) return setError("The 'analysis' variant needs a note saying how it was derived.");
    const delta = (t: ElementType) => (deltas[t]?.trim() ? Number(deltas[t]) : undefined);
    const elements: ModeElementInput[] = chosen.map((c) => ({
      element_type: c.type,
      variant,
      label: c.from.join(", ").slice(0, 120),
      details: notes.trim() || undefined,
      ...(c.stagger
        ? { stagger_values: c.stagger, delta: delta("pri") ?? 0 }
        : {
            value_min: c.min,
            value_max: c.max,
            delta: delta(c.type),
            jitter_min: c.type === "pri" ? (c.jitter?.[0] ?? 0) : undefined,
            jitter_max: c.type === "pri" ? (c.jitter?.[1] ?? 0) : undefined,
          }),
    }));
    setSaving(true);
    try {
      const res = await elementsApi.batch(
        emitterId,
        target === "existing" ? [sourceId] : [],
        elements,
        target === "new"
          ? { name: newName.trim(), source_date: newDate, description: `Values logged in the test run "${record.title}".` }
          : undefined,
      );
      const intoId = res.new_source_id ?? sourceId;
      qc.invalidateQueries({ queryKey: sourcesKey(emitterId) });
      qc.invalidateQueries({ queryKey: elementsKey(emitterId, intoId) });
      qc.invalidateQueries({ queryKey: elementOverviewKey(emitterId) });
      const into = target === "new" ? `the new Source "${newName.trim()}"` : `"${sources.find((s) => s.id === sourceId)?.name}"`;
      onDone(`Added ${res.created} Element${res.created === 1 ? "" : "s"} to ${into}.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't add the Elements — nothing was added.");
      setSaving(false);
    }
  }

  return (
    <Modal title="Elements from this test" onClose={onClose} wide>
      <form className="batch-edit-form" onSubmit={handleSubmit}>
        {candidates.length === 0 ? (
          <p className="hint-text">This run has no logged RF, PRI or PW values to make Elements of.</p>
        ) : (
          <>
            <p className="hint-text">
              Each logged value becomes its own Element; the same value logged on several lines is one. Untick what
              you don&apos;t want.
            </p>
            <table className="data-table compact">
              <thead>
                <tr>
                  <th />
                  <th>Type</th>
                  <th>Value</th>
                  <th>Logged on</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <input type="checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)} aria-label={`Add ${describe(c)}`} />
                    </td>
                    <td>{c.type.toUpperCase()}</td>
                    <td>{describe(c)}</td>
                    <td className="hint-text">{c.from.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="batch-edit-grid batch-edit-grid-4">
              <label>
                Variant
                <select value={variant} onChange={(e) => setVariant(e.target.value as ElementVariant)}>
                  <option value="intercept">intercept</option>
                  <option value="typical">typical</option>
                  <option value="discrete">discrete</option>
                  <option value="most_probable">most-probable</option>
                  <option value="extreme">extreme</option>
                  <option value="analysis">analysis</option>
                  <option value="other">other</option>
                </select>
              </label>
              {typesChosen.map((t) => (
                <label key={t}>
                  {t.toUpperCase()} ± delta ({UNITS[t]}){t === "pri" && needsStaggerDelta ? "" : " — optional"}
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder={t === "pri" && needsStaggerDelta ? "0" : ""}
                    value={deltas[t] ?? ""}
                    onChange={(e) => setDeltas({ ...deltas, [t]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <fieldset className="batch-sources">
              <legend>Into</legend>
              <label className="inline-label">
                <input type="radio" checked={target === "existing"} disabled={!sources.length} onChange={() => setTarget("existing")} />
                A Source
              </label>
              {target === "existing" && (
                <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label="Source">
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              <label className="inline-label">
                <input type="radio" checked={target === "new"} onChange={() => setTarget("new")} />A new Source
              </label>
              {target === "new" && (
                <>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New Source name" placeholder="Name" />
                  <DateInput value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="New Source date" />
                </>
              )}
            </fieldset>
            <label>
              Notes on each Element{variant === "analysis" ? " (required)" : ""}
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="batch-edit-actions">
          <button type="button" className="icon-button" onClick={onClose}>
            Cancel
          </button>
          {candidates.length > 0 && (
            <button type="submit" disabled={saving || chosen.length === 0}>
              {saving ? "Adding…" : `Add ${chosen.length} Element${chosen.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
