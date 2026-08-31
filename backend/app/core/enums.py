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


class ModeStatus(str, enum.Enum):
    """A Mode's place in the propose/approve micro-workflow for line edits.
    Metadata-only edits (name, notes, EW Group) bypass this entirely and stay
    instant — only a change to the actual RF/PW/PRI line goes through it.

    approved   - the live, canonical line. What ambiguity checks, XML export,
                 and Emitter version snapshots all see.
    draft      - a proposed edit, pending review. Carries `supersedes_id`
                 pointing at the approved Mode it would replace.
    superseded - a formerly-approved Mode whose draft edit was approved.
                 Permanently kept for lineage; excluded from active views.
    rejected   - a draft whose edit was declined. The original it targeted
                 was never touched and stays approved.
    """

    approved = "approved"
    draft = "draft"
    superseded = "superseded"
    rejected = "rejected"


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
    import_batch = "import_batch"
    parameter_sequence = "parameter_sequence"
    user = "user"
    auth = "auth"
