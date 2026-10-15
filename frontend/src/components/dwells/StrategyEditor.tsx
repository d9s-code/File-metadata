import { useEffect, useState } from "react";
import type { DwellStrategy, MergedDwell } from "../../api/dwells";
import { ApiRequestError } from "../../api/client";
import { MenuButton } from "../common/MenuButton";
import { DwellChart, num } from "./DwellChart";

const DEFAULT_MS = 50;

/** A dwell row as typed: text, so a half-typed number stays put. */
interface Row {
  freq: string;
  dwell: string;
  collect: string;
}

const toRow = (d: MergedDwell): Row => ({ freq: num(d.freq_mhz), dwell: num(d.dwell_time_ms), collect: num(d.collect_time_ms) });

function parse(rows: Row[]): { dwells: MergedDwell[]; problem: string | null } {
  const dwells: MergedDwell[] = [];
  for (const [i, r] of rows.entries()) {
    const freq = Number(r.freq);
    const dwell = Number(r.dwell);
    const collect = r.collect.trim() === "" ? DEFAULT_MS : Number(r.collect);
    if (!r.freq.trim() || !(freq > 0)) return { dwells, problem: `Dwell ${i + 1}: give a frequency above 0 MHz.` };
    if (!(dwell > 0)) return { dwells, problem: `Dwell ${i + 1}: the dwell time must be above 0 ms.` };
    if (!(collect >= 0)) return { dwells, problem: `Dwell ${i + 1}: the collect time can't be negative.` };
    dwells.push({ freq_mhz: freq, dwell_time_ms: dwell, collect_time_ms: collect });
  }
  return { dwells, problem: null };
}

/** One Dwell Strategy — one Platform's dwell: which Platform, the manual
 * collect time, and the Merged Mode dwells (edited here, then saved), with
 * the dwell drawn over time. */
