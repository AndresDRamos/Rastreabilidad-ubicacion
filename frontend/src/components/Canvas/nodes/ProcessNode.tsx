import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";

import { useUiStore } from "@/store/useUiStore";
import type { ProcessNodeData } from "@/lib/buildGraph";
import { fmtInt, fmtPlanta } from "@/lib/format";

type Props = NodeProps<Node<ProcessNodeData>>;

export function ProcessNode({ data }: Props) {
  const mode = useUiStore((s) => s.mode);
  const valor = mode === "inventario" ? data.wipEnPaso : data.reqPaso;
  const subLabel = mode === "inventario" ? "en este paso" : "por procesar";

  // Tono mas ligero cuando el paso esta cubierto (req_paso=0).
  const cubierto = data.reqPaso <= 0;
  const borderCls = cubierto
    ? "border-status-covered/40"
    : data.wipEnPaso > 0
      ? "border-status-partial/50"
      : "border-surface-border";

  return (
    <div
      className={`rounded-lg shadow-soft bg-white border ${borderCls} overflow-hidden w-[180px]`}
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

      <div className="px-2.5 py-1 border-b border-surface-border bg-surface-muted/60 flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-ink-subtle tabular-nums">
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

        <div className="mt-1.5 flex items-baseline gap-1">
          <span className="text-lg font-semibold tabular-nums text-ink leading-none">
            {fmtInt(valor)}
          </span>
          <span className="text-[10px] text-ink-muted">{subLabel}</span>
        </div>
      </div>
    </div>
  );
}
