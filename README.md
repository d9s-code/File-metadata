# RF Recognizer Emitter Profile Manager

A self-contained, fully offline web application for building and maintaining **emitter
profiles** for an RF Recognizer, and packaging them into versioned **Mission Data Files
(MDFs)**. It covers the whole workflow: entering RF/PRI/PW parameters (via forms or a
typed DSL), organizing them by operational EW Group and by data-provenance Source,
grouping Emitters into Platforms, pinning Platforms into MDFs, tracking version history
with diffs, running pairwise ambiguity analysis, logging real-world test results, and
exporting a committed MDF to XML.

See **[docs/FEATURES.md](docs/FEATURES.md)** for a full walkthrough of every feature and
the reasoning behind key design decisions (e.g. why Platforms — not Emitters — are what
gets pinned into an MDF, and why readiness warnings never hard-block release).

## Highlights

- **Emitters, EW Groups & Sources** — Modes are grouped two ways at once: operationally
  by EW Group (scan range + threat priority) and by data provenance by Source.
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
  placeholder field-mapping layer (Sources/elements are deliberately excluded).
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
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # edit DATABASE_URL / JWT_SECRET; set COOKIE_SECURE=false for plain-HTTP local dev
alembic upgrade head
python scripts/create_admin.py admin <password>
uvicorn app.main:app --reload

# in another shell
cd frontend
npm install
npm run dev
```

Backend: http://localhost:8000 · Frontend dev server: http://localhost:5173

## Docker Compose (closer to the offline deployment shape)

```bash
cp .env.example .env   # at repo root: set POSTGRES_PASSWORD and JWT_SECRET
docker compose up --build
```

`docker-compose.yml` deliberately puts Postgres data and database backups in **separate**
named volumes (`pg_data` vs `backup_data`). On a real deployment, map those to genuinely
separate physical disks — the whole point of the separation is that one disk failing must
not be able to take out both the live database and its backups.

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
```

Restore is deliberately a CLI-only, confirmation-required runbook rather than a UI
button, since it overwrites live data. See `docs/FEATURES.md#backup--restore` for the
full retention/verification story.

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
  PRI types, the DSL, Sources, versioning & diffs, Platforms, MDFs, test tracking, the
  dashboard, ambiguity checks, XML export, backup & restore, accounts & roles).
