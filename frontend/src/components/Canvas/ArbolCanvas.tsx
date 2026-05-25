import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useArbol } from "@/api/queries";
import { useUiStore } from "@/store/useUiStore";
import { buildGraph, type HighlightFiltro } from "@/lib/buildGraph";
import { layoutLR } from "@/lib/layout";
import { getCachedLayout, keyFor, setCachedLayout } from "@/lib/layoutCache";

import { PtNode } from "./nodes/PtNode";
import { ComponentNode } from "./nodes/ComponentNode";
import { ProcessNode } from "./nodes/ProcessNode";

const NODE_TYPES = {
  pt: PtNode,
  component: ComponentNode,
  process: ProcessNode,
};

interface Props {
  idPt: number;
}

function ArbolCanvasInner({ idPt }: Props) {
  const ventana = useUiStore((s) => s.ventana);
  const fechaMax = useUiStore((s) => s.filters.fechaMax);
  const plantaId = useUiStore((s) => s.filters.plantaId);
  const expanded = useUiStore((s) => s.expanded);
  const toggleExpanded = useUiStore((s) => s.toggleExpanded);
  const setExpanded = useUiStore((s) => s.setExpanded);
  const procesoFiltro = useUiStore((s) => s.procesoFiltro);
  const { data, isLoading, error } = useArbol(idPt, ventana, fechaMax);

  // Drill-down activo desde el Resumen. Si esta seteado, marca los
  // ProcessNode que matchean (idProceso + idPlanta) y dispara la
  // auto-expansion de los componentes que los contienen.
  const highlight = useMemo<HighlightFiltro | null>(() => {
    if (!procesoFiltro) return null;
    return { idProceso: procesoFiltro.idProceso, idPlanta: plantaId };
  }, [procesoFiltro, plantaId]);

  const expandableIds = useMemo<number[]>(() => {
    if (!data) return [];
    return data.componentes
      .filter((c) => c.ruta.some((p) => !p.es_virtual))
      .map((c) => c.idComp);
  }, [data]);

  // Componentes cuyos pasos reales matchean el filtro de drill-down.
  // Se usa para auto-expandir solo la primera vez que se entra a una
  // combinacion (idPt, idProceso, idPlanta).
  const idsAExpandir = useMemo<number[]>(() => {
    if (!data || !highlight) return [];
    return data.componentes
      .filter((c) =>
        c.ruta.some(
          (p) =>
            !p.es_virtual &&
            p.idProceso === highlight.idProceso &&
            (highlight.idPlanta === null || p.idPlanta === highlight.idPlanta),
        ),
      )
      .map((c) => c.idComp);
  }, [data, highlight]);

  // Registro de combinaciones ya auto-expandidas. Evita re-expandir lo que
  // el usuario haya colapsado manualmente despues, incluso si cambia de tab
  // y vuelve. Solo se re-aplica si cambia el procesoFiltro o la planta.
  const autoExpandedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!data || !highlight || idsAExpandir.length === 0) return;
    const key = `${idPt}|${highlight.idProceso}|${highlight.idPlanta ?? "x"}`;
    if (autoExpandedKeyRef.current === key) return;
    autoExpandedKeyRef.current = key;
    // Union: preservar lo que el usuario ya tenia expandido.
    const next = new Set(expanded);
    for (const id of idsAExpandir) next.add(id);
    if (next.size !== expanded.size) setExpanded(next);
    // expanded no va en deps: solo queremos disparar al cambiar la
    // combinacion (PT, proceso, planta) o cuando llega el arbol.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, highlight, idsAExpandir, idPt, setExpanded]);

  const allExpanded =
    expandableIds.length > 0 && expandableIds.every((id) => expanded.has(id));
  const noneExpanded = expandableIds.every((id) => !expanded.has(id));

  const layoutResult = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    if (!data) return { nodes: [], edges: [] };
    const { nodes: rawNodes, edges } = buildGraph(data, expanded, highlight);
    const nodes = rawNodes as unknown as Node[];

    const key = keyFor(idPt, expanded);
    const cached = getCachedLayout(key);
    if (cached) {
      const placed = nodes.map((n) => ({
        ...n,
        position: cached.get(n.id) ?? n.position,
      }));
      return { nodes: placed, edges };
    }

    const placed = layoutLR<Record<string, unknown>>(
      nodes as Node<Record<string, unknown>>[],
      edges,
    );
    const cache = new Map<string, { x: number; y: number }>();
    for (const n of placed) cache.set(n.id, n.position);
    setCachedLayout(key, cache);
    return { nodes: placed as unknown as Node[], edges };
  }, [data, idPt, expanded, highlight]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setNodes(layoutResult.nodes);
    setEdges(layoutResult.edges);
    if (layoutResult.nodes.length > 0) {
      const t = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
      return () => clearTimeout(t);
    }
  }, [layoutResult, setNodes, setEdges, fitView]);

  const onNodeClick = useCallback(
    (_evt: unknown, node: Node) => {
      // PT y componente son expandibles; el ProcessNode no.
      if (node.type !== "pt" && node.type !== "component") return;
      const d = node.data as { expandable?: boolean; idComp?: number; idPt?: number };
      if (!d.expandable) return;
      const id = d.idComp ?? d.idPt;
      if (typeof id === "number") toggleExpanded(id);
    },
    [toggleExpanded],
  );

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-ink-muted">
        Cargando arbol...
      </div>
    );
  }
  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-status-empty px-8 text-center">
        Error al cargar el arbol del PT: {(error as Error).message}
      </div>
    );
  }
  if (!data) return null;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      nodeTypes={NODE_TYPES}
      proOptions={{ hideAttribution: true }}
      minZoom={0.3}
      maxZoom={1.5}
      fitView
    >
      <Background gap={20} size={1} color="#e5e5e5" />
      <Controls showInteractive={false} />
      <Panel position="top-right">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-white/90 backdrop-blur border border-surface-border shadow-soft">
          <button
            type="button"
            onClick={() => setExpanded(expandableIds)}
            disabled={expandableIds.length === 0 || allExpanded}
            title="Expandir todos los nodos"
            className="px-2.5 py-1 text-xs font-medium rounded-md text-ink-muted hover:text-ink hover:bg-surface-subtle transition disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted disabled:cursor-not-allowed"
          >
            Expandir todo
          </button>
          <span className="w-px h-4 bg-surface-border" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setExpanded([])}
            disabled={noneExpanded}
            title="Colapsar todos los nodos"
            className="px-2.5 py-1 text-xs font-medium rounded-md text-ink-muted hover:text-ink hover:bg-surface-subtle transition disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted disabled:cursor-not-allowed"
          >
            Colapsar todo
          </button>
        </div>
      </Panel>
      <MiniMap
        nodeColor={(n) => {
          const status = (n.data as { status?: string } | undefined)?.status;
          switch (status) {
            case "pt":
              return "#3b82f6";
            case "covered":
              return "#10b981";
            case "partial":
              return "#f59e0b";
            case "empty":
              return "#ef4444";
            default:
              return "#94a3b8";
          }
        }}
        maskColor="rgba(15,23,42,0.05)"
        pannable
        zoomable
      />
    </ReactFlow>
  );
}

export function ArbolCanvas({ idPt }: Props) {
  return (
    <ReactFlowProvider>
      <ArbolCanvasInner idPt={idPt} />
    </ReactFlowProvider>
  );
}
