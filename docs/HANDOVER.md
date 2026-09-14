# Handover

A session briefing for whoever (human or LLM) picks this project up next. Read this first,
then follow its pointers — it doesn't repeat what's already documented elsewhere.

**Repo:** `d9s-code/File-metadata` — branch `claude/rf-recognizer-emitter-profiles-le5jik`,
pushed to `origin`, working tree clean as of this doc.

```
git clone https://github.com/d9s-code/File-metadata.git
cd File-metadata
git checkout claude/rf-recognizer-emitter-profiles-le5jik
```

## ⚠ If you're merging another branch into this one

This session (item 12 below) **removed the entire Mode-level propose/approve/reject
workflow** — `Mode.status`, `Mode.supersedes_id`, `POST .../modes/{id}/draft`,
`.../approve`, `.../reject` are all gone from both backend and frontend, replaced by
direct in-place line edits gated by a new Emitter-level **checkout** lock (see below).
Before merging any other branch/agent's work into this one:

- **Search the incoming branch for `ModeStatus`, `supersedes_id`, `propose_mode_draft`,
  `ModeDraftForm`, `/draft`/`/approve`/`/reject` on the modes router.** If it touches any
  of these, you have a real conflict to resolve by hand — the underlying feature it's
  built on no longer exists on this side.
- **Migration `d6c8b50650d6_remove_mode_draft_workflow` runs `DELETE FROM modes WHERE
  status != 'approved'` before dropping the column.** If the other branch's work (or
  data) created any Mode with `status` other than `approved` (i.e. an actual pending
  draft), running this migration after merging will silently delete those rows. Check
  for that *before* running `alembic upgrade head` on any database the other branch's
  changes have touched.
- Every mutating Emitter/EW-Group/Source/Mode endpoint now requires the Emitter to be
  **checked out** by the requesting user (`checked_out_by_id` on `emitters`, gated via
  `require_emitter_checkout`/`require_ew_group_checkout` in `app/deps.py`). If the other
  branch added a new mutating endpoint under `/emitters/{emitter_id}/...` or
  `/ew-groups/{ew_group_id}/modes/...`, it almost certainly needs the same gate added —
  it won't fail loudly, it'll just let anyone edit a checked-out-by-someone-else Emitter.
