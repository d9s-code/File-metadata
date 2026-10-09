"""Test runs being filled in: saved as they're typed, listed on the Emitter's
Test History so they can be picked up again, deleted when logged (see
TestRecordCreate.draft_id) or discarded."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.models.platform import Platform
from app.models.test_record import TestRunDraft
from app.models.user import User
from app.schemas.test_record import TestRunDraftFull, TestRunDraftOut, TestRunDraftSave

router = APIRouter(tags=["test-drafts"])


def _out(db: Session, draft: TestRunDraft, full: bool = False):
    names = dict(
        db.query(User.id, User.username).filter(User.id.in_([i for i in (draft.created_by, draft.updated_by) if i])).all()
    )
    data = {
        **{k: getattr(draft, k) for k in TestRunDraftOut.model_fields if hasattr(draft, k)},
        "created_by_username": names.get(draft.created_by),
        "updated_by_username": names.get(draft.updated_by),
    }
    return TestRunDraftFull(**data, state=draft.state) if full else TestRunDraftOut(**data)


def _draft(db: Session, draft_id: UUID) -> TestRunDraft:
    draft = db.get(TestRunDraft, draft_id)
    if draft is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This test run in progress was logged or discarded")
    return draft


def _live_emitter(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None or emitter.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


@router.get("/emitters/{emitter_id}/test-drafts", response_model=list[TestRunDraftOut])
def list_drafts(emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))):
    _live_emitter(db, emitter_id)
    drafts = (
        db.query(TestRunDraft)
        .filter(TestRunDraft.emitter_id == emitter_id)
        .order_by(TestRunDraft.updated_at.desc())
        .all()
    )
    return [_out(db, d) for d in drafts]


@router.post(
    "/emitters/{emitter_id}/test-drafts",
    response_model=TestRunDraftFull,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_draft(
    emitter_id: UUID,
    payload: TestRunDraftSave,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
):
    _live_emitter(db, emitter_id)
    draft = TestRunDraft(
        emitter_id=emitter_id,
        title=payload.title,
        test_type=payload.test_type.value,
        summary=payload.summary,
        state=payload.state,
        version=1,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return _out(db, draft, full=True)


@router.get("/test-drafts/{draft_id}", response_model=TestRunDraftFull)
def get_draft(draft_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))):
    return _out(db, _draft(db, draft_id), full=True)


@router.put("/test-drafts/{draft_id}", response_model=TestRunDraftOut, dependencies=[Depends(verify_csrf)])
def save_draft(
    draft_id: UUID,
    payload: TestRunDraftSave,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
):
    """Save the run as it stands. Refused if someone else saved it since the
    version this builds on — their changes would be lost."""
    draft = db.query(TestRunDraft).filter(TestRunDraft.id == draft_id).with_for_update().first()
    if draft is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This test run in progress was logged or discarded")
    if payload.version is not None and payload.version != draft.version:
        who = db.get(User, draft.updated_by) if draft.updated_by else None
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{who.username if who else 'Someone'} has saved this test run since you opened it — reload to see their changes",
        )
    draft.title = payload.title
    draft.test_type = payload.test_type.value
    draft.summary = payload.summary
    draft.state = payload.state
    draft.version += 1
    draft.updated_by = user.id
    db.commit()
    db.refresh(draft)
    return _out(db, draft)


@router.delete("/test-drafts/{draft_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def discard_draft(draft_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.editor))):
    db.delete(_draft(db, draft_id))
    db.commit()


def _live_platform(db: Session, platform_id: UUID) -> Platform:
    platform = db.get(Platform, platform_id)
    if platform is None or platform.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Platform not found")
    return platform


@router.get("/platforms/{platform_id}/test-drafts", response_model=list[TestRunDraftOut])
def list_platform_drafts(platform_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))):
    """Platform tests in progress — every pinned Emitter tested in one run."""
    _live_platform(db, platform_id)
    drafts = (
        db.query(TestRunDraft)
        .filter(TestRunDraft.platform_id == platform_id)
        .order_by(TestRunDraft.updated_at.desc())
        .all()
    )
    return [_out(db, d) for d in drafts]


@router.post(
    "/platforms/{platform_id}/test-drafts",
    response_model=TestRunDraftFull,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_platform_draft(
    platform_id: UUID,
    payload: TestRunDraftSave,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
):
    _live_platform(db, platform_id)
    draft = TestRunDraft(
        platform_id=platform_id,
        title=payload.title,
        test_type=payload.test_type.value,
        summary=payload.summary,
        state=payload.state,
        version=1,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return _out(db, draft, full=True)
