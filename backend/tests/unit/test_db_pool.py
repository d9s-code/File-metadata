"""The API's database pool covers every request it runs at once, so a burst
of requests (quick clicks, many tabs refreshing) never queues for a
connection and fails with "QueuePool limit of size 5 overflow 10 reached"."""

from app.config import settings
from app.database import engine


def test_the_pool_is_sized_from_the_settings():
    assert engine.pool.size() == settings.db_pool_size == 10
    assert engine.pool._max_overflow == settings.db_max_overflow == 40
    assert engine.pool._timeout == settings.db_pool_timeout


def test_it_covers_the_requests_run_at_once():
    # FastAPI runs up to 40 plain (non-async) endpoints at a time.
    assert settings.db_pool_size + settings.db_max_overflow >= 40
