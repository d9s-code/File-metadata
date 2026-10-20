import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlalchemy.exc import ProgrammingError

from app.config import settings
from app.database import Base
import app.models  # noqa: F401  (registers all model classes on Base.metadata)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# configparser treats "%" as interpolation syntax, so a URL-encoded query
# param (e.g. "%3D" in ?options=-csearch_path%3Dv2) must be escaped as "%%"
# here — this only affects how alembic's ConfigParser stores the value;
# get_main_option() below returns it unescaped.
config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        try:
            with context.begin_transaction():
                context.run_migrations()
        except ProgrammingError as err:
            if type(err.orig).__name__ in ("DuplicateTable", "DuplicateColumn", "DuplicateObject"):
                # Something an upgrade adds is there already: the database says
                # it's at an older version than its tables are — almost always a
                # restore that didn't finish (pg_restore --clean can't drop tables
                # newer than its dump). Nothing was changed: the upgrade runs in
                # one transaction.
                print(
                    "\n*** The database is out of step with itself: it records an older version than the "
                    f"tables it holds ({str(err.orig).strip().splitlines()[0]}).\n"
                    "*** This usually means a restore didn't finish. Nothing was changed. Restore a backup "
                    "with the restore script, which empties the database first and upgrades it after:\n"
                    "***   docker compose run --rm --no-deps backup python scripts/restore_db.py "
                    "/backups/<file>.dump --confirm-db <database name>\n",
                    file=sys.stderr,
                )
            raise


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
