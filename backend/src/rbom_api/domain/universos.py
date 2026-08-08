"""Universos de filtrado por archivo (no por BD).

Un "listado" es un CSV (`ClaveMaterial, idMaterial`) con los numeros criticos de
un cliente. El backend lee la columna `idMaterial` y la usa como universo de PTs
en las queries del Resumen / Flujo / Calendario.

Los listados viven en `listados/` con un manifiesto `listados.json` que les da
slug y nombre visible. El slug es el valor del parametro `?universo=` y forma
parte de las queryKeys del frontend: no cambiarlo despues de publicado.

    listados/
      listados.json      <- registro: slug, nombre, archivo
      caterpillar.csv    <- ClaveMaterial, idMaterial

Todo se cachea en memoria y se invalida por mtime, tanto el manifiesto como cada
CSV: para refrescar un universo basta con sobrescribir el archivo, sin reiniciar
el proceso.

El universo especial `general` (sin filtro) no vive en el manifiesto — es la
ausencia de universo, y se resuelve a `None`.
"""

from __future__ import annotations

import csv
import json
import threading
from pathlib import Path

import structlog

from ..config import get_settings
from .modelo import ListadoInfo

log = structlog.get_logger("rbom_api.domain.universos")

# Slug reservado: "sin filtro de universo". No puede usarlo un listado.
UNIVERSO_GENERAL = "general"

# Caches module-level, cada uno invalidado por el mtime de su archivo.
_lock = threading.Lock()
_cache_csv: dict[str, tuple[float, frozenset[int]]] = {}
_cache_manifiesto: tuple[float, list[ListadoInfo]] | None = None


class UniversoDesconocido(ValueError):
    """El slug pedido no es `general` ni ningun listado del manifiesto."""


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


def _cargar_csv(path: Path) -> frozenset[int]:
    """Set de idMaterial de un CSV, cacheado por (ruta, mtime).

    Si el archivo no existe devuelve un set vacio: el caller decide como
    tratarlo (los routers cortocircuitan a respuesta vacia, para no devolver el
    universo completo por error)."""
    path = Path(path)
    if not path.exists():
        log.warning("universo_csv_inexistente", path=str(path))
        return frozenset()

    mtime = path.stat().st_mtime
    key = str(path.resolve())
    with _lock:
        cached = _cache_csv.get(key)
        if cached is not None and cached[0] == mtime:
            return cached[1]

    ids = _leer_csv(path)
    with _lock:
        _cache_csv[key] = (mtime, ids)
    log.info("universo_csv_cargado", path=str(path), n=len(ids))
    return ids


def listar_listados(manifiesto: Path | None = None) -> list[ListadoInfo]:
    """Listados declarados en el manifiesto, con su conteo de materiales.

    Cacheado por mtime del manifiesto. El conteo se recalcula siempre desde
    `_cargar_csv`, que tiene su propio cache por archivo: asi, sobrescribir un
    CSV se refleja sin tocar el manifiesto.

    Un listado cuyo archivo no existe se reporta con `n_materiales = 0` en vez
    de desaparecer — es mas facil de diagnosticar que un selector al que le
    falta una opcion.
    """
    global _cache_manifiesto

    if manifiesto is None:
        manifiesto = get_settings().listados_manifiesto
    manifiesto = Path(manifiesto)

    if not manifiesto.exists():
        log.warning("listados_manifiesto_inexistente", path=str(manifiesto))
        return []

    mtime = manifiesto.stat().st_mtime
    with _lock:
        cached = _cache_manifiesto
    if cached is not None and cached[0] == mtime:
        entradas = cached[1]
    else:
        try:
            crudo = json.loads(manifiesto.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            log.error("listados_manifiesto_ilegible", path=str(manifiesto), error=str(exc))
            return []

        entradas = []
        vistos: set[str] = set()
        for item in crudo.get("listados", []):
            slug = str(item.get("slug", "")).strip().lower()
            nombre = str(item.get("nombre", "")).strip()
            archivo = str(item.get("archivo", "")).strip()
            if not slug or not nombre or not archivo:
                log.warning("listado_incompleto", item=item)
                continue
            if slug == UNIVERSO_GENERAL:
                log.warning("listado_slug_reservado", slug=slug)
                continue
            if slug in vistos:
                log.warning("listado_slug_duplicado", slug=slug)
                continue
            vistos.add(slug)
            entradas.append(
                ListadoInfo(
                    slug=slug,
                    nombre=nombre,
                    archivo=archivo,
                    descripcion=str(item.get("descripcion") or "") or None,
                    actualizado=str(item.get("actualizado") or "") or None,
                    n_materiales=0,
                )
            )
        with _lock:
            _cache_manifiesto = (mtime, entradas)
        log.info("listados_manifiesto_cargado", path=str(manifiesto), n=len(entradas))

    base = manifiesto.parent
    return [e.model_copy(update={"n_materiales": len(_cargar_csv(base / e.archivo))})
            for e in entradas]


def resolver_universo(slug: str) -> frozenset[int] | None:
    """Traduce el parametro `universo` a un set de idMaterial.

    `general` -> None (sin filtro). Cualquier otro slug tiene que estar en el
    manifiesto; si no, `UniversoDesconocido` — nunca se degrada a "sin filtro",
    porque un slug mal escrito devolveria el universo completo haciendo creer
    que el filtro corrio.

    El frozenset puede venir vacio (archivo faltante o CSV sin filas validas);
    el caller debe cortocircuitar a respuesta vacia en ese caso.
    """
    slug = (slug or "").strip().lower()
    if slug == UNIVERSO_GENERAL:
        return None

    manifiesto = Path(get_settings().listados_manifiesto)
    for entrada in listar_listados(manifiesto):
        if entrada.slug == slug:
            return _cargar_csv(manifiesto.parent / entrada.archivo)

    raise UniversoDesconocido(slug)


def cargar_universo_caterpillar(path: Path | None = None) -> frozenset[int]:
    """Compat: el universo Caterpillar cuando era el unico listado.

    Se conserva para no romper llamadas viejas. Codigo nuevo debe usar
    `resolver_universo(slug)`.
    """
    if path is not None:
        return _cargar_csv(Path(path))
    return resolver_universo("caterpillar") or frozenset()
