"""GET /api/pts?ventana=3 — listado de PTs con demanda activa.

Cache TTL=5min keyed por ventana_meses, maxsize=4 (asume ventanas tipicas
de 1, 2, 3, 6 meses).
"""

from __future__ import annotations

import threading
from datetime import date
from typing import Annotated

import pyodbc
from cachetools import TTLCache
from fastapi import APIRouter, Depends, Query

from ..deps import get_conn, universo_ids as _universo_ids
from ..domain.modelo import FilaListado
from ..services.arbol_service import listar_pts


router = APIRouter(prefix="/api", tags=["pts"])

# Slug del universo: "general" (sin filtro) o el de un listado de
# `listados/listados.json`. Se valida al resolverlo, no con un Literal, para
# que agregar un listado sea solo dejar su CSV y su entrada en el manifiesto.
Universo = str


# Cache compartido entre requests. TTL 5 min.
# Key = (universo, ventana, fecha_max_iso | None). maxsize permite varias
# combinaciones de fecha/universo.
_cache: TTLCache[tuple[str, int, str | None], list[FilaListado]] = TTLCache(
    maxsize=32, ttl=300
)
_lock = threading.Lock()


@router.get("/pts", response_model=list[FilaListado])
def get_pts(
    ventana: Annotated[int, Query(ge=1, le=24)] = 3,
    fecha_max: Annotated[date | None, Query()] = None,
    universo: Annotated[Universo, Query()] = "general",
    conn: pyodbc.Connection = Depends(get_conn),
) -> list[FilaListado]:
    fecha_max_iso = fecha_max.isoformat() if fecha_max else None
    uni = _universo_ids(universo)
    if uni is not None and len(uni) == 0:
        return []  # listado sin numeros criticos cargados
    key = (universo, ventana, fecha_max_iso)
    with _lock:
        cached = _cache.get(key)
    if cached is not None:
        return cached

    filas = listar_pts(
        conn, ventana_meses=ventana, fecha_max=fecha_max_iso, universo_ids=uni
    )
    with _lock:
        _cache[key] = filas
    return filas
