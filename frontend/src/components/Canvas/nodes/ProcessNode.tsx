import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";

import type { ProcessNodeData } from "@/lib/buildGraph";
import { fmtInt, fmtPlanta } from "@/lib/format";

type Props = NodeProps<Node<ProcessNodeData>>;

/** Tarjeta de un paso de la ruta de fabricacion.
 *
 * Mismo modelo que las cards del Resumen:
 *   - "Inventario total" (numero grande)    = disponibles + recibidas + liberadas
 *     [Solo disponibles + recibidas alimentan el netteo; liberadas es display.]
 *   - 3 metricas: Disponibles / Recibidas / Por transferir
 *   - Pie condicional: badges "Insp." y "Retrab." si > 0
 */
export function ProcessNode({ data }: Props) {
  const total = data.disponibles + data.recibidas + data.liberadas;
  const cubierto = data.reqPaso <= 0;
  const hasFooter = data.enInspeccion > 0 || data.retrabajo > 0;

  const borderCls = data.highlighted
    ? "border-status-pt"
    : cubierto
      ? "border-status-covered/40"
      : data.wipEnPaso > 0
        ? "border-status-partial/50"
        : "border-surface-border";

  const highlightCls = data.highlighted
    ? "ring-2 ring-status-pt/40 ring-offset-2 ring-offset-surface-muted shadow-card"
    : "shadow-soft";

  return (
    <div
      className={`rounded-lg bg-white border ${borderCls} ${highlightCls} overflow-hidden w-[240px] transition-shadow`}
    >
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-ink-subtle !border-0"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-ink-subtle !border-0"
      />

      <div
        className={`px-2.5 py-1 border-b flex items-center justify-between gap-2 ${
          data.highlighted
            ? "bg-status-pt/10 border-status-pt/30"
            : "bg-surface-muted/60 border-surface-border"
        }`}
      >
        <span
          className={`text-[10px] font-medium tabular-nums ${
            data.highlighted ? "text-status-pt" : "text-ink-subtle"
          }`}
        >
          Paso {data.ordenEnRuta}/{data.totalPasos}
        </span>
        {fmtPlanta(data.idPlanta) ? (
          <span className="text-[10px] font-medium text-ink-subtle truncate">
            {fmtPlanta(data.idPlanta)}
          </span>
        ) : null}
      </div>

      <div className="px-2.5 py-2">
        <div
          className="text-xs font-medium text-ink truncate"
          title={data.proceso}
        >
          {data.proceso}
        </div>
        {data.ruta && data.ruta !== data.proceso ? (
          <div
            className="text-[10px] text-ink-subtle truncate"
            title={data.ruta}
          >
            {data.ruta}
          </div>
        ) : null}

        {/* Inventario total */}
        <div className="mt-2">
          <div
            className={`text-lg font-semibold tabular-nums leading-tight ${
              total > 0 ? "text-ink" : "text-ink-subtle"
            }`}
          >
            {fmtInt(total)}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-ink-subtle">
            Inventario total
          </div>
        </div>

        {/* Desglose en 3 metricas */}
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Metric
            value={data.disponibles}
            label="Disp."
            colorCls="text-status-covered"
          />
          <Metric
            value={data.recibidas}
            label="Recib."
            colorCls="text-status-partial"
          />
          <Metric
            value={data.liberadas}
            label="Trans."
            colorCls="text-status-pt"
          />
        </div>

        {/* Pie condicional: Inspeccion / Retrabajo */}
        {hasFooter ? (
          <div className="mt-2 pt-2 border-t border-surface-border flex items-center gap-1.5 text-[10px]">
            {data.enInspeccion > 0 ? (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-status-empty/10 text-status-empty font-medium tabular-nums">
                <Dot />
                {fmtInt(data.enInspeccion)} insp.
              </span>
            ) : null}
            {data.retrabajo > 0 ? (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-status-partial/10 text-status-partial font-medium tabular-nums">
                <Dot />
                {fmtInt(data.retrabajo)} retrab.
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface MetricProps {
  value: number;
  label: string;
  colorCls: string;
}

function Metric({ value, label, colorCls }: MetricProps) {
  const dim = value <= 0;
  return (
    <div className="flex flex-col leading-none min-w-0">
      <span
        className={`text-sm font-semibold tabular-nums truncate ${
          dim ? "text-ink-subtle" : colorCls
        }`}
        title={String(value)}
      >
        {fmtInt(value)}
      </span>
      <span
        className={`text-[9px] mt-0.5 ${dim ? "text-ink-subtle" : "text-ink-muted"}`}
      >
        {label}
      </span>
    </div>
  );
}

function Dot() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 8 8"
      fill="currentColor"
      aria-hidden="true"
      className="w-1.5 h-1.5"
    >
      <circle cx="4" cy="4" r="4" />
    </svg>
  );
}
