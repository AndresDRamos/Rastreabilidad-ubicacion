"""Dependencias FastAPI: settings y conexion pyodbc por request."""

from __future__ import annotations

from typing import Iterator

import pyodbc
from fastapi import Depends

from .config import Settings, get_settings


def get_conn(settings: Settings = Depends(get_settings)) -> Iterator[pyodbc.Connection]:
    """Yield una conexion pyodbc fresca por request.

    Razon: pyodbc no es thread-safe entre conexiones, y FastAPI corre los
    endpoints sync en un threadpool. Una conexion por request es seguro y
    simple, sin necesidad de pool.
    """
    conn = pyodbc.connect(settings.conn_string, timeout=settings.timeout)
    try:
        yield conn
    finally:
        conn.close()
