"""Dwells: Dwell Strategies (dwells for one or more Platforms, or none — a
default dwell; a Platform can have several) and dwell files that pin saved
versions of them, for an MDF's export (`dwells/<name>.xml`). Both are versioned and
audited like Platforms. Plus the app-wide settings an admin sets."""

from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings as app_config
from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.dwell import (
    DwellFile,
    DwellFileStrategy,
    DwellFileVersion,
    DwellStrategy,
    DwellStrategyNote,
    DwellStrategyPlatform,
    DwellStrategyVersion,
)
from app.models.mdf import Mdf, MdfPlatformLink
from app.models.platform import Platform
from app.models.test_record import PlatformTest, TestRecord
from app.schemas.dwell import (
    CommitDwellVersion,
    DwellDiffOut,
    DwellFileCreate,
    DwellFileLinkOut,
    DwellFileLinkUpdate,
    DwellFileOut,
    DwellFileSummary,
    DwellFileUpdate,
    DwellStrategyCreate,
    DwellStrategyOut,
    DwellStrategySummary,
    DwellStrategyUpdate,
    DwellVersionDetailOut,
    DwellVersionOut,
    PinStrategy,
    SettingsOut,
    SettingsUpdate,
    DwellStrategyNoteCreate,
    DwellStrategyNoteOut,
    StrategyTestUse,
    StrategyUse,
)
from app.services import app_settings
from app.services.audit_service import record_audit
from app.services.dwell_service import (
    commit_file,
    file_diff,
    file_snapshot,
    latest_file_version,
    latest_strategy_version,
    strategy_diff,
    strategy_snapshot,
)
from app.services.dwell_xml import (
    DEFAULT_COLLECT_TIME_MS,
    DEFAULT_RAPID_DF,
    DEFAULT_SPLIT_MODE,
    DwellXmlError,
    build_dwell_xml,
    parse_dwell_xml,
)
from app.services.prs_export.serializer import sanitize_filename

router = APIRouter(tags=["dwells"])


def _audit(db: Session, user, action: AuditAction, entity: AuditEntityType, entity_id, summary: str, changes=None):
    record_audit(
        db, actor_id=user.id, action=action, entity_type=entity.value, entity_id=entity_id, summary=summary, changes=changes
    )


def _platforms(db: Session, platform_ids: list[UUID]) -> list[Platform]:
    """The Platforms asked for, once each, in order."""
    out: list[Platform] = []
    for platform_id in dict.fromkeys(platform_ids):
        platform = db.get(Platform, platform_id)
        if platform is None or platform.is_deleted:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Platform not found")
        out.append(platform)
    return out


def _set_platforms(strategy: DwellStrategy, platforms: list[Platform]) -> None:
    """Make the Strategy cover exactly these Platforms, in this order —
    keeping the links it already has."""
    wanted = [p.id for p in platforms]
    by_platform = {link.platform_id: link for link in strategy.platform_links}
    for link in list(strategy.platform_links):
        if link.platform_id not in wanted:
            strategy.platform_links.remove(link)
    for i, platform in enumerate(platforms):
        link = by_platform.get(platform.id)
        if link is None:
            link = DwellStrategyPlatform(platform_id=platform.id, platform=platform)
            strategy.platform_links.append(link)
        link.sort_order = i
    strategy.platform_links.sort(key=lambda link: link.sort_order)


def _platforms_text(names: list[str]) -> str:
    return ", ".join(names) if names else "no Platform (a default dwell)"


def _mdf(db: Session, mdf_id: UUID | None) -> Mdf | None:
    if mdf_id is None:
        return None
    mdf = db.get(Mdf, mdf_id)
    if mdf is None or getattr(mdf, "is_deleted", False):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    return mdf


# ---------------------------------------------------------------- Strategies


def _strategy_or_404(db: Session, strategy_id: UUID) -> DwellStrategy:
    strategy = db.get(DwellStrategy, strategy_id)
    if strategy is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dwell Strategy not found")
    return strategy


def _strategy_name_free(db: Session, name: str, platforms: list[Platform], strategy_id=None) -> str:
    """No two Strategies of one name on the same Platform, nor two default
    dwells of one name."""
    name = name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Give the Strategy a name")
    ids = {p.id for p in platforms}
    for other in db.query(DwellStrategy).filter(DwellStrategy.name == name, DwellStrategy.id != strategy_id):
        shared = [link.platform.name for link in other.platform_links if link.platform_id in ids]
        if shared:
            raise HTTPException(status.HTTP_409_CONFLICT, f"{shared[0]} already has a Strategy called '{name}'")
        if not ids and other.is_default:
            raise HTTPException(status.HTTP_409_CONFLICT, f"There's already a default dwell called '{name}'")
    return name


