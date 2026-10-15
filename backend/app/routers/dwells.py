"""Dwell files: one Dwell Strategy per Platform, the Merged Mode dwells
edited here; imported from and written as `dwells/<name>.xml`. Plus the
app-wide settings an admin sets (the dwell charts' default bandwidth)."""

from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.config import settings as app_config
from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.dwell import DwellFile, DwellStrategy
from app.models.mdf import Mdf, MdfPlatformLink
from app.models.platform import Platform
from app.schemas.dwell import (
    DwellFileCreate,
    DwellFileOut,
    DwellFileSummary,
    DwellFileUpdate,
    DwellStrategyCreate,
    DwellStrategyOut,
    DwellStrategyUpdate,
    SettingsOut,
    SettingsUpdate,
)
from app.services import app_settings
from app.services.audit_service import record_audit
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


def _file_or_404(db: Session, file_id: UUID) -> DwellFile:
    dwell_file = db.get(DwellFile, file_id)
    if dwell_file is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dwell file not found")
    return dwell_file


def _strategy_or_404(db: Session, strategy_id: UUID) -> DwellStrategy:
    strategy = db.get(DwellStrategy, strategy_id)
    if strategy is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dwell Strategy not found")
    return strategy


def _check_mdf(db: Session, mdf_id: UUID | None) -> Mdf | None:
    if mdf_id is None:
        return None
    mdf = db.get(Mdf, mdf_id)
    if mdf is None or getattr(mdf, "is_deleted", False):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    return mdf


def _check_platform(db: Session, dwell_file: DwellFile, platform_id: UUID | None, strategy_id=None) -> Platform | None:
    if platform_id is None:
        return None
    platform = db.get(Platform, platform_id)
    if platform is None or platform.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Platform not found")
    taken = next((s for s in dwell_file.strategies if s.platform_id == platform_id and s.id != strategy_id), None)
    if taken is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"'{platform.name}' already has a Dwell Strategy in this file — one per Platform"
        )
    return platform


def _name_free(db: Session, name: str, file_id=None) -> str:
    name = name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Give the dwell file a name")
    clash = db.query(DwellFile).filter(DwellFile.name == name).first()
    if clash is not None and clash.id != file_id:
        raise HTTPException(status.HTTP_409_CONFLICT, f"There's already a dwell file called '{name}'")
    return name


def _out(db: Session, dwell_file: DwellFile) -> DwellFileOut:
    pinned = None
    if dwell_file.mdf_id is not None:
        pinned = {
            pid
            for (pid,) in db.query(MdfPlatformLink.platform_id).filter(MdfPlatformLink.mdf_id == dwell_file.mdf_id).all()
        }
    return DwellFileOut(
        id=dwell_file.id,
        name=dwell_file.name,
        mdf_id=dwell_file.mdf_id,
        mdf_name=dwell_file.mdf.name if dwell_file.mdf else None,
        timeout=dwell_file.timeout,
        setup_time=dwell_file.setup_time,
        bandwidth_mhz=dwell_file.bandwidth_mhz,
        notes=dwell_file.notes,
        created_at=dwell_file.created_at,
        updated_at=dwell_file.updated_at,
        strategies=[
            DwellStrategyOut(
                id=s.id,
                platform_id=s.platform_id,
                platform_name=s.platform.name if s.platform else None,
                platform_in_mdf=(s.platform_id in pinned) if pinned is not None and s.platform_id else None,
                sort_order=s.sort_order,
                manual_collect_time_ms=s.manual_collect_time_ms,
                merged_mode=s.merged_mode or [],
                rapid_df=s.rapid_df,
                split_mode=s.split_mode,
            )
            for s in dwell_file.strategies
        ],
    )


def _audit(db: Session, user, action: AuditAction, entity: AuditEntityType, entity_id, summary: str, changes=None):
    record_audit(
        db, actor_id=user.id, action=action, entity_type=entity.value, entity_id=entity_id, summary=summary, changes=changes
    )


