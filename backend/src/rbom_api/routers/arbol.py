"""GET /api/pts/{idPt}/arbol?ventana=3 — arbol BOM netteado de un PT.

El response incluye AMBOS valores por nodo (wip_en_paso + req_paso) — el
toggle Inventario/Requerimiento del frontend es re-render puro, sin refetch.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

import pyodbc
from fastapi import APIRouter, Depends, HTTPException, Query

from ..config import Settings, get_settings
from ..deps import get_conn
from ..domain.modelo import ArbolPT
from ..services.arbol_service import armar_arbol


router = APIRouter(prefix="/api", tags=["arbol"])


@router.get("/pts/{idPt}/arbol", response_model=ArbolPT)
def get_arbol(
    idPt: int,
    ventana: Annotated[int, Query(ge=1, le=24)] = 3,
    fecha_max: Annotated[date | None, Query()] = None,
    conn: pyodbc.Connection = Depends(get_conn),
    settings: Settings = Depends(get_settings),
) -> ArbolPT:
    fecha_max_iso = fecha_max.isoformat() if fecha_max else None
    try:
        return armar_arbol(
            conn,
            idPt=idPt,
            ventana_meses=ventana,
            settings=settings,
            fecha_max=fecha_max_iso,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
