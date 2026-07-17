import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";

import type { FlujoPlantaNodeData, FlujoPlantaVecino } from "@/lib/buildFlujoPlantas";
import { fmtInt } from "@/lib/format";
import { Tooltip } from "@/components/ui/Tooltip";
import { useUiStore } from "@/store/useUiStore";

type Props = NodeProps<Node<FlujoPlantaNodeData>>;

/** Lista de vecinos para el tooltip "viene de" / "va a" (nivel planta). */
function Vecinos({ titulo, items }: { titulo: string; items: FlujoPlantaVecino[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-white/60">{titulo}</div>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((v, i) => (
          <li key={`${v.label}-${i}`} className="flex items-center justify-between gap-3">
            <span className="truncate">{v.label}</span>
            <span className="tabular-nums text-white/70">
              {fmtInt(v.componentes)} comp
              {v.piezas > 0 ? ` · ${fmtInt(v.piezas)} en tránsito` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Bloque del overview = una planta. Resume el WIP interno total de la planta y
 *  es clickeable para hacer drill-in a su grafo interno de procesos. */
export function FlujoPlantaNode({ data }: Props) {
  const setFlujoPlantaDrill = useUiStore((s) => s.setFlujoPlantaDrill);

  const interno = data.recibidas + data.disponibles;
  const hasFooter = data.inspeccion > 0 || data.retrabajo > 0;

  const tooltip = (
    <div className="space-y-1.5">
      <div className="font-semibold">{data.nombre}</div>
      <div className="text-white/70">
        {fmtInt(data.procesos)} procesos · {fmtInt(data.materiales)} materiales ·{" "}
        {fmtInt(data.etiquetas)} etiquetas
      </div>
      <Vecinos titulo="Recibe de" items={data.entradas} />
      <Vecinos titulo="Envía a" items={data.salidas} />
      <div className="text-white/50 pt-0.5">Click para ver sus procesos →</div>
    </div>
  );

  const drill = () => {
    if (data.idPlanta == null) return;
    setFlujoPlantaDrill({ idPlanta: data.idPlanta, nombre: data.nombre });
  };

  const borderCls = data.hovered
    ? "border-status-pt ring-2 ring-status-pt/30"
    : data.vacio
      ? "border-dashed border-surface-border"
      : data.recibidas > 0
        ? "border-status-partial/50"
        : "border-surface-border";

  return (
    <div
      className={`relative rounded-xl bg-white border ${borderCls} shadow-soft overflow-hidden w-[280px] transition ${
        data.dimmed ? "opacity-40" : data.vacio ? "opacity-70" : "opacity-100"
      } ${data.idPlanta != null ? "cursor-pointer hover:shadow-card" : ""}`}
      onClick={drill}
      role={data.idPlanta != null ? "button" : undefined}
    >
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-ink-subtle !border-0" />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-ink-subtle !border-0" />

      <Tooltip content={tooltip} side="top">
        <div className="px-3 py-2 border-b border-surface-border flex items-center justify-between gap-2 cursor-pointer">
          <span className="text-sm font-semibold text-ink truncate">{data.nombre}</span>
          <span className="text-[11px] font-medium text-ink-subtle shrink-0">
            {fmtInt(data.procesos)} proc.
          </span>
        </div>
      </Tooltip>

      <div className="flex items-end justify-center gap-3 px-3 py-3">
        <Metric value={data.disponibles} label="Disponibles" color="text-status-covered" size="sm" />
        <Metric value={data.recibidas} label="Recibidas" color="text-ink" size="lg" />
      </div>

      <div className="px-3 pb-2 flex items-center justify-center gap-2 text-[11px]">
        {hasFooter ? (
          <>
            {data.inspeccion > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-status-partial/15 text-status-partial font-semibold tabular-nums">
                <span className="h-1.5 w-1.5 rounded-full bg-status-partial" />
                {fmtInt(data.inspeccion)} insp.
              </span>
            ) : null}
            {data.retrabajo > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-status-empty/15 text-status-empty font-semibold tabular-nums">
                <span className="h-1.5 w-1.5 rounded-full bg-status-empty" />
                {fmtInt(data.retrabajo)} retrab.
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-ink-subtle tabular-nums">
            {fmtInt(interno)} piezas en piso
          </span>
        )}
      </div>
    </div>
  );
}

function Metric({
  value,
  label,
  color,
  size,
}: {
  value: number;
  label: string;
  color: string;
  size: "sm" | "lg";
}) {
  const numberCls = size === "lg" ? "text-3xl font-bold" : "text-lg font-semibold";
  return (
    <div className="text-center">
      <div className={`tabular-nums leading-none ${numberCls} ${value > 0 ? color : "text-ink-subtle"}`}>
        {fmtInt(value)}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-ink-subtle mt-1">{label}</div>
    </div>
  );
}
