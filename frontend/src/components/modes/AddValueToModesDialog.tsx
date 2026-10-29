import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Modal } from "../common/Modal";
import { ApiRequestError } from "../../api/client";
import { modesApi, type ParameterValue, type ValueParameter } from "../../api/modes";
import { useAddParameter, useEmitterModes } from "../../state/hooks/useModes";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";

/** What the dialog opens with — e.g. a PRI logged in a test, or an Element. */
export interface ValueSeed {
  parameter: ValueParameter;
  /** Strings as typed into the fields (blank = not set). */
  from?: number | null;
  to?: number | null;
  jitterFrom?: number | null;
  jitterTo?: number | null;
  margin?: number | null;
  priType?: "fixed" | "stagger";
  steps?: number[] | null;
}

const PARAMS: { key: ValueParameter; label: string; unit: string }[] = [
  { key: "pri", label: "PRI", unit: "µs" },
  { key: "rf", label: "RF", unit: "MHz" },
  { key: "pw", label: "PW", unit: "µs" },
];

const str = (v: number | null | undefined) => (v == null ? "" : String(v));
const numOrNull = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** The value as the backend wants it, or why it can't be sent yet. */
function toValue(
  parameter: ValueParameter,
  f: { from: string; to: string; jFrom: string; jTo: string; margin: string; priType: "fixed" | "stagger"; steps: string },
): ParameterValue | string {
  const from = numOrNull(f.from);
  const to = numOrNull(f.to) ?? from;
  const margin = numOrNull(f.margin) ?? 0;
  if (parameter === "pri" && f.priType === "stagger") {
    const steps = f.steps
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number);
    if (steps.length < 2 || steps.some((v) => !Number.isFinite(v) || v <= 0)) return "Give the stagger's steps (at least two)";
    return { parameter, pri_type: "stagger", values: { pri_stagger_values_us: steps, frame_time_delta_us: margin } };
  }
  if (from == null) return "Give the value";
  if (to == null || to < from) return "The range runs low to high";
  if (parameter === "rf") return { parameter, values: { rf_min_mhz: from, rf_max_mhz: to, rf_delta: margin } };
  if (parameter === "pw") return { parameter, values: { pw_min_us: from, pw_max_us: to, pw_delta: margin } };
  const jFrom = numOrNull(f.jFrom) ?? 0;
  const jTo = numOrNull(f.jTo) ?? jFrom;
  return {
    parameter,
    pri_type: "fixed",
    values: { pri_min_us: from, pri_max_us: to, jitter_min_us: jFrom, jitter_max_us: jTo, pri_delta: margin },
  };
}

function suffixFor(parameter: ValueParameter, f: { from: string; to: string; priType: string; steps: string }) {
  const label = PARAMS.find((p) => p.key === parameter)!.label;
  if (parameter === "pri" && f.priType === "stagger") return `Stagger ${f.steps.split(/[\s,;]+/).filter(Boolean).join("/")}`;
  const to = f.to.trim() && f.to !== f.from ? `–${f.to}` : "";
  return f.from.trim() ? `${label} ${f.from}${to}` : label;
}

/** Adds one parameter value — a stray PRI seen in a test, say — to every
 * applicable combination of the other two among the Emitter's Modes: one
 * new Mode per ticked combination, a copy of one of its Modes with only that
 * parameter changed, all in one generation batch. */
