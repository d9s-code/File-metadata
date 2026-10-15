import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EntityHeader } from "../components/common/EntityHeader";
import { MenuButton } from "../components/common/MenuButton";
import { Modal } from "../components/common/Modal";
import { LoadingState } from "../components/common/LoadingState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { formatDate } from "../components/common/dates";
import { NotesFeed } from "../components/common/NotesFeed";
import { NotesDrawer } from "../components/common/NotesDrawer";
import { LatestVersion, SaveVersionButton } from "../components/versioning/SaveVersionButton";
import { DwellsEditor } from "../components/dwells/DwellsEditor";
import { num } from "../components/dwells/DwellChart";
import { useHasRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { dwellsApi, type DwellStrategy, type StrategyTestUse } from "../api/dwells";
import {
  useAddDwellStrategyNote,
  useAppSettings,
  useCommitDwellVersion,
  useDeleteDwellStrategyNote,
  useDwellStrategy,
  useDwellStrategyNotes,
  useDwellVersions,
  useRefreshDwellLists,
  useUpdateDwellStrategy,
} from "../state/hooks/useDwells";
import { usePlatforms } from "../state/hooks/usePlatforms";

type Tab = "dwells" | "used";

/** One Dwell Strategy: a Platform's dwells, edited, charted and saved as
 * versions that dwell files pin and test runs record. */
export function DwellStrategyPage() {
  const { strategyId = "" } = useParams<{ strategyId: string }>();
  const { data: strategy, isLoading, error } = useDwellStrategy(strategyId);
  if (isLoading) return <LoadingState label="Loading Strategy…" />;
  if (!strategy || error)
    return (
      <div className="page">
        <Link to="/dwells">← Dwells</Link>
        <p className="hint-text">This Strategy doesn&apos;t exist (it may have been deleted).</p>
      </div>
    );
  return <StrategyView strategy={strategy} />;
}

function StrategyView({ strategy }: { strategy: DwellStrategy }) {
  const navigate = useNavigate();
  const canEdit = useHasRole("editor");
  const refreshLists = useRefreshDwellLists();
  const { data: settings } = useAppSettings();
  const { data: versions } = useDwellVersions("strategies", strategy.id);
  const commit = useCommitDwellVersion("strategies", strategy.id);
  const update = useUpdateDwellStrategy(strategy.id);
  const { data: notes, isLoading: notesLoading } = useDwellStrategyNotes(strategy.id);
  const addNote = useAddDwellStrategyNote(strategy.id);
  const deleteNote = useDeleteDwellStrategyNote(strategy.id);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [tab, setTab] = useState<Tab>("dwells");
  const [editing, setEditing] = useState<"details" | "copy" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uses = strategy.used_in.length + strategy.tests.length;
  const outdatedUses = strategy.used_in.filter((u) => u.outdated).length;

  async function handleDelete() {
    if (uses > 0) {
      setError("It's in a dwell file or was used in a test run, so it's kept. Take it out of the files first.");
      setTab("used");
      return;
    }
    if (!(await confirmDelete(`Delete the Strategy "${strategy.name}" and its saved versions?`))) return;
    try {
      await dwellsApi.deleteStrategy(strategy.id);
      refreshLists();
      navigate("/dwells");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't delete it.");
    }
  }

  return (
    <div className="page">
      <Link to="/dwells">← Dwells</Link>
      <EntityHeader
        title={strategy.name}
        actions={
          <>
            {strategy.unsaved && (
              <SaveVersionButton
                noun="Strategy"
                save={(summary) => commit.mutateAsync(summary)}
                pending={commit.isPending}
              />
            )}
            <MenuButton
              label="More ▾"
              items={[
                { label: "Details…", onSelect: () => setEditing("details") },
                { label: "Version history", to: `/dwells/strategies/${strategy.id}/versions` },
                ...(canEdit
                  ? [
                      { label: "Make a copy…", onSelect: () => setEditing("copy") },
                      { label: "Delete this Strategy…", danger: true, onSelect: () => void handleDelete() },
                    ]
                  : []),
              ]}
            />
          </>
        }
        status={
          <>
            {strategy.platform_id ? (
              <span className="dwell-chip">
                Platform <Link to={`/platforms/${strategy.platform_id}`}>{strategy.platform_name}</Link>
              </span>
            ) : (
              <button type="button" className="status-badge status-pending_review" onClick={() => setEditing("details")}>
                No Platform yet — pick one
              </button>
            )}
            <LatestVersion versions={versions} />
            {strategy.unsaved && strategy.latest_version_number != null && (
              <span
                className="status-badge status-draft"
                title="The dwells differ from the latest saved version. Files and tests use saved versions only."
              >
                Changed since v{strategy.latest_version_number}
              </span>
            )}
            {outdatedUses > 0 && (
              <button type="button" className="status-badge status-pending_review" onClick={() => setTab("used")}>
                {outdatedUses} file{outdatedUses === 1 ? " pins" : "s pin"} an older version
              </button>
            )}
          </>
        }
      >
        {strategy.description && <p className="muted emitter-description">{strategy.description}</p>}
      </EntityHeader>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="tab-bar">
        <button className={tab === "dwells" ? "tab active" : "tab"} onClick={() => setTab("dwells")}>
          Dwells <span className="tab-count">{strategy.dwells.length}</span>
        </button>
        <button className={tab === "used" ? "tab active" : "tab"} onClick={() => setTab("used")}>
          Used in <span className="tab-count">{uses}</span>
        </button>
      </div>

      {tab === "dwells" && (
        <DwellsEditor
          strategy={strategy}
          defaultBandwidth={settings?.dwell_bandwidth_mhz ?? 10}
          canEdit={canEdit}
          onSave={(input) => update.mutateAsync(input)}
        />
      )}
      {tab === "used" && <UsedIn strategy={strategy} />}

      <NotesDrawer count={notes?.length ?? 0} subject={strategy.name} draftKey={`notes-draft:dwell-strategy:${strategy.id}`}>
        <NotesFeed
          key={strategy.id}
          draftKey={`notes-draft:dwell-strategy:${strategy.id}`}
          notes={notes}
          isLoading={notesLoading}
          placeholder="Running notes about this Strategy — why it dwells where it does, what to check next."
          onAdd={(body) => addNote.mutateAsync(body)}
          isAdding={addNote.isPending}
          onDelete={(noteId) => deleteNote.mutateAsync(noteId)}
          inDrawer
        />
      </NotesDrawer>

      {editing === "details" && <Details strategy={strategy} canEdit={canEdit} onClose={() => setEditing(null)} />}
      {editing === "copy" && <MakeCopy strategy={strategy} onClose={() => setEditing(null)} />}
      {dialog}
    </div>
  );
}

function testHref(t: StrategyTestUse): string {
  if (t.kind === "platform") return `/platforms/${t.owner_id}/tests/${t.id}`;
  if (t.kind === "emitter") return `/emitters/${t.owner_id}/tests/${t.id}`;
  return `/mdfs/${t.owner_id}`;
}

/** The dwell files that pin the Strategy, and the test runs that used it. */
function UsedIn({ strategy }: { strategy: DwellStrategy }) {
  const latest = strategy.latest_version_number;
  return (
    <div className="dwell-used-in">
      <section className="card">
        <h3>Dwell files</h3>
        {strategy.used_in.length === 0 ? (
          <p className="hint-text">Not in any dwell file yet — add it from a dwell file&apos;s page.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Pins</th>
              </tr>
            </thead>
            <tbody>
              {strategy.used_in.map((u) => (
                <tr key={u.link_id}>
                  <td>
                    <Link to={`/dwells/files/${u.file_id}`}>{u.file_name}</Link>
                  </td>
                  <td>
                    v{u.pinned_version_number}
                    {u.outdated && (
                      <span className="status-badge status-pending_review" title={`v${latest} is the latest`}>
                        outdated
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card">
        <h3>Test runs</h3>
        {strategy.tests.length === 0 ? (
          <p className="hint-text">No test run has recorded it yet — pick it under Dwell when logging a run.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Tested</th>
                <th>Version</th>
              </tr>
            </thead>
            <tbody>
              {strategy.tests.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={testHref(t)}>{t.title}</Link>
                    {t.kind === "platform" && <span className="hint-text"> · Platform test</span>}
                  </td>
                  <td className="nowrap">{formatDate(t.test_date)}</td>
                  <td>v{t.version_number}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** The Strategy's details: name, Platform, description and manual collect
 * time — read-only for viewers. Saving them saves a new version. */
function Details({ strategy, canEdit, onClose }: { strategy: DwellStrategy; canEdit: boolean; onClose: () => void }) {
  const update = useUpdateDwellStrategy(strategy.id);
  const { data: platforms } = usePlatforms();
  const [name, setName] = useState(strategy.name);
  const [platformId, setPlatformId] = useState(strategy.platform_id ?? "");
  const [description, setDescription] = useState(strategy.description ?? "");
  const [manual, setManual] = useState(num(strategy.manual_collect_time_ms));
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return onClose();
    if (!name.trim()) return setError("Give it a name.");
    if (!platformId) return setError("Pick its Platform.");
    const manualValue = manual.trim() === "" ? 50 : Number(manual);
    if (!(manualValue >= 0)) return setError("The manual collect time can't be negative.");
    setError(null);
    try {
      await update.mutateAsync({
        name: name.trim(),
        ...(platformId !== strategy.platform_id ? { platform_id: platformId } : {}),
        description: description.trim() || null,
        manual_collect_time_ms: manualValue,
        save_version: true,
        change_summary: "Changed its details",
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save the details.");
    }
  }

  return (
    <Modal title="Details" onClose={onClose} wide>
      <form className="rename-form" onSubmit={submit}>
        <fieldset className="plain-fieldset" disabled={!canEdit}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
          </label>
          <PlatformSelect value={platformId} onChange={setPlatformId} platforms={platforms ?? []} />
          <label>
            Description (shown in the lists)
            <textarea rows={2} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            Manual collect time (ms)
            <input type="number" step="any" min="0" value={manual} placeholder="50" onChange={(e) => setManual(e.target.value)} />
          </label>
        </fieldset>
        {canEdit && <p className="hint-text">Saving changes here saves a new version of the Strategy.</p>}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            {canEdit ? "Cancel" : "Close"}
          </button>
          {canEdit && (
            <button type="submit" className="button primary" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

export function PlatformSelect({
  value,
  onChange,
  platforms,
}: {
  value: string;
  onChange: (id: string) => void;
  platforms: { id: string; name: string }[];
}) {
  return (
    <label>
      Platform
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Pick the Platform —</option>
        {[...platforms]
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
    </label>
  );
}

/** A new Strategy starting from this one's dwells — for this Platform or another. */
function MakeCopy({ strategy, onClose }: { strategy: DwellStrategy; onClose: () => void }) {
  const navigate = useNavigate();
  const refreshLists = useRefreshDwellLists();
  const { data: platforms } = usePlatforms();
  const [name, setName] = useState(`${strategy.name} (copy)`);
  const [platformId, setPlatformId] = useState(strategy.platform_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the copy a name.");
    if (!platformId) return setError("Pick its Platform.");
    setSaving(true);
    try {
      const made = await dwellsApi.createStrategy({ name: name.trim(), platform_id: platformId, copy_from_id: strategy.id });
      refreshLists();
      onClose();
      navigate(`/dwells/strategies/${made.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't make the copy.");
      setSaving(false);
    }
  }

  return (
    <Modal title="Make a copy" onClose={onClose}>
      <form className="rename-form" onSubmit={submit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
        </label>
        <PlatformSelect value={platformId} onChange={setPlatformId} platforms={platforms ?? []} />
        <p className="hint-text">The copy starts with these dwells as they stand now, and its own version history.</p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? "Copying…" : "Make the copy"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
