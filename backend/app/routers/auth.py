from datetime import datetime, timezone
from uuid import UUID

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.config import settings
from app.core.csrf import CSRF_COOKIE_NAME, generate_csrf_token, verify_csrf
from app.core.enums import AuditAction, AuditEntityType
from app.core.rate_limit import (
    MAX_FAILURES_PER_IP,
    check_login_rate_limit,
    clear_login_failures,
    ip_key,
    record_login_failure,
    user_key,
)
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password
from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas.user import ChangePasswordRequest, LoginRequest, UserOut
from app.services.audit_service import record_audit

router = APIRouter(prefix="/auth", tags=["auth"])

_COOKIE_MAX_AGE = settings.jwt_expire_minutes * 60

# Checked against when the username doesn't exist, so an unknown username
# takes as long to reject as a wrong password (no timing-based enumeration).
_DUMMY_PASSWORD_HASH = hash_password("dummy-password-for-timing")


@router.post("/login", response_model=UserOut)
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> User:
    client_ip = ip_key(request.client.host if request.client else "unknown")
    check_login_rate_limit(user_key(payload.username))
    check_login_rate_limit(client_ip, max_failures=MAX_FAILURES_PER_IP)

    user = db.query(User).filter(User.username == payload.username).first()
    password_ok = verify_password(payload.password, user.password_hash if user else _DUMMY_PASSWORD_HASH)
    if user is None or not user.is_active or not password_ok:
        record_login_failure(user_key(payload.username))
        record_login_failure(client_ip)
        record_audit(
            db,
            actor_id=user.id if user else None,
            action=AuditAction.login_failed,
            entity_type=AuditEntityType.auth.value,
            entity_id=user.id if user else None,
            summary=f"Failed login attempt for username '{payload.username}'",
        )
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")

    # Only the username's counter: clearing the IP's would let one valid
    # account reset the spraying limit for every other guess from that IP.
    clear_login_failures(user_key(payload.username))
    user.last_login_at = datetime.now(timezone.utc)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.login,
        entity_type=AuditEntityType.auth.value,
        entity_id=user.id,
        summary=f"'{user.username}' logged in",
    )
    db.commit()
    db.refresh(user)

    _start_session(response, user)
    return user


def _start_session(response: Response, user: User) -> None:
    """The session cookie, and the CSRF cookie that goes with it."""
    token = create_access_token(user.id, user.role.value, user.password_changed_at)
    response.set_cookie(
        "access_token",
        token,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        samesite="strict",
        secure=settings.cookie_secure,
    )
    response.set_cookie(
        CSRF_COOKIE_NAME,
        generate_csrf_token(),
        max_age=_COOKIE_MAX_AGE,
        httponly=False,
        samesite="strict",
        secure=settings.cookie_secure,
    )


@router.post("/change-password", dependencies=[Depends(verify_csrf)])
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Your own password. Needs the current one — wrong guesses count toward
    the same limit as signing in. Every other session of yours is signed out;
    this one carries on with a fresh session."""
    check_login_rate_limit(user_key(user.username))
    if not verify_password(payload.current_password, user.password_hash):
        record_login_failure(user_key(user.username))
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The current password isn't right")
    if verify_password(payload.new_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The new password must be different from the current one")
    clear_login_failures(user_key(user.username))
    user.password_hash = hash_password(payload.new_password)
    user.password_changed_at = datetime.now(timezone.utc)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.user.value,
        entity_id=user.id,
        summary=f"'{user.username}' changed their password",
    )
    db.commit()
    _start_session(response, user)
    return {"ok": True}


@router.post("/logout")
def logout(response: Response, access_token: str | None = Cookie(default=None), db: Session = Depends(get_db)) -> dict:
    if access_token:
        try:
            user_id = UUID(decode_access_token(access_token)["sub"])
            record_audit(
                db,
                actor_id=user_id,
                action=AuditAction.logout,
                entity_type=AuditEntityType.auth.value,
                entity_id=user_id,
                summary="User logged out",
            )
            db.commit()
        except (jwt.PyJWTError, KeyError, ValueError):
            pass  # expired/invalid token — nothing to attribute the logout to
    response.delete_cookie("access_token")
    response.delete_cookie(CSRF_COOKIE_NAME)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user
