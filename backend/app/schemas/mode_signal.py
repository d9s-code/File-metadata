"""How a Mode's signal behaves, beyond its RF, PRI and PW ranges: how its
RF moves (agile, hopping over channels, swept, several at once), how a Fixed
PRI moves inside its range (sliding, wobulated, dwell & switch, random), its
PW (agile, a sequence), the modulation inside each pulse, and polarisation.

App-only, for analysis and the dwell planner: never exported — the export
still writes the Mode's ranges as they are. Everything defaults to plain
(fixed RF, a steady PRI, a fixed PW, no modulation); a Mode that's plain
throughout stores nothing."""

import math
from typing import Literal

from pydantic import BaseModel, Field, model_validator

MAX_LIST = 256
_Values = list[float]


def _check_values(values: _Values, what: str, minimum: int = 2) -> None:
    if len(values) < minimum:
        raise ValueError(f"{what} needs at least {minimum} values")
    if any(not math.isfinite(v) or v <= 0 for v in values):
        raise ValueError(f"{what}: each value above 0")


class RfBehaviour(BaseModel):
    """fixed: one frequency in its range. agile: pulse to pulse anywhere in its
    range. hopping: over channels, a hop every so many pulses (or ms), in order
    or at random. swept: across its range in sweep_ms (sawtooth or triangle).
    diverse: on several channels at once."""

    kind: Literal["fixed", "agile", "hopping", "swept", "diverse"] = "fixed"
    channels_mhz: _Values = Field(default_factory=list, max_length=MAX_LIST)
    hop_pulses: int | None = Field(default=None, ge=1, le=1_000_000)
    hop_ms: float | None = Field(default=None, gt=0, le=3_600_000)
    order: Literal["sequence", "random"] | None = None
    sweep_ms: float | None = Field(default=None, gt=0, le=3_600_000)
    shape: Literal["sawtooth", "triangle"] | None = None

    @model_validator(mode="after")
    def check(self) -> "RfBehaviour":
        if self.kind in ("hopping", "diverse"):
            _check_values(self.channels_mhz, "Its RF channels")
        if self.kind == "hopping" and (self.hop_pulses is None) == (self.hop_ms is None):
            raise ValueError("A hop lasts a number of pulses or a time (ms), one of the two")
        if self.kind == "swept" and self.sweep_ms is None:
            raise ValueError("A swept RF needs its sweep time")
        return self


class PriBehaviour(BaseModel):
    """How a Fixed PRI moves inside its range. steady: as it is. sliding: from
    one end to the other over period_ms (up, down or triangle). wobulated:
    sinusoidally over period_ms. dwell_switch: values_us in turn, dwell_pulses
    each. random: anywhere in its range, pulse to pulse."""

    kind: Literal["steady", "sliding", "wobulated", "dwell_switch", "random"] = "steady"
    period_ms: float | None = Field(default=None, gt=0, le=3_600_000)
    shape: Literal["up", "down", "triangle"] | None = None
    values_us: _Values = Field(default_factory=list, max_length=MAX_LIST)
    dwell_pulses: int | None = Field(default=None, ge=1, le=1_000_000)

    @model_validator(mode="after")
    def check(self) -> "PriBehaviour":
        if self.kind in ("sliding", "wobulated") and self.period_ms is None:
            raise ValueError("A sliding or wobulated PRI needs its period")
        if self.kind == "dwell_switch":
            _check_values(self.values_us, "A dwell & switch PRI")
            if self.dwell_pulses is None:
                raise ValueError("A dwell & switch PRI needs its dwell in pulses")
        return self


class PwBehaviour(BaseModel):
    """fixed: one PW in its range. agile: one of values_us at random, pulse to
    pulse. sequence: values_us in turn."""

    kind: Literal["fixed", "agile", "sequence"] = "fixed"
    values_us: _Values = Field(default_factory=list, max_length=MAX_LIST)

    @model_validator(mode="after")
    def check(self) -> "PwBehaviour":
        if self.kind != "fixed":
            _check_values(self.values_us, "Its PWs")
        return self


class Modulation(BaseModel):
    """Inside each pulse. lfm / nlfm: a chirp over bandwidth_mhz (up, down,
    triangle). phase: a code (Barker, Frank, P1–P4, polyphase…) of
    code_length chips of chip_us. fsk: frequencies tones."""

    kind: Literal["none", "lfm", "nlfm", "phase", "fsk", "unknown"] = "none"
    bandwidth_mhz: float | None = Field(default=None, gt=0, le=100_000)
    direction: Literal["up", "down", "triangle"] | None = None
    code: Literal["barker", "frank", "p1", "p2", "p3", "p4", "polyphase", "binary", "other"] | None = None
    code_length: int | None = Field(default=None, ge=2, le=100_000)
    chip_us: float | None = Field(default=None, gt=0, le=1_000_000)
    frequencies: int | None = Field(default=None, ge=2, le=10_000)

    @model_validator(mode="after")
    def check(self) -> "Modulation":
        if self.kind in ("lfm", "nlfm") and self.bandwidth_mhz is None:
            raise ValueError("A chirp needs its bandwidth")
        if self.kind == "phase" and self.code_length is None:
            raise ValueError("A phase code needs its length")
        if self.kind == "fsk" and self.frequencies is None:
            raise ValueError("FSK needs its number of frequencies")
        return self


Polarisation = Literal["horizontal", "vertical", "circular_left", "circular_right", "slant", "agile"]


class ModeSignal(BaseModel):
    rf: RfBehaviour | None = None
    pri: PriBehaviour | None = None
    pw: PwBehaviour | None = None
    modulation: Modulation | None = None
    polarisation: Polarisation | None = None

    def stored(self) -> dict | None:
        """As kept: only what isn't plain; None when nothing is."""
        out: dict = {}
        for key, plain in (("rf", "fixed"), ("pri", "steady"), ("pw", "fixed"), ("modulation", "none")):
            part = getattr(self, key)
            if part is not None and part.kind != plain:
                data = part.model_dump(exclude_none=True)
                out[key] = {k: v for k, v in data.items() if v != []}
        if self.polarisation:
            out["polarisation"] = self.polarisation
        return out or None


def check_signal_for(pri_type: str, signal: dict | None) -> None:
    """A PRI behaviour is a Fixed PRI's (moving inside its range)."""
    if signal and signal.get("pri") and pri_type != "fixed":
        raise ValueError("A PRI behaviour (sliding, wobulated, dwell & switch, random) is for a Fixed PRI")
