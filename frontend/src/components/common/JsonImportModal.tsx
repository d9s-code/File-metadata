import { Fragment, useRef, useState } from "react";
import { DateInput } from "./DateInput";
import { Modal } from "./Modal";
import { emittersApi, type JsonImportPreview, type JsonImportResult } from "../../api/emitters";
import { ApiRequestError } from "../../api/client";
import { useSourceGroups } from "../../state/hooks/useSourceGroups";
import { formatDate } from "./dates";
import { VariantTag } from "../sources/elementDisplay";
import { SequenceKindTag } from "../sources/SequenceKind";

interface JsonImportModalProps {
  emitterId: string;
  onSuccess: () => void;
  onClose: () => void;
}

type PreviewSet = JsonImportPreview["sets"][number];
const TYPES = [
  ["rf", "RF", "MHz"],
  ["pri", "PRI", "µs"],
  ["pw", "PW", "µs"],
  ["scan", "Scan", "s"],
] as const;

function span(lo: number | null, hi: number | null): string {
  if (lo == null && hi == null) return "—";
  return lo === hi || hi == null ? `${lo}` : `${lo}–${hi}`;
}

/** One Source the file would make: its counts on a line, its Elements and
 * sequences when opened. */
function PreviewRow({ set }: { set: PreviewSet }) {
  const [open, setOpen] = useState(false);
  const count = (t: string) => set.elements.filter((e) => e.element_type === t).length;
  return (
    <>
      <tr className={open ? "row-open" : undefined}>
        <td className="expand-col">
          <button
            type="button"
            className="link-button"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} what ${set.source_name} has`}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "▾" : "▸"}
          </button>
        </td>
        <td>
          <strong>{set.source_name}</strong>
          {set.name_taken && <span className="json-preview-warn"> · name already on this Emitter</span>}
          {set.left_out.length > 0 && (
            <span className="json-preview-warn" title={set.left_out.join("\n")}>
              {" "}
              · {set.left_out.length} left out
            </span>
          )}
          {set.source_description && <div className="hint-text">{set.source_description}</div>}
        </td>
        <td className="nowrap">{formatDate(set.source_date)}</td>
        <td className="nowrap">
          {TYPES.filter(([t]) => count(t) > 0)
            .map(([t, name]) => `${count(t)} ${name}`)
            .join(" · ") || <span className="hint-text">—</span>}
        </td>
        <td>{set.sequences.length || <span className="hint-text">—</span>}</td>
      </tr>
      {open && (
        <tr className="row-detail">
          <td />
          <td colSpan={4}>
            {set.left_out.length > 0 && (
              <ul className="json-preview-warn json-preview-row-left-out">
                {set.left_out.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            )}
            <div className="json-preview-detail">
              {TYPES.map(([t, name, unit]) => {
                const els = set.elements.filter((e) => e.element_type === t);
                if (els.length === 0) return null;
                return (
                  <div key={t}>
                    <strong>
                      {name} <span className="hint-text">({unit})</span>
                    </strong>
                    <ul>
                      {els.map((e, i) => (
                        <li key={i}>
                          <span className="figure">{span(e.value_min, e.value_max)}</span> <VariantTag variant={e.variant} />{" "}
                          {e.label && <span className="hint-text">{e.label}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {set.sequences.length > 0 && (
                <div>
                  <strong>Sequences</strong>
                  <ul>
                    {set.sequences.map((q, i) => (
                      <li key={i}>
                        {q.label ?? "unnamed"} <span className="hint-text">· {q.steps} steps · {q.parameters.join(", ")}</span>{" "}
                        {q.parameters.includes("PRI") && <SequenceKindTag kind={q.guessed_kind} guessed />}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Import JSON: pick a file, see what it would make (and what would be left
 * out), then import it. */
export function JsonImportModal({ emitterId, onSuccess, onClose }: JsonImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<JsonImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceDate, setSourceDate] = useState("");
  const [groupId, setGroupId] = useState("");
  // Shown instead of closing when some of the file was left out.
  const [done, setDone] = useState<JsonImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { sourceGroups } = useSourceGroups();

  async function loadPreview(f: File, date: string) {
    setPreviewing(true);
    setError(null);
    try {
      setPreview(await emittersApi.previewJson(emitterId, f, date || undefined));
      setFind("");
      setOnlyFlagged(false);
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiRequestError ? err.message : "Couldn't read the file");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    if (!file) return;
    setIsImporting(true);
    setError(null);
    try {
      const result = await emittersApi.importJson(emitterId, file, sourceDate || undefined, groupId || undefined);
      onSuccess();
      if (result?.skipped?.length) setDone(result);
      else onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to import JSON");
    } finally {
      setIsImporting(false);
    }
  }

  const errors = preview?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = preview?.issues.filter((i) => i.severity !== "error") ?? [];
  const busy = previewing || isImporting;
  const n = preview?.sets.length ?? 0;
  // A long file: find a Source, or just those with something to look at.
  const [find, setFind] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const flagged = (s: PreviewSet) => s.name_taken || s.left_out.length > 0;
  const flaggedCount = preview?.sets.filter(flagged).length ?? 0;
  const shownSets = (preview?.sets ?? []).filter(
    (s) => (!onlyFlagged || flagged(s)) && s.source_name.toLowerCase().includes(find.trim().toLowerCase()),
  );
  // Warnings that are only "this name is already here" read as one line.
  const takenNames = preview?.sets.filter((s) => s.name_taken).map((s) => s.source_name) ?? [];
  const otherWarnings = warnings.filter((i) => !/is already on this Emitter/.test(i.message));

  return (
    <Modal title="Import JSON" onClose={onClose} wide>
      {done ? (
        <div className="json-import-done">
          <p>
            Imported {done.source_count} Source{done.source_count === 1 ? "" : "s"} with {done.element_count} Element
            {done.element_count === 1 ? "" : "s"} and {done.sequence_count} sequence{done.sequence_count === 1 ? "" : "s"}.
          </p>
          <p className="hint-text">
            {done.skipped.length} thing{done.skipped.length === 1 ? "" : "s"} in the file couldn&apos;t be read and{" "}
            {done.skipped.length === 1 ? "was" : "were"} left out:
          </p>
          <ul className="json-import-skipped">
            {done.skipped.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <div className="modal-actions">
            <button type="button" className="button primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="json-import">
          <div className="json-import-options">
            <label>
              Date last updated (optional)
              <DateInput
                value={sourceDate}
                onChange={(e) => {
                  setSourceDate(e.target.value);
                  if (file) void loadPreview(file, e.target.value);
                }}
                disabled={busy}
              />
              <span className="hint-text">Used for every Source instead of the file&apos;s own dates.</span>
            </label>
            <label>
              Source Group (optional)
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={busy}>
                <option value="">— a new group for this import —</option>
                {sourceGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <span className="hint-text">Every Source it makes is filed under it.</span>
            </label>
          </div>

          <div className="json-import-file">
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  void loadPreview(f, sourceDate);
                  e.target.value = ""; // the same file can be picked again
                }
              }}
            />
            <button type="button" className="button secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
              {file ? "Choose another file" : "Select JSON file"}
            </button>
            {file && <span className="hint-text">{file.name}</span>}
            {previewing && <span className="hint-text">Reading…</span>}
          </div>

          {preview && (
            <div className="json-preview" aria-label="What the import would make">
              <p>
                <strong>{preview.document_name}</strong>
                {preview.document_reference && <span className="hint-text"> · {preview.document_reference}</span>} — would make{" "}
                <strong>
                  {n} Source{n === 1 ? "" : "s"}
                </strong>{" "}
                with {preview.element_count} Element{preview.element_count === 1 ? "" : "s"} and {preview.sequence_count} sequence
                {preview.sequence_count === 1 ? "" : "s"}. Nothing is saved until you import.
              </p>
              {errors.length > 0 && (
                <details className="error-text json-preview-list" open={errors.length <= 5}>
                  <summary>
                    Can&apos;t be imported — {errors.length} problem{errors.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="json-import-skipped">
                    {errors.map((i, k) => (
                      <li key={k}>{i.message}</li>
                    ))}
                  </ul>
                </details>
              )}
              {takenNames.length > 0 && (
                <details className="json-preview-warn json-preview-list">
                  <summary>
                    {takenNames.length === n ? (n === 1 ? "Its name is" : `All ${n} names are`) : `${takenNames.length} of the names are`}{" "}
                    already on this Emitter — importing adds {takenNames.length === 1 ? "another Source" : "more Sources"} of the same
                    name
                  </summary>
                  <p className="hint-text">{takenNames.join(", ")}</p>
                </details>
              )}
              {otherWarnings.length > 0 && (
                <details className="json-preview-warn json-preview-list" open={otherWarnings.length <= 5}>
                  <summary>
                    {otherWarnings.length} warning{otherWarnings.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="json-import-skipped">
                    {otherWarnings.map((i, k) => (
                      <li key={k}>{i.message}</li>
                    ))}
                  </ul>
                </details>
              )}
              {preview.skipped.length > 0 && (
                <details className="json-preview-skipped" open={preview.skipped.length <= 5}>
                  <summary>
                    {preview.skipped.length} thing{preview.skipped.length === 1 ? "" : "s"} can&apos;t be read and would be left out
                  </summary>
                  <ul className="json-import-skipped">
                    {preview.skipped.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </details>
              )}
              {n > 10 && (
                <div className="json-preview-filter">
                  <input
                    type="search"
                    placeholder="Find a Source…"
                    aria-label="Find a Source in the preview"
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                  />
                  <label>
                    <input type="checkbox" checked={onlyFlagged} disabled={flaggedCount === 0} onChange={(e) => setOnlyFlagged(e.target.checked)} />
                    Only those with something to check ({flaggedCount})
                  </label>
                  <span className="hint-text">
                    {shownSets.length} of {n}
                  </span>
                </div>
              )}
              <div className="json-preview-table">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th className="expand-col" aria-label="Open" />
                      <th>Source</th>
                      <th>Date</th>
                      <th>Elements</th>
                      <th>Sequences</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownSets.map((set, i) => (
                      <Fragment key={`${set.source_name}-${i}`}>
                        <PreviewRow set={set} />
                      </Fragment>
                    ))}
                    {shownSets.length === 0 && (
                      <tr>
                        <td colSpan={5} className="hint-text">
                          No Source matches.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!preview || !preview.valid || busy}
              onClick={() => void handleImport()}
            >
              {isImporting ? "Importing…" : preview ? `Import ${n} Source${n === 1 ? "" : "s"}` : "Import"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
