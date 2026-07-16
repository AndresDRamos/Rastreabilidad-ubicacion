"""Acceso a SQL Server EPS. Carga queries desde sql/ y ejecuta con pyodbc.

A diferencia del proyecto Streamlit original, este modulo NO expone un
context manager global de conexion. La conexion la inyecta FastAPI via
``deps.get_conn`` (yield por request).
"""

from __future__ import annotations

from typing import Any, Iterable

import pyodbc

from ..config import SQL_DIR


def _leer_sql(nombre: str) -> str:
    return (SQL_DIR / nombre).read_text(encoding="utf-8")


def _rows_to_dicts(cursor: pyodbc.Cursor) -> list[dict[str, Any]]:
    if cursor.description is None:
        return []
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def fetch_listado(conn: pyodbc.Connection,
                  ventana_meses: int = 3,
                  fecha_max: str | None = None,
                  universo_ids: Iterable[int] | None = None) -> list[dict[str, Any]]:
    sql = _leer_sql("Q_listado.sql")
    sql = sql.replace("/*PT_UNIVERSO_FILTER*/", _pt_universo_predicate(universo_ids))
    cursor = conn.cursor()
    if fecha_max:
        # fecha_max viene validada como ISO yyyy-mm-dd desde el router (date).
        fecha_decl = f"DECLARE @fecha_max date = '{fecha_max}';\n"
    else:
        fecha_decl = "DECLARE @fecha_max date = NULL;\n"
    sql_param = (
        f"DECLARE @ventana_meses int = {int(ventana_meses)};\n"
        + fecha_decl
    ) + _strip_param_declarations(sql)
    cursor.execute(sql_param)
    rows = _rows_to_dicts(cursor)
    cursor.close()
    return rows

def fetch_detalle(conn: pyodbc.Connection, idPT: int,
                  ventana_meses: int = 3,
                  fecha_max: str | None = None) -> tuple[
                      list[dict[str, Any]],  # DEMANDA
                      list[dict[str, Any]],  # BOM
                      list[dict[str, Any]],  # RUTA
                      list[dict[str, Any]],  # WIP
                  ]:
    sql = _leer_sql("Q_detalle.sql")
    if fecha_max:
        # fecha_max viene validada como ISO yyyy-mm-dd desde el router (date).
        fecha_decl = f"DECLARE @fecha_max date = '{fecha_max}';\n"
    else:
        fecha_decl = "DECLARE @fecha_max date = NULL;\n"
    sql_param = (
        f"DECLARE @idPT int = {int(idPT)};\n"
        f"DECLARE @ventana_meses int = {int(ventana_meses)};\n"
        + fecha_decl
    ) + _strip_param_declarations(sql)

    cursor = conn.cursor()
    cursor.execute(sql_param)

    result_sets: list[list[dict[str, Any]]] = []
    while True:
        result_sets.append(_rows_to_dicts(cursor))
        if not cursor.nextset():
            break
    cursor.close()

    # Esperamos exactamente 4 result-sets en orden DEMANDA, BOM, RUTA, WIP.
    while len(result_sets) < 4:
        result_sets.append([])
    return result_sets[0], result_sets[1], result_sets[2], result_sets[3]


def _decl_int(name: str, value: int | None) -> str:
    if value is None:
        return f"DECLARE @{name} int = NULL;\n"
    return f"DECLARE @{name} int = {int(value)};\n"


def _ciudades_predicate(ids: list[int] | None) -> str:
    """Devuelve el predicado SQL a injectar en /*CIUDADES_FILTER*/.

    Valida cada id como int para evitar SQL injection. Lista vacia o None
    devuelve "" (no se filtra por ciudad)."""
    if not ids:
        return ""
    csv = ",".join(str(int(x)) for x in ids)
    return f"AND d.idCiudad IN ({csv})"


