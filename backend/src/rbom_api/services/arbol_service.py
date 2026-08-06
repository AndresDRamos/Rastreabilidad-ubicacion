"""Orquestacion: BD -> validacion pydantic -> netteo -> ArbolPT."""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Iterable

import pyodbc
import structlog
from cachetools import TTLCache

from ..config import Settings
from ..domain import db
from ..domain.modelo import (
    ArbolPT,
    FilaAristaUniverso,
    FilaBom,
    FilaDemandaUniverso,
    FilaListado,
    FilaRuta,
    FilaWip,
    FilaWipUniverso,
    ReqUniverso,
)
from ..domain.netteo import construir_arbol
from ..domain.universo_req import construir_universo, repartir_wip_fifo


log = structlog.get_logger("rbom_api.services.arbol")


# Cache del netteo cross-PT. Key = (ventana, fecha_max_iso | None) — SIN
# universo: el requerimiento total es un hecho del piso, no depende de la
# pestana del sidebar (ver db.fetch_universo_req).
#
# TTL 5 min = mismo orden que el listado de PTs. Calcularlo cuesta ~1 s (0.8 s
# de SQL + netteo en memoria del bosque de ~6K nodos), asi que se resuelve
# inline en el request que lo pide; no hace falta job en background.
_universo_cache: TTLCache[tuple[int, str | None], dict[int, ReqUniverso]] = TTLCache(
    maxsize=8, ttl=300
)
_universo_lock = threading.Lock()

# Cuota de WIP por (idPT, idComp) del reparto FIFO. Misma key y mismo TTL que el
# universo: sale de los mismos insumos y caduca con ellos. Se cachea aparte
# porque el arbol la necesita en cada request y recalcularla cuesta ~30 ms.
_fifo_cache: TTLCache[tuple[int, str | None], dict[tuple[int, int], float]] = TTLCache(
    maxsize=8, ttl=300
)
_fifo_lock = threading.Lock()


def cuota_wip_fifo(
    conn: pyodbc.Connection,
    ventana_meses: int,
    fecha_max: str | None = None,
) -> dict[tuple[int, int], float]:
    """Reparto FIFO del WIP entre los PT que lo reclaman, cacheado 5 min.

    Ver domain/universo_req.repartir_wip_fifo: el inventario compartido se sirve
    a la demanda mas vencida primero, sin prorratear.
    """
    key = (ventana_meses, fecha_max)
    with _fifo_lock:
        cached = _fifo_cache.get(key)
    if cached is not None:
        return cached

    t0 = time.perf_counter()
    demanda_raw, aristas_raw, wip_raw, _ = db.fetch_universo_req(
        conn, ventana_meses=ventana_meses, fecha_max=fecha_max
    )
    asignado = repartir_wip_fifo(
        demanda_filas=[FilaDemandaUniverso(**f) for f in demanda_raw],
        arista_filas=[FilaAristaUniverso(**f) for f in aristas_raw],
        wip_filas=[FilaWipUniverso(**f) for f in wip_raw],
    )
    log.info(
        "wip_fifo_done",
        ventana_meses=ventana_meses,
        fecha_max=fecha_max,
        n_pares=len(asignado),
        piezas_repartidas=round(sum(asignado.values()), 2),
        duration_ms=round((time.perf_counter() - t0) * 1000, 2),
    )
    with _fifo_lock:
        _fifo_cache[key] = asignado
    return asignado


def _recortar_wip_a_cuota(
    wip: list[FilaWip], cuota: dict[int, float]
) -> tuple[list[FilaWip], dict[int, float]]:
    """Recorta el WIP del arbol a la cuota FIFO de este PT.

    El reparto asigna un total por componente; el arbol lo necesita por
    (componente, proceso). Se reparte **proporcionalmente al WIP de cada
    proceso**: conserva el total y no altera la forma de la cadena. (El CLR
    consume por (componente, planta, proceso); igualarlo exige traer el WIP del
    universo desagregado por proceso y se puede hacer despues sin rehacer esto.)

    Los conteos de ETIQUETAS y los buckets de display (liberadas, inspeccion de
    salida, retrabajo) NO se escalan: son hechos del piso, no cuotas.

    Returns:
        (wip recortado, wip fisico por componente antes del recorte)
    """
    fisico: dict[int, float] = defaultdict(float)
    for f in wip:
        fisico[f.idComp] += f.Piezas

    recortado: list[FilaWip] = []
    for f in wip:
        total = fisico[f.idComp]
        mia = cuota.get(f.idComp, 0.0)
        if total <= 0 or mia >= total:
            recortado.append(f)          # nadie mas lo reclama: se queda con todo
            continue
        k = mia / total
        recortado.append(f.model_copy(update={
            "Piezas": f.Piezas * k,
            "PiezasDisponibles": f.PiezasDisponibles * k,
            "PiezasRecibidas": f.PiezasRecibidas * k,
            "PiezasInspeccionSig": f.PiezasInspeccionSig * k,
        }))
    return recortado, dict(fisico)


