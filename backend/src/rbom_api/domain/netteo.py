"""Algoritmo de netteo del arbol BOM.

Dos pasadas:

1. **Top-down por orden topologico** (raiz -> hojas): para cada componente C,
   ``req_bruto[C] = sum( req_neto[padre] * CantidadEnsamble )`` sobre TODAS sus
   apariciones bajo distintos padres. Luego
   ``req_neto[C] = max(0, req_bruto[C] - wip_total[C])``.

2. **Ruta inversa por componente** (ultimo paso -> primer paso): el req del
   ultimo paso debe entregar ``req_neto``. Cada paso anterior descuenta el WIP
   que YA esta posicionado downstream. Para intermedios (no PT raiz) se agrega
   un nodo virtual `Almacen WIP` al final, donde el componente espera consumo
   por el padre.

El WIP de un componente es **uno solo** aunque el componente aparezca en
multiples padres (componentes shared).
"""

from __future__ import annotations

from collections import defaultdict

from .modelo import (
    ArbolPT,
    AristaPadre,
    DemandaPT,
    FilaBom,
    FilaRuta,
    FilaWip,
    NodoComponente,
    PasoRuta,
)


def _fmt(x: float) -> str:
    """Formato compacto: enteros sin decimales, fracciones con 2."""
    if abs(x - round(x)) < 1e-6:
        return str(int(round(x)))
    return f"{x:.2f}"


