import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";

import { BucketBadge } from "@/components/ui/BucketRow";
import { Tooltip } from "@/components/ui/Tooltip";
import type { ProcessNodeData } from "@/lib/buildGraph";
import { fmtInt, fmtPlanta } from "@/lib/format";
import { useUiStore } from "@/store/useUiStore";

type Props = NodeProps<Node<ProcessNodeData>>;

/** Tarjeta compacta de un paso de la ruta de fabricacion de un componente.
 *
 *   (n/N) Proceso                    Planta
 *   Sub-rutas que lo componen
 *   ●───●───●              67,782
 *   Disp Recib Transf      requerido
 *
 * El pipeline (Disponibles > Recibidas > Por transferir) siempre se muestra.
 * El numero de requerimiento solo aparece en modo Requerimiento, alineado a
 * la derecha en la misma fila que el pipeline para mantener la tarjeta baja.
 *
 * `req_paso` YA descuenta el material que este proceso libero: una etiqueta
 * que salio de X hacia Y se cuenta como PorTransferir en X y como
 * Disponibles en Y, y la formula del netteo (req_bruto - Σ wip_en_paso
 * downstream, inclusiva) la descuenta via el termino de Y. Restarle ademas
 * `liberadas` seria doble conteo. Ver backend/docs/algoritmo-netteo.md.
 */
export function ProcessNode({ data }: Props) {
  const mode = useUiStore((s) => s.mode);
  const esRequerimiento = mode === "requerimiento";

  // `cubierto` = ya no falta que llegue nada de aguas arriba. OJO: el numero
  // grande es `faltante` (la carga del proceso), que puede ser > 0 aunque este
  // cubierto — significa "hay que procesar N y las N ya estan aqui".
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

      {/* Encabezado: badge de paso (n/N) + proceso a la izquierda, planta a la derecha */}
      <div className="px-2 pt-1 flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`inline-flex items-center justify-center shrink-0 h-4 min-w-[16px] px-0.5 rounded-full border text-[8px] font-semibold tabular-nums leading-none ${
              data.highlighted
                ? "border-status-pt text-status-pt"
                : "border-ink-subtle/40 text-ink-subtle"
            }`}
            title={`Paso ${data.ordenEnRuta} de ${data.totalPasos}`}
          >
            {data.ordenEnRuta}/{data.totalPasos}
          </span>
          <span
            className="text-xs font-semibold text-ink truncate"
            title={data.proceso}
          >
            {data.proceso}
          </span>
        </div>
        {fmtPlanta(data.idPlanta) ? (
          <span className="text-[10px] font-medium text-ink-subtle shrink-0">
            {fmtPlanta(data.idPlanta)}
          </span>
        ) : null}
      </div>

      {/* Sub-rutas que conforman el proceso (ej. "Robot / Limpieza / Manual") */}
      {data.ruta && data.ruta !== data.proceso ? (
        <div
          className="px-2 pt-0.5 text-[9px] text-ink-subtle truncate"
          title={data.ruta}
        >
          {data.ruta}
        </div>
      ) : null}

      {/* Pipeline compacto + requerimiento (solo en modo Requerimiento) */}
      <div className="px-2 py-1 flex items-center gap-2">
        <MiniPipeline
          enInspeccionSig={data.enInspeccionSig}
          disponibles={data.disponibles}
          recibidas={data.recibidas}
          liberadas={data.liberadas}
          muted={esRequerimiento}
        />

        {esRequerimiento ? (
          <div
            className="shrink-0 text-right leading-none"
            title={
              `${fmtInt(data.faltante)} piezas tiene que procesar ${data.proceso}: ` +
              `${fmtInt(data.wipEnPaso)} ya esperan aqui y ` +
              `${fmtInt(data.reqPaso)} aun deben llegar de los pasos anteriores.`
            }
          >
            <div
              className={`text-lg font-bold tabular-nums tracking-tight ${
                cubierto ? "text-status-covered" : "text-ink"
              }`}
            >
              {fmtInt(data.faltante)}
            </div>
            <div className="text-[8px] uppercase tracking-wide text-ink-subtle mt-0.5">
              {cubierto ? "a procesar · completo" : "a procesar"}
            </div>
          </div>
        ) : null}
      </div>

      {hasFooter ? (
        <div className="px-2 pb-1 -mt-0.5 flex items-center justify-center gap-1">
          {data.enInspeccion > 0 ? (
            <BucketBadge value={data.enInspeccion} bucket="Inspeccion" />
          ) : null}
          {data.retrabajo > 0 ? (
            <BucketBadge value={data.retrabajo} bucket="Retrabajo" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface Stage {
  value: number;
  label: string;
  dotCls: string;
  main: boolean;
}

interface MiniPipelineProps {
  /** En QC camino a este proceso. Desde 2026-08-03 SI descuenta demanda, asi que
   *  se muestra: sin el, wipEnPaso seria un numero que no cuadra con la suma. */
  enInspeccionSig: number;
  disponibles: number;
  recibidas: number;
  liberadas: number;
  /** Atenua el pipeline completo — usado cuando el numero grande es el requerimiento. */
  muted?: boolean;
}

/** Pipeline [En QC ->] Disponibles -> Recibidas -> Por transferir: puntos
 *  conectados por una linea. El punto se enciende (color del bucket) si su valor
 *  es > 0; "Recibidas" es el paso central y se muestra con enfasis. La etapa
 *  "En QC" solo aparece cuando hay algo en ella — es poco frecuente y no vale
 *  gastarle ancho al nodo cuando esta en cero. */
function MiniPipeline({
  enInspeccionSig, disponibles, recibidas, liberadas, muted = false,
}: MiniPipelineProps) {
  const stages: Stage[] = [
    ...(enInspeccionSig > 0
      ? [{ value: enInspeccionSig, label: "En QC", dotCls: "bg-status-partial", main: false }]
      : []),
    { value: disponibles, label: "Disponibles", dotCls: "bg-status-covered", main: false },
    { value: recibidas, label: "Recibidas", dotCls: "bg-ink", main: true },
    { value: liberadas, label: "Por transferir", dotCls: "bg-status-pt", main: false },
  ];

  return (
    <div className={`flex-1 min-w-0 ${muted ? "opacity-60" : ""}`}>
      <div className="flex items-center">
        {stages.map((s, i) => (
          <PipelineDot key={s.label} stage={s} isLast={i === stages.length - 1} />
        ))}
      </div>
      <div className="flex items-center justify-between mt-1">
        {stages.map((s) => (
          <span
            key={s.label}
            className={`tabular-nums leading-none ${s.main ? "text-xs" : "text-[9px]"} ${
              s.value > 0 ? "font-semibold text-ink" : "text-ink-subtle"
            }`}
          >
            {fmtInt(s.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

function PipelineDot({ stage, isLast }: { stage: Stage; isLast: boolean }) {
  return (
    <>
      <Tooltip content={`${stage.label}: ${fmtInt(stage.value)}`} side="top">
        <span
          className={`nodrag h-1.5 w-1.5 rounded-full shrink-0 ${
            stage.value > 0 ? stage.dotCls : "bg-surface-border"
          }`}
        />
      </Tooltip>
      {!isLast ? (
        <span className="flex-1 h-px bg-surface-border mx-0.5" aria-hidden="true" />
      ) : null}
    </>
  );
}
