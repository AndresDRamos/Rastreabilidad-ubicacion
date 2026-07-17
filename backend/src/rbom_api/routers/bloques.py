"""Endpoints de la vista Resumen.

- GET /api/bloques?clientes=&planta=                  -> list[BloqueProceso]
- GET /api/bloques/{idProceso}/pts?clientes=&planta=  -> list[PTEnProceso]
- GET /api/plantas                                   -> list[Planta]

Cache TTL=2 min: los numeros se mueven con cada movimiento de etiqueta,
pero la vista no necesita ser tiempo-real.
"""

from __future__ import annotations

import threading
import time
from typing import Annotated, Literal

import pyodbc
import structlog
from cachetools import TTLCache
from fastapi import APIRouter, Depends, Query

from fastapi import HTTPException

from ..deps import get_conn
from ..domain import db
from ..domain.modelo import (
    BloqueProceso,
    EtiquetaDetalle,
    FlujoPlantasResponse,
    FlujoResponse,
    Planta,
    PTEnProceso,
)
from ..domain.universos import cargar_universo_caterpillar


router = APIRouter(prefix="/api", tags=["bloques"])
log = structlog.get_logger("rbom_api.routers.bloques")

# Universos de filtrado (pestana del sidebar). "general" = sin filtro de
# universo; "caterpillar" = solo los idMaterial del CSV de numeros criticos.
Universo = Literal["general", "caterpillar"]


def _universo_ids(universo: str) -> frozenset[int] | None:
    """Resuelve el param `universo` a un set de idMaterial.

    None = sin filtro (General). frozenset (posiblemente vacia) para Caterpillar:
    el caller debe cortocircuitar a respuesta vacia cuando sea vacia, para no
    devolver el universo completo por error."""
    if universo == "caterpillar":
        return cargar_universo_caterpillar()
    return None


# Cache compartido entre requests. Keys incluyen filtros (y el universo) para no
# devolver datos cruzados entre clientes/plantas/ciudades/tipos/universos.
_CacheKeyBloques = tuple[
    str, tuple[int, ...], int | None, tuple[int, ...], tuple[int, ...], tuple[int, ...]
]
_CacheKeyPts = tuple[
    str, int, tuple[int, ...], int | None, tuple[int, ...], tuple[int, ...], tuple[int, ...]
]
_CacheKeyFlujo = _CacheKeyBloques

