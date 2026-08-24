class InvalidStatusTransition(ValueError):
    pass


def validate_transition(current: str, new: str, transitions: dict) -> None:
    allowed = transitions.get(current, [])
    if new not in [s.value if hasattr(s, "value") else s for s in allowed]:
        raise InvalidStatusTransition(f"Cannot transition from '{current}' to '{new}'")
