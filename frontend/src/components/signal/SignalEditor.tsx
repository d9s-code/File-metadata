/** A Mode's signal behaviour, in its form: how its RF, PRI and PW behave,
 * the modulation inside a pulse, polarisation — folded to a line that says
 * what's set, open with the pictures. For analysis only: never exported. */
import { useState } from "react";
import type { PriType } from "../../types/domain";
import { SignalCharts } from "./SignalCharts";
import {
  CODES,
  MOD_KINDS,
  POLARISATIONS,
  PRI_KINDS,
  PW_KINDS,
  RF_KINDS,
  parseList,
  signalPayload,
  signalProblem,
  signalShort,
  type Ranges,
  type SignalDraft,
} from "./signal";

export function SignalEditor({
  draft,
  onChange,
  priType,
  ranges,
  forceOpen,
}: {
  draft: SignalDraft;
  onChange: (d: SignalDraft) => void;
  priType: PriType;
  /** Its ranges as typed (null: not valid yet — no pictures). */
  ranges: Ranges | null;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const fixedPri = priType === "fixed";
  const problem = signalProblem(draft, fixedPri);
  const isOpen = open || !!forceOpen || !!problem;
  const set = (part: Partial<SignalDraft>) => onChange({ ...draft, ...part });
  const summary = signalShort(signalPayload(draft, fixedPri)) ?? "plain — fixed RF, steady PRI, fixed PW, unmodulated";
  const channels = parseList(draft.channels) ?? [];
  const outside = ranges ? channels.filter((c) => c < ranges.rf[0] || c > ranges.rf[1]) : [];

  return (
    <div className={isOpen ? "mode-more open" : "mode-more"}>
      <button type="button" className="mode-more-toggle" aria-expanded={isOpen} onClick={() => setOpen((o) => !o)}>
        <span>{isOpen ? "▾" : "▸"} Signal behaviour</span>
        {!isOpen && <span className="hint-text">{summary}</span>}
      </button>
      {isOpen && (
        <div className="mode-more-body signal-editor">
          <p className="hint-text">
            How it behaves inside its ranges — for analysis and the dwell planner. Not exported: the export writes its ranges as they are.
          </p>
          <div className="signal-grid">
            <fieldset className="mode-scan-box">
              <legend>RF</legend>
              <select value={draft.rfKind} aria-label="RF behaviour" onChange={(e) => set({ rfKind: e.target.value as SignalDraft["rfKind"] })}>
                {RF_KINDS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              {(draft.rfKind === "hopping" || draft.rfKind === "diverse") && (
                <label>
                  Channels (MHz)
                  <input value={draft.channels} placeholder="9400, 9420, 9440" onChange={(e) => set({ channels: e.target.value })} />
                  {outside.length > 0 && <span className="mode-form-warning">{outside.join(", ")} MHz outside its RF range</span>}
                </label>
              )}
              {draft.rfKind === "hopping" && (
                <div className="signal-row">
                  <label>
                    A hop lasts
                    <input type="number" min="0" step="any" value={draft.hopAmount} aria-label="Hop length" onChange={(e) => set({ hopAmount: e.target.value })} />
                  </label>
                  <select value={draft.hopUnit} aria-label="Hop unit" onChange={(e) => set({ hopUnit: e.target.value as "pulses" | "ms" })}>
                    <option value="pulses">pulses</option>
                    <option value="ms">ms</option>
                  </select>
                  <select value={draft.hopOrder} aria-label="Hop order" onChange={(e) => set({ hopOrder: e.target.value as "sequence" | "random" })}>
                    <option value="sequence">in order</option>
                    <option value="random">at random</option>
                  </select>
                </div>
              )}
              {draft.rfKind === "swept" && (
                <div className="signal-row">
                  <label>
                    Sweep time (ms)
                    <input type="number" min="0" step="any" value={draft.sweepMs} onChange={(e) => set({ sweepMs: e.target.value })} />
                  </label>
                  <select value={draft.sweepShape} aria-label="Sweep shape" onChange={(e) => set({ sweepShape: e.target.value as "sawtooth" | "triangle" })}>
                    <option value="sawtooth">sawtooth</option>
                    <option value="triangle">triangle</option>
                  </select>
                </div>
              )}
            </fieldset>
            <fieldset className="mode-scan-box">
              <legend>PRI</legend>
              {fixedPri ? (
                <>
                  <select value={draft.priKind} aria-label="PRI behaviour" onChange={(e) => set({ priKind: e.target.value as SignalDraft["priKind"] })}>
                    {PRI_KINDS.map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {(draft.priKind === "sliding" || draft.priKind === "wobulated") && (
                    <div className="signal-row">
                      <label>
                        Period (ms)
                        <input type="number" min="0" step="any" value={draft.priPeriodMs} aria-label="PRI period (ms)" onChange={(e) => set({ priPeriodMs: e.target.value })} />
                      </label>
                      {draft.priKind === "sliding" && (
                        <select value={draft.priShape} aria-label="Slide shape" onChange={(e) => set({ priShape: e.target.value as SignalDraft["priShape"] })}>
                          <option value="up">up</option>
                          <option value="down">down</option>
                          <option value="triangle">up and down</option>
                        </select>
                      )}
                    </div>
                  )}
                  {draft.priKind === "dwell_switch" && (
                    <div className="signal-row">
                      <label>
                        PRIs (µs)
                        <input value={draft.priValues} placeholder="800, 1000, 1200" aria-label="Dwell & switch PRIs" onChange={(e) => set({ priValues: e.target.value })} />
                      </label>
                      <label>
                        Pulses each
                        <input type="number" min="1" step="1" value={draft.priDwell} aria-label="Pulses each" onChange={(e) => set({ priDwell: e.target.value })} />
                      </label>
                    </div>
                  )}
                  <span className="hint-text">Moves inside its PRI range (min–max).</span>
                </>
              ) : (
                <span className="hint-text">{priType === "stagger" ? "A stagger's steps, as typed above." : "For a Fixed PRI."}</span>
              )}
            </fieldset>
            <fieldset className="mode-scan-box">
              <legend>PW</legend>
              <select value={draft.pwKind} aria-label="PW behaviour" onChange={(e) => set({ pwKind: e.target.value as SignalDraft["pwKind"] })}>
                {PW_KINDS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              {draft.pwKind !== "fixed" && (
                <label>
                  PWs (µs)
                  <input value={draft.pwValues} placeholder="0.5, 1, 2" aria-label="PWs" onChange={(e) => set({ pwValues: e.target.value })} />
                </label>
              )}
            </fieldset>
            <fieldset className="mode-scan-box">
              <legend>Inside a pulse</legend>
              <select value={draft.modKind} aria-label="Intra-pulse modulation" onChange={(e) => set({ modKind: e.target.value as SignalDraft["modKind"] })}>
                {MOD_KINDS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              {(draft.modKind === "lfm" || draft.modKind === "nlfm") && (
                <div className="signal-row">
                  <label>
                    Bandwidth (MHz)
                    <input type="number" min="0" step="any" value={draft.bandwidth} aria-label="Chirp bandwidth (MHz)" onChange={(e) => set({ bandwidth: e.target.value })} />
                  </label>
                  <select value={draft.direction} aria-label="Chirp direction" onChange={(e) => set({ direction: e.target.value as SignalDraft["direction"] })}>
                    <option value="up">up</option>
                    <option value="down">down</option>
                    <option value="triangle">up and down</option>
                  </select>
                </div>
              )}
              {draft.modKind === "phase" && (
                <div className="signal-row">
                  <select value={draft.code} aria-label="Phase code" onChange={(e) => set({ code: e.target.value as SignalDraft["code"] })}>
                    {CODES.map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <label>
                    Chips
                    <input type="number" min="2" step="1" value={draft.codeLength} aria-label="Code length (chips)" onChange={(e) => set({ codeLength: e.target.value })} />
                  </label>
                  <label>
                    Chip (µs)
                    <input type="number" min="0" step="any" value={draft.chipUs} aria-label="Chip length (µs)" onChange={(e) => set({ chipUs: e.target.value })} />
                  </label>
                </div>
              )}
              {draft.modKind === "fsk" && (
                <label>
                  Frequencies
                  <input type="number" min="2" step="1" value={draft.fskFrequencies} aria-label="FSK frequencies" onChange={(e) => set({ fskFrequencies: e.target.value })} />
                </label>
              )}
              <label>
                Polarisation
                <select value={draft.polarisation} onChange={(e) => set({ polarisation: e.target.value as SignalDraft["polarisation"] })}>
                  <option value="">— Not known —</option>
                  {POLARISATIONS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          </div>
          {problem && (
            <p className="line-row-problem" role="alert">
              {problem}
            </p>
          )}
          {ranges && !problem && <SignalCharts signal={signalPayload(draft, fixedPri)} ranges={ranges} />}
        </div>
      )}
    </div>
  );
}
