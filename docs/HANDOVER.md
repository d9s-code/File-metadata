# Handover

A session briefing for whoever (human or LLM) picks this project up next. Read this first,
then follow its pointers — it doesn't repeat what's already documented elsewhere.

**This is `file-metadata_v2`** — a separate physical working copy at
`file-metadata_v2/File-metadata/File-metadata`, distinct from the original `File-metadata`
checkout elsewhere on this machine. The user explicitly redirected work here mid-session
("I would rather like for you to be working in the file-metadata_v2 version"); the two copies
share no git history. **This repo has no remote configured** (`git remote -v` is empty) and a
single local commit, `845ccf7 Initial snapshot of file-metadata_v2 working tree` — everything
below happened as uncommitted changes on top of that one commit until this session committed
them. Where to push this (a new repo? the same GitHub repo as the original, as a new branch?)
was **not decided** before this doc was written — ask the user before adding a remote.

## Where to start

- **[README.md](../README.md)** — what this app is, the stack, and exact local-dev / Docker
  Compose / test setup commands.
- **[docs/FEATURES.md](FEATURES.md)** — the feature reference.
- **[docs/ROADMAP.md](ROADMAP.md)** — proposed-but-not-built features.

## What this project is, briefly

A fully offline FastAPI/SQLAlchemy/Alembic/PostgreSQL + React/TypeScript/Vite web app for
managing RF emitter profiles: Emitters → EW Groups + Sources → Modes (built via a typed DSL or
an Elements+cartesian-product tool) → grouped into Platforms → pinned into versioned MDFs, with
snapshot-based versioning/diffing, a pairwise ambiguity-overlap engine, XML export, and
role-based access (Viewer/Editor/Admin). Same feature set as the original `File-metadata`
project this was copied from — see that repo's own docs for the full pre-existing feature list;
this doc only covers what changed in *this* copy.

## Session history in this copy (chronological)

