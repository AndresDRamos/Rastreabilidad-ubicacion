"""Tests del netteo CROSS-PT (bosque completo).

El contrato que fijan estos tests: el WIP fisico de un componente se descuenta
UNA sola vez aunque varios PTs lo reclamen. Correr el netteo por PT y sumar
produce numeros incorrectos — ese es justamente el bug que este modulo existe
para evitar.
"""

from __future__ import annotations

from rbom_api.domain.modelo import (
    FilaAristaUniverso,
    FilaDemandaUniverso,
    FilaWipUniverso,
)
from rbom_api.domain.universo_req import construir_universo


# ids sinteticos
PT_A, PT_B, COMP_X, COMP_Y = 1, 2, 300, 400


def _dem(pares: list[tuple[int, str, float]]) -> list[FilaDemandaUniverso]:
    return [
        FilaDemandaUniverso(idMaterial=i, PT=clave, PiezasPend=pzs)
        for i, clave, pzs in pares
    ]


def test_wip_compartido_se_descuenta_una_sola_vez():
    """El caso que motiva todo el modulo.

    X lo demandan PT-A (60) y PT-B (40) = 100. Hay 50 piezas fisicas de X.

    Netteo por PT y suma (INCORRECTO):
        PT-A -> max(0, 60-50) = 10
        PT-B -> max(0, 40-50) = 0
        suma = 10
    Netteo global (correcto):
        max(0, 100-50) = 50
    """
    universo = construir_universo(
        demanda_filas=_dem([(PT_A, "PT-A", 60), (PT_B, "PT-B", 40)]),
        arista_filas=[
            FilaAristaUniverso(idPadre=PT_A, idComp=COMP_X, CantidadEnsamble=1),
            FilaAristaUniverso(idPadre=PT_B, idComp=COMP_X, CantidadEnsamble=1),
        ],
        wip_filas=[FilaWipUniverso(idComp=COMP_X, Piezas=50)],
        pts_por_comp={COMP_X: [PT_A, PT_B]},
    )

    x = universo[COMP_X]
    assert x.req_bruto_total == 100, "req_bruto debe sumar ambos PTs"
    assert x.req_neto_total == 50, "el WIP se descuenta UNA vez, no una por PT"
    assert x.wip_total == 50
    assert x.n_pts == 2
    assert x.pts == ["PT-A", "PT-B"]


def test_cantidad_ensamble_multiplica_por_padre():
    """req_bruto[X] = Σ req_neto[padre] * CantidadEnsamble de esa arista."""
    universo = construir_universo(
        demanda_filas=_dem([(PT_A, "PT-A", 10), (PT_B, "PT-B", 5)]),
        arista_filas=[
            FilaAristaUniverso(idPadre=PT_A, idComp=COMP_X, CantidadEnsamble=3),
            FilaAristaUniverso(idPadre=PT_B, idComp=COMP_X, CantidadEnsamble=2),
        ],
        wip_filas=[],
        pts_por_comp={COMP_X: [PT_A, PT_B]},
    )
    # 10*3 + 5*2 = 40
    assert universo[COMP_X].req_bruto_total == 40
    assert universo[COMP_X].req_neto_total == 40


def test_cascada_multinivel_propaga_req_neto():
    """El WIP de un intermedio reduce lo que piden sus hijos (efecto cascada)."""
    universo = construir_universo(
        demanda_filas=_dem([(PT_A, "PT-A", 100)]),
        arista_filas=[
            FilaAristaUniverso(idPadre=PT_A, idComp=COMP_Y, CantidadEnsamble=1),
            FilaAristaUniverso(idPadre=COMP_Y, idComp=COMP_X, CantidadEnsamble=2),
        ],
        wip_filas=[FilaWipUniverso(idComp=COMP_Y, Piezas=30)],
        pts_por_comp={COMP_Y: [PT_A], COMP_X: [PT_A]},
    )
    # Y: bruto 100, wip 30 -> neto 70
    assert universo[COMP_Y].req_neto_total == 70
    # X: bruto = neto(Y) * 2 = 140  (no 200: el WIP de Y ya cubrio 30 juegos)
    assert universo[COMP_X].req_bruto_total == 140


