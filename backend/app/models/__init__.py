"""Import every model module here so SQLAlchemy's mapper registry sees all
classes before relationships (declared as string references) are resolved.
Alembic's env.py imports this module to get the full metadata for autogenerate.
"""

from app.models.emitter import Emitter  # noqa: F401
from app.models.emitter_version import EmitterVersion  # noqa: F401
from app.models.ew_group import EwGroup  # noqa: F401
from app.models.mdf import Mdf, MdfPlatformLink, MdfVersion  # noqa: F401
from app.models.mode import Mode, ModeElement, ModeLine  # noqa: F401
from app.models.platform import Platform, PlatformEmitterLink, PlatformVersion  # noqa: F401
from app.models.source import Source  # noqa: F401
from app.models.test_record import TestRecord, TestRecordMode  # noqa: F401
from app.models.user import User  # noqa: F401
