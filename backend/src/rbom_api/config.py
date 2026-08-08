"""Settings de la app — leidos desde variables de entorno / .env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


PACKAGE_DIR = Path(__file__).resolve().parent
SQL_DIR = PACKAGE_DIR / "sql"
# Raiz del monorepo: backend/src/rbom_api -> ../../.. = Rastreabilidad-app/
REPO_ROOT = PACKAGE_DIR.parents[2]


class Settings(BaseSettings):
    """Configuracion de la app. Lee .env y variables de entorno."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Conexion SQL Server EPS
    eps_server: str = "192.168.4.5"
    eps_database: str = "EPS"
    eps_user: str = "audit_agent"
    # Credencial canonica del workspace EZI (EPS_SQL_PASSWORD, definida una vez por
    # maquina con setx); EPS_PASSWORD queda como fallback para .env legados.
    eps_password: str = Field(
        default="",
        validation_alias=AliasChoices("EPS_SQL_PASSWORD", "EPS_PASSWORD"),
    )
    eps_driver: str = "ODBC Driver 17 for SQL Server"
    eps_timeout: int = 120

    # Dominio
    almacen_wip_proceso_id: int = 16
    almacen_wip_proceso_nombre: str = "Almacen WIP"

    # Listados de numeros criticos por cliente: manifiesto JSON que declara
    # (slug, nombre, archivo) y CSVs (ClaveMaterial, idMaterial) a su lado.
    # Override via env LISTADOS_MANIFIESTO.
    listados_manifiesto: Path = REPO_ROOT / "listados" / "listados.json"

    # App
    log_level: str = "INFO"
    dev: bool = False

    @property
    def conn_string(self) -> str:
        return (
            f"DRIVER={{{self.eps_driver}}};"
            f"SERVER={self.eps_server};"
            f"DATABASE={self.eps_database};"
            f"UID={self.eps_user};"
            f"PWD={self.eps_password};"
            "TrustServerCertificate=yes;"
        )

    @property
    def timeout(self) -> int:
        return self.eps_timeout


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Singleton de Settings. Cacheado para evitar re-leer .env por request."""
    return Settings()
