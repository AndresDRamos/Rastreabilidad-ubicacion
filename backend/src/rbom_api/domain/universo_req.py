"""Netteo CROSS-PT: requerimiento de cada componente sobre TODO el universo.

`netteo.construir_arbol` nettea **un** PT. Este modulo nettea el **bosque
completo** (todos los PTs con demanda activa a la vez) para responder "¿cuanto
se requiere realmente de este componente sumando todos sus padres, en todos los
PTs?".

Por que no basta con correr `construir_arbol` por PT y sumar
--------------------------------------------------------------
Cada llamada a `construir_arbol` asume que tiene acceso **exclusivo** a todo el
WIP del componente. Al sumar N netteos independientes, el mismo WIP fisico se
descuenta una vez por cada PT que reclama el componente:

    Componente X: demanda 60 (PT-A) + 40 (PT-B) = 100. WIP fisico = 50.
      netteo por PT:  PT-A -> max(0, 60-50) = 10
                      PT-B -> max(0, 40-50) = 0
                      suma = 10                        <-- INCORRECTO
      netteo global:  max(0, 100-50) = 50              <-- correcto

El error escala con el reparto de la demanda y afecta justo a los componentes de
mas rotacion (medido: 576 de 6,113 componentes viven bajo mas de un PT; el peor
caso aparece bajo 27 PTs distintos).

La solucion es tratar el universo como **un solo grafo con multiples raices**:
un unico orden topologico global donde `req_bruto` acumula la contribucion de
todos los padres (vengan del PT que vengan) y `wip_total` se descuenta **una
sola vez** por componente. Es la misma regla del componente compartido que
`netteo.py` ya aplica dentro de un arbol (trampa #7 del contrato), elevada al
bosque.

Relacion con el arbol de un PT
------------------------------
Los dos numeros conviven y **no cuadran entre si**, a proposito:

- El arbol de un PT muestra el requerimiento *de ese PT*, atribuyendose el 100%
  del WIP fisico del componente (comportamiento historico, no se toca).
- Este modulo muestra el requerimiento *del universo*, repartiendo ese WIP entre
  todos los que lo reclaman.

En el ejemplo de arriba el nodo diria 10 en grande (arbol abierto) y 50 en la
leyenda (universo). Por eso la UI debe advertir que el WIP mostrado tambien lo
reclaman otros PTs.
"""

from __future__ import annotations

from collections import defaultdict

from .modelo import FilaAristaUniverso, FilaDemandaUniverso, FilaWipUniverso, ReqUniverso


def construir_universo(
    demanda_filas: list[FilaDemandaUniverso],
    arista_filas: list[FilaAristaUniverso],
    wip_filas: list[FilaWipUniverso],
    pts_por_comp: dict[int, list[int]],
) -> dict[int, ReqUniverso]:
    """Nettea el bosque completo y devuelve el requerimiento por componente.

    Args:
        demanda_filas: una fila por PT raiz con demanda activa.
        arista_filas: grafo padre->hijo YA deduplicado a nivel universo (ver
            Q_universo_req.sql: la misma relacion se repite en cada arbol donde
            vive, sumarla multiplicaria el requerimiento).
        wip_filas: piezas por componente (bucket "por procesar").
        pts_por_comp: idComp -> lista de idPT que lo demandan.

    Returns:
        idComp -> ReqUniverso. Incluye tambien a los PT raiz.
    """
    # ---- Indices -------------------------------------------------------------
    demanda: dict[int, float] = {}
    clave_pt: dict[int, str] = {}
    for fd in demanda_filas:
        demanda[fd.idMaterial] = demanda.get(fd.idMaterial, 0.0) + fd.PiezasPend
        clave_pt[fd.idMaterial] = fd.PT

    wip: dict[int, float] = {}
    for fw in wip_filas:
        wip[fw.idComp] = wip.get(fw.idComp, 0.0) + fw.Piezas

    padres_de: dict[int, list[tuple[int, float]]] = defaultdict(list)
    hijos_de: dict[int, set[int]] = defaultdict(set)
    nodos: set[int] = set(demanda)
    for fa in arista_filas:
        padres_de[fa.idComp].append((fa.idPadre, fa.CantidadEnsamble))
        hijos_de[fa.idPadre].add(fa.idComp)
        nodos.add(fa.idComp)
        nodos.add(fa.idPadre)

    # ---- Orden topologico global (Kahn multi-raiz) ---------------------------
    # A diferencia de netteo.py, aqui NO hay una raiz unica: las raices son todos
    # los nodos sin padres. Un PT con demanda puede ademas colgar de otro PT, en
    # cuyo caso no es raiz topologica pero si aporta su demanda propia.
    in_degree: dict[int, int] = {
        n: len({p for p, _ in padres_de.get(n, [])}) for n in nodos
    }
    listos = [n for n in nodos if in_degree[n] == 0]
    orden: list[int] = []
    while listos:
        nodo = listos.pop()
        orden.append(nodo)
        for hijo in hijos_de.get(nodo, set()):
            in_degree[hijo] -= 1
            if in_degree[hijo] == 0:
                listos.append(hijo)

    # Nodos en ciclo: no se pueden ordenar. En vez de tumbar el universo entero
    # (netteo.py si lanza ValueError, pero ahi el scope es un arbol y el usuario
    # puede ver el error), se procesan al final con su demanda propia. Un BOM
    # ciclico es dato sucio, no debe dejar sin leyenda al resto del universo.
    ciclicos = [n for n in nodos if n not in set(orden)]
    orden.extend(ciclicos)

    # ---- Pasada unica: req_bruto acumulado + WIP descontado UNA vez ----------
    req_bruto: dict[int, float] = {}
    req_neto: dict[int, float] = {}
    for idComp in orden:
        # Demanda propia (si es PT raiz) + lo que piden todos sus padres.
        bruto = demanda.get(idComp, 0.0)
        for padre, cant in padres_de.get(idComp, []):
            bruto += req_neto.get(padre, 0.0) * cant
        req_bruto[idComp] = bruto
        req_neto[idComp] = max(0.0, bruto - wip.get(idComp, 0.0))

    # ---- Salida --------------------------------------------------------------
    salida: dict[int, ReqUniverso] = {}
    for idComp in nodos:
        pts = pts_por_comp.get(idComp, [])
        claves = sorted(clave_pt[p] for p in pts if p in clave_pt)
        salida[idComp] = ReqUniverso(
            req_bruto_total=req_bruto.get(idComp, 0.0),
            req_neto_total=req_neto.get(idComp, 0.0),
            wip_total=wip.get(idComp, 0.0),
            n_pts=len(claves),
            pts=claves[:20],  # tope defensivo: la leyenda no lista mas de 20
            ciclico=idComp in set(ciclicos),
        )
    return salida
