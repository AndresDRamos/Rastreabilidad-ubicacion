import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

import type { FlujoEdgeData } from "@/lib/buildFlujo";

/** Arista del grafo de Flujo: material que el proceso origen libero (o que va
 *  encaminado por la ruta) y avanza al destino. El trazado se calcula EN VIVO
 *  desde las posiciones reales de los handles (getBezierPath), asi se mantiene
 *  recto y suave y se readapta al instante si se arrastra un nodo. Es clickeable:
 *  abre el detalle de la arista.
 *
 *  Interplanta (esInterPlanta): cruza a otra planta; se dibuja violeta y muestra
 *  un chip con el proceso frontera (el que surte/recibe en la otra planta). */
export function FlujoEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
  interactionWidth,
}: EdgeProps) {
  const d = data as FlujoEdgeData | undefined;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.5,
  });

  const dimmed = d?.dimmed ?? false;
  const highlighted = d?.highlighted ?? false;
  const esRetorno = d?.esRetorno ?? false;
  const esInterPlanta = d?.esInterPlanta ?? false;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth ?? 18}
        style={{
          ...style,
          cursor: "pointer",
          opacity: dimmed ? 0.15 : 1,
          // Retorno: punteada y ámbar (operación tardía → temprana).
          ...(esRetorno
            ? { stroke: "#f59e0b", strokeDasharray: "6 4", strokeWidth: Number(style?.strokeWidth ?? 2) }
            : null),
          // Interplanta: violeta y punteada suave (el material cruza de planta).
          ...(esInterPlanta && !esRetorno
            ? { stroke: "#7c3aed", strokeDasharray: "2 3", strokeWidth: Number(style?.strokeWidth ?? 2) }
            : null),
          // Hover/seleccion sobrescribe el color.
          ...(highlighted
            ? { stroke: "#1d4ed8", strokeWidth: Number(style?.strokeWidth ?? 2) + 1.5 }
            : null),
        }}
      />
      {esInterPlanta && d?.procesoFrontera && !dimmed ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded-full border border-[#7c3aed]/30 bg-white/90 px-1.5 py-px text-[10px] font-medium text-[#7c3aed] shadow-soft"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {d.procesoFrontera}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
