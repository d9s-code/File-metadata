from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class Customer(UUIDPkMixin, TimestampMixin, Base):
    """Who an MDF is delivered to — global (not per-Emitter), picked from a
    dropdown on the MDF rather than typed freely, so sorting/filtering MDFs
    by customer doesn't drift on inconsistent spelling.
    """

    __tablename__ = "customers"

    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)

    mdfs: Mapped[list["Mdf"]] = relationship(back_populates="customer")  # noqa: F821
