import { Link } from "react-router-dom";
import { formatDateTime } from "../common/dates";
import { isOutdatedMdfPin, type MdfLink } from "../../api/mdfs";
import type { Platform } from "../../api/platforms";
import { usePinPlatform, useUnpinPlatform } from "../../state/hooks/useMdfs";
import { usePlatformVersions } from "../../state/hooks/usePlatformVersions";
import { RequireRole } from "../../auth/RequireAuth";
import { EmptyState } from "../common/EmptyState";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareStrings } from "../common/sortUtils";

type MdfLinkSortKey = "platform" | "added";

function PinnedVersionCell({ platformId, versionId }: { platformId: string; versionId: string }) {
  const { data: versions } = usePlatformVersions(platformId);
  const version = versions?.find((v) => v.id === versionId);
  if (!version) return <span title={versionId}>{versionId.slice(0, 8)}…</span>;
  return (
    <Link to={`/platforms/${platformId}/versions?version=${version.version_number}`}>
      v{version.version_number}
    </Link>
  );
}

/** "Outdated — v4 saved" with a one-click repin to the newest saved version. */
function OutdatedPin({ mdfId, link }: { mdfId: string; link: MdfLink }) {
  const pin = usePinPlatform(mdfId);
  if (!isOutdatedMdfPin(link)) return null;
  return (
    <>
      {" "}
      <span
        className="status-badge status-pending_review"
        title={`The Platform has a newer saved version (v${link.latest_version_number}) than the one pinned here (v${link.pinned_version_number}).`}
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
              void pin.mutateAsync({ platformId: link.platform_id, platformVersionId: link.latest_version_id! })
            }
          >
            {pin.isPending ? "Repinning…" : `Repin to v${link.latest_version_number}`}
          </button>
        </RequireRole>
      )}
    </>
  );
}

export function MdfLinkTable({
  mdfId,
  links,
  platformsById,
}: {
  mdfId: string;
  links: MdfLink[];
  platformsById: Record<string, Platform>;
}) {
  const unpin = useUnpinPlatform(mdfId);

  function compareLinks(a: MdfLink, b: MdfLink, key: MdfLinkSortKey, dir: "asc" | "desc"): number {
    switch (key) {
      case "platform":
        return compareStrings(platformsById[a.platform_id]?.name, platformsById[b.platform_id]?.name, dir);
      case "added":
        return compareStrings(a.added_at, b.added_at, dir);
    }
  }
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(links, compareLinks);

  if (links.length === 0) {
    return <EmptyState icon="○" title="No Platforms pinned yet" message="Pin a saved Platform version below." />;
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <SortableColumnHeader label="Platform" columnKey="platform" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
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
            <td>
              <Link to={`/platforms/${link.platform_id}`}>
                {platformsById[link.platform_id]?.name ?? link.platform_id}
              </Link>
            </td>
            <td>
              <PinnedVersionCell platformId={link.platform_id} versionId={link.platform_version_id} />
              <OutdatedPin mdfId={mdfId} link={link} />
            </td>
            <td>{formatDateTime(link.added_at)}</td>
            <td>
              <RequireRole minimum="editor">
                <button className="link-button" onClick={() => void unpin.mutateAsync(link.platform_id)}>
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
