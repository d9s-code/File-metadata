import { useMemo, useState } from "react";
import type { ModeStatus, PriType, TestResult } from "../../types/domain";
import type { ObservedValues } from "../../api/testRecords";

const TEST_RESULTS: TestResult[] = ["fail", "partial", "inconclusive", "pass"];
const PRI_TYPES: PriType[] = ["fixed", "stagger", "cw", "xlet"];
const MODE_STATUSES: ModeStatus[] = ["approved", "draft", "superseded", "rejected"];
const RESULT_FILTERS: (TestResult | "never")[] = ["pass", "fail", "partial", "inconclusive", "never"];

export interface ModeOption {
  id: string;
  name: string;
  status: ModeStatus;
  last_tested_at: string | null;
  last_test_result: TestResult | null;
}

type NumericObservedKey =
  | "rf_min_mhz"
  | "rf_max_mhz"
  | "pw_min_us"
  | "pw_max_us"
  | "pri_min_us"
  | "pri_max_us"
  | "jitter_min_us"
  | "jitter_max_us";

const BASE_OBSERVED_FIELDS: { key: NumericObservedKey; label: string }[] = [
  { key: "rf_min_mhz", label: "RF min (MHz)" },
  { key: "rf_max_mhz", label: "RF max (MHz)" },
  { key: "pw_min_us", label: "PW min (µs)" },
  { key: "pw_max_us", label: "PW max (µs)" },
];

const FIXED_PRI_FIELDS: { key: NumericObservedKey; label: string }[] = [
  { key: "pri_min_us", label: "PRI min (µs)" },
  { key: "pri_max_us", label: "PRI max (µs)" },
  { key: "jitter_min_us", label: "jitter min (µs)" },
  { key: "jitter_max_us", label: "jitter max (µs)" },
];

export interface ModeResultEntry {
  included: boolean;
  result: TestResult;
  notes: string;
  /** Zero or more sets — e.g. one per repeated measurement/run. */
  observedValues: ObservedValues[];
}

function chipClass(entry: ModeResultEntry | undefined, selected: boolean): string {
  if (!entry?.included) return selected ? "mode-chip mode-chip-excluded mode-chip-selected" : "mode-chip mode-chip-excluded";
  const base = entry.result === "pass" ? "mode-chip" : `mode-chip mode-chip-${entry.result}`;
  return selected ? `${base} mode-chip-selected` : base;
}

/**
 * A searchable chip grid rather than a row-per-Mode table — an Emitter can
 * easily carry 70+ Modes, so a table with a dropdown+textarea per row would
 * mean editing 70 rows to log one test. Every Mode defaults to
 * included+pass (untouched, plain chip); click chips to select one or many,
 * then apply a result+notes to the whole selection at once. Only Modes that
 * actually deviate from the default need a click at all.
 */
