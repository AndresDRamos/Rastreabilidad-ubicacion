"""Acceso a SQL Server EPS. Carga queries desde sql/ y ejecuta con pyodbc.

A diferencia del proyecto Streamlit original, este modulo NO expone un
context manager global de conexion. La conexion la inyecta FastAPI via
``deps.get_conn`` (yield por request).
"""

from __future__ import annotations

from typing import Any

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
                  fecha_max: str | None = None) -> list[dict[str, Any]]:
    sql = _leer_sql("Q_listado.sql")
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
                  ventana_meses: int = 3) -> tuple[
                      list[dict[str, Any]],  # DEMANDA
                      list[dict[str, Any]],  # BOM
                      list[dict[str, Any]],  # RUTA
                      list[dict[str, Any]],  # WIP
                  ]:
    sql = _leer_sql("Q_detalle.sql")
    sql_param = (
        f"DECLARE @idPT int = {int(idPT)};\n"
        f"DECLARE @ventana_meses int = {int(ventana_meses)};\n"
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


def fetch_bloques(conn: pyodbc.Connection,
                  id_cliente: int | None = None,
                  id_planta: int | None = None,
                  ids_ciudad: list[int] | None = None) -> list[dict[str, Any]]:
    """Lee Q_bloques.sql — bloques agregados por idProcesoSiguiente."""
    sql = _leer_sql("Q_bloques.sql")
    sql = sql.replace("/*CIUDADES_FILTER*/", _ciudades_predicate(ids_ciudad))
    con_filtro = 1 if (id_cliente is not None or ids_ciudad) else 0
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
                         ids_ciudad: list[int] | None = None) -> list[dict[str, Any]]:
    """Lee Q_pts_en_proceso.sql — PTs cuyos componentes esperan @id_proceso."""
    sql = _leer_sql("Q_pts_en_proceso.sql")
    sql = sql.replace("/*CIUDADES_FILTER*/", _ciudades_predicate(ids_ciudad))
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
           or stripped.startswith("declare @confiltrouniverso"):
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
