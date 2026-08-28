import enum


class Role(str, enum.Enum):
    admin = "admin"
    editor = "editor"
    viewer = "viewer"


class PriType(str, enum.Enum):
    fixed = "fixed"
    stagger = "stagger"
    cw = "cw"
    xlet = "xlet"


class ElementType(str, enum.Enum):
    rf = "rf"
    pw = "pw"
    pri = "pri"


class EmitterStatus(str, enum.Enum):
    draft = "draft"
    in_review = "in_review"
    validated = "validated"
    deprecated = "deprecated"


EMITTER_STATUS_TRANSITIONS: dict[EmitterStatus, list[EmitterStatus]] = {
    EmitterStatus.draft: [EmitterStatus.in_review],
    EmitterStatus.in_review: [EmitterStatus.validated, EmitterStatus.draft],
    EmitterStatus.validated: [EmitterStatus.deprecated, EmitterStatus.in_review],
    EmitterStatus.deprecated: [EmitterStatus.draft],
}


class MdfStatus(str, enum.Enum):
    draft = "draft"
    pending_review = "pending_review"
    approved = "approved"
    released = "released"
    deprecated = "deprecated"


MDF_STATUS_TRANSITIONS: dict[MdfStatus, list[MdfStatus]] = {
    MdfStatus.draft: [MdfStatus.pending_review],
    MdfStatus.pending_review: [MdfStatus.approved, MdfStatus.draft],
    MdfStatus.approved: [MdfStatus.released, MdfStatus.pending_review],
    MdfStatus.released: [MdfStatus.deprecated],
    MdfStatus.deprecated: [MdfStatus.draft],
}


class VersionedEntityType(str, enum.Enum):
    emitter = "emitter"
    platform = "platform"
    mdf = "mdf"


class AmbiguityScopeType(str, enum.Enum):
    emitter = "emitter"
    platform = "platform"
    mdf = "mdf"


class AmbiguityRunStatus(str, enum.Enum):
    pending = "pending"
    complete = "complete"
    failed = "failed"


class AmbiguitySeverity(str, enum.Enum):
    none = "none"
    low = "low"
    medium = "medium"
    high = "high"
    exact_overlap = "exact_overlap"


class TestType(str, enum.Enum):
    simulation = "simulation"
    lab_bench = "lab_bench"
    live_range = "live_range"
    field_exercise = "field_exercise"


class TestResult(str, enum.Enum):
    pass_ = "pass"
    fail = "fail"
    partial = "partial"
    inconclusive = "inconclusive"


class TestScopeType(str, enum.Enum):
    emitter = "emitter"
    mdf = "mdf"


class AuditAction(str, enum.Enum):
    create = "create"
    update = "update"
    delete = "delete"
    status_change = "status_change"
    commit = "commit"
    login = "login"
    login_failed = "login_failed"
    logout = "logout"


class AuditEntityType(str, enum.Enum):
    """The "group" an audit entry is filed under. A flat list underneath
    (see AuditLog) — this enum is what the UI groups/subgroups by.
    """

    emitter = "emitter"
    ew_group = "ew_group"
    source = "source"
    mode_element = "mode_element"
    mode = "mode"
    mode_generation_batch = "mode_generation_batch"
    platform = "platform"
    platform_link = "platform_link"
    mdf = "mdf"
    mdf_link = "mdf_link"
    test_record = "test_record"
    user = "user"
    auth = "auth"
