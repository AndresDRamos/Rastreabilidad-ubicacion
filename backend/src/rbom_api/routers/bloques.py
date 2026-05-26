"""Endpoints de la vista Resumen.

- GET /api/bloques?cliente=&planta=                  -> list[BloqueProceso]
- GET /api/bloques/{idProceso}/pts?cliente=&planta=  -> list[PTEnProceso]
- GET /api/plantas                                   -> list[Planta]

Cache TTL=2 min: los numeros se mueven con cada movimiento de etiqueta,
pero la vista no necesita ser tiempo-real.
"""

from __future__ import annotations

import threading
import time
from typing import Annotated

import pyodbc
import structlog
from cachetools import TTLCache
from fastapi import APIRouter, Depends, Query

from ..deps import get_conn
from ..domain import db
from ..domain.modelo import BloqueProceso, Planta, PTEnProceso


router = APIRouter(prefix="/api", tags=["bloques"])
log = structlog.get_logger("rbom_api.routers.bloques")


# Cache compartido entre requests. Keys incluyen filtros para no devolver
# datos cruzados entre clientes/plantas/ciudades/tipos de material distintos.
_CacheKeyBloques = tuple[
    int | None, int | None, tuple[int, ...], tuple[int, ...], tuple[int, ...]
]
_CacheKeyPts = tuple[
    int, int | None, int | None, tuple[int, ...], tuple[int, ...], tuple[int, ...]
]

_cache_bloques: TTLCache[_CacheKeyBloques, list[BloqueProceso]] = TTLCache(
    maxsize=128, ttl=120
)
_cache_pts: TTLCache[_CacheKeyPts, list[PTEnProceso]] = TTLCache(
    maxsize=256, ttl=120
)
_cache_plantas: TTLCache[str, list[Planta]] = TTLCache(maxsize=1, ttl=600)
_lock = threading.Lock()


def _parse_int_csv(raw: str | None) -> list[int]:
    """Acepta 'a,b,c' y devuelve [int]. Ignora vacios y valores invalidos."""
    if not raw:
        return []
    out: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(int(part))
        except ValueError:
            continue
    return out


# Alias retrocompatible para no romper imports/llamadas existentes.
_parse_ciudades_csv = _parse_int_csv


@router.get("/bloques", response_model=list[BloqueProceso])
def get_bloques(
    cliente: Annotated[int | None, Query(ge=1)] = None,
    planta: Annotated[int | None, Query(ge=1)] = None,
    ciudades: Annotated[str | None, Query(description="CSV de idCiudad")] = None,
    tipos_material: Annotated[
        str | None,
        Query(description="CSV de idTipoMaterial (PT=1, Intermedio=3)"),
    ] = None,
    clases: Annotated[
        str | None,
        Query(description="CSV de idClase NetSuit (CLASS_ID_ARTCULO_ID)"),
    ] = None,
    conn: pyodbc.Connection = Depends(get_conn),
) -> list[BloqueProceso]:
    ids_ciudad = _parse_int_csv(ciudades)
    ids_tipo = _parse_int_csv(tipos_material)
    ids_clase = _parse_int_csv(clases)
    key: _CacheKeyBloques = (
        cliente,
        planta,
        tuple(sorted(ids_ciudad)),
        tuple(sorted(ids_tipo)),
        tuple(sorted(ids_clase)),
    )
    with _lock:
        cached = _cache_bloques.get(key)
    if cached is not None:
        return cached

    t0 = time.perf_counter()
    rows = db.fetch_bloques(
        conn,
        id_cliente=cliente,
        id_planta=planta,
        ids_ciudad=ids_ciudad or None,
        ids_tipo_material=ids_tipo or None,
        ids_clase=ids_clase or None,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "db_query",
        query="Q_bloques",
        cliente=cliente,
        planta=planta,
        ciudades=ids_ciudad,
        tipos_material=ids_tipo,
        clases=ids_clase,
        rows=len(rows),
        duration_ms=round(elapsed_ms, 2),
    )
    bloques = [BloqueProceso(**r) for r in rows]
    with _lock:
        _cache_bloques[key] = bloques
    return bloques


@router.get("/bloques/{idProceso}/pts", response_model=list[PTEnProceso])
def get_pts_en_proceso(
    idProceso: int,
    cliente: Annotated[int | None, Query(ge=1)] = None,
    planta: Annotated[int | None, Query(ge=1)] = None,
    ciudades: Annotated[str | None, Query(description="CSV de idCiudad")] = None,
    tipos_material: Annotated[
        str | None,
        Query(description="CSV de idTipoMaterial (PT=1, Intermedio=3)"),
    ] = None,
    clases: Annotated[
        str | None,
        Query(description="CSV de idClase NetSuit (CLASS_ID_ARTCULO_ID)"),
    ] = None,
    conn: pyodbc.Connection = Depends(get_conn),
) -> list[PTEnProceso]:
    ids_ciudad = _parse_int_csv(ciudades)
    ids_tipo = _parse_int_csv(tipos_material)
    ids_clase = _parse_int_csv(clases)
    key: _CacheKeyPts = (
        idProceso,
        cliente,
        planta,
        tuple(sorted(ids_ciudad)),
        tuple(sorted(ids_tipo)),
        tuple(sorted(ids_clase)),
    )
    with _lock:
        cached = _cache_pts.get(key)
    if cached is not None:
        return cached

    t0 = time.perf_counter()
    rows = db.fetch_pts_en_proceso(
        conn,
        id_proceso=idProceso,
        id_cliente=cliente,
        id_planta=planta,
        ids_ciudad=ids_ciudad or None,
        ids_tipo_material=ids_tipo or None,
        ids_clase=ids_clase or None,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "db_query",
        query="Q_pts_en_proceso",
        id_proceso=idProceso,
        cliente=cliente,
        planta=planta,
        ciudades=ids_ciudad,
        tipos_material=ids_tipo,
        clases=ids_clase,
        rows=len(rows),
        duration_ms=round(elapsed_ms, 2),
    )
    pts = [PTEnProceso(**r) for r in rows]
    with _lock:
        _cache_pts[key] = pts
    return pts


@router.get("/plantas", response_model=list[Planta])
def get_plantas(
    conn: pyodbc.Connection = Depends(get_conn),
) -> list[Planta]:
    with _lock:
        cached = _cache_plantas.get("all")
    if cached is not None:
        return cached

    t0 = time.perf_counter()
    rows = db.fetch_plantas(conn)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "db_query",
        query="Q_plantas",
        rows=len(rows),
        duration_ms=round(elapsed_ms, 2),
    )
    plantas = [Planta(**r) for r in rows]
    with _lock:
        _cache_plantas["all"] = plantas
    return plantas