def _tipomat_predicate(ids: list[int] | None) -> str:
    """Predicado SQL para /*TIPOMAT_FILTER*/.

    Filtra por m.idTipoMaterial (alias `m` = tblMaterial JOINed en el CTE de
    WIP). Lista vacia o None = sin filtro."""
    if not ids:
        return ""
    csv = ",".join(str(int(x)) for x in ids)
    return f"AND m.idTipoMaterial IN ({csv})"


def _clase_predicate(ids: list[int] | None) -> str:
    """Predicado SQL para /*CLASE_FILTER*/.

    Filtra por I.CLASS_ID_ARTCULO_ID (alias `I` = NETSUITE.dbo.ITEMS JOINed en
    el cteDem). Lista vacia o None = sin filtro."""
    if not ids:
        return ""
    csv = ",".join(str(int(x)) for x in ids)
    return f"AND I.CLASS_ID_ARTCULO_ID IN ({csv})"


def _pt_universo_predicate(ids: Iterable[int] | None) -> str:
    """Predicado SQL para /*PT_UNIVERSO_FILTER*/.

    Acota el universo de PTs a `d.idMaterial IN (...)` (alias `d` = cteDem sobre
    tblDemandaEPS). Lo usa el universo "Caterpillar Priority" (CSV de numeros
    criticos). Cada id se castea a int como unica defensa anti-inyeccion. None o
    vacio = sin filtro."""
    if not ids:
        return ""
    csv = ",".join(str(int(x)) for x in ids)
    return f"AND d.idMaterial IN ({csv})"


def _destino_predicate(id_destino: int | None) -> str:
    """Predicado SQL para /*DESTINO_FILTER*/ (detalle de una arista del Flujo).

    Acota a etiquetas cuyo `idProcesoSiguiente` = destino. Solo tiene sentido con
    bucket='PorTransferir' (origen X -> destino Y). None = sin filtro."""
    if id_destino is None:
        return ""
    return f"AND e.idProcesoSiguiente = {int(id_destino)}"


def fetch_bloques(conn: pyodbc.Connection,
                  id_cliente: int | None = None,
                  id_planta: int | None = None,
                  ids_ciudad: list[int] | None = None,
                  ids_tipo_material: list[int] | None = None,
                  ids_clase: list[int] | None = None,
                  universo_ids: Iterable[int] | None = None) -> list[dict[str, Any]]:
    """Lee Q_bloques.sql — bloques agregados por idProcesoSiguiente."""
    sql = _leer_sql("Q_bloques.sql")
    sql = sql.replace("/*CIUDADES_FILTER*/", _ciudades_predicate(ids_ciudad))
    sql = sql.replace("/*TIPOMAT_FILTER*/", _tipomat_predicate(ids_tipo_material))
    sql = sql.replace("/*CLASE_FILTER*/", _clase_predicate(ids_clase))
    sql = sql.replace("/*PT_UNIVERSO_FILTER*/", _pt_universo_predicate(universo_ids))
    con_filtro = 1 if (
        id_cliente is not None or ids_ciudad or ids_clase or universo_ids
    ) else 0
    sql_param = (
        _decl_int("idCliente", id_cliente)
        + _decl_int("idPlantaFiltro", id_planta)
        + f"DECLARE @conFiltroUniverso bit = {con_filtro};\n"
    ) + _strip_param_declarations(sql)
    cursor = conn.cursor()
    cursor.execute(sql_param)
    rows = _rows_to_dicts(cursor)
    cursor.close()
    return rows


def fetch_pts_en_proceso(conn: pyodbc.Connection,
                         id_proceso: int,
                         id_cliente: int | None = None,
                         id_planta: int | None = None,
                         ids_ciudad: list[int] | None = None,
                         ids_tipo_material: list[int] | None = None,
                         ids_clase: list[int] | None = None,
                         universo_ids: Iterable[int] | None = None) -> list[dict[str, Any]]:
    """Lee Q_pts_en_proceso.sql — PTs cuyos componentes esperan @id_proceso."""
    sql = _leer_sql("Q_pts_en_proceso.sql")
    sql = sql.replace("/*CIUDADES_FILTER*/", _ciudades_predicate(ids_ciudad))
    sql = sql.replace("/*TIPOMAT_FILTER*/", _tipomat_predicate(ids_tipo_material))
    sql = sql.replace("/*CLASE_FILTER*/", _clase_predicate(ids_clase))
    sql = sql.replace("/*PT_UNIVERSO_FILTER*/", _pt_universo_predicate(universo_ids))
    sql_param = (
        _decl_int("idProcesoSelected", id_proceso)
        + _decl_int("idCliente", id_cliente)
        + _decl_int("idPlantaFiltro", id_planta)
    ) + _strip_param_declarations(sql)
    cursor = conn.cursor()
    cursor.execute(sql_param)
    rows = _rows_to_dicts(cursor)
    cursor.close()
    return rows


