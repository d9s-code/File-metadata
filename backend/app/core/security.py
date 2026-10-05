from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from passlib.context import CryptContext

from app.config import settings

# Passwords are never stored, only a salted bcrypt hash of each (work factor
# 12) — one-way, so a database backup can't be turned back into passwords.
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)

MIN_PASSWORD_LENGTH = 12
# bcrypt silently ignores everything past 72 bytes.
MAX_PASSWORD_BYTES = 72


def password_policy_error(password: str) -> str | None:
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        return f"Password must be at most {MAX_PASSWORD_BYTES} bytes"
    if "CHANGE_ME" in password:
        return "Password is still the CHANGE_ME placeholder"
    return None


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd_context.verify(password, password_hash)


def password_stamp(password_changed_at: datetime | None) -> int:
    """When the password last changed, in milliseconds (0 if never) — carried in
    each session token so a change can tell older sessions apart exactly."""
    return int(password_changed_at.timestamp() * 1000) if password_changed_at else 0


def session_predates_password_change(token_payload: dict, password_changed_at: datetime | None) -> bool:
    """Whether a session was signed in before the password last changed."""
    return int(token_payload.get("pwc", 0)) < password_stamp(password_changed_at)


def create_access_token(user_id: UUID, role: str, password_changed_at: datetime | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "pwc": password_stamp(password_changed_at),
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