export function AddValueToModesDialog({
  emitterId,
  seed,
  context,
  derivedFromTestRecordId,
  extraSourceIds,
  onClose,
}: {
  emitterId: string;
  seed?: ValueSeed;
  /** Where the value comes from, in words. */
  context?: string;
  derivedFromTestRecordId?: string;
  /** Sources to give each new Mode besides its template's (an Element's). */
  extraSourceIds?: string[];
  onClose: () => void;
}) {
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const add = useAddParameter(emitterId);
  const [parameter, setParameter] = useState<ValueParameter>(seed?.parameter ?? "pri");
  const [fields, setFields] = useState({
    from: str(seed?.from),
    to: str(seed?.to),
    jFrom: str(seed?.jitterFrom),
    jTo: str(seed?.jitterTo),
    margin: str(seed?.margin ?? 0),
    priType: seed?.priType ?? ("fixed" as "fixed" | "stagger"),
    steps: (seed?.steps ?? []).join(", "),
  });
  const [suffix, setSuffix] = useState<string | null>(null);
  // From a test, the new Modes get a name of their own with a running number
  // by default, rather than the copied Mode's name with something added.
  const [naming, setNaming] = useState<"numbered" | "suffix">(derivedFromTestRecordId ? "numbered" : "suffix");
  const [base, setBase] = useState<string | null>(null);
  const { data: emitterModes } = useEmitterModes(emitterId);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ names: string[]; skipped: number } | null>(null);

  const value = toValue(parameter, fields);
  // Asked for a moment after the typing stops.
  const [asked, setAsked] = useState<ParameterValue | null>(typeof value === "string" ? null : value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const t = setTimeout(() => setAsked(typeof value === "string" ? null : value), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const plan = useQuery({
    queryKey: ["parameterPlan", emitterId, asked],
    queryFn: () => modesApi.planParameter(emitterId, asked!),
    enabled: asked != null,
  });
  const rows = useMemo(() => plan.data?.rows ?? [], [plan.data]);
  const picked = rows.filter((r) => !r.has_value && !unticked.has(r.key));
  const name = suffix ?? suffixFor(parameter, fields);
  const baseName = base ?? suffixFor(parameter, fields);
  // The numbers carry on from the highest "<name> N" the Emitter has — as the server numbers them.
  const firstNumber = useMemo(() => {
    const trimmed = baseName.trim();
    const numbers = (emitterModes ?? [])
      .map((m) => (m.name.startsWith(`${trimmed} `) ? m.name.slice(trimmed.length + 1) : ""))
      .filter((rest) => /^\d+$/.test(rest))
      .map(Number);
    return Math.max(0, ...numbers) + 1;
  }, [emitterModes, baseName]);
  const nameGiven = naming === "numbered" ? baseName.trim() !== "" : name.trim() !== "";
  const set = (k: keyof typeof fields) => (e: { target: { value: string } }) => setFields({ ...fields, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (typeof value === "string" || picked.length === 0) return;
    setError(null);
    try {
      const result = await add.mutateAsync({
        ...value,
        row_keys: picked.map((r) => r.key),
        ...(naming === "numbered" ? { name_base: baseName.trim() } : { name_suffix: name }),
        extra_source_ids: extraSourceIds,
        derived_from_test_record_id: derivedFromTestRecordId,
      });
      setDone({ names: result.created.map((m) => m.name), skipped: result.skipped.length });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't add them.");
    }
  }

  const unit = PARAMS.find((p) => p.key === parameter)!.unit;
  return (
    <Modal title="Add a value to the Modes" onClose={onClose} className="form-dialog">
      {done ? (
        <div className="add-value">
          <p>
            Added {done.names.length} Mode{done.names.length === 1 ? "" : "s"}
            {done.skipped ? ` — ${done.skipped} skipped, they had it already` : ""}. They&apos;re one generation batch
            on the Modes tab.
          </p>
          <ul className="add-value-created">
            {done.names.map((n) => (
              <li key={n}>
                <Link to={`/emitters/${emitterId}?tab=modes&mode=${encodeURIComponent(n)}`} onClick={onClose}>
                  {n}
                </Link>
              </li>
            ))}
          </ul>
          <div className="modal-actions">
            <button type="button" className="button primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className="add-value" onSubmit={submit}>
          {context && <p className="hint-text">{context}</p>}
          <div className="add-value-params" role="group" aria-label="Parameter">
            {PARAMS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={parameter === p.key ? "button primary small" : "button secondary small"}
                aria-pressed={parameter === p.key}
                onClick={() => {
                  setParameter(p.key);
                  setUnticked(new Set());
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="add-value-fields">
            {parameter === "pri" && (
              <label>
                Type
                <select value={fields.priType} onChange={(e) => setFields({ ...fields, priType: e.target.value as "fixed" | "stagger" })}>
                  <option value="fixed">Fixed</option>
                  <option value="stagger">Stagger</option>
                </select>
              </label>
            )}
            {parameter === "pri" && fields.priType === "stagger" ? (
              <>
                <label className="add-value-steps">
                  Steps ({unit}, in firing order)
                  <input value={fields.steps} onChange={set("steps")} placeholder="700, 750, 1200" />
                </label>
                <label>
                  Frame time ± delta ({unit})
                  <input value={fields.margin} onChange={set("margin")} inputMode="decimal" />
                </label>
              </>
            ) : (
              <>
                <label>
                  {PARAMS.find((p) => p.key === parameter)!.label} from ({unit})
                  <input value={fields.from} onChange={set("from")} inputMode="decimal" autoFocus />
                </label>
                <label>
                  to
                  <input value={fields.to} onChange={set("to")} inputMode="decimal" placeholder={fields.from} />
                </label>
                {parameter === "pri" && (
                  <>
                    <label>
                      Jitter from
                      <input value={fields.jFrom} onChange={set("jFrom")} inputMode="decimal" placeholder="0" />
                    </label>
                    <label>
                      to
                      <input value={fields.jTo} onChange={set("jTo")} inputMode="decimal" placeholder={fields.jFrom || "0"} />
                    </label>
                  </>
                )}
                <label>
                  Delta ± ({unit})
                  <input value={fields.margin} onChange={set("margin")} inputMode="decimal" />
                </label>
              </>
            )}
          </div>

          {typeof value === "string" ? (
            <p className="hint-text">{value}.</p>
          ) : plan.isLoading || asked == null ? (
            <p className="hint-text">Finding the combinations…</p>
          ) : plan.error ? (
            <p className="error-text">{(plan.error as Error).message}</p>
          ) : rows.length === 0 ? (
            <p className="hint-text">This Emitter has no Modes to add it to yet.</p>
          ) : (
            <>
              <div className="add-value-rows-head">
                <strong>Add {plan.data?.value} to</strong>
                <span className="hint-text">
                  each combination of the other parameters among the Modes — untick the ones it doesn&apos;t apply to
                </span>
                <button type="button" className="link-button" onClick={() => setUnticked(new Set())}>
                  Tick all
                </button>
                <button type="button" className="link-button" onClick={() => setUnticked(new Set(rows.map((r) => r.key)))}>
                  Untick all
                </button>
              </div>
              <ul className="add-value-rows">
                {rows.map((r) => (
                  <li key={r.key} className={r.has_value ? "muted" : undefined}>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        disabled={r.has_value}
                        checked={!r.has_value && !unticked.has(r.key)}
                        onChange={() => {
                          const next = new Set(unticked);
                          if (next.has(r.key)) next.delete(r.key);
                          else next.add(r.key);
                          setUnticked(next);
                        }}
                      />
                      <span className="add-value-row-label">{r.label}</span>
                      <span className="hint-text">
                        {r.ew_group_name} · {r.has_value ? `${r.mode_names.join(", ")} has it already` : `like ${r.mode_names.join(", ")}`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}

          <fieldset className="add-value-naming">
            <legend>Name the new Modes</legend>
            <label className="inline-label">
              <input type="radio" checked={naming === "numbered"} onChange={() => setNaming("numbered")} />
              <input
                value={baseName}
                onChange={(e) => {
                  setBase(e.target.value);
                  setNaming("numbered");
                }}
                aria-label="Name to number"
              />
              <span className="hint-text">
                with a number
                {baseName.trim() && picked.length > 0 && (
                  <>
                    {" "}
                    — {baseName.trim()} {firstNumber}
                    {picked.length > 1 && <>, {baseName.trim()} {firstNumber + 1}</>}
                    {picked.length > 2 && " …"}
                  </>
                )}
              </span>
            </label>
            <label className="inline-label">
              <input type="radio" checked={naming === "suffix"} onChange={() => setNaming("suffix")} />
              <span>After the Mode each one copies, plus</span>
              <input
                value={name}
                onChange={(e) => {
                  setSuffix(e.target.value);
                  setNaming("suffix");
                }}
                aria-label="Suffix"
              />
            </label>
          </fieldset>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            {!canEdit && <span className="hint-text">Start editing the Emitter to add them.</span>}
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={!canEdit || add.isPending || typeof value === "string" || picked.length === 0 || !nameGiven}
            >
              {add.isPending ? "Adding…" : `Add ${picked.length} Mode${picked.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
