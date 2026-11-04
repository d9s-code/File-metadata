# Standalone (offline) app

The whole app on one Windows PC — no Docker, no installation — for working
where the server can't be reached, and syncing back when it can.

* **What it is:** `PRS.exe` (the backend and a launcher, frozen with
  PyInstaller), the frontend built for it, and PostgreSQL's Windows binaries
  in `pgsql\`. The launcher creates a database cluster in
  `%LOCALAPPDATA%\PRS` at the first start (listening on 127.0.0.1 only, with a
  generated password), migrates it, serves the backend under `/api` and the
  frontend on `http://127.0.0.1:8765`, and opens the browser.
* **Fetching:** the server's `GET /sync/copy` (Editors and up) is the whole
  database as gzipped JSON — not `pg_dump`, so the PC's PostgreSQL needn't
  match the server's. The PC loads it into its database and into
  `prs_baseline`, an untouched copy.
* **Syncing:** the PC works out every row inserted, updated or deleted since
  (against `prs_baseline`) and sends them with their base values; the server
  compares field by field (`backend/app/services/sync_service.py`): changed
  on one side only goes in, changed on both is a conflict a person settles per
  Emitter / Platform / MDF / …, history adds together. Then the PC fetches a
  fresh copy. Users, settings, AI chats and edit locks don't travel.
* **Versions must match:** the PC's and server's database versions (Alembic)
  must be the same to fetch or sync.

The user-facing explanation is `README-user.txt` (shipped as `README.txt`).

## Building for Windows

On a Windows 10/11 machine with Python 3.11, Node 22 and git:

```powershell
powershell -ExecutionPolicy Bypass -File standalone\build_windows.ps1
```

→ `build\standalone\PRS-offline-<version>-windows-x64.zip`. Options:
`-PgVersion 16.9-1` (EnterpriseDB's binaries zip to bundle), `-PgZip <file>`
(a zip already downloaded, for a build machine without internet).

Or let GitHub build it: the **Standalone (Windows)** workflow
(`.github/workflows/standalone-windows.yml`, run by hand or on a `v*` tag)
builds the zip, starts `PRS.exe` on an empty data folder to check it comes up
(`smoke_windows.ps1`), and attaches the zip to the run.

## Running from source (any OS)

```bash
cd frontend && npm run build:standalone && cd ..
cd standalone && PYTHONPATH=. python -m prs_standalone
```

On Linux it uses the system's PostgreSQL binaries (`/usr/lib/postgresql/*/bin`,
or `PRS_PG_BIN`); PostgreSQL refuses to run as root. `PRS_DATA_DIR` chooses the
data folder, `PRS_NO_BROWSER=1` skips opening the browser.
