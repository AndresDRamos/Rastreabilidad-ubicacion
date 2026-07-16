import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";

import type { FlujoNodeData, FlujoVecino } from "@/lib/buildFlujo";
import { fmtInt, fmtPlanta } from "@/lib/format";
import { Tooltip } from "@/components/ui/Tooltip";
import { useUiStore } from "@/store/useUiStore";

type Props = NodeProps<Node<FlujoNodeData>>;

/** ">" — chevron que ilustra el avance del material de izquierda a derecha. */
function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3 shrink-0 text-ink-subtle"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Lista de vecinos para el tooltip "viene de" / "va a". */
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

/** Bloque del grafo de Flujo = un proceso (agrupado por nombre) en una planta.
 *  Diseño compacto que sigue el avance del material en una sola fila:
 *    Disponibles (verde, en camino) → Recibidas (en proceso) → Liberado (azul, sale)
 *  con Inspeccion (ambar) / Retrabajo (rojo) como badges al pie. Una sola entrada
 *  y una sola salida por nodo; el significado vive en tooltips.
 */
export function FlujoProcessNode({ data }: Props) {
  const setBloqueDetalle = useUiStore((s) => s.setBloqueDetalle);

  const idProceso = data.idProceso;
  const planta = fmtPlanta(data.idPlanta) ?? data.nombrePlanta;
  const disponiblesView = data.disponiblesEntrantes;

  const openDetalle = (
    bucket: "Recibidas" | "Disponibles" | "PorTransferir" | "Inspeccion" | "Retrabajo",
  ) => {
    if (idProceso == null) return;
    setBloqueDetalle({ idProceso, nombreProceso: data.proceso, bucket });
  };

  const borderCls = data.hovered
    ? "border-status-pt ring-2 ring-status-pt/30"
    : data.vacio
      ? "border-dashed border-surface-border"
      : data.recibidas > 0
        ? "border-status-partial/50"
        : "border-surface-border";

  const hasFooter = data.inspeccion > 0 || data.retrabajo > 0;

  const nodeTooltip = (
    <div className="space-y-1.5">
      <div className="font-semibold">
        {data.proceso}
        {planta ? <span className="text-white/70"> · {planta}</span> : null}
      </div>
      <Vecinos titulo="Viene de" items={data.entradas} />
      <Vecinos titulo="Va a" items={data.salidas} />
      {data.entradas.length === 0 && data.salidas.length === 0 ? (
        <div className="text-white/60">Sin conexiones de ruta.</div>
      ) : null}
    </div>
  );

  return (
    <div
      className={`relative rounded-xl bg-white border ${borderCls} shadow-soft overflow-hidden w-[260px] transition ${
        data.dimmed ? "opacity-40" : data.vacio ? "opacity-70" : "opacity-100"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-ink-subtle !border-0" />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-ink-subtle !border-0" />

      <Tooltip content={nodeTooltip} side="top">
        <div className="px-3 py-1.5 border-b border-surface-border flex items-center justify-between gap-2 cursor-help">
          <span className="min-w-0 flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-ink truncate">{data.proceso}</span>
            {data.fase != null && data.fase > 1 ? (
              <span
                className="shrink-0 rounded-full bg-status-pt/10 text-status-pt text-[10px] font-semibold px-1.5 leading-4"
                title={`${data.fase}ª aparición de ${data.proceso} en la ruta`}
              >
                {data.fase}ª
              </span>
            ) : null}
          </span>
          {planta ? (
            <span className="text-[11px] font-medium text-ink-subtle shrink-0">{planta}</span>
          ) : null}
        </div>
      </Tooltip>

      <div className="flex items-center justify-center gap-2 px-3 py-2.5">
        {/* Disponibles — en camino. Verde, justificado a la izquierda. */}
        <Tooltip
          content="Disponibles — material liberado que viene en camino a este proceso (suma de las aristas entrantes)."
          side="bottom"
        >
          <button
            type="button"
            disabled={idProceso == null || disponiblesView <= 0}
            onClick={(e) => {
              e.stopPropagation();
              openDetalle("Disponibles");
            }}
            className={`nodrag rounded px-1 py-0.5 text-lg font-semibold tabular-nums leading-none transition ${
              disponiblesView > 0
                ? "text-status-covered cursor-pointer hover:bg-status-covered/10"
                : "text-ink-subtle cursor-default"
            }`}
          >
            {fmtInt(disponiblesView)}
          </button>
        </Tooltip>

        <Chevron />

        {/* Recibidas — en proceso. Numero principal, centrado. */}
        <Tooltip
          content="Recibidas — material ya recibido y fisicamente en este proceso, listo para procesarse."
          side="bottom"
        >
          <button
            type="button"
            disabled={idProceso == null || data.recibidas <= 0}
            onClick={(e) => {
              e.stopPropagation();
              openDetalle("Recibidas");
            }}
            className={`nodrag rounded px-1.5 py-0.5 text-3xl font-bold tabular-nums leading-none transition ${
              data.recibidas > 0 ? "text-ink cursor-pointer hover:bg-surface-subtle" : "text-ink-subtle cursor-default"
            }`}
          >
            {fmtInt(data.recibidas)}
          </button>
        </Tooltip>

        <Chevron />

        {/* Liberado — sale del proceso. Azul, justificado a la derecha. */}
        <Tooltip
          content="Liberado — material que este proceso ya libero y va en tránsito al siguiente paso (suma de las aristas salientes)."
          side="bottom"
        >
          <button
            type="button"
            disabled={idProceso == null || data.liberado <= 0}
            onClick={(e) => {
              e.stopPropagation();
              openDetalle("PorTransferir");
            }}
            className={`nodrag rounded px-1 py-0.5 text-lg font-semibold tabular-nums leading-none transition ${
              data.liberado > 0
                ? "text-status-pt cursor-pointer hover:bg-status-pt/10"
                : "text-ink-subtle cursor-default"
            }`}
          >
            {fmtInt(data.liberado)}
          </button>
        </Tooltip>
      </div>

      {hasFooter ? (
        <div className="px-3 pb-2 -mt-1 flex items-center justify-center gap-2">
          {data.inspeccion > 0 ? (
            <Tooltip content="En inspeccion — material detenido en control de calidad. Click para ver etiquetas." side="bottom">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openDetalle("Inspeccion");
                }}
                className="nodrag inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-status-partial/15 text-status-partial text-[11px] font-semibold tabular-nums cursor-pointer transition hover:bg-status-partial/25"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-status-partial" />
                {fmtInt(data.inspeccion)} inspección
              </button>
            </Tooltip>
          ) : null}
          {data.retrabajo > 0 ? (
            <Tooltip content="Retrabajo — material rechazado que debe reprocesarse. Click para ver etiquetas." side="bottom">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openDetalle("Retrabajo");
                }}
                className="nodrag inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-status-empty/15 text-status-empty text-[11px] font-semibold tabular-nums cursor-pointer transition hover:bg-status-empty/25"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-status-empty" />
                {fmtInt(data.retrabajo)} retrabajo
              </button>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