def fetch_etiquetas_detalle(conn: pyodbc.Connection,
                            id_proceso: int,
                            bucket: str,
                            id_cliente: int | None = None,
                            id_planta: int | None = None,
                            ids_ciudad: list[int] | None = None,
                            ids_tipo_material: list[int] | None = None,
                            ids_clase: list[int] | None = None,
                            universo_ids: Iterable[int] | None = None,
                            id_destino: int | None = None) -> list[dict[str, Any]]:
    """Lee Q_etiquetas_detalle.sql — etiquetas que componen el bucket dado."""
    sql = _leer_sql("Q_etiquetas_detalle.sql")
    sql = sql.replace("/*CIUDADES_FILTER*/", _ciudades_predicate(ids_ciudad))
    sql = sql.replace("/*TIPOMAT_FILTER*/", _tipomat_predicate(ids_tipo_material))
    sql = sql.replace("/*CLASE_FILTER*/", _clase_predicate(ids_clase))
    sql = sql.replace("/*PT_UNIVERSO_FILTER*/", _pt_universo_predicate(universo_ids))
    # DESTINO_FILTER solo aplica a 'PorTransferir' (acota idProcesoSiguiente=Y).
    # 'Encaminadas' usa @idDestino dentro de su propia rama (via ruta), no aqui.
    destino_filter = _destino_predicate(id_destino) if bucket == "PorTransferir" else ""
    sql = sql.replace("/*DESTINO_FILTER*/", destino_filter)
    con_filtro = 1 if (
        id_cliente is not None or ids_ciudad or ids_clase or universo_ids
    ) else 0
    # bucket viene validado contra una whitelist en el router.
    bucket_lit = bucket.replace("'", "''")
    sql_param = (
        _decl_int("idProcesoSelected", id_proceso)
        + f"DECLARE @bucket varchar(20) = '{bucket_lit}';\n"
        + _decl_int("idCliente", id_cliente)
        + _decl_int("idPlantaFiltro", id_planta)
        + _decl_int("idDestino", id_destino)
        + f"DECLARE @conFiltroUniverso bit = {con_filtro};\n"
    ) + _strip_param_declarations(sql)
    cursor = conn.cursor()
    cursor.execute(sql_param)
    rows = _rows_to_dicts(cursor)
    cursor.close()
    return rows


def fetch_flujo(conn: pyodbc.Connection,
                id_cliente: int | None = None,
                id_planta: int | None = None,
                ids_ciudad: list[int] | None = None,
                ids_tipo_material: list[int] | None = None,
                ids_clase: list[int] | None = None,
                universo_ids: Iterable[int] | None = None) -> tuple[
                    list[dict[str, Any]],  # BLOQUES
                    list[dict[str, Any]],  # ARISTAS
                ]:
    """Lee Q_flujo.sql — grafo de procesos conectados (2 result-sets).

    La estructura sale de las rutas de fabricacion del universo; el WIP se
    sobrepone. Devuelve (bloques, aristas)."""
    sql = _leer_sql("Q_flujo.sql")
    sql = sql.replace("/*CIUDADES_FILTER*/", _ciudades_predicate(ids_ciudad))
    sql = sql.replace("/*TIPOMAT_FILTER*/", _tipomat_predicate(ids_tipo_material))
    sql = sql.replace("/*CLASE_FILTER*/", _clase_predicate(ids_clase))
    sql = sql.replace("/*PT_UNIVERSO_FILTER*/", _pt_universo_predicate(universo_ids))
    sql_param = (
        _decl_int("idCliente", id_cliente)
        + _decl_int("idPlantaFiltro", id_planta)
    ) + _strip_param_declarations(sql)

    cursor = conn.cursor()
    cursor.execute(sql_param)
    result_sets: list[list[dict[str, Any]]] = []
    while True:
        result_sets.append(_rows_to_dicts(cursor))
        if not cursor.nextset():
            break
    cursor.close()

    # Esperamos 2 result-sets en orden BLOQUES, ARISTAS.
    while len(result_sets) < 2:
        result_sets.append([])
    return result_sets[0], result_sets[1]


