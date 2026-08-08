"""Dependencias FastAPI: settings, conexion pyodbc por request y universo."""

from __future__ import annotations

from typing import Iterator

import pyodbc
from fastapi import Depends, HTTPException

from .config import Settings, get_settings
from .domain.universos import UniversoDesconocido, resolver_universo


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


def universo_ids(universo: str) -> frozenset[int] | None:
    """Resuelve el query param `universo` a un set de idMaterial.

    `None` = sin filtro (universo General). Un frozenset —posiblemente vacio—
    para cualquier listado: el caller debe cortocircuitar a respuesta vacia
    cuando venga vacio, para no devolver el universo completo por error.

    Un slug que no existe es 400, NO "sin filtro": degradarlo silenciosamente
    devolveria toda la demanda con apariencia de haber filtrado.
    """
    try:
        return resolver_universo(universo)
    except UniversoDesconocido:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Universo desconocido: {universo!r}. "
                "Consulta GET /api/listados para los slugs validos."
            ),
        ) from None
