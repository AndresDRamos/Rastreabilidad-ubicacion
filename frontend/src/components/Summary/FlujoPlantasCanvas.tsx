import { useCallback, useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useFlujoPlantas } from "@/api/queries";
import type { FlujoEdgeData } from "@/lib/buildFlujo";
import {
  buildFlujoPlantas,
  type FlujoPlantaNodeData,
} from "@/lib/buildFlujoPlantas";
import { layoutLR } from "@/lib/layout";
import { useUiStore } from "@/store/useUiStore";

import { FlujoPlantaNode } from "./FlujoPlantaNode";
import { FlujoEdge } from "./FlujoEdge";
import { FlujoControls } from "./FlujoControls";
import { FlujoSkeleton } from "./FlujoSkeleton";

const NODE_TYPES = { flujoPlanta: FlujoPlantaNode };
const EDGE_TYPES = { flujoEdge: FlujoEdge };

function FlujoPlantasCanvasInner() {
  const clienteId = useUiStore((s) => s.filters.clienteId);
  const ciudadIds = useUiStore((s) => s.filters.ciudadIds);
  const tipoMaterialIds = useUiStore((s) => s.filters.tipoMaterialIds);
  const claseIds = useUiStore((s) => s.filters.claseIds);
  const universo = useUiStore((s) => s.universo);

  const { data, isLoading, isFetching, error } = useFlujoPlantas(
    clienteId,
    ciudadIds,
    tipoMaterialIds,
    claseIds,
    universo,
  );

  const layoutResult = useMemo<{
    nodes: Node<FlujoPlantaNodeData>[];
    edges: Edge<FlujoEdgeData>[];
  }>(() => {
    if (!data) return { nodes: [], edges: [] };
    const { nodes, edges } = buildFlujoPlantas(data);
    // dagre rankea SOLO con aristas hacia adelante (acíclico) -> izquierda
    // (fabricación) a derecha (embarque). Los retornos se dibujan pero no
    // influyen en las columnas.
    const forwardEdges = edges.filter(
      (e) => !(e.data as FlujoEdgeData | undefined)?.esRetorno,
    );
    const placed = layoutLR<FlujoPlantaNodeData>(nodes, forwardEdges, {
      nodeWidth: 280,
      nodeHeight: 140,
      rankSep: 140,
      nodeSep: 80,
    });
    return { nodes: placed, edges };
  }, [data]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlujoPlantaNodeData>>([]);
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

  // Hover: resaltar el nodo, sus aristas conectadas y vecinos; atenuar el resto.
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
    setNodes((ns) =>
      ns.map((n) => ({ ...n, data: { ...n.data, hovered: false, dimmed: false } })),
    );
    setEdges((es) =>
      es.map((e) => ({
        ...e,
        data: { ...(e.data as FlujoEdgeData), highlighted: false, dimmed: false },
      })),
    );
  }, [setNodes, setEdges]);

  if (isLoading || (isFetching && !data)) {
    return <FlujoSkeleton />;
  }
  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-status-empty px-8 text-center">
        Error al cargar el flujo de plantas: {(error as Error).message}
      </div>
    );
  }
  if (!data || data.nodos.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-ink-muted">
        Sin plantas con ruta o WIP en los filtros actuales.
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
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
      maxZoom={1.5}
      fitView
    >
      <div className="absolute left-3 top-3 z-10">
        <FlujoControls />
      </div>
      <Background gap={20} size={1} color="#e5e5e5" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function FlujoPlantasCanvas() {
  return (
    <ReactFlowProvider>
      <FlujoPlantasCanvasInner />
    </ReactFlowProvider>
  );
}
