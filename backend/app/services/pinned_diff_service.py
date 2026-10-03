"""A human-readable diff between two Platform or two MDF snapshots — the
same shape as an Emitter's (see emitter_diff_service): which pins were added
or removed, which moved to another version, and the entity's own fields —
instead of raw paths into the full snapshots each pin carries."""

from app.services.emitter_diff_service import _diff_fields, _entry

OWN_FIELD_LABELS = {"name": "Name", "description": "Description", "status": "Status"}


def _status_label(value: str | None) -> str | None:
    if not value:
        return value
    words = value.replace("_", " ")
    return words[:1].upper() + words[1:]


def compute_pinned_diff(old: dict, new: dict, *, own: str, child: str) -> list[dict]:
    """`own` names the entity ("Platform" or "MDF"); `child` what it pins
    ("emitter" or "platform"), as its snapshot's link keys spell it."""
    entries: list[dict] = []
    statuses = {v: _status_label(v) for v in (old.get("status"), new.get("status")) if v}
    _diff_fields(entries, own, old, new, OWN_FIELD_LABELS, value_labels={"status": statuses})

    noun = child.capitalize()
    id_key, name_key, version_key = f"{child}_id", f"{child}_name", f"{child}_version_number"
    old_links = {link[id_key]: link for link in old.get("links", [])}
    new_links = {link[id_key]: link for link in new.get("links", [])}
    for link_id, link in new_links.items():
        if link_id not in old_links:
            entries.append(_entry(f"{noun} '{link[name_key]}'", "Pinned", "added", new_value=f"At its v{link[version_key]}"))
    for link_id, link in old_links.items():
        if link_id not in new_links:
            entries.append(_entry(f"{noun} '{link[name_key]}'", "Unpinned", "removed", old_value=f"Was at its v{link[version_key]}"))
    for link_id in set(old_links) & set(new_links):
        before, after = old_links[link_id], new_links[link_id]
        if before[version_key] != after[version_key]:
            entries.append(
                _entry(
                    f"{noun} '{after[name_key]}'",
                    "Pinned version",
                    "changed",
                    f"v{before[version_key]}",
                    f"v{after[version_key]}",
                )
            )
    return entries
