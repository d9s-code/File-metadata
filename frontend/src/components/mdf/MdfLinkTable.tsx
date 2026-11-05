import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { formatDateTime } from "../common/dates";
import { isOutdatedMdfPin, type MdfLink } from "../../api/mdfs";
import type { Platform, PlatformCoverage } from "../../api/platforms";
import { StatusBadge } from "../status/StatusBadge";
import { usePinPlatform, useUnpinPlatform } from "../../state/hooks/useMdfs";
import { usePlatformVersions } from "../../state/hooks/usePlatformVersions";
import { RequireRole } from "../../auth/RequireAuth";
import { EmptyState } from "../common/EmptyState";
import { MenuButton } from "../common/MenuButton";
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
      v{version.version_label ?? version.version_number}
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
        title={`The Platform has a newer saved version (v${link.latest_version_label ?? link.latest_version_number}) than the one pinned here (v${link.pinned_version_label ?? link.pinned_version_number}).`}
      >
        Outdated — v{link.latest_version_label ?? link.latest_version_number} saved
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
            {pin.isPending ? "Repinning…" : `Repin to v${link.latest_version_label ?? link.latest_version_number}`}
          </button>
        </RequireRole>
      )}
    </>
  );
}

/** The Emitters a pinned Platform version pins, at their versions. */
function PinnedEmitters({ coverage, pinsFrozen }: { coverage: PlatformCoverage | undefined; pinsFrozen: boolean }) {
  if (!coverage) return <p className="hint-text">Loading its Emitters…</p>;
  if (coverage.emitters.length === 0) return <p className="hint-text">This Platform version pins no Emitter.</p>;
  return (
    <table className="data-table pinned-emitters">
      <thead>
        <tr>
          <th>Emitter</th>
          <th>Designation</th>
          <th>Pinned version</th>
          <th className="num">Modes</th>
          <th>Status now</th>
        </tr>
      </thead>
      <tbody>
        {coverage.emitters.map((e) => (
          <tr key={`${e.emitter_id}-${e.version_number}`}>
            <td>
              <Link to={`/emitters/${e.emitter_id}`}>{e.emitter_name}</Link>
            </td>
            <td>{e.designation ?? <span className="hint-text">—</span>}</td>
            <td className="nowrap">
              <Link to={`/emitters/${e.emitter_id}/versions?version=${e.version_number}`}>v{e.version_number}</Link>
              {!pinsFrozen && e.latest_version_number != null && e.latest_version_number > e.version_number && (
                <>
                  {" "}
                  <span
                    className="status-badge status-pending_review"
                    title="The Emitter has a newer saved version — repin it on the Platform, save the Platform, then repin the Platform here"
                  >
                    v{e.latest_version_number} saved
                  </span>
                </>
              )}
            </td>
            <td className="num">{e.modes.length}</td>
            <td>{e.status ? <StatusBadge type="emitter" status={e.status} /> : <span className="hint-text">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MdfLinkTable({
  mdfId,
  links,
  platformsById,
  pinsFrozen = false,
  coverage,
}: {
  mdfId: string;
  links: MdfLink[];
  platformsById: Record<string, Platform>;
  /** Released (or later): pins stay as released, so none is flagged outdated. */
  pinsFrozen?: boolean;
  /** What each pinned Platform version pins — shown when its row is opened. */
  coverage?: PlatformCoverage[];
}) {
  const unpin = useUnpinPlatform(mdfId);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOpen = links.length > 0 && links.every((l) => open.has(l.id));

  function compareLinks(a: MdfLink, b: MdfLink, key: MdfLinkSortKey, dir: "asc" | "desc"): number {
    switch (key) {
      case "platform":
        return compareStrings(platformsById[a.platform_id]?.name, platformsById[b.platform_id]?.name, dir);
      case "added":
        return compareStrings(a.added_at, b.added_at, dir);
    }
  }
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(links, compareLinks, "mdfPinnedPlatforms");

  if (links.length === 0) {
    return <EmptyState icon="○" title="No Platforms pinned yet" message="Pin a saved Platform version below." />;
  }

  return (
    <table className="data-table mdf-link-table">
      <thead>
        <tr>
          <th className="expand-col">
            <button
              type="button"
              className="link-button"
              aria-label={allOpen ? "Close every row" : "Open every row"}
              title={allOpen ? "Close every row" : "Show every Platform's Emitters"}
              onClick={() => setOpen(allOpen ? new Set() : new Set(links.map((l) => l.id)))}
            >
              {allOpen ? "▾" : "▸"}
            </button>
          </th>
          <SortableColumnHeader label="Platform" columnKey="platform" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
          <th>Pinned version</th>
          <th className="num">Emitters</th>
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
        {sorted.map((link) => {
          const cov = coverage?.find(
            (c) =>
              c.platform_id === link.platform_id &&
              (link.pinned_version_number == null || c.version_number === link.pinned_version_number),
          );
          const isOpen = open.has(link.id);
          return (
          <Fragment key={link.id}>
          <tr className={isOpen ? "row-open" : undefined}>
            <td className="expand-col">
              <button
                type="button"
                className="link-button"
                aria-expanded={isOpen}
                aria-label={`${isOpen ? "Hide" : "Show"} the Emitters ${platformsById[link.platform_id]?.name ?? "this Platform"} pins`}
                onClick={() => toggle(link.id)}
              >
                {isOpen ? "▾" : "▸"}
              </button>
            </td>
            <td>
              <Link to={`/platforms/${link.platform_id}`}>
                {platformsById[link.platform_id]?.name ?? link.platform_id}
              </Link>
            </td>
            <td>
              <PinnedVersionCell platformId={link.platform_id} versionId={link.platform_version_id} />
              {!pinsFrozen && <OutdatedPin mdfId={mdfId} link={link} />}
            </td>
            <td className="num">{cov ? cov.emitters.length : "—"}</td>
            <td>{formatDateTime(link.added_at)}</td>
            <td>
              <RequireRole minimum="editor">
                <MenuButton
                  label="⋯"
                  className="row-menu-button"
                  ariaLabel={`Actions for ${platformsById[link.platform_id]?.name ?? "this Platform"}`}
                  items={[{ label: "Unpin", danger: true, onSelect: () => void unpin.mutateAsync(link.platform_id) }]}
                />
              </RequireRole>
            </td>
          </tr>
          {isOpen && (
            <tr className="row-detail">
              <td />
              <td colSpan={5}>
                <PinnedEmitters coverage={cov} pinsFrozen={pinsFrozen} />
              </td>
            </tr>
          )}
          </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
