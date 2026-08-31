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

## Open items (not yet implemented)

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
- **No "uncommitted draft changes" indicator** anywhere in the Emitter/Platform/MDF editors.
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