@router.get("/dwells", response_model=list[DwellFileSummary])
def list_dwell_files(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[DwellFileSummary]:
    files = db.query(DwellFile).order_by(DwellFile.name).all()
    return [
        DwellFileSummary(
            id=f.id,
            name=f.name,
            mdf_id=f.mdf_id,
            mdf_name=f.mdf.name if f.mdf else None,
            strategy_count=len(f.strategies),
            platform_names=[s.platform.name for s in f.strategies if s.platform],
            dwell_count=sum(len(s.merged_mode or []) for s in f.strategies),
            updated_at=f.updated_at,
        )
        for f in files
    ]


@router.post("/dwells", response_model=DwellFileOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_dwell_file(
    payload: DwellFileCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> DwellFileOut:
    name = _name_free(db, payload.name)
    _check_mdf(db, payload.mdf_id)
    dwell_file = DwellFile(name=name, mdf_id=payload.mdf_id, timeout=5, setup_time=5, created_by=user.id)
    db.add(dwell_file)
    db.flush()
    _audit(db, user, AuditAction.create, AuditEntityType.dwell_file, dwell_file.id, f"Created dwell file '{name}'")
    db.commit()
    db.refresh(dwell_file)
    return _out(db, dwell_file)


@router.post(
    "/dwells/import", response_model=DwellFileOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def import_dwell_file(
    file: UploadFile = File(...),
    name: str | None = Form(None),
    mdf_id: UUID | None = Form(None),
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> DwellFileOut:
    """A dwell file from its XML. The file doesn't say which Platform each
    Strategy is for — they're assigned afterwards."""
    content = file.file.read(app_config.max_upload_bytes + 1)
    if len(content) > app_config.max_upload_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "The file is larger than the upload limit")
    try:
        parsed = parse_dwell_xml(content)
    except DwellXmlError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    default_name = (file.filename or "Dwell file").rsplit("/", 1)[-1].removesuffix(".xml")
    name = _name_free(db, name or default_name)
    _check_mdf(db, mdf_id)
    dwell_file = DwellFile(
        name=name, mdf_id=mdf_id, timeout=parsed["timeout"], setup_time=parsed["setup_time"], created_by=user.id
    )
    for i, s in enumerate(parsed["strategies"]):
        dwell_file.strategies.append(DwellStrategy(sort_order=i, **s))
    db.add(dwell_file)
    db.flush()
    _audit(
        db,
        user,
        AuditAction.create,
        AuditEntityType.dwell_file,
        dwell_file.id,
        f"Imported dwell file '{name}' ({len(parsed['strategies'])} Strategies)",
    )
    db.commit()
    db.refresh(dwell_file)
    return _out(db, dwell_file)


@router.get("/dwells/{file_id}", response_model=DwellFileOut)
def get_dwell_file(file_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> DwellFileOut:
    return _out(db, _file_or_404(db, file_id))


@router.patch("/dwells/{file_id}", response_model=DwellFileOut, dependencies=[Depends(verify_csrf)])
def update_dwell_file(
    file_id: UUID, payload: DwellFileUpdate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> DwellFileOut:
    dwell_file = _file_or_404(db, file_id)
    fields = payload.model_dump(exclude_unset=True)
    if "name" in fields:
        fields["name"] = _name_free(db, fields["name"], dwell_file.id)
    if "mdf_id" in fields:
        _check_mdf(db, fields["mdf_id"])
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
            f"Updated dwell file '{dwell_file.name}'", changes,
        )
    db.commit()
    db.refresh(dwell_file)
    return _out(db, dwell_file)


@router.delete("/dwells/{file_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_dwell_file(file_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))) -> None:
    dwell_file = _file_or_404(db, file_id)
    _audit(db, user, AuditAction.delete, AuditEntityType.dwell_file, dwell_file.id, f"Deleted dwell file '{dwell_file.name}'")
    db.delete(dwell_file)
    db.commit()


@router.get("/dwells/{file_id}/xml")
def download_dwell_xml(file_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> Response:
    dwell_file = _file_or_404(db, file_id)
    return Response(
        content=build_dwell_xml(dwell_file),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{sanitize_filename(dwell_file.name)}.xml"'},
    )


@router.post(
    "/dwells/{file_id}/strategies",
    response_model=DwellFileOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def add_strategy(
    file_id: UUID, payload: DwellStrategyCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> DwellFileOut:
    dwell_file = _file_or_404(db, file_id)
    platform = _check_platform(db, dwell_file, payload.platform_id)
    strategy = DwellStrategy(
        platform_id=payload.platform_id,
        sort_order=max((s.sort_order for s in dwell_file.strategies), default=-1) + 1,
        manual_collect_time_ms=DEFAULT_COLLECT_TIME_MS,
        merged_mode=[],
        rapid_df=dict(DEFAULT_RAPID_DF),
        split_mode=[dict(d, freqs=list(d["freqs"])) for d in DEFAULT_SPLIT_MODE],
    )
    dwell_file.strategies.append(strategy)
    db.flush()
    _audit(
        db, user, AuditAction.create, AuditEntityType.dwell_strategy, strategy.id,
        f"Added a Dwell Strategy{f' for {platform.name}' if platform else ''} to dwell file '{dwell_file.name}'",
    )
    db.commit()
    db.refresh(dwell_file)
    return _out(db, dwell_file)


@router.patch("/dwell-strategies/{strategy_id}", response_model=DwellFileOut, dependencies=[Depends(verify_csrf)])
def update_strategy(
    strategy_id: UUID, payload: DwellStrategyUpdate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> DwellFileOut:
    strategy = _strategy_or_404(db, strategy_id)
    dwell_file = strategy.dwell_file
    fields = payload.model_dump(exclude_unset=True)
    if payload.merged_mode is not None:
        # Whole entries, defaults included (exclude_unset drops them inside).
        fields["merged_mode"] = [d.model_dump() for d in payload.merged_mode]
    changes = {}
    if "platform_id" in fields and fields["platform_id"] != strategy.platform_id:
        _check_platform(db, dwell_file, fields["platform_id"], strategy.id)
        changes["platform_id"] = {"old": str(strategy.platform_id), "new": str(fields["platform_id"])}
        strategy.platform_id = fields["platform_id"]
    if fields.get("manual_collect_time_ms") is not None and fields["manual_collect_time_ms"] != strategy.manual_collect_time_ms:
        changes["manual_collect_time_ms"] = {"old": strategy.manual_collect_time_ms, "new": fields["manual_collect_time_ms"]}
        strategy.manual_collect_time_ms = fields["manual_collect_time_ms"]
    if fields.get("merged_mode") is not None and fields["merged_mode"] != strategy.merged_mode:
        changes["merged_mode"] = {"old": strategy.merged_mode, "new": fields["merged_mode"]}
        strategy.merged_mode = fields["merged_mode"]
    if fields.get("sort_order") is not None:
        strategy.sort_order = fields["sort_order"]
    if changes:
        db.flush()
        db.refresh(strategy)
        who = strategy.platform.name if strategy.platform else "a Platform not yet picked"
        _audit(
            db, user, AuditAction.update, AuditEntityType.dwell_strategy, strategy.id,
            f"Updated the Dwell Strategy for {who} in dwell file '{dwell_file.name}'", changes,
        )
    db.commit()
    db.refresh(dwell_file)
    return _out(db, dwell_file)


@router.delete("/dwell-strategies/{strategy_id}", response_model=DwellFileOut, dependencies=[Depends(verify_csrf)])
def delete_strategy(strategy_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))) -> DwellFileOut:
    strategy = _strategy_or_404(db, strategy_id)
    dwell_file = strategy.dwell_file
    who = strategy.platform.name if strategy.platform else "a Platform not yet picked"
    _audit(
        db, user, AuditAction.delete, AuditEntityType.dwell_strategy, strategy.id,
        f"Removed the Dwell Strategy for {who} from dwell file '{dwell_file.name}'",
        {"merged_mode": strategy.merged_mode},
    )
    dwell_file.strategies.remove(strategy)
    db.commit()
    db.refresh(dwell_file)
    return _out(db, dwell_file)


@router.get("/settings", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> dict:
    return app_settings.all_settings(db)


@router.patch("/settings", response_model=SettingsOut, dependencies=[Depends(verify_csrf)])
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))) -> dict:
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        old = app_settings.get_setting(db, key)
        if old != value:
            app_settings.set_setting(db, key, value, user.id)
            _audit(db, user, AuditAction.update, AuditEntityType.setting, None, f"Changed setting {key}", {key: {"old": old, "new": value}})
    db.commit()
    return app_settings.all_settings(db)
