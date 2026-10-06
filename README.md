# RF Recognizer Emitter Profile Manager

A self-contained, fully offline web application for building and maintaining **emitter
profiles** for an RF Recognizer, and packaging them into versioned **Mission Data Files
(MDFs)**. It covers the whole workflow: entering RF/PRI/PW parameters (via forms or a
typed DSL), organizing them by operational Group and by data-provenance Source,
grouping Emitters into Platforms, pinning Platforms into MDFs, tracking version history
with diffs, running pairwise ambiguity analysis, logging real-world test results, and
exporting a committed MDF to XML.

See **[docs/FEATURES.md](docs/FEATURES.md)** for a full walkthrough of every feature and
the reasoning behind key design decisions (e.g. why Platforms — not Emitters — are what
gets pinned into an MDF, and why readiness warnings never hard-block release).

## Highlights

- **Tasks & assignment** — assign each Emitter to a person; give out to-dos (for yourself,
  for someone, or up for grabs), optionally about an Emitter, Platform or MDF, with due
  dates; "My work" on the dashboard.
- **Emitters, Groups & Sources** — Modes are grouped two ways at once: operationally
  by Group (scan range + threat priority) and by data provenance by Source.
- **Typed DSL + editorial tools** — write mode lines as text (`RF 2900-3100 PRI FIXED
  800-1200 JITTER 5-15 PW 0.5-1.2`), or build a pool of RF/PW/PRI elements per Source and
  generate a whole batch of Modes via cartesian product, with frame-time computation.
- **Two-level pinning** — Platforms pin specific committed Emitter *versions*; MDFs pin
  specific committed Platform *versions*. Editing a draft never silently changes an
  already-built MDF.
- **Version history & diffs** — every commit is a snapshot; diffs are computed on read
  and shown field-by-field, including status transitions.
- **Status tracking with soft readiness signals** — Emitter and MDF lifecycle states, with
  non-blocking warnings (unvalidated emitters, unresolved ambiguity, missing tests) shown
  before you move toward release.
- **Ambiguity analysis** — pairwise RF/PRI/PW overlap checking at Emitter, Platform, and
  MDF scope, visualized as a severity heatmap and an RF-vs-PRI plot, with a
  review/acknowledge workflow.
- **Test tracking** — log simulation/lab/range/field test results pinned to the exact
  version tested.
- **XML export** — export a committed MDF version to a custom XML format via a swappable
  placeholder field-mapping layer (Sources/elements are deliberately excluded). XML
  *import* is planned next — see `docs/XML_IMPORT_BRIEF.md`.
- **Per-parameter deltas, Frame Time, and Range Matching** — RF/PW/PRI each carry their
  own raw-vs-engineered tolerance margin; Stagger PRI adds a frame-time tolerance the
  same way; RF/PW/PRI can each independently be flagged for range matching, governed by
  the same propose/approve workflow as any other Mode Line edit.
- **Recently Deleted & Admin panel** — Emitters/Platforms/MDFs soft-delete into a 30-day
  Recently Deleted view (restore, or Admin-only permanent delete; auto-purged daily);
  Admins can also create and manage user accounts from the UI.
- **Backup & restore** — weekly `pg_dump` backups from their own container, each one
  restored into a scratch database to prove it works, with retention pruning, an optional
  second copy, and an Admin page that shows their health and compares any two of them.
- **Dark mode** — light/dark/system theme, persisted per browser, applied before first
  paint to avoid a flash of the wrong theme.
- **Roles** — Admin/Editor/Viewer, enforced server-side.

## Stack

- Backend: FastAPI + SQLAlchemy + Alembic + PostgreSQL (Python 3.11)
- Frontend: React + TypeScript + Vite (fully bundled, no CDN/runtime internet dependency)

## Local development (no Docker)

```bash
# Postgres: create a dev role/db once
sudo -u postgres psql -c "CREATE USER rf_app WITH PASSWORD 'devpassword';"
sudo -u postgres psql -c "CREATE DATABASE rf_emitter_db OWNER rf_app;"

cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements-dev.txt
cp .env.example .env   # edit DATABASE_URL / JWT_SECRET; for local dev set APP_ENV=dev and COOKIE_SECURE=false
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe scripts/create_admin.py admin <password>
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload

# in another shell
cd frontend
npm install
npm run dev
```

Backend: http://localhost:8000 · Frontend dev server: http://localhost:5173

## Docker Compose

This app is deployed behind an existing Traefik reverse proxy at `prs.app`, and connects to
an existing Postgres 15 instance rather than running its own — `docker-compose.yml` only
defines the `backend`, `frontend` and `backup` services. Before running it:

