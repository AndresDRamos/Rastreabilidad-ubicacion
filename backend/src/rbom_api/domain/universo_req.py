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

Relacion con el arbol de un PT — [2026-08-03] YA CUADRAN
--------------------------------------------------------
Hasta 2026-08-03 el arbol de un PT se atribuia el 100% del WIP fisico y este
modulo repartia; los dos numeros convivian sin cuadrar y la UI lo advertia en la
leyenda. **Eso cambio**: `repartir_wip_fifo` asigna a cada PT la porcion de WIP
que le toca, y el arbol nettea contra esa porcion. La suma de los arboles
coincide ahora con el netteo agregado del universo (verificado: el componente
compartido por 10 PT da 33,244 por ambas vias).

El reparto es **FIFO por urgencia**, la misma regla del CLR de cobertura y del
activo `plan-capacidad` de ezi-data-core: los PT se sirven del inventario
compartido en orden de promesa mas antigua primero, sin prorratear. En el ejemplo
de arriba, si PT-A es el mas urgente se lleva las 50 piezas y PT-B se queda con
su requerimiento intacto — no se parten 25 y 25.

Granularidad: el FIFO se resuelve por **PT**, no por linea de demanda (el CLR va
linea a linea). Es la traduccion natural aqui, porque la unidad que el usuario
abre es el arbol de un PT; dentro de un PT sus lineas comparten el mismo lote
asignado.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from .modelo import FilaAristaUniverso, FilaDemandaUniverso, FilaWipUniverso, ReqUniverso

# Un PT sin fecha de promesa va al final de la cola FIFO: si no sabemos que tan
# urgente es, no puede quitarle inventario a uno que si tiene fecha vencida.
_SIN_FECHA = date(2099, 12, 31)


def repartir_wip_fifo(
    demanda_filas: list[FilaDemandaUniverso],
    arista_filas: list[FilaAristaUniverso],
    wip_filas: list[FilaWipUniverso],
) -> dict[tuple[int, int], float]:
    """Reparte el WIP fisico entre los PT que lo reclaman, FIFO por urgencia.

    Replica la regla del CLR de cobertura (y del activo `plan-capacidad`): el
    inventario es un recurso COMPARTIDO y se sirve a la demanda mas vencida
    primero, sin prorratear. Lo que un PT toma deja de estar disponible para los
    siguientes.

    Returns:
        (idPT, idComp) -> piezas de WIP asignadas a ese PT. Las combinaciones sin
        entrada tienen 0: ese PT no alcanzo inventario de ese componente.
    """
    demanda: dict[int, float] = {}
    urgencia: dict[int, date] = {}
    for fd in demanda_filas:
        demanda[fd.idMaterial] = demanda.get(fd.idMaterial, 0.0) + fd.PiezasPend
        f = fd.FechaPromMin or _SIN_FECHA
        # Si el PT llega en varias filas, manda la promesa mas antigua.
        if fd.idMaterial not in urgencia or f < urgencia[fd.idMaterial]:
            urgencia[fd.idMaterial] = f

    pool: dict[int, float] = {}
    for fw in wip_filas:
        pool[fw.idComp] = pool.get(fw.idComp, 0.0) + fw.Piezas

    hijos_de: dict[int, list[tuple[int, float]]] = defaultdict(list)
    padres_de: dict[int, set[int]] = defaultdict(set)
    nodos: set[int] = set(demanda)
    for fa in arista_filas:
        hijos_de[fa.idPadre].append((fa.idComp, fa.CantidadEnsamble))
        padres_de[fa.idComp].add(fa.idPadre)
        nodos.add(fa.idComp)
        nodos.add(fa.idPadre)

    # Orden topologico GLOBAL, calculado una sola vez. Se reusa para todos los PT:
    # dentro del sub-arbol de cualquier PT sigue garantizando padres antes que
    # hijos, que es lo que necesita la propagacion.
    in_degree = {n: len(padres_de.get(n, set())) for n in nodos}
    listos = [n for n in nodos if in_degree[n] == 0]
    pos: dict[int, int] = {}
    orden: list[int] = []
    while listos:
        nodo = listos.pop()
        pos[nodo] = len(orden)
        orden.append(nodo)
        for hijo, _ in hijos_de.get(nodo, []):
            in_degree[hijo] -= 1
            if in_degree[hijo] == 0:
                listos.append(hijo)
    # Los nodos en ciclo (dato sucio) van al final; no deben tumbar el reparto.
    for n in nodos:
        pos.setdefault(n, len(orden) + 1)

    asignado: dict[tuple[int, int], float] = {}

    for pt in sorted(demanda, key=lambda p: (urgencia.get(p, _SIN_FECHA), p)):
        # Requerimiento propagado dentro del sub-arbol de ESTE PT. Se recorre en
        # orden topologico para que un componente compartido acumule TODAS las
        # contribuciones de sus padres antes de consumir inventario (misma regla
        # del componente compartido de netteo.py, trampa #7).
        req: dict[int, float] = {pt: demanda[pt]}
        pendientes: list[int] = [pt]
        vistos: set[int] = {pt}
        # Descubrir el sub-arbol alcanzable desde el PT.
        i = 0
        while i < len(pendientes):
            actual = pendientes[i]
            i += 1
            for hijo, _cant in hijos_de.get(actual, []):
                if hijo not in vistos:
                    vistos.add(hijo)
                    pendientes.append(hijo)

        for comp in sorted(vistos, key=lambda c: pos.get(c, 0)):
            bruto = req.get(comp, 0.0)
            if bruto <= 0:
                continue
            disponible = pool.get(comp, 0.0)
            toma = min(disponible, bruto)
            if toma > 0:
                pool[comp] = disponible - toma
                asignado[(pt, comp)] = asignado.get((pt, comp), 0.0) + toma
            neto = bruto - toma
            if neto > 0:
                for hijo, cant in hijos_de.get(comp, []):
                    req[hijo] = req.get(hijo, 0.0) + neto * cant

    return asignado


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
