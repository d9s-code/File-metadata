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
  Recently Deleted view (restore, or Admin-only permanent delete/auto-purge via cron);
  Admins can also create and manage user accounts from the UI.
- **Backup & restore** — `pg_dump`/`pg_restore` based, with retention pruning and
  automated restore verification; treated as the most critical piece of ops, not an
  afterthought.
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
an existing Postgres 18 instance rather than running its own — `docker-compose.yml` only
defines the `backend` and `frontend` services. Before running it:

- Edit `DATABASE_URL` in `docker-compose.yml` to point at a role/database created on that
  Postgres 18 instance (see below), and add the backend to whatever Docker network reaches
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

Database backups (`backend/scripts/backup_db.py`) still write to the `backup_data` volume,
separate from wherever the Postgres 18 instance itself stores its data — keep that separation
on different physical disks if that instance doesn't already handle it elsewhere.

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
   been created on the Postgres 18 instance, then:
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

```bash
# one-off / manual
python backend/scripts/backup_db.py

# restore (deliberately requires confirming the target DB name)
python backend/scripts/restore_db.py /path/to/emitterdb_20260101_030000.dump --confirm-db rf_emitter_db
```

Schedule regular backups via OS cron (decoupled from whether the app process is up), e.g.
`crontab -e`:

```
# nightly backup + retention pruning at 03:00
0 3 * * * cd /opt/rf-emitter-app/backend && .venv/bin/python scripts/backup_db.py >> /var/log/rf-emitter-backup.log 2>&1

# nightly trash purge at 03:30 — hard-deletes Emitters/Platforms/MDFs that
# have sat in Recently Deleted past the retention window (TRASH_RETENTION_DAYS, default 30)
30 3 * * * cd /opt/rf-emitter-app/backend && .venv/bin/python scripts/purge_deleted.py >> /var/log/rf-emitter-purge.log 2>&1
```

Restore is deliberately a CLI-only, confirmation-required runbook rather than a UI
button, since it overwrites live data. See `docs/FEATURES.md#backup--restore` for the
full retention/verification story.

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
