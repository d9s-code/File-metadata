"""Platform confidence (experimental): what in an MDF tells its Platforms
apart. Read-only; nothing here is stored yet."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.mdf import Mdf, MdfVersion
from app.models.pcl_rule import PclRule
from app.models.platform import Platform
from app.services.ambiguity_service import DEFAULT_TOLERANCE
from app.services.app_settings import mode_defaults
from app.services.audit_service import record_audit
from app.services.pcl_expr import Heard, PclSyntaxError, to_text
from app.services.pcl_rules_service import (
    Context,
    parse_condition,
    rules_by_platform,
    what_if,
)
from app.services.platform_uniqueness import mdf_uniqueness

router = APIRouter(prefix="/pcl", tags=["platform-confidence"])


class UniquenessOut(BaseModel):
    mdf_id: UUID
    mdf_name: str
    # The MDF version read (its latest saved one).
    mdf_version_number: int
    # The step tolerance the Stagger steps were compared with (± µs).
    stagger_step_delta_us: float
    platforms: list[dict]


def _latest(db: Session, mdf_id: UUID) -> tuple[Mdf, MdfVersion]:
    mdf = db.get(Mdf, mdf_id)
    if mdf is None or getattr(mdf, "deleted_at", None) is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    version = (
        db.query(MdfVersion).filter(MdfVersion.mdf_id == mdf_id).order_by(MdfVersion.version_number.desc()).first()
    )
    if version is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Save a version of this MDF first — this reads its saved Platforms")
    return mdf, version


def _context(db: Session, version: MdfVersion) -> Context:
    return Context(db, version.snapshot, {"stagger_step_delta_us": float(mode_defaults(db)["stagger_step_delta_us"])})


@router.get("/mdfs/{mdf_id}/uniqueness", response_model=UniquenessOut)
def get_mdf_uniqueness(mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> UniquenessOut:
    """Each Platform the MDF's latest saved version pins: its Emitters, unique
    to it or shared; a unique Emitter's Modes with a unique parameter set and
    unique parameters; pairs of shared Emitters only it has together; and
    the Platforms that have everything it has."""
    mdf, version = _latest(db, mdf_id)
    step = float(mode_defaults(db)["stagger_step_delta_us"])
    return UniquenessOut(
        mdf_id=mdf.id,
        mdf_name=mdf.name,
        mdf_version_number=version.version_number,
        stagger_step_delta_us=step,
        platforms=mdf_uniqueness(version.snapshot, {**DEFAULT_TOLERANCE, "stagger_step_delta_us": step}),
    )


# --- Rules -----------------------------------------------------------------


class RuleIn(BaseModel):
    level: Literal[1, 2, 3]
    text: str = Field(min_length=1, max_length=4000)
    note: str | None = Field(default=None, max_length=2000)


class RulePatch(BaseModel):
    level: Literal[1, 2, 3] | None = None
    text: str | None = Field(default=None, min_length=1, max_length=4000)
    note: str | None = Field(default=None, max_length=2000)


class CheckIn(BaseModel):
    platform_id: UUID
    mdf_id: UUID | None = None
    text: str = Field(max_length=4000)


class HeardIn(BaseModel):
    emitter_ids: list[UUID] = []
    # A Mode heard: its Emitter and name.
    modes: list[dict] = []


def _syntax_error(err: PclSyntaxError) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"message": str(err), "position": err.position})


def _rule_out(rule: PclRule, ctx: Context | None, name_of) -> dict:
    out = {
        "id": str(rule.id),
        "platform_id": str(rule.platform_id),
        "level": rule.level,
        "text": to_text(rule.condition, name_of),
        "note": rule.note,
        "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
    }
    if ctx is not None:
        out["check"] = ctx.check(str(rule.platform_id), rule.condition)
    return out


@router.get("/mdfs/{mdf_id}/rules")
def get_mdf_rules(mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> dict:
    """Each of the MDF's Platforms: its rules, each checked against this MDF,
    and rules suggested from what's unique in it."""
    _mdf, version = _latest(db, mdf_id)
    ctx = _context(db, version)
    rules = rules_by_platform(db, [p.id for p in ctx.platforms])
    platforms = []
    for p in ctx.platforms:
        own = [_rule_out(r, ctx, ctx.name_of) for r in rules.get(p.id, [])]
        platforms.append(
            {
                "platform_id": p.id,
                "platform_name": p.name,
                "rules": own,
                "suggestions": ctx.suggestions(p.id, {r["text"] for r in own}),
            }
        )
    return {"mdf_id": str(mdf_id), "mdf_version_number": version.version_number, "platforms": platforms}