def _commit_strategy(db: Session, strategy: DwellStrategy, summary: str | None, user_id) -> DwellStrategyVersion:
    db.flush()
    db.refresh(strategy)
    number = (
        db.query(func.max(DwellStrategyVersion.version_number))
        .filter(DwellStrategyVersion.strategy_id == strategy.id)
        .scalar()
        or 0
    ) + 1
    version = DwellStrategyVersion(
        strategy_id=strategy.id,
        version_number=number,
        snapshot=strategy_snapshot(strategy),
        change_summary=summary,
        created_by=user_id,
    )
    db.add(version)
    db.flush()
    return version


def _strategy_out(db: Session, strategy: DwellStrategy) -> DwellStrategyOut:
    latest = latest_strategy_version(db, strategy.id)
    links = db.query(DwellFileStrategy).filter(DwellFileStrategy.strategy_id == strategy.id).all()
    return DwellStrategyOut(
        id=strategy.id,
        name=strategy.name,
        platform_ids=strategy.platform_ids,
        platform_names=strategy.platform_names,
        is_default=strategy.is_default,
        description=strategy.description,
        manual_collect_time_ms=strategy.manual_collect_time_ms,
        dwells=strategy.dwells or [],
        rapid_df=strategy.rapid_df,
        split_mode=strategy.split_mode,
        bandwidth_mhz=strategy.bandwidth_mhz,
        latest_version_number=latest.version_number if latest else None,
        unsaved=latest is None or latest.snapshot != strategy_snapshot(strategy),
        used_in=sorted(
            (
                StrategyUse(
                    link_id=link.id,
                    file_id=link.dwell_file_id,
                    file_name=link.dwell_file.name,
                    pinned_version_number=link.strategy_version.version_number,
                    outdated=latest is not None and link.strategy_version.version_number < latest.version_number,
                )
                for link in links
            ),
            key=lambda u: u.file_name.lower(),
        ),
        tests=_strategy_tests(db, strategy.id),
        created_at=strategy.created_at,
        updated_at=strategy.updated_at,
    )


def _strategy_tests(db: Session, strategy_id: UUID) -> list[StrategyTestUse]:
    """Test runs that recorded a version of the Strategy, newest first: a
    Platform's run once (not each Emitter's record in it)."""
    uses = [
        StrategyTestUse(
            kind="platform", id=t.id, owner_id=t.platform_id, title=t.title, test_date=t.test_date, version_number=n
        )
        for t, n in db.query(PlatformTest, DwellStrategyVersion.version_number)
        .join(DwellStrategyVersion, PlatformTest.dwell_strategy_version_id == DwellStrategyVersion.id)
        .filter(DwellStrategyVersion.strategy_id == strategy_id)
    ]
    uses += [
        StrategyTestUse(
            kind=r.scope_type.value, id=r.id, owner_id=r.scope_id, title=r.title, test_date=r.test_date, version_number=n
        )
        for r, n in db.query(TestRecord, DwellStrategyVersion.version_number)
        .join(DwellStrategyVersion, TestRecord.dwell_strategy_version_id == DwellStrategyVersion.id)
        .filter(DwellStrategyVersion.strategy_id == strategy_id, TestRecord.platform_test_id.is_(None))
    ]
    return sorted(uses, key=lambda u: u.test_date, reverse=True)


