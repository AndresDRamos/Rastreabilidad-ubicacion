"""Tests del algoritmo de netteo con casos sinteticos.

Caso canonico del usuario: Ca, Cc -> Cb -> Cp
- Cp requiere 1 pieza (demanda)
- Cb es hijo directo de Cp con CantEnsamble=2
- Ca es hijo de Cb con CantEnsamble=2
- Cc es hijo de Cb con CantEnsamble=2

WIP:
- Cb: 1 pza en Almacen WIP (=ya armado, esperando Cp)
- Ca: 2 pzs antes de Almacen WIP (terminaron Doblez)
- Cc: 1 pza antes de Almacen WIP

Resultado esperado:
- Cp: req_neto=1
- Cb: req_bruto=2, wip=1, req_neto=1
- Ca: req_bruto=1*2=2, wip=2, req_neto=0
- Cc: req_bruto=1*2=2, wip=1, req_neto=1
"""

from __future__ import annotations

from datetime import date

import pytest

from rbom_api.domain.modelo import FilaBom, FilaRuta, FilaWip
from rbom_api.domain.netteo import construir_arbol


ALM_WIP_ID = 16
ALM_WIP_NOMBRE = "Almacen WIP"

# ids sinteticos
CP, CB, CA, CC = 100, 200, 300, 400

# idProceso sinteticos
CORTE, DOBLEZ, SOLDADURA, PINTURA, EMBARQUES = 3, 4, 6, 7, 13


def _demanda(req_pt: float) -> list[dict]:
    return [{
        "idMaterial": CP, "PT": "Cp", "Descripcion": "Producto final",
        "idCliente": 1, "Cliente": "Test",
        "idCiudad": 1, "Ciudad": "Test City",
        "PiezasPend": req_pt, "FechaPromMin": date(2026, 5, 25),
        "FechaPromMax": date(2026, 5, 25), "PiezasPastDue": 0,
    }]


def _bom() -> list[FilaBom]:
    return [
        FilaBom(IdBom=1, IdBomParent=None, BomLevel=1, idComp=CP, Componente="Cp",
                IdPadre=None, idTipoMat=1, CantidadEnsamble=1, HijosTotales=1,
                bLastLevel=False, PrimerIdProceso=ALM_WIP_ID, PrimerProceso=ALM_WIP_NOMBRE,
                UltimoIdProceso=EMBARQUES, UltimoProceso="Embarques"),
        FilaBom(IdBom=2, IdBomParent=1, BomLevel=2, idComp=CB, Componente="Cb",
                IdPadre=CP, idTipoMat=3, CantidadEnsamble=2, HijosTotales=2,
                bLastLevel=False),
        FilaBom(IdBom=3, IdBomParent=2, BomLevel=3, idComp=CA, Componente="Ca",
                IdPadre=CB, idTipoMat=3, CantidadEnsamble=2, HijosTotales=0,
                bLastLevel=True),
        FilaBom(IdBom=4, IdBomParent=2, BomLevel=3, idComp=CC, Componente="Cc",
                IdPadre=CB, idTipoMat=3, CantidadEnsamble=2, HijosTotales=0,
                bLastLevel=True),
    ]


