import time

from fastapi import HTTPException, status

MAX_FAILURES = 5
WINDOW_SECONDS = 15 * 60

# In-memory, per-process. Fine for this app's single-worker deployment
# (see Dockerfile/docker-compose.yml, no --workers flag); a multi-worker
# or multi-instance deployment would need a shared store instead.
_failures: dict[str, list[float]] = {}


def _prune(key: str, now: float) -> list[float]:
    attempts = [t for t in _failures.get(key, []) if now - t < WINDOW_SECONDS]
    if attempts:
        _failures[key] = attempts
    else:
        _failures.pop(key, None)
    return attempts


def check_login_rate_limit(key: str) -> None:
    now = time.monotonic()
    attempts = _prune(key, now)
    if len(attempts) >= MAX_FAILURES:
        retry_after = int(WINDOW_SECONDS - (now - attempts[0])) + 1
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many failed login attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )


def record_login_failure(key: str) -> None:
    now = time.monotonic()
    attempts = _prune(key, now)
    attempts.append(now)
    _failures[key] = attempts


def clear_login_failures(key: str) -> None:
    _failures.pop(key, None)
