// Convierte ArbolPT (response del backend) a nodos y edges de React Flow.
// La direccion de los edges es hijo -> padre (flujo de fabricacion).
//
// Si un componente esta en `expanded`, sus pasos de ruta NO virtuales se
// emiten como nodos en cadena (proceso_1 -> proceso_2 -> ... -> card_comp).
// Los edges desde sus hijos apuntan al PRIMER paso visible del padre cuando
// el padre esta expandido; al card del padre cuando no.

import type { Edge, Node } from "@xyflow/react";

import type { ArbolPT, NodoComponente, PasoRuta } from "@/api/types";

export type Status = "pt" | "covered" | "partial" | "empty" | "neutral";

export interface PtNodeData extends Record<string, unknown> {
  kind: "pt";
  idPt: number;
  clave: string;
  descripcion: string;
  cliente: string;
  ciudad: string;
  fechaPromMin: string;
  fechaPromMax: string;
  piezasPend: number;
  piezasPastDue: number;
  reqBruto: number;
  wipTotal: number;
  reqNeto: number;
  status: Status;
  expandable: boolean;     // true si tiene pasos reales
  expanded: boolean;
}

export interface ComponentNodeData extends Record<string, unknown> {
  kind: "component";
  idComp: number;
  clave: string;
  descripcion: string;
  nivel: number;
  reqBruto: number;
  wipTotal: number;
  reqNeto: number;
  // Valores derivados para la card segun modo.
  // inventario  -> wipBuffer (piezas en el buffer Almacen WIP virtual)
  // requerimiento -> reqBufferFaltante = max(0, reqBruto - wipBuffer)
  wipBuffer: number;
  reqBufferFaltante: number;
  cadenaRuta: string;
  ultimoPaso: PasoRuta | null;
  status: Status;
  expandable: boolean;
  expanded: boolean;
}

export interface ProcessNodeData extends Record<string, unknown> {
  kind: "process";
  idComp: number;
  idProceso: number;
  proceso: string;
  ruta: string | null;
  idPlanta: number | null;
  ordenEnRuta: number;
  totalPasos: number;
  reqPaso: number;
  wipEnPaso: number;
}

export type ArbolNode =
  | Node<PtNodeData>
  | Node<ComponentNodeData>
  | Node<ProcessNodeData>;

export interface BuildResult {
  nodes: ArbolNode[];
  edges: Edge[];
}

function statusDeComponente(c: NodoComponente, ultimoPasoReal: PasoRuta | null): Status {
  if (c.req_bruto <= 0) return "neutral";
  const reqUlt = ultimoPasoReal?.req_paso ?? c.req_bruto;
  if (reqUlt <= 0) return "covered";
  if (c.wip_total <= 0) return "empty";
  return "partial";
}

function procIdNode(idComp: number, idProceso: number): string {
  return `p-${idComp}-${idProceso}`;
}

function cardIdNode(idComp: number, idPt: number): string {
  return idComp === idPt ? `pt-${idPt}` : `c-${idComp}`;
}

/** Donde "entra" un edge cuando apunta a un componente.
 *  - Si esta expandido y tiene pasos reales -> primer paso real
 *  - Si no -> card del componente
 */
function nodoEntrada(
  comp: NodoComponente,
  idPt: number,
  expanded: Set<number>,
): string {
  if (expanded.has(comp.idComp)) {
    const pasosReales = comp.ruta.filter((p) => !p.es_virtual);
    if (pasosReales.length > 0) {
      return procIdNode(comp.idComp, pasosReales[0].idProceso);
    }
  }
  return cardIdNode(comp.idComp, idPt);
}

