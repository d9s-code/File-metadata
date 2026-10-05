"""The whole repository as PRS-format XML, written next to each backup — so if
the database can't be restored in time, the files are still there to use.

One zip, laid out as:

    README.txt                       what's inside, and from which version
    emitters/<Emitter>.xml           every Emitter
    platforms/<Platform>/...         each Platform as its own PRS package
    mdfs/<MDF>/...                   each MDF as its own PRS package (ready to use as-is)

It uses the same serializer and packager as the PRS downloads in the app, so
the files are exactly what an export from the app would give. Each item is
taken from its latest saved version, as PRS exports always are; an item never
saved is taken from its current state instead, and the README says which.
"""

import io
import zipfile
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.mdf import Mdf, MdfVersion
from app.models.platform import Platform, PlatformVersion
from app.services.prs_export.packager import _template_bytes, build_mdf_export_zip, build_platform_export_zip
from app.services.prs_export.serializer import build_emitter_element, sanitize_filename, to_xml_bytes
from app.services.snapshots import build_emitter_snapshot, build_mdf_snapshot, build_platform_snapshot


def _latest_versions(db: Session, version_model, fk: str) -> dict:
    """Each item's latest saved version: {item id: version row}."""
    fk_col = getattr(version_model, fk)
    latest = (
        db.query(fk_col.label("item_id"), func.max(version_model.version_number).label("n"))
        .group_by(fk_col)
        .subquery()
    )
    rows = (
        db.query(version_model)
        .join(latest, (fk_col == latest.c.item_id) & (version_model.version_number == latest.c.n))
        .all()
    )
    return {getattr(v, fk): v for v in rows}


def _unique(name: str, taken: set[str]) -> str:
    """A file name not used yet in this folder — two names can clean up the same way."""
    base = sanitize_filename(name) or "unnamed"
    candidate, n = base, 2
    while candidate.lower() in taken:
        candidate = f"{base}_{n}"
        n += 1
    taken.add(candidate.lower())
    return candidate


def _add_package(out: zipfile.ZipFile, folder: str, package: bytes) -> int:
    """Copy one PRS package's files into a folder of the backup zip."""
    with zipfile.ZipFile(io.BytesIO(package)) as zf:
        names = zf.namelist()
        for entry in names:
            out.writestr(f"{folder}/{entry}", zf.read(entry))
    return len(names)


def build_repository_prs_zip(db: Session, taken_at: datetime) -> tuple[bytes, dict]:
    """The zip, and a summary for the backup's record: how many of each, and how
    many were taken from their current state because they've never been saved."""
    lines: list[str] = []
    summary = {"emitters": 0, "platforms": 0, "mdfs": 0, "files": 0, "never_saved": 0}
    buffer = io.BytesIO()

    def source(version, label: str) -> str:
        if version is None:
            summary["never_saved"] += 1
            return f"{label} — never saved; its current state"
        return f"{label} — v{version.version_number}, saved {version.created_at:%Y-%m-%d %H:%M} UTC"

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as out:
        # Emitters
        versions = _latest_versions(db, EmitterVersion, "emitter_id")
        out.writestr("emitters/default_unknown_emitter.xml", _template_bytes("default_unknown_emitter.xml"))
        summary["files"] += 1
        taken: set[str] = {"default_unknown_emitter"}
        lines.append("EMITTERS (emitters/)")
        for emitter in db.query(Emitter).filter(Emitter.is_deleted.is_(False)).order_by(func.lower(Emitter.name)):
            version = versions.get(emitter.id)
            snapshot = version.snapshot if version else build_emitter_snapshot(emitter)
            filename = _unique(emitter.name, taken)
            out.writestr(f"emitters/{filename}.xml", to_xml_bytes(build_emitter_element(snapshot)))
            summary["emitters"] += 1
            summary["files"] += 1
            lines.append(f"  {filename}.xml: {source(version, emitter.name)}")

        # Platforms, each its own PRS package
        versions = _latest_versions(db, PlatformVersion, "platform_id")
        taken = set()
        lines += ["", "PLATFORMS (platforms/<name>/ — each a complete PRS package)"]
        for platform in db.query(Platform).filter(Platform.is_deleted.is_(False)).order_by(func.lower(Platform.name)):
            version = versions.get(platform.id)
            snapshot = version.snapshot if version else build_platform_snapshot(platform)
            folder = _unique(platform.name, taken)
            summary["files"] += _add_package(
                out, f"platforms/{folder}", build_platform_export_zip(snapshot, platform_id=str(platform.id))
            )
            summary["platforms"] += 1
            lines.append(f"  {folder}/: {source(version, platform.name)}")

        # MDFs, each its own PRS package
        versions = _latest_versions(db, MdfVersion, "mdf_id")
        taken = set()
        lines += ["", "MDFS (mdfs/<name>/ — each a complete PRS package, ready to use as-is)"]
        for mdf in db.query(Mdf).filter(Mdf.is_deleted.is_(False)).order_by(func.lower(Mdf.name)):
            version = versions.get(mdf.id)
            snapshot = version.snapshot if version else build_mdf_snapshot(mdf)
            folder = _unique(mdf.name, taken)
            summary["files"] += _add_package(out, f"mdfs/{folder}", build_mdf_export_zip(snapshot, mdf_id=str(mdf.id)))
            summary["mdfs"] += 1
            lines.append(f"  {folder}/: {source(version, mdf.name)}")

        header = [
            "PRS export of the whole repository",
            f"Taken {taken_at:%Y-%m-%d %H:%M} UTC, together with the database backup of the same name.",
            "",
            "Use these files directly if the database can't be restored in time. Each MDF folder",
            "is a complete PRS package, the same as exporting that MDF from the app. Everything is",
            "from its latest saved version; anything never saved is from its current state.",
            "",
            f"{summary['emitters']} Emitters, {summary['platforms']} Platforms, {summary['mdfs']} MDFs.",
            "",
        ]
        out.writestr("README.txt", "\n".join(header + lines) + "\n")
        summary["files"] += 1
    return buffer.getvalue(), summary
