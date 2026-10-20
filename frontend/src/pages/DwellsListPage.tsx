import { Fragment, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/common/PageHeader";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { Modal } from "../components/common/Modal";
import { formatDate } from "../components/common/dates";
import { num } from "../components/dwells/DwellChart";
import { ApiRequestError } from "../api/client";
import { dwellsApi, type DwellStrategySummary } from "../api/dwells";
import { useDwellFiles, useDwellStrategies, useRefreshDwellLists } from "../state/hooks/useDwells";
import { useMdfs } from "../state/hooks/useMdfs";
import { usePlatforms } from "../state/hooks/usePlatforms";
import { PlatformsPicker } from "../components/dwells/PlatformsPicker";
import { useSessionState } from "../components/common/useSessionState";

/** Names shown in a cell before the rest fold into "+N". */
const SHOWN = 2;

/** Dwells: the Strategies (default dwells, then grouped by the Platforms
 * they cover) and the dwell files that pin them. */
export function DwellsListPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "files" ? "files" : "strategies";
  const [making, setMaking] = useState<"strategy" | "file" | "import" | null>(null);

  return (
    <div className="page">
      <PageHeader
        title="Dwells"
        info="A Strategy is a set of dwells — frequency and how long to sit there, in order — for one or more Platforms, or none (a default dwell), saved in versions. A dwell file pins saved versions of any Strategies; linked to an MDF, its latest saved version goes into that MDF's export as dwells/<name>.xml."
      >
        <RequireRole minimum="editor">
          {view === "strategies" ? (
            <button type="button" className="button primary" onClick={() => setMaking("strategy")}>
              + New Strategy
            </button>
          ) : (
            <>
              <button type="button" className="button secondary" onClick={() => setMaking("import")}>
                Import XML
              </button>
              <button type="button" className="button primary" onClick={() => setMaking("file")}>
                + New dwell file
              </button>
            </>
          )}
        </RequireRole>
      </PageHeader>
      <div className="tab-bar">
        <button className={view === "strategies" ? "tab active" : "tab"} onClick={() => setParams({}, { replace: true })}>
          Strategies
        </button>
        <button
          className={view === "files" ? "tab active" : "tab"}
          onClick={() => setParams({ view: "files" }, { replace: true })}
        >
          Dwell files
        </button>
      </div>
      {view === "strategies" ? <StrategyList onNew={() => setMaking("strategy")} /> : <FileList />}
      {making === "strategy" && <NewStrategy onClose={() => setMaking(null)} />}
      {(making === "file" || making === "import") && (
        <NewDwellFile importing={making === "import"} onClose={() => setMaking(null)} />
      )}
    </div>
  );
}

