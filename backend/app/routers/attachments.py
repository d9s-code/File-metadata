"""Files kept with Emitters, Platforms and MDFs — spreadsheets, documents,
photos, screenshots: any kind, one at a time. A PNG, JPEG, WebP or GIF that
really is one also gets a preview and is shown on the page; everything else
is downloaded. Editors add them without checking anything out — they aren't
part of a version. Every change is in the Audit Log."""

from __future__ import annotations

import io
import mimetypes
import uuid
import warnings
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, undefer

from app.core.csrf import verify_csrf
from app.core.downloads import attachment_disposition
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.attachment import OWNER_COLUMNS, Attachment
from app.models.emitter import Emitter
from app.models.mdf import Mdf
from app.models.platform import Platform
from app.services.audit_service import record_audit, snapshot

router = APIRouter(prefix="/attachments", tags=["attachments"])

#: The largest file taken: the proxy in front takes at most 20 MB a request.
MAX_BYTES = 18 * 1024 * 1024
#: Larger than any camera; guards against an image that unpacks to gigabytes.
MAX_PIXELS = 100_000_000
#: A preview's longest side.
THUMB_SIZE = 480
IMAGE_FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}
OWNERS = {"emitter": (Emitter, "Emitter"), "platform": (Platform, "Platform"), "mdf": (Mdf, "MDF")}

Owner = Literal["emitter", "platform", "mdf"]


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    emitter_id: uuid.UUID | None
    platform_id: uuid.UUID | None
    mdf_id: uuid.UUID | None
    filename: str
    content_type: str
    size_bytes: int
    is_image: bool
    width: int | None
    height: int | None
    description: str | None
    position: int
    created_at: datetime
    updated_at: datetime
    uploaded_by_username: str | None = None


class AttachmentUpdate(BaseModel):
    description: str | None = Field(default=None, max_length=2000)


class AttachmentOrder(BaseModel):
    owner: Owner
    owner_id: uuid.UUID
    ids: list[uuid.UUID] = Field(max_length=1000)


def _out(a: Attachment) -> AttachmentOut:
    out = AttachmentOut.model_validate(a)
    out.uploaded_by_username = a.uploader.username if a.uploader else None
    return out


def _owner_row(db: Session, owner: str, owner_id: uuid.UUID, *, writing: bool):
    model, kind = OWNERS[owner]
    row = db.get(model, owner_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{kind} not found")
    if writing and row.deleted_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This {kind} is in the Trash — restore it to change its files")
    return row


def _audit(db: Session, a: Attachment, owner_row, *, user_id, action: AuditAction, summary: str, changes=None):
    kind, owner_id = a.owner
    record_audit(
        db,
        actor_id=user_id,
        action=action,
        entity_type=AuditEntityType.attachment.value,
        entity_id=a.id,
        summary=f"{summary} {OWNERS[kind][1]} '{owner_row.name}'",
        changes=changes,
        emitter_id=owner_id if kind == "emitter" else None,
    )


def _read_image(data: bytes) -> tuple[str, int, int, bytes] | None:
    """(content type, width and height as shown, preview) for a picture the
    page can show — or None for anything else (kept as a plain file)."""
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as probe:
                if probe.format not in IMAGE_FORMATS:
                    return None
                probe.verify()
            img = Image.open(io.BytesIO(data))
            content_type = IMAGE_FORMATS[img.format]
            img.seek(0)  # the first frame of an animation
            # As it's shown: a phone photo's sideways pixels turned upright.
            img = ImageOps.exif_transpose(img)
            width, height = img.size
            img.thumbnail((THUMB_SIZE, THUMB_SIZE))
            keep_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
            img = img.convert("RGBA" if keep_alpha else "RGB")
            buf = io.BytesIO()
            img.save(buf, "WEBP", quality=80, method=4)
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning, OSError, SyntaxError, ValueError):
        return None
    return content_type, width, height, buf.getvalue()


