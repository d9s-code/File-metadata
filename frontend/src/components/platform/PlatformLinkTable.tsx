import type { PlatformLink } from "../../api/platforms";
import type { Emitter } from "../../types/domain";
import { useUnpinEmitter } from "../../state/hooks/usePlatforms";
import { RequireRole } from "../../auth/RequireAuth";

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

  if (links.length === 0) return <p className="hint-text">No emitters pinned yet.</p>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Emitter</th>
          <th>Pinned Version</th>
          <th>Added</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {links.map((link) => (
          <tr key={link.id}>
            <td>{emittersById[link.emitter_id]?.name ?? link.emitter_id}</td>
            <td title={link.emitter_version_id}>{link.emitter_version_id.slice(0, 8)}…</td>
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
