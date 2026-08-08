"""Tests del registro de listados y del loader de universos (CSV de criticos)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from rbom_api.domain import universos


def _write_csv(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "NumerosCriticos.csv"
    p.write_text(body, encoding="utf-8")
    return p


def test_parsea_columna_idmaterial(tmp_path: Path) -> None:
    csv = "ClaveMaterial,idMaterial\n0930357-04,35200\n[35197]5051947-02,35197\n"
    path = _write_csv(tmp_path, csv)
    ids = universos.cargar_universo_caterpillar(path)
    assert ids == frozenset({35200, 35197})


def test_tolera_filas_vacias_e_invalidas(tmp_path: Path) -> None:
    csv = "ClaveMaterial,idMaterial\nA,1\n,\nB,no-numero\nC,2\n\n"
    path = _write_csv(tmp_path, csv)
    ids = universos.cargar_universo_caterpillar(path)
    assert ids == frozenset({1, 2})


def test_archivo_inexistente_devuelve_vacio(tmp_path: Path) -> None:
    ids = universos.cargar_universo_caterpillar(tmp_path / "no-existe.csv")
    assert ids == frozenset()


def test_sin_columna_idmaterial_devuelve_vacio(tmp_path: Path) -> None:
    path = _write_csv(tmp_path, "Clave,Otra\nA,1\n")
    ids = universos.cargar_universo_caterpillar(path)
    assert ids == frozenset()


def test_cache_se_invalida_por_mtime(tmp_path: Path) -> None:
    path = _write_csv(tmp_path, "ClaveMaterial,idMaterial\nA,1\n")
    assert universos.cargar_universo_caterpillar(path) == frozenset({1})
    # Reescribe con mtime distinto: el cache debe refrescar.
    import os
    import time

    new_mtime = path.stat().st_mtime + 10
    path.write_text("ClaveMaterial,idMaterial\nA,1\nB,2\n", encoding="utf-8")
    os.utime(path, (new_mtime, new_mtime))
    time.sleep(0.01)
    assert universos.cargar_universo_caterpillar(path) == frozenset({1, 2})


# ---------- Registro de listados (manifiesto) -------------------------------


def _manifiesto(tmp_path: Path, listados: list[dict], csvs: dict[str, str]) -> Path:
    for nombre, body in csvs.items():
        (tmp_path / nombre).write_text(body, encoding="utf-8")
    p = tmp_path / "listados.json"
    p.write_text(json.dumps({"listados": listados}), encoding="utf-8")
    return p


def _apuntar_settings(monkeypatch: pytest.MonkeyPatch, manifiesto: Path) -> None:
    """Hace que resolver_universo lea el manifiesto de prueba."""
    from rbom_api import config

    config.get_settings.cache_clear()
    monkeypatch.setenv("LISTADOS_MANIFIESTO", str(manifiesto))
    universos._cache_manifiesto = None


def test_listar_devuelve_nombre_y_conteo(tmp_path: Path) -> None:
    m = _manifiesto(
        tmp_path,
        [{"slug": "caterpillar", "nombre": "Caterpillar", "archivo": "cat.csv"}],
        {"cat.csv": "ClaveMaterial,idMaterial\nA,1\nB,2\n"},
    )
    universos._cache_manifiesto = None
    listados = universos.listar_listados(m)
    assert [(x.slug, x.nombre, x.n_materiales) for x in listados] == [
        ("caterpillar", "Caterpillar", 2)
    ]


def test_listado_con_csv_faltante_se_reporta_en_cero(tmp_path: Path) -> None:
    """Mejor una opcion con 0 que una opcion que desaparece sin explicacion."""
    m = _manifiesto(
        tmp_path, [{"slug": "x", "nombre": "X", "archivo": "no-existe.csv"}], {}
    )
    universos._cache_manifiesto = None
    listados = universos.listar_listados(m)
    assert len(listados) == 1 and listados[0].n_materiales == 0


def test_ignora_entradas_incompletas_duplicadas_y_slug_reservado(tmp_path: Path) -> None:
    m = _manifiesto(
        tmp_path,
        [
            {"slug": "a", "nombre": "A", "archivo": "a.csv"},
            {"slug": "a", "nombre": "A bis", "archivo": "a.csv"},   # duplicado
            {"slug": "general", "nombre": "G", "archivo": "a.csv"},  # reservado
            {"slug": "b", "nombre": "", "archivo": "a.csv"},         # sin nombre
        ],
        {"a.csv": "ClaveMaterial,idMaterial\nA,1\n"},
    )
    universos._cache_manifiesto = None
    assert [x.slug for x in universos.listar_listados(m)] == ["a"]


def test_manifiesto_ilegible_no_tumba_el_endpoint(tmp_path: Path) -> None:
    p = tmp_path / "listados.json"
    p.write_text("{ esto no es json", encoding="utf-8")
    universos._cache_manifiesto = None
    assert universos.listar_listados(p) == []


def test_resolver_general_es_sin_filtro(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    m = _manifiesto(
        tmp_path,
        [{"slug": "cat", "nombre": "Cat", "archivo": "cat.csv"}],
        {"cat.csv": "ClaveMaterial,idMaterial\nA,1\n"},
    )
    _apuntar_settings(monkeypatch, m)
    assert universos.resolver_universo("general") is None


def test_resolver_devuelve_los_ids_del_listado(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    m = _manifiesto(
        tmp_path,
        [{"slug": "cat", "nombre": "Cat", "archivo": "cat.csv"}],
        {"cat.csv": "ClaveMaterial,idMaterial\nA,7\nB,8\n"},
    )
    _apuntar_settings(monkeypatch, m)
    assert universos.resolver_universo("CAT") == frozenset({7, 8})  # case-insensitive


def test_slug_desconocido_falla_en_vez_de_no_filtrar(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Degradarlo a None devolveria el universo completo aparentando filtro."""
    m = _manifiesto(
        tmp_path,
        [{"slug": "cat", "nombre": "Cat", "archivo": "cat.csv"}],
        {"cat.csv": "ClaveMaterial,idMaterial\nA,1\n"},
    )
    _apuntar_settings(monkeypatch, m)
    with pytest.raises(universos.UniversoDesconocido):
        universos.resolver_universo("caterpilar")  # typo
