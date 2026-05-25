import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";

import { useUiStore } from "@/store/useUiStore";
import type { PtNodeData } from "@/lib/buildGraph";
import { fmtInt } from "@/lib/format";
import { PartThumbnail } from "./PartThumbnail";

type Props = NodeProps<Node<PtNodeData>>;

export function PtNode({ data }: Props) {
  const mode = useUiStore((s) => s.mode);
  // PT card: inventario muestra wip_total (lo que ya hay en piso),
  // requerimiento muestra piezas pendientes (demanda).
  const valor = mode === "inventario" ? data.wipTotal : data.piezasPend;
  const subLabel = mode === "inventario" ? "en piso" : "pendientes";

  return (
    <div
      className={`rounded-xl shadow-card bg-white border-2 border-status-pt overflow-hidden w-[240px] ${data.expandable ? "cursor-pointer" : ""}`}
    >
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-status-pt !border-0" />
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-status-pt !border-0" />

      <div className="px-3 py-2 bg-status-pt/10 border-b border-status-pt/20 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-status-pt">
          Producto terminado
        </span>
        {data.expandable ? (
          <span
            className={`
              pointer-events-none select-none
              inline-flex items-center gap-1
              text-[10px] font-medium leading-none
              px-2 py-1 rounded-full
              transition-colors duration-150
              ${data.expanded
                ? "bg-status-pt text-white"
                : "border border-status-pt text-status-pt bg-transparent"
              }
            `}
          >
            <svg
              viewBox="0 0 12 12"
              className="w-[9px] h-[9px] shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {/* Icono de árbol/jerarquía: línea vertical + 2 ramas */}
              <line x1="6" y1="1" x2="6" y2="5" />
              <line x1="6" y1="5" x2="2" y2="9" />
              <line x1="6" y1="5" x2="10" y2="9" />
              <circle cx="6" cy="1" r="1" fill="currentColor" stroke="none" />
              <circle cx="2" cy="9" r="1" fill="currentColor" stroke="none" />
              <circle cx="10" cy="9" r="1" fill="currentColor" stroke="none" />
            </svg>
            procesos
          </span>
        ) : null}
      </div>

      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-sm font-semibold text-ink truncate">{data.clave}</div>
            {data.descripcion ? (
              <div className="text-[11px] text-ink-muted truncate" title={data.descripcion}>
                {data.descripcion}
              </div>
            ) : null}
          </div>
          <PartThumbnail clave={data.clave} />
        </div>

        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold tabular-nums text-ink leading-none">
            {fmtInt(valor)}
          </span>
          <span className="text-xs text-ink-muted">{subLabel}</span>
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-ink-subtle">
          <span className="truncate" title={data.cliente}>
            {data.cliente}
          </span>
          {data.ciudad ? (
            <span className="ml-1 shrink-0 truncate" title={data.ciudad}>
              · {data.ciudad}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
