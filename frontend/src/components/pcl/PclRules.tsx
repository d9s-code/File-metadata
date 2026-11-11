import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "../../api/client";
import {
  pclRulesApi,
  type PclCheck,
  type PclCheckResult,
  type PclLevel,
  type PclPlatformRules,
  type PclRef,
  type PclRule,
  type UniquenessPlatform,
} from "../../api/pcl";
import { useHasRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";

const PARAM_LABEL: Record<string, string> = { rf: "RF", pri: "PRI", pw: "PW", scan: "Scan" };
const LEVELS: PclLevel[] = [3, 2, 1];

export function LevelBadge({ level }: { level: number }) {
  return <span className={`pcl-level pcl-level-${level}`}>{level ? `PCL ${level}` : "—"}</span>;
}

/** What a name in a rule is here: unique, shared, a Mode's uniqueness. */
function RefChip({ r }: { r: PclRef }) {
  const label = r.kind === "mode" ? `${r.name} · ${r.mode}` : r.name;
  let flag = "";
  let cls = "pcl-ref";
  if (!r.on_platform) {
    flag = r.elsewhere.length ? `not on this Platform (on ${r.elsewhere.join(", ")})` : r.in_mdf ? "not on this Platform" : "not in this MDF";
    cls += " pcl-ref-off";
  } else if (r.kind === "mode" && r.mode_unique_set !== null) {
    flag = r.mode_unique_set
      ? `unique set${r.mode_unique_params.length ? ` · unique ${r.mode_unique_params.map((p) => PARAM_LABEL[p] ?? p).join(", ")}` : ""}`
      : "a look-alike Mode on another Platform";
    cls += r.mode_unique_set ? " pcl-ref-unique" : " pcl-ref-shared";
  } else if (r.unique) {
    flag = "only on this Platform";
    cls += " pcl-ref-unique";
  } else {
    flag = `shared with ${r.shared_with.join(", ")}`;
    cls += " pcl-ref-shared";
  }
  return (
    <span className={cls} title={`${label}: ${flag}`}>
      {label} <span className="pcl-ref-flag">{flag}</span>
    </span>
  );
}

function CheckView({ check }: { check: PclCheck }) {
  return (
    <div className="pcl-check">
      {check.refs.length > 0 && (
        <div className="pcl-refs">
          {check.refs.map((r, i) => (
            <RefChip key={i} r={r} />
          ))}
        </div>
      )}
      {check.warnings.map((w) => (
        <div key={w} className="pcl-warn">
          ⚠ {w}
        </div>
      ))}
      <details className="pcl-ways">
        <summary>
          What it takes — {check.fewest_needed} thing{check.fewest_needed === 1 ? "" : "s"} heard at the least
        </summary>
        <ul>
          {check.ways.map((w, i) => (
            <li key={i}>
              {w.needs.join(" + ")}
              {w.without.length > 0 && <span className="hint-text"> · without {w.without.join(", ")}</span>}
            </li>
          ))}
          {check.more_ways > 0 && <li className="hint-text">and {check.more_ways} more way{check.more_ways === 1 ? "" : "s"}</li>}
        </ul>
      </details>
    </div>
  );
}

/** Names to put in a condition: the Platform's Emitters (and a unique one's Modes). */
function InsertMenu({ platform, onInsert }: { platform: UniquenessPlatform; onInsert: (text: string) => void }) {
  return (
    <select
      className="pcl-insert"
      aria-label="Insert a name"
      value=""
      onChange={(e) => {
        if (e.target.value) onInsert(e.target.value);
      }}
    >
      <option value="">Insert…</option>
      <optgroup label="Operators">
        {["AND", "OR", "NOT", "2 OF ( , )", "( )"].map((op) => (
          <option key={op} value={op === "2 OF ( , )" ? "2 OF (" : op === "( )" ? "(" : op}>
            {op}
          </option>
        ))}
      </optgroup>
      <optgroup label="Its Emitters">
        {platform.emitters.map((e) => (
          <option key={e.emitter_id} value={`"${e.emitter_name}"`}>
            {e.emitter_name} — {e.unique ? "only here" : `shared with ${e.shared_with.map((s) => s.platform_name).join(", ")}`}
          </option>
        ))}
      </optgroup>
      {platform.emitters
        .filter((e) => e.unique && e.modes.length > 0)
        .map((e) => (
          <optgroup key={e.emitter_id} label={`${e.emitter_name}'s Modes`}>
            {e.modes.map((m) => (
              <option key={m.mode_id} value={`"${e.emitter_name}"."${m.mode_name}"`}>
                {m.mode_name} — {m.unique_set ? "unique set" : "has a look-alike"}
              </option>
            ))}
          </optgroup>
        ))}
    </select>
  );
}

/** Writing a condition: checked as it's typed (where it doesn't read, and
 * how it fares in this MDF), with names to insert. */
function RuleEditor({
  mdfId,
  platform,
  initial,
  onSave,
  onCancel,
  saving,
}: {
  mdfId: string;
  platform: UniquenessPlatform;
  initial?: { level: PclLevel; text: string; note: string | null };
  onSave: (v: { level: PclLevel; text: string; note: string | null }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [level, setLevel] = useState<PclLevel>(initial?.level ?? 2);
  const [text, setText] = useState(initial?.text ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [result, setResult] = useState<PclCheckResult | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!text.trim()) {
      setResult(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      pclRulesApi
        .check(platform.platform_id, mdfId, text)
        .then((r) => alive && setResult(r))
        .catch(() => undefined);
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [text, mdfId, platform.platform_id]);

  function insert(piece: string) {
    const el = input.current;
    const at = el ? el.selectionStart : text.length;
    const before = text.slice(0, at);
    const after = text.slice(el ? el.selectionEnd : text.length);
    const pad = before && !/\s$/.test(before) && !/[(.]$/.test(before) ? " " : "";
    const next = `${before}${pad}${piece}${after && !/^\s/.test(after) ? " " : ""}${after}`;
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = (before + pad + piece).length + 1;
      el?.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="pcl-editor">
      <div className="pcl-editor-row">
        <select value={level} onChange={(e) => setLevel(Number(e.target.value) as PclLevel)} aria-label="Confidence level">
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              PCL {l}
            </option>
          ))}
        </select>
        <span className="hint-text">when</span>
        <InsertMenu platform={platform} onInsert={insert} />
      </div>
      <textarea
        ref={input}
        className="pcl-condition-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'"Sea Search" AND "Fire Control"   ·   "Fire Control"."Track"   ·   2 OF ("A", "B", "C")'}
        aria-label="Condition"
        rows={2}
        spellCheck={false}
      />
      {result && !result.ok && (
        <div className="error-text pcl-syntax" role="alert">
          <code>
            {text.slice(0, result.position)}
            <mark>{text.slice(result.position, result.position + 1) || " "}</mark>
            {text.slice(result.position + 1)}
          </code>
          <div>{result.message}</div>
        </div>
      )}
      {result && result.ok && result.check && <CheckView check={result.check} />}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — why this level" aria-label="Note" />
      <div className="pcl-editor-row">
        <button
          type="button"
          className="button primary small"
          disabled={saving || !text.trim() || (result !== null && !result.ok)}
          onClick={() => onSave({ level, text, note: note.trim() || null })}
        >
          {saving ? "Saving…" : "Save rule"}
        </button>
        <button type="button" className="button secondary small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** A Platform's confidence rules in this MDF: each with its check, plus
 * suggestions and a way to add one. */
export function PclRulesSection({
  mdfId,
  platform,
  rules,
}: {
  mdfId: string;
  platform: UniquenessPlatform;
  rules: PclPlatformRules | undefined;
}) {
  const canWrite = useHasRole("editor");
  const qc = useQueryClient();
  const { confirmDelete, dialog } = useConfirmDialog();
  const [adding, setAdding] = useState<{ level: PclLevel; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["pcl"] });
  const fail = (err: unknown) => setError(err instanceof ApiRequestError ? err.message : "Couldn't save it");
  const create = useMutation({
    mutationFn: (v: { level: PclLevel; text: string; note: string | null }) => pclRulesApi.create(platform.platform_id, v),
    onSuccess: () => {
      setAdding(null);
      setError(null);
      refresh();
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: ({ id, v }: { id: string; v: { level: PclLevel; text: string; note: string | null } }) => pclRulesApi.update(id, v),
    onSuccess: () => {
      setEditing(null);
      setError(null);
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({ mutationFn: (id: string) => pclRulesApi.remove(id), onSuccess: refresh });

  const list = rules?.rules ?? [];
  const suggestions = rules?.suggestions ?? [];

  return (
    <section className="pcl-rules">
      <h3 className="as-h5">Confidence rules</h3>
      {list.length === 0 && !adding && <p className="hint-text">None yet. A rule gives a level when its condition is heard; the highest met counts.</p>}
      {list.map((r: PclRule) =>
        editing === r.id ? (
          <RuleEditor
            key={r.id}
            mdfId={mdfId}
            platform={platform}
            initial={r}
            saving={update.isPending}
            onSave={(v) => update.mutate({ id: r.id, v })}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div key={r.id} className="pcl-rule">
            <div className="pcl-rule-head">
              <LevelBadge level={r.level} />
              <code className="pcl-condition">{r.text}</code>
              {canWrite && (
                <span className="pcl-rule-actions">
                  <button type="button" className="link-button" onClick={() => setEditing(r.id)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="link-button link-button-danger"
                    onClick={async () => {
                      if (await confirmDelete(`Remove this PCL ${r.level} rule?`)) remove.mutate(r.id);
                    }}
                  >
                    Remove
                  </button>
                </span>
              )}
            </div>
            {r.note && <div className="hint-text">{r.note}</div>}
            {r.check && <CheckView check={r.check} />}
          </div>
        ),
      )}
      {adding ? (
        <RuleEditor
          mdfId={mdfId}
          platform={platform}
          initial={{ ...adding, note: null }}
          saving={create.isPending}
          onSave={(v) => create.mutate(v)}
          onCancel={() => setAdding(null)}
        />
      ) : (
        canWrite && (
          <button type="button" className="button secondary small" onClick={() => setAdding({ level: 2, text: "" })}>
            + Add rule
          </button>
        )
      )}
      {error && <p className="error-text">{error}</p>}
      {suggestions.length > 0 && (
        <details className="pcl-suggestions">
          <summary>
            {suggestions.length} suggested rule{suggestions.length === 1 ? "" : "s"}, from what&apos;s unique here
          </summary>
          <ul>
            {suggestions.map((s) => (
              <li key={s.text}>
                <LevelBadge level={s.level} /> <code className="pcl-condition">{s.text}</code>{" "}
                <span className="hint-text">— {s.why}</span>{" "}
                {canWrite && (
                  <button type="button" className="link-button" onClick={() => setAdding({ level: s.level, text: s.text })}>
                    Use…
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {dialog}
    </section>
  );
}
