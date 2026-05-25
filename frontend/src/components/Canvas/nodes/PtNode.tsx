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
        <div className="flex items-center gap-2">
          {data.expandable ? (
            <span className="text-[10px] text-status-pt/80 font-medium select-none">
              {data.expanded ? "▼ procesos" : "▶ procesos"}
            </span>
          ) : null}
          {data.piezasPastDue > 0 ? (
            <span className="text-[10px] font-medium text-status-empty">
              {fmtInt(data.piezasPastDue)} past-due
            </span>
          ) : null}
        </div>
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
