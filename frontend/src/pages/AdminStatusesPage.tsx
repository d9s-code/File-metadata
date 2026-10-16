import { useState, type FormEvent } from "react";
import { AdminNav } from "../components/common/AdminNav";
import { InfoTip } from "../components/common/PageHeader";
import { MenuButton } from "../components/common/MenuButton";
import { Modal } from "../components/common/Modal";
import { LoadingState } from "../components/common/LoadingState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { StatusBadge } from "../components/status/StatusBadge";
import { ApiRequestError } from "../api/client";
import {
  STATUS_COLORS,
  type MilestoneDefinition,
  type StatusColor,
  type StatusDefinition,
  type StatusEntityType,
} from "../api/statuses";
import {
  useAllStatuses,
  useDefaultMilestones,
  useMilestoneAdmin,
  useStatusAdmin,
  useStatuses,
} from "../state/hooks/useStatuses";

const TYPES: [StatusEntityType, string][] = [
  ["emitter", "Emitters"],
  ["platform", "Platforms"],
  ["mdf", "MDFs"],
];
const NOUN: Record<StatusEntityType, string> = { emitter: "Emitter", platform: "Platform", mdf: "MDF" };

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiRequestError ? err.message : fallback;
}

/** Admin → Statuses & milestones: per kind of item, its statuses (name,
 * colour, order, which moves are allowed, which ask for a note) and the
 * default milestones every item of that kind has before each status. */
