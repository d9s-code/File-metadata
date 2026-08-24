# RF Recognizer Emitter Profile Manager

Offline tool for building emitter profiles (Platforms → Emitters → EW Groups/Sources → Modes)
and Mission Data Files for an RF Recognizer. See `/root/.claude/plans/i-need-an-app-shimmying-snail.md`
in the session this was built from for the full design plan; this file covers day-to-day setup.

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

## Tests

```bash
cd backend
sudo -u postgres psql -c "CREATE DATABASE rf_emitter_test OWNER rf_app;"   # once
source .venv/bin/activate
pytest
```

Integration tests run against a real Postgres database (not SQLite) since the schema uses
JSONB and array columns whose behavior only real Postgres reproduces faithfully.