@router.post("/check")
def check_condition(payload: CheckIn, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> dict:
    """A condition as it's typed: whether it reads, written out, and — with an
    MDF — how it fares there. Nothing is saved."""
    ctx = None
    if payload.mdf_id is not None:
        _mdf, version = _latest(db, payload.mdf_id)
        ctx = _context(db, version)
    try:
        condition = parse_condition(db, payload.text, ctx)
    except PclSyntaxError as err:
        return {"ok": False, "message": str(err), "position": err.position}
    name_of = ctx.name_of if ctx else _names(db)
    return {
        "ok": True,
        "text": to_text(condition, name_of),
        "check": ctx.check(str(payload.platform_id), condition) if ctx else None,
    }


def _names(db: Session):
    from app.models.emitter import Emitter

    cache: dict[str, str] = {}

    def name_of(eid: str) -> str:
        if eid not in cache:
            e = db.get(Emitter, UUID(eid))
            cache[eid] = e.name if e else "(deleted Emitter)"
        return cache[eid]

    return name_of


def _platform(db: Session, platform_id: UUID) -> Platform:
    p = db.get(Platform, platform_id)
    if p is None or p.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Platform not found")
    return p


@router.get("/platforms/{platform_id}/rules")
def list_platform_rules(platform_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[dict]:
    _platform(db, platform_id)
    name_of = _names(db)
    return [_rule_out(r, None, name_of) for r in rules_by_platform(db, [str(platform_id)]).get(str(platform_id), [])]


@router.post("/platforms/{platform_id}/rules", status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_rule(platform_id: UUID, payload: RuleIn, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))) -> dict:
    platform = _platform(db, platform_id)
    try:
        condition = parse_condition(db, payload.text)
    except PclSyntaxError as err:
        raise _syntax_error(err) from err
    rule = PclRule(platform_id=platform_id, level=payload.level, condition=condition, note=(payload.note or "").strip() or None, created_by=user.id)
    db.add(rule)
    db.flush()
    name_of = _names(db)
    text = to_text(condition, name_of)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.platform.value,
        entity_id=platform.id,
        summary=f"Added a confidence rule to Platform '{platform.name}': PCL {payload.level} when {text}",
        changes={"level": payload.level, "condition": text},
    )
    db.commit()
    db.refresh(rule)
    return _rule_out(rule, None, name_of)


def _rule(db: Session, rule_id: UUID) -> tuple[PclRule, Platform]:
    rule = db.get(PclRule, rule_id)
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rule not found")
    return rule, _platform(db, rule.platform_id)


@router.patch("/rules/{rule_id}", dependencies=[Depends(verify_csrf)])
def update_rule(rule_id: UUID, payload: RulePatch, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))) -> dict:
    rule, platform = _rule(db, rule_id)
    name_of = _names(db)
    before = {"level": rule.level, "condition": to_text(rule.condition, name_of), "note": rule.note}
    changes = payload.model_dump(exclude_unset=True)
    if "text" in changes:
        try:
            rule.condition = parse_condition(db, changes["text"])
        except PclSyntaxError as err:
            raise _syntax_error(err) from err
    if changes.get("level") is not None:
        rule.level = changes["level"]
    if "note" in changes:
        rule.note = (changes["note"] or "").strip() or None
    after = {"level": rule.level, "condition": to_text(rule.condition, name_of), "note": rule.note}
    diff = {k: {"old": before[k], "new": after[k]} for k in before if before[k] != after[k]}
    if diff:
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.update,
            entity_type=AuditEntityType.platform.value,
            entity_id=platform.id,
            summary=f"Changed a confidence rule of Platform '{platform.name}': PCL {rule.level} when {after['condition']}",
            changes=diff,
        )
    db.commit()
    db.refresh(rule)
    return _rule_out(rule, None, name_of)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_rule(rule_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))) -> None:
    rule, platform = _rule(db, rule_id)
    text = to_text(rule.condition, _names(db))
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.platform.value,
        entity_id=platform.id,
        summary=f"Removed a confidence rule of Platform '{platform.name}': PCL {rule.level} when {text}",
        changes={"level": rule.level, "condition": text},
    )
    db.delete(rule)
    db.commit()


@router.post("/mdfs/{mdf_id}/what-if")
def mdf_what_if(mdf_id: UUID, payload: HeardIn, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> dict:
    """Which of the MDF's Platforms what's heard points to, and how surely:
    each one's highest level whose rule is met. Nothing is saved."""
    _mdf, version = _latest(db, mdf_id)
    ctx = _context(db, version)
    emitters = {str(e) for e in payload.emitter_ids}
    modes = set()
    for m in payload.modes:
        eid, name = str(m.get("emitter_id") or ""), str(m.get("mode") or "")
        if eid and name:
            modes.add((eid, name.lower()))
            emitters.add(eid)
    rules = rules_by_platform(db, [p.id for p in ctx.platforms])
    return {"platforms": what_if(ctx, Heard(frozenset(emitters), frozenset(modes)), rules)}