export function AdminStatusesPage() {
  const [type, setType] = useState<StatusEntityType>("emitter");
  const { isLoading } = useAllStatuses();
  return (
    <div className="page">
      <h1>Admin</h1>
      <AdminNav />
      <div className="admin-statuses-head">
        <div className="theme-toggle" role="group" aria-label="Kind of item">
          {TYPES.map(([t, label]) => (
            <button key={t} type="button" className={t === type ? "active" : undefined} onClick={() => setType(t)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <LoadingState label="Loading statuses…" />
      ) : (
        <>
          <StatusesSection type={type} />
          <MilestonesSection type={type} />
        </>
      )}
    </div>
  );
}

// --- Statuses ----------------------------------------------------------------

function StatusesSection({ type }: { type: StatusEntityType }) {
  const { list } = useStatuses(type);
  const admin = useStatusAdmin();
  const [editing, setEditing] = useState<StatusDefinition | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirmDelete, dialog } = useConfirmDialog();

  async function move(index: number, by: -1 | 1) {
    const ids = list.map((s) => s.id);
    const j = index + by;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setError(null);
    try {
      await admin.reorder.mutateAsync([type, ids]);
    } catch (err) {
      setError(errorText(err, "Couldn't reorder"));
    }
  }

  async function remove(s: StatusDefinition) {
    if (!(await confirmDelete(`Delete the status "${s.label}"? Its default milestones go with it.`))) return;
    setError(null);
    try {
      await admin.remove.mutateAsync(s.id);
    } catch (err) {
      setError(errorText(err, "Couldn't delete it"));
    }
  }

  const byKey = Object.fromEntries(list.map((s) => [s.key, s]));
  return (
    <section className="card admin-statuses">
      <div className="section-head">
        <h3>
          {NOUN[type]} statuses{" "}
          <InfoTip label="About statuses">
            In order, as lists and the dashboard show them. "Can move to" is which buttons an item in that status
            gets. Built-in statuses can be renamed and recoloured but not deleted — the app relies on them (new items
            start in the first built-in one; Operational is what MDF readiness checks look for).
          </InfoTip>
        </h3>
        <button type="button" className="button secondary small" onClick={() => setAdding(true)}>
          + Add status
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th aria-label="Order" />
            <th>Status</th>
            <th>Can move to</th>
            <th>Note asked</th>
            <th className="num">In use</th>
            <th className="row-actions" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {list.map((s, i) => (
            <tr key={s.id}>
              <td className="nowrap">
                <button type="button" className="link-button" disabled={i === 0} onClick={() => void move(i, -1)} aria-label={`Move ${s.label} up`}>
                  ↑
                </button>
                <button
                  type="button"
                  className="link-button"
                  disabled={i === list.length - 1}
                  onClick={() => void move(i, 1)}
                  aria-label={`Move ${s.label} down`}
                >
                  ↓
                </button>
              </td>
              <td>
                <StatusBadge type={type} status={s.key} />
                {s.builtin && <span className="hint-text"> built in</span>}
              </td>
              <td>
                {s.transitions.length === 0 ? (
                  <span className="hint-text">— (a dead end)</span>
                ) : (
                  s.transitions.map((k) => byKey[k] && <StatusBadge key={k} type={type} status={k} />)
                )}
              </td>
              <td title={s.note_prompt ?? undefined}>{s.requires_note ? (s.note_prompt ?? "Yes") : "—"}</td>
              <td className="num">{s.in_use}</td>
              <td className="row-actions">
                <MenuButton
                  label="⋯"
                  className="link-button row-menu-button"
                  ariaLabel={`Actions for ${s.label}`}
                  items={[
                    { label: "Edit…", onSelect: () => setEditing(s) },
                    {
                      label: "Delete",
                      danger: true,
                      disabled: s.builtin || s.in_use > 0,
                      title: s.builtin ? "Built in — rename it instead" : s.in_use > 0 ? "Move its items first" : undefined,
                      onSelect: () => void remove(s),
                    },
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="error-text">{error}</p>}
      {editing && <EditStatus status={editing} all={list} onClose={() => setEditing(null)} />}
      {adding && <AddStatus type={type} onClose={() => setAdding(false)} />}
      {dialog}
    </section>
  );
}

function ColorPicker({ value, onChange }: { value: StatusColor; onChange: (c: StatusColor) => void }) {
  return (
    <div className="color-picker" role="radiogroup" aria-label="Colour">
      {STATUS_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          className={`status-badge status-color-${c}${c === value ? " picked" : ""}`}
          onClick={() => onChange(c)}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

function AddStatus({ type, onClose }: { type: StatusEntityType; onClose: () => void }) {
  const admin = useStatusAdmin();
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<StatusColor>("blue");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await admin.create.mutateAsync([type, label.trim(), color]);
      onClose();
    } catch (err) {
      setError(errorText(err, "Couldn't add it"));
    }
  }

  return (
    <Modal title={`New ${NOUN[type]} status`} onClose={onClose}>
      <form onSubmit={submit} className="status-form">
        <label>
          Name
          <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus maxLength={60} />
        </label>
        <ColorPicker value={color} onChange={setColor} />
        <p className="hint-text">Then use Edit… to choose which statuses it can move to, and which lead to it.</p>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!label.trim() || admin.create.isPending}>
            Add
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditStatus({
  status,
  all,
  onClose,
}: {
  status: StatusDefinition;
  all: StatusDefinition[];
  onClose: () => void;
}) {
  const admin = useStatusAdmin();
  const [label, setLabel] = useState(status.label);
  const [color, setColor] = useState<StatusColor>(status.color);
  const [moves, setMoves] = useState<Set<string>>(new Set(status.transitions));
  // Which statuses can move here — edited on those statuses, saved alongside.
  const [from, setFrom] = useState<Set<string>>(
    new Set(all.filter((s) => s.transitions.includes(status.key)).map((s) => s.key)),
  );
  const [requiresNote, setRequiresNote] = useState(status.requires_note);
  const [prompt, setPrompt] = useState(status.note_prompt ?? "");
  const [error, setError] = useState<string | null>(null);
  const others = all.filter((s) => s.id !== status.id);

  function toggle(set: Set<string>, key: string, apply: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await admin.update.mutateAsync([
        status.id,
        {
          label: label.trim(),
          color,
          transitions: others.filter((s) => moves.has(s.key)).map((s) => s.key),
          requires_note: requiresNote,
          note_prompt: prompt,
        },
      ]);
      for (const s of others) {
        const has = s.transitions.includes(status.key);
        if (has !== from.has(s.key)) {
          const transitions = has ? s.transitions.filter((k) => k !== status.key) : [...s.transitions, status.key];
          await admin.update.mutateAsync([s.id, { transitions }]);
        }
      }
      onClose();
    } catch (err) {
      setError(errorText(err, "Couldn't save it"));
    }
  }

  return (
    <Modal title={`Edit status — ${status.label}`} onClose={onClose} wide>
      <form onSubmit={submit} className="status-form">
        <label>
          Name
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </label>
        <ColorPicker value={color} onChange={setColor} />
        <div className="status-moves">
          <fieldset>
            <legend>Can move to</legend>
            {others.map((s) => (
              <label key={s.key} className="checkbox-label">
                <input type="checkbox" checked={moves.has(s.key)} onChange={() => toggle(moves, s.key, setMoves)} />
                {s.label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Can be reached from</legend>
            {others.map((s) => (
              <label key={s.key} className="checkbox-label">
                <input type="checkbox" checked={from.has(s.key)} onChange={() => toggle(from, s.key, setFrom)} />
                {s.label}
              </label>
            ))}
          </fieldset>
        </div>
        <label className="checkbox-label">
          <input type="checkbox" checked={requiresNote} onChange={(e) => setRequiresNote(e.target.checked)} />
          Ask for a note when moving here
        </label>
        {requiresNote && (
          <label>
            The question it asks
            <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. What was validated?" />
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!label.trim() || admin.update.isPending}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

// --- Default milestones ----------------------------------------------------

function MilestonesSection({ type }: { type: StatusEntityType }) {
  const { list: statuses } = useStatuses(type);
  const { data: milestones } = useDefaultMilestones(type);
  const admin = useMilestoneAdmin();
  const [statusKey, setStatusKey] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState<MilestoneDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirmDelete, dialog } = useConfirmDialog();
  const chosenStatus = statusKey || statuses[1]?.key || statuses[0]?.key || "";

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await admin.create.mutateAsync([type, chosenStatus, title.trim(), description.trim() || undefined]);
      setTitle("");
      setDescription("");
    } catch (err) {
      setError(errorText(err, "Couldn't add it"));
    }
  }

  async function move(group: MilestoneDefinition[], index: number, by: -1 | 1) {
    const ids = group.map((m) => m.id);
    const j = index + by;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await admin.reorder.mutateAsync(ids);
  }

  async function remove(m: MilestoneDefinition) {
    if (!(await confirmDelete(`Delete the milestone "${m.title}" from every ${NOUN[type]}? Who ticked it off goes too.`)))
      return;
    await admin.remove.mutateAsync(m.id);
  }

  const groups = statuses
    .map((s) => ({ s, items: (milestones ?? []).filter((m) => m.status_key === s.key) }))
    .filter((g) => g.items.length > 0);

  return (
    <section className="card admin-milestones">
      <div className="section-head">
        <h3>
          Default milestones{" "}
          <InfoTip label="About milestones">
            What every {NOUN[type]} should have done before it reaches a status — ticked off by hand on its page
            (◎ Milestones). Moving to a status with milestones not met asks to confirm first. An {NOUN[type]} can also
            have milestones of its own, added on its page.
          </InfoTip>
        </h3>
      </div>
      {groups.length === 0 && <p className="hint-text">None yet — add one below.</p>}
      {groups.map(({ s, items }) => (
        <div key={s.key} className="milestone-group">
          <h5>
            Before <StatusBadge type={type} status={s.key} />
          </h5>
          <ul className="milestone-list">
            {items.map((m, i) => (
              <li key={m.id} className="milestone">
                <span className="milestone-order">
                  <button type="button" className="link-button" disabled={i === 0} onClick={() => void move(items, i, -1)} aria-label="Up">
                    ↑
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    disabled={i === items.length - 1}
                    onClick={() => void move(items, i, 1)}
                    aria-label="Down"
                  >
                    ↓
                  </button>
                </span>
                <span className="milestone-title">{m.title}</span>
                {m.description && <span className="hint-text milestone-desc">{m.description}</span>}
                <MenuButton
                  label="⋯"
                  className="link-button row-menu-button"
                  ariaLabel={`Actions for ${m.title}`}
                  items={[
                    { label: "Edit…", onSelect: () => setEditing(m) },
                    { label: "Delete", danger: true, onSelect: () => void remove(m) },
                  ]}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <form className="milestone-add" onSubmit={add}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Manual dwell test passed"
          aria-label="Milestone"
        />
        <label className="inline-label">
          before
          <select value={chosenStatus} onChange={(e) => setStatusKey(e.target.value)}>
            {statuses.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Details (optional)"
          aria-label="Details"
        />
        <button type="submit" className="button secondary small" disabled={!title.trim() || admin.create.isPending}>
          + Add milestone
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
      {editing && <EditMilestone milestone={editing} type={type} onClose={() => setEditing(null)} />}
      {dialog}
    </section>
  );
}

function EditMilestone({
  milestone,
  type,
  onClose,
}: {
  milestone: MilestoneDefinition;
  type: StatusEntityType;
  onClose: () => void;
}) {
  const { list: statuses } = useStatuses(type);
  const admin = useMilestoneAdmin();
  const [title, setTitle] = useState(milestone.title);
  const [description, setDescription] = useState(milestone.description ?? "");
  const [statusKey, setStatusKey] = useState(milestone.status_key);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await admin.update.mutateAsync([milestone.id, { title: title.trim(), description, status_key: statusKey }]);
      onClose();
    } catch (err) {
      setError(errorText(err, "Couldn't save it"));
    }
  }

  return (
    <Modal title="Edit milestone" onClose={onClose}>
      <form onSubmit={submit} className="status-form">
        <label>
          Milestone
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </label>
        <label>
          Before
          <select value={statusKey} onChange={(e) => setStatusKey(e.target.value)}>
            {statuses.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Details
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!title.trim() || admin.update.isPending}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
