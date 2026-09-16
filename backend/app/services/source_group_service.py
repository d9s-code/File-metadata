from datetime import date, datetime

from app.core.enums import ElementType
from app.models.source_group import SourceGroup
from app.services.delta import apply_delta


class SourceGroupStats:
    def __init__(self) -> None:
        self.source_count: int = 0
        self.last_updated_source_date: date | None = None
        self.last_edited_at: datetime | None = None
        self.rf_min_mhz: float | None = None
        self.rf_max_mhz: float | None = None
        self.pw_min_us: float | None = None
        self.pw_max_us: float | None = None
        self.pri_min_us: float | None = None
        self.pri_max_us: float | None = None
        self.pri_stagger_count: int = 0


def compute_source_group_stats(group: SourceGroup) -> SourceGroupStats:
    """Derived, read-only stats rolled up across every Source currently in this
    group: the two independently-tracked "freshness" signals (the analyst-entered
    source_date vs. the actual last-edited-at timestamp), and the engineered
    RF/PW/PRI coverage across the group's pooled Elements. Fixed-style PRI
    Elements (value_min/value_max) contribute to the PRI range; stagger-style
    ones (stagger_values, no single min/max) are excluded from that range and
    counted separately instead.
    """
    stats = SourceGroupStats()
    ranges: dict[ElementType, list[float]] = {ElementType.rf: [], ElementType.pw: [], ElementType.pri: []}

    for source in group.sources:
        stats.source_count += 1
        if stats.last_updated_source_date is None or source.source_date > stats.last_updated_source_date:
            stats.last_updated_source_date = source.source_date
        if stats.last_edited_at is None or source.updated_at > stats.last_edited_at:
            stats.last_edited_at = source.updated_at

        for element in source.elements:
            if element.element_type not in ranges:
                continue
            if element.stagger_values:
                if element.element_type == ElementType.pri:
                    stats.pri_stagger_count += 1
                continue
            eng_min, eng_max = apply_delta(element.value_min, element.value_max, element.delta)
            if eng_min is None or eng_max is None:
                continue
            ranges[element.element_type].extend([eng_min, eng_max])

    # Cast Decimal -> float: these are Numeric(14, 4) columns under the hood, and
    # a raw Decimal serializes with its full stored precision ("2000.0000")
    # instead of a clean JSON number the way the rest of the app's float-typed
    # schemas already do.
    if ranges[ElementType.rf]:
        stats.rf_min_mhz = float(min(ranges[ElementType.rf]))
        stats.rf_max_mhz = float(max(ranges[ElementType.rf]))
    if ranges[ElementType.pw]:
        stats.pw_min_us = float(min(ranges[ElementType.pw]))
        stats.pw_max_us = float(max(ranges[ElementType.pw]))
    if ranges[ElementType.pri]:
        stats.pri_min_us = float(min(ranges[ElementType.pri]))
        stats.pri_max_us = float(max(ranges[ElementType.pri]))

    return stats
