from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolved relative to this file, not the process's cwd — a relative ".env"
# silently fails to load (falling back to defaults) whenever the process is
# launched from a different working directory, which happens with some
# process launchers/reload watchers.
_BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_BACKEND_DIR / ".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+psycopg2://rf_app:rf_app_dev_pw@localhost:5432/rf_emitter_db"
    jwt_secret: str = "dev-only-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480

    backup_dir: str = "/var/backups/rf-emitter-db"
    backup_retention_daily: int = 14
    backup_retention_weekly: int = 8
    backup_retention_monthly: int = 6

    trash_retention_days: int = 30

    cors_origins: list[str] = ["http://localhost:5173"]
    # Set false only for local dev over plain HTTP; must be true in any real deployment.
    cookie_secure: bool = True


settings = Settings()