export function ModeResultsPicker({
  modes,
  entries,
  onChange,
}: {
  modes: ModeOption[];
  entries: Record<string, ModeResultEntry>;
  onChange: (modeId: string, entry: ModeResultEntry) => void;
}) {
  const [search, setSearch] = useState("");
  // Defaults to "approved" — a test run is normally against the live Mode
  // set; broaden to "All" (or another status) only when you specifically
  // need to flag a pending-review/rejected/superseded Mode.
  const [statusFilter, setStatusFilter] = useState<ModeStatus | "">("approved");
  const [resultFilter, setResultFilter] = useState<TestResult | "never" | "">("");
  const [testedDir, setTestedDir] = useState<"before" | "after" | "">("");
  const [testedDate, setTestedDate] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkResult, setBulkResult] = useState<TestResult>("fail");
  const [bulkNotes, setBulkNotes] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return modes.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q)) return false;
      if (statusFilter && m.status !== statusFilter) return false;
      if (resultFilter) {
        if (resultFilter === "never" ? m.last_test_result != null : m.last_test_result !== resultFilter) return false;
      }
      if (testedDir && testedDate) {
        if (!m.last_tested_at) return false;
        const cmp = m.last_tested_at.localeCompare(testedDate);
        if (testedDir === "before" && cmp >= 0) return false;
        if (testedDir === "after" && cmp <= 0) return false;
      }
      return true;
    });
  }, [modes, search, statusFilter, resultFilter, testedDir, testedDate]);

  const counts = useMemo(() => {
    const c = { pass: 0, fail: 0, partial: 0, inconclusive: 0, excluded: 0 };
    for (const m of modes) {
      const e = entries[m.id];
      if (!e?.included) c.excluded++;
      else c[e.result]++;
    }
    return c;
  }, [modes, entries]);

  function toggleChip(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyToSelected() {
    for (const id of selected) onChange(id, { ...entries[id], included: true, result: bulkResult, notes: bulkNotes });
    setSelected(new Set());
    setBulkNotes("");
  }

  function updateObservedSet(modeId: string, setIndex: number, updater: (set: ObservedValues) => ObservedValues) {
    const entry = entries[modeId];
    const nextSets = entry.observedValues.map((set, i) => (i === setIndex ? updater(set) : set));
    onChange(modeId, { ...entry, observedValues: nextSets });
  }

  function setObservedValue(modeId: string, setIndex: number, field: NumericObservedKey, raw: string) {
    updateObservedSet(modeId, setIndex, (set) => {
      const next = { ...set };
      if (raw === "") delete next[field];
      else next[field] = Number(raw);
      return next;
    });
  }

  function setObservedPriType(modeId: string, setIndex: number, priType: PriType | "") {
    updateObservedSet(modeId, setIndex, (set) => {
      // Clear whatever the previous type carried — a stagger sequence left
      // over after switching to "fixed" (or vice versa) would be a
      // contradiction the backend rejects anyway.
      const next: ObservedValues = { ...set };
      delete next.pri_min_us;
      delete next.pri_max_us;
      delete next.jitter_min_us;
      delete next.jitter_max_us;
      delete next.pri_stagger_values_us;
      if (priType === "") delete next.pri_type;
      else next.pri_type = priType;
      return next;
    });
  }

  function setObservedStagger(modeId: string, setIndex: number, raw: string) {
    updateObservedSet(modeId, setIndex, (set) => {
      const values = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
      const next = { ...set };
      if (values.length) next.pri_stagger_values_us = values;
      else delete next.pri_stagger_values_us;
      return next;
    });
  }

  function addObservedSet(modeId: string) {
    const entry = entries[modeId];
    onChange(modeId, { ...entry, observedValues: [...entry.observedValues, {}] });
  }

  function removeObservedSet(modeId: string, setIndex: number) {
    const entry = entries[modeId];
    onChange(modeId, { ...entry, observedValues: entry.observedValues.filter((_, i) => i !== setIndex) });
  }

  function excludeSelected() {
    for (const id of selected) onChange(id, { ...entries[id], included: false });
    setSelected(new Set());
  }

  return (
    <div className="mode-results-picker">
      <div className="mode-results-picker-header">
        <span>
          {counts.pass} pass (default) · {counts.fail} fail · {counts.partial} partial · {counts.inconclusive}{" "}
          inconclusive · {counts.excluded} excluded
        </span>
        <input
          type="text"
          placeholder="Filter by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="mode-chip-filters">
        <label>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ModeStatus | "")}>
            <option value="">All</option>
            {MODE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Last result
          <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value as TestResult | "never" | "")}>
            <option value="">All</option>
            {RESULT_FILTERS.map((r) => (
              <option key={r} value={r}>
                {r === "never" ? "never tested" : r}
              </option>
            ))}
          </select>
        </label>
        <label>
          Not tested
          <select value={testedDir} onChange={(e) => setTestedDir(e.target.value as "before" | "after" | "")}>
            <option value="">—</option>
            <option value="before">before</option>
            <option value="after">after</option>
          </select>
        </label>
        <input type="date" value={testedDate} onChange={(e) => setTestedDate(e.target.value)} disabled={!testedDir} />
      </div>

      <p className="hint-text">
        Every Mode defaults to <strong>pass</strong>. Click one or more that need a different result (or should be
        excluded from this test), then apply below.
      </p>

      <div className="mode-chip-grid">
        {filtered.map((m) => {
          const lastInfo = `Last: ${m.last_test_result ?? "never tested"}${m.last_tested_at ? ` (${m.last_tested_at})` : ""} · Status: ${m.status}`;
          const title = entries[m.id]?.notes ? `${entries[m.id]!.notes}\n${lastInfo}` : lastInfo;
          const cls = chipClass(entries[m.id], selected.has(m.id));
          return (
            <button
              key={m.id}
              type="button"
              className={m.last_test_result === "fail" ? `${cls} mode-chip-flag-fail` : cls}
              title={title}
              onClick={() => toggleChip(m.id)}
            >
              {m.name}
            </button>
          );
        })}
        {filtered.length === 0 && <span className="hint-text">No Modes match the current filters.</span>}
      </div>

      {selected.size > 0 && (
        <div className="mode-chip-bulk-editor">
          <span>{selected.size} selected:</span>
          <select value={bulkResult} onChange={(e) => setBulkResult(e.target.value as TestResult)}>
            {TEST_RESULTS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="What happened — e.g. no detection, frequency drifted high…"
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

      {selected.size === 1 &&
        (() => {
          const [soleId] = [...selected];
          const entry = entries[soleId];
          const sets = entry?.observedValues ?? [];
          return (
            <div className="mode-observed-values">
              <span className="hint-text">
                Observed values for <strong>{modes.find((m) => m.id === soleId)?.name}</strong> (optional) — what
                was actually measured, e.g. to seed a test-derived Mode from this anomaly. Add more than one set if
                it was measured multiple times with different results.
              </span>

              {sets.map((set, setIndex) => (
                <div key={setIndex} className="mode-observed-value-set">
                  {sets.length > 1 && <div className="mode-observed-value-set-label">Set {setIndex + 1}</div>}
                  <div className="form-row">
                    {BASE_OBSERVED_FIELDS.map(({ key, label }) => (
                      <label key={key}>
                        {label}
                        <input
                          type="number"
                          step="any"
                          value={set[key] ?? ""}
                          onChange={(e) => setObservedValue(soleId, setIndex, key, e.target.value)}
                        />
                      </label>
                    ))}
                    <label>
                      PRI type
                      <select
                        value={set.pri_type ?? ""}
                        onChange={(e) => setObservedPriType(soleId, setIndex, e.target.value as PriType | "")}
                      >
                        <option value="">—</option>
                        {PRI_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {set.pri_type === "fixed" && (
                    <div className="form-row">
                      {FIXED_PRI_FIELDS.map(({ key, label }) => (
                        <label key={key}>
                          {label}
                          <input
                            type="number"
                            step="any"
                            value={set[key] ?? ""}
                            onChange={(e) => setObservedValue(soleId, setIndex, key, e.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                  )}

                  {set.pri_type === "stagger" && (
                    <div className="form-row">
                      <label className="wide-label">
                        PRI stagger sequence (comma-separated µs, in order)
                        <input
                          placeholder="800, 850, 900, 780"
                          value={set.pri_stagger_values_us?.join(", ") ?? ""}
                          onChange={(e) => setObservedStagger(soleId, setIndex, e.target.value)}
                        />
                      </label>
                    </div>
                  )}

                  {(set.pri_type === "cw" || set.pri_type === "xlet") && (
                    <p className="hint-text">{set.pri_type.toUpperCase()}: no further PRI value to record.</p>
                  )}

                  <button type="button" className="link-button" onClick={() => removeObservedSet(soleId, setIndex)}>
                    Remove this set
                  </button>
                </div>
              ))}

              <button type="button" className="icon-button" onClick={() => addObservedSet(soleId)}>
                + Add another observed value
              </button>
            </div>
          );
        })()}
    </div>
  );
}
