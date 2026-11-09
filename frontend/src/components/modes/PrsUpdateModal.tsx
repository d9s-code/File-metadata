import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "../common/Modal";
import { ApiRequestError } from "../../api/client";
import { prsUpdateApi, type PrsImportIssue, type PrsUpdatePreview, type PrsUpdateResult } from "../../api/prsImport";
import { emitterModesKey, invalidateSimResults } from "../../state/hooks/useModes";
import { emitterVersionsKey } from "../../state/hooks/useEmitterVersions";

const FIELD: Record<string, string> = {
  pri_type: "PRI type",
  confirmation_quality: "Quality",
  confirmation_quantity: "Quantity",
  rf_min_mhz: "RF min",
  rf_max_mhz: "RF max",
  rf_delta: "RF ±",
  pw_min_us: "PW min",
  pw_max_us: "PW max",
  pw_delta: "PW ±",
  pri_min_us: "PRI min",
  pri_max_us: "PRI max",
  pri_delta: "PRI ±",
  jitter_min_us: "Jitter min",
  jitter_max_us: "Jitter max",
  pri_stagger_values_us: "Steps",
  frame_time_delta_us: "Frame time ±",
  explicit_frame_time_us: "Frame time",
  rf_range_matching: "RF range matching",
  pw_range_matching: "PW range matching",
  pri_range_matching: "PRI range matching",
};

function show(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.map(show).join(", ");
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return String(v).replace("_", " ");
}

/** Updates the ticked Modes from a PRS Emitter XML file — the file's Mode
 * with the same name (or one picked) replaces each one's values in place.
 * The Mode keeps its name, EW Group, Sources, notes, test history and links,
 * so the version summary shows it as changed, not as removed and added. */
