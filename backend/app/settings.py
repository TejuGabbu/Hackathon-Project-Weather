from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SENTINEL_", env_file=".env")

    app_name: str = "AI-Powered Environmental Sentinel API"
    sqlite_path: str = "sentinel.db"


settings = Settings()

