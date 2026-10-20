import { Fragment, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EntityHeader } from "../components/common/EntityHeader";
import { MenuButton } from "../components/common/MenuButton";
import { Modal } from "../components/common/Modal";
import { LoadingState } from "../components/common/LoadingState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { RequireRole, useHasRole } from "../auth/RequireAuth";
import { LatestVersion, SaveVersionButton } from "../components/versioning/SaveVersionButton";
import { DwellChart, num } from "../components/dwells/DwellChart";
import { overlayTitle, usePlatformsEmitterOverlay } from "../components/dwells/platformOverlay";
import { ApiRequestError } from "../api/client";
import { dwellsApi, type DwellFile, type DwellFileLink } from "../api/dwells";
import {
  useAppSettings,
  useCommitDwellVersion,
  useDwellFile,
  useDwellFileMutation,
  useDwellFiles,
  useDwellStrategies,
  useDwellVersions,
  useRefreshDwellLists,
  useUpdateDwellFile,
} from "../state/hooks/useDwells";
import { useMdfLinks, useMdfs } from "../state/hooks/useMdfs";
import { usePlatforms } from "../state/hooks/usePlatforms";

/** Saves a file as the browser's download. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const xmlName = (name: string) => `${name.replace(/[^\w.-]+/g, "_")}.xml`;

/** One dwell file: its settings and the Strategies it pins — a saved
 * version of each, any number per Platform. */
export function DwellFilePage() {
  const { fileId = "" } = useParams<{ fileId: string }>();
  const { data: file, isLoading, error } = useDwellFile(fileId);
  if (isLoading) return <LoadingState label="Loading dwell file…" />;
  if (!file || error)
    return (
      <div className="page">
        <Link to="/dwells?view=files">← Dwell files</Link>
        <p className="hint-text">This dwell file doesn&apos;t exist (it may have been deleted).</p>
      </div>
    );
  return <DwellFileView file={file} />;
}