function StrategyList({ onNew }: { onNew: () => void }) {
  const { data: strategies, isLoading } = useDwellStrategies();
  const [filter, setFilter] = useSessionState("dwells.filter", "");
  if (isLoading) return <LoadingState label="Loading Strategies…" />;
  if (!strategies?.length)
    return (
      <EmptyState
        icon="◇"
        title="No Strategies yet"
        message="Make one for a Platform, or import a dwell file's XML under Dwell files."
        action={
          <RequireRole minimum="editor">
            <button type="button" className="button primary" onClick={onNew}>
              + New Strategy
            </button>
          </RequireRole>
        }
      />
    );

  const needle = filter.trim().toLowerCase();
  const shown = strategies.filter(
    (s) =>
      !needle ||
      [s.name, ...s.platform_names, s.is_default ? "default dwell" : "", s.description ?? ""].some((text) =>
        text.toLowerCase().includes(needle),
      ),
  );
  // Default dwells first (the list comes in that order), then by the Platforms covered.
  const groups = new Map<string, DwellStrategySummary[]>();
  for (const s of shown) {
    const key = s.is_default ? "" : s.platform_ids.join(",");
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  return (
    <>
      <div className="dwell-toolbar">
        <input
          type="search"
          className="dwell-filter"
          placeholder="Filter by Strategy, Platform or description"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="hint-text">
          {shown.length} of {strategies.length}
        </span>
      </div>
      <table className="data-table dwell-strategy-list">
        <thead>
          <tr>
            <th>Strategy</th>
            <th className="num">Dwells</th>
            <th>Range (MHz)</th>
            <th className="num">Cycle (ms)</th>
            <th>Version</th>
            <th>In files</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([key, items]) => (
            <Fragment key={key || "default"}>
              <tr className="dwell-group-row">
                <th colSpan={7}>
                  {key ? (
                    items[0].platform_ids.map((id, i) => (
                      <span key={id}>
                        {i > 0 && " + "}
                        <Link to={`/platforms/${id}`}>{items[0].platform_names[i]}</Link>
                      </span>
                    ))
                  ) : (
                    <span title="Not tied to any Platform — typically larger plans">Default dwells</span>
                  )}
                  <span className="hint-text">
                    {" "}
                    · {items.length} Strateg{items.length === 1 ? "y" : "ies"}
                  </span>
                </th>
              </tr>
              {items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/dwells/strategies/${s.id}`}>{s.name}</Link>
                    {s.description && <div className="dwell-desc">{s.description}</div>}
                  </td>
                  <td className="num">{s.dwell_count}</td>
                  <td className="nowrap">
                    {s.lowest_mhz != null && s.highest_mhz != null ? `${num(s.lowest_mhz)}–${num(s.highest_mhz)}` : "—"}
                  </td>
                  <td className="num">{s.cycle_ms ? num(s.cycle_ms) : "—"}</td>
                  <td className="nowrap">
                    {s.latest_version_number ? `v${s.latest_version_number}` : <span className="hint-text">none</span>}
                    {s.unsaved && s.latest_version_number != null && (
                      <span className="dwell-dot" title={`Changed since v${s.latest_version_number}`} aria-label="changed" />
                    )}
                  </td>
                  <td title={s.used_in.join("\n")}>
                    {s.used_in.slice(0, SHOWN).join(", ") || <span className="hint-text">—</span>}
                    {s.used_in.length > SHOWN && <span className="hint-text"> +{s.used_in.length - SHOWN}</span>}
                  </td>
                  <td className="nowrap">{formatDate(s.updated_at)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={7} className="hint-text">
                Nothing matches &quot;{filter}&quot;.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

function FileList() {
  const { data: files, isLoading } = useDwellFiles();
  if (isLoading) return <LoadingState label="Loading dwell files…" />;
  if (!files?.length)
    return <EmptyState icon="◇" title="No dwell files yet" message="Make one and add Strategies, or import a dwell file's XML." />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>MDF</th>
          <th>Platforms</th>
          <th>Version</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {files.map((f) => (
          <tr key={f.id}>
            <td>
              <Link to={`/dwells/files/${f.id}`}>{f.name}</Link>
            </td>
            <td>{f.mdf_id ? <Link to={`/mdfs/${f.mdf_id}`}>{f.mdf_name}</Link> : <span className="hint-text">—</span>}</td>
            <td title={f.platform_names.join("\n")}>
              {f.platform_names.slice(0, 3).join(", ") || <span className="hint-text">none yet</span>}
              {f.platform_names.length > 3 && <span className="hint-text"> +{f.platform_names.length - 3}</span>}
              {f.strategy_count > f.platform_names.length && (
                <span className="hint-text"> · {f.strategy_count - f.platform_names.length} without a Platform</span>
              )}
            </td>
            <td className="nowrap">
              {f.latest_version_number ? `v${f.latest_version_number}` : <span className="hint-text">none</span>}
              {f.unsaved && f.latest_version_number != null && (
                <span className="dwell-dot" title={`Changed since v${f.latest_version_number}`} aria-label="changed" />
              )}
              {f.outdated_count > 0 && (
                <span className="status-badge status-pending_review" title="Pinned Strategies with a newer saved version">
                  {f.outdated_count} outdated
                </span>
              )}
            </td>
            <td className="nowrap">{formatDate(f.updated_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A new Strategy — for some Platforms, or none (a default dwell): empty, or
 * starting from another's dwells. */
export function NewStrategy({ onClose, platformId: initialPlatform = "" }: { onClose: () => void; platformId?: string }) {
  const navigate = useNavigate();
  const refresh = useRefreshDwellLists();
  const { data: platforms } = usePlatforms();
  const { data: strategies } = useDwellStrategies();
  const [name, setName] = useState("");
  const [platformIds, setPlatformIds] = useState<string[]>(initialPlatform ? [initialPlatform] : []);
  const [copyFrom, setCopyFrom] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the Strategy a name.");
    setSaving(true);
    try {
      const made = await dwellsApi.createStrategy({
        name: name.trim(),
        platform_ids: platformIds,
        description: description.trim() || null,
        copy_from_id: copyFrom || null,
      });
      refresh();
      navigate(`/dwells/strategies/${made.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't make the Strategy.");
      setSaving(false);
    }
  }

  return (
    <Modal title="New Strategy" onClose={onClose}>
      <form className="rename-form" onSubmit={submit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="e.g. Summer" autoFocus />
        </label>
        <PlatformsPicker value={platformIds} onChange={setPlatformIds} platforms={platforms ?? []} />
        <label>
          Description (optional)
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            placeholder="e.g. Coastal patrol, summer"
          />
        </label>
        <label>
          Start from (optional)
          <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">Empty — no dwells yet</option>
            {(strategies ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.is_default ? "Default · " : `${s.platform_names.join(", ")} · `}
                {s.name} ({s.dwell_count} dwell{s.dwell_count === 1 ? "" : "s"})
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? "Making…" : platformIds.length === 0 ? "Create default dwell" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A new dwell file: empty, or from a dwell file's XML. */
function NewDwellFile({ importing, onClose }: { importing: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const refresh = useRefreshDwellLists();
  const { data: mdfs } = useMdfs();
  const [name, setName] = useState("");
  const [mdfId, setMdfId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (importing && !file) return setError("Pick the XML file.");
    if (!importing && !name.trim()) return setError("Give the dwell file a name.");
    setSaving(true);
    try {
      const made = importing
        ? await dwellsApi.importFile(file as File, name.trim() || undefined, mdfId || null)
        : await dwellsApi.createFile({ name: name.trim(), mdf_id: mdfId || null });
      refresh();
      navigate(`/dwells/files/${made.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't make the dwell file.");
      setSaving(false);
    }
  }

  return (
    <Modal title={importing ? "Import a dwell file" : "New dwell file"} onClose={onClose}>
      <form className="rename-form" onSubmit={handleSubmit}>
        {importing && (
          <label>
            Dwell file (XML)
            <input type="file" accept=".xml,application/xml,text/xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        )}
        <label>
          Name{importing ? " (blank: the file's name)" : ""}
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!importing} />
        </label>
        <label>
          For the MDF (optional)
          <select value={mdfId} onChange={(e) => setMdfId(e.target.value)}>
            <option value="">None yet</option>
            {(mdfs ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {importing && (
          <p className="hint-text">
            Each Strategy in the file becomes a Strategy of its own, pinned into the new file. The file doesn&apos;t say
            which Platform each is for — pick that on each Strategy afterwards.
          </p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? "Working…" : importing ? "Import" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
