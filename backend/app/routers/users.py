from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.core.security import hash_password
from app.database import get_db
from app.deps import get_current_user, require_role
from app.models.user import User
from app.schemas.user import UserCreate, UserOut, UserUpdate
from app.services.audit_service import record_audit

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_role(Role.admin))])


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)) -> list[User]:
    return db.query(User).order_by(User.username).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_user(payload: UserCreate, db: Session = Depends(get_db), actor: User = Depends(get_current_user)) -> User:
    if db.query(User).filter(User.username == payload.username).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already exists")
    user = User(username=payload.username, password_hash=hash_password(payload.password), role=payload.role)
    db.add(user)
    db.flush()
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.user.value,
        entity_id=user.id,
        summary=f"Created user '{user.username}' (role: {user.role.value})",
        # Password is deliberately excluded — never store credentials in the audit trail.
        changes={"username": payload.username, "role": payload.role.value},
    )
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut, dependencies=[Depends(verify_csrf)])
def update_user(
    user_id: UUID, payload: UserUpdate, db: Session = Depends(get_db), actor: User = Depends(get_current_user)
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    changes: dict = {}
    if payload.role is not None:
        changes["role"] = {"old": user.role.value, "new": payload.role.value}
        user.role = payload.role
    if payload.is_active is not None:
        changes["is_active"] = {"old": user.is_active, "new": payload.is_active}
        user.is_active = payload.is_active
    if payload.password:
        user.password_hash = hash_password(payload.password)
        changes["password"] = "changed"
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.user.value,
        entity_id=user.id,
        summary=f"Updated user '{user.username}'",
        changes=changes,
    )
    db.commit()
    db.refresh(user)
    return user
