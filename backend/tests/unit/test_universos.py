"""Tests del loader del universo Caterpillar (CSV de numeros criticos)."""

from __future__ import annotations

from pathlib import Path

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
