from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from app.core.enums import Role
from app.core.security import password_policy_error


def _check_password(password: str | None) -> str | None:
    if password is not None and (error := password_policy_error(password)):
        raise ValueError(error)
    return password


class UserCreate(BaseModel):
    username: str
    password: str
    role: Role = Role.viewer

    _password_policy = field_validator("password")(_check_password)


class UserUpdate(BaseModel):
    role: Role | None = None
    is_active: bool | None = None
    password: str | None = None

    _password_policy = field_validator("password")(_check_password)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str
    role: Role
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None = None


class LoginRequest(BaseModel):
    username: str
    password: str
