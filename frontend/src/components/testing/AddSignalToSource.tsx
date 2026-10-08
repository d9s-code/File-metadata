import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { elementsApi } from "../../api/elements";
import { parameterSequencesApi } from "../../api/parameterSequences";
import { sourcesApi } from "../../api/sources";
import type { TestRecordSignal } from "../../api/testRecords";
import type { Source } from "../../types/domain";
import { elementOverviewKey, elementsKey } from "../../state/hooks/useElements";
import { parameterSequencesKey } from "../../state/hooks/useParameterSequences";
import { sourcesKey } from "../../state/hooks/useSources";
import { signalElements, signalSequence } from "./signalToSource";

/** A Source made from an intercept: one standing for an Intercept, or of type Intercept. */
export function isInterceptSource(s: Source): boolean {
  return !!s.intercept_id || (s.source_type ?? "").toLowerCase() === "intercept";
}

const NEW = "__new__";

/** Adds a logged signal's parameters to a Source, variant Intercept: all
 * together as one Parameter Sequence, or each as its own Element. */
export function AddSignalToSource({
  emitterId,
  sources,
  signal,
  label,
  canEdit,
  newSourceName,
  newSourceDate,
}: {
  emitterId: string;
  /** All of the Emitter's Sources — only intercept ones are offered. */
  sources: Source[];
  signal: TestRecordSignal;
  /** e.g. "Live pass — signal 2". */
  label: string;
  canEdit: boolean;
  /** What a new Source is suggested to be called and dated (the run's). */
  newSourceName: string;
  newSourceDate: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const interceptSources = sources.filter(isInterceptSource);
  const [sourceId, setSourceId] = useState(() => interceptSources[0]?.id ?? NEW);
  const [newName, setNewName] = useState(newSourceName);
  const [newDate, setNewDate] = useState(newSourceDate);
  const [addedTo, setAddedTo] = useState<{ id: string; name: string } | null>(null);
  const [as, setAs] = useState<"sequence" | "elements">("sequence");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const elements = signalElements(signal.observed_values, label, signal.notes ?? undefined);
  const sequence = signalSequence(signal.observed_values, label);
  const nothing = as === "sequence" ? !sequence : elements.length === 0;

  async function add() {
    setBusy(true);
    setError(null);
    try {
      let target = interceptSources.find((src) => src.id === sourceId);
      if (sourceId === NEW) {
        target = await sourcesApi.create(emitterId, { name: newName.trim(), source_date: newDate, source_type: "Intercept" });
        await qc.invalidateQueries({ queryKey: sourcesKey(emitterId) });
        setSourceId(target.id);
      }
      if (!target) return;
      const sourceId_ = target.id;
      setAddedTo({ id: target.id, name: target.name });
      if (as === "sequence" && sequence) {
        await parameterSequencesApi.create(emitterId, sourceId_, sequence);
        await qc.invalidateQueries({ queryKey: parameterSequencesKey(emitterId, sourceId_) });
        setDone(`Added as a Sequence (${sequence.steps.length} step${sequence.steps.length === 1 ? "" : "s"})`);
      } else {
        for (const [i, element] of elements.entries()) {
          await elementsApi.create(emitterId, sourceId_, { ...element, sort_order: i });
        }
        await qc.invalidateQueries({ queryKey: elementsKey(emitterId, sourceId_) });
        await qc.invalidateQueries({ queryKey: elementOverviewKey(emitterId) });
        setDone(`Added ${elements.length} Element${elements.length === 1 ? "" : "s"}`);
      }
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const newInvalid = sourceId === NEW && (!newName.trim() || !newDate);
  if (!open)
    return (
      <span className="add-signal-to-source">
        <button
          type="button"
          className="link-button"
          disabled={!canEdit}
          title={!canEdit ? "Start editing this Emitter first" : undefined}
          onClick={() => {
            setDone(null);
            setOpen(true);
          }}
        >
          Add to Source…
        </button>
        {done && addedTo && (
          <span className="hint-text">
            {done} to <Link to={`/emitters/${emitterId}?tab=setup&source=${addedTo.id}`}>{addedTo.name}</Link>, variant
            Intercept.
          </span>
        )}
      </span>
    );
  return (
    <div className="add-signal-to-source open">
      <label className="inline-date-label">
        Intercept Source
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          {interceptSources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value={NEW}>+ New Source…</option>
        </select>
      </label>
      {sourceId === NEW && (
        <>
          <label className="inline-date-label">
            Name
            <input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New Source name" />
          </label>
          <label className="inline-date-label">
            Date
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="New Source date" />
          </label>
          <span className="hint-text">A new Source of type Intercept.</span>
        </>
      )}
      <label className="inline-label">
        <input type="radio" name={`as-${label}`} checked={as === "sequence"} onChange={() => setAs("sequence")} /> As one
        Sequence
      </label>
      <label className="inline-label">
        <input type="radio" name={`as-${label}`} checked={as === "elements"} onChange={() => setAs("elements")} /> Each
        parameter as an Element{elements.length ? ` (${elements.length})` : ""}
      </label>
      <button type="button" disabled={busy || nothing || newInvalid} onClick={() => void add()}>
        {busy ? "Adding…" : "Add"}
      </button>
      <button type="button" className="link-button" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {nothing && <span className="hint-text">Nothing measured that fits here.</span>}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