function DwellFileView({ file }: { file: DwellFile }) {
  const navigate = useNavigate();
  const canEdit = useHasRole("editor");
  const refreshLists = useRefreshDwellLists();
  const { data: versions } = useDwellVersions("files", file.id);
  const commit = useCommitDwellVersion("files", file.id);
  const { data: mdfLinks } = useMdfLinks(file.mdf_id ?? "");
  const { data: platforms } = usePlatforms();
  const repinAll = useDwellFileMutation(file.id, () => dwellsApi.repinLatest(file.id));
  const { confirmDelete, dialog } = useConfirmDialog();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<string | null>(null); // a Platform id, or "" for any
  const [error, setError] = useState<string | null>(null);

  const outdated = file.links.filter((l) => l.outdated).length;
  const mdfPlatformIds = file.mdf_id ? new Set((mdfLinks ?? []).map((l) => l.platform_id)) : null;
  const platformName = new Map((platforms ?? []).map((p) => [p.id, p.name]));
  const missing = mdfPlatformIds
    ? [...mdfPlatformIds].filter((id) => !file.links.some((l) => l.platform_ids.includes(id)))
    : [];

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "That didn't work.");
    }
  }

  async function handleDelete() {
    if (!(await confirmDelete(`Delete the dwell file "${file.name}"? Its Strategies stay.`))) return;
    await run(async () => {
      await dwellsApi.deleteFile(file.id);
      refreshLists();
      navigate("/dwells?view=files");
    });
  }

  return (
    <div className="page">
      <Link to="/dwells?view=files">← Dwell files</Link>
      <EntityHeader
        title={file.name}
        actions={
          <>
            <SaveVersionButton noun="dwell file" save={(summary) => commit.mutateAsync(summary)} pending={commit.isPending} />
            <button
              type="button"
              className="button secondary"
              title="The file as it stands now"
              onClick={() => void run(async () => saveBlob(await dwellsApi.xml(file.id), xmlName(file.name)))}
            >
              Download XML
            </button>
            <MenuButton
              label="More ▾"
              items={[
                { label: "Details…", onSelect: () => setEditing(true) },
                { label: "Version history", to: `/dwells/files/${file.id}/versions` },
                ...(canEdit
                  ? [
                      { label: "Delete this dwell file…", danger: true, onSelect: () => void handleDelete() },
                    ]
                  : []),
              ]}
            />
          </>
        }
        status={
          <>
            <span className="dwell-chip">
              {file.mdf_id ? (
                <>
                  MDF <Link to={`/mdfs/${file.mdf_id}`}>{file.mdf_name}</Link>
                </>
              ) : (
                "In no MDF"
              )}
            </span>
            <LatestVersion versions={versions} />
            {file.unsaved && file.latest_version_number != null && (
              <span className="status-badge status-draft" title="An MDF export uses the latest saved version">
                Changed since v{file.latest_version_number}
              </span>
            )}
            {outdated > 0 && (
              <span className="status-badge status-pending_review">
                {outdated} outdated pin{outdated === 1 ? "" : "s"}
              </span>
            )}
          </>
        }
      >
        {file.notes && <p className="muted emitter-description">{file.notes}</p>}
      </EntityHeader>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <h2 className="dwell-section-title">
        Strategies <span className="tab-count">{file.links.length}</span>
      </h2>
      {missing.length > 0 && (
            <div className="dwell-callout">
              <strong>
                {missing.length} Platform{missing.length === 1 ? "" : "s"} in {file.mdf_name} {missing.length === 1 ? "has" : "have"} no
                Strategy here:
              </strong>{" "}
              {missing.map((id, i) => (
                <Fragment key={id}>
                  {i > 0 && ", "}
                  {canEdit ? (
                    <button type="button" className="link-button" onClick={() => setAdding(id)}>
                      {platformName.get(id) ?? "?"}
                    </button>
                  ) : (
                    platformName.get(id) ?? "?"
                  )}
                </Fragment>
              ))}
            </div>
          )}
          {outdated > 0 && (
            <RequireRole minimum="editor">
              <p className="repin-all-row">
                <span className="hint-text">
                  {outdated} Strateg{outdated === 1 ? "y has" : "ies have"} a newer saved version.
                </span>{" "}
                <button
                  type="button"
                  className="button secondary small"
                  disabled={repinAll.isPending}
                  onClick={() => void run(() => repinAll.mutateAsync(undefined))}
                >
                  {repinAll.isPending ? "Repinning…" : "Repin all to their latest version"}
                </button>
              </p>
            </RequireRole>
          )}
          <PinnedStrategies file={file} canEdit={canEdit} onError={setError} />
          {canEdit && (
            <button type="button" className="button secondary" onClick={() => setAdding("")}>
              + Add a Strategy
            </button>
          )}
      {editing && <FileDetails file={file} canEdit={canEdit} onClose={() => setEditing(false)} />}
      {adding != null && (
        <AddStrategy file={file} platformId={adding} mdfPlatformIds={mdfPlatformIds} onClose={() => setAdding(null)} />
      )}
      {dialog}
    </div>
  );
}

