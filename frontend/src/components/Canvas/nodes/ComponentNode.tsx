import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";

import { useUiStore } from "@/store/useUiStore";
import type { ComponentNodeData, Status } from "@/lib/buildGraph";
import { fmtInt } from "@/lib/format";
import { PartThumbnail } from "./PartThumbnail";

const STATUS_RING: Record<Status, string> = {
  pt: "border-status-pt",
  covered: "border-status-covered",
  partial: "border-status-partial",
  empty: "border-status-empty",
  neutral: "border-status-neutral",
};

const STATUS_BADGE_BG: Record<Status, string> = {
  pt: "bg-status-pt/10 text-status-pt",
  covered: "bg-status-covered/10 text-status-covered",
  partial: "bg-status-partial/10 text-status-partial",
  empty: "bg-status-empty/10 text-status-empty",
  neutral: "bg-status-neutral/10 text-status-neutral",
};

const STATUS_LABEL: Record<Status, string> = {
  pt: "PT",
  covered: "Cubierto",
  partial: "Parcial",
  empty: "Sin WIP",
  neutral: "Sin demanda",
};

type Props = NodeProps<Node<ComponentNodeData>>;

export function ComponentNode({ data }: Props) {
  const mode = useUiStore((s) => s.mode);
  // Card del intermedio:
  //   inventario   -> piezas listas en el buffer Almacen WIP (wipBuffer)
  //   requerimiento -> piezas que aun faltan para cubrir al padre (reqBufferFaltante)
  const valor = mode === "inventario" ? data.wipBuffer : data.reqBufferFaltante;
  const subLabel = mode === "inventario" ? "en buffer" : "por fabricar";

  const ring = STATUS_RING[data.status];
  const badgeCls = STATUS_BADGE_BG[data.status];
  const badgeText = STATUS_LABEL[data.status];

  return (
    <div
      className={`rounded-xl shadow-soft bg-white border ${ring} overflow-hidden w-[240px] ${data.expandable ? "cursor-pointer" : ""}`}
    >
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-ink-subtle !border-0" />
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-ink-subtle !border-0" />

      <div className="px-3 py-1.5 border-b border-surface-border flex items-center justify-between">
        <span className="text-[10px] font-medium text-ink-subtle">Nivel {data.nivel}</span>
        <div className="flex items-center gap-1.5">
          {data.expandable ? (
            <span className="text-[10px] text-ink-subtle font-medium select-none">
              {data.expanded ? "▼ procesos" : "▶ procesos"}
            </span>
          ) : null}
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badgeCls}`}>
            {badgeText}
          </span>
        </div>
      </div>

      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-sm font-medium text-ink truncate">{data.clave}</div>
            {data.descripcion ? (
              <div
                className="text-[11px] text-ink-muted truncate"
                title={data.descripcion}
              >
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
      </div>
    </div>
  );
}