- Edit `DATABASE_URL` in `docker-compose.yml` to point at a role/database created on that
  Postgres 15 instance (see below), and add the backend to whatever Docker network reaches
  it (the `# TODO` comments in the file mark exactly where).
- Replace `JWT_SECRET` and `ADMIN_PASSWORD` with real values (`openssl rand -hex 32` for the
  former) — don't ship the placeholders.
- Make sure the external `web` Docker network (the one Traefik itself watches) already
  exists on this host; compose doesn't create external networks for you.
- If the hostname isn't actually `prs.app`, update the `Host(...)` rule in both services'
  Traefik labels, and `VITE_API_BASE_URL` in the frontend's build args to match.

Config here is intentionally hardcoded into `docker-compose.yml` rather than read from a
`.env` file, to match how the rest of this server's stacks are set up — which also means:
don't commit real secret values into this file if the repo is tracked anywhere shared.

Create the database/role on the existing Postgres instance first, e.g.:
```sql
CREATE ROLE rf_app WITH LOGIN PASSWORD 'CHANGE_ME';
CREATE DATABASE rf_emitter_db OWNER rf_app;
```

Then:
```bash
docker compose up --build
```

There is no self-service register form, so the backend bootstraps an initial admin user
(`ADMIN_USERNAME` / `ADMIN_PASSWORD`, defaulting to username `admin`) on every startup, via
`scripts/create_admin.py` — it no-ops once that user already exists. Log in with those
credentials at `https://prs.app` and create additional users from there.