- **Item 13 (this session's most recent work) changed what the two Emitter diff endpoints
  return** — `GET /emitters/{id}/diff/live` and `GET /emitters/{id}/versions/{n}/diff` now
  return the new `EmitterDiffOut` shape (`{entries: [{scope, label, kind, old_value,
  new_value}], identical}`), not the old generic `DiffOut` (`{added, removed, changed,
  identical}`, each entry a raw DeepDiff path). **Platform/MDF diff endpoints are unaffected
  — they still return the old `DiffOut` shape.** If the incoming branch touched
  `app/schemas/emitter_version.py`, `app/services/diffing.py`, either Emitter diff route in
  `emitters.py`, `frontend/src/types/versioning.ts`, `DiffViewer.tsx`, or built any frontend
  code that consumes an Emitter's diff response, expect a real conflict — check which shape
  it assumes before merging either side's version in.
- **Item 13 also added `POST /emitters/{emitter_id}/modes/batch-edit`** (new
  `mode_batch_service.py`, new `BatchModeFieldEdit`/`ModeBatchEditRequest` schemas in
  `schemas/mode.py`). If the incoming branch independently built Mode batch editing — a real
  possibility, see item 11 above where a *different* unsupervised agent had already attempted
  something similarly named in a sibling copy of this repo — treat it the same way item 11
  was handled: read both implementations in full and rebuild the real intent cleanly against
  whichever validation/all-or-nothing semantics are correct, don't try to reconcile two
  competing endpoints at the same path by hand.

## Where to start

- **[README.md](../README.md)** — what this app is, the stack, and exact local-dev / Docker
  Compose / test setup commands. Follow it verbatim to get running.
- **[docs/FEATURES.md](FEATURES.md)** — the feature reference. Read this before touching any
  area of the code; it explains not just what each screen does but *why* (e.g. why Platforms,
  not Emitters, get pinned into an MDF).
- **[docs/ROADMAP.md](ROADMAP.md)** — proposed-but-not-built features (currently: an Audit
  Trail), plus a "considered and rejected" section explaining design calls made in this
  session that were deliberately *not* taken from a sibling project.

## What this project is, briefly

A fully offline FastAPI/SQLAlchemy/Alembic/PostgreSQL + React/TypeScript/Vite web app for
managing RF emitter profiles: Emitters → EW Groups + Sources → Modes (built via a typed DSL or
an Elements+cartesian-product tool) → grouped into Platforms → pinned into versioned MDFs, with
snapshot-based versioning/diffing, a pairwise ambiguity-overlap engine, XML export, and
role-based access (Viewer/Editor/Admin).

## Session history (chronological, most recent last)

All 7 original build phases (schema/auth/CRUD, DSL+elements, versioning, Platforms, MDFs+dashboard,
ambiguity engine, XML export) plus dark mode and initial docs were completed and pushed before
this log starts. Since then, in order:

1. **`8fe153b`** — Added a per-element `delta` (and EW Group `scan_delta`): a symmetric ±
   tolerance margin producing an "engineered" value from the raw source value, used downstream
   in generated Mode Lines.
2. **`c24d83b`** — Frontend UX pass: shared `ConfirmDialog` for destructive actions, flattened
   the Emitter editor so Modes lead (EW Groups/Sources demoted to a collapsible setup panel —
   they were wrongly dominating the page), added a table/card view toggle for Modes.
3. **`5ff651a`** — Scale/oversight pass (triggered by "an emitter may have 70+ modes"): search +
   sortable min/max columns with hover-detail popovers on the Modes table, persisted
   `ModeGenerationBatch` entities (fixed a real `sort_order` collision bug across repeated
   cartesian-product runs), EW Group/Source scope filters + visual clustering on the ambiguity
   matrix.
4. A separate Django sibling project (`emitter-web-repo`, uploaded by the user, not part of this
   repo) was reviewed in depth for data-model and workflow comparison. Conclusion delivered to
   the user: its *ideas* (an audit trail, its `SensorModeWindow`/`RelationshipExpansion` design
   independently converging with our `delta`/`ModeGenerationBatch`) are worth learning from, but
   its *architecture* (dual-row draft/approved versioning + stacked ORM guard mixins) is likely
   why that project became hard for one person to govern, and should not be ported wholesale.
5. **`b3935ae`** — Per the above, added `docs/ROADMAP.md` documenting the Audit Trail as a
   scoped-down proposal (write-up only, not implemented), and explicitly rejecting the heavier
   patterns. Note while writing it: this app **already has** a version-diff view
   (`DiffViewer.tsx` + `*VersionHistoryPage.tsx`) — an earlier claim in conversation that it was
   missing was wrong and was corrected to the user.
6. **A full app-wide review** was run via parallel Explore agents across backend, frontend, and
   ops/deployment. Full findings are below (not all fixed yet — see "Open items").
7. **`864d1d1`** — Fixed the three *security* findings from that review (the user's first
   chosen priority): CSRF was missing on the cartesian-product endpoint; `/auth/login` had no
   rate limiting (now: 5 failed attempts/15min/username → 429, in-memory, fine for the app's
   single-worker deployment); Viewers could set a custom ambiguity `tolerance_config`, contradicting
   `docs/FEATURES.md` (now Editor+ only). 17 new backend tests added; all verified live against a
   running server, not just unit tests.
8. **A second, narrower review** of frontend *workflow logic* (not accessibility, not code
   quality — distinct from item 6) was run, again via parallel Explore agents, walking real user
   stories through the Emitter editor, versioning/pinning, ambiguity dashboard, test tracking,
   and navigation. Findings below, under "Open items." The user was mid-way through choosing
   which to prioritize when this handover was requested — no answer was given.
9. **`9d3ea77`–`e05e5d9`** — While this handover doc was being written, **a concurrent session
   under this same account** (`yildeez <d9s.yil@gmail.com>`, i.e. you, working locally or
   through another agent — not this session) pushed 5 commits directly to this branch: a full
   Audit Trail implementation (`9d3ea77` — the exact feature proposed in `docs/ROADMAP.md`;
   status there has been updated to "Shipped," **the roadmap entry's scope should be diffed
   against what actually shipped** before trusting it as documentation), a Mode form regroup
   into per-parameter rows with per-parameter deltas (`9cf0e37`; note this is a materially
   different delta model than the single Mode-level `rf_delta`/`pw_delta`/`pri_delta` described
   in item 1 above and `docs/FEATURES.md` §3 — **check which is now current before writing
   about deltas**), a fix making the Mode-name/EW-Group/Source hover popovers focus-driven in
   addition to hover-driven (`InfoPopover.tsx` now handles `onFocus`/`onBlur`, and popover
   positioning moved to a portal via a new `useFloatingPosition` hook, fixing a clipping bug —
   this likely closes or reduces the "hover popovers are hover-only" accessibility finding under
   "From the earlier full-app review" below, **not independently reverified in this session**),
   and test-tracking changes linking test records to specific Modes with per-mode status. This
   session merged those commits in (merge commit `5a96174`) rather than overwrite them, but
   **did not re-review the new code** beyond what's noted here — treat the "Open items" lists
   below as written *before* this merge except where a note says otherwise, and re-check
   anything they claim against current `main`/branch state before acting on it.

10. **This session** (a separate session from all of the above — picked up the repo cold via
    "pull up the server"). Shipped, in order:
    - Pulled in `claude/production-readiness` (fast-forward merge) — the Mode form
      per-parameter-delta regroup from item 9 above **is confirmed current**; the single
      Mode-level `rf_delta`/`pw_delta`/`pri_delta` described in item 1 is superseded.
    - Diagnosed and fixed a real bug found live: the "pre-fill from observed values"
      retest feature silently no-op'd because a `useState` initializer never resynced
      after mount (`ModeForm.tsx`).
    - Built soft-delete + a 30-day Recently Deleted trash (Emitters/Platforms/MDFs) +
      an Admin panel (Users create/role/deactivate, Recently Deleted with
      restore/permanent-delete), plus `scripts/purge_deleted.py` for cron-driven
      auto-purge. See `docs/FEATURES.md` §14. Caught a real bug during this: adding
      `AuditAction.restore` to the Python enum wasn't enough — Postgres's own native
      enum type needed a matching `ALTER TYPE ... ADD VALUE` migration too, or every
      restore/purge call 500'd.
    - Added per-Mode-Line **Range Matching**, **Frame Time** (Stagger PRI frame-time
      tolerance + engineered min/max), and EW Group **Ageout**. Range Matching shipped
      *twice*: the first pass built it as a single per-Mode boolean, freely toggleable;
      the user corrected this — it's actually three independent per-parameter
      (RF/PW/PRI) fields, and needed to be governed by the same propose/draft/approve
      workflow as any other Mode Line field, not an instant toggle. Second pass reverted
      the first design and rebuilt it as line-level fields. Worth remembering: this user
      wants line-level parameters treated uniformly, not given bespoke instant-edit
      shortcuts, even for flags that look metadata-like at first glance.
    - Added a dedicated, sortable **Range Matching** column to the Modes table/cards,
      rendering one tag per active parameter (not a joined string).
    - Wrote `docs/XML_IMPORT_BRIEF.md` ahead of a separate agent starting XML import
      work, and refreshed `docs/FEATURES.md`/`README.md`/this file accordingly.
    - All work verified live against the running dev server (this session's environment:
      Postgres as a native Windows service, not Docker — see updated environment notes
      below) in addition to the backend test suite (141 passing as of this entry).
    - Pushed to `claude/rf-recognizer-emitter-profiles-le5jik` (commit `e4424da`) and
      built a Windows offline-deployment zip (wheels + `node_modules` bundled, no
      internet needed on the target machine) for the user to test on a remote server.

11. **Same session, continued.** The user pointed at a second, separate
    non-git-tracked copy of this repo (`file-metadata_v2`) where a different AI agent
    had kept working unsupervised on XML import/export, Source Groups, and a Modes
    batch-edit — and asked for a review. Findings, in short: the JSON datasheet
    importer there (`json_import/transformer.py`) was solid and reuses this app's
    real validate/commit import pipeline correctly — worth porting later, not done
    this pass. Everything else needed real fixes before being trustworthy:
    - Its Alembic chain was broken (two heads, a fabricated dummy root migration, a
      destructive column rename via a hand-rolled inspector-based patch script) —
      not fixable in place, so instead of trying to reconcile it, the underlying
      *intent* (Source Groups, `sources.source_type`/legacy-term fields,
      `mode_elements.details`, two legitimate CASCADE FK fixes) was rebuilt as one
      clean migration (`f5a6b7c8d9e0_...`) against this repo's real, single-head
      chain. See `docs/FEATURES.md`'s new "Source Groups, legacy terms, and element
      details (API only)" note under Sources — backend/schema only, no frontend UI
      yet, deliberately deferred until the shape of the data these reconcile against
      (e.g. an eventual XML import) is clearer.
    - Its PRS exporter was broken in ways that would have shipped silently wrong data
      to the target system: an undefined-name `NameError` on the MDF path, an
      unimplemented `export_mdf_to_zip` (literally `pass`), a namespace typo
      (`xml:pfm` instead of `urn:com:bae:prs:pfm:library`), and — worst — RangeMatch/
      Ageout/ThreatPriority all **hardcoded** rather than reading the app's real
      fields. Its own real sample files, though (`Profile_format/`, supplied
      externally, not git-tracked), were genuinely valuable and had never been
      cross-checked against the code claiming to match them — e.g. the code added a
      nested `<CW/>` child that the real sample never has, and claimed `Speed
      Units="knots"` where the real sample says `"kph"`. Read every real sample file
      in full and rebuilt the exporter clean against them
      (`backend/app/services/prs_export/`), reusing this app's existing
      `apply_delta`/`compute_frametime_us` services rather than reimplementing them.
      Wrote 7 new integration tests (`test_prs_export_api.py`) mirroring the existing
      `test_xml_export_api.py` pattern — full suite now 148 passing. See
      `docs/FEATURES.md` §11a and the "PRS Export" section in
      `docs/XML_IMPORT_BRIEF.md` for what's real vs. placeholder in the output, and
      the confirmed gap (no Dwell file generation — no data model for it anywhere in
      this app).
    - Explicitly **not** ported from the other copy, flagged for a future pass
      instead: the JSON importer mentioned above, and an `EwGroup.modes_count`
      feature (worked, but implemented by mutating an unmapped ORM attribute —
      needs a cleaner approach, e.g. a query-time count, before it's worth adopting).
    - Worth remembering: when a second unsupervised agent hands you "roughness to
      clean up," the useful move is triage, not merge — read every changed file,
      distinguish real external artifacts (the sample XML files) from generated
      code claiming to match them, and rebuild the legitimate intent cleanly against
      *your* repo's real state rather than trying to reconcile a broken migration
      chain or import code wholesale.

12. **This session** (a separate session from all of the above — picked up the repo cold,
    already at `d5ac357`). Two pieces of work:

    - **Small fix, found while seeding demo data:** the PRS exporter
      (`backend/app/services/prs_export/`) didn't sanitize `/`/`\` out of Emitter/Platform
      names when turning them into zip entry filenames or `<EmitterFile>` path references
      — a realistic designation like `AN/APG-99` silently produced a stray nested zip
      directory and a broken path. Added `sanitize_filename()` in `serializer.py`, used it
      everywhere a name becomes a path in both `serializer.py` and `packager.py`, plus a
      regression test.
    - **Main work: Emitter checkout, revert, and fork**, requested because editing an
      Emitter always mutated live rows directly with no way to undo, and the existing
      Mode-line propose/approve micro-workflow (item 1's `delta` era design, formalized
      further in item 10) added an extra click without giving the same protection at the
      whole-Emitter level. Replaced both with one model — full design rationale and the
      decisions made along the way are in `C:\Users\d9syi\.claude\plans\deep-greeting-parasol.md`
      if you need the "why" behind a specific choice, but the load-bearing points:
      - **Checkout**: `emitters.checked_out_by_id`/`checked_out_at`, claimed via
        `POST /emitters/{id}/checkout`, released via `DELETE` (holder or Admin), checked by
        every mutating Emitter/EW-Group/Source/Mode endpoint (see the merge-warning above).
        A new Emitter auto-checks-out to its creator.
      - **Discard** (`POST /emitters/{id}/discard`) and **Revert**
        (`POST /emitters/{id}/versions/{n}/revert`) both reconcile live rows to a target
        committed snapshot via one engine, `emitter_revert_service.py::reconcile_emitter_to_snapshot`
        — matches EW Group/Source/Mode/Element by the UUID a snapshot already preserves, so
        a surviving row keeps its id (and its TestRecord links) and only rows absent from
        the target get deleted. Discard doesn't commit anything; Revert does (behaves like
        `git revert`, not `git reset` — history is never rewritten).
      - **Fork** (`POST /emitters/{id}/versions/{n}/fork`) spins a version off into a
        brand-new, fully independent Emitter via `emitter_revert_service.py::build_forked_emitter`
        (fresh UUIDs throughout), auto-checked-out to the requester, with
        `forked_from_emitter_id`/`forked_from_version_id` set for traceability.
      - Mode-level propose/approve/reject is **gone** — see the merge warning above. Line
        edits are now instant `PATCH`es like everything else, gated only by the Emitter's
        checkout. The "derived from these test records" traceability that used to live on
        the propose-draft payload moved onto `ModeUpdate` directly.
      - Emitter "Commit Version" now **requires** a non-blank `change_summary` (Platform/MDF
        commits are unaffected, still optional — they share the versioning *engine*, not the
        request schema, which is now split: `CommitVersionRequest` vs. the Emitter-only
        `CommitEmitterVersionRequest`). Transitioning an Emitter to **Operational**
        (`validated`) also now requires a note, folded into the same `note` field the
        existing Operational→Needs-rework guard already used — one prompt, not two.
      - Two new Alembic migrations: `08de475c3012_emitter_checkout_and_fork_provenance`,
        `d6c8b50650d6_remove_mode_draft_workflow` (destructive — see merge warning). Both
        applied to this session's dev `rf_emitter_db`; **run `alembic upgrade head`**
        wherever else this branch lands.
      - **A real SQLAlchemy gotcha, worth remembering**: the first version of the new
        `Emitter.checked_out_by`/`forked_from_emitter`/`forked_from_version_id` fields used
        real `relationship()` objects and a real FK for `forked_from_version_id`. That
        created a genuine `emitters ↔ emitter_versions` table cycle
        (`EmitterVersion.emitter_id` already points back at `Emitter`), which didn't just
        break `Base.metadata.create_all`/`drop_all` (fixed with `use_alter=True` on the raw
        column) — it **also intermittently broke flush ordering for entirely unrelated
        inserts/deletes in the same transaction** (an `audit_log` insert racing a hard
        Emitter delete, ~50% flaky, reproduced with a tight repro script, not caught by a
        single test run). Root cause: two ORM relationships between the same two mapper
        classes (the primary `versions`/`emitter` pair plus the new one) gave the UOW
        dependency graph a real ambiguity, even though the second relationship never
        cascaded anything. Fix: dropped `forked_from_version_id`'s FK constraint entirely
        (it's a soft/display-only reference now, like `AuditLog.emitter_id`) and removed the
        `checked_out_by`/`forked_from_emitter` relationship objects — nothing actually used
        `emitter.checked_out_by` or `.forked_from_emitter` as ORM objects, only the raw `_id`
        columns, so this cost nothing. **If you ever add a new FK-with-relationship from
        `Emitter` back toward something `Emitter` already has a relationship to (directly or
        transitively), run the full suite 5+ times before trusting one green run** — this
        class of bug is real and doesn't announce itself as a warning every time.
      - New tests: `test_emitter_checkout_api.py`, `test_emitter_revert_api.py` (including a
        case reverting away an entire EW Group, which is what surfaced a second, harmless
        SAWarning about a redundant cascade delete — fixed with a `db.expire_all()` after
        the explicit Mode-deletion pass, see the comment in `emitter_revert_service.py`),
        `test_emitter_fork_api.py`. Full suite: **175 passing**, run clean 2x in a row
        after the SQLAlchemy fix above (given the flakiness discovered, don't trust a single
        green run on this branch's DB-touching tests without rerunning at least once).
      - Frontend: `CheckoutBanner.tsx`, `useEmitterCheckout.ts`, `ModeEditForm.tsx` (replaces
        the deleted `ModeDraftForm.tsx`), `ForkVersionModal.tsx`, a "Revert to this version"
        action in `EmitterVersionHistoryPage.tsx`. `tsc -b` compiles clean. Verified live in
        the Browser pane: create → auto-checkout → edit a Mode line → discard (reverted) →
        commit → fork → confirmed the fork is independently editable and the original
        untouched.
      - `docs/FEATURES.md` §3 and §5 rewritten for the above; the in-app Help page
        (`HelpPage.tsx`) updated to match.

13. **`734b807`** — This session (a separate session from all of the above — continued straight
    on from item 12's checkout/revert/fork work, same branch). Two pieces of work:

    - **Modes Batch Edit.** Select multiple Modes (table/card checkboxes, header "select all
      filtered") and apply EW Group reassignment / Notes overwrite / the three Range Matching
      tri-states / the four delta fields to all of them in one all-or-nothing call — see
      `docs/FEATURES.md`'s new "Batch Edit" subsection under §3 for the exact semantics (why it
      excludes RF/PW/PRI min/max/stagger, why it doesn't re-check `require_manual_deltas`).
      Backend: `app/services/mode_batch_service.py` (`plan_batch_edit`/`apply_batch_edit`,
      validate-everything-in-memory-first then write, same pattern as `cartesian_product`),
      `POST /emitters/{emitter_id}/modes/batch-edit` in `emitters.py`, gated by
      `require_emitter_checkout()` like every other Mode mutation. Originally scoped with a
      second "Shift ranges" (additive RF/PW/PRI shift) operation too — the user tried it, called
      it "useless," and it was fully removed from both backend and frontend before this was
      considered done; if you see any reference to `BatchModeShift`/`rf_shift_mhz` anywhere,
      that's stale and should have been deleted. Frontend: `BatchEditModal.tsx`,
      `useBatchEditModes` in `useModes.ts`. Tests: `test_mode_batch_api.py` (7 cases including
      the all-or-nothing rejection and a cross-Emitter `mode_id` 404).
    - **Mode-centric Emitter diffs**, replacing the raw DeepDiff-path rendering the user
      correctly called unreadable ("impossible to see what was altered, and which parameter").
      New `app/services/emitter_diff_service.py::compute_emitter_diff` walks an Emitter
      snapshot's own known shape (Emitter → EW Groups → Modes → Line, plus Sources) and matches
      each level by the id a snapshot already preserves, emitting `{scope, label, kind,
      old_value, new_value}` entries — `scope` is a resolved name like `Mode 'RM Mode'`, `label`
      a human field name like `RF Min (MHz)` from a lookup table in that same file, never a raw
      path. New schema `EmitterDiffOut`/`EmitterDiffEntry` in `emitter_version.py`, used by
      **both** Emitter diff endpoints (`GET .../diff/live` and `GET .../versions/{n}/diff`) —
      **the old generic `DiffOut`/`compute_diff` (`app/services/diffing.py`) is now Platform/MDF-
      only**, see the merge-warning section below, this is exactly the kind of shape change that
      bites a concurrent branch. New frontend `EmitterDiffViewer.tsx` (groups entries under a
      `<h5>{scope}</h5>` per Mode/EW Group/etc.) replaces the shared `DiffViewer.tsx` on the two
      Emitter-facing pages only (`EmitterVersionHistoryPage.tsx`, the live-diff panel in
      `CheckoutBanner.tsx`) — `DiffViewer.tsx` itself is untouched and still serves Platform/MDF
      version history. Also fixed a real bug surfaced while verifying this live: Mode mutations
      (`useUpdateMode`/`useCreateMode`/`useDeleteMode`/`useBatchEditModes` in `useModes.ts`)
      weren't invalidating the `emitterVersionsKey` query prefix, so an already-open "View
      changes since last commit" panel wouldn't refresh after an edit until a full page reload —
      **EW Group and Source mutations (`useEwGroups.ts`/`useSources.ts`) still have this same
      gap**, not fixed this pass, worth doing in the same way if it's reported.
    - Along the way, three small UI fixes the user flagged live while testing the above:
      the Batch Edit modal's 4-field "Deltas" row was overflow-wrapping its last field
      (Frame time) onto its own line with no visual tie back to the "Deltas" label — fixed by
      restructuring to a label-above/fields-wrap-below layout (`.param-block` in `index.css`)
      that stays grouped at any width instead of fighting exact pixel widths (this modal's width
      had already been bumped 480px → 640px → 760px earlier in the session chain and was still
      not the real fix); the "Batch Edit (N)" button was visually indistinguishable from the
      bordered filter dropdowns next to it, given its own `.accent-button` violet fill (new
      `--accent`/`--accent-hover` CSS variables, both light and dark `:root` blocks); and every
      `.data-table` (used by 17 of the app's 18 table components — the ambiguity heatmap is the
      one exception, it already encodes meaning in cell color and would visually fight a stripe)
      got alternating-row zebra striping via `tbody tr:nth-child(even) { background: var(--bg);
      }` — reuses the existing page-background token rather than a new color, so it's
      theme-consistent for free.
    - Full backend suite (**184 passing**, verified after both the schema-shape change and the
      test-file updates it required in `test_versioning_api.py`) and `tsc -b` clean throughout.
      Live-verified in the Browser pane at both desktop and mobile widths.
    - Committed and pushed as `734b807` on `claude/rf-recognizer-emitter-profiles-le5jik`.

## Open items (not yet implemented)

### From this session's PRS export cleanup (item 11 above)

- **JSON datasheet importer, not yet ported.** `file-metadata_v2`'s
  `json_import/transformer.py` + its `/json-import` endpoint + `JsonImportModal.tsx`
  looked functionally sound (reuses this app's real `validate_import_payload`/
  `commit_import_payload` pipeline correctly) but wasn't brought over this pass —
  only explicitly-scoped work was. Worth a look before building path A of XML import
  (see `docs/XML_IMPORT_BRIEF.md`) — may already solve most of it for JSON input.
- **`EwGroup.modes_count`, not yet ported.** A real, useful feature in the other
  copy's `routers/ew_groups.py`, but implemented by mutating an unmapped ORM
  attribute at read time — needs a cleaner approach (a query-time count/subquery)
  before it's worth adopting here.
- **No frontend UI for Source Groups / `source_type` / `rf_legacy_term` /
  `pri_legacy_term` / `mode_elements.details`.** Backend API + schema only (see
  `docs/FEATURES.md`'s "Source Groups, legacy terms, and element details (API
  only)" note) — deliberately deferred until it's clearer what data these are
  meant to reconcile against.

### From the frontend workflow-logic review (most recent, least acted-on)

- **Dashboard "Needs Attention" items aren't clickable** — rendered as plain strings
  (`needs_attention: string[]`) with no id/entity-type/link. Fix needs a backend shape change
  (structured items, not strings) plus a frontend render change.
- **Pinned versions shown as truncated UUIDs, not `v3`-style numbers, with no click-through** —
  `PlatformLinkTable.tsx` / `MdfLinkTable.tsx` render `link.emitter_version_id.slice(0,8)…`
  instead of resolving to a version number, and the linked entity name isn't a `<Link>`.
- **`EmitterEditorPage.tsx` shows Modes above the EW Groups/Sources setup panel** despite the
  latter being a hard prerequisite; the auto-open-on-empty logic only fires once per mount.
  Also: creating a new Emitter doesn't navigate into its editor.
- **EW Group deletion silently cascades and deletes all its Modes** (plain confirm dialog only),
  while Source deletion is properly blocked with a 409 if it still has Modes — same category of
  action, inconsistent safety behavior, not signaled anywhere.
- **No "uncommitted draft changes" indicator for Platform/MDF editors.** **Resolved for
  Emitters** by item 13's live diff ("View changes since last commit" in `CheckoutBanner.tsx`
  — shows not just *that* there are uncommitted changes but the exact mode-centric diff of
  what they are). Platform/MDF still have neither a checkout concept nor any dirty-state
  indicator at all — this item now only applies to those two.
- **Ambiguity run results are ephemeral** (`runId` is local `useState`, lost on navigation) and
  **the checked version is never displayed** even though `AmbiguityRun` carries
  `emitter_version_id`/etc. — confirmed unused in any JSX via grep. `useAmbiguityRuns` (past-runs
  hook) exists and is never called.
- **Test records don't show their pinned version**, and the "Log Test" form doesn't warn when
  logging against a never-committed draft. **Partially touched** by the concurrent commits in
  item 9 above (test records now link to specific Modes with per-mode status, and the log form's
  Mode-selection default changed) — re-check whether the version-visibility gap specifically was
  also addressed before re-flagging it.
- **Minor:** the manual "+ Add Mode" form is a third mode-creation path that (unlike the DSL
  path) never derives Elements, silently leaving the Elements pool empty; `FindingsTable.tsx`
  always acknowledges with `note: undefined` despite a reviewer-note field existing on the
  backend.
- **What's already solid, don't relitigate:** pinning prerequisite hints (explicit "commit one
  first" messaging), consistent terminology app-wide, and role-gated controls that hide (`null`)
  rather than show-then-403.

The user was asked to prioritize among "Version visibility," "Dashboard linking," "Editor page
flow," or "all of the above" — **no answer was given before this handover**. Ask before picking
one.

### From the earlier full-app review, still open (security track is done; these are not)

**Backend:**
- Zero test coverage on 6 of 12 routers before this session (`users`, `sources`, `ew_groups`,
  `dsl`, `test_records` — `auth` gained coverage as a side effect of the security fixes).
- `PATCH` endpoints on Emitter/Platform/MDF don't pre-check name uniqueness like `create` does →
  a rename collision raises an uncaught `IntegrityError` (500, not a clean 409).
- `jwt_secret` silently defaults to an insecure dev value with no startup check.
- List endpoints (`list_emitters`, `list_findings`, etc.) have no pagination.
- Inconsistent delete error handling (`SourcesTable` catches `ApiRequestError` and shows it;
  `EwGroupsTable`/`ModesSection` deletes don't).
- `delete_generation_batch` deletes modes in a Python loop (N+1) instead of bulk.
- `execute_ambiguity_run` uses a bare `except Exception` with no logging.

**Frontend:**
- **No test infrastructure at all** — no vitest/jest/testing-library/Playwright config, zero
  `*.test.*` files anywhere.
- Accessibility: the ambiguity matrix is keyboard-unreachable (`<td onClick>`, no
  tabIndex/role/onKeyDown) and severity is color-only; sortable table headers are mouse-only.
  `HoverInfo` popovers were originally hover-only (no `:focus`) — **likely fixed** by the
  concurrent commits in item 9 above (`onFocus`/`onBlur` added), but not reverified here.
- Perf: every `HoverInfo` is always-mounted (not lazy), the Source popover fires a live query per
  row, no `staleTime` tuning anywhere, no virtualization for large Mode lists.

**Ops/deployment:**
- `docker-compose.yml` references `build: ./frontend` but there's no frontend `Dockerfile` — the
  documented `docker compose up --build` quickstart fails outright.
- No CI pipeline anywhere (backend tests, frontend build/lint all local-only).
- README/`docs/FEATURES.md` §12 claim automated backup-restore *verification* on a schedule —
  only `backup_db.py`/`restore_db.py` exist; the verification script doesn't.
- `COOKIE_SECURE: "false"` hardcoded in `docker-compose.yml` with no override path; no TLS
  termination anywhere in the stack.
- No resource limits/healthchecks on the `backend`/`frontend` compose services.

## Environment notes specific to this dev session

These are facts about *this* sandboxed session's environment, not the app itself — check
whether they still apply wherever you're picking this up. **This session ran on Windows**,
a materially different environment from whatever produced the notes this section replaced
(a Linux container) — don't assume either set of notes applies to a third environment.

- Windows machine, PowerShell + Git Bash both used. Postgres 17 runs as a native Windows
  service (`postgresql-x64-17`), not Docker — Docker Desktop is installed but wasn't running
  and wasn't started (no need arose). Node.js and PostgreSQL's `bin/` were both installed but
  not on the default `PATH` for tool invocations; commands referenced them via full paths
  (`C:\Program Files\nodejs`, `C:\Program Files\PostgreSQL\17\bin`).
- A Python venv already exists at `backend/.venv` with all `requirements.txt` deps installed;
  frontend `node_modules` was already present too.
- Dev DB `rf_emitter_db` and test DB `rf_emitter_test` both already exist, owned by role
  `rf_app` / password `rf_app_dev_pw` (matches `DATABASE_URL` defaults in `app/config.py`).
- **Admin credentials for this dev DB are `admin` / `admin`** (reset this session, since the
  existing admin user's password wasn't known — see `git log` around the "pull up the server"
  request). This is a local/dev-only credential; do not carry the assumption that this password
  works on any other deployment of this app, including whatever the user's remote server ends
  up with once redeployed there.
- `backend/app/main.py` runs single-process/single-worker (`Dockerfile` and
  `docker-compose.yml` both call plain `uvicorn app.main:app` with no `--workers`) — this is why
  the login rate limiter (`app/core/rate_limit.py`) is a plain in-memory dict rather than a
  Redis-backed one. If deployment ever moves to multiple workers/instances, that limiter needs a
  shared store instead.
- The user's actual target deployment is **their own remote server, with no internet access**
  — this is why an offline-installable bundle (backend wheels + frontend `node_modules`, not
  just source) was produced alongside this session's final push; see the zip/bundle handed to
  the user directly rather than committed to the repo.

**Delta for item 12's session** (same Windows machine, still not the same as wherever you are):
Postgres is now **18** (`postgresql-x64-18`), not 17 — `backend/.env`'s `DATABASE_URL` had a
stale port (`5433`) left over from a Docker-based setup that was never actually running; fixed
to `5432` to match the native service. Docker Desktop was attempted (`docker compose up`) and
got stuck mid-startup (never finished past first-run initialization in ~2 minutes) — gave up on
it and used the native Postgres service directly instead, same as item 10's session; if Docker
Desktop is still flaky wherever you are, don't burn time waiting on it, the native-service path
works fine. Admin login this session: `admin` / `admin1234` (again dev-only, don't assume it
carries anywhere else). `rf_app`'s Postgres role password had also drifted from what
`backend/tests/conftest.py` hardcodes (`rf_app_dev_pw`) — reset the role's password to match
rather than the other way around, since the test suite's expectation is the one that can't
change without editing tracked code.

## Working conventions established this session (carry these forward)

- Every non-trivial change gets backend tests (pytest, integration-style against real Postgres —
  see `backend/tests/conftest.py` fixtures: `client`/`editor_client`/`viewer_client`/`admin_client`)
  and, where relevant, a live manual verification (curl against a running server), not just unit
  tests — see the security-fix commit for the pattern (CSRF and rate-limit checks were both
  confirmed against a live server, not just pytest).
- `docs/FEATURES.md` is kept in sync with behavior on every feature change — check it before
  claiming something is missing (it's caught a wrong claim once already, see item 5 above).
- Destructive/risky actions (deleting real data, resetting a real user's password) are confirmed
  with the user first, or done on clearly-throwaway data that's cleaned up immediately after.
- Commits are scoped to one logical change with a "why," not a "what" (see recent commit
  messages for the expected tone).
