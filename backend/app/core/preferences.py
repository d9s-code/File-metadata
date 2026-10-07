"""Each person's own settings: which optional features they see.

Every setting is on unless switched off, so a new feature shows for
everyone until they choose otherwise. Stored per user (users.preferences),
so they follow the person to any browser.
"""

DEFAULTS: dict[str, bool] = {
    # The ✦ chat button in the corner of every page.
    "ai_chat": True,
    # The chat is told which page you're on, so "this Emitter" works.
    "ai_chat_page": True,
    # Explain with AI / Summarise with AI on the ambiguity page.
    "ai_drafts": True,
}


def resolved(stored: dict | None) -> dict[str, bool]:
    """Every setting, stored or default."""
    stored = stored or {}
    return {key: bool(stored.get(key, default)) for key, default in DEFAULTS.items()}
