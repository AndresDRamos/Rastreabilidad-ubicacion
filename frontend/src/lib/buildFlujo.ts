// Convierte FlujoResponse (grafo de procesos del drill-in de una planta) a nodos
// y edges de React Flow.
//
// El backend ya devuelve los nodos fraccionados por FASE (un mismo proceso
// repetido en la ruta = varios nodos, uno por aparicion) y los nodos-PUERTA (una
// planta externa que surte/recibe material). Aqui solo mapeamos 1:1 y calculamos
// los agregados de tooltip. Direccion de los edges: origen -> destino.

import type { Edge, Node } from "@xyflow/react";

import type { FlujoArista, FlujoResponse } from "@/api/types";

/** Vecino de un nodo (para los tooltips "viene de" / "va a"). */
export interface FlujoVecino {
  label: string;
  piezas: number;
}

export interface FlujoNodeData extends Record<string, unknown> {
  kind: "flujoProc" | "flujoGateway";
  idProceso: number | null;
  proceso: string;
  // Aparicion del proceso en la ruta (1a, 2a...). null en las puertas.
  fase: number | null;
  idPlanta: number | null;
  nombrePlanta: string | null;
  // --- Solo nodos-PUERTA -----------------------------------------------------
  esPuerta: boolean;
  plantaVecina: number | null;
  nombrePlantaVecina: string | null;
  direccion: "in" | "out" | null;
  // ---------------------------------------------------------------------------
  // Posición en la secuencia de fabricación (mediana de OrdenFabricacion). El
  // layout ordena columnas izquierda(temprano)→derecha(tardío). null = sin ruta.
  rango: number | null;
  recibidas: number;
  // `disponibles` = Disponibles real del bloque. `disponiblesEntrantes` = suma
  // de las aristas entrantes (deben coincidir; si no, hay "sin origen").
  disponibles: number;
  disponiblesEntrantes: number;
  // `liberado` = suma de las aristas salientes (PorTransferir total del proceso).
  liberado: number;
  inspeccion: number;
  retrabajo: number;
  etiquetas: number;
  materiales: number;
  // Vecinos para los tooltips (no son handles: el nodo usa un handle por lado).
  entradas: FlujoVecino[];
  salidas: FlujoVecino[];
  // Sin material "dentro" del bloque (recibidas + disponibles + insp + retrab = 0).
  vacio: boolean;
  // Resaltado por hover / seleccion (lo controla el canvas).
  hovered: boolean;
  dimmed: boolean;
}

export interface FlujoEdgeData extends Record<string, unknown> {
  idProcesoOrigen: number | null;
  idProcesoDestino: number | null;
  idPlanta: number | null;
  procesoOrigen: string;
  procesoDestino: string;
  piezas: number;
  etiquetas: number;
  // Arista de "retorno": el destino tiene rango menor que el origen (va de una
  // operación tardía a una temprana). Se excluye del layout y se dibuja marcada
  // (punteada) para que el flujo principal se lea limpio de izquierda a derecha.
  esRetorno: boolean;
  // Arista de PUERTA (cruce interplanta). procesoFrontera = proceso que surte/
  // recibe en la otra planta (rótulo).
  esInterPlanta: boolean;
  direccion: "in" | "out" | null;
  procesoFrontera: string | null;
  // Resaltado/atenuado por hover de un nodo o de la propia arista.
  highlighted: boolean;
  dimmed: boolean;
}

const EDGE_COLOR = "#2563eb"; // status-pt
const EDGE_COLOR_EMPTY = "#cbd5e1";

/** Grosor de la arista escalado por piezas (1.25 vacio .. 6 maximo). */
function edgeWidth(piezas: number, maxPiezas: number): number {
  if (piezas <= 0) return 1.25;
  if (maxPiezas <= 0) return 2;
  return 2 + (piezas / maxPiezas) * 4;
}

export interface FlujoBuildResult {
  nodes: Node<FlujoNodeData>[];
  edges: Edge<FlujoEdgeData>[];
}