export function buildGraph(arbol: ArbolPT, expanded: Set<number>): BuildResult {
  const nodes: ArbolNode[] = [];
  const edges: Edge[] = [];

  const idPt = arbol.pt.idMaterial;
  const porIdComp = new Map(arbol.componentes.map((c) => [c.idComp, c]));

  // --- 1) Nodo PT ----------------------------------------------------------
  const ptComp = porIdComp.get(idPt);
  const ptReqBruto = ptComp?.req_bruto ?? arbol.pt.PiezasPend;
  const ptWipTotal = ptComp?.wip_total ?? 0;
  const ptReqNeto = ptComp?.req_neto ?? ptReqBruto;
  const ptPasosReales = ptComp?.ruta.filter((p) => !p.es_virtual) ?? [];

  nodes.push({
    id: `pt-${idPt}`,
    type: "pt",
    position: { x: 0, y: 0 },
    data: {
      kind: "pt",
      idPt,
      clave: arbol.pt.PT,
      descripcion: arbol.pt.Descripcion,
      cliente: arbol.pt.Cliente,
      ciudad: arbol.pt.Ciudad,
      fechaPromMin: arbol.pt.FechaPromMin,
      fechaPromMax: arbol.pt.FechaPromMax,
      piezasPend: arbol.pt.PiezasPend,
      piezasPastDue: arbol.pt.PiezasPastDue,
      reqBruto: ptReqBruto,
      wipTotal: ptWipTotal,
      reqNeto: ptReqNeto,
      status: "pt",
      expandable: ptPasosReales.length > 0,
      expanded: expanded.has(idPt),
    },
  });

  // --- 2) Nodos de componentes (intermedios) -------------------------------
  for (const c of arbol.componentes) {
    if (c.idComp === idPt) continue;

    const ultimoPasoReal = [...c.ruta].reverse().find((p) => !p.es_virtual) ?? null;
    const buffer = c.ruta.find((p) => p.es_virtual) ?? null;
    const wipBuffer = buffer?.wip_en_paso ?? 0;
    const reqBufferFaltante = Math.max(0, c.req_bruto - wipBuffer);
    const pasosReales = c.ruta.filter((p) => !p.es_virtual);

    nodes.push({
      id: `c-${c.idComp}`,
      type: "component",
      position: { x: 0, y: 0 },
      data: {
        kind: "component",
        idComp: c.idComp,
        clave: c.clave,
        descripcion: c.descripcion ?? "",
        nivel: c.nivel,
        reqBruto: c.req_bruto,
        wipTotal: c.wip_total,
        reqNeto: c.req_neto,
        wipBuffer,
        reqBufferFaltante,
        cadenaRuta: c.cadena_ruta,
        ultimoPaso: ultimoPasoReal,
        status: statusDeComponente(c, ultimoPasoReal),
        expandable: pasosReales.length > 0,
        expanded: expanded.has(c.idComp),
      },
    });
  }

  // --- 3) Pasos expandidos: nodos + edges internos -------------------------
  for (const c of arbol.componentes) {
    if (!expanded.has(c.idComp)) continue;
    const pasosReales = c.ruta.filter((p) => !p.es_virtual);
    if (pasosReales.length === 0) continue;

    pasosReales.forEach((paso, idx) => {
      nodes.push({
        id: procIdNode(c.idComp, paso.idProceso),
        type: "process",
        position: { x: 0, y: 0 },
        data: {
          kind: "process",
          idComp: c.idComp,
          idProceso: paso.idProceso,
          proceso: paso.proceso,
          ruta: paso.ruta,
          idPlanta: paso.idPlanta,
          ordenEnRuta: idx + 1,
          totalPasos: pasosReales.length,
          reqPaso: paso.req_paso,
          wipEnPaso: paso.wip_en_paso,
        },
      });

      // Edge interno paso_i -> paso_{i+1}, o ultimo paso -> card del componente.
      const sourceId = procIdNode(c.idComp, paso.idProceso);
      const isLast = idx === pasosReales.length - 1;
      const targetId = isLast
        ? cardIdNode(c.idComp, idPt)
        : procIdNode(c.idComp, pasosReales[idx + 1].idProceso);

      edges.push({
        id: `ei-${sourceId}-to-${targetId}`,
        source: sourceId,
        target: targetId,
        type: "smoothstep",
        style: { stroke: "#cbd5e1", strokeWidth: 1.25, strokeDasharray: "4 3" },
      });
    });
  }

  // --- 4) Edges hijo -> padre (apunta al primer paso si padre expandido) --
  for (const c of arbol.componentes) {
    if (c.idComp === idPt) continue;
    const sourceId = `c-${c.idComp}`;
    for (const arista of c.padres) {
      const padre = porIdComp.get(arista.idPadre);
      const targetId = padre
        ? nodoEntrada(padre, idPt, expanded)
        : cardIdNode(arista.idPadre, idPt);
      edges.push({
        id: `e-${sourceId}-to-${targetId}`,
        source: sourceId,
        target: targetId,
        type: "smoothstep",
        animated: false,
        label: arista.cantidad_ensamble !== 1 ? `×${arista.cantidad_ensamble}` : undefined,
        labelStyle: { fontSize: 11, fill: "#64748b" },
        labelBgStyle: { fill: "#ffffff", fillOpacity: 0.85 },
        style: { stroke: "#cbd5e1", strokeWidth: 1.5 },
      });
    }
  }

  return { nodes, edges };
}
