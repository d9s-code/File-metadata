import { Link, useParams } from "react-router-dom";
import { usePlatform, usePlatformLinks } from "../state/hooks/usePlatforms";
import { useEmitters } from "../state/hooks/useEmitters";
import { PlatformLinkTable } from "../components/platform/PlatformLinkTable";
import { PlatformEmitterVersionPicker } from "../components/platform/PlatformEmitterVersionPicker";
import { RequireRole } from "../auth/RequireAuth";

export function PlatformBuilderPage() {
  const { platformId } = useParams<{ platformId: string }>();
  const { data: platform, isLoading } = usePlatform(platformId);
  const { data: links } = usePlatformLinks(platformId ?? "");
  const { data: emitters } = useEmitters();

  if (isLoading || !platform) return <p>Loading…</p>;

  const emittersById = Object.fromEntries((emitters ?? []).map((e) => [e.id, e]));

  return (
    <div className="page">
      <h1>{platform.name}</h1>
      {platform.description && <p className="muted">{platform.description}</p>}
      <Link to={`/platforms/${platform.id}/versions`}>Version history</Link>{" "}
      <Link to={`/ambiguity/platform/${platform.id}`}>Ambiguity check</Link>

      <h4>Pinned Emitters</h4>
      <PlatformLinkTable platformId={platform.id} links={links ?? []} emittersById={emittersById} />

      <RequireRole minimum="editor">
        <h4>Pin an Emitter Version</h4>
        <p className="hint-text">
          Pinning requires a committed version of the emitter — commit one from the emitter's Version
          History page first if it only has uncommitted draft changes.
        </p>
        <PlatformEmitterVersionPicker platformId={platform.id} />
      </RequireRole>
    </div>
  );
}