def construir_arbol(
    demanda_filas: list[dict],
    bom_filas: list[FilaBom],
    ruta_filas: list[FilaRuta],
    wip_filas: list[FilaWip],
    almacen_wip_id: int,
    almacen_wip_nombre: str,
) -> ArbolPT:
    """Arma el arbol netteado de un PT a partir de los 4 result-sets crudos."""

    if not demanda_filas:
        raise ValueError("Sin filas de demanda — el PT no tiene demanda activa en la ventana.")
    if not bom_filas:
        raise ValueError("Sin filas de BOM — el PT no existe en tblBomExplosionado.")

    # ---- Demanda total del PT (suma sobre todos los clientes) ----------------
    req_pt_total = sum(float(d["PiezasPend"]) for d in demanda_filas)

    primer = demanda_filas[0]
    if len(demanda_filas) == 1:
        pt_obj = DemandaPT(**primer)
    else:
        clientes = sorted({d["Cliente"] for d in demanda_filas})
        ciudades = sorted({d.get("Ciudad", "") for d in demanda_filas})
        pt_obj = DemandaPT(
            idMaterial=primer["idMaterial"],
            PT=primer["PT"],
            Descripcion=primer["Descripcion"],
            idCliente=None,
            Cliente=", ".join(clientes) if len(clientes) <= 3 else f"{len(clientes)} clientes",
            idCiudad=None,
            Ciudad=", ".join(ciudades) if len(ciudades) <= 3 else f"{len(ciudades)} ciudades",
            PiezasPend=req_pt_total,
            FechaPromMin=min(d["FechaPromMin"] for d in demanda_filas),
            FechaPromMax=max(d["FechaPromMax"] for d in demanda_filas),
            PiezasPastDue=sum(float(d["PiezasPastDue"]) for d in demanda_filas),
        )

    # ---- Indices del BOM -----------------------------------------------------
    pt_root_id: int | None = None
    info_comp: dict[int, FilaBom] = {}
    cantidad_ensamble_total: dict[int, float] = defaultdict(float)
    padres_de: dict[int, list[tuple[int, float]]] = defaultdict(list)
    hijos_de: dict[int, set[int]] = defaultdict(set)

    for fb in bom_filas:
        if fb.IdPadre is None and fb.IdBomParent is None:
            pt_root_id = fb.idComp
        if fb.idComp not in info_comp:
            info_comp[fb.idComp] = fb
        else:
            # Si la aparicion actual tiene info de ruta y la guardada no, actualizar
            guardada = info_comp[fb.idComp]
            if fb.PrimerIdProceso is not None and guardada.PrimerIdProceso is None:
                info_comp[fb.idComp] = fb
        cantidad_ensamble_total[fb.idComp] += fb.CantidadEnsamble
        if fb.IdPadre is not None:
            padres_de[fb.idComp].append((fb.IdPadre, fb.CantidadEnsamble))
            hijos_de[fb.IdPadre].add(fb.idComp)

    if pt_root_id is None:
        raise ValueError("No se encontro el PT raiz en tblBomExplosionado (IdPadre=NULL).")

    # ---- WIP por componente y por (componente, proceso) ---------------------
    # Solo el bucket "Por procesar" (Piezas/Etiquetas) alimenta el netteo.
    # Liberadas / Inspección son solo display y no descuentan demanda.
    wip_total: dict[int, float] = defaultdict(float)
    wip_por_paso: dict[tuple[int, int | None], float] = defaultdict(float)
    etiquetas_por_paso: dict[tuple[int, int | None], int] = defaultdict(int)
    liberadas_por_paso: dict[tuple[int, int | None], float] = defaultdict(float)
    etiquetas_liberadas_por_paso: dict[tuple[int, int | None], int] = defaultdict(int)
    inspeccion_por_paso: dict[tuple[int, int | None], float] = defaultdict(float)
    etiquetas_inspeccion_por_paso: dict[tuple[int, int | None], int] = defaultdict(int)
    for fw in wip_filas:
        wip_total[fw.idComp] += fw.Piezas
        wip_por_paso[(fw.idComp, fw.idProceso)] += fw.Piezas
        etiquetas_por_paso[(fw.idComp, fw.idProceso)] += fw.Etiquetas
        liberadas_por_paso[(fw.idComp, fw.idProceso)] += fw.PiezasLiberadas
        etiquetas_liberadas_por_paso[(fw.idComp, fw.idProceso)] += fw.EtiquetasLiberadas
        inspeccion_por_paso[(fw.idComp, fw.idProceso)] += fw.PiezasInspeccion
        etiquetas_inspeccion_por_paso[(fw.idComp, fw.idProceso)] += fw.EtiquetasInspeccion

    # ---- Orden topologico (Kahn): asegura padres antes que hijos -------------
    orden = _topological_sort(pt_root_id, hijos_de, padres_de)
    componentes_en_arbol = set(orden)

    # ---- Pasada 1: req_bruto + req_neto en orden topologico ------------------
    req_bruto: dict[int, float] = defaultdict(float)
    req_neto: dict[int, float] = {}
    req_bruto[pt_root_id] = req_pt_total

    for idComp in orden:
        if idComp != pt_root_id:
            req_bruto[idComp] = sum(
                req_neto[padre] * cant
                for padre, cant in padres_de[idComp]
                if padre in req_neto
            )
        req_neto[idComp] = max(0.0, req_bruto[idComp] - wip_total.get(idComp, 0.0))

    # ---- Rutas por componente ------------------------------------------------
    rutas_by_comp: dict[int, list[FilaRuta]] = defaultdict(list)
    for fr in ruta_filas:
        rutas_by_comp[fr.idComp].append(fr)
    for lst in rutas_by_comp.values():
        lst.sort(key=lambda r: r.OrdenRuta)

    # ---- Construir nodos -----------------------------------------------------
    advertencias: list[str] = []
    nodos: list[NodoComponente] = []

    for idComp in orden:
        fb = info_comp[idComp]
        es_pt = idComp == pt_root_id
        pasos = _construir_pasos(
            idComp=idComp,
            ruta=rutas_by_comp.get(idComp, []),
            wip_por_paso=wip_por_paso,
            etiquetas_por_paso=etiquetas_por_paso,
            liberadas_por_paso=liberadas_por_paso,
            etiquetas_liberadas_por_paso=etiquetas_liberadas_por_paso,
            inspeccion_por_paso=inspeccion_por_paso,
            etiquetas_inspeccion_por_paso=etiquetas_inspeccion_por_paso,
            req_bruto=req_bruto[idComp],
            es_pt=es_pt,
            almacen_wip_id=almacen_wip_id,
            almacen_wip_nombre=almacen_wip_nombre,
        )

        # Detectar WIP en procesos fuera de ruta (outliers operativos)
        procesos_en_ruta = {p.idProceso for p in pasos}
        for (comp_id, proc_id), pzs in wip_por_paso.items():
            if comp_id == idComp and proc_id not in procesos_en_ruta and pzs > 0:
                advertencias.append(
                    f"{fb.Componente}: {_fmt(pzs)} pzs WIP en idProceso={proc_id} "
                    f"fuera de la ruta catalogo (revisar)"
                )

        cadena_ruta = " -> ".join(p.label for p in pasos) if pasos else "(sin ruta)"

        aristas_padre = [
            AristaPadre(idPadre=p, cantidad_ensamble=c)
            for p, c in padres_de[idComp]
        ]
        nodos.append(NodoComponente(
            idComp=idComp,
            clave=fb.Componente,
            descripcion=fb.DescripcionComp,
            nivel=fb.BomLevel,
            tipo_material=fb.idTipoMat,
            cantidad_ensamble_total=cantidad_ensamble_total[idComp],
            req_bruto=req_bruto[idComp],
            wip_total=wip_total.get(idComp, 0.0),
            req_neto=req_neto[idComp],
            ruta=pasos,
            cadena_ruta=cadena_ruta,
            padres=aristas_padre,
            hijos=sorted(hijos_de[idComp] & componentes_en_arbol),
        ))

    return ArbolPT(pt=pt_obj, componentes=nodos, advertencias=advertencias)


