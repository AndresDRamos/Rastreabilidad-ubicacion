"""Fixtures para tests e2e contra BD EPS real (192.168.4.5).

Lee credenciales de ``.env.test`` (en la carpeta backend/). Si no existe,
todos los tests con marker @pytest.mark.e2e se SKIPean con mensaje claro.

Aplicar marker e2e a TODOS los tests de este directorio:
    pytestmark = pytest.mark.e2e

Comando: pytest -m e2e -v
"""

from __future__ import annotations

import os
from pathlib import Path

import pyodbc
import pytest
from fastapi.testclient import TestClient

from rbom_api.config import Settings, get_settings
from rbom_api.main import create_app


BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_TEST = BACKEND_DIR / ".env.test"


def _parse_dotenv_value(raw: str) -> str:
    """Soporte minimo de comentarios inline (' #') y quotes envolventes."""
    v = raw.strip()
    if " #" in v:
        v = v.split(" #", 1)[0].rstrip()
    if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
        v = v[1:-1]
    return v


@pytest.fixture(scope="session")
def settings() -> Settings:
    if not ENV_TEST.exists():
        pytest.skip(
            f".env.test no encontrado en {ENV_TEST}. "
            f"Copia .env.test.example y rellena credenciales para correr los e2e."
        )
    # Cargamos las variables del .env.test al environment ANTES de instanciar
    # Settings, asi pydantic-settings las recoge.
    for line in ENV_TEST.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, raw_v = s.split("=", 1)
        # .env.test sobre-escribe siempre — es lo esperado para tests.
        os.environ[k.strip()] = _parse_dotenv_value(raw_v)
    # Invalidar el cache del Settings singleton: ya fue instanciado durante
    # el import de rbom_api.main con un env potencialmente vacio.
    get_settings.cache_clear()
    return get_settings()


@pytest.fixture(scope="session")
def conn(settings: Settings) -> pyodbc.Connection:
    """Una conexion compartida para toda la sesion de tests e2e."""
    try:
        c = pyodbc.connect(settings.conn_string, timeout=settings.timeout)
    except pyodbc.Error as exc:
        pytest.skip(f"No se pudo conectar a SQL Server EPS: {exc}")
    yield c
    c.close()


@pytest.fixture(scope="session")
def client(settings: Settings) -> TestClient:
    """TestClient de FastAPI — pega a los endpoints sin levantar uvicorn.

    Usa la app real (con Depends(get_conn) que abre conexiones nuevas por
    request via .env.test cargado en environ por la fixture settings).
    """
    app = create_app()
    return TestClient(app)


def env_int(name: str) -> int | None:
    v = os.environ.get(name, "").strip()
    if not v:
        return None
    try:
        return int(v)
    except ValueError:
        return None
