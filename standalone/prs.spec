# PyInstaller spec for the standalone app — run from the repository root:
#     python -m PyInstaller standalone/prs.spec --noconfirm
# Expects frontend/dist-standalone built first (npm run build:standalone).
# Produces dist/PRS/ (PRS.exe and _internal/); the build script then adds
# PostgreSQL beside it as dist/PRS/pgsql.
import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = Path(SPECPATH).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend" / "dist-standalone"
if not (FRONTEND / "index.html").exists():
    raise SystemExit("Build the frontend first: cd frontend && npm run build:standalone")

# The backend's own files that aren't Python (the DSL grammar, export templates),
# where the code looks for them: beside its modules.
app_data = [
    (str(p), str(Path("app") / p.relative_to(BACKEND / "app").parent))
    for p in (BACKEND / "app").rglob("*")
    if p.is_file() and p.suffix not in (".py", ".pyc") and "__pycache__" not in p.parts
]

datas = [
    (str(BACKEND / "alembic"), "backend/alembic"),
    (str(FRONTEND), "frontend_dist"),
    *app_data,
    *collect_data_files("lark"),
]

hiddenimports = [
    *collect_submodules("app"),
    *collect_submodules("prs_standalone"),
    *collect_submodules("uvicorn"),
    *collect_submodules("alembic"),
    *collect_submodules("sqlalchemy.dialects.postgresql"),
    "psycopg2",
    "passlib.handlers.bcrypt",
    "multipart",
    "truststore",
]

a = Analysis(
    [str(ROOT / "standalone" / "run_prs.py")],
    pathex=[str(ROOT / "standalone"), str(BACKEND)],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="PRS",
    console=True,  # the window says it's running; closing it stops the app
    icon=None,
)
coll = COLLECT(exe, a.binaries, a.datas, name="PRS")
