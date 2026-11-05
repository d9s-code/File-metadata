import { useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { ApiRequestError } from "../../api/client";
import {
  ATTACHMENT_MAX_BYTES,
  attachmentDownloadUrl,
  attachmentThumbUrl,
  attachmentUrl,
  type Attachment,
  type AttachmentOwner,
} from "../../api/attachments";
import { useAttachmentMutations, useAttachments } from "../../state/hooks/useAttachments";
import { LoadingState } from "../common/LoadingState";
import { MenuButton } from "../common/MenuButton";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { formatDateTime } from "../common/dates";

const OWNER_LABEL: Record<AttachmentOwner, string> = { emitter: "Emitter", platform: "Platform", mdf: "MDF" };

export function formatSize(n: number) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} kB`;
}

/** "xlsx" — the extension, for the file's tile. */
function extension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase().slice(0, 5) : "file";
}

/** Which family a file is, for its tile's colour. */
function family(name: string): string {
  const ext = extension(name);
  if (["xls", "xlsx", "xlsm", "csv", "ods", "tsv"].includes(ext)) return "sheet";
  if (["doc", "docx", "odt", "rtf", "txt", "md"].includes(ext)) return "doc";
  if (ext === "pdf") return "pdf";
  if (["ppt", "pptx", "odp"].includes(ext)) return "slides";
  if (["zip", "7z", "rar", "gz", "tar"].includes(ext)) return "archive";
  return "other";
}

const isPdf = (a: Attachment) => a.content_type === "application/pdf";

/** An Emitter's, Platform's or MDF's files — spreadsheets, documents,
 * pictures, anything. Pictures show as previews and open full size; a PDF
 * opens in a new tab; the rest download. Editors add them (pick, drop or
 * paste), describe, reorder and delete them — no checkout needed, they
 * aren't in versions. */
export function FilesPanel({
  owner,
  ownerId,
  ownerName,
  canEdit,
  readOnlyReason,
}: {
  owner: AttachmentOwner;
  ownerId: string;
  ownerName: string;
  canEdit: boolean;
  /** Shown instead of the add button when it can't be changed (in the Trash, say). */
  readOnlyReason?: string;
}) {
  const { data: files, isLoading, error } = useAttachments(owner, ownerId);
  const { upload, update, reorder, remove } = useAttachmentMutations(owner, ownerId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const input = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<{ done: number; total: number } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  async function add(picked: File[]) {
    if (!canEdit || picked.length === 0) return;
    const errors: string[] = [];
    const ok = picked.filter((f) => {
      if (f.size > ATTACHMENT_MAX_BYTES) errors.push(`${f.name}: at most ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB`);
      else if (f.size === 0) errors.push(`${f.name}: the file is empty`);
      else return true;
      return false;
    });
    setQueue({ done: 0, total: ok.length });
    // One at a time, in the order picked, so they keep it.
    for (const [i, file] of ok.entries()) {
      try {
        await upload.mutateAsync(file);
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof ApiRequestError ? err.message : "couldn't be added"}`);
      }
      setQueue({ done: i + 1, total: ok.length });
    }
    setQueue(null);
    setProblems(errors);
  }

  // Pasting a file (a screenshot, or a file copied in Explorer) adds it — unless typing somewhere.
  useEffect(() => {
    if (!canEdit) return;
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, [contenteditable=true]") || target.isContentEditable)) return;
      const pasted = [...(e.clipboardData?.files ?? [])];
      if (pasted.length === 0) return;
      e.preventDefault();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      // A screenshot comes as "image.png" — named for when it was pasted instead.
      void add(
        pasted.map((f, i) =>
          f.name && f.name !== "image.png" ? f : new File([f], `pasted-${stamp}${i ? `-${i}` : ""}.png`, { type: f.type }),
        ),
      );
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // add() only reads state set through setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, ownerId]);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void add([...e.dataTransfer.files]);
  }

  function move(id: string, by: number) {
    if (!files) return;
    const ids = files.map((f) => f.id);
    const i = ids.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(ids, { onError: (err) => setProblems([err instanceof ApiRequestError ? err.message : "Couldn't reorder"]) });
  }

  async function del(a: Attachment) {
    if (!(await confirmDelete(`Delete "${a.filename}"?`))) return;
    try {
      await remove.mutateAsync(a.id);
      if (open === a.id) setOpen(null);
    } catch (err) {
      setProblems([err instanceof ApiRequestError ? err.message : "Couldn't delete the file"]);
    }
  }

  async function saveDescription() {
    if (!editing) return;
    try {
      await update.mutateAsync({ id: editing.id, description: editing.text.trim() || null });
      setEditing(null);
    } catch (err) {
      setProblems([err instanceof ApiRequestError ? err.message : "Couldn't save the description"]);
    }
  }

  /** A picture opens full size here, a PDF in a new tab, anything else downloads. */
  function openFile(a: Attachment) {
    if (a.is_image) setOpen(a.id);
    else if (isPdf(a)) window.open(attachmentUrl(a.id), "_blank", "noopener");
    else window.location.assign(attachmentDownloadUrl(a.id));
  }

  const list = files ?? [];
  const images = list.filter((a) => a.is_image);
  const index = open ? images.findIndex((a) => a.id === open) : -1;

  return (
    <section
      className={`card files-panel${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={canEdit ? onDrop : undefined}
    >
      <div className="files-head">
        <h3>
          Files <span className="section-count">{list.length}</span>
        </h3>
        {canEdit ? (
          <span className="files-add">
            <span className="hint-text">Drop files here or paste (Ctrl+V)</span>
            <button type="button" className="button primary small" disabled={!!queue} onClick={() => input.current?.click()}>
              {queue ? `Adding ${Math.min(queue.done + 1, queue.total)} of ${queue.total}…` : "+ Add files"}
            </button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = "";
                void add(picked);
              }}
            />
          </span>
        ) : (
          readOnlyReason && <span className="hint-text">{readOnlyReason}</span>
        )}
      </div>
      {problems.length > 0 && (
        <div className="error-text files-problems" role="alert">
          {problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
          <button type="button" className="link-button" onClick={() => setProblems([])}>
            Dismiss
          </button>
        </div>
      )}
      {error && <div className="error-text">{(error as Error).message}</div>}
      {isLoading ? (
        <LoadingState label="Loading files…" />
      ) : list.length === 0 ? (
        <p className="hint-text files-empty">
          No files with this {OWNER_LABEL[owner]} yet.
          {canEdit &&
            ` Spreadsheets, documents, PDFs, photos and screenshots — any kind, up to ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB each.`}
        </p>
      ) : (
        <ul className="files-grid">
          {list.map((a, i) => (
            <li key={a.id} className="file-card">
              <button
                type="button"
                className={`file-tile${a.is_image ? " image" : ""}`}
                onClick={() => openFile(a)}
                title={a.is_image ? "Open full size" : isPdf(a) ? "Open in a new tab" : `Download ${a.filename}`}
              >
                {a.is_image ? (
                  <img src={attachmentThumbUrl(a.id)} alt={a.description ?? a.filename} loading="lazy" />
                ) : (
                  <span className={`file-badge file-${family(a.filename)}`}>{extension(a.filename).toUpperCase()}</span>
                )}
              </button>
              {editing?.id === a.id ? (
                <form
                  className="file-description-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveDescription();
                  }}
                >
                  <input
                    type="text"
                    autoFocus
                    aria-label="Description"
                    maxLength={2000}
                    value={editing.text}
                    placeholder="What it is"
                    onChange={(e) => setEditing({ id: a.id, text: e.target.value })}
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                  />
                  <button type="submit" className="button primary small" disabled={update.isPending}>
                    Save
                  </button>
                </form>
              ) : (
                <div className="file-info">
                  <div className="file-text">
                    <span className="file-name" title={a.filename}>
                      {a.filename}
                    </span>
                    <span className="hint-text file-sub" title={a.description ?? undefined}>
                      {a.description ?? formatSize(a.size_bytes)}
                    </span>
                  </div>
                  <MenuButton
                    label="⋯"
                    className="row-menu-button"
                    ariaLabel={`Actions for ${a.filename}`}
                    items={[
                      ...(isPdf(a) ? [{ label: "Open in a new tab", onSelect: () => openFile(a) }] : []),
                      { label: "Download", onSelect: () => window.location.assign(attachmentDownloadUrl(a.id)) },
                      ...(canEdit
                        ? [
                            {
                              label: a.description ? "Edit description" : "Add description",
                              onSelect: () => setEditing({ id: a.id, text: a.description ?? "" }),
                            },
                            { label: "Move earlier", onSelect: () => move(a.id, -1), disabled: i === 0 },
                            { label: "Move later", onSelect: () => move(a.id, 1), disabled: i === list.length - 1 },
                            { label: "Delete", danger: true, onSelect: () => void del(a) },
                          ]
                        : []),
                    ]}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {index >= 0 && (
        <PictureViewer
          pictures={images}
          index={index}
          ownerName={ownerName}
          onIndex={(i) => setOpen(images[i]?.id ?? null)}
          onClose={() => setOpen(null)}
        />
      )}
      {dialog}
    </section>
  );
}

/** One picture full size over the page: ← → for the other pictures, Esc to close. */
function PictureViewer({
  pictures,
  index,
  ownerName,
  onIndex,
  onClose,
}: {
  pictures: Attachment[];
  index: number;
  ownerName: string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const p = pictures[index];
  const n = pictures.length;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && n > 1) onIndex((index - 1 + n) % n);
      else if (e.key === "ArrowRight" && n > 1) onIndex((index + 1) % n);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, n, onIndex, onClose]);

  return createPortal(
    <div className="picture-viewer" role="dialog" aria-modal="true" aria-label={`Picture of ${ownerName}`} onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        <div className="picture-viewer-frame">
          {n > 1 && (
            <button type="button" className="picture-viewer-nav prev" aria-label="Previous picture" onClick={() => onIndex((index - 1 + n) % n)}>
              ‹
            </button>
          )}
          {/* The preview shows behind it at once, sharpening as the full picture loads. */}
          <img
            key={p.id}
            src={attachmentUrl(p.id)}
            alt={p.description ?? p.filename}
            style={{
              aspectRatio: p.width && p.height ? `${p.width} / ${p.height}` : undefined,
              backgroundImage: `url(${attachmentThumbUrl(p.id)})`,
            }}
          />
          {n > 1 && (
            <button type="button" className="picture-viewer-nav next" aria-label="Next picture" onClick={() => onIndex((index + 1) % n)}>
              ›
            </button>
          )}
        </div>
        <figcaption>
          <div>
            {p.description && <strong>{p.description}</strong>}
            <div className="picture-viewer-meta">
              {p.filename} · {p.width}×{p.height} · {formatSize(p.size_bytes)} · added {formatDateTime(p.created_at)}
              {p.uploaded_by_username && ` by ${p.uploaded_by_username}`}
              {n > 1 && ` · ${index + 1} of ${n}`}
            </div>
          </div>
          <span className="picture-viewer-actions">
            <a href={attachmentUrl(p.id)} target="_blank" rel="noreferrer">
              Open in a new tab
            </a>
            <a href={attachmentDownloadUrl(p.id)}>Download</a>
            <button type="button" className="link-button" onClick={onClose} aria-label="Close">
              ✕ Close
            </button>
          </span>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}
