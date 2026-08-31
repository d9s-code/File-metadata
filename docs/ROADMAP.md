# Roadmap

Backlog notes for features under consideration but not yet built. Unlike [FEATURES.md](FEATURES.md), which documents what exists today, this document is a set of proposals — nothing here is scheduled or guaranteed.

---

## Audit Trail

**Status:** Shipped (`9d3ea77`) — see `backend/app/models/audit_log.py`,
`backend/app/routers/audit_log.py`, `frontend/src/pages/AuditLogPage.tsx`. The scope below
describes the original proposal; the shipped version is worth diffing against it to confirm the
"explicitly out of scope" boundaries were respected before removing this note entirely.

**What it would be:** an append-only log of who changed what, when — across Emitters, Platforms, and MDFs at minimum, possibly extending to EW Groups/Sources/Modes. Each entry would record the actor, the action (create / update / delete / status change), the entity affected, and a summary of what changed.

**Why it's on the roadmap:** this app currently has no record of *who* made a given change or *when*, only the committed-version snapshots themselves (see [Versioning & Diffs](FEATURES.md#5-versioning--diffs)). A version diff shows *what* changed between two commits, but not who made the edits that led there, or what happened on the live draft between commits.

**Scope, deliberately kept light:** a single `AuditLog` table —

```
AuditLog(id, actor_id, action, entity_type, entity_id, changes JSONB, created_at)
```

— written from the existing service-layer functions that already handle commit/update/status-transition for Emitter/Platform/MDF, surfaced as a simple chronological feed (global "Recent Activity" list, per-entity, or both — left open for whenever this is actually scoped).

This is intentionally *not* modeled after heavier prior art: a sibling project's `AuditEvent` design additionally guards against bulk ORM writes bypassing the log (blocking `QuerySet.update()`/`delete()` at the manager level, not just instance `save()`/`delete()`) and enforces immutability at the database layer. That's real protection, but it's also exactly the kind of stacked governance machinery that made that project hard for one person to maintain. This app doesn't have that machinery today and shouldn't grow it just to support an audit log — a plain table with writes on the existing code paths gets most of the value (who changed what, when) without it.

**Explicitly out of scope for this entry:**
- Any bulk-write immutability guard
- Any UI beyond a simple chronological list
- Retroactive backfill of history for existing data

---

## XML Import

**Status:** Not yet started — implementation work is about to begin (by a
separate agent/session), briefed via
[docs/XML_IMPORT_BRIEF.md](XML_IMPORT_BRIEF.md) rather than this entry.

**Why it's here:** flagging that it's imminent, and that the brief document
identifies an open fork in the design (datasheet/parametric import at the
Source/Element level vs. a full MDF round-trip import mirroring XML export)
that hasn't been resolved yet — resolve it before treating either direction
as "the" XML import feature.

---

## Considered and rejected

**Per-kind pattern flexibility (Stagger/Switcher/Dwell/Jitter for RF and PW, not just PRI).** A sibling project supports this for all three parameter kinds via a legality-matrix `CheckConstraint`. Not added here by default — it's a real schema expansion, not a bolt-on, and should only be scoped if there's an actual case where RF or PW needs to be more than a fixed range, rather than added because another project has it.

**Dual-row draft/approved versioning, per-entity approval guards, per-value source provenance chains.** All present in the sibling project. Deliberately not adopted: this app's snapshot-based versioning (draft row + immutable JSONB snapshots on commit) already gives reproducible history without a second shadow-row per entity, and the sibling project's stacked guard-mixin approach is a strong candidate for *why* that codebase became hard to govern. Recreating it here would reintroduce the same problem this project was started to avoid.
