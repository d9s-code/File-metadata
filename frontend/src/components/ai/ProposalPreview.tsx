import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { aiApi, type ModeProposal, type SavedChat } from "../../api/ai";
import { ApiRequestError } from "../../api/client";
import { useHasRole } from "../../auth/RequireAuth";

type LineValue = number | number[] | boolean | null | undefined;

function span(min: LineValue, max: LineValue): string {
  if (typeof min !== "number") return "—";
  return typeof max !== "number" || max === min ? String(min) : `${min}–${max}`;
}

function margin(v: LineValue): string {
  return typeof v === "number" && v > 0 ? ` ±${v}` : "";
}

/** A proposal's PRI in words: a Fixed range with its jitter, a stagger's steps, or CW. */
function pri(p: ModeProposal): string {
  const l = p.line;
  if (p.pri_type === "fixed") return `${span(l.pri_min_us, l.pri_max_us)}${margin(l.pri_delta)} µs · jitter ${span(l.jitter_min_us, l.jitter_max_us)}`;
  if (p.pri_type === "stagger") {
    const steps = Array.isArray(l.pri_stagger_values_us) ? l.pri_stagger_values_us.join(", ") : "—";
    const frame = typeof l.explicit_frame_time_us === "number" ? ` · frame ${l.explicit_frame_time_us} µs` : "";
    return `stagger ${steps} µs${margin(l.frame_time_delta_us)}${frame}`;
  }
  return p.pri_type === "xlet" ? "X-let" : "CW";
}

/** The rest of what it sets, in one line: range matching, confirmation, notes, tests. */
function extras(p: ModeProposal): string {
  const l = p.line;
  const matching = (
    [
      ["RF", l.rf_range_matching],
      ["PRI", l.pri_range_matching],
      ["PW", l.pw_range_matching],
    ] as const
  )
    .filter(([, on]) => on === true)
    .map(([k]) => k);
  const bits = [`range matching ${matching.length ? matching.join(", ") : "none"}`];
  if (p.confirmation_quality != null) bits.push(`confirmation ${p.confirmation_quality} % × ${p.confirmation_quantity}`);
  if (p.derived_test_titles?.length) bits.push(`test-derived: ${p.derived_test_titles.join(", ")}`);
  if (p.notes) bits.push(`notes: ${p.notes}`);
  return bits.join(" · ");
}

/** The Modes the chat proposed in one answer — a preview, nothing written.
 * The user ticks the ones to add and adds them; that's the only way they're
 * written, into Emitters the user is editing. */
export function ProposalPreview({
  chatId,
  messageIndex,
  proposals,
  onSaved,
}: {
  chatId: string;
  messageIndex: number;
  proposals: ModeProposal[];
  onSaved: (chat: SavedChat) => void;
}) {
  const qc = useQueryClient();
  const isEditor = useHasRole("editor");
  const addable = proposals.filter((p) => !p.problem && p.status === "proposed");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(addable.map((p) => p.id)));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const chosen = addable.filter((p) => picked.has(p.id));
  const emitters = [...new Set(chosen.map((p) => p.emitter_name))];

  async function add() {
    setError(null);
    setSaving(true);
    try {
      const res = await aiApi.applyProposals(chatId, messageIndex, chosen.map((p) => p.id));
      onSaved(res.chat);
      // Every Modes list (an EW Group's, an Emitter's) may show them now.
      void qc.invalidateQueries({ queryKey: ["modes"] });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't add them");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="chat-proposal">
      <div className="chat-proposal-head">
        <strong>
          Proposed Mode{proposals.length === 1 ? "" : "s"} ({proposals.length})
        </strong>
        <span className="hint-text">A preview — nothing is added until you add it.</span>
      </div>
      <div className="table-scroll">
        <table className="data-table compact">
          <thead>
            <tr>
              <th aria-label="Add" />
              <th>Mode</th>
              <th>Where</th>
              <th>RF (MHz)</th>
              <th>PRI</th>
              <th>PW (µs)</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((p) => {
              const l = p.line;
              return (
                <tr key={p.id} className={p.problem ? "chat-proposal-bad" : undefined}>
                  <td>
                    {p.status === "added" ? (
                      <span title="Added">✓</span>
                    ) : (
                      <input
                        type="checkbox"
                        aria-label={`Add ${p.name}`}
                        disabled={!!p.problem}
                        checked={picked.has(p.id) && !p.problem}
                        onChange={() => {
                          const next = new Set(picked);
                          if (next.has(p.id)) next.delete(p.id);
                          else next.add(p.id);
                          setPicked(next);
                        }}
                      />
                    )}
                  </td>
                  <td>
                    {p.status === "added" && p.emitter_id ? (
                      <Link to={`/emitters/${p.emitter_id}?tab=modes&mode=${encodeURIComponent(p.name)}`}>{p.name}</Link>
                    ) : (
                      p.name
                    )}
                    <div className="hint-text">{p.pri_type === "xlet" ? "X-LET" : p.pri_type.toUpperCase()}</div>
                    <div className="hint-text">{extras(p)}</div>
                  </td>
                  <td>
                    {p.emitter_name} › {p.ew_group_name}
                    {(p.source_names?.length ? p.source_names : p.source_name ? [p.source_name] : []).length > 0 && (
                      <div className="hint-text">
                        {(p.source_names?.length ?? 0) > 1 ? "Sources" : "Source"}{" "}
                        {(p.source_names?.length ? p.source_names : [p.source_name]).join(", ")}
                      </div>
                    )}
                  </td>
                  <td>
                    {span(l.rf_min_mhz, l.rf_max_mhz)}
                    {margin(l.rf_delta)}
                  </td>
                  <td>{pri(p)}</td>
                  <td>
                    {span(l.pw_min_us, l.pw_max_us)}
                    {margin(l.pw_delta)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {proposals
        .filter((p) => p.problem)
        .map((p) => (
          <p key={p.id} className="chat-proposal-problem">
            ✕ {p.name}: {p.problem}
          </p>
        ))}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {addable.length > 0 &&
        (isEditor ? (
          <div className="chat-proposal-actions">
            <button type="button" className="button primary small" disabled={saving || chosen.length === 0} onClick={() => void add()}>
              {saving ? "Adding…" : `Add ${chosen.length} Mode${chosen.length === 1 ? "" : "s"}`}
            </button>
            {chosen.length > 0 && <span className="hint-text">to {emitters.join(", ")} — you need to be editing it</span>}
          </div>
        ) : (
          <p className="hint-text">An editor can add these.</p>
        ))}
    </div>
  );
}