export function StrategyEditor({
  index,
  count,
  strategy,
  platforms,
  mdfPlatformIds,
  takenPlatformIds,
  bandwidthMhz,
  canEdit,
  onSave,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  strategy: DwellStrategy;
  platforms: { id: string; name: string }[];
  /** The Platforms the file's MDF pins (null: no MDF). */
  mdfPlatformIds: Set<string> | null;
  /** Platforms other Strategies in this file already have. */
  takenPlatformIds: Set<string>;
  bandwidthMhz: number;
  canEdit: boolean;
  onSave: (input: { platform_id?: string | null; manual_collect_time_ms?: number; merged_mode?: MergedDwell[] }) => Promise<unknown>;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => strategy.merged_mode.map(toRow));
  const [manual, setManual] = useState(num(strategy.manual_collect_time_ms));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Saved elsewhere (or just now): start from what's stored.
  const stored = JSON.stringify([strategy.merged_mode, strategy.manual_collect_time_ms]);
  useEffect(() => {
    setRows(strategy.merged_mode.map(toRow));
    setManual(num(strategy.manual_collect_time_ms));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  const { dwells, problem } = parse(rows);
  const dirty =
    JSON.stringify(rows) !== JSON.stringify(strategy.merged_mode.map(toRow)) || manual !== num(strategy.manual_collect_time_ms);
  const manualValue = manual.trim() === "" ? DEFAULT_MS : Number(manual);

  function setRow(i: number, patch: Partial<Row>) {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function moveRow(i: number, to: number) {
    if (to < 0 || to >= rows.length) return;
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
      await onSave({ merged_mode: dwells, manual_collect_time_ms: manualValue });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save the Strategy.");
    } finally {
      setSaving(false);
    }
  }

  async function pickPlatform(platformId: string) {
    setError(null);
    try {
      await onSave({ platform_id: platformId || null });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't change the Platform.");
    }
  }

  const inMdf = mdfPlatformIds ? platforms.filter((p) => mdfPlatformIds.has(p.id)) : platforms;
  const others = mdfPlatformIds ? platforms.filter((p) => !mdfPlatformIds.has(p.id)) : [];
  const option = (p: { id: string; name: string }) => (
    <option key={p.id} value={p.id} disabled={takenPlatformIds.has(p.id)}>
      {p.name}
      {takenPlatformIds.has(p.id) ? " (has a Strategy)" : ""}
    </option>
  );
  const totalMs = dwells.reduce((sum, d) => sum + d.dwell_time_ms, 0);

  return (
    <section className="card dwell-strategy">
      <div className="card-header-row">
        <h3>
          Strategy {index + 1}
          <span className="hint-text">
            {" "}
            · {strategy.platform_name ?? "no Platform yet"} · {dwells.length} dwell{dwells.length === 1 ? "" : "s"}
            {totalMs > 0 ? `, ${num(totalMs)} ms a cycle` : ""}
          </span>
        </h3>
        {canEdit && (
          <MenuButton
            label="⋯"
            className="row-menu-button"
            ariaLabel={`Actions for Strategy ${index + 1}`}
            items={[
              { label: "Move up", disabled: index === 0, onSelect: () => onMove(-1) },
              { label: "Move down", disabled: index === count - 1, onSelect: () => onMove(1) },
              { label: "Remove this Strategy…", danger: true, onSelect: onRemove },
            ]}
          />
        )}
      </div>

      <div className="form-row">
        <label>
          Platform
          <select value={strategy.platform_id ?? ""} disabled={!canEdit} onChange={(e) => void pickPlatform(e.target.value)}>
            <option value="">— Pick the Platform —</option>
            {mdfPlatformIds ? (
              <>
                <optgroup label="In the MDF">{inMdf.map(option)}</optgroup>
                {others.length > 0 && <optgroup label="Not in the MDF">{others.map(option)}</optgroup>}
              </>
            ) : (
              inMdf.map(option)
            )}
          </select>
        </label>
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
      </div>
      {!strategy.platform_id && <p className="hint-text">Pick which Platform this dwell is for.</p>}
      {strategy.platform_in_mdf === false && (
        <p className="mode-form-warning">{strategy.platform_name} isn&apos;t pinned in this file&apos;s MDF.</p>
      )}

      <h4>Merged Mode</h4>
      <table className="data-table dwell-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Frequency (MHz)</th>
            <th>Dwell (ms)</th>
            <th>Collect (ms)</th>
            {canEdit && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={r.freq}
                  disabled={!canEdit}
                  aria-label={`Dwell ${i + 1} frequency (MHz)`}
                  onChange={(e) => setRow(i, { freq: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={r.dwell}
                  disabled={!canEdit}
                  aria-label={`Dwell ${i + 1} dwell time (ms)`}
                  onChange={(e) => setRow(i, { dwell: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={r.collect}
                  disabled={!canEdit}
                  placeholder={String(DEFAULT_MS)}
                  aria-label={`Dwell ${i + 1} collect time (ms)`}
                  onChange={(e) => setRow(i, { collect: e.target.value })}
                />
              </td>
              {canEdit && (
                <td className="nowrap">
                  <button type="button" className="link-button" disabled={i === 0} onClick={() => moveRow(i, i - 1)} aria-label="Move up">
                    ↑
                  </button>{" "}
                  <button
                    type="button"
                    className="link-button"
                    disabled={i === rows.length - 1}
                    onClick={() => moveRow(i, i + 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </button>{" "}
                  <button
                    type="button"
                    className="link-button link-button-danger"
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    aria-label={`Remove dwell ${i + 1}`}
                  >
                    ✕
                  </button>
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={canEdit ? 5 : 4} className="hint-text">
                No dwells yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {canEdit && (
        <div className="form-row dwell-actions">
          <button
            type="button"
            className="button secondary small"
            onClick={() => setRows([...rows, { freq: "", dwell: String(DEFAULT_MS), collect: String(DEFAULT_MS) }])}
          >
            + Add dwell
          </button>
          {dirty && (
            <>
              <button type="button" className="button primary small" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setRows(strategy.merged_mode.map(toRow));
                  setManual(num(strategy.manual_collect_time_ms));
                  setError(null);
                }}
              >
                Discard
              </button>
              <span className="hint-text">Unsaved — the chart shows them already.</span>
            </>
          )}
        </div>
      )}
      {(error || (dirty && problem)) && (
        <p className="error-text" role="alert">
          {error ?? problem}
        </p>
      )}

      <DwellChart dwells={dwells} bandwidthMhz={bandwidthMhz} />

      <p className="hint-text dwell-kept">
        Kept as in the file, not edited here: RapidDF{" "}
        {strategy.rapid_df ? Object.entries(strategy.rapid_df).map(([k, v]) => `${k} ${v}`).join(", ") : "none"} · Split Mode{" "}
        {strategy.split_mode?.length
          ? strategy.split_mode.map((d) => `${d.freqs.join(", ")} (dwell ${d.dwell_time}, collect ${d.collect_time})`).join("; ")
          : "none"}
      </p>
    </section>
  );
}
