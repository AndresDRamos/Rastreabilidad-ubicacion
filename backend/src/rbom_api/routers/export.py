"""GET /api/export/arboles?ids=1,2,3 — exporta arboles netteados a Excel.

Una hoja por PT. Pensado para los tabs abiertos en el frontend.

Endpoint `def` (sync) a proposito: pyodbc bloquea y FastAPI lo corre en
threadpool. Ver regla 1 de AGENTS.md.
"""

from __future__ import annotations

import time
from datetime import date
from typing import Annotated
from urllib.parse import quote

import pyodbc
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from ..config import Settings, get_settings
from ..deps import get_conn
from ..domain.modelo import ArbolPT
from ..services.arbol_service import armar_arbol
from ..services.export_service import exportar_arboles


router = APIRouter(prefix="/api", tags=["export"])
log = structlog.get_logger("rbom_api.routers.export")

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Tope defensivo: cada PT es un Q_detalle (100 ms - 3 s). 20 arboles ya es un
# archivo grande y ~1 min de request; mas que eso pide un job asincrono.
MAX_PTS = 20


def _parse_ids(ids: str) -> list[int]:
    """CSV de idMaterial -> lista de int, sin duplicados y preservando orden."""
    vistos: list[int] = []
    for parte in ids.split(","):
        parte = parte.strip()
        if not parte:
            continue
        try:
            idp = int(parte)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"id invalido: {parte!r}")
        if idp not in vistos:
            vistos.append(idp)
    if not vistos:
        raise HTTPException(status_code=422, detail="Sin ids: nada que exportar.")
    if len(vistos) > MAX_PTS:
        raise HTTPException(
            status_code=422,
            detail=f"Demasiados PTs ({len(vistos)}). Maximo {MAX_PTS} por exportacion.",
        )
    return vistos


@router.get("/export/arboles")
def export_arboles(
    ids: Annotated[str, Query(description="idMaterial separados por coma")],
    ventana: Annotated[int, Query(ge=1, le=24)] = 3,
    fecha_max: Annotated[date | None, Query()] = None,
    conn: pyodbc.Connection = Depends(get_conn),
    settings: Settings = Depends(get_settings),
) -> Response:
    id_list = _parse_ids(ids)
    fecha_max_iso = fecha_max.isoformat() if fecha_max else None

    t0 = time.perf_counter()
    arboles: list[ArbolPT] = []
    fallidos: list[int] = []
    for idPt in id_list:
        try:
            arboles.append(
                armar_arbol(
                    conn,
                    idPt=idPt,
                    ventana_meses=ventana,
                    settings=settings,
                    fecha_max=fecha_max_iso,
                )
            )
        except ValueError:
            # PT sin demanda activa o sin BOM: se omite su hoja en vez de tumbar
            # toda la exportacion. Si NINGUNO sale, se responde 404 mas abajo.
            fallidos.append(idPt)
            log.warning("export_pt_omitido", idPt=idPt)

    if not arboles:
        raise HTTPException(
            status_code=404,
            detail="Ningun PT pudo exportarse (sin demanda activa o sin BOM).",
        )

    contenido = exportar_arboles(arboles)
    log.info(
        "export_done",
        n_pts=len(arboles),
        n_fallidos=len(fallidos),
        bytes=len(contenido),
        duration_ms=round((time.perf_counter() - t0) * 1000, 2),
    )

    if len(arboles) == 1:
        base = f"arbol_{arboles[0].pt.PT}"
    else:
        base = f"arboles_{len(arboles)}_PTs"
    nombre = f"{base}_{date.today().isoformat()}.xlsx"

    # filename* (RFC 5987) porque las claves de PT pueden traer no-ASCII.
    disp = f"attachment; filename*=UTF-8''{quote(nombre)}"
    headers = {"Content-Disposition": disp}
    if fallidos:
        # El front lo lee para avisar sin romper la descarga.
        headers["X-Export-Omitidos"] = ",".join(str(i) for i in fallidos)
    return Response(content=contenido, media_type=XLSX_MIME, headers=headers)