Backups (the `backup` service — see [Backups](#backups)) write to the `backup_data` volume,
separate from wherever the Postgres 15 instance itself stores its data — keep that separation
on different physical disks, and set `BACKUP_COPY_DIR` to keep a second copy elsewhere.

## Offline / air-gapped server deployment

The app itself makes no outbound network calls at runtime, but building the images does
(base images from Docker Hub, plus `pip`/`npm`/`apt` packages) — so the images must be built
on a machine **with** internet access and carried over to the offline server, rather than
built there. Postgres isn't part of this: it's an existing instance already running on that
server, so there's no database image to build or transfer.

1. On a machine with internet access, clone/copy this repo. Make the edits described above
   (`DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD`, hostname) directly in `docker-compose.yml`
   first — in particular, `VITE_API_BASE_URL` gets baked into the frontend's built JS at
   image-build time, so it can't be fixed later on the server without rebuilding.
   ```bash
   ./scripts/offline/build-images.sh
   ```
   This builds the backend/frontend images and writes `rf-emitter-images.tar`.
2. Copy the whole repo directory (including `rf-emitter-images.tar` and your edited
   `docker-compose.yml`) to the offline server — USB drive, `scp` over a jump host, whatever
   transfer path that network allows.
3. On the offline server, confirm the `web` network exists and the role/database above has
   been created on the Postgres 15 instance, then:
   ```bash
   ./scripts/offline/load-images.sh
   docker compose up -d
   ```
   Do **not** pass `--build` — the images are already loaded locally under the tags
   `docker-compose.yml` expects (`rf-emitter-backend:latest`, `rf-emitter-frontend:latest`),
   so plain `docker compose up` uses them directly without touching the network.

To ship a code change afterwards: rebuild and re-save on the connected machine, then repeat
steps 2–3 on the server (`docker load` overwrites the existing image tags; `docker compose up
-d` recreates any changed containers).

## Backups

In Docker the `backup` service does this on its own, apart from the web app so it runs
whether or not the app is up. Every `BACKUP_SCHEDULE_DAY` (a weekday, or `daily`; default
`sun`) at `BACKUP_SCHEDULE_TIME` (UTC, default 03:00) it:

1. takes a backup — a `pg_dump` file plus a small JSON manifest next to it (checksum, row
   counts, and an overview of every Emitter, Platform and MDF, used by the compare view);
   alongside it, a **PRS export of the whole repository** (`<backup>_prs.zip`, below);
2. copies it to `BACKUP_COPY_DIR`, if set — mount a second disk or a share there;
3. **verifies** it: restores it into a scratch database and checks the row counts match;
4. prunes old backups (keeps the newest 14, then one a week for 8 weeks and one a month
   for 6 months — `BACKUP_RETENTION_DAILY` / `_WEEKLY` / `_MONTHLY`).

Every day at that time it also purges Recently Deleted items past `TRASH_RETENTION_DAYS`
(default 30). If the latest backup is over a week old when it starts (the server was off),
it takes one straight away.

**Between automatic backups, the warning scales with the changes.** The dashboard's Backup
card shows how long since the last backup and how many changes have been made since (every
Audit Log entry that edits data), with which Emitters, Platforms and MDFs were added,
changed or removed. A backup is due a week after the last one at `BACKUP_CHANGES_PER_WEEK`
changes (default 50), half a week at twice as many, and so on — never sooner than 12 hours
after, never later than 4 weeks, and not at all if nothing changed. Once due, the card turns
amber and admins get a warning on every page; at twice that it's overdue and turns red.
"Back up now" (on the card, or Admin → Backups) clears it. **Admin → Backups** shows all of this: the latest backup and its
verification, when the next one runs, a warning if anything is missing, late or failed, a
"Back up now" button, and a compare view — what changed between two backups, or since a
backup, at the level of Emitters, Platforms and MDFs.

**The PRS export — for when there's no time to restore.** Each backup has a
`emitterdb_<date>_prs.zip` next to it, taken from the same moment as the database file:

```
README.txt                  what's inside, and which saved version each item is from
emitters/<Emitter>.xml      every Emitter (plus default_unknown_emitter.xml)
platforms/<Platform>/...    each Platform as its own PRS package
mdfs/<MDF>/...              each MDF as a complete PRS package, ready to use as-is
```

They're the same files the app's own PRS exports give, from each item's latest saved
version (anything never saved is taken from its current state; README.txt says which).
Verify checks it, it's copied to `BACKUP_COPY_DIR` and pruned with its backup, and Admin →
Backups downloads it with **PRS (XML)**. If it fails, the database backup is still kept and
the Backups page says so.

Verification needs an empty scratch database it may overwrite — by default the live
database's name with `_verify` on the same server. Create it once:

```sql
CREATE DATABASE rf_emitter_db_verify OWNER rf_app;
```

(or point `BACKUP_VERIFY_DATABASE_URL` elsewhere). Without it backups still run, but the
Backups page says they aren't verified.

**Keeping a copy off this server.** Backups sit on this server's disk, so a lost server
means lost backups. Either or both:

- **Download** — Admin → Backups has a Download link on each backup. It holds the whole
  database (user accounts' password hashes included), so keep it somewhere safe; every
  download is recorded in the Audit Log.
- **Automatic copy to another computer** — set `BACKUP_COPY_DIR: /backups-copy` and mount a
  share from that computer there. `docker-compose.yml` has a commented `backup_copy` volume
  for a Windows (SMB) share or a Linux NFS export: uncomment it, fill in the address and
  credentials, and uncomment the two lines that use it. Every backup is then copied there
  after it's taken, and the Backups page shows each one's copy and warns if one failed. If
  the share can't be reached when the container starts, the container doesn't start, and the
  page says the scheduler isn't reporting. Pruning only thins out this server's backups —
  the other computer keeps every copy until you clear it.

The other way round works too: the other computer can fetch new files from the
`backup_data` volume on a schedule (`rsync`/`scp` over SSH) without the app knowing.

The image's backup tools (`pg_dump`/`pg_restore`) are Postgres 15, matching the server —
if the server is upgraded, set `PG_CLIENT_MAJOR` in `backend/Dockerfile` to its new major
version (`SELECT version();`) and rebuild. They must never be older than the server. Newer ones still work — a restore skips
settings an older server doesn't know, such as `transaction_timeout` (Postgres 17+) — but
matching the server is the clean setup, and the Backups page says so if they differ.

```bash
# a backup now (also on Admin → Backups)
docker compose exec backup python scripts/backup_db.py --verify

# restore — overwrites the live database, so it asks for its name. It takes a
# "before-restore" backup first, so restoring the wrong file can be undone.
# Stop the web app while it runs.
docker compose stop backend
docker compose exec backup python scripts/restore_db.py /backups/emitterdb_20260101_030000.dump --confirm-db rf_emitter_db
docker compose start backend
```

Without Docker, run the same scripts from `backend/` (`python scripts/backup_scheduler.py`
as a service, or `scripts/backup_db.py --verify` and `scripts/purge_deleted.py` from cron).

Restore is deliberately a command-line step with a confirmation rather than a button, since
it overwrites live data. See `docs/FEATURES.md#backup--restore` for more.

## AI assistance (optional)

With a language model on your network behind an OpenAI-compatible API (vLLM, for
instance), the Ambiguity check page can **explain** a finding — why the two Modes can't be
told apart, what separates them, and a suggested action — and **summarise** a whole run.
Set on the backend:

```
LLM_BASE_URL=http://vllm-host:8000/v1   # up to and including /v1
LLM_MODEL=...                           # only if the server serves several models
LLM_API_KEY=...                         # only if the server wants one
```

Unset, nothing changes and the buttons don't appear. Requests go from the backend, never
the browser.

**The code finds, the model explains.** The ambiguity check itself still computes every
overlap exactly; the model is given one finding at a time (the two Modes and the computed
overlap) or, for a run, the counts and the 40 most serious findings — so a request stays a
few thousand tokens however large the Emitter, Platform or MDF. Answers are kept with the
finding or run as a **draft**, marked with the model and who asked, and any number in an
answer that wasn't in what the model was given is listed for checking. Asking again
replaces it.

**Try it on your own data first.** In the backend container:

```bash
docker compose exec backend python scripts/llm_eval.py --check   # reachable? context size?
docker compose exec backend python scripts/llm_eval.py --limit 20  # latest run's findings
```

The second writes `llm_eval.md` (what the model was given and answered, per finding) and
`llm_eval.csv` (one row each, with empty *correct* / *useful* columns for an analyst), and
saves nothing to the database unless `--save` is given.

### Outline as background (being built)

The model can be given pages from an Outline wiki — the sensor logic, say — as background
for its answers. So far there's a read-only check of what it would get:

```bash
docker compose exec backend python scripts/outline_probe.py --tree             # collections and pages, nested
docker compose exec backend python scripts/outline_probe.py --root <page address>  # that page and all under it
docker compose exec backend python scripts/outline_probe.py --root <page address> --search "stagger"
docker compose exec backend python scripts/outline_probe.py --root <page address> --sections  # every section
```

`--root` takes a page's address as copied from the browser (or its id, or exact title) and
reads it with every page nested under it, however deep; `--collection NAME` reads a whole
collection. Set the one you settle on as `OUTLINE_ROOT` (or `OUTLINE_COLLECTION`) on the
backend; pages added under it later are picked up too.

The model is given sections — the text under each heading, labelled with every heading
above it and the page's place in the collection — so the structure in Outline matters:
`--sections` marks sections too long to hand over whole (split them with sub-headings),
too short to make sense alone, or under no heading at all.

with `OUTLINE_URL` and `OUTLINE_API_TOKEN` (an Outline API key — Outline → Settings → API) set
on the backend. Only what that Outline account may read
is ever returned. If Outline runs on the same server, the backend container has to be able to
reach that address. Either:

- **through Traefik (or whichever proxy) by name** — if the container can't resolve the
  name, add `extra_hosts: ["outline.app:host-gateway"]` to the backend service; a
  certificate from your own authority needs `OUTLINE_CA_BUNDLE`; or
- **straight to Outline's container** — put the backend on a Docker network Outline is on,
  set `OUTLINE_URL=http://<outline container>:3000` and `OUTLINE_PUBLIC_URL` to the address
  people open, which the links back to Outline use.

## Database migrations

`alembic/versions/` holds a single baseline migration, not an incremental history — a
prior migration that created the core tables was lost from the repo at some point, leaving
`alembic upgrade head` unable to bootstrap a genuinely fresh database (every existing dev/test
database had those tables already, so this went unnoticed). The current baseline was
regenerated from the live SQLAlchemy models (`alembic revision --autogenerate` against an
empty database) and verified to produce an exact match to `app/models/` with no drift
(`alembic check`). If any other database out there is still stamped partway through the old
migration chain, point it at the new baseline with `alembic stamp d68a4d14b7c2` instead of
running `upgrade head` from wherever it was.

## Tests

```bash
cd backend
sudo -u postgres psql -c "CREATE DATABASE rf_emitter_test OWNER rf_app;"   # once
sudo -u postgres psql -c "CREATE DATABASE rf_emitter_test_verify OWNER rf_app;"   # once, for the backup verification test
source .venv/bin/activate
pytest
```

Integration tests run against a real Postgres database (not SQLite) since the schema uses
JSONB and array columns whose behavior only real Postgres reproduces faithfully.

## Documentation

- **[docs/FEATURES.md](docs/FEATURES.md)** — full feature walkthrough (Emitters, Modes &
  PRI types, the DSL, Sources & import, versioning & diffs, Platforms, MDFs, test
  tracking, the dashboard, ambiguity checks, XML export, backup & restore, accounts &
  roles, the Admin panel).
- **[docs/XML_IMPORT_BRIEF.md](docs/XML_IMPORT_BRIEF.md)** — field-mapping reference and
  open design questions for the upcoming XML import feature.
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — proposed-but-not-yet-built features.