def fetch_flujo_plantas(conn: pyodbc.Connection,
                        id_cliente: int | None = None,
                        ids_ciudad: list[int] | None = None,
                        ids_tipo_material: list[int] | None = None,
                        ids_clase: list[int] | None = None,
                        universo_ids: Iterable[int] | None = None) -> tuple[
                            list[dict[str, Any]],  # NODOS (planta)
                            list[dict[str, Any]],  # ARISTAS (interplanta)
                        ]:
    """Lee Q_flujo_plantas.sql — overview nivel planta (2 result-sets).

    Un nodo por planta (WIP interno total) y aristas Planta A -> Planta B. NO
    acepta @idPlantaFiltro: el overview muestra todas las plantas. Devuelve
    (nodos, aristas)."""
    sql = _leer_sql("Q_flujo_plantas.sql")
    sql = sql.replace("/*CIUDADES_FILTER*/", _ciudades_predicate(ids_ciudad))
    sql = sql.replace("/*TIPOMAT_FILTER*/", _tipomat_predicate(ids_tipo_material))
    sql = sql.replace("/*CLASE_FILTER*/", _clase_predicate(ids_clase))
    sql = sql.replace("/*PT_UNIVERSO_FILTER*/", _pt_universo_predicate(universo_ids))
    sql_param = _decl_int("idCliente", id_cliente) + _strip_param_declarations(sql)

    cursor = conn.cursor()
    cursor.execute(sql_param)
    result_sets: list[list[dict[str, Any]]] = []
    while True:
        result_sets.append(_rows_to_dicts(cursor))
        if not cursor.nextset():
            break
    cursor.close()

    # Esperamos 2 result-sets en orden NODOS, ARISTAS.
    while len(result_sets) < 2:
        result_sets.append([])
    return result_sets[0], result_sets[1]


def fetch_plantas(conn: pyodbc.Connection) -> list[dict[str, Any]]:
    """Lee Q_plantas.sql — lista de plantas con WIP activo."""
    sql = _leer_sql("Q_plantas.sql")
    cursor = conn.cursor()
    cursor.execute(sql)
    rows = _rows_to_dicts(cursor)
    cursor.close()
    return rows


def _strip_param_declarations(sql: str) -> str:
    """Quita los DECLARE @... del SQL para evitar redeclaraciones,
    manteniendo el uso de las variables en el batch."""
    lines = sql.splitlines()
    keep = []
    for line in lines:
        stripped = line.strip().lower()
        if stripped.startswith("declare @ventana_meses") \
           or stripped.startswith("declare @idpt") \
           or stripped.startswith("declare @fecha_max") \
           or stripped.startswith("declare @idplantafiltro") \
           or stripped.startswith("declare @idprocesoselected") \
           or stripped.startswith("declare @idcliente") \
           or stripped.startswith("declare @iddestino") \
           or stripped.startswith("declare @confiltrouniverso") \
           or stripped.startswith("declare @bucket"):
            continue
        keep.append(line)
    return "\n".join(keep)


def ping(conn: pyodbc.Connection) -> bool:
    """SELECT 1 — usado por /health para verificar BD up."""
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT 1")
        row = cursor.fetchone()
        return row is not None and row[0] == 1
    finally:
        cursor.close()
