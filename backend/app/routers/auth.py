from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.config import settings
from app.core.csrf import CSRF_COOKIE_NAME, generate_csrf_token
from app.core.rate_limit import check_login_rate_limit, clear_login_failures, record_login_failure
from app.core.security import create_access_token, verify_password
from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas.user import LoginRequest, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

_COOKIE_MAX_AGE = settings.jwt_expire_minutes * 60


@router.post("/login", response_model=UserOut)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> User:
    check_login_rate_limit(payload.username)

    user = db.query(User).filter(User.username == payload.username).first()
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        record_login_failure(payload.username)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")

    clear_login_failures(payload.username)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.role.value)
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
    return user


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie("access_token")
    response.delete_cookie(CSRF_COOKIE_NAME)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user