def _rutas() -> list[FilaRuta]:
    return [
        # Cp: Almacen WIP -> Soldadura -> Pintura -> Embarques
        FilaRuta(idComp=CP, OrdenRuta=10, idRuta=1, Ruta="Armado", idProceso=ALM_WIP_ID,
                 Proceso=ALM_WIP_NOMBRE, idProcesoSiguiente=SOLDADURA, ProcesoSiguiente="Soldadura"),
        FilaRuta(idComp=CP, OrdenRuta=20, idRuta=2, Ruta="Sold", idProceso=SOLDADURA,
                 Proceso="Soldadura", idProcesoSiguiente=PINTURA, ProcesoSiguiente="Pintura"),
        FilaRuta(idComp=CP, OrdenRuta=30, idRuta=3, Ruta="Pintura", idProceso=PINTURA,
                 Proceso="Pintura", idProcesoSiguiente=EMBARQUES, ProcesoSiguiente="Embarques"),
        FilaRuta(idComp=CP, OrdenRuta=40, idRuta=4, Ruta="Emb", idProceso=EMBARQUES,
                 Proceso="Embarques"),
        # Cb: Almacen WIP (armado) -> Soldadura
        FilaRuta(idComp=CB, OrdenRuta=10, idRuta=1, Ruta="Armado", idProceso=ALM_WIP_ID,
                 Proceso=ALM_WIP_NOMBRE, idProcesoSiguiente=SOLDADURA, ProcesoSiguiente="Soldadura"),
        FilaRuta(idComp=CB, OrdenRuta=20, idRuta=2, Ruta="Sold", idProceso=SOLDADURA,
                 Proceso="Soldadura"),
        # Ca: Corte -> Doblez
        FilaRuta(idComp=CA, OrdenRuta=10, idRuta=5, Ruta="Laser", idProceso=CORTE,
                 Proceso="Corte", idProcesoSiguiente=DOBLEZ, ProcesoSiguiente="Doblez"),
        FilaRuta(idComp=CA, OrdenRuta=20, idRuta=6, Ruta="Doblez", idProceso=DOBLEZ,
                 Proceso="Doblez"),
        # Cc: Corte -> Doblez
        FilaRuta(idComp=CC, OrdenRuta=10, idRuta=5, Ruta="Laser", idProceso=CORTE,
                 Proceso="Corte", idProcesoSiguiente=DOBLEZ, ProcesoSiguiente="Doblez"),
        FilaRuta(idComp=CC, OrdenRuta=20, idRuta=6, Ruta="Doblez", idProceso=DOBLEZ,
                 Proceso="Doblez"),
    ]


def _wip_caso_ejemplo() -> list[FilaWip]:
    return [
        # Cb tiene 1 pza armada esperando entrar al PT (idProcesoSiguiente=Soldadura del PT)
        # Pero su wip_total cuenta como inventario disponible del intermedio
        FilaWip(idComp=CB, idProcesoSiguiente=SOLDADURA, ProcesoSiguiente="Soldadura",
                Etiquetas=1, Piezas=1),
        # Ca tiene 2 pzs en Almacen WIP (terminaron Doblez, esperando armado por Cb)
        FilaWip(idComp=CA, idProcesoSiguiente=ALM_WIP_ID, ProcesoSiguiente=ALM_WIP_NOMBRE,
                Etiquetas=1, Piezas=2),
        # Cc tiene 1 pza en Almacen WIP
        FilaWip(idComp=CC, idProcesoSiguiente=ALM_WIP_ID, ProcesoSiguiente=ALM_WIP_NOMBRE,
                Etiquetas=1, Piezas=1),
    ]


def test_caso_canonico_req_neto():
    arbol = construir_arbol(
        demanda_filas=_demanda(req_pt=1),
        bom_filas=_bom(),
        ruta_filas=_rutas(),
        wip_filas=_wip_caso_ejemplo(),
        almacen_wip_id=ALM_WIP_ID,
        almacen_wip_nombre=ALM_WIP_NOMBRE,
    )
    nodos = {n.idComp: n for n in arbol.componentes}

    assert nodos[CP].req_bruto == 1
    assert nodos[CP].wip_total == 0
    assert nodos[CP].req_neto == 1

    assert nodos[CB].req_bruto == 2
    assert nodos[CB].wip_total == 1
    assert nodos[CB].req_neto == 1

    assert nodos[CA].req_bruto == 2  # req_neto[Cb]=1 * CantEnsamble=2
    assert nodos[CA].wip_total == 2
    assert nodos[CA].req_neto == 0

    assert nodos[CC].req_bruto == 2
    assert nodos[CC].wip_total == 1
    assert nodos[CC].req_neto == 1


