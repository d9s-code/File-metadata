import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { VersionList } from "../components/versioning/VersionList";
import { VersionPanel } from "../components/versioning/VersionPanel";
import { SaveVersionButton } from "../components/versioning/SaveVersionButton";
import { LoadingState } from "../components/common/LoadingState";
import { DwellChart } from "../components/dwells/DwellChart";
import { dwellsApi, type Dwell, type DwellKind } from "../api/dwells";
import {
  useAppSettings,
  useCommitDwellVersion,
  useDwellFile,
  useDwellStrategy,
  useDwellVersion,
  useDwellVersionDiff,
  useDwellVersions,
} from "../state/hooks/useDwells";
import { saveBlob, xmlName } from "./DwellFilePage";

/** A Strategy's or a dwell file's saved versions: what each changed, and
 * (a Strategy's) its dwells as they were, or (a file's) its XML. */
export function DwellVersionHistoryPage({ kind }: { kind: DwellKind }) {
  const { id = "" } = useParams<{ id: string }>();
  const { data: strategy } = useDwellStrategy(kind === "strategies" ? id : "");
  const { data: file } = useDwellFile(kind === "files" ? id : "");
  const subject = kind === "strategies" ? strategy : file;
  const { data: versions } = useDwellVersions(kind, id);
  const commit = useCommitDwellVersion(kind, id);
  const { data: settings } = useAppSettings();
  const [searchParams] = useSearchParams();
  const initialVersion = Number(searchParams.get("version"));
  const [selected, setSelected] = useState<number | null>(initialVersion > 0 ? initialVersion : null);
  const [against, setAgainst] = useState<number | null>(null);
  const { data: diff, isLoading: diffLoading } = useDwellVersionDiff(kind, id, selected ?? 0, against ?? undefined);
  const { data: detail } = useDwellVersion(kind, id, kind === "strategies" ? selected : null);

  const latest = versions?.length ? Math.max(...versions.map((v) => v.version_number)) : null;
  useEffect(() => {
    if (selected == null && latest != null) setSelected(latest);
  }, [selected, latest]);

  if (!subject) return <LoadingState label="Loading version history…" />;
  const back = kind === "strategies" ? `/dwells/strategies/${id}` : `/dwells/files/${id}`;
  const snapshotDwells = (detail?.snapshot?.dwells as Dwell[] | undefined) ?? [];

  return (
    <div className="page">
      <Link to={back}>← Back to {subject.name}</Link>
      <div className="emitter-title-row">
        <h1>{subject.name} — Version History</h1>
        <div className="emitter-actions">
          <SaveVersionButton
            noun={kind === "strategies" ? "Strategy" : "dwell file"}
            save={(summary) => commit.mutateAsync(summary)}
            pending={commit.isPending}
          />
        </div>
      </div>

      <div className="version-history-layout">
        <div className="card">
          <h4>Versions</h4>
          <VersionList
            versions={versions ?? []}
            selected={selected}
            onSelect={(n) => {
              setSelected(n);
              setAgainst(null);
            }}
          />
        </div>
        {selected != null && (
          <div className="dwell-version-main">
            <VersionPanel
              versions={versions ?? []}
              selected={selected}
              against={against}
              onAgainst={setAgainst}
              diff={diff && { entries: diff.entries ?? [], identical: diff.identical }}
              loading={diffLoading}
              actions={
                kind === "files" ? (
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() =>
                      void dwellsApi
                        .xml(id, selected)
                        .then((blob) => saveBlob(blob, xmlName(`${subject.name}_v${selected}`)))
                    }
                  >
                    Download this version&apos;s XML
                  </button>
                ) : undefined
              }
            />
            {kind === "strategies" && detail && (
              <DwellChart
                dwells={snapshotDwells}
                bandwidthMhz={strategy?.bandwidth_mhz ?? settings?.dwell_bandwidth_mhz ?? 10}
                title={`Dwells in v${selected}`}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
