from datetime import datetime, timezone
from uuid import UUID

from app.models.emitter import Emitter


class AlreadyCheckedOutBySomeoneElse(Exception):
    def __init__(self, holder_id: UUID):
        self.holder_id = holder_id
        super().__init__(f"Checked out by {holder_id}")


class NotCheckedOutByUser(Exception):
    pass


def start_checkout(emitter: Emitter, user_id: UUID) -> None:
    """Claims the editing lock for `user_id`. Idempotent if they already hold
    it; raises if someone else does.
    """
    if emitter.checked_out_by_id is not None and emitter.checked_out_by_id != user_id:
        raise AlreadyCheckedOutBySomeoneElse(emitter.checked_out_by_id)
    emitter.checked_out_by_id = user_id
    emitter.checked_out_at = datetime.now(timezone.utc)


def assert_checked_out_by(emitter: Emitter, user_id: UUID) -> None:
    if emitter.checked_out_by_id != user_id:
        raise NotCheckedOutByUser


def release_checkout(emitter: Emitter) -> None:
    emitter.checked_out_by_id = None
    emitter.checked_out_at = None
