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


class TestRecordModeLinkType(str, enum.Enum):
    """Why a Test Record is linked to a Mode: `exercised` means the Mode was
    tested as-is; `derived` means the Mode's values themselves are explained
    by (came out of) that test's findings, rather than a Source's data.
    """

    exercised = "exercised"
    derived = "derived"


class ElementType(str, enum.Enum):
    rf = "rf"
    pw = "pw"
    pri = "pri"
    scan = "scan"


class ElementVariant(str, enum.Enum):
    """Which measurement basis a parametric-set Element represents. Imported
    Elements may carry several variants of the same element_type (e.g. RF
    typical + RF extreme as separate rows); manually-entered Elements
    typically leave this unset.
    """

    typical = "typical"
    discrete = "discrete"
    most_probable = "most_probable"
    extreme = "extreme"
    intercept = "intercept"
    analysis = "analysis"
    other = "other"


class EmitterStatus(str, enum.Enum):
    draft = "draft"
    in_review = "in_review"
    validated = "validated"
    deprecated = "deprecated"


# What each status is called wherever a person reads it. The stored values
# predate these names and stay as they are (DB, API, CSS classes).
EMITTER_STATUS_LABELS: dict[str, str] = {
    EmitterStatus.draft.value: "In progress",
    EmitterStatus.in_review.value: "Testing",
    EmitterStatus.validated.value: "Operational",
    EmitterStatus.deprecated.value: "Needs rework",
}


def emitter_status_label(value: str) -> str:
    return EMITTER_STATUS_LABELS.get(value, value)


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


class SourceStatus(str, enum.Enum):
    """A Source's review state. Manually-created Sources are immediately
    usable (approved). Imported Sources start pending_review — an editor must
    approve or reject each one; no draft/supersede complexity since an
    imported Source is always a brand-new row, never an edit to an existing
    one.
    """

    approved = "approved"
    pending_review = "pending_review"
    rejected = "rejected"


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
    intercept = "intercept"


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
    restore = "restore"
    status_change = "status_change"
    commit = "commit"
    login = "login"
    login_failed = "login_failed"
    logout = "logout"
    checkout = "checkout"
    checkin = "checkin"
    discard = "discard"
    revert = "revert"
    fork = "fork"


class AuditEntityType(str, enum.Enum):
    """The "group" an audit entry is filed under. A flat list underneath
    (see AuditLog) — this enum is what the UI groups/subgroups by.
    """

    emitter = "emitter"
    emitter_note = "emitter_note"
    ew_group = "ew_group"
    function_group = "function_group"
    ambiguity_finding = "ambiguity_finding"
    customer = "customer"
    intercept = "intercept"
    intercept_entry = "intercept_entry"
    intercept_note = "intercept_note"
    source = "source"
    source_note = "source_note"
    source_group = "source_group"
    mode_element = "mode_element"
    mode = "mode"
    mode_generation_batch = "mode_generation_batch"
    platform = "platform"
    platform_link = "platform_link"
    mdf = "mdf"
    mdf_link = "mdf_link"
    mdf_note = "mdf_note"
    test_record = "test_record"
    test_line = "test_line"
    prs_import = "prs_import"
    import_batch = "import_batch"
    parameter_sequence = "parameter_sequence"
    user = "user"
    auth = "auth"
