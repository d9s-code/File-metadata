import secrets

from fastapi import Cookie, Header, HTTPException, status

CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "x-csrf-token"


def generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def verify_csrf(
    csrf_cookie: str | None = Cookie(default=None, alias=CSRF_COOKIE_NAME),
    csrf_header: str | None = Header(default=None, alias=CSRF_HEADER_NAME),
) -> None:
    """Double-submit cookie check for state-changing requests made from the
    browser session (httpOnly JWT cookie can't be read/forged by JS, but the
    browser will still attach it automatically on a cross-site POST unless we
    also require this header, which JS on another origin cannot set).
    """
    if not csrf_cookie or not csrf_header or not secrets.compare_digest(csrf_cookie, csrf_header):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing or invalid CSRF token")
