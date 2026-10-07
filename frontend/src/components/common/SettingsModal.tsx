import { useState } from "react";
import { ApiRequestError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { useAiStatus } from "../../state/hooks/useAmbiguity";
import type { UserPreferences } from "../../types/domain";
import { Modal } from "./Modal";

const AI_SETTINGS: { key: keyof UserPreferences; label: string; hint: string; needs?: keyof UserPreferences }[] = [
  {
    key: "ai_chat",
    label: "AI chat",
    hint: "The ✦ Ask AI button in the bottom-right corner of every page.",
  },
  {
    key: "ai_chat_page",
    label: "Tell the chat which page I'm on",
    hint: "So “this Emitter” means the one you're looking at. Off: it only knows what you type.",
    needs: "ai_chat",
  },
  {
    key: "ai_drafts",
    label: "AI drafts on the ambiguity page",
    hint: "Explain with AI on a finding, and the AI overview of a check.",
  },
];

/** Your own settings — which optional features you see. Saved with your
 * account, so they apply in any browser you sign in from. */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { user, updatePreferences } = useAuth();
  const aiAvailable = useAiStatus().data?.enabled ?? false;
  const [saving, setSaving] = useState<keyof UserPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const prefs = user.preferences;

  async function toggle(key: keyof UserPreferences) {
    setError(null);
    setSaving(key);
    try {
      await updatePreferences({ [key]: !prefs[key] });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save the setting");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      <p className="hint-text">Saved with your account — they apply wherever you sign in.</p>
      <fieldset className="settings-group">
        <legend>AI</legend>
        {!aiAvailable && <p className="hint-text">No language model is set up on this server, so these have no effect yet.</p>}
        {AI_SETTINGS.map((s) => {
          const off = s.needs ? !prefs[s.needs] : false;
          return (
            <label key={s.key} className={off ? "settings-row disabled" : "settings-row"}>
              <input
                type="checkbox"
                role="switch"
                checked={prefs[s.key]}
                disabled={saving !== null || off}
                onChange={() => void toggle(s.key)}
              />
              <span>
                <strong>{s.label}</strong>
                <span className="hint-text">{s.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {error && <p className="error-text">{error}</p>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
