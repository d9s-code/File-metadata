import { Fragment, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError } from "../../api/client";
import { dwellsApi, type MdfDwell } from "../../api/dwells";
import { RequireRole } from "../../auth/RequireAuth";
import { saveBlob, xmlName } from "../../pages/DwellFilePage";
import { useDwellFiles, useDwellVersions, useMdfDwellMutations, useMdfDwells } from "../../state/hooks/useDwells";
import { formatDate, formatDateTime } from "../common/dates";
import { EmptyState } from "../common/EmptyState";
import { LoadingState } from "../common/LoadingState";
import { MenuButton } from "../common/MenuButton";
import { Modal } from "../common/Modal";
import { num } from "../dwells/DwellChart";
import { StatusBadge } from "../status/StatusBadge";

const fileUrl = (id: string) => `/dwells/files/${id}`;
const versionUrl = (id: string, n: number) => `/dwells/files/${id}/versions?version=${n}`;

/** Pick a dwell file and a saved version of it (its latest by default). */
function PinDwellFile({
  mdfId,
  pinned,
  initialFileId = "",
  onClose,
}: {
  mdfId: string;
  pinned: MdfDwell[];
  /** Pinning another version of a file the MDF already pins. */
  initialFileId?: string;
  onClose: () => void;
}) {
  const { data: files } = useDwellFiles();
  const { pin } = useMdfDwellMutations(mdfId);
  const [fileId, setFileId] = useState(initialFileId);
  const [versionId, setVersionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data: versions } = useDwellVersions("files", fileId);
  const pinnedIds = new Set(pinned.map((d) => d.dwell_file_id));
  const current = pinned.find((d) => d.dwell_file_id === fileId);
  const choices = (files ?? []).filter((f) => f.id === initialFileId || !pinnedIds.has(f.id));
  const newestFirst = [...(versions ?? [])].reverse();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!fileId) return setError("Pick the dwell file.");
    try {
      await pin.mutateAsync({ fileId, versionId: versionId || null });
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't pin it.");
    }
  }

  return (
    <Modal title={initialFileId ? "Pin another version" : "Pin a dwell file"} onClose={onClose}>
      <form className="rename-form" onSubmit={submit}>
        <label>
          Dwell file
          <select
            value={fileId}
            disabled={!!initialFileId}
            onChange={(e) => {
              setFileId(e.target.value);
              setVersionId("");
            }}
          >
            <option value="">— Pick the dwell file —</option>
            {choices.map((f) => (
              <option key={f.id} value={f.id} disabled={f.latest_version_number == null}>
                {f.name}
                {f.latest_version_number == null ? " — not saved yet" : ` — v${f.latest_version_number}`}
                {f.mdfs.length > 0 ? ` · in ${f.mdfs.map((m) => m.name).join(", ")}` : ""}
              </option>
            ))}
          </select>
        </label>
        {fileId && (
          <label>
            Version
            <select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              <option value="">The latest saved{newestFirst[0] ? ` (v${newestFirst[0].version_number})` : ""}</option>
              {newestFirst.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_number} · {formatDate(v.created_at)}
                  {v.change_summary ? ` — ${v.change_summary}` : ""}
                  {current?.pinned_version_id === v.id ? " (pinned now)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="hint-text">
          The MDF pins a saved version: later changes to the file stay out of it until you repin. Save the MDF to put the
          pin in a version, and in its export.
        </p>
        {choices.length === 0 && !initialFileId && (
          <p className="hint-text">
            Every dwell file is pinned here already — <Link to="/dwells?view=files">add one under Dwells</Link>.
          </p>
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
          <button type="submit" className="button primary" disabled={pin.isPending || !fileId}>
            {pin.isPending ? "Pinning…" : "Pin"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DwellFileCard({
  mdfId,
  d,
  pinsFrozen,
  canEdit,
  onPinOther,
  onError,
}: {
  mdfId: string;
  d: MdfDwell;
  pinsFrozen: boolean;
  canEdit: boolean;
  onPinOther: () => void;
  onError: (message: string | null) => void;
}) {
  const { pin, unpin } = useMdfDwellMutations(mdfId);
  const cycle = d.strategies.length ? Math.max(...d.strategies.map((s) => s.cycle_ms)) : 0;

  async function run(action: () => Promise<unknown>) {
    onError(null);
    try {
      await action();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : "That didn't work.");
    }
  }

  return (
    <section className="card mdf-dwell-file">
      <div className="card-header">
        <h4>
          <Link to={fileUrl(d.dwell_file_id)}>{d.name}</Link>{" "}
          <Link className="hint-text" to={versionUrl(d.dwell_file_id, d.pinned_version_number)} title="The version this MDF pins">
            v{d.pinned_version_number} pinned
          </Link>
        </h4>
        <span className="section-actions">
          {d.outdated && d.latest_version_id && (
            <>
              <span
                className="status-badge status-pending_review"
                title={`The file has a newer saved version (v${d.latest_version_number}) than the one pinned here.`}
              >
                Outdated — v{d.latest_version_number} saved
              </span>
              <RequireRole minimum="editor">
                <button
                  type="button"
                  className="link-button"
                  disabled={pin.isPending}
                  onClick={() => void run(() => pin.mutateAsync({ fileId: d.dwell_file_id, versionId: d.latest_version_id }))}
                >
                  {pin.isPending ? "Repinning…" : `Repin to v${d.latest_version_number}`}
                </button>
              </RequireRole>
            </>
          )}
          {d.file_changed && !pinsFrozen && (
            <span
              className="status-badge status-draft"
              title="The file has changes not saved as a version — save it on the file's page, then repin here."
            >
              File changed since v{d.latest_version_number}
            </span>
          )}
          <MenuButton
            label="⋯"
            className="row-menu-button"
            ariaLabel={`Actions for ${d.name}`}
            items={[
              { label: "Open the dwell file", to: fileUrl(d.dwell_file_id) },
              {
                label: `Download XML (v${d.pinned_version_number})`,
                onSelect: () =>
                  void run(async () =>
                    saveBlob(await dwellsApi.xml(d.dwell_file_id, d.pinned_version_number), xmlName(d.name)),
                  ),
              },
              { label: "Version history", to: versionUrl(d.dwell_file_id, d.pinned_version_number) },
              ...(canEdit
                ? [
                    { label: "Pin another version…", onSelect: onPinOther },
                    {
                      label: "Unpin from this MDF",
                      danger: true,
                      onSelect: () => void run(() => unpin.mutateAsync(d.dwell_file_id)),
                    },
                  ]
                : []),
            ]}
          />
        </span>
      </div>
      <dl className="mdf-dwell-facts">
        <div>
          <dt>Timeout</dt>
          <dd>{num(d.timeout)}</dd>
        </div>
        <div>
          <dt>Setup time</dt>
          <dd>{num(d.setup_time)}</dd>
        </div>
        <div>
          <dt>Strategies</dt>
          <dd>{d.strategies.length}</dd>
        </div>
        <div>
          <dt title="The longest Strategy's cycle: one pass through all its dwells">Longest cycle</dt>
          <dd>{cycle ? `${num(cycle)} ms` : "—"}</dd>
        </div>
        <div>
          <dt>v{d.pinned_version_number} saved</dt>
          <dd>{formatDate(d.pinned_version_saved_at)}</dd>
        </div>
        <div>
          <dt>Pinned</dt>
          <dd title={formatDateTime(d.pinned_at)}>{formatDate(d.pinned_at)}</dd>
        </div>
      </dl>
      {d.notes && <p className="muted">{d.notes}</p>}
      {d.platforms_not_covered.length > 0 && (
        <div className="dwell-callout">
          <strong>
            {d.platforms_not_covered.length} of this MDF&apos;s Platform{d.platforms_not_covered.length === 1 ? " has" : "s have"} no
            Strategy in v{d.pinned_version_number}:
          </strong>{" "}
          {d.platforms_not_covered.join(", ")}
        </div>
      )}
      {d.strategies.length === 0 ? (
        <p className="hint-text">No Strategy in v{d.pinned_version_number} — its XML would be empty.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Version</th>
              <th>Platforms</th>
              <th className="num">Dwells</th>
              <th className="num" title="One pass through every dwell">
                Cycle (ms)
              </th>
              <th className="num">Bandwidth (MHz)</th>
            </tr>
          </thead>
          <tbody>
            {d.strategies.map((s, i) => (
              <tr key={`${s.strategy_id ?? "gone"}-${i}`}>
                <td>{s.strategy_id ? <Link to={`/dwells/strategies/${s.strategy_id}`}>{s.name}</Link> : s.name}</td>
                <td className="nowrap">
                  {s.version_number != null ? `v${s.version_number}` : "—"}
                  {s.outdated && !pinsFrozen && (
                    <span
                      className="hint-text"
                      title="The Strategy has a newer saved version — repin it in the file, save the file, then repin the file here"
                    >
                      {" "}
                      · v{s.latest_version_number} saved
                    </span>
                  )}
                </td>
                <td>{s.is_default ? <em>Default — every Platform</em> : s.platform_names.join(", ") || "—"}</td>
                <td className="num">{s.dwell_count}</td>
                <td className="num">{s.cycle_ms ? num(s.cycle_ms) : "—"}</td>
                <td className="num">{s.bandwidth_mhz != null ? num(s.bandwidth_mhz) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint-text mdf-dwell-others">
        {d.other_mdfs.length === 0 ? (
          "No other MDF uses this file."
        ) : (
          <>
            Also in{" "}
            {d.other_mdfs.map((m, i) => (
              <Fragment key={m.id}>
                {i > 0 && ", "}
                <Link to={`/mdfs/${m.id}?tab=dwells`}>{m.name}</Link> v{m.pinned_version_number}{" "}
                <StatusBadge type="mdf" status={m.status} />
              </Fragment>
            ))}
          </>
        )}
      </p>
    </section>
  );
}

/** The MDF's dwell files: each at the saved version it pins, with that
 * version's settings and Strategies, the Platforms it misses and the other
 * MDFs using it. */
export function MdfDwellsPanel({ mdfId, pinsFrozen, canEdit }: { mdfId: string; pinsFrozen: boolean; canEdit: boolean }) {
  const { data, isLoading, error } = useMdfDwells(mdfId);
  const { repinAll } = useMdfDwellMutations(mdfId);
  const [pinning, setPinning] = useState<string | null>(null); // a file id, or "" for a new one
  const [actionError, setActionError] = useState<string | null>(null);
  const dwells = data ?? [];
  const outdated = dwells.filter((d) => d.outdated).length;

  return (
    <div className="mdf-dwells-tab">
      <section className="card">
        <div className="card-header">
          <h4>
            Dwell files <span className="hint-text">{dwells.length}</span>
          </h4>
          {canEdit && (
            <div className="section-actions">
              {outdated > 0 && (
                <>
                  <span className="hint-text">
                    {outdated} file{outdated === 1 ? " has" : "s have"} a newer saved version.
                  </span>
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={repinAll.isPending}
                    onClick={() => void repinAll.mutateAsync()}
                  >
                    {repinAll.isPending ? "Repinning…" : "Repin all to their latest version"}
                  </button>
                </>
              )}
              <button type="button" className="button primary small" onClick={() => setPinning("")}>
                + Pin dwell file
              </button>
            </div>
          )}
        </div>
        <p className="hint-text">
          A dwell file can go into any number of MDFs; each pins a saved version, and its export carries that version.
        </p>
        {actionError && (
          <p className="error-text" role="alert">
            {actionError}
          </p>
        )}
        {isLoading ? (
          <LoadingState label="Loading dwell files…" />
        ) : error ? (
          <div className="error-text">{(error as Error).message}</div>
        ) : dwells.length === 0 ? (
          <EmptyState icon="◇" title="No dwell file pinned" message="Pin a saved dwell file version with + Pin dwell file." />
        ) : null}
      </section>
      {dwells.map((d) => (
        <DwellFileCard
          key={d.dwell_file_id}
          mdfId={mdfId}
          d={d}
          pinsFrozen={pinsFrozen}
          canEdit={canEdit}
          onPinOther={() => setPinning(d.dwell_file_id)}
          onError={setActionError}
        />
      ))}
      {pinning != null && (
        <PinDwellFile mdfId={mdfId} pinned={dwells} initialFileId={pinning} onClose={() => setPinning(null)} />
      )}
    </div>
  );
}
