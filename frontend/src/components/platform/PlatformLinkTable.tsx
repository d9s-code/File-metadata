import { Link } from "react-router-dom";
import { isOutdatedPin, type PlatformLink } from "../../api/platforms";
import type { Emitter } from "../../types/domain";
import { usePinEmitter, useUnpinEmitter } from "../../state/hooks/usePlatforms";
import { useEmitterVersions } from "../../state/hooks/useEmitterVersions";
import { RequireRole } from "../../auth/RequireAuth";
import { EmptyState } from "../common/EmptyState";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareStrings } from "../common/sortUtils";

type PlatformLinkSortKey = "designation" | "emitter" | "added";

function PinnedVersionCell({ emitterId, versionId }: { emitterId: string; versionId: string }) {
  const { data: versions } = useEmitterVersions(emitterId);
  const version = versions?.find((v) => v.id === versionId);
  if (!version) return <span title={versionId}>{versionId.slice(0, 8)}…</span>;
  return (
    <Link to={`/emitters/${emitterId}/versions?version=${version.version_number}`}>
      v{version.version_number}
    </Link>
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
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(links, compareLinks);

  if (links.length === 0) {
    return <EmptyState icon="○" title="No Emitters pinned yet" message="Pin a saved Emitter version below." />;
  }

  return (
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
              <PinnedVersionCell emitterId={link.emitter_id} versionId={link.emitter_version_id} />
              <OutdatedPin platformId={platformId} link={link} />
            </td>
            <td>{new Date(link.added_at).toLocaleString()}</td>
            <td>
              <RequireRole minimum="editor">
                <button className="link-button" onClick={() => void unpin.mutateAsync(link.emitter_id)}>
                  Unpin
                </button>
              </RequireRole>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