/** Clave de nodo de proceso: nombre (normalizado) + planta + fase. */
export function flujoNodeKey(
  proceso: string | null,
  idPlanta: number | null,
  fase: number | null,
): string {
  const nombre = (proceso ?? "").trim().toLowerCase() || "(sin proceso)";
  return `fn-${nombre}-${idPlanta ?? "x"}-${fase ?? "x"}`;
}

/** Clave de nodo-puerta: planta vecina + direccion. */
export function flujoGatewayKey(
  idPlantaVecina: number | null,
  direccion: "in" | "out" | null,
): string {
  return `fg-${idPlantaVecina ?? "x"}-${direccion ?? "x"}`;
}

/** Clave de nodo para el extremo de una arista (proceso real o puerta). */
function edgeEndpointKeys(a: FlujoArista): { source: string; target: string } {
  if (a.EsInterPlanta && a.Direccion === "in") {
    // origen = puerta (planta vecina), destino = proceso real de la planta.
    return {
      source: flujoGatewayKey(a.idPlantaVecina, "in"),
      target: flujoNodeKey(a.ProcesoDestino, a.idPlanta, a.FaseDestino),
    };
  }
  if (a.EsInterPlanta && a.Direccion === "out") {
    // origen = proceso real, destino = puerta (planta vecina).
    return {
      source: flujoNodeKey(a.ProcesoOrigen, a.idPlanta, a.FaseOrigen),
      target: flujoGatewayKey(a.idPlantaVecina, "out"),
    };
  }
  return {
    source: flujoNodeKey(a.ProcesoOrigen, a.idPlanta, a.FaseOrigen),
    target: flujoNodeKey(a.ProcesoDestino, a.idPlanta, a.FaseDestino),
  };
}

