import { useState, type ReactNode } from "react";
import { DerivedFromPicker } from "./DerivedFromPicker";
import type { OperationalMode } from "../../api/operationalModes";
import { buildTree, flatten } from "../operationalModes/opTree";

/** Written to the PRS export — 100 % and 2 unless a Mode says otherwise. */
export const DEFAULT_CONFIRMATION_QUALITY = 100;
export const DEFAULT_CONFIRMATION_QUANTITY = 2;

export interface MoreOptionsValues {
  quality: string;
  quantity: string;
  notes: string;
  derivedFrom: Set<string>;
  /** The function's own scan period box (s), inside the EW Group's range — both or neither. */
  scanMin?: string;
  scanMax?: string;
  /** The radar's operational mode it's transmitted in ("" — none). */
  operationalModeId?: string;
}

/** The EW Group's scan range, as a box inside it is checked against. */
export type GroupScan = { min: number | null; max: number | null } | null | undefined;

/** What's wrong with the scan period box, if anything. Outside the EW
 * Group's range is a warning, not a problem: see scanOutsideGroup. */
export function scanProblem(min = "", max = ""): string | null {
  const a = min.trim();
  const b = max.trim();
  if (!a && !b) return null;
  if (!a || !b) return "Give the scan period both a min and a max, or leave both empty";
  const lo = Number(a);
  const hi = Number(b);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < 0) return "The scan period is a number of seconds, 0 or more";
  if (lo > hi) return "The scan period's min can't be above its max";
  return null;
}

/** The box reaches outside its EW Group's range. */
export function scanOutsideGroup(min = "", max = "", group: GroupScan): boolean {
  if (scanProblem(min, max) || !min.trim() || !group) return false;
  return (group.min != null && Number(min) < group.min) || (group.max != null && Number(max) > group.max);
}

/** The box as the API takes it: both numbers, or both null. */
export function scanPayload(values: MoreOptionsValues): { scan_min_s: number | null; scan_max_s: number | null } {
  const a = (values.scanMin ?? "").trim();
  const b = (values.scanMax ?? "").trim();
  return a && b ? { scan_min_s: Number(a), scan_max_s: Number(b) } : { scan_min_s: null, scan_max_s: null };
}

/** What's wrong in the options, if anything. */
export function optionsProblem(values: MoreOptionsValues): string | null {
  return confirmationProblem(values.quality, values.quantity) ?? scanProblem(values.scanMin, values.scanMax);
}

const secondsText = (v: number) => `${Number(v.toFixed(3))} s`;

/** What's wrong with the confirmation numbers, if anything. */
export function confirmationProblem(quality: string, quantity: string): string | null {
  const q = Number(quality);
  const n = Number(quantity);
  if (quality.trim() === "" || !Number.isInteger(q) || q < 0 || q > 100) return "Confirmation quality is a whole number from 0 to 100";
  if (quantity.trim() === "" || !Number.isInteger(n) || n < 1) return "Confirmation quantity is a whole number, 1 or more";
  return null;
}

/** The fields most Modes leave alone — confirmation, notes,
 * test-derived — folded into one line that says what they're set to. */