def test_componente_compartido_suma_req_bruto():
    """Si un componente C aparece como hijo de DOS padres distintos en el arbol,
    su req_bruto debe sumar ambas contribuciones."""
    bom = [
        FilaBom(IdBom=1, IdBomParent=None, BomLevel=1, idComp=CP, Componente="Cp",
                IdPadre=None, idTipoMat=1, CantidadEnsamble=1, HijosTotales=2,
                bLastLevel=False),
        # Cb es hijo del PT con CantEns=1
        FilaBom(IdBom=2, IdBomParent=1, BomLevel=2, idComp=CB, Componente="Cb",
                IdPadre=CP, idTipoMat=3, CantidadEnsamble=1, HijosTotales=1,
                bLastLevel=False),
        # Ca es hijo del PT directamente con CantEns=3
        FilaBom(IdBom=3, IdBomParent=1, BomLevel=2, idComp=CA, Componente="Ca",
                IdPadre=CP, idTipoMat=3, CantidadEnsamble=3, HijosTotales=0,
                bLastLevel=True),
        # Ca tambien es hijo de Cb con CantEns=2
        FilaBom(IdBom=4, IdBomParent=2, BomLevel=3, idComp=CA, Componente="Ca",
                IdPadre=CB, idTipoMat=3, CantidadEnsamble=2, HijosTotales=0,
                bLastLevel=True),
    ]
    # Sin WIP - simplifica calculo
    wip: list[FilaWip] = []
    rutas = [r for r in _rutas() if r.idComp in (CP, CB, CA)]

    arbol = construir_arbol(
        demanda_filas=_demanda(req_pt=1),
        bom_filas=bom,
        ruta_filas=rutas,
        wip_filas=wip,
        almacen_wip_id=ALM_WIP_ID,
        almacen_wip_nombre=ALM_WIP_NOMBRE,
    )
    nodos = {n.idComp: n for n in arbol.componentes}

    # Cp: 1
    assert nodos[CP].req_neto == 1
    # Cb: 1*1 = 1
    assert nodos[CB].req_neto == 1
    # Ca aparece como hijo de Cp (CantEns=3) Y como hijo de Cb (CantEns=2)
    # req_bruto = req_neto[Cp]*3 + req_neto[Cb]*2 = 1*3 + 1*2 = 5
    assert nodos[CA].req_bruto == 5
    assert nodos[CA].req_neto == 5


def test_req_paso_ruta_inversa():
    """Formula validada contra diagrama del usuario:
        req_paso[i] = req_bruto - sum(WIP en pasos i, i+1, ..., final)
    El WIP en este paso ya completo pasos previos -> no se cuenta upstream.
    """
    arbol = construir_arbol(
        demanda_filas=_demanda(req_pt=1),
        bom_filas=_bom(),
        ruta_filas=_rutas(),
        wip_filas=_wip_caso_ejemplo(),
        almacen_wip_id=ALM_WIP_ID,
        almacen_wip_nombre=ALM_WIP_NOMBRE,
    )
    nodos = {n.idComp: n for n in arbol.componentes}

    # Ca: req_bruto=2, ruta = Corte -> Doblez -> Almacen WIP (virtual)
    # WIP de Ca: 2 en Almacen WIP (idProcesoSiguiente=16)
    ca_ruta = nodos[CA].ruta
    assert len(ca_ruta) == 3
    # Inverso: Almacen WIP: acum=2, req=max(0, 2-2)=0
    #          Doblez:      acum=2, req=max(0, 2-2)=0
    #          Corte:       acum=2, req=max(0, 2-2)=0
    assert ca_ruta[2].es_virtual is True
    assert ca_ruta[2].req_paso == 0
    assert ca_ruta[2].wip_en_paso == 2
    assert ca_ruta[1].req_paso == 0
    assert ca_ruta[0].req_paso == 0