export function buildFlujo(data: FlujoResponse): FlujoBuildResult {
  const nodeByKey = new Map<string, Node<FlujoNodeData>>();

  // --- 1) Nodos desde los bloques (procesos por fase + puertas) --------------
  for (const b of data.bloques) {
    if (b.EsPuerta) {
      const key = flujoGatewayKey(b.idPlantaVecina, b.Direccion as "in" | "out" | null);
      if (nodeByKey.has(key)) continue;
      nodeByKey.set(key, {
        id: key,
        type: "flujoGateway",
        position: { x: 0, y: 0 },
        data: {
          kind: "flujoGateway",
          idProceso: null,
          proceso: b.NombrePlantaVecina ?? b.Proceso,
          fase: null,
          idPlanta: b.idPlanta,
          nombrePlanta: b.NombrePlanta,
          esPuerta: true,
          plantaVecina: b.idPlantaVecina,
          nombrePlantaVecina: b.NombrePlantaVecina ?? b.Proceso,
          direccion: (b.Direccion as "in" | "out" | null) ?? null,
          rango: b.Rango,
          recibidas: 0,
          disponibles: 0,
          disponiblesEntrantes: 0,
          liberado: 0,
          inspeccion: 0,
          retrabajo: 0,
          etiquetas: 0,
          materiales: 0,
          entradas: [],
          salidas: [],
          vacio: true,
          hovered: false,
          dimmed: false,
        },
      });
      continue;
    }

    const key = flujoNodeKey(b.Proceso, b.idPlanta, b.Fase);
    const existing = nodeByKey.get(key);
    if (existing) {
      const d = existing.data;
      d.recibidas += b.Recibidas;
      d.disponibles += b.Disponibles;
      d.inspeccion += b.Inspeccion;
      d.retrabajo += b.Retrabajo;
      d.etiquetas += b.Etiquetas;
      d.materiales += b.Materiales;
      if (d.idProceso == null && b.idProceso != null) d.idProceso = b.idProceso;
      if (b.Rango != null) d.rango = d.rango == null ? b.Rango : Math.min(d.rango, b.Rango);
      continue;
    }
    nodeByKey.set(key, {
      id: key,
      type: "flujoProc",
      position: { x: 0, y: 0 },
      data: {
        kind: "flujoProc",
        idProceso: b.idProceso,
        proceso: b.Proceso,
        fase: b.Fase,
        idPlanta: b.idPlanta,
        nombrePlanta: b.NombrePlanta,
        esPuerta: false,
        plantaVecina: null,
        nombrePlantaVecina: null,
        direccion: null,
        rango: b.Rango,
        recibidas: b.Recibidas,
        disponibles: b.Disponibles,
        disponiblesEntrantes: 0,
        liberado: 0,
        inspeccion: b.Inspeccion,
        retrabajo: b.Retrabajo,
        etiquetas: b.Etiquetas,
        materiales: b.Materiales,
        entradas: [],
        salidas: [],
        vacio: true,
        hovered: false,
        dimmed: false,
      },
    });
  }

  // --- 2) Aristas: agrupar por (sourceKey -> targetKey), saltar self-loops ----
  interface EdgeAcc {
    a: FlujoArista;
    piezas: number;
    etiquetas: number;
  }
  const edgeAcc = new Map<string, EdgeAcc>();

  for (const a of data.aristas) {
    const { source: sourceKey, target: targetKey } = edgeEndpointKeys(a);
    if (sourceKey === targetKey) continue; // self-loop tras mapear -> descartar
    if (!nodeByKey.has(sourceKey) || !nodeByKey.has(targetKey)) continue; // sin nodo

    const ekey = `${sourceKey}>>${targetKey}`;
    const acc = edgeAcc.get(ekey);
    if (acc) {
      acc.piezas += a.Piezas;
      acc.etiquetas += a.Etiquetas;
    } else {
      edgeAcc.set(ekey, { a, piezas: a.Piezas, etiquetas: a.Etiquetas });
    }
  }

  const maxPiezas = [...edgeAcc.values()].reduce((m, e) => Math.max(m, e.piezas), 0);

  const edges: Edge<FlujoEdgeData>[] = [];
  for (const [ekey, { a, piezas, etiquetas }] of edgeAcc) {
    const [sourceKey, targetKey] = ekey.split(">>");
    const sourceNode = nodeByKey.get(sourceKey);
    const targetNode = nodeByKey.get(targetKey);

    if (targetNode) {
      targetNode.data.disponiblesEntrantes += piezas;
      targetNode.data.entradas.push({ label: sourceNode?.data.proceso ?? a.ProcesoOrigen, piezas });
    }
    if (sourceNode) {
      sourceNode.data.liberado += piezas;
      sourceNode.data.salidas.push({ label: targetNode?.data.proceso ?? a.ProcesoDestino, piezas });
    }

    // Retorno: solo aristas intra-planta con destino de rango estrictamente
    // menor. Las de puerta van a los bordes (nunca son retorno).
    const sR = sourceNode?.data.rango;
    const tR = targetNode?.data.rango;
    const esRetorno = !a.EsInterPlanta && sR != null && tR != null && tR < sR;

    const conMaterial = piezas > 0;
    edges.push({
      id: `fa-${ekey}`,
      source: sourceKey,
      target: targetKey,
      type: "flujoEdge",
      animated: conMaterial && !esRetorno,
      style: {
        stroke: conMaterial ? EDGE_COLOR : EDGE_COLOR_EMPTY,
        strokeWidth: edgeWidth(piezas, maxPiezas),
      },
      data: {
        idProcesoOrigen: a.idProcesoOrigen,
        idProcesoDestino: a.idProcesoDestino,
        idPlanta: a.idPlanta,
        procesoOrigen: sourceNode?.data.proceso ?? a.ProcesoOrigen,
        procesoDestino: targetNode?.data.proceso ?? a.ProcesoDestino,
        piezas,
        etiquetas,
        esRetorno,
        esInterPlanta: a.EsInterPlanta,
        direccion: a.Direccion,
        procesoFrontera: a.ProcesoFrontera,
        highlighted: false,
        dimmed: false,
      },
    });
  }

  // --- 3) Marcar nodos vacios y ordenar vecinos para los tooltips -----------
  for (const n of nodeByKey.values()) {
    const d = n.data;
    d.vacio = d.recibidas + d.disponibles + d.inspeccion + d.retrabajo <= 0;
    d.entradas.sort((a, b) => b.piezas - a.piezas);
    d.salidas.sort((a, b) => b.piezas - a.piezas);
  }

  return { nodes: [...nodeByKey.values()], edges };
}