export function ModeMoreOptions({
  values,
  onChange,
  emitterId,
  showDerived,
  forceOpen,
  extra,
  groupScan,
  operationalModes,
  emitterIlluminationMs,
}: {
  values: MoreOptionsValues;
  onChange: (part: Partial<MoreOptionsValues>) => void;
  emitterId: string;
  /** Offer "test-derived" — not when the form already fixes where the Mode came from. */
  showDerived: boolean;
  /** Open regardless, e.g. when something in here needs fixing. */
  forceOpen?: boolean;
  extra?: ReactNode;
  /** The EW Group's scan range, shown by the Mode's own box. */
  groupScan?: GroupScan;
  /** The Emitter's operational modes, to link the Mode to one. */
  operationalModes?: OperationalMode[];
  /** The Emitter's own illumination time, ms — what a Mode takes without an operational mode's. */
  emitterIlluminationMs?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(values.derivedFrom.size > 0);
  const problem = confirmationProblem(values.quality, values.quantity);
  const scanBad = scanProblem(values.scanMin, values.scanMax);
  const outside = scanOutsideGroup(values.scanMin, values.scanMax, groupScan);
  const isOpen = open || !!forceOpen || !!problem || !!scanBad;
  const hasBox = !!(values.scanMin ?? "").trim() && !!(values.scanMax ?? "").trim();
  const groupText =
    groupScan && (groupScan.min != null || groupScan.max != null)
      ? `${groupScan.min != null ? secondsText(groupScan.min) : "?"} – ${groupScan.max != null ? secondsText(groupScan.max) : "?"}`
      : null;
  const tree = flatten(buildTree(operationalModes ?? [], []).roots);
  const linkedNode = tree.find((x) => x.op.id === values.operationalModeId);
  const illumination =
    linkedNode?.illuminationMs != null
      ? `${Number(linkedNode.illuminationMs.toFixed(3))} ms, from ${linkedNode.illuminationFrom}`
      : emitterIlluminationMs != null
        ? `${Number(emitterIlluminationMs.toFixed(3))} ms, the Emitter's`
        : "worked out from the planner's beamwidth";
  const summary = [
    linkedNode && linkedNode.path,
    `Confirmation ${values.quality || "?"} % × ${values.quantity || "?"}`,
    hasBox && `scan ${values.scanMin}–${values.scanMax} s`,
    values.notes.trim() ? "has notes" : "no notes",
    values.derivedFrom.size > 0 && `test-derived (${values.derivedFrom.size})`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={isOpen ? "mode-more open" : "mode-more"}>
      <button type="button" className="mode-more-toggle" aria-expanded={isOpen} onClick={() => setOpen((o) => !o)}>
        <span>{isOpen ? "▾" : "▸"} More options</span>
        {!isOpen && <span className="hint-text">{summary}</span>}
      </button>
      {isOpen && (
        <div className="mode-more-body">
          <div className="mode-form-grid">
            <label title="Written to the PRS export">
              Confirmation quality (0–100)
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={values.quality}
                aria-invalid={!!problem || undefined}
                onChange={(e) => onChange({ quality: e.target.value })}
              />
            </label>
            <label title="Written to the PRS export">
              Confirmation quantity
              <input
                type="number"
                step="1"
                min="1"
                value={values.quantity}
                aria-invalid={!!problem || undefined}
                onChange={(e) => onChange({ quantity: e.target.value })}
              />
            </label>
          </div>
          {problem && (
            <p className="line-row-problem" role="alert">
              {problem}
            </p>
          )}
          {operationalModes && operationalModes.length > 0 && (
            <label>
              Operational mode
              <select value={values.operationalModeId ?? ""} onChange={(e) => onChange({ operationalModeId: e.target.value })}>
                <option value="">— None —</option>
                {tree.map((x) => (
                  <option key={x.op.id} value={x.op.id}>
                    {"\u2003".repeat(x.depth)}
                    {x.op.name}
                    {x.op.illumination_time_ms != null ? ` (${Number(x.op.illumination_time_ms.toFixed(3))} ms)` : ""}
                  </option>
                ))}
              </select>
              <span className="hint-text">The radar&apos;s mode it&apos;s transmitted in. Illumination time: {illumination}.</span>
            </label>
          )}
          <fieldset className="mode-scan-box">
            <legend>Scan period of this Mode&apos;s function (s)</legend>
            <div className="mode-form-grid">
              <label>
                Min
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={values.scanMin ?? ""}
                  placeholder={groupScan?.min != null ? String(groupScan.min) : undefined}
                  aria-invalid={!!scanBad || undefined}
                  onChange={(e) => onChange({ scanMin: e.target.value })}
                />
              </label>
              <label>
                Max
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={values.scanMax ?? ""}
                  placeholder={groupScan?.max != null ? String(groupScan.max) : undefined}
                  aria-invalid={!!scanBad || undefined}
                  onChange={(e) => onChange({ scanMax: e.target.value })}
                />
              </label>
            </div>
            {scanBad ? (
              <p className="line-row-problem" role="alert">
                {scanBad}
              </p>
            ) : outside ? (
              <p className="mode-form-warning">Reaches outside its EW Group&apos;s scan range ({groupText}).</p>
            ) : (
              <p className="hint-text">
                Its own box inside the EW Group&apos;s overall scan range{groupText ? ` (${groupText})` : ""}, for the dwell planner. Empty:
                the EW Group&apos;s range. Not exported.
              </p>
            )}
          </fieldset>
          <label>
            Notes
            <textarea
              rows={2}
              placeholder="Any context worth recording about this Mode…"
              value={values.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
            />
          </label>
          {extra}
          {showDerived &&
            (showPicker ? (
              <div>
                <h3 className="as-h5">Explained by test result(s)</h3>
                <DerivedFromPicker
                  emitterId={emitterId}
                  selected={values.derivedFrom}
                  onChange={(derivedFrom) => onChange({ derivedFrom })}
                />
              </div>
            ) : (
              <button type="button" className="link-button" onClick={() => setShowPicker(true)}>
                + This Mode is test-derived (not from the Source)
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
