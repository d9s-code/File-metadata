import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMdf, useMdfLinks } from "../state/hooks/useMdfs";
import { usePlatforms } from "../state/hooks/usePlatforms";
import { MdfLinkTable } from "../components/mdf/MdfLinkTable";
import { PlatformVersionPicker } from "../components/mdf/PlatformVersionPicker";
import { MdfStatusTransitionControls } from "../components/mdf/MdfStatusTransitionControls";
import { MdfTestHistory } from "../components/testing/MdfTestHistory";
import { RequireRole } from "../auth/RequireAuth";

type Tab = "platforms" | "tests";

export function MdfBuilderPage() {
  const { mdfId } = useParams<{ mdfId: string }>();
  const [tab, setTab] = useState<Tab>("platforms");
  const { data: mdf, isLoading } = useMdf(mdfId);
  const { data: links } = useMdfLinks(mdfId ?? "");
  const { data: platforms } = usePlatforms();

  if (isLoading || !mdf) return <p>Loading…</p>;

  const platformsById = Object.fromEntries((platforms ?? []).map((p) => [p.id, p]));

  return (
    <div className="page">
      <h1>{mdf.name}</h1>
      <div className="status-row">
        <span className={`status-badge status-${mdf.status}`}>{mdf.status.replace("_", " ")}</span>
        <MdfStatusTransitionControls mdfId={mdf.id} status={mdf.status} />
        <Link to={`/mdfs/${mdf.id}/versions`}>Version history</Link>
      </div>
      {mdf.description && <p className="muted">{mdf.description}</p>}

      <div className="tab-bar">
        <button className={tab === "platforms" ? "tab active" : "tab"} onClick={() => setTab("platforms")}>
          Pinned Platforms
        </button>
        <button className={tab === "tests" ? "tab active" : "tab"} onClick={() => setTab("tests")}>
          Test History
        </button>
      </div>

      {tab === "platforms" && (
        <div>
          <MdfLinkTable mdfId={mdf.id} links={links ?? []} platformsById={platformsById} />
          <RequireRole minimum="editor">
            <h4>Pin a Platform Version</h4>
            <p className="hint-text">
              Pinning requires a committed version of the platform (and each emitter it references).
            </p>
            <PlatformVersionPicker mdfId={mdf.id} />
          </RequireRole>
        </div>
      )}

      {tab === "tests" && <MdfTestHistory mdfId={mdf.id} />}
    </div>
  );
}