def test_pt_que_es_componente_de_otro_pt_suma_demanda_propia():
    """Un PT con demanda propia puede colgar de otro PT. Debe sumar ambas."""
    universo = construir_universo(
        demanda_filas=_dem([(PT_A, "PT-A", 10), (PT_B, "PT-B", 7)]),
        # PT_B es hijo de PT_A ademas de tener demanda propia
        arista_filas=[
            FilaAristaUniverso(idPadre=PT_A, idComp=PT_B, CantidadEnsamble=1),
        ],
        wip_filas=[],
        pts_por_comp={PT_B: [PT_A]},
    )
    # PT_B: demanda propia 7 + lo que pide PT_A (10*1) = 17
    assert universo[PT_B].req_bruto_total == 17


def test_wip_mayor_que_demanda_no_produce_negativos():
    universo = construir_universo(
        demanda_filas=_dem([(PT_A, "PT-A", 10)]),
        arista_filas=[
            FilaAristaUniverso(idPadre=PT_A, idComp=COMP_X, CantidadEnsamble=1),
        ],
        wip_filas=[FilaWipUniverso(idComp=COMP_X, Piezas=999)],
        pts_por_comp={COMP_X: [PT_A]},
    )
    assert universo[COMP_X].req_neto_total == 0


def test_ciclo_no_tumba_el_universo():
    """Un BOM ciclico es dato sucio: se marca y se sigue, no se lanza excepcion.

    A diferencia de netteo.construir_arbol (que si lanza ValueError), aqui el
    scope es todo el universo — un ciclo en un rincon no puede dejar sin leyenda
    a los otros 6,000 componentes.
    """
    universo = construir_universo(
        demanda_filas=_dem([(PT_A, "PT-A", 10)]),
        arista_filas=[
            FilaAristaUniverso(idPadre=PT_A, idComp=COMP_X, CantidadEnsamble=1),
            # ciclo: X -> Y -> X
            FilaAristaUniverso(idPadre=COMP_X, idComp=COMP_Y, CantidadEnsamble=1),
            FilaAristaUniverso(idPadre=COMP_Y, idComp=COMP_X, CantidadEnsamble=1),
        ],
        wip_filas=[],
        pts_por_comp={},
    )
    # El PT sano se calcula igual
    assert universo[PT_A].req_bruto_total == 10
    assert universo[PT_A].ciclico is False
    # Los del ciclo se marcan
    assert universo[COMP_X].ciclico is True
    assert universo[COMP_Y].ciclico is True


def test_componente_sin_padres_ni_demanda_queda_en_cero():
    universo = construir_universo(
        demanda_filas=_dem([(PT_A, "PT-A", 10)]),
        arista_filas=[
            FilaAristaUniverso(idPadre=PT_A, idComp=COMP_X, CantidadEnsamble=1),
        ],
        wip_filas=[FilaWipUniverso(idComp=COMP_X, Piezas=2)],
        pts_por_comp={COMP_X: [PT_A]},
    )
    assert universo[PT_A].req_bruto_total == 10
    assert universo[COMP_X].req_neto_total == 8


def test_un_solo_pt_coincide_con_el_netteo_del_arbol():
    """Con un unico PT, el netteo global debe dar lo mismo que el del arbol.

    Es la garantia de que el modulo generaliza netteo.py sin contradecirlo: la
    divergencia entre ambos aparece SOLO cuando hay componentes compartidos.
    """
    universo = construir_universo(
        demanda_filas=_dem([(PT_A, "PT-A", 222)]),
        arista_filas=[
            FilaAristaUniverso(idPadre=PT_A, idComp=COMP_X, CantidadEnsamble=1),
        ],
        wip_filas=[FilaWipUniverso(idComp=COMP_X, Piezas=4)],
        pts_por_comp={COMP_X: [PT_A]},
    )
    # Espeja test_req_paso_caso_diagrama_usuario: req_bruto 222, wip 4
    assert universo[COMP_X].req_bruto_total == 222
    assert universo[COMP_X].req_neto_total == 218