export function PrsUpdateModal({
  emitterId,
  modeIds,
  onClose,
  onDone,
}: {
  emitterId: string;
  modeIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [keepDeltas, setKeepDeltas] = useState(true);
  const [pairs, setPairs] = useState<Record<string, number | null> | null>(null);
  const [preview, setPreview] = useState<PrsUpdatePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<PrsImportIssue[] | null>(null);
  const [result, setResult] = useState<PrsUpdateResult | null>(null);

  async function load(f: File, p: Record<string, number | null> | null, keep: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await prsUpdateApi.preview(emitterId, f, modeIds, p, keep);
      setPreview(res);
      setPairs(Object.fromEntries(res.pairs.map((x) => [x.mode_id, x.file_index])));
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiRequestError ? err.message : "Couldn't read the file");
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (!file || !pairs) return;
    setSaving(true);
    setError(null);
    setIssues(null);
    try {
      const res = await prsUpdateApi.update(emitterId, file, modeIds, pairs, keepDeltas);
      setResult(res);
      qc.invalidateQueries({ queryKey: emitterModesKey(emitterId) });
      qc.invalidateQueries({ queryKey: ["modes"] });
      qc.invalidateQueries({ queryKey: emitterVersionsKey(emitterId) });
      qc.invalidateQueries({ queryKey: ["auditLog"] });
      invalidateSimResults(qc, emitterId);
    } catch (err) {
      if (err instanceof ApiRequestError && Array.isArray(err.detail)) setIssues(err.detail as PrsImportIssue[]);
      else setError(err instanceof ApiRequestError ? err.message : "Couldn't update the Modes");
    } finally {
      setSaving(false);
    }
  }

  const rows = preview?.pairs ?? [];
  const used = new Set(rows.map((r) => r.file_index).filter((i) => i != null));
  const unused = (preview?.file_modes.length ?? 0) - used.size;
  const toUpdate = rows.filter((r) => r.file_index != null && Object.keys(r.changes).length > 0 && !r.error).length;
  const blocked = rows.some((r) => r.error);
  const n = modeIds.length;

  return (
    <Modal title={`Update ${n} Mode${n === 1 ? "" : "s"} from PRS`} onClose={onClose} wide className="prs-update">
      {result ? (
        <div className="prs-update-done">
          <p>
            Updated <strong>{result.updated.length}</strong> Mode{result.updated.length === 1 ? "" : "s"}
            {result.updated.length > 0 && <> ({result.updated.join(", ")})</>}.
            {result.unchanged.length > 0 && <> {result.unchanged.length} already matched the file.</>}
            {result.skipped.length > 0 && <> {result.skipped.length} left as they were.</>}
          </p>
          <p className="hint-text">They&apos;re in this Emitter&apos;s unsaved changes — save a version when you&apos;re done.</p>
          <div className="modal-actions">
            <button type="button" onClick={onDone}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="hint-text">
            Each ticked Mode takes the values of its Mode in the file — matched by name (the export writes spaces as
            underscores), or picked below. It keeps its name, EW Group, Sources, notes, test history and intercept links, so
            the version summary shows it as <em>changed</em>, not removed and added. Modes in the file that aren&apos;t
            used are left out; <strong>Import from PRS</strong> adds Modes.
          </p>
          <div className="prs-update-controls">
            <input
              type="file"
              ref={fileRef}
              accept=".xml"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setResult(null);
                if (f) void load(f, null, keepDeltas);
              }}
            />
            <button type="button" className="button secondary" onClick={() => fileRef.current?.click()} disabled={loading || saving}>
              {file ? file.name : "Select XML file"}
            </button>
            <label className="checkbox-label" title="The file's ranges include each ± delta. Kept, a Mode that wasn't changed elsewhere comes back exactly as it was.">
              <input
                type="checkbox"
                checked={keepDeltas}
                onChange={(e) => {
                  setKeepDeltas(e.target.checked);
                  if (file) void load(file, pairs, e.target.checked);
                }}
              />
              Keep each Mode&apos;s ± deltas
            </label>
            {loading && <span className="hint-text">Reading…</span>}
            {preview && <span className="hint-text">From &ldquo;{preview.file_emitter_name}&rdquo; · {preview.file_modes.length} Modes in the file</span>}
          </div>

          {preview && (
            <table className="data-table prs-update-table">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>From the file</th>
                  <th>What changes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const changes = Object.entries(r.changes);
                  return (
                    <tr key={r.mode_id} className={r.file_index == null ? "prs-update-skip" : undefined}>
                      <td>
                        <strong>{r.mode_name}</strong>
                        <div className="hint-text">{r.ew_group_name}</div>
                      </td>
                      <td>
                        <select
                          aria-label={`Mode in the file for ${r.mode_name}`}
                          value={r.file_index ?? ""}
                          disabled={loading || saving}
                          onChange={(e) => {
                            const next = { ...pairs, [r.mode_id]: e.target.value === "" ? null : Number(e.target.value) };
                            // A Mode in the file updates one Mode: free it from any other.
                            if (e.target.value !== "") {
                              for (const k of Object.keys(next)) if (k !== r.mode_id && next[k] === Number(e.target.value)) next[k] = null;
                            }
                            if (file) void load(file, next, keepDeltas);
                          }}
                        >
                          <option value="">— leave as it is —</option>
                          {preview.file_modes.map((m) => (
                            <option key={m.index} value={m.index}>
                              {m.name} · {m.ew_group_name} · {m.pri_type}
                            </option>
                          ))}
                        </select>
                        <div className="hint-text">
                          {r.match === "name" ? "matched by name" : r.match === "picked" ? "picked" : "no Mode of that name"}
                        </div>
                      </td>
                      <td className="prs-update-changes">
                        {r.error ? (
                          <span className="error-text">{r.error}</span>
                        ) : r.file_index == null ? (
                          <span className="hint-text">Left as it is</span>
                        ) : changes.length === 0 ? (
                          <span className="hint-text">No change — already the same</span>
                        ) : (
                          <ul>
                            {changes.map(([k, c]) => (
                              <li key={k}>
                                {FIELD[k] ?? k} <span className="figure">{show(c.old)}</span> →{" "}
                                <span className="figure">{show(c.new)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {r.notes.map((note) => (
                          <div key={note} className="prs-update-note">
                            {note}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {preview && unused > 0 && (
            <p className="hint-text">
              {unused} Mode{unused === 1 ? "" : "s"} in the file {unused === 1 ? "isn't" : "aren't"} used.
            </p>
          )}
          {preview && preview.issues.length > 0 && (
            <p className="hint-text">
              Can&apos;t be used ({preview.issues.length}): {preview.issues.map((i) => `${i.mode_name} — ${i.error}`).join("; ")}
            </p>
          )}
          {error && <p className="error-text">{error}</p>}
          {issues && (
            <div className="error-text">
              Nothing was changed:
              <ul>
                {issues.map((i) => (
                  <li key={i.mode_name}>
                    <strong>{i.mode_name}</strong>: {i.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" disabled={!preview || saving || loading || blocked || toUpdate === 0} onClick={() => void apply()}>
              {saving ? "Updating…" : toUpdate === 0 && preview ? "Nothing to update" : `Update ${toUpdate} Mode${toUpdate === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