def _topological_sort(
    raiz: int,
    hijos_de: dict[int, set[int]],
    padres_de: dict[int, list[tuple[int, float]]],
) -> list[int]:
    """Kahn's algorithm: padres antes que hijos. Falla con ciclos."""
    nodos_alcanzables = _bfs_reachable(raiz, hijos_de)
    in_degree = {n: 0 for n in nodos_alcanzables}
    for n in nodos_alcanzables:
        in_degree[n] = len({p for p, _ in padres_de.get(n, []) if p in nodos_alcanzables})

    listos = [raiz]
    orden: list[int] = []
    while listos:
        nodo = listos.pop(0)
        orden.append(nodo)
        for hijo in hijos_de.get(nodo, set()):
            if hijo not in in_degree:
                continue
            in_degree[hijo] -= 1
            if in_degree[hijo] == 0:
                listos.append(hijo)

    if len(orden) != len(nodos_alcanzables):
        faltantes = set(nodos_alcanzables) - set(orden)
        raise ValueError(f"Ciclo o nodo no alcanzable en el BOM: {faltantes}")
    return orden


def _bfs_reachable(raiz: int, hijos_de: dict[int, set[int]]) -> set[int]:
    visto = {raiz}
    cola = [raiz]
    while cola:
        n = cola.pop(0)
        for h in hijos_de.get(n, set()):
            if h not in visto:
                visto.add(h)
                cola.append(h)
    return visto


