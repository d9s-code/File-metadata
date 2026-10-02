import { useMemo, useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { ApiRequestError } from "../../api/client";
import { useEwGroups } from "../../state/hooks/useEwGroups";
import { useSources } from "../../state/hooks/useSources";
import { useFunctionGroups } from "../../state/hooks/useFunctionGroups";
import { useCreateModesFromIntercept } from "../../state/hooks/useModes";
import type { EntryMatch } from "./interceptMatch";
import type { Intercept, InterceptEntry } from "../../types/domain";

const PREVIEW_ROWS = 8;
const TYPE_LABEL: Record<string, string> = { fixed: "Fixed", stagger: "Stagger", cw: "CW" };
const TYPE_ORDER: Record<string, number> = { fixed: 0, stagger: 1, cw: 2 };

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
const r3 = (v: number) => Number(v.toFixed(3));

/** One Mode per selected entry, in one batch: the entry's measured range (or
 * its mean) widened by the deltas given. Entries that already match a Mode,
 * or already had one created from them, can be left out. The batch can be
 * deleted together from the Modes tab. */
export function ModesFromEntriesModal({
  intercept,
  entries,
  matchById,
  onClose,
  onDone,
}: {
  intercept: Intercept;
  entries: InterceptEntry[];
  matchById: Map<string, EntryMatch> | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const emitterId = intercept.emitter_id;
  const { data: ewGroups } = useEwGroups(emitterId);
  const { data: sources } = useSources(emitterId);
  const { data: functionGroups } = useFunctionGroups(emitterId);
  const create = useCreateModesFromIntercept(emitterId);

  const [skipMatching, setSkipMatching] = useState(true);
  const [skipUsed, setSkipUsed] = useState(true);
  const [ewGroupId, setEwGroupId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [functionGroupId, setFunctionGroupId] = useState("");
  const [prefix, setPrefix] = useState(intercept.name.slice(0, 150));
  const [ranges, setRanges] = useState<"measured" | "mean">("measured");
  const [rfDelta, setRfDelta] = useState("0");
  const [pwDelta, setPwDelta] = useState("0");
  const [priDelta, setPriDelta] = useState("0");
  const [frameDelta, setFrameDelta] = useState("0");
  const [cwPwMin, setCwPwMin] = useState("");
  const [cwPwMax, setCwPwMax] = useState("");
  const [error, setError] = useState<string | null>(null);

  const matching = entries.filter((e) => matchById?.get(e.id)?.status === "match");
  const used = entries.filter((e) => e.derived_mode_ids.length > 0);
  const chosen = useMemo(
    () =>
      entries
        .filter((e) => !(skipMatching && matchById?.get(e.id)?.status === "match"))
        .filter((e) => !(skipUsed && e.derived_mode_ids.length > 0))
        // The server names them in this order: PRI type as declared (fixed, stagger, CW), then RF.
        .sort((a, b) => (TYPE_ORDER[a.pri_type] ?? 9) - (TYPE_ORDER[b.pri_type] ?? 9) || a.rf_mean_mhz - b.rf_mean_mhz),
    [entries, skipMatching, skipUsed, matchById],
  );
  const types = new Set(chosen.map((e) => e.pri_type));
  const needsCwPw = types.has("cw");
  const cwPwOk = !needsCwPw || (cwPwMin !== "" && cwPwMax !== "" && num(cwPwMin) <= num(cwPwMax));
  const group = ewGroupId || ewGroups?.[0]?.id || "";
  const source = sourceId || sources?.[0]?.id || "";

  // What each Mode will cover — its engineered range: the entry's span widened by the delta.
  function span(e: InterceptEntry, which: "rf" | "pri" | "pw") {
    const mean = which === "rf" ? e.rf_mean_mhz : which === "pri" ? e.pri_mean_us : e.pw_mean_us;
    if (mean == null) {
      if (which === "pw" && e.pri_type === "cw" && cwPwMin !== "" && cwPwMax !== "")
        return `${r3(num(cwPwMin) - num(pwDelta))}–${r3(num(cwPwMax) + num(pwDelta))}`;
      return "—";
    }
    const lo = ranges === "measured" ? ((which === "rf" ? e.rf_min_mhz : which === "pri" ? e.pri_min_us : e.pw_min_us) ?? mean) : mean;
    const hi = ranges === "measured" ? ((which === "rf" ? e.rf_max_mhz : which === "pri" ? e.pri_max_us : e.pw_max_us) ?? mean) : mean;
    const d = which === "rf" ? num(rfDelta) : which === "pw" ? num(pwDelta) : e.pri_type === "stagger" ? num(frameDelta) : num(priDelta);
    return `${r3(lo - d)}–${r3(hi + d)}`;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const modes = await create.mutateAsync({
        ewGroupId: group,
        input: {
          intercept_id: intercept.id,
          entry_ids: chosen.map((c) => c.id),
          source_id: source,
          function_group_id: functionGroupId || null,
          name_prefix: prefix.trim(),
          ranges,
          rf_delta: num(rfDelta),
          pw_delta: num(pwDelta),
          pri_delta: num(priDelta),
          frame_time_delta_us: num(frameDelta),
          cw_pw_min_us: needsCwPw ? num(cwPwMin) : null,
          cw_pw_max_us: needsCwPw ? num(cwPwMax) : null,
        },
      });
      onDone(
        `Created ${modes.length} Mode${modes.length === 1 ? "" : "s"} (${modes[0]?.name}${modes.length > 1 ? ` – ${modes[modes.length - 1].name}` : ""}) in one batch — each linked to its entry. The batch can be deleted together from the Modes tab.`,
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't create the Modes — nothing was created.");
    }
  }

  const deltaInput = (label: string, value: string, set: (v: string) => void) => (
    <label>
      {label}
      <input className="edit-input" type="number" step="any" min="0" value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );

  return (
    <Modal title={`Create Modes from ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`} onClose={onClose} wide>
      <form onSubmit={(e) => void submit(e)} className="modes-from-entries">
        <p className="hint-text">
          One Mode per entry, from its values, all in one batch (deletable together from the Modes tab). Each Mode is
          linked to the entry it came from.
        </p>
        {(matching.length > 0 || used.length > 0) && (
          <div className="form-row modes-from-skips">
            {matching.length > 0 && (
              <label className="inline-label">
                <input type="checkbox" checked={skipMatching} onChange={(e) => setSkipMatching(e.target.checked)} />
                Leave out the {matching.length} that already match a Mode
              </label>
            )}
            {used.length > 0 && (
              <label className="inline-label">
                <input type="checkbox" checked={skipUsed} onChange={(e) => setSkipUsed(e.target.checked)} />
                Leave out the {used.length} already used to create a Mode
              </label>
            )}
          </div>
        )}
        <div className="form-row">
          <label className="grow">
            EW Group
            <select className="edit-input" value={group} onChange={(e) => setEwGroupId(e.target.value)} required>
              {(ewGroups ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grow">
            Source
            <select className="edit-input" value={source} onChange={(e) => setSourceId(e.target.value)} required>
              {(sources ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {(functionGroups ?? []).length > 0 && (
            <label className="grow">
              Function group
              <select className="edit-input" value={functionGroupId} onChange={(e) => setFunctionGroupId(e.target.value)}>
                <option value="">None</option>
                {(functionGroups ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="form-row">
          <label className="grow">
            Names
            <input className="edit-input" value={prefix} maxLength={150} onChange={(e) => setPrefix(e.target.value)} required />
            <span className="hint-text">
              {prefix.trim() || "…"} 1, {prefix.trim() || "…"} 2, … in rising RF — numbers already used in the EW Group
              are skipped.
            </span>
          </label>
          <fieldset className="modes-from-ranges">
            <legend>Range of each Mode</legend>
            <label className="inline-label">
              <input type="radio" checked={ranges === "measured"} onChange={() => setRanges("measured")} />
              The entry&apos;s measured min–max (its mean where it has none)
            </label>
            <label className="inline-label">
              <input type="radio" checked={ranges === "mean"} onChange={() => setRanges("mean")} />
              The entry&apos;s mean only
            </label>
          </fieldset>
        </div>
        <div className="form-row">
          {deltaInput("RF delta ± (MHz)", rfDelta, setRfDelta)}
          {(types.has("fixed") || types.has("stagger")) && deltaInput("PW delta ± (µs)", pwDelta, setPwDelta)}
          {types.has("fixed") && deltaInput("PRI delta ± (µs)", priDelta, setPriDelta)}
          {types.has("stagger") && deltaInput("Frame time delta ± (µs)", frameDelta, setFrameDelta)}
        </div>
        {needsCwPw && (
          <div className="form-row">
            <label>
              CW Modes&apos; PW min (µs)
              <input className="edit-input" type="number" step="any" min="0" value={cwPwMin} onChange={(e) => setCwPwMin(e.target.value)} required />
            </label>
            <label>
              PW max (µs)
              <input className="edit-input" type="number" step="any" min="0" value={cwPwMax} onChange={(e) => setCwPwMax(e.target.value)} required />
            </label>
          </div>
        )}

        {chosen.length === 0 ? (
          <p className="hint-text">Every selected entry is left out — nothing to create.</p>
        ) : (
          <>
            <p>
              <strong>{chosen.length}</strong> Mode{chosen.length === 1 ? "" : "s"} will be created. What each will
              cover (with the deltas):
            </p>
            <table className="data-table compact-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>PRI type</th>
                  <th>RF (MHz)</th>
                  <th>PRI / frame time (µs)</th>
                  <th>PW (µs)</th>
                </tr>
              </thead>
              <tbody>
                {chosen.slice(0, PREVIEW_ROWS).map((e, i) => (
                  <tr key={e.id}>
                    <td className="hint-text">
                      {prefix.trim()} {i + 1}…
                    </td>
                    <td>
                      {TYPE_LABEL[e.pri_type] ?? e.pri_type}
                      {e.pri_type === "stagger" && e.stagger_values && (
                        <span className="hint-text"> · {e.stagger_values.length} positions</span>
                      )}
                    </td>
                    <td>{span(e, "rf")}</td>
                    <td>{span(e, "pri")}</td>
                    <td>{span(e, "pw")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {chosen.length > PREVIEW_ROWS && (
              <p className="hint-text">…and {chosen.length - PREVIEW_ROWS} more.</p>
            )}
          </>
        )}
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="icon-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={chosen.length === 0 || !group || !source || !prefix.trim() || !cwPwOk || create.isPending}
          >
            {create.isPending ? "Creating…" : `Create ${chosen.length} Mode${chosen.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
