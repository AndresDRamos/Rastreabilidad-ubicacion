"""Endpoints de la vista Calendario de requerimiento (panel expandible del
sidebar).

- GET /api/requerimiento/calendario?ventana=&fecha_max=&universo=
      -> list[CeldaCalendario]   (demanda desagregada por fecha, sin colapsar)
- GET /api/requerimiento/orden-detalle?idMaterial=&cliente=&ciudad=&desde=&hasta=&forecast=
      -> list[OrdenLinea]        (lineas de una celda: orden de venta + PO)

La celda = demanda BRUTA pendiente por fecha (SUM(Cantidad - Embarcado)); NO
descuenta WIP (eso vive en el arbol). Cliente/ciudad/forecast/granularidad se
resuelven client-side sobre el result-set de /calendario para no re-consultar,
igual que el listado del sidebar (GET /api/pts).

Cache TTL: /calendario 5 min (la demanda se mueve lento, espeja GET /pts);
/orden-detalle 2 min.
"""

from __future__ import annotations

import threading
import time
from datetime import date
from typing import Annotated, Literal

import pyodbc
import structlog
from cachetools import TTLCache
from fastapi import APIRouter, Depends, Query

from ..deps import get_conn
from ..domain import db
from ..domain.modelo import CeldaCalendario, OrdenLinea
from ..domain.universos import cargar_universo_caterpillar


router = APIRouter(prefix="/api/requerimiento", tags=["requerimiento"])
log = structlog.get_logger("rbom_api.routers.requerimiento")

Universo = Literal["general", "caterpillar"]


# Cache /calendario: (universo, ventana, fecha_max_iso | None). Espeja GET /pts.
_cache_cal: TTLCache[tuple[str, int, str | None], list[CeldaCalendario]] = TTLCache(
    maxsize=32, ttl=300
)
# Cache /orden-detalle: (idMaterial, cliente, ciudad, desde, hasta, forecast).
_CacheKeyOrden = tuple[int, int | None, int | None, str | None, str | None, bool]
_cache_orden: TTLCache[_CacheKeyOrden, list[OrdenLinea]] = TTLCache(maxsize=256, ttl=120)
_lock = threading.Lock()


@router.get("/calendario", response_model=list[CeldaCalendario])
def get_calendario(
    ventana: Annotated[int, Query(ge=1, le=24)] = 3,
    fecha_max: Annotated[date | None, Query()] = None,
    universo: Annotated[Universo, Query()] = "general",
    conn: pyodbc.Connection = Depends(get_conn),
) -> list[CeldaCalendario]:
    fecha_max_iso = fecha_max.isoformat() if fecha_max else None
    uni = cargar_universo_caterpillar() if universo == "caterpillar" else None
    if uni is not None and len(uni) == 0:
        return []  # Caterpillar sin numeros criticos cargados
    key = (universo, ventana, fecha_max_iso)
    with _lock:
        cached = _cache_cal.get(key)
    if cached is not None:
        return cached

    t0 = time.perf_counter()
    rows = db.fetch_requerimiento_calendario(
        conn, ventana_meses=ventana, fecha_max=fecha_max_iso, universo_ids=uni
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "db_query",
        query="Q_requerimiento_calendario",
        universo=universo,
        ventana=ventana,
        fecha_max=fecha_max_iso,
        rows=len(rows),
        duration_ms=round(elapsed_ms, 2),
    )
    celdas = [CeldaCalendario(**r) for r in rows]
    with _lock:
        _cache_cal[key] = celdas
    return celdas


@router.get("/orden-detalle", response_model=list[OrdenLinea])
def get_orden_detalle(
    idMaterial: Annotated[int, Query(ge=1)],
    cliente: Annotated[int | None, Query(ge=1)] = None,
    ciudad: Annotated[int | None, Query(ge=1)] = None,
    desde: Annotated[date | None, Query(description="Inicio del bucket (inclusive)")] = None,
    hasta: Annotated[date | None, Query(description="Fin del bucket (EXCLUSIVO)")] = None,
    forecast: Annotated[bool, Query(description="Incluir lineas forecast (bForecast=1)")] = False,
    conn: pyodbc.Connection = Depends(get_conn),
) -> list[OrdenLinea]:
    desde_iso = desde.isoformat() if desde else None
    hasta_iso = hasta.isoformat() if hasta else None
    key: _CacheKeyOrden = (idMaterial, cliente, ciudad, desde_iso, hasta_iso, forecast)
    with _lock:
        cached = _cache_orden.get(key)
    if cached is not None:
        return cached

    t0 = time.perf_counter()
    rows = db.fetch_orden_detalle(
        conn,
        id_material=idMaterial,
        id_cliente=cliente,
        id_ciudad=ciudad,
        fecha_desde=desde_iso,
        fecha_hasta=hasta_iso,
        incluye_forecast=forecast,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "db_query",
        query="Q_orden_detalle",
        id_material=idMaterial,
        cliente=cliente,
        ciudad=ciudad,
        desde=desde_iso,
        hasta=hasta_iso,
        forecast=forecast,
        rows=len(rows),
        duration_ms=round(elapsed_ms, 2),
    )
    lineas = [OrdenLinea(**r) for r in rows]
    with _lock:
        _cache_orden[key] = lineas
    return lineas
