import { useState, type ReactNode } from "react";
import { DerivedFromPicker } from "./DerivedFromPicker";
import type { OperationalMode } from "../../api/operationalModes";
import { buildTree, flatten } from "../operationalModes/opTree";
import { useScans } from "../../state/hooks/useScans";
import { patternName, scanTiming, spreadText } from "../scans/scanPatterns";

/** Written to the PRS export — 100 % and 2 unless a Mode says otherwise. */
export const DEFAULT_CONFIRMATION_QUALITY = 100;
export const DEFAULT_CONFIRMATION_QUANTITY = 2;

export interface MoreOptionsValues {
  quality: string;
  quantity: string;
  notes: string;
  derivedFrom: Set<string>;
  /** Its own scan ("" — its operational mode's). */
  scanId?: string;
  /** The radar's operational mode it's transmitted in ("" — none). */
  operationalModeId?: string;
}

/** The EW Group's scan range, as a scan's revisit is checked against. */
export type GroupScan = { min: number | null; max: number | null } | null | undefined;

/** A revisit (s, lowest–highest) reaching outside its EW Group's range. */
export function scanOutsideGroup(revisit: [number, number] | null | undefined, group: GroupScan): boolean {
  if (!revisit || !group) return false;
  return (group.min != null && revisit[0] < group.min - 1e-9) || (group.max != null && revisit[1] > group.max + 1e-9);
}

/** Its scan as the API takes it: one of the Emitter's, or null (its operational mode's). */
export function scanPayload(values: MoreOptionsValues): { scan_id: string | null } {
  return { scan_id: values.scanId || null };
}

/** What's wrong in the options, if anything. */
export function optionsProblem(values: MoreOptionsValues): string | null {
  return confirmationProblem(values.quality, values.quantity);
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
  /** The EW Group's scan range, its scan's revisit is checked against. */
  groupScan?: GroupScan;
  /** The Emitter's operational modes, to link the Mode to one. */
  operationalModes?: OperationalMode[];
  /** The Emitter's own illumination time, ms — what a Mode takes without a scan that works one out. */
  emitterIlluminationMs?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(values.derivedFrom.size > 0);
  const problem = confirmationProblem(values.quality, values.quantity);
  const isOpen = open || !!forceOpen || !!problem;
  const groupText =
    groupScan && (groupScan.min != null || groupScan.max != null)
      ? `${groupScan.min != null ? secondsText(groupScan.min) : "?"} – ${groupScan.max != null ? secondsText(groupScan.max) : "?"}`
      : null;
  const { data: scans } = useScans(emitterId);
  const scanById = new Map((scans ?? []).map((x) => [x.id, x]));
  const tree = flatten(buildTree(operationalModes ?? [], [], new Map((scans ?? []).map((x) => [x.id, x.name]))).roots);
  const linkedNode = tree.find((x) => x.op.id === values.operationalModeId);
  const inherited = linkedNode?.scanId ? scanById.get(linkedNode.scanId) : undefined;
  const scan = (values.scanId ? scanById.get(values.scanId) : undefined) ?? inherited;
  const timing = scan ? scanTiming(scan) : null;
  const rev = timing?.revisitS;
  const outside = scanOutsideGroup(rev ? [rev.lo, rev.hi] : null, groupScan);
  const illumination = timing?.continuous
    ? "all the time"
    : timing?.illuminationMs
      ? `${spreadText(timing.illuminationMs, "ms")}, from ${scan!.name}`
      : timing?.working.length
        ? `${timing.working[0]}, from ${scan!.name}`
        : emitterIlluminationMs != null
          ? `${Number(emitterIlluminationMs.toFixed(3))} ms, the Emitter's`
          : "worked out from the planner's beamwidth";
  const summary = [
    linkedNode && linkedNode.path,
    `Confirmation ${values.quality || "?"} % × ${values.quantity || "?"}`,
    scan && `scan ${scan.name}`,
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
                    {x.scanFrom === x.op.name && x.scanId ? ` (${scanById.get(x.scanId)?.name})` : ""}
                  </option>
                ))}
              </select>
              <span className="hint-text">The radar&apos;s mode it&apos;s transmitted in{inherited ? `; its scan is ${inherited.name}` : ""}.</span>
            </label>
          )}
          {scans && scans.length > 0 && (
            <label>
              Scan
              <select value={values.scanId ?? ""} onChange={(e) => onChange({ scanId: e.target.value })}>
                <option value="">{inherited ? `— Its operational mode's: ${inherited.name} —` : "— None of its own —"}</option>
                {scans.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({patternName(x.pattern)})
                  </option>
                ))}
              </select>
              <span className="hint-text">
                For the dwell planner. Illumination time: {illumination}
                {rev ? `; revisit ${spreadText(rev, "s")}` : ""}. Not exported: the XML keeps the EW Group&apos;s range
                {groupText ? ` (${groupText})` : ""}.
              </span>
              {outside && (
                <span className="mode-form-warning">
                  {scan!.name}&apos;s revisit ({spreadText(rev!, "s")}) reaches outside its EW Group&apos;s scan range ({groupText}).
                </span>
              )}
            </label>
          )}
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
