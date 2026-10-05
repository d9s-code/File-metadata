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
    # A second place each backup is copied to — another disk, a mounted share.
    backup_copy_dir: str | None = None
    # The scratch database verification restores into; default: the live
    # database's name + "_verify" on the same server. Create it once, owned by
    # the app's role — it's emptied again after every check.
    backup_verify_database_url: str | None = None
    # When the scheduler takes the automatic backup: a weekday ("sun", "monday"…)
    # or "daily", at HH:MM on the container's clock (UTC). Expired Recently
    # Deleted items are purged at that time every day either way.
    backup_schedule_day: str = "sun"
    backup_schedule_time: str = "03:00"
    # How soon a backup is due depends on how much has changed since the last
    # one: with this many changes it's due a week after it, with twice as many
    # half a week, and so on (12 hours at the soonest, 4 weeks at the latest).
    # Nothing changed, nothing due.
    backup_changes_per_week: int = 50

    trash_retention_days: int = 30

    # A language model behind an OpenAI-compatible API (e.g. vLLM), used to
    # explain ambiguity findings and summarise runs. Unset: those buttons
    # don't appear. LLM_BASE_URL is the address up to and including /v1.
    llm_base_url: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_timeout_seconds: float = 120.0
    llm_max_tokens: int = 1200

    # An Outline wiki whose pages (the sensor logic, say) the language model
    # may be given as background. OUTLINE_URL is the address people open it
    # at; OUTLINE_API_TOKEN belongs to an Outline account that can read only
    # what the model may see — Outline's own permissions decide. For a
    # certificate from your own authority, OUTLINE_CA_BUNDLE is its file.
    outline_url: str | None = None
    outline_api_token: str | None = None
    outline_collection: str | None = None
    # Or one page and everything nested under it — its address as copied
    # from the browser (or its id, or its exact title). Takes precedence.
    outline_root: str | None = None
    outline_ca_bundle: str | None = None

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
