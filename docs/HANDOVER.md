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
   and navigation. Findings below, under "Open items" — **none of these are fixed yet**; the
   user was mid-way through choosing which to prioritize when this handover was requested.

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
  logging against a never-committed draft.
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
  tabIndex/role/onKeyDown) and severity is color-only; `HoverInfo` popovers open on CSS `:hover`
  only (no `:focus`); sortable table headers are mouse-only.
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
whether they still apply wherever you're picking this up:

- Postgres runs as a local OS service here (not Docker) — started via `service postgresql start`
  when this session began (it starts stopped by default in this container image).
- A Python venv already exists at `backend/.venv` with all `requirements.txt` deps installed.
- Dev DB `rf_emitter_db` and test DB `rf_emitter_test` both already exist, owned by role
  `rf_app` / password `rf_app_dev_pw` (matches `DATABASE_URL` defaults in `app/config.py`).
- The dev DB has pre-existing real users (`admin`, `deltatest`, `viewer1`) whose passwords are
  **not known** to me — they were created in earlier sessions. If you need admin access and
  don't have the password, reset it directly via `UPDATE users SET password_hash = ...` using
  `app.core.security.hash_password()` to generate the hash (this is what was done to create and
  then delete a throwaway test user during the security-fix verification — see commit
  `864d1d1`'s description for context).
- `backend/app/main.py` runs single-process/single-worker (`Dockerfile` and
  `docker-compose.yml` both call plain `uvicorn app.main:app` with no `--workers`) — this is why
  the login rate limiter (`app/core/rate_limit.py`) is a plain in-memory dict rather than a
  Redis-backed one. If deployment ever moves to multiple workers/instances, that limiter needs a
  shared store instead.

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