def test_req_paso_caso_diagrama_usuario():
    """Replica el caso real del diagrama Excalidraw del usuario.

    PT 91711066-RA con demanda 222.
    Componente 90358715-RA: 4 pzs en Doblez. Ruta Corte -> Doblez.
        - buffer Almacen WIP (virtual): req = 222 (0 wip)
        - Doblez: req = 222 - 4 = 218
        - Corte:  req = 222 - 4 = 218

    Componente 91711040-RA: 9 pzs en Almacen WIP buffer. Ruta Corte -> Nivelado -> Doblez.
        - buffer: req = 222 - 9 = 213
        - Doblez: req = 222 - 9 = 213
        - Nivelado: req = 222 - 9 = 213
        - Corte:    req = 222 - 9 = 213
    """
    # IDs sinteticos siguiendo el diagrama
    PT_ID, C1_ID, C2_ID = 911, 901, 902
    DOBLEZ_P, CORTE_P, NIVELADO_P, SOLD_P, PINT_P, EMB_P = 4, 3, 18, 6, 7, 13

    demanda = [{
        "idMaterial": PT_ID, "PT": "91711066-RA", "Descripcion": "PT",
        "idCliente": 1, "Cliente": "Test",
        "idCiudad": 1, "Ciudad": "Test City",
        "PiezasPend": 222, "FechaPromMin": date(2026, 5, 25),
        "FechaPromMax": date(2026, 5, 25), "PiezasPastDue": 0,
    }]
    bom = [
        FilaBom(IdBom=1, IdBomParent=None, BomLevel=1, idComp=PT_ID,
                Componente="91711066-RA", IdPadre=None, idTipoMat=1,
                CantidadEnsamble=1, HijosTotales=2, bLastLevel=False),
        FilaBom(IdBom=2, IdBomParent=1, BomLevel=2, idComp=C1_ID,
                Componente="90358715-RA", IdPadre=PT_ID, idTipoMat=3,
                CantidadEnsamble=1, HijosTotales=0, bLastLevel=True),
        FilaBom(IdBom=3, IdBomParent=1, BomLevel=2, idComp=C2_ID,
                Componente="91711040-RA", IdPadre=PT_ID, idTipoMat=3,
                CantidadEnsamble=1, HijosTotales=0, bLastLevel=True),
    ]
    rutas = [
        # PT: Soldadura -> Pintura -> Embarques (sin Almacen WIP virtual)
        FilaRuta(idComp=PT_ID, OrdenRuta=10, idRuta=1, Ruta="Sold", idProceso=SOLD_P,
                 Proceso="Soldadura", idProcesoSiguiente=PINT_P, ProcesoSiguiente="Pintura"),
        FilaRuta(idComp=PT_ID, OrdenRuta=20, idRuta=2, Ruta="Pint", idProceso=PINT_P,
                 Proceso="Pintura", idProcesoSiguiente=EMB_P, ProcesoSiguiente="Embarques"),
        FilaRuta(idComp=PT_ID, OrdenRuta=30, idRuta=3, Ruta="Emb", idProceso=EMB_P,
                 Proceso="Embarques"),
        # Componente 1: Corte -> Doblez
        FilaRuta(idComp=C1_ID, OrdenRuta=10, idRuta=4, Ruta="Laser", idProceso=CORTE_P,
                 Proceso="Corte laser", idProcesoSiguiente=DOBLEZ_P, ProcesoSiguiente="Doblez"),
        FilaRuta(idComp=C1_ID, OrdenRuta=20, idRuta=5, Ruta="Doblez", idProceso=DOBLEZ_P,
                 Proceso="Doblez"),
        # Componente 2: Corte -> Nivelado -> Doblez
        FilaRuta(idComp=C2_ID, OrdenRuta=10, idRuta=4, Ruta="Laser", idProceso=CORTE_P,
                 Proceso="Corte laser", idProcesoSiguiente=NIVELADO_P, ProcesoSiguiente="Nivelado"),
        FilaRuta(idComp=C2_ID, OrdenRuta=20, idRuta=6, Ruta="Niv", idProceso=NIVELADO_P,
                 Proceso="Nivelado", idProcesoSiguiente=DOBLEZ_P, ProcesoSiguiente="Doblez"),
        FilaRuta(idComp=C2_ID, OrdenRuta=30, idRuta=5, Ruta="Doblez", idProceso=DOBLEZ_P,
                 Proceso="Doblez"),
    ]
    wip = [
        # 4 pzs de 90358715-RA esperando Doblez
        FilaWip(idComp=C1_ID, idProcesoSiguiente=DOBLEZ_P, ProcesoSiguiente="Doblez",
                Etiquetas=1, Piezas=4),
        # 9 pzs de 91711040-RA en Almacen WIP (terminaron Doblez)
        FilaWip(idComp=C2_ID, idProcesoSiguiente=ALM_WIP_ID, ProcesoSiguiente="Almacen WIP",
                Etiquetas=1, Piezas=9),
    ]

    arbol = construir_arbol(
        demanda_filas=demanda, bom_filas=bom, ruta_filas=rutas, wip_filas=wip,
        almacen_wip_id=ALM_WIP_ID, almacen_wip_nombre=ALM_WIP_NOMBRE,
    )
    nodos = {n.idComp: n for n in arbol.componentes}

    # Componente 90358715-RA
    c1 = nodos[C1_ID]
    assert c1.req_bruto == 222
    assert c1.wip_total == 4
    # ruta tras netteo: Corte, Doblez, Almacen WIP virtual
    pasos_c1 = c1.ruta
    assert len(pasos_c1) == 3
    assert pasos_c1[0].proceso == "Corte laser" and pasos_c1[0].req_paso == 218
    assert pasos_c1[1].proceso == "Doblez"      and pasos_c1[1].req_paso == 218
    assert pasos_c1[2].es_virtual               and pasos_c1[2].req_paso == 222

    # Componente 91711040-RA
    c2 = nodos[C2_ID]
    assert c2.req_bruto == 222
    assert c2.wip_total == 9
    pasos_c2 = c2.ruta
    assert len(pasos_c2) == 4
    assert pasos_c2[0].proceso == "Corte laser" and pasos_c2[0].req_paso == 213
    assert pasos_c2[1].proceso == "Nivelado"    and pasos_c2[1].req_paso == 213
    assert pasos_c2[2].proceso == "Doblez"      and pasos_c2[2].req_paso == 213
    assert pasos_c2[3].es_virtual               and pasos_c2[3].req_paso == 213


