import { useEffect, useState, type FormEvent } from "react";
import type { Dwell, DwellStrategy, DwellStrategyUpdate } from "../../api/dwells";
import { ApiRequestError } from "../../api/client";
import { MenuButton } from "../common/MenuButton";
import { Modal } from "../common/Modal";
import { DwellChart, num } from "./DwellChart";
import { usePlatformEmitterOverlay } from "./platformOverlay";

const DEFAULT_MS = 50;

/** A dwell row as typed: text, so a half-typed number stays put. */
interface Row {
  freq: string;
  dwell: string;
  collect: string;
}

const toRow = (d: Dwell): Row => ({ freq: num(d.freq_mhz), dwell: num(d.dwell_time_ms), collect: num(d.collect_time_ms) });
const blankRow = (): Row => ({ freq: "", dwell: String(DEFAULT_MS), collect: String(DEFAULT_MS) });

function parse(rows: Row[]): { dwells: Dwell[]; problem: string | null } {
  const dwells: Dwell[] = [];
  let problem: string | null = null;
  for (const [i, r] of rows.entries()) {
    const freq = Number(r.freq);
    const dwell = Number(r.dwell);
    const collect = r.collect.trim() === "" ? DEFAULT_MS : Number(r.collect);
    // Keep every row (the chart skips unfinished ones) but report the first problem.
    dwells.push({ freq_mhz: freq > 0 ? freq : 0, dwell_time_ms: dwell > 0 ? dwell : 0, collect_time_ms: collect >= 0 ? collect : 0 });
    if (problem) continue;
    if (!r.freq.trim() || !(freq > 0)) problem = `Dwell ${i + 1}: give a frequency above 0 MHz.`;
    else if (!(dwell > 0)) problem = `Dwell ${i + 1}: the dwell time must be above 0 ms.`;
    else if (!(collect >= 0)) problem = `Dwell ${i + 1}: the collect time can't be negative.`;
  }
  return { dwells, problem };
}

/** A Strategy's dwells: the table (edited here, then saved) beside the
 * chart of one cycle, the manual collect time, and the chart's band width. */
