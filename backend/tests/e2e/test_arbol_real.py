"""Tests e2e: validan endpoints contra SQL Server EPS real.

Marker @pytest.mark.e2e (aplicado a todo el modulo). Correr:
    pytest -m e2e -v

Requiere ``backend/.env.test`` con credenciales reales — ver
``.env.test.example``.

Los asserts del PT canonico (91711066-RA) provienen del diagrama Excalidraw
del usuario validado en Fase 0-2:
- Componente 90358715-RA: 4 pzs en Doblez -> req_paso[Doblez]=218
- Componente 91711040-RA: 9 pzs en buffer Almacen WIP -> req_paso[Doblez]=213
"""

from __future__ import annotations

import os

import pytest

from .conftest import env_int


pytestmark = pytest.mark.e2e


def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["db_ok"] is True, f"BD no responde SELECT 1: {body}"
    assert body["status"] == "ok"
    assert "version" in body


def test_listado_contiene_pts_con_demanda(client):
    r = client.get("/api/pts", params={"ventana": 3})
    assert r.status_code == 200
    filas = r.json()
    assert isinstance(filas, list)
    assert len(filas) > 0, "No hay PTs con demanda activa en la ventana de 3 meses"
    assert any(f["PiezasPend"] > 0 for f in filas)
    # Sanity de schema
    primero = filas[0]
    for col in ("idMaterial", "PT", "Cliente", "Ciudad", "PiezasPend",
                "PiezasPastDue", "FechaPromMin", "DiasAtrasoMax"):
        assert col in primero, f"Falta columna {col} en /api/pts"


def test_arbol_pt_canonico_cuadra_con_diagrama(client):
    """Replica el caso del diagrama Excalidraw contra la BD real.

    Requiere que RBOM_E2E_PT_ID este definido en .env.test (idMaterial int,
    no la clave string). Si no, se skipea con mensaje.
    """
    pt_id = env_int("RBOM_E2E_PT_ID")
    if pt_id is None:
        pytest.skip(
            "RBOM_E2E_PT_ID no definido en .env.test — "
            "no se puede validar el caso del diagrama sin un PT especifico."
        )

    pt_clave = os.environ.get("RBOM_E2E_PT_CLAVE", "91711066-RA").strip()
    c1_clave = os.environ.get("RBOM_E2E_COMP1_CLAVE", "90358715-RA").strip()
    c2_clave = os.environ.get("RBOM_E2E_COMP2_CLAVE", "91711040-RA").strip()
    c1_req_doblez_esperado = env_int("RBOM_E2E_COMP1_REQ_DOBLEZ") or 218
    c2_req_doblez_esperado = env_int("RBOM_E2E_COMP2_REQ_DOBLEZ") or 213

    r = client.get(f"/api/pts/{pt_id}/arbol", params={"ventana": 3})
    assert r.status_code == 200, r.text
    arbol = r.json()

    # PT raiz
    assert arbol["pt"]["PT"] == pt_clave, \
        f"Clave del PT raiz no coincide: esperado={pt_clave} got={arbol['pt']['PT']}"
    assert arbol["pt"]["PiezasPend"] > 0

    # Componentes esperados por clave
    por_clave = {c["clave"]: c for c in arbol["componentes"]}
    assert c1_clave in por_clave, f"No se encontro componente {c1_clave} en el arbol"
    assert c2_clave in por_clave, f"No se encontro componente {c2_clave} en el arbol"

    # Componente 1: Doblez debe tener req_paso esperado
    c1 = por_clave[c1_clave]
    pasos_doblez_c1 = [p for p in c1["ruta"] if p["proceso"].lower().startswith("doblez")]
    assert pasos_doblez_c1, f"{c1_clave} no tiene paso Doblez en su ruta: {c1['ruta']}"
    assert pasos_doblez_c1[0]["req_paso"] == c1_req_doblez_esperado, (
        f"{c1_clave} Doblez.req_paso={pasos_doblez_c1[0]['req_paso']} "
        f"esperado={c1_req_doblez_esperado}"
    )

    # Componente 2: idem
    c2 = por_clave[c2_clave]
    pasos_doblez_c2 = [p for p in c2["ruta"] if p["proceso"].lower().startswith("doblez")]
    assert pasos_doblez_c2, f"{c2_clave} no tiene paso Doblez en su ruta"
    assert pasos_doblez_c2[0]["req_paso"] == c2_req_doblez_esperado, (
        f"{c2_clave} Doblez.req_paso={pasos_doblez_c2[0]['req_paso']} "
        f"esperado={c2_req_doblez_esperado}"
    )


def test_arbol_devuelve_ambos_valores_por_paso(client):
    """Cada PasoRuta debe traer wip_en_paso Y req_paso (toggle puro en frontend)."""
    pt_id = env_int("RBOM_E2E_PT_ID")
    if pt_id is None:
        # Fallback: usar el primer PT del listado.
        r = client.get("/api/pts", params={"ventana": 3})
        filas = r.json()
        if not filas:
            pytest.skip("No hay PTs con demanda para tomar uno de referencia")
        pt_id = int(filas[0]["idMaterial"])

    r = client.get(f"/api/pts/{pt_id}/arbol", params={"ventana": 3})
    assert r.status_code == 200, r.text
    arbol = r.json()
    for comp in arbol["componentes"]:
        for paso in comp["ruta"]:
            assert "wip_en_paso" in paso and "req_paso" in paso, (
                f"PasoRuta de {comp['clave']} no incluye ambos valores: {paso}"
            )
