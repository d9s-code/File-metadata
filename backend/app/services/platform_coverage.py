"""What each Emitter pinned on a Platform (or, through its Platforms, an MDF) covers — its Modes' RF, PRI and PW
ranges as of the pinned version, raw and engineered (± delta), for the
Platform's charts. Modes whose Sources were all rejected are left out, as in
the export."""

from uuid import UUID

from sqlalchemy.orm import Session

from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.mdf import MdfPlatformLink
from app.models.platform import Platform, PlatformEmitterLink, PlatformVersion
from app.services.delta import apply_delta
from app.services.frametime_service import effective_frametime_us
from app.services.mode_sources import all_rejected, mode_source_ids
from app.services.snapshots import rejected_source_ids


def _span(lo, hi):
    if lo is None or hi is None:
        return None
    lo, hi = float(lo), float(hi)
    return [min(lo, hi), max(lo, hi)]


def _mode_ranges(mode: dict) -> dict | None:
    line = mode.get("line")
    if not line:
        return None
    pri_type = mode.get("pri_type")
    rf_raw = _span(line.get("rf_min_mhz"), line.get("rf_max_mhz"))
    if rf_raw is None:
        return None
    out = {
        "id": str(mode["id"]) if mode.get("id") else None,
        "name": mode["name"],
        "pri_type": pri_type,
        "rf_raw": rf_raw,
        "rf": _span(*apply_delta(rf_raw[0], rf_raw[1], line.get("rf_delta"))),
        "pri_raw": None,
        "pri": None,
        "pw_raw": None,
        "pw": None,
    }
    if pri_type != "cw":
        pw_raw = _span(line.get("pw_min_us"), line.get("pw_max_us"))
        if pw_raw:
            out["pw_raw"] = pw_raw
            out["pw"] = _span(*apply_delta(pw_raw[0], pw_raw[1], line.get("pw_delta")))
    if pri_type == "fixed":
        pri_raw = _span(line.get("pri_min_us"), line.get("pri_max_us"))
        if pri_raw:
            out["pri_raw"] = pri_raw
            out["pri"] = _span(*apply_delta(pri_raw[0], pri_raw[1], line.get("pri_delta")))
    elif pri_type == "stagger":
        frame = effective_frametime_us(line.get("pri_stagger_values_us"), line.get("explicit_frame_time_us"))
        if frame is not None:
            out["pri_raw"] = [frame, frame]
            out["pri"] = _span(*apply_delta(frame, frame, line.get("frame_time_delta_us")))
    return out


def emitter_coverage(snapshot: dict, *, emitter_id, emitter_name: str, designation, version_number: int) -> dict:
    """One Emitter version's coverage from its snapshot."""
    rejected = rejected_source_ids(snapshot)
    modes = [
        ranges
        for group in snapshot.get("ew_groups", [])
        for mode in group.get("modes", [])
        if not all_rejected(mode_source_ids(mode), rejected) and (ranges := _mode_ranges(mode)) is not None
    ]
    return {
        "emitter_id": emitter_id,
        "emitter_name": emitter_name,
        "designation": designation,
        "version_number": version_number,
        "modes": modes,
    }


def _by_designation(entries: list[dict]) -> list[dict]:
    return sorted(entries, key=lambda e: ((e["designation"] or "\uffff").lower(), e["emitter_name"].lower()))


def platform_coverage(db: Session, platform_id: UUID) -> list[dict]:
    links = (
        db.query(PlatformEmitterLink, EmitterVersion, Emitter)
        .join(EmitterVersion, PlatformEmitterLink.emitter_version_id == EmitterVersion.id)
        .join(Emitter, PlatformEmitterLink.emitter_id == Emitter.id)
        .filter(PlatformEmitterLink.platform_id == platform_id)
        .all()
    )
    return _by_designation(
        [
            emitter_coverage(
                version.snapshot,
                emitter_id=emitter.id,
                emitter_name=emitter.name,
                designation=emitter.designation,
                version_number=version.version_number,
            )
            for _link, version, emitter in links
        ]
    )


def mdf_coverage(db: Session, mdf_id: UUID) -> list[dict]:
    """Each Platform version pinned on an MDF, with what its pinned Emitter
    versions cover — as recorded in that Platform version."""
    links = (
        db.query(MdfPlatformLink, PlatformVersion, Platform)
        .join(PlatformVersion, MdfPlatformLink.platform_version_id == PlatformVersion.id)
        .join(Platform, MdfPlatformLink.platform_id == Platform.id)
        .filter(MdfPlatformLink.mdf_id == mdf_id)
        .all()
    )
    out = []
    for _link, version, platform in links:
        emitters = [
            emitter_coverage(
                el["emitter_snapshot"],
                emitter_id=el["emitter_id"],
                emitter_name=el["emitter_name"],
                designation=el["emitter_snapshot"].get("designation"),
                version_number=el.get("emitter_version_number") or 0,
            )
            for el in version.snapshot.get("links", [])
        ]
        out.append(
            {
                "platform_id": platform.id,
                "platform_name": platform.name,
                "version_number": version.version_number,
                "emitters": _by_designation(emitters),
            }
        )
    out.sort(key=lambda p: p["platform_name"].lower())
    return out
