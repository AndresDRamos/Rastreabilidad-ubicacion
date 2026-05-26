import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";

import type { ProcessNodeData } from "@/lib/buildGraph";
import { fmtInt, fmtPlanta } from "@/lib/format";

type Props = NodeProps<Node<ProcessNodeData>>;

/** Tarjeta de un paso de la ruta de fabricación.
 *
 * Muestra tres ángulos del proceso, independientes del toggle Inv/Req del
 * componente padre:
 *   - Por procesar : piezas LIBERADAS del proceso anterior, esperando entrar.
 *                    (= `wipEnPaso`, el bucket que alimenta el netteo.)
 *   - Liberadas    : piezas que YA salieron de este proceso y esperan al siguiente.
 *   - En Inspección: piezas que pasaron por este proceso y están en QC.
 */
export function ProcessNode({ data }: Props) {
  const cubierto = data.reqPaso <= 0;
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
      className={`rounded-lg bg-white border ${borderCls} ${highlightCls} overflow-hidden w-[220px] transition-shadow`}
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
        <div className="text-xs font-medium text-ink truncate" title={data.proceso}>
          {data.proceso}
        </div>
        {data.ruta && data.ruta !== data.proceso ? (
          <div className="text-[10px] text-ink-subtle truncate" title={data.ruta}>
            {data.ruta}
          </div>
        ) : null}

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Metric
            value={data.wipEnPaso}
            label="Por procesar"
            colorCls="text-status-covered"
          />
          <Metric
            value={data.liberadas}
            label="Liberadas"
            colorCls="text-status-pt"
          />
          <Metric
            value={data.enInspeccion}
            label="En Inspección"
            colorCls="text-status-partial"
          />
        </div>
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
    <div className="flex flex-col leading-none">
      <span
        className={`text-base font-semibold tabular-nums ${
          dim ? "text-ink-subtle" : colorCls
        }`}
      >
        {fmtInt(value)}
      </span>
      <span className={`text-[9px] mt-0.5 ${dim ? "text-ink-subtle" : "text-ink-muted"}`}>
        {label}
      </span>
    </div>
  );
}
