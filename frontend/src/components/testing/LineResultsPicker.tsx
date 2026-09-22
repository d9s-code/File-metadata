import { useMemo, useState } from "react";
import type { TestResult } from "../../types/domain";

const OUTCOMES: TestResult[] = ["fail", "partial", "inconclusive", "pass"];

export interface TestLineOption {
  id: string;
  label: string;
  expected_mode_id: string | null;
  expected_mode_name: string | null;
}

export interface ModeNameOption {
  id: string;
  name: string;
}

export interface LineResultEntry {
  included: boolean;
  outcome: TestResult;
  detectedAsModeId: string;
  notes: string;
}

function outcomeLabel(o: TestResult): string {
  switch (o) {
    case "pass":
      return "correct intercept";
    case "partial":
      return "misclassified";
    case "fail":
      return "missed";
    case "inconclusive":
      return "inconclusive";
  }
}

function chipClass(entry: LineResultEntry | undefined, selected: boolean): string {
  if (!entry?.included) return selected ? "mode-chip mode-chip-excluded mode-chip-selected" : "mode-chip mode-chip-excluded";
  const base = entry.outcome === "pass" ? "mode-chip" : `mode-chip mode-chip-${entry.outcome}`;
  return selected ? `${base} mode-chip-selected` : base;
}

/**
 * The simulation-centric counterpart to ModeResultsPicker: one chip per
 * imported Test Line, defaulting to "correct intercept" — click to select
 * one or more that weren't, then apply an outcome (+ what it was
 * misclassified as, when relevant) to the selection at once.
 */
export function LineResultsPicker({
  lines,
  entries,
  onChange,
  modes,
}: {
  lines: TestLineOption[];
  entries: Record<string, LineResultEntry>;
  onChange: (lineId: string, entry: LineResultEntry) => void;
  /** For the "detected as" picker on a misclassified line — optional, since
   * not every Emitter has Modes defined yet. */
  modes?: ModeNameOption[];
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOutcome, setBulkOutcome] = useState<TestResult>("fail");
  const [bulkDetectedAs, setBulkDetectedAs] = useState("");
  const [bulkNotes, setBulkNotes] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? lines.filter((l) => l.label.toLowerCase().includes(q)) : lines;
  }, [lines, search]);

  const counts = useMemo(() => {
    const c = { pass: 0, fail: 0, partial: 0, inconclusive: 0, excluded: 0 };
    for (const l of lines) {
      const e = entries[l.id];
      if (!e?.included) c.excluded++;
      else c[e.outcome]++;
    }
    return c;
  }, [lines, entries]);

  function toggleChip(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyToSelected() {
    for (const id of selected) {
      onChange(id, {
        ...entries[id],
        included: true,
        outcome: bulkOutcome,
        detectedAsModeId: bulkOutcome === "partial" ? bulkDetectedAs : "",
        notes: bulkNotes,
      });
    }
    setSelected(new Set());
    setBulkNotes("");
    setBulkDetectedAs("");
  }

  function excludeSelected() {
    for (const id of selected) onChange(id, { ...entries[id], included: false });
    setSelected(new Set());
  }

  function renderChip(l: TestLineOption) {
    const entry = entries[l.id];
    const title = entry?.notes || (entry?.outcome === "partial" && entry.detectedAsModeId
      ? `Detected as: ${modes?.find((m) => m.id === entry.detectedAsModeId)?.name ?? entry.detectedAsModeId}`
      : undefined);
    return (
      <button
        key={l.id}
        type="button"
        className={chipClass(entry, selected.has(l.id))}
        title={title}
        onClick={() => toggleChip(l.id)}
      >
        {l.label}
      </button>
    );
  }

  return (
    <div className="mode-results-picker">
      <div className="mode-results-picker-header">
        <span>
          {counts.pass} correct (default) · {counts.fail} missed · {counts.partial} misclassified ·{" "}
          {counts.inconclusive} inconclusive · {counts.excluded} excluded
        </span>
        <input type="text" placeholder="Filter by label…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <p className="hint-text">
        Every Test Line defaults to <strong>correct intercept</strong>. Click one or more that weren't, then apply
        below.
      </p>

      <div className="mode-chip-grid">
        {filtered.map((l) => renderChip(l))}
        {filtered.length === 0 && <span className="hint-text">No Test Lines match the current filter.</span>}
      </div>

      {selected.size > 0 && (
        <div className="mode-chip-bulk-editor">
          <span>{selected.size} selected:</span>
          <select value={bulkOutcome} onChange={(e) => setBulkOutcome(e.target.value as TestResult)}>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {outcomeLabel(o)}
              </option>
            ))}
          </select>
          {bulkOutcome === "partial" && modes && modes.length > 0 && (
            <select value={bulkDetectedAs} onChange={(e) => setBulkDetectedAs(e.target.value)}>
              <option value="">detected as… (optional)</option>
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            placeholder="What happened — e.g. no return, recognized as the wrong threat…"
            value={bulkNotes}
            onChange={(e) => setBulkNotes(e.target.value)}
          />
          <button type="button" className="icon-button" onClick={applyToSelected}>
            Apply
          </button>
          <button type="button" className="link-button" onClick={excludeSelected}>
            Exclude instead
          </button>
          <button type="button" className="link-button" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}
