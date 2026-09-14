from uuid import UUID

import jwt
from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.enums import Role
from app.core.security import decode_access_token
from app.database import get_db
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.user import User
from app.services import checkout_service

_ROLE_RANK = {Role.viewer: 0, Role.editor: 1, Role.admin: 2}


def has_role(user: User, minimum: Role) -> bool:
    return _ROLE_RANK[user.role] >= _ROLE_RANK[minimum]


def get_current_user(
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User:
    if access_token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = decode_access_token(access_token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from exc

    user = db.get(User, UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    return user


def require_role(minimum: Role):
    def _checker(user: User = Depends(get_current_user)) -> User:
        if _ROLE_RANK[user.role] < _ROLE_RANK[minimum]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role '{minimum.value}' or higher")
        return user

    return _checker


def _not_checked_out_message(emitter: Emitter) -> str:
    if emitter.checked_out_by_id is None:
        return "Start editing this Emitter before making changes"
    return f"This Emitter is checked out by another user (since {emitter.checked_out_at})"


def require_emitter_checkout(emitter_id_param: str = "emitter_id"):
    """Gates a mutating endpoint on the requester holding the Emitter's
    editing lock — used by routers whose path already carries `emitter_id`
    directly (emitters.py, ew_groups.py, sources.py).
    """

    def _checker(
        request: Request,
        db: Session = Depends(get_db),
        user: User = Depends(require_role(Role.editor)),
    ) -> User:
        emitter = db.get(Emitter, UUID(request.path_params[emitter_id_param]))
        if emitter is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
        try:
            checkout_service.assert_checked_out_by(emitter, user.id)
        except checkout_service.NotCheckedOutByUser:
            raise HTTPException(status.HTTP_409_CONFLICT, _not_checked_out_message(emitter))
        return user

    return _checker


def require_ew_group_checkout():
    """Same gate as require_emitter_checkout, for routers whose path carries
    `ew_group_id` instead of `emitter_id` directly (modes.py).
    """

    def _checker(
        request: Request,
        db: Session = Depends(get_db),
        user: User = Depends(require_role(Role.editor)),
    ) -> User:
        ew_group = db.get(EwGroup, UUID(request.path_params["ew_group_id"]))
        if ew_group is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "EW Group not found")
        emitter = db.get(Emitter, ew_group.emitter_id)
        try:
            checkout_service.assert_checked_out_by(emitter, user.id)
        except checkout_service.NotCheckedOutByUser:
            raise HTTPException(status.HTTP_409_CONFLICT, _not_checked_out_message(emitter))
        return user

    return _checker