@router.get("/dwell-strategies", response_model=list[DwellStrategySummary])
def list_strategies(
    platform_id: UUID | None = None,
    include_default: bool = False,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[DwellStrategySummary]:
    """Every Strategy; with platform_id, those covering that Platform (and
    with include_default, the default dwells too)."""
    query = db.query(DwellStrategy)
    if platform_id is not None:
        covers = DwellStrategy.platform_links.any(DwellStrategyPlatform.platform_id == platform_id)
        query = query.filter(covers | ~DwellStrategy.platform_links.any()) if include_default else query.filter(covers)
    strategies = query.all()
    latest = {
        sid: (n, snap, vid)
        for sid, n, snap, vid in db.query(
            DwellStrategyVersion.strategy_id,
            DwellStrategyVersion.version_number,
            DwellStrategyVersion.snapshot,
            DwellStrategyVersion.id,
        )
        .distinct(DwellStrategyVersion.strategy_id)
        .order_by(DwellStrategyVersion.strategy_id, DwellStrategyVersion.version_number.desc())
        .all()
    }
    used: dict = {}
    for sid, name in db.query(DwellFileStrategy.strategy_id, DwellFile.name).join(DwellFile).all():
        used.setdefault(sid, []).append(name)
    out = []
    for s in strategies:
        freqs = [d["freq_mhz"] for d in s.dwells or []]
        version = latest.get(s.id)
        out.append(
            DwellStrategySummary(
                id=s.id,
                name=s.name,
                platform_ids=s.platform_ids,
                platform_names=s.platform_names,
                is_default=s.is_default,
                description=s.description,
                dwell_count=len(s.dwells or []),
                cycle_ms=sum(d["dwell_time_ms"] for d in s.dwells or []),
                lowest_mhz=min(freqs) if freqs else None,
                highest_mhz=max(freqs) if freqs else None,
                latest_version_number=version[0] if version else None,
                latest_version_id=version[2] if version else None,
                unsaved=version is None or version[1] != strategy_snapshot(s),
                used_in=sorted(used.get(s.id, []), key=str.lower),
                updated_at=s.updated_at,
            )
        )
    # Default dwells first, then by Platform.
    return sorted(out, key=lambda s: (not s.is_default, ", ".join(s.platform_names).lower(), s.name.lower()))


@router.post(
    "/dwell-strategies", response_model=DwellStrategyOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def create_strategy(
    payload: DwellStrategyCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> DwellStrategyOut:
    platforms = _platforms(db, [*payload.platform_ids, *([payload.platform_id] if payload.platform_id else [])])
    name = _strategy_name_free(db, payload.name, platforms)
    source = _strategy_or_404(db, payload.copy_from_id) if payload.copy_from_id else None
    strategy = DwellStrategy(
        name=name,
        description=(payload.description or "").strip() or (source.description if source else None),
        manual_collect_time_ms=source.manual_collect_time_ms if source else DEFAULT_COLLECT_TIME_MS,
        dwells=list(source.dwells or []) if source else [],
        rapid_df=dict(source.rapid_df) if source and source.rapid_df is not None else dict(DEFAULT_RAPID_DF),
        split_mode=(
            [dict(d) for d in source.split_mode]
            if source and source.split_mode is not None
            else [dict(d, freqs=list(d["freqs"])) for d in DEFAULT_SPLIT_MODE]
        ),
        bandwidth_mhz=source.bandwidth_mhz if source else None,
        created_by=user.id,
    )
    _set_platforms(strategy, platforms)
    db.add(strategy)
    db.flush()
    _commit_strategy(db, strategy, f"Copied from '{source.name}'" if source else "Created", user.id)
    _audit(
        db, user, AuditAction.create, AuditEntityType.dwell_strategy, strategy.id,
        f"Created Dwell Strategy '{name}' for {_platforms_text([p.name for p in platforms])}"
        + (f" (a copy of '{source.name}')" if source else ""),
    )
    db.commit()
    db.refresh(strategy)
    return _strategy_out(db, strategy)


@router.get("/dwell-strategies/{strategy_id}", response_model=DwellStrategyOut)
def get_strategy(strategy_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> DwellStrategyOut:
    return _strategy_out(db, _strategy_or_404(db, strategy_id))


@router.patch("/dwell-strategies/{strategy_id}", response_model=DwellStrategyOut, dependencies=[Depends(verify_csrf)])
def update_strategy(
    strategy_id: UUID, payload: DwellStrategyUpdate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> DwellStrategyOut:
    strategy = _strategy_or_404(db, strategy_id)
    fields = payload.model_dump(exclude_unset=True, exclude={"save_version", "change_summary", "platform_ids"})
    if "description" in fields:
        fields["description"] = (fields["description"] or "").strip() or None
    if payload.dwells is not None:
        # Whole entries, defaults included (exclude_unset drops them inside).
        fields["dwells"] = [d.model_dump() for d in payload.dwells]
    changing_platforms = payload.platform_ids is not None and list(dict.fromkeys(payload.platform_ids)) != strategy.platform_ids
    platforms = (
        _platforms(db, payload.platform_ids)
        if changing_platforms
        else [link.platform for link in strategy.platform_links]
    )
    if "name" in fields or changing_platforms:
        fields["name"] = _strategy_name_free(db, fields.get("name", strategy.name), platforms, strategy.id)
    changes = {}
    if changing_platforms:
        old_names = strategy.platform_names
        _set_platforms(strategy, platforms)
        changes["platforms"] = {"old": _platforms_text(old_names), "new": _platforms_text([p.name for p in platforms])}
    for key, value in fields.items():
        if key in ("manual_collect_time_ms",) and value is None:
            continue
        old = getattr(strategy, key)
        if old != value:
            changes[key] = {"old": old if key == "dwells" else (str(old) if old is not None else None),
                            "new": value if key == "dwells" else (str(value) if value is not None else None)}
            setattr(strategy, key, value)
    if changes:
        _audit(
            db, user, AuditAction.update, AuditEntityType.dwell_strategy, strategy.id,
            f"Updated Dwell Strategy '{strategy.name}'"
            + (f" — {', '.join(sorted(k.replace('_', ' ') for k in changes))}" if changes else ""),
            changes,
        )
    if payload.save_version:
        db.flush()
        latest = latest_strategy_version(db, strategy.id)
        if latest is None or latest.snapshot != strategy_snapshot(strategy):
            version = _commit_strategy(db, strategy, (payload.change_summary or "").strip() or None, user.id)
            _audit(
                db, user, AuditAction.commit, AuditEntityType.dwell_strategy, strategy.id,
                f"Saved Dwell Strategy '{strategy.name}' as v{version.version_number}",
            )
    db.commit()
    db.refresh(strategy)
    return _strategy_out(db, strategy)


@router.get("/dwell-strategies/{strategy_id}/notes", response_model=list[DwellStrategyNoteOut])
def list_strategy_notes(
    strategy_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[DwellStrategyNote]:
    """Newest-first analyst notes, like a Platform's."""
    _strategy_or_404(db, strategy_id)
    return (
        db.query(DwellStrategyNote)
        .filter(DwellStrategyNote.strategy_id == strategy_id)
        .order_by(DwellStrategyNote.created_at.desc())
        .all()
    )


@router.post(
    "/dwell-strategies/{strategy_id}/notes",
    response_model=DwellStrategyNoteOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_strategy_note(
    strategy_id: UUID, payload: DwellStrategyNoteCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> DwellStrategyNote:
    strategy = _strategy_or_404(db, strategy_id)
    note = DwellStrategyNote(strategy_id=strategy.id, author_id=user.id, body=payload.body)
    db.add(note)
    db.flush()
    _audit(db, user, AuditAction.create, AuditEntityType.dwell_strategy_note, note.id, f"Added a note to Dwell Strategy '{strategy.name}'")
    db.commit()
    db.refresh(note)
    return note


@router.delete(
    "/dwell-strategies/{strategy_id}/notes/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(verify_csrf)],
)
def delete_strategy_note(
    strategy_id: UUID, note_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> None:
    strategy = _strategy_or_404(db, strategy_id)
    note = db.get(DwellStrategyNote, note_id)
    if note is None or note.strategy_id != strategy.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    _audit(
        db, user, AuditAction.delete, AuditEntityType.dwell_strategy_note, note.id,
        f"Deleted a note from Dwell Strategy '{strategy.name}'", {"body": note.body},
    )
    db.delete(note)
    db.commit()


@router.delete("/dwell-strategies/{strategy_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_strategy(strategy_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))) -> None:
    strategy = _strategy_or_404(db, strategy_id)
    files = [link.dwell_file.name for link in db.query(DwellFileStrategy).filter(DwellFileStrategy.strategy_id == strategy.id)]
    if files:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"It's in {len(files)} dwell file(s): {', '.join(sorted(files))} — remove it there first"
        )
    version_ids = [v.id for v in strategy.versions]
    tested = (
        db.query(TestRecord).filter(TestRecord.dwell_strategy_version_id.in_(version_ids)).count()
        + db.query(PlatformTest).filter(PlatformTest.dwell_strategy_version_id.in_(version_ids)).count()
        if version_ids
        else 0
    )
    if tested:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{tested} test run(s) record it as the dwell they used — it's kept")
    _audit(db, user, AuditAction.delete, AuditEntityType.dwell_strategy, strategy.id, f"Deleted Dwell Strategy '{strategy.name}'")
    db.delete(strategy)
    db.commit()


@router.post(
    "/dwell-strategies/{strategy_id}/versions",
    response_model=DwellVersionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def commit_strategy_version(
    strategy_id: UUID, payload: CommitDwellVersion, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> DwellStrategyVersion:
    strategy = _strategy_or_404(db, strategy_id)
    summary = (payload.change_summary or "").strip() or None
    version = _commit_strategy(db, strategy, summary, user.id)
    _audit(
        db, user, AuditAction.commit, AuditEntityType.dwell_strategy, strategy.id,
        f"Saved v{version.version_number} of Dwell Strategy '{strategy.name}'" + (f" — {summary}" if summary else ""),
    )
    db.commit()
    db.refresh(version)
    return version


@router.get("/dwell-strategies/{strategy_id}/versions", response_model=list[DwellVersionOut])
def list_strategy_versions(strategy_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))):
    return _strategy_or_404(db, strategy_id).versions


@router.get("/dwell-strategies/{strategy_id}/versions/{number}", response_model=DwellVersionDetailOut)
def get_strategy_version(strategy_id: UUID, number: int, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))):
    version = next((v for v in _strategy_or_404(db, strategy_id).versions if v.version_number == number), None)
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    return version


@router.get("/dwell-strategies/{strategy_id}/versions/{number}/diff", response_model=DwellDiffOut)
def diff_strategy_version(
    strategy_id: UUID, number: int, against: int | None = None, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> DwellDiffOut:
    versions = {v.version_number: v for v in _strategy_or_404(db, strategy_id).versions}
    base = against if against is not None else number - 1
    if number not in versions or base not in versions:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    entries = strategy_diff(versions[base].snapshot, versions[number].snapshot)
    return DwellDiffOut(entries=entries, identical=not entries)


# ---------------------------------------------------------------- Dwell files


def _file_or_404(db: Session, file_id: UUID) -> DwellFile:
    dwell_file = db.get(DwellFile, file_id)
    if dwell_file is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dwell file not found")
    return dwell_file


def _file_name_free(db: Session, name: str, file_id=None) -> str:
    name = name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Give the dwell file a name")
    clash = db.query(DwellFile).filter(DwellFile.name == name).first()
    if clash is not None and clash.id != file_id:
        raise HTTPException(status.HTTP_409_CONFLICT, f"There's already a dwell file called '{name}'")
    return name


def _file_out(db: Session, dwell_file: DwellFile) -> DwellFileOut:
    pinned = None
    if dwell_file.mdf_id is not None:
        pinned = {
            pid
            for (pid,) in db.query(MdfPlatformLink.platform_id).filter(MdfPlatformLink.mdf_id == dwell_file.mdf_id).all()
        }
    latest = latest_file_version(db, dwell_file.id)
    links = []
    for link in dwell_file.links:
        newest = latest_strategy_version(db, link.strategy_id)
        strategy = link.strategy
        links.append(
            DwellFileLinkOut(
                id=link.id,
                strategy_id=strategy.id,
                strategy_name=strategy.name,
                platform_ids=strategy.platform_ids,
                platform_names=strategy.platform_names,
                is_default=strategy.is_default,
                platforms_not_in_mdf=(
                    [link.platform.name for link in strategy.platform_links if link.platform_id not in pinned]
                    if pinned is not None
                    else None
                ),
                pinned_version_id=link.strategy_version_id,
                pinned_version_number=link.strategy_version.version_number,
                latest_version_number=newest.version_number,
                outdated=link.strategy_version.version_number < newest.version_number,
                sort_order=link.sort_order,
                dwells=link.strategy_version.snapshot.get("dwells") or [],
            )
        )
    return DwellFileOut(
        id=dwell_file.id,
        name=dwell_file.name,
        mdf_id=dwell_file.mdf_id,
        mdf_name=dwell_file.mdf.name if dwell_file.mdf else None,
        timeout=dwell_file.timeout,
        setup_time=dwell_file.setup_time,
        notes=dwell_file.notes,
        latest_version_number=latest.version_number if latest else None,
        unsaved=latest is None or latest.snapshot != file_snapshot(dwell_file),
        links=links,
        created_at=dwell_file.created_at,
        updated_at=dwell_file.updated_at,
    )


def _pin(db: Session, dwell_file: DwellFile, strategy: DwellStrategy, version: DwellStrategyVersion | None) -> DwellFileStrategy:
    if any(link.strategy_id == strategy.id for link in dwell_file.links):
        raise HTTPException(status.HTTP_409_CONFLICT, f"'{strategy.name}' is already in this file")
    version = version or latest_strategy_version(db, strategy.id)
    if version is None or version.strategy_id != strategy.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick a saved version of that Strategy")
    link = DwellFileStrategy(
        strategy_id=strategy.id,
        strategy_version_id=version.id,
        sort_order=max((o.sort_order for o in dwell_file.links), default=-1) + 1,
    )
    dwell_file.links.append(link)
    return link


@router.get("/dwell-files", response_model=list[DwellFileSummary])
def list_files(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[DwellFileSummary]:
    out = []
    for f in db.query(DwellFile).order_by(DwellFile.name).all():
        latest = latest_file_version(db, f.id)
        outdated = 0
        for link in f.links:
            newest = latest_strategy_version(db, link.strategy_id)
            outdated += int(link.strategy_version.version_number < newest.version_number)
        out.append(
            DwellFileSummary(
                id=f.id,
                name=f.name,
                mdf_id=f.mdf_id,
                mdf_name=f.mdf.name if f.mdf else None,
                strategy_count=len(f.links),
                platform_names=list(dict.fromkeys(n for link in f.links for n in link.strategy.platform_names)),
                outdated_count=outdated,
                latest_version_number=latest.version_number if latest else None,
                unsaved=latest is None or latest.snapshot != file_snapshot(f),
                updated_at=f.updated_at,
            )
        )
    return out


@router.post("/dwell-files", response_model=DwellFileOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_file(payload: DwellFileCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))) -> DwellFileOut:
    name = _file_name_free(db, payload.name)
    _mdf(db, payload.mdf_id)
    dwell_file = DwellFile(name=name, mdf_id=payload.mdf_id, timeout=5, setup_time=5, created_by=user.id)
    db.add(dwell_file)
    db.flush()
    commit_file(db, dwell_file, "Created", user.id)
    _audit(db, user, AuditAction.create, AuditEntityType.dwell_file, dwell_file.id, f"Created dwell file '{name}'")
    db.commit()
    db.refresh(dwell_file)
    return _file_out(db, dwell_file)


@router.post(
    "/dwell-files/import", response_model=DwellFileOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def import_file(
    file: UploadFile = File(...),
    name: str | None = Form(None),
    mdf_id: UUID | None = Form(None),
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> DwellFileOut:
    """A dwell file from its XML: each Strategy in it becomes a Strategy of
    its own (named after the file; its Platform picked afterwards), pinned
    into the new file."""
    content = file.file.read(app_config.max_upload_bytes + 1)
    if len(content) > app_config.max_upload_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "The file is larger than the upload limit")
    try:
        parsed = parse_dwell_xml(content)
    except DwellXmlError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    default_name = (file.filename or "Dwell file").rsplit("/", 1)[-1].removesuffix(".xml")
    name = _file_name_free(db, name or default_name)
    _mdf(db, mdf_id)
    dwell_file = DwellFile(
        name=name, mdf_id=mdf_id, timeout=parsed["timeout"], setup_time=parsed["setup_time"], created_by=user.id
    )
    db.add(dwell_file)
    db.flush()
    for i, s in enumerate(parsed["strategies"], start=1):
        strategy = DwellStrategy(name=f"{name} — Strategy {i}", created_by=user.id, **s)
        db.add(strategy)
        db.flush()
        version = _commit_strategy(db, strategy, f"Imported from '{name}'", user.id)
        _pin(db, dwell_file, strategy, version)
    commit_file(db, dwell_file, "Imported", user.id)
    _audit(
        db, user, AuditAction.create, AuditEntityType.dwell_file, dwell_file.id,
        f"Imported dwell file '{name}' ({len(parsed['strategies'])} Strategies)",
    )
    db.commit()
    db.refresh(dwell_file)
    return _file_out(db, dwell_file)


@router.get("/dwell-files/{file_id}", response_model=DwellFileOut)
def get_file(file_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> DwellFileOut:
    return _file_out(db, _file_or_404(db, file_id))


@router.patch("/dwell-files/{file_id}", response_model=DwellFileOut, dependencies=[Depends(verify_csrf)])
def update_file(
    file_id: UUID, payload: DwellFileUpdate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> DwellFileOut:
    dwell_file = _file_or_404(db, file_id)
    fields = payload.model_dump(exclude_unset=True)
    if "name" in fields:
        fields["name"] = _file_name_free(db, fields["name"], dwell_file.id)
    if "mdf_id" in fields:
        _mdf(db, fields["mdf_id"])
    changes = {}
    for key, value in fields.items():
        if key in ("timeout", "setup_time") and value is None:
            continue
        old = getattr(dwell_file, key)
        if old != value:
            changes[key] = {"old": str(old) if old is not None else None, "new": str(value) if value is not None else None}
            setattr(dwell_file, key, value)
    if changes:
        _audit(
            db, user, AuditAction.update, AuditEntityType.dwell_file, dwell_file.id,
            f"Updated dwell file '{dwell_file.name}' — {', '.join(sorted(k.replace('_id', '').replace('_', ' ') for k in changes))}",
            changes,
        )
    db.commit()
    db.refresh(dwell_file)
    return _file_out(db, dwell_file)


@router.delete("/dwell-files/{file_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_file(file_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))) -> None:
    dwell_file = _file_or_404(db, file_id)
    _audit(db, user, AuditAction.delete, AuditEntityType.dwell_file, dwell_file.id, f"Deleted dwell file '{dwell_file.name}'")
    db.delete(dwell_file)
    db.commit()


@router.get("/dwell-files/{file_id}/xml")
def download_file_xml(
    file_id: UUID, version: int | None = None, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> Response:
    """The file as it stands now, or a saved version of it."""
    dwell_file = _file_or_404(db, file_id)
    if version is None:
        snapshot = file_snapshot(dwell_file)
    else:
        saved = next((v for v in dwell_file.versions if v.version_number == version), None)
        if saved is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
        snapshot = saved.snapshot
    return Response(
        content=build_dwell_xml(snapshot),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{sanitize_filename(dwell_file.name)}.xml"'},
    )


@router.post("/dwell-files/{file_id}/strategies", response_model=DwellFileOut, dependencies=[Depends(verify_csrf)])
def pin_strategy(
    file_id: UUID, payload: PinStrategy, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> DwellFileOut:
    dwell_file = _file_or_404(db, file_id)
    strategy = _strategy_or_404(db, payload.strategy_id)
    version = db.get(DwellStrategyVersion, payload.strategy_version_id) if payload.strategy_version_id else None
    if payload.strategy_version_id and version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    link = _pin(db, dwell_file, strategy, version)
    db.flush()
    _audit(
        db, user, AuditAction.create, AuditEntityType.dwell_file, dwell_file.id,
        f"Added Strategy '{strategy.name}' v{link.strategy_version.version_number} to dwell file '{dwell_file.name}'",
    )
    db.commit()
    db.refresh(dwell_file)
    return _file_out(db, dwell_file)


@router.post("/dwell-files/{file_id}/strategies/repin-latest", response_model=DwellFileOut, dependencies=[Depends(verify_csrf)])
def repin_latest(file_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))) -> DwellFileOut:
    dwell_file = _file_or_404(db, file_id)
    moved = []
    for link in dwell_file.links:
        newest = latest_strategy_version(db, link.strategy_id)
        if newest.id != link.strategy_version_id:
            moved.append(f"'{link.strategy.name}' v{link.strategy_version.version_number}→v{newest.version_number}")
            link.strategy_version_id = newest.id
    if moved:
        _audit(
            db, user, AuditAction.update, AuditEntityType.dwell_file, dwell_file.id,
            f"Repinned {len(moved)} Strateg{'y' if len(moved) == 1 else 'ies'} in dwell file '{dwell_file.name}' to their latest: {', '.join(moved)}",
        )
    db.commit()
    db.refresh(dwell_file)
    return _file_out(db, dwell_file)


@router.patch("/dwell-file-strategies/{link_id}", response_model=DwellFileOut, dependencies=[Depends(verify_csrf)])
def update_link(
    link_id: UUID, payload: DwellFileLinkUpdate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> DwellFileOut:
    link = db.get(DwellFileStrategy, link_id)
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not in a dwell file")
    dwell_file = link.dwell_file
    if payload.strategy_version_id is not None and payload.strategy_version_id != link.strategy_version_id:
        version = db.get(DwellStrategyVersion, payload.strategy_version_id)
        if version is None or version.strategy_id != link.strategy_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Pick a saved version of that Strategy")
        _audit(
            db, user, AuditAction.update, AuditEntityType.dwell_file, dwell_file.id,
            f"Repinned Strategy '{link.strategy.name}' in dwell file '{dwell_file.name}': "
            f"v{link.strategy_version.version_number} → v{version.version_number}",
        )
        link.strategy_version_id = version.id
    if payload.sort_order is not None:
        link.sort_order = payload.sort_order
    db.commit()
    db.refresh(dwell_file)
    return _file_out(db, dwell_file)


@router.delete("/dwell-file-strategies/{link_id}", response_model=DwellFileOut, dependencies=[Depends(verify_csrf)])
def unpin_strategy(link_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))) -> DwellFileOut:
    link = db.get(DwellFileStrategy, link_id)
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not in a dwell file")
    dwell_file = link.dwell_file
    _audit(
        db, user, AuditAction.delete, AuditEntityType.dwell_file, dwell_file.id,
        f"Removed Strategy '{link.strategy.name}' from dwell file '{dwell_file.name}'",
    )
    dwell_file.links.remove(link)
    db.commit()
    db.refresh(dwell_file)
    return _file_out(db, dwell_file)


@router.post(
    "/dwell-files/{file_id}/versions",
    response_model=DwellVersionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def commit_file_version(
    file_id: UUID, payload: CommitDwellVersion, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> DwellFileVersion:
    dwell_file = _file_or_404(db, file_id)
    summary = (payload.change_summary or "").strip() or None
    version = commit_file(db, dwell_file, summary, user.id)
    _audit(
        db, user, AuditAction.commit, AuditEntityType.dwell_file, dwell_file.id,
        f"Saved v{version.version_number} of dwell file '{dwell_file.name}'" + (f" — {summary}" if summary else ""),
    )
    db.commit()
    db.refresh(version)
    return version


@router.get("/dwell-files/{file_id}/versions", response_model=list[DwellVersionOut])
def list_file_versions(file_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))):
    return _file_or_404(db, file_id).versions


@router.get("/dwell-files/{file_id}/versions/{number}", response_model=DwellVersionDetailOut)
def get_file_version(file_id: UUID, number: int, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))):
    version = next((v for v in _file_or_404(db, file_id).versions if v.version_number == number), None)
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    return version


@router.get("/dwell-files/{file_id}/versions/{number}/diff", response_model=DwellDiffOut)
def diff_file_version(
    file_id: UUID, number: int, against: int | None = None, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> DwellDiffOut:
    versions = {v.version_number: v for v in _file_or_404(db, file_id).versions}
    base = against if against is not None else number - 1
    if number not in versions or base not in versions:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    entries = file_diff(versions[base].snapshot, versions[number].snapshot)
    return DwellDiffOut(entries=entries, identical=not entries)


# ---------------------------------------------------------------- Settings


@router.get("/settings", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> dict:
    return app_settings.all_settings(db)


_MODE_DEFAULT_LABELS = {
    "confirmation_quality": ("confirmation quality", "%"),
    "confirmation_quantity": ("confirmation quantity", ""),
    "frame_time_delta_us": ("frame-time margin", " µs"),
    "rf_delta": ("RF margin", " MHz"),
    "pri_delta": ("PRI margin", " µs"),
    "pw_delta": ("PW margin", " µs"),
}


def _setting_summary(key: str, old, new) -> str:
    if key != app_settings.MODE_DEFAULTS:
        return f"Changed setting {key}"
    old = {**app_settings.MODE_DEFAULT_VALUES, **(old or {})}
    parts = [
        f"{label} {old.get(k):g}{unit} → {new[k]:g}{unit}"
        for k, (label, unit) in _MODE_DEFAULT_LABELS.items()
        if old.get(k) != new.get(k)
    ]
    return "Changed the Mode defaults: " + ", ".join(parts)


@router.patch("/settings", response_model=SettingsOut, dependencies=[Depends(verify_csrf)])
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))) -> dict:
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        old = app_settings.get_setting(db, key)
        if old != value:
            app_settings.set_setting(db, key, value, user.id)
            _audit(db, user, AuditAction.update, AuditEntityType.setting, None, _setting_summary(key, old, value), {key: {"old": old, "new": value}})
    db.commit()
    return app_settings.all_settings(db)
