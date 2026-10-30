import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { aiApi, type ModeEditChange, type ModeEditProposal, type SavedChat } from "../../api/ai";
import { ApiRequestError } from "../../api/client";
import { useHasRole } from "../../auth/RequireAuth";

function show(v: ModeEditChange["old"], unit: string): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (Array.isArray(v)) return `${v.join(", ")}${unit ? ` ${unit}` : ""}`;
  return `${v}${unit ? ` ${unit}` : ""}`;
}

/** The edits to existing Modes the chat proposed in one answer — a preview
 * of each value before → after, nothing written. The user ticks the ones to
 * apply and applies them; that's the only way they're written, into
 * Emitters the user is editing, refused if a Mode changed since. */
export function EditProposalPreview({
  chatId,
  messageIndex,
  edits,
  onSaved,
}: {
  chatId: string;
  messageIndex: number;
  edits: ModeEditProposal[];
  onSaved: (chat: SavedChat) => void;
}) {
  const qc = useQueryClient();
  const isEditor = useHasRole("editor");
  const applicable = edits.filter((e) => !e.problem && e.status === "proposed");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(applicable.map((e) => e.id)));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const chosen = applicable.filter((e) => picked.has(e.id));
  const emitters = [...new Set(chosen.map((e) => e.emitter_name))];

  async function apply() {
    setError(null);
    setSaving(true);
    try {
      const res = await aiApi.applyEditProposals(chatId, messageIndex, chosen.map((e) => e.id));
      onSaved(res.chat);
      // Every Modes list, and what's derived from them, may show the change now.
      void qc.invalidateQueries({ queryKey: ["modes"] });
      void qc.invalidateQueries({ queryKey: ["emitterVersions"] });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't apply them");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="chat-proposal">
      <div className="chat-proposal-head">
        <strong>
          Proposed edit{edits.length === 1 ? "" : "s"} to existing Modes ({edits.length})
        </strong>
        <span className="hint-text">A preview — nothing changes until you apply it.</span>
      </div>
      <div className="table-scroll">
        <table className="data-table compact">
          <thead>
            <tr>
              <th aria-label="Apply" />
              <th>Mode</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {edits.map((e) => (
              <tr key={e.id} className={e.problem ? "chat-proposal-bad" : undefined}>
                <td>
                  {e.status === "applied" ? (
                    <span title="Applied">✓</span>
                  ) : (
                    <input
                      type="checkbox"
                      aria-label={`Apply the edit to ${e.mode_name}`}
                      disabled={!!e.problem}
                      checked={picked.has(e.id) && !e.problem}
                      onChange={() => {
                        const next = new Set(picked);
                        if (next.has(e.id)) next.delete(e.id);
                        else next.add(e.id);
                        setPicked(next);
                      }}
                    />
                  )}
                </td>
                <td className="chat-edit-mode">
                  {e.emitter_id && e.mode_id ? (
                    <Link to={`/emitters/${e.emitter_id}?tab=modes&mode=${encodeURIComponent(e.mode_name)}`}>{e.mode_name}</Link>
                  ) : (
                    e.mode_name
                  )}
                  <div className="hint-text">
                    {e.emitter_name}
                    {e.ew_group_name && ` › ${e.ew_group_name}`}
                    {e.pri_type && ` · ${e.pri_type.toUpperCase()}`}
                  </div>
                  {e.reason && <div className="hint-text">Why: {e.reason}</div>}
                </td>
                <td>
                  {e.changes.length === 0 && <span className="hint-text">—</span>}
                  {e.changes.map((c) => (
                    <div key={c.field} className="chat-edit-change">
                      {c.label}: <span className="chat-edit-old">{show(c.old, c.unit)}</span> →{" "}
                      <span className="chat-edit-new">{show(c.new, c.unit)}</span>
                    </div>
                  ))}
                  {!e.problem && e.dsl_before && e.dsl && e.dsl_before !== e.dsl && (
                    <div className="chat-edit-dsl" title="The Mode line before and after">
                      {e.dsl_before} → {e.dsl}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edits
        .filter((e) => e.problem)
        .map((e) => (
          <p key={e.id} className="chat-proposal-problem">
            ✕ {e.mode_name}: {e.problem}
          </p>
        ))}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {applicable.length > 0 &&
        (isEditor ? (
          <div className="chat-proposal-actions">
            <button type="button" className="button primary small" disabled={saving || chosen.length === 0} onClick={() => void apply()}>
              {saving ? "Applying…" : `Apply ${chosen.length} edit${chosen.length === 1 ? "" : "s"}`}
            </button>
            {chosen.length > 0 && <span className="hint-text">to {emitters.join(", ")} — you need to be editing it</span>}
          </div>
        ) : (
          <p className="hint-text">An editor can apply these.</p>
        ))}
    </div>
  );
}
