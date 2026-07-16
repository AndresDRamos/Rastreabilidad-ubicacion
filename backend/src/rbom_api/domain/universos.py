"""Universos de filtrado por archivo (no por BD).

Hoy solo existe el universo "Caterpillar Priority": un CSV
(`ClaveMaterial, idMaterial`) con los numeros criticos. El backend lo lee de
disco, parsea la columna `idMaterial` y la usa como filtro de universo de PTs
en las queries del Resumen / Flujo.

El set se cachea en memoria e se invalida automaticamente cuando cambia el
mtime del archivo (refrescable sin reiniciar el proceso: basta con sobrescribir
el CSV).
"""

from __future__ import annotations

import csv
import threading
from pathlib import Path

import structlog

from ..config import get_settings

log = structlog.get_logger("rbom_api.domain.universos")

# Cache module-level: (ruta_resuelta, mtime) -> frozenset[int].
_lock = threading.Lock()
_cache: dict[str, tuple[float, frozenset[int]]] = {}


def _parse_idmaterial(value: str | None) -> int | None:
    """Convierte el campo idMaterial a int. None/vacio/invalido -> None."""
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _leer_csv(path: Path) -> frozenset[int]:
    ids: set[int] = set()
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        # Tolera espacios/caps en el header: localiza la columna idMaterial.
        col = None
        for name in reader.fieldnames or []:
            if name and name.strip().lower() == "idmaterial":
                col = name
                break
        if col is None:
            log.warning("universo_csv_sin_columna_idMaterial", path=str(path))
            return frozenset()
        for row in reader:
            idm = _parse_idmaterial(row.get(col))
            if idm is not None:
                ids.add(idm)
    return frozenset(ids)


def cargar_universo_caterpillar(path: Path | None = None) -> frozenset[int]:
    """Devuelve el set de idMaterial del CSV de numeros criticos.

    Cacheado por (ruta, mtime). Si el archivo no existe devuelve un set vacio
    (el caller decide como tratarlo). `path` permite override en tests.
    """
    if path is None:
        path = get_settings().numeros_criticos_path
    path = Path(path)

    if not path.exists():
        log.warning("universo_csv_inexistente", path=str(path))
        return frozenset()

    mtime = path.stat().st_mtime
    key = str(path.resolve())
    with _lock:
        cached = _cache.get(key)
        if cached is not None and cached[0] == mtime:
            return cached[1]

    ids = _leer_csv(path)
    with _lock:
        _cache[key] = (mtime, ids)
    log.info("universo_csv_cargado", path=str(path), n=len(ids))
    return ids