def test_pt_no_tiene_nodo_virtual():
    """El PT raiz NO debe tener Almacen WIP virtual al final — termina en Embarques."""
    arbol = construir_arbol(
        demanda_filas=_demanda(req_pt=1),
        bom_filas=_bom(),
        ruta_filas=_rutas(),
        wip_filas=_wip_caso_ejemplo(),
        almacen_wip_id=ALM_WIP_ID,
        almacen_wip_nombre=ALM_WIP_NOMBRE,
    )
    nodos = {n.idComp: n for n in arbol.componentes}
    pasos_pt = nodos[CP].ruta
    assert all(not p.es_virtual for p in pasos_pt), \
        "El PT no debe agregar nodo virtual Almacen WIP"


def test_falla_sin_demanda():
    with pytest.raises(ValueError, match="Sin filas de demanda"):
        construir_arbol(
            demanda_filas=[], bom_filas=_bom(), ruta_filas=_rutas(),
            wip_filas=[], almacen_wip_id=ALM_WIP_ID, almacen_wip_nombre=ALM_WIP_NOMBRE,
        )


def test_agrupacion_pasos_por_idProceso():
    """Si la ruta tiene varios sub-pasos con el mismo idProceso (caso real:
    Soldadura Robot + Soldadura Limpieza, ambos idProceso=6), debe quedar UN
    solo PasoRuta con ambas rutas concatenadas. El WIP no se cuenta dos veces.
    """
    PT_ID = 700
    SOLD_P = 6
    PINT_P = 7
    EMB_P = 13

    demanda = [{
        "idMaterial": PT_ID, "PT": "PT-X", "Descripcion": "Test",
        "idCliente": 1, "Cliente": "C", "idCiudad": 1, "Ciudad": "City",
        "PiezasPend": 100, "FechaPromMin": date(2026, 5, 25),
        "FechaPromMax": date(2026, 5, 25), "PiezasPastDue": 0,
    }]
    bom = [
        FilaBom(IdBom=1, IdBomParent=None, BomLevel=1, idComp=PT_ID,
                Componente="PT-X", IdPadre=None, idTipoMat=1,
                CantidadEnsamble=1, HijosTotales=0, bLastLevel=True),
    ]
    # 3 sub-pasos de Soldadura (idProceso=6) con distintas rutas
    rutas = [
        FilaRuta(idComp=PT_ID, OrdenRuta=10, idRuta=28, Ruta="Soldadura Solida Robot",
                 idProceso=SOLD_P, Proceso="Soldadura"),
        FilaRuta(idComp=PT_ID, OrdenRuta=20, idRuta=29, Ruta="Limpieza",
                 idProceso=SOLD_P, Proceso="Soldadura"),
        FilaRuta(idComp=PT_ID, OrdenRuta=30, idRuta=56, Ruta="Soldadura Manual",
                 idProceso=SOLD_P, Proceso="Soldadura"),
        FilaRuta(idComp=PT_ID, OrdenRuta=40, idRuta=34, Ruta="Pintura",
                 idProceso=PINT_P, Proceso="Pintura"),
        FilaRuta(idComp=PT_ID, OrdenRuta=50, idRuta=101, Ruta="Embarques",
                 idProceso=EMB_P, Proceso="Embarques"),
    ]
    # WIP: 30 piezas yendo a Soldadura, 20 a Pintura
    wip = [
        FilaWip(idComp=PT_ID, idProcesoSiguiente=SOLD_P, ProcesoSiguiente="Soldadura",
                Etiquetas=3, Piezas=30),
        FilaWip(idComp=PT_ID, idProcesoSiguiente=PINT_P, ProcesoSiguiente="Pintura",
                Etiquetas=2, Piezas=20),
    ]

    arbol = construir_arbol(
        demanda_filas=demanda, bom_filas=bom, ruta_filas=rutas, wip_filas=wip,
        almacen_wip_id=ALM_WIP_ID, almacen_wip_nombre=ALM_WIP_NOMBRE,
    )
    pt = next(n for n in arbol.componentes if n.idComp == PT_ID)

    # 3 pasos: Soldadura (agrupada), Pintura, Embarques (PT no tiene virtual al final)
    assert len(pt.ruta) == 3
    assert pt.ruta[0].proceso == "Soldadura"
    assert pt.ruta[1].proceso == "Pintura"
    assert pt.ruta[2].proceso == "Embarques"

    # El campo ruta del grupo Soldadura debe listar las 3 sub-rutas
    assert "Robot" in pt.ruta[0].ruta and "Limpieza" in pt.ruta[0].ruta and "Manual" in pt.ruta[0].ruta

    # Math con grupos:
    # acum_downstream (reverse):
    #   Embarques:  acum=0,  req=100
    #   Pintura:    acum=20, req=80
    #   Soldadura:  acum=50, req=50      <- WIP de Soldadura se cuenta UNA vez (no 3)
    assert pt.ruta[2].req_paso == 100
    assert pt.ruta[1].req_paso == 80
    assert pt.ruta[0].req_paso == 50


def test_advertencia_wip_fuera_ruta():
    """WIP en proceso no listado en catalogo -> advertencia."""
    wip_extra = _wip_caso_ejemplo() + [
        FilaWip(idComp=CA, idProcesoSiguiente=99, ProcesoSiguiente="Proceso Raro",
                Etiquetas=1, Piezas=5),
    ]
    arbol = construir_arbol(
        demanda_filas=_demanda(req_pt=1),
        bom_filas=_bom(),
        ruta_filas=_rutas(),
        wip_filas=wip_extra,
        almacen_wip_id=ALM_WIP_ID,
        almacen_wip_nombre=ALM_WIP_NOMBRE,
    )
    assert any("Ca" in w and "99" in w for w in arbol.advertencias)
