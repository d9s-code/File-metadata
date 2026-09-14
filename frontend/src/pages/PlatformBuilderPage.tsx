import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePlatform, usePlatformLinks } from "../state/hooks/usePlatforms";
import { useCommitPlatformVersion } from "../state/hooks/usePlatformVersions";
import { useEmitters } from "../state/hooks/useEmitters";
import { platformsApi } from "../api/platforms";
import { PlatformLinkTable } from "../components/platform/PlatformLinkTable";
import { PlatformEmitterVersionPicker } from "../components/platform/PlatformEmitterVersionPicker";
import { EntityAuditTrail } from "../components/audit/EntityAuditTrail";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";

type Tab = "emitters" | "audit";

export function PlatformBuilderPage() {
  const { platformId } = useParams<{ platformId: string }>();
  const [tab, setTab] = useState<Tab>("emitters");
  const [commitSummary, setCommitSummary] = useState("");
  const { data: platform, isLoading } = usePlatform(platformId);
  const { data: links } = usePlatformLinks(platformId ?? "");
  const { data: emitters } = useEmitters();
  const commitVersion = useCommitPlatformVersion(platformId ?? "");
  const [isExporting, setIsExporting] = useState(false);

  if (isLoading || !platform) return <LoadingState label="Loading platform…" />;

  const emittersById = Object.fromEntries((emitters ?? []).map((e) => [e.id, e]));

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{platform.name}</h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <RequireRole minimum="editor">
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Commit summary..."
                value={commitSummary}
                onChange={(e) => setCommitSummary(e.target.value)}
                style={{ padding: '0.25rem', fontSize: '0.875rem' }}
              />
              <button
                className="button primary small"
                onClick={() => {
                  commitVersion.mutate(commitSummary, {
                    onSuccess: () => setCommitSummary(""),
                  });
                }}
                disabled={commitVersion.isPending || !commitSummary.trim()}
              >
                {commitVersion.isPending ? "Committing..." : "Commit Version"}
              </button>
            </div>
          </RequireRole>
          <Link to={`/platforms/${platform.id}/versions`}>Version history</Link>
          <Link to={`/ambiguity/platform/${platform.id}`}>Ambiguity check</Link>
              <button
                className="button secondary small"
                onClick={async () => {
                  try {
                    setIsExporting(true);
                    const blob = await platformsApi.exportXml(platform.id);
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${platform.name}_xml_export.zip`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    a.remove();
                  } catch (error) {
                    console.error("Export failed", error);
                    alert("Failed to export XML package.");
                  } finally {
                    setIsExporting(false);
                  }
                }}
                disabled={isExporting}
              >
                {isExporting ? "Exporting..." : "Export XML"}
              </button>
        </div>
      </div>

      <div className="tab-bar">
        <button className={tab === "emitters" ? "tab active" : "tab"} onClick={() => setTab("emitters")}>
          Pinned Emitters
        </button>
        <button className={tab === "audit" ? "tab active" : "tab"} onClick={() => setTab("audit")}>
          Audit
        </button>
      </div>

      {tab === "emitters" && (
        <div>
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
      )}

      {tab === "audit" && <EntityAuditTrail entityType="platform" entityId={platform.id} />}
    </div>
  );
}
