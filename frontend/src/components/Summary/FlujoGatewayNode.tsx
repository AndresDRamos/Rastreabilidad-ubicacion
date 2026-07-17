import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";

import type { FlujoNodeData, FlujoVecino } from "@/lib/buildFlujo";
import { fmtInt } from "@/lib/format";
import { Tooltip } from "@/components/ui/Tooltip";

type Props = NodeProps<Node<FlujoNodeData>>;

/** Lista de vecinos para el tooltip. */
function Vecinos({ titulo, items }: { titulo: string; items: FlujoVecino[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-white/60">{titulo}</div>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((v, i) => (
          <li key={`${v.label}-${i}`} className="flex items-center justify-between gap-3">
            <span className="truncate">{v.label}</span>
            <span className="tabular-nums text-white/70">{fmtInt(v.piezas)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Nodo-PUERTA: una planta externa que surte (direccion 'in', borde izquierdo) o
 *  recibe (direccion 'out', borde derecho) material en el drill-in de una planta.
 *  Es la "salida/entrada alterna" al flujo interno: el material cruza de planta.
 *  El número es el material en tránsito por esa frontera. */
export function FlujoGatewayNode({ data }: Props) {
  const entra = data.direccion === "in";
  // 'in': la puerta SURTE -> su transito sale de ella (liberado).
  // 'out': la puerta RECIBE -> su transito llega a ella (disponiblesEntrantes).
  const transito = entra ? data.liberado : data.disponiblesEntrantes;
  const vecinos = entra ? data.salidas : data.entradas;

  const tooltip = (
    <div className="space-y-1.5">
      <div className="font-semibold">
        {data.nombrePlantaVecina}
        <span className="text-white/70"> · {entra ? "surte a esta planta" : "recibe de esta planta"}</span>
      </div>
      <Vecinos titulo={entra ? "Alimenta procesos" : "Enviado desde"} items={vecinos} />
      {vecinos.length === 0 ? (
        <div className="text-white/60">Sin material en tránsito ahora.</div>
      ) : null}
    </div>
  );

  return (
    <div
      className={`relative rounded-xl bg-surface-muted border border-dashed shadow-soft w-[168px] transition ${
        data.hovered ? "border-status-pt ring-2 ring-status-pt/30" : "border-surface-border"
      } ${data.dimmed ? "opacity-40" : "opacity-100"}`}
    >
      {/* La puerta 'in' es fuente (handle derecho); la 'out' es destino (handle izq). */}
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-ink-subtle !border-0" />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-ink-subtle !border-0" />

      <Tooltip content={tooltip} side="top">
        <div className="px-3 py-2 flex items-center gap-2 cursor-help">
          <span className="text-status-pt text-base leading-none shrink-0" aria-hidden="true">
            {entra ? "→" : "←"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-ink-subtle leading-none">
              {entra ? "Surte" : "Recibe"}
            </div>
            <div className="text-[13px] font-semibold text-ink truncate leading-tight">
              {data.nombrePlantaVecina}
            </div>
          </div>
          <div
            className={`tabular-nums text-sm font-semibold shrink-0 ${
              transito > 0 ? "text-status-pt" : "text-ink-subtle"
            }`}
          >
            {fmtInt(transito)}
          </div>
        </div>
      </Tooltip>
    </div>
  );
}
