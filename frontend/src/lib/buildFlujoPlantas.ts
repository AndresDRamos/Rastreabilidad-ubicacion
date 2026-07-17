// Convierte FlujoPlantasResponse (overview nivel planta) a nodos y edges de
// React Flow. Un nodo por planta; aristas Planta A → Planta B.
//
// Grosor de la arista = nº de componentes que rutan A→B (peso estructural).
// Color/animación = material en tránsito ahora (Piezas). Las aristas de retorno
// (destino con rango menor que el origen) se marcan aparte, igual que en el
// flujo de procesos. Reusa FlujoEdge (FlujoEdgeData) para el render de aristas.

import type { Edge, Node } from "@xyflow/react";

import type { FlujoPlantaNodo, FlujoPlantasResponse } from "@/api/types";
import type { FlujoEdgeData } from "./buildFlujo";

/** Vecino de una planta (para los tooltips "viene de" / "va a"). */
export interface FlujoPlantaVecino {
  label: string;
  componentes: number;
  piezas: number;
}

export interface FlujoPlantaNodeData extends Record<string, unknown> {
  kind: "flujoPlanta";
  idPlanta: number | null;
  nombre: string;
  rango: number | null;
  // WIP interno total de la planta (suma de todos sus procesos).
  recibidas: number;
  disponibles: number;
  inspeccion: number;
  retrabajo: number;
  etiquetas: number;
  materiales: number;
  procesos: number;
  // Material que entra/sale de la planta hacia/desde otras (para tooltips).
  entradas: FlujoPlantaVecino[];
  salidas: FlujoPlantaVecino[];
  // Sin WIP interno (recibidas + disponibles + insp + retrab = 0).
  vacio: boolean;
  hovered: boolean;
  dimmed: boolean;
}

const EDGE_COLOR = "#2563eb"; // status-pt — con material en tránsito
const EDGE_COLOR_EMPTY = "#cbd5e1"; // gris — solo estructura

/** Grosor por nº de componentes que rutan A→B (1.5 .. 7). */
function edgeWidth(componentes: number, maxComp: number): number {
  if (maxComp <= 0) return 1.5;
  return 1.5 + (componentes / maxComp) * 5.5;
}

export function flujoPlantaKey(idPlanta: number | null): string {
  return `fp-${idPlanta ?? "x"}`;
}

export interface FlujoPlantasBuildResult {
  nodes: Node<FlujoPlantaNodeData>[];
  edges: Edge<FlujoEdgeData>[];
}

export function buildFlujoPlantas(
  data: FlujoPlantasResponse,
): FlujoPlantasBuildResult {
  const nodeByKey = new Map<string, Node<FlujoPlantaNodeData>>();

  const ensureNode = (
    idPlanta: number | null,
    nombre: string | null,
    n?: FlujoPlantaNodo,
  ): Node<FlujoPlantaNodeData> => {
    const key = flujoPlantaKey(idPlanta);
    const existing = nodeByKey.get(key);
    if (existing) {
      if (n && !existing.data.nombre && nombre) existing.data.nombre = nombre;
      return existing;
    }
    const node: Node<FlujoPlantaNodeData> = {
      id: key,
      type: "flujoPlanta",
      position: { x: 0, y: 0 },
      data: {
        kind: "flujoPlanta",
        idPlanta,
        nombre: nombre ?? "(sin planta)",
        rango: n?.Rango ?? null,
        recibidas: n?.Recibidas ?? 0,
        disponibles: n?.Disponibles ?? 0,
        inspeccion: n?.Inspeccion ?? 0,
        retrabajo: n?.Retrabajo ?? 0,
        etiquetas: n?.Etiquetas ?? 0,
        materiales: n?.Materiales ?? 0,
        procesos: n?.Procesos ?? 0,
        entradas: [],
        salidas: [],
        vacio: true,
        hovered: false,
        dimmed: false,
      },
    };
    nodeByKey.set(key, node);
    return node;
  };

  for (const n of data.nodos) ensureNode(n.idPlanta, n.NombrePlanta, n);

  const maxComp = data.aristas.reduce((m, a) => Math.max(m, a.Componentes), 0);

  const edges: Edge<FlujoEdgeData>[] = [];
  for (const a of data.aristas) {
    const sourceNode = ensureNode(a.idPlantaOrigen, a.PlantaOrigen);
    const targetNode = ensureNode(a.idPlantaDestino, a.PlantaDestino);
    const sourceKey = sourceNode.id;
    const targetKey = targetNode.id;
    if (sourceKey === targetKey) continue;

    const sR = sourceNode.data.rango;
    const tR = targetNode.data.rango;
    const esRetorno = sR != null && tR != null && tR < sR;
    const conTransito = a.Piezas > 0;

    targetNode.data.entradas.push({
      label: sourceNode.data.nombre,
      componentes: a.Componentes,
      piezas: a.Piezas,
    });
    sourceNode.data.salidas.push({
      label: targetNode.data.nombre,
      componentes: a.Componentes,
      piezas: a.Piezas,
    });

    edges.push({
      id: `fpa-${sourceKey}>>${targetKey}`,
      source: sourceKey,
      target: targetKey,
      type: "flujoEdge",
      animated: conTransito && !esRetorno,
      style: {
        stroke: conTransito ? EDGE_COLOR : EDGE_COLOR_EMPTY,
        strokeWidth: edgeWidth(a.Componentes, maxComp),
      },
      data: {
        idProcesoOrigen: null,
        idProcesoDestino: null,
        idPlanta: a.idPlantaOrigen,
        procesoOrigen: a.PlantaOrigen,
        procesoDestino: a.PlantaDestino,
        piezas: a.Piezas,
        etiquetas: a.Etiquetas,
        esRetorno,
        esInterPlanta: false,
        direccion: null,
        procesoFrontera: null,
        highlighted: false,
        dimmed: false,
      },
    });
  }

  for (const n of nodeByKey.values()) {
    const d = n.data;
    d.vacio = d.recibidas + d.disponibles + d.inspeccion + d.retrabajo <= 0;
    d.entradas.sort((a, b) => b.componentes - a.componentes);
    d.salidas.sort((a, b) => b.componentes - a.componentes);
  }

  return { nodes: [...nodeByKey.values()], edges };
}
