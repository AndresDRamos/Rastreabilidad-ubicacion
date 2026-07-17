import { useCallback, useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useFlujo } from "@/api/queries";
import { buildFlujo, type FlujoEdgeData, type FlujoNodeData } from "@/lib/buildFlujo";
import { layoutLR } from "@/lib/layout";
import { useUiStore } from "@/store/useUiStore";

import { FlujoProcessNode } from "./FlujoProcessNode";
import { FlujoGatewayNode } from "./FlujoGatewayNode";
import { FlujoEdge } from "./FlujoEdge";
import { FlujoNodeSelector } from "./FlujoNodeSelector";
import { FlujoControls } from "./FlujoControls";
import { FlujoSkeleton } from "./FlujoSkeleton";

const NODE_TYPES = { flujoProc: FlujoProcessNode, flujoGateway: FlujoGatewayNode };
const EDGE_TYPES = { flujoEdge: FlujoEdge };

function FlujoCanvasInner({ planta }: { planta: number | null }) {
  const clienteIds = useUiStore((s) => s.filters.clienteIds);
  const plantaId = planta;
  const ciudadIds = useUiStore((s) => s.filters.ciudadIds);
  const tipoMaterialIds = useUiStore((s) => s.filters.tipoMaterialIds);
  const claseIds = useUiStore((s) => s.filters.claseIds);
  const universo = useUiStore((s) => s.universo);
  const setBloqueDetalle = useUiStore((s) => s.setBloqueDetalle);
  const flujoResaltados = useUiStore((s) => s.flujoResaltados);
  const setFlujoResaltados = useUiStore((s) => s.setFlujoResaltados);

  const { data, isLoading, isFetching, error } = useFlujo(
    clienteIds,
    plantaId,
    ciudadIds,
    tipoMaterialIds,
    claseIds,
    universo,
  );

  const layoutResult = useMemo<{
    nodes: Node<FlujoNodeData>[];
    edges: Edge<FlujoEdgeData>[];
  }>(() => {
    if (!data) return { nodes: [], edges: [] };
    const { nodes, edges } = buildFlujo(data);
    // El layout (dagre) usa SOLO las aristas hacia adelante: así el grafo que se
    // rankea es acíclico y se lee limpio izquierda→derecha. Las aristas de
    // retorno se siguen dibujando (marcadas) pero no influyen en las columnas.
    const forwardEdges = edges.filter(
      (e) => !(e.data as FlujoEdgeData | undefined)?.esRetorno,
    );
    const placed = layoutLR<FlujoNodeData>(nodes, forwardEdges, {
      nodeWidth: 260,
      nodeHeight: 132,
      rankSep: 100,
      nodeSep: 100,
    });
    return { nodes: placed, edges };
  }, [data]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlujoNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<FlujoEdgeData>>([]);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setNodes(layoutResult.nodes);
    setEdges(layoutResult.edges);
    if (layoutResult.nodes.length > 0) {
      const t = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
      return () => clearTimeout(t);
    }
  }, [layoutResult, setNodes, setEdges, fitView]);

  // --- Resaltado sticky por el selector multi-nodo (nombres de proceso). Los
  //     ids de nodo (proceso, todas sus fases) que coinciden con la seleccion. --
  const resaltadoIds = useMemo(() => {
    const ids = new Set<string>();
    if (flujoResaltados.length === 0) return ids;
    const names = new Set(flujoResaltados.map((n) => n.trim().toLowerCase()));
    for (const n of layoutResult.nodes) {
      const d = n.data as FlujoNodeData;
      if (!d.esPuerta && names.has(d.proceso.trim().toLowerCase())) ids.add(n.id);
    }
    return ids;
  }, [flujoResaltados, layoutResult.nodes]);

  // Estado "base" (sin hover): con seleccion activa, resalta los coincidentes y
  // atenua el resto; sin seleccion, todo neutro. El hover lo sobrescribe.
  const applyBase = useCallback(() => {
    const has = resaltadoIds.size > 0;
    setNodes((ns) =>
      ns.map((n) => ({
        ...n,
        data: { ...n.data, hovered: has && resaltadoIds.has(n.id), dimmed: has && !resaltadoIds.has(n.id) },
      })),
    );
    setEdges((es) =>
      es.map((e) => ({
        ...e,
        data: {
          ...(e.data as FlujoEdgeData),
          highlighted: false,
          dimmed: has && !(resaltadoIds.has(e.source) && resaltadoIds.has(e.target)),
        },
      })),
    );
  }, [resaltadoIds, setNodes, setEdges]);

  useEffect(() => {
    applyBase();
  }, [applyBase]);

  // --- Hover: resaltar el nodo, sus aristas conectadas y vecinos; atenuar el
  //     resto para dar feedback de "de aqui sale/entra el material". ----------
  const onNodeMouseEnter = useCallback(
    (_evt: unknown, node: Node) => {
      const focus = new Set<string>([node.id]);
      const connEdgeIds = new Set<string>();
      for (const e of layoutResult.edges) {
        if (e.source === node.id || e.target === node.id) {
          connEdgeIds.add(e.id);
          focus.add(e.source);
          focus.add(e.target);
        }
      }
      setNodes((ns) =>
        ns.map((n) => ({
          ...n,
          data: { ...n.data, hovered: n.id === node.id, dimmed: !focus.has(n.id) },
        })),
      );
      setEdges((es) =>
        es.map((e) => ({
          ...e,
          data: {
            ...(e.data as FlujoEdgeData),
            highlighted: connEdgeIds.has(e.id),
            dimmed: !connEdgeIds.has(e.id),
          },
        })),
      );
    },
    [layoutResult.edges, setNodes, setEdges],
  );

  const onNodeMouseLeave = useCallback(() => {
    applyBase(); // vuelve al estado base (respeta la seleccion sticky).
  }, [applyBase]);

  // --- Hover sobre una arista: resaltarla sola (afordancia de "clickeable"). --
  const onEdgeMouseEnter = useCallback(
    (_evt: unknown, edge: Edge) => {
      setEdges((es) =>
        es.map((e) => ({
          ...e,
          data: { ...(e.data as FlujoEdgeData), highlighted: e.id === edge.id },
        })),
      );
    },
    [setEdges],
  );

  const onEdgeMouseLeave = useCallback(() => {
    applyBase();
  }, [applyBase]);

  // --- Click en una arista X->Y: abre el detalle de etiquetas de ese tramo. ---
  //   piezas > 0  -> PorTransferir: material ya liberado en transito X->Y.
  //   piezas == 0 -> Encaminadas: material aun en X cuya ruta apunta a Y
  //                  ("lo que deberia irse por ese camino").
  const onEdgeClick = useCallback(
    (_evt: unknown, edge: Edge) => {
      const d = edge.data as FlujoEdgeData | undefined;
      if (!d || d.idProcesoOrigen == null || d.idProcesoDestino == null) return;
      setBloqueDetalle({
        idProceso: d.idProcesoOrigen,
        nombreProceso: d.procesoOrigen,
        bucket: d.piezas > 0 ? "PorTransferir" : "Encaminadas",
        destino: d.idProcesoDestino,
        tituloDestino: d.procesoDestino,
      });
    },
    [setBloqueDetalle],
  );

  if (isLoading || (isFetching && !data)) {
    return <FlujoSkeleton />;
  }
  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-status-empty px-8 text-center">
        Error al cargar el flujo: {(error as Error).message}
      </div>
    );
  }
  if (!data || data.bloques.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-ink-muted">
        Sin procesos en la ruta con los filtros actuales.
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeMouseLeave={onNodeMouseLeave}
      onEdgeMouseEnter={onEdgeMouseEnter}
      onEdgeMouseLeave={onEdgeMouseLeave}
      onEdgeClick={onEdgeClick}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
      maxZoom={1.5}
      fitView
    >
      <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5">
        <FlujoControls />
        <FlujoNodeSelector
          nodes={layoutResult.nodes}
          value={flujoResaltados}
          onChange={setFlujoResaltados}
          onOpenDetail={(idProceso, nombre) =>
            setBloqueDetalle({
              idProceso,
              nombreProceso: nombre,
              bucket: "Disponibles",
              idPlanta: planta,
            })
          }
        />
      </div>
      <Background gap={20} size={1} color="#e5e5e5" />
      <Controls showInteractive={false} />
      <MiniMap
        nodeColor={(n) => {
          const d = n.data as FlujoNodeData | undefined;
          if (!d) return "#94a3b8";
          if (d.recibidas > 0) return "#f59e0b";
          if (d.disponiblesEntrantes > 0) return "#10b981";
          return "#cbd5e1";
        }}
        maskColor="rgba(15,23,42,0.05)"
        pannable
        zoomable
      />
    </ReactFlow>
  );
}

export function FlujoCanvas({ planta = null }: { planta?: number | null }) {
  return (
    <ReactFlowProvider>
      <FlujoCanvasInner planta={planta} />
    </ReactFlowProvider>
  );
}