def _file_type(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


@router.get("", response_model=list[AttachmentOut])
def list_attachments(
    owner: Owner, owner_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[AttachmentOut]:
    _owner_row(db, owner, owner_id, writing=False)
    col = getattr(Attachment, OWNER_COLUMNS[owner])
    rows = db.scalars(select(Attachment).where(col == owner_id).order_by(Attachment.position, Attachment.created_at)).all()
    return [_out(a) for a in rows]


@router.post("", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def upload_attachment(
    owner: Owner = Form(...),
    owner_id: uuid.UUID = Form(...),
    description: str | None = Form(default=None, max_length=2000),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> AttachmentOut:
    """One file, added after the others."""
    row = _owner_row(db, owner, owner_id, writing=True)
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, f"A file can be at most {MAX_BYTES // 1_048_576} MB")
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The file is empty")
    filename = (file.filename or "file").replace("\\", "/").rsplit("/", 1)[-1].strip()[:255] or "file"
    image = _read_image(data)
    col = getattr(Attachment, OWNER_COLUMNS[owner])
    last = db.scalar(select(Attachment.position).where(col == owner_id).order_by(Attachment.position.desc()).limit(1))
    a = Attachment(
        filename=filename,
        content_type=image[0] if image else _file_type(filename),
        size_bytes=len(data),
        is_image=image is not None,
        width=image[1] if image else None,
        height=image[2] if image else None,
        thumb=image[3] if image else None,
        description=(description or "").strip() or None,
        position=(last + 1) if last is not None else 0,
        data=data,
        uploaded_by=user.id,
        **{OWNER_COLUMNS[owner]: owner_id},
    )
    db.add(a)
    db.flush()
    _audit(
        db, a, row, user_id=user.id, action=AuditAction.create, summary=f"Added file '{filename}' to",
        changes=snapshot(a, ["filename", "description", "size_bytes"]),
    )
    db.commit()
    db.refresh(a)
    return _out(a)


def _get(db: Session, attachment_id: uuid.UUID, *, load: str | None = None) -> Attachment:
    q = select(Attachment).where(Attachment.id == attachment_id)
    if load:
        q = q.options(undefer(getattr(Attachment, load)))
    a = db.scalar(q)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    return a


def _shows_inline(a: Attachment) -> bool:
    """A picture, or a PDF (the browser's own viewer) — opened in the page or a
    tab. Anything else is only ever downloaded, never run by the browser."""
    return a.is_image or (a.content_type == "application/pdf" and a.data[:5] == b"%PDF-")


@router.get("/{attachment_id}/file")
def attachment_file(
    attachment_id: uuid.UUID,
    download: bool = False,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> Response:
    """The file as uploaded: a picture or PDF shown, anything else downloaded."""
    a = _get(db, attachment_id, load="data")
    inline = _shows_inline(a) and not download
    headers = {
        # A file never changes under its id: a new file is a new attachment.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": attachment_disposition(a.filename).replace("attachment;", "inline;", 1)
        if inline
        else attachment_disposition(a.filename),
    }
    # PDF viewers need scripts of their own; everything else runs nothing.
    if not (inline and a.content_type == "application/pdf"):
        headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
    return Response(content=a.data, media_type=a.content_type, headers=headers)


@router.get("/{attachment_id}/thumb")
def attachment_thumb(
    attachment_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> Response:
    """A picture's preview: at most 480 px a side, WebP."""
    a = _get(db, attachment_id, load="thumb")
    if a.thumb is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This file has no preview")
    return Response(
        content=a.thumb,
        media_type="image/webp",
        headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"},
    )


@router.patch("/{attachment_id}", response_model=AttachmentOut, dependencies=[Depends(verify_csrf)])
def update_attachment(
    attachment_id: uuid.UUID,
    payload: AttachmentUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> AttachmentOut:
    a = _get(db, attachment_id)
    kind, owner_id = a.owner
    row = _owner_row(db, kind, owner_id, writing=True)
    new = (payload.description or "").strip() or None
    if new != a.description:
        _audit(
            db, a, row, user_id=user.id, action=AuditAction.update,
            summary=f"Changed the description of file '{a.filename}' on",
            changes={"description": {"old": a.description, "new": new}},
        )
        a.description = new
        db.commit()
        db.refresh(a)
    return _out(a)


@router.put("/order", response_model=list[AttachmentOut], dependencies=[Depends(verify_csrf)])
def reorder_attachments(
    payload: AttachmentOrder, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> list[AttachmentOut]:
    """Puts an owner's files in this order. Every file it has must be listed
    once — so a file added meanwhile isn't put somewhere by accident."""
    row = _owner_row(db, payload.owner, payload.owner_id, writing=True)
    col = getattr(Attachment, OWNER_COLUMNS[payload.owner])
    files = {a.id: a for a in db.scalars(select(Attachment).where(col == payload.owner_id)).all()}
    if len(payload.ids) != len(set(payload.ids)) or set(payload.ids) != set(files):
        raise HTTPException(status.HTTP_409_CONFLICT, "The files have changed — reload and try again")
    before = [a.id for a in sorted(files.values(), key=lambda a: (a.position, a.created_at))]
    if before != payload.ids:
        for i, aid in enumerate(payload.ids):
            files[aid].position = i
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.update,
            entity_type=AuditEntityType.attachment.value,
            entity_id=payload.ids[0] if payload.ids else None,
            summary=f"Reordered the files of {OWNERS[payload.owner][1]} '{row.name}'",
            changes={"order": {"old": [files[i].filename for i in before], "new": [files[i].filename for i in payload.ids]}},
            emitter_id=payload.owner_id if payload.owner == "emitter" else None,
        )
        db.commit()
    return [_out(files[i]) for i in payload.ids]


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_attachment(
    attachment_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> None:
    a = _get(db, attachment_id)
    kind, owner_id = a.owner
    row = _owner_row(db, kind, owner_id, writing=True)
    _audit(
        db, a, row, user_id=user.id, action=AuditAction.delete, summary=f"Deleted file '{a.filename}' from",
        changes=snapshot(a, ["filename", "description", "size_bytes"]),
    )
    db.delete(a)
    db.commit()
