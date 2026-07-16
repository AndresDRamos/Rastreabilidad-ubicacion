/**
 * BucketRow — primitivas de la "fila direccional" de inventario.
 *
 * Canon visual unico del proyecto para mostrar el WIP alrededor de un proceso:
 * el material avanza Disponibles > Recibidas > Por transferir, con la metrica
 * central como numero dominante y los flancos como entrada/salida.
 *
 *     [Disponibles]  >  [ RECIBIDAS ]  >  [Por transferir]
 *        verde            grande             azul
 *
 * Lo consumen las tarjetas del Resumen (SummaryView), los nodos del grafo de
 * Flujo (FlujoProcessNode) y los nodos de proceso del arbol (ProcessNode).
 * Antes cada uno tenia su propia copia de Chevron/Dot y su propio mapa de
 * color, que habian divergido entre si — este modulo es la fuente unica.
 */

import type { ReactNode } from "react";

import { fmtInt } from "@/lib/format";

/** Buckets de WIP alrededor de un proceso. Espeja `BloqueBucket` de api/types. */
export type BucketKind =
  | "Disponibles"
  | "Recibidas"
  | "PorTransferir"
  | "Inspeccion"
  | "Retrabajo"
  | "Encaminadas";

/** Etiqueta legible de cada bucket. */
export const BUCKET_LABEL: Record<BucketKind, string> = {
  Disponibles: "Disponibles",
  Recibidas: "Recibidas",
  PorTransferir: "Por transferir",
  Inspeccion: "Inspección",
  Retrabajo: "Retrabajo",
  Encaminadas: "Encaminadas",
};

/**
 * Canon de color por bucket. Fijado a partir de las tarjetas del Resumen, que
 * son el diseno de referencia.
 *
 * Recibidas va en `text-ink` a proposito: es el numero dominante de la fila y
 * se lee como "lo que esta aqui", no como un estado de alerta. Inspeccion es
 * rojo (material detenido en QC) y Retrabajo ambar (material que reprocesa).
 */
export const BUCKET_COLOR: Record<BucketKind, string> = {
  Disponibles: "text-status-covered",
  Recibidas: "text-ink",
  PorTransferir: "text-status-pt",
  Inspeccion: "text-status-empty",
  Retrabajo: "text-status-partial",
  Encaminadas: "text-status-covered",
};

/** Clases de los badges de pie (Inspeccion / Retrabajo). */
const BADGE_COLOR: Record<"Inspeccion" | "Retrabajo", string> = {
  Inspeccion: "bg-status-empty/15 text-status-empty hover:bg-status-empty/25",
  Retrabajo: "bg-status-partial/15 text-status-partial hover:bg-status-partial/25",
};

const BADGE_DOT: Record<"Inspeccion" | "Retrabajo", string> = {
  Inspeccion: "bg-status-empty",
  Retrabajo: "bg-status-partial",
};

/** ">" — chevron que ilustra el avance del material de izquierda a derecha. */
export function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3 w-3 shrink-0 text-ink-subtle ${className}`}
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Punto solido de los badges de pie. */
export function Dot({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`h-1.5 w-1.5 rounded-full shrink-0 ${className}`}
    />
  );
}

interface BucketMetricProps {
  value: number;
  bucket: BucketKind;
  /** `lg` = metrica dominante (centro de la fila). `sm` = flanco. */
  size?: "sm" | "lg";
  /** Si se omite, la metrica se renderiza como texto (no interactiva). */
  onClick?: () => void;
  /** Fuerza el estado apagado aunque `value > 0` (ej. proceso sin id). */
  disabled?: boolean;
  /** Oculta el label bajo el numero (filas compactas de apoyo). */
  hideLabel?: boolean;
  /** Atenua toda la metrica — usada como leyenda de apoyo. */
  muted?: boolean;
  /** Se antepone al label (ej. "Requerimiento"). */
  labelOverride?: string;
}

/**
 * Una metrica de la fila direccional. Si recibe `onClick` se renderiza como
 * boton (con `nodrag` para no arrastrar el nodo al hacer click dentro de un
 * canvas de React Flow); si no, como texto plano.
 */
export function BucketMetric({
  value,
  bucket,
  size = "sm",
  onClick,
  disabled = false,
  hideLabel = false,
  muted = false,
  labelOverride,
}: BucketMetricProps) {
  const off = disabled || value <= 0;
  const label = labelOverride ?? BUCKET_LABEL[bucket];

  const numberCls = muted
    ? "text-xs font-semibold"
    : size === "lg"
      ? "text-3xl font-bold"
      : "text-lg font-semibold";

  const colorCls = off ? "text-ink-subtle" : BUCKET_COLOR[bucket];

  const numero = (
    <div className={`tabular-nums leading-none truncate ${numberCls} ${colorCls}`}>
      {fmtInt(value)}
    </div>
  );

  const texto = hideLabel ? null : (
    <div
      className={`uppercase tracking-wide text-ink-subtle mt-0.5 ${
        muted ? "text-[9px]" : "text-[10px]"
      }`}
    >
      {label}
    </div>
  );

  if (!onClick) {
    return (
      <div className="min-w-0 text-center px-1" title={`${label}: ${fmtInt(value)}`}>
        {numero}
        {texto}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-bucket-button
      disabled={off}
      onClick={(e) => {
        e.stopPropagation();
        if (!off) onClick();
      }}
      title={off ? `${label}: sin etiquetas` : `Ver etiquetas — ${label}`}
      className={`nodrag min-w-0 text-center rounded p-1 transition ${
        off ? "cursor-default" : "cursor-pointer hover:bg-surface-subtle"
      }`}
    >
      {numero}
      {texto}
    </button>
  );
}

interface BucketBadgeProps {
  value: number;
  bucket: "Inspeccion" | "Retrabajo";
  onClick?: () => void;
}

/** Badge de pie para los estados de excepcion (Inspeccion / Retrabajo). */
export function BucketBadge({ value, bucket, onClick }: BucketBadgeProps) {
  const label = bucket === "Inspeccion" ? "insp." : "retrab.";
  const cls = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums transition ${BADGE_COLOR[bucket]}`;

  if (!onClick) {
    return (
      <span className={cls}>
        <Dot className={BADGE_DOT[bucket]} />
        {fmtInt(value)} {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-bucket-button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`nodrag cursor-pointer ${cls}`}
    >
      <Dot className={BADGE_DOT[bucket]} />
      {fmtInt(value)} {label}
    </button>
  );
}

interface BucketRowProps {
  children: ReactNode;
  className?: string;
}

/** Contenedor de la fila direccional: centra las metricas y las separa. */
export function BucketRow({ children, className = "" }: BucketRowProps) {
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      {children}
    </div>
  );
}
