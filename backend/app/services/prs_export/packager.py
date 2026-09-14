"""Packages committed Platform/MDF version snapshots into a PRS-format ZIP —
the offline counterpart to app/xml_export's single-file placeholder export.
Reads only from version snapshots (never live ORM state), same guarantee the
rest of this app's versioning makes: what you export is exactly what was
pinned, not whatever the draft looks like right now.
"""

import io
import zipfile
from importlib import resources

from app.services.prs_export.serializer import (
    build_emitter_element,
    build_library_root,
    build_platform_element,
    sanitize_filename,
    to_xml_bytes,
)


def _template_bytes(filename: str) -> bytes:
    return resources.files("app.services.prs_export").joinpath("templates", filename).read_bytes()


def _write_emitter_files(zf: zipfile.ZipFile, written: set[str], links: list[dict]) -> None:
    for link in links:
        emitter_name = link["emitter_name"]
        if emitter_name in written:
            continue
        written.add(emitter_name)
        emitter_el = build_emitter_element(link["emitter_snapshot"])
        zf.writestr(f"emitters/{sanitize_filename(emitter_name)}.xml", to_xml_bytes(emitter_el))


def build_platform_export_zip(platform_snapshot: dict, *, platform_id: str) -> bytes:
    """A single Platform, exported standalone — the root library file uses
    the Platform's own id/name in place of a real MDF, since there isn't one
    in this scope.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("platforms/default_unknown_platform.xml", _template_bytes("default_unknown_platform.xml"))
        zf.writestr("emitters/default_unknown_emitter.xml", _template_bytes("default_unknown_emitter.xml"))

        written_emitters: set[str] = set()
        _write_emitter_files(zf, written_emitters, platform_snapshot.get("links", []))

        platform_el = build_platform_element(platform_snapshot)
        platform_name = platform_snapshot["name"]
        zf.writestr(f"platforms/{sanitize_filename(platform_name)}.xml", to_xml_bytes(platform_el))

        root_el = build_library_root(mdf_id=platform_id, mdf_name=platform_name)
        zf.writestr(f"{sanitize_filename(platform_name)}.xml", to_xml_bytes(root_el))

    return buffer.getvalue()


def build_mdf_export_zip(mdf_snapshot: dict, *, mdf_id: str) -> bytes:
    """A full MDF: every pinned Platform, and every Emitter pinned into each
    of those Platforms.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("platforms/default_unknown_platform.xml", _template_bytes("default_unknown_platform.xml"))
        zf.writestr("emitters/default_unknown_emitter.xml", _template_bytes("default_unknown_emitter.xml"))

        written_emitters: set[str] = set()
        written_platforms: set[str] = set()
        for link in mdf_snapshot.get("links", []):
            platform_snapshot = link["platform_snapshot"]
            _write_emitter_files(zf, written_emitters, platform_snapshot.get("links", []))

            platform_name = link["platform_name"]
            if platform_name not in written_platforms:
                written_platforms.add(platform_name)
                platform_el = build_platform_element(platform_snapshot)
                zf.writestr(f"platforms/{sanitize_filename(platform_name)}.xml", to_xml_bytes(platform_el))

        root_el = build_library_root(mdf_id=mdf_id, mdf_name=mdf_snapshot["name"])
        zf.writestr(f"{sanitize_filename(mdf_snapshot['name'])}.xml", to_xml_bytes(root_el))

    return buffer.getvalue()
