"""What a Parameter Sequence is: a stagger or a dwell & switch.

- A **stagger**: its PRI steps, in order, are one PRI train — one Stagger
  Mode. It may carry RF or PW per step too (often unused).
- A **dwell & switch**: each step is a Fixed Mode of its own — the emitter
  dwells on one RF/PRI/PW, then switches to the next.

The steps alone can't tell them apart reliably, so the kind is set by hand
on the Source's Sequences tab (imports leave it unset). Until it is, it's
guessed from the steps and shown as guessed:

- only PRI in every step → a stagger;
- no PRI at all → a dwell & switch (it can't be a stagger);
- otherwise a dwell & switch when the RF changes between steps or a step
  has a dwell time, and a stagger when the RF stays put (or isn't given).
"""

from typing import Literal

SequenceKind = Literal["stagger", "dwell_switch"]
SEQUENCE_KINDS: tuple[str, ...] = ("stagger", "dwell_switch")
KIND_LABELS = {"stagger": "Stagger", "dwell_switch": "Dwell & switch"}

_PARAM_FIELDS = {
    "rf": ("rf_mhz", "rf_min_mhz", "rf_max_mhz"),
    "pri": ("pri_us", "pri_min_us", "pri_max_us"),
    "pw": ("pw_us", "pw_min_us", "pw_max_us"),
    "scan": ("scan_value",),
}


def _has(step: dict, param: str) -> bool:
    return any(step.get(f) is not None for f in _PARAM_FIELDS[param])


def _rf_key(step: dict):
    """A step's RF as something to compare (a value, or a min–max)."""
    if step.get("rf_mhz") is not None:
        return float(step["rf_mhz"])
    if step.get("rf_min_mhz") is not None:
        return (float(step["rf_min_mhz"]), float(step["rf_max_mhz"]))
    return None


def has_pri(steps: list[dict]) -> bool:
    return any(_has(st, "pri") for st in steps or [])


def guess_kind(steps: list[dict]) -> SequenceKind:
    """The kind the steps suggest (see the module's docstring)."""
    steps = steps or []
    if not has_pri(steps):
        return "dwell_switch"
    if all(_has(st, "pri") and not any(_has(st, p) for p in ("rf", "pw", "scan")) for st in steps):
        return "stagger"
    rfs = {k for k in (_rf_key(st) for st in steps) if k is not None}
    if len(rfs) > 1 or any(st.get("dwell_s") is not None for st in steps):
        return "dwell_switch"
    return "stagger"


def effective_kind(kind: str | None, steps: list[dict]) -> SequenceKind:
    return kind if kind in SEQUENCE_KINDS else guess_kind(steps)  # type: ignore[return-value]
