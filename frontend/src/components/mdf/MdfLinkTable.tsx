import type { MdfLink } from "../../api/mdfs";
import type { Platform } from "../../api/platforms";
import { useUnpinPlatform } from "../../state/hooks/useMdfs";
import { RequireRole } from "../../auth/RequireAuth";

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

  if (links.length === 0) return <p className="hint-text">No platforms pinned yet.</p>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Platform</th>
          <th>Pinned Version</th>
          <th>Added</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {links.map((link) => (
          <tr key={link.id}>
            <td>{platformsById[link.platform_id]?.name ?? link.platform_id}</td>
            <td title={link.platform_version_id}>{link.platform_version_id.slice(0, 8)}…</td>
            <td>{new Date(link.added_at).toLocaleString()}</td>
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