1. **Environment stabilization.** `git init` (no history existed here yet), fixed a broken
   Python venv, fixed a broken Alembic migration chain, and fixed a real data-leak: `backend/.env`
   was resolving relative to process cwd, which under this session's `preview_start` tooling
   silently resolved wrong and pointed the dev server at the *original* File-metadata project's
   live database. Fixed via `Path(__file__)`-based `.env` resolution in `app/config.py`, and by
   giving this copy its own Postgres **schema** (`v2`/`v2_test`, via
   `?options=-csearch_path%3Dv2` on `DATABASE_URL`) inside the same physical `rf_emitter_db`
   database/role — avoids needing a Postgres superuser password to create a separate database.
   `preview_start`/`.claude/launch.json` proved unreliable for launching this copy's dev servers
   (kept resolving to the original project's directory) — abandoned in favor of direct `Bash`
   `uvicorn`/`vite` invocations; see the process-management note below, which matters a lot here.

2. **Bug-fix punch list** (backend + frontend), all verified live and via `pytest`: `app/config.py`
   cwd-dependent `.env` loading, `SourceGroup` model never registered (crashed any request
   touching `Source.group`), Alembic `%` in `DATABASE_URL` breaking configparser, missing
   `group_id` existence check (404) on Source create/update, shared test-DB isolation risk, 7
   frontend `tsc` compile errors.

3. **A large feedback-driven feature round**, from one consolidated user message plus two
   follow-ups:
   - **Analyst notes**, both on Emitters and per-Source. **Shipped twice**: the first pass was a
     single free-text field (PATCH-replace, like `description`). The user then explicitly said
     notes "should be incremental, and shouldn't be overwritten" — redesigned as an append-only
     log: new `emitter_notes`/`source_notes` tables (`EmitterNote`/`SourceNote` models, immutable
     — create + delete only, no update), a shared `NotesFeed.tsx` component (newest-first,
     author + timestamp, per-entry delete gated to Editor+), and `EmitterOut`/`SourceOut` lost
     their `notes` field entirely (it's `GET /emitters/{id}/notes` /
     `GET .../sources/{id}/notes` now, not embedded). Migration `eb0437ec8ea8` backfills any
     existing single-blob `notes` value as that entity's first log entry before dropping the old
     column (best-effort — author unknown, so `author_id` is null on backfilled entries).
   - **Source coverage**: a "Modes" count column plus a per-Source "which Modes were built from
     this Source" list on `SourcesTable.tsx` (`SourceCoverage`, reading `useEmitterModes`) — there
     was previously no way to see this at all.
   - **Delta/engineered-value visibility**: the Emitter summary row now shows engineered
     (raw ± delta) ranges alongside raw ones wherever they differ, instead of raw-only.
   - **Per-element cartesian-product delta override** (`rf_delta_overrides`/etc. on
     `CartesianProductRequest`) — this also surfaced and fixed a real bug: `cartesian_service.py`
     was applying delta *before* storing generated Mode Lines, baking the widened value into the
     "raw" field and never populating `ModeLine.rf_delta`/etc., which was the root cause of the
     user's complaint that editing delta into generated Modes took a lot of manual work.
   - **Batch notes wired through**: `CartesianProductRequest` was missing `batch_note` entirely —
     the frontend sent it, the backend silently dropped it. Fixed and now visible via
     `ModeGenerationBatch`.
   - **Cartesian form staleness fix**: `CartesianProductButton.tsx` didn't re-prune stale
     element selections when an element was added/deleted; added pruning `useEffect`s.
   - **Duplicate Mode-name collision avoidance**: repeated cartesian-product runs with the same
     name prefix now get an indexing suffix instead of colliding.
   - **Range Matching flags added to the cartesian generator** (three independent per-parameter
     booleans, threaded through like everything else in that form).
   - **Modes table column reorder**: Name → RF → PRI → PW → RangeMatching → EW Group → Source →
     Last tested, per explicit user spec.
   - **XML export bugs fixed** (`xml_exporter_service.py`): it was exporting *raw*, not
     engineered (delta-adjusted), values; `RangeMatch` flags were derived from a comparison that
     could never be true (comparing a `PriType` enum against XML `Class` strings), so `PRI` was
     always exported `"true"` regardless of the actual flag; Stagger `FramePeriod` was hardcoded
     to `Min="1100" Max="1300"` regardless of real data. All three fixed; a second, separate,
     pre-existing XML export path (`app/xml_export/serializer.py`, no frontend button wired to
     it) has the same class of limitation and was deliberately left untouched — lower priority,
     documented here rather than fixed silently.

4. **Item 7 — "branch-style editing" instead of "propose edit"** — the user explicitly framed
   this as something they're "looking at," not a firm instruction, and asked to defer it pending
   a dedicated design discussion. **Not started. Do not implement without that discussion
   happening first.**

## Process-management gotcha (read before touching the dev server)

**`uvicorn --reload` was unreliable in this environment, twice, in ways that silently served
stale code with no visible error to the user.** Root cause, confirmed via
`Get-CimInstance Win32_Process`: this session's Python venv (`backend/.venv`) is a
"redirector-style" venv — its `Scripts\python.exe`, once running, re-execs into the *global*
interpreter under the hood, and `uvicorn --reload`'s worker-respawn path (Windows
`multiprocessing.spawn`) sometimes produces a worker whose parent reloader had already died,
orphaning a zombie worker that kept accepting connections on port 8000 indefinitely, alongside
whatever new instance got started next — with **no crash, no error, just quietly wrong
responses** (missing fields, stale schema) from whichever of the N processes happened to accept
a given connection. Two full sessions of "why is this endpoint missing a field I definitely
added" were both this.

**Working pattern that avoided it**: run uvicorn *without* `--reload`
(`.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000`, no flag) and restart it
manually after backend edits. Before trusting any surprising live-server behavior, verify
there is exactly one owner of port 8000:
```
Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" | Select-Object CommandLine
```
If more than one `python.exe` shows up in `Get-CimInstance Win32_Process -Filter "Name='python.exe'"`,
kill all of them and restart clean rather than trying to figure out which one is "the real one."

## Open items

- **Sample dataset**: user asked to "inject a little dataset of emitters, sources and modes" to
  visually exercise the new functionality (source coverage, engineered-value display, per-element
  delta overrides, batch notes, notes feed, range matching, reordered columns). **Requested, not
  yet done.**
- **Item 7 (branch-style editing)** — see above. Deferred pending discussion, not implementation.
- **Push destination undecided** — see the top of this doc. This session committed the work
  locally but did not push anywhere; no remote is configured.
- The original `File-metadata` project's own "Open items" (dashboard linking, pagination, test
  coverage gaps, accessibility, CI, etc.) were not re-audited in this copy — assume they still
  apply here too unless independently checked, since this copy started as a straight snapshot of
  that project.

## Environment notes specific to this dev session

- Windows machine, PowerShell + Git Bash both used. Postgres 17 runs as a native Windows service.
- Dev DB: same physical `rf_emitter_db` / role `rf_app` as the original project, but isolated via
  a dedicated `v2` (dev) / `v2_test` (test) Postgres **schema** — see `DATABASE_URL` in
  `backend/.env` (gitignored, not committed) and `backend/tests/conftest.py`.
- Backend test suite: 157 passing as of this entry (`cd backend && .venv/Scripts/python.exe -m
  pytest -q`).
- Frontend: `npx tsc -b` clean as of this entry.
