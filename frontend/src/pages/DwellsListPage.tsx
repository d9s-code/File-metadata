import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { MDFS_SECTION, PageHeader } from "../components/common/PageHeader";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { Modal } from "../components/common/Modal";
import { formatDateTime } from "../components/common/dates";
import { ApiRequestError } from "../api/client";
import { dwellsApi } from "../api/dwells";
import { dwellsKey, useDwellFiles } from "../state/hooks/useDwells";
import { useMdfs } from "../state/hooks/useMdfs";

/** Names shown in a cell before the rest fold into "+N". */
const SHOWN = 3;

/** Every dwell file: which MDF it's for, the Platforms its Strategies are
 * for, and how many dwells — with a new one, or one imported from XML. */
export function DwellsListPage() {
  const { data: files, isLoading } = useDwellFiles();
  const [making, setMaking] = useState<"new" | "import" | null>(null);

  return (
    <div className="page">
      <PageHeader
        title="Dwells"
        section={MDFS_SECTION}
        info="Dwell files: one Dwell Strategy per Platform, each with its Merged Mode dwells. A file linked to an MDF goes into that MDF's export as dwells/<name>.xml."
      >
        <RequireRole minimum="editor">
          <button type="button" className="button secondary" onClick={() => setMaking("import")}>
            Import XML
          </button>
          <button type="button" className="button primary" onClick={() => setMaking("new")}>
            + New dwell file
          </button>
        </RequireRole>
      </PageHeader>
      {isLoading ? (
        <LoadingState label="Loading dwell files…" />
      ) : !files?.length ? (
        <EmptyState icon="◇" title="No dwell files yet" message="Make one, or import a dwell file's XML." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>MDF</th>
              <th>Platforms</th>
              <th>Strategies</th>
              <th>Dwells</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td>
                  <Link to={`/dwells/${f.id}`}>{f.name}</Link>
                </td>
                <td>{f.mdf_id ? <Link to={`/mdfs/${f.mdf_id}`}>{f.mdf_name}</Link> : <span className="hint-text">—</span>}</td>
                <td title={f.platform_names.join("\n")}>
                  {f.platform_names.slice(0, SHOWN).join(", ") || <span className="hint-text">none picked</span>}
                  {f.platform_names.length > SHOWN && <span className="hint-text"> +{f.platform_names.length - SHOWN}</span>}
                </td>
                <td>{f.strategy_count}</td>
                <td>{f.dwell_count}</td>
                <td className="nowrap">{formatDateTime(f.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {making && <NewDwellFile importing={making === "import"} onClose={() => setMaking(null)} />}
    </div>
  );
}

/** A new dwell file: empty, or from a dwell file's XML. */
function NewDwellFile({ importing, onClose }: { importing: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
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
        ? await dwellsApi.importXml(file as File, name.trim() || undefined, mdfId || null)
        : await dwellsApi.create({ name: name.trim(), mdf_id: mdfId || null });
      qc.invalidateQueries({ queryKey: dwellsKey });
      navigate(`/dwells/${made.id}`);
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
            The file doesn&apos;t say which Platform each Strategy is for — pick them after importing.
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