/** The pinned Strategies, in file order: each row opens to its chart. */
function PinnedStrategies({ file, canEdit, onError }: { file: DwellFile; canEdit: boolean; onError: (e: string | null) => void }) {
  const { data: settings } = useAppSettings();
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState<DwellFileLink | null>(null);
  const { confirmDelete, dialog } = useConfirmDialog();
  const update = useDwellFileMutation(file.id, ({ linkId, input }: { linkId: string; input: { strategy_version_id?: string; sort_order?: number } }) =>
    dwellsApi.updateLink(linkId, input),
  );
  const unpin = useDwellFileMutation(file.id, (linkId: string) => dwellsApi.unpin(linkId));

  async function run(action: () => Promise<unknown>) {
    onError(null);
    try {
      await action();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : "That didn't work.");
    }
  }
  async function move(index: number, to: number) {
    const order = [...file.links];
    [order[index], order[to]] = [order[to], order[index]];
    await run(async () => {
      for (const [place, link] of order.entries()) {
        if (link.sort_order !== place) await update.mutateAsync({ linkId: link.id, input: { sort_order: place } });
      }
    });
  }

  if (file.links.length === 0) {
    return <p className="hint-text dwell-empty">No Strategies in this file yet{canEdit ? " — add the Strategies it should hold." : "."}</p>;
  }
  return (
    <>
      <table className="data-table dwell-links">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Platform</th>
            <th>Strategy</th>
            <th>Version</th>
            <th>Dwells</th>
            <th>Range (MHz)</th>
            <th>Cycle (ms)</th>
            {canEdit && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {file.links.map((l, i) => {
            const freqs = l.dwells.map((d) => d.freq_mhz);
            const cycle = l.dwells.reduce((sum, d) => sum + d.dwell_time_ms, 0);
            const isOpen = open === l.id;
            return (
              <Fragment key={l.id}>
                <tr className={isOpen ? "dwell-link-row open" : "dwell-link-row"} onClick={() => setOpen(isOpen ? null : l.id)}>
                  <td className="num muted">{i + 1}</td>
                  <td>
                    {l.is_default ? (
                      <span className="hint-text" title="Not tied to any Platform">
                        Default dwell
                      </span>
                    ) : (
                      <>
                        {l.platform_names.join(", ")}
                        {(l.platforms_not_in_mdf?.length ?? 0) > 0 && (
                          <span
                            className="status-badge status-pending_review"
                            title={`The file's MDF doesn't pin ${l.platforms_not_in_mdf?.join(", ")}`}
                          >
                            {l.platform_names.length > 1 ? `${l.platforms_not_in_mdf?.length} not in the MDF` : "not in the MDF"}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    <span className="dwell-disclosure" aria-hidden>
                      {isOpen ? "▾" : "▸"}
                    </span>{" "}
                    <Link to={`/dwells/strategies/${l.strategy_id}`} onClick={(e) => e.stopPropagation()}>
                      {l.strategy_name}
                    </Link>
                  </td>
                  <td className="nowrap">
                    v{l.pinned_version_number}
                    {l.outdated && (
                      <span className="status-badge status-pending_review" title={`v${l.latest_version_number} is the latest`}>
                        v{l.latest_version_number} out
                      </span>
                    )}
                  </td>
                  <td className="num">{l.dwells.length}</td>
                  <td className="nowrap">{freqs.length ? `${num(Math.min(...freqs))}–${num(Math.max(...freqs))}` : "—"}</td>
                  <td className="num">{cycle ? num(cycle) : "—"}</td>
                  {canEdit && (
                    <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <MenuButton
                        label="⋯"
                        className="row-menu-button"
                        ariaLabel={`Actions for ${l.strategy_name}`}
                        items={[
                          ...(l.outdated
                            ? [
                                {
                                  label: `Repin to v${l.latest_version_number}`,
                                  onSelect: () =>
                                    void run(async () => {
                                      const versions = await dwellsApi.versions("strategies", l.strategy_id);
                                      const latest = versions[versions.length - 1];
                                      await update.mutateAsync({ linkId: l.id, input: { strategy_version_id: latest.id } });
                                    }),
                                },
                              ]
                            : []),
                          { label: "Pin another version…", onSelect: () => setPicking(l) },
                          { label: "Move up", disabled: i === 0, onSelect: () => void move(i, i - 1) },
                          { label: "Move down", disabled: i === file.links.length - 1, onSelect: () => void move(i, i + 1) },
                          {
                            label: "Remove from this file…",
                            danger: true,
                            onSelect: async () => {
                              if (!(await confirmDelete(`Take "${l.strategy_name}" out of ${file.name}? The Strategy itself stays.`)))
                                return;
                              await run(() => unpin.mutateAsync(l.id));
                            },
                          },
                        ]}
                      />
                    </td>
                  )}
                </tr>
                {isOpen && (
                  <tr className="dwell-link-detail">
                    <td colSpan={canEdit ? 8 : 7}>
                      <PinnedChart link={l} bandwidthMhz={settings?.dwell_bandwidth_mhz ?? 10} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {picking && <PickVersion file={file} link={picking} onClose={() => setPicking(null)} />}
      {dialog}
    </>
  );
}

/** The Platform picker's choice for the default dwells. */
const DEFAULT_KEY = "__default";

/** A pinned Strategy version's chart, with its Platform's Emitters behind it. */
function PinnedChart({ link, bandwidthMhz }: { link: DwellFileLink; bandwidthMhz: number }) {
  const overlay = usePlatformsEmitterOverlay(link.platform_ids);
  const emptyText =
    link.latest_version_number > link.pinned_version_number
      ? `v${link.pinned_version_number} has no dwells — v${link.latest_version_number} is newer: repin it from the ⋯ menu.`
      : `v${link.pinned_version_number} has no dwells — add them on the Strategy's page and save.`;
  return (
    <DwellChart
      dwells={link.dwells}
      bandwidthMhz={bandwidthMhz}
      title={`${link.strategy_name} · v${link.pinned_version_number}`}
      overlay={overlay}
      overlayTitle={overlayTitle(link.platform_names)}
      emptyText={link.dwells.length ? "No dwells." : emptyText}
    />
  );
}

/** Pins a different saved version of a Strategy already in the file. */
function PickVersion({ file, link, onClose }: { file: DwellFile; link: DwellFileLink; onClose: () => void }) {
  const { data: versions } = useDwellVersions("strategies", link.strategy_id);
  const update = useDwellFileMutation(file.id, (versionId: string) =>
    dwellsApi.updateLink(link.id, { strategy_version_id: versionId }),
  );
  const [versionId, setVersionId] = useState(link.pinned_version_id);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync(versionId);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't pin it.");
    }
  }
  return (
    <Modal title={`Pin a version of ${link.strategy_name}`} onClose={onClose}>
      <form className="rename-form" onSubmit={submit}>
        <label>
          Version
          <select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
            {[...(versions ?? [])].reverse().map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version_number}
                {v.change_summary ? ` — ${v.change_summary}` : ""}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={update.isPending || versionId === link.pinned_version_id}>
            Pin
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Adds a Strategy: pick the Platform (one Strategy each), then which of its
 * Strategies; the latest saved version is pinned. */
function AddStrategy({
  file,
  platformId: initialPlatform,
  mdfPlatformIds,
  onClose,
}: {
  file: DwellFile;
  platformId: string;
  mdfPlatformIds: Set<string> | null;
  onClose: () => void;
}) {
  const { data: strategies } = useDwellStrategies();
  const pin = useDwellFileMutation(file.id, (strategyId: string) => dwellsApi.pin(file.id, strategyId));
  const [platformId, setPlatformId] = useState(initialPlatform);
  const [strategyId, setStrategyId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // How many of the file's Strategies cover each Platform — a Platform can have several here.
  const inFile = new Map<string, number>();
  for (const l of file.links) for (const id of l.platform_ids) inFile.set(id, (inFile.get(id) ?? 0) + 1);
  // Platforms that have a Strategy to offer, the file's MDF's first.
  const platforms = new Map<string, string>();
  for (const s of strategies ?? []) s.platform_ids.forEach((id, i) => platforms.set(id, s.platform_names[i] ?? "?"));
  const hasDefaults = (strategies ?? []).some((s) => s.is_default);
  const byName = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1], undefined, { numeric: true });
  const all = [...platforms.entries()].sort(byName);
  const inMdf = mdfPlatformIds ? all.filter(([id]) => mdfPlatformIds.has(id)) : all;
  const others = mdfPlatformIds ? all.filter(([id]) => !mdfPlatformIds.has(id)) : [];
  const choices = (strategies ?? []).filter((s) =>
    platformId === DEFAULT_KEY ? s.is_default : s.platform_ids.includes(platformId),
  );
  const blocked = (s: (typeof choices)[number]) => file.links.some((l) => l.strategy_id === s.id);
  const chosen = choices.find((s) => s.id === strategyId) ?? (choices.length === 1 ? choices[0] : undefined);

  const option = ([id, name]: [string, string]) => (
    <option key={id} value={id}>
      {name}
      {inFile.has(id) ? ` — ${inFile.get(id)} in this file` : ""}
    </option>
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return setError("Pick the Strategy.");
    if (chosen.latest_version_number == null) return setError("That Strategy has no saved version yet.");
    try {
      await pin.mutateAsync(chosen.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't add it.");
    }
  }

  return (
    <Modal title="Add a Strategy" onClose={onClose}>
      <form className="rename-form" onSubmit={submit}>
        <label>
          Platform
          <select
            value={platformId}
            onChange={(e) => {
              setPlatformId(e.target.value);
              setStrategyId("");
            }}
          >
            <option value="">— Pick the Platform —</option>
            {hasDefaults && <option value={DEFAULT_KEY}>Default dwells (no Platform)</option>}
            {mdfPlatformIds ? (
              <>
                {inMdf.length > 0 && <optgroup label={`In ${file.mdf_name}`}>{inMdf.map(option)}</optgroup>}
                {others.length > 0 && <optgroup label="Others">{others.map(option)}</optgroup>}
              </>
            ) : (
              all.map(option)
            )}
          </select>
        </label>
        {platformId && platformId !== DEFAULT_KEY && !platforms.has(platformId) && (
          <p className="hint-text">
            This Platform has no Strategy yet — <Link to="/dwells">make one under Dwells</Link> first.
          </p>
        )}
        {choices.length > 0 && (
          <label>
            Strategy
            <select value={chosen?.id ?? ""} onChange={(e) => setStrategyId(e.target.value)}>
              {choices.length > 1 && <option value="">— Pick one —</option>}
              {choices.map((s) => (
                <option key={s.id} value={s.id} disabled={blocked(s)}>
                  {s.name} — {s.dwell_count} dwell{s.dwell_count === 1 ? "" : "s"}
                  {s.latest_version_number ? `, v${s.latest_version_number}` : ", not saved"}
                  {s.platform_ids.length > 1 ? ` · also ${s.platform_names.filter((_, i) => s.platform_ids[i] !== platformId).join(", ")}` : ""}
                  {blocked(s) ? " — already in this file" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {chosen?.unsaved && chosen.latest_version_number != null && (
          <p className="hint-text">It has changes since v{chosen.latest_version_number}; v{chosen.latest_version_number} is pinned.</p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={pin.isPending || !chosen}>
            Add
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Name, MDF, the file's settings and notes. */
function FileDetails({ file, canEdit, onClose }: { file: DwellFile; canEdit: boolean; onClose: () => void }) {
  const update = useUpdateDwellFile(file.id);
  const { data: mdfs } = useMdfs();
  const { data: files } = useDwellFiles();
  const [name, setName] = useState(file.name);
  const [mdfId, setMdfId] = useState(file.mdf_id ?? "");
  const [timeout, setTimeoutValue] = useState(num(file.timeout));
  const [setup, setSetup] = useState(num(file.setup_time));
  const [notes, setNotes] = useState(file.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return onClose();
    const clash = (files ?? []).some((f) => f.id !== file.id && f.name.toLowerCase() === name.trim().toLowerCase());
    if (!name.trim()) return setError("Give it a name.");
    if (clash) return setError("Another dwell file has that name.");
    if (!(Number(timeout) >= 0) || !(Number(setup) >= 0)) return setError("Timeout and setup time can't be negative.");
    try {
      await update.mutateAsync({
        name: name.trim(),
        mdf_id: mdfId || null,
        timeout: Number(timeout),
        setup_time: Number(setup),
        notes: notes.trim() || null,
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
        <label>
          For the MDF
          <select value={mdfId} onChange={(e) => setMdfId(e.target.value)}>
            <option value="">None</option>
            {(mdfs ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <p className="hint-text">The MDF&apos;s export carries the file&apos;s latest saved version as dwells/{xmlName(name || file.name)}.</p>
        <div className="form-row">
          <label>
            Timeout
            <input type="number" step="any" min="0" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} />
          </label>
          <label>
            Setup time
            <input type="number" step="any" min="0" value={setup} onChange={(e) => setSetup(e.target.value)} />
          </label>
        </div>
        <label>
          Notes (optional)
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        </fieldset>
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