def listar_pts(
    conn: pyodbc.Connection,
    ventana_meses: int,
    fecha_max: str | None = None,
    universo_ids: Iterable[int] | None = None,
) -> list[FilaListado]:
    """Lee Q_listado y valida cada fila contra FilaListado."""
    t0 = time.perf_counter()
    filas = db.fetch_listado(
        conn,
        ventana_meses=ventana_meses,
        fecha_max=fecha_max,
        universo_ids=universo_ids,
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


def req_universo(
    conn: pyodbc.Connection,
    ventana_meses: int,
    fecha_max: str | None = None,
) -> dict[int, ReqUniverso]:
    """Requerimiento cross-PT por componente, cacheado con TTL de 5 min.

    Nettea el bosque completo (todos los PTs con demanda activa). Ver
    domain/universo_req.py para por que no se puede sumar el netteo por PT.
    """
    key = (ventana_meses, fecha_max)
    with _universo_lock:
        cached = _universo_cache.get(key)
    if cached is not None:
        return cached

    t0 = time.perf_counter()
    demanda_raw, aristas_raw, wip_raw, pts_comp_raw = db.fetch_universo_req(
        conn, ventana_meses=ventana_meses, fecha_max=fecha_max
    )
    sql_ms = (time.perf_counter() - t0) * 1000

    t1 = time.perf_counter()
    pts_por_comp: dict[int, list[int]] = {}
    for fila in pts_comp_raw:
        pts_por_comp.setdefault(fila["idComp"], []).append(fila["idPT"])

    resultado = construir_universo(
        demanda_filas=[FilaDemandaUniverso(**f) for f in demanda_raw],
        arista_filas=[FilaAristaUniverso(**f) for f in aristas_raw],
        wip_filas=[FilaWipUniverso(**f) for f in wip_raw],
        pts_por_comp=pts_por_comp,
    )
    netteo_ms = (time.perf_counter() - t1) * 1000

    log.info(
        "universo_req_done",
        ventana_meses=ventana_meses,
        fecha_max=fecha_max,
        n_pts=len(demanda_raw),
        n_aristas=len(aristas_raw),
        n_componentes=len(resultado),
        n_ciclicos=sum(1 for r in resultado.values() if r.ciclico),
        sql_ms=round(sql_ms, 2),
        netteo_ms=round(netteo_ms, 2),
    )

    with _universo_lock:
        _universo_cache[key] = resultado
    return resultado


def armar_arbol(
    conn: pyodbc.Connection,
    idPt: int,
    ventana_meses: int,
    settings: Settings,
    fecha_max: str | None = None,
    con_universo: bool = True,
) -> ArbolPT:
    """Lee Q_detalle (4 result-sets), valida y arma el arbol netteado.

    Si `con_universo`, cada componente se enriquece con su requerimiento
    cross-PT (`req_universo`). Un fallo ahi NO tumba el arbol: el requerimiento
    del PT es el dato principal y la leyenda del universo es informativa.
    """
    t0 = time.perf_counter()
    demanda, bom_raw, ruta_raw, wip_raw = db.fetch_detalle(
        conn, idPT=idPt, ventana_meses=ventana_meses, fecha_max=fecha_max
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "db_query",
        query="Q_detalle",
        idPt=idPt,
        ventana_meses=ventana_meses,
        fecha_max=fecha_max,
        rows_demanda=len(demanda),
        rows_bom=len(bom_raw),
        rows_ruta=len(ruta_raw),
        rows_wip=len(wip_raw),
        duration_ms=round(elapsed_ms, 2),
    )

    bom = [FilaBom(**f) for f in bom_raw]
    ruta = [FilaRuta(**f) for f in ruta_raw]
    wip = [FilaWip(**f) for f in wip_raw]

    # Reparto FIFO: este PT solo nettea contra la cuota de WIP que le toca. Un
    # fallo aqui NO tumba el arbol — se cae al comportamiento anterior (100% del
    # WIP) y se registra, porque un arbol con un reparto optimista sigue siendo
    # mas util que un error.
    wip_fisico: dict[int, float] | None = None
    if con_universo:
        try:
            cuota_global = cuota_wip_fifo(conn, ventana_meses, fecha_max)
            mia = {
                comp: pzs for (pt, comp), pzs in cuota_global.items() if pt == idPt
            }
            wip, wip_fisico = _recortar_wip_a_cuota(wip, mia)
        except Exception as exc:  # noqa: BLE001
            log.warning("wip_fifo_failed", idPt=idPt, error=str(exc))

    t0 = time.perf_counter()
    arbol = construir_arbol(
        demanda_filas=demanda,
        bom_filas=bom,
        ruta_filas=ruta,
        wip_filas=wip,
        almacen_wip_id=settings.almacen_wip_proceso_id,
        almacen_wip_nombre=settings.almacen_wip_proceso_nombre,
        wip_fisico_por_comp=wip_fisico,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "netteo_done",
        idPt=idPt,
        n_componentes=len(arbol.componentes),
        n_advertencias=len(arbol.advertencias),
        duration_ms=round(elapsed_ms, 2),
    )

    if con_universo:
        _hidratar_req_universo(conn, arbol, ventana_meses, fecha_max)

    return arbol


def _hidratar_req_universo(
    conn: pyodbc.Connection,
    arbol: ArbolPT,
    ventana_meses: int,
    fecha_max: str | None,
) -> None:
    """Cuelga el requerimiento cross-PT en cada componente del arbol (in-place).

    Degrada con gracia: si el universo falla (BD lenta, dato sucio), el arbol se
    entrega sin la leyenda en vez de devolver un 500. El requerimiento del PT ya
    esta calculado y es el dato que el planner necesita.
    """
    try:
        universo = req_universo(conn, ventana_meses=ventana_meses, fecha_max=fecha_max)
    except Exception as exc:  # noqa: BLE001 — la leyenda es informativa, no critica
        arbol.advertencias.append(
            "No se pudo calcular el requerimiento total entre PTs; "
            "el arbol muestra solo el requerimiento de este PT."
        )
        log.warning("universo_req_failed", idPt=arbol.pt.idMaterial, error=str(exc))
        return

    for comp in arbol.componentes:
        comp.req_universo = universo.get(comp.idComp)
