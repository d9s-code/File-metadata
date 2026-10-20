import { Link } from "react-router-dom";
import { formatDateTime } from "../common/dates";
import { isOutdatedPin, type PlatformLink } from "../../api/platforms";
import type { Emitter } from "../../types/domain";
import { usePinEmitter, useUnpinEmitter } from "../../state/hooks/usePlatforms";
import { useEmitterVersions } from "../../state/hooks/useEmitterVersions";
import { RequireRole, useHasRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { EmptyState } from "../common/EmptyState";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareStrings } from "../common/sortUtils";

type PlatformLinkSortKey = "designation" | "emitter" | "added";

/** The pinned version — for editors, a picker of the Emitter's saved
 * versions (newest first) that repins on change. */
function PinnedVersionCell({ platformId, link }: { platformId: string; link: PlatformLink }) {
  const canEdit = useHasRole("editor");
  const { data: versions } = useEmitterVersions(canEdit ? link.emitter_id : "");
  const pin = usePinEmitter(platformId);
  const number = link.pinned_version_number;
  const view = number != null && (
    <Link to={`/emitters/${link.emitter_id}/versions?version=${number}`} title="See this version">
      {canEdit ? "view" : `v${number}`}
    </Link>
  );
  if (!canEdit || !versions) return <>{view || "—"}</>;
  const newestFirst = [...versions].sort((a, b) => b.version_number - a.version_number);
  return (
    <span className="pinned-version">
      <select
        value={link.emitter_version_id}
        disabled={pin.isPending}
        aria-label="Pinned version"
        onChange={(e) => void pin.mutateAsync({ emitterId: link.emitter_id, emitterVersionId: e.target.value })}
      >
        {newestFirst.map((v, i) => (
          <option key={v.id} value={v.id}>
            v{v.version_number}
            {i === 0 ? " (latest)" : ""}
            {v.change_summary ? ` — ${v.change_summary.slice(0, 40)}` : ""}
          </option>
        ))}
      </select>{" "}
      {view}
    </span>
  );
}

/** "Outdated — v5 saved" with a one-click repin to the newest saved version. */
function OutdatedPin({ platformId, link }: { platformId: string; link: PlatformLink }) {
  const pin = usePinEmitter(platformId);
  if (!isOutdatedPin(link)) return null;
  return (
    <>
      {" "}
      <span
        className="status-badge status-pending_review"
        title={`The Emitter has a newer saved version (v${link.latest_version_number}) than the one pinned here (v${link.pinned_version_number}).`}
      >
        Outdated — v{link.latest_version_number} saved
      </span>
      {link.latest_version_id && (
        <RequireRole minimum="editor">
          {" "}
          <button
            className="link-button"
            disabled={pin.isPending}
            onClick={() =>
              void pin.mutateAsync({ emitterId: link.emitter_id, emitterVersionId: link.latest_version_id! })
            }
          >
            {pin.isPending ? "Repinning…" : `Repin to v${link.latest_version_number}`}
          </button>
        </RequireRole>
      )}
    </>
  );
}

export function PlatformLinkTable({
  platformId,
  links,
  emittersById,
}: {
  platformId: string;
  links: PlatformLink[];
  emittersById: Record<string, Emitter>;
}) {
  const unpin = useUnpinEmitter(platformId);
  const { confirmDelete, dialog } = useConfirmDialog();

  async function handleUnpin(link: PlatformLink) {
    const name = emittersById[link.emitter_id]?.name ?? "this Emitter";
    if (await confirmDelete(`Unpin ${name} from this Platform?`, { confirmLabel: "Unpin", danger: true }))
      await unpin.mutateAsync(link.emitter_id);
  }

  function compareLinks(a: PlatformLink, b: PlatformLink, key: PlatformLinkSortKey, dir: "asc" | "desc"): number {
    switch (key) {
      case "emitter":
        return compareStrings(emittersById[a.emitter_id]?.name, emittersById[b.emitter_id]?.name, dir);
      case "designation":
        return compareStrings(emittersById[a.emitter_id]?.designation, emittersById[b.emitter_id]?.designation, dir);
      case "added":
        return compareStrings(a.added_at, b.added_at, dir);
    }
  }
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(links, compareLinks, "platformPinnedEmitters");

  if (links.length === 0) {
    return <EmptyState icon="○" title="No Emitters pinned yet" message="Use + Pin Emitters to add them." />;
  }

  return (
    <>
    {dialog}
    <table className="data-table">
      <thead>
        <tr>
          <SortableColumnHeader label="Designation" columnKey="designation" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
          <SortableColumnHeader label="Emitter" columnKey="emitter" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
          <th>Pinned Version</th>
          <SortableColumnHeader
            label="Added"
            columnKey="added"
            columnType="date"
            activeKey={sortKey}
            activeDir={sortDir}
            onSort={onSort}
            onClear={onClear}
          />
          <th></th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((link) => (
          <tr key={link.id}>
            <td>{emittersById[link.emitter_id]?.designation ?? "—"}</td>
            <td>
              <Link to={`/emitters/${link.emitter_id}`}>
                {emittersById[link.emitter_id]?.name ?? link.emitter_id}
              </Link>
            </td>
            <td>
              <PinnedVersionCell platformId={platformId} link={link} />
              <OutdatedPin platformId={platformId} link={link} />
            </td>
            <td>{formatDateTime(link.added_at)}</td>
            <td>
              <RequireRole minimum="editor">
                <button className="link-button" onClick={() => void handleUnpin(link)}>
                  Unpin
                </button>
              </RequireRole>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}
