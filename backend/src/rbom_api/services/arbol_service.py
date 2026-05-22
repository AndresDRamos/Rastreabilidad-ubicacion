"""Orquestacion: BD -> validacion pydantic -> netteo -> ArbolPT."""

from __future__ import annotations

import time

import pyodbc
import structlog

from ..config import Settings
from ..domain import db
from ..domain.modelo import ArbolPT, FilaBom, FilaListado, FilaRuta, FilaWip
from ..domain.netteo import construir_arbol


log = structlog.get_logger("rbom_api.services.arbol")


def listar_pts(
    conn: pyodbc.Connection,
    ventana_meses: int,
    fecha_max: str | None = None,
) -> list[FilaListado]:
    """Lee Q_listado y valida cada fila contra FilaListado."""
    t0 = time.perf_counter()
    filas = db.fetch_listado(
        conn, ventana_meses=ventana_meses, fecha_max=fecha_max
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "db_query",
        query="Q_listado",
        ventana_meses=ventana_meses,
        fecha_max=fecha_max,
        rows=len(filas),
        duration_ms=round(elapsed_ms, 2),
    )
    return [FilaListado(**f) for f in filas]


def armar_arbol(
    conn: pyodbc.Connection,
    idPt: int,
    ventana_meses: int,
    settings: Settings,
) -> ArbolPT:
    """Lee Q_detalle (4 result-sets), valida y arma el arbol netteado."""
    t0 = time.perf_counter()
    demanda, bom_raw, ruta_raw, wip_raw = db.fetch_detalle(
        conn, idPT=idPt, ventana_meses=ventana_meses
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "db_query",
        query="Q_detalle",
        idPt=idPt,
        ventana_meses=ventana_meses,
        rows_demanda=len(demanda),
        rows_bom=len(bom_raw),
        rows_ruta=len(ruta_raw),
        rows_wip=len(wip_raw),
        duration_ms=round(elapsed_ms, 2),
    )

    bom = [FilaBom(**f) for f in bom_raw]
    ruta = [FilaRuta(**f) for f in ruta_raw]
    wip = [FilaWip(**f) for f in wip_raw]

    t0 = time.perf_counter()
    arbol = construir_arbol(
        demanda_filas=demanda,
        bom_filas=bom,
        ruta_filas=ruta,
        wip_filas=wip,
        almacen_wip_id=settings.almacen_wip_proceso_id,
        almacen_wip_nombre=settings.almacen_wip_proceso_nombre,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "netteo_done",
        idPt=idPt,
        n_componentes=len(arbol.componentes),
        n_advertencias=len(arbol.advertencias),
        duration_ms=round(elapsed_ms, 2),
    )
    return arbol
