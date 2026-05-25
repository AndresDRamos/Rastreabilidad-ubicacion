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

const STATUS_BTN_FILLED: Record<Status, string> = {
  pt: "bg-status-pt text-white",
  covered: "bg-status-covered text-white",
  partial: "bg-status-partial text-white",
  empty: "bg-status-empty text-white",
  neutral: "bg-status-neutral text-white",
};

const STATUS_BTN_OUTLINED: Record<Status, string> = {
  pt: "border border-status-pt text-status-pt",
  covered: "border border-status-covered text-status-covered",
  partial: "border border-status-partial text-status-partial",
  empty: "border border-status-empty text-status-empty",
  neutral: "border border-status-neutral text-status-neutral",
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
  const btnCls = data.expanded
    ? STATUS_BTN_FILLED[data.status]
    : STATUS_BTN_OUTLINED[data.status];

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
            <span
              className={`
                pointer-events-none select-none
                inline-flex items-center gap-1
                text-[10px] font-medium leading-none
                px-2 py-1 rounded-full
                transition-colors duration-150
                ${btnCls}
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
