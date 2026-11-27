/** Adding or editing one of an Emitter's scans: its pattern, then the values
 * that pattern needs (each with a ±) and the beamwidths, with the
 * illumination time and revisit worked out as they're typed — the working
 * shown — and the two pictures. A typed-in illumination time wins. */
import { useMemo, useState, type FormEvent } from "react";
import { ApiRequestError } from "../../api/client";
import type { EmitterScan } from "../../api/scans";
import { useCreateScan, useUpdateScan } from "../../state/hooks/useScans";
import { Modal } from "../common/Modal";
import { IlluminationTimeline, ScanPatternDrawing } from "./ScanGraphs";
import { PATTERN_BY_ID, PATTERN_GROUPS, SCAN_PATTERNS, scanTiming, spreadText, type ScanPatternId } from "./scanPatterns";

const str = (v: number | null | undefined) => (v == null ? "" : String(v));
const parsed = (s: string) => (s.trim() === "" ? null : Number(s));
const bad = (s: string, integer = false) => {
  if (!s.trim()) return false;
  const n = Number(s);
  return !Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n));
};

export function ScanForm({
  emitterId,
  initial,
  readOnly = false,
  onClose,
}: {
  emitterId: string;
  initial?: EmitterScan;
  /** Looking only: not the editor holding the Emitter. */
  readOnly?: boolean;
  onClose: () => void;
}) {
  const create = useCreateScan(emitterId);
  const update = useUpdateScan(emitterId);
  const [name, setName] = useState(initial?.name ?? "");
  const [pattern, setPattern] = useState<ScanPatternId>((initial?.pattern as ScanPatternId) ?? "circular");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial?.params ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [az, setAz] = useState(str(initial?.beam_az_deg));
  const [el, setEl] = useState(str(initial?.beam_el_deg));
  const [typed, setTyped] = useState(str(initial?.illumination_ms));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const def = PATTERN_BY_ID.get(pattern)!;

  const params = useMemo(() => {
    const out: Record<string, number> = {};
    for (const f of def.fields) {
      for (const key of f.integer ? [f.key] : [f.key, `${f.key}_delta`]) {
        const n = parsed(values[key] ?? "");
        if (n != null && Number.isFinite(n)) out[key] = n;
      }
    }
    return out;
  }, [def, values]);
  const scan = {
    pattern,
    params,
    beam_az_deg: def.beam.az || pattern === "spiral" ? parsed(az) : null,
    beam_el_deg: def.beam.el ? parsed(el) : null,
    illumination_ms: parsed(typed),
  };
  const timing = scanTiming(scan);
  const problems = [
    ...def.fields.flatMap((f) => [
      bad(values[f.key] ?? "", f.integer) ? `${f.label}: a number ≥ 0${f.integer ? ", whole" : ""}` : null,
      !f.integer && bad(values[`${f.key}_delta`] ?? "") ? `${f.label} ±: a number ≥ 0` : null,
    ]),
    bad(az) || (az.trim() && Number(az) === 0) ? "Azimuth beamwidth: above 0" : null,
    bad(el) || (el.trim() && Number(el) === 0) ? "Elevation beamwidth: above 0" : null,
    bad(typed) || (typed.trim() && Number(typed) === 0) ? "Illumination time: above 0" : null,
  ].filter((x): x is string => !!x);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give it a name");
    if (problems.length) return;
    const input = {
      name: name.trim(),
      pattern,
      params: Object.keys(params).length ? params : null,
      beam_az_deg: scan.beam_az_deg,
      beam_el_deg: scan.beam_el_deg,
      illumination_ms: scan.illumination_ms,
      description: description.trim() || null,
    };
    try {
      if (initial) await update.mutateAsync({ id: initial.id, input });
      else await create.mutateAsync(input);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save it");
    }
  }

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const usesBeam = def.beam.az || pattern === "spiral";

  return (
    <Modal title={initial ? `${readOnly ? "Scan" : "Edit scan"} ${initial.name}` : "Add scan"} onClose={onClose} wide className="scan-form-modal">
      <form className="edit-fields scan-form" onSubmit={submit}>
        <fieldset disabled={readOnly} className="scan-form-fieldset">
        <div className="scan-form-top">
          <label>
            Name
            <input value={name} placeholder="e.g. Surveillance rotation" onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label>
            Pattern
            <select value={pattern} onChange={(e) => setPattern(e.target.value as ScanPatternId)} aria-label="Scan pattern">
              {PATTERN_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {SCAN_PATTERNS.filter((p) => p.group === g).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <p className="hint-text">{def.about}</p>
        <div className="scan-form-body">
          <div className="scan-form-fields">
            {def.fields.length > 0 && (
              <table className="scan-values">
                <thead>
                  <tr>
                    <th />
                    <th>Value</th>
                    <th>±</th>
                  </tr>
                </thead>
                <tbody>
                  {def.fields.map((f) => (
                    <tr key={f.key}>
                      <th scope="row" title={f.hint}>
                        {f.label}
                        {f.unit && <span className="unit"> ({f.unit})</span>}
                        {f.optional && <span className="hint-text"> — optional</span>}
                      </th>
                      <td>
                        <input
                          type="number"
                          step={f.integer ? 1 : "any"}
                          min="0"
                          value={values[f.key] ?? ""}
                          aria-label={f.label}
                          aria-invalid={bad(values[f.key] ?? "", f.integer) || undefined}
                          placeholder={f.hint}
                          onChange={set(f.key)}
                        />
                      </td>
                      <td>
                        {!f.integer && (
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={values[`${f.key}_delta`] ?? ""}
                            aria-label={`${f.label} ±`}
                            onChange={set(`${f.key}_delta`)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(usesBeam || def.beam.el) && (
              <div className="mode-form-grid">
                {usesBeam && (
                  <label>
                    Beamwidth, azimuth (°)
                    <input type="number" step="any" min="0" value={az} onChange={(e) => setAz(e.target.value)} />
                  </label>
                )}
                {def.beam.el && (
                  <label>
                    Beamwidth, elevation (°)
                    <input type="number" step="any" min="0" value={el} onChange={(e) => setEl(e.target.value)} />
                  </label>
                )}
              </div>
            )}
            {!timing.continuous && (
              <label>
                Illumination time typed in (ms){pattern === "other" ? "" : " — optional"}
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={typed}
                  placeholder={pattern === "other" ? "" : "Empty: worked out"}
                  onChange={(e) => setTyped(e.target.value)}
                />
                <span className="hint-text">
                  {pattern === "other" ? "How long the beam is on a target each look." : "Wins over the worked-out time, e.g. one measured."}
                </span>
              </label>
            )}
            <label>
              Description
              <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>
          <div className="scan-form-result">
            <ScanPatternDrawing scan={scan} />
            <dl className="scan-readout">
              <div>
                <dt>Illumination</dt>
                <dd>
                  {timing.continuous ? "All the time" : spreadText(timing.illuminationMs, "ms")}
                  {timing.looks > 1 && ` × ${timing.looks} looks`}
                </dd>
              </div>
              <div>
                <dt>Revisit</dt>
                <dd>{timing.continuous ? "—" : spreadText(timing.revisitS, "s")}</dd>
              </div>
            </dl>
            {timing.working.map((w) => (
              <p key={w} className="scan-working">
                {w}
              </p>
            ))}
            {timing.missing.length > 0 && <p className="hint-text">Still needs: {timing.missing.join(", ")}.</p>}
            <p className="hint-text scan-formula">{def.formula}</p>
          </div>
        </div>
        </fieldset>
        <IlluminationTimeline scan={scan} timing={timing} />
        {problems.length > 0 && <p className="line-row-problem">{problems.join(" · ")}</p>}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && (
            <button type="submit" className="button primary" disabled={create.isPending || update.isPending || problems.length > 0}>
              {initial ? "Save" : "Add"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
