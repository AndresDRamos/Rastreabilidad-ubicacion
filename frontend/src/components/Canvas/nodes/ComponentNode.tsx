import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";

import { Tooltip } from "@/components/ui/Tooltip";
import { useUiStore } from "@/store/useUiStore";
import type { ComponentNodeData, Status } from "@/lib/buildGraph";
import type { ReqUniverso } from "@/api/types";
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
  // Card del intermedio — los dos modos son complementarios sobre el MISMO
  // universo de piezas (wipTotal + reqNeto cubren reqBruto):
  //   inventario    -> wipTotal: todas las piezas del componente en piso, en
  //     cualquier proceso de su ruta (incluido el buffer Almacen WIP).
  //   requerimiento -> reqNeto: lo que falta fabricar, = max(0, reqBruto - wipTotal).
  const valor = mode === "inventario" ? data.wipTotal : data.reqNeto;
  // Cuando el componente lo reclaman varios PT, `wipTotal` es la CUOTA que el
  // reparto FIFO asigno a este arbol y `wipFisico` lo que hay en el piso. Se
  // muestran los dos ("13,900 de 15,430 en piso") para que el reparto sea
  // visible en vez de parecer que faltan piezas.
  const repartido = data.wipFisico > data.wipTotal + 0.5;
  const subLabel =
    mode === "inventario"
      ? repartido
        ? `de ${fmtInt(data.wipFisico)} en piso`
        : "en piso"
      : "por fabricar";

  const ring = STATUS_RING[data.status];
  const badgeCls = STATUS_BADGE_BG[data.status];
  // "Sin WIP" mentiria cuando SI hay piezas en piso pero se las llevaron PT mas
  // urgentes: el componente no esta desabastecido, esta comprometido.
  const badgeText =
    data.status === "empty" && repartido
      ? "Asignado a otros"
      : STATUS_LABEL[data.status];
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
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badgeCls}`}
            title={
              data.status === "empty" && repartido
                ? `Hay ${fmtInt(data.wipFisico)} pzs en piso, pero las reclaman PT con promesa mas vencida. A este arbol no le toca ninguna.`
                : undefined
            }
          >
            {badgeText}
          </span>
        </div>
      </div>

      <div className="px-3 pt-2.5 pb-2">
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
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tabular-nums text-ink leading-none">
                {fmtInt(valor)}
              </span>
              <span className="text-xs text-ink-muted">{subLabel}</span>
            </div>
          </div>
          <PartThumbnail clave={data.clave} />
        </div>

        <div className="flex items-center justify-between gap-2 mt-1">
          <CompartidoLegend reqUniverso={data.reqUniverso} mode={mode} />
          {data.cantPadre > 1 ? (
            <Tooltip
              content={`Este componente lleva ${fmtInt(data.cantPadre)} piezas por cada unidad del PT.`}
              side="bottom"
            >
              <span className="text-[10px] text-ink-subtle tabular-nums shrink-0 cursor-help">
                ×{data.cantPadre}
              </span>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Leyenda del componente compartido entre varios PTs.
 *
 * El numero grande de la card es el requerimiento del ARBOL ABIERTO; esta
 * leyenda muestra el del UNIVERSO (todos los PTs con demanda que lo piden).
 *
 * Los dos numeros NO cuadran, y es correcto: el arbol se atribuye el 100% del
 * WIP fisico del componente, mientras que el universo reparte ese mismo WIP
 * entre todos los que lo reclaman. Por eso el tooltip lo advierte de forma
 * explicita — si no, el planner leeria el WIP de la card como si fuera suyo.
 */
function CompartidoLegend({
  reqUniverso,
  mode,
}: {
  reqUniverso: ReqUniverso | null;
  mode: "inventario" | "requerimiento";
}) {
  // Solo aporta cuando el componente vive bajo mas de un PT: si es exclusivo de
  // este arbol, el universo y el arbol dicen lo mismo y la leyenda seria ruido.
  if (!reqUniverso || reqUniverso.n_pts <= 1) return null;

  // En modo inventario NO se repite el numero: el WIP fisico es unico, asi que
  // el total del universo es identico al `wipTotal` que ya muestra la card en
  // grande. Lo que si aporta es avisar de que ese inventario esta disputado.
  const esInventario = mode === "inventario";
  const valor = esInventario ? reqUniverso.n_pts : reqUniverso.req_neto_total;
  const etiqueta = esInventario ? "PTs lo piden" : "req. total";

  const listado = reqUniverso.pts.slice(0, 8).join(", ");
  const resto = reqUniverso.n_pts - Math.min(reqUniverso.pts.length, 8);

  const tooltip = (
    <div className="space-y-1.5">
      <div className="font-semibold">
        Compartido con {reqUniverso.n_pts} PTs
      </div>
      <div className="text-white/80">
        Requerimiento total: {fmtInt(reqUniverso.req_neto_total)} pzs
        {" · "}
        WIP en piso: {fmtInt(reqUniverso.wip_total)} pzs
      </div>
      <div className="text-white/60">
        {listado}
        {resto > 0 ? ` y ${resto} más` : ""}
      </div>
      <div className="text-white/80 border-t border-white/20 pt-1">
        {esInventario ? (
          <>
            Esas piezas <b>no están reservadas</b> para este árbol: los otros PTs
            de la lista las reclaman con el mismo derecho.
          </>
        ) : (
          <>
            El número grande es lo que pide <b>este</b> PT, descontando todo el
            WIP. Como ese WIP también lo reclaman los otros PTs, los dos números
            no cuadran a propósito.
          </>
        )}
      </div>
    </div>
  );

  return (
    <Tooltip content={tooltip} side="bottom">
      <span className="nodrag inline-flex items-center gap-1 min-w-0 cursor-help rounded px-1 py-0.5 bg-status-pt/5 border border-status-pt/25 hover:bg-status-pt/10 transition">
        <SharedIcon />
        <span className="text-[10px] tabular-nums font-medium text-status-pt truncate">
          {fmtInt(valor)}
        </span>
        <span className="text-[9px] text-ink-subtle truncate">{etiqueta}</span>
      </span>
    </Tooltip>
  );
}

/** Icono de "compartido": un nodo que se bifurca hacia dos padres. */
function SharedIcon() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="w-[9px] h-[9px] shrink-0 text-status-pt"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="2" cy="2" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="2" r="1.2" fill="currentColor" stroke="none" />
      <path d="M6 9V6M6 6L2 3M6 6l4-3" />
    </svg>
  );
}