_cache_bloques: TTLCache[_CacheKeyBloques, list[BloqueProceso]] = TTLCache(
    maxsize=128, ttl=120
)
_cache_pts: TTLCache[_CacheKeyPts, list[PTEnProceso]] = TTLCache(
    maxsize=256, ttl=120
)
_cache_flujo: TTLCache[_CacheKeyFlujo, FlujoResponse] = TTLCache(
    maxsize=128, ttl=120
)
# Overview por planta: misma clave que el flujo pero SIN planta (siempre todas).
_CacheKeyFlujoPlantas = tuple[
    str, tuple[int, ...], tuple[int, ...], tuple[int, ...], tuple[int, ...]
]
_cache_flujo_plantas: TTLCache[_CacheKeyFlujoPlantas, FlujoPlantasResponse] = TTLCache(
    maxsize=64, ttl=120
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
    clientes: Annotated[str | None, Query(description="CSV de idCliente")] = None,
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
    universo: Annotated[Universo, Query()] = "general",
    conn: pyodbc.Connection = Depends(get_conn),
) -> list[BloqueProceso]:
    ids_cliente = _parse_int_csv(clientes)
    ids_ciudad = _parse_int_csv(ciudades)
    ids_tipo = _parse_int_csv(tipos_material)
    ids_clase = _parse_int_csv(clases)
    uni = _universo_ids(universo)
    if uni is not None and len(uni) == 0:
        return []  # Caterpillar sin numeros criticos cargados
    key: _CacheKeyBloques = (
        universo,
        tuple(sorted(ids_cliente)),
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
        ids_cliente=ids_cliente or None,
        id_planta=planta,
        ids_ciudad=ids_ciudad or None,
        ids_tipo_material=ids_tipo or None,
        ids_clase=ids_clase or None,
        universo_ids=uni,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "db_query",
        query="Q_bloques",
        universo=universo,
        clientes=ids_cliente,
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


@router.get("/flujo", response_model=FlujoResponse)
def get_flujo(
    clientes: Annotated[str | None, Query(description="CSV de idCliente")] = None,
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
    universo: Annotated[Universo, Query()] = "general",
    conn: pyodbc.Connection = Depends(get_conn),
) -> FlujoResponse:
    """Grafo de procesos conectados: bloques (proceso x planta) + aristas
    (origen -> destino). Estructura desde la ruta, WIP sobrepuesto."""
    ids_cliente = _parse_int_csv(clientes)
    ids_ciudad = _parse_int_csv(ciudades)
    ids_tipo = _parse_int_csv(tipos_material)
    ids_clase = _parse_int_csv(clases)
    uni = _universo_ids(universo)
    if uni is not None and len(uni) == 0:
        return FlujoResponse(bloques=[], aristas=[])
    key: _CacheKeyFlujo = (
        universo,
        tuple(sorted(ids_cliente)),
        planta,
        tuple(sorted(ids_ciudad)),
        tuple(sorted(ids_tipo)),
        tuple(sorted(ids_clase)),
    )
    with _lock:
        cached = _cache_flujo.get(key)
    if cached is not None:
        return cached

    t0 = time.perf_counter()
    bloques_rows, aristas_rows = db.fetch_flujo(
        conn,
        ids_cliente=ids_cliente or None,
        id_planta=planta,
        ids_ciudad=ids_ciudad or None,
        ids_tipo_material=ids_tipo or None,
        ids_clase=ids_clase or None,
        universo_ids=uni,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "db_query",
        query="Q_flujo",
        universo=universo,
        clientes=ids_cliente,
        planta=planta,
        ciudades=ids_ciudad,
        tipos_material=ids_tipo,
        clases=ids_clase,
        rows_bloques=len(bloques_rows),
        rows_aristas=len(aristas_rows),
        duration_ms=round(elapsed_ms, 2),
    )
    flujo = FlujoResponse(
        bloques=[r for r in bloques_rows],
        aristas=[r for r in aristas_rows],
    )
    with _lock:
        _cache_flujo[key] = flujo
    return flujo


@router.get("/flujo/plantas", response_model=FlujoPlantasResponse)
def get_flujo_plantas(
    clientes: Annotated[str | None, Query(description="CSV de idCliente")] = None,
    ciudades: Annotated[str | None, Query(description="CSV de idCiudad")] = None,
    tipos_material: Annotated[
        str | None,
        Query(description="CSV de idTipoMaterial (PT=1, Intermedio=3)"),
    ] = None,
    clases: Annotated[
        str | None,
        Query(description="CSV de idClase NetSuit (CLASS_ID_ARTCULO_ID)"),
    ] = None,
    universo: Annotated[Universo, Query()] = "general",
    conn: pyodbc.Connection = Depends(get_conn),
) -> FlujoPlantasResponse:
    """Overview nivel planta: un nodo por planta + aristas interplanta. No
    acepta `planta` (muestra todas); el drill-in a una planta usa GET /flujo."""
    ids_cliente = _parse_int_csv(clientes)
    ids_ciudad = _parse_int_csv(ciudades)
    ids_tipo = _parse_int_csv(tipos_material)
    ids_clase = _parse_int_csv(clases)
    uni = _universo_ids(universo)
    if uni is not None and len(uni) == 0:
        return FlujoPlantasResponse(nodos=[], aristas=[])
    key: _CacheKeyFlujoPlantas = (
        universo,
        tuple(sorted(ids_cliente)),
        tuple(sorted(ids_ciudad)),
        tuple(sorted(ids_tipo)),
        tuple(sorted(ids_clase)),
    )
    with _lock:
        cached = _cache_flujo_plantas.get(key)
    if cached is not None:
        return cached

    t0 = time.perf_counter()
    nodos_rows, aristas_rows = db.fetch_flujo_plantas(
        conn,
        ids_cliente=ids_cliente or None,
        ids_ciudad=ids_ciudad or None,
        ids_tipo_material=ids_tipo or None,
        ids_clase=ids_clase or None,
        universo_ids=uni,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "db_query",
        query="Q_flujo_plantas",
        universo=universo,
        clientes=ids_cliente,
        ciudades=ids_ciudad,
        tipos_material=ids_tipo,
        clases=ids_clase,
        rows_nodos=len(nodos_rows),
        rows_aristas=len(aristas_rows),
        duration_ms=round(elapsed_ms, 2),
    )
    flujo = FlujoPlantasResponse(
        nodos=[r for r in nodos_rows],
        aristas=[r for r in aristas_rows],
    )
    with _lock:
        _cache_flujo_plantas[key] = flujo
    return flujo


@router.get("/bloques/{idProceso}/pts", response_model=list[PTEnProceso])
def get_pts_en_proceso(
    idProceso: int,
    clientes: Annotated[str | None, Query(description="CSV de idCliente")] = None,
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
    universo: Annotated[Universo, Query()] = "general",
    conn: pyodbc.Connection = Depends(get_conn),
) -> list[PTEnProceso]:
    ids_cliente = _parse_int_csv(clientes)
    ids_ciudad = _parse_int_csv(ciudades)
    ids_tipo = _parse_int_csv(tipos_material)
    ids_clase = _parse_int_csv(clases)
    uni = _universo_ids(universo)
    if uni is not None and len(uni) == 0:
        return []
    key: _CacheKeyPts = (
        universo,
        idProceso,
        tuple(sorted(ids_cliente)),
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
        ids_cliente=ids_cliente or None,
        id_planta=planta,
        ids_ciudad=ids_ciudad or None,
        ids_tipo_material=ids_tipo or None,
        ids_clase=ids_clase or None,
        universo_ids=uni,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "db_query",
        query="Q_pts_en_proceso",
        universo=universo,
        id_proceso=idProceso,
        clientes=ids_cliente,
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


_BUCKET_WHITELIST = {
    "Disponibles",
    "Recibidas",
    "PorTransferir",
    "Inspeccion",
    "Retrabajo",
    "Encaminadas",
}

# Buckets de arista del Flujo (origen X -> destino Y) que admiten ?destino=:
#   PorTransferir = material ya liberado de X hacia Y (arista con piezas).
#   Encaminadas   = material aun en X cuya ruta apunta a Y (arista en cero).
_BUCKETS_CON_DESTINO = {"PorTransferir", "Encaminadas"}

# Cache (idProceso, bucket, filtros) — los detalles cambian igual de seguido
# que los bloques; TTL 2 min coincide con el resto de la vista Resumen.
_CacheKeyEtiq = tuple[
    str, int, str, tuple[int, ...], int | None, int | None,
    tuple[int, ...], tuple[int, ...], tuple[int, ...],
]
_cache_etiquetas: TTLCache[_CacheKeyEtiq, list[EtiquetaDetalle]] = TTLCache(
    maxsize=512, ttl=120
)


@router.get(
    "/bloques/{idProceso}/etiquetas",
    response_model=list[EtiquetaDetalle],
)
def get_etiquetas_detalle(
    idProceso: int,
    bucket: Annotated[
        str,
        Query(description="Disponibles | Recibidas | PorTransferir | Inspeccion | Retrabajo"),
    ],
    clientes: Annotated[str | None, Query(description="CSV de idCliente")] = None,
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
    universo: Annotated[Universo, Query()] = "general",
    destino: Annotated[
        int | None,
        Query(ge=1, description="Con bucket=PorTransferir o Encaminadas: acota al proceso destino (arista del Flujo)"),
    ] = None,
    conn: pyodbc.Connection = Depends(get_conn),
) -> list[EtiquetaDetalle]:
    if bucket not in _BUCKET_WHITELIST:
        raise HTTPException(
            status_code=400,
            detail=f"bucket invalido. Debe ser uno de {sorted(_BUCKET_WHITELIST)}",
        )

    ids_cliente = _parse_int_csv(clientes)
    ids_ciudad = _parse_int_csv(ciudades)
    ids_tipo = _parse_int_csv(tipos_material)
    ids_clase = _parse_int_csv(clases)
    uni = _universo_ids(universo)
    if uni is not None and len(uni) == 0:
        return []
    key: _CacheKeyEtiq = (
        universo,
        idProceso,
        bucket,
        tuple(sorted(ids_cliente)),
        planta,
        destino,
        tuple(sorted(ids_ciudad)),
        tuple(sorted(ids_tipo)),
        tuple(sorted(ids_clase)),
    )
    with _lock:
        cached = _cache_etiquetas.get(key)
    if cached is not None:
        return cached

    t0 = time.perf_counter()
    rows = db.fetch_etiquetas_detalle(
        conn,
        id_proceso=idProceso,
        bucket=bucket,
        ids_cliente=ids_cliente or None,
        id_planta=planta,
        ids_ciudad=ids_ciudad or None,
        ids_tipo_material=ids_tipo or None,
        ids_clase=ids_clase or None,
        universo_ids=uni,
        id_destino=destino if bucket in _BUCKETS_CON_DESTINO else None,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "db_query",
        query="Q_etiquetas_detalle",
        universo=universo,
        id_proceso=idProceso,
        bucket=bucket,
        destino=destino,
        clientes=ids_cliente,
        planta=planta,
        ciudades=ids_ciudad,
        tipos_material=ids_tipo,
        clases=ids_clase,
        rows=len(rows),
        duration_ms=round(elapsed_ms, 2),
    )
    etiquetas = [EtiquetaDetalle(**r) for r in rows]
    with _lock:
        _cache_etiquetas[key] = etiquetas
    return etiquetas


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
