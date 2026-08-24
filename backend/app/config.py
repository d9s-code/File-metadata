from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+psycopg2://rf_app:rf_app_dev_pw@localhost:5432/rf_emitter_db"
    jwt_secret: str = "dev-only-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480

    backup_dir: str = "/var/backups/rf-emitter-db"
    backup_retention_daily: int = 14
    backup_retention_weekly: int = 8
    backup_retention_monthly: int = 6

    cors_origins: list[str] = ["http://localhost:5173"]
    # Set false only for local dev over plain HTTP; must be true in any real deployment.
    cookie_secure: bool = True


settings = Settings()
