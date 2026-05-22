"""GET /api/pts/{idPt}/arbol?ventana=3 — arbol BOM netteado de un PT.

El response incluye AMBOS valores por nodo (wip_en_paso + req_paso) — el
toggle Inventario/Requerimiento del frontend es re-render puro, sin refetch.
"""

from __future__ import annotations

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
    conn: pyodbc.Connection = Depends(get_conn),
    settings: Settings = Depends(get_settings),
) -> ArbolPT:
    try:
        return armar_arbol(conn, idPt=idPt, ventana_meses=ventana, settings=settings)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