export function DwellsEditor({
  strategy,
  defaultBandwidth,
  canEdit,
  onSave,
}: {
  strategy: DwellStrategy;
  defaultBandwidth: number;
  canEdit: boolean;
  onSave: (input: DwellStrategyUpdate) => Promise<unknown>;
}) {
  const [rows, setRows] = useState<Row[]>(() => strategy.dwells.map(toRow));
  const [manual, setManual] = useState(num(strategy.manual_collect_time_ms));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  // The row whose frequency gets the focus once it's drawn (after Enter or "+ Add dwell").
  const [focusRow, setFocusRow] = useState<number | null>(null);

  // Saved (here or elsewhere): start again from what's stored.
  const stored = JSON.stringify([strategy.dwells, strategy.manual_collect_time_ms]);
  useEffect(() => {
    setRows(strategy.dwells.map(toRow));
    setManual(num(strategy.manual_collect_time_ms));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);
  useEffect(() => {
    if (focusRow == null) return;
    document.querySelector<HTMLInputElement>(`[data-dwell-freq="${focusRow}"]`)?.focus();
    setFocusRow(null);
  }, [focusRow]);

  const { dwells, problem } = parse(rows);
  const dirty =
    JSON.stringify(rows) !== JSON.stringify(strategy.dwells.map(toRow)) || manual !== num(strategy.manual_collect_time_ms);
  const manualValue = manual.trim() === "" ? DEFAULT_MS : Number(manual);
  const bandwidth = strategy.bandwidth_mhz ?? defaultBandwidth;
  const overlay = usePlatformEmitterOverlay(strategy.platform_id);

  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  function insertAt(i: number, row: Row = blankRow()) {
    setRows([...rows.slice(0, i), row, ...rows.slice(i)]);
    setFocusRow(i);
  }
  function move(i: number, to: number) {
    const next = [...rows];
    [next[i], next[to]] = [next[to], next[i]];
    setRows(next);
  }

  async function save() {
    if (problem) return setError(problem);
    if (!(manualValue >= 0)) return setError("The manual collect time can't be negative.");
    setError(null);
    setSaving(true);
    try {
      await onSave({ dwells, manual_collect_time_ms: manualValue });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save the dwells.");
    } finally {
      setSaving(false);
    }
  }

  let start = 0;
  const starts = dwells.map((d) => {
    const at = start;
    start += d.dwell_time_ms;
    return at;
  });
  const cell = (i: number, field: keyof Row, label: string, extra?: { placeholder?: string; first?: boolean }) => (
    <input
      type="number"
      step="any"
      min="0"
      value={rows[i][field]}
      disabled={!canEdit}
      placeholder={extra?.placeholder}
      aria-label={`Dwell ${i + 1} ${label}`}
      data-dwell-freq={extra?.first ? i : undefined}
      onChange={(e) => setRow(i, { [field]: e.target.value })}
      onFocus={() => setHover(i)}
      onKeyDown={(e) => {
        // Enter: a new dwell below this one, ready for its frequency.
        if (e.key === "Enter" && canEdit) {
          e.preventDefault();
          insertAt(i + 1, { ...blankRow(), dwell: rows[i].dwell || String(DEFAULT_MS), collect: rows[i].collect });
        }
      }}
    />
  );

  return (
    <div className="dwell-editor">
      <section className="card dwell-editor-table">
        <div className="dwell-editor-settings">
          <label>
            Manual collect time (ms)
            <input
              type="number"
              step="any"
              min="0"
              value={manual}
              disabled={!canEdit}
              onChange={(e) => setManual(e.target.value)}
              placeholder={String(DEFAULT_MS)}
            />
          </label>
          <BandwidthField strategy={strategy} defaultBandwidth={defaultBandwidth} canEdit={canEdit} onSave={onSave} />
        </div>

        <div className="dwell-table-wrap">
          <table className="data-table dwell-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Frequency (MHz)</th>
                <th>Dwell (ms)</th>
                <th>Collect (ms)</th>
                <th className="num" title="When in the cycle it starts">
                  Starts at
                </th>
                {canEdit && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody onPointerLeave={() => setHover(null)}>
              {rows.map((r, i) => (
                <tr key={i} className={hover === i ? "hovered" : undefined} onPointerEnter={() => setHover(i)}>
                  <td className="num muted">{i + 1}</td>
                  <td>{cell(i, "freq", "frequency (MHz)", { first: true })}</td>
                  <td>{cell(i, "dwell", "dwell time (ms)")}</td>
                  <td>{cell(i, "collect", "collect time (ms)", { placeholder: String(DEFAULT_MS) })}</td>
                  <td className="num muted">{num(starts[i])} ms</td>
                  {canEdit && (
                    <td className="row-actions">
                      <MenuButton
                        label="⋯"
                        className="row-menu-button"
                        ariaLabel={`Actions for dwell ${i + 1}`}
                        items={[
                          { label: "Insert a dwell above", onSelect: () => insertAt(i) },
                          { label: "Duplicate", onSelect: () => insertAt(i + 1, { ...r }) },
                          { label: "Move up", disabled: i === 0, onSelect: () => move(i, i - 1) },
                          { label: "Move down", disabled: i === rows.length - 1, onSelect: () => move(i, i + 1) },
                          { label: "Remove", danger: true, onSelect: () => setRows(rows.filter((_, j) => j !== i)) },
                        ]}
                      />
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="hint-text">
                    No dwells yet{canEdit ? " — add one, or several at once." : "."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="dwell-editor-add">
            <button type="button" className="button secondary small" onClick={() => insertAt(rows.length)}>
              + Add dwell
            </button>
            <button type="button" className="button secondary small" onClick={() => setAdding(true)}>
              Add several…
            </button>
            <span className="hint-text">Enter in a row adds the next one.</span>
          </div>
        )}

        {canEdit && dirty && (
          <div className="dwell-save-bar" role="status">
            <span>{problem ?? "Unsaved changes"}</span>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setRows(strategy.dwells.map(toRow));
                setManual(num(strategy.manual_collect_time_ms));
                setError(null);
              }}
            >
              Discard
            </button>
            <button type="button" className="button primary small" disabled={saving || !!problem} onClick={() => void save()}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <details className="dwell-kept">
          <summary>RapidDF and Split Mode</summary>
          <p className="hint-text">Written to the file as they are; not edited here.</p>
          <dl className="dwell-kept-list">
            <dt>RapidDF</dt>
            <dd>
              {strategy.rapid_df
                ? `${strategy.rapid_df.freq ?? "?"} MHz · dwell ${strategy.rapid_df.dwell_time ?? "?"} ms · collect ${
                    strategy.rapid_df.collect_time ?? "?"
                  } ms`
                : "none"}
            </dd>
            <dt>Split Mode</dt>
            <dd>
              {strategy.split_mode?.length
                ? strategy.split_mode
                    .map((d) => `${d.freqs.join(" + ")} MHz · dwell ${d.dwell_time} ms · collect ${d.collect_time} ms`)
                    .join("; ")
                : "none"}
            </dd>
          </dl>
        </details>
      </section>

      <div className="dwell-editor-chart">
        <DwellChart
          dwells={dwells}
          bandwidthMhz={bandwidth}
          hover={hover}
          onHover={setHover}
          overlay={overlay}
          overlayTitle={strategy.platform_name ? `${strategy.platform_name}'s Emitters` : "Emitters"}
        />
      </div>

      {adding && (
        <AddSeveral
          onAdd={(added) => {
            setRows([...rows.filter((r) => r.freq.trim() !== ""), ...added]);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

/** The chart's band width for this Strategy: saved when left; blank for the default. */
function BandwidthField({
  strategy,
  defaultBandwidth,
  canEdit,
  onSave,
}: {
  strategy: DwellStrategy;
  defaultBandwidth: number;
  canEdit: boolean;
  onSave: (input: DwellStrategyUpdate) => Promise<unknown>;
}) {
  const value = strategy.bandwidth_mhz;
  const [text, setText] = useState(value == null ? "" : num(value));
  const [was, setWas] = useState(value);
  if (was !== value) {
    setWas(value);
    setText(value == null ? "" : num(value));
  }
  function commit() {
    const next = text.trim() === "" ? null : Number(text);
    if (next != null && !(next > 0)) return setText(value == null ? "" : num(value));
    if (next !== value) void onSave({ bandwidth_mhz: next });
  }
  return (
    <label title="How wide each dwell is drawn in the chart. Blank: the default an admin sets under Admin → Settings.">
      Chart band width (MHz)
      <input
        type="number"
        step="any"
        min="0"
        value={text}
        placeholder={`${num(defaultBandwidth)} (default)`}
        disabled={!canEdit}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    </label>
  );
}

/** Several dwells at once: frequencies separated by commas, spaces or lines,
 * each with the same dwell and collect time. */
function AddSeveral({ onAdd, onClose }: { onAdd: (rows: Row[]) => void; onClose: () => void }) {
  const [freqs, setFreqs] = useState("");
  const [dwell, setDwell] = useState(String(DEFAULT_MS));
  const [collect, setCollect] = useState(String(DEFAULT_MS));
  const [error, setError] = useState<string | null>(null);
  const values = freqs.split(/[\s,;]+/).filter(Boolean);

  function submit(e: FormEvent) {
    e.preventDefault();
    const bad = values.find((v) => !(Number(v) > 0));
    if (!values.length) return setError("Give at least one frequency.");
    if (bad) return setError(`"${bad}" isn't a frequency above 0 MHz.`);
    if (!(Number(dwell) > 0)) return setError("The dwell time must be above 0 ms.");
    if (!(Number(collect) >= 0)) return setError("The collect time can't be negative.");
    onAdd(values.map((v) => ({ freq: num(Number(v)), dwell, collect })));
  }

  return (
    <Modal title="Add several dwells" onClose={onClose}>
      <form className="rename-form" onSubmit={submit}>
        <label>
          Frequencies (MHz), in order
          <textarea
            rows={4}
            value={freqs}
            onChange={(e) => setFreqs(e.target.value)}
            placeholder="e.g. 2900, 3100, 9400"
            autoFocus
          />
        </label>
        <div className="form-row">
          <label>
            Dwell (ms)
            <input type="number" step="any" min="0" value={dwell} onChange={(e) => setDwell(e.target.value)} />
          </label>
          <label>
            Collect (ms)
            <input type="number" step="any" min="0" value={collect} onChange={(e) => setCollect(e.target.value)} />
          </label>
        </div>
        <p className="hint-text">They&apos;re added after the dwells already there; save changes to keep them.</p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Add {values.length || ""} dwell{values.length === 1 ? "" : "s"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