def _construir_pasos(
    idComp: int,
    ruta: list[FilaRuta],
    wip_por_paso: dict[tuple[int, int | None], float],
    etiquetas_por_paso: dict[tuple[int, int | None], int],
    liberadas_por_paso: dict[tuple[int, int | None], float],
    etiquetas_liberadas_por_paso: dict[tuple[int, int | None], int],
    inspeccion_por_paso: dict[tuple[int, int | None], float],
    etiquetas_inspeccion_por_paso: dict[tuple[int, int | None], int],
    req_bruto: float,
    es_pt: bool,
    almacen_wip_id: int,
    almacen_wip_nombre: str,
) -> list[PasoRuta]:
    """Construye la lista de PasoRuta de un componente con netteo paso a paso.

    Reglas:
    1. **Agrupar por idProceso**: si una ruta tiene varios sub-pasos con el mismo
       ``idProceso`` (ej. Soldadura Robot + Soldadura Limpieza, ambos idProceso=6),
       se colapsan en un solo PasoRuta. El WIP en ``tblEtiqueta`` (bucket
       "Por procesar") esta indexado por ``idProcesoSiguiente`` (sin idRuta),
       asi que solo hay un valor de WIP por (componente, idProceso) — agrupar
       evita contar el mismo WIP varias veces.
    2. **Para intermedios** se agrega un PasoRuta virtual ``Almacen WIP`` al final
       que representa el buffer donde el componente espera consumo por el padre.
       La capa visual lo usa para llenar la card del componente y no lo renderiza
       como nodo aparte.
    3. **Formula req_paso** (validada contra diagrama del usuario):
       ``req_paso[i] = req_bruto - sum(WIP en pasos i, i+1, ..., final)``
       Las piezas en este paso ya completaron los previos -> no se cuentan en el
       requerimiento upstream. Solo el bucket "Por procesar" (wip_en_paso) entra
       a esta formula — Liberadas / Inspección son solo display.
    """
    # Agrupar por idProceso preservando el orden de primera aparicion
    grupos: list[tuple[int, FilaRuta, list[str]]] = []
    indice: dict[int, int] = {}
    for fr in sorted(ruta, key=lambda r: r.OrdenRuta):
        if fr.idProceso in indice:
            grupos[indice[fr.idProceso]][2].append(fr.Ruta)
        else:
            indice[fr.idProceso] = len(grupos)
            grupos.append((fr.idProceso, fr, [fr.Ruta]))

    pasos: list[PasoRuta] = []
    for orden, (idProc, primer_fr, sub_rutas) in enumerate(grupos, start=1):
        key = (idComp, idProc)
        ruta_label = " / ".join(sub_rutas) if len(sub_rutas) > 1 else primer_fr.Ruta
        pasos.append(PasoRuta(
            orden=orden,
            idProceso=idProc,
            proceso=primer_fr.Proceso,
            ruta=ruta_label,
            idPlanta=primer_fr.IdPlanta,
            es_virtual=False,
            wip_en_paso=wip_por_paso.get(key, 0.0),
            etiquetas_en_paso=etiquetas_por_paso.get(key, 0),
            liberadas=liberadas_por_paso.get(key, 0.0),
            etiquetas_liberadas=etiquetas_liberadas_por_paso.get(key, 0),
            en_inspeccion=inspeccion_por_paso.get(key, 0.0),
            etiquetas_inspeccion=etiquetas_inspeccion_por_paso.get(key, 0),
            req_paso=0.0,
            label="",
        ))

    if not es_pt:
        key_virt = (idComp, almacen_wip_id)
        pasos.append(PasoRuta(
            orden=len(pasos) + 1,
            idProceso=almacen_wip_id,
            proceso=almacen_wip_nombre,
            ruta=None,
            idPlanta=None,
            es_virtual=True,
            wip_en_paso=wip_por_paso.get(key_virt, 0.0),
            etiquetas_en_paso=etiquetas_por_paso.get(key_virt, 0),
            # Liberadas / Inspección no aplican al Almacén WIP virtual (idProceso=16
            # es un proceso de catálogo, no físico — no genera bUltimoProceso=1).
            liberadas=0.0,
            etiquetas_liberadas=0,
            en_inspeccion=0.0,
            etiquetas_inspeccion=0,
            req_paso=0.0,
            label="",
        ))

    # Pasada inversa (inclusivo del paso actual)
    acum_downstream = 0.0
    for paso in reversed(pasos):
        acum_downstream += paso.wip_en_paso
        paso.req_paso = max(0.0, req_bruto - acum_downstream)

    for paso in pasos:
        paso.label = f"{paso.proceso} ({_fmt(paso.wip_en_paso)} de {_fmt(paso.req_paso)})"

    return pasos
