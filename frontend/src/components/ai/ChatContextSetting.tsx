import { useState, type FormEvent } from "react";
import { ApiRequestError } from "../../api/client";
import { useUpdateAppSettings } from "../../state/hooks/useDwells";

/** How much the AI chat may give the model at once — its context window. */
export function ChatContextSetting({ current, compact = false }: { current: number; compact?: boolean }) {
  const update = useUpdateAppSettings();
  const [value, setValue] = useState(String(current));
  const [error, setError] = useState<string | null>(null);
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 4096 && parsed <= 2_000_000;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await update.mutateAsync({ ai_chat_max_context_tokens: parsed });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save it");
    }
  }

  const form = (
    <form className="form-row" onSubmit={save}>
      <label>
        Max context (tokens)
        <input type="number" min={4096} max={2000000} step={1024} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <button type="submit" disabled={!valid || parsed === current || update.isPending}>
        {update.isPending ? "Saving…" : "Save"}
      </button>
      {error && <span className="error-text">{error}</span>}
    </form>
  );
  if (compact) return form;
  return (
    <section className="card">
      <h3>AI chat context</h3>
      <p className="hint-text">
        The most the chat gives the model at once — set it to the model&apos;s context window (vLLM&apos;s
        max_model_len) or less. Older turns are left out to stay inside it, and a chat about to fill it is compacted
        on its own: its earlier turns summarised.
      </p>
      {form}
    </section>
  );
}
