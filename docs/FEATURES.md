# Features

This document walks through every feature of the RF Emitter Profile Manager, organized in the order data flows through the system: **Emitters → Platforms → Mission Data Files (MDFs)**, plus the cross-cutting tools (versioning, ambiguity checks, test tracking, backups) that apply at each level.

If you just want to see it running, start with the [README](../README.md). This document explains *what each screen does and why it works the way it does*.

---

## 1. Emitters

An **Emitter** is the top-level record for a single RF emitter profile. It has a **name** (unique) and an optional **designation** (e.g. a platform-independent reporting name), plus a free-text description.

An Emitter is always edited as a **live draft** — changes save immediately, and nothing is locked in until you explicitly [commit a version](#5-versioning--diffs). Two things live inside an Emitter:

- **EW Groups** — operational groupings of Modes (see below)
- **Sources** — data-provenance groupings of Modes, and the home of the element-based mode-building tools (see [DSL, Elements & Editorial Tools](#3-modes-the-dsl-elements--editorial-tools))

Every Mode belongs to exactly one EW Group *and* exactly one Source — two independent, orthogonal groupings of the same underlying Modes.

### EW Groups

An EW Group represents an operational grouping — think "the set of modes this emitter uses while in track mode." Each EW Group carries:

- **Scan min / max** — the group's scan parameter range, as raw/as-entered
- **Scan delta** (optional) — a symmetric ± tolerance margin; see [Raw vs. engineered values](#raw-vs-engineered-values) below
- **Threat priority** — a numeric priority value
- **Ageout** (optional, seconds) — a plain descriptive reference value. No automated behavior is tied to it (nothing expires or gets flagged when it elapses) — it's recorded and displayed only.

EW Groups are how the "EW Groups → Modes" tab on the Emitter page is organized: expand a group to see (and add) its Modes.

---

## 2. Modes and PRI Types

A **Mode** is one RF/PRI/PW parameter set. Every Mode has exactly one **Mode Line** — the actual RF, PW, and PRI values — and a **PRI Type** that determines which fields are required:

| PRI Type | Fields | Notes |
|---|---|---|
| **Fixed** | PRI min/max **and Jitter min/max** | Both PRI and Jitter ranges are required together. |
| **Stagger** | An ordered sequence of discrete PRI values (µs) | Order matters — it's a repeating stagger pattern. Frame time (see below) is the sum of one full cycle. |
| **CW** (continuous wave) | *(none)* | PRI is constant/not applicable — the field is deliberately left blank. |
| **Xlet** | *(none yet)* | A stub for a future PRI type; no fields are defined, and it's rejected by the DSL parser until they are. |

RF is always in **MHz**; PW, PRI, and Jitter are always in **µs** — fixed units for now to keep the input format simple.

Every Mode also carries `rf_min/max` and `pw_min/max`, always required regardless of PRI Type.

---

## 3. Modes: the DSL, Elements & Editorial Tools

There are two ways to build a Mode, and they're designed to be interchangeable:

### Typed DSL entry

Type a mode line directly using a small custom syntax:

```
RF 2900-3100 PRI FIXED 800-1200 JITTER 5-15 PW 0.5-1.2
RF 2900-3100 PRI STAGGER [800, 850, 900, 780] PW 0.5-1.2
RF 2900-3100 PRI CW PW 0.5-1.2
```

Submitting a typed line does two things at once: it creates the Mode (with its parsed RF/PRI/PW values), **and** it derives matching RF/PW/PRI building blocks into the parent Source's **Elements** pool — so the same values immediately show up as reusable elements, ready for the cartesian-product tool below. Parse errors are reported inline with the offending text.

### Elements + Cartesian Product

Alternatively, build up a pool of reusable building blocks under a Source's **Elements** panel:

- **RF elements** — a min/max range
- **PW elements** — a min/max range
- **PRI elements** — either a Fixed-style range (+ optional Jitter) or a Stagger sequence

Then use the **Cartesian Product** tool: pick one or more RF elements, PW elements, and PRI elements, choose a target EW Group, and run it. The tool generates **one new Mode per combination** — N RF × M PW × K PRI elements produces N×M×K Modes in one action. This is the fast path for generating a large family of related modes (e.g. sweeping RF sub-bands against a couple of PRI options).

Mixing Fixed-style and Stagger PRI elements in a single cartesian-product run is rejected — pick one shape per run so the resulting batch is predictable.

### Raw vs. engineered values

An element's min/max is the **raw** value — pulled straight from the source, exactly as reported, with no adjustment. Separately, an RF, PW, or Fixed-style PRI element (not Stagger, for which delta means something different — see Frame Time below) can carry an optional **delta**: a symmetric ± tolerance margin representing sensor/collection measurement uncertainty. When a delta is set, the app computes the element's **engineered** range (`raw min − delta` to `raw max + delta`) and shows it alongside the raw value wherever the element appears — the raw value itself is never overwritten.

The engineered range, not the raw range, is what actually gets written into the generated Mode Line when the element is used in a cartesian-product run — so ambiguity checks, the Mode's DSL text, and XML export all see the engineered value, while the Elements pool keeps the raw value on record for provenance. An element created by typing a DSL line directly gets no delta (the typed numbers are already treated as final); go back to the Elements panel afterward to add one if the source data needs an engineering margin.

A manually-created or manually-edited Mode Line carries its **own** per-parameter deltas — `rf_delta`, `pw_delta`, and (for Fixed PRI) `pri_delta` — required fields, same status as `rf_min_mhz`/etc. Cartesian-generated and DSL-parsed lines don't set these: the engineered value is already baked into the line's raw min/max at generation time, so a separate delta would be redundant.

EW Group **scan delta** works the same way for computing an engineered scan window, but for v1 it's display-only: XML export still exports the group's raw `scan_min`/`scan_max` unchanged. Say so if you'd rather XML export emit the engineered scan window instead.

### Frame Time

Next to any Stagger element or Stagger Mode, a **Frametime badge** shows the sum of its sequence — the time for one full cycle through the stagger pattern.

A Stagger PRI **element** must carry a **delta** (repurposing the same `delta` field used for RF/PW/Fixed-PRI elsewhere, now meaning a frame-time tolerance rather than a range tolerance) — the app can't compute an engineered frame-time window without it, so it's required, not optional, specifically for Stagger. This is also how frame time flows through the cartesian-product tool: since a Stagger PRI element can't exist without its delta already set, every cartesian-generated Stagger Mode automatically inherits a valid frame-time delta with no separate input needed in the Cartesian Product form itself.

A manually-created or manually-edited Stagger Mode Line carries its own `frame_time_delta_us`, entered directly in the Mode form next to the stagger sequence (which shows a live "Suggested frame time" hint as you type the sequence). The engineered frame-time range (`frame time − delta` to `frame time + delta`) is shown wherever the sequence appears.

### Range Matching

A per-parameter flag — `RF`, `PW`, and `PRI` are each independently on or off for a given Mode Line. Currently a stored flag only; no behavior elsewhere in the app reacts to it yet, but it's shown as its own sortable column on the Modes table (and its own field on the Mode cards view), rendering one small tag per active parameter (e.g. `RF` `PRI` side by side) or `—` if none are set.

Range matching is treated as **any other Mode Line parameter** — set when creating a Mode, and freely editable afterward like the rest of the line (see [Editing an existing Mode](#editing-an-existing-mode) below), gated only by holding the Emitter's checkout (see [Versioning & Diffs](#5-versioning--diffs)).

---

### Editing an existing Mode

Every field on a Mode — metadata (name, notes, which EW Group it's filed under) and the actual line (RF/PW/PRI/jitter/stagger values, deltas, range matching flags) alike — edits in place immediately, the same way everything else in the app works. The only gate is holding the Emitter's **checkout**: without it, every mutating action on the Emitter and everything under it (EW Groups, Sources, Modes, Elements) is rejected. There's no separate propose/approve step for a Mode line anymore — if you get something wrong, either edit it again or use the Emitter's **Discard changes** / **Revert to a version** actions (see [Versioning & Diffs](#5-versioning--diffs)) to get back to a known-good state.

### Batch Edit

Select multiple Modes (checkboxes on the table or card view — a header checkbox selects every currently-filtered Mode) and apply one change across all of them at once via **Batch Edit**: EW Group reassignment, an overwritten Notes value, the three Range Matching flags (each an independent tri-state — leave unchanged / turn on / turn off, not just a single on/off), and the four delta fields (`rf_delta`/`pw_delta`/`pri_delta`/`frame_time_delta_us`). Only fields you actually touch are sent, so leaving something blank/unchanged never overwrites it.

It's **all-or-nothing**: every selected Mode's resulting line is validated in memory first (e.g. a PRI delta is invalid on a CW Mode), and if *any one* would end up invalid, nothing is written to any of them — every failure is listed by Mode name so you can see exactly which selections are the problem before retrying. It does not cover RF/PW/PRI min/max/stagger values directly (collapsing many Modes' ranges to one literal value is never what a batch edit means for a per-Mode range) and doesn't re-run `require_manual_deltas` (a batch edit doesn't change where a line *came from*, only its fields). Gated by the Emitter's checkout, same as every other Mode mutation.

### Test-Derived Modes

A Mode's values don't always come from a Source — real-world testing can turn up an emission a datasheet never mentioned, or reveal that an existing Mode's parameters are wrong. Both the "+ Add Mode" form and an existing Mode's edit form let you optionally link it to one or more existing **Test Records** whose findings explain its values ("this Mode is test-derived"). A linked Mode shows a **Test-Derived** badge with a popover listing the justifying test(s) — explainability for a Mode that didn't come from a Source, without needing a Source to explain it.

---

## 4. Sources

A **Source** groups Modes by where the data came from (e.g. a specific collection event or report). Each Source has:

- Name and description
- **Date last updated** — a plain date *you* enter, independent of the record's actual edit timestamps. It's a fact about the data ("this is current as of..."), not a system-generated audit field.
- Its own pool of **Elements** (see above) — the working set Modes under this Source were built from

Sources are scoped per-Emitter — each Emitter curates its own list.

A Source can't be deleted while it still has Modes attached.

### Source Groups, legacy terms, and element details (API only)

Backend support exists for grouping Sources under a **Source Group** (`/source-groups`, name + description), tagging a Source with `rf_legacy_term`/`pri_legacy_term`/`source_type` free-text fields (alongside its existing `description`, not replacing it — for reconciling against older naming conventions in imported data), and attaching a free-text `details` note to an individual Element. All of this is reachable via the API and schema today; **no frontend UI has been built for any of it yet** — it's scoped for a future pass once the shape of the data these are meant to reconcile against (e.g. an XML import) is clearer.

### Import

Beyond typing a DSL line or building Elements by hand, a Source's Elements and Parameter Sequences can be bulk-imported from a structured JSON payload — one `POST /emitters/{emitter_id}/imports` call creates a new Source (starting `pending_review`, same as any imported data) per "parametric set" in the payload, each carrying its own Elements/Sequences. A `/validate` dry-run endpoint checks the payload (cross-object checks like duplicate Source names within one import) without writing anything, returning field-path-addressable issues suitable for a pre-commit review UI.

**XML import — not yet built.** The Elements panel has an "Import from XML" entry point ("coming soon") that will eventually parse an uploaded XML datasheet into this same JSON shape rather than requiring it hand-typed. See **[docs/XML_IMPORT_BRIEF.md](XML_IMPORT_BRIEF.md)** for the full field-mapping reference and open design questions before that work starts.

---

## 5. Versioning & Diffs

Emitters, Platforms, and MDFs are all **versioned** the same way:

- The live record is always an editable **draft**.
- **Commit Version** takes a full, immutable snapshot of the current state (for an Emitter: every EW Group, Source, Mode, and Mode Line) and adds it to that entity's version history, numbered sequentially (v1, v2, v3, ...). An Emitter commit requires a non-blank change summary (Platform/MDF commits keep theirs optional).
- The **Version History** page lists every committed version and lets you pick any two to **diff** — added / removed / changed fields, shown with old vs. new values. By default it diffs a version against the one immediately before it, but you can compare against any earlier version too.

Nothing is ever silently lost: the live draft can keep changing, but a committed version is a permanent, inspectable snapshot you can always come back to.

### Emitter checkout, discard, revert & fork

An Emitter's live rows (and everything under it) can only be edited while you hold its **checkout** — an explicit lock, not a data copy. A banner on the Emitter's page shows whether it's free, held by you, or held by someone else, with a **Start Editing** button when it's free; an Admin can force-release a stale lock. A brand-new Emitter is auto-checked-out to whoever created it, so there's no extra click before populating it.

- **Discard changes** (available while you hold the checkout) reconciles live data back to the latest committed version and releases the checkout — for throwing away uncommitted edits. Disabled if nothing has been committed yet.
- **Revert to a version** reconciles live data to match an older committed version, then immediately commits a *new* version documenting the revert (`"Reverted to version N"`) — like `git revert`, history is never rewritten. It claims the checkout if it's free, and 409s if someone else holds it.
- **Fork a version** spins that version off into a brand-new, fully independent Emitter (fresh EW Groups/Sources/Modes/Elements, its own version history starting at v1), auto-checked-out to whoever forked it, with `forked_from_emitter_id`/`forked_from_version_id` recorded for traceability. Editing the fork never affects the source Emitter, and forking doesn't require holding the source's checkout.

Reconciliation (used by both discard and revert) matches EW Groups/Sources/Modes/Elements by the UUID a committed snapshot already preserves — a row that still exists in the target keeps its id (so a Test Record linked to a surviving Mode stays linked), a row absent from the target is deleted (the same cascade a manual Mode delete already does, not a new class of data loss).

Moving an Emitter's status to **Operational** (`validated`) requires a message describing what was validated, same as a manual commit — that transition is a trust signal everything downstream (Platforms/MDFs pinning this Emitter) relies on.

### Live diff (uncommitted changes) and mode-centric rendering

Next to the checkout banner, **View changes since last commit** shows a live diff between the Emitter's current draft state and its latest committed version — exactly what a **Discard** would throw away or a **Commit** would capture, without having to commit first just to see it. It's 404 (and hidden) until at least one version has been committed.

Both this live diff and the Emitter's version-to-version diff render **mode-centric**: entries are grouped under the actual Mode/EW Group/Source/Emitter they belong to (matched by the id a snapshot already preserves, so a Mode that moved position in its list is never mistaken for a different one) and labeled with a human field name (e.g. "RF Min (MHz)") instead of a raw nested-path string like `['ew_groups'][0]['modes'][1]['line']['rf_min_mhz']`. This is a different, richer shape (`app/services/emitter_diff_service.py`, schema `EmitterDiffOut`) than the generic path-based diff Platforms and MDFs still use (`app/services/diffing.py`, schema `DiffOut`) — those snapshot shapes are different enough (a Platform/MDF snapshot embeds whole Emitter snapshots inside `links`) that the mode-centric walker doesn't apply to them as-is.

### Status

Emitters and MDFs additionally carry a **status** that moves through a fixed set of legal transitions — you can't jump straight from `draft` to `validated`, for example:

- **Emitter status**: `draft` → `in_review` → `validated` → `deprecated`
- **MDF status**: `draft` → `pending_review` → `approved` → `released` → `deprecated`

Every status transition automatically commits a new version with an auto-filled summary (e.g. "Status: draft → in_review"), so your status history *is* your version history — nothing extra to look up.

---

## 6. Platforms

A **Platform** groups several Emitters — think "everything mounted on this aircraft/ship." Platforms are what actually gets pinned into an MDF, not Emitters directly.

Critically, a Platform doesn't reference an Emitter's live draft — it **pins to a specific committed Emitter version**. This means editing an Emitter later never silently changes a Platform that already pinned an earlier version. If you need the Platform to pick up new Emitter changes, you explicitly **repin** it to a newer version (the "Pin an Emitter Version" tool lets you pick from any of that Emitter's committed versions).

Platforms are versioned exactly like Emitters (commit, history, diff) — a Platform version snapshots the full set of emitter/version pins at that point, including each pinned emitter's complete nested data.

---

## 7. Mission Data Files (MDFs)

An **MDF** is the deployable artifact — the file structure actually loaded onto the RF Recognizer. MDFs link to **Platforms** (never directly to Emitters), and just like Platform→Emitter pinning, an MDF pins to a specific **committed Platform version**. This gives you a two-level pin (MDF → Platform version → Emitter version), so changes at either lower level never silently ripple upward into an MDF you've already built.

MDFs are versioned the same way as everything else, and carry their own status lifecycle (see [Versioning & Diffs](#5-versioning--diffs) above).

### Readiness signals

Before moving an MDF toward `approved` or `released`, the app checks two things and surfaces them as **soft warnings** (never a hard block — the decision stays with you):

- Are all the emitters referenced (transitively, through pinned platforms) marked `validated`?
- Is there at least one passing [test record](#8-test-tracking) on file for this MDF?

If either check turns up something, you'll see the warnings in a confirmation prompt before the transition goes through. You can always proceed anyway.

---

## 8. Test Tracking

A **Test Record** logs real-world validation — a simulation run, lab bench check, live range test, or field exercise — against either an Emitter or an MDF. Each record captures:

- Test type (simulation / lab bench / live range / field exercise)
- Result (pass / fail / partial / inconclusive)
- Title, notes, and the date tested
- Optionally, which specific Modes were exercised

A test record automatically pins to whichever version of the Emitter or MDF was the latest *committed* one at the moment you logged it — so your test history stays accurate to what was actually tested, even as the draft keeps changing afterward.

---

## 9. Dashboard

The **Dashboard** is the landing page after login: status-count tiles for all Emitters and MDFs at a glance, plus a **Needs Attention** panel that surfaces:

- Emitter drafts that haven't been committed in over a week
- Any MDF with open readiness warnings (unvalidated referenced emitters, or no passing test on file)

---

## 10. Ambiguity Checks

The core analytical feature: detecting when two Modes' parameter spaces overlap closely enough that the Recognizer might not be able to tell them apart.

### How it works

Each Mode Line is treated as an RF × PW × PRI box. For every pair of Modes in scope:

- **RF and PW** always compare as simple range overlaps.
- **PRI** comparison depends on the pair of PRI Types involved:
  - Fixed vs. Fixed → range overlap
  - Stagger vs. Stagger → shared discrete values
  - Fixed vs. Stagger → what fraction of the stagger's values fall inside the fixed range
  - Anything vs. **CW or Xlet** → PRI has no value to compare, so the check degrades to **RF+PW only** (flagged explicitly, not silently ignored)

Each dimension gets an overlap percentage (`intersection ÷ smaller of the two ranges`, so a narrow mode fully contained in a wide one still reads as highly ambiguous). Overall severity buckets from a configurable **tolerance** (low / high / exact thresholds, editable by Editors and Admins) into: `none`, `low`, `medium`, `high`, or `exact_overlap`.

### Three scopes

Run a check at three levels, each reusing the same engine:

- **Per-Emitter** — every Mode against every other Mode within one Emitter
- **Per-Platform** — every Mode across every Emitter version pinned into one Platform (catches ambiguity between emitters riding the same platform)
- **Per-MDF** — every Mode across every Emitter transitively referenced (through pinned Platforms) by the MDF

A check always runs against a specific **committed version** (the latest by default), never the live draft — so results are reproducible and tied to a known snapshot, not a moving target. Runs execute in the background; the page polls until it completes.

### Visualization

- **Ambiguity Matrix** — a clickable heatmap: one row/column per Mode involved in at least one finding, cell color = severity.
- **RF/PW/PRI range comparison** — click a matrix cell (or a row in the findings table) to see a side-by-side range-bar chart for that specific pair, including a discrete-point view for Stagger sequences.
- **Findings table** — every flagged pair with its per-dimension overlap percentages, filterable by severity.

### Review workflow

Editors and Admins can **Acknowledge** a finding (with an optional note) to mark it as reviewed/accepted, and **Unacknowledge** it later if circumstances change. Acknowledging doesn't delete or hide the finding — it's a record that a human looked at it and made a call.

---

## 11. XML Export

Any committed MDF version can be exported to XML — the file format meant to actually load onto hardware. The export walks the full pinned hierarchy: **Platforms → Emitters → EW Groups → Modes → Mode Lines**.

Two things worth knowing:

- **Sources and Elements never appear in the export.** They're an authoring/organizational construct with no meaning outside this tool — the export excludes them by construction (the serializer never even reads that part of the snapshot).
- **The XML tag names are placeholders.** Since the target system's real XML Schema (XSD) wasn't available when this was built, all tag-name mapping lives in one file (`backend/app/xml_export/field_mapping.py`). Swapping in the real schema later is a data change to that file, not a rewrite of the export logic.
- **RF/PW/PRI values exported are already engineered** (raw ± any element delta, applied when the Mode was generated — see [Raw vs. engineered values](#raw-vs-engineered-values)); **EW Group scan range is exported raw**, ignoring `scan_delta`, since scan delta is display-only for v1.
- **Not yet exported at all:** per-parameter deltas (`rf_delta`/`pw_delta`/`pri_delta`), `frame_time_delta_us`, Range Matching flags, and EW Group `ageout`. None of these existed when the export mapping was built; whether they belong in the target XML format (and under what tag names) is undecided.

Export is available from the MDF page (latest committed version) and from the MDF's Version History page (any specific version) — click **Export XML** to download.

This placeholder format predates the real target format below and is kept only because nothing consumes it downstream yet; new integration work should use PRS Export instead.

---

## 11a. PRS Export

A second, separate export: the **real** target format (namespace `urn:com:bae:prs:pfm:library`), confirmed against actual sample files from the target system rather than guessed. Unlike the placeholder XML Export above, this one reads the correct field for every value it has one for — including the fields the placeholder export never got: per-parameter Range Matching, EW Group Ageout, and the engineered Frame Time range.

Available from a committed **Platform** version or a committed **MDF** version — `GET /platforms/{id}/versions/{n}/export/prs` and `GET /mdfs/{id}/versions/{n}/export/prs` — download a ZIP package (`backend/app/services/prs_export/`), not a single file, matching how the real format ships:

```
<name>.xml              — root ThreatLibrary, references a DefaultUnknown platform + the real MDF/Platform
platforms/<name>.xml    — one file per pinned Platform
emitters/<name>.xml     — one file per pinned Emitter (deduplicated across Platforms)
```

A Platform-level export synthesizes its own single-Platform root (there's no real MDF in scope), everything else is identical.

What's real vs. placeholder in the generated XML:

| Field | Source |
|---|---|
| RangeMatch (Frequency/PulseWidth/PRI) | Real — from `rf_range_matching`/`pw_range_matching`/`pri_range_matching` on the Mode Line |
| Ageout | Real — from the EW Group |
| Frequency/PulseWidth Min/Max | Real — engineered (raw ± delta), same values as the placeholder export |
| PRI (Simple/Stagger/Xlet/CW) | Real — Stagger's `FramePeriod` is the engineered frame time range (`compute_frametime_us` sum ± `frame_time_delta_us`); CW correctly emits an empty `<PRI Class="CW" />` with no children, matching the real sample exactly |
| ThreatPriority | Real — from the EW Group |
| LethalCeiling, LethalPower, MinERP/MaxERP, ConfirmationQuality/Quantity, Scan Class, Platform Hostility/Base | **Placeholder constants** — this app has no field for any of these yet; see `backend/app/services/prs_export/serializer.py` for the exact stand-in values |
| Dwell files | **Not generated at all** — the real format has a `dwells/` directory but no corresponding data model exists anywhere in this app; a known gap, not an oversight |

Like every other export/ambiguity consumer, this reads only committed version **snapshots**, never live/draft ORM state — an already-pinned version's PRS export never changes underneath you.

---

## 12. Backup & Restore

Since this app runs fully offline, its own database backups *are* the disaster-recovery plan — there's no cloud fallback. Whole-database `pg_dump` backups are:

- **Scheduled independently of the app** (OS cron, not an in-process job) so a backup still runs even if the web app itself is down
- **Written to a separate disk/volume from the live database**, so one disk failure can't take out both the data and its backups
- **Pruned on a retention policy** (keep recent daily backups, thin older ones down to weekly/monthly) so the backup directory doesn't grow forever
- **Automatically verified** on a schedule — a real restore into a scratch database, checked, and torn down again, so a backup that silently stopped working gets caught

Restoring is a deliberate, operator-run CLI action (not a UI button) — it overwrites live data, so it requires explicitly confirming the target database name. See the [README](../README.md#backups) for the exact commands.

---

## 13. Accounts & Roles

Three roles, enforced by the backend on every request (not just hidden in the UI):

| Role | Can do |
|---|---|
| **Viewer** | Read everything, including version diffs and ambiguity dashboards. Can trigger ambiguity runs (non-destructive) but not edit tolerance thresholds or acknowledge findings. |
| **Editor** | Full CRUD on Platforms/Emitters/EW Groups/Sources/Modes/Elements, commit versions, build/pin Platforms and MDFs, run ambiguity checks, acknowledge findings, log test records. |
| **Admin** | Everything Editor can, plus the [Admin panel](#14-admin-panel) (user management, Recently Deleted) and hard/permanent delete. |

Authentication is local username/password (no external identity provider, matching the offline requirement), with the session stored in an httpOnly cookie and CSRF protection on every state-changing request.

---

## 14. Admin Panel

Admin-only (both the nav link and the routes themselves redirect a non-admin away, not just hide the link) — two sections:

### Users

Create a user (username, password, role) directly from the UI — previously only possible via a one-off CLI script. Existing users can have their role changed or be **deactivated/reactivated** inline. Deactivation, not deletion, is how a user's access is revoked: there's no "delete a user" action, so a user row is never actually removed (and every audit-log entry that names them as the actor stays attributable).

### Recently Deleted

Emitters, Platforms, and MDFs are already soft-deleted by default when you delete one from its list page (see the [Roles](#13-accounts--roles) table above — hard/permanent delete is a separate, Admin-only action). This section is where that soft-deleted data actually lives:

- Every soft-deleted item, across all three entity types, in one list with a live "days left" countdown (30 days by default, `TRASH_RETENTION_DAYS`).
- **Restore** — reverses the soft delete; the item reappears wherever it normally lives.
- **Delete forever** — Admin-only, immediate, irreversible hard delete from the trash view itself.
- **Automatic purge** — a cron-run script (`backend/scripts/purge_deleted.py`, see the [README](../README.md#backups) for the crontab entry) hard-deletes anything past the retention window on a schedule, so nothing relies on a human remembering to empty the trash.

Restoring can fail with a 409 if another item now holds the same name — rename the conflicting one first.
