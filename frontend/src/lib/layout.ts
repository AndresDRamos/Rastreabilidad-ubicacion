// Layout horizontal con dagre. Hijos a la izquierda, PT raiz a la derecha.

import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
}

function runDagre<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
  opts: LayoutOptions,
): { g: dagre.graphlib.Graph; nodeWidth: number; nodeHeight: number } {
  const nodeWidth = opts.nodeWidth ?? 240;
  const nodeHeight = opts.nodeHeight ?? 110;
  const rankSep = opts.rankSep ?? 90;
  const nodeSep = opts.nodeSep ?? 28;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: nodeSep, ranksep: rankSep, marginx: 24, marginy: 24 });

  for (const n of nodes) {
    g.setNode(n.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);
  return { g, nodeWidth, nodeHeight };
}

function placeNodes<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  g: dagre.graphlib.Graph,
  nodeWidth: number,
  nodeHeight: number,
): Node<T>[] {
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 },
    };
  });
}

export function layoutLR<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
  opts: LayoutOptions = {},
): Node<T>[] {
  const { g, nodeWidth, nodeHeight } = runDagre(nodes, edges, opts);
  return placeNodes(nodes, g, nodeWidth, nodeHeight);
}
