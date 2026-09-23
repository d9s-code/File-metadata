from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolved relative to this file, not the process's cwd — a relative ".env"
# silently fails to load (falling back to defaults) whenever the process is
# launched from a different working directory, which happens with some
# process launchers/reload watchers.
_BACKEND_DIR = Path(__file__).resolve().parent.parent

_DEFAULT_JWT_SECRET = "dev-only-insecure-secret-change-me"
_MIN_JWT_SECRET_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_BACKEND_DIR / ".env", env_file_encoding="utf-8")

    # "dev" relaxes the startup secret check and serves the interactive API
    # docs; anything else is treated as a real deployment.
    app_env: str = "production"

    database_url: str = "postgresql+psycopg2://rf_app:rf_app_dev_pw@localhost:5432/rf_emitter_db"
    jwt_secret: str = _DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480

    backup_dir: str = "/var/backups/rf-emitter-db"
    backup_retention_daily: int = 14
    backup_retention_weekly: int = 8
    backup_retention_monthly: int = 6

    trash_retention_days: int = 30

    max_upload_bytes: int = 10 * 1024 * 1024

    cors_origins: list[str] = ["http://localhost:5173"]
    # Set false only for local dev over plain HTTP; must be true in any real deployment.
    cookie_secure: bool = True


    @property
    def is_dev(self) -> bool:
        return self.app_env == "dev"


def insecure_setting_problems(s: Settings) -> list[str]:
    problems = []
    if s.jwt_secret == _DEFAULT_JWT_SECRET or "CHANGE_ME" in s.jwt_secret:
        problems.append("JWT_SECRET is the built-in default or a CHANGE_ME placeholder")
    elif len(s.jwt_secret) < _MIN_JWT_SECRET_LENGTH:
        problems.append(f"JWT_SECRET is shorter than {_MIN_JWT_SECRET_LENGTH} characters")
    return problems


settings = Settings()
